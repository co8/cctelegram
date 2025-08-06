//! MCP connection management with pooling, retry logic, and circuit breaker pattern

use super::errors::{McpError, McpErrorCode};
use super::McpConfig;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock, Semaphore};
use tracing::{debug, error, info, warn};

/// Connection pool for MCP server connections
pub struct McpConnectionPool {
    connections: Arc<Mutex<VecDeque<McpClient>>>,
    semaphore: Arc<Semaphore>,
    config: McpConfig,
}

/// Individual MCP client connection
#[derive(Debug, Clone)]
pub struct McpClient {
    id: String,
    created_at: Instant,
    last_used: Instant,
    is_healthy: bool,
    request_count: u64,
}

/// Circuit breaker state for handling MCP server failures
#[derive(Debug, Clone)]
pub struct CircuitBreakerState {
    state: CircuitState,
    failure_count: u8,
    last_failure: Option<Instant>,
    next_attempt: Option<Instant>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    Closed,   // Normal operation
    Open,     // Failing - reject requests immediately  
    HalfOpen, // Testing - allow limited requests
}

/// Main connection manager with retry logic and circuit breaker
pub struct McpConnectionManager {
    pool: Arc<McpConnectionPool>,
    circuit_breaker: Arc<RwLock<CircuitBreakerState>>,
    config: McpConfig,
    health_port: String,
}

impl McpClient {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now,
            last_used: now,
            is_healthy: true,
            request_count: 0,
        }
    }

    fn mark_used(&mut self) {
        self.last_used = Instant::now();
        self.request_count += 1;
    }

    fn is_expired(&self, max_age: Duration) -> bool {
        self.created_at.elapsed() > max_age
    }
}

impl McpConnectionPool {
    fn new(config: &McpConfig) -> Self {
        Self {
            connections: Arc::new(Mutex::new(VecDeque::new())),
            semaphore: Arc::new(Semaphore::new(config.max_connections)),
            config: config.clone(),
        }
    }

    async fn acquire(&self) -> Result<McpClient, McpError> {
        // Wait for available slot in connection pool
        let _permit = self.semaphore.acquire().await
            .map_err(|_| McpError::ConnectionPoolExhausted)?;

        let mut connections = self.connections.lock().await;
        
        // Try to reuse existing connection
        if let Some(mut client) = connections.pop_front() {
            client.mark_used();
            debug!("Reusing MCP client connection: {}", client.id);
            return Ok(client);
        }

        // Create new connection
        let client = McpClient::new();
        info!("Created new MCP client connection: {}", client.id);
        Ok(client)
    }

    async fn release(&self, mut client: McpClient) {
        client.mark_used();
        
        // Check if connection should be kept alive
        let max_age = Duration::from_secs(300); // 5 minutes
        if !client.is_expired(max_age) && client.is_healthy {
            let client_id = client.id.clone();
            let mut connections = self.connections.lock().await;
            connections.push_back(client);
            debug!("Returned MCP client to pool: {}", client_id);
        } else {
            let client_id = client.id.clone();
            debug!("Discarded expired/unhealthy MCP client: {}", client_id);
        }
    }
}

impl CircuitBreakerState {
    fn new() -> Self {
        Self {
            state: CircuitState::Closed,
            failure_count: 0,
            last_failure: None,
            next_attempt: None,
        }
    }

    fn record_success(&mut self) {
        self.state = CircuitState::Closed;
        self.failure_count = 0;
        self.last_failure = None;
        self.next_attempt = None;
        debug!("Circuit breaker reset to Closed state");
    }

    fn record_failure(&mut self, threshold: u8, timeout_duration: Duration) {
        self.failure_count += 1;
        self.last_failure = Some(Instant::now());

        match self.state {
            CircuitState::Closed if self.failure_count >= threshold => {
                self.state = CircuitState::Open;
                self.next_attempt = Some(Instant::now() + timeout_duration);
                warn!("Circuit breaker opened after {} failures", self.failure_count);
            }
            CircuitState::HalfOpen => {
                self.state = CircuitState::Open;
                self.next_attempt = Some(Instant::now() + timeout_duration);
                warn!("Circuit breaker reopened after failure in HalfOpen state");
            }
            _ => {
                debug!("Circuit breaker failure count: {}", self.failure_count);
            }
        }
    }

    fn can_attempt(&mut self) -> bool {
        match self.state {
            CircuitState::Closed => true,
            CircuitState::Open => {
                if let Some(next_attempt) = self.next_attempt {
                    if Instant::now() >= next_attempt {
                        self.state = CircuitState::HalfOpen;
                        debug!("Circuit breaker moved to HalfOpen state");
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            CircuitState::HalfOpen => true,
        }
    }
}

impl McpConnectionManager {
    pub fn new(config: &McpConfig) -> Self {
        let health_port = std::env::var("CC_TELEGRAM_HEALTH_PORT")
            .unwrap_or_else(|_| "8080".to_string());

        Self {
            pool: Arc::new(McpConnectionPool::new(config)),
            circuit_breaker: Arc::new(RwLock::new(CircuitBreakerState::new())),
            config: config.clone(),
            health_port,
        }
    }

    /// Execute MCP command with retry logic and circuit breaker protection
    pub async fn execute_with_retry(
        &self,
        command: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        // Check circuit breaker
        {
            let mut breaker = self.circuit_breaker.write().await;
            if !breaker.can_attempt() {
                return Err(McpError::CircuitBreakerOpen);
            }
        }

        let mut last_error = None;
        let mut delay = Duration::from_millis(self.config.base_retry_delay_ms);

        for attempt in 0..=self.config.max_retries {
            match self.execute_once(command, &params).await {
                Ok(result) => {
                    // Record success in circuit breaker
                    {
                        let mut breaker = self.circuit_breaker.write().await;
                        breaker.record_success();
                    }
                    
                    info!("MCP command '{}' succeeded on attempt {}", command, attempt + 1);
                    return Ok(result);
                }
                Err(error) => {
                    last_error = Some(error.clone());
                    warn!("MCP command '{}' failed on attempt {}: {:?}", command, attempt + 1, error);

                    // Don't retry on certain error types
                    if matches!(error.code(), McpErrorCode::AuthenticationFailure | McpErrorCode::InvalidRequest) {
                        break;
                    }

                    // Apply exponential backoff delay if not the last attempt
                    if attempt < self.config.max_retries {
                        tokio::time::sleep(delay).await;
                        delay = delay * 2; // Exponential backoff
                        
                        // Add jitter to prevent thundering herd
                        let jitter = Duration::from_millis(rand::random::<u64>() % 100);
                        delay += jitter;
                    }
                }
            }
        }

        // Record failure in circuit breaker
        {
            let mut breaker = self.circuit_breaker.write().await;
            breaker.record_failure(
                self.config.circuit_breaker_threshold,
                Duration::from_secs(self.config.circuit_breaker_timeout_s),
            );
        }

        error!("MCP command '{}' failed after {} attempts", command, self.config.max_retries + 1);
        Err(last_error.unwrap_or(McpError::UnknownError))
    }

    /// Execute single MCP command attempt
    async fn execute_once(
        &self,
        command: &str,
        _params: &serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        let client = self.pool.acquire().await?;
        
        let result = match command {
            "get_tasks" => self.query_tasks().await,
            "health_check" => {
                let healthy = self.check_mcp_health().await?;
                Ok(serde_json::json!({"healthy": healthy}))
            }
            _ => Err(McpError::UnsupportedOperation(command.to_string())),
        };

        // Return client to pool
        self.pool.release(client).await;

        result
    }

    /// Query MCP server for task information
    async fn query_tasks(&self) -> Result<serde_json::Value, McpError> {
        // For now, this returns the current implementation behavior
        // In the future, this would make actual MCP protocol calls
        Err(McpError::NotImplemented("MCP task querying via stdio not implemented yet".to_string()))
    }

    /// Check MCP server health via HTTP endpoint
    async fn check_mcp_health(&self) -> Result<bool, McpError> {
        let health_url = format!("http://localhost:{}/health", self.health_port);
        
        let client = reqwest::Client::new();
        let response = client
            .get(&health_url)
            .timeout(Duration::from_millis(self.config.connection_timeout_ms))
            .send()
            .await
            .map_err(|e| McpError::ConnectionTimeout(e.to_string()))?;

        Ok(response.status().is_success())
    }

    /// Public health check method
    pub async fn health_check(&self) -> Result<bool, McpError> {
        self.check_mcp_health().await
    }

    /// Get connection pool statistics
    pub async fn get_pool_stats(&self) -> serde_json::Value {
        let connections = self.pool.connections.lock().await;
        let available_permits = self.pool.semaphore.available_permits();
        
        serde_json::json!({
            "pool_size": connections.len(),
            "max_connections": self.config.max_connections,
            "available_permits": available_permits,
            "active_connections": self.config.max_connections - available_permits
        })
    }

    /// Get circuit breaker status
    pub async fn get_circuit_breaker_status(&self) -> serde_json::Value {
        let breaker = self.circuit_breaker.read().await;
        
        serde_json::json!({
            "state": format!("{:?}", breaker.state),
            "failure_count": breaker.failure_count,
            "last_failure": breaker.last_failure.map(|t| t.elapsed().as_secs()),
            "next_attempt": breaker.next_attempt.map(|t| {
                let remaining = t.saturating_duration_since(Instant::now());
                remaining.as_secs()
            })
        })
    }
}
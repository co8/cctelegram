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
            "todo" => self.query_todo().await,
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
        // Try to call the MCP server's get_task_status function
        // For now, we'll use a subprocess call to the MCP server
        match self.call_mcp_function("get_task_status", serde_json::json!({})).await {
            Ok(result) => Ok(result),
            Err(_) => {
                // Fallback: try to read TaskMaster file directly
                self.fallback_query_tasks().await
            }
        }
    }

    /// Call MCP server function via subprocess
    async fn call_mcp_function(&self, function: &str, args: serde_json::Value) -> Result<serde_json::Value, McpError> {
        use tokio::process::Command;
        use tokio::io::AsyncWriteExt;

        let current_dir = std::env::current_dir()
            .map_err(|e| McpError::ConfigurationError(format!("Cannot get current directory: {}", e)))?;
        
        let mcp_server_dir = current_dir.join("mcp-server");
        
        if !mcp_server_dir.exists() {
            return Err(McpError::ConfigurationError("MCP server directory not found".to_string()));
        }

        // Create MCP request
        let mcp_request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": function,
                "arguments": args
            }
        });

        // Call the MCP server via node
        let mut child = Command::new("node")
            .arg("dist/index.js")
            .current_dir(&mcp_server_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| McpError::ConnectionTimeout(format!("Failed to spawn MCP server: {}", e)))?;

        // Send the request
        if let Some(stdin) = child.stdin.as_mut() {
            let request_str = serde_json::to_string(&mcp_request)
                .map_err(|e| McpError::SerializationError(e.to_string()))?;
            
            stdin.write_all(request_str.as_bytes()).await
                .map_err(|e| McpError::ConnectionTimeout(format!("Failed to write to MCP server: {}", e)))?;
            stdin.write_all(b"\n").await
                .map_err(|e| McpError::ConnectionTimeout(format!("Failed to write newline: {}", e)))?;
        }

        // Wait for response with timeout
        let output = tokio::time::timeout(
            Duration::from_millis(self.config.connection_timeout_ms),
            child.wait_with_output()
        ).await
        .map_err(|_| McpError::ConnectionTimeout("MCP server call timed out".to_string()))?
        .map_err(|e| McpError::ConnectionTimeout(format!("MCP server process error: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(McpError::ConnectionTimeout(format!("MCP server error: {}", stderr)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        
        // Parse the MCP response
        for line in stdout.lines() {
            if let Ok(response) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(result) = response.get("result") {
                    if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
                        if let Some(first_content) = content.first() {
                            if let Some(text) = first_content.get("text").and_then(|t| t.as_str()) {
                                // Parse the text as JSON to get the actual task data
                                let task_data: serde_json::Value = serde_json::from_str(text)
                                    .map_err(|e| McpError::SerializationError(e.to_string()))?;
                                
                                // Transform TaskMaster data to bridge format
                                return self.transform_taskmaster_response(task_data).await;
                            }
                        }
                    }
                } else if let Some(error) = response.get("error") {
                    return Err(McpError::ProtocolError(error.to_string()));
                }
            }
        }

        Err(McpError::SerializationError("Invalid MCP response format".to_string()))
    }

    /// Transform TaskMaster MCP response to bridge format
    async fn transform_taskmaster_response(&self, data: serde_json::Value) -> Result<serde_json::Value, McpError> {
        // Extract TaskMaster data from the get_task_status response
        if let Some(taskmaster_tasks) = data.get("taskmaster_tasks") {
            if let Some(available) = taskmaster_tasks.get("available").and_then(|a| a.as_bool()) {
                if available {
                    // Extract counts from combined_summary
                    let pending = data.get("combined_summary")
                        .and_then(|s| s.get("total_pending"))
                        .and_then(|p| p.as_u64())
                        .unwrap_or(0);
                    
                    let in_progress = data.get("combined_summary")
                        .and_then(|s| s.get("total_in_progress"))
                        .and_then(|p| p.as_u64())
                        .unwrap_or(0);
                    
                    let completed = data.get("combined_summary")
                        .and_then(|s| s.get("total_completed"))
                        .and_then(|p| p.as_u64())
                        .unwrap_or(0);
                    
                    let blocked = data.get("combined_summary")
                        .and_then(|s| s.get("total_blocked"))
                        .and_then(|p| p.as_u64())
                        .unwrap_or(0);
                    
                    let total = data.get("combined_summary")
                        .and_then(|s| s.get("grand_total"))
                        .and_then(|t| t.as_u64())
                        .unwrap_or(0);
                    
                    let main_tasks_count = taskmaster_tasks.get("main_tasks_count")
                        .and_then(|m| m.as_u64())
                        .unwrap_or(0);
                    
                    let subtasks_count = taskmaster_tasks.get("subtasks_count")
                        .and_then(|s| s.as_u64())
                        .unwrap_or(0);
                    
                    let project_name = taskmaster_tasks.get("project_name")
                        .and_then(|p| p.as_str())
                        .unwrap_or("CCTelegram Project");

                    return Ok(serde_json::json!({
                        "source": "live_mcp",
                        "project_name": project_name,
                        "stats": {
                            "pending": pending,
                            "in_progress": in_progress,
                            "completed": completed,
                            "blocked": blocked,
                            "total": total,
                            "main_tasks": main_tasks_count,
                            "subtasks": subtasks_count
                        },
                        "last_updated": chrono::Utc::now().to_rfc3339(),
                        "is_fallback": false
                    }));
                }
            }
        }

        // Fallback to original parsing logic
        Err(McpError::SerializationError("Unable to parse TaskMaster MCP response".to_string()))
    }

    /// Fallback method to query tasks from file system
    async fn fallback_query_tasks(&self) -> Result<serde_json::Value, McpError> {
        use tokio::fs;

        let current_dir = std::env::current_dir()
            .map_err(|e| McpError::ConfigurationError(format!("Cannot get current directory: {}", e)))?;
        
        let taskmaster_path = current_dir.join(".taskmaster/tasks/tasks.json");
        
        if !taskmaster_path.exists() {
            return Ok(serde_json::json!({
                "source": "fallback",
                "data": {
                    "tasks": [],
                    "stats": {
                        "total": 0,
                        "pending": 0,
                        "in_progress": 0,
                        "completed": 0,
                        "blocked": 0
                    }
                }
            }));
        }

        let content = fs::read_to_string(&taskmaster_path).await
            .map_err(|e| McpError::ConfigurationError(format!("Cannot read TaskMaster file: {}", e)))?;
        
        let data: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| McpError::SerializationError(format!("Invalid TaskMaster JSON: {}", e)))?;

        Ok(serde_json::json!({
            "source": "fallback",
            "data": data
        }))
    }

    /// Query MCP server for todo information
    async fn query_todo(&self) -> Result<serde_json::Value, McpError> {
        // Try to call the MCP server's todo function
        match self.call_mcp_function("todo", serde_json::json!({})).await {
            Ok(result) => {
                // The todo function returns text content directly
                if let Some(text) = result.as_str() {
                    Ok(serde_json::json!({
                        "content": [{
                            "type": "text",
                            "text": text
                        }]
                    }))
                } else {
                    Ok(result)
                }
            }
            Err(_) => {
                // Fallback todo response
                let fallback_text = "*📋 Todo Status*\n\nℹ️ No active todo list found\n💡 Use Claude Code to create tasks\n\n*🚀 Available Commands:*\n• `/tasks` \\- View TaskMaster status\n• `/bridge` \\- View bridge status";
                Ok(serde_json::json!(fallback_text))
            }
        }
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
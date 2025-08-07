/**
 * Task 37.3: Multi-Token Load Balancing and Failover System
 * Specialized agent-based architecture for token pool management
 */

use anyhow::{Result, Context};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, Mutex, mpsc, oneshot};
use tracing::{debug, warn, error, info, instrument};
use uuid::Uuid;
use chrono::{DateTime, Utc};

// Re-export rate limiter types for integration
pub use crate::telegram::rate_limiter::{RateLimiterConfig, RateLimiterMetrics};

/// Token performance metrics for health monitoring and weighted distribution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenMetrics {
    pub token_id: String,
    pub success_rate: f64,              // 0.0 to 1.0
    pub average_response_time_ms: u64,  // Average API response time
    pub rate_limit_hits: u64,           // Number of rate limit violations
    pub consecutive_failures: u32,       // Consecutive failure count
    pub last_success: Option<DateTime<Utc>>,
    pub last_failure: Option<DateTime<Utc>>,
    pub total_requests: u64,
    pub total_successes: u64,
    pub total_failures: u64,
    pub is_rate_limited: bool,          // Currently rate limited
    pub rate_limit_reset_time: Option<DateTime<Utc>>,
    pub weight: f64,                    // Weighted distribution factor (0.0 to 1.0)
}

impl Default for TokenMetrics {
    fn default() -> Self {
        Self {
            token_id: String::new(),
            success_rate: 1.0,
            average_response_time_ms: 0,
            rate_limit_hits: 0,
            consecutive_failures: 0,
            last_success: None,
            last_failure: None,
            total_requests: 0,
            total_successes: 0,
            total_failures: 0,
            is_rate_limited: false,
            rate_limit_reset_time: None,
            weight: 1.0,
        }
    }
}

/// Token health status for circuit breaker pattern
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TokenHealthStatus {
    Healthy,        // Normal operation
    Degraded,       // Performance issues but still usable
    Unhealthy,      // Significant issues, avoid if possible
    RateLimited,    // Currently rate limited by Telegram
    Failed,         // Complete failure, circuit breaker open
}

/// Token configuration with validation settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenConfig {
    pub token: String,
    pub bot_username: Option<String>,
    pub chat_permissions: Vec<i64>,     // Allowed chat IDs (empty = all allowed)
    pub rate_limit_override: Option<u32>, // Custom rate limit if different from global
    pub priority: u8,                   // 1 = highest, 255 = lowest priority
    pub enabled: bool,                  // Can be disabled without removing from pool
    pub max_consecutive_failures: u32,  // Circuit breaker threshold
    pub health_check_interval_secs: u64, // Health check frequency
}

/// Multi-token system configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiTokenConfig {
    pub tokens: Vec<TokenConfig>,
    pub load_balancing_strategy: LoadBalancingStrategy,
    pub health_monitoring: HealthMonitoringConfig,
    pub failover: FailoverConfig,
    pub validation: ValidationConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LoadBalancingStrategy {
    RoundRobin,           // Simple round-robin
    WeightedRoundRobin,   // Based on performance weights
    LeastConnections,     // Choose token with least active requests
    PerformanceBased,     // Choose best performing token
    Adaptive,             // Dynamically adjust based on conditions
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthMonitoringConfig {
    pub enable_continuous_monitoring: bool,
    pub health_check_interval_secs: u64,
    pub performance_degradation_threshold: f64,    // Success rate below which token is degraded
    pub unhealthy_threshold: f64,                  // Success rate below which token is unhealthy
    pub rate_limit_detection_enabled: bool,
    pub metrics_retention_hours: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailoverConfig {
    pub enable_automatic_failover: bool,
    pub max_consecutive_failures: u32,
    pub failover_cooldown_secs: u64,              // Time before retrying failed token
    pub enable_graceful_rotation: bool,           // Rotate without message loss
    pub fallback_strategy: FallbackStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FallbackStrategy {
    NextHealthyToken,     // Fail to next healthy token
    BestAvailableToken,   // Fail to best performing available token
    PriorityBased,        // Fail based on configured priorities
    LoadDistribution,     // Distribute load across remaining tokens
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationConfig {
    pub enable_token_validation: bool,
    pub validate_on_startup: bool,
    pub validate_permissions: bool,
    pub validation_timeout_secs: u64,
    pub revalidation_interval_hours: u64,
}

impl Default for MultiTokenConfig {
    fn default() -> Self {
        Self {
            tokens: Vec::new(),
            load_balancing_strategy: LoadBalancingStrategy::WeightedRoundRobin,
            health_monitoring: HealthMonitoringConfig {
                enable_continuous_monitoring: true,
                health_check_interval_secs: 30,
                performance_degradation_threshold: 0.8,
                unhealthy_threshold: 0.5,
                rate_limit_detection_enabled: true,
                metrics_retention_hours: 24,
            },
            failover: FailoverConfig {
                enable_automatic_failover: true,
                max_consecutive_failures: 3,
                failover_cooldown_secs: 300, // 5 minutes
                enable_graceful_rotation: true,
                fallback_strategy: FallbackStrategy::BestAvailableToken,
            },
            validation: ValidationConfig {
                enable_token_validation: true,
                validate_on_startup: true,
                validate_permissions: true,
                validation_timeout_secs: 10,
                revalidation_interval_hours: 6,
            },
        }
    }
}

/// Agent communication messages for coordination
#[derive(Debug)]
pub enum AgentMessage {
    // Token Pool messages
    SelectToken { 
        chat_id: i64, 
        response_tx: oneshot::Sender<Result<String>> 
    },
    RecordSuccess { 
        token_id: String, 
        response_time_ms: u64 
    },
    RecordFailure { 
        token_id: String, 
        error: String 
    },
    GetMetrics { 
        response_tx: oneshot::Sender<HashMap<String, TokenMetrics>> 
    },
    
    // Health Monitor messages
    PerformHealthCheck { 
        token_id: Option<String> 
    },
    UpdateTokenHealth { 
        token_id: String, 
        status: TokenHealthStatus,
        metrics: Option<TokenMetrics>
    },
    
    // Failover Manager messages
    TriggerFailover { 
        failed_token_id: String, 
        reason: String 
    },
    RestoreToken { 
        token_id: String 
    },
    
    // Token Validator messages
    ValidateToken { 
        token_id: String, 
        response_tx: oneshot::Sender<Result<bool>> 
    },
    ValidateAllTokens { 
        response_tx: oneshot::Sender<Result<HashMap<String, bool>>> 
    },
    
    // System messages
    Shutdown,
    GetStatus { 
        response_tx: oneshot::Sender<SystemStatus> 
    },
}

/// System status for monitoring and debugging
#[derive(Debug, Clone, Serialize)]
pub struct SystemStatus {
    pub active_tokens: u32,
    pub healthy_tokens: u32,
    pub rate_limited_tokens: u32,
    pub failed_tokens: u32,
    pub total_requests: u64,
    pub total_successes: u64,
    pub total_failures: u64,
    pub average_response_time_ms: u64,
    pub current_strategy: String,
    pub last_failover: Option<DateTime<Utc>>,
    pub agent_status: HashMap<String, String>,
}

/// Token selection result with context
#[derive(Debug, Clone)]
pub struct TokenSelection {
    pub token_id: String,
    pub token: String,
    pub selection_reason: String,
    pub fallback_tokens: Vec<String>,
    pub estimated_weight: f64,
}

/// Specialized agent trait for parallel processing
#[async_trait]
pub trait SpecializedAgent: Send + Sync {
    /// Agent name for identification
    fn name(&self) -> &str;
    
    /// Start the agent's background processing
    async fn start(&mut self) -> Result<()>;
    
    /// Stop the agent gracefully
    async fn stop(&mut self) -> Result<()>;
    
    /// Check agent health
    async fn health_check(&self) -> Result<bool>;
    
    /// Process agent-specific messages
    async fn process_message(&mut self, message: AgentMessage) -> Result<()>;
}

/// Token Pool Manager - coordinates token selection and load balancing
pub struct TokenPoolManager {
    config: MultiTokenConfig,
    tokens: Arc<RwLock<HashMap<String, TokenConfig>>>,
    metrics: Arc<RwLock<HashMap<String, TokenMetrics>>>,
    active_requests: Arc<RwLock<HashMap<String, u32>>>, // Track active requests per token
    selection_index: Arc<Mutex<usize>>, // For round-robin selection
    message_rx: Option<mpsc::UnboundedReceiver<AgentMessage>>,
    message_tx: mpsc::UnboundedSender<AgentMessage>,
    shutdown_signal: Option<oneshot::Receiver<()>>,
    running: Arc<RwLock<bool>>,
}

impl TokenPoolManager {
    pub fn new(config: MultiTokenConfig) -> Result<Self> {
        let (message_tx, message_rx) = mpsc::unbounded_channel();
        let mut tokens = HashMap::new();
        let mut metrics = HashMap::new();
        
        // Initialize token pool from configuration
        for token_config in &config.tokens {
            let token_id = Self::generate_token_id(&token_config.token);
            tokens.insert(token_id.clone(), token_config.clone());
            
            let mut token_metrics = TokenMetrics::default();
            token_metrics.token_id = token_id.clone();
            token_metrics.weight = 1.0 / config.tokens.len() as f64; // Initial equal weighting
            metrics.insert(token_id, token_metrics);
        }
        
        Ok(Self {
            config,
            tokens: Arc::new(RwLock::new(tokens)),
            metrics: Arc::new(RwLock::new(metrics)),
            active_requests: Arc::new(RwLock::new(HashMap::new())),
            selection_index: Arc::new(Mutex::new(0)),
            message_rx: Some(message_rx),
            message_tx,
            shutdown_signal: None,
            running: Arc::new(RwLock::new(false)),
        })
    }
    
    fn generate_token_id(token: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        token.hash(&mut hasher);
        format!("token_{:x}", hasher.finish())
    }
    
    pub fn get_message_sender(&self) -> mpsc::UnboundedSender<AgentMessage> {
        self.message_tx.clone()
    }
    
    /// Select optimal token based on current strategy and conditions
    #[instrument(skip(self))]
    pub async fn select_token(&self, chat_id: i64) -> Result<TokenSelection> {
        let tokens = self.tokens.read().await;
        let metrics = self.metrics.read().await;
        let active_requests = self.active_requests.read().await;
        
        // Filter available tokens (healthy and enabled)
        let available_tokens: Vec<_> = tokens
            .iter()
            .filter(|(token_id, token_config)| {
                token_config.enabled &&
                self.is_token_available_for_chat(token_config, chat_id) &&
                self.is_token_healthy(&metrics, token_id)
            })
            .collect();
        
        if available_tokens.is_empty() {
            return Err(anyhow::anyhow!("No healthy tokens available"));
        }
        
        // Apply load balancing strategy
        let selected = match self.config.load_balancing_strategy {
            LoadBalancingStrategy::RoundRobin => {
                self.select_round_robin(&available_tokens).await?
            }
            LoadBalancingStrategy::WeightedRoundRobin => {
                self.select_weighted_round_robin(&available_tokens, &metrics).await?
            }
            LoadBalancingStrategy::LeastConnections => {
                self.select_least_connections(&available_tokens, &active_requests).await?
            }
            LoadBalancingStrategy::PerformanceBased => {
                self.select_performance_based(&available_tokens, &metrics).await?
            }
            LoadBalancingStrategy::Adaptive => {
                self.select_adaptive(&available_tokens, &metrics, &active_requests).await?
            }
        };
        
        // Build fallback token list (remaining available tokens sorted by preference)
        let fallback_tokens = self.build_fallback_list(&available_tokens, &selected.0, &metrics).await;
        
        Ok(TokenSelection {
            token_id: selected.0.clone(),
            token: selected.1.token.clone(),
            selection_reason: selected.2,
            fallback_tokens,
            estimated_weight: metrics.get(&selected.0)
                .map(|m| m.weight)
                .unwrap_or(1.0),
        })
    }
    
    fn is_token_available_for_chat(&self, token_config: &TokenConfig, chat_id: i64) -> bool {
        if token_config.chat_permissions.is_empty() {
            return true; // No restrictions
        }
        token_config.chat_permissions.contains(&chat_id)
    }
    
    fn is_token_healthy(&self, metrics: &HashMap<String, TokenMetrics>, token_id: &str) -> bool {
        metrics.get(token_id)
            .map(|m| !m.is_rate_limited && m.consecutive_failures < 3)
            .unwrap_or(false)
    }
    
    async fn select_round_robin(&self, available_tokens: &[(&String, &TokenConfig)]) -> Result<(String, TokenConfig, String)> {
        let mut index = self.selection_index.lock().await;
        *index = (*index + 1) % available_tokens.len();
        
        let (token_id, token_config) = available_tokens[*index];
        Ok((token_id.clone(), token_config.clone(), "Round-robin selection".to_string()))
    }
    
    async fn select_weighted_round_robin(
        &self, 
        available_tokens: &[(&String, &TokenConfig)], 
        metrics: &HashMap<String, TokenMetrics>
    ) -> Result<(String, TokenConfig, String)> {
        // Calculate total weight
        let total_weight: f64 = available_tokens
            .iter()
            .map(|(token_id, _)| {
                metrics.get(*token_id)
                    .map(|m| m.weight)
                    .unwrap_or(1.0)
            })
            .sum();
        
        if total_weight <= 0.0 {
            return self.select_round_robin(available_tokens).await;
        }
        
        // Generate random value for weighted selection
        let random_value = rand::random::<f64>() * total_weight;
        let mut cumulative_weight = 0.0;
        
        for (token_id, token_config) in available_tokens {
            let weight = metrics.get(*token_id)
                .map(|m| m.weight)
                .unwrap_or(1.0);
            cumulative_weight += weight;
            
            if random_value <= cumulative_weight {
                return Ok((
                    token_id.to_string(), 
                    (*token_config).clone(), 
                    format!("Weighted selection (weight: {:.3})", weight)
                ));
            }
        }
        
        // Fallback to first token if calculation fails
        let (token_id, token_config) = available_tokens[0];
        Ok((token_id.clone(), token_config.clone(), "Weighted fallback".to_string()))
    }
    
    async fn select_least_connections(
        &self, 
        available_tokens: &[(&String, &TokenConfig)], 
        active_requests: &HashMap<String, u32>
    ) -> Result<(String, TokenConfig, String)> {
        let (token_id, token_config) = available_tokens
            .iter()
            .min_by_key(|(token_id, _)| {
                active_requests.get(*token_id).unwrap_or(&0)
            })
            .ok_or_else(|| anyhow::anyhow!("No tokens available for least connections selection"))?;
        
        let connections = active_requests.get(*token_id).unwrap_or(&0);
        Ok((token_id.to_string(), (*token_config).clone(), format!("Least connections ({} active)", connections)))
    }
    
    async fn select_performance_based(
        &self, 
        available_tokens: &[(&String, &TokenConfig)], 
        metrics: &HashMap<String, TokenMetrics>
    ) -> Result<(String, TokenConfig, String)> {
        let (token_id, token_config) = available_tokens
            .iter()
            .max_by(|(a_id, _), (b_id, _)| {
                let a_score = self.calculate_performance_score(metrics, a_id);
                let b_score = self.calculate_performance_score(metrics, b_id);
                a_score.partial_cmp(&b_score).unwrap_or(std::cmp::Ordering::Equal)
            })
            .ok_or_else(|| anyhow::anyhow!("No tokens available for performance-based selection"))?;
        
        let score = self.calculate_performance_score(metrics, token_id);
        Ok((token_id.to_string(), (*token_config).clone(), format!("Performance-based (score: {:.3})", score)))
    }
    
    fn calculate_performance_score(&self, metrics: &HashMap<String, TokenMetrics>, token_id: &str) -> f64 {
        if let Some(metric) = metrics.get(token_id) {
            // Combine success rate, response time, and rate limit status
            let success_weight = metric.success_rate * 0.5;
            let response_time_weight = if metric.average_response_time_ms > 0 {
                (1.0 / (metric.average_response_time_ms as f64 / 1000.0)) * 0.3
            } else {
                0.3
            };
            let rate_limit_penalty = if metric.is_rate_limited { -0.5 } else { 0.0 };
            let consecutive_failures_penalty = -(metric.consecutive_failures as f64 * 0.1);
            
            (success_weight + response_time_weight + rate_limit_penalty + consecutive_failures_penalty).max(0.0)
        } else {
            0.0
        }
    }
    
    async fn select_adaptive(
        &self, 
        available_tokens: &[(&String, &TokenConfig)], 
        metrics: &HashMap<String, TokenMetrics>,
        active_requests: &HashMap<String, u32>
    ) -> Result<(String, TokenConfig, String)> {
        // Adaptive selection combines multiple strategies based on current conditions
        let total_active = active_requests.values().sum::<u32>();
        
        // Under low load, prefer performance-based selection
        if total_active < 5 {
            self.select_performance_based(available_tokens, metrics).await
        }
        // Under high load, prefer least connections
        else if total_active > 20 {
            self.select_least_connections(available_tokens, active_requests).await
        }
        // Medium load, use weighted round-robin
        else {
            self.select_weighted_round_robin(available_tokens, metrics).await
        }
    }
    
    async fn build_fallback_list(
        &self,
        available_tokens: &[(&String, &TokenConfig)],
        selected_token_id: &str,
        metrics: &HashMap<String, TokenMetrics>
    ) -> Vec<String> {
        let mut fallback_tokens: Vec<_> = available_tokens
            .iter()
            .filter(|(token_id, _)| *token_id != selected_token_id)
            .map(|(token_id, _)| {
                let score = self.calculate_performance_score(metrics, token_id);
                (token_id.clone(), score)
            })
            .collect();
        
        // Sort by performance score (descending)
        fallback_tokens.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        
        fallback_tokens.into_iter().map(|(token_id, _)| token_id).collect()
    }
    
    /// Record successful token usage and update metrics
    pub async fn record_success(&self, token_id: &str, response_time_ms: u64) -> Result<()> {
        let mut metrics = self.metrics.write().await;
        let mut active_requests = self.active_requests.write().await;
        
        // Update metrics
        if let Some(metric) = metrics.get_mut(token_id) {
            metric.total_requests += 1;
            metric.total_successes += 1;
            metric.consecutive_failures = 0;
            metric.last_success = Some(Utc::now());
            
            // Update success rate
            metric.success_rate = metric.total_successes as f64 / metric.total_requests as f64;
            
            // Update average response time (simple moving average)
            if metric.average_response_time_ms == 0 {
                metric.average_response_time_ms = response_time_ms;
            } else {
                metric.average_response_time_ms = 
                    (metric.average_response_time_ms + response_time_ms) / 2;
            }
            
            // Recalculate weight based on performance
            metric.weight = self.calculate_token_weight(metric);
            
            debug!("✅ Token {} success recorded: response_time={}ms, success_rate={:.3}, weight={:.3}",
                   token_id, response_time_ms, metric.success_rate, metric.weight);
        }
        
        // Decrease active request count
        if let Some(count) = active_requests.get_mut(token_id) {
            *count = count.saturating_sub(1);
        }
        
        Ok(())
    }
    
    /// Record token failure and update metrics
    pub async fn record_failure(&self, token_id: &str, error: &str) -> Result<()> {
        let mut metrics = self.metrics.write().await;
        let mut active_requests = self.active_requests.write().await;
        
        // Update metrics
        if let Some(metric) = metrics.get_mut(token_id) {
            metric.total_requests += 1;
            metric.total_failures += 1;
            metric.consecutive_failures += 1;
            metric.last_failure = Some(Utc::now());
            
            // Update success rate
            metric.success_rate = metric.total_successes as f64 / metric.total_requests as f64;
            
            // Check if this is a rate limit error
            if error.to_lowercase().contains("rate limit") || error.contains("429") {
                metric.is_rate_limited = true;
                metric.rate_limit_hits += 1;
                // Estimate rate limit reset time (Telegram typically uses 1-minute windows)
                metric.rate_limit_reset_time = Some(Utc::now() + chrono::Duration::minutes(1));
            }
            
            // Recalculate weight based on performance
            metric.weight = self.calculate_token_weight(metric);
            
            warn!("❌ Token {} failure recorded: error='{}', consecutive_failures={}, success_rate={:.3}, weight={:.3}",
                  token_id, error, metric.consecutive_failures, metric.success_rate, metric.weight);
        }
        
        // Decrease active request count
        if let Some(count) = active_requests.get_mut(token_id) {
            *count = count.saturating_sub(1);
        }
        
        Ok(())
    }
    
    fn calculate_token_weight(&self, metric: &TokenMetrics) -> f64 {
        let base_weight = metric.success_rate;
        let response_time_factor = if metric.average_response_time_ms > 0 {
            (1000.0 / metric.average_response_time_ms as f64).min(1.0)
        } else {
            1.0
        };
        let rate_limit_penalty = if metric.is_rate_limited { 0.1 } else { 1.0 };
        let failure_penalty = 1.0 - (metric.consecutive_failures as f64 * 0.1).min(0.8);
        
        (base_weight * response_time_factor * rate_limit_penalty * failure_penalty)
            .max(0.01) // Minimum weight to prevent complete exclusion
            .min(1.0)  // Maximum weight cap
    }
    
    /// Increment active request counter for load balancing
    pub async fn increment_active_requests(&self, token_id: &str) {
        let mut active_requests = self.active_requests.write().await;
        *active_requests.entry(token_id.to_string()).or_insert(0) += 1;
    }
    
    /// Get current system status
    pub async fn get_status(&self) -> SystemStatus {
        let tokens = self.tokens.read().await;
        let metrics = self.metrics.read().await;
        let active_requests = self.active_requests.read().await;
        
        let active_tokens = tokens.len() as u32;
        let healthy_tokens = metrics.values()
            .filter(|m| !m.is_rate_limited && m.consecutive_failures < 3)
            .count() as u32;
        let rate_limited_tokens = metrics.values()
            .filter(|m| m.is_rate_limited)
            .count() as u32;
        let failed_tokens = metrics.values()
            .filter(|m| m.consecutive_failures >= 3)
            .count() as u32;
        
        let total_requests: u64 = metrics.values().map(|m| m.total_requests).sum();
        let total_successes: u64 = metrics.values().map(|m| m.total_successes).sum();
        let total_failures: u64 = metrics.values().map(|m| m.total_failures).sum();
        
        let average_response_time_ms = if !metrics.is_empty() {
            metrics.values()
                .map(|m| m.average_response_time_ms)
                .sum::<u64>() / metrics.len() as u64
        } else {
            0
        };
        
        let mut agent_status = HashMap::new();
        agent_status.insert("token_pool_manager".to_string(), "running".to_string());
        
        SystemStatus {
            active_tokens,
            healthy_tokens,
            rate_limited_tokens,
            failed_tokens,
            total_requests,
            total_successes,
            total_failures,
            average_response_time_ms,
            current_strategy: format!("{:?}", self.config.load_balancing_strategy),
            last_failover: None, // TODO: Track failover events
            agent_status,
        }
    }
}

#[async_trait]
impl SpecializedAgent for TokenPoolManager {
    fn name(&self) -> &str {
        "TokenPoolManager"
    }
    
    async fn start(&mut self) -> Result<()> {
        info!("🚀 Starting TokenPoolManager with {} tokens", self.config.tokens.len());
        
        let mut running = self.running.write().await;
        *running = true;
        drop(running);
        
        let mut message_rx = self.message_rx.take()
            .ok_or_else(|| anyhow::anyhow!("Message receiver already taken"))?;
        
        let tokens = Arc::clone(&self.tokens);
        let metrics = Arc::clone(&self.metrics);
        let active_requests = Arc::clone(&self.active_requests);
        let running = Arc::clone(&self.running);
        
        tokio::spawn(async move {
            info!("📨 TokenPoolManager message loop started");
            
            while *running.read().await {
                match message_rx.recv().await {
                    Some(message) => {
                        match message {
                            AgentMessage::SelectToken { chat_id, response_tx } => {
                                // This would need to be handled by the actual instance
                                // For now, just acknowledge
                                let _ = response_tx.send(Err(anyhow::anyhow!("Not implemented in spawn")));
                            }
                            AgentMessage::GetMetrics { response_tx } => {
                                let current_metrics = metrics.read().await.clone();
                                let _ = response_tx.send(current_metrics);
                            }
                            AgentMessage::RecordSuccess { token_id, response_time_ms } => {
                                // Update metrics (simplified version for spawn)
                                debug!("✅ Recording success for token: {}", token_id);
                            }
                            AgentMessage::RecordFailure { token_id, error } => {
                                // Update metrics (simplified version for spawn)
                                warn!("❌ Recording failure for token: {} - {}", token_id, error);
                            }
                            AgentMessage::Shutdown => {
                                info!("🛑 TokenPoolManager received shutdown signal");
                                break;
                            }
                            _ => {
                                debug!("📨 TokenPoolManager received unhandled message");
                            }
                        }
                    }
                    None => {
                        warn!("📨 TokenPoolManager message channel closed");
                        break;
                    }
                }
            }
            
            info!("🛑 TokenPoolManager message loop stopped");
        });
        
        Ok(())
    }
    
    async fn stop(&mut self) -> Result<()> {
        info!("🛑 Stopping TokenPoolManager");
        
        let mut running = self.running.write().await;
        *running = false;
        
        // Send shutdown message
        self.message_tx.send(AgentMessage::Shutdown)
            .map_err(|e| anyhow::anyhow!("Failed to send shutdown message: {}", e))?;
        
        Ok(())
    }
    
    async fn health_check(&self) -> Result<bool> {
        let tokens = self.tokens.read().await;
        let metrics = self.metrics.read().await;
        
        // Check if at least one token is healthy
        let healthy_count = metrics.values()
            .filter(|m| !m.is_rate_limited && m.consecutive_failures < 3)
            .count();
        
        let is_healthy = !tokens.is_empty() && healthy_count > 0;
        
        debug!("🔍 TokenPoolManager health check: {}/{} tokens healthy", 
               healthy_count, tokens.len());
        
        Ok(is_healthy)
    }
    
    async fn process_message(&mut self, message: AgentMessage) -> Result<()> {
        match message {
            AgentMessage::SelectToken { chat_id, response_tx } => {
                let result = self.select_token(chat_id).await
                    .map(|selection| selection.token);
                let _ = response_tx.send(result);
            }
            AgentMessage::RecordSuccess { token_id, response_time_ms } => {
                self.record_success(&token_id, response_time_ms).await?;
            }
            AgentMessage::RecordFailure { token_id, error } => {
                self.record_failure(&token_id, &error).await?;
            }
            AgentMessage::GetMetrics { response_tx } => {
                let metrics = self.metrics.read().await.clone();
                let _ = response_tx.send(metrics);
            }
            _ => {
                debug!("TokenPoolManager received unhandled message type");
            }
        }
        Ok(())
    }
}
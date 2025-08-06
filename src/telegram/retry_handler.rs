use anyhow::Result;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, warn, error, instrument};
use rand::Rng;

use crate::utils::errors::BridgeError;
use super::rate_limiter::RateLimiter;

/// Retry configuration with exponential backoff
#[derive(Debug, Clone)]
pub struct RetryConfig {
    /// Maximum number of retry attempts (default: 5)
    pub max_attempts: usize,
    /// Initial retry delay in milliseconds (default: 1000)
    pub initial_delay_ms: u64,
    /// Maximum retry delay in seconds (default: 30)
    pub max_delay_secs: u64,
    /// Backoff multiplier (default: 2.0)
    pub backoff_factor: f64,
    /// Add jitter to prevent thundering herd (default: true)
    pub enable_jitter: bool,
    /// Jitter range as percentage of delay (default: 0.1 = 10%)
    pub jitter_range: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 5,
            initial_delay_ms: 1000,
            max_delay_secs: 30,
            backoff_factor: 2.0,
            enable_jitter: true,
            jitter_range: 0.1,
        }
    }
}

/// Circuit breaker configuration
#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    /// Number of failures to trigger circuit breaker (default: 5)
    pub failure_threshold: usize,
    /// Time window for failure counting in seconds (default: 60)
    pub failure_window_secs: u64,
    /// How long to keep circuit open in seconds (default: 30)
    pub recovery_timeout_secs: u64,
    /// Number of successful calls needed to close circuit (default: 3)
    pub success_threshold: usize,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5,
            failure_window_secs: 60,
            recovery_timeout_secs: 30,
            success_threshold: 3,
        }
    }
}

/// Circuit breaker states
#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    /// Normal operation, requests allowed
    Closed,
    /// Failures exceeded threshold, requests blocked
    Open { opened_at: Instant },
    /// Testing if service recovered, limited requests allowed
    HalfOpen { successful_calls: usize },
}

/// Circuit breaker statistics for monitoring
#[derive(Debug, Clone, Default)]
pub struct CircuitBreakerStats {
    pub current_state: String,
    pub failure_count: usize,
    pub success_count: usize,
    pub total_requests: usize,
    pub state_transitions: usize,
    pub last_failure_time: Option<Instant>,
    pub last_success_time: Option<Instant>,
}

/// Tracks failures within a time window
#[derive(Debug)]
struct FailureWindow {
    failures: Vec<Instant>,
    window_duration: Duration,
}

impl FailureWindow {
    fn new(window_duration: Duration) -> Self {
        Self {
            failures: Vec::new(),
            window_duration,
        }
    }
    
    fn add_failure(&mut self, timestamp: Instant) {
        self.failures.push(timestamp);
        self.cleanup_old_failures(timestamp);
    }
    
    fn cleanup_old_failures(&mut self, current_time: Instant) {
        self.failures.retain(|&failure_time| {
            current_time.duration_since(failure_time).as_secs() <= self.window_duration.as_secs()
        });
    }
    
    fn failure_count(&mut self, current_time: Instant) -> usize {
        self.cleanup_old_failures(current_time);
        self.failures.len()
    }
    
    fn clear(&mut self) {
        self.failures.clear();
    }
}

/// Circuit breaker implementation
#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    state: Arc<RwLock<CircuitState>>,
    failure_window: Arc<RwLock<FailureWindow>>,
    stats: Arc<RwLock<CircuitBreakerStats>>,
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        let window_duration = Duration::from_secs(config.failure_window_secs);
        
        Self {
            config,
            state: Arc::new(RwLock::new(CircuitState::Closed)),
            failure_window: Arc::new(RwLock::new(FailureWindow::new(window_duration))),
            stats: Arc::new(RwLock::new(CircuitBreakerStats::default())),
        }
    }
    
    /// Check if request can be made through circuit breaker
    pub async fn can_execute(&self) -> bool {
        let state = self.state.read().await;
        let now = Instant::now();
        
        match &*state {
            CircuitState::Closed => true,
            CircuitState::Open { opened_at } => {
                let recovery_timeout = Duration::from_secs(self.config.recovery_timeout_secs);
                now.duration_since(*opened_at) >= recovery_timeout
            }
            CircuitState::HalfOpen { .. } => true,
        }
    }
    
    /// Record successful execution
    #[instrument(skip(self))]
    pub async fn record_success(&self) {
        let mut stats = self.stats.write().await;
        stats.success_count += 1;
        stats.total_requests += 1;
        stats.last_success_time = Some(Instant::now());
        
        let mut state = self.state.write().await;
        
        match &mut *state {
            CircuitState::Closed => {
                // Reset failure window on success
                self.failure_window.write().await.clear();
            }
            CircuitState::Open { .. } => {
                // Should not happen - can_execute should prevent this
                warn!("Recording success while circuit breaker is open");
            }
            CircuitState::HalfOpen { successful_calls } => {
                *successful_calls += 1;
                if *successful_calls >= self.config.success_threshold {
                    debug!("Circuit breaker closing after {} successful calls", successful_calls);
                    *state = CircuitState::Closed;
                    stats.state_transitions += 1;
                    self.failure_window.write().await.clear();
                }
            }
        }
        
        stats.current_state = format!("{:?}", *state);
    }
    
    /// Record failed execution
    #[instrument(skip(self))]
    pub async fn record_failure(&self) {
        let now = Instant::now();
        let mut stats = self.stats.write().await;
        stats.failure_count += 1;
        stats.total_requests += 1;
        stats.last_failure_time = Some(now);
        
        // Add failure to time window
        self.failure_window.write().await.add_failure(now);
        
        let mut state = self.state.write().await;
        
        match &*state {
            CircuitState::Closed => {
                // Check if we should open the circuit
                let failure_count = self.failure_window.write().await.failure_count(now);
                
                if failure_count >= self.config.failure_threshold {
                    debug!("Circuit breaker opening due to {} failures", failure_count);
                    *state = CircuitState::Open { opened_at: now };
                    stats.state_transitions += 1;
                }
            }
            CircuitState::Open { .. } => {
                // Already open, just record the failure
            }
            CircuitState::HalfOpen { .. } => {
                // Failure during half-open - go back to open
                debug!("Circuit breaker reopening due to failure during half-open state");
                *state = CircuitState::Open { opened_at: now };
                stats.state_transitions += 1;
            }
        }
        
        stats.current_state = format!("{:?}", *state);
    }
    
    /// Transition to half-open state for testing
    async fn try_half_open(&self) {
        let mut state = self.state.write().await;
        
        if matches!(&*state, CircuitState::Open { .. }) {
            debug!("Circuit breaker transitioning to half-open");
            *state = CircuitState::HalfOpen { successful_calls: 0 };
            
            let mut stats = self.stats.write().await;
            stats.state_transitions += 1;
            stats.current_state = format!("{:?}", *state);
        }
    }
    
    /// Get current circuit breaker statistics
    pub async fn get_stats(&self) -> CircuitBreakerStats {
        let stats = self.stats.read().await;
        stats.clone()
    }
    
    /// Reset circuit breaker state and statistics
    pub async fn reset(&self) {
        let mut state = self.state.write().await;
        *state = CircuitState::Closed;
        
        self.failure_window.write().await.clear();
        
        let mut stats = self.stats.write().await;
        *stats = CircuitBreakerStats::default();
        stats.current_state = "Closed".to_string();
    }
}

/// Retry handler with exponential backoff and circuit breaker
#[derive(Clone)]
pub struct RetryHandler {
    retry_config: RetryConfig,
    circuit_breaker: CircuitBreaker,
    rate_limiter: Option<Arc<RateLimiter>>,
}

impl RetryHandler {
    /// Create new retry handler with default configuration
    pub fn new() -> Self {
        Self {
            retry_config: RetryConfig::default(),
            circuit_breaker: CircuitBreaker::new(CircuitBreakerConfig::default()),
            rate_limiter: None,
        }
    }
    
    /// Create new retry handler with custom configuration
    pub fn with_config(
        retry_config: RetryConfig,
        circuit_breaker_config: CircuitBreakerConfig,
    ) -> Self {
        Self {
            retry_config,
            circuit_breaker: CircuitBreaker::new(circuit_breaker_config),
            rate_limiter: None,
        }
    }
    
    /// Set rate limiter for integration with SubAgent Alpha's work
    pub fn with_rate_limiter(mut self, rate_limiter: Arc<RateLimiter>) -> Self {
        self.rate_limiter = Some(rate_limiter);
        self
    }
    
    /// Execute an operation with retry logic and circuit breaker
    #[instrument(skip(self, operation))]
    pub async fn execute_with_retry<T, F, Fut>(&self, mut operation: F) -> Result<T>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, BridgeError>>,
        T: std::fmt::Debug,
    {
        for attempt in 0..self.retry_config.max_attempts {
            // Check circuit breaker
            if !self.circuit_breaker.can_execute().await {
                // Try to transition to half-open if timeout has passed
                self.circuit_breaker.try_half_open().await;
                
                if !self.circuit_breaker.can_execute().await {
                    return Err(anyhow::anyhow!(BridgeError::CircuitBreakerOpen(
                        "Circuit breaker is open, preventing request".to_string()
                    )));
                }
            }
            
            debug!("Attempting operation (attempt {}/{})", attempt + 1, self.retry_config.max_attempts);
            
            match operation().await {
                Ok(result) => {
                    debug!("Operation succeeded on attempt {}", attempt + 1);
                    self.circuit_breaker.record_success().await;
                    return Ok(result);
                }
                Err(error) => {
                    self.circuit_breaker.record_failure().await;
                    
                    // Check if error is retryable
                    if !error.is_retryable() {
                        debug!("Non-retryable error: {}", error);
                        return Err(anyhow::anyhow!(error));
                    }
                    
                    // Don't retry on the last attempt
                    if attempt == self.retry_config.max_attempts - 1 {
                        error!("All retry attempts exhausted for operation");
                        return Err(anyhow::anyhow!(BridgeError::RetryExhausted(
                            format!("Operation failed after {} attempts: {}", 
                                   self.retry_config.max_attempts, error)
                        )));
                    }
                    
                    // Calculate delay for next attempt
                    let delay = self.calculate_delay(attempt, &error);
                    
                    warn!(
                        "Operation failed on attempt {} (will retry in {}ms): {}", 
                        attempt + 1, 
                        delay.as_millis(),
                        error
                    );
                    
                    // Wait before next attempt
                    tokio::time::sleep(delay).await;
                }
            }
        }
        
        // This should never be reached due to the loop logic above
        unreachable!("Retry loop should always return or error before this point");
    }
    
    /// Execute Telegram message sending with retry and rate limit coordination
    #[instrument(skip(self, operation))]
    pub async fn send_telegram_message_with_retry<T, F, Fut>(
        &self, 
        chat_id: i64,
        operation: F
    ) -> Result<T>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, BridgeError>>,
        T: std::fmt::Debug,
    {
        // If we have a rate limiter, integrate with it
        if let Some(rate_limiter) = &self.rate_limiter {
            // Wait for rate limit clearance if needed
            if let Ok(false) = rate_limiter.check_rate_limit(chat_id).await {
                debug!("Rate limited, waiting for clearance before retry attempt");
                
                // Wait for rate limit clearance with timeout
                let timeout = Duration::from_secs(30);
                if !rate_limiter.wait_for_rate_limit(chat_id, timeout).await? {
                    return Err(anyhow::anyhow!(BridgeError::RateLimit(
                        format!("Rate limit timeout after {}s for chat {}", 
                               timeout.as_secs(), chat_id)
                    )));
                }
            }
        }
        
        // Execute with standard retry logic
        self.execute_with_retry(operation).await
    }
    
    /// Calculate exponential backoff delay with jitter
    fn calculate_delay(&self, attempt: usize, error: &BridgeError) -> Duration {
        // Check if error provides a specific delay suggestion
        if let Some(suggested_delay) = error.get_retry_delay() {
            return self.add_jitter(suggested_delay);
        }
        
        // Calculate exponential backoff
        let base_delay_ms = self.retry_config.initial_delay_ms;
        let backoff_factor = self.retry_config.backoff_factor;
        let max_delay = Duration::from_secs(self.retry_config.max_delay_secs);
        
        let exponential_delay = base_delay_ms as f64 * backoff_factor.powi(attempt as i32);
        let capped_delay = Duration::from_millis(exponential_delay as u64).min(max_delay);
        
        self.add_jitter(capped_delay)
    }
    
    /// Add jitter to delay to prevent thundering herd effect
    fn add_jitter(&self, delay: Duration) -> Duration {
        if !self.retry_config.enable_jitter {
            return delay;
        }
        
        let jitter_range = self.retry_config.jitter_range;
        let delay_ms = delay.as_millis() as f64;
        
        // Generate random jitter between -jitter_range and +jitter_range
        let mut rng = rand::thread_rng();
        let jitter_factor = rng.gen_range(-jitter_range..jitter_range);
        let jittered_delay = delay_ms * (1.0 + jitter_factor);
        
        Duration::from_millis(jittered_delay.max(0.0) as u64)
    }
    
    /// Get retry handler statistics
    pub async fn get_stats(&self) -> Result<serde_json::Value> {
        let circuit_stats = self.circuit_breaker.get_stats().await;
        
        Ok(serde_json::json!({
            "retry_config": {
                "max_attempts": self.retry_config.max_attempts,
                "initial_delay_ms": self.retry_config.initial_delay_ms,
                "max_delay_secs": self.retry_config.max_delay_secs,
                "backoff_factor": self.retry_config.backoff_factor,
                "enable_jitter": self.retry_config.enable_jitter
            },
            "circuit_breaker": {
                "current_state": circuit_stats.current_state,
                "failure_count": circuit_stats.failure_count,
                "success_count": circuit_stats.success_count,
                "total_requests": circuit_stats.total_requests,
                "state_transitions": circuit_stats.state_transitions
            }
        }))
    }
    
    /// Reset all statistics and circuit breaker state
    pub async fn reset_stats(&self) {
        self.circuit_breaker.reset().await;
    }
}

impl Default for RetryHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::timeout;
    
    #[tokio::test]
    async fn test_circuit_breaker_opens_after_failures() {
        let config = CircuitBreakerConfig {
            failure_threshold: 3,
            failure_window_secs: 60,
            recovery_timeout_secs: 1,
            success_threshold: 2,
        };
        
        let circuit_breaker = CircuitBreaker::new(config);
        
        // Circuit should start closed
        assert!(circuit_breaker.can_execute().await);
        
        // Record failures to trigger opening
        for _ in 0..3 {
            circuit_breaker.record_failure().await;
        }
        
        // Circuit should now be open
        assert!(!circuit_breaker.can_execute().await);
        
        // Wait for recovery timeout
        tokio::time::sleep(Duration::from_secs(2)).await;
        
        // Should be able to try again (half-open)
        assert!(circuit_breaker.can_execute().await);
    }
    
    #[tokio::test]
    async fn test_retry_handler_success() {
        let retry_config = RetryConfig {
            max_attempts: 3,
            initial_delay_ms: 10, // Short delay for testing
            ..Default::default()
        };
        
        let handler = RetryHandler::with_config(retry_config, CircuitBreakerConfig::default());
        
        let mut attempt_count = 0;
        let result = handler.execute_with_retry(|| {
            attempt_count += 1;
            async move {
                if attempt_count < 2 {
                    Err(BridgeError::Http(reqwest::Error::from(std::io::Error::new(
                        std::io::ErrorKind::ConnectionRefused,
                        "connection refused"
                    ))))
                } else {
                    Ok("success".to_string())
                }
            }
        }).await;
        
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "success");
        assert_eq!(attempt_count, 2);
    }
    
    #[tokio::test]
    async fn test_retry_handler_non_retryable_error() {
        let handler = RetryHandler::new();
        
        let mut attempt_count = 0;
        let result = handler.execute_with_retry(|| {
            attempt_count += 1;
            async move {
                Err(BridgeError::Authentication("invalid token".to_string()))
            }
        }).await;
        
        assert!(result.is_err());
        assert_eq!(attempt_count, 1); // Should not retry non-retryable errors
    }
    
    #[tokio::test]
    async fn test_retry_exhausted() {
        let retry_config = RetryConfig {
            max_attempts: 2,
            initial_delay_ms: 1, // Very short delay for testing
            ..Default::default()
        };
        
        let handler = RetryHandler::with_config(retry_config, CircuitBreakerConfig::default());
        
        let mut attempt_count = 0;
        let result = handler.execute_with_retry(|| {
            attempt_count += 1;
            async move {
                Err(BridgeError::Http(reqwest::Error::from(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "timeout"
                ))))
            }
        }).await;
        
        assert!(result.is_err());
        assert_eq!(attempt_count, 2);
        
        let error_str = result.unwrap_err().to_string();
        assert!(error_str.contains("RetryExhausted"));
    }
}
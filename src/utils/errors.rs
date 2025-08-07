use thiserror::Error;
use std::time::Duration;

#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum BridgeError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("File system error: {0}")]
    FileSystem(#[from] std::io::Error),

    #[error("Telegram API error: {0}")]
    Telegram(#[from] teloxide::RequestError),

    #[error("Event processing error: {0}")]
    EventProcessing(String),

    #[error("Authentication error: {0}")]
    Authentication(String),

    #[error("Rate limiting error: {0}")]
    RateLimit(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("File watcher error: {0}")]
    FileWatcher(#[from] notify::Error),

    #[error("Security error: {0}")]
    Security(String),

    #[error("Performance monitoring error: {0}")]
    Performance(String),

    #[error("Health check error: {0}")]
    Health(String),

    #[error("HTTP client error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Retry exhausted error: {0}")]
    RetryExhausted(String),

    #[error("Circuit breaker open: {0}")]
    CircuitBreakerOpen(String),

    #[error("Timeout error: {0}")]
    Timeout(String),

    #[error("Generic error: {0}")]
    Generic(String),
}

/// Categorizes errors for retry logic
#[derive(Debug, Clone, PartialEq)]
pub enum ErrorCategory {
    /// Temporary errors that should be retried (429, 502, 503, 504, network timeouts)
    Retryable { suggested_delay: Option<Duration> },
    /// Permanent errors that should not be retried (400, 401, 403, invalid data)
    NonRetryable,
    /// Rate limiting errors with specific handling
    RateLimit { retry_after: Option<Duration> },
    /// Circuit breaker should be opened
    CircuitBreaker,
}

impl BridgeError {
    /// Categorize error for retry logic
    pub fn categorize(&self) -> ErrorCategory {
        match self {
            // Telegram API errors
            BridgeError::Telegram(req_error) => {
                Self::categorize_telegram_error(req_error)
            }
            
            // HTTP client errors
            BridgeError::Http(http_error) => {
                Self::categorize_http_error(http_error)
            }
            
            // Rate limiting is always retryable with delay
            BridgeError::RateLimit(_) => ErrorCategory::RateLimit { 
                retry_after: Some(Duration::from_secs(1)) 
            },
            
            // Timeout errors are retryable
            BridgeError::Timeout(_) => ErrorCategory::Retryable { 
                suggested_delay: Some(Duration::from_millis(500)) 
            },
            
            // Circuit breaker errors suggest opening the circuit
            BridgeError::RetryExhausted(_) => ErrorCategory::CircuitBreaker,
            BridgeError::CircuitBreakerOpen(_) => ErrorCategory::NonRetryable,
            
            // Configuration and authentication errors are not retryable
            BridgeError::Config(_) | BridgeError::Authentication(_) | BridgeError::Security(_) => {
                ErrorCategory::NonRetryable
            }
            
            // File system and serialization errors are generally not retryable
            BridgeError::FileSystem(_) | BridgeError::Serialization(_) => {
                ErrorCategory::NonRetryable
            }
            
            // Other errors default to non-retryable for safety
            _ => ErrorCategory::NonRetryable,
        }
    }
    
    /// Categorize Telegram-specific errors
    fn categorize_telegram_error(req_error: &teloxide::RequestError) -> ErrorCategory {
        // Convert error to string to parse status codes
        let error_str = req_error.to_string();
        
        // Check for rate limiting (429)
        if error_str.contains("429") || error_str.contains("Too Many Requests") {
            return ErrorCategory::RateLimit { 
                retry_after: Some(Duration::from_secs(1)) 
            };
        }
        
        // Check for server errors that can be retried
        if error_str.contains("502") || error_str.contains("503") || error_str.contains("504") ||
           error_str.contains("Bad Gateway") || error_str.contains("Service Unavailable") || 
           error_str.contains("Gateway Timeout") {
            return ErrorCategory::Retryable { 
                suggested_delay: Some(Duration::from_millis(1000)) 
            };
        }
        
        // Check for client errors that should not be retried
        if error_str.contains("400") || error_str.contains("401") || error_str.contains("403") || 
           error_str.contains("404") || error_str.contains("409") ||
           error_str.contains("Bad Request") || error_str.contains("Unauthorized") || 
           error_str.contains("Forbidden") || error_str.contains("Not Found") {
            return ErrorCategory::NonRetryable;
        }
        
        // Network-related errors are retryable
        if error_str.contains("network") || error_str.contains("connection") || 
           error_str.contains("timeout") || error_str.contains("DNS") {
            return ErrorCategory::Retryable { 
                suggested_delay: Some(Duration::from_millis(500)) 
            };
        }
        
        // Default to non-retryable for safety
        ErrorCategory::NonRetryable
    }
    
    /// Categorize HTTP client errors
    fn categorize_http_error(http_error: &reqwest::Error) -> ErrorCategory {
        if http_error.is_timeout() {
            return ErrorCategory::Retryable { 
                suggested_delay: Some(Duration::from_millis(1000)) 
            };
        }
        
        if http_error.is_connect() {
            return ErrorCategory::Retryable { 
                suggested_delay: Some(Duration::from_millis(2000)) 
            };
        }
        
        if let Some(status) = http_error.status() {
            match status.as_u16() {
                // Rate limiting
                429 => ErrorCategory::RateLimit { 
                    retry_after: Some(Duration::from_secs(1)) 
                },
                
                // Server errors that can be retried
                502 | 503 | 504 => ErrorCategory::Retryable { 
                    suggested_delay: Some(Duration::from_millis(1000)) 
                },
                
                // Client errors that should not be retried
                400 | 401 | 403 | 404 | 409 => ErrorCategory::NonRetryable,
                
                // Other status codes default to non-retryable
                _ => ErrorCategory::NonRetryable,
            }
        } else {
            // Network errors without status codes are retryable
            ErrorCategory::Retryable { 
                suggested_delay: Some(Duration::from_millis(500)) 
            }
        }
    }
    
    /// Check if error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(
            self.categorize(),
            ErrorCategory::Retryable { .. } | ErrorCategory::RateLimit { .. }
        )
    }
    
    /// Get suggested retry delay
    pub fn get_retry_delay(&self) -> Option<Duration> {
        match self.categorize() {
            ErrorCategory::Retryable { suggested_delay } => suggested_delay,
            ErrorCategory::RateLimit { retry_after } => retry_after,
            _ => None,
        }
    }
}
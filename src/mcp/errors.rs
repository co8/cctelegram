//! Error types and codes for MCP integration

use thiserror::Error;

/// Comprehensive error types for MCP operations
#[derive(Error, Debug, Clone)]
pub enum McpError {
    #[error("Connection timeout: {0}")]
    ConnectionTimeout(String),

    #[error("Connection pool exhausted")]
    ConnectionPoolExhausted,

    #[error("Circuit breaker is open")]
    CircuitBreakerOpen,

    #[error("Authentication failure: {0}")]
    AuthenticationFailure(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Server unavailable: {0}")]
    ServerUnavailable(String),

    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),

    #[error("Not implemented: {0}")]
    NotImplemented(String),

    #[error("Cache operation failed: {0}")]
    CacheError(String),

    #[error("Telemetry disabled")]
    TelemetryDisabled,

    #[error("Configuration error: {0}")]
    ConfigurationError(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Protocol error: {0}")]
    ProtocolError(String),

    #[error("Retry exhausted after {attempts} attempts")]
    RetryExhausted { attempts: u8 },

    #[error("Unknown error")]
    UnknownError,
}

/// Specific error codes for telemetry and monitoring
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpErrorCode {
    ConnectionTimeout = 1001,
    ConnectionPoolExhausted = 1002,
    CircuitBreakerOpen = 1003,
    AuthenticationFailure = 2001,
    InvalidRequest = 2002,
    ServerUnavailable = 3001,
    UnsupportedOperation = 3002,
    NotImplemented = 3003,
    CacheError = 4001,
    TelemetryDisabled = 4002,
    ConfigurationError = 5001,
    SerializationError = 5002,
    NetworkError = 6001,
    ProtocolError = 6002,
    RetryExhausted = 7001,
    UnknownError = 9999,
}

/// Error category for grouping and analysis
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpErrorCategory {
    Connection,
    Authentication,
    Server,
    Configuration,
    Network,
    Protocol,
    Retry,
    Unknown,
}

/// Error severity level for alerting and prioritization
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum McpErrorSeverity {
    Low,
    Medium,
    High,
    Critical,
}

impl McpError {
    /// Get the error code for this error type
    pub fn code(&self) -> McpErrorCode {
        match self {
            Self::ConnectionTimeout(_) => McpErrorCode::ConnectionTimeout,
            Self::ConnectionPoolExhausted => McpErrorCode::ConnectionPoolExhausted,
            Self::CircuitBreakerOpen => McpErrorCode::CircuitBreakerOpen,
            Self::AuthenticationFailure(_) => McpErrorCode::AuthenticationFailure,
            Self::InvalidRequest(_) => McpErrorCode::InvalidRequest,
            Self::ServerUnavailable(_) => McpErrorCode::ServerUnavailable,
            Self::UnsupportedOperation(_) => McpErrorCode::UnsupportedOperation,
            Self::NotImplemented(_) => McpErrorCode::NotImplemented,
            Self::CacheError(_) => McpErrorCode::CacheError,
            Self::TelemetryDisabled => McpErrorCode::TelemetryDisabled,
            Self::ConfigurationError(_) => McpErrorCode::ConfigurationError,
            Self::SerializationError(_) => McpErrorCode::SerializationError,
            Self::NetworkError(_) => McpErrorCode::NetworkError,
            Self::ProtocolError(_) => McpErrorCode::ProtocolError,
            Self::RetryExhausted { .. } => McpErrorCode::RetryExhausted,
            Self::UnknownError => McpErrorCode::UnknownError,
        }
    }

    /// Get the error category for this error type
    pub fn category(&self) -> McpErrorCategory {
        match self {
            Self::ConnectionTimeout(_) | Self::ConnectionPoolExhausted => McpErrorCategory::Connection,
            Self::CircuitBreakerOpen => McpErrorCategory::Connection,
            Self::AuthenticationFailure(_) => McpErrorCategory::Authentication,
            Self::InvalidRequest(_) | Self::ServerUnavailable(_) | Self::UnsupportedOperation(_) | Self::NotImplemented(_) => McpErrorCategory::Server,
            Self::CacheError(_) | Self::TelemetryDisabled | Self::ConfigurationError(_) => McpErrorCategory::Configuration,
            Self::SerializationError(_) | Self::NetworkError(_) => McpErrorCategory::Network,
            Self::ProtocolError(_) => McpErrorCategory::Protocol,
            Self::RetryExhausted { .. } => McpErrorCategory::Retry,
            Self::UnknownError => McpErrorCategory::Unknown,
        }
    }

    /// Get the severity level for this error type
    pub fn severity(&self) -> McpErrorSeverity {
        match self {
            Self::ConnectionTimeout(_) | Self::CacheError(_) | Self::TelemetryDisabled => McpErrorSeverity::Low,
            Self::ConnectionPoolExhausted | Self::NetworkError(_) | Self::SerializationError(_) => McpErrorSeverity::Medium,
            Self::CircuitBreakerOpen | Self::ServerUnavailable(_) | Self::RetryExhausted { .. } => McpErrorSeverity::High,
            Self::AuthenticationFailure(_) | Self::ConfigurationError(_) | Self::ProtocolError(_) => McpErrorSeverity::Critical,
            Self::InvalidRequest(_) | Self::UnsupportedOperation(_) | Self::NotImplemented(_) => McpErrorSeverity::Low,
            Self::UnknownError => McpErrorSeverity::Medium,
        }
    }

    /// Check if this error type should trigger a retry
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::ConnectionTimeout(_) | Self::NetworkError(_) | Self::ServerUnavailable(_) => true,
            Self::ConnectionPoolExhausted | Self::CircuitBreakerOpen => false, // Handled at higher level
            Self::AuthenticationFailure(_) | Self::InvalidRequest(_) => false, // Client errors
            Self::UnsupportedOperation(_) | Self::NotImplemented(_) => false, // Implementation issues
            Self::CacheError(_) | Self::TelemetryDisabled | Self::ConfigurationError(_) => false,
            Self::SerializationError(_) | Self::ProtocolError(_) => false,
            Self::RetryExhausted { .. } => false, // Already exhausted
            Self::UnknownError => true, // Conservative approach
        }
    }

    /// Check if this error should trigger circuit breaker
    pub fn triggers_circuit_breaker(&self) -> bool {
        match self {
            Self::ConnectionTimeout(_) | Self::NetworkError(_) | Self::ServerUnavailable(_) => true,
            Self::ProtocolError(_) => true,
            _ => false,
        }
    }

    /// Get human-readable error message for user display
    pub fn user_message(&self) -> String {
        match self {
            Self::ConnectionTimeout(_) => "Connection to MCP server timed out".to_string(),
            Self::ConnectionPoolExhausted => "Server is busy, please try again".to_string(),
            Self::CircuitBreakerOpen => "MCP server is temporarily unavailable".to_string(),
            Self::AuthenticationFailure(_) => "Authentication failed".to_string(),
            Self::InvalidRequest(_) => "Invalid request format".to_string(),
            Self::ServerUnavailable(_) => "MCP server is currently unavailable".to_string(),
            Self::UnsupportedOperation(op) => format!("Operation '{}' is not supported", op),
            Self::NotImplemented(_) => "Feature not yet implemented".to_string(),
            Self::CacheError(_) => "Cache operation failed".to_string(),
            Self::TelemetryDisabled => "Telemetry is disabled".to_string(),
            Self::ConfigurationError(_) => "Configuration error".to_string(),
            Self::SerializationError(_) => "Data format error".to_string(),
            Self::NetworkError(_) => "Network connection error".to_string(),
            Self::ProtocolError(_) => "Communication protocol error".to_string(),
            Self::RetryExhausted { attempts } => format!("Operation failed after {} attempts", attempts),
            Self::UnknownError => "An unexpected error occurred".to_string(),
        }
    }

    /// Convert to structured JSON for telemetry
    pub fn to_telemetry_json(&self) -> serde_json::Value {
        serde_json::json!({
            "error_code": self.code() as u16,
            "error_category": format!("{:?}", self.category()),
            "error_severity": format!("{:?}", self.severity()),
            "error_message": self.to_string(),
            "user_message": self.user_message(),
            "is_retryable": self.is_retryable(),
            "triggers_circuit_breaker": self.triggers_circuit_breaker(),
        })
    }
}
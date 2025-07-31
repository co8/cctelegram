use thiserror::Error;

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
}
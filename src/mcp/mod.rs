//! MCP (Model Context Protocol) connection management and integration
//! 
//! This module provides:
//! - Connection pooling and management for MCP servers
//! - Retry logic with exponential backoff
//! - Circuit breaker pattern for failure handling
//! - Caching layer for performance optimization
//! - Comprehensive error handling and telemetry

pub mod connection;
pub mod cache;
pub mod errors;
pub mod telemetry;

pub use connection::{McpConnectionManager, McpConnectionPool, McpClient};
pub use cache::{CacheManager, CacheEntry};
pub use errors::{McpError, McpErrorCode};
pub use telemetry::{McpMetrics, McpTelemetry};

use std::sync::Arc;

/// Main MCP integration facade that provides high-level APIs
/// for MCP server interaction with built-in reliability features
pub struct McpIntegration {
    connection_manager: Arc<McpConnectionManager>,
    cache_manager: Arc<CacheManager>,
    telemetry: Arc<McpTelemetry>,
    config: McpConfig,
}

/// Fallback strategy when MCP server is unavailable
#[derive(Debug, Clone, PartialEq)]
pub enum FallbackStrategy {
    /// Try file system fallback immediately
    Automatic,
    /// Ask user for permission before fallback
    Manual,
    /// No fallback - return error immediately
    Disabled,
}

/// Configuration for MCP integration
#[derive(Debug, Clone)]
pub struct McpConfig {
    /// Maximum number of connections in the pool
    pub max_connections: usize,
    /// Connection timeout in milliseconds  
    pub connection_timeout_ms: u64,
    /// Maximum retry attempts with exponential backoff
    pub max_retries: u8,
    /// Base delay for exponential backoff in milliseconds
    pub base_retry_delay_ms: u64,
    /// Circuit breaker failure threshold
    pub circuit_breaker_threshold: u8,
    /// Circuit breaker recovery timeout in seconds
    pub circuit_breaker_timeout_s: u64,
    /// Enable caching layer
    pub enable_caching: bool,
    /// Cache TTL in seconds (shorter for real-time accuracy)
    pub cache_ttl_seconds: u64,
    /// Force fresh data (bypass cache) for critical operations
    pub bypass_cache_for_writes: bool,
    /// Enable telemetry collection
    pub enable_telemetry: bool,
    /// Fallback behavior when MCP server is unavailable
    pub fallback_strategy: FallbackStrategy,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            max_connections: 10,
            connection_timeout_ms: 5000,
            max_retries: 3,
            base_retry_delay_ms: 100,
            circuit_breaker_threshold: 5,
            circuit_breaker_timeout_s: 30,
            enable_caching: true,
            cache_ttl_seconds: 60, // 1 minute for real-time accuracy
            bypass_cache_for_writes: true,
            enable_telemetry: true,
            fallback_strategy: FallbackStrategy::Automatic,
        }
    }
}

impl McpIntegration {
    /// Create a new MCP integration instance with default configuration
    pub fn new() -> Self {
        Self::with_config(McpConfig::default())
    }

    /// Create a new MCP integration instance with custom configuration
    pub fn with_config(config: McpConfig) -> Self {
        let connection_manager = Arc::new(McpConnectionManager::new(&config));
        let cache_manager = Arc::new(CacheManager::new(&config));
        let telemetry = Arc::new(McpTelemetry::new(&config));

        Self {
            connection_manager,
            cache_manager,
            telemetry,
            config,
        }
    }

    /// Get task status from MCP server with full reliability features
    pub async fn get_task_status(&self) -> Result<serde_json::Value, McpError> {
        self.get_task_status_with_cache_control(false).await
    }

    /// Get task status with option to force fresh data (bypass cache)
    pub async fn get_task_status_fresh(&self) -> Result<serde_json::Value, McpError> {
        self.get_task_status_with_cache_control(true).await
    }

    /// Get task status with cache control
    async fn get_task_status_with_cache_control(&self, force_fresh: bool) -> Result<serde_json::Value, McpError> {
        let start_time = std::time::Instant::now();
        let operation_id = uuid::Uuid::new_v4().to_string();

        // Check cache first if enabled and not forcing fresh data
        if self.config.enable_caching && !force_fresh {
            if let Some(cached_result) = self.cache_manager.get("task_status").await? {
                self.telemetry.record_cache_hit(&operation_id).await;
                return Ok(cached_result);
            }
        }

        // Execute MCP query with connection management
        let result = self.connection_manager
            .execute_with_retry("get_tasks", serde_json::Value::Null)
            .await;

        match result {
            Ok(data) => {
                // Cache successful result
                if self.config.enable_caching {
                    self.cache_manager.set("task_status", data.clone(), self.config.cache_ttl_seconds).await?;
                }

                // Record successful operation
                if self.config.enable_telemetry {
                    self.telemetry.record_success(&operation_id, start_time.elapsed()).await;
                }

                Ok(data)
            }
            Err(error) => {
                // Try fallback based on strategy
                match self.config.fallback_strategy {
                    FallbackStrategy::Automatic => {
                        // Try file system fallback automatically
                        match self.try_file_system_fallback().await {
                            Ok(fallback_data) => {
                                // Record fallback success
                                if self.config.enable_telemetry {
                                    self.telemetry.record_success(&operation_id, start_time.elapsed()).await;
                                }
                                Ok(fallback_data)
                            }
                            Err(_fallback_error) => {
                                // Record both original and fallback errors
                                if self.config.enable_telemetry {
                                    self.telemetry.record_error(&operation_id, &error, start_time.elapsed()).await;
                                }
                                Err(error) // Return original error, not fallback error
                            }
                        }
                    }
                    FallbackStrategy::Manual => {
                        // Return error with suggestion to try fallback
                        if self.config.enable_telemetry {
                            self.telemetry.record_error(&operation_id, &error, start_time.elapsed()).await;
                        }
                        Err(McpError::ServerUnavailable("MCP server unavailable. Try manual fallback.".to_string()))
                    }
                    FallbackStrategy::Disabled => {
                        // Return error immediately
                        if self.config.enable_telemetry {
                            self.telemetry.record_error(&operation_id, &error, start_time.elapsed()).await;
                        }
                        Err(error)
                    }
                }
            }
        }
    }

    /// Health check for MCP server availability
    pub async fn health_check(&self) -> Result<bool, McpError> {
        self.connection_manager.health_check().await
    }

    /// Get current metrics and telemetry data
    pub async fn get_metrics(&self) -> Result<serde_json::Value, McpError> {
        if !self.config.enable_telemetry {
            return Err(McpError::TelemetryDisabled);
        }
        
        self.telemetry.get_metrics().await
    }

    /// Invalidate cache for task data (call when tasks are updated)
    pub async fn invalidate_task_cache(&self) -> Result<(), McpError> {
        if self.config.enable_caching {
            self.cache_manager.remove("task_status").await?;
        }
        Ok(())
    }

    /// Get cache configuration for real-time accuracy
    pub fn get_cache_config(&self) -> (bool, u64) {
        (self.config.enable_caching, self.config.cache_ttl_seconds)
    }

    /// Try file system fallback when MCP server is unavailable
    async fn try_file_system_fallback(&self) -> Result<serde_json::Value, McpError> {
        use tokio::fs;

        // Try to read TaskMaster data directly from file system
        let current_dir = std::env::current_dir()
            .map_err(|e| McpError::ConfigurationError(format!("Cannot get current directory: {}", e)))?;
        
        let taskmaster_path = current_dir.join(".taskmaster/tasks/tasks.json");
        
        if !taskmaster_path.exists() {
            return Err(McpError::NotImplemented("TaskMaster file not found for fallback".to_string()));
        }

        let content = fs::read_to_string(&taskmaster_path).await
            .map_err(|e| McpError::ConfigurationError(format!("Cannot read TaskMaster file: {}", e)))?;
        
        let data: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| McpError::SerializationError(format!("Invalid TaskMaster JSON: {}", e)))?;

        // Parse TaskMaster data into standard format
        self.parse_taskmaster_data(data).await
    }

    /// Parse TaskMaster data into standardized format
    async fn parse_taskmaster_data(&self, data: serde_json::Value) -> Result<serde_json::Value, McpError> {
        // Try current TaskMaster AI data structure first
        if let Some(data_tasks) = data.get("data").and_then(|d| d.get("tasks")) {
            if let Some(tasks_array) = data_tasks.as_array() {
                let mut pending = 0;
                let mut in_progress = 0;
                let mut completed = 0;
                let mut blocked = 0;

                for task in tasks_array {
                    match task.get("status").and_then(|s| s.as_str()) {
                        Some("pending") => pending += 1,
                        Some("in-progress") => in_progress += 1,
                        Some("done") => completed += 1,
                        Some("blocked") => blocked += 1,
                        _ => {}
                    }
                }

                return Ok(serde_json::json!({
                    "source": "file_fallback",
                    "project_name": "CCTelegram Project",
                    "stats": {
                        "pending": pending,
                        "in_progress": in_progress,
                        "completed": completed,
                        "blocked": blocked,
                        "total": tasks_array.len()
                    },
                    "last_updated": chrono::Utc::now().to_rfc3339(),
                    "is_fallback": true
                }));
            }
        }

        // Try legacy TaskMaster format
        if let Some(tags) = data.get("tags") {
            if let Some(master) = tags.get("master") {
                if let Some(tasks) = master.get("tasks") {
                    if let Some(tasks_array) = tasks.as_array() {
                        let mut pending = 0;
                        let mut in_progress = 0;
                        let mut completed = 0;

                        for task in tasks_array {
                            match task.get("status").and_then(|s| s.as_str()) {
                                Some("pending") => pending += 1,
                                Some("in-progress") => in_progress += 1,
                                Some("done") | Some("completed") => completed += 1,
                                _ => {}
                            }
                        }

                        return Ok(serde_json::json!({
                            "source": "file_fallback_legacy",
                            "project_name": "CCTelegram Project",
                            "stats": {
                                "pending": pending,
                                "in_progress": in_progress,
                                "completed": completed,
                                "blocked": 0,
                                "total": tasks_array.len()
                            },
                            "last_updated": chrono::Utc::now().to_rfc3339(),
                            "is_fallback": true
                        }));
                    }
                }
            }
        }

        Err(McpError::SerializationError("Unable to parse TaskMaster data in any known format".to_string()))
    }

    /// Manual fallback method for when strategy is set to Manual
    pub async fn manual_fallback(&self) -> Result<serde_json::Value, McpError> {
        self.try_file_system_fallback().await
    }

    /// Get todo status from MCP server
    pub async fn get_todo_status(&self) -> Result<String, McpError> {
        let start_time = std::time::Instant::now();
        let operation_id = uuid::Uuid::new_v4().to_string();

        // Execute MCP todo query
        let result = self.connection_manager
            .execute_with_retry("todo", serde_json::Value::Null)
            .await;

        match result {
            Ok(data) => {
                // Record successful operation
                if self.config.enable_telemetry {
                    self.telemetry.record_success(&operation_id, start_time.elapsed()).await;
                }

                // Extract text content from MCP response
                if let Some(text) = data.as_str() {
                    return Ok(text.to_string());
                } else if let Some(content) = data.get("content").and_then(|c| c.as_array()) {
                    if let Some(first_content) = content.first() {
                        if let Some(text) = first_content.get("text").and_then(|t| t.as_str()) {
                            return Ok(text.to_string());
                        }
                    }
                }
                
                // Fallback: return JSON formatted text
                Ok(serde_json::to_string_pretty(&data)
                    .unwrap_or_else(|_| "Error formatting todo data".to_string()))
            }
            Err(error) => {
                // Try fallback based on strategy
                match self.config.fallback_strategy {
                    FallbackStrategy::Automatic => {
                        // Return a fallback todo message
                        if self.config.enable_telemetry {
                            self.telemetry.record_success(&operation_id, start_time.elapsed()).await;
                        }
                        Ok("*📋 Todo Status*\n\nℹ️ No active todo list found\n💡 Use Claude Code to create tasks\n\n*🚀 Available Commands:*\n• `/tasks` \\- View TaskMaster status\n• `/bridge` \\- View bridge status".to_string())
                    }
                    FallbackStrategy::Manual => {
                        if self.config.enable_telemetry {
                            self.telemetry.record_error(&operation_id, &error, start_time.elapsed()).await;
                        }
                        Err(McpError::ServerUnavailable("MCP server unavailable for todo. Try manual fallback.".to_string()))
                    }
                    FallbackStrategy::Disabled => {
                        if self.config.enable_telemetry {
                            self.telemetry.record_error(&operation_id, &error, start_time.elapsed()).await;
                        }
                        Err(error)
                    }
                }
            }
        }
    }
}
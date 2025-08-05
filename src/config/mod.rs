use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use anyhow::{Result, Context};
use std::fs;
use tracing::{info, warn};
use notify::RecommendedWatcher;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::utils::performance::PerformanceConfig;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Config {
    pub telegram: TelegramConfig,
    pub paths: PathsConfig,
    pub notifications: NotificationsConfig,
    pub security: SecurityConfig,
    pub performance: PerformanceConfig,
    pub monitoring: MonitoringConfig,
    pub timeouts: TimeoutConfig,
    pub tier_configuration: TierConfiguration,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TelegramConfig {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub telegram_bot_token: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub telegram_allowed_users: Vec<i64>,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    #[serde(default = "default_message_style")]
    pub message_style: String,
}

fn default_timezone() -> String {
    "Europe/Berlin".to_string()
}

fn default_message_style() -> String {
    "concise".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PathsConfig {
    pub events_dir: PathBuf,
    pub responses_dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NotificationsConfig {
    pub task_completion: bool,
    pub approval_requests: bool,
    pub progress_updates: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SecurityConfig {
    pub rate_limit_requests: u32,
    pub rate_limit_window: u64,
    pub audit_log: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MonitoringConfig {
    pub health_check_port: u16,
    pub enable_metrics_server: bool,
    pub metrics_endpoint: String,
    pub health_endpoint: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TimeoutConfig {
    // Tier-specific timeouts in milliseconds
    #[serde(default = "default_webhook_timeout")]
    pub webhook_timeout_ms: u64,
    
    #[serde(default = "default_bridge_timeout")]
    pub bridge_processing_timeout_ms: u64,
    
    #[serde(default = "default_file_watcher_timeout")]
    pub file_watcher_timeout_ms: u64,
    
    #[serde(default = "default_file_debounce")]
    pub file_watcher_debounce_ms: u64,
    
    #[serde(default = "default_system_timeout")]
    pub overall_system_timeout_ms: u64,
    
    // Grace periods for tier degradation
    #[serde(default = "default_degradation_grace")]
    pub degradation_grace_period_ms: u64,
    
    // Health check intervals
    #[serde(default = "default_health_check_interval")]
    pub health_check_interval_ms: u64,
    
    // Configuration hot-reload check interval
    #[serde(default = "default_config_reload_interval")]
    pub config_reload_interval_ms: u64,
    
    // Circuit breaker recovery timeout
    #[serde(default = "default_circuit_breaker_recovery")]
    pub circuit_breaker_recovery_timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TierConfiguration {
    // Performance-based tier selection thresholds
    #[serde(default = "default_performance_degradation_threshold")]
    pub performance_degradation_threshold: f64,
    
    #[serde(default = "default_response_time_threshold")]
    pub response_time_degradation_ms: u64,
    
    #[serde(default = "default_error_rate_threshold")]
    pub error_rate_threshold_percent: f64,
    
    #[serde(default = "default_consecutive_failures")]
    pub max_consecutive_failures: u32,
    
    // Tier priority weights (lower = higher priority)
    #[serde(default = "default_tier_priorities")]
    pub tier_priorities: TierPriorities,
    
    // Enable/disable individual tiers
    #[serde(default = "default_tier_enabled")]
    pub mcp_webhook_enabled: bool,
    
    #[serde(default = "default_tier_enabled")]
    pub bridge_internal_enabled: bool,
    
    #[serde(default = "default_tier_enabled")]
    pub file_watcher_enabled: bool,
    
    // Graceful degradation settings
    #[serde(default = "default_auto_recovery")]
    pub enable_auto_recovery: bool,
    
    #[serde(default = "default_performance_monitoring")]
    pub enable_performance_based_selection: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TierPriorities {
    #[serde(default = "priority_mcp_webhook")]
    pub mcp_webhook: u8,
    
    #[serde(default = "priority_bridge_internal")]
    pub bridge_internal: u8,
    
    #[serde(default = "priority_file_watcher")]
    pub file_watcher: u8,
}

// Default timeout values (as per requirements)
fn default_webhook_timeout() -> u64 { 100 }
fn default_bridge_timeout() -> u64 { 500 }
fn default_file_watcher_timeout() -> u64 { 5000 }
fn default_file_debounce() -> u64 { 500 }
fn default_system_timeout() -> u64 { 10000 }
fn default_degradation_grace() -> u64 { 1000 }
fn default_health_check_interval() -> u64 { 30000 }
fn default_config_reload_interval() -> u64 { 5000 }
fn default_circuit_breaker_recovery() -> u64 { 30000 }

// Default tier configuration values
fn default_performance_degradation_threshold() -> f64 { 0.8 }
fn default_response_time_threshold() -> u64 { 2000 }
fn default_error_rate_threshold() -> f64 { 15.0 }
fn default_consecutive_failures() -> u32 { 3 }
fn default_tier_enabled() -> bool { true }
fn default_auto_recovery() -> bool { true }
fn default_performance_monitoring() -> bool { true }

fn default_tier_priorities() -> TierPriorities {
    TierPriorities {
        mcp_webhook: 1,
        bridge_internal: 2,
        file_watcher: 3,
    }
}

fn priority_mcp_webhook() -> u8 { 1 }
fn priority_bridge_internal() -> u8 { 2 }
fn priority_file_watcher() -> u8 { 3 }

impl Default for Config {
    fn default() -> Self {
        let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let cc_telegram_dir = home_dir.join(".cc_telegram");
        
        Self {
            telegram: TelegramConfig {
                telegram_bot_token: String::new(),
                telegram_allowed_users: Vec::new(),
                timezone: default_timezone(),
                message_style: default_message_style(),
            },
            paths: PathsConfig {
                events_dir: cc_telegram_dir.join("events"),
                responses_dir: cc_telegram_dir.join("responses"),
            },
            notifications: NotificationsConfig {
                task_completion: true,
                approval_requests: true,
                progress_updates: false,
            },
            security: SecurityConfig {
                rate_limit_requests: 30,
                rate_limit_window: 60,
                audit_log: true,
            },
            performance: PerformanceConfig::default(),
            monitoring: MonitoringConfig {
                health_check_port: 8080,
                enable_metrics_server: true,
                metrics_endpoint: "/metrics".to_string(),
                health_endpoint: "/health".to_string(),
            },
            timeouts: TimeoutConfig {
                webhook_timeout_ms: default_webhook_timeout(),
                bridge_processing_timeout_ms: default_bridge_timeout(),
                file_watcher_timeout_ms: default_file_watcher_timeout(),
                file_watcher_debounce_ms: default_file_debounce(),
                overall_system_timeout_ms: default_system_timeout(),
                degradation_grace_period_ms: default_degradation_grace(),
                health_check_interval_ms: default_health_check_interval(),
                config_reload_interval_ms: default_config_reload_interval(),
                circuit_breaker_recovery_timeout_ms: default_circuit_breaker_recovery(),
            },
            tier_configuration: TierConfiguration {
                performance_degradation_threshold: default_performance_degradation_threshold(),
                response_time_degradation_ms: default_response_time_threshold(),
                error_rate_threshold_percent: default_error_rate_threshold(),
                max_consecutive_failures: default_consecutive_failures(),
                tier_priorities: default_tier_priorities(),
                mcp_webhook_enabled: default_tier_enabled(),
                bridge_internal_enabled: default_tier_enabled(),
                file_watcher_enabled: default_tier_enabled(),
                enable_auto_recovery: default_auto_recovery(),
                enable_performance_based_selection: default_performance_monitoring(),
            },
        }
    }
}

impl Config {
    pub fn load() -> Result<Self> {
        let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let config_dir = home_dir.join(".cc_telegram");
        let config_file = config_dir.join("config.toml");

        // Create config directory if it doesn't exist
        fs::create_dir_all(&config_dir)
            .with_context(|| format!("Failed to create config directory: {}", config_dir.display()))?;

        let mut config = if config_file.exists() {
            info!("Loading configuration from: {}", config_file.display());
            let content = fs::read_to_string(&config_file)
                .with_context(|| format!("Failed to read config file: {}", config_file.display()))?;
            
            toml::from_str(&content)
                .with_context(|| format!("Failed to parse config file: {}", config_file.display()))?
        } else {
            warn!("Config file not found, creating default configuration");
            let default_config = Self::default();
            default_config.save(&config_file)?;
            default_config
        };

        // Override with environment variables
        config.load_from_env()?;
        
        // Validate configuration
        config.validate()?;

        Ok(config)
    }

    pub fn save(&self, path: &PathBuf) -> Result<()> {
        let mut content = String::new();
        content.push_str("# CC Telegram Bridge Configuration\n");
        content.push_str("# \n");
        content.push_str("# IMPORTANT: Sensitive configuration (bot token, user IDs) should be set\n");
        content.push_str("# in environment variables for security:\n");
        content.push_str("# \n");
        content.push_str("# Required environment variables:\n");
        content.push_str("#   TELEGRAM_BOT_TOKEN=\"your_bot_token_here\"\n");
        content.push_str("#   TELEGRAM_ALLOWED_USERS=\"123456,789012\"\n");
        content.push_str("# \n");
        content.push_str("# Optional environment variables:\n");
        content.push_str("#   CC_TELEGRAM_EVENTS_DIR=\"/custom/events/path\"\n");
        content.push_str("#   CC_TELEGRAM_RESPONSES_DIR=\"/custom/responses/path\"\n");
        content.push_str("#   CC_TELEGRAM_TIMEZONE=\"America/New_York\"  # Default: Europe/Berlin\n");
        content.push_str("\n");
        
        let config_content = toml::to_string_pretty(self)
            .context("Failed to serialize configuration")?;
        content.push_str(&config_content);
            
        fs::write(path, content)
            .with_context(|| format!("Failed to write config file: {}", path.display()))?;
            
        info!("Configuration saved to: {}", path.display());
        Ok(())
    }

    fn load_from_env(&mut self) -> Result<()> {
        // Load Telegram bot token from environment
        if let Ok(token) = std::env::var("TELEGRAM_BOT_TOKEN") {
            if !token.is_empty() {
                self.telegram.telegram_bot_token = token;
                info!("Loaded Telegram bot token from environment");
            }
        }

        // Load allowed users from environment (comma-separated)
        if let Ok(users_str) = std::env::var("TELEGRAM_ALLOWED_USERS") {
            if !users_str.is_empty() {
                let users: Result<Vec<i64>, _> = users_str
                    .split(',')
                    .map(|s| s.trim().parse::<i64>())
                    .collect();
                
                match users {
                    Ok(user_list) => {
                        self.telegram.telegram_allowed_users = user_list;
                        info!("Loaded {} allowed users from environment", self.telegram.telegram_allowed_users.len());
                    }
                    Err(e) => {
                        warn!("Failed to parse TELEGRAM_ALLOWED_USERS: {}", e);
                    }
                }
            }
        }

        // Load timezone from environment
        if let Ok(timezone) = std::env::var("CC_TELEGRAM_TIMEZONE") {
            if !timezone.is_empty() {
                self.telegram.timezone = timezone;
                info!("Loaded timezone from environment: {}", self.telegram.timezone);
            }
        }

        // Load message style from environment
        if let Ok(message_style) = std::env::var("CC_TELEGRAM_MESSAGE_STYLE") {
            if !message_style.is_empty() {
                self.telegram.message_style = message_style;
                info!("Loaded message style from environment: {}", self.telegram.message_style);
            }
        }

        // Load paths from environment
        if let Ok(events_dir) = std::env::var("CC_TELEGRAM_EVENTS_DIR") {
            self.paths.events_dir = PathBuf::from(events_dir);
        }
        
        if let Ok(responses_dir) = std::env::var("CC_TELEGRAM_RESPONSES_DIR") {
            self.paths.responses_dir = PathBuf::from(responses_dir);
        }

        Ok(())
    }

    fn validate(&self) -> Result<()> {
        if self.telegram.telegram_bot_token.is_empty() {
            anyhow::bail!("\nTelegram bot token is required.\n\nPlease set the TELEGRAM_BOT_TOKEN environment variable:\n  export TELEGRAM_BOT_TOKEN=\"your_bot_token_here\"\n\nGet your bot token from @BotFather on Telegram.");
        }

        if self.telegram.telegram_allowed_users.is_empty() {
            anyhow::bail!("\nAt least one allowed user is required.\n\nPlease set the TELEGRAM_ALLOWED_USERS environment variable:\n  export TELEGRAM_ALLOWED_USERS=\"123456,789012\"\n\nFind your user ID by messaging @userinfobot on Telegram.");
        }

        if !self.paths.events_dir.is_absolute() {
            anyhow::bail!("Events directory must be an absolute path");
        }

        if !self.paths.responses_dir.is_absolute() {
            anyhow::bail!("Responses directory must be an absolute path");
        }

        // Validate timeout configuration
        self.validate_timeouts()?;
        
        // Validate tier configuration
        self.validate_tier_configuration()?;

        Ok(())
    }

    pub fn get_config_dir() -> PathBuf {
        let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home_dir.join(".cc_telegram")
    }

    /// Validate timeout configuration values
    pub fn validate_timeouts(&self) -> Result<()> {
        if self.timeouts.webhook_timeout_ms == 0 {
            anyhow::bail!("Webhook timeout must be greater than 0");
        }
        if self.timeouts.bridge_processing_timeout_ms == 0 {
            anyhow::bail!("Bridge processing timeout must be greater than 0");
        }
        if self.timeouts.file_watcher_timeout_ms == 0 {
            anyhow::bail!("File watcher timeout must be greater than 0");
        }
        if self.timeouts.overall_system_timeout_ms == 0 {
            anyhow::bail!("Overall system timeout must be greater than 0");
        }
        
        // Validate tier timeouts are sensible
        if self.timeouts.webhook_timeout_ms > self.timeouts.bridge_processing_timeout_ms {
            warn!("Webhook timeout ({}) is greater than bridge timeout ({})", 
                  self.timeouts.webhook_timeout_ms, self.timeouts.bridge_processing_timeout_ms);
        }
        
        if self.timeouts.bridge_processing_timeout_ms > self.timeouts.file_watcher_timeout_ms {
            warn!("Bridge timeout ({}) is greater than file watcher timeout ({})", 
                  self.timeouts.bridge_processing_timeout_ms, self.timeouts.file_watcher_timeout_ms);
        }

        Ok(())
    }

    /// Validate tier configuration values
    pub fn validate_tier_configuration(&self) -> Result<()> {
        if self.tier_configuration.performance_degradation_threshold < 0.0 
            || self.tier_configuration.performance_degradation_threshold > 1.0 {
            anyhow::bail!("Performance degradation threshold must be between 0.0 and 1.0");
        }
        
        if self.tier_configuration.error_rate_threshold_percent < 0.0 
            || self.tier_configuration.error_rate_threshold_percent > 100.0 {
            anyhow::bail!("Error rate threshold must be between 0.0 and 100.0");
        }
        
        if self.tier_configuration.max_consecutive_failures == 0 {
            anyhow::bail!("Max consecutive failures must be greater than 0");
        }

        // Check that at least one tier is enabled
        if !self.tier_configuration.mcp_webhook_enabled 
            && !self.tier_configuration.bridge_internal_enabled 
            && !self.tier_configuration.file_watcher_enabled {
            anyhow::bail!("At least one tier must be enabled");
        }

        Ok(())
    }

    /// Get timeout for specific tier
    pub fn get_tier_timeout(&self, tier_type: crate::tier_orchestrator::TierType) -> Duration {
        let timeout_ms = match tier_type {
            crate::tier_orchestrator::TierType::McpWebhook => self.timeouts.webhook_timeout_ms,
            crate::tier_orchestrator::TierType::BridgeInternal => self.timeouts.bridge_processing_timeout_ms,
            crate::tier_orchestrator::TierType::FileWatcher => self.timeouts.file_watcher_timeout_ms,
        };
        Duration::from_millis(timeout_ms)
    }

    /// Get tier priority from configuration
    pub fn get_tier_priority(&self, tier_type: crate::tier_orchestrator::TierType) -> u8 {
        match tier_type {
            crate::tier_orchestrator::TierType::McpWebhook => self.tier_configuration.tier_priorities.mcp_webhook,
            crate::tier_orchestrator::TierType::BridgeInternal => self.tier_configuration.tier_priorities.bridge_internal,
            crate::tier_orchestrator::TierType::FileWatcher => self.tier_configuration.tier_priorities.file_watcher,
        }
    }

    /// Check if tier is enabled
    pub fn is_tier_enabled(&self, tier_type: crate::tier_orchestrator::TierType) -> bool {
        match tier_type {
            crate::tier_orchestrator::TierType::McpWebhook => self.tier_configuration.mcp_webhook_enabled,
            crate::tier_orchestrator::TierType::BridgeInternal => self.tier_configuration.bridge_internal_enabled,
            crate::tier_orchestrator::TierType::FileWatcher => self.tier_configuration.file_watcher_enabled,
        }
    }
}

/// Configuration manager with hot-reload capability
#[derive(Debug)]
pub struct ConfigManager {
    current_config: Arc<RwLock<Config>>,
    config_path: PathBuf,
    last_modified: Arc<RwLock<std::time::SystemTime>>,
    _watcher: Option<RecommendedWatcher>,
}

impl ConfigManager {
    /// Create a new configuration manager with hot-reload capability
    pub fn new() -> Result<Self> {
        let config_path = Self::get_config_path();
        let config = Config::load()?;
        
        let last_modified = if config_path.exists() {
            config_path.metadata()
                .context("Failed to read config file metadata")?
                .modified()
                .context("Failed to get config file modification time")?
        } else {
            std::time::SystemTime::now()
        };

        Ok(Self {
            current_config: Arc::new(RwLock::new(config)),
            config_path,
            last_modified: Arc::new(RwLock::new(last_modified)),
            _watcher: None,
        })
    }

    /// Get the current configuration
    pub async fn get_config(&self) -> Config {
        self.current_config.read().await.clone()
    }

    /// Check for configuration changes and reload if necessary
    pub async fn check_and_reload(&self) -> Result<bool> {
        if !self.config_path.exists() {
            return Ok(false);
        }

        let metadata = self.config_path.metadata()
            .context("Failed to read config file metadata")?;
        let current_modified = metadata.modified()
            .context("Failed to get config file modification time")?;

        let last_modified = *self.last_modified.read().await;
        
        if current_modified > last_modified {
            info!("🔄 [CONFIG] Configuration file changed, reloading...");
            
            match Config::load() {
                Ok(new_config) => {
                    // Validate new configuration
                    if let Err(e) = new_config.validate_timeouts() {
                        warn!("⚠️ [CONFIG] Invalid timeout configuration: {}", e);
                        return Ok(false);
                    }
                    
                    if let Err(e) = new_config.validate_tier_configuration() {
                        warn!("⚠️ [CONFIG] Invalid tier configuration: {}", e);
                        return Ok(false);
                    }

                    *self.current_config.write().await = new_config;
                    *self.last_modified.write().await = current_modified;
                    
                    info!("✅ [CONFIG] Configuration reloaded successfully");
                    return Ok(true);
                }
                Err(e) => {
                    warn!("⚠️ [CONFIG] Failed to reload configuration: {}", e);
                    return Ok(false);
                }
            }
        }

        Ok(false)
    }

    /// Start background configuration monitoring task
    pub async fn start_config_monitor(self: Arc<Self>) -> Result<()> {
        let config_manager = Arc::clone(&self);
        let interval_ms = {
            let config = self.get_config().await;
            config.timeouts.config_reload_interval_ms
        };

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(interval_ms));
            
            loop {
                interval.tick().await;
                
                if let Err(e) = config_manager.check_and_reload().await {
                    warn!("⚠️ [CONFIG] Error checking configuration: {}", e);
                }
            }
        });

        info!("🚀 [CONFIG] Started configuration monitoring task");
        Ok(())
    }

    /// Update timeout configuration dynamically
    pub async fn update_timeout(&self, tier_type: crate::tier_orchestrator::TierType, timeout_ms: u64) -> Result<()> {
        let mut config = self.current_config.write().await;
        
        match tier_type {
            crate::tier_orchestrator::TierType::McpWebhook => {
                config.timeouts.webhook_timeout_ms = timeout_ms;
            }
            crate::tier_orchestrator::TierType::BridgeInternal => {
                config.timeouts.bridge_processing_timeout_ms = timeout_ms;
            }
            crate::tier_orchestrator::TierType::FileWatcher => {
                config.timeouts.file_watcher_timeout_ms = timeout_ms;
            }
        }

        // Validate updated configuration
        config.validate_timeouts()?;
        
        info!("✅ [CONFIG] Updated {} timeout to {}ms", 
              tier_type.as_str(), timeout_ms);
        
        Ok(())
    }

    /// Enable or disable a tier
    pub async fn set_tier_enabled(&self, tier_type: crate::tier_orchestrator::TierType, enabled: bool) -> Result<()> {
        let mut config = self.current_config.write().await;
        
        match tier_type {
            crate::tier_orchestrator::TierType::McpWebhook => {
                config.tier_configuration.mcp_webhook_enabled = enabled;
            }
            crate::tier_orchestrator::TierType::BridgeInternal => {
                config.tier_configuration.bridge_internal_enabled = enabled;
            }
            crate::tier_orchestrator::TierType::FileWatcher => {
                config.tier_configuration.file_watcher_enabled = enabled;
            }
        }

        // Validate that at least one tier remains enabled
        config.validate_tier_configuration()?;
        
        info!("✅ [CONFIG] {} tier {} {}", 
              tier_type.as_str(), 
              if enabled { "enabled" } else { "disabled" },
              if enabled { "✓" } else { "✗" });
              
        Ok(())
    }

    fn get_config_path() -> PathBuf {
        let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home_dir.join(".cc_telegram").join("config.toml")
    }
}
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use anyhow::{Result, Context};
use std::fs;
use tracing::{info, warn};
use crate::utils::performance::PerformanceConfig;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Config {
    pub telegram: TelegramConfig,
    pub paths: PathsConfig,
    pub notifications: NotificationsConfig,
    pub security: SecurityConfig,
    pub performance: PerformanceConfig,
    pub monitoring: MonitoringConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TelegramConfig {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub telegram_bot_token: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub telegram_allowed_users: Vec<i64>,
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

impl Default for Config {
    fn default() -> Self {
        let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let cc_telegram_dir = home_dir.join(".cc_telegram");
        
        Self {
            telegram: TelegramConfig {
                telegram_bot_token: String::new(),
                telegram_allowed_users: Vec::new(),
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

        Ok(())
    }

    pub fn get_config_dir() -> PathBuf {
        let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home_dir.join(".cc_telegram")
    }
}
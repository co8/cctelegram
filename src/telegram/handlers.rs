use crate::events::types::ResponseEvent;
use crate::utils::security::SecurityManager;
use chrono::{Utc, TimeZone};
use chrono_tz::Tz;
use std::collections::HashMap;
use anyhow::{Result, Context};
use tracing::{info, warn};

#[allow(dead_code)]
pub struct CallbackHandler {
    responses_dir: std::path::PathBuf,
    timezone: Tz,
    security_manager: SecurityManager,
}

#[allow(dead_code)]
impl CallbackHandler {
    pub fn new(responses_dir: std::path::PathBuf, timezone: Tz) -> Self {
        // Initialize with default security settings
        let security_manager = SecurityManager::new(vec![], 30, 60);
        Self { responses_dir, timezone, security_manager }
    }

    pub fn new_with_security(
        responses_dir: std::path::PathBuf, 
        timezone: Tz,
        allowed_users: Vec<i64>,
        rate_limit_requests: u32,
        rate_limit_window: u64,
    ) -> Self {
        let security_manager = SecurityManager::new(allowed_users, rate_limit_requests, rate_limit_window);
        Self { responses_dir, timezone, security_manager }
    }

    pub async fn handle_callback(&self, callback_data: &str, user_id: i64) -> Result<String> {
        // Sanitize input first
        let sanitized_callback = self.security_manager.sanitize_input(callback_data);
        
        info!("Processing sanitized callback from user: {}", user_id);

        let parts: Vec<&str> = sanitized_callback.split('_').collect();
        if parts.len() < 2 {
            warn!("Invalid callback format received from user {}", user_id);
            return Ok("Invalid callback data".to_string());
        }

        let action = parts[0];
        let raw_task_id = parts[1..].join("_");
        
        // Validate task ID
        if !self.security_manager.validate_task_id(&raw_task_id) {
            warn!("Invalid task ID format: {} from user {}", raw_task_id, user_id);
            return Ok("Invalid task ID format".to_string());
        }
        
        let task_id = raw_task_id;

        match action {
            "approve" => self.handle_approval(&task_id, user_id, "approve").await,
            "deny" => self.handle_approval(&task_id, user_id, "deny").await,
            "ack" => self.handle_acknowledgment(&task_id, user_id).await,
            "details" => self.handle_details_request(&task_id, user_id).await,
            _ => Ok(format!("Unknown action: {}", action)),
        }
    }

    async fn handle_approval(&self, task_id: &str, user_id: i64, response: &str) -> Result<String> {
        let response_event = ResponseEvent {
            event_id: task_id.to_string(),
            user_id: user_id.to_string(),
            timestamp: Utc::now(),
            response: response.to_string(),
            metadata: Some({
                let mut metadata = HashMap::new();
                metadata.insert("response_time".to_string(), serde_json::Value::String(Utc::now().to_rfc3339()));
                metadata.insert("user_agent".to_string(), serde_json::Value::String("Telegram Bot".to_string()));
                metadata
            }),
        };

        self.write_response_file(&response_event).await?;

        let utc_now = Utc::now();
        let local_time = self.timezone.from_utc_datetime(&utc_now.naive_utc());
        let timestamp = local_time.format("%d/%b/%y %H:%M").to_string();
        let message = match response {
            "approve" => format!("*✅ Request Approved*\n⏰ {}", timestamp),
            "deny" => format!("*❌ Request Denied*\n⏰ {}", timestamp),
            _ => format!("*🤖 Response Received*\n⏰ {}", timestamp),
        };

        info!("User {} {} task {}", user_id, response, task_id);
        Ok(message)
    }

    async fn handle_acknowledgment(&self, task_id: &str, user_id: i64) -> Result<String> {
        let response_event = ResponseEvent {
            event_id: task_id.to_string(),
            user_id: user_id.to_string(),
            timestamp: Utc::now(),
            response: "acknowledge".to_string(),
            metadata: Some({
                let mut metadata = HashMap::new();
                metadata.insert("response_time".to_string(), serde_json::Value::String(Utc::now().to_rfc3339()));
                metadata
            }),
        };

        self.write_response_file(&response_event).await?;

        let utc_now = Utc::now();
        let local_time = self.timezone.from_utc_datetime(&utc_now.naive_utc());
        let timestamp = local_time.format("%d/%b/%y %H:%M").to_string();
        info!("User {} acknowledged task {}", user_id, task_id);
        Ok(format!("*👍 Notification Acknowledged*\n⏰ {}", timestamp))
    }

    async fn handle_details_request(&self, task_id: &str, user_id: i64) -> Result<String> {
        info!("User {} requested details for task {}", user_id, task_id);
        info!("DEBUG: Checking task_id '{}' for details formatting", task_id);
        
        // For now, provide a structured details response  
        // In the future, this would read from stored event data
        let details = if task_id.contains("deployment") || task_id.contains("approval") || task_id.contains("demo") || task_id.contains("test") {
            info!("DEBUG: Task ID '{}' matched condition, using deployment details", task_id);
            format!(
                "*📋 Deployment Details*\n\n\
                🔄 *Changes:*\n\
                • Enhanced user authentication\n\
                • Database performance \\+40%\n\
                • Real\\-time notifications\n\
                • Security patches applied\n\n\
                🔍 *Pre\\-flight Checks:*\n\
                ✅ Tests: 1,247 passed\n\
                ✅ Security: Clean scan\n\
                ✅ Database: Migration ready\n\
                ✅ Backup: Completed\n\n\
                📊 *Impact Assessment:*\n\
                ⏱️ Downtime: 2\\-3 minutes\n\
                👥 Users: All production\n\
                🔄 Rollback: 5 minutes"
            )
        } else {
            info!("DEBUG: Task ID '{}' did NOT match condition, using placeholder", task_id);
            format!(
                "📄 **Task Details**\n\n\
                Task ID: `{}`\n\n\
                *Additional details would be shown here based on the event type and data\\.*",
                task_id
            )
        };
        
        Ok(details)
    }

    async fn write_response_file(&self, response: &ResponseEvent) -> Result<()> {
        use tokio::fs::OpenOptions;
        use std::os::unix::fs::PermissionsExt;
        
        tokio::fs::create_dir_all(&self.responses_dir).await?;
        
        // Sanitize the filename components
        let sanitized_response = self.security_manager.sanitize_input(&response.response);
        let sanitized_event_id = self.security_manager.sanitize_input(&response.event_id);
        let filename = format!("{}_{}.json", sanitized_response, sanitized_event_id);
        let file_path = self.responses_dir.join(filename);
        
        let json_content = serde_json::to_string_pretty(response)?;
        
        // Write file with restrictive permissions (0600)
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&file_path)
            .await
            .context("Failed to create response file")?;
        
        // Set restrictive permissions (owner read/write only)
        let metadata = file.metadata().await?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o600);
        tokio::fs::set_permissions(&file_path, permissions).await?;
        
        // Write content
        use tokio::io::AsyncWriteExt;
        file.write_all(json_content.as_bytes()).await?;
        
        info!("Response written securely to: {}", file_path.display());
        Ok(())
    }
}
use crate::events::types::ResponseEvent;
use chrono::{Utc, TimeZone};
use chrono_tz::Tz;
use std::collections::HashMap;
use anyhow::Result;
use tracing::info;

#[allow(dead_code)]
pub struct CallbackHandler {
    responses_dir: std::path::PathBuf,
    timezone: Tz,
}

#[allow(dead_code)]
impl CallbackHandler {
    pub fn new(responses_dir: std::path::PathBuf, timezone: Tz) -> Self {
        Self { responses_dir, timezone }
    }

    pub async fn handle_callback(&self, callback_data: &str, user_id: i64) -> Result<String> {
        info!("Processing callback: {} from user: {}", callback_data, user_id);

        let parts: Vec<&str> = callback_data.split('_').collect();
        if parts.len() < 2 {
            return Ok("Invalid callback data".to_string());
        }

        let action = parts[0];
        let task_id = parts[1..].join("_");

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
        
        // TODO: Implement reading full event details from storage
        Ok(format!(
            "📄 **Task Details**\n\n\
            Task ID: `{}`\n\n\
            *Detailed information would be loaded from the original event data.*\n\n\
            💡 This feature will be enhanced in future versions.",
            task_id
        ))
    }

    async fn write_response_file(&self, response: &ResponseEvent) -> Result<()> {
        tokio::fs::create_dir_all(&self.responses_dir).await?;
        
        let filename = format!("{}_{}.json", response.response, response.event_id);
        let file_path = self.responses_dir.join(filename);
        
        let json_content = serde_json::to_string_pretty(response)?;
        tokio::fs::write(&file_path, json_content).await?;
        
        info!("Response written to: {}", file_path.display());
        Ok(())
    }
}
use super::types::{Event, EventType};
use anyhow::{Result, Context};
use std::path::Path;
use tokio::fs;
use tracing::{info, error, warn};

pub struct EventProcessor {
    events_dir: std::path::PathBuf,
}

impl EventProcessor {
    pub fn new<P: AsRef<Path>>(events_dir: P) -> Self {
        Self {
            events_dir: events_dir.as_ref().to_path_buf(),
        }
    }

    pub async fn process_event_file<P: AsRef<Path>>(&self, file_path: P) -> Result<Event> {
        let file_path = file_path.as_ref();
        info!("Processing event file: {}", file_path.display());

        // Read the file content
        let content = fs::read_to_string(file_path)
            .await
            .with_context(|| format!("Failed to read event file: {}", file_path.display()))?;

        // Parse JSON
        let event: Event = serde_json::from_str(&content)
            .with_context(|| format!("Failed to parse event JSON from: {}", file_path.display()))?;

        // Validate event
        self.validate_event(&event)?;

        info!(
            "Successfully processed {} event with ID: {}", 
            self.event_type_to_string(&event.event_type),
            event.task_id
        );

        Ok(event)
    }

    fn validate_event(&self, event: &Event) -> Result<()> {
        if event.task_id.is_empty() {
            anyhow::bail!("Event task_id cannot be empty");
        }

        if event.title.is_empty() {
            anyhow::bail!("Event title cannot be empty");
        }

        match event.event_type {
            EventType::ApprovalRequest => {
                if event.data.approval_prompt.is_none() {
                    anyhow::bail!("Approval request must have approval_prompt");
                }
                if event.data.options.is_none() || event.data.options.as_ref().unwrap().is_empty() {
                    anyhow::bail!("Approval request must have options");
                }
            }
            EventType::TaskCompletion => {
                if event.data.status.is_none() {
                    anyhow::bail!("Task completion must have status");
                }
            }
            EventType::ProgressUpdate => {
                // Progress updates are more flexible
            }
        }

        Ok(())
    }

    fn event_type_to_string(&self, event_type: &EventType) -> &'static str {
        match event_type {
            EventType::TaskCompletion => "task_completion",
            EventType::ApprovalRequest => "approval_request",
            EventType::ProgressUpdate => "progress_update",
        }
    }

    pub async fn cleanup_processed_file<P: AsRef<Path>>(&self, file_path: P) -> Result<()> {
        let file_path = file_path.as_ref();
        
        match fs::remove_file(file_path).await {
            Ok(()) => {
                info!("Cleaned up processed event file: {}", file_path.display());
                Ok(())
            }
            Err(e) => {
                warn!("Failed to cleanup event file {}: {}", file_path.display(), e);
                Ok(()) // Don't fail the entire process for cleanup issues
            }
        }
    }
}
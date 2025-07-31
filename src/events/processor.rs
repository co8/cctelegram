use super::types::{Event, EventType};
use anyhow::{Result, Context};
use std::path::Path;
use tokio::fs;
use tracing::{info, warn};

pub struct EventProcessor {
    #[allow(dead_code)]
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
            // All other event types have basic validation requirements
            _ => {
                // Basic validation - all events need task_id and title (checked above)
                // Specific validation can be added here for individual event types as needed
            }
        }

        Ok(())
    }

    fn event_type_to_string(&self, event_type: &EventType) -> &'static str {
        use EventType::*;
        match event_type {
            // Original three event types
            TaskCompletion => "task_completion",
            ApprovalRequest => "approval_request",
            ProgressUpdate => "progress_update",
            
            // Task Management Events
            TaskStarted => "task_started",
            TaskFailed => "task_failed",
            TaskProgress => "task_progress",
            TaskCancelled => "task_cancelled",
            
            // Code Operation Events
            CodeGeneration => "code_generation",
            CodeAnalysis => "code_analysis",
            CodeRefactoring => "code_refactoring",
            CodeReview => "code_review",
            CodeTesting => "code_testing",
            CodeDeployment => "code_deployment",
            
            // File System Events
            FileCreated => "file_created",
            FileModified => "file_modified",
            FileDeleted => "file_deleted",
            DirectoryCreated => "directory_created",
            DirectoryDeleted => "directory_deleted",
            
            // Build & Development Events
            BuildStarted => "build_started",
            BuildCompleted => "build_completed",
            BuildFailed => "build_failed",
            TestSuiteRun => "test_suite_run",
            TestPassed => "test_passed",
            TestFailed => "test_failed",
            LintCheck => "lint_check",
            TypeCheck => "type_check",
            
            // Git & Version Control Events
            GitCommit => "git_commit",
            GitPush => "git_push",
            GitMerge => "git_merge",
            GitBranch => "git_branch",
            GitTag => "git_tag",
            PullRequestCreated => "pull_request_created",
            PullRequestMerged => "pull_request_merged",
            
            // System & Monitoring Events
            SystemHealth => "system_health",
            PerformanceAlert => "performance_alert",
            SecurityAlert => "security_alert",
            ErrorOccurred => "error_occurred",
            ResourceUsage => "resource_usage",
            
            // User Interaction Events
            UserResponse => "user_response",
            CommandExecuted => "command_executed",
            
            // Notification Events
            StatusChange => "status_change",
            AlertNotification => "alert_notification",
            InfoNotification => "info_notification",
            
            // Integration Events
            ApiCall => "api_call",
            WebhookReceived => "webhook_received",
            ServiceIntegration => "service_integration",
            
            // Custom Events
            CustomEvent => "custom_event",
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
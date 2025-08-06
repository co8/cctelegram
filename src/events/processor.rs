use super::types::{Event, EventType};
use super::watcher::{DebouncedEventWatcher, FileEventBatch, DebouncedFileEvent, DebounceConfig};
use anyhow::{Result, Context};
use std::path::Path;
use tokio::fs;
use tokio::sync::mpsc;
use tracing::{info, warn, error, debug};

pub struct EventProcessor {
    #[allow(dead_code)]
    events_dir: std::path::PathBuf,
}

/// Enhanced event processor with debouncing capabilities
pub struct DebouncedEventProcessor {
    processor: EventProcessor,
    watcher: Option<DebouncedEventWatcher>,
    batch_sender: Option<mpsc::UnboundedSender<Vec<Event>>>,
    batch_receiver: Option<mpsc::UnboundedReceiver<Vec<Event>>>,
}

/// Configuration for the debounced event processor
pub struct DebouncedProcessorConfig {
    pub events_dir: std::path::PathBuf,
    pub debounce_config: Option<DebounceConfig>,
    pub auto_cleanup: bool,
    pub max_concurrent_processing: usize,
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
            
            // Unknown event type for forward compatibility
            Unknown => "unknown_event",
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

impl Default for DebouncedProcessorConfig {
    fn default() -> Self {
        Self {
            events_dir: std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")),
            debounce_config: None,
            auto_cleanup: true,
            max_concurrent_processing: 10,
        }
    }
}

impl DebouncedEventProcessor {
    /// Create a new debounced event processor
    pub fn new(config: DebouncedProcessorConfig) -> Result<Self> {
        let processor = EventProcessor::new(&config.events_dir);
        let watcher = DebouncedEventWatcher::new(&config.events_dir, config.debounce_config)?;
        let (batch_sender, batch_receiver) = mpsc::unbounded_channel();

        Ok(Self {
            processor,
            watcher: Some(watcher),
            batch_sender: Some(batch_sender),
            batch_receiver: Some(batch_receiver),
        })
    }

    /// Start the debounced event processing system
    pub async fn start_processing(&mut self) -> Result<()> {
        let mut watcher = self.watcher.take()
            .ok_or_else(|| anyhow::anyhow!("Watcher already started"))?;

        let batch_sender = self.batch_sender.take()
            .ok_or_else(|| anyhow::anyhow!("Batch sender already taken"))?;

        info!("Starting debounced event processing system");

        // Process debounced batches using the watcher's integrated processing
        let processing_handle = tokio::spawn(async move {
            // Start processing in the background and collect batches
            tokio::spawn(async move {
                if let Err(e) = watcher.start_processing().await {
                    error!("Debounced watcher error: {}", e);
                }
            });
            
            // For now, we'll need to create a new watcher instance to get batches
            // This is a design limitation that should be improved in the future
            info!("Debounced processing started - batches will be processed by main loop");
        });

        // Wait for the processing task
        if let Err(e) = processing_handle.await {
            error!("Processing task error: {}", e);
        }

        Ok(())
    }

    /// Get the next batch of processed events
    pub async fn next_event_batch(&mut self) -> Option<Vec<Event>> {
        if let Some(ref mut receiver) = self.batch_receiver {
            receiver.recv().await
        } else {
            None
        }
    }

    /// Process a single debounced file event
    pub async fn process_debounced_event(&self, event: &DebouncedFileEvent) -> Result<Option<Event>> {
        if !event.content_changed {
            debug!("Skipping timestamp-only change: {}", event.path.display());
            return Ok(None);
        }

        info!("Processing content change for: {}", event.path.display());

        match self.processor.process_event_file(&event.path).await {
            Ok(parsed_event) => {
                debug!("Successfully processed debounced event: {} -> {}", 
                       event.path.display(), parsed_event.task_id);
                Ok(Some(parsed_event))
            }
            Err(e) => {
                warn!("Failed to process debounced event {}: {}", event.path.display(), e);
                Err(e)
            }
        }
    }

    /// Get processing statistics
    pub fn get_stats(&self) -> DebouncedProcessorStats {
        DebouncedProcessorStats {
            watcher_active: self.watcher.is_none(), // None means it's been moved to processing task
            batch_sender_active: self.batch_sender.is_none(),
            batch_receiver_active: self.batch_receiver.is_some(),
        }
    }
}

/// Statistics for the debounced event processor
#[derive(Debug, Clone)]
pub struct DebouncedProcessorStats {
    pub watcher_active: bool,
    pub batch_sender_active: bool,
    pub batch_receiver_active: bool,
}

/// Process a batch of debounced file events into parsed Events
async fn process_file_batch(batch: &FileEventBatch) -> Result<Vec<Event>> {
    info!("Processing file batch with {} events (from {} raw events)", 
          batch.events.len(), batch.raw_event_count);

    let processor = EventProcessor::new(".");
    let mut processed_events = Vec::new();

    for file_event in &batch.events {
        if !file_event.content_changed {
            debug!("Skipping timestamp-only change: {}", file_event.path.display());
            continue;
        }

        debug!("Processing content change: {} (hash: {:?})", 
               file_event.path.display(), file_event.content_hash);

        match processor.process_event_file(&file_event.path).await {
            Ok(event) => {
                info!("Successfully processed event: {} from {}", 
                      event.task_id, file_event.path.display());
                processed_events.push(event);
            }
            Err(e) => {
                warn!("Failed to process file {}: {}", file_event.path.display(), e);
                // Continue processing other files in the batch
            }
        }
    }

    info!("Batch processing complete: {}/{} events successfully processed", 
          processed_events.len(), batch.events.len());

    Ok(processed_events)
}

/// Utility function to create a debounced processor with default configuration
pub fn create_debounced_processor<P: AsRef<Path>>(events_dir: P) -> Result<DebouncedEventProcessor> {
    let config = DebouncedProcessorConfig {
        events_dir: events_dir.as_ref().to_path_buf(),
        ..Default::default()
    };
    DebouncedEventProcessor::new(config)
}

/// Utility function to create a debounced processor with custom debounce settings
pub fn create_custom_debounced_processor<P: AsRef<Path>>(
    events_dir: P, 
    debounce_config: DebounceConfig
) -> Result<DebouncedEventProcessor> {
    let config = DebouncedProcessorConfig {
        events_dir: events_dir.as_ref().to_path_buf(),
        debounce_config: Some(debounce_config),
        ..Default::default()
    };
    DebouncedEventProcessor::new(config)
}
use serde::{Deserialize, Deserializer, Serialize};
use chrono::{DateTime, Utc, Duration};
use std::collections::HashMap;
use uuid::Uuid;

/// Event processing status for queue management and reliability tracking
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProcessingStatus {
    #[default]
    Pending,        // Event received, waiting to be processed
    Processing,     // Event is currently being processed
    Delivered,      // Event successfully delivered to Telegram
    Failed,         // Event processing failed
    Retrying,       // Event failed but is being retried
    Abandoned,      // Event permanently failed after max retries
    Duplicate,      // Event was a duplicate and ignored
    Unknown,        // Unknown processing status for forward compatibility
}

// Custom deserializer implementation for ProcessingStatus with fallback handling
impl<'de> Deserialize<'de> for ProcessingStatus {
    fn deserialize<D>(deserializer: D) -> Result<ProcessingStatus, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "pending" => Ok(ProcessingStatus::Pending),
            "processing" => Ok(ProcessingStatus::Processing),
            "delivered" => Ok(ProcessingStatus::Delivered),
            "failed" => Ok(ProcessingStatus::Failed),
            "retrying" => Ok(ProcessingStatus::Retrying),
            "abandoned" => Ok(ProcessingStatus::Abandoned),
            "duplicate" => Ok(ProcessingStatus::Duplicate),
            _ => {
                tracing::warn!("Unknown processing status '{}', using Unknown variant", s);
                Ok(ProcessingStatus::Unknown)
            }
        }
    }
}

/// Event validation errors with specific error types and user-friendly messages
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationError {
    // Field constraint errors
    EmptyField { field: String },
    InvalidLength { field: String, current: usize, min: Option<usize>, max: Option<usize> },
    InvalidFormat { field: String, expected_format: String },
    InvalidTimestamp { reason: String },
    InvalidUuid { field: String },
    
    // Business logic validation errors
    MissingRequiredField { field: String, context: String },
    InvalidValue { field: String, value: String, allowed_values: Vec<String> },
    InvalidDuration { reason: String },
    InvalidProgressData { reason: String },
    InvalidApprovalData { reason: String },
    
    // Event consistency and integrity errors
    DuplicateEvent { event_id: String, original_timestamp: DateTime<Utc> },
    InconsistentEventData { reason: String },
    
    // Schema and structure errors
    UnknownEventType { event_type: String },
    MissingEventData { required_data: String },
}

impl ValidationError {
    /// Get a user-friendly error message
    pub fn message(&self) -> String {
        match self {
            ValidationError::EmptyField { field } => {
                format!("The '{}' field cannot be empty", field)
            }
            ValidationError::InvalidLength { field, current, min, max } => {
                let range = match (min, max) {
                    (Some(min_val), Some(max_val)) => format!("between {} and {} characters", min_val, max_val),
                    (Some(min_val), None) => format!("at least {} characters", min_val),
                    (None, Some(max_val)) => format!("no more than {} characters", max_val),
                    (None, None) => "within valid length limits".to_string(),
                };
                format!("The '{}' field must be {} (current: {} characters)", field, range, current)
            }
            ValidationError::InvalidFormat { field, expected_format } => {
                format!("The '{}' field has invalid format. Expected: {}", field, expected_format)
            }
            ValidationError::InvalidTimestamp { reason } => {
                format!("Invalid timestamp: {}", reason)
            }
            ValidationError::InvalidUuid { field } => {
                format!("The '{}' field must be a valid UUID", field)
            }
            ValidationError::MissingRequiredField { field, context } => {
                format!("Missing required field '{}' for {}", field, context)
            }
            ValidationError::InvalidValue { field, value, allowed_values } => {
                format!("Invalid value '{}' for field '{}'. Allowed values: [{}]", 
                       value, field, allowed_values.join(", "))
            }
            ValidationError::InvalidDuration { reason } => {
                format!("Invalid duration: {}", reason)
            }
            ValidationError::InvalidProgressData { reason } => {
                format!("Invalid progress data: {}", reason)
            }
            ValidationError::InvalidApprovalData { reason } => {
                format!("Invalid approval data: {}", reason)
            }
            ValidationError::DuplicateEvent { event_id, original_timestamp } => {
                format!("Duplicate event detected. Event ID '{}' was already processed at {}", 
                       event_id, original_timestamp.format("%Y-%m-%d %H:%M:%S UTC"))
            }
            ValidationError::InconsistentEventData { reason } => {
                format!("Event data is inconsistent: {}", reason)
            }
            ValidationError::UnknownEventType { event_type } => {
                format!("Unknown event type: {}", event_type)
            }
            ValidationError::MissingEventData { required_data } => {
                format!("Missing required event data: {}", required_data)
            }
        }
    }
    
    /// Get error severity level
    pub fn severity(&self) -> &'static str {
        match self {
            ValidationError::EmptyField { .. } |
            ValidationError::InvalidLength { .. } |
            ValidationError::InvalidFormat { .. } |
            ValidationError::InvalidUuid { .. } |
            ValidationError::MissingRequiredField { .. } => "high",
            
            ValidationError::InvalidTimestamp { .. } |
            ValidationError::InvalidValue { .. } |
            ValidationError::InconsistentEventData { .. } |
            ValidationError::UnknownEventType { .. } |
            ValidationError::MissingEventData { .. } => "medium",
            
            ValidationError::InvalidDuration { .. } |
            ValidationError::InvalidProgressData { .. } |
            ValidationError::InvalidApprovalData { .. } => "low",
            
            ValidationError::DuplicateEvent { .. } => "critical",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct Event {
    // Core event identification - ENHANCED FOR RELIABILITY
    pub event_id: String, // UUID for deduplication and tracking
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub source: String,
    pub timestamp: DateTime<Utc>,
    pub task_id: String,
    pub title: String,
    pub description: String,
    pub data: EventData,
    
    // Reliability and queue management fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>, // For tracking related events
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_event_id: Option<String>, // For event chains
    #[serde(default)]
    pub retry_count: u32, // Track retry attempts
    #[serde(default)]
    pub processing_status: ProcessingStatus, // Queue processing state
    #[serde(default)]
    pub schema_version: String, // For backward compatibility
    #[serde(default)]
    pub created_at: DateTime<Utc>, // When event was created (vs processed)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processed_at: Option<DateTime<Utc>>, // When event was processed
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    // Task Management Events
    TaskCompletion,
    TaskStarted,
    TaskFailed,
    TaskProgress,
    TaskCancelled,
    
    // Code Operation Events
    CodeGeneration,
    CodeAnalysis,
    CodeRefactoring,
    CodeReview,
    CodeTesting,
    CodeDeployment,
    
    // File System Events
    FileCreated,
    FileModified,
    FileDeleted,
    DirectoryCreated,
    DirectoryDeleted,
    
    // Build & Development Events
    BuildStarted,
    BuildCompleted,
    BuildFailed,
    TestSuiteRun,
    TestPassed,
    TestFailed,
    LintCheck,
    TypeCheck,
    
    // Git & Version Control Events
    GitCommit,
    GitPush,
    GitMerge,
    GitBranch,
    GitTag,
    PullRequestCreated,
    PullRequestMerged,
    
    // System & Monitoring Events
    SystemHealth,
    PerformanceAlert,
    SecurityAlert,
    ErrorOccurred,
    ResourceUsage,
    
    // User Interaction Events
    ApprovalRequest,
    UserResponse,
    CommandExecuted,
    
    // Notification Events
    ProgressUpdate,
    StatusChange,
    AlertNotification,
    InfoNotification,
    
    // Integration Events
    ApiCall,
    WebhookReceived,
    ServiceIntegration,
    
    // Custom Events
    CustomEvent,
    
    // Unknown event type for forward compatibility
    Unknown,
}

// Custom deserializer implementation for EventType with fallback handling
impl<'de> Deserialize<'de> for EventType {
    fn deserialize<D>(deserializer: D) -> Result<EventType, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            // Task Management Events
            "task_completion" => Ok(EventType::TaskCompletion),
            "task_started" => Ok(EventType::TaskStarted),
            "task_failed" => Ok(EventType::TaskFailed),
            "task_progress" => Ok(EventType::TaskProgress),
            "task_cancelled" => Ok(EventType::TaskCancelled),
            
            // Code Operation Events
            "code_generation" => Ok(EventType::CodeGeneration),
            "code_analysis" => Ok(EventType::CodeAnalysis),
            "code_refactoring" => Ok(EventType::CodeRefactoring),
            "code_review" => Ok(EventType::CodeReview),
            "code_testing" => Ok(EventType::CodeTesting),
            "code_deployment" => Ok(EventType::CodeDeployment),
            
            // File System Events
            "file_created" => Ok(EventType::FileCreated),
            "file_modified" => Ok(EventType::FileModified),
            "file_deleted" => Ok(EventType::FileDeleted),
            "directory_created" => Ok(EventType::DirectoryCreated),
            "directory_deleted" => Ok(EventType::DirectoryDeleted),
            
            // Build & Development Events
            "build_started" => Ok(EventType::BuildStarted),
            "build_completed" => Ok(EventType::BuildCompleted),
            "build_failed" => Ok(EventType::BuildFailed),
            "test_suite_run" => Ok(EventType::TestSuiteRun),
            "test_passed" => Ok(EventType::TestPassed),
            "test_failed" => Ok(EventType::TestFailed),
            "lint_check" => Ok(EventType::LintCheck),
            "type_check" => Ok(EventType::TypeCheck),
            
            // Git & Version Control Events
            "git_commit" => Ok(EventType::GitCommit),
            "git_push" => Ok(EventType::GitPush),
            "git_merge" => Ok(EventType::GitMerge),
            "git_branch" => Ok(EventType::GitBranch),
            "git_tag" => Ok(EventType::GitTag),
            "pull_request_created" => Ok(EventType::PullRequestCreated),
            "pull_request_merged" => Ok(EventType::PullRequestMerged),
            
            // System & Monitoring Events
            "system_health" => Ok(EventType::SystemHealth),
            "performance_alert" => Ok(EventType::PerformanceAlert),
            "security_alert" => Ok(EventType::SecurityAlert),
            "error_occurred" => Ok(EventType::ErrorOccurred),
            "resource_usage" => Ok(EventType::ResourceUsage),
            
            // User Interaction Events
            "approval_request" => Ok(EventType::ApprovalRequest),
            "user_response" => Ok(EventType::UserResponse),
            "command_executed" => Ok(EventType::CommandExecuted),
            
            // Notification Events
            "progress_update" => Ok(EventType::ProgressUpdate),
            "status_change" => Ok(EventType::StatusChange),
            "alert_notification" => Ok(EventType::AlertNotification),
            "info_notification" => Ok(EventType::InfoNotification),
            
            // Integration Events
            "api_call" => Ok(EventType::ApiCall),
            "webhook_received" => Ok(EventType::WebhookReceived),
            "service_integration" => Ok(EventType::ServiceIntegration),
            
            // Custom Events
            "custom_event" => Ok(EventType::CustomEvent),
            
            // Unknown or unrecognized event types (forward compatibility)
            _ => {
                tracing::warn!("Unknown event type '{}', using Unknown variant", s);
                Ok(EventType::Unknown)
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct EventData {
    // Status and Results
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    
    // File and Path Information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_affected: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_number: Option<u32>,
    
    // Code Information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_snippet: Option<String>,
    
    // Git Information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_changed: Option<Vec<String>>,
    
    // Build and Test Information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tests_passed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tests_failed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage_percentage: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    
    // Performance and System Information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_usage_mb: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_usage_percent: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk_usage_mb: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_bytes: Option<u64>,
    
    // Error Information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_trace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>, // low, medium, high, critical
    
    // User Interaction
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Vec<String>>,
    
    // Notification Information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>, // low, normal, high, urgent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<ActionButton>>,
    
    // Integration Information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_code: Option<u16>,
    
    // Custom and Extended Data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ActionButton {
    pub text: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>, // primary, secondary, danger
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ResponseEvent {
    pub event_id: String,
    pub user_id: String,
    pub timestamp: DateTime<Utc>,
    pub response: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

// ============================================================================
// SPECIALIZED EVENT DATA STRUCTURES - TYPE-SAFE ALTERNATIVES
// ============================================================================

/// Specialized data structure for task completion events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct TaskCompletionData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_affected: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

/// Specialized data structure for approval request events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ApprovalRequestData {
    pub prompt: String,
    pub options: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
    pub priority: String, // low, normal, high, urgent
    pub actions: Vec<ActionButton>,
}

/// Specialized data structure for progress update events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ProgressUpdateData {
    pub current: u64,
    pub total: u64,
    pub message: String,
    pub percentage: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_completion: Option<DateTime<Utc>>,
}

/// Specialized data structure for performance alert events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PerformanceAlertData {
    pub metric: String,
    pub current_value: f64,
    pub threshold: f64,
    pub severity: String, // low, medium, high, critical
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_info: Option<SystemMetrics>,
}

/// Specialized data structure for code operation events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct CodeOperationData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_affected: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_snippet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_number: Option<u32>,
    pub success: bool,
}

/// Specialized data structure for build and test events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct BuildTestData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tests_passed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tests_failed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage_percentage: Option<f32>,
    pub duration_ms: u64,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

/// Specialized data structure for git operation events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GitOperationData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_changed: Option<Vec<String>>,
    pub operation_type: String, // commit, push, merge, branch, tag
}

/// Specialized data structure for system monitoring events
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SystemMonitoringData {
    pub metrics: SystemMetrics,
    pub alerts: Vec<String>,
    pub health_status: String, // healthy, warning, critical
    pub timestamp: DateTime<Utc>,
}

/// System performance metrics
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SystemMetrics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_usage_mb: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_usage_percent: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk_usage_mb: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub load_average: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_seconds: Option<u64>,
}

/// Type-safe event wrapper for specialized event data
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "event_type", content = "data")]
pub enum TypedEventData {
    TaskCompletion(TaskCompletionData),
    ApprovalRequest(ApprovalRequestData),
    ProgressUpdate(ProgressUpdateData),
    PerformanceAlert(PerformanceAlertData),
    CodeOperation(CodeOperationData),
    BuildTest(BuildTestData),
    GitOperation(GitOperationData),
    SystemMonitoring(SystemMonitoringData),
    // Fallback for backward compatibility
    Generic(EventData),
}

/// Type-safe specialized event structure
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct TypedEvent {
    // Core event identification - ENHANCED FOR RELIABILITY
    pub event_id: String, // UUID for deduplication and tracking
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub source: String,
    pub timestamp: DateTime<Utc>,
    pub task_id: String,
    pub title: String,
    pub description: String,
    
    // Type-safe specialized data
    #[serde(flatten)]
    pub typed_data: TypedEventData,
    
    // Reliability and queue management fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_event_id: Option<String>,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default)]
    pub processing_status: ProcessingStatus,
    #[serde(default)]
    pub schema_version: String,
    #[serde(default)]
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processed_at: Option<DateTime<Utc>>,
}

// Event builder implementations
#[allow(dead_code)]
impl Event {
    /// Create a new event with basic information and reliability tracking
    pub fn new(
        event_type: EventType,
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            // Core event identification - ENHANCED FOR RELIABILITY
            event_id: Uuid::new_v4().to_string(),
            event_type,
            source: source.into(),
            timestamp: now,
            task_id: task_id.into(),
            title: title.into(),
            description: description.into(),
            data: EventData::default(),
            
            // Reliability and queue management fields
            correlation_id: None,
            parent_event_id: None,
            retry_count: 0,
            processing_status: ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: now,
            processed_at: None,
        }
    }

    /// Set the event data
    pub fn with_data(mut self, data: EventData) -> Self {
        self.data = data;
        self
    }

    /// Set the timestamp
    pub fn with_timestamp(mut self, timestamp: DateTime<Utc>) -> Self {
        self.timestamp = timestamp;
        self
    }

    /// Set correlation ID for event tracking
    pub fn with_correlation_id(mut self, correlation_id: impl Into<String>) -> Self {
        self.correlation_id = Some(correlation_id.into());
        self
    }

    /// Set parent event ID for event chains
    pub fn with_parent_event_id(mut self, parent_event_id: impl Into<String>) -> Self {
        self.parent_event_id = Some(parent_event_id.into());
        self
    }

    /// Mark event as processed and set processed timestamp
    pub fn mark_processed(&mut self) {
        self.processing_status = ProcessingStatus::Delivered;
        self.processed_at = Some(Utc::now());
    }

    /// Mark event as failed and increment retry count
    pub fn mark_failed(&mut self) {
        self.processing_status = ProcessingStatus::Failed;
        self.retry_count += 1;
    }

    /// Mark event as retrying
    pub fn mark_retrying(&mut self) {
        self.processing_status = ProcessingStatus::Retrying;
    }

    /// Mark event as abandoned after max retries
    pub fn mark_abandoned(&mut self) {
        self.processing_status = ProcessingStatus::Abandoned;
    }

    /// Mark event as duplicate
    pub fn mark_duplicate(&mut self) {
        self.processing_status = ProcessingStatus::Duplicate;
    }

    /// Check if event should be retried based on retry count
    pub fn should_retry(&self, max_retries: u32) -> bool {
        matches!(self.processing_status, ProcessingStatus::Failed) && self.retry_count < max_retries
    }

    /// Check if event is in a final state (delivered, abandoned, or duplicate)
    pub fn is_final_state(&self) -> bool {
        matches!(self.processing_status, 
            ProcessingStatus::Delivered | 
            ProcessingStatus::Abandoned | 
            ProcessingStatus::Duplicate
        )
    }

    /// Get processing duration in milliseconds
    pub fn get_processing_duration_ms(&self) -> Option<i64> {
        self.processed_at.map(|processed| {
            (processed - self.created_at).num_milliseconds()
        })
    }

    // Task Management Event Builders
    pub fn task_completed(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        results: Option<String>,
    ) -> Self {
        Self::new(
            EventType::TaskCompletion,
            source,
            task_id,
            title,
            "Task completed successfully",
        )
        .with_data(EventData {
            status: Some("completed".to_string()),
            success: Some(true),
            results,
            ..Default::default()
        })
    }

    pub fn task_failed(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        error_message: String,
    ) -> Self {
        Self::new(
            EventType::TaskFailed,
            source,
            task_id,
            title,
            "Task failed",
        )
        .with_data(EventData {
            status: Some("failed".to_string()),
            success: Some(false),
            error_message: Some(error_message),
            severity: Some("high".to_string()),
            ..Default::default()
        })
    }

    pub fn task_progress(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        progress: String,
    ) -> Self {
        Self::new(
            EventType::TaskProgress,
            source,
            task_id,
            title,
            progress.clone(),
        )
        .with_data(EventData {
            status: Some("in_progress".to_string()),
            results: Some(progress),
            ..Default::default()
        })
    }

    // Code Operation Event Builders
    pub fn code_generated(
        source: impl Into<String>,
        task_id: impl Into<String>,
        file_path: String,
        language: String,
    ) -> Self {
        Self::new(
            EventType::CodeGeneration,
            source,
            task_id,
            format!("Code generated: {}", file_path),
            "New code has been generated",
        )
        .with_data(EventData {
            file_path: Some(file_path),
            language: Some(language),
            status: Some("generated".to_string()),
            success: Some(true),
            ..Default::default()
        })
    }

    pub fn code_analyzed(
        source: impl Into<String>,
        task_id: impl Into<String>,
        files: Vec<String>,
        results: String,
    ) -> Self {
        Self::new(
            EventType::CodeAnalysis,
            source,
            task_id,
            "Code analysis completed",
            "Code analysis has been completed",
        )
        .with_data(EventData {
            files_affected: Some(files),
            results: Some(results),
            status: Some("analyzed".to_string()),
            success: Some(true),
            ..Default::default()
        })
    }

    // Build & Development Event Builders
    pub fn build_completed(
        source: impl Into<String>,
        task_id: impl Into<String>,
        target: String,
        duration_ms: u64,
        success: bool,
    ) -> Self {
        let event_type = if success { EventType::BuildCompleted } else { EventType::BuildFailed };
        let description = if success { "Build completed successfully" } else { "Build failed" };
        
        Self::new(
            event_type,
            source,
            task_id,
            format!("Build {}: {}", if success { "completed" } else { "failed" }, target),
            description,
        )
        .with_data(EventData {
            build_target: Some(target),
            duration_ms: Some(duration_ms),
            success: Some(success),
            status: Some(if success { "completed" } else { "failed" }.to_string()),
            ..Default::default()
        })
    }

    pub fn test_results(
        source: impl Into<String>,
        task_id: impl Into<String>,
        total: u32,
        passed: u32,
        failed: u32,
        duration_ms: u64,
    ) -> Self {
        let success = failed == 0;
        let event_type = if success { EventType::TestPassed } else { EventType::TestFailed };
        
        Self::new(
            event_type,
            source,
            task_id,
            format!("Tests: {}/{} passed", passed, total),
            format!("Test suite completed with {} passed, {} failed", passed, failed),
        )
        .with_data(EventData {
            test_count: Some(total),
            tests_passed: Some(passed),
            tests_failed: Some(failed),
            duration_ms: Some(duration_ms),
            success: Some(success),
            status: Some(if success { "passed" } else { "failed" }.to_string()),
            ..Default::default()
        })
    }

    // Git Event Builders
    pub fn git_commit(
        source: impl Into<String>,
        task_id: impl Into<String>,
        commit_hash: String,
        message: String,
        author: String,
        files_changed: Vec<String>,
    ) -> Self {
        Self::new(
            EventType::GitCommit,
            source,
            task_id,
            format!("Git commit: {}", &commit_hash[..commit_hash.len().min(8)]),
            message.clone(),
        )
        .with_data(EventData {
            commit_hash: Some(commit_hash),
            commit_message: Some(message),
            author: Some(author),
            files_changed: Some(files_changed),
            success: Some(true),
            ..Default::default()
        })
    }

    pub fn git_push(
        source: impl Into<String>,
        task_id: impl Into<String>,
        branch: String,
        commits_count: u32,
    ) -> Self {
        Self::new(
            EventType::GitPush,
            source,
            task_id,
            format!("Pushed {} commits to {}", commits_count, branch),
            "Changes pushed to remote repository",
        )
        .with_data(EventData {
            branch_name: Some(branch),
            success: Some(true),
            metadata: {
                let mut map = HashMap::new();
                map.insert("commits_count".to_string(), serde_json::Value::Number(commits_count.into()));
                Some(map)
            },
            ..Default::default()
        })
    }

    // System Event Builders
    pub fn performance_alert(
        source: impl Into<String>,
        task_id: impl Into<String>,
        metric: String,
        value: f64,
        threshold: f64,
    ) -> Self {
        Self::new(
            EventType::PerformanceAlert,
            source,
            task_id,
            format!("Performance Alert: {}", metric),
            format!("{} is {} (threshold: {})", metric, value, threshold),
        )
        .with_data(EventData {
            severity: Some("high".to_string()),
            priority: Some("high".to_string()),
            category: Some("performance".to_string()),
            metadata: {
                let mut map = HashMap::new();
                map.insert("metric".to_string(), serde_json::Value::String(metric));
                map.insert("value".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(value).unwrap()));
                map.insert("threshold".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(threshold).unwrap()));
                Some(map)
            },
            ..Default::default()
        })
    }

    pub fn error_occurred(
        source: impl Into<String>,
        task_id: impl Into<String>,
        error_message: String,
        severity: String,
        stack_trace: Option<String>,
    ) -> Self {
        Self::new(
            EventType::ErrorOccurred,
            source,
            task_id,
            "Error occurred",
            error_message.clone(),
        )
        .with_data(EventData {
            error_message: Some(error_message),
            severity: Some(severity),
            stack_trace,
            success: Some(false),
            priority: Some("high".to_string()),
            ..Default::default()
        })
    }

    // User Interaction Event Builders
    pub fn approval_request(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        prompt: String,
        options: Vec<String>,
    ) -> Self {
        let actions: Vec<ActionButton> = options.iter().map(|opt| ActionButton {
            text: opt.clone(),
            action: format!("approve_{}", opt.to_lowercase().replace(' ', "_")),
            data: Some(opt.clone()),
            style: if opt.to_lowercase().contains("approve") || opt.to_lowercase().contains("yes") {
                Some("primary".to_string())
            } else if opt.to_lowercase().contains("reject") || opt.to_lowercase().contains("no") {
                Some("danger".to_string())
            } else {
                Some("secondary".to_string())
            },
        }).collect();

        Self::new(
            EventType::ApprovalRequest,
            source,
            task_id,
            title,
            prompt.clone(),
        )
        .with_data(EventData {
            approval_prompt: Some(prompt),
            options: Some(options),
            actions: Some(actions),
            priority: Some("high".to_string()),
            category: Some("user_interaction".to_string()),
            ..Default::default()
        })
    }

    // File System Event Builders
    pub fn file_modified(
        source: impl Into<String>,
        task_id: impl Into<String>,
        file_path: String,
        language: Option<String>,
    ) -> Self {
        Self::new(
            EventType::FileModified,
            source,
            task_id,
            format!("File modified: {}", file_path),
            "A file has been modified",
        )
        .with_data(EventData {
            file_path: Some(file_path),
            language,
            status: Some("modified".to_string()),
            ..Default::default()
        })
    }
}

impl Default for EventData {
    fn default() -> Self {
        Self {
            status: None,
            results: None,
            exit_code: None,
            success: None,
            file_path: None,
            files_affected: None,
            directory: None,
            line_number: None,
            language: None,
            function_name: None,
            class_name: None,
            module_name: None,
            code_snippet: None,
            commit_hash: None,
            branch_name: None,
            author: None,
            commit_message: None,
            files_changed: None,
            build_target: None,
            test_count: None,
            tests_passed: None,
            tests_failed: None,
            coverage_percentage: None,
            duration_ms: None,
            memory_usage_mb: None,
            cpu_usage_percent: None,
            disk_usage_mb: None,
            network_bytes: None,
            error_message: None,
            error_code: None,
            stack_trace: None,
            severity: None,
            approval_prompt: None,
            options: None,
            user_id: None,
            command: None,
            arguments: None,
            priority: None,
            category: None,
            tags: None,
            url: None,
            actions: None,
            service_name: None,
            endpoint: None,
            request_id: None,
            response_code: None,
            metadata: None,
        }
    }
}

// ============================================================================
// SERIALIZATION VALIDATION AND ERROR HANDLING METHODS
// ============================================================================

impl Event {
    /// Validate JSON serialization compliance and payload optimization
    pub fn validate_serialization(&self) -> Result<(), String> {
        // Test serialization to JSON
        match self.to_json() {
            Ok(json) => {
                // Verify JSON structure compliance
                if !json.contains("\"type\"") {
                    return Err("JSON serialization missing required type field".to_string());
                }
                
                if !json.contains("\"processing_status\"") {
                    return Err("JSON serialization missing required processing_status field".to_string());
                }
                
                // Verify snake_case naming convention
                if json.contains("eventType") || json.contains("taskId") || json.contains("processingStatus") {
                    return Err("JSON serialization using camelCase instead of snake_case".to_string());
                }
                
                // Verify payload optimization - check that None fields are not serialized
                let none_field_count = [
                    self.data.file_path.is_none() && json.contains("\"file_path\""),
                    self.data.files_affected.is_none() && json.contains("\"files_affected\""),
                    self.data.error_message.is_none() && json.contains("\"error_message\""),
                    self.data.metadata.is_none() && json.contains("\"metadata\""),
                    self.correlation_id.is_none() && json.contains("\"correlation_id\""),
                    self.parent_event_id.is_none() && json.contains("\"parent_event_id\""),
                    self.processed_at.is_none() && json.contains("\"processed_at\""),
                ].iter().filter(|&&x| x).count();
                
                if none_field_count > 0 {
                    return Err(format!("JSON serialization includes {} None fields, payload not optimized", none_field_count));
                }
                
                // Test round-trip serialization
                match Event::from_json(&json) {
                    Ok(deserialized) => {
                        // Verify critical fields survive round-trip
                        if self.event_type != deserialized.event_type {
                            return Err("Round-trip serialization failed: event_type mismatch".to_string());
                        }
                        if self.processing_status != deserialized.processing_status {
                            return Err("Round-trip serialization failed: processing_status mismatch".to_string());
                        }
                        if self.source != deserialized.source {
                            return Err("Round-trip serialization failed: source mismatch".to_string());
                        }
                        if self.task_id != deserialized.task_id {
                            return Err("Round-trip serialization failed: task_id mismatch".to_string());
                        }
                    }
                    Err(e) => return Err(format!("Round-trip deserialization failed: {}", e)),
                }
                
                Ok(())
            }
            Err(e) => Err(format!("JSON serialization failed: {}", e)),
        }
    }

    /// Get descriptive error message for deserialization failures
    pub fn get_deserialization_error_context(json: &str, error: &serde_json::Error) -> String {
        let line = error.line();
        let column = error.column();
        
        // Extract the problematic line from JSON
        let lines: Vec<&str> = json.lines().collect();
        let problematic_line = if line > 0 && line <= lines.len() {
            lines[line - 1]
        } else {
            "Unable to identify problematic line"
        };
        
        format!(
            "JSON deserialization error at line {}, column {}: {}\n\
            Problematic line: {}\n\
            \n\
            Common solutions:\n\
            - Check for missing required fields: event_id, event_type, source, timestamp, task_id, title, description, data\n\
            - Verify enum values match expected variants (unknown values will be mapped to Unknown)\n\
            - Ensure proper JSON syntax (commas, quotes, brackets)\n\
            - Check timestamp format (RFC3339/ISO8601 expected)\n\
            - Verify UUID format for event_id",
            line, column, error, problematic_line
        )
    }

    /// Validate JSON schema compliance with detailed diagnostics
    pub fn validate_json_schema(json: &str) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        
        // Basic JSON parsing check
        match serde_json::from_str::<serde_json::Value>(json) {
            Ok(value) => {
                // Check for required fields
                let required_fields = [
                    "event_id", "type", "source", "timestamp", 
                    "task_id", "title", "description", "data"
                ];
                
                for field in &required_fields {
                    if !value.get(field).is_some() {
                        errors.push(format!("Missing required field: {}", field));
                    }
                }
                
                // Check data field structure
                if let Some(data) = value.get("data") {
                    if !data.is_object() {
                        errors.push("Field 'data' must be an object".to_string());
                    }
                } else {
                    errors.push("Missing required field: data".to_string());
                }
                
                // Check timestamp format
                if let Some(timestamp) = value.get("timestamp") {
                    if let Some(timestamp_str) = timestamp.as_str() {
                        if chrono::DateTime::parse_from_rfc3339(timestamp_str).is_err() {
                            errors.push("Invalid timestamp format. Expected RFC3339/ISO8601".to_string());
                        }
                    } else {
                        errors.push("Timestamp must be a string in RFC3339 format".to_string());
                    }
                }
                
                // Check event_type validity (attempt deserialization)
                if let Some(event_type) = value.get("event_type") {
                    if let Some(event_type_str) = event_type.as_str() {
                        let test_result: Result<EventType, _> = serde_json::from_str(&format!("\"{}\"", event_type_str));
                        if test_result.is_err() {
                            // This shouldn't happen due to our Unknown fallback, but check anyway
                            errors.push(format!("Invalid event_type: {}", event_type_str));
                        }
                    } else {
                        errors.push("Event type must be a string".to_string());
                    }
                }
                
                // Check processing_status validity
                if let Some(status) = value.get("processing_status") {
                    if let Some(status_str) = status.as_str() {
                        let test_result: Result<ProcessingStatus, _> = serde_json::from_str(&format!("\"{}\"", status_str));
                        if test_result.is_err() {
                            errors.push(format!("Invalid processing_status: {}", status_str));
                        }
                    } else {
                        errors.push("Processing status must be a string".to_string());
                    }
                }
                
                // Check UUID format for event_id
                if let Some(event_id) = value.get("event_id") {
                    if let Some(event_id_str) = event_id.as_str() {
                        if uuid::Uuid::parse_str(event_id_str).is_err() {
                            errors.push(format!("Invalid UUID format for event_id: {}", event_id_str));
                        }
                    } else {
                        errors.push("Event ID must be a string".to_string());
                    }
                }
                
            }
            Err(e) => {
                errors.push(format!("Invalid JSON syntax: {}", e));
            }
        }
        
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Calculate JSON payload size optimization metrics
    pub fn calculate_payload_optimization_metrics(&self) -> PayloadOptimizationMetrics {
        // Serialize optimized version (current)
        let optimized_json = self.to_json().unwrap_or_default();
        
        // Create a version with all optional fields populated for comparison
        let mut full_event = self.clone();
        full_event.data = EventData {
            status: Some(self.data.status.clone().unwrap_or_else(|| "default".to_string())),
            results: Some(self.data.results.clone().unwrap_or_else(|| "default".to_string())),
            exit_code: Some(self.data.exit_code.unwrap_or(0)),
            success: Some(self.data.success.unwrap_or(false)),
            file_path: Some(self.data.file_path.clone().unwrap_or_else(|| "default".to_string())),
            files_affected: Some(self.data.files_affected.clone().unwrap_or_else(|| vec!["default".to_string()])),
            directory: Some(self.data.directory.clone().unwrap_or_else(|| "default".to_string())),
            line_number: Some(self.data.line_number.unwrap_or(0)),
            language: Some(self.data.language.clone().unwrap_or_else(|| "default".to_string())),
            function_name: Some(self.data.function_name.clone().unwrap_or_else(|| "default".to_string())),
            class_name: Some(self.data.class_name.clone().unwrap_or_else(|| "default".to_string())),
            module_name: Some(self.data.module_name.clone().unwrap_or_else(|| "default".to_string())),
            code_snippet: Some(self.data.code_snippet.clone().unwrap_or_else(|| "default".to_string())),
            commit_hash: Some(self.data.commit_hash.clone().unwrap_or_else(|| "default".to_string())),
            branch_name: Some(self.data.branch_name.clone().unwrap_or_else(|| "default".to_string())),
            author: Some(self.data.author.clone().unwrap_or_else(|| "default".to_string())),
            commit_message: Some(self.data.commit_message.clone().unwrap_or_else(|| "default".to_string())),
            files_changed: Some(self.data.files_changed.clone().unwrap_or_else(|| vec!["default".to_string()])),
            build_target: Some(self.data.build_target.clone().unwrap_or_else(|| "default".to_string())),
            test_count: Some(self.data.test_count.unwrap_or(0)),
            tests_passed: Some(self.data.tests_passed.unwrap_or(0)),
            tests_failed: Some(self.data.tests_failed.unwrap_or(0)),
            coverage_percentage: Some(self.data.coverage_percentage.unwrap_or(0.0)),
            duration_ms: Some(self.data.duration_ms.unwrap_or(0)),
            memory_usage_mb: Some(self.data.memory_usage_mb.unwrap_or(0.0)),
            cpu_usage_percent: Some(self.data.cpu_usage_percent.unwrap_or(0.0)),
            disk_usage_mb: Some(self.data.disk_usage_mb.unwrap_or(0.0)),
            network_bytes: Some(self.data.network_bytes.unwrap_or(0)),
            error_message: Some(self.data.error_message.clone().unwrap_or_else(|| "default".to_string())),
            error_code: Some(self.data.error_code.clone().unwrap_or_else(|| "default".to_string())),
            stack_trace: Some(self.data.stack_trace.clone().unwrap_or_else(|| "default".to_string())),
            severity: Some(self.data.severity.clone().unwrap_or_else(|| "default".to_string())),
            approval_prompt: Some(self.data.approval_prompt.clone().unwrap_or_else(|| "default".to_string())),
            options: Some(self.data.options.clone().unwrap_or_else(|| vec!["default".to_string()])),
            user_id: Some(self.data.user_id.clone().unwrap_or_else(|| "default".to_string())),
            command: Some(self.data.command.clone().unwrap_or_else(|| "default".to_string())),
            arguments: Some(self.data.arguments.clone().unwrap_or_else(|| vec!["default".to_string()])),
            priority: Some(self.data.priority.clone().unwrap_or_else(|| "default".to_string())),
            category: Some(self.data.category.clone().unwrap_or_else(|| "default".to_string())),
            tags: Some(self.data.tags.clone().unwrap_or_else(|| vec!["default".to_string()])),
            url: Some(self.data.url.clone().unwrap_or_else(|| "default".to_string())),
            actions: Some(self.data.actions.clone().unwrap_or_else(|| vec![])),
            service_name: Some(self.data.service_name.clone().unwrap_or_else(|| "default".to_string())),
            endpoint: Some(self.data.endpoint.clone().unwrap_or_else(|| "default".to_string())),
            request_id: Some(self.data.request_id.clone().unwrap_or_else(|| "default".to_string())),
            response_code: Some(self.data.response_code.unwrap_or(200)),
            metadata: Some(self.data.metadata.clone().unwrap_or_else(|| {
                let mut map = HashMap::new();
                map.insert("default".to_string(), serde_json::Value::String("default".to_string()));
                map
            })),
        };
        full_event.correlation_id = Some(self.correlation_id.clone().unwrap_or_else(|| "default".to_string()));
        full_event.parent_event_id = Some(self.parent_event_id.clone().unwrap_or_else(|| "default".to_string()));
        full_event.processed_at = Some(self.processed_at.unwrap_or_else(|| Utc::now()));
        
        let full_json = full_event.to_json().unwrap_or_default();
        
        let optimized_size = optimized_json.len();
        let full_size = full_json.len();
        let size_reduction_bytes = full_size.saturating_sub(optimized_size);
        let size_reduction_percentage = if full_size > 0 {
            (size_reduction_bytes as f64 / full_size as f64) * 100.0
        } else {
            0.0
        };
        
        PayloadOptimizationMetrics {
            optimized_size_bytes: optimized_size,
            full_size_bytes: full_size,
            size_reduction_bytes,
            size_reduction_percentage,
            null_fields_omitted: self.count_omitted_fields(),
        }
    }

    /// Count the number of optional fields that are None (and thus omitted from JSON)
    fn count_omitted_fields(&self) -> u32 {
        let mut count = 0;
        
        // EventData optional fields
        if self.data.status.is_none() { count += 1; }
        if self.data.results.is_none() { count += 1; }
        if self.data.exit_code.is_none() { count += 1; }
        if self.data.success.is_none() { count += 1; }
        if self.data.file_path.is_none() { count += 1; }
        if self.data.files_affected.is_none() { count += 1; }
        if self.data.directory.is_none() { count += 1; }
        if self.data.line_number.is_none() { count += 1; }
        if self.data.language.is_none() { count += 1; }
        if self.data.function_name.is_none() { count += 1; }
        if self.data.class_name.is_none() { count += 1; }
        if self.data.module_name.is_none() { count += 1; }
        if self.data.code_snippet.is_none() { count += 1; }
        if self.data.commit_hash.is_none() { count += 1; }
        if self.data.branch_name.is_none() { count += 1; }
        if self.data.author.is_none() { count += 1; }
        if self.data.commit_message.is_none() { count += 1; }
        if self.data.files_changed.is_none() { count += 1; }
        if self.data.build_target.is_none() { count += 1; }
        if self.data.test_count.is_none() { count += 1; }
        if self.data.tests_passed.is_none() { count += 1; }
        if self.data.tests_failed.is_none() { count += 1; }
        if self.data.coverage_percentage.is_none() { count += 1; }
        if self.data.duration_ms.is_none() { count += 1; }
        if self.data.memory_usage_mb.is_none() { count += 1; }
        if self.data.cpu_usage_percent.is_none() { count += 1; }
        if self.data.disk_usage_mb.is_none() { count += 1; }
        if self.data.network_bytes.is_none() { count += 1; }
        if self.data.error_message.is_none() { count += 1; }
        if self.data.error_code.is_none() { count += 1; }
        if self.data.stack_trace.is_none() { count += 1; }
        if self.data.severity.is_none() { count += 1; }
        if self.data.approval_prompt.is_none() { count += 1; }
        if self.data.options.is_none() { count += 1; }
        if self.data.user_id.is_none() { count += 1; }
        if self.data.command.is_none() { count += 1; }
        if self.data.arguments.is_none() { count += 1; }
        if self.data.priority.is_none() { count += 1; }
        if self.data.category.is_none() { count += 1; }
        if self.data.tags.is_none() { count += 1; }
        if self.data.url.is_none() { count += 1; }
        if self.data.actions.is_none() { count += 1; }
        if self.data.service_name.is_none() { count += 1; }
        if self.data.endpoint.is_none() { count += 1; }
        if self.data.request_id.is_none() { count += 1; }
        if self.data.response_code.is_none() { count += 1; }
        if self.data.metadata.is_none() { count += 1; }
        
        // Event optional fields
        if self.correlation_id.is_none() { count += 1; }
        if self.parent_event_id.is_none() { count += 1; }
        if self.processed_at.is_none() { count += 1; }
        
        count
    }
}

/// Metrics for JSON payload optimization analysis
#[derive(Debug, Clone)]
pub struct PayloadOptimizationMetrics {
    pub optimized_size_bytes: usize,
    pub full_size_bytes: usize,
    pub size_reduction_bytes: usize,
    pub size_reduction_percentage: f64,
    pub null_fields_omitted: u32,
}

impl PayloadOptimizationMetrics {
    /// Get a human-readable summary of optimization metrics
    pub fn summary(&self) -> String {
        format!(
            "Payload Optimization Summary:\n\
            - Optimized size: {} bytes\n\
            - Full size: {} bytes\n\
            - Size reduction: {} bytes ({:.1}%)\n\
            - Null fields omitted: {}",
            self.optimized_size_bytes,
            self.full_size_bytes,
            self.size_reduction_bytes,
            self.size_reduction_percentage,
            self.null_fields_omitted
        )
    }
    
    /// Check if optimization meets target thresholds
    pub fn meets_optimization_targets(&self) -> bool {
        // Target: At least 20% size reduction when fields are omitted
        if self.null_fields_omitted > 0 {
            self.size_reduction_percentage >= 20.0
        } else {
            // If no fields are omitted, optimization is not applicable
            true
        }
    }
}

// Event validation and utility implementations
#[allow(dead_code)]
impl Event {
    /// Comprehensive event validation with detailed error reporting
    pub fn validate(&self) -> Result<(), ValidationError> {
        // Field constraint validation
        self.validate_field_constraints()?;
        
        // UUID format validation
        self.validate_uuid_fields()?;
        
        // Timestamp validation
        self.validate_timestamp()?;
        
        // Event type specific business logic validation
        self.validate_business_logic()?;
        
        // Data consistency validation
        self.validate_data_consistency()?;
        
        Ok(())
    }
    
    /// Validate field constraints (length, empty fields, etc.)
    pub fn validate_field_constraints(&self) -> Result<(), ValidationError> {
        // Validate source field
        if self.source.is_empty() {
            return Err(ValidationError::EmptyField { 
                field: "source".to_string() 
            });
        }
        if self.source.len() > 100 {
            return Err(ValidationError::InvalidLength {
                field: "source".to_string(),
                current: self.source.len(),
                min: Some(1),
                max: Some(100),
            });
        }
        
        // Validate task_id field
        if self.task_id.is_empty() {
            return Err(ValidationError::EmptyField { 
                field: "task_id".to_string() 
            });
        }
        if self.task_id.len() > 100 {
            return Err(ValidationError::InvalidLength {
                field: "task_id".to_string(),
                current: self.task_id.len(),
                min: Some(1),
                max: Some(100),
            });
        }
        
        // Validate title field (1-200 chars as per task requirements)
        if self.title.is_empty() {
            return Err(ValidationError::EmptyField { 
                field: "title".to_string() 
            });
        }
        if self.title.len() > 200 {
            return Err(ValidationError::InvalidLength {
                field: "title".to_string(),
                current: self.title.len(),
                min: Some(1),
                max: Some(200),
            });
        }
        
        // Validate description field (1-2000 chars as per task requirements)
        if self.description.is_empty() {
            return Err(ValidationError::EmptyField { 
                field: "description".to_string() 
            });
        }
        if self.description.len() > 2000 {
            return Err(ValidationError::InvalidLength {
                field: "description".to_string(),
                current: self.description.len(),
                min: Some(1),
                max: Some(2000),
            });
        }
        
        Ok(())
    }
    
    /// Validate UUID fields format
    pub fn validate_uuid_fields(&self) -> Result<(), ValidationError> {
        // Validate event_id format (should be valid UUID)
        if let Err(_) = Uuid::parse_str(&self.event_id) {
            return Err(ValidationError::InvalidUuid { 
                field: "event_id".to_string() 
            });
        }
        
        // Validate correlation_id if present
        if let Some(ref correlation_id) = self.correlation_id {
            if let Err(_) = Uuid::parse_str(correlation_id) {
                return Err(ValidationError::InvalidUuid { 
                    field: "correlation_id".to_string() 
                });
            }
        }
        
        // Validate parent_event_id if present
        if let Some(ref parent_id) = self.parent_event_id {
            if let Err(_) = Uuid::parse_str(parent_id) {
                return Err(ValidationError::InvalidUuid { 
                    field: "parent_event_id".to_string() 
                });
            }
        }
        
        Ok(())
    }
    
    /// Validate timestamp constraints
    pub fn validate_timestamp(&self) -> Result<(), ValidationError> {
        let now = Utc::now();
        
        // Check if timestamp is in the future (not allowed)
        if self.timestamp > now {
            return Err(ValidationError::InvalidTimestamp {
                reason: "Timestamp cannot be in the future".to_string(),
            });
        }
        
        // Check if timestamp is too far in the past (more than 1 year)
        let one_year_ago = now - Duration::days(365);
        if self.timestamp < one_year_ago {
            return Err(ValidationError::InvalidTimestamp {
                reason: "Timestamp cannot be more than 1 year in the past".to_string(),
            });
        }
        
        // Validate processed_at if present
        if let Some(processed_at) = self.processed_at {
            if processed_at < self.timestamp {
                return Err(ValidationError::InvalidTimestamp {
                    reason: "Processed timestamp cannot be before creation timestamp".to_string(),
                });
            }
            if processed_at > now {
                return Err(ValidationError::InvalidTimestamp {
                    reason: "Processed timestamp cannot be in the future".to_string(),
                });
            }
        }
        
        Ok(())
    }
    
    /// Validate business logic for specific event types
    pub fn validate_business_logic(&self) -> Result<(), ValidationError> {
        match self.event_type {
            EventType::ApprovalRequest => {
                self.validate_approval_request_data()?;
            }
            EventType::TaskCompletion => {
                self.validate_task_completion_data()?;
            }
            EventType::ProgressUpdate => {
                self.validate_progress_update_data()?;
            }
            EventType::TestPassed | EventType::TestFailed | EventType::TestSuiteRun => {
                self.validate_test_event_data()?;
            }
            EventType::GitCommit => {
                self.validate_git_commit_data()?;
            }
            EventType::ErrorOccurred => {
                self.validate_error_event_data()?;
            }
            EventType::PerformanceAlert | EventType::SecurityAlert => {
                self.validate_alert_event_data()?;
            }
            _ => {} // Other event types don't have specific business logic requirements
        }
        
        Ok(())
    }
    
    /// Validate approval request specific data
    fn validate_approval_request_data(&self) -> Result<(), ValidationError> {
        if self.data.approval_prompt.is_none() {
            return Err(ValidationError::MissingRequiredField {
                field: "approval_prompt".to_string(),
                context: "approval request events".to_string(),
            });
        }
        
        if let Some(ref options) = self.data.options {
            if options.is_empty() {
                return Err(ValidationError::InvalidApprovalData {
                    reason: "Approval options cannot be empty".to_string(),
                });
            }
            if options.len() > 10 {
                return Err(ValidationError::InvalidApprovalData {
                    reason: "Cannot have more than 10 approval options".to_string(),
                });
            }
        } else {
            return Err(ValidationError::MissingRequiredField {
                field: "options".to_string(),
                context: "approval request events".to_string(),
            });
        }
        
        Ok(())
    }
    
    /// Validate task completion specific data
    fn validate_task_completion_data(&self) -> Result<(), ValidationError> {
        // Validate duration if present
        if let Some(ref duration_ms) = self.data.duration_ms {
            // Since duration_ms is u64, it can't be negative, so only check upper bound
            if *duration_ms > 86400000 { // 24 hours in milliseconds
                return Err(ValidationError::InvalidDuration {
                    reason: "Duration cannot exceed 24 hours".to_string(),
                });
            }
        }
        
        Ok(())
    }
    
    /// Validate progress update specific data
    fn validate_progress_update_data(&self) -> Result<(), ValidationError> {
        // Check for valid progress data in metadata
        if let Some(ref metadata) = self.data.metadata {
            if let (Some(current), Some(total)) = (metadata.get("current"), metadata.get("total")) {
                if let (Some(current_val), Some(total_val)) = (current.as_u64(), total.as_u64()) {
                    if current_val > total_val {
                        return Err(ValidationError::InvalidProgressData {
                            reason: "Current progress cannot exceed total".to_string(),
                        });
                    }
                    if total_val == 0 {
                        return Err(ValidationError::InvalidProgressData {
                            reason: "Total progress cannot be zero".to_string(),
                        });
                    }
                } else {
                    return Err(ValidationError::InvalidProgressData {
                        reason: "Progress values must be valid numbers".to_string(),
                    });
                }
            } else if let Some(percentage) = metadata.get("percentage") {
                if let Some(percentage_val) = percentage.as_f64() {
                    if percentage_val < 0.0 || percentage_val > 100.0 {
                        return Err(ValidationError::InvalidProgressData {
                            reason: "Percentage must be between 0 and 100".to_string(),
                        });
                    }
                } else {
                    return Err(ValidationError::InvalidProgressData {
                        reason: "Percentage must be a valid number".to_string(),
                    });
                }
            }
        }
        
        Ok(())
    }
    
    /// Validate test event specific data
    fn validate_test_event_data(&self) -> Result<(), ValidationError> {
        if self.data.test_count.is_none() {
            return Err(ValidationError::MissingRequiredField {
                field: "test_count".to_string(),
                context: "test events".to_string(),
            });
        }
        
        Ok(())
    }
    
    /// Validate git commit specific data
    fn validate_git_commit_data(&self) -> Result<(), ValidationError> {
        if self.data.commit_hash.is_none() {
            return Err(ValidationError::MissingRequiredField {
                field: "commit_hash".to_string(),
                context: "git commit events".to_string(),
            });
        }
        
        if self.data.commit_message.is_none() {
            return Err(ValidationError::MissingRequiredField {
                field: "commit_message".to_string(),
                context: "git commit events".to_string(),
            });
        }
        
        Ok(())
    }
    
    /// Validate error event specific data
    fn validate_error_event_data(&self) -> Result<(), ValidationError> {
        if self.data.error_message.is_none() {
            return Err(ValidationError::MissingRequiredField {
                field: "error_message".to_string(),
                context: "error events".to_string(),
            });
        }
        
        Ok(())
    }
    
    /// Validate alert event specific data
    fn validate_alert_event_data(&self) -> Result<(), ValidationError> {
        if self.data.severity.is_none() {
            return Err(ValidationError::MissingRequiredField {
                field: "severity".to_string(),
                context: "alert events".to_string(),
            });
        }
        
        Ok(())
    }
    
    /// Validate data consistency and value constraints
    pub fn validate_data_consistency(&self) -> Result<(), ValidationError> {
        // Validate severity levels
        if let Some(ref severity) = self.data.severity {
            let valid_severities = vec!["low".to_string(), "medium".to_string(), "high".to_string(), "critical".to_string()];
            if !valid_severities.contains(&severity.to_lowercase()) {
                return Err(ValidationError::InvalidValue {
                    field: "severity".to_string(),
                    value: severity.clone(),
                    allowed_values: valid_severities,
                });
            }
        }
        
        // Validate priority levels
        if let Some(ref priority) = self.data.priority {
            let valid_priorities = vec!["low".to_string(), "normal".to_string(), "high".to_string(), "urgent".to_string()];
            if !valid_priorities.contains(&priority.to_lowercase()) {
                return Err(ValidationError::InvalidValue {
                    field: "priority".to_string(),
                    value: priority.clone(),
                    allowed_values: valid_priorities,
                });
            }
        }
        
        // Validate action button styles
        if let Some(ref actions) = self.data.actions {
            for (i, action) in actions.iter().enumerate() {
                if let Some(ref style) = action.style {
                    let valid_styles = vec!["primary".to_string(), "secondary".to_string(), "danger".to_string()];
                    if !valid_styles.contains(&style.to_lowercase()) {
                        return Err(ValidationError::InvalidValue {
                            field: format!("actions[{}].style", i),
                            value: style.clone(),
                            allowed_values: valid_styles,
                        });
                    }
                }
            }
        }
        
        Ok(())
    }
    
    /// Legacy validate method for backward compatibility
    pub fn validate_legacy(&self) -> Result<(), String> {
        match self.validate() {
            Ok(()) => Ok(()),
            Err(validation_error) => Err(validation_error.message()),
        }
    }
    
    /// Check if this event is a duplicate based on event_id and timestamp
    pub fn is_duplicate_of(&self, other: &Event) -> bool {
        // Primary deduplication: exact event_id match
        if self.event_id == other.event_id {
            return true;
        }
        
        // Secondary deduplication: same content within a time window
        self.has_duplicate_content(other)
    }
    
    /// Check if two events have duplicate content (same task, type, timestamp window)
    pub fn has_duplicate_content(&self, other: &Event) -> bool {
        // Must be same event type and task
        if self.event_type != other.event_type || self.task_id != other.task_id {
            return false;
        }
        
        // Check if timestamps are within 5 seconds of each other (likely duplicate)
        let time_diff = if self.timestamp > other.timestamp {
            self.timestamp - other.timestamp
        } else {
            other.timestamp - self.timestamp
        };
        
        if time_diff > Duration::seconds(5) {
            return false;
        }
        
        // Check if title and description are similar (exact match for now)
        self.title == other.title && self.description == other.description
    }
    
    /// Generate a deduplication key for this event
    pub fn deduplication_key(&self) -> String {
        // Primary key is the event_id
        self.event_id.clone()
    }
    
    /// Generate a content-based deduplication key
    pub fn content_deduplication_key(&self) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        self.event_type.hash(&mut hasher);
        self.task_id.hash(&mut hasher);
        self.title.hash(&mut hasher);
        self.description.hash(&mut hasher);
        // Round timestamp to nearest 5 seconds for duplicate detection
        let rounded_timestamp = (self.timestamp.timestamp() / 5) * 5;
        rounded_timestamp.hash(&mut hasher);
        
        format!("content_{:x}", hasher.finish())
    }
    
    /// Validate against a list of existing events for deduplication
    pub fn validate_against_duplicates(&self, existing_events: &[Event]) -> Result<(), ValidationError> {
        for existing_event in existing_events {
            if self.is_duplicate_of(existing_event) {
                return Err(ValidationError::DuplicateEvent {
                    event_id: existing_event.event_id.clone(),
                    original_timestamp: existing_event.timestamp,
                });
            }
        }
        Ok(())
    }
    
    /// Get the event priority, defaulting to "normal" if not set
    pub fn get_priority(&self) -> String {
        self.data.priority.clone().unwrap_or_else(|| "normal".to_string())
    }
    
    /// Get the event severity, defaulting to "medium" if not set
    pub fn get_severity(&self) -> String {
        self.data.severity.clone().unwrap_or_else(|| "medium".to_string())
    }
    
    /// Check if this is a critical event (high/critical severity or urgent priority)
    pub fn is_critical(&self) -> bool {
        let severity = self.get_severity();
        let priority = self.get_priority();
        
        matches!(severity.as_str(), "high" | "critical") || priority == "urgent"
    }
    
    /// Check if this event requires user interaction
    pub fn requires_user_interaction(&self) -> bool {
        matches!(self.event_type, EventType::ApprovalRequest | EventType::UserResponse) ||
        self.data.actions.is_some()
    }
    
    /// Get a formatted summary of the event
    pub fn get_summary(&self) -> String {
        let status_emoji = match (&self.data.success, &self.event_type) {
            (Some(true), _) => "✅",
            (Some(false), _) => "❌",
            (None, EventType::TaskProgress | EventType::ProgressUpdate) => "🔄",
            (None, EventType::ApprovalRequest) => "❓",
            (None, EventType::ErrorOccurred | EventType::TaskFailed | EventType::BuildFailed | EventType::TestFailed) => "❌",
            (None, EventType::PerformanceAlert | EventType::SecurityAlert) => "⚠️",
            (None, EventType::GitCommit | EventType::GitPush) => "📝",
            (None, EventType::CodeGeneration | EventType::FileCreated | EventType::FileModified) => "📄",
            (None, EventType::BuildCompleted | EventType::TestPassed) => "✅",
            _ => "ℹ️",
        };
        
        format!("{} {}", status_emoji, self.title)
    }
    
    /// Get the event category for grouping and filtering
    pub fn get_category(&self) -> String {
        if let Some(ref category) = self.data.category {
            return category.clone();
        }
        
        match self.event_type {
            EventType::TaskCompletion | EventType::TaskStarted | EventType::TaskFailed | 
            EventType::TaskProgress | EventType::TaskCancelled => "task_management".to_string(),
            
            EventType::CodeGeneration | EventType::CodeAnalysis | EventType::CodeRefactoring | 
            EventType::CodeReview | EventType::CodeTesting | EventType::CodeDeployment => "code_operations".to_string(),
            
            EventType::FileCreated | EventType::FileModified | EventType::FileDeleted | 
            EventType::DirectoryCreated | EventType::DirectoryDeleted => "file_system".to_string(),
            
            EventType::BuildStarted | EventType::BuildCompleted | EventType::BuildFailed | 
            EventType::TestSuiteRun | EventType::TestPassed | EventType::TestFailed | 
            EventType::LintCheck | EventType::TypeCheck => "build_and_test".to_string(),
            
            EventType::GitCommit | EventType::GitPush | EventType::GitMerge | EventType::GitBranch | 
            EventType::GitTag | EventType::PullRequestCreated | EventType::PullRequestMerged => "version_control".to_string(),
            
            EventType::SystemHealth | EventType::PerformanceAlert | EventType::SecurityAlert | 
            EventType::ErrorOccurred | EventType::ResourceUsage => "system_monitoring".to_string(),
            
            EventType::ApprovalRequest | EventType::UserResponse | EventType::CommandExecuted => "user_interaction".to_string(),
            
            EventType::ProgressUpdate | EventType::StatusChange | EventType::AlertNotification | 
            EventType::InfoNotification => "notifications".to_string(),
            
            EventType::ApiCall | EventType::WebhookReceived | EventType::ServiceIntegration => "integrations".to_string(),
            
            EventType::CustomEvent => "custom".to_string(),
            EventType::Unknown => "unknown".to_string(),
        }
    }
    
    /// Convert event to JSON string
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
    
    /// Create event from JSON string
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

// ============================================================================
// TYPE-SAFE EVENT BUILDERS - SPECIALIZED EVENT CONSTRUCTION
// ============================================================================

impl TypedEvent {
    /// Create a new typed event with reliability tracking
    pub fn new(
        event_type: EventType,
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        description: impl Into<String>,
        typed_data: TypedEventData,
    ) -> Self {
        let now = Utc::now();
        Self {
            event_id: Uuid::new_v4().to_string(),
            event_type,
            source: source.into(),
            timestamp: now,
            task_id: task_id.into(),
            title: title.into(),
            description: description.into(),
            typed_data,
            correlation_id: None,
            parent_event_id: None,
            retry_count: 0,
            processing_status: ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: now,
            processed_at: None,
        }
    }

    /// Create a type-safe task completion event
    pub fn task_completion(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        duration_ms: Option<u64>,
        results: Option<String>,
        files_affected: Option<Vec<String>>,
        success: bool,
    ) -> Self {
        let data = TaskCompletionData {
            duration_ms,
            results,
            files_affected,
            exit_code: if success { Some(0) } else { Some(1) },
            success,
            error_message: None,
        };

        Self::new(
            EventType::TaskCompletion,
            source,
            task_id,
            title,
            "Task completed",
            TypedEventData::TaskCompletion(data),
        )
    }

    /// Create a type-safe approval request event
    pub fn approval_request(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        prompt: String,
        options: Vec<String>,
        priority: String,
        timeout_seconds: Option<u64>,
    ) -> Self {
        let actions: Vec<ActionButton> = options.iter().map(|opt| ActionButton {
            text: opt.clone(),
            action: format!("approve_{}", opt.to_lowercase().replace(' ', "_")),
            data: Some(opt.clone()),
            style: if opt.to_lowercase().contains("approve") || opt.to_lowercase().contains("yes") {
                Some("primary".to_string())
            } else if opt.to_lowercase().contains("reject") || opt.to_lowercase().contains("no") {
                Some("danger".to_string())
            } else {
                Some("secondary".to_string())
            },
        }).collect();

        let data = ApprovalRequestData {
            prompt,
            options,
            timeout_seconds,
            priority,
            actions,
        };

        Self::new(
            EventType::ApprovalRequest,
            source,
            task_id,
            title,
            "Approval required",
            TypedEventData::ApprovalRequest(data),
        )
    }

    /// Create a type-safe progress update event
    pub fn progress_update(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        current: u64,
        total: u64,
        message: String,
        estimated_completion: Option<DateTime<Utc>>,
    ) -> Self {
        let percentage = if total > 0 { (current as f32 / total as f32) * 100.0 } else { 0.0 };
        
        let data = ProgressUpdateData {
            current,
            total,
            message,
            percentage,
            estimated_completion,
        };

        Self::new(
            EventType::ProgressUpdate,
            source,
            task_id,
            title,
            "Progress update",
            TypedEventData::ProgressUpdate(data),
        )
    }

    /// Create a type-safe performance alert event
    pub fn performance_alert(
        source: impl Into<String>,
        task_id: impl Into<String>,
        metric: String,
        current_value: f64,
        threshold: f64,
        severity: String,
        system_info: Option<SystemMetrics>,
    ) -> Self {
        let data = PerformanceAlertData {
            metric: metric.clone(),
            current_value,
            threshold,
            severity,
            system_info,
        };

        Self::new(
            EventType::PerformanceAlert,
            source,
            task_id,
            format!("Performance Alert: {}", metric),
            format!("{} is {} (threshold: {})", metric, current_value, threshold),
            TypedEventData::PerformanceAlert(data),
        )
    }

    /// Create a type-safe code operation event
    pub fn code_operation(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        operation_type: EventType,
        file_path: Option<String>,
        language: Option<String>,
        success: bool,
    ) -> Self {
        let data = CodeOperationData {
            file_path,
            files_affected: None,
            language,
            function_name: None,
            class_name: None,
            module_name: None,
            code_snippet: None,
            line_number: None,
            success,
        };

        Self::new(
            operation_type,
            source,
            task_id,
            title,
            "Code operation completed",
            TypedEventData::CodeOperation(data),
        )
    }

    /// Create a type-safe build/test event
    pub fn build_test(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        operation_type: EventType,
        duration_ms: u64,
        success: bool,
        test_count: Option<u32>,
        tests_passed: Option<u32>,
        tests_failed: Option<u32>,
    ) -> Self {
        let data = BuildTestData {
            build_target: None,
            test_count,
            tests_passed,
            tests_failed,
            coverage_percentage: None,
            duration_ms,
            success,
            error_message: None,
        };

        Self::new(
            operation_type,
            source,
            task_id,
            title,
            "Build/test operation completed",
            TypedEventData::BuildTest(data),
        )
    }

    /// Create a type-safe git operation event
    pub fn git_operation(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        operation_type: EventType,
        commit_hash: Option<String>,
        branch_name: Option<String>,
        author: Option<String>,
        commit_message: Option<String>,
        files_changed: Option<Vec<String>>,
        git_operation_type: String,
    ) -> Self {
        let data = GitOperationData {
            commit_hash,
            branch_name,
            author,
            commit_message,
            files_changed,
            operation_type: git_operation_type,
        };

        Self::new(
            operation_type,
            source,
            task_id,
            title,
            "Git operation completed",
            TypedEventData::GitOperation(data),
        )
    }

    /// Create a type-safe system monitoring event
    pub fn system_monitoring(
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        metrics: SystemMetrics,
        alerts: Vec<String>,
        health_status: String,
    ) -> Self {
        let data = SystemMonitoringData {
            metrics,
            alerts,
            health_status,
            timestamp: Utc::now(),
        };

        Self::new(
            EventType::SystemHealth,
            source,
            task_id,
            title,
            "System monitoring update",
            TypedEventData::SystemMonitoring(data),
        )
    }

    /// Convert from legacy Event struct to TypedEvent
    pub fn from_legacy_event(event: Event) -> Self {
        let typed_data = TypedEventData::Generic(event.data.clone());
        
        Self {
            event_id: event.event_id,
            event_type: event.event_type,
            source: event.source,
            timestamp: event.timestamp,
            task_id: event.task_id,
            title: event.title,
            description: event.description,
            typed_data,
            correlation_id: event.correlation_id,
            parent_event_id: event.parent_event_id,
            retry_count: event.retry_count,
            processing_status: event.processing_status,
            schema_version: event.schema_version,
            created_at: event.created_at,
            processed_at: event.processed_at,
        }
    }

    /// Convert to legacy Event struct for backward compatibility
    pub fn to_legacy_event(&self) -> Event {
        let data = match &self.typed_data {
            TypedEventData::Generic(event_data) => event_data.clone(),
            _ => {
                // Convert specialized data to generic EventData
                // This is a simplified conversion - you might want more sophisticated mapping
                EventData::default()
            }
        };

        Event {
            event_id: self.event_id.clone(),
            event_type: self.event_type.clone(),
            source: self.source.clone(),
            timestamp: self.timestamp,
            task_id: self.task_id.clone(),
            title: self.title.clone(),
            description: self.description.clone(),
            data,
            correlation_id: self.correlation_id.clone(),
            parent_event_id: self.parent_event_id.clone(),
            retry_count: self.retry_count,
            processing_status: self.processing_status.clone(),
            schema_version: self.schema_version.clone(),
            created_at: self.created_at,
            processed_at: self.processed_at,
        }
    }

    /// Mark event as processed and set processed timestamp
    pub fn mark_processed(&mut self) {
        self.processing_status = ProcessingStatus::Delivered;
        self.processed_at = Some(Utc::now());
    }

    /// Mark event as failed and increment retry count
    pub fn mark_failed(&mut self) {
        self.processing_status = ProcessingStatus::Failed;
        self.retry_count += 1;
    }

    /// Check if event should be retried based on retry count
    pub fn should_retry(&self, max_retries: u32) -> bool {
        matches!(self.processing_status, ProcessingStatus::Failed) && self.retry_count < max_retries
    }

    /// Check if event is in a final state
    pub fn is_final_state(&self) -> bool {
        matches!(self.processing_status, 
            ProcessingStatus::Delivered | 
            ProcessingStatus::Abandoned | 
            ProcessingStatus::Duplicate
        )
    }

    /// Convert to JSON string
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Create from JSON string
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

#[allow(dead_code)]
impl EventType {
    /// Get all available event types
    pub fn all() -> Vec<EventType> {
        vec![
            // Task Management Events
            EventType::TaskCompletion,
            EventType::TaskStarted,
            EventType::TaskFailed,
            EventType::TaskProgress,
            EventType::TaskCancelled,
            
            // Code Operation Events
            EventType::CodeGeneration,
            EventType::CodeAnalysis,
            EventType::CodeRefactoring,
            EventType::CodeReview,
            EventType::CodeTesting,
            EventType::CodeDeployment,
            
            // File System Events
            EventType::FileCreated,
            EventType::FileModified,
            EventType::FileDeleted,
            EventType::DirectoryCreated,
            EventType::DirectoryDeleted,
            
            // Build & Development Events
            EventType::BuildStarted,
            EventType::BuildCompleted,
            EventType::BuildFailed,
            EventType::TestSuiteRun,
            EventType::TestPassed,
            EventType::TestFailed,
            EventType::LintCheck,
            EventType::TypeCheck,
            
            // Git & Version Control Events
            EventType::GitCommit,
            EventType::GitPush,
            EventType::GitMerge,
            EventType::GitBranch,
            EventType::GitTag,
            EventType::PullRequestCreated,
            EventType::PullRequestMerged,
            
            // System & Monitoring Events
            EventType::SystemHealth,
            EventType::PerformanceAlert,
            EventType::SecurityAlert,
            EventType::ErrorOccurred,
            EventType::ResourceUsage,
            
            // User Interaction Events
            EventType::ApprovalRequest,
            EventType::UserResponse,
            EventType::CommandExecuted,
            
            // Notification Events
            EventType::ProgressUpdate,
            EventType::StatusChange,
            EventType::AlertNotification,
            EventType::InfoNotification,
            
            // Integration Events
            EventType::ApiCall,
            EventType::WebhookReceived,
            EventType::ServiceIntegration,
            
            // Custom Events
            EventType::CustomEvent,
        ]
    }
    
    /// Get the display name for the event type
    pub fn display_name(&self) -> &'static str {
        match self {
            EventType::TaskCompletion => "Task Completed",
            EventType::TaskStarted => "Task Started",
            EventType::TaskFailed => "Task Failed",
            EventType::TaskProgress => "Task Progress",
            EventType::TaskCancelled => "Task Cancelled",
            EventType::CodeGeneration => "Code Generated",
            EventType::CodeAnalysis => "Code Analysis",
            EventType::CodeRefactoring => "Code Refactoring",
            EventType::CodeReview => "Code Review",
            EventType::CodeTesting => "Code Testing",
            EventType::CodeDeployment => "Code Deployment",
            EventType::FileCreated => "File Created",
            EventType::FileModified => "File Modified",
            EventType::FileDeleted => "File Deleted",
            EventType::DirectoryCreated => "Directory Created",
            EventType::DirectoryDeleted => "Directory Deleted",
            EventType::BuildStarted => "Build Started",
            EventType::BuildCompleted => "Build Completed",
            EventType::BuildFailed => "Build Failed",
            EventType::TestSuiteRun => "Test Suite Run",
            EventType::TestPassed => "Tests Passed",
            EventType::TestFailed => "Tests Failed",
            EventType::LintCheck => "Lint Check",
            EventType::TypeCheck => "Type Check",
            EventType::GitCommit => "Git Commit",
            EventType::GitPush => "Git Push",
            EventType::GitMerge => "Git Merge",
            EventType::GitBranch => "Git Branch",
            EventType::GitTag => "Git Tag",
            EventType::PullRequestCreated => "Pull Request Created",
            EventType::PullRequestMerged => "Pull Request Merged",
            EventType::SystemHealth => "System Health",
            EventType::PerformanceAlert => "Performance Alert",
            EventType::SecurityAlert => "Security Alert",
            EventType::ErrorOccurred => "Error Occurred",
            EventType::ResourceUsage => "Resource Usage",
            EventType::ApprovalRequest => "Approval Request",
            EventType::UserResponse => "User Response",
            EventType::CommandExecuted => "Command Executed",
            EventType::ProgressUpdate => "Progress Update",
            EventType::StatusChange => "Status Change",
            EventType::AlertNotification => "Alert Notification",
            EventType::InfoNotification => "Info Notification",
            EventType::ApiCall => "API Call",
            EventType::WebhookReceived => "Webhook Received",
            EventType::ServiceIntegration => "Service Integration",
            EventType::CustomEvent => "Custom Event",
            EventType::Unknown => "Unknown Event",
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn test_event_creation() {
        let event = Event::new(
            EventType::TaskCompletion,
            "claude-code",
            "task-123",
            "Test Task",
            "A test task has been completed",
        );

        assert_eq!(event.event_type, EventType::TaskCompletion);
        assert_eq!(event.source, "claude-code");
        assert_eq!(event.task_id, "task-123");
        assert_eq!(event.title, "Test Task");
        assert_eq!(event.description, "A test task has been completed");
    }

    #[test]
    fn test_task_completed_builder() {
        let event = Event::task_completed(
            "claude-code",
            "task-123",
            "Deploy Application",
            Some("Successfully deployed to production".to_string()),
        );

        assert_eq!(event.event_type, EventType::TaskCompletion);
        assert_eq!(event.data.status, Some("completed".to_string()));
        assert_eq!(event.data.success, Some(true));
        assert_eq!(event.data.results, Some("Successfully deployed to production".to_string()));
    }

    #[test]
    fn test_task_failed_builder() {
        let event = Event::task_failed(
            "claude-code",
            "task-456",
            "Build Project",
            "Compilation failed due to syntax errors".to_string(),
        );

        assert_eq!(event.event_type, EventType::TaskFailed);
        assert_eq!(event.data.status, Some("failed".to_string()));
        assert_eq!(event.data.success, Some(false));
        assert_eq!(event.data.error_message, Some("Compilation failed due to syntax errors".to_string()));
        assert_eq!(event.data.severity, Some("high".to_string()));
    }

    #[test]
    fn test_code_generated_builder() {
        let event = Event::code_generated(
            "claude-code",
            "task-789",
            "src/main.rs".to_string(),
            "rust".to_string(),
        );

        assert_eq!(event.event_type, EventType::CodeGeneration);
        assert_eq!(event.data.file_path, Some("src/main.rs".to_string()));
        assert_eq!(event.data.language, Some("rust".to_string()));
        assert_eq!(event.data.status, Some("generated".to_string()));
        assert_eq!(event.data.success, Some(true));
    }

    #[test]
    fn test_build_completed_builder() {
        let event = Event::build_completed(
            "cargo",
            "build-001",
            "release".to_string(),
            5000,
            true,
        );

        assert_eq!(event.event_type, EventType::BuildCompleted);
        assert_eq!(event.data.build_target, Some("release".to_string()));
        assert_eq!(event.data.duration_ms, Some(5000));
        assert_eq!(event.data.success, Some(true));
        assert_eq!(event.data.status, Some("completed".to_string()));
    }

    #[test]
    fn test_build_failed_builder() {
        let event = Event::build_completed(
            "cargo",
            "build-002",
            "debug".to_string(),
            2500,
            false,
        );

        assert_eq!(event.event_type, EventType::BuildFailed);
        assert_eq!(event.data.build_target, Some("debug".to_string()));
        assert_eq!(event.data.duration_ms, Some(2500));
        assert_eq!(event.data.success, Some(false));
        assert_eq!(event.data.status, Some("failed".to_string()));
    }

    #[test]
    fn test_test_results_builder() {
        let event = Event::test_results(
            "cargo-test",
            "test-run-001",
            50,
            48,
            2,
            10000,
        );

        assert_eq!(event.event_type, EventType::TestFailed);
        assert_eq!(event.data.test_count, Some(50));
        assert_eq!(event.data.tests_passed, Some(48));
        assert_eq!(event.data.tests_failed, Some(2));
        assert_eq!(event.data.duration_ms, Some(10000));
        assert_eq!(event.data.success, Some(false));
        assert_eq!(event.title, "Tests: 48/50 passed");
    }

    #[test]
    fn test_git_commit_builder() {
        let event = Event::git_commit(
            "git",
            "commit-001",
            "a1b2c3d4e5f6".to_string(),
            "Fix critical bug in authentication".to_string(),
            "John Doe".to_string(),
            vec!["src/auth.rs".to_string(), "tests/auth_test.rs".to_string()],
        );

        assert_eq!(event.event_type, EventType::GitCommit);
        assert_eq!(event.data.commit_hash, Some("a1b2c3d4e5f6".to_string()));
        assert_eq!(event.data.commit_message, Some("Fix critical bug in authentication".to_string()));
        assert_eq!(event.data.author, Some("John Doe".to_string()));
        assert_eq!(event.data.files_changed, Some(vec!["src/auth.rs".to_string(), "tests/auth_test.rs".to_string()]));
        assert_eq!(event.title, "Git commit: a1b2c3d4");
    }

    #[test]
    fn test_performance_alert_builder() {
        let event = Event::performance_alert(
            "monitoring",
            "alert-001",
            "Memory Usage".to_string(),
            85.5,
            80.0,
        );

        assert_eq!(event.event_type, EventType::PerformanceAlert);
        assert_eq!(event.data.severity, Some("high".to_string()));
        assert_eq!(event.data.priority, Some("high".to_string()));
        assert_eq!(event.data.category, Some("performance".to_string()));
        assert!(event.data.metadata.is_some());
    }

    #[test]
    fn test_approval_request_builder() {
        let event = Event::approval_request(
            "claude-code",
            "approval-001",
            "Deploy to Production",
            "Deploy version 2.1.0 to production environment?".to_string(),
            vec!["Approve".to_string(), "Reject".to_string(), "Defer".to_string()],
        );

        assert_eq!(event.event_type, EventType::ApprovalRequest);
        assert_eq!(event.data.approval_prompt, Some("Deploy version 2.1.0 to production environment?".to_string()));
        assert_eq!(event.data.options, Some(vec!["Approve".to_string(), "Reject".to_string(), "Defer".to_string()]));
        assert_eq!(event.data.priority, Some("high".to_string()));
        assert_eq!(event.data.category, Some("user_interaction".to_string()));
        
        let actions = event.data.actions.as_ref().unwrap();
        assert_eq!(actions.len(), 3);
        assert_eq!(actions[0].text, "Approve");
        assert_eq!(actions[0].style, Some("primary".to_string()));
        assert_eq!(actions[1].text, "Reject");
        assert_eq!(actions[1].style, Some("danger".to_string()));
    }

    #[test]
    fn test_event_validation() {
        // Valid event
        let valid_event = Event::new(
            EventType::TaskCompletion,
            "claude-code",
            "task-123",
            "Test Task",
            "Description",
        );
        assert!(valid_event.validate().is_ok());

        // Invalid event - empty source
        let invalid_event = Event::new(
            EventType::TaskCompletion,
            "",
            "task-123",
            "Test Task",
            "Description",
        );
        assert!(invalid_event.validate().is_err());

        // Invalid event - empty task_id
        let invalid_event = Event::new(
            EventType::TaskCompletion,
            "claude-code",
            "",
            "Test Task",
            "Description",
        );
        assert!(invalid_event.validate().is_err());

        // Invalid event - empty title
        let invalid_event = Event::new(
            EventType::TaskCompletion,
            "claude-code",
            "task-123",
            "",
            "Description",
        );
        assert!(invalid_event.validate().is_err());
    }

    #[test]
    fn test_approval_request_validation() {
        // Valid approval request
        let valid_approval = Event::approval_request(
            "claude-code",
            "approval-001",
            "Test Approval",
            "Do you approve?".to_string(),
            vec!["Yes".to_string(), "No".to_string()],
        );
        assert!(valid_approval.validate().is_ok());

        // Invalid approval request - missing prompt
        let mut invalid_approval = valid_approval.clone();
        invalid_approval.data.approval_prompt = None;
        assert!(invalid_approval.validate().is_err());

        // Invalid approval request - empty options
        let mut invalid_approval = valid_approval.clone();
        invalid_approval.data.options = Some(vec![]);
        assert!(invalid_approval.validate().is_err());
    }

    #[test]
    fn test_severity_validation() {
        let mut event = Event::new(
            EventType::ErrorOccurred,
            "test",
            "error-001",
            "Test Error",
            "Test error description",
        );
        event.data.error_message = Some("Test error message".to_string());

        // Valid severities
        for severity in &["low", "medium", "high", "critical"] {
            event.data.severity = Some(severity.to_string());
            assert!(event.validate().is_ok());
        }

        // Invalid severity
        event.data.severity = Some("invalid".to_string());
        assert!(event.validate().is_err());
    }

    #[test]
    fn test_priority_validation() {
        let mut event = Event::new(
            EventType::InfoNotification,
            "test",
            "info-001",
            "Test Info",
            "Test info description",
        );

        // Valid priorities
        for priority in &["low", "normal", "high", "urgent"] {
            event.data.priority = Some(priority.to_string());
            assert!(event.validate().is_ok());
        }

        // Invalid priority
        event.data.priority = Some("invalid".to_string());
        assert!(event.validate().is_err());
    }

    #[test]
    fn test_event_utility_methods() {
        let event = Event::performance_alert(
            "monitoring",
            "alert-001",
            "CPU Usage".to_string(),
            95.0,
            80.0,
        );

        assert_eq!(event.get_priority(), "high");
        assert_eq!(event.get_severity(), "high");
        assert!(event.is_critical());
        assert!(!event.requires_user_interaction());
        assert_eq!(event.get_category(), "performance");
        assert!(event.get_summary().contains("⚠️"));
    }

    #[test]
    fn test_user_interaction_detection() {
        let approval_event = Event::approval_request(
            "claude-code",
            "approval-001",
            "Test Approval",
            "Approve deployment?".to_string(),
            vec!["Yes".to_string(), "No".to_string()],
        );
        assert!(approval_event.requires_user_interaction());

        let task_event = Event::task_completed(
            "claude-code",
            "task-001",
            "Test Task",
            None,
        );
        assert!(!task_event.requires_user_interaction());
    }

    #[test]
    fn test_event_serialization() {
        let event = Event::code_generated(
            "claude-code",
            "gen-001",
            "src/lib.rs".to_string(),
            "rust".to_string(),
        );

        // Test JSON serialization
        let json = event.to_json().unwrap();
        assert!(json.contains("\"type\": \"code_generation\""));
        assert!(json.contains("\"file_path\": \"src/lib.rs\""));
        assert!(json.contains("\"language\": \"rust\""));

        // Test JSON deserialization
        let deserialized_event = Event::from_json(&json).unwrap();
        assert_eq!(deserialized_event.event_type, EventType::CodeGeneration);
        assert_eq!(deserialized_event.data.file_path, Some("src/lib.rs".to_string()));
        assert_eq!(deserialized_event.data.language, Some("rust".to_string()));
    }

    #[test]
    fn test_event_summary_formatting() {
        let success_event = Event::task_completed(
            "claude-code",
            "task-001",
            "Build Success",
            Some("Built successfully".to_string()),
        );
        assert!(success_event.get_summary().starts_with("✅"));

        let failed_event = Event::task_failed(
            "claude-code",
            "task-002",
            "Build Failed",
            "Compilation error".to_string(),
        );
        assert!(failed_event.get_summary().starts_with("❌"));

        let progress_event = Event::task_progress(
            "claude-code",
            "task-003",
            "Building",
            "50% complete".to_string(),
        );
        assert!(progress_event.get_summary().starts_with("🔄"));

        let approval_event = Event::approval_request(
            "claude-code",
            "approval-001",
            "Need Approval",
            "Approve action?".to_string(),
            vec!["Yes".to_string(), "No".to_string()],
        );
        assert!(approval_event.get_summary().starts_with("❓"));
    }

    #[test]
    fn test_event_type_utilities() {
        let all_types = EventType::all();
        assert!(all_types.len() > 30); // Should have many event types
        assert!(all_types.contains(&EventType::TaskCompletion));
        assert!(all_types.contains(&EventType::CodeGeneration));
        assert!(all_types.contains(&EventType::GitCommit));

        assert_eq!(EventType::TaskCompletion.display_name(), "Task Completed");
        assert_eq!(EventType::CodeGeneration.display_name(), "Code Generated");
        assert_eq!(EventType::PerformanceAlert.display_name(), "Performance Alert");
    }

    #[test]
    fn test_event_categories() {
        let task_event = Event::task_completed("test", "task-001", "Test", None);
        assert_eq!(task_event.get_category(), "task_management");

        let code_event = Event::code_generated("test", "gen-001", "file.rs".to_string(), "rust".to_string());
        assert_eq!(code_event.get_category(), "code_operations");

        let git_event = Event::git_commit("test", "commit-001", "abc123".to_string(), "message".to_string(), "author".to_string(), vec![]);
        assert_eq!(git_event.get_category(), "version_control");

        let system_event = Event::performance_alert("test", "alert-001", "CPU".to_string(), 90.0, 80.0);
        assert_eq!(system_event.get_category(), "performance");
    }

    #[test]
    fn test_action_button_creation() {
        let button = ActionButton {
            text: "Approve".to_string(),
            action: "approve_deploy".to_string(),
            data: Some("deploy-v2.1.0".to_string()),
            style: Some("primary".to_string()),
        };

        assert_eq!(button.text, "Approve");
        assert_eq!(button.action, "approve_deploy");
        assert_eq!(button.data, Some("deploy-v2.1.0".to_string()));
        assert_eq!(button.style, Some("primary".to_string()));
    }

    #[test]
    fn test_event_data_default() {
        let data = EventData::default();
        assert!(data.status.is_none());
        assert!(data.results.is_none());
        assert!(data.success.is_none());
        assert!(data.file_path.is_none());
        assert!(data.metadata.is_none());
    }

    #[test]
    fn test_response_event() {
        let response = ResponseEvent {
            event_id: "event-123".to_string(),
            user_id: "user-456".to_string(),
            timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap(),
            response: "approved".to_string(),
            metadata: None,
        };

        assert_eq!(response.event_id, "event-123");
        assert_eq!(response.user_id, "user-456");
        assert_eq!(response.response, "approved");
    }

    // ============================================================================
    // COMPREHENSIVE ROUND-TRIP SERIALIZATION TESTS
    // ============================================================================

    #[test]
    fn test_event_type_round_trip_serialization() {
        let all_types = EventType::all();
        
        for event_type in &all_types {
            // Test serialization to JSON
            let json = serde_json::to_string(event_type).unwrap();
            
            // Test deserialization from JSON
            let deserialized: EventType = serde_json::from_str(&json).unwrap();
            
            // Verify round-trip consistency
            assert_eq!(*event_type, deserialized, "Round-trip failed for event type: {:?}", event_type);
        }
    }

    #[test]
    fn test_processing_status_round_trip_serialization() {
        let all_statuses = vec![
            ProcessingStatus::Pending,
            ProcessingStatus::Processing,
            ProcessingStatus::Delivered,
            ProcessingStatus::Failed,
            ProcessingStatus::Retrying,
            ProcessingStatus::Abandoned,
            ProcessingStatus::Duplicate,
            ProcessingStatus::Unknown,
        ];
        
        for status in &all_statuses {
            // Test serialization to JSON
            let json = serde_json::to_string(status).unwrap();
            
            // Test deserialization from JSON
            let deserialized: ProcessingStatus = serde_json::from_str(&json).unwrap();
            
            // Verify round-trip consistency
            assert_eq!(*status, deserialized, "Round-trip failed for processing status: {:?}", status);
        }
    }

    #[test]
    fn test_event_round_trip_serialization() {
        let event = Event::task_completed(
            "claude-code",
            "task-123",
            "Test Task Completion",
            Some("Task completed successfully with all tests passing".to_string()),
        );

        // Test serialization to JSON
        let json = event.to_json().unwrap();
        
        // Verify JSON contains expected snake_case fields
        assert!(json.contains("\"type\""));
        assert!(json.contains("\"task_completion\""));
        assert!(json.contains("\"processing_status\""));
        assert!(json.contains("\"created_at\""));
        
        // Test deserialization from JSON
        let deserialized = Event::from_json(&json).unwrap();
        
        // Verify critical fields match
        assert_eq!(event.event_type, deserialized.event_type);
        assert_eq!(event.source, deserialized.source);
        assert_eq!(event.task_id, deserialized.task_id);
        assert_eq!(event.title, deserialized.title);
        assert_eq!(event.description, deserialized.description);
        assert_eq!(event.processing_status, deserialized.processing_status);
        assert_eq!(event.data.status, deserialized.data.status);
        assert_eq!(event.data.success, deserialized.data.success);
        assert_eq!(event.data.results, deserialized.data.results);
    }

    #[test]
    fn test_specialized_event_data_round_trip() {
        // Test TaskCompletionData
        let task_data = TaskCompletionData {
            duration_ms: Some(5000),
            results: Some("Completed successfully".to_string()),
            files_affected: Some(vec!["src/main.rs".to_string(), "tests/test.rs".to_string()]),
            exit_code: Some(0),
            success: true,
            error_message: None,
        };
        
        let json = serde_json::to_string(&task_data).unwrap();
        let deserialized: TaskCompletionData = serde_json::from_str(&json).unwrap();
        
        assert_eq!(task_data.duration_ms, deserialized.duration_ms);
        assert_eq!(task_data.results, deserialized.results);
        assert_eq!(task_data.files_affected, deserialized.files_affected);
        assert_eq!(task_data.success, deserialized.success);

        // Test ApprovalRequestData
        let approval_data = ApprovalRequestData {
            prompt: "Deploy to production?".to_string(),
            options: vec!["Approve".to_string(), "Reject".to_string()],
            timeout_seconds: Some(300),
            priority: "high".to_string(),
            actions: vec![ActionButton {
                text: "Approve".to_string(),
                action: "approve_deploy".to_string(),
                data: Some("prod-deploy".to_string()),
                style: Some("primary".to_string()),
            }],
        };
        
        let json = serde_json::to_string(&approval_data).unwrap();
        let deserialized: ApprovalRequestData = serde_json::from_str(&json).unwrap();
        
        assert_eq!(approval_data.prompt, deserialized.prompt);
        assert_eq!(approval_data.options, deserialized.options);
        assert_eq!(approval_data.priority, deserialized.priority);
        assert_eq!(approval_data.actions.len(), deserialized.actions.len());

        // Test ProgressUpdateData
        let progress_data = ProgressUpdateData {
            current: 75,
            total: 100,
            message: "Processing files...".to_string(),
            percentage: 75.0,
            estimated_completion: Some(Utc::now()),
        };
        
        let json = serde_json::to_string(&progress_data).unwrap();
        let deserialized: ProgressUpdateData = serde_json::from_str(&json).unwrap();
        
        assert_eq!(progress_data.current, deserialized.current);
        assert_eq!(progress_data.total, deserialized.total);
        assert_eq!(progress_data.message, deserialized.message);
        assert_eq!(progress_data.percentage, deserialized.percentage);
    }

    #[test]
    fn test_typed_event_round_trip_serialization() {
        let typed_event = TypedEvent::task_completion(
            "claude-code",
            "task-456",
            "Build Project",
            Some(10000),
            Some("Build completed successfully".to_string()),
            Some(vec!["target/release/app".to_string()]),
            true,
        );

        // Test serialization to JSON
        let json = typed_event.to_json().unwrap();
        
        // Verify JSON structure
        assert!(json.contains("\"type\""));
        assert!(json.contains("\"task_completion\""));
        assert!(json.contains("\"duration_ms\""));
        
        // Test deserialization from JSON
        let deserialized = TypedEvent::from_json(&json).unwrap();
        
        // Verify critical fields match
        assert_eq!(typed_event.event_type, deserialized.event_type);
        assert_eq!(typed_event.source, deserialized.source);
        assert_eq!(typed_event.task_id, deserialized.task_id);
        assert_eq!(typed_event.title, deserialized.title);
        assert_eq!(typed_event.processing_status, deserialized.processing_status);
    }

    #[test]
    fn test_unknown_event_type_forward_compatibility() {
        // Test unknown event type handling - deserialize just the event type string
        let unknown_json = r#""future_event_type_v2""#;
        let result: Result<EventType, _> = serde_json::from_str(unknown_json);
        
        // Should deserialize to Unknown variant without error
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), EventType::Unknown);
    }

    #[test]
    fn test_unknown_processing_status_forward_compatibility() {
        // Test unknown processing status handling
        let unknown_json = r#""future_processing_status""#;
        let result: Result<ProcessingStatus, _> = serde_json::from_str(unknown_json);
        
        // Should deserialize to Unknown variant without error
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), ProcessingStatus::Unknown);
    }

    #[test]
    fn test_payload_size_optimization() {
        // Create event with many optional fields as None
        let mut event = Event::new(
            EventType::TaskCompletion,
            "claude-code",
            "task-optimization-test",
            "Payload Size Test",
            "Testing JSON payload optimization",
        );
        
        // Set only required fields, leave optionals as None
        event.data.status = Some("completed".to_string());
        event.data.success = Some(true);
        // All other optional fields remain None
        
        let json = event.to_json().unwrap();
        
        // Verify that None fields are not serialized (should not appear in JSON)
        assert!(!json.contains("\"file_path\""));
        assert!(!json.contains("\"files_affected\""));
        assert!(!json.contains("\"error_message\""));
        assert!(!json.contains("\"build_target\""));
        assert!(!json.contains("\"metadata\""));
        
        // But required fields should be present
        assert!(json.contains("\"status\""));
        assert!(json.contains("\"success\""));
        assert!(json.contains("\"type\""));
        assert!(json.contains("\"processing_status\""));
        
        // Measure approximate size reduction with all fields populated
        let full_event_data = EventData {
            status: Some("completed".to_string()),
            results: Some("sample results".to_string()),
            exit_code: Some(0),
            success: Some(true),
            file_path: Some("sample/path.rs".to_string()),
            files_affected: Some(vec!["file1.rs".to_string(), "file2.rs".to_string()]),
            directory: Some("sample/dir".to_string()),
            line_number: Some(42),
            language: Some("rust".to_string()),
            function_name: Some("sample_function".to_string()),
            class_name: Some("SampleClass".to_string()),
            module_name: Some("sample_module".to_string()),
            code_snippet: Some("fn sample() {}".to_string()),
            commit_hash: Some("abc123def456".to_string()),
            branch_name: Some("main".to_string()),
            author: Some("Sample Author".to_string()),
            commit_message: Some("Sample commit message".to_string()),
            files_changed: Some(vec!["changed1.rs".to_string(), "changed2.rs".to_string()]),
            build_target: Some("release".to_string()),
            test_count: Some(100),
            tests_passed: Some(95),
            tests_failed: Some(5),
            coverage_percentage: Some(85.5),
            duration_ms: Some(5000),
            memory_usage_mb: Some(512.0),
            cpu_usage_percent: Some(75.0),
            disk_usage_mb: Some(1024.0),
            network_bytes: Some(2048),
            error_message: Some("Sample error message".to_string()),
            error_code: Some("E001".to_string()),
            stack_trace: Some("Stack trace here".to_string()),
            severity: Some("high".to_string()),
            approval_prompt: Some("Approve deployment?".to_string()),
            options: Some(vec!["Approve".to_string(), "Reject".to_string()]),
            user_id: Some("user123".to_string()),
            command: Some("deploy".to_string()),
            arguments: Some(vec!["--env".to_string(), "prod".to_string()]),
            priority: Some("high".to_string()),
            category: Some("deployment".to_string()),
            tags: Some(vec!["critical".to_string(), "production".to_string()]),
            url: Some("https://example.com".to_string()),
            actions: Some(vec![
                ActionButton {
                    text: "Approve".to_string(),
                    action: "approve".to_string(),
                    data: Some("deployment-123".to_string()),
                    style: Some("primary".to_string()),
                }
            ]),
            service_name: Some("api-service".to_string()),
            endpoint: Some("/api/v1/deploy".to_string()),
            request_id: Some("req-456".to_string()),
            response_code: Some(200),
            metadata: Some({
                let mut map = HashMap::new();
                map.insert("key1".to_string(), serde_json::Value::String("value1".to_string()));
                map.insert("key2".to_string(), serde_json::Value::Number(serde_json::Number::from(42)));
                map
            }),
        };
        
        let mut full_event = event.clone();
        full_event.data = full_event_data;
        let full_json = full_event.to_json().unwrap();
        
        // Optimized JSON should be significantly smaller
        let size_reduction = ((full_json.len() - json.len()) as f64 / full_json.len() as f64) * 100.0;
        assert!(size_reduction > 20.0, "Expected at least 20% size reduction, got {:.1}%", size_reduction);
    }

    #[test]
    fn test_snake_case_field_naming_consistency() {
        let event = Event::new(
            EventType::TaskCompletion,
            "claude-code",
            "task-123",
            "Snake Case Test",
            "Testing snake_case field naming",
        );

        let json = event.to_json().unwrap();
        
        // Verify snake_case naming is applied
        assert!(json.contains("\"type\""));
        assert!(json.contains("\"task_id\""));
        assert!(json.contains("\"processing_status\""));
        assert!(json.contains("\"created_at\""));
        assert!(json.contains("\"retry_count\""));
        assert!(json.contains("\"schema_version\""));
        
        // These fields are None by default and get omitted due to skip_serializing_if
        assert!(!json.contains("\"processed_at\""));
        assert!(!json.contains("\"correlation_id\""));
        assert!(!json.contains("\"parent_event_id\""));
        
        // Verify camelCase is NOT used
        assert!(!json.contains("\"eventType\""));
        assert!(!json.contains("\"taskId\""));
        assert!(!json.contains("\"processingStatus\""));
        assert!(!json.contains("\"createdAt\""));
        assert!(!json.contains("\"processedAt\""));
    }

    #[test]
    fn test_deserialization_error_handling() {
        // Test invalid JSON
        let invalid_json = r#"{"invalid": "json", "missing_required_fields": true"#;
        let result = Event::from_json(invalid_json);
        assert!(result.is_err());
        
        // Test JSON with missing required fields
        let incomplete_json = r#"{"event_type": "task_completion"}"#;
        let result = Event::from_json(incomplete_json);
        assert!(result.is_err());
        
        // Test JSON with invalid enum values (should use Unknown fallback)
        let future_compatible_json = r#"{
            "event_id": "test-123",
            "type": "future_event_type",
            "source": "test",
            "timestamp": "2024-01-01T12:00:00Z",
            "task_id": "task-123",
            "title": "Test",
            "description": "Test description",
            "data": {},
            "processing_status": "future_status",
            "retry_count": 0,
            "schema_version": "1.0",
            "created_at": "2024-01-01T12:00:00Z"
        }"#;
        
        let result = Event::from_json(future_compatible_json);
        assert!(result.is_ok());
        let event = result.unwrap();
        assert_eq!(event.event_type, EventType::Unknown);
        assert_eq!(event.processing_status, ProcessingStatus::Unknown);
    }

    // ============================================================================
    // SERIALIZATION VALIDATION AND ERROR HANDLING TESTS
    // ============================================================================

    #[test]
    fn test_serialization_validation() {
        let event = Event::task_completed(
            "claude-code",
            "task-validation-test",
            "Serialization Validation Test",
            Some("Testing serialization validation methods".to_string()),
        );

        // Test successful validation
        let validation_result = event.validate_serialization();
        assert!(validation_result.is_ok(), "Serialization validation should pass: {:?}", validation_result);
    }

    #[test]
    fn test_json_schema_validation() {
        // Test valid JSON schema
        let valid_event = Event::task_completed(
            "claude-code",
            "schema-test",
            "Schema Test",
            Some("Testing schema validation".to_string()),
        );
        let valid_json = valid_event.to_json().unwrap();
        
        let schema_result = Event::validate_json_schema(&valid_json);
        assert!(schema_result.is_ok(), "Valid JSON should pass schema validation: {:?}", schema_result);

        // Test invalid JSON schema - missing required fields
        let invalid_json = r#"{"event_type": "task_completion"}"#;
        let schema_result = Event::validate_json_schema(invalid_json);
        assert!(schema_result.is_err(), "Invalid JSON should fail schema validation");
        
        let errors = schema_result.unwrap_err();
        assert!(errors.len() > 0, "Should have validation errors");
        assert!(errors.iter().any(|e| e.contains("Missing required field")), "Should detect missing required fields");

        // Test invalid JSON syntax
        let malformed_json = r#"{"invalid": "json", missing_quote: true"#;
        let schema_result = Event::validate_json_schema(malformed_json);
        assert!(schema_result.is_err(), "Malformed JSON should fail schema validation");
        
        let errors = schema_result.unwrap_err();
        assert!(errors.iter().any(|e| e.contains("Invalid JSON syntax")), "Should detect JSON syntax errors");
    }

    #[test]
    fn test_deserialization_error_context() {
        let invalid_json = r#"{
            "event_id": "invalid-uuid",
            "type": "task_completion",
            "missing_field": true
        }"#;
        
        let result = Event::from_json(invalid_json);
        assert!(result.is_err(), "Invalid JSON should fail deserialization");
        
        let error = result.unwrap_err();
        let context = Event::get_deserialization_error_context(invalid_json, &error);
        
        assert!(context.contains("JSON deserialization error"), "Should provide error context");
        assert!(context.contains("Common solutions"), "Should provide solution suggestions");
        assert!(context.contains("missing required fields"), "Should mention missing fields");
    }

    #[test]
    fn test_payload_optimization_metrics() {
        // Create event with minimal optional fields
        let minimal_event = Event::new(
            EventType::TaskCompletion,
            "claude-code",
            "optimization-test",
            "Payload Optimization Test",
            "Testing payload optimization metrics",
        );

        let metrics = minimal_event.calculate_payload_optimization_metrics();
        
        // Should have significant optimization due to many None fields
        assert!(metrics.null_fields_omitted > 40, "Should omit many null fields");
        assert!(metrics.size_reduction_percentage > 20.0, "Should achieve >20% size reduction");
        assert!(metrics.meets_optimization_targets(), "Should meet optimization targets");
        
        // Test metrics summary
        let summary = metrics.summary();
        assert!(summary.contains("Payload Optimization Summary"), "Should provide summary");
        assert!(summary.contains("Size reduction"), "Should show size reduction");
        assert!(summary.contains("Null fields omitted"), "Should show omitted fields");

        // Create event with many populated fields
        let mut populated_event = minimal_event.clone();
        populated_event.data.status = Some("completed".to_string());
        populated_event.data.results = Some("Test results".to_string());
        populated_event.data.success = Some(true);
        populated_event.data.file_path = Some("test.rs".to_string());
        populated_event.data.language = Some("rust".to_string());
        populated_event.correlation_id = Some("correlation-123".to_string());
        populated_event.parent_event_id = Some("parent-456".to_string());

        let populated_metrics = populated_event.calculate_payload_optimization_metrics();
        
        // Should have less optimization due to fewer None fields
        assert!(populated_metrics.null_fields_omitted < metrics.null_fields_omitted, 
               "Populated event should omit fewer fields");
        assert!(populated_metrics.size_reduction_percentage < metrics.size_reduction_percentage,
               "Populated event should have less size reduction");
    }

    #[test]
    fn test_serialization_validation_comprehensive() {
        // Test all major event types for serialization compliance
        let test_events = vec![
            Event::task_completed("test", "task-1", "Task Test", Some("results".to_string())),
            Event::task_failed("test", "task-2", "Failed Test", "error message".to_string()),
            Event::code_generated("test", "gen-1", "file.rs".to_string(), "rust".to_string()),
            Event::build_completed("test", "build-1", "release".to_string(), 5000, true),
            Event::approval_request("test", "approval-1", "Approval Test", 
                                   "Approve?".to_string(), vec!["Yes".to_string(), "No".to_string()]),
            Event::performance_alert("test", "alert-1", "CPU".to_string(), 90.0, 80.0),
            Event::git_commit("test", "commit-1", "abc123".to_string(), "message".to_string(), 
                             "author".to_string(), vec!["file.rs".to_string()]),
        ];

        for event in &test_events {
            // Each event should pass serialization validation
            let validation_result = event.validate_serialization();
            assert!(validation_result.is_ok(), 
                   "Event {:?} failed serialization validation: {:?}", 
                   event.event_type, validation_result);

            // Each event should have valid JSON
            let json = event.to_json().unwrap();
            let schema_result = Event::validate_json_schema(&json);
            assert!(schema_result.is_ok(), 
                   "Event {:?} failed JSON schema validation: {:?}", 
                   event.event_type, schema_result);

            // Each event should achieve some payload optimization
            let metrics = event.calculate_payload_optimization_metrics();
            assert!(metrics.null_fields_omitted > 0, 
                   "Event {:?} should omit some null fields", event.event_type);
        }
    }

    #[test]
    fn test_error_handling_edge_cases() {
        // Test empty JSON
        let empty_result = Event::validate_json_schema("");
        assert!(empty_result.is_err(), "Empty JSON should fail validation");

        // Test null JSON
        let null_result = Event::validate_json_schema("null");
        assert!(null_result.is_err(), "Null JSON should fail validation");

        // Test array JSON instead of object
        let array_result = Event::validate_json_schema("[]");
        assert!(array_result.is_err(), "Array JSON should fail validation");

        // Test JSON with wrong data types
        let wrong_types_json = r#"{
            "event_id": 123,
            "type": true,
            "source": ["not", "a", "string"],
            "timestamp": 1234567890,
            "task_id": null,
            "title": {},
            "description": 42,
            "data": "not an object"
        }"#;
        
        let wrong_types_result = Event::validate_json_schema(wrong_types_json);
        assert!(wrong_types_result.is_err(), "Wrong data types should fail validation");
        
        let errors = wrong_types_result.unwrap_err();
        // At minimum we should detect missing required fields and data type errors
        assert!(errors.len() >= 1, "Should detect type errors, got: {:?}", errors);
    }

    #[test]
    fn test_optimization_metrics_edge_cases() {
        // Test event with all fields populated
        let mut full_event = Event::task_completed(
            "claude-code",
            "full-test",
            "Full Event Test",
            Some("All fields populated".to_string()),
        );
        
        // Populate many optional fields
        full_event.data.file_path = Some("test.rs".to_string());
        full_event.data.language = Some("rust".to_string());
        full_event.data.duration_ms = Some(1000);
        full_event.data.memory_usage_mb = Some(100.0);
        full_event.data.cpu_usage_percent = Some(50.0);
        full_event.data.error_message = Some("No error".to_string());
        full_event.data.priority = Some("high".to_string());
        full_event.data.category = Some("test".to_string());
        full_event.correlation_id = Some("corr-123".to_string());
        full_event.parent_event_id = Some("parent-456".to_string());
        full_event.processed_at = Some(Utc::now());
        
        let metrics = full_event.calculate_payload_optimization_metrics();
        
        // Should still have some optimization due to remaining None fields
        assert!(metrics.null_fields_omitted > 0, "Should still omit some fields");
        assert!(metrics.size_reduction_percentage > 0.0, "Should still have some optimization");
        assert!(metrics.optimized_size_bytes < metrics.full_size_bytes, "Optimized should be smaller");
    }

    // ============================================================================
    // COMPREHENSIVE TASK 2.3 SERIALIZATION TESTS
    // ============================================================================

    /// Comprehensive round-trip serialization test for all EventType variants
    #[test]
    fn test_all_event_types_comprehensive_round_trip() {
        let all_event_types = vec![
            // Task Management Events
            EventType::TaskCompletion, EventType::TaskStarted, EventType::TaskFailed,
            EventType::TaskProgress, EventType::TaskCancelled,
            // Code Operation Events
            EventType::CodeGeneration, EventType::CodeAnalysis, EventType::CodeRefactoring,
            EventType::CodeReview, EventType::CodeTesting, EventType::CodeDeployment,
            // File System Events
            EventType::FileCreated, EventType::FileModified, EventType::FileDeleted,
            EventType::DirectoryCreated, EventType::DirectoryDeleted,
            // Build & Development Events
            EventType::BuildStarted, EventType::BuildCompleted, EventType::BuildFailed,
            EventType::TestSuiteRun, EventType::TestPassed, EventType::TestFailed,
            EventType::LintCheck, EventType::TypeCheck,
            // Git & Version Control Events
            EventType::GitCommit, EventType::GitPush, EventType::GitMerge,
            EventType::GitBranch, EventType::GitTag, EventType::PullRequestCreated,
            EventType::PullRequestMerged,
            // System & Monitoring Events
            EventType::SystemHealth, EventType::PerformanceAlert, EventType::SecurityAlert,
            EventType::ErrorOccurred, EventType::ResourceUsage,
            // User Interaction Events
            EventType::ApprovalRequest, EventType::UserResponse, EventType::CommandExecuted,
            // Notification Events
            EventType::ProgressUpdate, EventType::StatusChange, EventType::AlertNotification,
            EventType::InfoNotification,
            // Integration Events
            EventType::ApiCall, EventType::WebhookReceived, EventType::ServiceIntegration,
            // Custom Events
            EventType::CustomEvent, EventType::Unknown,
        ];

        for event_type in all_event_types {
            println!("Testing comprehensive round-trip for: {:?}", event_type);
            
            // Create a comprehensive event with all fields populated
            let original_event = create_comprehensive_test_event(event_type.clone());
            
            // Serialize to JSON
            let json_result = serde_json::to_string_pretty(&original_event);
            assert!(json_result.is_ok(), "Failed to serialize event type: {:?}", event_type);
            let json = json_result.unwrap();
            
            // Deserialize from JSON
            let deserialized_result: Result<Event, _> = serde_json::from_str(&json);
            assert!(deserialized_result.is_ok(), "Failed to deserialize event type: {:?}", event_type);
            let deserialized_event = deserialized_result.unwrap();
            
            // Verify round-trip consistency
            assert_eq!(original_event.event_type, deserialized_event.event_type);
            assert_eq!(original_event.event_id, deserialized_event.event_id);
            assert_eq!(original_event.source, deserialized_event.source);
            assert_eq!(original_event.task_id, deserialized_event.task_id);
            assert_eq!(original_event.title, deserialized_event.title);
            assert_eq!(original_event.processing_status, deserialized_event.processing_status);
            
            // Verify JSON uses correct field names
            assert!(json.contains("\"type\""), "JSON should contain 'type' field (renamed from event_type)");
            assert!(json.contains("\"task_id\""), "JSON should use snake_case for task_id");
            
            // Verify null fields are omitted (payload optimization)
            if original_event.correlation_id.is_none() {
                assert!(!json.contains("\"correlation_id\""), "None fields should be omitted");
            }
        }
    }

    /// Test comprehensive payload size optimization
    #[test]
    fn test_comprehensive_payload_size_optimization() {
        // Create minimal event with mostly None values
        let minimal_event = Event {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type: EventType::TaskCompletion,
            source: "test".to_string(),
            timestamp: Utc::now(),
            task_id: "minimal-test".to_string(),
            title: "Minimal Event".to_string(),
            description: "Test event with minimal data".to_string(),
            data: EventData::default(), // All fields are None
            processing_status: ProcessingStatus::Pending,
            retry_count: 0,
            correlation_id: None, // This should be omitted
            parent_event_id: None, // This should be omitted
            schema_version: "1.0".to_string(),
            created_at: Utc::now(),
            processed_at: None, // This should be omitted
        };

        let json = serde_json::to_string_pretty(&minimal_event).unwrap();
        
        // Verify null fields are omitted - comprehensive check
        let omitted_fields = [
            "correlation_id", "parent_event_id", "processed_at", "status", "success", 
            "results", "error_message", "priority", "duration_ms", "files_affected", 
            "approval_prompt", "options", "user_id", "command", "branch_name", 
            "commit_hash", "severity", "url", "metadata"
        ];
        
        for field in &omitted_fields {
            assert!(!json.contains(&format!("\"{}\"", field)), 
                   "Field '{}' should be omitted when None", field);
        }
        
        // Verify no null values appear
        assert!(!json.contains("null"), "No null values should appear in JSON");
        
        // Create comprehensive event with all fields populated
        let comprehensive_event = create_comprehensive_test_event(EventType::TaskCompletion);
        let comprehensive_json = serde_json::to_string_pretty(&comprehensive_event).unwrap();
        
        // Verify size optimization (minimal should be significantly smaller)
        let size_reduction = ((comprehensive_json.len() - json.len()) as f64 / comprehensive_json.len() as f64) * 100.0;
        println!("Comprehensive event JSON length: {} bytes", comprehensive_json.len());
        println!("Minimal event JSON length: {} bytes", json.len());
        println!("Size reduction: {:.1}%", size_reduction);
        
        // Should see at least 20% reduction in size
        assert!(size_reduction >= 20.0, "Expected at least 20% size reduction, got {:.1}%", size_reduction);
    }

    /// Test forward compatibility with comprehensive unknown variants
    #[test]
    fn test_comprehensive_forward_compatibility() {
        // Test multiple unknown event types
        let unknown_event_types = vec![
            "future_ai_event_v3",
            "quantum_computing_event", 
            "neural_interface_event",
            "blockchain_verification",
            "metaverse_integration"
        ];

        for unknown_type in unknown_event_types {
            let unknown_event_json = format!(r#"{{
                "event_id": "test-123",
                "type": "{}",
                "source": "future-claude-version",
                "timestamp": "2025-01-01T12:00:00Z",
                "task_id": "future-task",
                "title": "Future Event",
                "description": "This event type doesn't exist yet",
                "data": {{}},
                "processing_status": "quantum_processing",
                "retry_count": 0,
                "schema_version": "1.0",
                "created_at": "2025-01-01T12:00:00Z"
            }}"#, unknown_type);

            let result: Result<Event, _> = serde_json::from_str(&unknown_event_json);
            assert!(result.is_ok(), "Should handle unknown event type '{}' gracefully", unknown_type);
            
            let event = result.unwrap();
            assert_eq!(event.event_type, EventType::Unknown);
            assert_eq!(event.processing_status, ProcessingStatus::Unknown);
            assert_eq!(event.task_id, "future-task");
        }

        // Test multiple unknown processing statuses
        let unknown_statuses = vec![
            "quantum_processing",
            "ai_enhanced_delivery",
            "blockchain_verified",
            "neural_network_processed",
            "future_status_v5"
        ];

        for unknown_status in unknown_statuses {
            let unknown_json = format!("\"{}\"", unknown_status);
            let result: Result<ProcessingStatus, _> = serde_json::from_str(&unknown_json);
            assert!(result.is_ok(), "Should handle unknown status '{}' gracefully", unknown_status);
            assert_eq!(result.unwrap(), ProcessingStatus::Unknown);
        }
    }

    /// Test comprehensive error handling with detailed validation
    #[test]
    fn test_comprehensive_error_handling() {
        // Test various JSON validation scenarios
        let error_scenarios = vec![
            // Missing required fields
            (r#"{"type": "task_completion"}"#, "missing required fields"),
            
            // Invalid timestamp formats
            (r#"{
                "event_id": "test-123",
                "type": "task_completion",
                "source": "test",
                "timestamp": "not-a-valid-timestamp",
                "task_id": "test",
                "title": "Test",
                "description": "Test",
                "data": {},
                "schema_version": "1.0",
                "created_at": "2024-01-01T12:00:00Z"
            }"#, "invalid timestamp"),
            
            // Malformed JSON
            (r#"{
                "type": "task_completion",
                "source": "test",
                "invalid": json,
            }"#, "malformed JSON"),
        ];

        for (json, description) in error_scenarios {
            let result = Event::from_json(json);
            assert!(result.is_err(), "Should fail for: {}", description);
            
            // Verify error message contains useful information
            let error_msg = result.unwrap_err().to_string();
            assert!(!error_msg.is_empty(), "Error message should not be empty for: {}", description);
        }
    }

    /// Test JSON field naming consistency across all structures
    #[test]
    fn test_comprehensive_json_field_naming() {
        let event = create_comprehensive_test_event(EventType::TaskCompletion);
        let json = serde_json::to_string_pretty(&event).unwrap();
        
        // Verify snake_case field names are used
        let snake_case_fields = vec![
            "event_id", "type", "task_id", "error_message", "duration_ms",
            "files_affected", "approval_prompt", "branch_name",
            "commit_hash", "request_id", "response_code", 
            "processing_status", "retry_count", "correlation_id"
        ];
        
        for field in &snake_case_fields {
            if json.contains(&format!("\"{}\"", field)) {
                println!("✓ Found snake_case field: {}", field);
            }
        }
        
        // Verify no camelCase field names exist
        let camel_case_fields = vec![
            "eventId", "eventType", "taskId", "errorMessage", "durationMs",
            "filesAffected", "approvalPrompt", "responseText", "branchName",
            "commitHash", "currentValue", "metricName", "requestId", 
            "responseCode", "processingStatus", "retryCount", "correlationId"
        ];
        
        for field in &camel_case_fields {
            assert!(!json.contains(&format!("\"{}\"", field)), 
                   "Should not contain camelCase field: {}", field);
        }
    }

    /// Test serialization performance benchmarks
    #[test]
    fn test_serialization_performance_benchmarks() {
        let event = create_comprehensive_test_event(EventType::TaskCompletion);
        
        // Benchmark serialization
        let iterations = 1000;
        let start = std::time::Instant::now();
        for _ in 0..iterations {
            let _json = serde_json::to_string(&event).unwrap();
        }
        let serialization_duration = start.elapsed();
        
        println!("{} serializations took: {:?}", iterations, serialization_duration);
        println!("Average serialization time: {:?}", serialization_duration / iterations);
        
        // Should be fast (less than 1ms average)
        let avg_micros = serialization_duration.as_micros() / iterations as u128;
        assert!(avg_micros < 1000, "Serialization should average less than 1ms, got {}μs", avg_micros);
        
        // Benchmark deserialization
        let json = serde_json::to_string(&event).unwrap();
        let start = std::time::Instant::now();
        for _ in 0..iterations {
            let _event: Event = serde_json::from_str(&json).unwrap();
        }
        let deserialization_duration = start.elapsed();
        
        println!("{} deserializations took: {:?}", iterations, deserialization_duration);
        println!("Average deserialization time: {:?}", deserialization_duration / iterations);
        
        // Should be fast (less than 1ms average)
        let avg_micros = deserialization_duration.as_micros() / iterations as u128;
        assert!(avg_micros < 1000, "Deserialization should average less than 1ms, got {}μs", avg_micros);
    }

    /// Helper function to create comprehensive test events with all fields populated
    fn create_comprehensive_test_event(event_type: EventType) -> Event {
        let mut metadata = HashMap::new();
        metadata.insert("test_key".to_string(), serde_json::json!("test_value"));
        metadata.insert("numeric_key".to_string(), serde_json::json!(42));
        metadata.insert("array_key".to_string(), serde_json::json!(["item1", "item2"]));
        
        Event {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type,
            source: "comprehensive-test".to_string(),
            timestamp: Utc::now(),
            task_id: format!("task-{}", uuid::Uuid::new_v4()),
            title: "Comprehensive Test Event".to_string(),
            description: "This event has all possible fields populated for comprehensive testing".to_string(),
            data: EventData {
                // Status and Results
                status: Some("test_status".to_string()),
                results: Some("Comprehensive test results with detailed information".to_string()),
                exit_code: Some(0),
                success: Some(true),
                
                // File and Path Information
                file_path: Some("src/events/types.rs".to_string()),
                files_affected: Some(vec![
                    "src/events/types.rs".to_string(), 
                    "tests/serialization.rs".to_string(),
                    "docs/api.md".to_string()
                ]),
                directory: Some("src/events/".to_string()),
                line_number: Some(1500),
                
                // Code Information
                language: Some("rust".to_string()),
                function_name: Some("create_comprehensive_test_event".to_string()),
                class_name: Some("Event".to_string()),
                module_name: Some("events::types".to_string()),
                code_snippet: Some("fn test() { /* code */ }".to_string()),
                
                // Git Information
                commit_hash: Some("abc123def456".to_string()),
                branch_name: Some("feature/task-2.3-serialization".to_string()),
                author: Some("Claude AI".to_string()),
                commit_message: Some("Complete Task 2.3: JSON Serialization Implementation".to_string()),
                files_changed: Some(vec![
                    "src/events/types.rs".to_string(),
                    "tests/serialization.rs".to_string()
                ]),
                
                // Build and Test Information
                build_target: Some("debug".to_string()),
                test_count: Some(150),
                tests_passed: Some(148),
                tests_failed: Some(2),
                coverage_percentage: Some(92.5),
                duration_ms: Some(1500),
                
                // Performance and System Information
                memory_usage_mb: Some(75.5),
                cpu_usage_percent: Some(25.3),
                disk_usage_mb: Some(1024.0),
                network_bytes: Some(4096),
                
                // Error Information
                error_message: Some("Test error message for validation".to_string()),
                error_code: Some("E001".to_string()),
                stack_trace: Some("at test_function:123".to_string()),
                severity: Some("medium".to_string()),
                
                // User Interaction
                approval_prompt: Some("Test approval prompt for comprehensive testing".to_string()),
                options: Some(vec![
                    "approve".to_string(), 
                    "deny".to_string(), 
                    "defer".to_string()
                ]),
                user_id: Some("123456".to_string()), // Fixed: Should be String
                command: Some("cargo test --comprehensive".to_string()),
                arguments: Some(vec!["--comprehensive".to_string(), "--nocapture".to_string()]),
                
                // Notification Information
                priority: Some("high".to_string()),
                category: Some("comprehensive_testing".to_string()),
                tags: Some(vec!["test".to_string(), "serialization".to_string()]),
                url: Some("https://github.com/enrique/cctelegram".to_string()),
                actions: Some(vec![
                    ActionButton {
                        text: "Approve".to_string(),
                        action: "approve".to_string(),
                        data: Some("approval_data".to_string()),
                        style: Some("primary".to_string()),
                    },
                    ActionButton {
                        text: "Deny".to_string(),
                        action: "deny".to_string(),
                        data: Some("denial_data".to_string()),
                        style: Some("danger".to_string()),
                    }
                ]),
                
                // Integration Information
                service_name: Some("test-service".to_string()),
                endpoint: Some("/api/v1/test".to_string()),
                request_id: Some(format!("req-{}", uuid::Uuid::new_v4())),
                response_code: Some(200),
                
                // Custom and Extended Data
                metadata: Some(metadata),
            },
            processing_status: ProcessingStatus::Pending,
            retry_count: 0,
            correlation_id: Some(uuid::Uuid::new_v4().to_string()),
            parent_event_id: Some(uuid::Uuid::new_v4().to_string()),
            schema_version: "1.0".to_string(),
            created_at: Utc::now(),
            processed_at: None,
        }
    }

    // ============================================================================
    // COMPREHENSIVE VALIDATION SYSTEM TESTS - Task 2.4 Implementation
    // ============================================================================

    #[test]
    fn test_validation_error_messages() {
        // Test ValidationError message generation
        let empty_field_error = ValidationError::EmptyField { 
            field: "title".to_string() 
        };
        assert_eq!(empty_field_error.message(), "The 'title' field cannot be empty");
        assert_eq!(empty_field_error.severity(), "high");
        
        let length_error = ValidationError::InvalidLength {
            field: "description".to_string(),
            current: 2500,
            min: Some(1),
            max: Some(2000),
        };
        assert_eq!(length_error.message(), "The 'description' field must be between 1 and 2000 characters (current: 2500 characters)");
        assert_eq!(length_error.severity(), "high");
        
        let duplicate_error = ValidationError::DuplicateEvent {
            event_id: "test-123".to_string(),
            original_timestamp: Utc.with_ymd_and_hms(2024, 8, 4, 12, 0, 0).unwrap(),
        };
        assert!(duplicate_error.message().contains("Duplicate event detected"));
        assert_eq!(duplicate_error.severity(), "critical");
    }

    #[test]
    fn test_field_constraint_validation() {
        let mut event = Event::new(
            EventType::TaskCompletion,
            "test-source",
            "test-task",
            "Test Title",
            "Test Description",
        );
        
        // Valid event should pass
        assert!(event.validate_field_constraints().is_ok());
        
        // Test empty source
        event.source = "".to_string();
        let result = event.validate_field_constraints();
        assert!(result.is_err());
        if let Err(ValidationError::EmptyField { field }) = result {
            assert_eq!(field, "source");
        } else {
            panic!("Expected EmptyField error for source");
        }
        
        // Reset and test title too long
        event.source = "test-source".to_string();
        event.title = "a".repeat(201); // Over 200 char limit
        let result = event.validate_field_constraints();
        assert!(result.is_err());
        if let Err(ValidationError::InvalidLength { field, current, max, .. }) = result {
            assert_eq!(field, "title");
            assert_eq!(current, 201);
            assert_eq!(max, Some(200));
        } else {
            panic!("Expected InvalidLength error for title");
        }
        
        // Reset and test description too long
        event.title = "Test Title".to_string();
        event.description = "a".repeat(2001); // Over 2000 char limit
        let result = event.validate_field_constraints();
        assert!(result.is_err());
        if let Err(ValidationError::InvalidLength { field, current, max, .. }) = result {
            assert_eq!(field, "description");
            assert_eq!(current, 2001);
            assert_eq!(max, Some(2000));
        } else {
            panic!("Expected InvalidLength error for description");
        }
    }

    #[test]
    fn test_uuid_validation() {
        let mut event = Event::new(
            EventType::TaskCompletion,
            "test-source",
            "test-task",
            "Test Title",
            "Test Description",
        );
        
        // Valid UUID should pass
        assert!(event.validate_uuid_fields().is_ok());
        
        // Invalid event_id UUID
        event.event_id = "not-a-uuid".to_string();
        let result = event.validate_uuid_fields();
        assert!(result.is_err());
        if let Err(ValidationError::InvalidUuid { field }) = result {
            assert_eq!(field, "event_id");
        } else {
            panic!("Expected InvalidUuid error for event_id");
        }
        
        // Reset event_id and test invalid correlation_id
        event.event_id = Uuid::new_v4().to_string();
        event.correlation_id = Some("not-a-uuid".to_string());
        let result = event.validate_uuid_fields();
        assert!(result.is_err());
        if let Err(ValidationError::InvalidUuid { field }) = result {
            assert_eq!(field, "correlation_id");
        } else {
            panic!("Expected InvalidUuid error for correlation_id");
        }
    }

    #[test]
    fn test_timestamp_validation() {
        let mut event = Event::new(
            EventType::TaskCompletion,
            "test-source",
            "test-task",
            "Test Title",
            "Test Description",
        );
        
        // Current timestamp should pass
        assert!(event.validate_timestamp().is_ok());
        
        // Future timestamp should fail
        event.timestamp = Utc::now() + Duration::hours(1);
        let result = event.validate_timestamp();
        assert!(result.is_err());
        if let Err(ValidationError::InvalidTimestamp { reason }) = result {
            assert!(reason.contains("future"));
        } else {
            panic!("Expected InvalidTimestamp error for future timestamp");
        }
        
        // Very old timestamp should fail
        event.timestamp = Utc::now() - Duration::days(400);
        let result = event.validate_timestamp();
        assert!(result.is_err());
        if let Err(ValidationError::InvalidTimestamp { reason }) = result {
            assert!(reason.contains("year in the past"));
        } else {
            panic!("Expected InvalidTimestamp error for old timestamp");
        }
    }

    #[test]
    fn test_deduplication_logic() {
        let event1 = Event::new(
            EventType::TaskCompletion,
            "test",
            "task-1",
            "Test Task",
            "Test Description",
        );
        
        let mut event2 = event1.clone();
        
        // Same event_id should be duplicate
        assert!(event1.is_duplicate_of(&event2));
        
        // Different event_id but same content and timestamp should be duplicate
        event2.event_id = Uuid::new_v4().to_string();
        assert!(event1.has_duplicate_content(&event2));
        
        // Different task_id should not be duplicate
        event2.task_id = "different-task".to_string();
        assert!(!event1.has_duplicate_content(&event2));
        
        // Test deduplication keys
        let key1 = event1.deduplication_key();
        let key2 = event1.content_deduplication_key();
        assert_eq!(key1, event1.event_id);
        assert!(key2.starts_with("content_"));
        
        // Test validation against duplicates
        let existing_events = vec![event1.clone()];
        let result = event1.validate_against_duplicates(&existing_events);
        assert!(result.is_err());
        if let Err(ValidationError::DuplicateEvent { event_id, .. }) = result {
            assert_eq!(event_id, event1.event_id);
        } else {
            panic!("Expected DuplicateEvent error");
        }
    }

    #[test]
    fn test_comprehensive_validation_flow() {
        // Create a valid event
        let event = Event::task_completed(
            "test-source",
            "task-123",
            "Test Task Completion",
            Some("Task completed successfully".to_string()),
        );
        
        // Should pass all validation
        assert!(event.validate().is_ok());
        
        // Test legacy compatibility
        assert!(event.validate_legacy().is_ok());
        
        // Create an invalid event
        let invalid_event = Event::new(
            EventType::ApprovalRequest,
            "",  // Empty source - should fail
            "task-456",
            "Approval Request",
            "Please approve this action",
        );
        
        // Should fail validation
        let result = invalid_event.validate();
        assert!(result.is_err());
        
        // Should also fail legacy validation
        let legacy_result = invalid_event.validate_legacy();
        assert!(legacy_result.is_err());
    }
}
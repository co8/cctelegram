use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Event {
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub source: String,
    pub timestamp: DateTime<Utc>,
    pub task_id: String,
    pub title: String,
    pub description: String,
    pub data: EventData,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventData {
    // Status and Results
    pub status: Option<String>,
    pub results: Option<String>,
    pub exit_code: Option<i32>,
    pub success: Option<bool>,
    
    // File and Path Information
    pub file_path: Option<String>,
    pub files_affected: Option<Vec<String>>,
    pub directory: Option<String>,
    pub line_number: Option<u32>,
    
    // Code Information
    pub language: Option<String>,
    pub function_name: Option<String>,
    pub class_name: Option<String>,
    pub module_name: Option<String>,
    pub code_snippet: Option<String>,
    
    // Git Information
    pub commit_hash: Option<String>,
    pub branch_name: Option<String>,
    pub author: Option<String>,
    pub commit_message: Option<String>,
    pub files_changed: Option<Vec<String>>,
    
    // Build and Test Information
    pub build_target: Option<String>,
    pub test_count: Option<u32>,
    pub tests_passed: Option<u32>,
    pub tests_failed: Option<u32>,
    pub coverage_percentage: Option<f32>,
    pub duration_ms: Option<u64>,
    
    // Performance and System Information
    pub memory_usage_mb: Option<f64>,
    pub cpu_usage_percent: Option<f32>,
    pub disk_usage_mb: Option<f64>,
    pub network_bytes: Option<u64>,
    
    // Error Information
    pub error_message: Option<String>,
    pub error_code: Option<String>,
    pub stack_trace: Option<String>,
    pub severity: Option<String>, // low, medium, high, critical
    
    // User Interaction
    pub approval_prompt: Option<String>,
    pub options: Option<Vec<String>>,
    pub user_id: Option<String>,
    pub command: Option<String>,
    pub arguments: Option<Vec<String>>,
    
    // Notification Information
    pub priority: Option<String>, // low, normal, high, urgent
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub url: Option<String>,
    pub actions: Option<Vec<ActionButton>>,
    
    // Integration Information
    pub service_name: Option<String>,
    pub endpoint: Option<String>,
    pub request_id: Option<String>,
    pub response_code: Option<u16>,
    
    // Custom and Extended Data
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ActionButton {
    pub text: String,
    pub action: String,
    pub data: Option<String>,
    pub style: Option<String>, // primary, secondary, danger
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResponseEvent {
    pub event_id: String,
    pub user_id: String,
    pub timestamp: DateTime<Utc>,
    pub response: String,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

// Event builder implementations
impl Event {
    /// Create a new event with basic information
    pub fn new(
        event_type: EventType,
        source: impl Into<String>,
        task_id: impl Into<String>,
        title: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            event_type,
            source: source.into(),
            timestamp: Utc::now(),
            task_id: task_id.into(),
            title: title.into(),
            description: description.into(),
            data: EventData::default(),
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

// Event validation and utility implementations
impl Event {
    /// Validate the event structure and data consistency
    pub fn validate(&self) -> Result<(), String> {
        // Basic field validation
        if self.source.is_empty() {
            return Err("Event source cannot be empty".to_string());
        }
        
        if self.task_id.is_empty() {
            return Err("Task ID cannot be empty".to_string());
        }
        
        if self.title.is_empty() {
            return Err("Event title cannot be empty".to_string());
        }
        
        // Event type specific validation
        match self.event_type {
            EventType::ApprovalRequest => {
                if self.data.approval_prompt.is_none() {
                    return Err("Approval request events must have an approval prompt".to_string());
                }
                if self.data.options.is_none() || self.data.options.as_ref().unwrap().is_empty() {
                    return Err("Approval request events must have options".to_string());
                }
            }
            EventType::TestPassed | EventType::TestFailed | EventType::TestSuiteRun => {
                if self.data.test_count.is_none() {
                    return Err("Test events must include test count".to_string());
                }
            }
            EventType::GitCommit => {
                if self.data.commit_hash.is_none() || self.data.commit_message.is_none() {
                    return Err("Git commit events must include commit hash and message".to_string());
                }
            }
            EventType::ErrorOccurred => {
                if self.data.error_message.is_none() {
                    return Err("Error events must include error message".to_string());
                }
            }
            EventType::PerformanceAlert | EventType::SecurityAlert => {
                if self.data.severity.is_none() {
                    return Err("Alert events must include severity level".to_string());
                }
            }
            _ => {} // Other event types don't have specific validation requirements
        }
        
        // Validate severity levels
        if let Some(ref severity) = self.data.severity {
            match severity.as_str() {
                "low" | "medium" | "high" | "critical" => {}
                _ => return Err("Invalid severity level. Must be: low, medium, high, or critical".to_string()),
            }
        }
        
        // Validate priority levels
        if let Some(ref priority) = self.data.priority {
            match priority.as_str() {
                "low" | "normal" | "high" | "urgent" => {}
                _ => return Err("Invalid priority level. Must be: low, normal, high, or urgent".to_string()),
            }
        }
        
        // Validate action button styles
        if let Some(ref actions) = self.data.actions {
            for action in actions {
                if let Some(ref style) = action.style {
                    match style.as_str() {
                        "primary" | "secondary" | "danger" => {}
                        _ => return Err("Invalid action button style. Must be: primary, secondary, or danger".to_string()),
                    }
                }
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
}
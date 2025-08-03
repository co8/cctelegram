use crate::events::types::Event;
use chrono::{DateTime, Utc, TimeZone};
use chrono_tz::Tz;

pub struct MessageFormatter {
    timezone: Tz,
}

impl MessageFormatter {
    pub fn new(timezone: Tz) -> Self {
        Self { timezone }
    }
    
    pub fn new_with_default() -> Self {
        Self::new("Europe/Berlin".parse().unwrap())
    }

    /// Escape special characters for MarkdownV2
    fn escape_markdown_v2(text: &str) -> String {
        text.chars()
            .map(|c| match c {
                '_' | '*' | '[' | ']' | '(' | ')' | '~' | '`' | '>' | '#' | '+' | '-' | '=' | '|' | '{' | '}' | '.' | '!' => {
                    format!("\\{}", c)
                }
                _ => c.to_string(),
            })
            .collect()
    }

    /// Convert markdown content while preserving intended formatting and escaping special chars
    fn process_markdown_content(text: &str) -> String {
        let mut result = String::new();
        let mut chars = text.chars().peekable();
        
        while let Some(ch) = chars.next() {
            match ch {
                '*' => {
                    // Check if this is bold markdown (**text**)
                    if chars.peek() == Some(&'*') {
                        chars.next(); // consume the second *
                        result.push('*'); // Single * for MarkdownV2 bold
                        
                        // Find the closing **
                        let mut bold_content = String::new();
                        let mut found_closing = false;
                        
                        while let Some(inner_ch) = chars.next() {
                            if inner_ch == '*' && chars.peek() == Some(&'*') {
                                chars.next(); // consume the second closing *
                                found_closing = true;
                                break;
                            } else {
                                bold_content.push(inner_ch);
                            }
                        }
                        
                        // Add the bold content (escaped) and closing *
                        result.push_str(&Self::escape_markdown_v2(&bold_content));
                        if found_closing {
                            result.push('*');
                        }
                    } else {
                        // Single *, escape it
                        result.push_str("\\*");
                    }
                }
                '_' | '[' | ']' | '(' | ')' | '~' | '`' | '>' | '#' | '+' | '-' | '=' | '|' | '{' | '}' | '.' | '!' => {
                    result.push_str(&format!("\\{}", ch));
                }
                _ => {
                    result.push(ch);
                }
            }
        }
        
        result
    }

    pub fn format_completion_message(&self, event: &Event) -> String {
        let status = event.data.status.as_deref().unwrap_or("unknown");
        let results = event.data.results.as_deref().unwrap_or("No details provided");
        
        let status_emoji = match status.to_lowercase().as_str() {
            "completed" | "success" => "✅",
            "failed" | "error" => "❌",
            "warning" => "⚠️",
            _ => "ℹ️",
        };

        format!(
            "*{} Task Completed {}*\n\
            ⏰ {}\n\
            📝 {}",
            status_emoji,
            Self::escape_markdown_v2(&event.title),
            Self::escape_markdown_v2(&self.format_timestamp(&event.timestamp)),
            Self::process_markdown_content(results)
        )
    }

    pub fn format_approval_message(&self, event: &Event) -> String {
        let prompt = event.data.approval_prompt.as_deref().unwrap_or("Approval required");

        format!(
            "*🔐 {}*\n\
            ⏰ {}\n\
            📝 Approval Required {}\n\
            \n\
            {}",
            Self::escape_markdown_v2(&event.title),
            Self::escape_markdown_v2(&self.format_timestamp(&event.timestamp)),
            Self::escape_markdown_v2(&event.title),
            Self::process_markdown_content(prompt)
        )
    }

    pub fn format_progress_message(&self, event: &Event) -> String {
        let progress_info = self.extract_progress_info(event);
        
        format!(
            "*🔄 Progress Update {}*\n\
            ⏰ {}\n\
            📊 Progress: {}\n\
            📝 {}",
            Self::escape_markdown_v2(&event.title),
            Self::escape_markdown_v2(&self.format_timestamp(&event.timestamp)),
            Self::escape_markdown_v2(&progress_info),
            Self::process_markdown_content(&event.description)
        )
    }

    pub fn format_generic_message(&self, event: &Event) -> String {
        let (emoji, event_name) = self.get_event_display_info(&event.event_type);
        
        format!(
            "*{} {} {}*\n\
            ⏰ {}\n\
            📝 {}",
            emoji,
            Self::escape_markdown_v2(event_name),
            Self::escape_markdown_v2(&event.title),
            Self::escape_markdown_v2(&self.format_timestamp(&event.timestamp)),
            Self::process_markdown_content(&event.description)
        )
    }

    fn get_event_display_info(&self, event_type: &crate::events::types::EventType) -> (&'static str, &'static str) {
        use crate::events::types::EventType::*;
        
        match event_type {
            // Task Management Events
            TaskStarted => ("🚀", "Task Started"),
            TaskFailed => ("❌", "Task Failed"),
            TaskProgress => ("📊", "Task Progress"),
            TaskCancelled => ("🚫", "Task Cancelled"),
            
            // Code Operation Events
            CodeGeneration => ("🔨", "Code Generated"),
            CodeAnalysis => ("🔍", "Code Analysis"),
            CodeRefactoring => ("🔧", "Code Refactored"),
            CodeReview => ("👁️", "Code Review"),
            CodeTesting => ("🧪", "Code Testing"),
            CodeDeployment => ("🚀", "Code Deployment"),
            
            // File System Events
            FileCreated => ("📄", "File Created"),
            FileModified => ("📝", "File Modified"),
            FileDeleted => ("🗑️", "File Deleted"),
            DirectoryCreated => ("📁", "Directory Created"),
            DirectoryDeleted => ("🗑️", "Directory Deleted"),
            
            // Build & Development Events
            BuildStarted => ("🔨", "Build Started"),
            BuildCompleted => ("✅", "Build Completed"),
            BuildFailed => ("❌", "Build Failed"),
            TestSuiteRun => ("🧪", "Test Suite Run"),
            TestPassed => ("✅", "Test Passed"),
            TestFailed => ("❌", "Test Failed"),
            LintCheck => ("📏", "Lint Check"),
            TypeCheck => ("🔍", "Type Check"),
            
            // Git & Version Control Events
            GitCommit => ("📝", "Git Commit"),
            GitPush => ("⬆️", "Git Push"),
            GitMerge => ("🔀", "Git Merge"),
            GitBranch => ("🌿", "Git Branch"),
            GitTag => ("🏷️", "Git Tag"),
            PullRequestCreated => ("📋", "Pull Request Created"),
            PullRequestMerged => ("✅", "Pull Request Merged"),
            
            // System & Monitoring Events
            SystemHealth => ("💚", "System Health"),
            PerformanceAlert => ("⚡", "Performance Alert"),
            SecurityAlert => ("🔒", "Security Alert"),
            ErrorOccurred => ("❌", "Error Occurred"),
            ResourceUsage => ("📊", "Resource Usage"),
            
            // User Interaction Events
            UserResponse => ("💬", "User Response"),
            CommandExecuted => ("⚡", "Command Executed"),
            
            // Notification Events
            StatusChange => ("🔄", "Status Change"),
            AlertNotification => ("🚨", "Alert"),
            InfoNotification => ("ℹ️", "Information"),
            
            // Integration Events
            ApiCall => ("🌐", "API Call"),
            WebhookReceived => ("📡", "Webhook Received"),
            ServiceIntegration => ("🔗", "Service Integration"),
            
            // Custom Events
            CustomEvent => ("🎯", "Custom Event"),
            
            // Original events handled elsewhere
            TaskCompletion => ("✅", "Task Completion"),
            ApprovalRequest => ("🔐", "Approval Request"),
            ProgressUpdate => ("🔄", "Progress Update"),
        }
    }

    fn format_timestamp(&self, timestamp: &DateTime<Utc>) -> String {
        let local_time = self.timezone.from_utc_datetime(&timestamp.naive_utc());
        local_time.format("%d/%b/%y %H:%M").to_string()
    }

    fn extract_progress_info(&self, event: &Event) -> String {
        if let Some(metadata) = &event.data.metadata {
            if let Some(percentage) = metadata.get("percentage") {
                if let Some(percentage_num) = percentage.as_f64() {
                    return format!("{}%", percentage_num as u32);
                }
            }
            
            if let Some(current) = metadata.get("current") {
                if let Some(total) = metadata.get("total") {
                    if let (Some(current_num), Some(total_num)) = (current.as_u64(), total.as_u64()) {
                        let percentage = (current_num as f64 / total_num as f64 * 100.0) as u32;
                        return format!("{}/{} ({}%)", current_num, total_num, percentage);
                    }
                }
            }
        }
        
        "In progress...".to_string()
    }

    #[allow(dead_code)]
    pub fn format_error_message(&self, error: &str) -> String {
        format!(
            "❌ **Error**\n\n\
            An error occurred while processing your request:\n\n\
            ```\n{}\n```\n\n\
            Please try again or contact support if the issue persists.",
            error
        )
    }

    #[allow(dead_code)]
    pub fn format_unauthorized_message(&self) -> String {
        "🚫 **Unauthorized**\n\n\
        You are not authorized to use this bot.\n\
        Please contact an administrator if you believe this is an error.".to_string()
    }
}
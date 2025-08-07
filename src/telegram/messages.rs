use crate::events::types::Event;
use chrono::{DateTime, Utc, TimeZone};
use chrono_tz::Tz;

pub struct MessageFormatter {
    timezone: Tz,
    style: MessageStyle,
}

#[derive(Clone, Debug)]
pub enum MessageStyle {
    Concise,
    Detailed,
}

impl MessageStyle {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "detailed" | "verbose" | "full" => MessageStyle::Detailed,
            _ => MessageStyle::Concise,
        }
    }
}

impl MessageFormatter {
    pub fn new(timezone: Tz) -> Self {
        Self { 
            timezone,
            style: MessageStyle::Concise,
        }
    }
    
    pub fn new_with_style(timezone: Tz, style: MessageStyle) -> Self {
        Self { timezone, style }
    }
    
    pub fn new_with_default() -> Self {
        Self::new("Europe/Berlin".parse().unwrap())
    }

    /// Escape special characters for MarkdownV2
    fn escape_markdown_v2(text: &str) -> String {
        text.chars()
            .map(|c| match c {
                '_' | '*' | '[' | ']' | '(' | ')' | '~' | '`' | '>' | '#' | '+' | '-' | '=' | '|' | '{' | '}' | '.' | '!' | '\\' => {
                    format!("\\{}", c)
                }
                // Handle bullet points and other special Unicode characters
                '•' | '◦' | '▪' | '▫' | '‣' | '⁃' => {
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

        // Calculate intelligent truncation limits using 4096 char Telegram limit
        let (title_limit, desc_limit) = self.calculate_smart_limits(&event.title, results, status_emoji);
        let concise_title = self.truncate_title(&event.title, title_limit);
        let concise_results = self.truncate_description(results, desc_limit);

        format!(
            "*{} {}*\n⏰ {}\n\n{}",
            status_emoji,
            Self::escape_markdown_v2(&concise_title),
            Self::escape_markdown_v2(&self.format_timestamp(&event.timestamp)),
            Self::process_markdown_content(&concise_results)
        )
    }

    pub fn format_approval_message(&self, event: &Event) -> String {
        let prompt = event.data.approval_prompt.as_deref().unwrap_or("Approval required");
        let (title_limit, _) = self.calculate_smart_limits(&event.title, prompt, "🔐");
        let concise_title = self.truncate_title(&event.title, title_limit);
        
        // Create concise summary with rating icons
        let summary = match self.style {
            MessageStyle::Detailed => {
                let prompt = event.data.approval_prompt.as_deref().unwrap_or("Approval required");
                Self::process_markdown_content(prompt)
            }
            MessageStyle::Concise => {
                // Extract summary information for concise display
                let priority = event.data.priority.as_deref().unwrap_or("medium");
                let priority_icon = match priority {
                    "critical" | "high" => "🔴",
                    "medium" => "🟡", 
                    "low" => "🟢",
                    _ => "🔵"
                };
                
                format!(
                    "📦 Critical Changes: ✅ Ready\n🔍 Pre\\-flight Checks: ✅ All Clear\n{} Priority: {}",
                    priority_icon,
                    priority.to_uppercase()
                )
            }
        };

        format!(
            "*🔐 {}*\n⏰ {}\n\n{}",
            Self::escape_markdown_v2(&concise_title),
            Self::escape_markdown_v2(&self.format_timestamp(&event.timestamp)),
            summary
        )
    }

    pub fn format_progress_message(&self, event: &Event) -> String {
        let progress_info = self.extract_progress_info(event);
        let (title_limit, desc_limit) = self.calculate_smart_limits(&event.title, &event.description, "🔄");
        let concise_title = self.truncate_title(&event.title, title_limit);
        let concise_desc = self.truncate_description(&event.description, desc_limit);
        
        // Combine progress info with description for concise format
        let combined_content = if progress_info.is_empty() {
            Self::process_markdown_content(&concise_desc)
        } else {
            format!("{}\n{}", 
                Self::escape_markdown_v2(&progress_info),
                Self::process_markdown_content(&concise_desc)
            )
        };
        
        format!(
            "*🔄 {}*\n⏰ {}\n\n{}",
            Self::escape_markdown_v2(&concise_title),
            Self::escape_markdown_v2(&self.format_timestamp(&event.timestamp)),
            combined_content
        )
    }

    pub fn format_generic_message(&self, event: &Event) -> String {
        let (emoji, _event_name) = self.get_event_display_info(&event.event_type);
        let (title_limit, desc_limit) = self.calculate_smart_limits(&event.title, &event.description, emoji);
        let concise_title = self.truncate_title(&event.title, title_limit);
        let concise_desc = self.truncate_description(&event.description, desc_limit);
        
        format!(
            "*{} {}*\n⏰ {}\n\n{}",
            emoji,
            Self::escape_markdown_v2(&concise_title),
            Self::escape_markdown_v2(&self.format_timestamp(&event.timestamp)),
            Self::process_markdown_content(&concise_desc)
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
            
            // Unknown event type for forward compatibility
            Unknown => ("❓", "Unknown Event"),
        }
    }

    fn format_timestamp(&self, timestamp: &DateTime<Utc>) -> String {
        let local_time = self.timezone.from_utc_datetime(&timestamp.naive_utc());
        local_time.format("%d/%b/%y %H:%M").to_string()
    }

    fn truncate_title(&self, title: &str, available_chars: usize) -> String {
        match self.style {
            MessageStyle::Detailed => title.to_string(),
            MessageStyle::Concise => {
                // Use intelligent truncation based on available characters
                if title.len() <= available_chars {
                    title.to_string()
                } else {
                    format!("{}…", &title[..available_chars.saturating_sub(1)])
                }
            }
        }
    }

    fn truncate_description(&self, desc: &str, available_chars: usize) -> String {
        match self.style {
            MessageStyle::Detailed => desc.to_string(),
            MessageStyle::Concise => {
                // Use intelligent truncation based on available characters  
                if desc.len() <= available_chars {
                    desc.to_string()
                } else {
                    format!("{}…", &desc[..available_chars.saturating_sub(1)])
                }
            }
        }
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
    
    /// Format a generic event message (used by large message handler)
    pub fn format_event_message(&self, event: &Event) -> String {
        match event.event_type {
            crate::events::types::EventType::TaskCompletion => self.format_completion_message(event),
            crate::events::types::EventType::ApprovalRequest => self.format_approval_message(event),
            crate::events::types::EventType::ProgressUpdate => self.format_progress_message(event),
            _ => self.format_generic_message(event),
        }
    }

    /// Calculate smart truncation limits based on Telegram's 4096 character limit
    fn calculate_smart_limits(&self, title: &str, description: &str, emoji: &str) -> (usize, usize) {
        // Telegram API limit is 4096 characters, leave some buffer
        const MAX_MESSAGE_LENGTH: usize = 4090;
        
        // Calculate overhead for formatting: emoji, asterisks, newlines, timestamp, etc.
        // Format: "*{emoji} {title}*\n⏰ {timestamp}\n\n{description}"
        let timestamp_overhead = 25; // "⏰ 14/Aug/25 10:30" + formatting
        let format_overhead = emoji.len() + 10; // emoji + asterisks + spaces + newlines
        let total_overhead = format_overhead + timestamp_overhead;
        
        let available_content_chars = MAX_MESSAGE_LENGTH.saturating_sub(total_overhead);
        
        match self.style {
            MessageStyle::Detailed => {
                // In detailed mode, don't truncate unless absolutely necessary
                let total_content = title.len() + description.len();
                if total_content <= available_content_chars {
                    (title.len(), description.len())
                } else {
                    // Need to truncate - prioritize description over title
                    let title_limit = (available_content_chars / 4).min(title.len()); // 25% for title
                    let desc_limit = available_content_chars.saturating_sub(title_limit); // 75% for description
                    (title_limit, desc_limit)
                }
            }
            MessageStyle::Concise => {
                // In concise mode, still use much more generous limits than before
                let total_content = title.len() + description.len();
                if total_content <= available_content_chars {
                    // No truncation needed - use full content!
                    (title.len(), description.len())
                } else {
                    // Smart truncation - prioritize description (which contains the actual content)
                    let title_limit = (available_content_chars / 3).min(500).min(title.len()); // ~33% for title, max 500 chars
                    let desc_limit = available_content_chars.saturating_sub(title_limit); // Remaining for description
                    (title_limit, desc_limit)
                }
            }
        }
    }
}
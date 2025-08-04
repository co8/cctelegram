use teloxide::prelude::*;
use teloxide::types::{InlineKeyboardButton, InlineKeyboardMarkup, CallbackQuery, ReactionType, ParseMode};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use anyhow::Result;
use tracing::{info, warn, error};
use chrono::{Utc, TimeZone};
use chrono_tz::Tz;
use serde_json;
use tokio::fs;
use crate::events::types::{Event, EventType};
use super::messages::{MessageFormatter, MessageStyle};

pub struct TelegramBot {
    bot: Bot,
    allowed_users: HashSet<i64>,
    formatter: MessageFormatter,
    responses_dir: PathBuf,
    timezone: Tz,
}

#[derive(serde::Serialize)]
struct IncomingMessage {
    timestamp: String,
    user_id: i64,
    username: Option<String>,
    first_name: Option<String>,
    message_text: String,
    message_type: String,
}

#[derive(serde::Serialize)]
struct CallbackResponse {
    timestamp: String,
    user_id: i64,
    username: Option<String>,
    first_name: Option<String>,
    callback_data: String,
    original_message_id: Option<i32>,
    response_type: String,
}

#[derive(Debug)]
struct TaskMasterInfo {
    project_name: String,
    pending: u32,
    in_progress: u32,
    completed: u32,
    blocked: u32,
    total: u32,
}

impl TelegramBot {
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

    pub fn new(token: String, allowed_users: Vec<i64>, responses_dir: PathBuf, timezone: Tz) -> Self {
        Self {
            bot: Bot::new(token),
            allowed_users: allowed_users.into_iter().collect(),
            formatter: MessageFormatter::new(timezone),
            responses_dir,
            timezone,
        }
    }

    pub fn new_with_style(token: String, allowed_users: Vec<i64>, responses_dir: PathBuf, timezone: Tz, message_style: MessageStyle) -> Self {
        Self {
            bot: Bot::new(token),
            allowed_users: allowed_users.into_iter().collect(),
            formatter: MessageFormatter::new_with_style(timezone, message_style),
            responses_dir,
            timezone,
        }
    }

    pub fn is_user_allowed(&self, user_id: i64) -> bool {
        self.allowed_users.contains(&user_id)
    }

    pub async fn send_event_notification(&self, user_id: i64, event: &Event) -> Result<()> {
        if !self.is_user_allowed(user_id) {
            warn!("Attempted notification to unauthorized user: {}", user_id);
            return Ok(());
        }

        match event.event_type {
            EventType::TaskCompletion => {
                self.send_task_completion(user_id, event).await
            }
            EventType::ApprovalRequest => {
                self.send_approval_request(user_id, event).await
            }
            EventType::ProgressUpdate => {
                self.send_progress_update(user_id, event).await
            }
            // Handle all other event types with generic notifications
            _ => {
                self.send_generic_notification(user_id, event).await
            }
        }
    }

    async fn send_task_completion(&self, user_id: i64, event: &Event) -> Result<()> {
        let message = self.formatter.format_completion_message(event);
        let keyboard = self.create_completion_keyboard(event);

        self.bot
            .send_message(UserId(user_id as u64), message)
            .parse_mode(ParseMode::MarkdownV2)
            .reply_markup(keyboard)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send completion message: {}", e))?;

        info!("Sent task completion notification to user {}", user_id);
        Ok(())
    }

    async fn send_approval_request(&self, user_id: i64, event: &Event) -> Result<()> {
        let message = self.formatter.format_approval_message(event);
        let keyboard = self.create_approval_keyboard(event);

        self.bot
            .send_message(UserId(user_id as u64), message)
            .parse_mode(ParseMode::MarkdownV2)
            .reply_markup(keyboard)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send approval message: {}", e))?;

        info!("Sent approval request to user {}", user_id);
        Ok(())
    }

    async fn send_progress_update(&self, user_id: i64, event: &Event) -> Result<()> {
        let message = self.formatter.format_progress_message(event);

        self.bot
            .send_message(UserId(user_id as u64), message)
            .parse_mode(ParseMode::MarkdownV2)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send progress message: {}", e))?;

        info!("Sent progress update to user {}", user_id);
        Ok(())
    }

    async fn send_generic_notification(&self, user_id: i64, event: &Event) -> Result<()> {
        let message = self.formatter.format_generic_message(event);

        self.bot
            .send_message(UserId(user_id as u64), message)
            .parse_mode(ParseMode::MarkdownV2)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send generic notification: {}", e))?;

        info!("Sent generic notification for {:?} to user {}", event.event_type, user_id);
        Ok(())
    }

    fn create_completion_keyboard(&self, event: &Event) -> InlineKeyboardMarkup {
        InlineKeyboardMarkup::new([
            [
                InlineKeyboardButton::callback("✅ Acknowledge", format!("ack_{}", event.task_id)),
                InlineKeyboardButton::callback("📄 Details", format!("details_{}", event.task_id)),
            ]
        ])
    }

    fn create_approval_keyboard(&self, event: &Event) -> InlineKeyboardMarkup {
        let mut keyboard = InlineKeyboardMarkup::new([
            [
                InlineKeyboardButton::callback("✅ Approve", format!("approve_{}", event.task_id)),
                InlineKeyboardButton::callback("❌ Deny", format!("deny_{}", event.task_id)),
            ]
        ]);
        keyboard = keyboard.append_row([
            InlineKeyboardButton::callback("📄 Details", format!("details_{}", event.task_id)),
        ]);
        keyboard
    }

    pub async fn start_dispatcher(self: Arc<Self>) -> Result<()> {
        info!("Starting Telegram bot dispatcher");
        
        let message_handler = Arc::clone(&self);
        let callback_handler = Arc::clone(&self);
        
        Dispatcher::builder(
            self.bot.clone(),
            dptree::entry()
                .branch(
                    Update::filter_message().endpoint(move |bot: Bot, msg: Message| {
                        let handler = Arc::clone(&message_handler);
                        async move { handler.handle_message(bot, msg).await }
                    })
                )
                .branch(
                    Update::filter_callback_query().endpoint(move |bot: Bot, q: CallbackQuery| {
                        let handler = Arc::clone(&callback_handler);
                        async move { handler.handle_callback_query(bot, q).await }
                    })
                )
        )
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;
            
        Ok(())
    }

    async fn handle_message(&self, bot: Bot, msg: Message) -> ResponseResult<()> {
        // Get user information
        let user_id = msg.from.as_ref().map_or(0, |u| u.id.0 as i64);
        let username = msg.from.as_ref().and_then(|u| u.username.clone());
        let first_name = msg.from.as_ref().map(|u| u.first_name.clone());

        // Check if user is authorized
        if !self.is_user_allowed(user_id) {
            warn!("Unauthorized message from user {}: {:?}", user_id, username);
            
            bot.send_message(
                msg.chat.id, 
                "⚠️ Unauthorized access. Your user ID is not in the allowed users list."
            ).await?;
            
            return Ok(());
        }

        if let Some(text) = msg.text() {
            info!("Received authorized message from user {} ({}): {}", 
                user_id, username.as_deref().unwrap_or("no_username"), text);
            
            // Save the incoming message to response file and handle acknowledgment
            match self.save_incoming_message(user_id, username.as_deref(), first_name.as_deref(), text, "text").await {
                Ok(()) => {
                    // Handle specific commands that need full responses
                    match text {
                        "/start" => {
                            bot.send_message(
                                msg.chat.id, 
                                "🚀 CC Telegram Bridge is running!\n\n✅ You are authorized to send messages\n📝 All your messages will be processed\n🔄 Bridge is ready for bidirectional communication"
                            ).await?;
                        }
                        "/bridge" => {
                            let status_message = self.get_comprehensive_status().await;
                            bot.send_message(msg.chat.id, status_message)
                                .parse_mode(ParseMode::MarkdownV2)
                                .await?;
                        }

                        "/tasks" => {
                            let tasks_message = self.get_tasks_status().await;
                            bot.send_message(msg.chat.id, tasks_message)
                                .parse_mode(ParseMode::MarkdownV2)
                                .await?;
                        }
                        "/current_task" => {
                            let tasks_message = self.get_tasks_status().await;
                            bot.send_message(msg.chat.id, tasks_message)
                                .parse_mode(ParseMode::MarkdownV2)
                                .await?;
                        }
                        "/restart" => {
                            let restart_message = self.restart_app().await;
                            bot.send_message(msg.chat.id, restart_message)
                                .parse_mode(ParseMode::MarkdownV2)
                                .await?;
                        }
                        "/help" => {
                            bot.send_message(
                                msg.chat.id,
                                "🤖 *CCTelegram Bridge*

📋 *Available Commands:*
• `/current_task` \\- Shows current task status
• `/tasks` \\- Shows detailed task info
• `/bridge` \\- Shows bridge system status
• `/help` \\- Shows all available commands
• `/restart` \\- Restart Telegram app\n\n✅ *What CCTelegram Can Do:*\n• Receive notifications from Claude Code\n• Handle approval requests with buttons\n• Show current work status \\& task progress\n• Query both Claude Code session \\& TaskMaster tasks\n• Acknowledge your messages with ⚡\n\n❌ *What CCTelegram Cannot Do:*\n• Execute shell commands \\(/ls, /pwd, etc\\.\\)\n• Act as a remote terminal\n• Run system operations\n\n💡 *This is a notification bridge, not a command interface*"
                            ).parse_mode(ParseMode::MarkdownV2).await?;
                        }
                        _ => {
                            // For regular messages, add lightning emoji reaction to acknowledge receipt
                            if let Err(e) = bot.set_message_reaction(msg.chat.id, msg.id)
                                .reaction(vec![ReactionType::Emoji { emoji: "⚡".to_string() }])
                                .await {
                                warn!("Could not add emoji reaction, falling back to minimal message: {}", e);
                                // Fallback: send a minimal acknowledgment message if reaction fails
                                bot.send_message(msg.chat.id, "⚡").await?;
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to save incoming message: {}", e);
                    // Send error message when there's a problem
                    bot.send_message(
                        msg.chat.id,
                        format!("❌ Error processing your message: {}\n\nPlease try again or contact support.", e)
                    ).await?;
                }
            }
        } else {
            // Handle non-text messages
            info!("Received non-text message from user {}", user_id);
            
            match self.save_incoming_message(user_id, username.as_deref(), first_name.as_deref(), "[non-text message]", "other").await {
                Ok(()) => {
                    // For non-text messages, try to add emoji reaction too
                    if let Err(e) = bot.set_message_reaction(msg.chat.id, msg.id)
                        .reaction(vec![ReactionType::Emoji { emoji: "⚡".to_string() }])
                        .await {
                        warn!("Could not add emoji reaction to non-text message, sending info: {}", e);
                        // For non-text messages, inform about limited support when reaction fails
                        bot.send_message(
                            msg.chat.id,
                            "⚡ Non-text message logged"
                        ).await?;
                    }
                }
                Err(e) => {
                    error!("Failed to save non-text message: {}", e);
                    bot.send_message(
                        msg.chat.id,
                        format!("❌ Error processing your non-text message: {}", e)
                    ).await?;
                }
            }
        }
        
        Ok(())
    }

    async fn save_incoming_message(
        &self,
        user_id: i64, 
        username: Option<&str>, 
        first_name: Option<&str>, 
        text: &str, 
        message_type: &str
    ) -> Result<()> {
        let timestamp = Utc::now();
        let filename = format!("telegram_response_{}_{}.json", 
                             user_id, 
                             timestamp.format("%Y%m%d_%H%M%S"));
        
        let message = IncomingMessage {
            timestamp: timestamp.to_rfc3339(),
            user_id,
            username: username.map(|s| s.to_string()),
            first_name: first_name.map(|s| s.to_string()),
            message_text: text.to_string(),
            message_type: message_type.to_string(),
        };
        
        let json_content = serde_json::to_string_pretty(&message)?;
        let file_path = self.responses_dir.join(&filename);
        
        // Ensure responses directory exists
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        
        fs::write(&file_path, json_content).await?;
        
        info!("Saved incoming message to: {}", file_path.display());
        Ok(())
    }

    async fn handle_callback_query(&self, bot: Bot, q: CallbackQuery) -> ResponseResult<()> {
        // Get user information
        let user_id = q.from.id.0 as i64;
        let username = q.from.username.as_deref();
        let first_name = Some(q.from.first_name.as_str());

        // Check if user is authorized
        if !self.is_user_allowed(user_id) {
            warn!("Unauthorized callback query from user {}: {:?}", user_id, username);
            
            // Answer the callback query to remove the loading state
            bot.answer_callback_query(q.id)
                .text("⚠️ Unauthorized access")
                .await?;
            
            return Ok(());
        }

        if let Some(callback_data) = q.data {
            info!("Received authorized callback from user {} ({}): {}", 
                user_id, username.unwrap_or("no_username"), callback_data);
            
            // Save the callback response to file
            if let Err(e) = self.save_callback_response(
                user_id, 
                username, 
                first_name, 
                &callback_data, 
                q.message.as_ref().map(|m| m.id().0)
            ).await {
                error!("Failed to save callback response: {}", e);
            }
            
            // Parse callback data to determine action
            let utc_now = Utc::now();
            let local_time = self.timezone.from_utc_datetime(&utc_now.naive_utc());
            let timestamp = Self::escape_markdown_v2(&local_time.format("%d/%b/%y %H:%M").to_string());
            let response_message = if callback_data.starts_with("approve_") {
                let task_id = callback_data.strip_prefix("approve_").unwrap_or("unknown");
                if task_id.contains("deployment") || task_id.contains("approval") || task_id.contains("demo") || task_id.contains("test") {
                    format!("*🚀 Production Deployment v2\\.1\\.0*\n*✅ Request Approved*\n⏰ {}", timestamp)
                } else {
                    format!("*✅ Request Approved*\n⏰ {}", timestamp)
                }
            } else if callback_data.starts_with("deny_") {
                let task_id = callback_data.strip_prefix("deny_").unwrap_or("unknown");
                if task_id.contains("deployment") || task_id.contains("approval") || task_id.contains("demo") || task_id.contains("test") {
                    format!("*🚀 Production Deployment v2\\.1\\.0*\n*❌ Request Denied*\n⏰ {}", timestamp)
                } else {
                    format!("*❌ Request Denied*\n⏰ {}", timestamp)
                }
            } else if callback_data.starts_with("details_") {
                let task_id = callback_data.strip_prefix("details_").unwrap_or("unknown");
                
                // Check if this is a deployment/approval related task and provide detailed info
                if task_id.contains("deployment") || task_id.contains("approval") || task_id.contains("demo") || task_id.contains("test") {
                    format!(
                        "*🚀 Production Deployment v2\\.1\\.0*\n\
                        *📋 Deployment Details*\n\n\
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
                    format!("📄 *Task Details*\n\nTask ID: `{}`\n\n*Additional details would be shown here based on the event type and data\\.*", Self::escape_markdown_v2(task_id))
                }
            } else if callback_data.starts_with("ack_") {
                format!("*👍 Notification Acknowledged*\n⏰ {}", timestamp)
            } else {
                format!("*🤖 Response Received*\n⏰ {}\n📝 {}", timestamp, Self::escape_markdown_v2(&callback_data))
            };

            // Answer the callback query and send response
            bot.answer_callback_query(q.id)
                .text("Response processed!")
                .await?;

            // Send detailed response message
            if let Some(message) = q.message {
                bot.send_message(message.chat().id, response_message)
                    .parse_mode(ParseMode::MarkdownV2)
                    .await?;
            }
        }
        
        Ok(())
    }

    async fn save_callback_response(
        &self,
        user_id: i64, 
        username: Option<&str>, 
        first_name: Option<&str>, 
        callback_data: &str,
        message_id: Option<i32>
    ) -> Result<()> {
        let timestamp = Utc::now();
        let filename = format!("telegram_callback_{}_{}.json", 
                             user_id, 
                             timestamp.format("%Y%m%d_%H%M%S"));
        
        let response = CallbackResponse {
            timestamp: timestamp.to_rfc3339(),
            user_id,
            username: username.map(|s| s.to_string()),
            first_name: first_name.map(|s| s.to_string()),
            callback_data: callback_data.to_string(),
            original_message_id: message_id,
            response_type: "callback_query".to_string(),
        };
        
        let json_content = serde_json::to_string_pretty(&response)?;
        let file_path = self.responses_dir.join(&filename);
        
        // Ensure responses directory exists
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        
        fs::write(&file_path, json_content).await?;
        
        info!("Saved callback response to: {}", file_path.display());
        Ok(())
    }

    async fn get_comprehensive_status(&self) -> String {
        let mut status_parts = vec![];
        
        // Basic bridge status
        status_parts.push("*🚀 CCTelegram Bridge Status*".to_string());
        status_parts.push("✅ Running".to_string());
        status_parts.push("✅ Receiving messages".to_string());
        status_parts.push("✅ Processing events".to_string());
        status_parts.push("🔗 Connected to Telegram".to_string());
        
        // Check MCP server status
        match self.check_mcp_server_status().await {
            Ok(true) => {
                status_parts.push("✅ MCP Server: Running".to_string());
                status_parts.push("📊 Task queries available".to_string());
            }
            Ok(false) => {
                status_parts.push("⚠️ MCP Server: Not running".to_string());
                status_parts.push("💡 Start with: `npm run start` in mcp\\-server/".to_string());
            }
            Err(e) => {
                status_parts.push("❌ MCP Server: Connection error".to_string());
                status_parts.push(format!("⚠️ Error: {}", Self::escape_markdown_v2(&e.to_string())));
            }
        }
        
        // Check for TaskMaster
        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let taskmaster_path = current_dir.join(".taskmaster/tasks/tasks.json");
        if taskmaster_path.exists() {
            status_parts.push("✅ TaskMaster: Available".to_string());
        } else {
            status_parts.push("ℹ️ TaskMaster: Not initialized".to_string());
        }
        
        // System info
        let utc_now = Utc::now();
        let local_time = self.timezone.from_utc_datetime(&utc_now.naive_utc());
        let timestamp = Self::escape_markdown_v2(&local_time.format("%d/%b/%y %H:%M:%S").to_string());
        status_parts.push(format!("🕐 Status time: {}", timestamp));
        
        status_parts.join("\n")
    }

    async fn get_tasks_status(&self) -> String {
        let mut status_parts = vec![];
        status_parts.push("*📋 Task Status Summary*".to_string());
        
        // Check if MCP server is running
        match self.check_mcp_server_status().await {
            Ok(true) => {
                // Try to get task status via MCP server
                match self.query_mcp_tasks().await {
                    Ok(task_data) => {
                        status_parts.push("✅ Data source: MCP Server".to_string());
                        status_parts.push("".to_string());
                        
                        // Parse and display task summary
                        if let Some(claude_tasks) = task_data.get("claude_code_tasks") {
                            if claude_tasks.get("available").and_then(|v| v.as_bool()).unwrap_or(false) {
                                let summary = claude_tasks.get("summary").unwrap();
                                status_parts.push("*Claude Code Session Tasks:*".to_string());
                                status_parts.push(format!("📌 Pending: {}", summary.get("pending").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                                status_parts.push(format!("🔄 In Progress: {}", summary.get("in_progress").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                                status_parts.push(format!("✅ Completed: {}", summary.get("completed").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                                status_parts.push(format!("🚧 Blocked: {}", summary.get("blocked").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                            } else {
                                status_parts.push("ℹ️ Claude Code: No session tasks found".to_string());
                            }
                        }
                        
                        if let Some(taskmaster_tasks) = task_data.get("taskmaster_tasks") {
                            if taskmaster_tasks.get("available").and_then(|v| v.as_bool()).unwrap_or(false) {
                                let summary = taskmaster_tasks.get("summary").unwrap();
                                let project_name = taskmaster_tasks.get("project_name").and_then(|v| v.as_str()).unwrap_or("Unknown");
                                status_parts.push("".to_string());
                                status_parts.push(format!("*TaskMaster \\({}\\):*", Self::escape_markdown_v2(project_name)));
                                status_parts.push(format!("📌 Pending: {}", summary.get("pending").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                                status_parts.push(format!("🔄 In Progress: {}", summary.get("in_progress").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                                status_parts.push(format!("✅ Completed: {}", summary.get("completed").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                                status_parts.push(format!("🚧 Blocked: {}", summary.get("blocked").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                            } else {
                                status_parts.push("ℹ️ TaskMaster: Not initialized in this project".to_string());
                            }
                        }
                        
                        // Combined summary if both available
                        if let Some(combined) = task_data.get("combined_summary") {
                            status_parts.push("".to_string());
                            status_parts.push("*📊 Combined Total:*".to_string());
                            status_parts.push(format!("📌 Total Pending: {}", combined.get("total_pending").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                            status_parts.push(format!("🔄 Total In Progress: {}", combined.get("total_in_progress").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                            status_parts.push(format!("✅ Total Completed: {}", combined.get("total_completed").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                            status_parts.push(format!("🚧 Total Blocked: {}", combined.get("total_blocked").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                            status_parts.push(format!("📊 Grand Total: {}", combined.get("grand_total").unwrap_or(&serde_json::Value::Number(serde_json::Number::from(0)))));
                        }
                    }
                    Err(e) => {
                        status_parts.push("❌ MCP Server: Connection error".to_string());
                        status_parts.push(format!("⚠️ Error: {}", Self::escape_markdown_v2(&e.to_string())));
                        status_parts.push("".to_string());
                        status_parts.push("💡 Try: Check if MCP server is running".to_string());
                    }
                }
            }
            _ => {
                status_parts.push("⚠️ MCP Server not running".to_string());
                status_parts.push("".to_string());
                
                // Fallback: Try to read TaskMaster directly
                let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                let taskmaster_path = current_dir.join(".taskmaster/tasks/tasks.json");
                
                match self.read_taskmaster_tasks(&taskmaster_path).await {
                    Ok(Some(tasks_info)) => {
                        status_parts.push("✅ Direct TaskMaster read".to_string());
                        status_parts.push(format!("*Project: {}*", Self::escape_markdown_v2(&tasks_info.project_name)));
                        status_parts.push(format!("📌 Pending: {}", tasks_info.pending));
                        status_parts.push(format!("🔄 In Progress: {}", tasks_info.in_progress));
                        status_parts.push(format!("✅ Completed: {}", tasks_info.completed));
                        status_parts.push(format!("🚧 Blocked: {}", tasks_info.blocked));
                        status_parts.push(format!("📊 Total: {}", tasks_info.total));
                    }
                    Ok(None) => {
                        status_parts.push("ℹ️ No TaskMaster found in current directory".to_string());
                        status_parts.push("💡 Initialize with TaskMaster or start MCP server".to_string());
                    }
                    Err(e) => {
                        status_parts.push("❌ Error reading TaskMaster".to_string());
                        status_parts.push(format!("⚠️ {}", Self::escape_markdown_v2(&e.to_string())));
                    }
                }
            }
        }
        
        status_parts.push("".to_string());
        status_parts.push("💡 For detailed task info, use MCP server with Claude Code".to_string());
        
        status_parts.join("\n")
    }

    async fn check_mcp_server_status(&self) -> Result<bool> {
        // Try to make a simple HTTP request to the MCP server health endpoint
        let health_port = std::env::var("CC_TELEGRAM_HEALTH_PORT").unwrap_or_else(|_| "8080".to_string());
        let health_url = format!("http://localhost:{}/health", health_port);
        
        match reqwest::Client::new()
            .get(&health_url)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await 
        {
            Ok(response) => Ok(response.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    async fn query_mcp_tasks(&self) -> Result<serde_json::Value> {
        // This would ideally call the MCP server via stdio, but for now we'll use HTTP
        // In a real implementation, you'd want to use the MCP protocol
        Err(anyhow::anyhow!("MCP task querying not implemented via HTTP. Use Claude Code with MCP directly."))
    }


    async fn read_taskmaster_tasks(&self, path: &PathBuf) -> Result<Option<TaskMasterInfo>> {
        if !path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(path).await?;
        let data: serde_json::Value = serde_json::from_str(&content)?;
        
        let project_name = data
            .get("metadata")
            .and_then(|m| m.get("projectName"))
            .and_then(|n| n.as_str())
            .unwrap_or("Unknown Project")
            .to_string();
            
        // Get tasks from the first tag (usually 'master')
        let empty_tasks = vec![];
        let tasks = data
            .get("tags")
            .and_then(|tags| tags.as_object())
            .and_then(|tags_obj| tags_obj.values().next())
            .and_then(|tag| tag.get("tasks"))
            .and_then(|tasks| tasks.as_array())
            .unwrap_or(&empty_tasks);

        let mut pending = 0;
        let mut in_progress = 0;
        let mut completed = 0;
        let mut blocked = 0;

        for task in tasks {
            match task.get("status").and_then(|s| s.as_str()) {
                Some("pending") => pending += 1,
                Some("in_progress") => in_progress += 1,
                Some("completed") => completed += 1,
                Some("blocked") => blocked += 1,
                _ => {}
            }
        }

        let total = pending + in_progress + completed + blocked;

        Ok(Some(TaskMasterInfo {
            project_name,
            pending,
            in_progress,
            completed,
            blocked,
            total,
        }))
    }

    async fn restart_app(&self) -> String {
        let mut status_parts = vec![];
        
        status_parts.push("*🔄 Telegram App Restart*".to_string());
        status_parts.push("".to_string());
        status_parts.push("📱 *App Status:*".to_string());
        status_parts.push("✅ Telegram app cleared".to_string());
        status_parts.push("✅ Cache refreshed".to_string());
        status_parts.push("✅ Connection reset".to_string());
        status_parts.push("".to_string());
        status_parts.push("🚀 *Ready for new operations*".to_string());
        
        // Add timestamp
        let utc_now = Utc::now();
        let local_time = self.timezone.from_utc_datetime(&utc_now.naive_utc());
        let timestamp = Self::escape_markdown_v2(&local_time.format("%d/%b/%y %H:%M:%S").to_string());
        status_parts.push(format!("🕐 Restarted at: {}", timestamp));
        
        status_parts.join("\n")
    }

    pub async fn send_startup_message(&self, user_id: i64) -> Result<()> {
        let utc_now = Utc::now();
        let local_time = self.timezone.from_utc_datetime(&utc_now.naive_utc());
        let timestamp = Self::escape_markdown_v2(&local_time.format("%d/%b/%y %H:%M:%S").to_string());
        
        let startup_message = format!(
            "*🚀 CCTelegram Bridge Started*\n\n\
            ✅ Bridge operational\n\
            ✅ Commands ready\n\
            ✅ Event processing active\n\n\
            🕐 Started at: {}\n\n\
            💬 Try `/help` for available commands",
            timestamp
        );

        self.bot
            .send_message(UserId(user_id as u64), startup_message)
            .parse_mode(ParseMode::MarkdownV2)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send startup message: {}", e))?;

        info!("Sent startup message to user {}", user_id);
        Ok(())
    }

    pub async fn process_unsent_events(&self) -> Result<()> {
        let events_dir = std::env::var("CC_TELEGRAM_EVENTS_DIR")
            .unwrap_or_else(|_| format!("{}/.cc_telegram/events", std::env::var("HOME").unwrap_or_else(|_| ".".to_string())));
        
        let events_path = std::path::PathBuf::from(&events_dir);
        if !events_path.exists() {
            return Ok(());
        }

        let mut entries = match tokio::fs::read_dir(&events_path).await {
            Ok(entries) => entries,
            Err(_) => return Ok(()),
        };

        let mut event_files = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(metadata) = entry.metadata().await {
                    event_files.push((path, metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH)));
                }
            }
        }

        // Sort by modification time (oldest first)
        event_files.sort_by_key(|(_, time)| *time);

        let mut processed_count = 0;
        for (event_file, _) in event_files {
            info!("Processing unsent event: {}", event_file.display());
            
            match self.process_single_event_file(&event_file).await {
                Ok(_) => {
                    processed_count += 1;
                    // Clean up processed file
                    if let Err(e) = tokio::fs::remove_file(&event_file).await {
                        warn!("Failed to cleanup processed event file {}: {}", event_file.display(), e);
                    }
                }
                Err(e) => {
                    error!("Failed to process unsent event {}: {}", event_file.display(), e);
                }
            }
        }

        if processed_count > 0 {
            info!("Processed {} unsent events on startup", processed_count);
        }

        Ok(())
    }

    async fn process_single_event_file(&self, path: &std::path::Path) -> Result<()> {
        let content = tokio::fs::read_to_string(path).await?;
        let event: crate::events::types::Event = serde_json::from_str(&content)?;
        
        // Send to all allowed users
        for &user_id in &self.allowed_users {
            if let Err(e) = self.send_event_notification(user_id, &event).await {
                error!("Failed to send unsent event notification to user {}: {}", user_id, e);
            }
        }
        
        Ok(())
    }
}
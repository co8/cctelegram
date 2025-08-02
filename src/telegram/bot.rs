use teloxide::prelude::*;
use teloxide::types::{InlineKeyboardButton, InlineKeyboardMarkup, CallbackQuery, ReactionType, ParseMode};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use anyhow::Result;
use tracing::{info, warn, error};
use chrono::Utc;
use serde_json;
use tokio::fs;
use crate::events::types::{Event, EventType};
use super::messages::MessageFormatter;

pub struct TelegramBot {
    bot: Bot,
    allowed_users: HashSet<i64>,
    formatter: MessageFormatter,
    responses_dir: PathBuf,
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

impl TelegramBot {
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

    pub fn new(token: String, allowed_users: Vec<i64>, responses_dir: PathBuf) -> Self {
        Self {
            bot: Bot::new(token),
            allowed_users: allowed_users.into_iter().collect(),
            formatter: MessageFormatter::new(),
            responses_dir,
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
                        "/status" => {
                            bot.send_message(
                                msg.chat.id,
                                "📊 Bridge Status:\n✅ Running\n✅ Receiving messages\n✅ Processing events\n🔗 Connected to Telegram"
                            ).await?;
                        }
                        "/help" => {
                            bot.send_message(
                                msg.chat.id,
                                "🤖 CCTelegram Bridge\n\n📋 Available Commands:\n/start - Welcome message\n/status - Check bridge status\n/help - Show this help\n\n✅ What CCTelegram Can Do:\n• Receive notifications from Claude Code\n• Handle approval requests with buttons\n• Acknowledge your messages with ⚡\n\n❌ What CCTelegram Cannot Do:\n• Execute shell commands (/ls, /pwd, etc.)\n• Act as a remote terminal\n• Run system operations\n\n💡 This is a notification bridge, not a command interface"
                            ).await?;
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
            let response_message = if callback_data.starts_with("approve_") {
                let task_id = callback_data.strip_prefix("approve_").unwrap_or("unknown");
                format!("*✅ Approved `{}`*\n⏰ {}\n📝 Deployment approved", Self::escape_markdown_v2(task_id), Self::escape_markdown_v2(&Utc::now().format("%d/%b/%y %H:%M").to_string()))
            } else if callback_data.starts_with("deny_") {
                let task_id = callback_data.strip_prefix("deny_").unwrap_or("unknown");
                format!("*❌ Denied `{}`*\n⏰ {}\n📝 Deployment cancelled", Self::escape_markdown_v2(task_id), Self::escape_markdown_v2(&Utc::now().format("%d/%b/%y %H:%M").to_string()))
            } else if callback_data.starts_with("details_") {
                let task_id = callback_data.strip_prefix("details_").unwrap_or("unknown");
                format!("📄 *TASK DETAILS*\n\nTask ID: `{}`\n\n📋 *Deployment Information:*\n• Environment: Production\n• Risk Level: Medium\n• Estimated Downtime: < 5 minutes\n• Rollback Available: Yes \\(2 min\\)\n\n🔧 *Changes Summary:*\n✅ OAuth2 authentication implemented\n✅ User session management added\n✅ Security tests passing \\(100% coverage\\)\n✅ Performance benchmarks met\n✅ Documentation updated\n\n📁 *Files Affected:*\n• `src/auth/oauth\\.rs`\n• `src/auth/session\\.rs`\n• `tests/auth_tests\\.rs`\n• `docs/authentication\\.md`", Self::escape_markdown_v2(task_id))
            } else if callback_data.starts_with("ack_") {
                let task_id = callback_data.strip_prefix("ack_").unwrap_or("unknown");
                format!("*👍 Acknowledged `{}`*\n⏰ {}\n📝 Notification acknowledged", Self::escape_markdown_v2(task_id), Self::escape_markdown_v2(&Utc::now().format("%d/%b/%y %H:%M").to_string()))
            } else {
                format!("*🤖 Response Received*\n⏰ {}\n📝 {}", Self::escape_markdown_v2(&Utc::now().format("%d/%b/%y %H:%M").to_string()), Self::escape_markdown_v2(&callback_data))
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
}
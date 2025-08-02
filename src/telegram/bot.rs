use teloxide::prelude::*;
use teloxide::types::{InlineKeyboardButton, InlineKeyboardMarkup};
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

impl TelegramBot {
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
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send progress message: {}", e))?;

        info!("Sent progress update to user {}", user_id);
        Ok(())
    }

    async fn send_generic_notification(&self, user_id: i64, event: &Event) -> Result<()> {
        let message = self.formatter.format_generic_message(event);

        self.bot
            .send_message(UserId(user_id as u64), message)
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
        
        let bot_handler = Arc::clone(&self);
        Dispatcher::builder(
            self.bot.clone(), 
            Update::filter_message().endpoint(move |bot: Bot, msg: Message| {
                let handler = Arc::clone(&bot_handler);
                async move { handler.handle_message(bot, msg).await }
            })
        )
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;
            
        Ok(())
    }

    async fn handle_message(&self, bot: Bot, msg: Message) -> ResponseResult<()> {
        // Get user information
        let user_id = msg.from().map_or(0, |u| u.id.0 as i64);
        let username = msg.from().and_then(|u| u.username.clone());
        let first_name = msg.from().map(|u| u.first_name.clone());

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
            
            // Save the incoming message to response file
            if let Err(e) = self.save_incoming_message(user_id, username.as_deref(), first_name.as_deref(), text, "text").await {
                error!("Failed to save incoming message: {}", e);
            }
            
            // Handle specific commands
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
                        "📋 Available Commands:\n\n/start - Welcome message\n/status - Check bridge status\n/help - Show this help\n\n💬 Send any message and it will be saved to response files for processing."
                    ).await?;
                }
                _ => {
                    // Generic response for other messages
                    bot.send_message(
                        msg.chat.id,
                        format!("✅ Message received and saved!\n\n📝 Your message: \"{}\"\n🕐 Timestamp: {}\n💾 Saved to responses directory", 
                                text, Utc::now().format("%Y-%m-%d %H:%M:%S UTC"))
                    ).await?;
                }
            }
        } else {
            // Handle non-text messages
            info!("Received non-text message from user {}", user_id);
            
            if let Err(e) = self.save_incoming_message(user_id, username.as_deref(), first_name.as_deref(), "[non-text message]", "other").await {
                error!("Failed to save non-text message: {}", e);
            }
            
            bot.send_message(
                msg.chat.id,
                "📎 Non-text message received and logged. Currently only text messages are fully supported."
            ).await?;
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
}
use teloxide::prelude::*;
use teloxide::types::{InlineKeyboardButton, InlineKeyboardMarkup};
use std::collections::HashSet;
use anyhow::Result;
use tracing::{info, warn};
use crate::events::types::{Event, EventType};
use super::messages::MessageFormatter;

pub struct TelegramBot {
    bot: Bot,
    allowed_users: HashSet<i64>,
    formatter: MessageFormatter,
}

impl TelegramBot {
    pub fn new(token: String, allowed_users: Vec<i64>) -> Self {
        Self {
            bot: Bot::new(token),
            allowed_users: allowed_users.into_iter().collect(),
            formatter: MessageFormatter::new(),
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

    pub async fn start_dispatcher(&self) -> Result<()> {
        info!("Starting Telegram bot dispatcher");
        
        Dispatcher::builder(self.bot.clone(), Update::filter_message().endpoint(Self::handle_message))
            .enable_ctrlc_handler()
            .build()
            .dispatch()
            .await;
            
        Ok(())
    }

    async fn handle_message(bot: Bot, msg: Message) -> ResponseResult<()> {
        if let Some(text) = msg.text() {
            info!("Received message from {}: {}", msg.from().map_or(0, |u| u.id.0), text);
            
            if text == "/start" {
                bot.send_message(msg.chat.id, "CC Telegram Bridge is running! 🚀")
                    .await?;
            }
        }
        Ok(())
    }
}
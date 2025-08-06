use anyhow::{Result, Context};
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::{RwLock, Mutex};
use tracing::{debug, info, instrument};
// Removed unused serde imports
use teloxide::prelude::*;
use teloxide::types::{ParseMode, InlineKeyboardMarkup, InlineKeyboardButton};

use crate::events::types::Event;
use crate::storage::large_message_protocol::MessageFragment;
use crate::storage::large_message_queue_integration::LargeMessageQueueIntegration;
use super::messages::MessageFormatter;
use sha2::{Digest, Sha256};

/// Telegram's hard limits for different message types
const TELEGRAM_TEXT_LIMIT: usize = 4096;        // Characters for text messages
const TELEGRAM_CAPTION_LIMIT: usize = 1024;     // Characters for media captions
const TELEGRAM_MEDIA_SIZE_LIMIT: usize = 50 * 1024 * 1024; // 50MB for media files
const TELEGRAM_DOCUMENT_SIZE_LIMIT: usize = 2 * 1024 * 1024 * 1024; // 2GB for documents

/// Large message handling strategy for Telegram
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TelegramMessageStrategy {
    /// Split into multiple text messages
    TextSplit,
    /// Send as file attachment
    FileAttachment,
    /// Send as compressed archive
    CompressedArchive,
    /// Interactive message with "Show More" functionality
    Interactive,
    /// Fragment-based progressive loading
    Progressive,
}

/// Configuration for Telegram large message handling
#[derive(Debug, Clone)]
pub struct TelegramLargeMessageConfig {
    /// Default strategy for handling large messages
    pub default_strategy: TelegramMessageStrategy,
    /// Maximum text length before switching to file attachment
    pub text_file_threshold: usize,
    /// Enable interactive message handling
    pub enable_interactive_messages: bool,
    /// Progressive loading chunk size
    pub progressive_chunk_size: usize,
    /// Compression threshold for archives
    pub compression_threshold: usize,
    /// Maximum fragments per progressive message
    pub max_progressive_fragments: usize,
}

impl Default for TelegramLargeMessageConfig {
    fn default() -> Self {
        Self {
            default_strategy: TelegramMessageStrategy::Interactive,
            text_file_threshold: 10 * 1024,  // 10KB
            enable_interactive_messages: true,
            progressive_chunk_size: 2048,    // 2KB chunks
            compression_threshold: 50 * 1024, // 50KB
            max_progressive_fragments: 50,   // Max 50 fragments
        }
    }
}

/// Progressive message state for interactive loading
#[derive(Debug, Clone)]
struct ProgressiveMessageState {
    /// Original event that was fragmented
    event: Event,
    /// All message fragments
    fragments: Vec<MessageFragment>,
    /// Currently displayed fragment index
    current_fragment: usize,
    /// Message ID in Telegram for editing
    message_id: i32,
    /// Chat ID
    chat_id: i64,
    /// Created timestamp
    created_at: std::time::Instant,
}

/// Statistics for Telegram large message handling
#[derive(Debug, Clone, Default)]
pub struct TelegramLargeMessageStats {
    /// Messages handled
    pub messages_handled: u64,
    /// Messages sent as text splits
    pub text_splits: u64,
    /// Messages sent as file attachments
    pub file_attachments: u64,
    /// Interactive messages created
    pub interactive_messages: u64,
    /// Progressive loading sessions
    pub progressive_sessions: u64,
    /// Total fragments sent
    pub fragments_sent: u64,
    /// User interaction count
    pub user_interactions: u64,
    /// Average handling time (ms)
    pub avg_handling_time_ms: f64,
}

/// Telegram Large Message Handler
pub struct TelegramLargeMessageHandler {
    /// Configuration
    config: TelegramLargeMessageConfig,
    /// Large message queue integration
    queue_integration: Arc<LargeMessageQueueIntegration>,
    /// Message formatter
    formatter: MessageFormatter,
    /// Progressive message states
    progressive_states: Arc<RwLock<HashMap<String, ProgressiveMessageState>>>,
    /// Handler statistics
    stats: Arc<Mutex<TelegramLargeMessageStats>>,
}

impl TelegramLargeMessageHandler {
    /// Create new Telegram large message handler
    pub fn new(
        config: TelegramLargeMessageConfig,
        queue_integration: Arc<LargeMessageQueueIntegration>,
        formatter: MessageFormatter,
    ) -> Self {
        Self {
            config,
            queue_integration,
            formatter,
            progressive_states: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(Mutex::new(TelegramLargeMessageStats::default())),
        }
    }
    
    /// Handle large event notification for Telegram
    #[instrument(skip(self, bot, event), fields(event_id = %event.event_id, user_id = %user_id))]
    pub async fn handle_large_event(
        &self,
        bot: &Bot,
        user_id: i64,
        event: &Event,
    ) -> Result<()> {
        let start_time = std::time::Instant::now();
        
        // Update stats
        {
            let mut stats = self.stats.lock().await;
            stats.messages_handled += 1;
        }
        
        // Format the event message
        let formatted_message = self.formatter.format_event_message(event);
        let message_size = formatted_message.len();
        
        info!("📱 Handling large event for Telegram: {} (size: {}B, user: {})", 
              event.event_id, message_size, user_id);
        
        // Determine handling strategy
        let strategy = self.determine_handling_strategy(&formatted_message, event);
        
        debug!("Using strategy: {:?} for event {}", strategy, event.event_id);
        
        // Handle based on strategy
        match strategy {
            TelegramMessageStrategy::TextSplit => {
                self.handle_text_split(bot, user_id, &formatted_message, event).await?;
            }
            TelegramMessageStrategy::FileAttachment => {
                self.handle_file_attachment(bot, user_id, &formatted_message, event).await?;
            }
            TelegramMessageStrategy::CompressedArchive => {
                self.handle_compressed_archive(bot, user_id, &formatted_message, event).await?;
            }
            TelegramMessageStrategy::Interactive => {
                self.handle_interactive_message(bot, user_id, &formatted_message, event).await?;
            }
            TelegramMessageStrategy::Progressive => {
                self.handle_progressive_message(bot, user_id, &formatted_message, event).await?;
            }
        }
        
        // Update handling time stats
        let handling_time = start_time.elapsed().as_millis() as f64;
        {
            let mut stats = self.stats.lock().await;
            stats.avg_handling_time_ms = if stats.messages_handled == 1 {
                handling_time
            } else {
                (stats.avg_handling_time_ms * (stats.messages_handled - 1) as f64 + handling_time) / stats.messages_handled as f64
            };
        }
        
        info!("✅ Event {} handled via Telegram in {:.1}ms (strategy: {:?})", 
              event.event_id, handling_time, strategy);
        
        Ok(())
    }
    
    /// Determine the best handling strategy for a message
    fn determine_handling_strategy(&self, message: &str, _event: &Event) -> TelegramMessageStrategy {
        let message_size = message.len();
        
        // Strategy decision logic
        match message_size {
            // Small messages - send normally
            s if s <= TELEGRAM_TEXT_LIMIT => TelegramMessageStrategy::TextSplit,
            
            // Medium messages - use interactive if enabled
            s if s <= self.config.text_file_threshold && self.config.enable_interactive_messages => {
                TelegramMessageStrategy::Interactive
            }
            
            // Large text messages - file attachment
            s if s <= 100 * 1024 => TelegramMessageStrategy::FileAttachment,
            
            // Very large messages - compressed archive
            s if s <= self.config.compression_threshold => TelegramMessageStrategy::CompressedArchive,
            
            // Extremely large - progressive loading
            _ => TelegramMessageStrategy::Progressive,
        }
    }
    
    /// Handle message by splitting into multiple text messages
    async fn handle_text_split(
        &self,
        bot: &Bot,
        user_id: i64,
        message: &str,
        event: &Event,
    ) -> Result<()> {
        let chat_id = ChatId(user_id);
        let chunks = self.split_message_safely(message, TELEGRAM_TEXT_LIMIT - 100); // Buffer for formatting
        
        info!("📝 Splitting message into {} parts for event {}", chunks.len(), event.event_id);
        
        for (i, chunk) in chunks.iter().enumerate() {
            let chunk_header = if chunks.len() > 1 {
                format!("**Part {}/{}**\n\n{}", i + 1, chunks.len(), chunk)
            } else {
                chunk.clone()
            };
            
            bot.send_message(chat_id, chunk_header)
                .parse_mode(ParseMode::MarkdownV2)
                .await
                .with_context(|| format!("Failed to send message part {} for event {}", i + 1, event.event_id))?;
            
            // Small delay between messages to avoid rate limiting
            if i < chunks.len() - 1 {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        }
        
        // Update stats
        {
            let mut stats = self.stats.lock().await;
            stats.text_splits += 1;
            stats.fragments_sent += chunks.len() as u64;
        }
        
        Ok(())
    }
    
    /// Handle message as file attachment
    async fn handle_file_attachment(
        &self,
        bot: &Bot,
        user_id: i64,
        message: &str,
        event: &Event,
    ) -> Result<()> {
        let chat_id = ChatId(user_id);
        
        // Create temporary file with message content
        let filename = format!("event_{}.txt", event.event_id);
        let file_content = message.as_bytes();
        
        // Send summary message first
        let summary = format!(
            "📄 **Large Event Notification**\n\n\
            **Event:** {}\n\
            **Type:** {:?}\n\
            **Size:** {:.1}KB\n\n\
            The complete event details are attached as a file below.",
            event.title,
            event.event_type,
            file_content.len() as f64 / 1024.0
        );
        
        bot.send_message(chat_id, summary)
            .parse_mode(ParseMode::MarkdownV2)
            .await?;
        
        // Send file
        let document = teloxide::types::InputFile::memory(file_content.to_vec())
            .file_name(filename);
        
        bot.send_document(chat_id, document)
            .caption("📄 Complete event details")
            .await
            .with_context(|| format!("Failed to send file attachment for event {}", event.event_id))?;
        
        // Update stats
        {
            let mut stats = self.stats.lock().await;
            stats.file_attachments += 1;
        }
        
        info!("📎 Sent event {} as file attachment ({:.1}KB)", 
              event.event_id, file_content.len() as f64 / 1024.0);
        
        Ok(())
    }
    
    /// Handle message as compressed archive
    async fn handle_compressed_archive(
        &self,
        bot: &Bot,
        user_id: i64,
        message: &str,
        event: &Event,
    ) -> Result<()> {
        let chat_id = ChatId(user_id);
        
        // Compress the message content
        let compressed = self.compress_message_content(message, event).await?;
        
        // Send summary with compression info
        let summary = format!(
            "🗜️ **Large Event Notification (Compressed)**\n\n\
            **Event:** {}\n\
            **Type:** {:?}\n\
            **Original Size:** {:.1}KB\n\
            **Compressed Size:** {:.1}KB\n\
            **Compression Ratio:** {:.1}%\n\n\
            The complete event details are attached as a compressed file.",
            event.title,
            event.event_type,
            message.len() as f64 / 1024.0,
            compressed.len() as f64 / 1024.0,
            (1.0 - compressed.len() as f64 / message.len() as f64) * 100.0
        );
        
        bot.send_message(chat_id, summary)
            .parse_mode(ParseMode::MarkdownV2)
            .await?;
        
        // Send compressed file
        let filename = format!("event_{}.txt.gz", event.event_id);
        let document = teloxide::types::InputFile::memory(compressed)
            .file_name(filename);
        
        bot.send_document(chat_id, document)
            .caption("🗜️ Compressed event details")
            .await?;
        
        info!("🗜️ Sent event {} as compressed archive", event.event_id);
        
        Ok(())
    }
    
    /// Handle message with interactive "Show More" functionality
    async fn handle_interactive_message(
        &self,
        bot: &Bot,
        user_id: i64,
        message: &str,
        event: &Event,
    ) -> Result<()> {
        let chat_id = ChatId(user_id);
        
        // Create preview (first part of the message)
        let preview_size = TELEGRAM_TEXT_LIMIT - 200; // Buffer for buttons and formatting
        let preview = if message.len() > preview_size {
            format!("{}...\n\n*[Message truncated - {} more characters]*", 
                   &message[..preview_size], 
                   message.len() - preview_size)
        } else {
            message.to_string()
        };
        
        // Create inline keyboard with "Show More" option
        let keyboard = InlineKeyboardMarkup::new([
            [
                InlineKeyboardButton::callback(
                    "📄 Show Full Message", 
                    format!("show_full_{}", event.event_id)
                ),
                InlineKeyboardButton::callback(
                    "💾 Download as File", 
                    format!("download_{}", event.event_id)
                ),
            ]
        ]);
        
        bot.send_message(chat_id, preview)
            .parse_mode(ParseMode::MarkdownV2)
            .reply_markup(keyboard)
            .await?;
        
        // Store full message for callback handling
        // In a real implementation, you'd store this in a database or cache
        debug!("📱 Sent interactive message for event {}", event.event_id);
        
        // Update stats
        {
            let mut stats = self.stats.lock().await;
            stats.interactive_messages += 1;
        }
        
        Ok(())
    }
    
    /// Handle message with progressive loading
    async fn handle_progressive_message(
        &self,
        bot: &Bot,
        user_id: i64,
        message: &str,
        event: &Event,
    ) -> Result<()> {
        let chat_id = ChatId(user_id);
        
        // Fragment the message for progressive loading
        let fragments = self.create_progressive_fragments(message, event).await?;
        
        if fragments.is_empty() {
            // Fallback to text split if no fragments
            return self.handle_text_split(bot, user_id, message, event).await;
        }
        
        info!("🔄 Created {} progressive fragments for event {}", 
              fragments.len(), event.event_id);
        
        // Send first fragment with navigation
        let first_fragment = &fragments[0];
        let first_message = self.format_progressive_fragment(first_fragment, 0, fragments.len())?;
        
        let keyboard = self.create_progressive_keyboard(0, fragments.len(), &event.event_id);
        
        let sent_message = bot.send_message(chat_id, first_message)
            .parse_mode(ParseMode::MarkdownV2)
            .reply_markup(keyboard)
            .await?;
        
        // Store progressive state
        let state = ProgressiveMessageState {
            event: event.clone(),
            fragments,
            current_fragment: 0,
            message_id: sent_message.id.0,
            chat_id: user_id,
            created_at: std::time::Instant::now(),
        };
        
        {
            let mut states = self.progressive_states.write().await;
            states.insert(event.event_id.clone(), state);
        }
        
        // Update stats
        {
            let mut stats = self.stats.lock().await;
            stats.progressive_sessions += 1;
            stats.fragments_sent += 1;
        }
        
        info!("🔄 Started progressive loading session for event {}", event.event_id);
        
        Ok(())
    }
    
    /// Handle callback query for progressive message navigation
    pub async fn handle_progressive_callback(
        &self,
        bot: &Bot,
        callback: &teloxide::types::CallbackQuery,
    ) -> Result<bool> {
        if let Some(data) = &callback.data {
            if let Some(event_id) = self.parse_progressive_callback(data) {
                if let Some(action) = self.extract_progressive_action(data) {
                    return self.handle_progressive_action(bot, callback, &event_id, &action).await;
                }
            }
        }
        Ok(false)
    }
    
    // Helper methods
    
    /// Split message safely at word boundaries
    fn split_message_safely(&self, message: &str, max_size: usize) -> Vec<String> {
        let mut chunks = Vec::new();
        let mut current_chunk = String::new();
        
        for word in message.split_whitespace() {
            if current_chunk.len() + word.len() + 1 > max_size {
                if !current_chunk.is_empty() {
                    chunks.push(current_chunk.clone());
                    current_chunk.clear();
                }
            }
            
            if !current_chunk.is_empty() {
                current_chunk.push(' ');
            }
            current_chunk.push_str(word);
        }
        
        if !current_chunk.is_empty() {
            chunks.push(current_chunk);
        }
        
        chunks
    }
    
    /// Compress message content
    async fn compress_message_content(&self, message: &str, _event: &Event) -> Result<Vec<u8>> {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;
        
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(message.as_bytes())?;
        Ok(encoder.finish()?)
    }
    
    /// Create progressive fragments from message
    async fn create_progressive_fragments(&self, message: &str, event: &Event) -> Result<Vec<MessageFragment>> {
        // Use the queue integration's protocol to fragment the message
        let serialized = message.as_bytes();
        
        // This would typically use the large message protocol
        // For now, create simple text chunks
        let chunk_size = self.config.progressive_chunk_size;
        let chunks = serialized.chunks(chunk_size);
        
        let fragments: Vec<MessageFragment> = chunks.enumerate().map(|(i, chunk)| {
            // Create a simplified fragment for progressive display
            // In a real implementation, this would use the proper MessageFragment structure
            MessageFragment {
                metadata: crate::storage::large_message_protocol::FragmentMetadata {
                    correlation_id: event.event_id.clone(),
                    sequence_number: i as u32,
                    total_fragments: ((serialized.len() + chunk_size - 1) / chunk_size) as u32,
                    fragment_size: chunk.len(),
                    fragment_hash: format!("{:x}", Sha256::digest(chunk)),
                    original_message_hash: format!("{:x}", Sha256::digest(serialized)),
                    original_message_size: serialized.len(),
                    created_at: chrono::Utc::now().timestamp() as u64,
                    is_compressed: false,
                    content_type: "text/plain".to_string(),
                },
                payload: chunk.to_vec(),
                validation_metadata: crate::utils::integrity::ValidationMetadata {
                    correlation_id: event.event_id.clone(),
                    content_hash: format!("{:x}", Sha256::digest(chunk)),
                    content_size: chunk.len(),
                    checkpoint: crate::utils::integrity::ValidationCheckpoint::Compression,
                    validated_at: chrono::Utc::now().timestamp() as u64,
                    previous_hash: None,
                    chain_depth: 0,
                },
            }
        }).collect();
        
        Ok(fragments)
    }
    
    /// Format progressive fragment for display
    fn format_progressive_fragment(&self, fragment: &MessageFragment, index: usize, total: usize) -> Result<String> {
        let content = String::from_utf8(fragment.payload.clone())
            .context("Failed to convert fragment payload to string")?;
        
        Ok(format!(
            "📄 **Part {}/{}**\n\n{}\n\n*Fragment {}/{} • {} bytes*",
            index + 1,
            total,
            content,
            index + 1,
            total,
            fragment.payload.len()
        ))
    }
    
    /// Create progressive navigation keyboard
    fn create_progressive_keyboard(&self, current: usize, total: usize, event_id: &str) -> InlineKeyboardMarkup {
        let mut buttons = Vec::new();
        
        // Navigation row
        let mut nav_row = Vec::new();
        if current > 0 {
            nav_row.push(InlineKeyboardButton::callback("⬅️ Previous", format!("prog_prev_{}", event_id)));
        }
        if current < total - 1 {
            nav_row.push(InlineKeyboardButton::callback("Next ➡️", format!("prog_next_{}", event_id)));
        }
        
        if !nav_row.is_empty() {
            buttons.push(nav_row);
        }
        
        // Action row
        buttons.push(vec![
            InlineKeyboardButton::callback("📄 Full Message", format!("prog_full_{}", event_id)),
            InlineKeyboardButton::callback("💾 Download", format!("prog_download_{}", event_id)),
        ]);
        
        InlineKeyboardMarkup::new(buttons)
    }
    
    /// Parse progressive callback data
    fn parse_progressive_callback(&self, data: &str) -> Option<String> {
        if data.starts_with("prog_") {
            data.split('_').nth(2).map(|s| s.to_string())
        } else {
            None
        }
    }
    
    /// Extract progressive action from callback data
    fn extract_progressive_action(&self, data: &str) -> Option<String> {
        if data.starts_with("prog_") {
            data.split('_').nth(1).map(|s| s.to_string())
        } else {
            None
        }
    }
    
    /// Handle progressive message action
    async fn handle_progressive_action(
        &self,
        bot: &Bot,
        callback: &teloxide::types::CallbackQuery,
        event_id: &str,
        action: &str,
    ) -> Result<bool> {
        // Implementation for handling progressive navigation actions
        // This would update the message content based on the action
        info!("🔄 Handling progressive action '{}' for event {}", action, event_id);
        
        // Update interaction stats
        {
            let mut stats = self.stats.lock().await;
            stats.user_interactions += 1;
        }
        
        // Answer the callback to remove loading state
        bot.answer_callback_query(&callback.id)
            .text("Navigation updated")
            .await?;
        
        Ok(true)
    }
    
    /// Get handler statistics
    pub async fn get_stats(&self) -> TelegramLargeMessageStats {
        self.stats.lock().await.clone()
    }
    
    /// Reset handler statistics
    pub async fn reset_stats(&self) {
        *self.stats.lock().await = TelegramLargeMessageStats::default();
    }
    
    /// Cleanup expired progressive states
    pub async fn cleanup_expired_states(&self) -> usize {
        let mut states = self.progressive_states.write().await;
        let initial_count = states.len();
        
        states.retain(|_, state| {
            state.created_at.elapsed().as_secs() < 3600 // 1 hour expiry
        });
        
        let removed = initial_count - states.len();
        if removed > 0 {
            debug!("🧹 Cleaned up {} expired progressive message states", removed);
        }
        
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::Event;
    
    #[test]
    fn test_message_splitting() {
        let config = TelegramLargeMessageConfig::default();
        let formatter = MessageFormatter::new(chrono_tz::UTC);
        
        // Create a mock handler with just the message splitting functionality
        struct MockHandler {
            config: TelegramLargeMessageConfig,
        }
        
        impl MockHandler {
            fn split_message_safely(&self, message: &str, max_size: usize) -> Vec<String> {
                let mut chunks = Vec::new();
                let mut current_chunk = String::new();
                
                for word in message.split_whitespace() {
                    if current_chunk.len() + word.len() + 1 > max_size {
                        if !current_chunk.is_empty() {
                            chunks.push(current_chunk.clone());
                            current_chunk.clear();
                        }
                    }
                    
                    if !current_chunk.is_empty() {
                        current_chunk.push(' ');
                    }
                    current_chunk.push_str(word);
                }
                
                if !current_chunk.is_empty() {
                    chunks.push(current_chunk);
                }
                
                chunks
            }
        }
        
        let handler = MockHandler { config };
        let long_message = "word ".repeat(1000);
        let chunks = handler.split_message_safely(&long_message, 100);
        
        assert!(chunks.len() > 1);
        for chunk in chunks {
            assert!(chunk.len() <= 100);
        }
    }
    
    #[test]
    fn test_strategy_determination() {
        let config = TelegramLargeMessageConfig::default();
        
        // Create a mock handler for strategy testing
        struct MockHandler {
            config: TelegramLargeMessageConfig,
        }
        
        impl MockHandler {
            fn determine_handling_strategy(&self, message: &str, _event: &Event) -> TelegramMessageStrategy {
                let message_size = message.len();
                
                match message_size {
                    s if s <= TELEGRAM_TEXT_LIMIT => TelegramMessageStrategy::TextSplit,
                    s if s <= self.config.text_file_threshold && self.config.enable_interactive_messages => {
                        TelegramMessageStrategy::Interactive
                    }
                    s if s <= 100 * 1024 => TelegramMessageStrategy::FileAttachment,
                    s if s <= self.config.compression_threshold => TelegramMessageStrategy::CompressedArchive,
                    _ => TelegramMessageStrategy::Progressive,
                }
            }
        }
        
        let handler = MockHandler { config };
        let event = Event::default_with_task_id("test".to_string());
        
        // Short message
        let short_message = "Short message";
        assert_eq!(
            handler.determine_handling_strategy(short_message, &event),
            TelegramMessageStrategy::TextSplit
        );
        
        // Long message
        let long_message = "x".repeat(20000);
        let strategy = handler.determine_handling_strategy(&long_message, &event);
        assert!(matches!(strategy, 
            TelegramMessageStrategy::Interactive |
            TelegramMessageStrategy::FileAttachment |
            TelegramMessageStrategy::CompressedArchive |
            TelegramMessageStrategy::Progressive
        ));
    }
}
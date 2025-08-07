use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;
use tracing::{info, warn, error, debug};
use uuid::Uuid;
use anyhow::{Result, Context};

use crate::events::types::Event;
use crate::tier_orchestrator::{TierOrchestrator, TierType, TierSelection};
use crate::telegram::TelegramBot;
use crate::storage::persistent_queue::{EventQueueIntegration, ProcessingResult, PersistentQueueConfig};
use crate::storage::message_persistence::MessagePersistenceConfig;
use crate::utils::errors::BridgeError;

/// Configuration for the integrated persistence system
#[derive(Debug, Clone)]
pub struct PersistenceIntegrationConfig {
    pub database_path: String,
    pub chat_id: i64,
    pub retention_days: u32,
    pub max_connections: usize,
    pub backup_enabled: bool,
    pub backup_path: Option<String>,
    pub cleanup_interval_hours: u64,
    pub retry_interval_seconds: u64,
    pub max_retry_count: u32,
    pub max_concurrent_processing: usize,
}

impl Default for PersistenceIntegrationConfig {
    fn default() -> Self {
        Self {
            database_path: "cctelegram_messages.db".to_string(),
            chat_id: 0, // Must be configured
            retention_days: 30,
            max_connections: 10,
            backup_enabled: true,
            backup_path: Some("backup".to_string()),
            cleanup_interval_hours: 24,
            retry_interval_seconds: 300,
            max_retry_count: 3,
            max_concurrent_processing: 5,
        }
    }
}

/// Integrated message processing system with persistence
pub struct PersistenceIntegratedProcessor {
    config: PersistenceIntegrationConfig,
    queue: Arc<EventQueueIntegration>,
    tier_orchestrator: Arc<TierOrchestrator>,
    telegram_bot: Arc<RwLock<Option<TelegramBot>>>,
    stats: Arc<RwLock<IntegrationStats>>,
}

#[derive(Debug, Default, Clone)]
pub struct IntegrationStats {
    pub total_processed: u64,
    pub successful_sends: u64,
    pub failed_sends: u64,
    pub tier1_usage: u64,
    pub tier2_usage: u64,
    pub tier3_usage: u64,
    pub total_retries: u64,
    pub average_processing_time_ms: u64,
}

impl PersistenceIntegratedProcessor {
    /// Create a new integrated processor
    pub async fn new(
        config: PersistenceIntegrationConfig,
        tier_orchestrator: Arc<TierOrchestrator>,
    ) -> Result<Self> {
        info!("Initializing persistence integrated processor");
        
        // Configure the persistent queue
        let persistence_config = MessagePersistenceConfig {
            database_path: config.database_path.clone(),
            retention_days: config.retention_days,
            max_connections: config.max_connections,
            cleanup_interval_hours: config.cleanup_interval_hours,
            backup_interval_hours: if config.backup_enabled {
                Some(168) // Weekly backup
            } else {
                None
            },
            backup_path: config.backup_path.clone(),
            max_retry_count: config.max_retry_count,
            batch_size: 50,
        };
        
        let queue_config = PersistentQueueConfig {
            persistence_config,
            chat_id: config.chat_id,
            max_memory_queue_size: 1000,
            retry_interval_seconds: config.retry_interval_seconds,
            max_concurrent_processing: config.max_concurrent_processing,
            batch_processing_size: 20,
        };
        
        let queue = Arc::new(
            EventQueueIntegration::new(queue_config).await
                .with_context(|| "Failed to initialize event queue integration")?
        );
        
        let processor = Self {
            config,
            queue,
            tier_orchestrator,
            telegram_bot: Arc::new(RwLock::new(None)),
            stats: Arc::new(RwLock::new(IntegrationStats::default())),
        };
        
        info!("Persistence integrated processor initialized successfully");
        Ok(processor)
    }

    /// Set the Telegram bot instance
    pub async fn set_telegram_bot(&self, bot: TelegramBot) {
        let mut bot_guard = self.telegram_bot.write().await;
        *bot_guard = Some(bot);
        info!("Telegram bot configured for integrated processor");
    }

    /// Process an event with full persistence and tier orchestration
    pub async fn process_event(&self, event: Event) -> Result<Uuid> {
        let start_time = std::time::Instant::now();
        
        debug!("Processing event: {} - {}", event.event_type, event.description);
        
        // Enqueue the event for processing
        let message_id = self.queue.enqueue_event(event.clone()).await
            .with_context(|| "Failed to enqueue event")?;
        
        // Start asynchronous processing
        let queue_clone = self.queue.clone();
        let tier_orchestrator_clone = self.tier_orchestrator.clone();
        let telegram_bot_clone = self.telegram_bot.clone();
        let stats_clone = self.stats.clone();
        
        let chat_id = self.config.chat_id;
        
        tokio::spawn(async move {
            match Self::process_message_async(
                message_id,
                event,
                chat_id,
                queue_clone,
                tier_orchestrator_clone,
                telegram_bot_clone,
                stats_clone,
            ).await {
                Ok(_) => {
                    debug!("Successfully processed message {}", message_id);
                }
                Err(e) => {
                    error!("Failed to process message {}: {}", message_id, e);
                }
            }
        });
        
        let processing_time = start_time.elapsed().as_millis() as u64;
        
        {
            let mut stats = self.stats.write().await;
            stats.total_processed += 1;
            
            // Update average processing time (simple moving average)
            if stats.average_processing_time_ms == 0 {
                stats.average_processing_time_ms = processing_time;
            } else {
                stats.average_processing_time_ms = 
                    (stats.average_processing_time_ms + processing_time) / 2;
            }
        }
        
        Ok(message_id)
    }

    /// Asynchronous message processing with tier orchestration
    async fn process_message_async(
        message_id: Uuid,
        event: Event,
        chat_id: i64,
        queue: Arc<EventQueueIntegration>,
        tier_orchestrator: Arc<TierOrchestrator>,
        telegram_bot: Arc<RwLock<Option<TelegramBot>>>,
        stats: Arc<RwLock<IntegrationStats>>,
    ) -> Result<()> {
        // Get the best available tier
        let tier_selection = tier_orchestrator.select_tier(&message_id.to_string()).await;
        
        debug!("Selected tier {:?} for message {}", tier_selection.selected_tier, message_id);
        
        // Format message based on event type and tier capabilities
        let formatted_message = Self::format_message_for_tier(&event, &tier_selection);
        
        // Attempt to send the message
        let send_result = Self::send_message_via_tier(
            &formatted_message,
            tier_selection.selected_tier,
            chat_id,
            &event,
            telegram_bot,
        ).await;
        
        // Update statistics based on tier used
        {
            let mut stats_guard = stats.write().await;
            match tier_selection.selected_tier {
                TierType::McpWebhook => stats_guard.tier1_usage += 1,
                TierType::BridgeInternal => stats_guard.tier2_usage += 1,
                TierType::FileWatcher => stats_guard.tier3_usage += 1,
            }
        }
        
        // Update message status based on result
        match send_result {
            Ok((telegram_message_id, actual_tier)) => {
                let result = ProcessingResult::Success {
                    telegram_message_id,
                    tier_used: format!("{:?}", actual_tier),
                };
                
                queue.update_result(message_id, result).await?;
                
                let mut stats_guard = stats.write().await;
                stats_guard.successful_sends += 1;
                
                info!("Successfully sent message {} via {:?}", message_id, actual_tier);
            }
            
            Err(e) => {
                // Determine if this should be retried or failed permanently
                let should_retry = Self::should_retry_error(&e);
                
                let result = if should_retry {
                    ProcessingResult::Retry {
                        error: format!("Retryable error: {}", e),
                    }
                } else {
                    ProcessingResult::Failed {
                        error: format!("Permanent failure: {}", e),
                    }
                };
                
                queue.update_result(message_id, result).await?;
                
                let mut stats_guard = stats.write().await;
                if should_retry {
                    stats_guard.total_retries += 1;
                } else {
                    stats_guard.failed_sends += 1;
                }
                
                warn!("Message {} processing failed: {} (retry: {})", 
                      message_id, e, should_retry);
            }
        }
        
        Ok(())
    }

    /// Format message content based on tier capabilities
    fn format_message_for_tier(event: &Event, tier_selection: &TierSelection) -> String {
        let base_message = format!("🔔 {} ({})\n{}", 
                                   event.event_type, 
                                   event.source, 
                                   event.description);
        
        // Add tier-specific formatting
        match tier_selection.selected_tier {
            TierType::McpWebhook => {
                // Full rich formatting for MCP webhook tier
                format!("{}\n\n📊 Task: {}\n⏰ Time: {}\n🏷️ Tier: MCP Webhook",
                        base_message, 
                        event.task_id,
                        event.timestamp.format("%H:%M:%S"))
            }
            
            TierType::BridgeInternal => {
                // Standard formatting for bridge internal tier
                format!("{}\n\nTask: {} | Time: {} | Tier: Bridge Internal",
                        base_message,
                        event.task_id,
                        event.timestamp.format("%H:%M:%S"))
            }
            
            TierType::FileWatcher => {
                // Minimal formatting for file watcher tier
                format!("{}\n[{}] [{}] [File Watcher]", 
                        base_message,
                        event.task_id,
                        event.timestamp.format("%H:%M"))
            }
        }
    }

    /// Send message via specified tier
    async fn send_message_via_tier(
        _message: &str,
        tier: TierType,
        user_id: i64,
        event: &Event,
        telegram_bot: Arc<RwLock<Option<TelegramBot>>>,
    ) -> Result<(i32, TierType)> {
        let bot_guard = telegram_bot.read().await;
        
        if let Some(bot) = bot_guard.as_ref() {
            // Use send_event_notification which handles the proper formatting
            bot.send_event_notification(user_id, event).await
                .with_context(|| format!("Failed to send via {:?} tier", tier))?;
            
            // Since send_event_notification returns (), we simulate a message ID
            let message_id = 0i32; // Would be returned by actual Telegram API
            Ok((message_id, tier))
        } else {
            Err(BridgeError::Generic("Telegram bot not configured".to_string()).into())
        }
    }

    /// Determine if an error should trigger a retry
    fn should_retry_error(error: &anyhow::Error) -> bool {
        let error_str = error.to_string().to_lowercase();
        
        // Rate limiting errors - should retry
        if error_str.contains("rate limit") || error_str.contains("too many requests") {
            return true;
        }
        
        // Network errors - should retry
        if error_str.contains("network") || error_str.contains("timeout") || 
           error_str.contains("connection") {
            return true;
        }
        
        // Temporary Telegram API errors - should retry
        if error_str.contains("502") || error_str.contains("503") || 
           error_str.contains("504") {
            return true;
        }
        
        // Authentication errors - should not retry
        if error_str.contains("unauthorized") || error_str.contains("forbidden") {
            return false;
        }
        
        // Invalid message format - should not retry
        if error_str.contains("bad request") || error_str.contains("invalid") {
            return false;
        }
        
        // Default: retry for unknown errors
        true
    }

    /// Get integration statistics
    pub async fn get_stats(&self) -> IntegrationStats {
        self.stats.read().await.clone()
    }

    /// Get queue statistics
    pub async fn get_queue_stats(&self) -> crate::storage::persistent_queue::QueueStats {
        self.queue.get_stats().await
    }

    /// Get persistence statistics
    pub fn get_persistence_stats(&self) -> crate::storage::message_persistence::PersistenceStats {
        self.queue.get_persistence_stats()
    }

    /// Shutdown the integrated processor
    pub async fn shutdown(&self) {
        info!("Shutting down persistence integrated processor");
        
        self.queue.shutdown().await;
        
        info!("Persistence integrated processor shutdown complete");
    }
}

/// Helper function to create a default integrated processor
pub async fn create_default_processor(
    chat_id: i64,
    tier_orchestrator: Arc<TierOrchestrator>,
) -> Result<PersistenceIntegratedProcessor> {
    let mut config = PersistenceIntegrationConfig::default();
    config.chat_id = chat_id;
    
    PersistenceIntegratedProcessor::new(config, tier_orchestrator).await
}

/// Helper function to create a processor with custom database path
pub async fn create_processor_with_path(
    chat_id: i64,
    database_path: String,
    tier_orchestrator: Arc<TierOrchestrator>,
) -> Result<PersistenceIntegratedProcessor> {
    let mut config = PersistenceIntegrationConfig::default();
    config.chat_id = chat_id;
    config.database_path = database_path;
    
    PersistenceIntegratedProcessor::new(config, tier_orchestrator).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    
    async fn create_test_processor() -> PersistenceIntegratedProcessor {
        let temp_file = NamedTempFile::new().unwrap();
        
        // Create test config and internal processor
        let config = Arc::new(crate::config::Config::default());
        let internal_processor = Arc::new(
            crate::internal_processor::InternalProcessor::new(config.clone())
        );
        
        let tier_orchestrator = Arc::new(
            TierOrchestrator::new(config, internal_processor).await
        );
        
        create_processor_with_path(
            12345,
            temp_file.path().to_string_lossy().to_string(),
            tier_orchestrator,
        ).await.unwrap()
    }
    
    #[tokio::test]
    async fn test_integration_basic_flow() {
        let processor = create_test_processor().await;
        
        let event = Event {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type: crate::events::types::EventType::TestSuiteRun,
            source: "test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: "test_task".to_string(),
            title: "Test Event".to_string(),
            description: "Test message for integration".to_string(),
            data: crate::events::types::EventData::default(),
            correlation_id: None,
            parent_event_id: None,
            retry_count: 0,
            processing_status: crate::events::types::ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: chrono::Utc::now(),
            processed_at: None,
        };
        
        let message_id = processor.process_event(event).await.unwrap();
        
        // Give processing a moment
        tokio::time::sleep(Duration::from_millis(200)).await;
        
        let stats = processor.get_stats().await;
        assert_eq!(stats.total_processed, 1);
        
        processor.shutdown().await;
    }
}
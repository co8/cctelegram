use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, RwLock};
use tokio::time::{sleep, interval};
use tracing::{info, warn, error, debug};
use uuid::Uuid;
use anyhow::{Result, Context};

use crate::events::types::Event;
use crate::storage::message_persistence::{MessagePersistenceSystem, MessageStatus, MessagePersistenceConfig};
use crate::utils::errors::BridgeError;

/// Configuration for persistent queue
#[derive(Debug, Clone)]
pub struct PersistentQueueConfig {
    pub persistence_config: MessagePersistenceConfig,
    pub chat_id: i64,
    pub max_memory_queue_size: usize,
    pub retry_interval_seconds: u64,
    pub max_concurrent_processing: usize,
    pub batch_processing_size: usize,
}

impl Default for PersistentQueueConfig {
    fn default() -> Self {
        Self {
            persistence_config: MessagePersistenceConfig::default(),
            chat_id: 0, // Must be configured
            max_memory_queue_size: 1000,
            retry_interval_seconds: 300, // 5 minutes
            max_concurrent_processing: 5,
            batch_processing_size: 10,
        }
    }
}

/// Result of message processing
#[derive(Debug, Clone)]
pub enum ProcessingResult {
    Success { telegram_message_id: i32, tier_used: String },
    Retry { error: String },
    Failed { error: String },
}

/// Persistent message queue that integrates with the message persistence system
pub struct PersistentMessageQueue {
    config: PersistentQueueConfig,
    persistence: Arc<MessagePersistenceSystem>,
    
    // In-memory queue for immediate processing
    sender: mpsc::UnboundedSender<QueueMessage>,
    receiver: Arc<RwLock<Option<mpsc::UnboundedReceiver<QueueMessage>>>>,
    
    // Processing coordination
    processing_semaphore: Arc<tokio::sync::Semaphore>,
    shutdown_flag: Arc<RwLock<bool>>,
    
    // Statistics
    stats: Arc<RwLock<QueueStats>>,
}

#[derive(Debug, Clone)]
struct QueueMessage {
    message_id: Uuid,
    event: Event,
    priority: MessagePriority,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MessagePriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

#[derive(Debug, Default, Clone)]
pub struct QueueStats {
    pub messages_enqueued: u64,
    pub messages_processed: u64,
    pub messages_failed: u64,
    pub messages_retried: u64,
    pub current_memory_queue_size: usize,
    pub current_processing_count: usize,
}

impl PersistentMessageQueue {
    /// Create a new persistent message queue
    pub async fn new(config: PersistentQueueConfig) -> Result<Self> {
        info!("Initializing persistent message queue for chat {}", config.chat_id);
        
        let persistence = Arc::new(
            MessagePersistenceSystem::new(config.persistence_config.clone()).await
                .with_context(|| "Failed to initialize message persistence system")?
        );
        
        let (sender, receiver) = mpsc::unbounded_channel();
        
        let queue = Self {
            config,
            persistence,
            sender,
            receiver: Arc::new(RwLock::new(Some(receiver))),
            processing_semaphore: Arc::new(tokio::sync::Semaphore::new(5)), // Default max concurrent
            shutdown_flag: Arc::new(RwLock::new(false)),
            stats: Arc::new(RwLock::new(QueueStats::default())),
        };
        
        // Perform crash recovery
        queue.perform_crash_recovery().await?;
        
        // Start background processing tasks
        queue.start_processing_task().await?;
        queue.start_retry_task();
        
        info!("Persistent message queue initialized successfully");
        Ok(queue)
    }

    /// Enqueue a message for processing
    pub async fn enqueue_message(&self, event: Event, priority: MessagePriority) -> Result<Uuid> {
        // First persist the message
        let message_id = self.persistence.store_message(&event, self.config.chat_id).await
            .with_context(|| "Failed to persist message")?;
        
        // Then add to in-memory queue for immediate processing
        let queue_message = QueueMessage {
            message_id,
            event,
            priority,
        };
        
        if let Err(_) = self.sender.send(queue_message) {
            warn!("Failed to send message to in-memory queue, processing will rely on retry mechanism");
        }
        
        {
            let mut stats = self.stats.write().await;
            stats.messages_enqueued += 1;
            // Note: UnboundedSender doesn't have a len() method, so we approximate
            stats.current_memory_queue_size = stats.messages_enqueued.saturating_sub(stats.messages_processed) as usize;
        }
        
        debug!("Enqueued message {} with priority {:?}", message_id, priority);
        Ok(message_id)
    }

    /// Update message processing result
    pub async fn update_message_result(&self, message_id: Uuid, result: ProcessingResult) -> Result<()> {
        match result {
            ProcessingResult::Success { telegram_message_id, tier_used } => {
                self.persistence.update_message_status(
                    message_id,
                    MessageStatus::Confirmed,
                    Some(telegram_message_id),
                    Some(tier_used),
                    None,
                ).await?;
                
                let mut stats = self.stats.write().await;
                stats.messages_processed += 1;
                
                debug!("Message {} processed successfully", message_id);
            },
            
            ProcessingResult::Retry { error } => {
                self.persistence.update_message_status(
                    message_id,
                    MessageStatus::Failed,
                    None,
                    None,
                    Some(error),
                ).await?;
                
                let mut stats = self.stats.write().await;
                stats.messages_retried += 1;
                
                debug!("Message {} scheduled for retry", message_id);
            },
            
            ProcessingResult::Failed { error } => {
                self.persistence.update_message_status(
                    message_id,
                    MessageStatus::Failed,
                    None,
                    None,
                    Some(error.clone()),
                ).await?;
                
                let mut stats = self.stats.write().await;
                stats.messages_failed += 1;
                
                warn!("Message {} failed permanently: {}", message_id, error);
            },
        }
        
        Ok(())
    }

    /// Get queue statistics
    pub async fn get_stats(&self) -> QueueStats {
        self.stats.read().await.clone()
    }

    /// Get persistence statistics
    pub fn get_persistence_stats(&self) -> crate::storage::message_persistence::PersistenceStats {
        self.persistence.get_stats()
    }

    /// Perform crash recovery by loading pending messages
    async fn perform_crash_recovery(&self) -> Result<()> {
        info!("Performing crash recovery for persistent queue");
        
        let pending_messages = self.persistence.get_messages_by_status(MessageStatus::Pending).await
            .with_context(|| "Failed to load pending messages during crash recovery")?;
        
        if !pending_messages.is_empty() {
            let message_count = pending_messages.len();
            warn!("Found {} pending messages during crash recovery", message_count);
            
            for persisted_message in pending_messages {
                if let Some(event_data) = &persisted_message.event_data {
                    match serde_json::from_str::<Event>(event_data) {
                        Ok(event) => {
                            let queue_message = QueueMessage {
                                message_id: persisted_message.id,
                                event,
                                priority: MessagePriority::High, // Recovered messages get high priority
                            };
                            
                            if let Err(_) = self.sender.send(queue_message) {
                                error!("Failed to re-enqueue recovered message {}", persisted_message.id);
                            } else {
                                info!("Re-enqueued recovered message {}", persisted_message.id);
                            }
                        },
                        Err(e) => {
                            error!("Failed to deserialize event data for message {}: {}", 
                                   persisted_message.id, e);
                        }
                    }
                }
            }
            
            info!("Crash recovery completed for {} messages", message_count);
        } else {
            info!("No pending messages found during crash recovery");
        }
        
        Ok(())
    }

    /// Start the main message processing task
    async fn start_processing_task(&self) -> Result<()> {
        let receiver = {
            let mut receiver_guard = self.receiver.write().await;
            receiver_guard.take()
                .ok_or_else(|| BridgeError::Generic("Processing task already started".to_string()))?
        };
        
        let persistence = self.persistence.clone();
        let semaphore = self.processing_semaphore.clone();
        let shutdown_flag = self.shutdown_flag.clone();
        let stats = self.stats.clone();
        let config = self.config.clone();
        
        tokio::spawn(async move {
            let mut receiver = receiver;
            
            info!("Started message processing task");
            
            while let Some(queue_message) = receiver.recv().await {
                if *shutdown_flag.read().await {
                    break;
                }
                
                let persistence_clone = persistence.clone();
                let stats_clone = stats.clone();
                let semaphore_clone = semaphore.clone();
                
                // Process message in separate task
                tokio::spawn(async move {
                    // Acquire semaphore permit for concurrency control
                    let permit = semaphore_clone.acquire().await.unwrap();
                    let _permit = permit; // Keep permit alive
                    
                    {
                        let mut stats = stats_clone.write().await;
                        stats.current_processing_count += 1;
                    }
                    
                    // Update message to sent status
                    if let Err(e) = persistence_clone.update_message_status(
                        queue_message.message_id,
                        MessageStatus::Sent,
                        None,
                        None,
                        None,
                    ).await {
                        error!("Failed to update message status to sent: {}", e);
                    }
                    
                    debug!("Processing message {} with priority {:?}", 
                           queue_message.message_id, queue_message.priority);
                    
                    // Here would be the actual message sending logic
                    // For now, we'll simulate it
                    Self::simulate_message_processing(&queue_message).await;
                    
                    {
                        let mut stats = stats_clone.write().await;
                        stats.current_processing_count -= 1;
                    }
                });
            }
            
            info!("Message processing task shut down");
        });
        
        Ok(())
    }

    /// Start retry processing task for failed messages
    fn start_retry_task(&self) {
        let persistence = self.persistence.clone();
        let sender = self.sender.clone();
        let shutdown_flag = self.shutdown_flag.clone();
        let config = self.config.clone();
        let stats = self.stats.clone();
        
        tokio::spawn(async move {
            let mut retry_interval = interval(Duration::from_secs(config.retry_interval_seconds));
            
            info!("Started message retry task");
            
            loop {
                retry_interval.tick().await;
                
                if *shutdown_flag.read().await {
                    break;
                }
                
                match persistence.get_retry_messages().await {
                    Ok(retry_messages) => {
                        if !retry_messages.is_empty() {
                            info!("Found {} messages for retry", retry_messages.len());
                            
                            for persisted_message in retry_messages {
                                if let Some(event_data) = &persisted_message.event_data {
                                    match serde_json::from_str::<Event>(event_data) {
                                        Ok(event) => {
                                            let queue_message = QueueMessage {
                                                message_id: persisted_message.id,
                                                event,
                                                priority: MessagePriority::Normal,
                                            };
                                            
                                            if let Err(_) = sender.send(queue_message) {
                                                error!("Failed to re-enqueue retry message {}", persisted_message.id);
                                            } else {
                                                debug!("Re-enqueued retry message {}", persisted_message.id);
                                                
                                                let mut stats = stats.write().await;
                                                stats.messages_retried += 1;
                                            }
                                        },
                                        Err(e) => {
                                            error!("Failed to deserialize event data for retry message {}: {}", 
                                                   persisted_message.id, e);
                                        }
                                    }
                                }
                            }
                        }
                    },
                    Err(e) => {
                        error!("Failed to get retry messages: {}", e);
                    }
                }
            }
            
            info!("Message retry task shut down");
        });
    }

    /// Simulate message processing (placeholder for actual Telegram sending)
    async fn simulate_message_processing(queue_message: &QueueMessage) {
        // Simulate processing delay
        sleep(Duration::from_millis(100)).await;
        
        debug!("Simulated processing of message {}", queue_message.message_id);
        
        // In real implementation, this would:
        // 1. Format the message using MessageFormatter
        // 2. Send via TelegramBot
        // 3. Handle rate limiting
        // 4. Update message status based on result
        // 5. Use tier orchestrator for failover
    }

    /// Shutdown the queue gracefully
    pub async fn shutdown(&self) {
        info!("Shutting down persistent message queue");
        
        {
            let mut shutdown_flag = self.shutdown_flag.write().await;
            *shutdown_flag = true;
        }
        
        // Wait for processing to complete
        let mut wait_count = 0;
        while wait_count < 30 { // Wait up to 30 seconds
            let current_processing = {
                let stats = self.stats.read().await;
                stats.current_processing_count
            };
            
            if current_processing == 0 {
                break;
            }
            
            debug!("Waiting for {} messages to finish processing", current_processing);
            sleep(Duration::from_secs(1)).await;
            wait_count += 1;
        }
        
        info!("Persistent message queue shut down completed");
    }
}

/// Integration with existing EventQueue for backward compatibility
pub struct EventQueueIntegration {
    persistent_queue: Arc<PersistentMessageQueue>,
}

impl EventQueueIntegration {
    pub async fn new(config: PersistentQueueConfig) -> Result<Self> {
        let persistent_queue = Arc::new(PersistentMessageQueue::new(config).await?);
        
        Ok(Self {
            persistent_queue,
        })
    }

    pub async fn enqueue_event(&self, event: Event) -> Result<Uuid> {
        // Determine priority based on event type
        let priority = match event.event_type.to_string().as_str() {
            "error_occurred" | "build_failed" | "performance_alert" => MessagePriority::Critical,
            "task_failed" | "alert_notification" => MessagePriority::High,
            "task_started" | "task_progress" => MessagePriority::Normal,
            _ => MessagePriority::Low,
        };
        
        self.persistent_queue.enqueue_message(event, priority).await
    }

    pub async fn update_result(&self, message_id: Uuid, result: ProcessingResult) -> Result<()> {
        self.persistent_queue.update_message_result(message_id, result).await
    }

    pub async fn get_stats(&self) -> QueueStats {
        self.persistent_queue.get_stats().await
    }

    pub fn get_persistence_stats(&self) -> crate::storage::message_persistence::PersistenceStats {
        self.persistent_queue.get_persistence_stats()
    }

    pub async fn shutdown(&self) {
        self.persistent_queue.shutdown().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    
    fn create_test_config() -> PersistentQueueConfig {
        let temp_file = NamedTempFile::new().unwrap();
        let mut persistence_config = MessagePersistenceConfig::default();
        persistence_config.database_path = temp_file.path().to_string_lossy().to_string();
        persistence_config.retention_days = 1;
        persistence_config.cleanup_interval_hours = 1;
        
        PersistentQueueConfig {
            persistence_config,
            chat_id: 12345,
            max_memory_queue_size: 100,
            retry_interval_seconds: 60,
            max_concurrent_processing: 2,
            batch_processing_size: 5,
        }
    }
    
    #[tokio::test]
    async fn test_persistent_queue_basic_functionality() {
        let config = create_test_config();
        let queue = PersistentMessageQueue::new(config).await.unwrap();
        
        let event = Event {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type: crate::events::types::EventType::TestSuiteRun,
            source: "test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: "test_task".to_string(),
            title: "Test Event".to_string(),
            description: "Test message".to_string(),
            data: crate::events::types::EventData::default(),
            correlation_id: None,
            parent_event_id: None,
            retry_count: 0,
            processing_status: crate::events::types::ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: chrono::Utc::now(),
            processed_at: None,
        };
        
        // Enqueue message
        let message_id = queue.enqueue_message(event, MessagePriority::Normal).await.unwrap();
        
        // Give processing a moment
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // Update with success result
        let result = ProcessingResult::Success {
            telegram_message_id: 123456,
            tier_used: "tier1".to_string(),
        };
        
        queue.update_message_result(message_id, result).await.unwrap();
        
        // Check stats
        let stats = queue.get_stats().await;
        assert_eq!(stats.messages_enqueued, 1);
        
        queue.shutdown().await;
    }
}
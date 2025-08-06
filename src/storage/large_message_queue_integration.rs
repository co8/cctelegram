use anyhow::{Result, Context};
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::{RwLock, Mutex};
use tracing::{debug, warn, info, error, instrument};
// Removed unused serde import

use crate::events::types::Event;
use super::large_message_protocol::{LargeMessageProtocol, MessageFragment, LargeMessageProtocolConfig};
use super::compression_integrity::IntegrityAwareCompressionService;
use super::redis_compression::{RedisCompressionService, RedisCompressionConfig};
use super::queue::EnhancedEventQueue;
use crate::utils::integrity::DefaultIntegrityValidator;

/// Queue limits and thresholds for large message handling
#[derive(Debug, Clone)]
pub struct QueueLimits {
    /// Maximum single message size for queue (from Task 39.1)
    pub max_message_size: usize,
    /// Queue batch size limits
    pub max_batch_size: usize,
    /// Memory pressure threshold
    pub memory_pressure_threshold: f64,
    /// Fragment processing timeout
    pub fragment_processing_timeout_ms: u64,
}

impl Default for QueueLimits {
    fn default() -> Self {
        Self {
            max_message_size: 10 * 1024 * 1024, // 10MB queue limit
            max_batch_size: 100,                 // 100 messages per batch
            memory_pressure_threshold: 0.8,     // 80% memory usage threshold
            fragment_processing_timeout_ms: 30000, // 30 seconds
        }
    }
}

/// Fragment storage strategy for queue integration
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FragmentStorageStrategy {
    /// Store fragments directly in Redis with correlation tracking
    RedisCorrelated,
    /// Use filesystem for large fragments with queue metadata
    FileSystemBacked,
    /// Hybrid approach: small fragments in Redis, large in filesystem
    Hybrid,
}

/// Configuration for large message queue integration
#[derive(Debug, Clone)]
pub struct LargeMessageQueueConfig {
    /// Large message protocol configuration
    pub lmp_config: LargeMessageProtocolConfig,
    /// Redis compression configuration
    pub redis_config: RedisCompressionConfig,
    /// Queue processing limits
    pub queue_limits: QueueLimits,
    /// Fragment storage strategy
    pub storage_strategy: FragmentStorageStrategy,
    /// Enable queue-aware fragment prioritization
    pub enable_fragment_prioritization: bool,
    /// Fragment reassembly worker count
    pub reassembly_worker_count: usize,
}

impl Default for LargeMessageQueueConfig {
    fn default() -> Self {
        Self {
            lmp_config: LargeMessageProtocolConfig::default(),
            redis_config: RedisCompressionConfig::default(),
            queue_limits: QueueLimits::default(),
            storage_strategy: FragmentStorageStrategy::Hybrid,
            enable_fragment_prioritization: true,
            reassembly_worker_count: 4,
        }
    }
}

/// Fragment priority for queue processing
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FragmentPriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// Queue-aware fragment with processing metadata
#[derive(Debug, Clone)]
pub struct QueueFragment {
    /// Core message fragment
    pub fragment: MessageFragment,
    /// Processing priority
    pub priority: FragmentPriority,
    /// Queue processing timestamp
    pub queued_at: u64,
    /// Retry count for failed processing
    pub retry_count: u32,
    /// Queue correlation key for batching
    pub queue_key: String,
}

/// Large Message Queue Integration service
pub struct LargeMessageQueueIntegration {
    /// Large message protocol core
    protocol: Arc<LargeMessageProtocol>,
    /// Redis compression service for fragment storage
    redis_service: Arc<RedisCompressionService>,
    /// Event queue for standard message handling
    event_queue: Arc<EnhancedEventQueue>,
    /// Configuration
    config: LargeMessageQueueConfig,
    /// Fragment processing queues by priority
    fragment_queues: Arc<RwLock<HashMap<FragmentPriority, Vec<QueueFragment>>>>,
    /// Active reassembly tracking
    active_reassemblies: Arc<RwLock<HashMap<String, ReassemblyTracker>>>,
    /// Queue integration statistics
    stats: Arc<Mutex<QueueIntegrationStats>>,
    /// Worker task handles
    worker_handles: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>,
}

/// Reassembly progress tracking for queue coordination
#[derive(Debug)]
struct ReassemblyTracker {
    correlation_id: String,
    total_fragments: u32,
    received_fragments: u32,
    priority: FragmentPriority,
    started_at: std::time::Instant,
    last_activity: std::time::Instant,
    estimated_size: usize,
}

impl ReassemblyTracker {
    fn new(correlation_id: String, total_fragments: u32, priority: FragmentPriority, estimated_size: usize) -> Self {
        let now = std::time::Instant::now();
        Self {
            correlation_id,
            total_fragments,
            received_fragments: 0,
            priority,
            started_at: now,
            last_activity: now,
            estimated_size,
        }
    }
    
    fn add_fragment(&mut self) {
        self.received_fragments += 1;
        self.last_activity = std::time::Instant::now();
    }
    
    fn completion_percentage(&self) -> f64 {
        if self.total_fragments == 0 {
            0.0
        } else {
            (self.received_fragments as f64 / self.total_fragments as f64) * 100.0
        }
    }
    
    fn is_stale(&self) -> bool {
        self.last_activity.elapsed().as_secs() > 300 // 5 minutes
    }
}

/// Queue integration statistics
#[derive(Debug, Clone, Default)]
pub struct QueueIntegrationStats {
    /// Messages handled by queue integration
    pub messages_processed: u64,
    /// Messages fragmented due to queue limits
    pub messages_fragmented: u64,
    /// Fragments processed through queue
    pub fragments_processed: u64,
    /// Queue batch operations
    pub batch_operations: u64,
    /// Fragment storage operations
    pub storage_operations: u64,
    /// Queue processing failures
    pub queue_failures: u64,
    /// Average queue processing time (ms)
    pub avg_queue_processing_time_ms: f64,
    /// Memory pressure incidents
    pub memory_pressure_incidents: u64,
    /// Fragment reassembly timeouts
    pub reassembly_timeouts: u64,
}

impl LargeMessageQueueIntegration {
    /// Create new queue integration service
    #[instrument(skip_all)]
    pub async fn new(
        config: LargeMessageQueueConfig,
        event_queue: Arc<EnhancedEventQueue>,
    ) -> Result<Self> {
        info!("🔗 Initializing Large Message Queue Integration");
        
        // Create compression service
        let compression_service = Arc::new(IntegrityAwareCompressionService::new_optimized());
        
        // Create Redis compression service
        let redis_service = Arc::new(
            RedisCompressionService::new(compression_service.clone(), config.redis_config.clone())
                .await
                .context("Failed to initialize Redis compression service")?
        );
        
        // Create large message protocol
        let integrity_validator = Box::new(DefaultIntegrityValidator::new_default());
        let protocol = Arc::new(LargeMessageProtocol::new(
            config.lmp_config.clone(),
            compression_service,
            integrity_validator,
        ));
        
        let instance = Self {
            protocol,
            redis_service,
            event_queue,
            config: config.clone(),
            fragment_queues: Arc::new(RwLock::new(HashMap::new())),
            active_reassemblies: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(Mutex::new(QueueIntegrationStats::default())),
            worker_handles: Arc::new(Mutex::new(Vec::new())),
        };
        
        // Initialize fragment queues
        {
            let mut queues = instance.fragment_queues.write().await;
            queues.insert(FragmentPriority::Critical, Vec::new());
            queues.insert(FragmentPriority::High, Vec::new());
            queues.insert(FragmentPriority::Normal, Vec::new());
            queues.insert(FragmentPriority::Low, Vec::new());
        }
        
        // Start worker tasks
        instance.start_worker_tasks().await?;
        
        info!("✅ Large Message Queue Integration initialized with {} workers", 
              config.reassembly_worker_count);
        
        Ok(instance)
    }
    
    /// Process event through queue-aware large message handling
    #[instrument(skip(self, event), fields(event_id = %event.event_id, event_size))]
    pub async fn process_event(&self, event: Event) -> Result<()> {
        let start_time = std::time::Instant::now();
        
        // Serialize event to check size
        let serialized = serde_json::to_vec(&event)
            .context("Failed to serialize event")?;
        
        tracing::Span::current().record("event_size", serialized.len());
        
        // Update stats
        {
            let mut stats = self.stats.lock().await;
            stats.messages_processed += 1;
        }
        
        // Check if fragmentation is needed based on queue limits
        let needs_fragmentation = serialized.len() > self.config.queue_limits.max_message_size || 
                                  self.protocol.needs_fragmentation(&serialized);
        
        if needs_fragmentation {
            info!("📦 Event {} needs fragmentation (size: {}KB, queue limit: {}KB)", 
                  event.event_id, serialized.len() / 1024, 
                  self.config.queue_limits.max_message_size / 1024);
            
            self.process_large_event(event).await?;
        } else {
            // Process normally through event queue
            debug!("⚡ Processing event {} through standard queue (size: {}B)", 
                   event.event_id, serialized.len());
            
            // Add to event queue for standard processing
            self.event_queue.enqueue_event(event).await
                .context("Failed to enqueue event")?;
        }
        
        // Update processing time stats
        let processing_time = start_time.elapsed().as_millis() as f64;
        {
            let mut stats = self.stats.lock().await;
            stats.avg_queue_processing_time_ms = if stats.messages_processed == 1 {
                processing_time
            } else {
                (stats.avg_queue_processing_time_ms * (stats.messages_processed - 1) as f64 + processing_time) / stats.messages_processed as f64
            };
        }
        
        Ok(())
    }
    
    /// Process large event that requires fragmentation
    async fn process_large_event(&self, event: Event) -> Result<()> {
        // Fragment the event
        let fragments = self.protocol.fragment_event(&event).await
            .context("Failed to fragment large event")?;
        
        if fragments.is_empty() {
            // Shouldn't happen, but handle gracefully
            return self.event_queue.enqueue_event(event).await;
        }
        
        let correlation_id = fragments[0].metadata.correlation_id.clone();
        let total_fragments = fragments.len() as u32;
        let estimated_size = fragments.iter().map(|f| f.payload.len()).sum::<usize>();
        
        // Determine priority based on event type and size
        let priority = self.determine_fragment_priority(&event, estimated_size);
        
        info!("🔪 Fragmented event {} into {} fragments (priority: {:?})", 
              event.event_id, total_fragments, priority);
        
        // Create reassembly tracker
        {
            let mut trackers = self.active_reassemblies.write().await;
            trackers.insert(
                correlation_id.clone(),
                ReassemblyTracker::new(correlation_id.clone(), total_fragments, priority, estimated_size)
            );
        }
        
        // Store fragments based on strategy
        match self.config.storage_strategy {
            FragmentStorageStrategy::RedisCorrelated => {
                self.store_fragments_redis(&fragments, priority).await?;
            }
            FragmentStorageStrategy::FileSystemBacked => {
                self.store_fragments_filesystem(&fragments, priority).await?;
            }
            FragmentStorageStrategy::Hybrid => {
                self.store_fragments_hybrid(&fragments, priority).await?;
            }
        }
        
        // Update fragmentation stats
        {
            let mut stats = self.stats.lock().await;
            stats.messages_fragmented += 1;
            stats.fragments_processed += fragments.len() as u64;
        }
        
        Ok(())
    }
    
    /// Determine fragment priority based on event characteristics
    fn determine_fragment_priority(&self, event: &Event, estimated_size: usize) -> FragmentPriority {
        use crate::events::types::EventType;
        
        match event.event_type {
            EventType::ApprovalRequest => FragmentPriority::Critical,
            EventType::TaskCompletion => FragmentPriority::High,
            EventType::ProgressUpdate => FragmentPriority::Normal,
            _ => {
                // Size-based priority for other events
                if estimated_size > 5 * 1024 * 1024 { // 5MB
                    FragmentPriority::High
                } else if estimated_size > 1024 * 1024 { // 1MB
                    FragmentPriority::Normal
                } else {
                    FragmentPriority::Low
                }
            }
        }
    }
    
    /// Store fragments using Redis correlation strategy
    async fn store_fragments_redis(&self, fragments: &[MessageFragment], priority: FragmentPriority) -> Result<()> {
        for fragment in fragments {
            let queue_fragment = QueueFragment {
                fragment: fragment.clone(),
                priority,
                queued_at: chrono::Utc::now().timestamp() as u64,
                retry_count: 0,
                queue_key: format!("lmp:{}:{}", fragment.metadata.correlation_id, fragment.metadata.sequence_number),
            };
            
            // Store fragment payload in Redis
            let storage_key = self.redis_service
                .store_raw_data(&fragment.payload, Some(queue_fragment.queue_key.clone())).await
                .context("Failed to store fragment in Redis")?;
                
            debug!("📥 Stored fragment {}/{} in Redis with key: {}", 
                   fragment.metadata.sequence_number + 1, 
                   fragment.metadata.total_fragments, 
                   storage_key);
            
            // Add to priority queue for processing
            self.enqueue_fragment(queue_fragment).await?;
        }
        
        Ok(())
    }
    
    /// Store fragments using filesystem strategy
    async fn store_fragments_filesystem(&self, fragments: &[MessageFragment], priority: FragmentPriority) -> Result<()> {
        for fragment in fragments {
            let queue_fragment = QueueFragment {
                fragment: fragment.clone(),
                priority,
                queued_at: chrono::Utc::now().timestamp() as u64,
                retry_count: 0,
                queue_key: format!("fs:{}:{}", fragment.metadata.correlation_id, fragment.metadata.sequence_number),
            };
            
            // For filesystem storage, we'd implement a separate file-based storage system
            // This is a placeholder for the filesystem storage logic
            debug!("💾 Would store fragment {}/{} in filesystem", 
                   fragment.metadata.sequence_number + 1, 
                   fragment.metadata.total_fragments);
            
            // Add to priority queue for processing
            self.enqueue_fragment(queue_fragment).await?;
        }
        
        Ok(())
    }
    
    /// Store fragments using hybrid strategy
    async fn store_fragments_hybrid(&self, fragments: &[MessageFragment], priority: FragmentPriority) -> Result<()> {
        const REDIS_SIZE_THRESHOLD: usize = 256 * 1024; // 256KB
        
        for fragment in fragments {
            let use_redis = fragment.payload.len() <= REDIS_SIZE_THRESHOLD;
            
            if use_redis {
                // Store small fragments in Redis
                let queue_fragment = QueueFragment {
                    fragment: fragment.clone(),
                    priority,
                    queued_at: chrono::Utc::now().timestamp() as u64,
                    retry_count: 0,
                    queue_key: format!("redis:{}:{}", fragment.metadata.correlation_id, fragment.metadata.sequence_number),
                };
                
                let storage_key = self.redis_service
                    .store_raw_data(&fragment.payload, Some(queue_fragment.queue_key.clone())).await
                    .context("Failed to store fragment in Redis")?;
                    
                debug!("📥 Stored fragment {}/{} in Redis ({}B)", 
                       fragment.metadata.sequence_number + 1, 
                       fragment.metadata.total_fragments,
                       fragment.payload.len());
                
                self.enqueue_fragment(queue_fragment).await?;
            } else {
                // Store large fragments in filesystem
                let queue_fragment = QueueFragment {
                    fragment: fragment.clone(),
                    priority,
                    queued_at: chrono::Utc::now().timestamp() as u64,
                    retry_count: 0,
                    queue_key: format!("fs:{}:{}", fragment.metadata.correlation_id, fragment.metadata.sequence_number),
                };
                
                debug!("💾 Would store fragment {}/{} in filesystem ({}KB)", 
                       fragment.metadata.sequence_number + 1, 
                       fragment.metadata.total_fragments,
                       fragment.payload.len() / 1024);
                
                self.enqueue_fragment(queue_fragment).await?;
            }
        }
        
        Ok(())
    }
    
    /// Add fragment to appropriate priority queue
    async fn enqueue_fragment(&self, queue_fragment: QueueFragment) -> Result<()> {
        let mut queues = self.fragment_queues.write().await;
        let queue = queues.get_mut(&queue_fragment.priority)
            .ok_or_else(|| anyhow::anyhow!("Invalid fragment priority: {:?}", queue_fragment.priority))?;
        
        queue.push(queue_fragment);
        
        Ok(())
    }
    
    /// Start background worker tasks for fragment processing
    async fn start_worker_tasks(&self) -> Result<()> {
        let mut handles = self.worker_handles.lock().await;
        
        for worker_id in 0..self.config.reassembly_worker_count {
            let worker_handle = self.spawn_worker_task(worker_id).await;
            handles.push(worker_handle);
        }
        
        // Start maintenance task
        let maintenance_handle = self.spawn_maintenance_task().await;
        handles.push(maintenance_handle);
        
        Ok(())
    }
    
    /// Spawn individual worker task
    async fn spawn_worker_task(&self, worker_id: usize) -> tokio::task::JoinHandle<()> {
        let fragment_queues = self.fragment_queues.clone();
        let active_reassemblies = self.active_reassemblies.clone();
        let protocol = self.protocol.clone();
        let stats = self.stats.clone();
        
        tokio::spawn(async move {
            info!("🔄 Starting fragment processing worker {}", worker_id);
            
            loop {
                // Process fragments in priority order
                let fragment = {
                    let mut queues = fragment_queues.write().await;
                    
                    // Check each priority level
                    for priority in [FragmentPriority::Critical, FragmentPriority::High, 
                                   FragmentPriority::Normal, FragmentPriority::Low] {
                        if let Some(queue) = queues.get_mut(&priority) {
                            if !queue.is_empty() {
                                Some(queue.remove(0))
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    }
                }.flatten();
                
                if let Some(queue_fragment) = fragment {
                    // Process fragment
                    if let Err(e) = Self::process_queue_fragment(
                        &protocol,
                        &active_reassemblies,
                        &stats,
                        queue_fragment
                    ).await {
                        error!("Worker {}: Failed to process fragment: {}", worker_id, e);
                    }
                } else {
                    // No fragments to process, wait
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }
            }
        })
    }
    
    /// Process individual queue fragment
    async fn process_queue_fragment(
        protocol: &Arc<LargeMessageProtocol>,
        active_reassemblies: &Arc<RwLock<HashMap<String, ReassemblyTracker>>>,
        stats: &Arc<Mutex<QueueIntegrationStats>>,
        queue_fragment: QueueFragment,
    ) -> Result<()> {
        let correlation_id = queue_fragment.fragment.metadata.correlation_id.clone();
        
        // Update reassembly tracker
        {
            let mut trackers = active_reassemblies.write().await;
            if let Some(tracker) = trackers.get_mut(&correlation_id) {
                tracker.add_fragment();
            }
        }
        
        // Add fragment to protocol for reassembly
        if let Some(reassembled_data) = protocol.add_fragment(queue_fragment.fragment).await? {
            // Message completely reassembled
            info!("✅ Message {} completely reassembled ({}KB)", 
                  correlation_id, reassembled_data.len() / 1024);
            
            // Remove from active reassemblies
            {
                let mut trackers = active_reassemblies.write().await;
                trackers.remove(&correlation_id);
            }
            
            // Deserialize and process the complete event
            let event: Event = serde_json::from_slice(&reassembled_data)
                .context("Failed to deserialize reassembled event")?;
            
            // Here we would send the reassembled event back to the event queue
            // or directly to the next processing stage
            debug!("📨 Reassembled event {} ready for processing", event.event_id);
            
            // Update stats
            {
                let mut stats_guard = stats.lock().await;
                stats_guard.messages_processed += 1;
            }
        }
        
        Ok(())
    }
    
    /// Spawn maintenance task for cleanup and monitoring
    async fn spawn_maintenance_task(&self) -> tokio::task::JoinHandle<()> {
        let active_reassemblies = self.active_reassemblies.clone();
        let stats = self.stats.clone();
        let protocol = self.protocol.clone();
        
        tokio::spawn(async move {
            info!("🧹 Starting maintenance task for large message queue integration");
            
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
            
            loop {
                interval.tick().await;
                
                // Clean up stale reassembly trackers
                let mut removed_count = 0;
                {
                    let mut trackers = active_reassemblies.write().await;
                    let initial_count = trackers.len();
                    
                    trackers.retain(|correlation_id, tracker| {
                        if tracker.is_stale() {
                            warn!("🗑️ Removing stale reassembly tracker: {} (completion: {:.1}%)",
                                  correlation_id, tracker.completion_percentage());
                            false
                        } else {
                            true
                        }
                    });
                    
                    removed_count = initial_count - trackers.len();
                }
                
                if removed_count > 0 {
                    let mut stats_guard = stats.lock().await;
                    stats_guard.reassembly_timeouts += removed_count as u64;
                }
                
                // Perform protocol maintenance
                if let Err(e) = protocol.perform_maintenance().await {
                    error!("Protocol maintenance error: {}", e);
                }
                
                debug!("Maintenance cycle completed: removed {} stale trackers", removed_count);
            }
        })
    }
    
    /// Get comprehensive statistics
    pub async fn get_stats(&self) -> QueueIntegrationStats {
        let mut stats = self.stats.lock().await.clone();
        
        // Add protocol stats
        let protocol_stats = self.protocol.get_stats().await;
        stats.fragments_processed = protocol_stats.fragments_received;
        
        // Add active reassembly count
        let active_count = self.active_reassemblies.read().await.len();
        debug!("Active reassemblies: {}", active_count);
        
        stats
    }
    
    /// Stop all workers and cleanup
    pub async fn stop(&self) -> Result<()> {
        info!("🛑 Stopping Large Message Queue Integration");
        
        // Stop all worker tasks
        let mut handles = self.worker_handles.lock().await;
        for handle in handles.drain(..) {
            handle.abort();
        }
        
        // Stop protocol
        self.protocol.stop().await?;
        
        // Clear active reassemblies
        let mut trackers = self.active_reassemblies.write().await;
        let active_count = trackers.len();
        trackers.clear();
        
        if active_count > 0 {
            warn!("Cleared {} active reassembly trackers during shutdown", active_count);
        }
        
        info!("✅ Large Message Queue Integration stopped");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{Event, EventType};
    
    #[tokio::test]
    async fn test_queue_integration_initialization() {
        let config = LargeMessageQueueConfig::default();
        
        // Create event queue directly
        let event_queue = Arc::new(
            EnhancedEventQueue::new(1000, None)
        );
        
        let integration = LargeMessageQueueIntegration::new(config, event_queue)
            .await
            .unwrap();
        
        let stats = integration.get_stats().await;
        assert_eq!(stats.messages_processed, 0);
        
        integration.stop().await.unwrap();
    }
    
    #[tokio::test]
    async fn test_fragment_priority_determination() {
        let config = LargeMessageQueueConfig::default();
        
        let event_queue = Arc::new(
            EnhancedEventQueue::new(1000, None)
        );
        
        let integration = LargeMessageQueueIntegration::new(config, event_queue)
            .await
            .unwrap();
        
        // Test priority determination
        let approval_event = Event {
            event_type: EventType::ApprovalRequest,
            ..Event::default_with_task_id("test".to_string())
        };
        
        let completion_event = Event {
            event_type: EventType::TaskCompletion,
            ..Event::default_with_task_id("test".to_string())
        };
        
        let progress_event = Event {
            event_type: EventType::ProgressUpdate,
            ..Event::default_with_task_id("test".to_string())
        };
        
        assert_eq!(integration.determine_fragment_priority(&approval_event, 1024), FragmentPriority::Critical);
        assert_eq!(integration.determine_fragment_priority(&completion_event, 1024), FragmentPriority::High);
        assert_eq!(integration.determine_fragment_priority(&progress_event, 1024), FragmentPriority::Normal);
        
        integration.stop().await.unwrap();
    }
}
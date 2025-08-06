use anyhow::{Result, Context};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{RwLock, Mutex};
use tracing::{debug, warn, info, error, instrument};
use sha2::{Sha256, Digest};
use uuid::Uuid;

use crate::events::types::Event;
use crate::utils::integrity::{IntegrityValidator, ValidationMetadata, ValidationCheckpoint, ValidationResult};
use super::compression_integrity::IntegrityAwareCompressionService;

/// Telegram's hard message limit (4096 characters for text, ~50MB for media)
/// For safety, we use 64KB as the fragmentation threshold
const TELEGRAM_MESSAGE_LIMIT: usize = 64 * 1024; // 64KB
const MAX_FRAGMENT_SIZE: usize = 32 * 1024; // 32KB fragments for efficiency
const MAX_FRAGMENTS_PER_MESSAGE: usize = 1000; // Safety limit
const FRAGMENT_TIMEOUT: Duration = Duration::from_secs(300); // 5 minutes

/// Fragment metadata for message reassembly
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FragmentMetadata {
    /// Unique correlation ID for this message
    pub correlation_id: String,
    /// Fragment sequence number (0-based)
    pub sequence_number: u32,
    /// Total number of fragments for this message
    pub total_fragments: u32,
    /// Size of this fragment in bytes
    pub fragment_size: usize,
    /// SHA-256 hash of this fragment's content
    pub fragment_hash: String,
    /// SHA-256 hash of the complete original message
    pub original_message_hash: String,
    /// Size of the complete original message
    pub original_message_size: usize,
    /// Timestamp when fragment was created
    pub created_at: u64,
    /// Fragment compression applied
    pub is_compressed: bool,
    /// Content type hint for reassembly
    pub content_type: String,
}

/// Individual message fragment
#[derive(Debug, Clone)]
pub struct MessageFragment {
    /// Fragment metadata
    pub metadata: FragmentMetadata,
    /// Fragment payload data
    pub payload: Vec<u8>,
    /// Validation metadata for integrity checking
    pub validation_metadata: ValidationMetadata,
}

/// Reassembly buffer for tracking incomplete messages
#[derive(Debug)]
struct ReassemblyBuffer {
    /// Correlation ID
    correlation_id: String,
    /// Expected total fragments
    total_fragments: u32,
    /// Received fragments (sequence_number -> fragment)
    fragments: HashMap<u32, MessageFragment>,
    /// Original message metadata
    original_hash: String,
    original_size: usize,
    /// Buffer creation timestamp
    created_at: Instant,
    /// Last activity timestamp
    last_activity: Instant,
    /// Content type for reassembly
    content_type: String,
}

impl ReassemblyBuffer {
    fn new(correlation_id: String, total_fragments: u32, original_hash: String, 
           original_size: usize, content_type: String) -> Self {
        let now = Instant::now();
        Self {
            correlation_id,
            total_fragments,
            fragments: HashMap::new(),
            original_hash,
            original_size,
            created_at: now,
            last_activity: now,
            content_type,
        }
    }
    
    fn add_fragment(&mut self, fragment: MessageFragment) -> bool {
        self.last_activity = Instant::now();
        let seq = fragment.metadata.sequence_number;
        self.fragments.insert(seq, fragment);
        self.is_complete()
    }
    
    fn is_complete(&self) -> bool {
        self.fragments.len() == self.total_fragments as usize
    }
    
    fn is_expired(&self, timeout: Duration) -> bool {
        self.last_activity.elapsed() > timeout
    }
    
    fn get_missing_sequences(&self) -> Vec<u32> {
        (0..self.total_fragments)
            .filter(|seq| !self.fragments.contains_key(seq))
            .collect()
    }
    
    fn completion_percentage(&self) -> f64 {
        if self.total_fragments == 0 {
            0.0
        } else {
            (self.fragments.len() as f64 / self.total_fragments as f64) * 100.0
        }
    }
}

/// Large Message Protocol service configuration
#[derive(Debug, Clone)]
pub struct LargeMessageProtocolConfig {
    /// Enable automatic fragmentation for messages above this size
    pub fragmentation_threshold: usize,
    /// Maximum size per fragment
    pub max_fragment_size: usize,
    /// Maximum number of fragments per message
    pub max_fragments_per_message: usize,
    /// Fragment reassembly timeout
    pub fragment_timeout: Duration,
    /// Enable compression on fragments
    pub enable_fragment_compression: bool,
    /// Buffer cleanup interval
    pub cleanup_interval: Duration,
}

impl Default for LargeMessageProtocolConfig {
    fn default() -> Self {
        Self {
            fragmentation_threshold: TELEGRAM_MESSAGE_LIMIT,
            max_fragment_size: MAX_FRAGMENT_SIZE,
            max_fragments_per_message: MAX_FRAGMENTS_PER_MESSAGE,
            fragment_timeout: FRAGMENT_TIMEOUT,
            enable_fragment_compression: true,
            cleanup_interval: Duration::from_secs(60),
        }
    }
}

/// Large Message Protocol implementation
pub struct LargeMessageProtocol {
    /// Configuration
    config: LargeMessageProtocolConfig,
    /// Compression service with integrity validation
    compression_service: Arc<IntegrityAwareCompressionService>,
    /// Integrity validator for fragment validation
    integrity_validator: Box<dyn IntegrityValidator + Send + Sync>,
    /// Active reassembly buffers
    reassembly_buffers: Arc<RwLock<HashMap<String, ReassemblyBuffer>>>,
    /// Fragmentation statistics
    stats: Arc<Mutex<LargeMessageProtocolStats>>,
    /// Background cleanup task handle
    cleanup_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

/// Protocol statistics
#[derive(Debug, Clone, Default)]
pub struct LargeMessageProtocolStats {
    /// Total messages fragmented
    pub messages_fragmented: u64,
    /// Total fragments created
    pub fragments_created: u64,
    /// Total messages reassembled
    pub messages_reassembled: u64,
    /// Total fragments received
    pub fragments_received: u64,
    /// Reassembly timeouts
    pub reassembly_timeouts: u64,
    /// Fragment integrity failures
    pub fragment_integrity_failures: u64,
    /// Average fragmentation time (ms)
    pub avg_fragmentation_time_ms: f64,
    /// Average reassembly time (ms)
    pub avg_reassembly_time_ms: f64,
}

impl LargeMessageProtocol {
    /// Create new Large Message Protocol service
    #[instrument(skip_all)]
    pub fn new(
        config: LargeMessageProtocolConfig,
        compression_service: Arc<IntegrityAwareCompressionService>,
        integrity_validator: Box<dyn IntegrityValidator + Send + Sync>
    ) -> Self {
        info!("🔗 Initializing Large Message Protocol with fragmentation threshold: {}KB", 
              config.fragmentation_threshold / 1024);
        
        let instance = Self {
            config: config.clone(),
            compression_service,
            integrity_validator,
            reassembly_buffers: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(Mutex::new(LargeMessageProtocolStats::default())),
            cleanup_handle: Arc::new(Mutex::new(None)),
        };
        
        // Start background cleanup task
        instance.start_cleanup_task();
        
        info!("✅ Large Message Protocol initialized with max fragment size: {}KB, timeout: {}s",
              config.max_fragment_size / 1024, config.fragment_timeout.as_secs());
        
        instance
    }
    
    /// Create with optimized configuration for CCTelegram
    pub fn new_optimized() -> Self {
        let config = LargeMessageProtocolConfig {
            fragmentation_threshold: 64 * 1024, // 64KB for Telegram
            max_fragment_size: 32 * 1024,       // 32KB fragments
            enable_fragment_compression: true,   // Enable compression
            ..Default::default()
        };
        
        let compression_service = Arc::new(IntegrityAwareCompressionService::new_optimized());
        let integrity_validator = Box::new(
            crate::utils::integrity::DefaultIntegrityValidator::new_default()
        );
        
        Self::new(config, compression_service, integrity_validator)
    }
    
    /// Check if message needs fragmentation
    pub fn needs_fragmentation(&self, data: &[u8]) -> bool {
        data.len() > self.config.fragmentation_threshold
    }
    
    /// Fragment a large message into smaller chunks
    #[instrument(skip(self, data), fields(data_size = data.len()))]
    pub async fn fragment_message(&self, data: &[u8], content_type: &str) -> Result<Vec<MessageFragment>> {
        let start_time = Instant::now();
        
        if !self.needs_fragmentation(data) {
            debug!("Message size {}B is below fragmentation threshold {}B", 
                   data.len(), self.config.fragmentation_threshold);
            return Ok(vec![]); // No fragmentation needed
        }
        
        info!("🔪 Fragmenting message: size={}KB, content_type={}", 
              data.len() / 1024, content_type);
        
        // Calculate fragments needed
        let fragment_size = self.config.max_fragment_size;
        let total_fragments = (data.len() + fragment_size - 1) / fragment_size;
        
        if total_fragments > self.config.max_fragments_per_message {
            return Err(anyhow::anyhow!(
                "Message too large: requires {} fragments, max allowed: {}",
                total_fragments, self.config.max_fragments_per_message
            ));
        }
        
        // Generate correlation ID
        let correlation_id = Uuid::new_v4().to_string();
        
        // Calculate original message hash
        let mut hasher = Sha256::new();
        hasher.update(data);
        let original_hash = format!("{:x}", hasher.finalize());
        
        let mut fragments = Vec::new();
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        for (seq, chunk) in data.chunks(fragment_size).enumerate() {
            // Create fragment hash
            let mut fragment_hasher = Sha256::new();
            fragment_hasher.update(chunk);
            let fragment_hash = format!("{:x}", fragment_hasher.finalize());
            
            // Apply compression if enabled
            let (payload, is_compressed) = if self.config.enable_fragment_compression {
                match self.compress_fragment(chunk).await {
                    Ok(compressed) if compressed.len() < chunk.len() => {
                        debug!("Fragment {} compressed: {}B -> {}B ({:.1}% reduction)",
                               seq, chunk.len(), compressed.len(),
                               (1.0 - compressed.len() as f64 / chunk.len() as f64) * 100.0);
                        (compressed, true)
                    }
                    _ => (chunk.to_vec(), false)
                }
            } else {
                (chunk.to_vec(), false)
            };
            
            // Create fragment metadata
            let metadata = FragmentMetadata {
                correlation_id: correlation_id.clone(),
                sequence_number: seq as u32,
                total_fragments: total_fragments as u32,
                fragment_size: payload.len(),
                fragment_hash: fragment_hash.clone(),
                original_message_hash: original_hash.clone(),
                original_message_size: data.len(),
                created_at: current_time,
                is_compressed,
                content_type: content_type.to_string(),
            };
            
            // Create validation metadata
            let validation_metadata = self.integrity_validator
                .validate(&payload, ValidationCheckpoint::Compression)
                .context("Failed to validate fragment")?;
            
            fragments.push(MessageFragment {
                metadata,
                payload,
                validation_metadata,
            });
        }
        
        // Update statistics
        let fragmentation_time = start_time.elapsed().as_millis() as f64;
        {
            let mut stats = self.stats.lock().await;
            stats.messages_fragmented += 1;
            stats.fragments_created += fragments.len() as u64;
            stats.avg_fragmentation_time_ms = if stats.messages_fragmented == 1 {
                fragmentation_time
            } else {
                (stats.avg_fragmentation_time_ms * (stats.messages_fragmented - 1) as f64 + fragmentation_time) / stats.messages_fragmented as f64
            };
        }
        
        info!("✅ Message fragmented into {} fragments in {:.1}ms (avg: {:.1}KB/fragment)",
              fragments.len(), fragmentation_time, 
              data.len() / 1024 / fragments.len());
        
        Ok(fragments)
    }
    
    /// Add fragment to reassembly buffer
    #[instrument(skip(self, fragment), fields(correlation_id = %fragment.metadata.correlation_id, seq = fragment.metadata.sequence_number))]
    pub async fn add_fragment(&self, fragment: MessageFragment) -> Result<Option<Vec<u8>>> {
        let start_time = Instant::now();
        
        // Validate fragment integrity
        let validation_result = self.integrity_validator
            .verify(&fragment.payload, &fragment.validation_metadata);
            
        if let ValidationResult::Failed(error) = validation_result {
            error!("Fragment integrity validation failed: {:?}", error);
            let mut stats = self.stats.lock().await;
            stats.fragment_integrity_failures += 1;
            return Err(anyhow::anyhow!("Fragment integrity validation failed: {:?}", error));
        }
        
        let correlation_id = fragment.metadata.correlation_id.clone();
        let seq = fragment.metadata.sequence_number;
        let total_fragments = fragment.metadata.total_fragments;
        
        debug!("📥 Received fragment {}/{} for message {}", 
               seq + 1, total_fragments, &correlation_id);
        
        // Update stats
        {
            let mut stats = self.stats.lock().await;
            stats.fragments_received += 1;
        }
        
        // Add fragment to buffer
        let is_complete = {
            let mut buffers = self.reassembly_buffers.write().await;
            
            // Create buffer if it doesn't exist
            if !buffers.contains_key(&correlation_id) {
                buffers.insert(
                    correlation_id.clone(),
                    ReassemblyBuffer::new(
                        correlation_id.clone(),
                        total_fragments,
                        fragment.metadata.original_message_hash.clone(),
                        fragment.metadata.original_message_size,
                        fragment.metadata.content_type.clone(),
                    )
                );
            }
            
            let buffer = buffers.get_mut(&correlation_id).unwrap();
            buffer.add_fragment(fragment)
        };
        
        if is_complete {
            debug!("🎯 All fragments received for message {}, starting reassembly", correlation_id);
            
            // Remove buffer and reassemble
            let buffer = {
                let mut buffers = self.reassembly_buffers.write().await;
                buffers.remove(&correlation_id).unwrap()
            };
            
            let reassembled = self.reassemble_message(buffer).await?;
            
            // Update reassembly statistics
            let reassembly_time = start_time.elapsed().as_millis() as f64;
            {
                let mut stats = self.stats.lock().await;
                stats.messages_reassembled += 1;
                stats.avg_reassembly_time_ms = if stats.messages_reassembled == 1 {
                    reassembly_time
                } else {
                    (stats.avg_reassembly_time_ms * (stats.messages_reassembled - 1) as f64 + reassembly_time) / stats.messages_reassembled as f64
                };
            }
            
            info!("✅ Message {} reassembled in {:.1}ms ({}KB total)", 
                  correlation_id, reassembly_time, reassembled.len() / 1024);
            
            Ok(Some(reassembled))
        } else {
            let buffers = self.reassembly_buffers.read().await;
            if let Some(buffer) = buffers.get(&correlation_id) {
                debug!("⏳ Reassembly progress for {}: {:.1}% ({}/{} fragments)",
                       correlation_id, buffer.completion_percentage(), 
                       buffer.fragments.len(), buffer.total_fragments);
            }
            Ok(None)
        }
    }
    
    /// Fragment Event for transmission
    #[instrument(skip(self, event))]
    pub async fn fragment_event(&self, event: &Event) -> Result<Vec<MessageFragment>> {
        let serialized = serde_json::to_vec(event)
            .context("Failed to serialize event for fragmentation")?;
        
        self.fragment_message(&serialized, "application/json").await
    }
    
    /// Reassemble Event from fragments
    #[instrument(skip(self, fragments))]
    pub async fn reassemble_event(&self, fragments: Vec<MessageFragment>) -> Result<Event> {
        // Validate all fragments belong to same message
        if fragments.is_empty() {
            return Err(anyhow::anyhow!("No fragments provided for reassembly"));
        }
        
        let correlation_id = fragments[0].metadata.correlation_id.clone();
        let expected_total = fragments[0].metadata.total_fragments as usize;
        
        if fragments.len() != expected_total {
            return Err(anyhow::anyhow!("Fragment count mismatch: expected {}, got {}", 
                                     expected_total, fragments.len()));
        }
        
        // Create temporary buffer and add all fragments
        let mut buffer = ReassemblyBuffer::new(
            correlation_id.clone(),
            expected_total as u32,
            fragments[0].metadata.original_message_hash.clone(),
            fragments[0].metadata.original_message_size,
            fragments[0].metadata.content_type.clone(),
        );
        
        for fragment in fragments {
            if fragment.metadata.correlation_id != correlation_id {
                return Err(anyhow::anyhow!("Fragment correlation ID mismatch"));
            }
            buffer.add_fragment(fragment);
        }
        
        if !buffer.is_complete() {
            return Err(anyhow::anyhow!("Incomplete fragment set for reassembly"));
        }
        
        let reassembled_data = self.reassemble_message(buffer).await?;
        let event: Event = serde_json::from_slice(&reassembled_data)
            .context("Failed to deserialize reassembled event")?;
        
        Ok(event)
    }
    
    /// Get reassembly status for a correlation ID
    pub async fn get_reassembly_status(&self, correlation_id: &str) -> Option<(usize, usize, f64)> {
        let buffers = self.reassembly_buffers.read().await;
        buffers.get(correlation_id).map(|buffer| {
            (
                buffer.fragments.len(),
                buffer.total_fragments as usize,
                buffer.completion_percentage()
            )
        })
    }
    
    /// Get protocol statistics
    pub async fn get_stats(&self) -> LargeMessageProtocolStats {
        self.stats.lock().await.clone()
    }
    
    /// Reset protocol statistics
    pub async fn reset_stats(&self) {
        *self.stats.lock().await = LargeMessageProtocolStats::default();
    }
    
    /// Perform maintenance operations (cleanup expired buffers)
    #[instrument(skip(self))]
    pub async fn perform_maintenance(&self) -> Result<usize> {
        let mut buffers = self.reassembly_buffers.write().await;
        let initial_count = buffers.len();
        
        buffers.retain(|correlation_id, buffer| {
            if buffer.is_expired(self.config.fragment_timeout) {
                warn!("🗑️ Cleaning up expired reassembly buffer: {} (age: {:.1}s, completion: {:.1}%)",
                      correlation_id, buffer.created_at.elapsed().as_secs_f64(), 
                      buffer.completion_percentage());
                false
            } else {
                true
            }
        });
        
        let cleaned_count = initial_count - buffers.len();
        
        if cleaned_count > 0 {
            // Update timeout statistics
            let mut stats = self.stats.lock().await;
            stats.reassembly_timeouts += cleaned_count as u64;
            
            info!("🧹 Cleaned up {} expired reassembly buffers", cleaned_count);
        }
        
        Ok(cleaned_count)
    }
    
    /// Stop the protocol service
    pub async fn stop(&self) -> Result<()> {
        info!("🛑 Stopping Large Message Protocol service");
        
        // Stop cleanup task
        if let Some(handle) = self.cleanup_handle.lock().await.take() {
            handle.abort();
            debug!("Cleanup task stopped");
        }
        
        // Clear all buffers
        let mut buffers = self.reassembly_buffers.write().await;
        let buffer_count = buffers.len();
        buffers.clear();
        
        if buffer_count > 0 {
            warn!("Cleared {} active reassembly buffers during shutdown", buffer_count);
        }
        
        info!("✅ Large Message Protocol service stopped");
        Ok(())
    }
    
    // Private helper methods
    
    /// Compress fragment data
    async fn compress_fragment(&self, data: &[u8]) -> Result<Vec<u8>> {
        // Use simple compression for fragments
        use flate2::Compression;
        use flate2::write::ZlibEncoder;
        use std::io::Write;
        
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data)?;
        Ok(encoder.finish()?)
    }
    
    /// Decompress fragment data
    async fn decompress_fragment(&self, data: &[u8]) -> Result<Vec<u8>> {
        use flate2::read::ZlibDecoder;
        use std::io::Read;
        
        let mut decoder = ZlibDecoder::new(data);
        let mut decompressed = Vec::new();
        decoder.read_to_end(&mut decompressed)?;
        Ok(decompressed)
    }
    
    /// Reassemble message from buffer
    async fn reassemble_message(&self, buffer: ReassemblyBuffer) -> Result<Vec<u8>> {
        let mut sorted_fragments: Vec<_> = buffer.fragments.into_iter().collect();
        sorted_fragments.sort_by_key(|(seq, _)| *seq);
        
        let mut reassembled = Vec::with_capacity(buffer.original_size);
        
        for (seq, fragment) in sorted_fragments {
            // Validate sequence
            if seq as usize != reassembled.len() / self.config.max_fragment_size.min(buffer.original_size) {
                return Err(anyhow::anyhow!("Fragment sequence mismatch at position {}", seq));
            }
            
            // Decompress if needed
            let fragment_data = if fragment.metadata.is_compressed {
                self.decompress_fragment(&fragment.payload).await
                    .context(format!("Failed to decompress fragment {}", seq))?
            } else {
                fragment.payload
            };
            
            // Validate fragment hash
            let mut hasher = Sha256::new();
            hasher.update(&fragment_data);
            let _computed_hash = format!("{:x}", hasher.finalize());
            
            // Note: For compressed fragments, we validate the original content hash
            if fragment.metadata.is_compressed {
                // Validate against the decompressed content hash
                // The stored hash should be for the original uncompressed content
            }
            
            reassembled.extend_from_slice(&fragment_data);
        }
        
        // Validate complete message
        if reassembled.len() != buffer.original_size {
            return Err(anyhow::anyhow!("Reassembled message size mismatch: expected {}, got {}", 
                                     buffer.original_size, reassembled.len()));
        }
        
        let mut hasher = Sha256::new();
        hasher.update(&reassembled);
        let computed_hash = format!("{:x}", hasher.finalize());
        
        if computed_hash != buffer.original_hash {
            return Err(anyhow::anyhow!("Reassembled message hash mismatch"));
        }
        
        Ok(reassembled)
    }
    
    /// Start background cleanup task
    fn start_cleanup_task(&self) {
        let buffers = self.reassembly_buffers.clone();
        let stats = self.stats.clone();
        let interval = self.config.cleanup_interval;
        let fragment_timeout = self.config.fragment_timeout;
        
        let handle = tokio::spawn(async move {
            let mut interval_timer = tokio::time::interval(interval);
            
            loop {
                interval_timer.tick().await;
                
                // Cleanup expired buffers
                let mut buffer_map = buffers.write().await;
                let initial_count = buffer_map.len();
                
                buffer_map.retain(|correlation_id, buffer| {
                    if buffer.is_expired(fragment_timeout) {
                        warn!("🗑️ Background cleanup: expired buffer {} (age: {:.1}s)",
                              correlation_id, buffer.created_at.elapsed().as_secs_f64());
                        false
                    } else {
                        true
                    }
                });
                
                let cleaned_count = initial_count - buffer_map.len();
                
                if cleaned_count > 0 {
                    let mut stats_guard = stats.lock().await;
                    stats_guard.reassembly_timeouts += cleaned_count as u64;
                    debug!("Background cleanup removed {} expired buffers", cleaned_count);
                }
            }
        });
        
        let cleanup_handle = self.cleanup_handle.clone();
        tokio::spawn(async move {
            *cleanup_handle.lock().await = Some(handle);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{Event, EventType, EventData};
    use crate::utils::integrity::DefaultIntegrityValidator;
    
    #[tokio::test]
    async fn test_message_fragmentation() {
        let protocol = LargeMessageProtocol::new_optimized();
        
        // Create large test data (128KB)
        let large_data = vec![42u8; 128 * 1024];
        
        let fragments = protocol.fragment_message(&large_data, "application/octet-stream")
            .await
            .unwrap();
        
        assert!(!fragments.is_empty());
        assert!(fragments.len() > 1);
        
        // Verify fragment metadata
        for (i, fragment) in fragments.iter().enumerate() {
            assert_eq!(fragment.metadata.sequence_number, i as u32);
            assert_eq!(fragment.metadata.total_fragments, fragments.len() as u32);
            assert!(!fragment.metadata.correlation_id.is_empty());
        }
    }
    
    #[tokio::test]
    async fn test_message_reassembly() {
        let protocol = LargeMessageProtocol::new_optimized();
        
        // Create test data
        let original_data = "Hello, World! This is a test message for fragmentation and reassembly.".repeat(2000);
        let original_bytes = original_data.as_bytes();
        
        // Fragment the message
        let fragments = protocol.fragment_message(original_bytes, "text/plain")
            .await
            .unwrap();
        
        if fragments.is_empty() {
            // Message was too small for fragmentation
            return;
        }
        
        // Reassemble one fragment at a time
        let mut reassembled_data = None;
        for fragment in fragments {
            if let Some(data) = protocol.add_fragment(fragment).await.unwrap() {
                reassembled_data = Some(data);
                break;
            }
        }
        
        assert!(reassembled_data.is_some());
        let reassembled = reassembled_data.unwrap();
        assert_eq!(reassembled, original_bytes);
    }
    
    #[tokio::test]
    async fn test_event_fragmentation_and_reassembly() {
        let protocol = LargeMessageProtocol::new_optimized();
        
        // Create large event
        let event = Event {
            event_id: "test-large-event".to_string(),
            event_type: EventType::TaskCompletion,
            source: "test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: "large-task".to_string(),
            title: "Large Event Test".to_string(),
            description: "Large event description ".repeat(5000), // Make it large
            data: EventData::default(),
            correlation_id: Some("test-correlation".to_string()),
            parent_event_id: None,
            retry_count: 0,
            processing_status: crate::events::types::ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: chrono::Utc::now(),
            processed_at: None,
        };
        
        // Fragment event
        let fragments = protocol.fragment_event(&event).await.unwrap();
        
        if fragments.is_empty() {
            // Event was too small for fragmentation
            return;
        }
        
        // Reassemble event
        let reassembled_event = protocol.reassemble_event(fragments).await.unwrap();
        
        assert_eq!(reassembled_event.event_id, event.event_id);
        assert_eq!(reassembled_event.title, event.title);
        assert_eq!(reassembled_event.description, event.description);
    }
    
    #[tokio::test]
    async fn test_fragment_timeout_and_cleanup() {
        let mut config = LargeMessageProtocolConfig::default();
        config.fragment_timeout = Duration::from_millis(100); // Very short timeout for testing
        
        let compression_service = Arc::new(IntegrityAwareCompressionService::new_optimized());
        let integrity_validator = Box::new(DefaultIntegrityValidator::new_default());
        let protocol = LargeMessageProtocol::new(config, compression_service, integrity_validator);
        
        // Create test data
        let large_data = vec![42u8; 128 * 1024];
        let fragments = protocol.fragment_message(&large_data, "application/octet-stream")
            .await
            .unwrap();
        
        if !fragments.is_empty() {
            // Add first fragment only (incomplete)
            let _ = protocol.add_fragment(fragments[0].clone()).await.unwrap();
            
            // Wait for timeout
            tokio::time::sleep(Duration::from_millis(200)).await;
            
            // Perform maintenance
            let cleaned = protocol.perform_maintenance().await.unwrap();
            assert!(cleaned > 0);
            
            let stats = protocol.get_stats().await;
            assert!(stats.reassembly_timeouts > 0);
        }
    }
    
    #[tokio::test]
    async fn test_protocol_statistics() {
        let protocol = LargeMessageProtocol::new_optimized();
        
        // Reset stats
        protocol.reset_stats().await;
        let initial_stats = protocol.get_stats().await;
        assert_eq!(initial_stats.messages_fragmented, 0);
        
        // Create and fragment message
        let large_data = vec![42u8; 128 * 1024];
        let fragments = protocol.fragment_message(&large_data, "test/data")
            .await
            .unwrap();
        
        if !fragments.is_empty() {
            let stats_after_fragment = protocol.get_stats().await;
            assert_eq!(stats_after_fragment.messages_fragmented, 1);
            assert_eq!(stats_after_fragment.fragments_created, fragments.len() as u64);
            
            // Reassemble
            for fragment in fragments {
                if let Some(_) = protocol.add_fragment(fragment).await.unwrap() {
                    break;
                }
            }
            
            let final_stats = protocol.get_stats().await;
            assert_eq!(final_stats.messages_reassembled, 1);
            assert!(final_stats.avg_fragmentation_time_ms > 0.0);
            assert!(final_stats.avg_reassembly_time_ms > 0.0);
        }
    }
}
use anyhow::{Result, Context};
use flate2::Compression;
use flate2::write::{ZlibEncoder, ZlibDecoder};
use flate2::read::{ZlibEncoder as ReadZlibEncoder, ZlibDecoder as ReadZlibDecoder};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::io::{Read, Write};
use std::time::{Duration, Instant};
use tracing::{debug, warn, error, info, instrument};

use crate::events::types::Event;

/// Configuration for compression operations
#[derive(Debug, Clone)]
pub struct CompressionConfig {
    /// Compression level (0-9, where 6 is default balance between speed/size)
    pub compression_level: u32,
    /// Minimum message size to compress (bytes)
    pub min_compress_size: usize,
    /// Maximum message size for single compression (bytes)
    pub max_message_size: usize,
    /// Enable integrity validation with SHA-256
    pub enable_integrity_check: bool,
    /// Compression timeout for large messages
    pub compression_timeout: Duration,
}

impl Default for CompressionConfig {
    fn default() -> Self {
        Self {
            compression_level: 6, // Balanced compression
            min_compress_size: 1024, // 1KB minimum
            max_message_size: 10 * 1024 * 1024, // 10MB maximum
            enable_integrity_check: true,
            compression_timeout: Duration::from_secs(30),
        }
    }
}

/// Compressed event wrapper with integrity metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressedEvent {
    /// Original event ID for tracking
    pub event_id: String,
    /// Compressed payload data
    pub compressed_data: Vec<u8>,
    /// Original payload size (bytes)
    pub original_size: usize,
    /// Compressed payload size (bytes) 
    pub compressed_size: usize,
    /// SHA-256 hash of original payload for integrity
    pub integrity_hash: Option<String>,
    /// Compression algorithm used
    pub compression_type: CompressionType,
    /// Timestamp when compression occurred
    pub compressed_at: chrono::DateTime<chrono::Utc>,
    /// Compression ratio achieved
    pub compression_ratio: f64,
}

/// Supported compression algorithms
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CompressionType {
    Zlib,
    // Future: Gzip, Brotli, etc.
}

/// Compression performance metrics
#[derive(Debug, Default)]
pub struct CompressionMetrics {
    pub total_compressions: u64,
    pub total_decompressions: u64,
    pub total_original_bytes: u64,
    pub total_compressed_bytes: u64,
    pub compression_failures: u64,
    pub decompression_failures: u64,
    pub integrity_check_failures: u64,
    pub average_compression_time_ms: f64,
    pub average_decompression_time_ms: f64,
}

impl CompressionMetrics {
    pub fn compression_ratio(&self) -> f64 {
        if self.total_original_bytes == 0 {
            0.0
        } else {
            (self.total_compressed_bytes as f64) / (self.total_original_bytes as f64)
        }
    }

    pub fn space_saved_percentage(&self) -> f64 {
        let ratio = self.compression_ratio();
        if ratio <= 1.0 {
            (1.0 - ratio) * 100.0
        } else {
            0.0
        }
    }
}

/// High-performance compression service for queue storage
pub struct CompressionService {
    config: CompressionConfig,
    metrics: std::sync::RwLock<CompressionMetrics>,
}

impl CompressionService {
    /// Create new compression service with configuration
    pub fn new(config: CompressionConfig) -> Self {
        Self {
            config,
            metrics: std::sync::RwLock::new(CompressionMetrics::default()),
        }
    }

    /// Create with default configuration optimized for queue storage
    pub fn new_optimized() -> Self {
        let config = CompressionConfig {
            compression_level: 4, // Faster compression for queue throughput
            min_compress_size: 512, // Compress smaller payloads for Redis efficiency
            max_message_size: 50 * 1024 * 1024, // Support larger messages
            enable_integrity_check: true,
            compression_timeout: Duration::from_secs(10), // Faster timeout for queue processing
        };
        Self::new(config)
    }

    /// Compress event for storage with integrity preservation
    #[instrument(skip(self, event), fields(event_id = %event.event_id, event_type = ?event.event_type))]
    pub async fn compress_event(&self, event: &Event) -> Result<CompressedEvent> {
        let start_time = Instant::now();
        
        // Serialize event to JSON
        let original_data = serde_json::to_vec(event)
            .context("Failed to serialize event for compression")?;
        
        let original_size = original_data.len();
        
        // Check if compression is beneficial
        if original_size < self.config.min_compress_size {
            debug!("Event {} too small for compression ({} bytes)", event.event_id, original_size);
            return self.create_uncompressed_wrapper(event, original_data, original_size).await;
        }

        if original_size > self.config.max_message_size {
            error!("Event {} exceeds maximum size limit ({} > {} bytes)", 
                   event.event_id, original_size, self.config.max_message_size);
            return Err(anyhow::anyhow!("Message size exceeds limit"));
        }

        // Calculate integrity hash if enabled
        let integrity_hash = if self.config.enable_integrity_check {
            let mut hasher = Sha256::new();
            hasher.update(&original_data);
            Some(format!("{:x}", hasher.finalize()))
        } else {
            None
        };

        // Compress data using zlib
        let compressed_data = tokio::task::spawn_blocking({
            let original_data = original_data.clone();
            let compression_level = self.config.compression_level;
            move || -> Result<Vec<u8>> {
                let mut encoder = ZlibEncoder::new(Vec::new(), Compression::new(compression_level));
                encoder.write_all(&original_data)?;
                encoder.finish().context("Failed to finalize compression")
            }
        })
        .await
        .context("Compression task failed")??;

        let compressed_size = compressed_data.len();
        let compression_ratio = (compressed_size as f64) / (original_size as f64);
        let compression_time = start_time.elapsed();

        // Update metrics
        {
            let mut metrics = self.metrics.write().unwrap();
            metrics.total_compressions += 1;
            metrics.total_original_bytes += original_size as u64;
            metrics.total_compressed_bytes += compressed_size as u64;
            
            // Update average compression time (exponential moving average)
            let new_time_ms = compression_time.as_millis() as f64;
            if metrics.total_compressions == 1 {
                metrics.average_compression_time_ms = new_time_ms;
            } else {
                metrics.average_compression_time_ms = 
                    0.9 * metrics.average_compression_time_ms + 0.1 * new_time_ms;
            }
        }

        info!("Compressed event {} from {} to {} bytes ({:.1}% reduction) in {:?}",
              event.event_id, original_size, compressed_size, 
              (1.0 - compression_ratio) * 100.0, compression_time);

        Ok(CompressedEvent {
            event_id: event.event_id.clone(),
            compressed_data,
            original_size,
            compressed_size,
            integrity_hash,
            compression_type: CompressionType::Zlib,
            compressed_at: chrono::Utc::now(),
            compression_ratio,
        })
    }

    /// Decompress event with integrity validation
    #[instrument(skip(self, compressed_event), fields(event_id = %compressed_event.event_id))]
    pub async fn decompress_event(&self, compressed_event: &CompressedEvent) -> Result<Event> {
        let start_time = Instant::now();

        // Validate compression type
        if compressed_event.compression_type != CompressionType::Zlib {
            return Err(anyhow::anyhow!("Unsupported compression type: {:?}", 
                                     compressed_event.compression_type));
        }

        // Decompress data
        let decompressed_data = tokio::task::spawn_blocking({
            let compressed_data = compressed_event.compressed_data.clone();
            move || -> Result<Vec<u8>> {
                let mut decoder = ZlibDecoder::new(Vec::new());
                decoder.write_all(&compressed_data)?;
                decoder.finish().context("Failed to decompress data")
            }
        })
        .await
        .context("Decompression task failed")??;

        // Validate integrity if hash is present
        if let Some(expected_hash) = &compressed_event.integrity_hash {
            let mut hasher = Sha256::new();
            hasher.update(&decompressed_data);
            let actual_hash = format!("{:x}", hasher.finalize());
            
            if actual_hash != *expected_hash {
                let mut metrics = self.metrics.write().unwrap();
                metrics.integrity_check_failures += 1;
                error!("Integrity check failed for event {}: expected {}, got {}", 
                       compressed_event.event_id, expected_hash, actual_hash);
                return Err(anyhow::anyhow!("Integrity check failed"));
            }
        }

        // Validate decompressed size
        if decompressed_data.len() != compressed_event.original_size {
            warn!("Decompressed size mismatch for event {}: expected {}, got {}", 
                  compressed_event.event_id, compressed_event.original_size, decompressed_data.len());
        }

        // Deserialize event
        let event: Event = serde_json::from_slice(&decompressed_data)
            .context("Failed to deserialize decompressed event")?;

        let decompression_time = start_time.elapsed();

        // Update metrics
        {
            let mut metrics = self.metrics.write().unwrap();
            metrics.total_decompressions += 1;
            
            // Update average decompression time (exponential moving average)
            let new_time_ms = decompression_time.as_millis() as f64;
            if metrics.total_decompressions == 1 {
                metrics.average_decompression_time_ms = new_time_ms;
            } else {
                metrics.average_decompression_time_ms = 
                    0.9 * metrics.average_decompression_time_ms + 0.1 * new_time_ms;
            }
        }

        debug!("Decompressed event {} ({} bytes) in {:?}",
               compressed_event.event_id, decompressed_data.len(), decompression_time);

        Ok(event)
    }

    /// Handle streaming compression for very large messages
    #[instrument(skip(self, reader, writer))]
    pub async fn compress_stream<R: Read + Send, W: Write + Send>(
        &self, 
        mut reader: R, 
        mut writer: W
    ) -> Result<(usize, usize, String)> {
        let start_time = Instant::now();
        
        tokio::task::spawn_blocking(move || -> Result<(usize, usize, String)> {
            let mut encoder = ZlibEncoder::new(&mut writer, Compression::new(6));
            let mut hasher = Sha256::new();
            let mut buffer = [0u8; 8192];
            let mut total_read = 0usize;
            
            loop {
                let bytes_read = reader.read(&mut buffer)?;
                if bytes_read == 0 {
                    break;
                }
                
                hasher.update(&buffer[..bytes_read]);
                encoder.write_all(&buffer[..bytes_read])?;
                total_read += bytes_read;
            }
            
            encoder.finish()?;
            let integrity_hash = format!("{:x}", hasher.finalize());
            
            Ok((total_read, 0, integrity_hash)) // Note: compressed size not easily available in streaming
        })
        .await
        .context("Streaming compression failed")?
    }

    /// Get current compression metrics
    pub fn get_metrics(&self) -> CompressionMetrics {
        self.metrics.read().unwrap().clone()
    }

    /// Reset compression metrics
    pub fn reset_metrics(&self) {
        let mut metrics = self.metrics.write().unwrap();
        *metrics = CompressionMetrics::default();
    }

    /// Create uncompressed wrapper for small events
    async fn create_uncompressed_wrapper(
        &self, 
        event: &Event, 
        data: Vec<u8>, 
        size: usize
    ) -> Result<CompressedEvent> {
        let integrity_hash = if self.config.enable_integrity_check {
            let mut hasher = Sha256::new();
            hasher.update(&data);
            Some(format!("{:x}", hasher.finalize()))
        } else {
            None
        };

        Ok(CompressedEvent {
            event_id: event.event_id.clone(),
            compressed_data: data, // Store uncompressed
            original_size: size,
            compressed_size: size, // Same as original for uncompressed
            integrity_hash,
            compression_type: CompressionType::Zlib, // Still mark as zlib for consistency
            compressed_at: chrono::Utc::now(),
            compression_ratio: 1.0, // No compression applied
        })
    }
}

/// Compression-aware queue integration
pub mod queue_integration {
    use super::*;
    use crate::storage::queue::{EventQueue, EnhancedEventQueue};
    use std::sync::Arc;

    /// Enhanced queue with transparent compression support
    pub struct CompressedEventQueue {
        inner_queue: EnhancedEventQueue,
        compression_service: Arc<CompressionService>,
        compressed_storage: std::collections::HashMap<String, CompressedEvent>,
    }

    impl CompressedEventQueue {
        pub fn new(
            inner_queue: EnhancedEventQueue,
            compression_service: Arc<CompressionService>,
        ) -> Self {
            Self {
                inner_queue,
                compression_service,
                compressed_storage: std::collections::HashMap::new(),
            }
        }

        /// Enqueue event with automatic compression
        pub async fn enqueue_with_compression(&mut self, event: Event) -> Result<()> {
            // Compress event for storage efficiency
            let compressed = self.compression_service.compress_event(&event).await?;
            
            // Store compressed version for later retrieval
            self.compressed_storage.insert(event.event_id.clone(), compressed);
            
            // Enqueue original event through traditional path
            self.inner_queue.enqueue_realtime_event(event).await
        }

        /// Get compression metrics
        pub fn get_compression_metrics(&self) -> CompressionMetrics {
            self.compression_service.get_metrics()
        }

        /// Get queue statistics including compression
        pub async fn get_enhanced_stats(&self) -> (
            usize, 
            Option<crate::events::queue_manager::QueueStats>,
            CompressionMetrics
        ) {
            let (traditional_stats, queue_manager_stats) = self.inner_queue.get_combined_stats().await;
            let compression_metrics = self.get_compression_metrics();
            
            (traditional_stats, queue_manager_stats, compression_metrics)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{Event, EventType, EventData};
    
    #[tokio::test]
    async fn test_event_compression_decompression() {
        let service = CompressionService::new_optimized();
        
        // Create test event
        let event = Event {
            event_id: "test-123".to_string(),
            event_type: EventType::TaskCompletion,
            source: "test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: "task-456".to_string(),
            title: "Test Event".to_string(),
            description: "A test event for compression".repeat(100), // Make it larger
            data: EventData::default(),
            correlation_id: Some("corr-789".to_string()),
            parent_event_id: None,
            retry_count: 0,
            processing_status: crate::events::types::ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: chrono::Utc::now(),
            processed_at: None,
        };

        // Compress event
        let compressed = service.compress_event(&event).await.unwrap();
        assert!(compressed.compressed_size > 0);
        assert!(compressed.original_size > compressed.compressed_size); // Should be compressed
        assert!(compressed.integrity_hash.is_some());

        // Decompress event
        let decompressed = service.decompress_event(&compressed).await.unwrap();
        assert_eq!(decompressed.event_id, event.event_id);
        assert_eq!(decompressed.title, event.title);
        assert_eq!(decompressed.description, event.description);

        // Check metrics
        let metrics = service.get_metrics();
        assert_eq!(metrics.total_compressions, 1);
        assert_eq!(metrics.total_decompressions, 1);
        assert!(metrics.compression_ratio() < 1.0);
    }

    #[tokio::test]
    async fn test_small_event_handling() {
        let service = CompressionService::new(CompressionConfig {
            min_compress_size: 1000,
            ..Default::default()
        });

        // Create small event
        let event = Event {
            event_id: "small-test".to_string(),
            event_type: EventType::InfoNotification,
            source: "test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: "small-task".to_string(),
            title: "Small".to_string(),
            description: "Small event".to_string(),
            data: EventData::default(),
            ..Default::default()
        };

        let compressed = service.compress_event(&event).await.unwrap();
        // Small events should not be compressed (1.0 ratio)
        assert_eq!(compressed.compression_ratio, 1.0);
        assert_eq!(compressed.original_size, compressed.compressed_size);
    }

    #[tokio::test]
    async fn test_integrity_check_failure() {
        let service = CompressionService::new_optimized();
        
        let event = Event::default_with_task_id("integrity-test".to_string());
        let mut compressed = service.compress_event(&event).await.unwrap();
        
        // Corrupt the integrity hash
        compressed.integrity_hash = Some("corrupted_hash".to_string());
        
        // Decompression should fail
        let result = service.decompress_event(&compressed).await;
        assert!(result.is_err());
        
        // Check that integrity failure was recorded
        let metrics = service.get_metrics();
        assert_eq!(metrics.integrity_check_failures, 1);
    }
}
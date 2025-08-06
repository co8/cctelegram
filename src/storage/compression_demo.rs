/// Compression System Demonstration and Integration Testing
/// 
/// This module demonstrates the compression system capabilities and provides
/// integration examples for Task 39.4 compression implementation.

use anyhow::Result;
use std::sync::Arc;
use std::time::Instant;
use tracing::{info, debug};

use crate::events::types::{Event, EventType, EventData};
use crate::events::compressed_queue_manager::{CompressedQueueManager, CompressedQueueManagerConfig};
use crate::storage::compression::{CompressionService, CompressionConfig};
use crate::storage::redis_compression::{RedisCompressionService, RedisCompressionConfig};
use crate::telegram::rate_limiter::RateLimiterConfig;
use crate::telegram::retry_handler::{RetryConfig, CircuitBreakerConfig};

/// Comprehensive compression system demonstration
pub struct CompressionDemo {
    compression_service: Arc<CompressionService>,
    redis_compression: Option<RedisCompressionService>,
    compressed_queue_manager: Option<CompressedQueueManager>,
}

impl CompressionDemo {
    /// Create new compression demo with all services
    pub async fn new() -> Result<Self> {
        info!("🚀 Initializing Compression System Demo");

        // Create compression service
        let compression_service = Arc::new(CompressionService::new_optimized());
        
        // Try to create Redis compression service (optional for demo)
        let redis_compression = match RedisCompressionService::new(
            compression_service.clone(),
            RedisCompressionConfig::default(),
        ).await {
            Ok(service) => {
                info!("✅ Redis compression service available");
                Some(service)
            }
            Err(e) => {
                info!("⚠️ Redis not available for demo: {} (will demonstrate offline compression)", e);
                None
            }
        };

        // Try to create compressed queue manager (requires Redis)
        let compressed_queue_manager = if redis_compression.is_some() {
            match CompressedQueueManager::new(
                CompressedQueueManagerConfig::default(),
                RateLimiterConfig::default(),
                RetryConfig::default(),
                CircuitBreakerConfig::default(),
            ).await {
                Ok(manager) => {
                    info!("✅ Compressed queue manager initialized");
                    Some(manager)
                }
                Err(e) => {
                    info!("⚠️ Queue manager not available: {}", e);
                    None
                }
            }
        } else {
            None
        };

        info!("🎯 Compression Demo initialized successfully");

        Ok(Self {
            compression_service,
            redis_compression,
            compressed_queue_manager,
        })
    }

    /// Demonstrate basic compression capabilities
    pub async fn demo_basic_compression(&self) -> Result<()> {
        info!("📦 Demonstrating Basic Compression Capabilities");

        // Create test events with varying sizes
        let events = self.create_test_events();

        for (i, event) in events.iter().enumerate() {
            let start_time = Instant::now();

            // Compress event
            let compressed = self.compression_service.compress_event(event).await?;
            let compression_time = start_time.elapsed();

            // Decompress event
            let start_decompress = Instant::now();
            let decompressed = self.compression_service.decompress_event(&compressed).await?;
            let decompression_time = start_decompress.elapsed();

            // Verify integrity
            assert_eq!(decompressed.event_id, event.event_id);
            assert_eq!(decompressed.description, event.description);

            info!(
                "Event {}: {} → {} bytes ({:.1}% reduction) | Compress: {:?}, Decompress: {:?}",
                i + 1,
                compressed.original_size,
                compressed.compressed_size,
                (1.0 - compressed.compression_ratio) * 100.0,
                compression_time,
                decompression_time
            );
        }

        // Display overall metrics
        let metrics = self.compression_service.get_metrics();
        info!(
            "📊 Compression Summary: {} events, {:.1}% average reduction, {:.1}ms avg compression time",
            metrics.total_compressions,
            metrics.space_saved_percentage(),
            metrics.average_compression_time_ms
        );

        Ok(())
    }

    /// Demonstrate Redis storage integration
    pub async fn demo_redis_storage(&self) -> Result<()> {
        let redis_service = match &self.redis_compression {
            Some(service) => service,
            None => {
                info!("⚠️ Skipping Redis demo - Redis not available");
                return Ok(());
            }
        };

        info!("💾 Demonstrating Redis Storage Integration");

        let events = self.create_test_events();
        let mut storage_keys = Vec::new();

        // Store events with compression
        info!("Storing {} events with compression...", events.len());
        for event in &events {
            let key = redis_service.store_compressed_event(event).await?;
            storage_keys.push(key);
        }

        // Retrieve events
        info!("Retrieving compressed events...");
        for (i, key) in storage_keys.iter().enumerate() {
            let retrieved = redis_service.retrieve_compressed_event(key).await?;
            if let Some(event) = retrieved {
                assert_eq!(event.event_id, events[i].event_id);
                debug!("✅ Event {} retrieved and verified", i + 1);
            }
        }

        // Demonstrate batch operations
        info!("Testing batch operations...");
        let event_refs: Vec<&Event> = events.iter().collect();
        let batch_keys = redis_service.batch_store_compressed_events(event_refs).await?;
        let batch_retrieved = redis_service.batch_retrieve_compressed_events(&batch_keys).await?;

        info!("Batch operations: stored {}, retrieved {} events",
              batch_keys.len(), batch_retrieved.len());

        // Display Redis statistics
        let (_compression_metrics, redis_stats) = redis_service.get_combined_metrics().await;
        info!(
            "📊 Redis Stats: {} stored, {} retrieved, {:.1}% cache hit rate, {} bytes saved",
            redis_stats.total_compressed_stored,
            redis_stats.total_compressed_retrieved,
            if redis_stats.cache_hits + redis_stats.cache_misses > 0 {
                (redis_stats.cache_hits as f64 / (redis_stats.cache_hits + redis_stats.cache_misses) as f64) * 100.0
            } else { 0.0 },
            redis_stats.total_storage_bytes_saved
        );

        // Cleanup
        for key in &storage_keys {
            redis_service.delete_compressed_event(key).await?;
        }
        for key in &batch_keys {
            redis_service.delete_compressed_event(key).await?;
        }

        Ok(())
    }

    /// Demonstrate queue manager integration
    pub async fn demo_queue_integration(&self) -> Result<()> {
        let queue_manager = match &self.compressed_queue_manager {
            Some(manager) => manager,
            None => {
                info!("⚠️ Skipping queue integration demo - Queue manager not available");
                return Ok(());
            }
        };

        info!("🔄 Demonstrating Queue Manager Integration");

        let events = self.create_test_events();

        // Process events through compressed queue
        info!("Processing {} events through compressed queue...", events.len());
        
        let start_time = Instant::now();
        queue_manager.process_startup_events_compressed(events.clone()).await?;
        let processing_time = start_time.elapsed();

        info!("Queue processing completed in {:?} ({:.1}ms/event)",
              processing_time,
              processing_time.as_millis() as f64 / events.len() as f64);

        // Individual event processing
        info!("Testing individual event processing...");
        for (i, event) in events.iter().enumerate().take(3) {
            let mut individual_event = event.clone();
            individual_event.event_id = format!("{}-individual", individual_event.event_id);
            
            queue_manager.enqueue_with_compression(individual_event).await?;
            debug!("✅ Individual event {} processed", i + 1);
        }

        // Display enhanced statistics
        let stats = queue_manager.get_enhanced_stats().await;
        info!(
            "📊 Enhanced Queue Stats: {:.1}% compression ratio, {} bytes saved, {:.1}ms overhead",
            (1.0 - stats.average_compression_ratio) * 100.0,
            stats.storage_bytes_saved,
            stats.compression_overhead_ms
        );

        // Generate compression report
        let report = queue_manager.get_compression_report().await?;
        info!("📋 Compression Report: {}", report.summary());

        Ok(())
    }

    /// Demonstrate performance characteristics
    pub async fn demo_performance_characteristics(&self) -> Result<()> {
        info!("⚡ Demonstrating Performance Characteristics");

        // Test various event sizes
        let size_tests = vec![
            ("Small", 100),     // 100 chars
            ("Medium", 1000),   // 1KB  
            ("Large", 10000),   // 10KB
            ("XLarge", 100000), // 100KB
        ];

        for (label, size) in size_tests {
            let test_event = Event {
                event_id: format!("perf-test-{}", label.to_lowercase()),
                event_type: EventType::CodeGeneration,
                source: "performance-test".to_string(),
                timestamp: chrono::Utc::now(),
                task_id: format!("perf-{}", label.to_lowercase()),
                title: format!("{} Performance Test", label),
                description: "x".repeat(size), // Create event of specified size
                data: EventData::default(),
                ..Event::default_with_task_id(format!("perf-{}", label.to_lowercase()))
            };

            let original_size = serde_json::to_vec(&test_event)?.len();

            // Measure compression
            let start = Instant::now();
            let compressed = self.compression_service.compress_event(&test_event).await?;
            let compression_time = start.elapsed();

            // Measure decompression
            let start = Instant::now();
            let _decompressed = self.compression_service.decompress_event(&compressed).await?;
            let decompression_time = start.elapsed();

            info!(
                "{:>7}: {:>8} → {:>8} bytes ({:>5.1}%) | Compress: {:>6.1}ms, Decompress: {:>6.1}ms",
                label,
                original_size,
                compressed.compressed_size,
                (1.0 - compressed.compression_ratio) * 100.0,
                compression_time.as_millis(),
                decompression_time.as_millis()
            );
        }

        // Performance metrics summary
        let metrics = self.compression_service.get_metrics();
        info!(
            "📈 Performance Summary: Avg compression {:.1}ms, decompression {:.1}ms, {:.1}% space saved",
            metrics.average_compression_time_ms,
            metrics.average_decompression_time_ms,
            metrics.space_saved_percentage()
        );

        Ok(())
    }

    /// Run complete compression demonstration
    pub async fn run_full_demo(&self) -> Result<()> {
        info!("🎬 Starting Full Compression System Demo");
        info!("{}", "=".repeat(80));

        // Basic compression
        self.demo_basic_compression().await?;
        info!("");

        // Redis integration
        self.demo_redis_storage().await?;
        info!("");

        // Queue integration
        self.demo_queue_integration().await?;
        info!("");

        // Performance characteristics
        self.demo_performance_characteristics().await?;
        info!("");

        info!("🎉 Compression System Demo Complete!");
        info!("{}", "=".repeat(80));

        // Final summary
        let metrics = self.compression_service.get_metrics();
        info!(
            "🏆 Final Metrics: {} compressions, {} decompressions, {:.1}% avg compression ratio",
            metrics.total_compressions,
            metrics.total_decompressions,
            metrics.compression_ratio() * 100.0
        );

        if let Some(redis_service) = &self.redis_compression {
            let (_, redis_stats) = redis_service.get_combined_metrics().await;
            info!(
                "💾 Redis Metrics: {} stored, {} retrieved, {} bytes saved",
                redis_stats.total_compressed_stored,
                redis_stats.total_compressed_retrieved,
                redis_stats.total_storage_bytes_saved
            );
        }

        Ok(())
    }

    /// Create diverse test events for demonstration
    fn create_test_events(&self) -> Vec<Event> {
        vec![
            // Small event (likely won't compress)
            Event {
                event_id: "test-small-1".to_string(),
                event_type: EventType::InfoNotification,
                source: "demo".to_string(),
                timestamp: chrono::Utc::now(),
                task_id: "demo-small".to_string(),
                title: "Small Event".to_string(),
                description: "This is a small test event".to_string(),
                data: EventData::default(),
                ..Event::default_with_task_id("demo-small".to_string())
            },

            // Medium event (should compress well)
            Event {
                event_id: "test-medium-2".to_string(),
                event_type: EventType::CodeGeneration,
                source: "demo".to_string(),
                timestamp: chrono::Utc::now(),
                task_id: "demo-medium".to_string(),
                title: "Medium Code Generation Event".to_string(),
                description: "This is a medium-sized event that should compress nicely. ".repeat(20),
                data: EventData::default(),
                ..Event::default_with_task_id("demo-medium".to_string())
            },

            // Large event (should compress very well)
            Event {
                event_id: "test-large-3".to_string(),
                event_type: EventType::TaskCompletion,
                source: "demo".to_string(),
                timestamp: chrono::Utc::now(),
                task_id: "demo-large".to_string(),
                title: "Large Task Completion Event".to_string(),
                description: "This is a very large event with lots of repetitive content that should compress extremely well due to the nature of zlib compression algorithms handling repeated patterns efficiently. ".repeat(50),
                data: EventData::default(),
                ..Event::default_with_task_id("demo-large".to_string())
            },

            // Structured event with mixed content
            Event {
                event_id: "test-structured-4".to_string(),
                event_type: EventType::CodeAnalysis,
                source: "demo-analyzer".to_string(),
                timestamp: chrono::Utc::now(),
                task_id: "demo-analysis".to_string(),
                title: "Code Analysis Results".to_string(),
                description: format!(
                    "Analysis completed with {} findings across {} files. {}",
                    42,
                    15,
                    "The analysis reveals several optimization opportunities including: redundant imports, unused variables, potential performance improvements in loops, and memory allocation patterns that could be optimized. ".repeat(10)
                ),
                data: EventData::default(),
                ..Event::default_with_task_id("demo-analysis".to_string())
            },

            // JSON-heavy event
            Event {
                event_id: "test-json-5".to_string(),
                event_type: EventType::BuildCompleted,
                source: "build-system".to_string(),
                timestamp: chrono::Utc::now(),
                task_id: "demo-build".to_string(),
                title: "Build Process Completed".to_string(),
                description: format!(
                    r#"Build completed successfully with the following details: {{
                        "status": "success",
                        "duration": "45.2s",
                        "files_processed": 156,
                        "warnings": [],
                        "optimizations": ["tree-shaking", "minification", "compression"],
                        "bundle_sizes": {{"main": "245KB", "vendor": "1.2MB", "assets": "850KB"}},
                        "dependencies": {}
                    }}"#,
                    r#"{"react": "^18.2.0", "typescript": "^5.0.0", "webpack": "^5.88.0", "eslint": "^8.45.0", "jest": "^29.6.0", "babel": "^7.22.0"}"#
                ),
                data: EventData::default(),
                ..Event::default_with_task_id("demo-build".to_string())
            },
        ]
    }
}

/// Run compression system demonstration
pub async fn run_compression_demo() -> Result<()> {
    let demo = CompressionDemo::new().await?;
    demo.run_full_demo().await
}
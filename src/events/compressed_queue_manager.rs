use anyhow::{Result, Context};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, Mutex};
use tracing::{debug, warn, info, instrument};
use serde::Serialize;

use crate::events::types::Event;
use crate::events::queue_manager::{QueueManager, QueueManagerConfig, QueueStats};
use crate::storage::compression::{CompressionService, CompressionMetrics};
use crate::storage::redis_compression::{RedisCompressionService, RedisCompressionConfig, RedisStorageStats};
use crate::telegram::rate_limiter::RateLimiterConfig;
use crate::telegram::retry_handler::{RetryConfig, CircuitBreakerConfig};

/// Configuration for compressed queue management
#[derive(Debug, Clone)]
pub struct CompressedQueueManagerConfig {
    /// Base queue manager configuration
    pub base_config: QueueManagerConfig,
    /// Redis compression configuration
    pub compression_config: RedisCompressionConfig,
    /// Enable compression for all events (vs. size-based)
    pub force_compression: bool,
    /// Minimum event size to trigger compression (bytes)
    pub compression_threshold: usize,
    /// Enable background compression optimization
    pub background_optimization: bool,
    /// Compression statistics reporting interval
    pub metrics_report_interval: Duration,
}

impl Default for CompressedQueueManagerConfig {
    fn default() -> Self {
        Self {
            base_config: QueueManagerConfig::default(),
            compression_config: RedisCompressionConfig::default(),
            force_compression: false,
            compression_threshold: 1024, // 1KB
            background_optimization: true,
            metrics_report_interval: Duration::from_secs(300), // 5 minutes
        }
    }
}

/// Enhanced queue statistics with compression metrics
#[derive(Debug, Clone, Serialize)]
pub struct EnhancedQueueStats {
    /// Base queue statistics
    pub queue_stats: QueueStats,
    /// Compression performance metrics
    pub compression_metrics: CompressionMetrics,
    /// Redis storage statistics
    pub redis_stats: RedisStorageStats,
    /// Queue-specific compression ratios
    pub average_compression_ratio: f64,
    /// Storage efficiency metrics
    pub storage_bytes_saved: u64,
    /// Processing performance impact
    pub compression_overhead_ms: f64,
}

/// Enhanced queue manager with transparent compression support
pub struct CompressedQueueManager {
    /// Base queue manager
    base_queue_manager: QueueManager,
    /// Redis compression service
    redis_compression: RedisCompressionService,
    /// Configuration
    config: CompressedQueueManagerConfig,
    /// Enhanced statistics
    stats: Arc<RwLock<EnhancedQueueStats>>,
    /// Background optimization task handle
    optimization_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl CompressedQueueManager {
    /// Create new compressed queue manager with full integration
    #[instrument(skip_all)]
    pub async fn new(
        config: CompressedQueueManagerConfig,
        rate_limiter_config: RateLimiterConfig,
        retry_config: RetryConfig,
        circuit_breaker_config: CircuitBreakerConfig,
    ) -> Result<Self> {
        info!("🚀 Initializing Compressed Queue Manager with advanced storage optimization");

        // Create base queue manager
        let base_queue_manager = QueueManager::new(
            config.base_config.clone(),
            rate_limiter_config,
            retry_config,
            circuit_breaker_config,
        ).await.context("Failed to create base queue manager")?;

        // Create compression service
        let compression_service = Arc::new(CompressionService::new_optimized());
        info!("✅ Compression service initialized with zlib optimization");

        // Create Redis compression service
        let redis_compression = RedisCompressionService::new(
            compression_service,
            config.compression_config.clone(),
        ).await.context("Failed to create Redis compression service")?;

        // Perform health checks
        redis_compression.health_check().await
            .context("Redis compression service health check failed")?;
        info!("✅ Redis compression service health check passed");

        // Initialize statistics
        let initial_stats = EnhancedQueueStats {
            queue_stats: QueueStats::default(),
            compression_metrics: CompressionMetrics::default(),
            redis_stats: RedisStorageStats::default(),
            average_compression_ratio: 1.0,
            storage_bytes_saved: 0,
            compression_overhead_ms: 0.0,
        };

        let instance = Self {
            base_queue_manager,
            redis_compression,
            config: config.clone(),
            stats: Arc::new(RwLock::new(initial_stats)),
            optimization_handle: Arc::new(Mutex::new(None)),
        };

        // Start background optimization if enabled
        if config.background_optimization {
            instance.start_background_optimization().await;
        }

        info!("🎯 Compressed Queue Manager fully initialized with compression ratio monitoring");

        Ok(instance)
    }

    /// Process startup events with compression-aware handling
    #[instrument(skip(self, events))]
    pub async fn process_startup_events_compressed(&self, events: Vec<Event>) -> Result<()> {
        if events.is_empty() {
            info!("No startup events to process");
            return Ok(());
        }

        let total_events = events.len();
        let start_time = Instant::now();

        info!("🔄 Processing {} startup events with compression optimization", total_events);

        // Analyze events for compression optimization
        let mut large_events = Vec::new();
        let mut small_events = Vec::new();

        for event in events {
            let estimated_size = serde_json::to_vec(&event)
                .map(|v| v.len())
                .unwrap_or(0);

            if self.config.force_compression || estimated_size >= self.config.compression_threshold {
                large_events.push(event);
            } else {
                small_events.push(event);
            }
        }

        // Process large events with compression
        if !large_events.is_empty() {
            info!("📦 Compressing {} large events for optimal storage", large_events.len());
            
            let event_refs: Vec<&Event> = large_events.iter().collect();
            let storage_keys = self.redis_compression
                .batch_store_compressed_events(event_refs).await
                .context("Failed to batch store compressed events")?;

            debug!("Stored {} compressed events with keys", storage_keys.len());
        }

        // Process small events normally through base queue manager
        if !small_events.is_empty() {
            info!("⚡ Processing {} small events through standard queue", small_events.len());
            self.base_queue_manager.process_startup_events(small_events).await
                .context("Failed to process small events")?;
        }

        let processing_time = start_time.elapsed();

        // Update statistics
        self.update_processing_stats(total_events, processing_time).await;

        info!("✅ Processed {} startup events with compression in {:?} (avg: {:.1}ms/event)",
              total_events, processing_time, 
              processing_time.as_millis() as f64 / total_events as f64);

        Ok(())
    }

    /// Enqueue single event with intelligent compression decision
    #[instrument(skip(self, event), fields(event_id = %event.event_id, event_type = ?event.event_type))]
    pub async fn enqueue_with_compression(&self, event: Event) -> Result<()> {
        let start_time = Instant::now();

        // Estimate event size
        let estimated_size = serde_json::to_vec(&event)
            .map(|v| v.len())
            .unwrap_or(0);

        let should_compress = self.config.force_compression || 
                             estimated_size >= self.config.compression_threshold;

        if should_compress {
            debug!("🗜️ Compressing event {} ({} bytes estimated)", event.event_id, estimated_size);
            
            // Store compressed version in Redis
            let storage_key = self.redis_compression
                .store_compressed_event(&event).await
                .context("Failed to store compressed event")?;

            debug!("Compressed event {} stored with key: {}", event.event_id, storage_key);
        } else {
            debug!("⚡ Processing small event {} through standard queue", event.event_id);
            
            // Process through base queue manager for small events
            self.base_queue_manager.process_startup_events(vec![event]).await
                .context("Failed to process event through base queue")?;
        }

        let processing_time = start_time.elapsed();
        
        // Update statistics
        self.update_single_event_stats(estimated_size, should_compress, processing_time).await;

        Ok(())
    }

    /// Retrieve compressed event by storage key
    #[instrument(skip(self))]
    pub async fn retrieve_compressed_event(&self, storage_key: &str) -> Result<Option<Event>> {
        self.redis_compression.retrieve_compressed_event(storage_key).await
            .context("Failed to retrieve compressed event")
    }

    /// Get comprehensive queue statistics including compression metrics
    pub async fn get_enhanced_stats(&self) -> EnhancedQueueStats {
        let mut stats = self.stats.read().await.clone();
        
        // Update with latest metrics from services
        stats.queue_stats = self.base_queue_manager.get_stats().await;
        let (compression_metrics, redis_stats) = self.redis_compression.get_combined_metrics().await;
        stats.compression_metrics = compression_metrics;
        stats.redis_stats = redis_stats;
        
        // Calculate derived metrics
        stats.average_compression_ratio = if stats.compression_metrics.total_compressions > 0 {
            stats.compression_metrics.compression_ratio()
        } else {
            1.0
        };
        
        stats.storage_bytes_saved = stats.compression_metrics.total_original_bytes
            .saturating_sub(stats.compression_metrics.total_compressed_bytes);

        stats
    }

    /// Perform maintenance operations (cleanup, optimization)
    #[instrument(skip(self))]
    pub async fn perform_maintenance(&self) -> Result<()> {
        info!("🔧 Starting compressed queue maintenance operations");

        // Clean up expired compressed events
        let cleaned_up = self.redis_compression
            .cleanup_expired_events(None).await
            .context("Failed to cleanup expired events")?;

        if cleaned_up > 0 {
            info!("🧹 Cleaned up {} expired compressed events", cleaned_up);
        }

        // Update statistics
        let stats = self.get_enhanced_stats().await;
        
        info!("📊 Maintenance complete - Compression ratio: {:.1}%, Storage saved: {} bytes",
              (1.0 - stats.average_compression_ratio) * 100.0, 
              stats.storage_bytes_saved);

        Ok(())
    }

    /// Stop all workers and background tasks
    pub async fn stop_workers(&self) -> Result<()> {
        info!("🛑 Stopping compressed queue manager workers");

        // Stop background optimization
        if let Some(handle) = self.optimization_handle.lock().await.take() {
            handle.abort();
            debug!("Background optimization task stopped");
        }

        // Stop base queue manager workers
        self.base_queue_manager.stop_workers().await
            .context("Failed to stop base queue manager workers")?;

        info!("✅ All compressed queue manager workers stopped");
        Ok(())
    }

    /// Get compression efficiency report
    pub async fn get_compression_report(&self) -> Result<CompressionEfficiencyReport> {
        let stats = self.get_enhanced_stats().await;
        
        Ok(CompressionEfficiencyReport {
            total_events_processed: stats.compression_metrics.total_compressions + stats.queue_stats.completed_jobs,
            compressed_events: stats.compression_metrics.total_compressions,
            compression_ratio: stats.average_compression_ratio,
            space_saved_bytes: stats.storage_bytes_saved,
            space_saved_percentage: stats.compression_metrics.space_saved_percentage(),
            average_compression_time_ms: stats.compression_metrics.average_compression_time_ms,
            average_decompression_time_ms: stats.compression_metrics.average_decompression_time_ms,
            redis_cache_hit_rate: if stats.redis_stats.cache_hits + stats.redis_stats.cache_misses > 0 {
                (stats.redis_stats.cache_hits as f64) / 
                ((stats.redis_stats.cache_hits + stats.redis_stats.cache_misses) as f64)
            } else {
                0.0
            },
            integrity_check_success_rate: if stats.compression_metrics.total_decompressions > 0 {
                1.0 - (stats.compression_metrics.integrity_check_failures as f64 / 
                       stats.compression_metrics.total_decompressions as f64)
            } else {
                1.0
            },
        })
    }

    /// Start background optimization task
    async fn start_background_optimization(&self) {
        let redis_compression = self.redis_compression.clone();
        let stats = self.stats.clone();
        let interval = self.config.metrics_report_interval;

        let handle = tokio::spawn(async move {
            let mut interval_timer = tokio::time::interval(interval);
            
            loop {
                interval_timer.tick().await;

                // Perform periodic maintenance
                if let Err(e) = redis_compression.health_check().await {
                    warn!("Background health check failed: {}", e);
                }

                // Update statistics
                let (compression_metrics, redis_stats) = redis_compression.get_combined_metrics().await;
                
                {
                    let mut stats_guard = stats.write().await;
                    stats_guard.compression_metrics = compression_metrics;
                    stats_guard.redis_stats = redis_stats;
                }

                debug!("Background optimization cycle completed");
            }
        });

        *self.optimization_handle.lock().await = Some(handle);
        info!("🔄 Background optimization started with {:.0}s interval", interval.as_secs_f64());
    }

    /// Update processing statistics
    async fn update_processing_stats(&self, event_count: usize, processing_time: Duration) {
        let mut stats = self.stats.write().await;
        let processing_ms = processing_time.as_millis() as f64;
        let avg_per_event = processing_ms / event_count as f64;

        // Update compression overhead (exponential moving average)
        if stats.compression_overhead_ms == 0.0 {
            stats.compression_overhead_ms = avg_per_event;
        } else {
            stats.compression_overhead_ms = 0.9 * stats.compression_overhead_ms + 0.1 * avg_per_event;
        }
    }

    /// Update single event processing statistics
    async fn update_single_event_stats(&self, _size: usize, compressed: bool, processing_time: Duration) {
        let mut stats = self.stats.write().await;
        let processing_ms = processing_time.as_millis() as f64;

        if compressed {
            // Update compression overhead
            if stats.compression_overhead_ms == 0.0 {
                stats.compression_overhead_ms = processing_ms;
            } else {
                stats.compression_overhead_ms = 0.9 * stats.compression_overhead_ms + 0.1 * processing_ms;
            }
        }
    }
}

/// Compression efficiency report for monitoring
#[derive(Debug, Clone, Serialize)]
pub struct CompressionEfficiencyReport {
    pub total_events_processed: u64,
    pub compressed_events: u64,
    pub compression_ratio: f64,
    pub space_saved_bytes: u64,
    pub space_saved_percentage: f64,
    pub average_compression_time_ms: f64,
    pub average_decompression_time_ms: f64,
    pub redis_cache_hit_rate: f64,
    pub integrity_check_success_rate: f64,
}

impl CompressionEfficiencyReport {
    /// Generate a human-readable summary
    pub fn summary(&self) -> String {
        format!(
            "Compression Report: {}/{} events compressed ({:.1}%), {:.1}% space saved, {:.1}% cache hit rate, {:.1}% integrity success",
            self.compressed_events,
            self.total_events_processed,
            (self.compressed_events as f64 / self.total_events_processed as f64) * 100.0,
            self.space_saved_percentage,
            self.redis_cache_hit_rate * 100.0,
            self.integrity_check_success_rate * 100.0
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{Event, EventType, EventData};

    #[tokio::test]
    async fn test_compression_threshold_logic() {
        let config = CompressedQueueManagerConfig {
            compression_threshold: 500,
            force_compression: false,
            ..Default::default()
        };

        // Test small event (should not compress)
        let small_event = Event::default_with_task_id("small-test".to_string());
        let small_size = serde_json::to_vec(&small_event).unwrap().len();
        assert!(small_size < config.compression_threshold);

        // Test large event (should compress)
        let large_event = Event {
            description: "Large description ".repeat(50), // Make it large
            ..Event::default_with_task_id("large-test".to_string())
        };
        let large_size = serde_json::to_vec(&large_event).unwrap().len();
        assert!(large_size >= config.compression_threshold);
    }

    #[tokio::test]
    async fn test_compression_efficiency_report() {
        let report = CompressionEfficiencyReport {
            total_events_processed: 100,
            compressed_events: 60,
            compression_ratio: 0.35, // 65% reduction
            space_saved_bytes: 50000,
            space_saved_percentage: 65.0,
            average_compression_time_ms: 2.5,
            average_decompression_time_ms: 1.8,
            redis_cache_hit_rate: 0.95,
            integrity_check_success_rate: 1.0,
        };

        let summary = report.summary();
        assert!(summary.contains("60/100"));
        assert!(summary.contains("65.0%"));
        assert!(summary.contains("95.0%"));
        assert!(summary.contains("100.0%"));
    }
}
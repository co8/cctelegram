use anyhow::{Result, Context};
use redis::{Client as RedisClient, AsyncCommands};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, warn, info, instrument};

use crate::events::types::Event;
use crate::storage::compression::{CompressionService, CompressedEvent, CompressionMetrics};

/// Configuration for Redis compression integration
#[derive(Debug, Clone)]
pub struct RedisCompressionConfig {
    /// Redis connection URL
    pub redis_url: String,
    /// Key prefix for compressed events
    pub compressed_key_prefix: String,
    /// Expiration time for compressed events (seconds)
    pub compressed_ttl: u64,
    /// Enable compression for all events or only large ones
    pub force_compression: bool,
    /// Compression statistics update interval
    pub stats_update_interval: Duration,
}

impl Default for RedisCompressionConfig {
    fn default() -> Self {
        Self {
            redis_url: "redis://localhost:6379".to_string(),
            compressed_key_prefix: "cctelegram:compressed".to_string(),
            compressed_ttl: 24 * 60 * 60, // 24 hours
            force_compression: false,
            stats_update_interval: Duration::from_secs(60),
        }
    }
}

/// Redis storage statistics for compression
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct RedisStorageStats {
    pub total_compressed_stored: u64,
    pub total_compressed_retrieved: u64,
    pub total_storage_bytes_saved: u64,
    pub average_retrieval_time_ms: f64,
    pub redis_errors: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
}

/// Redis compression service for efficient queue storage
#[derive(Clone)]
pub struct RedisCompressionService {
    redis_client: RedisClient,
    compression_service: Arc<CompressionService>,
    config: RedisCompressionConfig,
    stats: Arc<RwLock<RedisStorageStats>>,
}

impl RedisCompressionService {
    /// Create new Redis compression service
    pub async fn new(
        compression_service: Arc<CompressionService>,
        config: RedisCompressionConfig,
    ) -> Result<Self> {
        let redis_client = RedisClient::open(config.redis_url.as_str())
            .context("Failed to create Redis client")?;

        // Test connection
        let mut conn = redis_client.get_async_connection().await
            .context("Failed to connect to Redis")?;
        
        // Test connection with a simple command
        let _: redis::RedisResult<()> = conn.set("cctelegram:healthcheck", "ok").await;
        let _: redis::RedisResult<()> = conn.del("cctelegram:healthcheck").await;
        
        info!("Successfully connected to Redis at {}", config.redis_url);

        Ok(Self {
            redis_client,
            compression_service,
            config,
            stats: Arc::new(RwLock::new(RedisStorageStats::default())),
        })
    }

    /// Store compressed event in Redis with optimized key structure
    #[instrument(skip(self, event), fields(event_id = %event.event_id, event_type = ?event.event_type))]
    pub async fn store_compressed_event(&self, event: &Event) -> Result<String> {
        let start_time = std::time::Instant::now();
        
        // Compress the event
        let compressed = self.compression_service.compress_event(event).await
            .context("Failed to compress event")?;

        // Serialize compressed event for Redis storage
        let serialized = serde_json::to_vec(&compressed)
            .context("Failed to serialize compressed event")?;

        // Generate storage key
        let storage_key = format!("{}:{}:{}", 
            self.config.compressed_key_prefix, 
            event.event_type.to_string(),
            event.event_id
        );

        // Store in Redis with TTL
        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection")?;

        conn.set_ex::<_, _, ()>(&storage_key, serialized, self.config.compressed_ttl).await
            .context("Failed to store compressed event in Redis")?;

        // Update statistics
        let storage_time = start_time.elapsed();
        {
            let mut stats = self.stats.write().await;
            stats.total_compressed_stored += 1;
            stats.total_storage_bytes_saved += 
                (compressed.original_size as u64).saturating_sub(compressed.compressed_size as u64);
            
            // Update average retrieval time (exponential moving average)
            let new_time_ms = storage_time.as_millis() as f64;
            if stats.total_compressed_stored == 1 {
                stats.average_retrieval_time_ms = new_time_ms;
            } else {
                stats.average_retrieval_time_ms = 
                    0.9 * stats.average_retrieval_time_ms + 0.1 * new_time_ms;
            }
        }

        info!("Stored compressed event {} in Redis (key: {}, compression: {:.1}%) in {:?}",
              event.event_id, storage_key, 
              (1.0 - compressed.compression_ratio) * 100.0, storage_time);

        Ok(storage_key)
    }

    /// Retrieve and decompress event from Redis
    #[instrument(skip(self), fields(storage_key = %storage_key))]
    pub async fn retrieve_compressed_event(&self, storage_key: &str) -> Result<Option<Event>> {
        let start_time = std::time::Instant::now();
        
        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection")?;

        // Retrieve from Redis
        let serialized_data: Option<Vec<u8>> = conn.get(storage_key).await
            .context("Failed to retrieve from Redis")?;

        let serialized = match serialized_data {
            Some(data) => {
                let mut stats = self.stats.write().await;
                stats.cache_hits += 1;
                data
            }
            None => {
                let mut stats = self.stats.write().await;
                stats.cache_misses += 1;
                debug!("Cache miss for key: {}", storage_key);
                return Ok(None);
            }
        };

        // Deserialize compressed event
        let compressed: CompressedEvent = serde_json::from_slice(&serialized)
            .context("Failed to deserialize compressed event")?;

        // Decompress event
        let event = self.compression_service.decompress_event(&compressed).await
            .context("Failed to decompress event")?;

        let retrieval_time = start_time.elapsed();

        // Update statistics
        {
            let mut stats = self.stats.write().await;
            stats.total_compressed_retrieved += 1;
            
            // Update average retrieval time
            let new_time_ms = retrieval_time.as_millis() as f64;
            if stats.total_compressed_retrieved == 1 {
                stats.average_retrieval_time_ms = new_time_ms;
            } else {
                stats.average_retrieval_time_ms = 
                    0.9 * stats.average_retrieval_time_ms + 0.1 * new_time_ms;
            }
        }

        debug!("Retrieved compressed event {} from Redis in {:?}",
               event.event_id, retrieval_time);

        Ok(Some(event))
    }

    /// Store multiple events in a batch operation for better performance
    #[instrument(skip(self, events))]
    pub async fn batch_store_compressed_events(&self, events: Vec<&Event>) -> Result<Vec<String>> {
        if events.is_empty() {
            return Ok(Vec::new());
        }

        let start_time = std::time::Instant::now();
        let mut storage_keys = Vec::with_capacity(events.len());
        
        // Compress all events concurrently
        let compression_futures: Vec<_> = events.iter()
            .map(|event| self.compression_service.compress_event(event))
            .collect();

        let compressed_events: Vec<CompressedEvent> = futures::future::try_join_all(compression_futures).await
            .context("Failed to compress events in batch")?;

        // Prepare Redis pipeline
        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection")?;

        let mut pipe = redis::pipe();
        
        for (event, compressed) in events.iter().zip(compressed_events.iter()) {
            let storage_key = format!("{}:{}:{}", 
                self.config.compressed_key_prefix, 
                event.event_type.to_string(),
                event.event_id
            );

            let serialized = serde_json::to_vec(compressed)
                .context("Failed to serialize compressed event in batch")?;

            pipe.set_ex(&storage_key, serialized, self.config.compressed_ttl);
            storage_keys.push(storage_key);
        }

        // Execute pipeline
        pipe.query_async::<_, ()>(&mut conn).await
            .context("Failed to execute Redis pipeline")?;

        let batch_time = start_time.elapsed();

        // Update statistics
        {
            let mut stats = self.stats.write().await;
            stats.total_compressed_stored += events.len() as u64;
            
            let total_saved: u64 = compressed_events.iter()
                .map(|c| (c.original_size as u64).saturating_sub(c.compressed_size as u64))
                .sum();
            stats.total_storage_bytes_saved += total_saved;
        }

        info!("Batch stored {} compressed events in Redis in {:?}",
              events.len(), batch_time);

        Ok(storage_keys)
    }

    /// Retrieve multiple events in a batch operation
    #[instrument(skip(self, storage_keys))]
    pub async fn batch_retrieve_compressed_events(&self, storage_keys: &[String]) -> Result<Vec<Option<Event>>> {
        if storage_keys.is_empty() {
            return Ok(Vec::new());
        }

        let start_time = std::time::Instant::now();

        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection")?;

        // Retrieve all keys in one operation
        let serialized_data: Vec<Option<Vec<u8>>> = conn.get(storage_keys).await
            .context("Failed to batch retrieve from Redis")?;

        // Process results
        let mut events = Vec::with_capacity(storage_keys.len());
        let mut cache_hits = 0u64;
        let mut cache_misses = 0u64;

        for (key, data) in storage_keys.iter().zip(serialized_data.iter()) {
            match data {
                Some(serialized) => {
                    cache_hits += 1;
                    
                    // Deserialize and decompress
                    match serde_json::from_slice::<CompressedEvent>(serialized) {
                        Ok(compressed) => {
                            match self.compression_service.decompress_event(&compressed).await {
                                Ok(event) => events.push(Some(event)),
                                Err(e) => {
                                    warn!("Failed to decompress event for key {}: {}", key, e);
                                    events.push(None);
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Failed to deserialize compressed event for key {}: {}", key, e);
                            events.push(None);
                        }
                    }
                }
                None => {
                    cache_misses += 1;
                    events.push(None);
                }
            }
        }

        let batch_time = start_time.elapsed();

        // Update statistics
        {
            let mut stats = self.stats.write().await;
            stats.total_compressed_retrieved += storage_keys.len() as u64;
            stats.cache_hits += cache_hits;
            stats.cache_misses += cache_misses;
        }

        info!("Batch retrieved {} events from Redis ({} hits, {} misses) in {:?}",
              storage_keys.len(), cache_hits, cache_misses, batch_time);

        Ok(events)
    }

    /// Delete compressed event from Redis
    #[instrument(skip(self))]
    pub async fn delete_compressed_event(&self, storage_key: &str) -> Result<bool> {
        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection")?;

        let deleted: u64 = conn.del(storage_key).await
            .context("Failed to delete from Redis")?;

        Ok(deleted > 0)
    }

    /// Clean up expired compressed events (maintenance operation)
    #[instrument(skip(self))]
    pub async fn cleanup_expired_events(&self, pattern: Option<&str>) -> Result<u64> {
        let default_pattern = format!("{}:*", self.config.compressed_key_prefix);
        let search_pattern = pattern.unwrap_or(&default_pattern);
        
        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection")?;

        // Get all keys matching pattern
        let keys: Vec<String> = conn.keys(search_pattern).await
            .context("Failed to scan Redis keys")?;

        if keys.is_empty() {
            return Ok(0);
        }

        // Check which keys have expired (TTL = -1 means no expiry, -2 means expired/missing)
        let mut expired_keys = Vec::new();
        
        for key in &keys {
            let ttl: i64 = conn.ttl(key).await.unwrap_or(-2);
            if ttl == -2 {
                expired_keys.push(key);
            }
        }

        if !expired_keys.is_empty() {
            let deleted: u64 = conn.del(&expired_keys).await
                .context("Failed to delete expired keys")?;
            info!("Cleaned up {} expired compressed events", deleted);
            Ok(deleted)
        } else {
            Ok(0)
        }
    }

    /// Get Redis storage statistics
    pub async fn get_redis_stats(&self) -> RedisStorageStats {
        self.stats.read().await.clone()
    }

    /// Get combined compression and Redis storage metrics
    pub async fn get_combined_metrics(&self) -> (CompressionMetrics, RedisStorageStats) {
        let compression_metrics = self.compression_service.get_metrics();
        let redis_stats = self.get_redis_stats().await;
        (compression_metrics, redis_stats)
    }

    /// Test Redis connection and compression pipeline
    pub async fn health_check(&self) -> Result<()> {
        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection for health check")?;

        // Test Redis connectivity
        let _: redis::RedisResult<()> = conn.set("cctelegram:healthcheck", "ok").await;
        let _: redis::RedisResult<()> = conn.del("cctelegram:healthcheck").await;

        // Test compression pipeline with a small event
        let test_event = Event::default_with_task_id("health-check".to_string());
        
        let compressed = self.compression_service.compress_event(&test_event).await
            .context("Health check compression failed")?;
        
        let _decompressed = self.compression_service.decompress_event(&compressed).await
            .context("Health check decompression failed")?;

        debug!("Redis compression service health check passed");
        Ok(())
    }

    /// Reset all statistics (useful for monitoring resets)
    pub async fn reset_stats(&self) {
        let mut stats = self.stats.write().await;
        *stats = RedisStorageStats::default();
        
        // Also reset compression service metrics
        self.compression_service.reset_metrics();
        
        info!("Reset Redis compression service statistics");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::compression::CompressionService;
    use crate::events::types::{Event, EventType};

    async fn create_test_service() -> Result<RedisCompressionService> {
        let compression_service = Arc::new(CompressionService::new_optimized());
        let config = RedisCompressionConfig {
            redis_url: std::env::var("TEST_REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            compressed_ttl: 60, // 1 minute for tests
            ..Default::default()
        };
        
        RedisCompressionService::new(compression_service, config).await
    }

    #[tokio::test]
    async fn test_redis_compression_store_retrieve() {
        let service = match create_test_service().await {
            Ok(service) => service,
            Err(_) => {
                eprintln!("Skipping Redis test - Redis not available");
                return;
            }
        };

        let event = Event {
            event_id: "redis-test-123".to_string(),
            event_type: EventType::TaskCompletion,
            source: "test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: "redis-task-456".to_string(),
            title: "Redis Test Event".to_string(),
            description: "Testing Redis compression".repeat(50), // Make it compressible
            ..Event::default_with_task_id("test".to_string())
        };

        // Store event
        let storage_key = service.store_compressed_event(&event).await.unwrap();
        assert!(storage_key.contains(&event.event_id));

        // Retrieve event
        let retrieved = service.retrieve_compressed_event(&storage_key).await.unwrap();
        assert!(retrieved.is_some());
        let retrieved_event = retrieved.unwrap();
        
        assert_eq!(retrieved_event.event_id, event.event_id);
        assert_eq!(retrieved_event.title, event.title);
        assert_eq!(retrieved_event.description, event.description);

        // Clean up
        let deleted = service.delete_compressed_event(&storage_key).await.unwrap();
        assert!(deleted);
    }

    #[tokio::test]
    async fn test_batch_operations() {
        let service = match create_test_service().await {
            Ok(service) => service,
            Err(_) => {
                eprintln!("Skipping Redis batch test - Redis not available");
                return;
            }
        };

        // Create test events
        let events: Vec<Event> = (0..3).map(|i| Event {
            event_id: format!("batch-test-{}", i),
            event_type: EventType::InfoNotification,
            source: "batch-test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: format!("batch-task-{}", i),
            title: format!("Batch Event {}", i),
            description: "Batch testing event".repeat(20),
            ..Event::default_with_task_id(format!("batch-{}", i))
        }).collect();

        let event_refs: Vec<&Event> = events.iter().collect();

        // Batch store
        let storage_keys = service.batch_store_compressed_events(event_refs).await.unwrap();
        assert_eq!(storage_keys.len(), 3);

        // Batch retrieve
        let retrieved = service.batch_retrieve_compressed_events(&storage_keys).await.unwrap();
        assert_eq!(retrieved.len(), 3);
        
        for (i, maybe_event) in retrieved.iter().enumerate() {
            assert!(maybe_event.is_some());
            let event = maybe_event.as_ref().unwrap();
            assert_eq!(event.event_id, format!("batch-test-{}", i));
        }

        // Clean up
        for key in &storage_keys {
            service.delete_compressed_event(key).await.unwrap();
        }
    }

    #[tokio::test]
    async fn test_health_check() {
        let service = match create_test_service().await {
            Ok(service) => service,
            Err(_) => {
                eprintln!("Skipping Redis health check test - Redis not available");
                return;
            }
        };

        let result = service.health_check().await;
        assert!(result.is_ok());
    }
}
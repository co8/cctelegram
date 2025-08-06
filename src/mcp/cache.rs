//! Caching layer for MCP server responses to improve performance and reduce load

use super::errors::McpError;
use super::McpConfig;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// Cache entry with TTL and metadata
#[derive(Debug, Clone)]
pub struct CacheEntry {
    data: serde_json::Value,
    created_at: Instant,
    ttl: Duration,
    access_count: u64,
    last_accessed: Instant,
}

/// In-memory cache manager with TTL support and LRU eviction
pub struct CacheManager {
    cache: Arc<RwLock<HashMap<String, CacheEntry>>>,
    config: McpConfig,
    stats: Arc<RwLock<CacheStats>>,
}

/// Cache performance and usage statistics
#[derive(Debug, Default)]
pub struct CacheStats {
    hits: u64,
    misses: u64,
    evictions: u64,
    total_entries: u64,
    memory_usage_bytes: u64,
}

impl CacheEntry {
    fn new(data: serde_json::Value, ttl: Duration) -> Self {
        let now = Instant::now();
        Self {
            data,
            created_at: now,
            ttl,
            access_count: 0,
            last_accessed: now,
        }
    }

    fn is_expired(&self) -> bool {
        self.created_at.elapsed() > self.ttl
    }

    fn access(&mut self) -> serde_json::Value {
        self.access_count += 1;
        self.last_accessed = Instant::now();
        self.data.clone()
    }

    fn size_bytes(&self) -> u64 {
        // Rough estimation of memory usage
        serde_json::to_string(&self.data)
            .map(|s| s.len() as u64)
            .unwrap_or(0) + 100 // Account for metadata overhead
    }
}

impl CacheStats {
    fn hit_rate(&self) -> f64 {
        if self.hits + self.misses == 0 {
            0.0
        } else {
            self.hits as f64 / (self.hits + self.misses) as f64
        }
    }
}

impl CacheManager {
    pub fn new(config: &McpConfig) -> Self {
        let cache_manager = Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            config: config.clone(),
            stats: Arc::new(RwLock::new(CacheStats::default())),
        };

        // Start background cleanup task if caching is enabled
        if config.enable_caching {
            let manager = cache_manager.clone();
            tokio::spawn(async move {
                manager.cleanup_task().await;
            });
        }

        cache_manager
    }

    /// Get cached value by key
    pub async fn get(&self, key: &str) -> Result<Option<serde_json::Value>, McpError> {
        if !self.config.enable_caching {
            return Ok(None);
        }

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        if let Some(entry) = cache.get_mut(key) {
            if entry.is_expired() {
                debug!("Cache entry '{}' expired, removing", key);
                cache.remove(key);
                stats.misses += 1;
                stats.evictions += 1;
                Ok(None)
            } else {
                debug!("Cache hit for key '{}'", key);
                stats.hits += 1;
                Ok(Some(entry.access()))
            }
        } else {
            debug!("Cache miss for key '{}'", key);
            stats.misses += 1;
            Ok(None)
        }
    }

    /// Set cached value with TTL
    pub async fn set(
        &self,
        key: &str,
        value: serde_json::Value,
        ttl_seconds: u64,
    ) -> Result<(), McpError> {
        if !self.config.enable_caching {
            return Ok(());
        }

        let ttl = Duration::from_secs(ttl_seconds);
        let entry = CacheEntry::new(value, ttl);

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        let is_new = !cache.contains_key(key);
        let entry_size = entry.size_bytes();

        cache.insert(key.to_string(), entry);

        if is_new {
            stats.total_entries += 1;
        }
        stats.memory_usage_bytes += entry_size;

        debug!("Cached entry '{}' with TTL {}s", key, ttl_seconds);

        // Trigger cleanup if cache is getting large
        if cache.len() > 1000 {
            debug!("Cache size exceeded threshold, triggering cleanup");
            drop(cache);
            drop(stats);
            self.cleanup_expired().await?;
        }

        Ok(())
    }

    /// Remove cached entry
    pub async fn remove(&self, key: &str) -> Result<bool, McpError> {
        if !self.config.enable_caching {
            return Ok(false);
        }

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        if let Some(entry) = cache.remove(key) {
            stats.evictions += 1;
            stats.memory_usage_bytes = stats.memory_usage_bytes.saturating_sub(entry.size_bytes());
            debug!("Removed cache entry '{}'", key);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Clear all cached entries
    pub async fn clear(&self) -> Result<(), McpError> {
        if !self.config.enable_caching {
            return Ok(());
        }

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        let count = cache.len();
        cache.clear();
        stats.evictions += count as u64;
        stats.memory_usage_bytes = 0;

        info!("Cleared {} cache entries", count);
        Ok(())
    }

    /// Get cache statistics
    pub async fn get_stats(&self) -> serde_json::Value {
        let stats = self.stats.read().await;
        
        serde_json::json!({
            "enabled": self.config.enable_caching,
            "hits": stats.hits,
            "misses": stats.misses,
            "hit_rate": stats.hit_rate(),
            "evictions": stats.evictions,
            "total_entries": stats.total_entries,
            "memory_usage_bytes": stats.memory_usage_bytes,
            "memory_usage_mb": stats.memory_usage_bytes as f64 / 1024.0 / 1024.0
        })
    }

    /// Clean up expired entries
    async fn cleanup_expired(&self) -> Result<u64, McpError> {
        if !self.config.enable_caching {
            return Ok(0);
        }

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        let initial_count = cache.len();
        let mut bytes_freed = 0;

        cache.retain(|key, entry| {
            if entry.is_expired() {
                debug!("Cleaning up expired cache entry: {}", key);
                bytes_freed += entry.size_bytes();
                false
            } else {
                true
            }
        });

        let cleaned_count = initial_count - cache.len();
        stats.evictions += cleaned_count as u64;
        stats.memory_usage_bytes = stats.memory_usage_bytes.saturating_sub(bytes_freed);

        if cleaned_count > 0 {
            info!("Cleaned up {} expired cache entries, freed {} bytes", cleaned_count, bytes_freed);
        }

        Ok(cleaned_count as u64)
    }

    /// Background cleanup task that runs periodically
    async fn cleanup_task(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(60)); // Clean every minute
        
        loop {
            interval.tick().await;
            
            if let Err(e) = self.cleanup_expired().await {
                warn!("Cache cleanup task failed: {:?}", e);
            }
        }
    }

    /// Perform LRU eviction when cache is full
    async fn evict_lru(&self, target_size: usize) -> Result<u64, McpError> {
        if !self.config.enable_caching {
            return Ok(0);
        }

        let mut cache = self.cache.write().await;
        let mut stats = self.stats.write().await;

        if cache.len() <= target_size {
            return Ok(0);
        }

        // Sort entries by last accessed time (LRU first)
        let mut entries: Vec<(String, Instant)> = cache
            .iter()
            .map(|(k, v)| (k.clone(), v.last_accessed))
            .collect();

        entries.sort_by_key(|(_, last_accessed)| *last_accessed);

        let to_remove = cache.len() - target_size;
        let mut bytes_freed = 0;
        let mut removed_count = 0;

        for (key, _) in entries.into_iter().take(to_remove) {
            if let Some(entry) = cache.remove(&key) {
                bytes_freed += entry.size_bytes();
                removed_count += 1;
                debug!("Evicted LRU cache entry: {}", key);
            }
        }

        stats.evictions += removed_count;
        stats.memory_usage_bytes = stats.memory_usage_bytes.saturating_sub(bytes_freed);

        info!("LRU evicted {} cache entries, freed {} bytes", removed_count, bytes_freed);
        Ok(removed_count)
    }
}

impl Clone for CacheManager {
    fn clone(&self) -> Self {
        Self {
            cache: Arc::clone(&self.cache),
            config: self.config.clone(),
            stats: Arc::clone(&self.stats),
        }
    }
}
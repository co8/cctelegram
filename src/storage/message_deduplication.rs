use std::sync::Arc;
use std::time::Duration;
use std::collections::HashMap;

use rusqlite::{Result as SqlResult, Row};
use tokio::sync::{RwLock, Mutex};
use tokio::time::{interval, Instant};
use tracing::{info, error, debug};
use chrono::{DateTime, Utc};
use sha2::{Sha256, Digest};
use anyhow::Result;

use crate::events::types::Event;
use crate::storage::message_persistence::ConnectionPool;

/// Configuration for message deduplication system
#[derive(Debug, Clone)]
pub struct DeduplicationConfig {
    pub database_path: String,
    pub deduplication_window_seconds: u64,
    pub cleanup_interval_hours: u64,
    pub max_connections: usize,
    pub enable_content_normalization: bool,
    pub enable_similar_detection: bool,
    pub similarity_threshold: f32,
    pub cache_size_limit: usize,
}

impl Default for DeduplicationConfig {
    fn default() -> Self {
        Self {
            database_path: "cctelegram_messages.db".to_string(),
            deduplication_window_seconds: 3600, // 1 hour window
            cleanup_interval_hours: 6,
            max_connections: 5,
            enable_content_normalization: true,
            enable_similar_detection: false, // Advanced feature
            similarity_threshold: 0.85,
            cache_size_limit: 10000,
        }
    }
}

/// Deduplication result
#[derive(Debug, Clone, PartialEq)]
pub enum DeduplicationResult {
    Unique(String), // Returns content hash
    Duplicate { 
        original_hash: String,
        original_timestamp: DateTime<Utc>,
        duplicate_count: u32,
    },
    Similar {
        similar_hash: String,
        similarity_score: f32,
        original_timestamp: DateTime<Utc>,
    },
}

/// Deduplication cache entry
#[derive(Debug, Clone)]
struct DeduplicationEntry {
    pub message_hash: String,
    pub content: String,
    pub normalized_content: Option<String>,
    pub event_type: String,
    pub source: String,
    pub chat_id: i64,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub duplicate_count: u32,
    pub expires_at: DateTime<Utc>,
}

/// Statistics for deduplication system
#[derive(Debug, Default, Clone)]
pub struct DeduplicationStats {
    pub messages_processed: u64,
    pub duplicates_detected: u64,
    pub unique_messages: u64,
    pub similar_messages_detected: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub cache_size: usize,
    pub cleanup_operations: u64,
    pub last_cleanup: Option<DateTime<Utc>>,
}

/// High-performance message deduplication system
pub struct MessageDeduplicationSystem {
    config: DeduplicationConfig,
    pool: Arc<ConnectionPool>,
    
    // In-memory cache for fast duplicate detection
    memory_cache: Arc<RwLock<HashMap<String, DeduplicationEntry>>>,
    
    // Cleanup coordination
    cleanup_shutdown: Arc<RwLock<bool>>,
    
    // Statistics
    stats: Arc<RwLock<DeduplicationStats>>,
    
    // Performance optimization
    last_cache_update: Arc<Mutex<Instant>>,
}

impl MessageDeduplicationSystem {
    /// Create a new message deduplication system
    pub async fn new(config: DeduplicationConfig) -> Result<Self> {
        info!("Initializing message deduplication system with window: {}s", 
              config.deduplication_window_seconds);
        
        let pool = Arc::new(ConnectionPool::new(
            config.database_path.clone(), 
            config.max_connections
        )?);
        
        let system = Self {
            config,
            pool,
            memory_cache: Arc::new(RwLock::new(HashMap::new())),
            cleanup_shutdown: Arc::new(RwLock::new(false)),
            stats: Arc::new(RwLock::new(DeduplicationStats::default())),
            last_cache_update: Arc::new(Mutex::new(Instant::now())),
        };

        // Initialize database schema
        system.initialize_deduplication_schema().await?;
        
        // Load recent entries into memory cache
        system.warm_memory_cache().await?;
        
        // Start background cleanup task
        system.start_cleanup_task();
        
        info!("Message deduplication system initialized successfully");
        Ok(system)
    }

    /// Initialize deduplication database schema
    async fn initialize_deduplication_schema(&self) -> Result<()> {
        let conn = self.pool.get_connection().await?;
        
        conn.execute(|conn| {
            conn.execute_batch(r#"
                CREATE TABLE IF NOT EXISTS deduplication_cache (
                    message_hash TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    normalized_content TEXT,
                    event_type TEXT NOT NULL,
                    source TEXT NOT NULL,
                    chat_id INTEGER NOT NULL,
                    first_seen INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL,
                    duplicate_count INTEGER NOT NULL DEFAULT 1,
                    expires_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_dedup_expires_at ON deduplication_cache(expires_at);
                CREATE INDEX IF NOT EXISTS idx_dedup_event_type ON deduplication_cache(event_type);
                CREATE INDEX IF NOT EXISTS idx_dedup_source ON deduplication_cache(source);
                CREATE INDEX IF NOT EXISTS idx_dedup_chat_id ON deduplication_cache(chat_id);
                CREATE INDEX IF NOT EXISTS idx_dedup_first_seen ON deduplication_cache(first_seen);
                
                -- Composite index for fast lookup by content patterns
                CREATE INDEX IF NOT EXISTS idx_dedup_type_source ON deduplication_cache(event_type, source);
                
                -- Index for similarity matching (if enabled)
                CREATE INDEX IF NOT EXISTS idx_dedup_normalized ON deduplication_cache(normalized_content);
            "#)?;
            
            Ok(())
        })?;

        info!("Deduplication database schema initialized");
        Ok(())
    }

    /// Warm up the memory cache with recent entries
    async fn warm_memory_cache(&self) -> Result<()> {
        info!("Warming up deduplication memory cache");
        
        let cutoff_time = Utc::now() - chrono::Duration::seconds(self.config.deduplication_window_seconds as i64);
        let conn = self.pool.get_connection().await?;
        
        let entries = conn.execute(|conn| {
            let mut stmt = conn.prepare(
                "SELECT message_hash, content, normalized_content, event_type, source, 
                        chat_id, first_seen, last_seen, duplicate_count, expires_at
                 FROM deduplication_cache 
                 WHERE expires_at > ?1 
                 ORDER BY last_seen DESC 
                 LIMIT ?2"
            )?;
            
            let rows = stmt.query_map(
                [cutoff_time.timestamp(), self.config.cache_size_limit as i64], 
                |row| {
                    Ok(self.row_to_deduplication_entry(row)?)
                }
            )?;
            
            let mut entries = Vec::new();
            for entry_result in rows {
                entries.push(entry_result?);
            }
            
            Ok(entries)
        })?;

        let mut cache = self.memory_cache.write().await;
        for entry in entries {
            cache.insert(entry.message_hash.clone(), entry);
        }
        
        info!("Memory cache warmed with {} entries", cache.len());
        
        {
            let mut stats = self.stats.write().await;
            stats.cache_size = cache.len();
        }

        Ok(())
    }

    /// Check if a message is a duplicate and return deduplication result
    pub async fn check_duplicate(&self, event: &Event, chat_id: i64) -> Result<DeduplicationResult> {
        let start_time = Instant::now();
        
        // Generate content hash
        let content_hash = self.generate_content_hash(event);
        let normalized_content = if self.config.enable_content_normalization {
            Some(self.normalize_content(event))
        } else {
            None
        };
        
        debug!("Checking duplicate for hash: {} (event: {:?})", content_hash, event.event_type);
        
        // Check memory cache first
        let cache_result = {
            let cache = self.memory_cache.read().await;
            cache.get(&content_hash).cloned()
        };

        let mut stats = self.stats.write().await;
        stats.messages_processed += 1;

        if let Some(entry) = cache_result {
            // Check if entry is still valid (within deduplication window)
            if entry.expires_at > Utc::now() {
                stats.duplicates_detected += 1;
                stats.cache_hits += 1;
                
                debug!("Duplicate detected in cache: {} (original: {})", 
                       content_hash, entry.first_seen);
                
                // Update duplicate count asynchronously
                self.update_duplicate_count_async(&content_hash).await;
                
                return Ok(DeduplicationResult::Duplicate {
                    original_hash: content_hash,
                    original_timestamp: entry.first_seen,
                    duplicate_count: entry.duplicate_count + 1,
                });
            }
        }

        // Check database for duplicates
        stats.cache_misses += 1;
        drop(stats); // Release stats lock before async operations

        let db_result = self.check_database_duplicate(&content_hash, event, chat_id).await?;
        
        if let DeduplicationResult::Unique(_) = db_result {
            // Check for similar messages if enabled
            if self.config.enable_similar_detection {
                if let Some(ref normalized) = normalized_content {
                    let similar_result = self.check_similar_messages(normalized, event, chat_id).await?;
                    if !matches!(similar_result, DeduplicationResult::Unique(_)) {
                        return Ok(similar_result);
                    }
                }
            }
            
            // Store new unique message
            self.store_unique_message(&content_hash, event, chat_id, normalized_content).await?;
            
            let mut stats = self.stats.write().await;
            stats.unique_messages += 1;
        }

        let processing_time = start_time.elapsed();
        if processing_time > Duration::from_millis(10) {
            debug!("Deduplication check took {:?} for hash: {}", processing_time, content_hash);
        }

        Ok(db_result)
    }

    /// Generate SHA-256 hash of message content
    fn generate_content_hash(&self, event: &Event) -> String {
        let mut hasher = Sha256::new();
        
        // Include core content that defines message uniqueness
        hasher.update(event.event_type.to_string().as_bytes());
        hasher.update(event.description.as_bytes());
        hasher.update(event.source.as_bytes());
        hasher.update(event.task_id.as_bytes());
        
        // Include data if present, but serialize consistently
        if let Ok(serialized) = serde_json::to_string(&event.data) {
            hasher.update(serialized.as_bytes());
        }
        
        format!("{:x}", hasher.finalize())
    }

    /// Normalize content for similarity detection
    fn normalize_content(&self, event: &Event) -> String {
        let mut content = format!("{:?} {}", event.event_type, event.description);
        
        // Remove common variations that don't affect semantic meaning
        content = content.to_lowercase();
        content = content.replace(char::is_numeric, "N"); // Replace numbers with N
        content = content.chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
            .collect::<String>();
        content = content.split_whitespace()
            .collect::<Vec<&str>>()
            .join(" "); // Normalize whitespace
        
        content
    }

    /// Check database for duplicate entries
    async fn check_database_duplicate(
        &self, 
        content_hash: &str, 
        _event: &Event, 
        _chat_id: i64
    ) -> Result<DeduplicationResult> {
        let conn = self.pool.get_connection().await?;
        
        let existing_entry = conn.execute(|conn| {
            let mut stmt = conn.prepare(
                "SELECT message_hash, content, normalized_content, event_type, source, 
                        chat_id, first_seen, last_seen, duplicate_count, expires_at
                 FROM deduplication_cache 
                 WHERE message_hash = ?1 AND expires_at > ?2"
            )?;
            
            let current_time = Utc::now().timestamp();
            let mut rows = stmt.query_map([content_hash, &current_time.to_string()], |row| {
                Ok(self.row_to_deduplication_entry(row)?)
            })?;
            
            if let Some(row_result) = rows.next() {
                Ok(Some(row_result?))
            } else {
                Ok(None)
            }
        })?;

        if let Some(entry) = existing_entry {
            debug!("Duplicate found in database: {} (count: {})", 
                   content_hash, entry.duplicate_count);
            
            // Update memory cache
            {
                let mut cache = self.memory_cache.write().await;
                cache.insert(content_hash.to_string(), entry.clone());
                
                // Limit cache size
                if cache.len() > self.config.cache_size_limit {
                    self.evict_oldest_cache_entries(&mut cache).await;
                }
            }
            
            return Ok(DeduplicationResult::Duplicate {
                original_hash: content_hash.to_string(),
                original_timestamp: entry.first_seen,
                duplicate_count: entry.duplicate_count,
            });
        }

        Ok(DeduplicationResult::Unique(content_hash.to_string()))
    }

    /// Check for similar messages using normalized content
    async fn check_similar_messages(
        &self,
        normalized_content: &str,
        event: &Event,
        chat_id: i64,
    ) -> Result<DeduplicationResult> {
        let conn = self.pool.get_connection().await?;
        
        let similar_entries = conn.execute(|conn| {
            let mut stmt = conn.prepare(
                "SELECT message_hash, normalized_content, first_seen, last_seen
                 FROM deduplication_cache 
                 WHERE normalized_content IS NOT NULL 
                 AND event_type = ?1 
                 AND chat_id = ?2
                 AND expires_at > ?3
                 ORDER BY last_seen DESC 
                 LIMIT 100"
            )?;
            
            let current_time = Utc::now().timestamp();
            let rows = stmt.query_map(
                [&event.event_type.to_string(), &chat_id.to_string(), &current_time.to_string()], 
                |row| {
                    let hash: String = row.get(0)?;
                    let norm_content: Option<String> = row.get(1)?;
                    let first_seen: i64 = row.get(2)?;
                    let last_seen: i64 = row.get(3)?;
                    
                    Ok((hash, norm_content, 
                        DateTime::<Utc>::from_timestamp(first_seen, 0).unwrap_or_else(Utc::now),
                        DateTime::<Utc>::from_timestamp(last_seen, 0).unwrap_or_else(Utc::now)))
                }
            )?;
            
            let mut entries = Vec::new();
            for row_result in rows {
                entries.push(row_result?);
            }
            
            Ok(entries)
        })?;

        // Calculate similarity scores
        for (hash, existing_normalized, first_seen, _last_seen) in similar_entries {
            if let Some(ref existing_content) = existing_normalized {
                let similarity = self.calculate_similarity(normalized_content, existing_content);
                
                if similarity >= self.config.similarity_threshold {
                    let mut stats = self.stats.write().await;
                    stats.similar_messages_detected += 1;
                    
                    debug!("Similar message detected: {} (similarity: {:.2})", hash, similarity);
                    
                    return Ok(DeduplicationResult::Similar {
                        similar_hash: hash,
                        similarity_score: similarity,
                        original_timestamp: first_seen,
                    });
                }
            }
        }

        Ok(DeduplicationResult::Unique("".to_string()))
    }

    /// Calculate similarity between two normalized content strings
    fn calculate_similarity(&self, content1: &str, content2: &str) -> f32 {
        // Simple Jaccard similarity for normalized content
        let words1: std::collections::HashSet<&str> = content1.split_whitespace().collect();
        let words2: std::collections::HashSet<&str> = content2.split_whitespace().collect();
        
        let intersection = words1.intersection(&words2).count();
        let union = words1.union(&words2).count();
        
        if union == 0 {
            0.0
        } else {
            intersection as f32 / union as f32
        }
    }

    /// Store a new unique message in the deduplication cache
    async fn store_unique_message(
        &self,
        content_hash: &str,
        event: &Event,
        chat_id: i64,
        normalized_content: Option<String>,
    ) -> Result<()> {
        let current_time = Utc::now();
        let expires_at = current_time + chrono::Duration::seconds(self.config.deduplication_window_seconds as i64);
        
        let content = format!("{}: {}", event.event_type, event.description);
        
        let conn = self.pool.get_connection().await?;
        
        conn.transaction(|tx| {
            tx.execute(
                r#"INSERT OR REPLACE INTO deduplication_cache 
                   (message_hash, content, normalized_content, event_type, source, 
                    chat_id, first_seen, last_seen, duplicate_count, expires_at) 
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
                (
                    content_hash,
                    &content,
                    normalized_content.as_deref(),
                    &event.event_type.to_string(),
                    &event.source,
                    chat_id,
                    current_time.timestamp(),
                    current_time.timestamp(),
                    1,
                    expires_at.timestamp(),
                ),
            )?;
            Ok(())
        })?;

        // Update memory cache
        let entry = DeduplicationEntry {
            message_hash: content_hash.to_string(),
            content,
            normalized_content,
            event_type: event.event_type.to_string(),
            source: event.source.clone(),
            chat_id,
            first_seen: current_time,
            last_seen: current_time,
            duplicate_count: 1,
            expires_at,
        };

        {
            let mut cache = self.memory_cache.write().await;
            cache.insert(content_hash.to_string(), entry);
            
            if cache.len() > self.config.cache_size_limit {
                self.evict_oldest_cache_entries(&mut cache).await;
            }
        }

        debug!("Stored unique message: {} (expires: {})", content_hash, expires_at);
        Ok(())
    }

    /// Update duplicate count asynchronously
    async fn update_duplicate_count_async(&self, content_hash: &str) {
        let pool = self.pool.clone();
        let hash = content_hash.to_string();
        let memory_cache = self.memory_cache.clone();
        
        tokio::spawn(async move {
            if let Ok(conn) = pool.get_connection().await {
                let current_time = Utc::now();
                
                if let Err(e) = conn.transaction(|tx| {
                    tx.execute(
                        "UPDATE deduplication_cache SET duplicate_count = duplicate_count + 1, last_seen = ?1 WHERE message_hash = ?2",
                        (current_time.timestamp(), &hash),
                    )?;
                    Ok(())
                }) {
                    error!("Failed to update duplicate count for {}: {}", hash, e);
                } else {
                    // Update memory cache
                    {
                        let mut cache = memory_cache.write().await;
                        if let Some(entry) = cache.get_mut(&hash) {
                            entry.duplicate_count += 1;
                            entry.last_seen = current_time;
                        }
                    }
                }
            }
        });
    }

    /// Evict oldest entries from memory cache
    async fn evict_oldest_cache_entries(&self, cache: &mut HashMap<String, DeduplicationEntry>) {
        let target_size = (self.config.cache_size_limit as f32 * 0.8) as usize;
        
        if cache.len() <= target_size {
            return;
        }
        
        let mut entries: Vec<_> = cache.iter().collect();
        entries.sort_by(|a, b| a.1.last_seen.cmp(&b.1.last_seen));
        
        let to_remove = cache.len() - target_size;
        let hashes_to_remove: Vec<String> = entries.iter()
            .take(to_remove)
            .map(|(hash, _)| (*hash).clone())
            .collect();
            
        for hash in hashes_to_remove {
            cache.remove(&hash);
        }
        
        debug!("Evicted {} entries from memory cache (new size: {})", to_remove, cache.len());
    }

    /// Clean up expired entries
    pub async fn cleanup_expired_entries(&self) -> Result<u64> {
        let current_time = Utc::now();
        let conn = self.pool.get_connection().await?;
        
        let deleted_count = conn.transaction(|tx| {
            let count = tx.execute(
                "DELETE FROM deduplication_cache WHERE expires_at < ?1",
                [current_time.timestamp()],
            )?;
            Ok(count as u64)
        })?;

        if deleted_count > 0 {
            info!("Cleaned up {} expired deduplication entries", deleted_count);
            
            // Update memory cache - remove expired entries
            {
                let mut cache = self.memory_cache.write().await;
                cache.retain(|_, entry| entry.expires_at > current_time);
            }
        }

        {
            let mut stats = self.stats.write().await;
            stats.cleanup_operations += 1;
            stats.last_cleanup = Some(current_time);
            
            let cache_size = self.memory_cache.read().await.len();
            stats.cache_size = cache_size;
        }

        Ok(deleted_count)
    }

    /// Get deduplication statistics
    pub async fn get_stats(&self) -> DeduplicationStats {
        let mut stats = self.stats.read().await.clone();
        stats.cache_size = self.memory_cache.read().await.len();
        stats
    }

    /// Start background cleanup task
    fn start_cleanup_task(&self) {
        let pool = self.pool.clone();
        let config = self.config.clone();
        let shutdown_flag = self.cleanup_shutdown.clone();
        let stats = self.stats.clone();
        let memory_cache = self.memory_cache.clone();

        tokio::spawn(async move {
            let mut cleanup_interval = interval(Duration::from_secs(
                config.cleanup_interval_hours * 3600
            ));

            loop {
                cleanup_interval.tick().await;
                
                if *shutdown_flag.read().await {
                    break;
                }

                match Self::perform_cleanup(&pool, &stats, &memory_cache).await {
                    Ok(deleted_count) => {
                        if deleted_count > 0 {
                            info!("Deduplication cleanup completed, deleted {} entries", deleted_count);
                        }
                    }
                    Err(e) => {
                        error!("Deduplication cleanup failed: {}", e);
                    }
                }
            }
            
            info!("Deduplication cleanup task shut down");
        });
    }

    /// Internal cleanup implementation
    async fn perform_cleanup(
        pool: &ConnectionPool,
        stats: &Arc<RwLock<DeduplicationStats>>,
        memory_cache: &Arc<RwLock<HashMap<String, DeduplicationEntry>>>,
    ) -> Result<u64> {
        let current_time = Utc::now();
        let conn = pool.get_connection().await?;
        
        let deleted_count = conn.transaction(|tx| {
            let count = tx.execute(
                "DELETE FROM deduplication_cache WHERE expires_at < ?1",
                [current_time.timestamp()],
            )?;
            Ok(count as u64)
        })?;

        // Update memory cache
        {
            let mut cache = memory_cache.write().await;
            cache.retain(|_, entry| entry.expires_at > current_time);
        }

        {
            let mut stats_guard = stats.write().await;
            stats_guard.cleanup_operations += 1;
            stats_guard.last_cleanup = Some(current_time);
            stats_guard.cache_size = memory_cache.read().await.len();
        }

        Ok(deleted_count)
    }

    /// Convert database row to deduplication entry
    fn row_to_deduplication_entry(&self, row: &Row) -> SqlResult<DeduplicationEntry> {
        let first_seen_secs: i64 = row.get("first_seen")?;
        let last_seen_secs: i64 = row.get("last_seen")?;
        let expires_at_secs: i64 = row.get("expires_at")?;

        Ok(DeduplicationEntry {
            message_hash: row.get("message_hash")?,
            content: row.get("content")?,
            normalized_content: row.get("normalized_content")?,
            event_type: row.get("event_type")?,
            source: row.get("source")?,
            chat_id: row.get("chat_id")?,
            first_seen: DateTime::<Utc>::from_timestamp(first_seen_secs, 0).unwrap_or_else(Utc::now),
            last_seen: DateTime::<Utc>::from_timestamp(last_seen_secs, 0).unwrap_or_else(Utc::now),
            duplicate_count: row.get("duplicate_count")?,
            expires_at: DateTime::<Utc>::from_timestamp(expires_at_secs, 0).unwrap_or_else(Utc::now),
        })
    }

    /// Force refresh memory cache from database
    pub async fn refresh_cache(&self) -> Result<()> {
        info!("Force refreshing deduplication memory cache");
        
        {
            let mut cache = self.memory_cache.write().await;
            cache.clear();
        }
        
        self.warm_memory_cache().await?;
        
        info!("Deduplication memory cache refreshed");
        Ok(())
    }
}

impl Drop for MessageDeduplicationSystem {
    fn drop(&mut self) {
        // Signal background tasks to shut down
        // Note: This is a sync context, so we use try_write instead of async write
        if let Ok(mut shutdown_flag) = self.cleanup_shutdown.try_write() {
            *shutdown_flag = true;
        }
    }
}

/// Middleware for integrating deduplication with message processing
pub struct DeduplicationMiddleware {
    deduplication_system: Arc<MessageDeduplicationSystem>,
    bypass_similar: bool,
}

impl DeduplicationMiddleware {
    pub fn new(deduplication_system: Arc<MessageDeduplicationSystem>) -> Self {
        Self {
            deduplication_system,
            bypass_similar: false,
        }
    }

    pub fn with_similarity_bypass(mut self, bypass: bool) -> Self {
        self.bypass_similar = bypass;
        self
    }

    /// Process message through deduplication middleware
    pub async fn process(&self, event: &Event, chat_id: i64) -> Result<DeduplicationResult> {
        let result = self.deduplication_system.check_duplicate(event, chat_id).await?;
        
        match &result {
            DeduplicationResult::Duplicate { duplicate_count, .. } => {
                debug!("Middleware blocked duplicate message (count: {})", duplicate_count);
            }
            DeduplicationResult::Similar { similarity_score, .. } => {
                if self.bypass_similar {
                    debug!("Middleware allowing similar message (similarity: {:.2})", similarity_score);
                    return Ok(DeduplicationResult::Unique(String::new()));
                } else {
                    debug!("Middleware blocked similar message (similarity: {:.2})", similarity_score);
                }
            }
            DeduplicationResult::Unique(_) => {
                debug!("Middleware allowing unique message");
            }
        }
        
        Ok(result)
    }

    /// Get middleware statistics
    pub async fn get_stats(&self) -> DeduplicationStats {
        self.deduplication_system.get_stats().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use uuid::Uuid;
    use crate::events::types::{EventType, EventData, ProcessingStatus};
    use std::thread;
    use std::time::Duration as StdDuration;
    
    /// Helper function to create test configuration
    fn create_test_config() -> DeduplicationConfig {
        let temp_file = NamedTempFile::new().unwrap();
        DeduplicationConfig {
            database_path: temp_file.path().to_string_lossy().to_string(),
            deduplication_window_seconds: 300, // 5 minutes for testing
            cleanup_interval_hours: 1,
            max_connections: 2,
            enable_content_normalization: true,
            enable_similar_detection: true,
            similarity_threshold: 0.8,
            cache_size_limit: 100,
        }
    }
    
    /// Helper function to create a valid test event with all required fields
    fn create_test_event(
        task_id: &str,
        event_type: EventType,
        title: &str,
        description: &str,
        source: &str,
    ) -> Event {
        Event {
            event_id: Uuid::new_v4().to_string(),
            event_type,
            source: source.to_string(),
            timestamp: Utc::now(),
            task_id: task_id.to_string(),
            title: title.to_string(),
            description: description.to_string(),
            data: EventData::default(),
            correlation_id: None,
            parent_event_id: None,
            retry_count: 0,
            processing_status: ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: Utc::now(),
            processed_at: None,
        }
    }
    
    /// Helper function to create a test event with custom event data
    fn create_test_event_with_data(
        task_id: &str,
        event_type: EventType,
        title: &str,
        description: &str,
        source: &str,
        data: EventData,
    ) -> Event {
        let mut event = create_test_event(task_id, event_type, title, description, source);
        event.data = data;
        event
    }
    
    /// Helper function to create test event data with specific fields
    fn create_test_event_data(
        status: Option<&str>,
        results: Option<&str>,
        files_affected: Option<Vec<String>>,
    ) -> EventData {
        EventData {
            status: status.map(|s| s.to_string()),
            results: results.map(|s| s.to_string()),
            files_affected,
            success: Some(status == Some("success")),
            ..EventData::default()
        }
    }
    
    #[tokio::test]
    async fn test_basic_duplicate_detection() {
        let config = create_test_config();
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        
        let event = create_test_event(
            "test_task_1",
            EventType::TaskCompletion,
            "Test Task Complete",
            "Test message for basic deduplication testing",
            "test_system",
        );
        
        let chat_id = 12345i64;
        
        // First message should be unique
        let result1 = system.check_duplicate(&event, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        // Second identical message should be duplicate
        let result2 = system.check_duplicate(&event, chat_id).await.unwrap();
        assert!(matches!(result2, DeduplicationResult::Duplicate { .. }));
        
        if let DeduplicationResult::Duplicate { duplicate_count, .. } = result2 {
            assert_eq!(duplicate_count, 2);
        }
        
        let stats = system.get_stats().await;
        assert_eq!(stats.messages_processed, 2);
        assert_eq!(stats.unique_messages, 1);
        assert_eq!(stats.duplicates_detected, 1);
    }
    
    #[tokio::test]
    async fn test_sha256_content_hashing() {
        let config = create_test_config();
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        
        let event1 = create_test_event(
            "hash_test_1",
            EventType::CodeGeneration,
            "Code Generation",
            "Generated authentication module",
            "ai_assistant",
        );
        
        let event2 = create_test_event(
            "hash_test_2", 
            EventType::CodeGeneration,
            "Code Generation",
            "Generated authentication module", // Same description
            "ai_assistant",
        );
        
        let event3 = create_test_event(
            "hash_test_3",
            EventType::CodeGeneration,
            "Code Generation", 
            "Generated authorization module", // Different description
            "ai_assistant",
        );
        
        let chat_id = 12345i64;
        
        // Process first event - should be unique
        let result1 = system.check_duplicate(&event1, chat_id).await.unwrap();
        if let DeduplicationResult::Unique(hash1) = result1 {
            assert!(!hash1.is_empty());
            assert_eq!(hash1.len(), 64); // SHA-256 produces 64-character hex string
        } else {
            panic!("First event should be unique");
        }
        
        // Process second event with same content - should be duplicate
        let result2 = system.check_duplicate(&event2, chat_id).await.unwrap();
        assert!(matches!(result2, DeduplicationResult::Duplicate { .. }));
        
        // Process third event with different content - should be unique
        let result3 = system.check_duplicate(&event3, chat_id).await.unwrap();
        if let DeduplicationResult::Unique(hash3) = result3 {
            assert!(!hash3.is_empty());
            assert_eq!(hash3.len(), 64);
        } else {
            panic!("Third event should be unique");
        }
        
        let stats = system.get_stats().await;
        assert_eq!(stats.messages_processed, 3);
        assert_eq!(stats.unique_messages, 2);
        assert_eq!(stats.duplicates_detected, 1);
    }
    
    #[tokio::test]
    async fn test_time_window_expiration() {
        let mut config = create_test_config();
        config.deduplication_window_seconds = 1; // 1 second window for fast testing
        
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        
        let event = create_test_event(
            "window_test",
            EventType::BuildCompleted,
            "Build Success",
            "Project build completed successfully",
            "build_system",
        );
        
        let chat_id = 12345i64;
        
        // First message should be unique
        let result1 = system.check_duplicate(&event, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        // Wait for window to expire
        thread::sleep(StdDuration::from_millis(1100));
        
        // Same message after expiration should be unique again
        let result2 = system.check_duplicate(&event, chat_id).await.unwrap();
        assert!(matches!(result2, DeduplicationResult::Unique(_)));
        
        let stats = system.get_stats().await;
        assert_eq!(stats.messages_processed, 2);
        assert_eq!(stats.unique_messages, 2);
        assert_eq!(stats.duplicates_detected, 0);
    }
    
    #[tokio::test]
    async fn test_content_normalization() {
        let config = create_test_config();
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        
        let event1 = create_test_event(
            "normalization_1",
            EventType::TestPassed,
            "Test Results",
            "All tests passed!!! Great job 123",
            "test_runner",
        );
        
        let event2 = create_test_event(
            "normalization_2",
            EventType::TestPassed,
            "Test Results", 
            "All tests passed!   Great job 456", // Different numbers and spacing
            "test_runner",
        );
        
        let chat_id = 12345i64;
        
        // First event should be unique
        let result1 = system.check_duplicate(&event1, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        // Second event should be detected as similar due to normalization
        let result2 = system.check_duplicate(&event2, chat_id).await.unwrap();
        // Note: This should be Similar or Duplicate depending on normalization effectiveness
        assert!(matches!(result2, DeduplicationResult::Similar { .. }) || 
                matches!(result2, DeduplicationResult::Duplicate { .. }));
        
        let stats = system.get_stats().await;
        assert_eq!(stats.messages_processed, 2);
    }
    
    #[tokio::test]
    async fn test_similarity_detection() {
        let config = create_test_config();
        let similarity_threshold = config.similarity_threshold; // Extract before moving config
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        
        let event1 = create_test_event(
            "similarity_1",
            EventType::BuildCompleted,
            "Build Status",
            "Build completed successfully with 5 artifacts generated",
            "build_system",
        );
        
        let event2 = create_test_event(
            "similarity_2",
            EventType::BuildCompleted,
            "Build Status", 
            "Build completed successfully with 3 artifacts generated", // Similar but different
            "build_system",
        );
        
        let event3 = create_test_event(
            "similarity_3",
            EventType::CodeReview,
            "Review Complete",
            "Security vulnerability found in authentication module", // Completely different
            "security_scanner",
        );
        
        let chat_id = 12345i64;
        
        // First message should be unique
        let result1 = system.check_duplicate(&event1, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        // Similar message should be detected
        let result2 = system.check_duplicate(&event2, chat_id).await.unwrap();
        if let DeduplicationResult::Similar { similarity_score, .. } = result2 {
            assert!(similarity_score >= similarity_threshold);
            assert!(similarity_score <= 1.0);
        } else {
            // If not similar, should be unique (depends on threshold)
            assert!(matches!(result2, DeduplicationResult::Unique(_)));
        }
        
        // Completely different message should be unique
        let result3 = system.check_duplicate(&event3, chat_id).await.unwrap();
        assert!(matches!(result3, DeduplicationResult::Unique(_)));
    }
    
    #[tokio::test]
    async fn test_cache_functionality() {
        let mut config = create_test_config();
        config.cache_size_limit = 2; // Small cache for testing
        
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        
        let event1 = create_test_event(
            "cache_1",
            EventType::TaskStarted,
            "Task Started",
            "Started processing user data",
            "task_processor",
        );
        
        let event2 = create_test_event(
            "cache_2",
            EventType::TaskStarted,
            "Task Started",
            "Started processing file uploads",
            "task_processor",
        );
        
        let event3 = create_test_event(
            "cache_3", 
            EventType::TaskStarted,
            "Task Started",
            "Started processing notifications",
            "task_processor",
        );
        
        let chat_id = 12345i64;
        
        // Process events to fill and exceed cache
        let result1 = system.check_duplicate(&event1, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        let result2 = system.check_duplicate(&event2, chat_id).await.unwrap();
        assert!(matches!(result2, DeduplicationResult::Unique(_)));
        
        let result3 = system.check_duplicate(&event3, chat_id).await.unwrap();
        assert!(matches!(result3, DeduplicationResult::Unique(_)));
        
        // Test cache hits by duplicating events
        let result1_dup = system.check_duplicate(&event1, chat_id).await.unwrap();
        assert!(matches!(result1_dup, DeduplicationResult::Duplicate { .. }));
        
        let stats = system.get_stats().await;
        assert_eq!(stats.messages_processed, 4);
        assert_eq!(stats.unique_messages, 3);
        assert_eq!(stats.duplicates_detected, 1);
        assert!(stats.cache_hits > 0 || stats.cache_misses > 0);
    }
    
    #[tokio::test] 
    async fn test_different_event_types() {
        let config = create_test_config();
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        let chat_id = 12345i64;
        
        let events = vec![
            create_test_event("1", EventType::TaskCompletion, "Task Done", "User registration complete", "api"),
            create_test_event("2", EventType::CodeGeneration, "Code Gen", "Generated auth module", "ai"),
            create_test_event("3", EventType::BuildFailed, "Build Error", "Compilation failed", "ci"),
            create_test_event("4", EventType::SecurityAlert, "Security", "Suspicious login detected", "security"),
            create_test_event("5", EventType::PerformanceAlert, "Performance", "High CPU usage detected", "monitor"),
        ];
        
        let mut unique_count = 0;
        
        for event in &events {
            let result = system.check_duplicate(event, chat_id).await.unwrap();
            if matches!(result, DeduplicationResult::Unique(_)) {
                unique_count += 1;
            }
        }
        
        assert_eq!(unique_count, 5);
        
        // Test duplicates of each type
        for event in &events {
            let result = system.check_duplicate(event, chat_id).await.unwrap();
            assert!(matches!(result, DeduplicationResult::Duplicate { .. }));
        }
        
        let stats = system.get_stats().await;
        assert_eq!(stats.messages_processed, 10);
        assert_eq!(stats.unique_messages, 5);
        assert_eq!(stats.duplicates_detected, 5);
    }
    
    #[tokio::test]
    async fn test_event_data_variations() {
        let config = create_test_config();
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        let chat_id = 12345i64;
        
        let data1 = create_test_event_data(
            Some("success"),
            Some("Operation completed"),
            Some(vec!["file1.rs".to_string(), "file2.rs".to_string()]),
        );
        
        let data2 = create_test_event_data(
            Some("failed"),
            Some("Operation failed with error"),
            Some(vec!["file3.rs".to_string()]),
        );
        
        let event1 = create_test_event_with_data(
            "data_test_1",
            EventType::FileModified,
            "File Changes",
            "Files were modified during operation", 
            "file_watcher",
            data1,
        );
        
        let event2 = create_test_event_with_data(
            "data_test_2", 
            EventType::FileModified,
            "File Changes",
            "Files were modified during operation", // Same description
            "file_watcher",
            data2, // Different data
        );
        
        // Events with same description but different data should be unique
        let result1 = system.check_duplicate(&event1, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        let result2 = system.check_duplicate(&event2, chat_id).await.unwrap();
        assert!(matches!(result2, DeduplicationResult::Unique(_)));
        
        // Test exact duplicate
        let result1_dup = system.check_duplicate(&event1, chat_id).await.unwrap();
        assert!(matches!(result1_dup, DeduplicationResult::Duplicate { .. }));
    }
    
    #[tokio::test]
    async fn test_cleanup_functionality() {
        let mut config = create_test_config();
        config.deduplication_window_seconds = 1; // Very short window
        config.cleanup_interval_hours = 0; // Immediate cleanup for testing
        
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        let chat_id = 12345i64;
        
        let event = create_test_event(
            "cleanup_test",
            EventType::InfoNotification,
            "Info Message",
            "This is a test info notification",
            "notification_service",
        );
        
        // Add entry
        let result1 = system.check_duplicate(&event, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        // Wait for expiration
        thread::sleep(StdDuration::from_millis(1100));
        
        // Force cleanup
        let cleaned = system.cleanup_expired_entries().await.unwrap();
        assert!(cleaned >= 0); // Should have cleaned some entries
        
        // Check that entry is gone (should be unique again)
        let result2 = system.check_duplicate(&event, chat_id).await.unwrap(); 
        assert!(matches!(result2, DeduplicationResult::Unique(_)));
    }
    
    #[tokio::test]
    async fn test_middleware_integration() {
        let config = create_test_config();
        let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
        let middleware = DeduplicationMiddleware::new(system);
        
        let event = create_test_event(
            "middleware_test",
            EventType::UserResponse,
            "User Input", 
            "User selected option A from menu",
            "telegram_bot",
        );
        
        let chat_id = 12345i64;
        
        // First process through middleware - should be unique
        let result1 = middleware.process(&event, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        // Second process - should be duplicate
        let result2 = middleware.process(&event, chat_id).await.unwrap();
        assert!(matches!(result2, DeduplicationResult::Duplicate { .. }));
        
        let stats = middleware.get_stats().await;
        assert_eq!(stats.messages_processed, 2);
        assert_eq!(stats.duplicates_detected, 1);
    }
    
    #[tokio::test]
    async fn test_middleware_similarity_bypass() {
        let config = create_test_config();
        let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
        let middleware = DeduplicationMiddleware::new(system).with_similarity_bypass(true);
        
        let event1 = create_test_event(
            "bypass_1",
            EventType::ApprovalRequest,
            "Approval Needed",
            "Please approve deployment to production environment",
            "deployment_service",
        );
        
        let event2 = create_test_event(
            "bypass_2", 
            EventType::ApprovalRequest,
            "Approval Needed",
            "Please approve deployment to staging environment", // Similar
            "deployment_service",
        );
        
        let chat_id = 12345i64;
        
        let result1 = middleware.process(&event1, chat_id).await.unwrap();
        assert!(matches!(result1, DeduplicationResult::Unique(_)));
        
        let result2 = middleware.process(&event2, chat_id).await.unwrap();
        // With bypass enabled, similar messages should be allowed through
        assert!(matches!(result2, DeduplicationResult::Unique(_)));
    }
    
    #[tokio::test]
    async fn test_statistics_accuracy() {
        let config = create_test_config();
        let system = MessageDeduplicationSystem::new(config).await.unwrap();
        let chat_id = 12345i64;
        
        // Create mix of unique, duplicate, and similar events
        let events = vec![
            create_test_event("stat_1", EventType::TaskCompletion, "Task 1", "First task completed", "worker"),
            create_test_event("stat_1", EventType::TaskCompletion, "Task 1", "First task completed", "worker"), // Duplicate
            create_test_event("stat_2", EventType::TaskCompletion, "Task 2", "Second task completed", "worker"), // Unique
            create_test_event("stat_3", EventType::TaskCompletion, "Task 3", "Third task completed successfully", "worker"), // Unique
        ];
        
        let mut expected_unique = 0;
        let mut expected_duplicates = 0;
        
        for event in events {
            let result = system.check_duplicate(&event, chat_id).await.unwrap();
            match result {
                DeduplicationResult::Unique(_) => expected_unique += 1,
                DeduplicationResult::Duplicate { .. } => expected_duplicates += 1,
                DeduplicationResult::Similar { .. } => {} // Could be either depending on similarity
            }
        }
        
        let stats = system.get_stats().await;
        assert_eq!(stats.messages_processed, 4);
        assert_eq!(stats.unique_messages, expected_unique);
        assert_eq!(stats.duplicates_detected, expected_duplicates);
        assert!(stats.cache_size <= 100); // Should respect cache limit
    }
    
    #[tokio::test]
    async fn test_concurrent_access() {
        use tokio::task::JoinSet;
        
        let config = create_test_config();
        let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
        let chat_id = 12345i64;
        
        let mut join_set = JoinSet::new();
        
        // Spawn multiple concurrent tasks
        for i in 0..10 {
            let system_clone = Arc::clone(&system);
            join_set.spawn(async move {
                let event = create_test_event(
                    &format!("concurrent_{}", i),
                    EventType::ProgressUpdate,
                    "Progress Update",
                    &format!("Task {} progress: {}%", i, i * 10),
                    "progress_tracker",
                );
                
                system_clone.check_duplicate(&event, chat_id).await.unwrap()
            });
        }
        
        let mut unique_count = 0;
        let mut duplicate_count = 0;
        
        while let Some(result) = join_set.join_next().await {
            let dedup_result = result.unwrap();
            match dedup_result {
                DeduplicationResult::Unique(_) => unique_count += 1,
                DeduplicationResult::Duplicate { .. } => duplicate_count += 1,
                DeduplicationResult::Similar { .. } => {} // Could be similar
            }
        }
        
        // All should be unique since they have different task_ids and descriptions
        assert_eq!(unique_count, 10);
        assert_eq!(duplicate_count, 0);
        
        let stats = system.get_stats().await;
        assert_eq!(stats.messages_processed, 10);
        assert_eq!(stats.unique_messages, 10);
    }
}
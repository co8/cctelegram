use anyhow::{Result, Context};
use redis::{Client as RedisClient, AsyncCommands};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, warn, error, info, instrument};
use uuid::Uuid;

use crate::events::types::{Event, ProcessingStatus};
use crate::telegram::rate_limiter::{RateLimiter, RateLimiterConfig};
use crate::telegram::retry_handler::{RetryHandler, RetryConfig, CircuitBreakerConfig};
use crate::utils::errors::BridgeError;

/// Priority levels for queue processing
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Critical = 4,
    High = 3,
    Normal = 2,
    Low = 1,
}

impl Default for Priority {
    fn default() -> Self {
        Priority::Normal
    }
}

impl Priority {
    /// Get Redis sort score for priority ordering (higher number = higher priority)
    pub fn score(&self) -> f64 {
        match self {
            Priority::Critical => 4.0,
            Priority::High => 3.0,
            Priority::Normal => 2.0,
            Priority::Low => 1.0,
        }
    }
}

/// Queue configuration for startup event processing
#[derive(Debug, Clone)]
pub struct QueueManagerConfig {
    /// Redis connection URL
    pub redis_url: String,
    /// Maximum number of concurrent workers
    pub max_workers: usize,
    /// Dead letter queue settings
    pub max_retry_attempts: u32,
    /// Batch size for startup processing
    pub startup_batch_size: usize,
    /// Processing timeout for individual events
    pub processing_timeout: Duration,
    /// Queue prefix for Redis keys
    pub queue_prefix: String,
}

impl Default for QueueManagerConfig {
    fn default() -> Self {
        Self {
            redis_url: "redis://localhost:6379".to_string(),
            max_workers: 5,
            max_retry_attempts: 3,
            startup_batch_size: 10,
            processing_timeout: Duration::from_secs(30),
            queue_prefix: "cctelegram:queue".to_string(),
        }
    }
}

/// Queued job structure for Redis storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedJob {
    /// Unique job ID
    pub id: String,
    /// Event data
    pub event: Event,
    /// Priority level
    pub priority: Priority,
    /// Number of retry attempts made
    pub attempts: u32,
    /// Timestamp when job was created
    pub created_at: u64,
    /// Timestamp when job should be processed (for delays)
    pub process_at: u64,
    /// Chat ID for rate limiting coordination
    pub chat_id: i64,
}

impl QueuedJob {
    /// Create new queued job from event
    pub fn new(event: Event, priority: Priority, chat_id: i64) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        Self {
            id: Uuid::new_v4().to_string(),
            event,
            priority,
            attempts: 0,
            created_at: now,
            process_at: now,
            chat_id,
        }
    }
    
    /// Check if job is ready for processing
    pub fn is_ready(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.process_at <= now
    }
    
    /// Delay job processing for retry
    pub fn delay_for_retry(&mut self, delay: Duration) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.process_at = now + delay.as_secs();
        self.attempts += 1;
    }
}

/// Queue statistics for monitoring
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct QueueStats {
    pub pending_jobs: u64,
    pub processing_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub dead_letter_jobs: u64,
    pub jobs_by_priority: HashMap<String, u64>,
    pub average_processing_time: Duration,
    pub worker_utilization: f64,
}

/// Main queue manager coordinating with Alpha's rate limiter and Beta's retry handler
pub struct QueueManager {
    config: QueueManagerConfig,
    redis_client: RedisClient,
    rate_limiter: Arc<RateLimiter>,
    retry_handler: RetryHandler,
    stats: Arc<RwLock<QueueStats>>,
    workers_running: Arc<Mutex<bool>>,
}

impl QueueManager {
    /// Create new queue manager with integrated Alpha and Beta components
    #[instrument(skip(rate_limiter_config, retry_config, circuit_breaker_config))]
    pub async fn new(
        config: QueueManagerConfig,
        rate_limiter_config: RateLimiterConfig,
        retry_config: RetryConfig,
        circuit_breaker_config: CircuitBreakerConfig,
    ) -> Result<Self> {
        // Create Redis client
        let redis_client = RedisClient::open(config.redis_url.clone())
            .with_context(|| format!("Failed to create Redis client with URL: {}", config.redis_url))?;

        // Test Redis connection
        let mut conn = redis_client.get_async_connection().await
            .context("Failed to establish Redis connection for queue manager")?;
        
        // Test Redis connection with a simple command
        let _: redis::RedisResult<()> = conn.set("cctelegram:test", "ping").await;
        let _: redis::RedisResult<()> = conn.del("cctelegram:test").await;
        
        info!("✅ Queue Manager: Redis connection established");

        // Initialize Alpha's rate limiter with Redis backend
        let rate_limiter = Arc::new(
            RateLimiter::new_with_redis(rate_limiter_config).await
                .context("Failed to initialize rate limiter for queue manager")?
        );
        info!("✅ Queue Manager: Rate limiter integrated (Alpha)");

        // Initialize Beta's retry handler with rate limiter integration
        let retry_handler = RetryHandler::with_config(retry_config, circuit_breaker_config)
            .with_rate_limiter(rate_limiter.clone());
        info!("✅ Queue Manager: Retry handler integrated (Beta)");

        Ok(Self {
            config,
            redis_client,
            rate_limiter,
            retry_handler,
            stats: Arc::new(RwLock::new(QueueStats::default())),
            workers_running: Arc::new(Mutex::new(false)),
        })
    }

    /// Add event to priority queue for processing
    #[instrument(skip(self, event))]
    pub async fn enqueue_event(
        &self,
        mut event: Event,
        priority: Priority,
        chat_id: i64,
    ) -> Result<String> {
        // Update event status
        event.processing_status = ProcessingStatus::Pending;
        
        // Create queued job
        let job = QueuedJob::new(event, priority.clone(), chat_id);
        let job_id = job.id.clone();
        
        // Serialize job
        let job_data = serde_json::to_string(&job)
            .context("Failed to serialize queued job")?;
        
        // Add to Redis priority queue
        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection for enqueue")?;
        
        let queue_key = format!("{}:pending", self.config.queue_prefix);
        let priority_score = priority.score() + (job.created_at as f64 / 1000.0); // Add timestamp for FIFO within priority
        
        let _: () = conn.zadd(&queue_key, job_data, priority_score).await
            .context("Failed to add job to Redis queue")?;
        
        // Update statistics
        {
            let mut stats = self.stats.write().await;
            stats.pending_jobs += 1;
            let priority_key = format!("{:?}", priority);
            *stats.jobs_by_priority.entry(priority_key).or_insert(0) += 1;
        }
        
        debug!("Enqueued job {} with priority {:?} for chat {}", job_id, priority, chat_id);
        Ok(job_id)
    }

    /// Process startup events in batches to avoid rate limit bursts
    #[instrument(skip(self, startup_events))]
    pub async fn process_startup_events(&self, startup_events: Vec<Event>) -> Result<()> {
        if startup_events.is_empty() {
            info!("No startup events to process");
            return Ok(());
        }

        info!("🚀 Processing {} startup events in batches of {}", 
              startup_events.len(), self.config.startup_batch_size);

        // Sort events by priority and enqueue them
        let mut prioritized_events = Vec::new();
        for event in startup_events {
            let priority = self.determine_event_priority(&event);
            let chat_id = self.extract_chat_id_from_event(&event);
            prioritized_events.push((event, priority, chat_id));
        }

        // Sort by priority (higher priority first)
        prioritized_events.sort_by(|a, b| b.1.cmp(&a.1));

        // Enqueue all events
        for (event, priority, chat_id) in prioritized_events {
            self.enqueue_event(event, priority, chat_id).await?;
        }

        // Start workers to process the queue
        self.start_workers().await?;
        
        info!("✅ Startup events queued and workers started");
        Ok(())
    }

    /// Start queue workers for processing
    #[instrument(skip(self))]
    pub async fn start_workers(&self) -> Result<()> {
        let mut workers_running = self.workers_running.lock().await;
        if *workers_running {
            debug!("Workers already running");
            return Ok(());
        }
        *workers_running = true;

        info!("🔧 Starting {} queue workers", self.config.max_workers);

        // Spawn worker tasks
        for worker_id in 0..self.config.max_workers {
            let config = self.config.clone();
            let redis_client = self.redis_client.clone();
            let rate_limiter = self.rate_limiter.clone();
            let retry_handler = self.retry_handler.clone();
            let stats = self.stats.clone();
            let workers_running = self.workers_running.clone();

            tokio::spawn(async move {
                Self::worker_loop(
                    worker_id,
                    config,
                    redis_client,
                    rate_limiter,
                    retry_handler,
                    stats,
                    workers_running,
                ).await;
            });
        }

        Ok(())
    }

    /// Worker loop for processing jobs
    #[instrument(skip(config, redis_client, _rate_limiter, retry_handler, stats, workers_running))]
    async fn worker_loop(
        worker_id: usize,
        config: QueueManagerConfig,
        redis_client: RedisClient,
        _rate_limiter: Arc<RateLimiter>,
        retry_handler: RetryHandler,
        stats: Arc<RwLock<QueueStats>>,
        workers_running: Arc<Mutex<bool>>,
    ) {
        debug!("Worker {} started", worker_id);

        let mut conn = match redis_client.get_async_connection().await {
            Ok(conn) => conn,
            Err(e) => {
                error!("Worker {}: Failed to connect to Redis: {}", worker_id, e);
                return;
            }
        };

        let queue_key = format!("{}:pending", config.queue_prefix);
        let processing_key = format!("{}:processing", config.queue_prefix);

        loop {
            // Check if workers should continue running
            {
                let running = workers_running.lock().await;
                if !*running {
                    debug!("Worker {} stopping", worker_id);
                    break;
                }
            }

            // Get next job from priority queue (highest priority first)
            let job_data: Option<String> = match conn.zpopmax(&queue_key, 1).await {
                Ok(result) => {
                    let items: Vec<(String, f64)> = result;
                    items.into_iter().next().map(|(data, _score)| data)
                }
                Err(e) => {
                    error!("Worker {}: Failed to pop from queue: {}", worker_id, e);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };

            let job_data = match job_data {
                Some(data) => data,
                None => {
                    // No jobs available, wait briefly
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
            };

            // Deserialize job
            let mut job: QueuedJob = match serde_json::from_str(&job_data) {
                Ok(job) => job,
                Err(e) => {
                    error!("Worker {}: Failed to deserialize job: {}", worker_id, e);
                    continue;
                }
            };

            // Check if job is ready for processing
            if !job.is_ready() {
                // Put job back in queue for later
                let priority_score = job.priority.score() + (job.process_at as f64 / 1000.0);
                let _: Result<(), _> = conn.zadd(&queue_key, &job_data, priority_score).await;
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }

            // Move job to processing set
            let _: Result<(), _> = conn.sadd(&processing_key, &job.id).await;

            // Update stats
            {
                let mut stats_guard = stats.write().await;
                stats_guard.pending_jobs = stats_guard.pending_jobs.saturating_sub(1);
                stats_guard.processing_jobs += 1;
            }

            debug!("Worker {}: Processing job {} (attempt {})", 
                   worker_id, job.id, job.attempts + 1);

            // Process the job with integrated retry logic
            let processing_start = Instant::now();
            let job_id = job.id.clone();
            let chat_id = job.chat_id;

            let process_result = retry_handler.send_telegram_message_with_retry(
                chat_id,
                || async { Self::process_single_event(&job.event).await }
            ).await;

            let processing_duration = processing_start.elapsed();

            match process_result {
                Ok(_) => {
                    // Job succeeded
                    info!("✅ Worker {}: Job {} completed successfully", worker_id, job_id);
                    
                    // Remove from processing set
                    let _: Result<(), _> = conn.srem(&processing_key, &job_id).await;
                    
                    // Update stats
                    let mut stats_guard = stats.write().await;
                    stats_guard.processing_jobs = stats_guard.processing_jobs.saturating_sub(1);
                    stats_guard.completed_jobs += 1;
                    stats_guard.average_processing_time = 
                        Duration::from_millis(
                            (stats_guard.average_processing_time.as_millis() as u64 + processing_duration.as_millis() as u64) / 2
                        );
                }
                Err(e) => {
                    // Job failed
                    error!("❌ Worker {}: Job {} failed: {}", worker_id, job_id, e);
                    
                    job.attempts += 1;
                    
                    if job.attempts >= config.max_retry_attempts {
                        // Move to dead letter queue
                        warn!("💀 Worker {}: Moving job {} to dead letter queue after {} attempts", 
                              worker_id, job_id, job.attempts);
                        
                        let dlq_key = format!("{}:dead_letter", config.queue_prefix);
                        let dlq_data = serde_json::to_string(&job).unwrap_or_default();
                        let _: Result<(), _> = conn.lpush(&dlq_key, dlq_data).await;
                        
                        // Update stats
                        let mut stats_guard = stats.write().await;
                        stats_guard.processing_jobs = stats_guard.processing_jobs.saturating_sub(1);
                        stats_guard.dead_letter_jobs += 1;
                    } else {
                        // Retry with exponential backoff
                        let delay = Duration::from_millis(1000 * 2_u64.pow(job.attempts - 1));
                        job.delay_for_retry(delay);
                        
                        info!("🔄 Worker {}: Retrying job {} in {}ms (attempt {})", 
                              worker_id, job_id, delay.as_millis(), job.attempts);
                        
                        // Put back in queue with delay
                        let retry_data = serde_json::to_string(&job).unwrap_or_default();
                        let priority_score = job.priority.score() + (job.process_at as f64 / 1000.0);
                        let _: Result<(), _> = conn.zadd(&queue_key, retry_data, priority_score).await;
                        
                        // Update stats
                        let mut stats_guard = stats.write().await;
                        stats_guard.processing_jobs = stats_guard.processing_jobs.saturating_sub(1);
                        stats_guard.pending_jobs += 1;
                    }
                    
                    // Remove from processing set
                    let _: Result<(), _> = conn.srem(&processing_key, &job_id).await;
                }
            }
        }

        debug!("Worker {} stopped", worker_id);
    }

    /// Process a single event (placeholder for actual Telegram sending)
    async fn process_single_event(event: &Event) -> Result<(), BridgeError> {
        // Simulate actual Telegram message sending
        // In real implementation, this would call the Telegram API
        
        debug!("Processing event: {} - {}", event.task_id, event.title);
        
        // Simulate processing time and potential failures
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // Simulate occasional failures for testing retry logic
        if event.task_id.contains("fail") {
            return Err(BridgeError::EventProcessing("simulated failure for testing".to_string()));
        }
        
        Ok(())
    }

    /// Determine event priority based on content
    fn determine_event_priority(&self, event: &Event) -> Priority {
        // Priority logic based on event type and content
        if event.title.to_lowercase().contains("critical") || 
           event.title.to_lowercase().contains("error") ||
           event.title.to_lowercase().contains("security") {
            Priority::Critical
        } else if event.title.to_lowercase().contains("build") ||
                  event.title.to_lowercase().contains("deploy") ||
                  event.title.to_lowercase().contains("test") {
            Priority::High
        } else if event.title.to_lowercase().contains("warning") ||
                  event.title.to_lowercase().contains("performance") {
            Priority::Normal
        } else {
            Priority::Low
        }
    }

    /// Extract chat ID from event (would normally come from configuration)
    fn extract_chat_id_from_event(&self, _event: &Event) -> i64 {
        // For now, return a default chat ID
        // In real implementation, this would extract from event metadata
        // or use configured default user ID
        123456789 // Placeholder
    }

    /// Stop all workers gracefully
    #[instrument(skip(self))]
    pub async fn stop_workers(&self) -> Result<()> {
        info!("🛑 Stopping queue workers");
        let mut workers_running = self.workers_running.lock().await;
        *workers_running = false;
        
        // Give workers time to finish current jobs
        tokio::time::sleep(Duration::from_secs(2)).await;
        
        info!("✅ Queue workers stopped");
        Ok(())
    }

    /// Get current queue statistics
    pub async fn get_stats(&self) -> QueueStats {
        // Update Redis-based stats
        if let Ok(mut conn) = self.redis_client.get_async_connection().await {
            let mut stats = self.stats.write().await;
            
            // Get current queue sizes from Redis
            let pending_key = format!("{}:pending", self.config.queue_prefix);
            let processing_key = format!("{}:processing", self.config.queue_prefix);
            let dead_letter_key = format!("{}:dead_letter", self.config.queue_prefix);
            
            if let Ok(pending_count) = conn.zcard::<_, u64>(&pending_key).await {
                stats.pending_jobs = pending_count;
            }
            
            if let Ok(processing_count) = conn.scard::<_, u64>(&processing_key).await {
                stats.processing_jobs = processing_count;
            }
            
            if let Ok(dl_count) = conn.llen::<_, u64>(&dead_letter_key).await {
                stats.dead_letter_jobs = dl_count;
            }
            
            stats.clone()
        } else {
            self.stats.read().await.clone()
        }
    }

    /// Clear all queues (for testing and emergency cleanup)
    #[instrument(skip(self))]
    pub async fn clear_all_queues(&self) -> Result<()> {
        warn!("🧹 Clearing all queues");
        
        let mut conn = self.redis_client.get_async_connection().await
            .context("Failed to get Redis connection for queue clearing")?;
        
        let keys = [
            format!("{}:pending", self.config.queue_prefix),
            format!("{}:processing", self.config.queue_prefix),
            format!("{}:dead_letter", self.config.queue_prefix),
        ];
        
        for key in &keys {
            let _: Result<u64, _> = conn.del(key).await;
        }
        
        // Reset stats
        let mut stats = self.stats.write().await;
        *stats = QueueStats::default();
        
        info!("✅ All queues cleared");
        Ok(())
    }
}

// Integration tests
#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{Event, EventType, EventData, ProcessingStatus};
    use chrono::Utc;

    fn create_test_event(task_id: &str, title: &str) -> Event {
        Event {
            event_id: Uuid::new_v4().to_string(),
            event_type: EventType::TaskCompletion,
            source: "test".to_string(),
            timestamp: Utc::now(),
            task_id: task_id.to_string(),
            title: title.to_string(),
            description: "Test event".to_string(),
            data: EventData::default(),
            correlation_id: None,
            parent_event_id: None,
            retry_count: 0,
            processing_status: ProcessingStatus::Pending,
            priority: None,
            chat_id: Some(123456789),
            processing_metadata: None,
            validation_errors: None,
        }
    }

    #[tokio::test]
    async fn test_priority_ordering() {
        assert!(Priority::Critical > Priority::High);
        assert!(Priority::High > Priority::Normal);
        assert!(Priority::Normal > Priority::Low);
        
        assert!(Priority::Critical.score() > Priority::High.score());
        assert!(Priority::High.score() > Priority::Normal.score());
        assert!(Priority::Normal.score() > Priority::Low.score());
    }

    #[tokio::test]
    async fn test_queued_job_creation() {
        let event = create_test_event("test-1", "Test Event");
        let job = QueuedJob::new(event.clone(), Priority::High, 123456789);
        
        assert_eq!(job.event.task_id, event.task_id);
        assert_eq!(job.priority, Priority::High);
        assert_eq!(job.chat_id, 123456789);
        assert_eq!(job.attempts, 0);
        assert!(job.is_ready());
    }

    #[tokio::test]
    async fn test_job_delay_for_retry() {
        let event = create_test_event("test-1", "Test Event");
        let mut job = QueuedJob::new(event, Priority::Normal, 123456789);
        
        let delay = Duration::from_secs(5);
        job.delay_for_retry(delay);
        
        assert_eq!(job.attempts, 1);
        assert!(!job.is_ready()); // Should not be ready for immediate processing
        
        // Wait for the delay to pass
        tokio::time::sleep(Duration::from_millis(100)).await;
        // Note: In a real test, we'd need to wait the full delay or mock time
    }
}
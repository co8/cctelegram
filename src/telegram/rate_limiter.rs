use anyhow::{Result, Context};
use async_trait::async_trait;
use redis::{Client as RedisClient};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, warn, instrument};

/// Rate limiting configuration
#[derive(Debug, Clone)]
pub struct RateLimiterConfig {
    pub global_limit: u32,          // messages per second (default: 30)
    pub per_chat_limit: u32,        // messages per second per chat (default: 1)
    pub redis_url: Option<String>,  // Redis connection URL (optional)
    pub enable_telemetry: bool,     // Enable performance monitoring
}

impl Default for RateLimiterConfig {
    fn default() -> Self {
        Self {
            global_limit: 30,
            per_chat_limit: 1,
            redis_url: None,
            enable_telemetry: true,
        }
    }
}

/// Rate limiting metrics for telemetry
#[derive(Debug, Clone, Default)]
pub struct RateLimiterMetrics {
    pub global_requests: u64,
    pub per_chat_requests: HashMap<i64, u64>,
    pub global_throttled: u64,
    pub per_chat_throttled: HashMap<i64, u64>,
    pub avg_processing_time_micros: u64,
    pub peak_processing_time_micros: u64,
}

/// Trait for rate limiting backends
#[async_trait]
pub trait RateLimitBackend: Send + Sync {
    /// Check if a global rate limit allows the request
    async fn check_global_limit(&self, limit: u32) -> Result<bool>;
    
    /// Check if a per-chat rate limit allows the request
    async fn check_per_chat_limit(&self, chat_id: i64, limit: u32) -> Result<bool>;
    
    /// Get current metrics
    async fn get_metrics(&self) -> Result<RateLimiterMetrics>;
}

/// Redis-based rate limiting backend using token bucket algorithm
pub struct RedisRateLimitBackend {
    client: RedisClient,
    connection: Arc<Mutex<redis::aio::Connection>>,
}

impl RedisRateLimitBackend {
    pub async fn new(redis_url: &str) -> Result<Self> {
        let client = RedisClient::open(redis_url)
            .with_context(|| format!("Failed to create Redis client with URL: {}", redis_url))?;
        
        let connection = client.get_async_connection().await
            .context("Failed to establish Redis connection")?;
        
        Ok(Self {
            client,
            connection: Arc::new(Mutex::new(connection)),
        })
    }
}

#[async_trait]
impl RateLimitBackend for RedisRateLimitBackend {
    #[instrument(skip(self))]
    async fn check_global_limit(&self, limit: u32) -> Result<bool> {
        let key = "cctelegram:global_rate_limit";
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();
        
        let mut conn = self.connection.lock().await;
        
        // Token bucket algorithm with Redis
        // Use EVAL to ensure atomicity
        let script = r#"
            local key = KEYS[1]
            local limit = tonumber(ARGV[1])
            local current_time = tonumber(ARGV[2])
            local bucket_size = limit
            local refill_rate = limit
            
            -- Get current bucket state
            local bucket_info = redis.call('HMGET', key, 'tokens', 'last_refill')
            local current_tokens = tonumber(bucket_info[1]) or bucket_size
            local last_refill = tonumber(bucket_info[2]) or current_time
            
            -- Calculate tokens to add based on time elapsed
            local time_passed = math.max(0, current_time - last_refill)
            local tokens_to_add = math.floor(time_passed * refill_rate)
            current_tokens = math.min(bucket_size, current_tokens + tokens_to_add)
            
            -- Check if we can consume a token
            if current_tokens >= 1 then
                current_tokens = current_tokens - 1
                -- Update bucket state
                redis.call('HMSET', key, 'tokens', current_tokens, 'last_refill', current_time)
                redis.call('EXPIRE', key, 3600)  -- Expire after 1 hour of inactivity
                return 1  -- Allowed
            else
                -- Update last_refill time even if request is denied
                redis.call('HMSET', key, 'tokens', current_tokens, 'last_refill', current_time)
                redis.call('EXPIRE', key, 3600)
                return 0  -- Rate limited
            end
        "#;
        
        let allowed: i32 = redis::Script::new(script)
            .key(key)
            .arg(limit)
            .arg(current_time)
            .invoke_async(&mut *conn)
            .await
            .context("Failed to execute rate limit script for global limit")?;
        
        debug!("Global rate limit check: allowed={}", allowed == 1);
        Ok(allowed == 1)
    }
    
    #[instrument(skip(self))]
    async fn check_per_chat_limit(&self, chat_id: i64, limit: u32) -> Result<bool> {
        let key = format!("cctelegram:chat_rate_limit:{}", chat_id);
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();
        
        let mut conn = self.connection.lock().await;
        
        // Same token bucket algorithm for per-chat limits
        let script = r#"
            local key = KEYS[1]
            local limit = tonumber(ARGV[1])
            local current_time = tonumber(ARGV[2])
            local bucket_size = limit
            local refill_rate = limit
            
            -- Get current bucket state
            local bucket_info = redis.call('HMGET', key, 'tokens', 'last_refill')
            local current_tokens = tonumber(bucket_info[1]) or bucket_size
            local last_refill = tonumber(bucket_info[2]) or current_time
            
            -- Calculate tokens to add based on time elapsed
            local time_passed = math.max(0, current_time - last_refill)
            local tokens_to_add = math.floor(time_passed * refill_rate)
            current_tokens = math.min(bucket_size, current_tokens + tokens_to_add)
            
            -- Check if we can consume a token
            if current_tokens >= 1 then
                current_tokens = current_tokens - 1
                -- Update bucket state
                redis.call('HMSET', key, 'tokens', current_tokens, 'last_refill', current_time)
                redis.call('EXPIRE', key, 3600)  -- Expire after 1 hour of inactivity
                return 1  -- Allowed
            else
                -- Update last_refill time even if request is denied
                redis.call('HMSET', key, 'tokens', current_tokens, 'last_refill', current_time)
                redis.call('EXPIRE', key, 3600)
                return 0  -- Rate limited
            end
        "#;
        
        let allowed: i32 = redis::Script::new(script)
            .key(&key)
            .arg(limit)
            .arg(current_time)
            .invoke_async(&mut *conn)
            .await
            .context("Failed to execute rate limit script for per-chat limit")?;
        
        debug!("Per-chat rate limit check for chat {}: allowed={}", chat_id, allowed == 1);
        Ok(allowed == 1)
    }
    
    async fn get_metrics(&self) -> Result<RateLimiterMetrics> {
        // For now, return empty metrics. This would be implemented by tracking
        // metrics in Redis or a separate metrics store
        Ok(RateLimiterMetrics::default())
    }
}

/// In-memory rate limiting backend for development/testing
pub struct MemoryRateLimitBackend {
    global_tokens: Arc<RwLock<(u32, Instant)>>,
    per_chat_tokens: Arc<RwLock<HashMap<i64, (u32, Instant)>>>,
    metrics: Arc<RwLock<RateLimiterMetrics>>,
}

impl MemoryRateLimitBackend {
    pub fn new() -> Self {
        Self {
            global_tokens: Arc::new(RwLock::new((30, Instant::now()))), // Start with full bucket
            per_chat_tokens: Arc::new(RwLock::new(HashMap::new())),
            metrics: Arc::new(RwLock::new(RateLimiterMetrics::default())),
        }
    }
    
    async fn refill_bucket(current_tokens: u32, last_refill: Instant, limit: u32, bucket_size: u32) -> (u32, Instant) {
        let now = Instant::now();
        let time_passed = now.duration_since(last_refill).as_secs_f64();
        let tokens_to_add = (time_passed * limit as f64) as u32;
        let new_tokens = (current_tokens + tokens_to_add).min(bucket_size);
        (new_tokens, now)
    }
}

#[async_trait]
impl RateLimitBackend for MemoryRateLimitBackend {
    #[instrument(skip(self))]
    async fn check_global_limit(&self, limit: u32) -> Result<bool> {
        let mut global_tokens = self.global_tokens.write().await;
        let (current_tokens, last_refill) = *global_tokens;
        
        // Refill bucket
        let (new_tokens, now) = Self::refill_bucket(current_tokens, last_refill, limit, limit).await;
        
        if new_tokens >= 1 {
            *global_tokens = (new_tokens - 1, now);
            debug!("Global rate limit: allowed (tokens remaining: {})", new_tokens - 1);
            Ok(true)
        } else {
            *global_tokens = (new_tokens, now);
            debug!("Global rate limit: denied (tokens: {})", new_tokens);
            Ok(false)
        }
    }
    
    #[instrument(skip(self))]
    async fn check_per_chat_limit(&self, chat_id: i64, limit: u32) -> Result<bool> {
        let mut per_chat_tokens = self.per_chat_tokens.write().await;
        let now = Instant::now();
        
        let entry = per_chat_tokens.entry(chat_id).or_insert((limit, now)); // Start with full bucket
        let (current_tokens, last_refill) = *entry;
        
        // Refill bucket
        let (new_tokens, now) = Self::refill_bucket(current_tokens, last_refill, limit, limit).await;
        
        if new_tokens >= 1 {
            *entry = (new_tokens - 1, now);
            debug!("Per-chat rate limit for {}: allowed (tokens remaining: {})", chat_id, new_tokens - 1);
            Ok(true)
        } else {
            *entry = (new_tokens, now);
            debug!("Per-chat rate limit for {}: denied (tokens: {})", chat_id, new_tokens);
            Ok(false)
        }
    }
    
    async fn get_metrics(&self) -> Result<RateLimiterMetrics> {
        Ok(self.metrics.read().await.clone())
    }
}

/// Main rate limiter struct
pub struct RateLimiter {
    config: RateLimiterConfig,
    backend: Arc<dyn RateLimitBackend>,
    metrics: Arc<RwLock<RateLimiterMetrics>>,
}

impl RateLimiter {
    /// Create a new rate limiter with Redis backend
    pub async fn new_with_redis(config: RateLimiterConfig) -> Result<Self> {
        let redis_url = config.redis_url.clone()
            .context("Redis URL is required for Redis backend")?;
        
        let backend = Arc::new(RedisRateLimitBackend::new(&redis_url).await?) as Arc<dyn RateLimitBackend>;
        
        Ok(Self {
            config,
            backend,
            metrics: Arc::new(RwLock::new(RateLimiterMetrics::default())),
        })
    }
    
    /// Create a new rate limiter with in-memory backend (for testing/development)
    pub fn new_in_memory(config: RateLimiterConfig) -> Self {
        let backend = Arc::new(MemoryRateLimitBackend::new()) as Arc<dyn RateLimitBackend>;
        
        Self {
            config,
            backend,
            metrics: Arc::new(RwLock::new(RateLimiterMetrics::default())),
        }
    }
    
    /// Check if a message can be sent to a specific chat
    #[instrument(skip(self))]
    pub async fn check_rate_limit(&self, chat_id: i64) -> Result<bool> {
        let start_time = Instant::now();
        
        // Check global limit first (more restrictive)
        let global_allowed = self.backend.check_global_limit(self.config.global_limit).await?;
        if !global_allowed {
            warn!("Message blocked by global rate limit ({}msg/s)", self.config.global_limit);
            
            if self.config.enable_telemetry {
                let mut metrics = self.metrics.write().await;
                metrics.global_throttled += 1;
            }
            
            return Ok(false);
        }
        
        // Check per-chat limit
        let per_chat_allowed = self.backend.check_per_chat_limit(chat_id, self.config.per_chat_limit).await?;
        if !per_chat_allowed {
            warn!("Message blocked by per-chat rate limit for chat {} ({}msg/s)", 
                  chat_id, self.config.per_chat_limit);
            
            if self.config.enable_telemetry {
                let mut metrics = self.metrics.write().await;
                let entry = metrics.per_chat_throttled.entry(chat_id).or_insert(0);
                *entry += 1;
            }
            
            return Ok(false);
        }
        
        // Update telemetry
        if self.config.enable_telemetry {
            let processing_time = start_time.elapsed().as_micros() as u64;
            let mut metrics = self.metrics.write().await;
            metrics.global_requests += 1;
            let entry = metrics.per_chat_requests.entry(chat_id).or_insert(0);
            *entry += 1;
            
            // Update processing time metrics
            if processing_time > metrics.peak_processing_time_micros {
                metrics.peak_processing_time_micros = processing_time;
            }
            
            // Simple moving average for processing time
            metrics.avg_processing_time_micros = 
                (metrics.avg_processing_time_micros + processing_time) / 2;
        }
        
        debug!("Rate limit check passed for chat {} (processing time: {}μs)", 
               chat_id, start_time.elapsed().as_micros());
        
        Ok(true)
    }
    
    /// Get current rate limiting metrics
    pub async fn get_metrics(&self) -> Result<RateLimiterMetrics> {
        Ok(self.metrics.read().await.clone())
    }
    
    /// Reset rate limiting metrics
    pub async fn reset_metrics(&self) {
        let mut metrics = self.metrics.write().await;
        *metrics = RateLimiterMetrics::default();
    }
    
    /// Get configuration
    pub fn get_config(&self) -> &RateLimiterConfig {
        &self.config
    }
    
    /// Check if a batch of messages can be sent (for SubAgent Gamma)
    pub async fn check_batch_rate_limit(&self, chat_ids: &[i64]) -> Result<Vec<bool>> {
        let mut results = Vec::with_capacity(chat_ids.len());
        
        for &chat_id in chat_ids {
            let allowed = self.check_rate_limit(chat_id).await?;
            results.push(allowed);
        }
        
        Ok(results)
    }
    
    /// Wait for rate limit to allow a message (with timeout)
    pub async fn wait_for_rate_limit(&self, chat_id: i64, timeout: Duration) -> Result<bool> {
        let start_time = Instant::now();
        
        while start_time.elapsed() < timeout {
            if self.check_rate_limit(chat_id).await? {
                return Ok(true);
            }
            
            // Wait a short time before retrying
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::sleep;
    
    #[tokio::test]
    async fn test_memory_backend_global_limit() {
        let config = RateLimiterConfig {
            global_limit: 2,
            per_chat_limit: 10,
            ..Default::default()
        };
        
        let rate_limiter = RateLimiter::new_in_memory(config);
        
        // First two should pass
        assert!(rate_limiter.check_rate_limit(123).await.unwrap());
        assert!(rate_limiter.check_rate_limit(456).await.unwrap());
        
        // Third should be blocked by global limit
        assert!(!rate_limiter.check_rate_limit(789).await.unwrap());
        
        // Wait for refill and try again
        sleep(Duration::from_secs(2)).await;
        assert!(rate_limiter.check_rate_limit(789).await.unwrap());
    }
    
    #[tokio::test]
    async fn test_memory_backend_per_chat_limit() {
        let config = RateLimiterConfig {
            global_limit: 10,
            per_chat_limit: 1,
            ..Default::default()
        };
        
        let rate_limiter = RateLimiter::new_in_memory(config);
        let chat_id = 123;
        
        // First message should pass
        assert!(rate_limiter.check_rate_limit(chat_id).await.unwrap());
        
        // Second message should be blocked by per-chat limit
        assert!(!rate_limiter.check_rate_limit(chat_id).await.unwrap());
        
        // Different chat should still work
        assert!(rate_limiter.check_rate_limit(456).await.unwrap());
        
        // Wait for refill and try again
        sleep(Duration::from_secs(2)).await;
        assert!(rate_limiter.check_rate_limit(chat_id).await.unwrap());
    }
    
    #[tokio::test]
    async fn test_batch_rate_limit() {
        let config = RateLimiterConfig {
            global_limit: 2,
            per_chat_limit: 1,
            ..Default::default()
        };
        
        let rate_limiter = RateLimiter::new_in_memory(config);
        let chat_ids = vec![123, 456, 789];
        
        let results = rate_limiter.check_batch_rate_limit(&chat_ids).await.unwrap();
        
        // First two should pass, third should be blocked by global limit
        assert_eq!(results, vec![true, true, false]);
    }
    
    #[tokio::test]
    async fn test_wait_for_rate_limit() {
        let config = RateLimiterConfig {
            global_limit: 1,
            per_chat_limit: 1,
            ..Default::default()
        };
        
        let rate_limiter = RateLimiter::new_in_memory(config);
        let chat_id = 123;
        
        // Consume the token
        assert!(rate_limiter.check_rate_limit(chat_id).await.unwrap());
        
        // This should wait and then succeed
        let result = rate_limiter.wait_for_rate_limit(chat_id, Duration::from_secs(2)).await.unwrap();
        assert!(result);
    }
}
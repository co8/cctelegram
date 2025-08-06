//! Telemetry and metrics collection for MCP operations

use super::errors::McpError;
use super::McpConfig;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, info};

/// Telemetry collector for MCP operations
pub struct McpTelemetry {
    metrics: Arc<RwLock<McpMetrics>>,
    config: McpConfig,
    start_time: Instant,
}

/// Comprehensive metrics for MCP operations
#[derive(Debug, Default)]
pub struct McpMetrics {
    // Operation counters
    total_operations: u64,
    successful_operations: u64,
    failed_operations: u64,
    
    // Cache metrics
    cache_hits: u64,
    cache_misses: u64,
    cache_evictions: u64,
    
    // Connection metrics
    connection_attempts: u64,
    connection_successes: u64,
    connection_failures: u64,
    connection_timeouts: u64,
    
    // Circuit breaker metrics
    circuit_breaker_trips: u64,
    circuit_breaker_recoveries: u64,
    
    // Performance metrics
    operation_durations: Vec<Duration>,
    average_response_time: Duration,
    max_response_time: Duration,
    min_response_time: Duration,
    
    // Error tracking
    errors_by_code: HashMap<u16, u64>,
    errors_by_category: HashMap<String, u64>,
    
    // Retry metrics
    total_retries: u64,
    retry_successes: u64,
    retry_exhaustions: u64,
    
    // Timestamp tracking
    last_success: Option<Instant>,
    last_failure: Option<Instant>,
    last_cache_hit: Option<Instant>,
}

/// Operation result for telemetry recording
#[derive(Debug)]
pub enum OperationResult {
    Success,
    Failure(McpError),
    CacheHit,
    CacheMiss,
}

impl McpTelemetry {
    pub fn new(config: &McpConfig) -> Self {
        Self {
            metrics: Arc::new(RwLock::new(McpMetrics::default())),
            config: config.clone(),
            start_time: Instant::now(),
        }
    }

    /// Record a successful operation
    pub async fn record_success(&self, operation_id: &str, duration: Duration) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.total_operations += 1;
        metrics.successful_operations += 1;
        metrics.last_success = Some(Instant::now());
        
        // Update performance metrics
        metrics.operation_durations.push(duration);
        if metrics.operation_durations.len() > 1000 {
            // Keep only last 1000 measurements for rolling average
            metrics.operation_durations.remove(0);
        }
        
        metrics.update_response_time_stats(duration);
        
        debug!("Recorded successful operation: {} in {:?}", operation_id, duration);
    }

    /// Record a failed operation
    pub async fn record_error(&self, operation_id: &str, error: &McpError, duration: Duration) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.total_operations += 1;
        metrics.failed_operations += 1;
        metrics.last_failure = Some(Instant::now());
        
        // Track error by code and category
        let error_code = error.code() as u16;
        let error_category = format!("{:?}", error.category());
        
        *metrics.errors_by_code.entry(error_code).or_insert(0) += 1;
        *metrics.errors_by_category.entry(error_category).or_insert(0) += 1;
        
        // Update performance metrics even for failures
        metrics.operation_durations.push(duration);
        if metrics.operation_durations.len() > 1000 {
            metrics.operation_durations.remove(0);
        }
        
        metrics.update_response_time_stats(duration);
        
        debug!("Recorded failed operation: {} in {:?}, error: {:?}", operation_id, duration, error);
    }

    /// Record cache hit
    pub async fn record_cache_hit(&self, operation_id: &str) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.cache_hits += 1;
        metrics.last_cache_hit = Some(Instant::now());
        
        debug!("Recorded cache hit for operation: {}", operation_id);
    }

    /// Record cache miss
    pub async fn record_cache_miss(&self, operation_id: &str) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.cache_misses += 1;
        
        debug!("Recorded cache miss for operation: {}", operation_id);
    }

    /// Record cache eviction
    pub async fn record_cache_eviction(&self, count: u64) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.cache_evictions += count;
        
        debug!("Recorded {} cache evictions", count);
    }

    /// Record connection attempt
    pub async fn record_connection_attempt(&self, success: bool) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.connection_attempts += 1;
        
        if success {
            metrics.connection_successes += 1;
        } else {
            metrics.connection_failures += 1;
        }
        
        debug!("Recorded connection attempt: success={}", success);
    }

    /// Record connection timeout
    pub async fn record_connection_timeout(&self) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.connection_timeouts += 1;
        
        debug!("Recorded connection timeout");
    }

    /// Record circuit breaker trip
    pub async fn record_circuit_breaker_trip(&self) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.circuit_breaker_trips += 1;
        
        info!("Recorded circuit breaker trip");
    }

    /// Record circuit breaker recovery
    pub async fn record_circuit_breaker_recovery(&self) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.circuit_breaker_recoveries += 1;
        
        info!("Recorded circuit breaker recovery");
    }

    /// Record retry attempt
    pub async fn record_retry(&self, success: bool, exhausted: bool) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        metrics.total_retries += 1;
        
        if success {
            metrics.retry_successes += 1;
        } else if exhausted {
            metrics.retry_exhaustions += 1;
        }
        
        debug!("Recorded retry: success={}, exhausted={}", success, exhausted);
    }

    /// Get comprehensive metrics snapshot
    pub async fn get_metrics(&self) -> Result<serde_json::Value, McpError> {
        if !self.config.enable_telemetry {
            return Err(McpError::TelemetryDisabled);
        }

        let metrics = self.metrics.read().await;
        let uptime = self.start_time.elapsed();
        
        Ok(serde_json::json!({
            "uptime_seconds": uptime.as_secs(),
            "operations": {
                "total": metrics.total_operations,
                "successful": metrics.successful_operations,
                "failed": metrics.failed_operations,
                "success_rate": metrics.success_rate(),
                "operations_per_second": metrics.operations_per_second(uptime),
            },
            "cache": {
                "hits": metrics.cache_hits,
                "misses": metrics.cache_misses,
                "hit_rate": metrics.cache_hit_rate(),
                "evictions": metrics.cache_evictions,
            },
            "connections": {
                "attempts": metrics.connection_attempts,
                "successes": metrics.connection_successes,
                "failures": metrics.connection_failures,
                "timeouts": metrics.connection_timeouts,
                "success_rate": metrics.connection_success_rate(),
            },
            "circuit_breaker": {
                "trips": metrics.circuit_breaker_trips,
                "recoveries": metrics.circuit_breaker_recoveries,
            },
            "performance": {
                "average_response_time_ms": metrics.average_response_time.as_millis(),
                "min_response_time_ms": metrics.min_response_time.as_millis(),
                "max_response_time_ms": metrics.max_response_time.as_millis(),
                "total_measurements": metrics.operation_durations.len(),
            },
            "retries": {
                "total": metrics.total_retries,
                "successes": metrics.retry_successes,
                "exhaustions": metrics.retry_exhaustions,
                "success_rate": metrics.retry_success_rate(),
            },
            "errors": {
                "by_code": metrics.errors_by_code,
                "by_category": metrics.errors_by_category,
            },
            "timestamps": {
                "last_success": metrics.last_success.map(|t| t.elapsed().as_secs()),
                "last_failure": metrics.last_failure.map(|t| t.elapsed().as_secs()),
                "last_cache_hit": metrics.last_cache_hit.map(|t| t.elapsed().as_secs()),
            }
        }))
    }

    /// Reset all metrics (for testing or cleanup)
    pub async fn reset_metrics(&self) {
        if !self.config.enable_telemetry {
            return;
        }

        let mut metrics = self.metrics.write().await;
        *metrics = McpMetrics::default();
        
        info!("Reset all telemetry metrics");
    }

    /// Get health status based on metrics
    pub async fn get_health_status(&self) -> serde_json::Value {
        let metrics = self.metrics.read().await;
        let uptime = self.start_time.elapsed();
        
        // Calculate health indicators
        let success_rate = metrics.success_rate();
        let connection_success_rate = metrics.connection_success_rate();
        let cache_hit_rate = metrics.cache_hit_rate();
        let avg_response_time = metrics.average_response_time;
        
        // Determine overall health
        let is_healthy = success_rate >= 0.95 
            && connection_success_rate >= 0.90 
            && avg_response_time < Duration::from_millis(1000)
            && metrics.circuit_breaker_trips < 5;
        
        serde_json::json!({
            "healthy": is_healthy,
            "uptime_seconds": uptime.as_secs(),
            "success_rate": success_rate,
            "connection_success_rate": connection_success_rate,
            "cache_hit_rate": cache_hit_rate,
            "avg_response_time_ms": avg_response_time.as_millis(),
            "circuit_breaker_trips": metrics.circuit_breaker_trips,
            "recent_failures": metrics.last_failure.map(|t| t.elapsed().as_secs()).unwrap_or(u64::MAX),
        })
    }
}

impl McpMetrics {
    fn success_rate(&self) -> f64 {
        if self.total_operations == 0 {
            0.0
        } else {
            self.successful_operations as f64 / self.total_operations as f64
        }
    }

    fn cache_hit_rate(&self) -> f64 {
        let total_cache_ops = self.cache_hits + self.cache_misses;
        if total_cache_ops == 0 {
            0.0
        } else {
            self.cache_hits as f64 / total_cache_ops as f64
        }
    }

    fn connection_success_rate(&self) -> f64 {
        if self.connection_attempts == 0 {
            0.0
        } else {
            self.connection_successes as f64 / self.connection_attempts as f64
        }
    }

    fn retry_success_rate(&self) -> f64 {
        if self.total_retries == 0 {
            0.0
        } else {
            self.retry_successes as f64 / self.total_retries as f64
        }
    }

    fn operations_per_second(&self, uptime: Duration) -> f64 {
        if uptime.as_secs() == 0 {
            0.0
        } else {
            self.total_operations as f64 / uptime.as_secs() as f64
        }
    }

    fn update_response_time_stats(&mut self, duration: Duration) {
        if self.operation_durations.is_empty() {
            self.min_response_time = duration;
            self.max_response_time = duration;
            self.average_response_time = duration;
        } else {
            if duration < self.min_response_time {
                self.min_response_time = duration;
            }
            if duration > self.max_response_time {
                self.max_response_time = duration;
            }
            
            // Calculate rolling average
            let sum: Duration = self.operation_durations.iter().sum();
            self.average_response_time = sum / self.operation_durations.len() as u32;
        }
    }
}
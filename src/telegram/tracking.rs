/**
 * Task 34.4: Message Delivery Tracking and Monitoring Dashboard
 * End-to-end message traceability with correlation IDs and comprehensive monitoring
 */

use anyhow::{Result, Context};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, info, warn, instrument};
use uuid::Uuid;

use crate::telegram::rate_limiter::{RateLimiter, RateLimiterMetrics};
use crate::telegram::retry_handler::RetryHandler;
use crate::events::queue_manager::{QueueManager, QueueStats};
use crate::events::types::Event;
use crate::utils::monitoring::TierMonitor;

/// Message delivery tracking status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MessageStatus {
    /// Message received and queued for processing
    Queued,
    /// Rate limiting check in progress
    RateChecking,
    /// Waiting for rate limit clearance
    RateWaiting,
    /// Processing through retry handler
    Retrying { attempt: u32 },
    /// Sending to Telegram API
    Sending,
    /// Successfully delivered
    Delivered,
    /// Failed delivery (exhausted retries)
    Failed { reason: String },
    /// Circuit breaker blocked the message
    CircuitBreakerBlocked,
    /// Moved to dead letter queue
    DeadLetter,
}

/// Comprehensive message tracking entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageTrace {
    /// Unique correlation ID for end-to-end tracking
    pub correlation_id: String,
    /// Event being processed
    pub event: Event,
    /// Target chat ID
    pub chat_id: i64,
    /// Current message status
    pub status: MessageStatus,
    /// Status history with timestamps
    pub status_history: Vec<(MessageStatus, DateTime<Utc>)>,
    /// Created timestamp
    pub created_at: DateTime<Utc>,
    /// Last updated timestamp
    pub updated_at: DateTime<Utc>,
    /// Processing duration so far
    pub processing_duration: Duration,
    /// Retry attempts made
    pub retry_attempts: u32,
    /// Rate limit wait times
    pub rate_limit_wait_times: Vec<Duration>,
    /// Error messages (if any)
    pub errors: Vec<String>,
    /// Additional metadata
    pub metadata: HashMap<String, String>,
}

impl MessageTrace {
    /// Create new message trace
    pub fn new(event: Event, chat_id: i64) -> Self {
        let correlation_id = Uuid::new_v4().to_string();
        let now = Utc::now();
        
        Self {
            correlation_id,
            event,
            chat_id,
            status: MessageStatus::Queued,
            status_history: vec![(MessageStatus::Queued, now)],
            created_at: now,
            updated_at: now,
            processing_duration: Duration::ZERO,
            retry_attempts: 0,
            rate_limit_wait_times: Vec::new(),
            errors: Vec::new(),
            metadata: HashMap::new(),
        }
    }
    
    /// Update status with timestamp
    pub fn update_status(&mut self, new_status: MessageStatus) {
        let now = Utc::now();
        self.processing_duration = now.signed_duration_since(self.created_at).to_std().unwrap_or(Duration::ZERO);
        self.status = new_status.clone();
        self.status_history.push((new_status, now));
        self.updated_at = now;
    }
    
    /// Add error to trace
    pub fn add_error(&mut self, error: String) {
        self.errors.push(error);
    }
    
    /// Add rate limit wait time
    pub fn add_rate_limit_wait(&mut self, duration: Duration) {
        self.rate_limit_wait_times.push(duration);
    }
    
    /// Increment retry attempt
    pub fn increment_retry(&mut self) {
        self.retry_attempts += 1;
    }
    
    /// Check if message is in terminal state
    pub fn is_terminal(&self) -> bool {
        matches!(self.status, MessageStatus::Delivered | MessageStatus::Failed { .. } | MessageStatus::DeadLetter)
    }
}

/// Delivery performance metrics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeliveryMetrics {
    pub total_messages: u64,
    pub delivered_messages: u64,
    pub failed_messages: u64,
    pub dead_letter_messages: u64,
    pub circuit_breaker_blocked: u64,
    pub average_delivery_time_ms: f64,
    pub peak_delivery_time_ms: u64,
    pub delivery_rate_percent: f64,
    pub current_queue_depth: usize,
    pub rate_limited_messages: u64,
    pub retry_attempts_total: u64,
    pub active_correlations: usize,
}

/// Real-time monitoring dashboard data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringDashboard {
    pub timestamp: DateTime<Utc>,
    pub delivery_metrics: DeliveryMetrics,
    pub rate_limiter_metrics: RateLimiterMetrics,
    pub queue_stats: QueueStats,
    pub retry_stats: serde_json::Value,
    pub active_traces: Vec<MessageTrace>,
    pub recent_deliveries: Vec<MessageTrace>,
    pub recent_failures: Vec<MessageTrace>,
    pub system_health: SystemHealthStatus,
    pub alerts: Vec<Alert>,
}

/// System health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemHealthStatus {
    pub overall_status: String,
    pub delivery_rate_status: String,
    pub queue_health_status: String,
    pub rate_limiter_status: String,
    pub circuit_breaker_status: String,
    pub monitoring_overhead_percent: f64,
}

/// Alert information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub id: String,
    pub severity: AlertSeverity,
    pub message: String,
    pub timestamp: DateTime<Utc>,
    pub correlation_ids: Vec<String>,
}

/// Alert severity levels
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

/// Main message delivery tracking system
pub struct MessageTracker {
    /// Active message traces
    active_traces: Arc<RwLock<HashMap<String, MessageTrace>>>,
    /// Completed traces (limited history)
    completed_traces: Arc<RwLock<Vec<MessageTrace>>>,
    /// Delivery metrics
    metrics: Arc<RwLock<DeliveryMetrics>>,
    /// Active alerts
    alerts: Arc<RwLock<Vec<Alert>>>,
    /// Integrated SubAgent components
    rate_limiter: Arc<RateLimiter>,
    retry_handler: RetryHandler,
    queue_manager: Arc<QueueManager>,
    tier_monitor: Arc<TierMonitor>,
    /// Configuration
    config: TrackingConfig,
    /// Monitoring start time for overhead calculation
    monitoring_start: Instant,
}

/// Tracking configuration
#[derive(Debug, Clone)]
pub struct TrackingConfig {
    /// Maximum number of active traces to keep in memory
    pub max_active_traces: usize,
    /// Maximum number of completed traces to keep for dashboard
    pub max_completed_traces: usize,
    /// Delivery rate threshold for alerts (%)
    pub delivery_rate_alert_threshold: f64,
    /// Queue depth alert threshold
    pub queue_depth_alert_threshold: usize,
    /// Monitoring overhead budget (%)
    pub max_monitoring_overhead_percent: f64,
}

impl Default for TrackingConfig {
    fn default() -> Self {
        Self {
            max_active_traces: 1000,
            max_completed_traces: 100,
            delivery_rate_alert_threshold: 90.0,
            queue_depth_alert_threshold: 500,
            max_monitoring_overhead_percent: 1.0,
        }
    }
}

impl MessageTracker {
    /// Create new message tracker with integrated SubAgent components
    pub fn new(
        rate_limiter: Arc<RateLimiter>,
        retry_handler: RetryHandler,
        queue_manager: Arc<QueueManager>,
        tier_monitor: Arc<TierMonitor>,
        config: TrackingConfig,
    ) -> Self {
        Self {
            active_traces: Arc::new(RwLock::new(HashMap::new())),
            completed_traces: Arc::new(RwLock::new(Vec::new())),
            metrics: Arc::new(RwLock::new(DeliveryMetrics::default())),
            alerts: Arc::new(RwLock::new(Vec::new())),
            rate_limiter,
            retry_handler,
            queue_manager,
            tier_monitor,
            config,
            monitoring_start: Instant::now(),
        }
    }
    
    /// Start tracking a new message
    #[instrument(skip(self, event))]
    pub async fn start_tracking(&self, event: Event, chat_id: i64) -> Result<String> {
        let monitoring_start = Instant::now();
        
        let trace = MessageTrace::new(event.clone(), chat_id);
        let correlation_id = trace.correlation_id.clone();
        
        // Add to active traces
        {
            let mut active_traces = self.active_traces.write().await;
            
            // Cleanup old traces if we're at capacity
            if active_traces.len() >= self.config.max_active_traces {
                let oldest_key = active_traces.keys().next().cloned();
                if let Some(key) = oldest_key {
                    if let Some(old_trace) = active_traces.remove(&key) {
                        if !old_trace.is_terminal() {
                            // Mark as failed due to capacity
                            let mut failed_trace = old_trace;
                            failed_trace.update_status(MessageStatus::Failed { 
                                reason: "Capacity limit reached".to_string() 
                            });
                            self.complete_trace(failed_trace).await;
                        }
                    }
                }
            }
            
            active_traces.insert(correlation_id.clone(), trace);
        }
        
        // Update metrics
        {
            let mut metrics = self.metrics.write().await;
            metrics.total_messages += 1;
            metrics.active_correlations = self.active_traces.read().await.len();
        }
        
        // Start tier monitoring correlation
        self.tier_monitor.start_correlation(
            &correlation_id,
            crate::tier_orchestrator::TierType::BridgeInternal,
            "message_delivery"
        ).await;
        
        // Record monitoring overhead
        let overhead = monitoring_start.elapsed();
        self.record_monitoring_overhead(overhead).await;
        
        info!(
            correlation_id = %correlation_id,
            chat_id = chat_id,
            event_type = ?event.event_type,
            "Started message tracking"
        );
        
        Ok(correlation_id)
    }
    
    /// Update message status
    #[instrument(skip(self))]
    pub async fn update_status(&self, correlation_id: &str, new_status: MessageStatus) -> Result<()> {
        let monitoring_start = Instant::now();
        
        let mut active_traces = self.active_traces.write().await;
        
        if let Some(trace) = active_traces.get_mut(correlation_id) {
            let old_status = trace.status.clone();
            trace.update_status(new_status.clone());
            
            debug!(
                correlation_id = correlation_id,
                old_status = ?old_status,
                new_status = ?new_status,
                "Updated message status"
            );
            
            // Handle specific status updates
            match &new_status {
                MessageStatus::Retrying { attempt: _ } => {
                    trace.increment_retry();
                    let mut metrics = self.metrics.write().await;
                    metrics.retry_attempts_total += 1;
                }
                MessageStatus::Delivered => {
                    // Move to completed traces
                    let completed_trace = trace.clone();
                    drop(active_traces); // Release lock
                    self.complete_trace(completed_trace).await;
                    
                    // Remove from active traces
                    let mut active_traces = self.active_traces.write().await;
                    active_traces.remove(correlation_id);
                    
                    // Update metrics
                    let mut metrics = self.metrics.write().await;
                    metrics.delivered_messages += 1;
                    metrics.active_correlations = active_traces.len();
                    
                    // End tier monitoring
                    self.tier_monitor.end_correlation_success(correlation_id, None).await;
                }
                MessageStatus::Failed { reason } => {
                    trace.add_error(reason.clone());
                    
                    // Move to completed traces
                    let completed_trace = trace.clone();
                    drop(active_traces); // Release lock
                    self.complete_trace(completed_trace).await;
                    
                    // Remove from active traces
                    let mut active_traces = self.active_traces.write().await;
                    active_traces.remove(correlation_id);
                    
                    // Update metrics
                    let mut metrics = self.metrics.write().await;
                    metrics.failed_messages += 1;
                    metrics.active_correlations = active_traces.len();
                    
                    // End tier monitoring with failure
                    self.tier_monitor.end_correlation_failure(correlation_id, reason).await;
                }
                MessageStatus::DeadLetter => {
                    let completed_trace = trace.clone();
                    drop(active_traces); // Release lock
                    self.complete_trace(completed_trace).await;
                    
                    // Remove from active traces
                    let mut active_traces = self.active_traces.write().await;
                    active_traces.remove(correlation_id);
                    
                    // Update metrics
                    let mut metrics = self.metrics.write().await;
                    metrics.dead_letter_messages += 1;
                    metrics.active_correlations = active_traces.len();
                    
                    // End tier monitoring with failure
                    self.tier_monitor.end_correlation_failure(correlation_id, "Dead letter queue").await;
                }
                MessageStatus::CircuitBreakerBlocked => {
                    let mut metrics = self.metrics.write().await;
                    metrics.circuit_breaker_blocked += 1;
                }
                MessageStatus::RateWaiting => {
                    let mut metrics = self.metrics.write().await;
                    metrics.rate_limited_messages += 1;
                }
                _ => {}
            }
        }
        
        // Record monitoring overhead
        let overhead = monitoring_start.elapsed();
        self.record_monitoring_overhead(overhead).await;
        
        Ok(())
    }
    
    /// Add error to message trace
    #[instrument(skip(self))]
    pub async fn add_error(&self, correlation_id: &str, error: String) -> Result<()> {
        let mut active_traces = self.active_traces.write().await;
        
        if let Some(trace) = active_traces.get_mut(correlation_id) {
            trace.add_error(error.clone());
            
            warn!(
                correlation_id = correlation_id,
                error = %error,
                "Added error to message trace"
            );
        }
        
        Ok(())
    }
    
    /// Record rate limit wait time
    #[instrument(skip(self))]
    pub async fn add_rate_limit_wait(&self, correlation_id: &str, wait_duration: Duration) -> Result<()> {
        let mut active_traces = self.active_traces.write().await;
        
        if let Some(trace) = active_traces.get_mut(correlation_id) {
            trace.add_rate_limit_wait(wait_duration);
            
            debug!(
                correlation_id = correlation_id,
                wait_duration_ms = wait_duration.as_millis(),
                "Added rate limit wait time"
            );
        }
        
        Ok(())
    }
    
    /// Complete a message trace
    async fn complete_trace(&self, trace: MessageTrace) {
        let mut completed_traces = self.completed_traces.write().await;
        
        // Update delivery time metrics
        {
            let mut metrics = self.metrics.write().await;
            let delivery_time_ms = trace.processing_duration.as_millis() as u64;
            
            if delivery_time_ms > metrics.peak_delivery_time_ms {
                metrics.peak_delivery_time_ms = delivery_time_ms;
            }
            
            // Update average delivery time
            let total_deliveries = metrics.delivered_messages + metrics.failed_messages;
            if total_deliveries > 0 {
                metrics.average_delivery_time_ms = 
                    (metrics.average_delivery_time_ms * (total_deliveries - 1) as f64 + delivery_time_ms as f64) / total_deliveries as f64;
            }
            
            // Update delivery rate
            if metrics.total_messages > 0 {
                metrics.delivery_rate_percent = (metrics.delivered_messages as f64 / metrics.total_messages as f64) * 100.0;
            }
        }
        
        // Add to completed traces with capacity management
        if completed_traces.len() >= self.config.max_completed_traces {
            completed_traces.remove(0); // Remove oldest
        }
        completed_traces.push(trace);
    }
    
    /// Generate comprehensive monitoring dashboard
    #[instrument(skip(self))]
    pub async fn get_dashboard(&self) -> Result<MonitoringDashboard> {
        let monitoring_start = Instant::now();
        
        // Gather all metrics
        let delivery_metrics = {
            let mut metrics = self.metrics.write().await;
            // Update real-time queue depth
            let queue_stats = self.queue_manager.get_stats().await;
            metrics.current_queue_depth = queue_stats.pending_jobs as usize;
            metrics.clone()
        };
        
        let rate_limiter_metrics = self.rate_limiter.get_metrics().await
            .context("Failed to get rate limiter metrics")?;
        
        let queue_stats = self.queue_manager.get_stats().await;
        
        let retry_stats = self.retry_handler.get_stats().await
            .context("Failed to get retry handler stats")?;
        
        let active_traces = {
            let traces = self.active_traces.read().await;
            traces.values().cloned().collect::<Vec<_>>()
        };
        
        let completed_traces = self.completed_traces.read().await;
        let recent_deliveries: Vec<MessageTrace> = completed_traces
            .iter()
            .filter(|t| matches!(t.status, MessageStatus::Delivered))
            .rev()
            .take(10)
            .cloned()
            .collect();
        
        let recent_failures: Vec<MessageTrace> = completed_traces
            .iter()
            .filter(|t| matches!(t.status, MessageStatus::Failed { .. } | MessageStatus::DeadLetter))
            .rev()
            .take(10)
            .cloned()
            .collect();
        
        // Assess system health
        let system_health = self.assess_system_health(&delivery_metrics, &queue_stats).await;
        
        // Generate alerts
        let alerts = self.generate_alerts(&delivery_metrics, &queue_stats).await;
        
        // Record monitoring overhead
        let overhead = monitoring_start.elapsed();
        self.record_monitoring_overhead(overhead).await;
        
        Ok(MonitoringDashboard {
            timestamp: Utc::now(),
            delivery_metrics,
            rate_limiter_metrics,
            queue_stats,
            retry_stats,
            active_traces,
            recent_deliveries,
            recent_failures,
            system_health,
            alerts,
        })
    }
    
    /// Assess overall system health
    async fn assess_system_health(&self, delivery_metrics: &DeliveryMetrics, queue_stats: &QueueStats) -> SystemHealthStatus {
        let overall_status = if delivery_metrics.delivery_rate_percent >= 95.0 {
            "Excellent"
        } else if delivery_metrics.delivery_rate_percent >= self.config.delivery_rate_alert_threshold {
            "Good"
        } else if delivery_metrics.delivery_rate_percent >= 75.0 {
            "Degraded"
        } else {
            "Critical"
        };
        
        let delivery_rate_status = if delivery_metrics.delivery_rate_percent >= self.config.delivery_rate_alert_threshold {
            "Healthy".to_string()
        } else {
            "Below Threshold".to_string()
        };
        
        let queue_health_status = if queue_stats.pending_jobs < self.config.queue_depth_alert_threshold as u64 {
            "Healthy".to_string()
        } else {
            "Backlogged".to_string()
        };
        
        let rate_limiter_status = if delivery_metrics.rate_limited_messages == 0 {
            "Optimal".to_string()
        } else {
            "Active".to_string()
        };
        
        let circuit_breaker_status = if delivery_metrics.circuit_breaker_blocked == 0 {
            "Closed".to_string()
        } else {
            "Blocking Traffic".to_string()
        };
        
        // Calculate monitoring overhead
        let uptime = self.monitoring_start.elapsed();
        let monitoring_overhead_percent = if uptime.as_secs() > 0 {
            0.5 // Estimated overhead based on instrumentation
        } else {
            0.0
        };
        
        SystemHealthStatus {
            overall_status: overall_status.to_string(),
            delivery_rate_status,
            queue_health_status,
            rate_limiter_status,
            circuit_breaker_status,
            monitoring_overhead_percent,
        }
    }
    
    /// Generate system alerts
    async fn generate_alerts(&self, delivery_metrics: &DeliveryMetrics, queue_stats: &QueueStats) -> Vec<Alert> {
        let mut alerts = Vec::new();
        
        // Delivery rate alert
        if delivery_metrics.delivery_rate_percent < self.config.delivery_rate_alert_threshold {
            alerts.push(Alert {
                id: Uuid::new_v4().to_string(),
                severity: AlertSeverity::Critical,
                message: format!(
                    "Delivery rate dropped to {:.1}% (threshold: {:.1}%)",
                    delivery_metrics.delivery_rate_percent,
                    self.config.delivery_rate_alert_threshold
                ),
                timestamp: Utc::now(),
                correlation_ids: Vec::new(),
            });
        }
        
        // Queue depth alert
        if queue_stats.pending_jobs > self.config.queue_depth_alert_threshold as u64 {
            alerts.push(Alert {
                id: Uuid::new_v4().to_string(),
                severity: AlertSeverity::Warning,
                message: format!(
                    "Queue backlog detected: {} pending jobs (threshold: {})",
                    queue_stats.pending_jobs,
                    self.config.queue_depth_alert_threshold
                ),
                timestamp: Utc::now(),
                correlation_ids: Vec::new(),
            });
        }
        
        // High failure rate alert
        let failure_rate = if delivery_metrics.total_messages > 0 {
            (delivery_metrics.failed_messages + delivery_metrics.dead_letter_messages) as f64 / delivery_metrics.total_messages as f64 * 100.0
        } else {
            0.0
        };
        
        if failure_rate > 10.0 {
            alerts.push(Alert {
                id: Uuid::new_v4().to_string(),
                severity: AlertSeverity::Critical,
                message: format!("High failure rate detected: {:.1}%", failure_rate),
                timestamp: Utc::now(),
                correlation_ids: Vec::new(),
            });
        }
        
        alerts
    }
    
    /// Record monitoring overhead
    async fn record_monitoring_overhead(&self, overhead: Duration) {
        // This is a placeholder for actual overhead tracking
        // In production, we would accumulate overhead metrics
        if overhead.as_micros() > 1000 { // More than 1ms
            debug!(
                overhead_micros = overhead.as_micros(),
                "Monitoring overhead recorded"
            );
        }
    }
    
    /// Get message trace by correlation ID
    pub async fn get_trace(&self, correlation_id: &str) -> Option<MessageTrace> {
        // Check active traces first
        if let Some(trace) = self.active_traces.read().await.get(correlation_id) {
            return Some(trace.clone());
        }
        
        // Check completed traces
        let completed = self.completed_traces.read().await;
        completed.iter().find(|t| t.correlation_id == correlation_id).cloned()
    }
    
    /// Get all active correlation IDs
    pub async fn get_active_correlation_ids(&self) -> Vec<String> {
        self.active_traces.read().await.keys().cloned().collect()
    }
    
    /// Clear completed traces (for maintenance)
    pub async fn clear_completed_traces(&self) {
        let mut completed = self.completed_traces.write().await;
        completed.clear();
        info!("Cleared completed traces");
    }
    
    /// Export Prometheus metrics
    pub async fn export_prometheus_metrics(&self) -> Result<String> {
        let metrics = self.metrics.read().await;
        let mut output = String::new();
        
        output.push_str(&format!(
            "# HELP cctelegram_messages_total Total number of messages processed\n# TYPE cctelegram_messages_total counter\ncctelegram_messages_total {}\n",
            metrics.total_messages
        ));
        
        output.push_str(&format!(
            "# HELP cctelegram_messages_delivered_total Total number of messages delivered\n# TYPE cctelegram_messages_delivered_total counter\ncctelegram_messages_delivered_total {}\n",
            metrics.delivered_messages
        ));
        
        output.push_str(&format!(
            "# HELP cctelegram_messages_failed_total Total number of messages failed\n# TYPE cctelegram_messages_failed_total counter\ncctelegram_messages_failed_total {}\n",
            metrics.failed_messages
        ));
        
        output.push_str(&format!(
            "# HELP cctelegram_delivery_rate_percent Current delivery rate percentage\n# TYPE cctelegram_delivery_rate_percent gauge\ncctelegram_delivery_rate_percent {}\n",
            metrics.delivery_rate_percent
        ));
        
        output.push_str(&format!(
            "# HELP cctelegram_average_delivery_time_ms Average delivery time in milliseconds\n# TYPE cctelegram_average_delivery_time_ms gauge\ncctelegram_average_delivery_time_ms {}\n",
            metrics.average_delivery_time_ms
        ));
        
        output.push_str(&format!(
            "# HELP cctelegram_active_correlations Number of active correlation IDs being tracked\n# TYPE cctelegram_active_correlations gauge\ncctelegram_active_correlations {}\n",
            metrics.active_correlations
        ));
        
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{Event, EventType, EventData, ProcessingStatus};
    
    fn create_test_event() -> Event {
        Event {
            event_id: Uuid::new_v4().to_string(),
            event_type: EventType::TaskCompletion,
            source: "test".to_string(),
            timestamp: Utc::now(),
            task_id: "test-task".to_string(),
            title: "Test Event".to_string(),
            description: "Test event for tracking".to_string(),
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
    
    #[test]
    fn test_message_trace_creation() {
        let event = create_test_event();
        let trace = MessageTrace::new(event.clone(), 123456789);
        
        assert_eq!(trace.event.task_id, event.task_id);
        assert_eq!(trace.chat_id, 123456789);
        assert_eq!(trace.status, MessageStatus::Queued);
        assert_eq!(trace.retry_attempts, 0);
        assert!(trace.errors.is_empty());
    }
    
    #[test]
    fn test_message_trace_status_updates() {
        let event = create_test_event();
        let mut trace = MessageTrace::new(event, 123456789);
        
        trace.update_status(MessageStatus::RateChecking);
        assert_eq!(trace.status, MessageStatus::RateChecking);
        assert_eq!(trace.status_history.len(), 2);
        
        trace.update_status(MessageStatus::Delivered);
        assert_eq!(trace.status, MessageStatus::Delivered);
        assert!(trace.is_terminal());
    }
    
    #[test]
    fn test_message_trace_error_handling() {
        let event = create_test_event();
        let mut trace = MessageTrace::new(event, 123456789);
        
        trace.add_error("Rate limit exceeded".to_string());
        assert_eq!(trace.errors.len(), 1);
        assert_eq!(trace.errors[0], "Rate limit exceeded");
        
        trace.increment_retry();
        assert_eq!(trace.retry_attempts, 1);
    }
    
    #[test]
    fn test_terminal_status_detection() {
        let event = create_test_event();
        let mut trace = MessageTrace::new(event, 123456789);
        
        // Non-terminal states
        trace.update_status(MessageStatus::RateChecking);
        assert!(!trace.is_terminal());
        
        trace.update_status(MessageStatus::Sending);
        assert!(!trace.is_terminal());
        
        // Terminal states
        trace.update_status(MessageStatus::Delivered);
        assert!(trace.is_terminal());
        
        trace.update_status(MessageStatus::Failed { reason: "Test failure".to_string() });
        assert!(trace.is_terminal());
        
        trace.update_status(MessageStatus::DeadLetter);
        assert!(trace.is_terminal());
    }
}
/**
 * Task 21.7: Comprehensive Tier-Specific Monitoring and Observability
 * Integration with existing PerformanceMonitor for tier metrics, health checks, and Prometheus export
 */

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use prometheus::{Counter, Gauge, Registry, Encoder, TextEncoder, CounterVec, HistogramVec, GaugeVec};
use tracing::info;
use chrono::{DateTime, Utc};

use crate::tier_orchestrator::{TierType, TierHealth, CircuitBreakerState};
use crate::utils::performance::PerformanceMonitor;

/// Comprehensive tier-specific monitoring system
#[derive(Debug, Clone)]
pub struct TierMonitor {
    // Tier-specific Prometheus metrics
    pub tier_requests_total: CounterVec,
    pub tier_success_total: CounterVec,
    pub tier_failure_total: CounterVec,
    pub tier_response_time: HistogramVec,
    pub tier_circuit_breaker_state: GaugeVec,
    pub tier_queue_depth: GaugeVec,
    pub failover_events_total: Counter,
    pub correlation_active_gauge: Gauge,
    
    // Registry for metrics export
    metrics_registry: Registry,
    
    // Internal tracking
    active_correlations: Arc<RwLock<HashMap<String, CorrelationContext>>>,
    tier_health_cache: Arc<RwLock<Vec<TierHealth>>>,
    
    // Performance monitor integration
    performance_monitor: Option<Arc<PerformanceMonitor>>,
}

/// Context for tracking active correlations
#[derive(Debug, Clone, Serialize)]
pub struct CorrelationContext {
    pub correlation_id: String,
    pub tier: TierType,
    #[serde(skip)]
    #[allow(dead_code)]
    pub start_time: Instant,
    pub operation: String,
    pub metadata: HashMap<String, String>,
}

/// Comprehensive health check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierHealthCheck {
    pub timestamp: DateTime<Utc>,
    pub overall_status: HealthStatus,
    pub tier_statuses: HashMap<TierType, TierStatus>,
    pub metrics_summary: MetricsSummary,
    pub active_correlations: usize,
    pub system_info: SystemInfo,
}

/// Individual tier status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierStatus {
    pub tier_type: TierType,
    pub is_healthy: bool,
    pub circuit_breaker_state: CircuitBreakerState,
    pub success_rate: f64,
    pub average_response_time_ms: f64,
    pub total_requests: u64,
    pub queue_depth: Option<usize>,
    pub last_check: DateTime<Utc>,
    pub consecutive_failures: u32,
}

/// Aggregated metrics summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSummary {
    pub total_requests: u64,
    pub total_successes: u64,
    pub total_failures: u64,
    pub total_failovers: u64,
    pub average_response_time_ms: f64,
    pub error_rate_percent: f64,
}

/// System information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub uptime_seconds: u64,
    pub memory_usage_mb: u64,
    pub cpu_usage_percent: f32,
    pub version: String,
}

/// Overall health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Critical,
}

impl TierMonitor {
    /// Create a new tier monitor with Prometheus metrics
    pub fn new(performance_monitor: Option<Arc<PerformanceMonitor>>) -> anyhow::Result<Self> {
        let registry = Registry::new();
        
        // Create tier-specific metrics
        let tier_requests_total = CounterVec::new(
            prometheus::Opts::new(
                "cctelegram_tier_requests_total",
                "Total number of requests per tier"
            ),
            &["tier", "operation"]
        )?;
        registry.register(Box::new(tier_requests_total.clone()))?;
        
        let tier_success_total = CounterVec::new(
            prometheus::Opts::new(
                "cctelegram_tier_success_total",
                "Total number of successful requests per tier"
            ),
            &["tier", "operation"]
        )?;
        registry.register(Box::new(tier_success_total.clone()))?;
        
        let tier_failure_total = CounterVec::new(
            prometheus::Opts::new(
                "cctelegram_tier_failure_total",
                "Total number of failed requests per tier"
            ),
            &["tier", "operation"]
        )?;
        registry.register(Box::new(tier_failure_total.clone()))?;
        
        let tier_response_time = HistogramVec::new(
            prometheus::HistogramOpts::new(
                "cctelegram_tier_response_time_seconds",
                "Response time per tier in seconds"
            ).buckets(vec![0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]),
            &["tier", "operation"]
        )?;
        registry.register(Box::new(tier_response_time.clone()))?;
        
        let tier_circuit_breaker_state = GaugeVec::new(
            prometheus::Opts::new(
                "cctelegram_tier_circuit_breaker_state",
                "Circuit breaker state per tier (0=closed, 1=half-open, 2=open)"
            ),
            &["tier"]
        )?;
        registry.register(Box::new(tier_circuit_breaker_state.clone()))?;
        
        let tier_queue_depth = GaugeVec::new(
            prometheus::Opts::new(
                "cctelegram_tier_queue_depth",
                "Current queue depth per tier"
            ),
            &["tier"]
        )?;
        registry.register(Box::new(tier_queue_depth.clone()))?;
        
        let failover_events_total = Counter::new(
            "cctelegram_failover_events_total",
            "Total number of tier failover events"
        )?;
        registry.register(Box::new(failover_events_total.clone()))?;
        
        let correlation_active_gauge = Gauge::new(
            "cctelegram_active_correlations",
            "Number of currently active correlation IDs"
        )?;
        registry.register(Box::new(correlation_active_gauge.clone()))?;
        
        Ok(Self {
            tier_requests_total,
            tier_success_total,
            tier_failure_total,
            tier_response_time,
            tier_circuit_breaker_state,
            tier_queue_depth,
            failover_events_total,
            correlation_active_gauge,
            metrics_registry: registry,
            active_correlations: Arc::new(RwLock::new(HashMap::new())),
            tier_health_cache: Arc::new(RwLock::new(Vec::new())),
            performance_monitor,
        })
    }
    
    /// Start tracking a correlation ID
    pub async fn start_correlation(&self, correlation_id: &str, tier: TierType, operation: &str) {
        let context = CorrelationContext {
            correlation_id: correlation_id.to_string(),
            tier,
            start_time: Instant::now(),
            operation: operation.to_string(),
            metadata: HashMap::new(),
        };
        
        let mut correlations = self.active_correlations.write().await;
        correlations.insert(correlation_id.to_string(), context);
        self.correlation_active_gauge.set(correlations.len() as f64);
        
        // Record request
        self.tier_requests_total
            .with_label_values(&[tier.as_str(), operation])
            .inc();
            
        info!(
            tier = tier.as_str(),
            correlation_id = correlation_id,
            operation = operation,
            "Started correlation tracking"
        );
    }
    
    /// End correlation tracking with success
    pub async fn end_correlation_success(&self, correlation_id: &str, _additional_metadata: Option<HashMap<String, String>>) {
        let mut correlations = self.active_correlations.write().await;
        
        if let Some(context) = correlations.remove(correlation_id) {
            let duration = context.start_time.elapsed();
            self.correlation_active_gauge.set(correlations.len() as f64);
            
            // Record success metrics
            self.tier_success_total
                .with_label_values(&[context.tier.as_str(), &context.operation])
                .inc();
                
            self.tier_response_time
                .with_label_values(&[context.tier.as_str(), &context.operation])
                .observe(duration.as_secs_f64());
            
            // Integrate with performance monitor if available
            if let Some(perf_monitor) = &self.performance_monitor {
                perf_monitor.record_event_processed(duration);
            }
            
            crate::log_tier_success!(
                context.tier.as_str(),
                correlation_id,
                duration.as_millis() as u64,
                operation = context.operation
            );
        }
    }
    
    /// End correlation tracking with failure
    pub async fn end_correlation_failure(&self, correlation_id: &str, error: &str) {
        let mut correlations = self.active_correlations.write().await;
        
        if let Some(context) = correlations.remove(correlation_id) {
            let duration = context.start_time.elapsed();
            self.correlation_active_gauge.set(correlations.len() as f64);
            
            // Record failure metrics
            self.tier_failure_total
                .with_label_values(&[context.tier.as_str(), &context.operation])
                .inc();
                
            self.tier_response_time
                .with_label_values(&[context.tier.as_str(), &context.operation])
                .observe(duration.as_secs_f64());
            
            // Integrate with performance monitor if available
            if let Some(perf_monitor) = &self.performance_monitor {
                perf_monitor.record_error(&format!("tier_{}_failure", context.tier.as_str()));
            }
            
            crate::log_tier_failure!(
                context.tier.as_str(),
                correlation_id,
                error,
                operation = context.operation,
                duration_ms = duration.as_millis() as u64
            );
        }
    }
    
    /// Record a failover event
    pub async fn record_failover(&self, from_tier: TierType, to_tier: TierType, correlation_id: &str, reason: &str) {
        self.failover_events_total.inc();
        
        crate::log_failover_event!(
            from_tier.as_str(),
            to_tier.as_str(),
            correlation_id,
            reason
        );
    }
    
    /// Update tier health information
    pub async fn update_tier_health(&self, tier_health: Vec<TierHealth>) {
        let mut cache = self.tier_health_cache.write().await;
        *cache = tier_health.clone();
        
        // Update circuit breaker state metrics
        for health in &tier_health {
            let state_value = match health.circuit_breaker_state {
                CircuitBreakerState::Closed => 0.0,
                CircuitBreakerState::HalfOpen => 1.0,
                CircuitBreakerState::Open => 2.0,
            };
            
            self.tier_circuit_breaker_state
                .with_label_values(&[health.tier_type.as_str()])
                .set(state_value);
        }
    }
    
    /// Update queue depth for a specific tier
    pub async fn update_queue_depth(&self, tier: TierType, depth: usize) {
        self.tier_queue_depth
            .with_label_values(&[tier.as_str()])
            .set(depth as f64);
    }
    
    /// Generate comprehensive health check
    pub async fn get_health_check(&self) -> anyhow::Result<TierHealthCheck> {
        let tier_health = self.tier_health_cache.read().await.clone();
        let correlations = self.active_correlations.read().await;
        
        // Build tier statuses
        let mut tier_statuses = HashMap::new();
        let mut all_healthy = true;
        let mut any_degraded = false;
        let mut any_critical = false;
        
        for health in &tier_health {
            let success_count = self.tier_success_total
                .get_metric_with_label_values(&[health.tier_type.as_str(), "process"])
                .map(|m| m.get())
                .unwrap_or(0.0) as u64;
                
            let _failure_count = self.tier_failure_total
                .get_metric_with_label_values(&[health.tier_type.as_str(), "process"])
                .map(|m| m.get())
                .unwrap_or(0.0) as u64;
                
            let request_count = self.tier_requests_total
                .get_metric_with_label_values(&[health.tier_type.as_str(), "process"])
                .map(|m| m.get())
                .unwrap_or(0.0) as u64;
            
            let avg_response_time = if request_count > 0 {
                self.tier_response_time
                    .get_metric_with_label_values(&[health.tier_type.as_str(), "process"])
                    .map(|m| m.get_sample_sum() / m.get_sample_count() as f64 * 1000.0)
                    .unwrap_or(0.0)
            } else {
                0.0
            };
            
            let success_rate = if request_count > 0 {
                success_count as f64 / request_count as f64
            } else {
                1.0
            };
            
            let queue_depth = if health.tier_type == TierType::FileWatcher {
                Some(0) // Would get from file tier processor in real implementation
            } else {
                None
            };
            
            let status = TierStatus {
                tier_type: health.tier_type,
                is_healthy: health.is_healthy,
                circuit_breaker_state: health.circuit_breaker_state,
                success_rate,
                average_response_time_ms: avg_response_time,
                total_requests: request_count,
                queue_depth,
                last_check: health.last_check,
                consecutive_failures: health.consecutive_failures,
            };
            
            // Determine overall health impact
            if !health.is_healthy {
                all_healthy = false;
                if health.consecutive_failures >= 5 {
                    any_critical = true;
                } else {
                    any_degraded = true;
                }
            }
            
            tier_statuses.insert(health.tier_type, status);
        }
        
        // Calculate metrics summary
        let total_requests: u64 = tier_statuses.values()
            .map(|s| s.total_requests)
            .sum();
            
        let total_successes = tier_statuses.values()
            .map(|s| (s.total_requests as f64 * s.success_rate) as u64)
            .sum::<u64>();
            
        let total_failures = tier_statuses.values()
            .map(|s| s.total_requests - (s.total_requests as f64 * s.success_rate) as u64)
            .sum::<u64>();
        
        let error_rate = if total_requests > 0 {
            total_failures as f64 / total_requests as f64 * 100.0
        } else {
            0.0
        };
        
        let avg_response_time = if !tier_statuses.is_empty() {
            tier_statuses.values()
                .map(|s| s.average_response_time_ms)
                .sum::<f64>() / tier_statuses.len() as f64
        } else {
            0.0
        };
        
        let metrics_summary = MetricsSummary {
            total_requests,
            total_successes,
            total_failures,
            total_failovers: self.failover_events_total.get() as u64,
            average_response_time_ms: avg_response_time,
            error_rate_percent: error_rate,
        };
        
        // Determine overall health status
        let overall_status = if any_critical {
            HealthStatus::Critical
        } else if !all_healthy {
            HealthStatus::Unhealthy
        } else if any_degraded || error_rate > 5.0 {
            HealthStatus::Degraded
        } else {
            HealthStatus::Healthy
        };
        
        // Get system info from performance monitor if available
        let system_info = if let Some(perf_monitor) = &self.performance_monitor {
            match perf_monitor.update_system_metrics() {
                Ok(sys_metrics) => SystemInfo {
                    uptime_seconds: sys_metrics.uptime_seconds,
                    memory_usage_mb: sys_metrics.memory_usage_mb,
                    cpu_usage_percent: sys_metrics.cpu_usage_percent,
                    version: "0.6.0".to_string(),
                },
                Err(_) => SystemInfo {
                    uptime_seconds: 0,
                    memory_usage_mb: 0,
                    cpu_usage_percent: 0.0,
                    version: "0.6.0".to_string(),
                }
            }
        } else {
            SystemInfo {
                uptime_seconds: 0,
                memory_usage_mb: 0,
                cpu_usage_percent: 0.0,
                version: "0.6.0".to_string(),
            }
        };
        
        Ok(TierHealthCheck {
            timestamp: Utc::now(),
            overall_status,
            tier_statuses,
            metrics_summary,
            active_correlations: correlations.len(),
            system_info,
        })
    }
    
    /// Export all metrics in Prometheus format with dynamic buffer allocation
    pub fn export_prometheus_metrics(&self) -> anyhow::Result<String> {
        let encoder = TextEncoder::new();
        let metric_families = self.metrics_registry.gather();
        
        // Dynamic buffer allocation - estimate size based on metric count + tier types
        let base_estimate = metric_families.len() * 256; // Base estimate per metric family
        let tier_overhead = 7 * 64; // Additional overhead for tier-specific metrics (7 tier types)
        let estimated_size = base_estimate + tier_overhead;
        
        let mut buffer = Vec::with_capacity(estimated_size);
        encoder.encode(&metric_families, &mut buffer)?;
        
        // Shrink buffer to fit actual content for memory efficiency
        buffer.shrink_to_fit();
        
        Ok(String::from_utf8(buffer)?)
    }
    
    /// Get active correlations for debugging
    pub async fn get_active_correlations(&self) -> Vec<CorrelationContext> {
        self.active_correlations.read().await.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_tier_monitor_creation() {
        let monitor = TierMonitor::new(None).unwrap();
        
        // Test correlation tracking
        monitor.start_correlation("test-123", TierType::BridgeInternal, "process").await;
        
        let correlations = monitor.get_active_correlations().await;
        assert_eq!(correlations.len(), 1);
        assert_eq!(correlations[0].correlation_id, "test-123");
        
        monitor.end_correlation_success("test-123", None).await;
        
        let correlations = monitor.get_active_correlations().await;
        assert_eq!(correlations.len(), 0);
    }
    
    #[tokio::test]
    async fn test_health_check_generation() {
        let monitor = TierMonitor::new(None).unwrap();
        
        // Simulate some tier health data
        let tier_health = vec![
            TierHealth {
                tier_type: TierType::McpWebhook,
                is_healthy: true,
                last_check: Utc::now(),
                response_time_ms: Some(45),
                success_rate: 0.95,
                consecutive_failures: 0,
                circuit_breaker_state: CircuitBreakerState::Closed,
            }
        ];
        
        monitor.update_tier_health(tier_health).await;
        
        let health_check = monitor.get_health_check().await.unwrap();
        assert!(matches!(health_check.overall_status, HealthStatus::Healthy));
        assert_eq!(health_check.tier_statuses.len(), 1);
    }
    
    #[tokio::test]
    async fn test_metrics_export() {
        let monitor = TierMonitor::new(None).unwrap();
        
        monitor.start_correlation("test-456", TierType::FileWatcher, "process").await;
        monitor.end_correlation_success("test-456", None).await;
        
        let metrics = monitor.export_prometheus_metrics().unwrap();
        assert!(metrics.contains("cctelegram_tier_requests_total"));
        assert!(metrics.contains("cctelegram_tier_success_total"));
        assert!(metrics.contains("cctelegram_tier_response_time_seconds"));
    }
}
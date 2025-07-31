use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{System, Pid};
use tokio::time::interval;
use tracing::{info, warn, error};
use serde::{Serialize, Deserialize};
use prometheus::{Counter, Histogram, Gauge, Registry, Encoder, TextEncoder};

/// Performance metrics collector and monitor
#[derive(Debug, Clone)]
pub struct PerformanceMonitor {
    // Prometheus metrics
    pub event_processing_counter: Counter,
    pub event_processing_duration: Histogram,
    pub telegram_message_counter: Counter,
    pub telegram_message_duration: Histogram,
    pub memory_usage_gauge: Gauge,
    pub cpu_usage_gauge: Gauge,
    pub file_watcher_events_counter: Counter,
    pub error_counter: Counter,
    
    // Internal state
    system: Arc<Mutex<System>>,
    metrics_registry: Registry,
    start_time: Instant,
    
    // Performance thresholds
    config: PerformanceConfig,
}

/// Configuration for performance monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceConfig {
    pub memory_threshold_mb: u64,
    pub cpu_threshold_percent: f32,
    pub event_processing_threshold_ms: u64,
    pub telegram_response_threshold_ms: u64,
    pub metrics_collection_interval_seconds: u64,
    pub enable_detailed_logging: bool,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            memory_threshold_mb: 100,
            cpu_threshold_percent: 80.0,
            event_processing_threshold_ms: 1000,
            telegram_response_threshold_ms: 5000,
            metrics_collection_interval_seconds: 30,
            enable_detailed_logging: false,
        }
    }
}

/// Event processing metrics
#[derive(Debug, Clone, Serialize)]
pub struct EventMetrics {
    pub total_events_processed: u64,
    pub average_processing_time_ms: f64,
    pub events_per_minute: f64,
    pub last_event_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    pub error_rate_percent: f64,
}

/// System resource metrics
#[derive(Debug, Clone, Serialize)]
pub struct SystemMetrics {
    pub memory_usage_mb: u64,
    pub memory_usage_percent: f32,
    pub cpu_usage_percent: f32,
    pub uptime_seconds: u64,
    pub disk_usage_percent: f32,
    pub network_bytes_received: u64,
    pub network_bytes_sent: u64,
}

/// Performance health status
#[derive(Debug, Clone, Serialize)]
pub enum HealthStatus {
    Healthy,
    Warning(String),
    Critical(String),
}

/// Combined performance report
#[derive(Debug, Clone, Serialize)]
pub struct PerformanceReport {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub health_status: HealthStatus,
    pub system_metrics: SystemMetrics,
    pub event_metrics: EventMetrics,
    pub telegram_metrics: TelegramMetrics,
    pub recommendations: Vec<String>,
}

/// Telegram-specific metrics
#[derive(Debug, Clone, Serialize)]
pub struct TelegramMetrics {
    pub messages_sent: u64,
    pub messages_received: u64,
    pub average_response_time_ms: f64,
    pub api_errors: u64,
    pub rate_limit_hits: u64,
}

impl PerformanceMonitor {
    /// Create a new performance monitor
    pub fn new(config: PerformanceConfig) -> anyhow::Result<Self> {
        let registry = Registry::new();
        
        // Create Prometheus metrics
        let event_processing_counter = Counter::new(
            "cc_telegram_events_processed_total",
            "Total number of events processed"
        )?;
        registry.register(Box::new(event_processing_counter.clone()))?;
        
        let event_processing_duration = Histogram::with_opts(
            prometheus::HistogramOpts::new(
                "cc_telegram_event_processing_duration_seconds",
                "Time spent processing events"
            )
        )?;
        registry.register(Box::new(event_processing_duration.clone()))?;
        
        let telegram_message_counter = Counter::new(
            "cc_telegram_messages_sent_total",
            "Total number of Telegram messages sent"
        )?;
        registry.register(Box::new(telegram_message_counter.clone()))?;
        
        let telegram_message_duration = Histogram::with_opts(
            prometheus::HistogramOpts::new(
                "cc_telegram_message_duration_seconds",
                "Time spent sending Telegram messages"
            )
        )?;
        registry.register(Box::new(telegram_message_duration.clone()))?;
        
        let memory_usage_gauge = Gauge::new(
            "cc_telegram_memory_usage_bytes",
            "Current memory usage in bytes"
        )?;
        registry.register(Box::new(memory_usage_gauge.clone()))?;
        
        let cpu_usage_gauge = Gauge::new(
            "cc_telegram_cpu_usage_percent",
            "Current CPU usage percentage"
        )?;
        registry.register(Box::new(cpu_usage_gauge.clone()))?;
        
        let file_watcher_events_counter = Counter::new(
            "cc_telegram_file_watcher_events_total",
            "Total number of file system events detected"
        )?;
        registry.register(Box::new(file_watcher_events_counter.clone()))?;
        
        let error_counter = Counter::new(
            "cc_telegram_errors_total",
            "Total number of errors encountered"
        )?;
        registry.register(Box::new(error_counter.clone()))?;
        
        let mut system = System::new_all();
        system.refresh_all();
        
        Ok(Self {
            event_processing_counter,
            event_processing_duration,
            telegram_message_counter,
            telegram_message_duration,
            memory_usage_gauge,
            cpu_usage_gauge,
            file_watcher_events_counter,
            error_counter,
            system: Arc::new(Mutex::new(system)),
            metrics_registry: registry,
            start_time: Instant::now(),
            config,
        })
    }
    
    /// Record an event processing operation
    pub fn record_event_processed(&self, duration: Duration) {
        self.event_processing_counter.inc();
        self.event_processing_duration.observe(duration.as_secs_f64());
        
        if duration.as_millis() > self.config.event_processing_threshold_ms as u128 {
            warn!("Slow event processing detected: {}ms", duration.as_millis());
        }
        
        if self.config.enable_detailed_logging {
            info!("Event processed in {}ms", duration.as_millis());
        }
    }
    
    /// Record a Telegram message operation
    pub fn record_telegram_message(&self, duration: Duration) {
        self.telegram_message_counter.inc();
        self.telegram_message_duration.observe(duration.as_secs_f64());
        
        if duration.as_millis() > self.config.telegram_response_threshold_ms as u128 {
            warn!("Slow Telegram response detected: {}ms", duration.as_millis());
        }
    }
    
    /// Record a file watcher event
    pub fn record_file_watcher_event(&self) {
        self.file_watcher_events_counter.inc();
    }
    
    /// Record an error
    pub fn record_error(&self, error_type: &str) {
        self.error_counter.inc();
        error!("Error recorded: {}", error_type);
    }
    
    /// Update system metrics
    pub fn update_system_metrics(&self) -> anyhow::Result<SystemMetrics> {
        let mut system = self.system.lock().unwrap();
        system.refresh_all();
        
        let total_memory = system.total_memory();
        let used_memory = system.used_memory();
        let memory_usage_percent = (used_memory as f32 / total_memory as f32) * 100.0;
        
        // Get current process info
        let current_pid = std::process::id();
        let pid = Pid::from_u32(current_pid);
        
        let (process_memory, cpu_usage) = if let Some(process) = system.process(pid) {
            (process.memory(), process.cpu_usage())
        } else {
            (0, 0.0)
        };
        
        // Update Prometheus gauges
        self.memory_usage_gauge.set(process_memory as f64);
        self.cpu_usage_gauge.set(cpu_usage as f64);
        
        // Check thresholds
        if process_memory / 1024 / 1024 > self.config.memory_threshold_mb {
            warn!("High memory usage detected: {}MB", process_memory / 1024 / 1024);
        }
        
        if cpu_usage > self.config.cpu_threshold_percent {
            warn!("High CPU usage detected: {:.1}%", cpu_usage);
        }
        
        Ok(SystemMetrics {
            memory_usage_mb: process_memory / 1024 / 1024,
            memory_usage_percent,
            cpu_usage_percent: cpu_usage,
            uptime_seconds: self.start_time.elapsed().as_secs(),
            disk_usage_percent: 0.0, // TODO: Implement disk usage monitoring
            network_bytes_received: 0, // TODO: Implement network monitoring
            network_bytes_sent: 0,
        })
    }
    
    /// Generate a comprehensive performance report
    pub fn generate_report(&self) -> anyhow::Result<PerformanceReport> {
        let system_metrics = self.update_system_metrics()?;
        
        // Calculate event metrics from Prometheus metrics
        let event_metrics = EventMetrics {
            total_events_processed: self.event_processing_counter.get() as u64,
            average_processing_time_ms: self.event_processing_duration.get_sample_sum() 
                / self.event_processing_duration.get_sample_count() as f64 * 1000.0,
            events_per_minute: (self.event_processing_counter.get() as f64 
                / self.start_time.elapsed().as_secs() as f64) * 60.0,
            last_event_timestamp: None, // TODO: Track last event timestamp
            error_rate_percent: (self.error_counter.get() as f64 
                / self.event_processing_counter.get() as f64) * 100.0,
        };
        
        // Calculate Telegram metrics
        let telegram_metrics = TelegramMetrics {
            messages_sent: self.telegram_message_counter.get() as u64,
            messages_received: 0, // TODO: Track received messages
            average_response_time_ms: self.telegram_message_duration.get_sample_sum() 
                / self.telegram_message_duration.get_sample_count() as f64 * 1000.0,
            api_errors: 0, // TODO: Track API errors
            rate_limit_hits: 0, // TODO: Track rate limit hits
        };
        
        // Determine health status and generate recommendations
        let (health_status, recommendations) = self.assess_health(&system_metrics, &event_metrics);
        
        Ok(PerformanceReport {
            timestamp: chrono::Utc::now(),
            health_status,
            system_metrics,
            event_metrics,
            telegram_metrics,
            recommendations,
        })
    }
    
    /// Assess overall health and provide recommendations
    fn assess_health(&self, system: &SystemMetrics, events: &EventMetrics) -> (HealthStatus, Vec<String>) {
        let mut recommendations = Vec::new();
        let mut warnings = Vec::new();
        let mut critical_issues = Vec::new();
        
        // Check memory usage
        if system.memory_usage_mb > self.config.memory_threshold_mb {
            let issue = format!("High memory usage: {}MB", system.memory_usage_mb);
            if system.memory_usage_mb > self.config.memory_threshold_mb * 2 {
                critical_issues.push(issue);
                recommendations.push("Consider restarting the application or increasing memory limits".to_string());
            } else {
                warnings.push(issue);
                recommendations.push("Monitor memory usage and consider optimizing event processing".to_string());
            }
        }
        
        // Check CPU usage
        if system.cpu_usage_percent > self.config.cpu_threshold_percent {
            let issue = format!("High CPU usage: {:.1}%", system.cpu_usage_percent);
            if system.cpu_usage_percent > 95.0 {
                critical_issues.push(issue);
                recommendations.push("CPU usage is critically high - consider scaling or optimization".to_string());
            } else {
                warnings.push(issue);
                recommendations.push("Monitor CPU usage and consider optimizing processing logic".to_string());
            }
        }
        
        // Check error rate
        if events.error_rate_percent > 5.0 {
            let issue = format!("High error rate: {:.1}%", events.error_rate_percent);
            if events.error_rate_percent > 15.0 {
                critical_issues.push(issue);
                recommendations.push("Critical error rate detected - investigate and fix immediately".to_string());
            } else {
                warnings.push(issue);
                recommendations.push("Monitor error patterns and implement additional error handling".to_string());
            }
        }
        
        // Check processing performance
        if events.average_processing_time_ms > self.config.event_processing_threshold_ms as f64 {
            warnings.push(format!("Slow event processing: {:.0}ms avg", events.average_processing_time_ms));
            recommendations.push("Consider optimizing event processing logic or increasing resources".to_string());
        }
        
        // Determine overall health status
        let health_status = if !critical_issues.is_empty() {
            HealthStatus::Critical(critical_issues.join("; "))
        } else if !warnings.is_empty() {
            HealthStatus::Warning(warnings.join("; "))
        } else {
            HealthStatus::Healthy
        };
        
        (health_status, recommendations)
    }
    
    /// Export metrics in Prometheus format
    pub fn export_prometheus_metrics(&self) -> anyhow::Result<String> {
        let encoder = TextEncoder::new();
        let metric_families = self.metrics_registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer)?;
        Ok(String::from_utf8(buffer)?)
    }
    
    /// Start background monitoring task
    pub async fn start_monitoring_task(self: Arc<Self>) -> anyhow::Result<()> {
        let mut interval = interval(Duration::from_secs(self.config.metrics_collection_interval_seconds));
        
        loop {
            interval.tick().await;
            
            match self.generate_report() {
                Ok(report) => {
                    // Log performance summary
                    match &report.health_status {
                        HealthStatus::Healthy => {
                            info!("System healthy - CPU: {:.1}%, Memory: {}MB, Events: {} processed", 
                                report.system_metrics.cpu_usage_percent,
                                report.system_metrics.memory_usage_mb,
                                report.event_metrics.total_events_processed
                            );
                        },
                        HealthStatus::Warning(msg) => {
                            warn!("System warning: {} - Recommendations: {:?}", msg, report.recommendations);
                        },
                        HealthStatus::Critical(msg) => {
                            error!("System critical: {} - Immediate action required: {:?}", msg, report.recommendations);
                        }
                    }
                    
                    // Detailed logging if enabled
                    if self.config.enable_detailed_logging {
                        info!("Performance report: {}", serde_json::to_string_pretty(&report)?);
                    }
                },
                Err(e) => {
                    error!("Failed to generate performance report: {}", e);
                    self.record_error("performance_report_generation");
                }
            }
        }
    }
}

/// Helper trait for timing operations
#[allow(dead_code)]
pub trait TimedOperation {
    fn timed<F, R>(self, operation: F) -> R
    where
        F: FnOnce(Duration) -> R;
}

impl TimedOperation for Instant {
    fn timed<F, R>(self, operation: F) -> R
    where
        F: FnOnce(Duration) -> R,
    {
        let duration = self.elapsed();
        operation(duration)
    }
}

/// Macro for easy performance measurement
#[macro_export]
macro_rules! measure_performance {
    ($monitor:expr, $counter:ident, $operation:expr) => {{
        let start = std::time::Instant::now();
        let result = $operation;
        $monitor.$counter(start.elapsed());
        result
    }};
}

#[cfg(test)]
mod tests {
    use super::*;
    
    
    #[tokio::test]
    async fn test_performance_monitor_creation() {
        let config = PerformanceConfig::default();
        let monitor = PerformanceMonitor::new(config).unwrap();
        
        // Test basic metric recording
        monitor.record_event_processed(Duration::from_millis(100));
        monitor.record_telegram_message(Duration::from_millis(500));
        monitor.record_file_watcher_event();
        monitor.record_error("test_error");
        
        assert_eq!(monitor.event_processing_counter.get(), 1.0);
        assert_eq!(monitor.telegram_message_counter.get(), 1.0);
        assert_eq!(monitor.file_watcher_events_counter.get(), 1.0);
        assert_eq!(monitor.error_counter.get(), 1.0);
    }
    
    #[tokio::test]
    async fn test_performance_report_generation() {
        let config = PerformanceConfig::default();
        let monitor = PerformanceMonitor::new(config).unwrap();
        
        // Add some test data
        monitor.record_event_processed(Duration::from_millis(200));
        monitor.record_telegram_message(Duration::from_millis(300));
        
        let report = monitor.generate_report().unwrap();
        
        assert!(matches!(report.health_status, HealthStatus::Healthy));
        assert_eq!(report.event_metrics.total_events_processed, 1);
        assert!(report.system_metrics.memory_usage_mb > 0);
    }
    
    #[tokio::test]
    async fn test_prometheus_metrics_export() {
        let config = PerformanceConfig::default();
        let monitor = PerformanceMonitor::new(config).unwrap();
        
        monitor.record_event_processed(Duration::from_millis(100));
        
        let metrics = monitor.export_prometheus_metrics().unwrap();
        assert!(metrics.contains("cc_telegram_events_processed_total"));
        assert!(metrics.contains("cc_telegram_event_processing_duration_seconds"));
    }
}
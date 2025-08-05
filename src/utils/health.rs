use std::sync::Arc;
use warp::{Filter, Rejection, Reply, http::StatusCode};
use serde_json::json;
use crate::utils::performance::{PerformanceMonitor, HealthStatus};
use crate::utils::monitoring::TierMonitor;
use tracing::{info, error, warn};
use std::env;

/// Custom rejection for unauthorized access
#[derive(Debug)]
struct Unauthorized;

impl warp::reject::Reject for Unauthorized {}

/// Health check and metrics HTTP server
pub struct HealthServer {
    performance_monitor: Arc<PerformanceMonitor>,
    port: u16,
}

/// Enhanced health server with tier monitoring support
pub struct TierHealthServer {
    performance_monitor: Option<Arc<PerformanceMonitor>>,
    tier_monitor: Option<Arc<TierMonitor>>,
    port: u16,
}

impl TierHealthServer {
    /// Create a new tier health server with optional monitors
    pub fn new(port: u16) -> Self {
        Self {
            performance_monitor: None,
            tier_monitor: None,
            port,
        }
    }
    
    /// Add performance monitor
    pub fn with_performance_monitor(mut self, monitor: Arc<PerformanceMonitor>) -> Self {
        self.performance_monitor = Some(monitor);
        self
    }
    
    /// Add tier monitor
    pub fn with_tier_monitor(mut self, monitor: Arc<TierMonitor>) -> Self {
        self.tier_monitor = Some(monitor);
        self
    }
    
    /// Start the enhanced health check server
    pub async fn start(self) -> anyhow::Result<()> {
        info!("Starting enhanced tier health server on port {}", self.port);
        
        // Get authentication token from environment
        let auth_token = env::var("CC_TELEGRAM_METRICS_TOKEN").ok();
        if auth_token.is_none() {
            warn!("CC_TELEGRAM_METRICS_TOKEN not set - metrics endpoints will require no authentication");
            warn!("Set CC_TELEGRAM_METRICS_TOKEN environment variable to secure metrics endpoints");
        }
        
        let perf_monitor = self.performance_monitor.clone();
        let tier_monitor = self.tier_monitor.clone();
        
        // Authentication filter
        let auth = warp::header::optional::<String>("authorization")
            .and_then(move |auth_header: Option<String>| {
                let token = auth_token.clone();
                async move {
                    // If no token is configured, allow access (for backward compatibility)
                    if token.is_none() {
                        return Ok::<(), Rejection>(());
                    }
                    
                    // If token is configured, require authentication
                    let configured_token = token.unwrap();
                    match auth_header {
                        Some(header) if header == format!("Bearer {}", configured_token) => {
                            Ok(())
                        }
                        _ => {
                            warn!("Unauthorized metrics access attempt");
                            Err(warp::reject::custom(Unauthorized))
                        }
                    }
                }
            });
        
        // Basic health check endpoint (public)
        let health = warp::path("health")
            .and(warp::get())
            .and_then({
                let perf_monitor = perf_monitor.clone();
                move || {
                    let perf_monitor = perf_monitor.clone();
                    async move {
                        handle_basic_health_check(perf_monitor).await
                    }
                }
            });
        
        // Comprehensive tier health check endpoint (public for monitoring)
        let tier_health = warp::path("health")
            .and(warp::path("tiers"))
            .and(warp::get())
            .and_then({
                let tier_monitor = tier_monitor.clone();
                move || {
                    let tier_monitor = tier_monitor.clone();
                    async move {
                        handle_tier_health_check(tier_monitor).await
                    }
                }
            });
        
        // Combined metrics endpoint (Prometheus format) - requires auth
        let metrics = warp::path("metrics")
            .and(warp::get())
            .and(auth.clone())
            .and_then({
                let perf_monitor = perf_monitor.clone();
                let tier_monitor = tier_monitor.clone();
                move |_auth| {
                    let perf_monitor = perf_monitor.clone();
                    let tier_monitor = tier_monitor.clone();
                    async move {
                        handle_combined_metrics(perf_monitor, tier_monitor).await
                    }
                }
            });
        
        // Tier-specific metrics endpoint - requires auth
        let tier_metrics = warp::path("metrics")
            .and(warp::path("tiers"))
            .and(warp::get())
            .and(auth.clone())
            .and_then({
                let tier_monitor = tier_monitor.clone();
                move |_auth| {
                    let tier_monitor = tier_monitor.clone();
                    async move {
                        handle_tier_metrics_only(tier_monitor).await
                    }
                }
            });
        
        // Active correlations endpoint for debugging - requires auth
        let correlations = warp::path("debug")
            .and(warp::path("correlations"))
            .and(warp::get())
            .and(auth.clone())
            .and_then({
                let tier_monitor = tier_monitor.clone();
                move |_auth| {
                    let tier_monitor = tier_monitor.clone();
                    async move {
                        handle_active_correlations(tier_monitor).await
                    }
                }
            });
        
        // Performance report endpoint (JSON format) - requires auth
        let report = warp::path("report")
            .and(warp::get())
            .and(auth.clone())
            .and_then({
                let perf_monitor = perf_monitor.clone();
                move |_auth| {
                    let perf_monitor = perf_monitor.clone();
                    async move {
                        handle_performance_report_optional(perf_monitor).await
                    }
                }
            });
        
        // Ready check endpoint (simple)
        let ready = warp::path("ready")
            .and(warp::get())
            .map(|| {
                warp::reply::with_status("OK", StatusCode::OK)
            });
        
        // Live check endpoint (simple)
        let live = warp::path("live")
            .and(warp::get())
            .map(|| {
                warp::reply::with_status("OK", StatusCode::OK)
            });
        
        let routes = health
            .or(tier_health)
            .or(metrics)
            .or(tier_metrics)
            .or(correlations)
            .or(report)
            .or(ready)
            .or(live)
            .with(warp::cors().allow_any_origin())
            .recover(handle_rejection);
        
        warp::serve(routes)
            .run(([0, 0, 0, 0], self.port))
            .await;
        
        Ok(())
    }
}

impl HealthServer {
    /// Create a new health server
    pub fn new(performance_monitor: Arc<PerformanceMonitor>, port: u16) -> Self {
        Self {
            performance_monitor,
            port,
        }
    }
    
    /// Start the health check server
    pub async fn start(self) -> anyhow::Result<()> {
        info!("Starting health check server on port {}", self.port);
        
        // Get authentication token from environment
        let auth_token = env::var("CC_TELEGRAM_METRICS_TOKEN").ok();
        if auth_token.is_none() {
            warn!("CC_TELEGRAM_METRICS_TOKEN not set - metrics endpoints will require no authentication");
            warn!("Set CC_TELEGRAM_METRICS_TOKEN environment variable to secure metrics endpoints");
        }
        
        let monitor = self.performance_monitor.clone();
        
        // Authentication filter
        let auth = warp::header::optional::<String>("authorization")
            .and_then(move |auth_header: Option<String>| {
                let token = auth_token.clone();
                async move {
                    // If no token is configured, allow access (for backward compatibility)
                    if token.is_none() {
                        return Ok::<(), Rejection>(());
                    }
                    
                    // If token is configured, require authentication
                    let configured_token = token.unwrap();
                    match auth_header {
                        Some(header) if header == format!("Bearer {}", configured_token) => {
                            Ok(())
                        }
                        _ => {
                            warn!("Unauthorized metrics access attempt");
                            Err(warp::reject::custom(Unauthorized))
                        }
                    }
                }
            });
        
        // Health check endpoint (public for Kubernetes/Docker health checks)
        let health = warp::path("health")
            .and(warp::get())
            .and_then({
                let monitor = monitor.clone();
                move || {
                    let monitor = monitor.clone();
                    async move {
                        handle_health_check(monitor).await
                    }
                }
            });
        
        // Metrics endpoint (Prometheus format) - requires auth
        let metrics = warp::path("metrics")
            .and(warp::get())
            .and(auth.clone())
            .and_then({
                let monitor = monitor.clone();
                move |_auth| {
                    let monitor = monitor.clone();
                    async move {
                        handle_metrics(monitor).await
                    }
                }
            });
        
        // Performance report endpoint (JSON format) - requires auth
        let report = warp::path("report")
            .and(warp::get())
            .and(auth.clone())
            .and_then({
                let monitor = monitor.clone();
                move |_auth| {
                    let monitor = monitor.clone();
                    async move {
                        handle_performance_report(monitor).await
                    }
                }
            });
        
        // Ready check endpoint (simple)
        let ready = warp::path("ready")
            .and(warp::get())
            .map(|| {
                warp::reply::with_status("OK", StatusCode::OK)
            });
        
        // Live check endpoint (simple)
        let live = warp::path("live")
            .and(warp::get())
            .map(|| {
                warp::reply::with_status("OK", StatusCode::OK)
            });
        
        let routes = health
            .or(metrics)
            .or(report)
            .or(ready)
            .or(live)
            .with(warp::cors().allow_any_origin())
            .recover(handle_rejection);
        
        warp::serve(routes)
            .run(([0, 0, 0, 0], self.port))
            .await;
        
        Ok(())
    }
}

/// Handle basic health check requests (fallback to performance monitor)
async fn handle_basic_health_check(monitor: Option<Arc<PerformanceMonitor>>) -> Result<Box<dyn Reply>, Rejection> {
    match monitor {
        Some(perf_monitor) => {
            match handle_health_check(perf_monitor).await {
                Ok(reply) => Ok(Box::new(reply) as Box<dyn Reply>),
                Err(e) => Err(e),
            }
        },
        None => Ok(Box::new(warp::reply::with_status(
            warp::reply::json(&json!({
                "status": "healthy",
                "message": "Basic health check - no performance monitor available",
                "timestamp": chrono::Utc::now()
            })),
            StatusCode::OK
        )) as Box<dyn Reply>)
    }
}

/// Handle comprehensive tier health check requests
async fn handle_tier_health_check(tier_monitor: Option<Arc<TierMonitor>>) -> Result<impl Reply, Rejection> {
    match tier_monitor {
        Some(monitor) => {
            match monitor.get_health_check().await {
                Ok(health_check) => {
                    let status_code = match &health_check.overall_status {
                        crate::utils::monitoring::HealthStatus::Healthy => StatusCode::OK,
                        crate::utils::monitoring::HealthStatus::Degraded => StatusCode::OK,
                        crate::utils::monitoring::HealthStatus::Unhealthy => StatusCode::SERVICE_UNAVAILABLE,
                        crate::utils::monitoring::HealthStatus::Critical => StatusCode::SERVICE_UNAVAILABLE,
                    };
                    
                    Ok(warp::reply::with_status(
                        warp::reply::json(&health_check),
                        status_code
                    ))
                }
                Err(e) => {
                    error!("Failed to generate tier health check: {}", e);
                    Ok(warp::reply::with_status(
                        warp::reply::json(&json!({
                            "status": "error",
                            "message": "Failed to generate tier health check",
                            "error": e.to_string(),
                            "timestamp": chrono::Utc::now()
                        })),
                        StatusCode::INTERNAL_SERVER_ERROR
                    ))
                }
            }
        }
        None => Ok(warp::reply::with_status(
            warp::reply::json(&json!({
                "status": "healthy",
                "message": "Basic tier health check - no tier monitor available",
                "timestamp": chrono::Utc::now()
            })),
            StatusCode::OK
        ))
    }
}

/// Handle combined metrics requests (both performance and tier metrics)
async fn handle_combined_metrics(
    perf_monitor: Option<Arc<PerformanceMonitor>>, 
    tier_monitor: Option<Arc<TierMonitor>>
) -> Result<impl Reply, Rejection> {
    let mut combined_metrics = String::new();
    
    // Add performance metrics if available
    if let Some(monitor) = perf_monitor {
        match monitor.export_prometheus_metrics() {
            Ok(metrics) => {
                combined_metrics.push_str(&metrics);
                combined_metrics.push('\n');
            }
            Err(e) => {
                error!("Failed to export performance metrics: {}", e);
                combined_metrics.push_str(&format!("# Error exporting performance metrics: {}\n", e));
            }
        }
    }
    
    // Add tier metrics if available
    if let Some(monitor) = tier_monitor {
        match monitor.export_prometheus_metrics() {
            Ok(metrics) => {
                combined_metrics.push_str(&metrics);
            }
            Err(e) => {
                error!("Failed to export tier metrics: {}", e);
                combined_metrics.push_str(&format!("# Error exporting tier metrics: {}\n", e));
            }
        }
    }
    
    if combined_metrics.is_empty() {
        combined_metrics = "# No metrics available\n".to_string();
    }
    
    Ok(warp::reply::with_header(
        combined_metrics,
        "content-type",
        "text/plain; version=0.0.4; charset=utf-8"
    ))
}

/// Handle tier-only metrics requests
async fn handle_tier_metrics_only(tier_monitor: Option<Arc<TierMonitor>>) -> Result<impl Reply, Rejection> {
    match tier_monitor {
        Some(monitor) => {
            match monitor.export_prometheus_metrics() {
                Ok(metrics) => {
                    Ok(warp::reply::with_header(
                        metrics,
                        "content-type",
                        "text/plain; version=0.0.4; charset=utf-8"
                    ))
                }
                Err(e) => {
                    error!("Failed to export tier metrics: {}", e);
                    Ok(warp::reply::with_header(
                        format!("# Error exporting tier metrics: {}", e),
                        "content-type",
                        "text/plain; charset=utf-8"
                    ))
                }
            }
        }
        None => {
            Ok(warp::reply::with_header(
                "# No tier monitor available".to_string(),
                "content-type",
                "text/plain; charset=utf-8"
            ))
        }
    }
}

/// Handle active correlations debugging endpoint
async fn handle_active_correlations(tier_monitor: Option<Arc<TierMonitor>>) -> Result<impl Reply, Rejection> {
    match tier_monitor {
        Some(monitor) => {
            let correlations = monitor.get_active_correlations().await;
            Ok(warp::reply::with_status(
                warp::reply::json(&json!({
                    "active_correlations": correlations,
                    "count": correlations.len(),
                    "timestamp": chrono::Utc::now()
                })),
                StatusCode::OK
            ))
        }
        None => {
            Ok(warp::reply::with_status(
                warp::reply::json(&json!({
                    "message": "No tier monitor available",
                    "timestamp": chrono::Utc::now()
                })),
                StatusCode::OK
            ))
        }
    }
}

/// Handle performance report requests with optional monitor
async fn handle_performance_report_optional(monitor: Option<Arc<PerformanceMonitor>>) -> Result<Box<dyn Reply>, Rejection> {
    match monitor {
        Some(perf_monitor) => {
            match handle_performance_report(perf_monitor).await {
                Ok(reply) => Ok(Box::new(reply) as Box<dyn Reply>),
                Err(e) => Err(e),
            }
        },
        None => Ok(Box::new(warp::reply::with_status(
            warp::reply::json(&json!({
                "message": "No performance monitor available",
                "timestamp": chrono::Utc::now()
            })),
            StatusCode::OK
        )) as Box<dyn Reply>)
    }
}

/// Handle health check requests
async fn handle_health_check(monitor: Arc<PerformanceMonitor>) -> Result<impl Reply, Rejection> {
    match monitor.generate_report() {
        Ok(report) => {
            let (status_code, status_text) = match &report.health_status {
                HealthStatus::Healthy => (StatusCode::OK, "healthy"),
                HealthStatus::Warning(_) => (StatusCode::OK, "warning"),
                HealthStatus::Critical(_) => (StatusCode::SERVICE_UNAVAILABLE, "critical"),
            };
            
            let response = json!({
                "status": status_text,
                "timestamp": report.timestamp,
                "uptime_seconds": report.system_metrics.uptime_seconds,
                "memory_usage_mb": report.system_metrics.memory_usage_mb,
                "cpu_usage_percent": report.system_metrics.cpu_usage_percent,
                "events_processed": report.event_metrics.total_events_processed,
                "error_rate_percent": report.event_metrics.error_rate_percent,
                "health_details": match &report.health_status {
                    HealthStatus::Healthy => json!(null),
                    HealthStatus::Warning(msg) => json!(msg),
                    HealthStatus::Critical(msg) => json!(msg),
                },
                "recommendations": report.recommendations
            });
            
            Ok(warp::reply::with_status(
                warp::reply::json(&response),
                status_code
            ))
        },
        Err(e) => {
            error!("Failed to generate health report: {}", e);
            Ok(warp::reply::with_status(
                warp::reply::json(&json!({
                    "status": "error",
                    "message": "Failed to generate health report",
                    "error": e.to_string()
                })),
                StatusCode::INTERNAL_SERVER_ERROR
            ))
        }
    }
}

/// Handle metrics requests (Prometheus format)
async fn handle_metrics(monitor: Arc<PerformanceMonitor>) -> Result<impl Reply, Rejection> {
    match monitor.export_prometheus_metrics() {
        Ok(metrics) => {
            Ok(warp::reply::with_header(
                metrics,
                "content-type",
                "text/plain; version=0.0.4; charset=utf-8"
            ))
        },
        Err(e) => {
            error!("Failed to export metrics: {}", e);
            Ok(warp::reply::with_header(
                format!("# Error exporting metrics: {}", e),
                "content-type",
                "text/plain; charset=utf-8"
            ))
        }
    }
}

/// Handle performance report requests (JSON format)
async fn handle_performance_report(monitor: Arc<PerformanceMonitor>) -> Result<impl Reply, Rejection> {
    match monitor.generate_report() {
        Ok(report) => {
            Ok(warp::reply::with_status(
                warp::reply::json(&report),
                StatusCode::OK
            ))
        },
        Err(e) => {
            error!("Failed to generate performance report: {}", e);
            Ok(warp::reply::with_status(
                warp::reply::json(&json!({
                    "error": "Failed to generate performance report",
                    "message": e.to_string()
                })),
                StatusCode::INTERNAL_SERVER_ERROR
            ))
        }
    }
}

/// Handle HTTP errors and rejections
async fn handle_rejection(err: Rejection) -> Result<impl Reply, std::convert::Infallible> {
    let code;
    let message;

    if err.is_not_found() {
        code = StatusCode::NOT_FOUND;
        message = "Not Found";
    } else if err.find::<Unauthorized>().is_some() {
        code = StatusCode::UNAUTHORIZED;
        message = "Authentication required";
    } else if err.find::<warp::filters::body::BodyDeserializeError>().is_some() {
        code = StatusCode::BAD_REQUEST;
        message = "Invalid Body";
    } else if err.find::<warp::reject::MethodNotAllowed>().is_some() {
        code = StatusCode::METHOD_NOT_ALLOWED;
        message = "Method Not Allowed";
    } else {
        error!("Unhandled rejection: {:?}", err);
        code = StatusCode::INTERNAL_SERVER_ERROR;
        message = "Internal Server Error";
    }

    let json = json!({
        "error": message,
        "code": code.as_u16()
    });

    Ok(warp::reply::with_status(warp::reply::json(&json), code))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::performance::PerformanceConfig;
    use std::time::Duration;
    
    
    #[tokio::test]
    async fn test_health_server_creation() {
        let config = PerformanceConfig::default();
        let monitor = Arc::new(PerformanceMonitor::new(config).unwrap());
        let server = HealthServer::new(monitor, 0); // Use port 0 for testing
        
        // Just test that we can create the server
        assert_eq!(server.port, 0);
    }
    
    #[tokio::test]
    async fn test_health_check_handler() {
        let config = PerformanceConfig::default();
        let monitor = Arc::new(PerformanceMonitor::new(config).unwrap());
        
        // Add some test data
        monitor.record_event_processed(Duration::from_millis(100));
        
        let result = handle_health_check(monitor).await;
        assert!(result.is_ok());
    }
    
    #[tokio::test]
    async fn test_metrics_handler() {
        let config = PerformanceConfig::default();
        let monitor = Arc::new(PerformanceMonitor::new(config).unwrap());
        
        monitor.record_event_processed(Duration::from_millis(100));
        
        let result = handle_metrics(monitor).await;
        assert!(result.is_ok());
    }
    
    #[tokio::test]
    async fn test_performance_report_handler() {
        let config = PerformanceConfig::default();
        let monitor = Arc::new(PerformanceMonitor::new(config).unwrap());
        
        let result = handle_performance_report(monitor).await;
        assert!(result.is_ok());
    }
}
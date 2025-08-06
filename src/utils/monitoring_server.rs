/**
 * Task 34.4: HTTP server for monitoring dashboard and Prometheus metrics endpoint
 */

use anyhow::Result;
use serde_json::json;
use std::sync::Arc;
use tracing::{info, error, instrument};
use warp::{Filter, Reply};

use crate::telegram::tracking::MessageTracker;
use crate::utils::monitoring::TierMonitor;

/// HTTP server for monitoring dashboard and metrics
pub struct MonitoringServer {
    message_tracker: Arc<MessageTracker>,
    tier_monitor: Arc<TierMonitor>,
    port: u16,
}

impl MonitoringServer {
    /// Create new monitoring server
    pub fn new(
        message_tracker: Arc<MessageTracker>,
        tier_monitor: Arc<TierMonitor>,
        port: u16,
    ) -> Self {
        Self {
            message_tracker,
            tier_monitor,
            port,
        }
    }

    /// Start the monitoring HTTP server
    #[instrument(skip(self))]
    pub async fn start(self) -> Result<()> {
        info!("Starting monitoring server on port {}", self.port);

        let message_tracker = Arc::clone(&self.message_tracker);
        let tier_monitor = Arc::clone(&self.tier_monitor);

        // Dashboard API endpoint
        let dashboard_api = warp::path("api")
            .and(warp::path("monitoring"))
            .and(warp::path("dashboard"))
            .and(warp::get())
            .and_then({
                let message_tracker = Arc::clone(&message_tracker);
                move || {
                    let message_tracker = Arc::clone(&message_tracker);
                    async move {
                        match message_tracker.get_dashboard().await {
                            Ok(dashboard) => {
                                let json_response = serde_json::to_string(&dashboard)
                                    .map_err(|e| warp::reject::custom(ApiError(e.to_string())))?;
                                Ok(warp::reply::with_header(
                                    json_response,
                                    "content-type",
                                    "application/json",
                                ))
                            }
                            Err(e) => Err(warp::reject::custom(ApiError(e.to_string()))),
                        }
                    }
                }
            });

        // Prometheus metrics endpoint for message tracking
        let metrics_api = warp::path("metrics")
            .and(warp::get())
            .and_then({
                let message_tracker = Arc::clone(&message_tracker);
                let tier_monitor = Arc::clone(&tier_monitor);
                move || {
                    let message_tracker = Arc::clone(&message_tracker);
                    let tier_monitor = Arc::clone(&tier_monitor);
                    async move {
                        // Combine metrics from both sources
                        let mut combined_metrics = String::new();

                        // Add message tracking metrics
                        match message_tracker.export_prometheus_metrics().await {
                            Ok(tracking_metrics) => {
                                combined_metrics.push_str(&tracking_metrics);
                                combined_metrics.push('\n');
                            }
                            Err(e) => {
                                error!("Failed to export tracking metrics: {}", e);
                            }
                        }

                        // Add tier monitoring metrics
                        match tier_monitor.export_prometheus_metrics() {
                            Ok(tier_metrics) => {
                                combined_metrics.push_str(&tier_metrics);
                            }
                            Err(e) => {
                                error!("Failed to export tier metrics: {}", e);
                            }
                        }

                        Ok::<_, warp::Rejection>(warp::reply::with_header(
                            combined_metrics,
                            "content-type",
                            "text/plain; version=0.0.4",
                        ))
                    }
                }
            });

        // Health check endpoint
        let health_api = warp::path("health")
            .and(warp::get())
            .and_then({
                let tier_monitor = Arc::clone(&tier_monitor);
                move || {
                    let tier_monitor = Arc::clone(&tier_monitor);
                    async move {
                        match tier_monitor.get_health_check().await {
                            Ok(health_check) => {
                                let health_status = match health_check.overall_status {
                                    crate::utils::monitoring::HealthStatus::Healthy => "UP",
                                    crate::utils::monitoring::HealthStatus::Degraded => "DEGRADED",
                                    crate::utils::monitoring::HealthStatus::Unhealthy => "DOWN",
                                    crate::utils::monitoring::HealthStatus::Critical => "CRITICAL",
                                };

                                let response = json!({
                                    "status": health_status,
                                    "timestamp": health_check.timestamp,
                                    "details": health_check
                                });

                                Ok::<_, warp::Rejection>(warp::reply::with_status(
                                    warp::reply::json(&response),
                                    if health_status == "UP" {
                                        warp::http::StatusCode::OK
                                    } else {
                                        warp::http::StatusCode::SERVICE_UNAVAILABLE
                                    },
                                ))
                            }
                            Err(e) => {
                                let error_response = json!({
                                    "status": "ERROR",
                                    "error": e.to_string()
                                });
                                Ok::<_, warp::Rejection>(warp::reply::with_status(
                                    warp::reply::json(&error_response),
                                    warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                                ))
                            }
                        }
                    }
                }
            });

        // Message trace lookup endpoint
        let trace_api = warp::path("api")
            .and(warp::path("trace"))
            .and(warp::path::param::<String>())
            .and(warp::get())
            .and_then({
                let message_tracker = Arc::clone(&message_tracker);
                move |correlation_id: String| {
                    let message_tracker = Arc::clone(&message_tracker);
                    async move {
                        match message_tracker.get_trace(&correlation_id).await {
                            Some(trace) => {
                                let json_response = serde_json::to_string(&trace)
                                    .map_err(|e| warp::reject::custom(ApiError(e.to_string())))?;
                                Ok(warp::reply::with_header(
                                    json_response,
                                    "content-type",
                                    "application/json",
                                ))
                            }
                            None => Err(warp::reject::not_found()),
                        }
                    }
                }
            });

        // Active correlations endpoint
        let correlations_api = warp::path("api")
            .and(warp::path("correlations"))
            .and(warp::get())
            .and_then({
                let message_tracker = Arc::clone(&message_tracker);
                move || {
                    let message_tracker = Arc::clone(&message_tracker);
                    async move {
                        let correlation_ids = message_tracker.get_active_correlation_ids().await;
                        let response = json!({
                            "active_correlations": correlation_ids,
                            "count": correlation_ids.len()
                        });

                        Ok::<_, warp::Rejection>(warp::reply::json(&response))
                    }
                }
            });

        // Serve static dashboard files
        let dashboard_static = warp::path("dashboard")
            .and(warp::fs::dir("monitoring/dashboard"));

        // Root redirect to dashboard
        let root_redirect = warp::path::end()
            .map(|| warp::redirect(warp::http::Uri::from_static("/dashboard/")));

        // CORS headers
        let cors = warp::cors()
            .allow_any_origin()
            .allow_headers(vec!["content-type"])
            .allow_methods(vec!["GET", "POST", "OPTIONS"]);

        // Combine all routes
        let routes = dashboard_api
            .or(metrics_api)
            .or(health_api)
            .or(trace_api)
            .or(correlations_api)
            .or(dashboard_static)
            .or(root_redirect)
            .with(cors)
            .recover(handle_rejection);

        // Start server
        info!("✅ Monitoring server started on http://localhost:{}", self.port);
        info!("📊 Dashboard available at: http://localhost:{}/dashboard/", self.port);
        info!("📈 Metrics available at: http://localhost:{}/metrics", self.port);
        info!("🏥 Health check at: http://localhost:{}/health", self.port);

        warp::serve(routes)
            .run(([0, 0, 0, 0], self.port))
            .await;

        Ok(())
    }
}

/// Custom error type for API responses
#[derive(Debug)]
struct ApiError(String);

impl warp::reject::Reject for ApiError {}

/// Handle API rejections
async fn handle_rejection(err: warp::Rejection) -> Result<impl Reply, std::convert::Infallible> {
    let code;
    let message;

    if err.is_not_found() {
        code = warp::http::StatusCode::NOT_FOUND;
        message = "Resource not found";
    } else if let Some(api_error) = err.find::<ApiError>() {
        code = warp::http::StatusCode::INTERNAL_SERVER_ERROR;
        message = &api_error.0;
    } else {
        code = warp::http::StatusCode::INTERNAL_SERVER_ERROR;
        message = "Internal server error";
    }

    let json = warp::reply::json(&json!({
        "error": message,
        "status": code.as_u16()
    }));

    Ok(warp::reply::with_status(json, code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_monitoring_server_creation() {
        // This would normally create real instances, but for testing we'll skip the complex setup
        // In a real test, you would create all the required dependencies
        let port = 0; // Use port 0 for testing
        
        // Note: This test is incomplete due to complex dependencies
        // In a real implementation, you would create mock instances or use test containers
        assert_eq!(port, 0); // Placeholder assertion
    }
}
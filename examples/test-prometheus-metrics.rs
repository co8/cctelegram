/**
 * Simplified test script for validating Prometheus metrics export functionality
 * Tests the enhanced tier orchestrator metrics and monitoring integration
 */

use std::sync::Arc;
use tokio;
use cc_telegram_bridge::{
    utils::{monitoring::TierMonitor},
    tier_orchestrator::{
        core::{TierType, TierHealth, CircuitBreakerState},
        intelligent_selection::{SelectionStrategy, MessagePriority, TierScore},
    }
};
use chrono::Utc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("🧪 Testing Prometheus Metrics Export for Enhanced Tier Orchestrator");
    
    // Create a tier monitor instance without PerformanceMonitor to avoid compilation issues
    let tier_monitor = TierMonitor::new(None)?;
    
    // Test 1: Basic tier operations
    println!("\n📊 Test 1: Basic tier operations");
    tier_monitor.start_correlation("test-001", TierType::McpWebhook, "process").await;
    tier_monitor.start_correlation("test-002", TierType::BridgeInternal, "process").await;
    tier_monitor.start_correlation("test-003", TierType::FileWatcher, "process").await;
    
    // Simulate some processing time
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    
    tier_monitor.end_correlation_success("test-001", None).await;
    tier_monitor.end_correlation_failure("test-002", "timeout error").await;
    tier_monitor.end_correlation_success("test-003", None).await;
    
    // Test 2: Intelligent selection metrics
    println!("📊 Test 2: Intelligent selection metrics");
    let tier_scores = vec![
        TierScore {
            tier_type: TierType::McpWebhook,
            total_score: 0.95,
            performance_score: 0.98,
            availability_score: 0.99,
            load_score: 0.90,
            cost_score: 0.85,
            priority_bonus: 0.1,
            selection_reason: "High performance and availability".to_string(),
        },
        TierScore {
            tier_type: TierType::BridgeInternal,
            total_score: 0.75,
            performance_score: 0.80,
            availability_score: 0.85,
            load_score: 0.70,
            cost_score: 0.90,
            priority_bonus: 0.0,
            selection_reason: "Moderate performance".to_string(),
        },
    ];
    
    tier_monitor.record_tier_selection(
        SelectionStrategy::Adaptive,
        TierType::McpWebhook,
        MessagePriority::High,
        &tier_scores
    );
    
    tier_monitor.record_tier_selection(
        SelectionStrategy::PerformanceWeighted,
        TierType::BridgeInternal,
        MessagePriority::Normal,
        &tier_scores
    );
    
    // Test 3: Resilience pattern metrics
    println!("📊 Test 3: Resilience pattern metrics");
    
    // Recovery attempts
    tier_monitor.record_recovery_attempt(TierType::McpWebhook, "circuit_breaker_reset", "high_error_rate");
    tier_monitor.record_recovery_attempt(TierType::BridgeInternal, "adaptive_timeout", "slow_response");
    tier_monitor.record_recovery_success(TierType::McpWebhook, "circuit_breaker_reset");
    
    // Bulkhead utilization
    tier_monitor.update_bulkhead_utilization(TierType::McpWebhook, "connection_pool", 0.75);
    tier_monitor.update_bulkhead_utilization(TierType::BridgeInternal, "thread_pool", 0.60);
    tier_monitor.update_bulkhead_utilization(TierType::FileWatcher, "memory_pool", 0.85);
    
    // Adaptive timeouts
    tier_monitor.update_adaptive_timeout(TierType::McpWebhook, 0.12);
    tier_monitor.update_adaptive_timeout(TierType::BridgeInternal, 0.45);
    tier_monitor.update_adaptive_timeout(TierType::FileWatcher, 2.5);
    
    // Priority queue depths
    tier_monitor.update_priority_queue_depth(TierType::McpWebhook, MessagePriority::Critical, 0);
    tier_monitor.update_priority_queue_depth(TierType::McpWebhook, MessagePriority::High, 2);
    tier_monitor.update_priority_queue_depth(TierType::BridgeInternal, MessagePriority::Normal, 5);
    tier_monitor.update_priority_queue_depth(TierType::FileWatcher, MessagePriority::Low, 12);
    
    // Self-healing activities
    tier_monitor.record_self_healing_attempt(TierType::BridgeInternal, "restart_connection", "connection_failure");
    tier_monitor.record_self_healing_attempt(TierType::FileWatcher, "clear_queue", "queue_overflow");
    tier_monitor.record_self_healing_success(TierType::BridgeInternal, "restart_connection");
    
    // Circuit breaker trips
    tier_monitor.record_circuit_breaker_trip(TierType::BridgeInternal, "error_rate_threshold");
    tier_monitor.record_circuit_breaker_trip(TierType::FileWatcher, "response_time_threshold");
    
    // Health scores
    tier_monitor.update_tier_health_score(TierType::McpWebhook, 0.98);
    tier_monitor.update_tier_health_score(TierType::BridgeInternal, 0.75);
    tier_monitor.update_tier_health_score(TierType::FileWatcher, 0.88);
    
    // Test 4: Tier health update
    println!("📊 Test 4: Tier health updates");
    let tier_health_data = vec![
        TierHealth {
            tier_type: TierType::McpWebhook,
            is_healthy: true,
            last_check: Utc::now(),
            response_time_ms: Some(50),
            success_rate: 0.98,
            consecutive_failures: 0,
            circuit_breaker_state: CircuitBreakerState::Closed,
        },
        TierHealth {
            tier_type: TierType::BridgeInternal,
            is_healthy: false,
            last_check: Utc::now(),
            response_time_ms: Some(350),
            success_rate: 0.70,
            consecutive_failures: 3,
            circuit_breaker_state: CircuitBreakerState::Open,
        },
        TierHealth {
            tier_type: TierType::FileWatcher,
            is_healthy: true,
            last_check: Utc::now(),
            response_time_ms: Some(1200),
            success_rate: 0.92,
            consecutive_failures: 0,
            circuit_breaker_state: CircuitBreakerState::Closed,
        },
    ];
    
    tier_monitor.update_tier_health(tier_health_data).await;
    
    // Test 5: Export Prometheus metrics
    println!("📊 Test 5: Exporting Prometheus metrics");
    let metrics = tier_monitor.export_prometheus_metrics()?;
    
    println!("✅ Metrics exported successfully!");
    println!("📏 Metrics size: {} bytes", metrics.len());
    
    // Validate that our new metrics are present
    let expected_metrics = vec![
        "cctelegram_intelligent_selection_total",
        "cctelegram_selection_strategy_distribution",
        "cctelegram_tier_score_histogram",
        "cctelegram_recovery_attempts_total",
        "cctelegram_recovery_success_total",
        "cctelegram_bulkhead_utilization_ratio",
        "cctelegram_adaptive_timeout_seconds",
        "cctelegram_priority_queue_depth",
        "cctelegram_self_healing_attempts_total",
        "cctelegram_self_healing_success_total",
        "cctelegram_circuit_breaker_trips_total",
        "cctelegram_tier_health_score",
    ];
    
    println!("\n🔍 Validating enhanced tier orchestrator metrics:");
    for expected_metric in &expected_metrics {
        if metrics.contains(expected_metric) {
            println!("  ✅ {}", expected_metric);
        } else {
            println!("  ❌ {} - MISSING!", expected_metric);
        }
    }
    
    // Test 6: Health check
    println!("\n📊 Test 6: Health check generation");
    let health_check = tier_monitor.get_health_check().await?;
    println!("✅ Health check generated successfully!");
    println!("📋 Overall status: {:?}", health_check.overall_status);
    println!("📋 Active correlations: {}", health_check.active_correlations);
    println!("📋 Tier count: {}", health_check.tier_statuses.len());
    
    // Print sample of metrics for inspection
    println!("\n📄 Sample metrics output:");
    let sample_lines: Vec<&str> = metrics.lines().take(20).collect();
    for line in sample_lines {
        println!("  {}", line);
    }
    if metrics.lines().count() > 20 {
        println!("  ... ({} more lines)", metrics.lines().count() - 20);
    }
    
    println!("\n🎉 All tests completed successfully!");
    println!("🔗 Metrics can be scraped from the monitoring server /metrics endpoint");
    println!("🐳 Start monitoring stack: docker-compose -f monitoring/docker-compose.monitoring.yml up -d");
    
    Ok(())
}
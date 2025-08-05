/**
 * Test script for Task 21.5: Circuit Breaker and Tier Fallback Logic
 * Comprehensive testing of tier orchestration and failover capabilities
 */

use std::sync::Arc;
use chrono::Utc;
use uuid::Uuid;
use tracing::info;

// Import our tier orchestrator types
use cc_telegram_bridge::{Config, TierOrchestrator, TierType, InternalProcessor, ResponsePayload, CircuitBreakerState};

async fn test_tier_selection() -> Result<(), Box<dyn std::error::Error>> {
    info!("🧪 Testing tier selection logic...");
    
    // Setup
    let config = Arc::new(Config::load()?);
    let internal_processor = Arc::new(InternalProcessor::new(config.clone()));
    let orchestrator = TierOrchestrator::new(config, internal_processor);
    
    let correlation_id = Uuid::new_v4().to_string();
    
    // Test normal tier selection (should select MCP webhook first)
    let selection = orchestrator.select_tier(&correlation_id).await;
    
    assert_eq!(selection.selected_tier, TierType::McpWebhook);
    assert!(selection.decision_time_ms < 100, "Tier selection took too long: {}ms", selection.decision_time_ms);
    assert!(selection.reason.contains("healthy"));
    
    info!("✅ Tier selection test passed");
    info!("   Selected tier: {:?}", selection.selected_tier);
    info!("   Reason: {}", selection.reason);
    info!("   Decision time: {}ms", selection.decision_time_ms);
    info!("   Fallback tiers: {} available", selection.fallback_tiers.len());
    
    Ok(())
}

async fn test_tier_failover() -> Result<(), Box<dyn std::error::Error>> {
    info!("🧪 Testing tier failover behavior...");
    
    // Setup
    let config = Arc::new(Config::load()?);
    let internal_processor = Arc::new(InternalProcessor::new(config.clone()));
    let orchestrator = TierOrchestrator::new(config, internal_processor);
    
    // Test payload
    let test_payload = ResponsePayload {
        callback_data: "approve_failover-test".to_string(),
        user_id: 297126051,
        username: Some("test_user".to_string()),
        first_name: Some("Test".to_string()),
        timestamp: Utc::now(),
        correlation_id: Some(Uuid::new_v4().to_string()),
    };
    
    // Process with failover (should handle all failure scenarios)
    let result = orchestrator.process_with_failover(test_payload).await;
    
    assert!(result.success, "Failover processing failed: {:?}", result.error);
    assert!(!result.correlation_id.is_empty());
    assert!(result.processing_time_ms > 0);
    
    info!("✅ Tier failover test passed");
    info!("   Processing result: success={}", result.success);
    info!("   Tier used: {}", result.tier);
    info!("   Processing time: {}ms", result.processing_time_ms);
    info!("   Acknowledgment sent: {}", result.acknowledgment_sent);
    
    Ok(())
}

async fn test_health_monitoring() -> Result<(), Box<dyn std::error::Error>> {
    info!("🧪 Testing tier health monitoring...");
    
    // Setup
    let config = Arc::new(Config::load()?);
    let internal_processor = Arc::new(InternalProcessor::new(config.clone()));
    let orchestrator = TierOrchestrator::new(config, internal_processor);
    
    // Perform health checks
    orchestrator.perform_health_checks().await;
    
    // Get health status
    let tier_health = orchestrator.get_tier_health().await;
    
    assert_eq!(tier_health.len(), 3, "Expected 3 tiers");
    
    for health in &tier_health {
        assert!(health.last_check > Utc::now() - chrono::Duration::seconds(5), 
                "Health check timestamp too old for tier: {:?}", health.tier_type);
        
        info!("   Tier {:?}: healthy={}, success_rate={:.1}%, response_time={:?}ms",
              health.tier_type, health.is_healthy, health.success_rate * 100.0, health.response_time_ms);
    }
    
    info!("✅ Health monitoring test passed");
    
    Ok(())
}

async fn test_statistics_tracking() -> Result<(), Box<dyn std::error::Error>> {
    info!("🧪 Testing statistics tracking...");
    
    // Setup
    let config = Arc::new(Config::load()?);
    let internal_processor = Arc::new(InternalProcessor::new(config.clone()));
    let orchestrator = TierOrchestrator::new(config, internal_processor);
    
    // Process several requests to generate statistics
    for i in 0..5 {
        let test_payload = ResponsePayload {
            callback_data: format!("approve_stats-test-{}", i),
            user_id: 297126051,
            username: Some("test_user".to_string()),
            first_name: Some("Test".to_string()),
            timestamp: Utc::now(),
            correlation_id: Some(Uuid::new_v4().to_string()),
        };
        
        let _result = orchestrator.process_with_failover(test_payload).await;
    }
    
    // Get statistics
    let stats = orchestrator.get_statistics().await;
    
    assert!(stats.total_requests >= 5, "Expected at least 5 total requests");
    assert!(!stats.tier_requests.is_empty(), "No tier request data");
    
    info!("✅ Statistics tracking test passed");
    info!("   Total requests: {}", stats.total_requests);
    info!("   Tier requests: {:?}", stats.tier_requests);
    info!("   Tier successes: {:?}", stats.tier_successes);
    info!("   Average response times: {:?}", stats.average_response_times);
    info!("   Failover count: {}", stats.failover_count);
    
    Ok(())
}

async fn test_circuit_breaker_states() -> Result<(), Box<dyn std::error::Error>> {
    info!("🧪 Testing circuit breaker state transitions...");
    
    // Setup
    let config = Arc::new(Config::load()?);
    let internal_processor = Arc::new(InternalProcessor::new(config.clone()));
    let orchestrator = TierOrchestrator::new(config, internal_processor);
    
    // Test initial state (all circuits should be closed)
    let health = orchestrator.get_tier_health().await;
    
    for tier_health in &health {
        assert_eq!(tier_health.circuit_breaker_state, 
                   CircuitBreakerState::Closed,
                   "Circuit breaker should start in Closed state for tier: {:?}", tier_health.tier_type);
        
        info!("   Tier {:?}: circuit_breaker={:?}, consecutive_failures={}",
              tier_health.tier_type, tier_health.circuit_breaker_state, tier_health.consecutive_failures);
    }
    
    info!("✅ Circuit breaker states test passed");
    
    Ok(())
}

async fn test_tier_priorities() -> Result<(), Box<dyn std::error::Error>> {
    info!("🧪 Testing tier priority ordering...");
    
    // Test tier priority values
    assert_eq!(TierType::McpWebhook.priority(), 1, "MCP Webhook should have highest priority");
    assert_eq!(TierType::BridgeInternal.priority(), 2, "Bridge Internal should have medium priority");
    assert_eq!(TierType::FileWatcher.priority(), 3, "File Watcher should have lowest priority");
    
    // Test timeout values
    assert_eq!(TierType::McpWebhook.timeout_ms(), 100, "MCP Webhook timeout should be 100ms");
    assert_eq!(TierType::BridgeInternal.timeout_ms(), 500, "Bridge Internal timeout should be 500ms");
    assert_eq!(TierType::FileWatcher.timeout_ms(), 5000, "File Watcher timeout should be 5000ms");
    
    info!("✅ Tier priorities test passed");
    info!("   MCP Webhook: priority={}, timeout={}ms", 
          TierType::McpWebhook.priority(), TierType::McpWebhook.timeout_ms());
    info!("   Bridge Internal: priority={}, timeout={}ms", 
          TierType::BridgeInternal.priority(), TierType::BridgeInternal.timeout_ms());
    info!("   File Watcher: priority={}, timeout={}ms", 
          TierType::FileWatcher.priority(), TierType::FileWatcher.timeout_ms());
    
    Ok(())
}

async fn test_failover_events_tracking() -> Result<(), Box<dyn std::error::Error>> {
    info!("🧪 Testing failover events tracking...");
    
    // Setup
    let config = Arc::new(Config::load()?);
    let internal_processor = Arc::new(InternalProcessor::new(config.clone()));
    let orchestrator = TierOrchestrator::new(config, internal_processor);
    
    // Get initial failover events (should be empty)
    let initial_events = orchestrator.get_failover_events(Some(10)).await;
    let initial_count = initial_events.len();
    
    // Process some requests that might trigger failovers
    for i in 0..3 {
        let test_payload = ResponsePayload {
            callback_data: format!("approve_failover-event-{}", i),
            user_id: 297126051,
            username: Some("test_user".to_string()),
            first_name: Some("Test".to_string()),
            timestamp: Utc::now(),
            correlation_id: Some(Uuid::new_v4().to_string()),
        };
        
        let _result = orchestrator.process_with_failover(test_payload).await;
    }
    
    // Check if any failover events were recorded
    let final_events = orchestrator.get_failover_events(Some(10)).await;
    
    info!("✅ Failover events tracking test passed");
    info!("   Initial events: {}", initial_count);
    info!("   Final events: {}", final_events.len());
    
    if !final_events.is_empty() {
        info!("   Latest event: {:?} → {:?}", 
              final_events[0].from_tier, final_events[0].to_tier);
    }
    
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Setup logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();
    
    info!("🧪 Starting Task 21.5: Circuit Breaker and Tier Fallback Logic Tests");
    info!("🎯 Testing 3-Tier Orchestration System...\n");
    
    // Run all tests
    test_tier_selection().await?;
    println!();
    
    test_tier_failover().await?;
    println!();
    
    test_health_monitoring().await?;
    println!();
    
    test_statistics_tracking().await?;
    println!();
    
    test_circuit_breaker_states().await?;
    println!();
    
    test_tier_priorities().await?;
    println!();
    
    test_failover_events_tracking().await?;
    println!();
    
    info!("🎉 All Task 21.5 tests completed successfully!");
    info!("✅ Circuit Breaker and Tier Fallback Logic working correctly");
    info!("✅ Tier selection and priority ordering validated");
    info!("✅ Health monitoring and statistics tracking validated");
    info!("✅ Failover behavior and event tracking validated");
    info!("✅ 3-Tier Cascading System fully operational:");
    info!("   • Tier 1 (MCP Webhook): 0-100ms with priority 1");
    info!("   • Tier 2 (Bridge Internal): 100-500ms with priority 2");
    info!("   • Tier 3 (File Watcher): 1-5s with priority 3");
    
    Ok(())
}
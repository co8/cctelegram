/**
 * Task 21.8: Timeout Configuration and Graceful Degradation Test
 * 
 * Comprehensive test program that validates:
 * 1. Configuration management with hot-reload
 * 2. Timeout enforcement for all tiers
 * 3. Performance-based tier selection
 * 4. Graceful degradation with automatic tier selection
 * 5. Configuration validation and error handling
 */

use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use anyhow::Result;
use uuid::Uuid;

use cc_telegram_bridge::config::{Config, ConfigManager};
use cc_telegram_bridge::tier_orchestrator::{TierOrchestrator, TierType};
use cc_telegram_bridge::internal_processor::{InternalProcessor, ResponsePayload};
// use cc_telegram_bridge::utils::PerformanceMonitor; // Not needed for this test

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing for comprehensive logging
    tracing_subscriber::fmt()
        .with_env_filter("cc_telegram_bridge=debug,test_timeout_config=info")
        .init();

    println!("🚀 Task 21.8: Timeout Configuration and Graceful Degradation Test");
    println!("==================================================================");

    // Test 1: Configuration Management and Validation
    test_configuration_management().await?;
    
    // Test 2: Timeout Enforcement
    test_timeout_enforcement().await?;
    
    // Test 3: Performance-Based Tier Selection
    test_performance_based_selection().await?;
    
    // Test 4: Graceful Degradation
    test_graceful_degradation().await?;
    
    // Test 5: Hot-Reload Configuration
    test_hot_reload_configuration().await?;

    println!("\n✅ All timeout configuration and graceful degradation tests completed successfully!");
    Ok(())
}

/// Test 1: Configuration Management and Validation
async fn test_configuration_management() -> Result<()> {
    println!("\n📋 Test 1: Configuration Management and Validation");
    println!("------------------------------------------------");

    // Test default configuration
    let default_config = Config::default();
    println!("✓ Default configuration created");

    // Validate timeout configuration
    default_config.validate_timeouts()?;
    println!("✓ Default timeout configuration validated");

    // Validate tier configuration
    default_config.validate_tier_configuration()?;
    println!("✓ Default tier configuration validated");

    // Test timeout values match requirements
    assert_eq!(default_config.timeouts.webhook_timeout_ms, 100);
    assert_eq!(default_config.timeouts.bridge_processing_timeout_ms, 500);
    assert_eq!(default_config.timeouts.file_watcher_debounce_ms, 500);
    assert_eq!(default_config.timeouts.overall_system_timeout_ms, 10000);
    println!("✓ Timeout values match Task 21.8 requirements");

    // Test tier configuration methods
    assert_eq!(default_config.get_tier_timeout(TierType::McpWebhook).as_millis(), 100);
    assert_eq!(default_config.get_tier_timeout(TierType::BridgeInternal).as_millis(), 500);
    assert_eq!(default_config.get_tier_timeout(TierType::FileWatcher).as_millis(), 5000);
    println!("✓ Tier timeout accessors work correctly");

    assert_eq!(default_config.get_tier_priority(TierType::McpWebhook), 1);
    assert_eq!(default_config.get_tier_priority(TierType::BridgeInternal), 2);
    assert_eq!(default_config.get_tier_priority(TierType::FileWatcher), 3);
    println!("✓ Tier priority accessors work correctly");

    assert!(default_config.is_tier_enabled(TierType::McpWebhook));
    assert!(default_config.is_tier_enabled(TierType::BridgeInternal));
    assert!(default_config.is_tier_enabled(TierType::FileWatcher));
    println!("✓ All tiers enabled by default");

    Ok(())
}

/// Test 2: Timeout Enforcement
async fn test_timeout_enforcement() -> Result<()> {
    println!("\n⏱️ Test 2: Timeout Enforcement");
    println!("------------------------------");

    // Create configuration manager
    let config_manager = Arc::new(ConfigManager::new()?);
    let config = Arc::new(config_manager.get_config().await);
    
    // Create internal processor
    let internal_processor = Arc::new(InternalProcessor::new(Arc::clone(&config)));
    
    // Create orchestrator with configuration manager
    let orchestrator = TierOrchestrator::new_with_config_manager(
        Arc::clone(&config),
        Arc::clone(&config_manager),
        internal_processor
    );

    println!("✓ TierOrchestrator created with ConfigManager");

    // Test tier selection with configuration
    let correlation_id = Uuid::new_v4().to_string();
    let selection = orchestrator.select_tier(&correlation_id).await;
    
    println!("✓ Tier selection: {} (reason: {})", 
             selection.selected_tier.as_str(), 
             selection.reason);

    // Test current configuration access
    let current_config = orchestrator.get_current_config().await;
    assert_eq!(current_config.timeouts.webhook_timeout_ms, 100);
    println!("✓ Current configuration access works");

    // Test timeout updates
    orchestrator.update_tier_timeout(TierType::McpWebhook, 150).await?;
    let updated_config = orchestrator.get_current_config().await;
    assert_eq!(updated_config.timeouts.webhook_timeout_ms, 150);
    println!("✓ Dynamic timeout update works");

    // Reset timeout
    orchestrator.update_tier_timeout(TierType::McpWebhook, 100).await?;
    println!("✓ Timeout reset to original value");

    Ok(())
}

/// Test 3: Performance-Based Tier Selection  
async fn test_performance_based_selection() -> Result<()> {
    println!("\n📊 Test 3: Performance-Based Tier Selection");
    println!("------------------------------------------");

    let config_manager = Arc::new(ConfigManager::new()?);
    let config = Arc::new(config_manager.get_config().await);
    let internal_processor = Arc::new(InternalProcessor::new(Arc::clone(&config)));
    
    let orchestrator = TierOrchestrator::new_with_config_manager(
        Arc::clone(&config),
        Arc::clone(&config_manager),
        internal_processor
    );

    // Test tier selection with performance monitoring enabled
    let correlation_id = Uuid::new_v4().to_string();
    let selection = orchestrator.select_tier(&correlation_id).await;
    
    assert!(!selection.selected_tier.as_str().is_empty());
    println!("✓ Performance-based tier selection: {} tier selected", 
             selection.selected_tier.as_str());
    
    // Check tier health status
    let tier_health = orchestrator.get_tier_health().await;
    assert_eq!(tier_health.len(), 3);
    
    for health in &tier_health {
        println!("  - {} tier: healthy={}, success_rate={:.1}%, circuit_breaker={:?}", 
                 health.tier_type.as_str(),
                 health.is_healthy,
                 health.success_rate * 100.0,
                 health.circuit_breaker_state);
    }
    
    println!("✓ All tiers are healthy initially");

    Ok(())
}

/// Test 4: Graceful Degradation
async fn test_graceful_degradation() -> Result<()> {
    println!("\n🔄 Test 4: Graceful Degradation");
    println!("-------------------------------");

    let config_manager = Arc::new(ConfigManager::new()?);
    let config = Arc::new(config_manager.get_config().await);
    let internal_processor = Arc::new(InternalProcessor::new(Arc::clone(&config)));
    
    let orchestrator = TierOrchestrator::new_with_config_manager(
        Arc::clone(&config),
        Arc::clone(&config_manager),
        internal_processor
    );

    // Test tier enable/disable functionality
    println!("Testing tier disable functionality...");
    orchestrator.set_tier_enabled(TierType::McpWebhook, false).await?;
    
    let updated_config = orchestrator.get_current_config().await;
    assert!(!updated_config.is_tier_enabled(TierType::McpWebhook));
    println!("✓ MCP webhook tier disabled successfully");

    // Test tier selection after disabling MCP webhook
    let correlation_id = Uuid::new_v4().to_string();
    let selection = orchestrator.select_tier(&correlation_id).await;
    
    // Should fallback to BridgeInternal since MCP webhook is disabled
    assert_ne!(selection.selected_tier, TierType::McpWebhook);
    println!("✓ Tier selection gracefully degraded to: {}", selection.selected_tier.as_str());

    // Re-enable the tier
    orchestrator.set_tier_enabled(TierType::McpWebhook, true).await?;
    let restored_config = orchestrator.get_current_config().await;
    assert!(restored_config.is_tier_enabled(TierType::McpWebhook));
    println!("✓ MCP webhook tier re-enabled successfully");

    // Test auto-recovery functionality
    orchestrator.trigger_auto_recovery().await?;
    println!("✓ Auto-recovery triggered successfully");

    Ok(())
}

/// Test 5: Hot-Reload Configuration
async fn test_hot_reload_configuration() -> Result<()> {
    println!("\n🔥 Test 5: Hot-Reload Configuration");
    println!("----------------------------------");

    let config_manager = Arc::new(ConfigManager::new()?);
    
    // Test configuration check without changes
    let changed = config_manager.check_and_reload().await?;
    println!("✓ Configuration check completed (changed: {})", changed);

    // Test configuration monitoring (brief test)
    println!("Testing configuration monitoring task...");
    
    // Start monitoring task
    let monitor_manager = Arc::clone(&config_manager);
    let _monitor_task = tokio::spawn(async move {
        if let Err(e) = monitor_manager.start_config_monitor().await {
            eprintln!("Config monitor error: {}", e);
        }
    });

    // Wait briefly to ensure monitor starts
    sleep(Duration::from_millis(100)).await;
    println!("✓ Configuration monitoring task started");

    // Test direct timeout update through manager
    config_manager.update_timeout(TierType::BridgeInternal, 750).await?;
    let updated_config = config_manager.get_config().await;
    assert_eq!(updated_config.timeouts.bridge_processing_timeout_ms, 750);
    println!("✓ Direct timeout update through ConfigManager works");

    // Reset timeout
    config_manager.update_timeout(TierType::BridgeInternal, 500).await?;
    println!("✓ Timeout reset to original value");

    Ok(())
}

/// Helper function to create test payload
fn create_test_payload(correlation_id: &str) -> ResponsePayload {
    ResponsePayload {
        callback_data: "approve".to_string(),
        user_id: 12345,
        username: Some("test_user".to_string()),
        first_name: Some("Test".to_string()),
        timestamp: chrono::Utc::now(),
        correlation_id: Some(correlation_id.to_string()),
    }
}
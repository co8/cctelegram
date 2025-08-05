/**
 * Test script for Task 21.4: Bridge Internal Processing
 * Tests the Tier 2 fallback system functionality
 */

use std::sync::Arc;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::config::Config;
use crate::internal_processor::{InternalProcessor, ResponsePayload, ProcessingResult};

#[tokio::test]
async fn test_internal_processor_basic_functionality() {
    // Setup
    let config = Arc::new(Config::load().expect("Failed to load config"));
    let processor = InternalProcessor::new(config);
    
    // Test payload
    let test_payload = ResponsePayload {
        callback_data: "approve_deployment-v3.0.0".to_string(),
        user_id: 297126051,
        username: Some("enriqueco8".to_string()),
        first_name: Some("Enrique".to_string()),
        timestamp: Utc::now(),
        correlation_id: Some(Uuid::new_v4().to_string()),
    };
    
    // Process the response
    let result = processor.process_response(test_payload).await;
    
    // Verify results
    assert_eq!(result.action, "approve");
    assert_eq!(result.task_id, "deployment-v3.0.0");
    assert_eq!(result.tier, "bridge_internal");
    assert!(result.processing_time_ms > 0);
    
    println!("✅ Basic functionality test passed");
    println!("   Action: {}", result.action);
    println!("   Task ID: {}", result.task_id);
    println!("   Processing time: {}ms", result.processing_time_ms);
}

#[tokio::test]
async fn test_callback_data_parsing() {
    let config = Arc::new(Config::load().expect("Failed to load config"));
    let processor = InternalProcessor::new(config);
    
    let test_cases = vec![
        ("approve_task-123", "approve", "task-123"),
        ("deny_feature-abc", "deny", "feature-abc"),
        ("ack_deployment-v2", "acknowledge", "deployment-v2"),
        ("details_bug-fix-456", "details", "bug-fix-456"),
        ("unknown_action", "unknown", "unknown_action"),
    ];
    
    for (callback_data, expected_action, expected_task_id) in test_cases {
        let action = processor.parse_callback_data(callback_data);
        assert_eq!(action.action_type.as_str(), expected_action);
        assert_eq!(action.task_id, expected_task_id);
    }
    
    println!("✅ Callback data parsing test passed");
}

#[tokio::test]
async fn test_performance_targets() {
    let config = Arc::new(Config::load().expect("Failed to load config"));
    let processor = InternalProcessor::new(config);
    
    let test_payload = ResponsePayload {
        callback_data: "approve_performance-test".to_string(),
        user_id: 297126051,
        username: Some("test_user".to_string()),
        first_name: Some("Test".to_string()),
        timestamp: Utc::now(),
        correlation_id: Some(Uuid::new_v4().to_string()),
    };
    
    let start_time = std::time::Instant::now();
    let result = processor.process_response(test_payload).await;
    let total_time = start_time.elapsed().as_millis();
    
    // Tier 2 should process within 100-500ms target range
    assert!(total_time < 500, "Processing time {}ms exceeds 500ms target", total_time);
    assert!(result.processing_time_ms < 500, "Internal processing time {}ms exceeds 500ms target", result.processing_time_ms);
    
    println!("✅ Performance targets test passed");
    println!("   Total time: {}ms", total_time);
    println!("   Internal processing time: {}ms", result.processing_time_ms);
    println!("   Within Tier 2 target (100-500ms): {}", total_time >= 100 && total_time <= 500);
}

pub async fn run_all_tests() {
    println!("🧪 Running Internal Processor Tests (Task 21.4)...\n");
    
    test_internal_processor_basic_functionality().await;
    test_callback_data_parsing().await;
    test_performance_targets().await;
    
    println!("\n🎉 All Internal Processor tests completed successfully!");
    println!("✅ Tier 2 Bridge Internal Processing is working correctly");
}
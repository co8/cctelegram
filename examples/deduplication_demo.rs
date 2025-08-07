use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::info;

use cc_telegram_bridge::{
    MessageDeduplicationSystem, DeduplicationConfig, DeduplicationResult, 
    DeduplicationMiddleware, events::types::{Event, EventType, EventData, ProcessingStatus}
};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use std::collections::HashMap;

/// Helper function to create a properly structured Event for testing
fn create_test_event(
    task_id: &str,
    event_type: EventType,
    title: &str,
    description: &str,
    source: &str,
    data: Option<HashMap<String, serde_json::Value>>,
) -> Event {
    Event {
        event_id: Uuid::new_v4().to_string(),
        event_type,
        source: source.to_string(),
        timestamp: Utc::now(),
        task_id: task_id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        data: EventData {
            status: None,
            results: None,
            exit_code: None,
            success: None,
            file_path: None,
            files_affected: None,
            directory: None,
            line_number: None,
            language: None,
            function_name: None,
            class_name: None,
            module_name: None,
            code_snippet: None,
            commit_hash: None,
            branch_name: None,
            author: None,
            commit_message: None,
            files_changed: None,
            build_target: None,
            test_count: None,
            tests_passed: None,
            tests_failed: None,
            coverage_percentage: None,
            duration_ms: None,
            memory_usage_mb: None,
            cpu_usage_percent: None,
            disk_usage_mb: None,
            network_bytes: None,
            error_message: None,
            error_code: None,
            stack_trace: None,
            severity: None,
            approval_prompt: None,
            options: None,
            user_id: None,
            command: None,
            arguments: None,
            priority: None,
            category: None,
            tags: None,
            url: None,
            actions: None,
            service_name: None,
            endpoint: None,
            request_id: None,
            response_code: None,
            metadata: data,
        },
        correlation_id: None,
        parent_event_id: None,
        retry_count: 0,
        processing_status: ProcessingStatus::Pending,
        schema_version: "1.0".to_string(),
        created_at: Utc::now(),
        processed_at: None,
    }
}

/// Comprehensive demonstration of the Message Deduplication System
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();
    
    info!("Starting Message Deduplication System Demo");
    
    // Demo 1: Basic duplicate detection
    demo_basic_deduplication().await?;
    
    // Demo 2: Content normalization and similarity detection
    demo_similarity_detection().await?;
    
    // Demo 3: Time window expiration
    demo_time_window_expiration().await?;
    
    // Demo 4: Middleware integration
    demo_middleware_integration().await?;
    
    // Demo 5: Performance and statistics
    demo_performance_statistics().await?;
    
    info!("Message Deduplication System Demo completed");
    Ok(())
}

/// Demo 1: Basic duplicate detection functionality
async fn demo_basic_deduplication() -> anyhow::Result<()> {
    info!("=== Demo 1: Basic Duplicate Detection ===");
    
    // Configure deduplication system
    let config = DeduplicationConfig {
        database_path: "demo_dedup_basic.db".to_string(),
        deduplication_window_seconds: 300, // 5 minutes
        cleanup_interval_hours: 1,
        max_connections: 2,
        enable_content_normalization: true,
        enable_similar_detection: false,
        similarity_threshold: 0.8,
        cache_size_limit: 100,
    };
    
    // Initialize deduplication system
    let system = MessageDeduplicationSystem::new(config).await?;
    let chat_id = 12345i64;
    
    // Create sample events
    let mut metadata1 = HashMap::new();
    metadata1.insert("duration".to_string(), serde_json::json!("45s"));
    metadata1.insert("artifacts".to_string(), serde_json::json!(12));
    
    let event1 = create_test_event(
        "build_task_1",
        EventType::BuildCompleted,
        "Frontend Build Complete",
        "Frontend build completed successfully",
        "build_system",
        Some(metadata1),
    );
    
    let event2 = event1.clone(); // Exact duplicate
    
    let mut metadata3 = HashMap::new();
    metadata3.insert("error_count".to_string(), serde_json::json!(5));
    
    let event3 = create_test_event(
        "build_task_2",
        EventType::BuildFailed,
        "Backend Build Failed",
        "Backend build failed with compilation errors",
        "build_system",
        Some(metadata3),
    );
    
    // Check first event (should be unique)
    let result1 = system.check_duplicate(&event1, chat_id).await?;
    info!("Event 1 result: {:?}", result1);
    assert!(matches!(result1, DeduplicationResult::Unique(_)));
    
    // Check duplicate event (should be detected)
    let result2 = system.check_duplicate(&event2, chat_id).await?;
    info!("Event 2 result: {:?}", result2);
    assert!(matches!(result2, DeduplicationResult::Duplicate { .. }));
    
    if let DeduplicationResult::Duplicate { duplicate_count, .. } = result2 {
        info!("Duplicate detected with count: {}", duplicate_count);
    }
    
    // Check different event (should be unique)
    let result3 = system.check_duplicate(&event3, chat_id).await?;
    info!("Event 3 result: {:?}", result3);
    assert!(matches!(result3, DeduplicationResult::Unique(_)));
    
    // Get statistics
    let stats = system.get_stats().await;
    info!("Basic Deduplication Stats: {:?}", stats);
    assert_eq!(stats.messages_processed, 3);
    assert_eq!(stats.unique_messages, 2);
    assert_eq!(stats.duplicates_detected, 1);
    
    // Clean up
    std::fs::remove_file("demo_dedup_basic.db").ok();
    
    Ok(())
}

/// Demo 2: Content normalization and similarity detection
async fn demo_similarity_detection() -> anyhow::Result<()> {
    info!("=== Demo 2: Similarity Detection ===");
    
    let config = DeduplicationConfig {
        database_path: "demo_dedup_similarity.db".to_string(),
        deduplication_window_seconds: 600,
        cleanup_interval_hours: 1,
        max_connections: 2,
        enable_content_normalization: true,
        enable_similar_detection: true, // Enable similarity detection
        similarity_threshold: 0.7,
        cache_size_limit: 100,
    };
    
    let system = MessageDeduplicationSystem::new(config).await?;
    let chat_id = 67890i64;
    
    // Create similar events
    let event1 = create_test_event(
        "test_task_1",
        EventType::TaskCompletion,
        "Test Task Complete",
        "Task completed successfully with 5 tests passing",
        "test_runner",
        None,
    );
    
    let event2 = create_test_event(
        "test_task_2", 
        EventType::TaskCompletion,
        "Test Task Complete",
        "Task completed successfully with 3 tests passing",
        "test_runner",
        None,
    );
    
    let event3 = create_test_event(
        "deploy_task",
        EventType::CodeDeployment,
        "Deployment Complete",
        "Application deployed to production environment",
        "deploy_system", 
        None,
    );
    
    // First event should be unique
    let result1 = system.check_duplicate(&event1, chat_id).await?;
    info!("Similar Event 1 result: {:?}", result1);
    assert!(matches!(result1, DeduplicationResult::Unique(_)));
    
    // Similar event should be detected
    let result2 = system.check_duplicate(&event2, chat_id).await?;
    info!("Similar Event 2 result: {:?}", result2);
    
    // Different event should be unique
    let result3 = system.check_duplicate(&event3, chat_id).await?;
    info!("Different Event 3 result: {:?}", result3);
    assert!(matches!(result3, DeduplicationResult::Unique(_)));
    
    let stats = system.get_stats().await;
    info!("Similarity Detection Stats: {:?}", stats);
    
    // Clean up
    std::fs::remove_file("demo_dedup_similarity.db").ok();
    
    Ok(())
}

/// Demo 3: Time window expiration functionality
async fn demo_time_window_expiration() -> anyhow::Result<()> {
    info!("=== Demo 3: Time Window Expiration ===");
    
    let config = DeduplicationConfig {
        database_path: "demo_dedup_expiration.db".to_string(),
        deduplication_window_seconds: 2, // Very short window for demo
        cleanup_interval_hours: 1,
        max_connections: 2,
        enable_content_normalization: true,
        enable_similar_detection: false,
        similarity_threshold: 0.8,
        cache_size_limit: 100,
    };
    
    let system = MessageDeduplicationSystem::new(config).await?;
    let chat_id = 11111i64;
    
    let event = create_test_event(
        "expiration_test",
        EventType::CustomEvent,
        "Expiration Test",
        "Test event for expiration demo",
        "test_system",
        None,
    );
    
    // First check - should be unique
    let result1 = system.check_duplicate(&event, chat_id).await?;
    info!("Before expiration: {:?}", result1);
    assert!(matches!(result1, DeduplicationResult::Unique(_)));
    
    // Immediate second check - should be duplicate
    let result2 = system.check_duplicate(&event, chat_id).await?;
    info!("Immediate duplicate: {:?}", result2);
    assert!(matches!(result2, DeduplicationResult::Duplicate { .. }));
    
    // Wait for expiration
    info!("Waiting for deduplication window to expire...");
    sleep(Duration::from_secs(3)).await;
    
    // After expiration - should be unique again
    let result3 = system.check_duplicate(&event, chat_id).await?;
    info!("After expiration: {:?}", result3);
    assert!(matches!(result3, DeduplicationResult::Unique(_)));
    
    let stats = system.get_stats().await;
    info!("Expiration Demo Stats: {:?}", stats);
    
    // Test cleanup
    let cleaned = system.cleanup_expired_entries().await?;
    info!("Cleaned up {} expired entries", cleaned);
    
    // Clean up
    std::fs::remove_file("demo_dedup_expiration.db").ok();
    
    Ok(())
}

/// Demo 4: Middleware integration
async fn demo_middleware_integration() -> anyhow::Result<()> {
    info!("=== Demo 4: Middleware Integration ===");
    
    let config = DeduplicationConfig {
        database_path: "demo_dedup_middleware.db".to_string(),
        deduplication_window_seconds: 300,
        cleanup_interval_hours: 1,
        max_connections: 2,
        enable_content_normalization: true,
        enable_similar_detection: true,
        similarity_threshold: 0.8,
        cache_size_limit: 100,
    };
    
    let system = Arc::new(MessageDeduplicationSystem::new(config).await?);
    
    // Create middleware with similarity bypass disabled
    let middleware = DeduplicationMiddleware::new(system.clone());
    
    // Create middleware with similarity bypass enabled
    let middleware_bypass = DeduplicationMiddleware::new(system.clone())
        .with_similarity_bypass(true);
    
    let chat_id = 22222i64;
    
    let event1 = create_test_event(
        "middleware_test_1",
        EventType::BuildCompleted,
        "Build Complete",
        "Build completed successfully in 30 seconds",
        "build_system",
        None,
    );
    
    let event2 = create_test_event(
        "middleware_test_2",
        EventType::BuildCompleted,
        "Build Complete", 
        "Build completed successfully in 25 seconds",
        "build_system",
        None,
    );
    
    // Process through standard middleware
    let result1 = middleware.process(&event1, chat_id).await?;
    info!("Middleware result 1: {:?}", result1);
    assert!(matches!(result1, DeduplicationResult::Unique(_)));
    
    let result2 = middleware.process(&event2, chat_id).await?;
    info!("Middleware result 2 (similar, blocked): {:?}", result2);
    
    // Process similar event through bypass middleware
    let result3 = middleware_bypass.process(&event2, chat_id).await?;
    info!("Middleware bypass result 3 (similar, allowed): {:?}", result3);
    assert!(matches!(result3, DeduplicationResult::Unique(_)));
    
    let stats = middleware.get_stats().await;
    info!("Middleware Integration Stats: {:?}", stats);
    
    // Clean up
    std::fs::remove_file("demo_dedup_middleware.db").ok();
    
    Ok(())
}

/// Demo 5: Performance and statistics
async fn demo_performance_statistics() -> anyhow::Result<()> {
    info!("=== Demo 5: Performance and Statistics ===");
    
    let config = DeduplicationConfig {
        database_path: "demo_dedup_performance.db".to_string(),
        deduplication_window_seconds: 600,
        cleanup_interval_hours: 1,
        max_connections: 3,
        enable_content_normalization: true,
        enable_similar_detection: true,
        similarity_threshold: 0.8,
        cache_size_limit: 50,
    };
    
    let system = MessageDeduplicationSystem::new(config).await?;
    let chat_id = 33333i64;
    
    // Generate multiple events for performance testing
    let start_time = std::time::Instant::now();
    let mut unique_count = 0;
    let mut duplicate_count = 0;
    let mut similar_count = 0;
    
    for i in 0..100 {
        let event = if i % 10 == 0 {
            // Unique event
            let mut metadata = HashMap::new();
            metadata.insert("index".to_string(), serde_json::json!(i));
            create_test_event(
                &format!("unique_task_{}", i),
                EventType::CustomEvent,
                "Unique Event",
                &format!("Unique event number {}", i),
                "performance_test",
                Some(metadata),
            )
        } else if i % 5 == 0 {
            // Similar event
            create_test_event(
                &format!("similar_task_{}", i),
                EventType::BuildCompleted,
                "Build Complete",
                &format!("Build completed successfully with {} artifacts", i % 5 + 1),
                "build_system",
                None,
            )
        } else {
            // Duplicate event
            create_test_event(
                "duplicate_task",
                EventType::CustomEvent,
                "Duplicate Test",
                "This is a duplicate test event",
                "test_system",
                None,
            )
        };
        
        let result = system.check_duplicate(&event, chat_id).await?;
        match result {
            DeduplicationResult::Unique(_) => unique_count += 1,
            DeduplicationResult::Duplicate { .. } => duplicate_count += 1,
            DeduplicationResult::Similar { .. } => similar_count += 1,
        }
    }
    
    let processing_time = start_time.elapsed();
    info!("Processed 100 events in {:?}", processing_time);
    info!("Performance results: {} unique, {} duplicates, {} similar", 
          unique_count, duplicate_count, similar_count);
    
    // Get comprehensive statistics
    let stats = system.get_stats().await;
    info!("Final Performance Stats:");
    info!("  Messages processed: {}", stats.messages_processed);
    info!("  Unique messages: {}", stats.unique_messages);
    info!("  Duplicates detected: {}", stats.duplicates_detected);
    info!("  Similar messages detected: {}", stats.similar_messages_detected);
    info!("  Cache hits: {}", stats.cache_hits);
    info!("  Cache misses: {}", stats.cache_misses);
    info!("  Cache size: {}", stats.cache_size);
    info!("  Cleanup operations: {}", stats.cleanup_operations);
    
    // Test cache refresh
    info!("Testing cache refresh...");
    system.refresh_cache().await?;
    
    let refreshed_stats = system.get_stats().await;
    info!("Cache size after refresh: {}", refreshed_stats.cache_size);
    
    // Clean up
    std::fs::remove_file("demo_dedup_performance.db").ok();
    
    Ok(())
}
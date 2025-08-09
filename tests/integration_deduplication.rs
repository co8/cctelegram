use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;
use chrono::Utc;
use std::collections::HashMap;

use cc_telegram_bridge::{
    MessageDeduplicationSystem, DeduplicationConfig, DeduplicationResult, DeduplicationMiddleware,
    MessagePersistenceSystem, MessagePersistenceConfig, PersistentMessageQueue, 
    PersistentQueueConfig, EventQueue, EventProcessor,
    events::types::{Event, EventType, EventData, ProcessingStatus}
};

/// Helper function to create a properly structured Event for integration testing
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

#[tokio::test]
async fn test_deduplication_with_persistence_integration() {
    // Initialize tracing for test debugging
    let _ = tracing_subscriber::fmt::try_init();

    let test_id = Uuid::new_v4().to_string();
    let dedup_db = format!("test_dedup_integration_{}.db", test_id);
    let persistence_db = format!("test_persistence_integration_{}.db", test_id);
    
    // Setup deduplication system
    let dedup_config = DeduplicationConfig {
        database_path: dedup_db.clone(),
        deduplication_window_seconds: 300, // 5 minutes
        cleanup_interval_hours: 1,
        max_connections: 2,
        enable_content_normalization: true,
        enable_similar_detection: true,
        similarity_threshold: 0.8,
        cache_size_limit: 100,
    };
    
    let deduplication_system = Arc::new(
        MessageDeduplicationSystem::new(dedup_config).await.unwrap()
    );
    
    // Setup persistence system
    let persistence_config = MessagePersistenceConfig {
        database_path: persistence_db.clone(),
        retention_days: 30,
        max_connections: 5,
        cleanup_interval_hours: 24,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 3,
        batch_size: 100,
    };
    
    let persistence_system = Arc::new(
        MessagePersistenceSystem::new(persistence_config).await.unwrap()
    );
    
    let chat_id = 12345i64;
    
    // Test 1: Basic deduplication integration
    let event1 = create_test_event(
        "integration_test_1",
        EventType::BuildCompleted,
        "Build Complete",
        "Frontend build completed successfully",
        "build_system",
        None,
    );
    
    // Check deduplication first
    let dedup_result1 = deduplication_system.check_duplicate(&event1, chat_id).await.unwrap();
    assert!(matches!(dedup_result1, DeduplicationResult::Unique(_)));
    
    // Store in persistence system if unique
    if matches!(dedup_result1, DeduplicationResult::Unique(_)) {
        persistence_system.store_message(&event1, chat_id).await.unwrap();
    }
    
    // Test duplicate detection
    let event1_duplicate = event1.clone();
    let dedup_result2 = deduplication_system.check_duplicate(&event1_duplicate, chat_id).await.unwrap();
    assert!(matches!(dedup_result2, DeduplicationResult::Duplicate { .. }));
    
    // Duplicate should not be stored
    let should_not_store = matches!(dedup_result2, DeduplicationResult::Duplicate { .. });
    assert!(should_not_store);
    
    // Test 2: Similar event detection with persistence
    let event2 = create_test_event(
        "integration_test_2",
        EventType::BuildCompleted,
        "Build Complete",
        "Backend build completed successfully", // Similar but different
        "build_system",
        None,
    );
    
    let dedup_result3 = deduplication_system.check_duplicate(&event2, chat_id).await.unwrap();
    
    // Should either be similar or unique based on similarity threshold
    match dedup_result3 {
        DeduplicationResult::Unique(_) => {
            persistence_system.store_message(&event2, chat_id).await.unwrap();
        }
        DeduplicationResult::Similar { .. } => {
            // Similar event detected - might still store based on policy
        }
        DeduplicationResult::Duplicate { .. } => {
            panic!("Should not be duplicate for different content");
        }
    }
    
    // Verify persistence stats
    let persistence_stats = persistence_system.get_stats();
    assert!(persistence_stats.messages_stored >= 1); // At least event1 should be stored
    
    // Test 3: Retrieve messages and verify they were properly stored by getting pending messages
    let stored_messages = persistence_system.get_messages_by_status(
        cc_telegram_bridge::MessageStatus::Pending
    ).await.unwrap();
    assert!(!stored_messages.is_empty());
    assert_eq!(stored_messages[0].chat_id, chat_id);
    
    // Cleanup
    std::fs::remove_file(&dedup_db).ok();
    std::fs::remove_file(&persistence_db).ok();
}

#[tokio::test]
async fn test_deduplication_middleware_with_queue_integration() {
    let test_id = Uuid::new_v4().to_string();
    let dedup_db = format!("test_middleware_queue_{}.db", test_id);
    let queue_db = format!("test_queue_integration_{}.db", test_id);
    
    // Setup deduplication system
    let dedup_config = DeduplicationConfig {
        database_path: dedup_db.clone(),
        deduplication_window_seconds: 300,
        cleanup_interval_hours: 1,
        max_connections: 2,
        enable_content_normalization: true,
        enable_similar_detection: false, // Disable for clear testing
        similarity_threshold: 0.8,
        cache_size_limit: 100,
    };
    
    let deduplication_system = Arc::new(
        MessageDeduplicationSystem::new(dedup_config).await.unwrap()
    );
    
    // Setup deduplication middleware
    let middleware = DeduplicationMiddleware::new(deduplication_system.clone());
    
    // Setup persistent queue
    let queue_persistence_config = MessagePersistenceConfig {
        database_path: queue_db.clone(),
        retention_days: 30,
        max_connections: 5,
        cleanup_interval_hours: 24,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 3,
        batch_size: 10,
    };
    
    let chat_id = 12345i64;
    
    let queue_config = PersistentQueueConfig {
        persistence_config: queue_persistence_config,
        chat_id,
        max_memory_queue_size: 100,
        retry_interval_seconds: 1,
        max_concurrent_processing: 3,
        batch_processing_size: 10,
    };
    
    let persistent_queue = PersistentMessageQueue::new(queue_config).await.unwrap();
    
    // Test 1: Process unique event through middleware and queue
    let event1 = create_test_event(
        "middleware_test_1",
        EventType::TaskCompletion,
        "Task Complete",
        "Task completed successfully",
        "test_runner",
        None,
    );
    
    // Process through middleware
    let middleware_result1 = middleware.process(&event1, chat_id).await.unwrap();
    assert!(matches!(middleware_result1, DeduplicationResult::Unique(_)));
    
    // Enqueue if unique
    if matches!(middleware_result1, DeduplicationResult::Unique(_)) {
        persistent_queue.enqueue_message(event1.clone(), cc_telegram_bridge::MessagePriority::Normal).await.unwrap();
    }
    
    // Test 2: Process duplicate event
    let event1_duplicate = event1.clone();
    let middleware_result2 = middleware.process(&event1_duplicate, chat_id).await.unwrap();
    assert!(matches!(middleware_result2, DeduplicationResult::Duplicate { .. }));
    
    // Duplicate should not be enqueued
    let should_not_enqueue = matches!(middleware_result2, DeduplicationResult::Duplicate { .. });
    assert!(should_not_enqueue);
    
    // Test 3: Process different event
    let event2 = create_test_event(
        "middleware_test_2",
        EventType::TaskFailed,
        "Task Failed",
        "Task failed with error",
        "test_runner",
        None,
    );
    
    let middleware_result3 = middleware.process(&event2, chat_id).await.unwrap();
    assert!(matches!(middleware_result3, DeduplicationResult::Unique(_)));
    
    if matches!(middleware_result3, DeduplicationResult::Unique(_)) {
        persistent_queue.enqueue_message(event2.clone(), cc_telegram_bridge::MessagePriority::Normal).await.unwrap();
    }
    
    // Test 4: Verify queue contains only unique messages
    let queue_stats = persistent_queue.get_stats().await;
    assert_eq!(queue_stats.messages_enqueued, 2); // Only 2 unique events should be enqueued
    
    // Test 5: Simulate message processing by updating the results
    // In a real system, this would be done by the message processor
    
    // Create persistence system for middleware test
    let middleware_persistence_config = MessagePersistenceConfig {
        database_path: format!("test_middleware_persistence_{}.db", test_id),
        retention_days: 30,
        max_connections: 5,
        cleanup_interval_hours: 24,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 3,
        batch_size: 100,
    };
    
    let middleware_persistence_system = Arc::new(
        MessagePersistenceSystem::new(middleware_persistence_config).await.unwrap()
    );
    
    // Simulate successful processing of the first message
    let message_ids: Vec<_> = middleware_persistence_system.get_messages_by_status(
        cc_telegram_bridge::MessageStatus::Pending
    ).await.unwrap().into_iter().take(2).map(|m| m.id).collect();
    
    if message_ids.len() >= 1 {
        persistent_queue.update_message_result(
            message_ids[0], 
            cc_telegram_bridge::MessageProcessingResult::Success {
                telegram_message_id: 123,
                tier_used: "primary".to_string(),
            }
        ).await.unwrap();
    }
    
    if message_ids.len() >= 2 {
        persistent_queue.update_message_result(
            message_ids[1], 
            cc_telegram_bridge::MessageProcessingResult::Success {
                telegram_message_id: 124,
                tier_used: "primary".to_string(),
            }
        ).await.unwrap();
    }
    
    // Verify final queue stats
    let final_stats = persistent_queue.get_stats().await;
    assert_eq!(final_stats.messages_enqueued, 2);
    assert_eq!(final_stats.messages_processed, 2);
    
    // Cleanup
    std::fs::remove_file(&dedup_db).ok();
    std::fs::remove_file(&queue_db).ok();
}

#[tokio::test]
async fn test_end_to_end_deduplication_pipeline() {
    let test_id = Uuid::new_v4().to_string();
    let dedup_db = format!("test_e2e_dedup_{}.db", test_id);
    let persistence_db = format!("test_e2e_persistence_{}.db", test_id);
    let queue_db = format!("test_e2e_queue_{}.db", test_id);
    
    // Setup complete pipeline
    let dedup_config = DeduplicationConfig {
        database_path: dedup_db.clone(),
        deduplication_window_seconds: 60, // 1 minute for faster testing
        cleanup_interval_hours: 1,
        max_connections: 2,
        enable_content_normalization: true,
        enable_similar_detection: true,
        similarity_threshold: 0.7,
        cache_size_limit: 50,
    };
    
    let deduplication_system = Arc::new(
        MessageDeduplicationSystem::new(dedup_config).await.unwrap()
    );
    
    let middleware = DeduplicationMiddleware::new(deduplication_system.clone());
    
    let persistence_config = MessagePersistenceConfig {
        database_path: persistence_db.clone(),
        retention_days: 30,
        max_connections: 5,
        cleanup_interval_hours: 24,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 3,
        batch_size: 100,
    };
    
    let persistence_system = Arc::new(
        MessagePersistenceSystem::new(persistence_config).await.unwrap()
    );
    
    let queue_persistence_config = MessagePersistenceConfig {
        database_path: queue_db.clone(),
        retention_days: 30,
        max_connections: 5,
        cleanup_interval_hours: 24,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 3,
        batch_size: 10,
    };
    
    let chat_id = 99999i64;
    
    let queue_config = PersistentQueueConfig {
        persistence_config: queue_persistence_config,
        chat_id,
        max_memory_queue_size: 100,
        retry_interval_seconds: 1,
        max_concurrent_processing: 3,
        batch_processing_size: 10,
    };
    
    let persistent_queue = Arc::new(
        PersistentMessageQueue::new(queue_config).await.unwrap()
    );
    
    // Simulate complete message processing pipeline
    let events = vec![
        create_test_event(
            "e2e_test_1",
            EventType::CodeGeneration,
            "Code Generated",
            "Generated authentication module",
            "ai_assistant",
            None,
        ),
        create_test_event(
            "e2e_test_1", // Same task_id - should be duplicate
            EventType::CodeGeneration,
            "Code Generated",
            "Generated authentication module",
            "ai_assistant",
            None,
        ),
        create_test_event(
            "e2e_test_2",
            EventType::TestSuiteRun,
            "Tests Run",
            "Ran authentication tests successfully",
            "test_runner",
            None,
        ),
        create_test_event(
            "e2e_test_3",
            EventType::CodeGeneration,
            "Code Generated", 
            "Generated user registration module", // Similar but different
            "ai_assistant",
            None,
        ),
    ];
    
    let mut processed_count = 0;
    let mut duplicate_count = 0;
    let mut similar_count = 0;
    
    for event in events {
        // Step 1: Deduplication check
        let dedup_result = middleware.process(&event, chat_id).await.unwrap();
        
        match dedup_result {
            DeduplicationResult::Unique(_) => {
                processed_count += 1;
                
                // Step 2: Store in persistence
                persistence_system.store_message(&event, chat_id).await.unwrap();
                
                // Step 3: Enqueue for processing
                persistent_queue.enqueue_message(event.clone(), cc_telegram_bridge::MessagePriority::Normal).await.unwrap();
            }
            DeduplicationResult::Duplicate { .. } => {
                duplicate_count += 1;
                // Skip storage and queueing for duplicates
            }
            DeduplicationResult::Similar { .. } => {
                similar_count += 1;
                // Could implement custom logic for similar events
                // For this test, we'll treat similar as unique
                processed_count += 1;
                persistence_system.store_message(&event, chat_id).await.unwrap();
                persistent_queue.enqueue_message(event.clone(), cc_telegram_bridge::MessagePriority::Normal).await.unwrap();
            }
        }
    }
    
    // Verify pipeline results
    assert_eq!(duplicate_count, 1); // One exact duplicate
    assert!(processed_count >= 3); // At least 3 unique/similar events
    
    // Test simulated processing - get pending messages and process them
    let pending_messages = persistence_system.get_messages_by_status(
        cc_telegram_bridge::MessageStatus::Pending
    ).await.unwrap();
    
    for message in pending_messages {
        // Simulate processing the event
        assert!(!message.id.to_string().is_empty());
        assert_eq!(message.chat_id, chat_id);
        
        // Simulate successful processing
        persistent_queue.update_message_result(
            message.id,
            cc_telegram_bridge::MessageProcessingResult::Success {
                telegram_message_id: 999,
                tier_used: "primary".to_string(),
            }
        ).await.unwrap();
    }
    
    // Verify final state
    let final_queue_stats = persistent_queue.get_stats().await;
    assert!(final_queue_stats.messages_processed >= 3);
    
    let final_dedup_stats = deduplication_system.get_stats().await;
    assert_eq!(final_dedup_stats.messages_processed, 4);
    assert_eq!(final_dedup_stats.duplicates_detected, 1);
    
    let final_persistence_stats = persistence_system.get_stats();
    assert!(final_persistence_stats.messages_stored >= 3);
    
    // Cleanup
    std::fs::remove_file(&dedup_db).ok();
    std::fs::remove_file(&persistence_db).ok();
    std::fs::remove_file(&queue_db).ok();
}

#[tokio::test]
async fn test_deduplication_time_window_with_persistence() {
    let test_id = Uuid::new_v4().to_string();
    let dedup_db = format!("test_time_window_{}.db", test_id);
    let persistence_db = format!("test_time_persistence_{}.db", test_id);
    
    // Setup with short time window for testing
    let dedup_config = DeduplicationConfig {
        database_path: dedup_db.clone(),
        deduplication_window_seconds: 2, // Very short window
        cleanup_interval_hours: 1,
        max_connections: 2,
        enable_content_normalization: true,
        enable_similar_detection: false,
        similarity_threshold: 0.8,
        cache_size_limit: 100,
    };
    
    let deduplication_system = Arc::new(
        MessageDeduplicationSystem::new(dedup_config).await.unwrap()
    );
    
    let persistence_config = MessagePersistenceConfig {
        database_path: persistence_db.clone(),
        retention_days: 30,
        max_connections: 5,
        cleanup_interval_hours: 24,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 3,
        batch_size: 100,
    };
    
    let persistence_system = Arc::new(
        MessagePersistenceSystem::new(persistence_config).await.unwrap()
    );
    
    let chat_id = 77777i64;
    
    let event = create_test_event(
        "time_window_test",
        EventType::InfoNotification,
        "Test Notification",
        "Testing time window expiration",
        "test_system",
        None,
    );
    
    // First check - should be unique and stored
    let result1 = deduplication_system.check_duplicate(&event, chat_id).await.unwrap();
    assert!(matches!(result1, DeduplicationResult::Unique(_)));
    persistence_system.store_message(&event, chat_id).await.unwrap();
    
    // Immediate second check - should be duplicate, not stored
    let result2 = deduplication_system.check_duplicate(&event, chat_id).await.unwrap();
    assert!(matches!(result2, DeduplicationResult::Duplicate { .. }));
    
    // Wait for time window expiration
    sleep(Duration::from_secs(3)).await;
    
    // After expiration - should be unique again and stored
    let result3 = deduplication_system.check_duplicate(&event, chat_id).await.unwrap();
    assert!(matches!(result3, DeduplicationResult::Unique(_)));
    persistence_system.store_message(&event, chat_id).await.unwrap();
    
    // Verify persistence contains both messages (before and after expiration)
    let stored_messages = persistence_system.get_messages_by_status(
        cc_telegram_bridge::MessageStatus::Pending
    ).await.unwrap();
    assert_eq!(stored_messages.len(), 2);
    assert_eq!(stored_messages[0].chat_id, chat_id);
    assert_eq!(stored_messages[1].chat_id, chat_id);
    
    // Cleanup
    std::fs::remove_file(&dedup_db).ok();
    std::fs::remove_file(&persistence_db).ok();
}
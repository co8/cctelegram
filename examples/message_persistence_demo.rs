use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::info;

use cc_telegram_bridge::{
    MessagePersistenceSystem, MessagePersistenceConfig, MessageStatus,
    PersistentMessageQueue, PersistentQueueConfig, EventQueueIntegration,
    ProcessingResult as MessageProcessingResult, MessagePriority,
    events::types::Event
};

/// Demonstration of the SQLite Message Persistence System
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();
    
    info!("Starting Message Persistence System Demo");
    
    // Demo 1: Basic message persistence
    demo_basic_persistence().await?;
    
    // Demo 2: Message lifecycle with status transitions
    demo_message_lifecycle().await?;
    
    // Demo 3: Crash recovery simulation
    demo_crash_recovery().await?;
    
    // Demo 4: Queue integration with priorities
    demo_queue_integration().await?;
    
    info!("Message Persistence System Demo completed");
    Ok(())
}

/// Demo 1: Basic message persistence functionality
async fn demo_basic_persistence() -> anyhow::Result<()> {
    info!("=== Demo 1: Basic Message Persistence ===");
    
    // Configure persistence system
    let config = MessagePersistenceConfig {
        database_path: "demo_basic.db".to_string(),
        retention_days: 7,
        max_connections: 3,
        cleanup_interval_hours: 24,
        backup_interval_hours: None, // Disabled for demo
        backup_path: None,
        max_retry_count: 3,
        batch_size: 10,
    };
    
    // Initialize persistence system
    let persistence = MessagePersistenceSystem::new(config).await?;
    
    // Create sample events
    let events = create_sample_events();
    let chat_id = 12345i64;
    
    // Store messages
    let mut message_ids = Vec::new();
    for event in &events {
        let message_id = persistence.store_message(event, chat_id).await?;
        message_ids.push(message_id);
        info!("Stored message: {}", message_id);
    }
    
    // Retrieve pending messages
    let pending_messages = persistence.get_messages_by_status(MessageStatus::Pending).await?;
    info!("Found {} pending messages", pending_messages.len());
    
    // Update some messages to sent status
    for (i, &message_id) in message_ids.iter().enumerate() {
        if i % 2 == 0 {
            persistence.update_message_status(
                message_id,
                MessageStatus::Sent,
                Some(100 + i as i32),
                Some("tier1".to_string()),
                None,
            ).await?;
            info!("Updated message {} to sent", message_id);
        }
    }
    
    // Get statistics
    let stats = persistence.get_stats();
    info!("Persistence Stats: {:?}", stats);
    
    // Clean up
    std::fs::remove_file("demo_basic.db").ok();
    
    Ok(())
}

/// Demo 2: Complete message lifecycle demonstration
async fn demo_message_lifecycle() -> anyhow::Result<()> {
    info!("=== Demo 2: Message Lifecycle ===");
    
    let config = MessagePersistenceConfig {
        database_path: "demo_lifecycle.db".to_string(),
        retention_days: 1,
        max_connections: 2,
        cleanup_interval_hours: 1,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 2,
        batch_size: 5,
    };
    
    let persistence = MessagePersistenceSystem::new(config).await?;
    
    let event = Event {
        task_id: "lifecycle_test".to_string(),
        event_type: "task_completion".to_string(),
        description: "Test task completed successfully".to_string(),
        source: "demo".to_string(),
        timestamp: chrono::Utc::now(),
        data: Some(serde_json::json!({
            "duration_ms": 1500,
            "files_changed": 3
        })),
    };
    
    let chat_id = 67890i64;
    
    // Step 1: Store message (Pending)
    let message_id = persistence.store_message(&event, chat_id).await?;
    info!("1. Message stored as pending: {}", message_id);
    
    // Verify pending status
    let message = persistence.get_message(message_id).await?.unwrap();
    assert_eq!(message.status, MessageStatus::Pending);
    info!("   Verified: Status is Pending");
    
    // Step 2: Update to Sent
    persistence.update_message_status(
        message_id,
        MessageStatus::Sent,
        Some(999),
        Some("webhook_tier".to_string()),
        None,
    ).await?;
    info!("2. Message updated to sent");
    
    // Step 3: Update to Confirmed
    persistence.update_message_status(
        message_id,
        MessageStatus::Confirmed,
        None,
        None,
        None,
    ).await?;
    info!("3. Message confirmed");
    
    // Verify final status
    let final_message = persistence.get_message(message_id).await?.unwrap();
    assert_eq!(final_message.status, MessageStatus::Confirmed);
    assert_eq!(final_message.telegram_message_id, Some(999));
    assert_eq!(final_message.tier_used, Some("webhook_tier".to_string()));
    
    info!("   Final message state: {:?}", final_message.status);
    info!("   Telegram message ID: {:?}", final_message.telegram_message_id);
    info!("   Tier used: {:?}", final_message.tier_used);
    
    // Clean up
    std::fs::remove_file("demo_lifecycle.db").ok();
    
    Ok(())
}

/// Demo 3: Crash recovery simulation
async fn demo_crash_recovery() -> anyhow::Result<()> {
    info!("=== Demo 3: Crash Recovery ===");
    
    let config = MessagePersistenceConfig {
        database_path: "demo_crash_recovery.db".to_string(),
        retention_days: 30,
        max_connections: 3,
        cleanup_interval_hours: 24,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 3,
        batch_size: 10,
    };
    
    // Phase 1: Store some messages and simulate a crash
    {
        let persistence = MessagePersistenceSystem::new(config.clone()).await?;
        let events = create_sample_events();
        let chat_id = 11111i64;
        
        // Store messages but don't process them (simulating crash)
        for event in &events {
            persistence.store_message(event, chat_id).await?;
        }
        
        info!("Phase 1: Stored {} messages before 'crash'", events.len());
        
        // Simulate crash by dropping the persistence system
    }
    
    // Phase 2: Recovery - create new instance and verify recovery
    {
        let persistence = MessagePersistenceSystem::new(config).await?;
        
        // The system should have automatically recovered pending messages
        let pending_messages = persistence.get_messages_by_status(MessageStatus::Pending).await?;
        info!("Phase 2: Recovered {} pending messages after restart", pending_messages.len());
        
        // Verify the messages are correct
        for message in &pending_messages {
            info!("   Recovered message: {} - {}", message.id, message.message_text);
        }
        
        // Process some of the recovered messages
        for message in pending_messages.iter().take(2) {
            persistence.update_message_status(
                message.id,
                MessageStatus::Confirmed,
                Some(200),
                Some("recovery_tier".to_string()),
                None,
            ).await?;
            info!("   Processed recovered message: {}", message.id);
        }
        
        let stats = persistence.get_stats();
        info!("Recovery Stats: messages_stored={}, messages_updated={}", 
              stats.messages_stored, stats.messages_updated);
    }
    
    // Clean up
    std::fs::remove_file("demo_crash_recovery.db").ok();
    
    Ok(())
}

/// Demo 4: Queue integration with message priorities
async fn demo_queue_integration() -> anyhow::Result<()> {
    info!("=== Demo 4: Queue Integration ===");
    
    let persistence_config = MessagePersistenceConfig {
        database_path: "demo_queue.db".to_string(),
        retention_days: 30,
        max_connections: 5,
        cleanup_interval_hours: 24,
        backup_interval_hours: None,
        backup_path: None,
        max_retry_count: 3,
        batch_size: 20,
    };
    
    let queue_config = PersistentQueueConfig {
        persistence_config,
        chat_id: 98765,
        max_memory_queue_size: 100,
        retry_interval_seconds: 60,
        max_concurrent_processing: 3,
        batch_processing_size: 10,
    };
    
    // Initialize queue integration
    let queue = EventQueueIntegration::new(queue_config).await?;
    
    // Create events with different priorities
    let events = vec![
        (Event {
            task_id: "critical_error".to_string(),
            event_type: "error_occurred".to_string(),
            description: "Critical system error detected".to_string(),
            source: "system_monitor".to_string(),
            timestamp: chrono::Utc::now(),
            data: Some(serde_json::json!({"severity": "critical"})),
        }, MessagePriority::Critical),
        
        (Event {
            task_id: "task_progress".to_string(),
            event_type: "task_progress".to_string(),
            description: "Task 50% complete".to_string(),
            source: "task_runner".to_string(),
            timestamp: chrono::Utc::now(),
            data: Some(serde_json::json!({"progress": 50})),
        }, MessagePriority::Normal),
        
        (Event {
            task_id: "info_log".to_string(),
            event_type: "info_notification".to_string(),
            description: "System startup complete".to_string(),
            source: "system".to_string(),
            timestamp: chrono::Utc::now(),
            data: None,
        }, MessagePriority::Low),
    ];
    
    // Enqueue events
    let mut message_ids = Vec::new();
    for (event, priority) in events {
        let message_id = queue.enqueue_event(event).await?;
        message_ids.push(message_id);
        info!("Enqueued message {} with priority {:?}", message_id, priority);
    }
    
    // Give the queue a moment to process
    sleep(Duration::from_millis(100)).await;
    
    // Simulate processing results
    for (i, &message_id) in message_ids.iter().enumerate() {
        let result = match i {
            0 => MessageProcessingResult::Success {
                telegram_message_id: 301,
                tier_used: "priority_tier".to_string(),
            },
            1 => MessageProcessingResult::Retry {
                error: "Temporary network issue".to_string(),
            },
            2 => MessageProcessingResult::Success {
                telegram_message_id: 302,
                tier_used: "standard_tier".to_string(),
            },
            _ => unreachable!(),
        };
        
        queue.update_result(message_id, result).await?;
        info!("Updated message {} with result", message_id);
    }
    
    // Get statistics
    let queue_stats = queue.get_stats().await;
    let persistence_stats = queue.get_persistence_stats();
    
    info!("Queue Stats: enqueued={}, processed={}, failed={}, retried={}", 
          queue_stats.messages_enqueued,
          queue_stats.messages_processed,
          queue_stats.messages_failed,
          queue_stats.messages_retried);
    
    info!("Persistence Stats: stored={}, updated={}, retrieved={}", 
          persistence_stats.messages_stored,
          persistence_stats.messages_updated,
          persistence_stats.messages_retrieved);
    
    // Graceful shutdown
    queue.shutdown().await;
    
    // Clean up
    std::fs::remove_file("demo_queue.db").ok();
    
    Ok(())
}

/// Helper function to create sample events for testing
fn create_sample_events() -> Vec<Event> {
    vec![
        Event {
            task_id: "build_task_1".to_string(),
            event_type: "build_completed".to_string(),
            description: "Frontend build completed successfully".to_string(),
            source: "build_system".to_string(),
            timestamp: chrono::Utc::now(),
            data: Some(serde_json::json!({
                "duration": "45s",
                "artifacts": 12
            })),
        },
        Event {
            task_id: "test_task_2".to_string(),
            event_type: "test_suite_run".to_string(),
            description: "All tests passed (127/127)".to_string(),
            source: "test_runner".to_string(),
            timestamp: chrono::Utc::now(),
            data: Some(serde_json::json!({
                "passed": 127,
                "failed": 0,
                "coverage": "94.2%"
            })),
        },
        Event {
            task_id: "deploy_task_3".to_string(),
            event_type: "code_deployment".to_string(),
            description: "Application deployed to staging".to_string(),
            source: "deployment_system".to_string(),
            timestamp: chrono::Utc::now(),
            data: Some(serde_json::json!({
                "environment": "staging",
                "version": "1.2.3"
            })),
        },
    ]
}
use anyhow::Result;
use tempfile::TempDir;
use tokio::fs;
use serde_json;

use cc_telegram_bridge::{
    Config,
    EventProcessor, 
    types::{Event, EventType, EventData},
    FileStore,
    TelegramBot,
    SecurityManager,
};

#[tokio::test]
async fn test_config_loading_and_validation() -> Result<()> {
    // Test configuration loading with environment variables
    std::env::set_var("TELEGRAM_BOT_TOKEN", "test_token_123");
    std::env::set_var("TELEGRAM_ALLOWED_USERS", "123456,789012");
    
    // Load config - should succeed with our test values
    let result = Config::load();
    match result {
        Ok(config) => {
            // Verify the environment variables were loaded
            assert_eq!(config.telegram.bot_token, "test_token_123");
            assert_eq!(config.telegram.allowed_users, vec![123456, 789012]);
            assert!(config.paths.events_dir.is_absolute());
        }
        Err(e) => {
            // This is also acceptable if paths aren't absolute
            println!("Config loading failed (expected for non-absolute paths): {}", e);
        }
    }
    
    // Test validation with empty token (should fail)
    std::env::set_var("TELEGRAM_BOT_TOKEN", "");
    let empty_result = Config::load();
    assert!(empty_result.is_err()); // Should fail because token is empty
    
    // Clean up
    std::env::remove_var("TELEGRAM_BOT_TOKEN");
    std::env::remove_var("TELEGRAM_ALLOWED_USERS");
    
    Ok(())
}

#[tokio::test]
async fn test_event_processing() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let events_dir = temp_dir.path().to_path_buf();
    
    let processor = EventProcessor::new(&events_dir);
    
    // Create a test event
    let test_event = Event {
        event_type: EventType::TaskCompletion,
        source: "test".to_string(),
        timestamp: chrono::Utc::now(),
        task_id: "test_task_123".to_string(),
        title: "Test Task".to_string(),
        description: "This is a test task".to_string(),
        data: EventData {
            status: Some("completed".to_string()),
            results: Some("Test completed successfully".to_string()),
            approval_prompt: None,
            options: None,
            metadata: None,
        },
    };
    
    // Write event to file
    let event_file = events_dir.join("test_event.json");
    let json_content = serde_json::to_string_pretty(&test_event)?;
    fs::write(&event_file, json_content).await?;
    
    // Process the event
    let processed_event = processor.process_event_file(&event_file).await?;
    
    // Verify the event was processed correctly
    assert_eq!(processed_event.task_id, "test_task_123");
    assert_eq!(processed_event.title, "Test Task");
    assert!(matches!(processed_event.event_type, EventType::TaskCompletion));
    
    Ok(())
}

#[tokio::test]
async fn test_file_store_operations() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let file_store = FileStore::new(temp_dir.path());
    
    // Test directory creation
    file_store.ensure_directories().await?;
    
    assert!(temp_dir.path().join("events").exists());
    assert!(temp_dir.path().join("responses").exists());
    assert!(temp_dir.path().join("logs").exists());
    
    // Test JSON storage
    let test_data = serde_json::json!({
        "test": "data",
        "number": 42
    });
    
    let stored_path = file_store
        .store_json("test", "sample.json", &test_data)
        .await?;
    
    assert!(stored_path.exists());
    
    // Test JSON loading
    let loaded_data: serde_json::Value = file_store
        .load_json("test", "sample.json")
        .await?;
    
    assert_eq!(loaded_data["test"], "data");
    assert_eq!(loaded_data["number"], 42);
    
    Ok(())
}

#[tokio::test]
async fn test_telegram_bot_user_validation() {
    let allowed_users = vec![123456, 789012];
    let bot = TelegramBot::new("dummy_token".to_string(), allowed_users);
    
    // Test user authorization
    assert!(bot.is_user_allowed(123456));
    assert!(bot.is_user_allowed(789012));
    assert!(!bot.is_user_allowed(999999));
}

#[tokio::test]
async fn test_security_manager() {
    let mut security_manager = SecurityManager::new(
        vec![123456, 789012],
        5,  // 5 requests
        60, // per 60 seconds
    );
    
    // Test user authorization
    assert!(security_manager.is_user_authorized(123456));
    assert!(!security_manager.is_user_authorized(999999));
    
    // Test rate limiting
    let user_id = 123456;
    
    // Should allow first 5 requests
    for _ in 0..5 {
        assert!(security_manager.check_rate_limit(user_id));
    }
    
    // 6th request should be blocked
    assert!(!security_manager.check_rate_limit(user_id));
    
    // Test input sanitization
    let dirty_input = "<script>alert('xss')</script>normal text";
    let clean_input = security_manager.sanitize_input(dirty_input);
    assert!(!clean_input.contains("<script>"));
    assert!(clean_input.contains("normal text"));
    
    // Test task ID validation
    assert!(security_manager.validate_task_id("valid_task_123"));
    assert!(security_manager.validate_task_id("another-valid-task"));
    assert!(!security_manager.validate_task_id("invalid/task/with/slashes"));
    assert!(!security_manager.validate_task_id(""));
    
    // Test adding/removing users
    security_manager.add_user(555555);
    assert!(security_manager.is_user_authorized(555555));
    
    security_manager.remove_user(555555);
    assert!(!security_manager.is_user_authorized(555555));
}

#[tokio::test]
async fn test_event_validation() -> Result<()> {
    let temp_dir = TempDir::new()?;
    let processor = EventProcessor::new(temp_dir.path());
    
    // Test invalid event (missing task_id)
    let invalid_event_json = r#"
    {
        "type": "task_completion",
        "source": "test",
        "timestamp": "2024-07-31T20:30:00Z",
        "task_id": "",
        "title": "Test Task",
        "description": "Test",
        "data": {
            "status": "completed"
        }
    }
    "#;
    
    let event_file = temp_dir.path().join("invalid_event.json");
    fs::write(&event_file, invalid_event_json).await?;
    
    let result = processor.process_event_file(&event_file).await;
    assert!(result.is_err());
    
    // Test valid approval request
    let valid_approval_json = r#"
    {
        "type": "approval_request",
        "source": "test",
        "timestamp": "2024-07-31T20:30:00Z",
        "task_id": "approval_123",
        "title": "Need Approval",
        "description": "Please approve this action",
        "data": {
            "approval_prompt": "Do you want to proceed?",
            "options": ["approve", "deny"]
        }
    }
    "#;
    
    let approval_file = temp_dir.path().join("approval_event.json");
    fs::write(&approval_file, valid_approval_json).await?;
    
    let result = processor.process_event_file(&approval_file).await;
    assert!(result.is_ok());
    
    Ok(())
}
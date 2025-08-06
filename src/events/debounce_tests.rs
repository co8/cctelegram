#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs;
    use tokio::time::{Duration, sleep};
    use std::path::PathBuf;

    async fn create_test_file(dir: &TempDir, filename: &str, content: &str) -> PathBuf {
        let file_path = dir.path().join(filename);
        fs::write(&file_path, content).await.unwrap();
        file_path
    }

    #[tokio::test]
    async fn test_basic_file_debouncing() {
        let temp_dir = TempDir::new().unwrap();
        let config = DebounceConfig {
            debounce_duration: Duration::from_millis(200),
            ..Default::default()
        };

        let mut watcher = DebouncedEventWatcher::new(temp_dir.path(), Some(config)).unwrap();
        
        // Start processing in background
        tokio::spawn(async move {
            if let Err(e) = watcher.start_processing().await {
                eprintln!("Watcher error: {}", e);
            }
        });

        // Create and modify a test file
        let test_file = create_test_file(&temp_dir, "test.json", r#"{"test": "data"}"#).await;
        
        sleep(Duration::from_millis(50)).await;
        fs::write(&test_file, r#"{"test": "modified"}"#).await.unwrap();
        
        sleep(Duration::from_millis(50)).await;
        fs::write(&test_file, r#"{"test": "final"}"#).await.unwrap();

        // Wait for debounce window to expire
        sleep(Duration::from_millis(300)).await;

        // The test would need access to the batch receiver to verify results
        // This is a basic structure test - real testing would require refactoring
        // to expose the receiver or provide test hooks
    }

    #[tokio::test]
    async fn test_file_hash_calculation() {
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(&temp_dir, "test.json", r#"{"test": "data"}"#).await;
        
        let hash1 = calculate_file_hash(&test_file).await.unwrap();
        let hash2 = calculate_file_hash(&test_file).await.unwrap();
        
        // Same content should produce same hash
        assert_eq!(hash1, hash2);
        
        // Modify file content
        fs::write(&test_file, r#"{"test": "modified"}"#).await.unwrap();
        let hash3 = calculate_file_hash(&test_file).await.unwrap();
        
        // Different content should produce different hash
        assert_ne!(hash1, hash3);
    }

    #[tokio::test]
    async fn test_debounce_config() {
        let config = DebounceConfig::default();
        assert_eq!(config.debounce_duration, Duration::from_millis(500));
        assert_eq!(config.max_batch_size, 100);
        assert_eq!(config.processing_timeout, Duration::from_secs(5));

        let custom_config = DebounceConfig {
            debounce_duration: Duration::from_millis(1000),
            max_batch_size: 50,
            processing_timeout: Duration::from_secs(10),
        };
        assert_eq!(custom_config.debounce_duration, Duration::from_millis(1000));
        assert_eq!(custom_config.max_batch_size, 50);
        assert_eq!(custom_config.processing_timeout, Duration::from_secs(10));
    }

    #[tokio::test]
    async fn test_file_event_serialization() {
        let event = DebouncedFileEvent {
            path: PathBuf::from("/test/path.json"),
            event_kind: "Modify".to_string(),
            content_hash: Some("abc123".to_string()),
            timestamp: chrono::Utc::now(),
            size: Some(1024),
            content_changed: true,
        };

        // Test serialization
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("test/path.json"));
        assert!(json.contains("abc123"));

        // Test deserialization
        let deserialized: DebouncedFileEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.path, event.path);
        assert_eq!(deserialized.content_hash, event.content_hash);
    }

    #[tokio::test]
    async fn test_file_batch_serialization() {
        let event1 = DebouncedFileEvent {
            path: PathBuf::from("/test/file1.json"),
            event_kind: "Create".to_string(),
            content_hash: Some("hash1".to_string()),
            timestamp: chrono::Utc::now(),
            size: Some(512),
            content_changed: true,
        };

        let event2 = DebouncedFileEvent {
            path: PathBuf::from("/test/file2.json"),
            event_kind: "Modify".to_string(),
            content_hash: Some("hash2".to_string()),
            timestamp: chrono::Utc::now(),
            size: Some(1024),
            content_changed: false,
        };

        let batch = FileEventBatch {
            events: vec![event1, event2],
            batch_timestamp: chrono::Utc::now(),
            raw_event_count: 5,
        };

        // Test serialization
        let json = serde_json::to_string(&batch).unwrap();
        assert!(json.contains("file1.json"));
        assert!(json.contains("file2.json"));
        assert!(json.contains("\"raw_event_count\":5"));

        // Test deserialization
        let deserialized: FileEventBatch = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.events.len(), 2);
        assert_eq!(deserialized.raw_event_count, 5);
    }

    #[tokio::test]
    async fn test_non_json_files_filtered() {
        let temp_dir = TempDir::new().unwrap();
        let _txt_file = create_test_file(&temp_dir, "test.txt", "not json").await;
        let _rs_file = create_test_file(&temp_dir, "test.rs", "fn main() {}").await;
        
        let config = DebounceConfig {
            debounce_duration: Duration::from_millis(100),
            ..Default::default()
        };

        let watcher = DebouncedEventWatcher::new(temp_dir.path(), Some(config)).unwrap();
        
        // Test path filtering
        assert!(!watcher.is_relevant_path(&PathBuf::from("test.txt")));
        assert!(!watcher.is_relevant_path(&PathBuf::from("test.rs")));
        assert!(watcher.is_relevant_path(&PathBuf::from("test.json")));
    }

    #[tokio::test]
    async fn test_hash_consistency() {
        let temp_dir = TempDir::new().unwrap();
        let content = r#"{"test": "consistent", "number": 42}"#;
        let test_file = create_test_file(&temp_dir, "consistent.json", content).await;
        
        // Calculate hash multiple times
        let hash1 = calculate_file_hash(&test_file).await.unwrap();
        let hash2 = calculate_file_hash(&test_file).await.unwrap();
        let hash3 = calculate_file_hash(&test_file).await.unwrap();
        
        assert_eq!(hash1, hash2);
        assert_eq!(hash2, hash3);
        assert_eq!(hash1.len(), 64); // SHA256 produces 64-character hex string
    }
}
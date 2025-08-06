use notify::{Watcher, RecursiveMode, Result as NotifyResult, Event as NotifyEvent, EventKind};
use tokio::sync::mpsc;
use tokio::time::{Duration, Instant, sleep, timeout};
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use anyhow::Result;
use tracing::{info, error, warn, debug};
use sha2::{Sha256, Digest};
use serde::{Serialize, Deserialize};

/// Configuration for the file debouncing system
#[derive(Debug, Clone)]
pub struct DebounceConfig {
    /// Debounce window duration (default: 500ms)
    pub debounce_duration: Duration,
    /// Maximum batch size for events
    pub max_batch_size: usize,
    /// Timeout for processing batches
    pub processing_timeout: Duration,
}

impl Default for DebounceConfig {
    fn default() -> Self {
        Self {
            debounce_duration: Duration::from_millis(500),
            max_batch_size: 100,
            processing_timeout: Duration::from_secs(5),
        }
    }
}

/// File event with content hash and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebouncedFileEvent {
    /// Path of the affected file
    pub path: PathBuf,
    /// Type of file system event
    pub event_kind: String,
    /// SHA256 hash of file content (if readable)
    pub content_hash: Option<String>,
    /// Last modification time
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// File size in bytes
    pub size: Option<u64>,
    /// Whether this represents actual content change
    pub content_changed: bool,
}

/// Batch of debounced file events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEventBatch {
    /// Collection of file events in this batch
    pub events: Vec<DebouncedFileEvent>,
    /// When this batch was created
    pub batch_timestamp: chrono::DateTime<chrono::Utc>,
    /// Total number of raw events that contributed to this batch
    pub raw_event_count: usize,
}

/// Internal state for tracking file changes
#[derive(Debug)]
struct FileState {
    last_event_time: Instant,
    last_hash: Option<String>,
    pending_events: Vec<NotifyEvent>,
}

pub struct EventWatcher {
    _watcher: notify::RecommendedWatcher,
    receiver: mpsc::UnboundedReceiver<NotifyEvent>,
}

pub struct DebouncedEventWatcher {
    watcher: EventWatcher,
    config: DebounceConfig,
    file_states: HashMap<PathBuf, FileState>,
    debounced_sender: mpsc::UnboundedSender<FileEventBatch>,
    debounced_receiver: mpsc::UnboundedReceiver<FileEventBatch>,
}

impl EventWatcher {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let (tx, receiver) = mpsc::unbounded_channel();
        
        let mut watcher = notify::recommended_watcher(move |res: NotifyResult<NotifyEvent>| {
            match res {
                Ok(event) => {
                    if let Err(e) = tx.send(event) {
                        error!("Failed to send file event: {}", e);
                    }
                }
                Err(e) => error!("File watcher error: {:?}", e),
            }
        })?;

        watcher.watch(path.as_ref(), RecursiveMode::NonRecursive)?;
        info!("File watcher started for path: {}", path.as_ref().display());

        Ok(Self {
            _watcher: watcher,
            receiver,
        })
    }

    pub async fn next_event(&mut self) -> Option<NotifyEvent> {
        self.receiver.recv().await
    }

    pub fn is_relevant_event(&self, event: &NotifyEvent) -> bool {
        match &event.kind {
            EventKind::Create(_) | EventKind::Modify(_) => {
                // Check if it's a JSON file
                event.paths.iter().any(|path| {
                    path.extension().map_or(false, |ext| ext == "json")
                })
            }
            _ => false,
        }
    }
}

impl DebouncedEventWatcher {
    pub fn new<P: AsRef<Path>>(path: P, config: Option<DebounceConfig>) -> Result<Self> {
        let watcher = EventWatcher::new(path)?;
        let config = config.unwrap_or_default();
        let (debounced_sender, debounced_receiver) = mpsc::unbounded_channel();
        
        Ok(Self {
            watcher,
            config,
            file_states: HashMap::new(),
            debounced_sender,
            debounced_receiver,
        })
    }

    /// Start the debounced event processing loop
    pub async fn start_processing(&mut self) -> Result<()> {
        info!("Starting debounced file event processing with {}ms debounce window", 
              self.config.debounce_duration.as_millis());
        
        loop {
            tokio::select! {
                // Process incoming file events
                event = self.watcher.next_event() => {
                    if let Some(event) = event {
                        if let Err(e) = self.process_raw_event(event).await {
                            error!("Error processing raw event: {}", e);
                        }
                    }
                }
                
                // Check for debounce timeouts
                _ = sleep(Duration::from_millis(100)) => {
                    if let Err(e) = self.process_debounce_timeouts().await {
                        error!("Error processing debounce timeouts: {}", e);
                    }
                }
            }
        }
    }

    /// Get the next debounced file event batch
    pub async fn next_batch(&mut self) -> Option<FileEventBatch> {
        self.debounced_receiver.recv().await
    }

    /// Process a raw file system event
    async fn process_raw_event(&mut self, event: NotifyEvent) -> Result<()> {
        let now = Instant::now();
        
        for path in &event.paths {
            if !self.is_relevant_path(path) {
                continue;
            }
            
            debug!("Processing raw event for path: {}", path.display());
            
            let file_state = self.file_states.entry(path.clone()).or_insert_with(|| {
                FileState {
                    last_event_time: now,
                    last_hash: None,
                    pending_events: Vec::new(),
                }
            });
            
            file_state.last_event_time = now;
            file_state.pending_events.push(event.clone());
        }
        
        Ok(())
    }

    /// Process debounce timeouts and create batches
    async fn process_debounce_timeouts(&mut self) -> Result<()> {
        let now = Instant::now();
        let mut paths_to_process = Vec::new();
        
        // Find files that have exceeded the debounce window
        for (path, state) in &self.file_states {
            if now.duration_since(state.last_event_time) >= self.config.debounce_duration {
                paths_to_process.push(path.clone());
            }
        }
        
        if paths_to_process.is_empty() {
            return Ok(());
        }
        
        // Create batch from timed-out files
        let mut batch_events = Vec::new();
        let mut total_raw_events = 0;
        
        for path in paths_to_process {
            if let Some(state) = self.file_states.remove(&path) {
                total_raw_events += state.pending_events.len();
                
                if let Ok(debounced_event) = self.create_debounced_event(&path, &state.pending_events, &state.last_hash).await {
                    batch_events.push(debounced_event);
                }
            }
        }
        
        if !batch_events.is_empty() {
            let batch = FileEventBatch {
                events: batch_events,
                batch_timestamp: chrono::Utc::now(),
                raw_event_count: total_raw_events,
            };
            
            info!("Created batch with {} events from {} raw events", 
                  batch.events.len(), batch.raw_event_count);
            
            if let Err(e) = self.debounced_sender.send(batch) {
                error!("Failed to send debounced batch: {}", e);
            }
        }
        
        Ok(())
    }

    /// Create a debounced event from raw events
    async fn create_debounced_event(&self, path: &PathBuf, events: &[NotifyEvent], last_hash: &Option<String>) -> Result<DebouncedFileEvent> {
        let latest_event = events.last().unwrap();
        let event_kind = format!("{:?}", latest_event.kind);
        
        // Calculate file hash and metadata
        let (content_hash, size, content_changed) = match self.calculate_file_info(path, last_hash).await {
            Ok(info) => info,
            Err(e) => {
                warn!("Could not calculate file info for {}: {}", path.display(), e);
                (None, None, true) // Assume content changed if we can't verify
            }
        };
        
        Ok(DebouncedFileEvent {
            path: path.clone(),
            event_kind,
            content_hash,
            timestamp: chrono::Utc::now(),
            size,
            content_changed,
        })
    }

    /// Calculate SHA256 hash and metadata for a file
    async fn calculate_file_info(&self, path: &PathBuf, last_hash: &Option<String>) -> Result<(Option<String>, Option<u64>, bool)> {
        if !path.exists() {
            // File was deleted
            return Ok((None, None, true));
        }
        
        let metadata = tokio::fs::metadata(path).await?;
        let size = Some(metadata.len());
        
        // Read file content and calculate hash
        let content = match tokio::fs::read(path).await {
            Ok(content) => content,
            Err(e) => {
                warn!("Could not read file {}: {}", path.display(), e);
                return Ok((None, size, true)); // Assume changed if unreadable
            }
        };
        
        let mut hasher = Sha256::new();
        hasher.update(&content);
        let hash = format!("{:x}", hasher.finalize());
        
        let content_changed = match last_hash {
            Some(old_hash) => old_hash != &hash,
            None => true, // First time seeing this file
        };
        
        debug!("File {} hash: {} (changed: {})", path.display(), hash, content_changed);
        
        Ok((Some(hash), size, content_changed))
    }

    /// Check if a path should be monitored
    fn is_relevant_path(&self, path: &PathBuf) -> bool {
        // Only monitor JSON files for now
        path.extension().map_or(false, |ext| ext == "json")
    }
}

/// Utility function to calculate SHA256 hash of file content
pub async fn calculate_file_hash(path: &PathBuf) -> Result<String> {
    let content = tokio::fs::read(path).await?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    Ok(format!("{:x}", hasher.finalize()))
}

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
# File Debouncing System Documentation

## Overview

The CCTelegram bridge includes a sophisticated file debouncing system that efficiently handles high-frequency file system events while maintaining data integrity through content hashing. This system prevents duplicate processing of rapid file changes and reduces system overhead.

## Architecture

### Core Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  File System    │───▶│ DebouncedEvent   │───▶│ Event Processor │
│  Events (Raw)   │    │ Watcher          │    │ (Batched)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │ SHA256 Content   │
                       │ Hash Validation  │
                       └──────────────────┘
```

### Key Features

- **Smart Debouncing**: 500ms configurable debounce window to aggregate rapid file changes
- **Content Verification**: SHA256 hashing to distinguish actual content changes from timestamp-only updates
- **Batch Processing**: Efficient event batching within debounce windows
- **Cross-Platform**: Uses `notify::RecommendedWatcher` for robust file system monitoring
- **Async/Await**: Full async support with `tokio` integration
- **Serialization**: Complete JSON serialization support for event persistence

## Configuration

### DebounceConfig

```rust
use cc_telegram_bridge::events::DebounceConfig;
use tokio::time::Duration;

let config = DebounceConfig {
    debounce_duration: Duration::from_millis(500),  // Wait time before processing
    max_batch_size: 100,                            // Maximum events per batch
    processing_timeout: Duration::from_secs(5),     // Timeout for batch processing
};
```

### Configuration Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `debounce_duration` | 500ms | Time to wait for additional events before processing |
| `max_batch_size` | 100 | Maximum number of events in a single batch |
| `processing_timeout` | 5s | Timeout for processing a batch of events |

## Usage Examples

### Basic Setup

```rust
use cc_telegram_bridge::events::{DebouncedEventWatcher, DebounceConfig};
use tokio::time::Duration;
use std::path::Path;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Configure debouncing
    let config = DebounceConfig {
        debounce_duration: Duration::from_millis(1000),
        ..Default::default()
    };

    // Create watcher for a directory
    let watch_path = Path::new("./watch_directory");
    let mut watcher = DebouncedEventWatcher::new(watch_path, Some(config))?;

    // Start processing events
    tokio::spawn(async move {
        if let Err(e) = watcher.start_processing().await {
            eprintln!("Processing error: {}", e);
        }
    });

    // Process batched events
    while let Some(batch) = watcher.next_batch().await {
        process_batch(batch).await?;
    }

    Ok(())
}

async fn process_batch(batch: FileEventBatch) -> anyhow::Result<()> {
    println!("Processing {} events from {} raw events", 
             batch.events.len(), batch.raw_event_count);
    
    for event in batch.events {
        if event.content_changed {
            println!("Content changed: {} (hash: {:?})", 
                     event.path.display(), event.content_hash);
            // Process the actual content change
        } else {
            println!("Timestamp-only change: {}", event.path.display());
        }
    }
    
    Ok(())
}
```

### Integration with Existing Event System

```rust
use cc_telegram_bridge::events::{DebouncedEventWatcher, EventProcessor};

async fn setup_integrated_processing() -> anyhow::Result<()> {
    let mut watcher = DebouncedEventWatcher::new("./responses", None)?;
    let processor = EventProcessor::new();

    // Start debounced processing
    tokio::spawn(async move {
        watcher.start_processing().await
    });

    // Process debounced batches
    while let Some(batch) = watcher.next_batch().await {
        for event in batch.events {
            if event.content_changed {
                // Convert to internal event format and process
                if let Ok(content) = tokio::fs::read_to_string(&event.path).await {
                    processor.process_response_file(&event.path, &content).await?;
                }
            }
        }
    }

    Ok(())
}
```

## Event Types

### DebouncedFileEvent

Represents a single file event with metadata:

```rust
pub struct DebouncedFileEvent {
    pub path: PathBuf,                              // File path
    pub event_kind: String,                         // "Create", "Modify", "Delete"
    pub content_hash: Option<String>,               // SHA256 hash (if readable)
    pub timestamp: chrono::DateTime<chrono::Utc>,   // Event timestamp
    pub size: Option<u64>,                          // File size in bytes
    pub content_changed: bool,                      // True if content actually changed
}
```

### FileEventBatch

Contains a collection of debounced events:

```rust
pub struct FileEventBatch {
    pub events: Vec<DebouncedFileEvent>,            // Processed events
    pub batch_timestamp: chrono::DateTime<chrono::Utc>, // Batch creation time
    pub raw_event_count: usize,                     // Number of contributing raw events
}
```

## Content Hashing

The system uses SHA256 hashing to detect actual content changes:

```rust
use cc_telegram_bridge::events::calculate_file_hash;
use std::path::PathBuf;

// Calculate hash for a file
let file_path = PathBuf::from("example.json");
match calculate_file_hash(&file_path).await {
    Ok(hash) => println!("File hash: {}", hash),
    Err(e) => eprintln!("Hash calculation failed: {}", e),
}
```

### Hash Benefits

- **Duplicate Detection**: Identical content produces identical hashes
- **Change Verification**: Only actual content changes trigger processing
- **Integrity Checking**: Verify file contents haven't been corrupted
- **Efficient Comparisons**: 64-character hex strings for fast comparison

## File Filtering

Currently monitors only JSON files:

```rust
// Only these file extensions are processed
let json_file = PathBuf::from("data.json");      // ✅ Processed
let text_file = PathBuf::from("readme.txt");     // ❌ Ignored
let rust_file = PathBuf::from("main.rs");        // ❌ Ignored
```

To customize file filtering, modify the `is_relevant_path` method in `DebouncedEventWatcher`.

## Error Handling

The system implements comprehensive error handling:

```rust
// File reading errors
match tokio::fs::read(&path).await {
    Ok(content) => process_content(content),
    Err(e) => {
        warn!("Could not read file {}: {}", path.display(), e);
        // Continue processing with assumption of content change
    }
}

// Processing errors
if let Err(e) = watcher.start_processing().await {
    error!("Watcher processing failed: {}", e);
    // Implement retry logic or fallback mechanism
}
```

### Common Error Scenarios

- **Permission Denied**: File is not readable by the process
- **File Not Found**: File was deleted between event detection and processing
- **IO Errors**: Network drives, disk full, hardware issues
- **Hash Calculation**: Memory issues with very large files

## Performance Considerations

### Memory Usage

- **Event Batching**: Configurable `max_batch_size` limits memory consumption
- **Hash Caching**: Recent hashes are cached per file path
- **Cleanup**: Processed events are automatically cleaned up

### CPU Usage

- **Debouncing**: Reduces CPU load by aggregating rapid events
- **Selective Hashing**: Only calculates hashes for relevant file types
- **Async Processing**: Non-blocking I/O prevents thread starvation

### Disk I/O

- **Content Reading**: Only reads files when necessary for hash calculation
- **Batch Processing**: Minimizes file system access patterns
- **Path Filtering**: Early filtering reduces unnecessary I/O operations

## Monitoring and Observability

### Tracing Integration

```rust
use tracing::{info, warn, debug, error};

// Enable tracing in your application
tracing_subscriber::fmt()
    .with_max_level(tracing::Level::INFO)
    .init();

// The debouncing system will output structured logs:
// INFO  Creating batch with 5 events from 15 raw events
// DEBUG File example.json hash: a1b2c3... (changed: true)
// WARN  Could not read file temp.json: Permission denied
```

### Metrics

Track system performance:

```rust
// Batch processing metrics
let batch_size = batch.events.len();
let raw_event_reduction = batch.raw_event_count - batch.events.len();
let efficiency_ratio = (raw_event_reduction as f64) / (batch.raw_event_count as f64);

println!("Debouncing efficiency: {:.2}% event reduction", efficiency_ratio * 100.0);
```

## Testing

### Unit Tests

Run the comprehensive test suite:

```bash
cargo test events::watcher::tests
```

### Integration Testing

```rust
use tempfile::TempDir;
use tokio::fs;

#[tokio::test]
async fn test_debouncing_integration() {
    let temp_dir = TempDir::new().unwrap();
    let config = DebounceConfig {
        debounce_duration: Duration::from_millis(100),
        ..Default::default()
    };

    let mut watcher = DebouncedEventWatcher::new(temp_dir.path(), Some(config)).unwrap();
    
    // Create test files and verify debouncing behavior
    let test_file = temp_dir.path().join("test.json");
    fs::write(&test_file, r#"{"test": "data"}"#).await.unwrap();
    
    // ... test implementation
}
```

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Reduce `max_batch_size` in configuration
   - Increase `debounce_duration` to create larger batches less frequently
   - Check for file system event storms

2. **Events Not Processed**
   - Verify file extensions match filter criteria (currently JSON only)
   - Check file permissions and accessibility
   - Review tracing logs for error messages

3. **Performance Issues**
   - Monitor hash calculation overhead for large files
   - Consider file size limits for hash calculation
   - Verify async runtime is not blocked

### Debug Configuration

```rust
let debug_config = DebounceConfig {
    debounce_duration: Duration::from_millis(100),  // Shorter for testing
    max_batch_size: 10,                             // Smaller batches for debugging
    processing_timeout: Duration::from_secs(1),     // Faster timeout
};
```

## Best Practices

1. **Configuration Tuning**
   - Start with default values and adjust based on workload
   - Monitor batch sizes and processing times
   - Balance latency vs. efficiency requirements

2. **Error Handling**
   - Always handle file I/O errors gracefully
   - Implement retry logic for transient failures
   - Log errors with sufficient context for debugging

3. **Resource Management**
   - Use appropriate debounce windows for your use case
   - Monitor memory usage with large file volumes
   - Consider disk space for hash calculation of large files

4. **Integration**
   - Start debounced processing in a separate task
   - Use proper async/await patterns throughout
   - Implement graceful shutdown handling

## Future Enhancements

- **Configurable File Filters**: Support for multiple file types and custom patterns
- **Persistent State**: Save debounce state across restarts
- **Metrics Integration**: Built-in Prometheus metrics support
- **Advanced Batching**: Priority-based event batching
- **Compression**: Optional compression for large event batches

## See Also

- [Event Processing Documentation](./EVENT_PROCESSING.md)
- [Configuration Guide](./CONFIGURATION.md)
- [API Reference](./API_REFERENCE.md)
- [Examples](../examples/file_debouncing_demo.rs)
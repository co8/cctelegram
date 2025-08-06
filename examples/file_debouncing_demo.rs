use cc_telegram_bridge::events::{DebouncedEventWatcher, DebounceConfig, FileEventBatch};
use tokio::time::Duration;
use std::path::PathBuf;
use anyhow::Result;
use tracing::{info, error, Level};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .init();

    // Configure custom debounce settings
    let config = DebounceConfig {
        debounce_duration: Duration::from_millis(1000), // 1 second debounce
        max_batch_size: 50,
        processing_timeout: Duration::from_secs(10),
    };

    // Watch current directory for JSON file changes
    let watch_path = std::env::current_dir()?;
    info!("Starting file debouncing demo watching: {}", watch_path.display());
    
    let mut watcher = DebouncedEventWatcher::new(&watch_path, Some(config))?;

    // Start processing in a separate task
    let mut processing_watcher = DebouncedEventWatcher::new(&watch_path, None)?;
    tokio::spawn(async move {
        info!("Starting debounced event processing...");
        if let Err(e) = processing_watcher.start_processing().await {
            error!("Processing error: {}", e);
        }
    });

    info!("File debouncing system started. Modify JSON files in {} to see events.", watch_path.display());
    info!("Press Ctrl+C to exit.");

    // Main event processing loop
    loop {
        match watcher.next_batch().await {
            Some(batch) => {
                process_file_batch(&batch).await?;
            }
            None => {
                info!("Event channel closed, shutting down.");
                break;
            }
        }
    }

    Ok(())
}

async fn process_file_batch(batch: &FileEventBatch) -> Result<()> {
    info!(
        "📦 Processing batch with {} events (from {} raw events) at {}",
        batch.events.len(),
        batch.raw_event_count,
        batch.batch_timestamp.format("%H:%M:%S%.3f")
    );

    for event in &batch.events {
        info!(
            "  📄 File: {} | Event: {} | Size: {} bytes | Content changed: {} | Hash: {}",
            event.path.display(),
            event.event_kind,
            event.size.unwrap_or(0),
            event.content_changed,
            event.content_hash.as_deref().unwrap_or("N/A")
        );

        // Example: Process only files that actually changed content
        if event.content_changed {
            info!("    ✨ Processing content change for: {}", event.path.display());
            
            // Here you would add your actual file processing logic
            // For example:
            // - Parse JSON content
            // - Send to message queue
            // - Update database
            // - Trigger webhook
            // - etc.
            
            if let Some(hash) = &event.content_hash {
                info!("    🔍 File hash: {}", hash);
            }
        } else {
            info!("    ⏭️  Skipping timestamp-only change for: {}", event.path.display());
        }
    }

    info!("✅ Batch processing completed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs;

    #[tokio::test]
    async fn test_debouncing_demo_functionality() -> Result<()> {
        let temp_dir = TempDir::new()?;
        
        // Create test JSON files
        let test_file = temp_dir.path().join("test.json");
        fs::write(&test_file, r#"{"test": "initial"}"#).await?;
        
        // Test basic functionality without actually running the full demo
        let config = DebounceConfig::default();
        let _watcher = DebouncedEventWatcher::new(temp_dir.path(), Some(config))?;
        
        // Modify the file multiple times
        fs::write(&test_file, r#"{"test": "modified1"}"#).await?;
        fs::write(&test_file, r#"{"test": "modified2"}"#).await?;
        fs::write(&test_file, r#"{"test": "final"}"#).await?;
        
        Ok(())
    }
}
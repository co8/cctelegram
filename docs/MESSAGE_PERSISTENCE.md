# SQLite Message Persistence System

This document describes the robust SQLite-based message persistence system implemented for the CCTelegram bridge, providing crash recovery, message lifecycle management, and production-ready reliability.

## Overview

The message persistence system consists of three main components:

1. **MessagePersistenceSystem** - Core SQLite database management with WAL mode
2. **PersistentMessageQueue** - Queue integration with crash recovery
3. **PersistenceIntegratedProcessor** - Complete integration with tier orchestration

## Key Features

### 🏗️ Architecture

- **WAL Mode**: Write-Ahead Logging for concurrent access and crash safety
- **Connection Pooling**: Configurable connection pool for high-throughput scenarios
- **Atomic Transactions**: All message state transitions are atomic
- **Schema Versioning**: Built-in migration support for future schema changes

### 🔄 Message Lifecycle

Messages follow a clear lifecycle with atomic state transitions:

```
Pending → Sent → Confirmed
    ↓       ↓
  Failed ← Failed (with retry count)
```

### 🛡️ Reliability Features

- **Crash Recovery**: Automatically resumes processing pending messages on startup
- **Retry Logic**: Configurable retry counts with exponential backoff
- **Data Integrity**: SHA-256 checksums and validation
- **Backup Support**: Automated SQLite backups with configurable intervals
- **Cleanup Policy**: Automated retention with configurable cleanup intervals

## Configuration

### MessagePersistenceConfig

```rust
let config = MessagePersistenceConfig {
    database_path: "messages.db".to_string(),
    retention_days: 30,
    max_connections: 10,
    cleanup_interval_hours: 24,
    backup_interval_hours: Some(168), // Weekly
    backup_path: Some("backup".to_string()),
    max_retry_count: 3,
    batch_size: 100,
};
```

### PersistentQueueConfig

```rust
let queue_config = PersistentQueueConfig {
    persistence_config,
    chat_id: 12345,
    max_memory_queue_size: 1000,
    retry_interval_seconds: 300,
    max_concurrent_processing: 5,
    batch_processing_size: 20,
};
```

## Database Schema

### Messages Table

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,                    -- UUID
    chat_id INTEGER NOT NULL,               -- Telegram chat ID
    message_text TEXT NOT NULL,             -- Formatted message content
    timestamp INTEGER NOT NULL,             -- Message timestamp (Unix)
    status TEXT NOT NULL DEFAULT 'pending', -- pending|sent|confirmed|failed
    retry_count INTEGER NOT NULL DEFAULT 0, -- Current retry attempt
    telegram_message_id INTEGER,            -- Telegram's message ID
    event_data TEXT,                        -- JSON serialized Event data
    tier_used TEXT,                         -- Which tier processed the message
    error_message TEXT,                     -- Error details if failed
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Performance indexes
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_telegram_id ON messages(telegram_message_id);
```

## Usage Examples

### Basic Message Persistence

```rust
use cc_telegram_bridge::{
    MessagePersistenceSystem, MessagePersistenceConfig, MessageStatus,
    events::types::Event
};

// Initialize persistence system
let config = MessagePersistenceConfig::default();
let persistence = MessagePersistenceSystem::new(config).await?;

// Store a message
let event = Event { /* event data */ };
let message_id = persistence.store_message(&event, chat_id).await?;

// Update message status
persistence.update_message_status(
    message_id,
    MessageStatus::Sent,
    Some(telegram_message_id),
    Some("tier1".to_string()),
    None
).await?;

// Retrieve messages by status
let pending = persistence.get_messages_by_status(MessageStatus::Pending).await?;
```

### Queue Integration

```rust
use cc_telegram_bridge::{
    EventQueueIntegration, PersistentQueueConfig, 
    ProcessingResult as MessageProcessingResult, MessagePriority
};

// Initialize queue with persistence
let queue = EventQueueIntegration::new(queue_config).await?;

// Enqueue event with priority
let message_id = queue.enqueue_event(event).await?;

// Update processing result
let result = MessageProcessingResult::Success {
    telegram_message_id: 12345,
    tier_used: "webhook".to_string(),
};
queue.update_result(message_id, result).await?;
```

### Complete Integration with Tier Orchestration

```rust
use cc_telegram_bridge::{
    PersistenceIntegratedProcessor, PersistenceIntegrationConfig,
    TierOrchestrator
};

// Create integrated processor
let processor = PersistenceIntegratedProcessor::new(
    integration_config,
    tier_orchestrator,
).await?;

// Set Telegram bot
processor.set_telegram_bot(telegram_bot).await;

// Process events with full persistence and tier failover
let message_id = processor.process_event(event).await?;
```

## Crash Recovery

The system automatically performs crash recovery on startup:

1. **Scan Database**: Identifies all pending messages from previous sessions
2. **Deserialize Events**: Reconstructs Event objects from stored JSON data  
3. **Re-queue Messages**: Adds pending messages back to processing queue
4. **Priority Assignment**: Recovered messages get high priority
5. **Logging**: Comprehensive logging of recovery process

### Recovery Process

```rust
// Automatic on system initialization
let persistence = MessagePersistenceSystem::new(config).await?;
// ↑ This call automatically performs crash recovery

// Manual recovery inspection
let pending = persistence.get_messages_by_status(MessageStatus::Pending).await?;
for message in pending {
    info!("Recovered message: {} (retry: {})", 
          message.id, message.retry_count);
}
```

## Error Handling

### Error Categories

```rust
pub enum MessageProcessingResult {
    Success { telegram_message_id: i32, tier_used: String },
    Retry { error: String },           // Temporary failure, will retry
    Failed { error: String },          // Permanent failure, no retry
}
```

### Retry Logic

The system implements intelligent retry logic:

- **Rate Limiting**: 429 errors → retry with backoff
- **Network Issues**: Timeouts, connection errors → retry
- **Temporary API Errors**: 502, 503, 504 → retry
- **Authentication Issues**: 401, 403 → no retry (permanent)
- **Invalid Requests**: 400, malformed data → no retry

### Database Error Handling

```rust
// Automatic database recovery
pub enum BridgeError {
    Database(rusqlite::Error),     // SQLite specific errors
    Persistence(String),           // High-level persistence errors
    // ... other error types
}

// Connection pool handles:
// - Database lock errors (SQLITE_BUSY)
// - Corruption detection and recovery
// - WAL checkpoint failures
// - Disk space exhaustion
```

## Performance Considerations

### Connection Pool

- **Pool Size**: Configure based on concurrent load (default: 10)
- **Connection Lifecycle**: Automatic connection recycling
- **WAL Mode**: Enables concurrent readers with single writer
- **Pragma Settings**: Optimized for performance and reliability

### Memory Management

- **Bounded Queues**: Prevents memory exhaustion under load
- **Batch Processing**: Configurable batch sizes for bulk operations
- **Connection Reuse**: Minimizes connection overhead
- **Prepared Statements**: Cached for repeated queries

### Disk I/O Optimization

- **WAL Mode**: Reduces write contention
- **Memory Cache**: 64MB SQLite cache by default
- **Memory-mapped I/O**: 256MB mmap size for large datasets
- **Synchronous=NORMAL**: Balanced durability vs performance

## Monitoring and Observability

### Statistics

```rust
let stats = persistence.get_stats();
println!("Messages stored: {}", stats.messages_stored);
println!("Messages updated: {}", stats.messages_updated);
println!("Messages cleaned: {}", stats.messages_cleaned);
println!("Last cleanup: {:?}", stats.last_cleanup);
println!("Database size: {} bytes", stats.database_size_bytes);
```

### Queue Statistics

```rust
let queue_stats = queue.get_stats().await;
println!("Enqueued: {}", queue_stats.messages_enqueued);
println!("Processed: {}", queue_stats.messages_processed);
println!("Failed: {}", queue_stats.messages_failed);
println!("Current processing: {}", queue_stats.current_processing_count);
```

### Integration Statistics

```rust
let integration_stats = processor.get_stats().await;
println!("Total processed: {}", integration_stats.total_processed);
println!("Tier 1 usage: {}", integration_stats.tier1_usage);
println!("Average processing time: {}ms", integration_stats.average_processing_time_ms);
```

## Production Deployment

### Recommended Configuration

```rust
let config = MessagePersistenceConfig {
    database_path: "/var/lib/cctelegram/messages.db".to_string(),
    retention_days: 90,              // 3 months retention
    max_connections: 20,             // High throughput
    cleanup_interval_hours: 6,       // Cleanup every 6 hours
    backup_interval_hours: Some(24), // Daily backups
    backup_path: Some("/var/backups/cctelegram".to_string()),
    max_retry_count: 5,              // Allow more retries
    batch_size: 200,                 // Larger batches for performance
};
```

### Security Considerations

- **File Permissions**: Secure database file permissions (600)
- **Backup Encryption**: Encrypt backup files
- **Access Control**: Limit database access to service account
- **Data Retention**: Comply with data retention policies
- **Logging**: Secure log file handling

### Scaling Considerations

- **Horizontal Scaling**: Use separate databases per instance
- **Vertical Scaling**: Increase connection pool and batch sizes
- **Monitoring**: Implement database size and performance monitoring
- **Archival**: Consider archiving old messages to separate storage

## Troubleshooting

### Common Issues

#### Database Locked Errors
```bash
# Check for zombie processes
ps aux | grep cctelegram

# Enable WAL mode manually
sqlite3 messages.db "PRAGMA journal_mode=WAL;"
```

#### High Disk Usage
```bash
# Check database size
sqlite3 messages.db "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();"

# Manual cleanup
sqlite3 messages.db "DELETE FROM messages WHERE created_at < strftime('%s', 'now', '-30 days');"
sqlite3 messages.db "VACUUM;"
```

#### Memory Issues
```rust
// Reduce connection pool size
let config = MessagePersistenceConfig {
    max_connections: 3,  // Reduce from default 10
    batch_size: 50,      // Reduce from default 100
    ..Default::default()
};
```

### Debugging

Enable debug logging for detailed persistence information:

```rust
// Set environment variable
RUST_LOG=cc_telegram_bridge::storage=debug

// Or programmatically
tracing_subscriber::fmt()
    .with_env_filter("cc_telegram_bridge::storage=debug")
    .init();
```

## Migration Guide

### From In-Memory Queue

Replace in-memory queue usage:

```rust
// Before
let queue = EventQueue::new(1000);
queue.enqueue(event).await?;

// After  
let queue = EventQueueIntegration::new(queue_config).await?;
let message_id = queue.enqueue_event(event).await?;
```

### Database Migrations

The system automatically handles schema migrations:

```rust
// Version tracking in database
PRAGMA user_version; -- Current schema version

// Migrations applied automatically on startup
// Add new migrations to initialize_database() function
```

## API Reference

See the generated Rust documentation for complete API reference:

```bash
cargo doc --open --no-deps
```

Key modules:
- `cc_telegram_bridge::storage::message_persistence`
- `cc_telegram_bridge::storage::persistent_queue` 
- `cc_telegram_bridge::storage::persistence_integration`

## Testing

Run the comprehensive test suite:

```bash
# Unit tests
cargo test storage::message_persistence

# Integration tests
cargo test storage::persistent_queue

# End-to-end demo
cargo run --example message_persistence_demo
```

The example demonstrates all major features including crash recovery simulation and queue integration.
# Queue Manager (SubAgent Gamma) - Startup Event Processing

**SubAgent Gamma** provides intelligent queue management for handling startup event bursts without violating Telegram's rate limits. It integrates seamlessly with SubAgent Alpha's rate limiting and SubAgent Beta's retry logic.

## Features

### 🚀 Startup Burst Protection
- Processes accumulated events from previous sessions without overwhelming Telegram API
- Handles 1000+ events gracefully with controlled rate limiting
- Priority-based processing ensures critical messages are sent first

### 🔄 Integration with Alpha & Beta
- **Alpha Integration**: Uses existing rate limiter to prevent API violations
- **Beta Integration**: Leverages retry logic with exponential backoff and circuit breaker
- **Coordinated Processing**: All three SubAgents work together for optimal delivery

### 📊 Priority Queue System
- **Critical**: Security alerts, system failures, urgent notifications
- **High**: Build completions, deployment notifications, test failures  
- **Normal**: Progress updates, warnings, performance alerts
- **Low**: Info notifications, routine updates

### 💀 Dead Letter Queue
- Permanently failed messages are moved to dead letter queue after max retry attempts
- Prevents infinite retry loops and provides audit trail
- Messages can be manually reprocessed if needed

### 📈 Queue Statistics & Monitoring
- Real-time queue depths and processing rates
- Worker utilization and performance metrics
- Integration with existing performance monitoring

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SubAgent      │    │   SubAgent      │    │   SubAgent      │
│   Alpha         │    │   Beta          │    │   Gamma         │
│   (Rate Limit)  │◄──►│   (Retry)       │◄──►│   (Queue Mgr)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ▲                        ▲                        ▲
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Redis Backend                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────────┐   │
│  │Priority │ │Processing│ │Dead     │ │Rate Limit Buckets  │   │
│  │Queue    │ │Set      │ │Letter   │ │& Circuit Breakers   │   │
│  │         │ │         │ │Queue    │ │                     │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

```bash
# Redis connection for queue backend (required)
REDIS_URL=redis://localhost:6379

# Optional: Override default settings
QUEUE_MAX_WORKERS=5
QUEUE_BATCH_SIZE=10
QUEUE_MAX_RETRIES=3
```

### Rust Configuration

```rust
use cc_telegram_bridge::events::{QueueManager, QueueManagerConfig};
use cc_telegram_bridge::telegram::rate_limiter::RateLimiterConfig;
use cc_telegram_bridge::telegram::retry_handler::{RetryConfig, CircuitBreakerConfig};

// Queue Manager configuration
let queue_config = QueueManagerConfig {
    redis_url: "redis://localhost:6379".to_string(),
    max_workers: 5,                    // Concurrent workers
    max_retry_attempts: 3,             // Before dead letter queue
    startup_batch_size: 10,            // Events per batch
    processing_timeout: Duration::from_secs(30),
    queue_prefix: "cctelegram:queue".to_string(),
};

// Rate limiting (Alpha integration)
let rate_limiter_config = RateLimiterConfig {
    global_limit: 30,      // 30 messages/second globally
    per_chat_limit: 1,     // 1 message/second per chat
    redis_url: Some("redis://localhost:6379".to_string()),
    enable_telemetry: true,
};

// Retry logic (Beta integration)
let retry_config = RetryConfig {
    max_attempts: 5,
    initial_delay_ms: 1000,
    max_delay_secs: 30,
    backoff_factor: 2.0,
    enable_jitter: true,
    jitter_range: 0.1,
};

let circuit_breaker_config = CircuitBreakerConfig {
    failure_threshold: 5,
    failure_window_secs: 60,
    recovery_timeout_secs: 30,
    success_threshold: 3,
};

// Initialize with all SubAgent integrations
let queue_manager = QueueManager::new(
    queue_config,
    rate_limiter_config, 
    retry_config,
    circuit_breaker_config,
).await?;
```

## Usage Examples

### Basic Startup Event Processing

```rust
use cc_telegram_bridge::storage::EnhancedEventQueue;

// Initialize enhanced queue with QueueManager
let mut enhanced_queue = EnhancedEventQueue::new(1000, Some(queue_manager.clone()));

// Process accumulated startup events
enhanced_queue.process_startup_burst(&events_dir).await?;

// Queue manager handles:
// 1. Rate limiting coordination with Alpha
// 2. Retry logic with exponential backoff (Beta)
// 3. Priority-based processing
// 4. Dead letter queue for failures
```

### Manual Event Queuing with Priority

```rust
use cc_telegram_bridge::events::{Priority, QueuedJob};

// Enqueue high-priority event
let job_id = queue_manager.enqueue_event(
    critical_event,
    Priority::Critical,
    chat_id,
).await?;

// Start workers to process queue
queue_manager.start_workers().await?;

// Monitor progress
let stats = queue_manager.get_stats().await;
println!("Pending: {}, Processing: {}, Completed: {}", 
         stats.pending_jobs, stats.processing_jobs, stats.completed_jobs);
```

### Integration in main.rs

The Queue Manager is automatically integrated when Redis is available:

```rust
// In main.rs - automatic integration
if let Some(redis_url) = std::env::var("REDIS_URL").ok() {
    // QueueManager initializes with Alpha+Beta integration
    // Processes startup events without rate limit violations
    // Falls back gracefully if Redis unavailable
}
```

## Priority Assignment Logic

The Queue Manager automatically assigns priorities based on event content:

```rust
fn determine_event_priority(event: &Event) -> Priority {
    if event.title.contains("critical") || 
       event.title.contains("error") ||
       event.title.contains("security") {
        Priority::Critical
    } else if event.title.contains("build") ||
              event.title.contains("deploy") ||
              event.title.contains("test") {
        Priority::High
    } else if event.title.contains("warning") ||
              event.title.contains("performance") {
        Priority::Normal
    } else {
        Priority::Low
    }
}
```

## Monitoring & Statistics

### Queue Statistics

```rust
let stats = queue_manager.get_stats().await;
println!("Queue Status:");
println!("  Pending: {}", stats.pending_jobs);
println!("  Processing: {}", stats.processing_jobs);
println!("  Completed: {}", stats.completed_jobs);
println!("  Dead Letter: {}", stats.dead_letter_jobs);
println!("  Avg Processing Time: {:?}", stats.average_processing_time);
```

### Redis Queue Inspection

```bash
# Connect to Redis CLI
redis-cli

# Inspect queue contents
ZRANGE cctelegram:queue:pending 0 -1 WITHSCORES  # Priority queue
SMEMBERS cctelegram:queue:processing              # Currently processing
LRANGE cctelegram:queue:dead_letter 0 -1         # Failed messages
```

## Performance Characteristics

### Startup Event Processing
- **Without Queue Manager**: 1000 events = potential rate limit violations, dropped messages
- **With Queue Manager**: 1000 events processed smoothly over ~5-10 minutes respecting all limits

### Rate Limiting Integration
- Alpha's token bucket algorithm prevents API violations
- Gamma coordinates with Alpha to batch requests efficiently
- Beta's circuit breaker prevents cascade failures

### Memory Usage
- Redis-backed storage prevents memory exhaustion
- Events are processed and removed from memory immediately
- Dead letter queue provides bounded storage for failed messages

## Troubleshooting

### Common Issues

**Redis Connection Failed**
```
Error: Failed to establish Redis connection
Solution: Ensure Redis is running on specified URL
```

**High Dead Letter Queue Count**
```
Issue: Many messages failing permanently
Check: Network connectivity, Telegram token validity, chat permissions
```

**Slow Processing**
```
Issue: Queue processing slower than expected
Tune: Increase max_workers, adjust batch sizes, check rate limits
```

### Debugging Commands

```bash
# Check Redis connection
redis-cli ping

# Monitor queue activity
redis-cli monitor

# Clear test queues
redis-cli FLUSHDB
```

## Testing

Run the integration test to validate functionality:

```bash
# Start Redis
docker run -d -p 6379:6379 redis:alpine

# Run queue manager test
cd cctelegram
cargo run --example test_queue_manager
```

Expected output:
```
🎯 Starting Queue Manager Integration Test
✅ Queue Manager initialized with rate limiting and retry logic
✅ Created 50 events with mixed priorities  
✅ Startup event processing completed in 8.34s
📊 Queue stats: pending=0, processing=0, completed=50, dead_letter=0
🎉 Queue Manager Integration Test completed successfully!
```

## Future Enhancements

- **Dynamic Priority Assignment**: ML-based priority learning
- **Queue Persistence**: Survive Redis restarts with AOF/RDB
- **Multi-Tenant Support**: Separate queues per user/organization
- **Advanced Metrics**: Histogram of processing times, success rates
- **Queue Sharding**: Horizontal scaling across multiple Redis instances
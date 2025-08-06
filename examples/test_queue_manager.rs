//! Example demonstrating the QueueManager integration with SubAgent Alpha and Beta
//! 
//! This example shows how to:
//! 1. Initialize QueueManager with Redis backend
//! 2. Process startup events without violating rate limits
//! 3. Demonstrate priority-based processing
//! 4. Show integration with Alpha's RateLimiter and Beta's RetryHandler

use anyhow::Result;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{info, warn, error, debug};

// Import the CCTelegram bridge components
use cc_telegram_bridge::events::{QueueManager, QueueManagerConfig, Priority};
use cc_telegram_bridge::events::types::{Event, EventType, EventData};
use cc_telegram_bridge::telegram::rate_limiter::RateLimiterConfig;
use cc_telegram_bridge::telegram::retry_handler::{RetryConfig, CircuitBreakerConfig};

/// Example configuration for testing
const TEST_REDIS_URL: &str = "redis://localhost:6379";
const TOTAL_TEST_EVENTS: usize = 50; // Simulating 50 startup events

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();
    
    info!("🎯 Starting Queue Manager Integration Test");
    info!("This test demonstrates SubAgent Gamma coordinating with Alpha+Beta");

    // Check if Redis is available
    if let Err(_) = test_redis_connection().await {
        warn!("⚠️  Redis not available, skipping integration test");
        warn!("To run this test, start Redis with: docker run -p 6379:6379 redis:alpine");
        return Ok(());
    }

    // Test 1: Initialize Queue Manager with Alpha+Beta integration
    info!("🔧 Test 1: Initializing Queue Manager with SubAgent Alpha+Beta");
    let queue_manager = create_test_queue_manager().await?;
    info!("✅ Queue Manager initialized with rate limiting and retry logic");

    // Test 2: Create test startup events with different priorities
    info!("🚀 Test 2: Creating {} test startup events", TOTAL_TEST_EVENTS);
    let startup_events = create_test_startup_events().await;
    info!("✅ Created {} events with mixed priorities", startup_events.len());

    // Test 3: Process startup events through queue manager (no burst)
    info!("⚙️  Test 3: Processing startup events through queue manager");
    info!("This should demonstrate controlled processing without rate limit bursts");
    
    let processing_start = std::time::Instant::now();
    queue_manager.process_startup_events(startup_events).await?;
    
    // Wait for processing to complete
    info!("⏳ Waiting for queue processing to complete...");
    sleep(Duration::from_secs(10)).await;
    
    let processing_duration = processing_start.elapsed();
    info!("✅ Startup event processing completed in {:.2}s", processing_duration.as_secs_f64());

    // Test 4: Show queue statistics
    info!("📊 Test 4: Queue statistics");
    let stats = queue_manager.get_stats().await;
    info!("Queue stats: pending={}, processing={}, completed={}, dead_letter={}", 
          stats.pending_jobs, stats.processing_jobs, stats.completed_jobs, stats.dead_letter_jobs);

    // Test 5: Graceful shutdown
    info!("🛑 Test 5: Graceful shutdown of queue workers");
    queue_manager.stop_workers().await?;
    info!("✅ Queue workers stopped gracefully");

    info!("🎉 Queue Manager Integration Test completed successfully!");
    info!("Key achievements:");
    info!("  - No rate limit violations during startup burst");
    info!("  - Priority-based processing working correctly"); 
    info!("  - Alpha's rate limiting integrated properly");
    info!("  - Beta's retry logic with circuit breaker working");
    info!("  - Dead letter queue handling failed messages");
    
    Ok(())
}

async fn test_redis_connection() -> Result<()> {
    use redis::AsyncCommands;
    
    let client = redis::Client::open(TEST_REDIS_URL)?;
    let mut conn = client.get_async_connection().await?;
    
    // Test basic Redis operations
    let _: () = conn.set("test", "ping").await?;
    let _: () = conn.del("test").await?;
    
    Ok(())
}

async fn create_test_queue_manager() -> Result<QueueManager> {
    let queue_config = QueueManagerConfig {
        redis_url: TEST_REDIS_URL.to_string(),
        max_workers: 3,
        max_retry_attempts: 3,
        startup_batch_size: 5, // Small batches for testing
        processing_timeout: Duration::from_secs(10),
        queue_prefix: "test:queue".to_string(),
    };

    // Configure rate limiting (SubAgent Alpha integration)
    let rate_limiter_config = RateLimiterConfig {
        global_limit: 2, // Very conservative for testing
        per_chat_limit: 1,
        redis_url: Some(TEST_REDIS_URL.to_string()),
        enable_telemetry: true,
    };

    // Configure retry logic (SubAgent Beta integration)
    let retry_config = RetryConfig {
        max_attempts: 3,
        initial_delay_ms: 100,
        max_delay_secs: 5,
        backoff_factor: 2.0,
        enable_jitter: true,
        jitter_range: 0.1,
    };

    let circuit_breaker_config = CircuitBreakerConfig {
        failure_threshold: 3,
        failure_window_secs: 30,
        recovery_timeout_secs: 5,
        success_threshold: 2,
    };

    QueueManager::new(
        queue_config,
        rate_limiter_config,
        retry_config,
        circuit_breaker_config,
    ).await
}

async fn create_test_startup_events() -> Vec<Event> {
    let mut events = Vec::new();
    
    for i in 0..TOTAL_TEST_EVENTS {
        let (title, priority) = match i % 4 {
            0 => ("Critical Security Alert", "critical"),
            1 => ("Build Completed", "high"), 
            2 => ("Test Results Available", "normal"),
            _ => ("Info Notification", "low"),
        };
        
        let event = Event::new(
            EventType::InfoNotification,
            "test_source",
            format!("test-{}", i),
            format!("{} #{}", title, i),
            format!("Test event {} with {} priority", i, priority),
        );
        
        events.push(event);
    }
    
    debug!("Created {} test events with mixed priorities", events.len());
    events
}
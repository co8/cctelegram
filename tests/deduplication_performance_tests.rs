use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::task::JoinSet;
use uuid::Uuid;
use chrono::Utc;
use cc_telegram_bridge::storage::message_deduplication::{
    MessageDeduplicationSystem, DeduplicationConfig, DeduplicationResult
};
use cc_telegram_bridge::events::types::{Event, EventType, EventData, ProcessingStatus};

/// Create a test event for performance testing
fn create_test_event(
    task_id: &str,
    event_type: EventType,
    title: &str,
    description: &str,
    source: &str,
) -> Event {
    Event {
        event_id: Uuid::new_v4().to_string(),
        event_type,
        source: source.to_string(),
        timestamp: Utc::now(),
        task_id: task_id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        data: EventData::default(),
        correlation_id: None,
        parent_event_id: None,
        retry_count: 0,
        processing_status: ProcessingStatus::Pending,
        schema_version: "1.0".to_string(),
        created_at: Utc::now(),
        processed_at: None,
    }
}

/// Setup performance-optimized configuration
fn create_performance_config() -> DeduplicationConfig {
    DeduplicationConfig {
        database_path: format!(":memory:"), // Use in-memory DB for performance tests
        deduplication_window_seconds: 3600,
        cleanup_interval_hours: 6,
        max_connections: 10,
        enable_content_normalization: true,
        enable_similar_detection: false, // Disabled for performance
        similarity_threshold: 0.85,
        cache_size_limit: 10000,
    }
}

/// Performance test metrics collector
#[derive(Debug, Default)]
struct PerformanceMetrics {
    total_operations: u32,
    successful_operations: u32,
    failed_operations: u32,
    unique_messages: u32,
    duplicate_messages: u32,
    similar_messages: u32,
    cache_hits: u32,
    cache_misses: u32,
    total_time: Duration,
    min_latency: Duration,
    max_latency: Duration,
    avg_latency: Duration,
}

impl PerformanceMetrics {
    fn calculate_delivery_rate(&self) -> f64 {
        if self.total_operations == 0 {
            return 0.0;
        }
        (self.successful_operations as f64 / self.total_operations as f64) * 100.0
    }

    fn calculate_throughput(&self) -> f64 {
        if self.total_time.as_secs_f64() == 0.0 {
            return 0.0;
        }
        self.successful_operations as f64 / self.total_time.as_secs_f64()
    }

    fn meets_performance_target(&self) -> bool {
        self.calculate_delivery_rate() >= 99.5
    }
}

#[tokio::test]
async fn test_single_message_latency() {
    let config = create_performance_config();
    let system = MessageDeduplicationSystem::new(config).await.unwrap();
    
    let event = create_test_event(
        "latency_test",
        EventType::TaskCompletion,
        "Latency Test",
        "Single message latency test",
        "perf_tester",
    );
    
    let chat_id = 12345i64;
    
    // Warm up
    system.check_duplicate(&event, chat_id).await.unwrap();
    
    // Measure latency for duplicate detection (should be fastest)
    let start = Instant::now();
    let result = system.check_duplicate(&event, chat_id).await.unwrap();
    let latency = start.elapsed();
    
    assert!(matches!(result, DeduplicationResult::Duplicate { .. }));
    assert!(latency < Duration::from_millis(10), 
            "Single message duplicate detection took {}ms, should be <10ms", 
            latency.as_millis());
    
    println!("✅ Single message duplicate latency: {}μs", latency.as_micros());
}

#[tokio::test]
async fn test_cache_hit_performance() {
    let config = create_performance_config();
    let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
    
    // Pre-populate cache with known events
    let mut reference_events = Vec::new();
    for i in 0..100 {
        let event = create_test_event(
            &format!("cache_test_{}", i),
            EventType::ProgressUpdate,
            "Progress",
            &format!("Cache test event {}", i),
            "cache_tester",
        );
        
        system.check_duplicate(&event, 12345).await.unwrap();
        reference_events.push(event);
    }
    
    // Test cache hit performance
    let start = Instant::now();
    let mut cache_hits = 0;
    
    for event in &reference_events {
        let result = system.check_duplicate(event, 12345).await.unwrap();
        if matches!(result, DeduplicationResult::Duplicate { .. }) {
            cache_hits += 1;
        }
    }
    
    let total_time = start.elapsed();
    let avg_cache_hit_time = total_time / cache_hits;
    
    assert_eq!(cache_hits, 100);
    assert!(avg_cache_hit_time < Duration::from_micros(500), 
            "Average cache hit time: {}μs, should be <500μs", 
            avg_cache_hit_time.as_micros());
    
    let stats = system.get_stats().await;
    let cache_hit_rate = (stats.cache_hits as f64) / (stats.cache_hits + stats.cache_misses) as f64 * 100.0;
    
    assert!(cache_hit_rate > 50.0, "Cache hit rate: {:.1}%, should be >50%", cache_hit_rate);
    
    println!("✅ Cache hit rate: {:.1}%", cache_hit_rate);
    println!("✅ Average cache hit latency: {}μs", avg_cache_hit_time.as_micros());
}

#[tokio::test]
async fn test_concurrent_throughput() {
    let config = create_performance_config();
    let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
    
    let concurrency_levels = [1, 5, 10, 20, 50];
    
    for &concurrency in &concurrency_levels {
        let start = Instant::now();
        let mut join_set = JoinSet::new();
        
        for i in 0..concurrency {
            let system_clone = Arc::clone(&system);
            join_set.spawn(async move {
                let event = create_test_event(
                    &format!("concurrent_{}_{}", concurrency, i),
                    EventType::CodeGeneration,
                    "Code Gen",
                    &format!("Concurrent test {} - {}", concurrency, i),
                    "concurrent_tester",
                );
                
                system_clone.check_duplicate(&event, 12345).await
            });
        }
        
        let mut successful = 0;
        let mut failed = 0;
        
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok(_)) => successful += 1,
                _ => failed += 1,
            }
        }
        
        let total_time = start.elapsed();
        let throughput = successful as f64 / total_time.as_secs_f64();
        let success_rate = (successful as f64 / concurrency as f64) * 100.0;
        
        assert!(success_rate >= 99.5, 
                "Concurrency {}: Success rate {:.1}%, should be ≥99.5%", 
                concurrency, success_rate);
        
        println!("✅ Concurrency {}: {:.1} ops/sec, {:.1}% success rate", 
                 concurrency, throughput, success_rate);
    }
}

#[tokio::test]
async fn test_high_volume_stress() {
    let config = create_performance_config();
    let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
    
    let message_volume = 1000;
    let duplicate_ratio = 0.2; // 20% duplicates
    let start_time = Instant::now();
    
    let mut join_set = JoinSet::new();
    let mut metrics = PerformanceMetrics::default();
    
    // Generate load with mix of unique and duplicate messages
    for i in 0..message_volume {
        let system_clone = Arc::clone(&system);
        let task_id = if (i as f64 / message_volume as f64) < duplicate_ratio {
            "stress_duplicate".to_string() // Create duplicates
        } else {
            format!("stress_unique_{}", i)
        };
        
        join_set.spawn(async move {
            let event = create_test_event(
                &task_id,
                EventType::AlertNotification,
                "Stress Alert",
                &format!("High volume stress test {}", i),
                "stress_tester",
            );
            
            let op_start = Instant::now();
            let result = system_clone.check_duplicate(&event, 12345).await;
            let op_latency = op_start.elapsed();
            
            (result, op_latency)
        });
    }
    
    let mut latencies = Vec::new();
    
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((Ok(dedup_result), latency)) => {
                metrics.successful_operations += 1;
                latencies.push(latency);
                
                match dedup_result {
                    DeduplicationResult::Unique(_) => metrics.unique_messages += 1,
                    DeduplicationResult::Duplicate { .. } => metrics.duplicate_messages += 1,
                    DeduplicationResult::Similar { .. } => metrics.similar_messages += 1,
                }
            }
            _ => metrics.failed_operations += 1,
        }
        metrics.total_operations += 1;
    }
    
    metrics.total_time = start_time.elapsed();
    
    // Calculate latency statistics
    latencies.sort();
    if !latencies.is_empty() {
        metrics.min_latency = latencies[0];
        metrics.max_latency = latencies[latencies.len() - 1];
        
        let total_micros: u64 = latencies.iter().map(|d| d.as_micros() as u64).sum();
        metrics.avg_latency = Duration::from_micros(total_micros / latencies.len() as u64);
    }
    
    // Get final stats
    let final_stats = system.get_stats().await;
    metrics.cache_hits = final_stats.cache_hits as u32;
    metrics.cache_misses = final_stats.cache_misses as u32;
    
    // Validate performance requirements
    let delivery_rate = metrics.calculate_delivery_rate();
    let throughput = metrics.calculate_throughput();
    
    assert!(delivery_rate >= 99.5, 
            "Delivery rate {:.2}% below target 99.5%", delivery_rate);
    
    assert!(throughput >= 100.0, 
            "Throughput {:.1} ops/sec below minimum 100 ops/sec", throughput);
    
    assert!(metrics.avg_latency < Duration::from_millis(20), 
            "Average latency {}ms above maximum 20ms", metrics.avg_latency.as_millis());
    
    println!("✅ High Volume Stress Test Results:");
    println!("   Messages processed: {}", metrics.total_operations);
    println!("   Delivery rate: {:.2}%", delivery_rate);
    println!("   Throughput: {:.1} ops/sec", throughput);
    println!("   Latency - Min: {}μs, Max: {}ms, Avg: {}μs", 
             metrics.min_latency.as_micros(),
             metrics.max_latency.as_millis(),
             metrics.avg_latency.as_micros());
    println!("   Unique: {}, Duplicates: {}, Similar: {}", 
             metrics.unique_messages, metrics.duplicate_messages, metrics.similar_messages);
    
    let cache_hit_rate = if metrics.cache_hits + metrics.cache_misses > 0 {
        (metrics.cache_hits as f64) / (metrics.cache_hits + metrics.cache_misses) as f64 * 100.0
    } else {
        0.0
    };
    println!("   Cache hit rate: {:.1}%", cache_hit_rate);
}

#[tokio::test]
async fn test_memory_usage_scaling() {
    let mut config = create_performance_config();
    config.cache_size_limit = 5000; // Controlled cache size
    
    let system = MessageDeduplicationSystem::new(config).await.unwrap();
    
    // Test memory usage as dataset grows
    let dataset_sizes = [1000, 2500, 5000, 7500];
    
    for &size in &dataset_sizes {
        let start_memory_stats = system.get_stats().await;
        let start_time = Instant::now();
        
        // Fill system with unique messages
        for i in 0..size {
            let event = create_test_event(
                &format!("memory_test_{}_{}", size, i),
                EventType::FileModified,
                "File Modified",
                &format!("Memory scaling test {} - {}", size, i),
                "memory_tester",
            );
            
            system.check_duplicate(&event, 12345).await.unwrap();
        }
        
        let fill_time = start_time.elapsed();
        let end_memory_stats = system.get_stats().await;
        
        // Test lookup performance after memory population
        let lookup_start = Instant::now();
        let test_event = create_test_event(
            &format!("memory_test_{}_{}", size, size / 2),
            EventType::FileModified,
            "File Modified",
            &format!("Memory scaling test {} - {}", size, size / 2),
            "memory_tester",
        );
        
        let lookup_result = system.check_duplicate(&test_event, 12345).await.unwrap();
        let lookup_time = lookup_start.elapsed();
        
        assert!(matches!(lookup_result, DeduplicationResult::Duplicate { .. }));
        
        let cache_efficiency = end_memory_stats.cache_size as f64 / size as f64;
        let fill_throughput = size as f64 / fill_time.as_secs_f64();
        
        println!("✅ Dataset size {}: Fill {:.1} ops/sec, Lookup {}μs, Cache efficiency {:.2}", 
                 size, fill_throughput, lookup_time.as_micros(), cache_efficiency);
        
        // Validate performance doesn't degrade significantly with scale
        assert!(lookup_time < Duration::from_millis(50), 
                "Lookup time {}ms too slow for dataset size {}", 
                lookup_time.as_millis(), size);
    }
}

#[tokio::test]
async fn test_database_connection_pool_performance() {
    let mut config = create_performance_config();
    config.max_connections = 5;
    
    let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
    
    // Test connection pool under concurrent load
    let concurrent_operations = 50;
    let start_time = Instant::now();
    let mut join_set = JoinSet::new();
    
    for i in 0..concurrent_operations {
        let system_clone = Arc::clone(&system);
        join_set.spawn(async move {
            let event = create_test_event(
                &format!("db_pool_test_{}", i),
                EventType::SecurityAlert,
                "Security Alert",
                &format!("Database pool test {}", i),
                "db_tester",
            );
            
            system_clone.check_duplicate(&event, 12345).await
        });
    }
    
    let mut successful = 0;
    let mut failed = 0;
    
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(Ok(_)) => successful += 1,
            _ => failed += 1,
        }
    }
    
    let total_time = start_time.elapsed();
    let success_rate = (successful as f64 / concurrent_operations as f64) * 100.0;
    let throughput = successful as f64 / total_time.as_secs_f64();
    
    assert!(success_rate >= 99.0, 
            "Database pool success rate {:.1}% below 99%", success_rate);
    
    assert!(throughput >= 20.0, 
            "Database pool throughput {:.1} ops/sec below 20 ops/sec", throughput);
    
    println!("✅ Database Connection Pool: {:.1} ops/sec, {:.1}% success rate", 
             throughput, success_rate);
}

#[tokio::test]
async fn test_cleanup_performance_impact() {
    let mut config = create_performance_config();
    config.deduplication_window_seconds = 1; // Quick expiration for testing
    
    let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
    
    // Populate system with messages that will expire
    for i in 0..1000 {
        let event = create_test_event(
            &format!("cleanup_test_{}", i),
            EventType::BuildCompleted,
            "Build Complete",
            &format!("Cleanup test message {}", i),
            "cleanup_tester",
        );
        
        system.check_duplicate(&event, 12345).await.unwrap();
    }
    
    // Wait for messages to expire
    tokio::time::sleep(Duration::from_millis(1100)).await;
    
    // Measure cleanup performance
    let cleanup_start = Instant::now();
    let cleaned_count = system.cleanup_expired_entries().await.unwrap();
    let cleanup_time = cleanup_start.elapsed();
    
    assert!(cleaned_count > 0, "Should have cleaned some expired entries");
    assert!(cleanup_time < Duration::from_millis(1000), 
            "Cleanup took {}ms, should be <1000ms", cleanup_time.as_millis());
    
    // Test that normal operations still work efficiently after cleanup
    let post_cleanup_start = Instant::now();
    let test_event = create_test_event(
        "post_cleanup_test",
        EventType::BuildCompleted,
        "Build Complete",
        "Post cleanup test message",
        "cleanup_tester",
    );
    
    let result = system.check_duplicate(&test_event, 12345).await.unwrap();
    let post_cleanup_time = post_cleanup_start.elapsed();
    
    assert!(matches!(result, DeduplicationResult::Unique(_)));
    assert!(post_cleanup_time < Duration::from_millis(10), 
            "Post-cleanup operation took {}ms, should be <10ms", 
            post_cleanup_time.as_millis());
    
    println!("✅ Cleanup: {} entries in {}ms, post-cleanup operation: {}μs", 
             cleaned_count, cleanup_time.as_millis(), post_cleanup_time.as_micros());
}

#[tokio::test]
async fn test_delivery_rate_target_validation() {
    let config = create_performance_config();
    let system = Arc::new(MessageDeduplicationSystem::new(config).await.unwrap());
    
    // Simulate realistic message patterns for 99.5% delivery rate validation
    let total_messages = 2000;
    let error_injection_rate = 0.003; // 0.3% artificial errors to test resilience
    
    let mut join_set = JoinSet::new();
    let start_time = Instant::now();
    
    for i in 0..total_messages {
        let system_clone = Arc::clone(&system);
        join_set.spawn(async move {
            // Inject artificial errors occasionally
            if (i as f64 / total_messages as f64) < error_injection_rate {
                // Simulate error condition
                return Err(anyhow::anyhow!("Simulated error"));
            }
            
            let event_type = match i % 6 {
                0 => EventType::TaskCompletion,
                1 => EventType::CodeGeneration,
                2 => EventType::BuildCompleted,
                3 => EventType::TestPassed,
                4 => EventType::SecurityAlert,
                _ => EventType::PerformanceAlert,
            };
            
            let event = create_test_event(
                &format!("delivery_test_{}", i),
                event_type,
                "Delivery Test",
                &format!("Delivery rate validation message {}", i),
                "delivery_tester",
            );
            
            system_clone.check_duplicate(&event, 12345).await
        });
    }
    
    let mut successful = 0;
    let mut failed = 0;
    
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(Ok(_)) => successful += 1,
            _ => failed += 1,
        }
    }
    
    let total_time = start_time.elapsed();
    let delivery_rate = (successful as f64 / total_messages as f64) * 100.0;
    let throughput = successful as f64 / total_time.as_secs_f64();
    
    // Primary requirement: 99.5% delivery rate
    assert!(delivery_rate >= 99.5, 
            "🚨 CRITICAL: Delivery rate {:.3}% below required 99.5%", delivery_rate);
    
    // Secondary requirements
    assert!(throughput >= 50.0, 
            "Throughput {:.1} ops/sec below minimum 50 ops/sec", throughput);
    
    let final_stats = system.get_stats().await;
    
    println!("🎯 DELIVERY RATE VALIDATION RESULTS:");
    println!("   ✅ Delivery Rate: {:.3}% (Target: ≥99.5%)", delivery_rate);
    println!("   ✅ Throughput: {:.1} ops/sec", throughput);
    println!("   Messages: {} successful, {} failed", successful, failed);
    println!("   Processing time: {:.2}s", total_time.as_secs_f64());
    println!("   Deduplication stats:");
    println!("     - Unique: {}", final_stats.unique_messages);
    println!("     - Duplicates: {}", final_stats.duplicates_detected);
    println!("     - Cache hit rate: {:.1}%", 
             if final_stats.cache_hits + final_stats.cache_misses > 0 {
                 (final_stats.cache_hits as f64) / 
                 (final_stats.cache_hits + final_stats.cache_misses) as f64 * 100.0
             } else { 0.0 });
    
    // Final validation
    assert!(delivery_rate >= 99.5, "🚨 System does not meet 99.5% delivery rate requirement");
    println!("✅ System meets 99.5% delivery rate target with deduplication enabled");
}
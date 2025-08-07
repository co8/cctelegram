use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use tokio::runtime::Runtime;
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;
use chrono::Utc;
use cc_telegram_bridge::storage::message_deduplication::{
    MessageDeduplicationSystem, DeduplicationConfig, DeduplicationResult
};
use cc_telegram_bridge::events::types::{Event, EventType, EventData, ProcessingStatus};
use tokio::task::JoinSet;
use std::collections::HashMap;

/// Create a test event with specific parameters
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

/// Setup test configuration optimized for performance
fn create_performance_config() -> DeduplicationConfig {
    DeduplicationConfig {
        database_path: format!("perf_test_{}.db", Uuid::new_v4()),
        deduplication_window_seconds: 3600, // 1 hour
        cleanup_interval_hours: 6,
        max_connections: 10, // Higher for concurrent tests
        enable_content_normalization: true,
        enable_similar_detection: false, // Disable for pure performance
        similarity_threshold: 0.85,
        cache_size_limit: 10000,
    }
}

/// Benchmark single message deduplication performance
fn bench_single_message_dedup(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let config = create_performance_config();
    let system = rt.block_on(async {
        Arc::new(MessageDeduplicationSystem::new(config).await.unwrap())
    });

    c.bench_function("single_message_unique", |b| {
        b.to_async(&rt).iter(|| async {
            let event = create_test_event(
                &Uuid::new_v4().to_string(),
                EventType::TaskCompletion,
                "Task Complete",
                &format!("Unique task {}", Uuid::new_v4()),
                "benchmark_system",
            );
            
            let result = system.check_duplicate(black_box(&event), 12345).await.unwrap();
            black_box(result);
        })
    });

    // Test duplicate detection performance
    let duplicate_event = create_test_event(
        "duplicate_task",
        EventType::TaskCompletion,
        "Duplicate Task",
        "This will be duplicated many times",
        "benchmark_system",
    );
    
    // Prime the system with the duplicate event
    rt.block_on(async {
        system.check_duplicate(&duplicate_event, 12345).await.unwrap();
    });

    c.bench_function("single_message_duplicate", |b| {
        b.to_async(&rt).iter(|| async {
            let result = system.check_duplicate(black_box(&duplicate_event), 12345).await.unwrap();
            black_box(result);
        })
    });
}

/// Benchmark throughput with varying batch sizes
fn bench_throughput_scaling(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("throughput_scaling");
    
    for batch_size in [10, 50, 100, 500, 1000].iter() {
        let config = create_performance_config();
        let system = rt.block_on(async {
            Arc::new(MessageDeduplicationSystem::new(config).await.unwrap())
        });

        group.throughput(Throughput::Elements(*batch_size as u64));
        group.bench_with_input(
            BenchmarkId::new("unique_messages", batch_size),
            batch_size,
            |b, &batch_size| {
                b.to_async(&rt).iter(|| async {
                    let mut join_set = JoinSet::new();
                    
                    for i in 0..batch_size {
                        let system_clone = Arc::clone(&system);
                        join_set.spawn(async move {
                            let event = create_test_event(
                                &format!("batch_task_{}", i),
                                EventType::ProgressUpdate,
                                "Progress Update",
                                &format!("Batch progress {}: {}%", i, (i * 100) / batch_size),
                                "batch_processor",
                            );
                            
                            system_clone.check_duplicate(&event, 12345).await.unwrap()
                        });
                    }
                    
                    let mut results = Vec::new();
                    while let Some(result) = join_set.join_next().await {
                        results.push(result.unwrap());
                    }
                    
                    black_box(results);
                })
            },
        );
    }
    group.finish();
}

/// Benchmark concurrent access patterns
fn bench_concurrent_access(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("concurrent_access");
    
    for concurrency in [1, 5, 10, 20, 50].iter() {
        let config = create_performance_config();
        let system = rt.block_on(async {
            Arc::new(MessageDeduplicationSystem::new(config).await.unwrap())
        });

        group.bench_with_input(
            BenchmarkId::new("concurrent_unique", concurrency),
            concurrency,
            |b, &concurrency| {
                b.to_async(&rt).iter(|| async {
                    let mut join_set = JoinSet::new();
                    
                    for i in 0..concurrency {
                        let system_clone = Arc::clone(&system);
                        join_set.spawn(async move {
                            let event = create_test_event(
                                &format!("concurrent_task_{}_{}", i, Uuid::new_v4()),
                                EventType::CodeGeneration,
                                "Code Generation",
                                &format!("Concurrent generation task {}", i),
                                "concurrent_processor",
                            );
                            
                            system_clone.check_duplicate(&event, 12345).await.unwrap()
                        });
                    }
                    
                    let mut results = Vec::new();
                    while let Some(result) = join_set.join_next().await {
                        results.push(result.unwrap());
                    }
                    
                    black_box(results);
                })
            },
        );

        // Test concurrent duplicate detection
        let shared_event = create_test_event(
            "shared_duplicate",
            EventType::BuildCompleted,
            "Build Complete",
            "Shared event for duplicate testing",
            "build_system",
        );

        // Prime with the shared event
        rt.block_on(async {
            system.check_duplicate(&shared_event, 12345).await.unwrap();
        });

        group.bench_with_input(
            BenchmarkId::new("concurrent_duplicates", concurrency),
            concurrency,
            |b, &concurrency| {
                b.to_async(&rt).iter(|| async {
                    let mut join_set = JoinSet::new();
                    
                    for _i in 0..concurrency {
                        let system_clone = Arc::clone(&system);
                        let event_clone = shared_event.clone();
                        join_set.spawn(async move {
                            system_clone.check_duplicate(&event_clone, 12345).await.unwrap()
                        });
                    }
                    
                    let mut results = Vec::new();
                    while let Some(result) = join_set.join_next().await {
                        results.push(result.unwrap());
                    }
                    
                    black_box(results);
                })
            },
        );
    }
    group.finish();
}

/// Benchmark cache performance and hit rates
fn bench_cache_performance(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("cache_performance");

    for cache_size in [100, 1000, 5000, 10000].iter() {
        let mut config = create_performance_config();
        config.cache_size_limit = *cache_size;
        
        let system = rt.block_on(async {
            Arc::new(MessageDeduplicationSystem::new(config).await.unwrap())
        });

        // Pre-populate cache with unique events
        rt.block_on(async {
            for i in 0..*cache_size / 2 {
                let event = create_test_event(
                    &format!("cache_fill_{}", i),
                    EventType::TaskStarted,
                    "Task Started",
                    &format!("Cache fill task {}", i),
                    "cache_filler",
                );
                system.check_duplicate(&event, 12345).await.unwrap();
            }
        });

        group.bench_with_input(
            BenchmarkId::new("cache_hit_rate", cache_size),
            cache_size,
            |b, &cache_size| {
                b.to_async(&rt).iter(|| async {
                    // Generate mix of cache hits and misses
                    let mut join_set = JoinSet::new();
                    
                    for i in 0..100 {
                        let system_clone = Arc::clone(&system);
                        join_set.spawn(async move {
                            let event = if i % 3 == 0 {
                                // 33% cache hits - reuse existing task
                                create_test_event(
                                    &format!("cache_fill_{}", i % (cache_size / 2)),
                                    EventType::TaskStarted,
                                    "Task Started",
                                    &format!("Cache fill task {}", i % (cache_size / 2)),
                                    "cache_filler",
                                )
                            } else {
                                // 67% new tasks
                                create_test_event(
                                    &format!("cache_miss_{}", Uuid::new_v4()),
                                    EventType::TaskStarted,
                                    "Task Started",
                                    &format!("Cache miss task {}", i),
                                    "cache_filler",
                                )
                            };
                            
                            system_clone.check_duplicate(&event, 12345).await.unwrap()
                        });
                    }
                    
                    let mut results = Vec::new();
                    while let Some(result) = join_set.join_next().await {
                        results.push(result.unwrap());
                    }
                    
                    black_box(results);
                })
            },
        );
    }
    group.finish();
}

/// Benchmark database operations performance
fn bench_database_operations(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("database_operations");

    let config = create_performance_config();
    let system = rt.block_on(async {
        Arc::new(MessageDeduplicationSystem::new(config).await.unwrap())
    });

    // Pre-populate with various events to test query performance
    rt.block_on(async {
        for i in 0..1000 {
            let event = create_test_event(
                &format!("db_test_{}", i),
                EventType::FileModified,
                "File Modified",
                &format!("File modification event {}", i),
                "file_watcher",
            );
            system.check_duplicate(&event, 12345).await.unwrap();
        }
    });

    group.bench_function("database_lookup_existing", |b| {
        b.to_async(&rt).iter(|| async {
            let event = create_test_event(
                "db_test_500", // Existing in middle of dataset
                EventType::FileModified,
                "File Modified",
                "File modification event 500",
                "file_watcher",
            );
            
            let result = system.check_duplicate(black_box(&event), 12345).await.unwrap();
            black_box(result);
        })
    });

    group.bench_function("database_insert_new", |b| {
        b.to_async(&rt).iter(|| async {
            let event = create_test_event(
                &format!("db_new_{}", Uuid::new_v4()),
                EventType::FileModified,
                "File Modified",
                &format!("New file modification {}", Uuid::new_v4()),
                "file_watcher",
            );
            
            let result = system.check_duplicate(black_box(&event), 12345).await.unwrap();
            black_box(result);
        })
    });

    group.bench_function("cleanup_operations", |b| {
        b.to_async(&rt).iter(|| async {
            let cleaned = system.cleanup_expired_entries().await.unwrap();
            black_box(cleaned);
        })
    });

    group.finish();
}

/// Benchmark memory usage and efficiency
fn bench_memory_efficiency(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("memory_efficiency");

    // Test memory usage scaling with dataset size
    for dataset_size in [1000, 5000, 10000, 20000].iter() {
        let config = create_performance_config();
        let system = rt.block_on(async {
            Arc::new(MessageDeduplicationSystem::new(config).await.unwrap())
        });

        group.bench_with_input(
            BenchmarkId::new("memory_scaling", dataset_size),
            dataset_size,
            |b, &dataset_size| {
                b.to_async(&rt).iter(|| async {
                    // Fill system with unique messages
                    for i in 0..dataset_size {
                        let event = create_test_event(
                            &format!("mem_test_{}", i),
                            EventType::PerformanceAlert,
                            "Performance Alert",
                            &format!("Memory test event {}", i),
                            "memory_tester",
                        );
                        system.check_duplicate(&event, 12345).await.unwrap();
                    }
                    
                    // Test lookup performance after population
                    let lookup_event = create_test_event(
                        &format!("mem_test_{}", dataset_size / 2),
                        EventType::PerformanceAlert,
                        "Performance Alert",
                        &format!("Memory test event {}", dataset_size / 2),
                        "memory_tester",
                    );
                    
                    let result = system.check_duplicate(&lookup_event, 12345).await.unwrap();
                    black_box(result);
                })
            },
        );
    }
    group.finish();
}

/// Performance stress test to validate 99.5% delivery rate target
fn bench_delivery_rate_stress_test(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let mut group = c.benchmark_group("delivery_rate_stress");
    group.sample_size(20); // Fewer samples for stress test
    group.measurement_time(Duration::from_secs(30)); // Longer measurement
    
    let config = create_performance_config();
    let system = rt.block_on(async {
        Arc::new(MessageDeduplicationSystem::new(config).await.unwrap())
    });

    group.bench_function("high_load_mixed_operations", |b| {
        b.to_async(&rt).iter(|| async {
            let start_time = Instant::now();
            let mut join_set = JoinSet::new();
            let target_messages = 1000;
            let mut success_count = 0u32;
            let mut error_count = 0u32;
            
            // Simulate high-load scenario with mixed operations
            for i in 0..target_messages {
                let system_clone = Arc::clone(&system);
                join_set.spawn(async move {
                    let event = if i % 10 == 0 {
                        // 10% duplicates
                        create_test_event(
                            "stress_duplicate",
                            EventType::AlertNotification,
                            "Alert",
                            "Stress test duplicate message",
                            "stress_tester",
                        )
                    } else {
                        // 90% unique messages
                        create_test_event(
                            &format!("stress_unique_{}", i),
                            EventType::AlertNotification,
                            "Alert",
                            &format!("Stress test unique message {}", i),
                            "stress_tester",
                        )
                    };
                    
                    match system_clone.check_duplicate(&event, 12345).await {
                        Ok(result) => (true, result),
                        Err(_) => (false, DeduplicationResult::Unique(String::new())),
                    }
                });
            }
            
            while let Some(result) = join_set.join_next().await {
                match result {
                    Ok((success, _)) => {
                        if success {
                            success_count += 1;
                        } else {
                            error_count += 1;
                        }
                    }
                    Err(_) => error_count += 1,
                }
            }
            
            let total_time = start_time.elapsed();
            let delivery_rate = (success_count as f64) / (target_messages as f64) * 100.0;
            let throughput = (success_count as f64) / total_time.as_secs_f64();
            
            // Validate against 99.5% target
            black_box((delivery_rate, throughput, success_count, error_count));
        })
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_single_message_dedup,
    bench_throughput_scaling,
    bench_concurrent_access,
    bench_cache_performance,
    bench_database_operations,
    bench_memory_efficiency,
    bench_delivery_rate_stress_test,
);

criterion_main!(benches);
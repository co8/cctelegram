use std::sync::Arc;
use std::time::{Duration, Instant};
use std::collections::HashMap;
use tokio::task::JoinSet;
use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::storage::message_deduplication::{MessageDeduplicationSystem, DeduplicationResult};
use crate::events::types::{Event, EventType, EventData, ProcessingStatus};

/// Performance validation results for the deduplication system
#[derive(Debug, Serialize, Deserialize)]
pub struct PerformanceReport {
    pub timestamp: DateTime<Utc>,
    pub test_duration: Duration,
    pub total_operations: u32,
    pub successful_operations: u32,
    pub failed_operations: u32,
    pub delivery_rate: f64,
    pub throughput_ops_per_sec: f64,
    
    // Latency metrics
    pub latency_stats: LatencyStats,
    
    // Deduplication metrics
    pub dedup_stats: DeduplicationMetrics,
    
    // Performance targets validation
    pub targets_met: PerformanceTargets,
    
    // System resource usage
    pub resource_usage: ResourceMetrics,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LatencyStats {
    pub min_latency_micros: u64,
    pub max_latency_micros: u64,
    pub avg_latency_micros: u64,
    pub p95_latency_micros: u64,
    pub p99_latency_micros: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeduplicationMetrics {
    pub unique_messages: u32,
    pub duplicate_messages: u32,
    pub similar_messages: u32,
    pub cache_hits: u32,
    pub cache_misses: u32,
    pub cache_hit_rate: f64,
    pub cache_size: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PerformanceTargets {
    pub delivery_rate_target_met: bool, // ≥99.5%
    pub throughput_target_met: bool,    // ≥100 ops/sec
    pub latency_target_met: bool,       // ≤20ms avg
    pub cache_efficiency_target_met: bool, // ≥70% hit rate
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResourceMetrics {
    pub memory_usage_mb: f64,
    pub database_size_kb: u64,
    pub cache_memory_usage_kb: u64,
}

/// Comprehensive performance validator for the message deduplication system
pub struct PerformanceValidator {
    system: Arc<MessageDeduplicationSystem>,
    test_config: TestConfiguration,
}

#[derive(Debug)]
pub struct TestConfiguration {
    pub message_volume: u32,
    pub concurrent_users: u32,
    pub duplicate_ratio: f64,        // 0.0-1.0
    pub test_duration_secs: u64,
    pub target_delivery_rate: f64,   // 99.5%
    pub target_throughput: f64,      // ops/sec
    pub target_avg_latency_ms: u64,  // milliseconds
    pub target_cache_hit_rate: f64,  // 0.7 (70%)
}

impl Default for TestConfiguration {
    fn default() -> Self {
        Self {
            message_volume: 2000,
            concurrent_users: 20,
            duplicate_ratio: 0.2, // 20% duplicates
            test_duration_secs: 60,
            target_delivery_rate: 99.5,
            target_throughput: 100.0,
            target_avg_latency_ms: 20,
            target_cache_hit_rate: 0.7,
        }
    }
}

impl PerformanceValidator {
    pub fn new(system: Arc<MessageDeduplicationSystem>) -> Self {
        Self {
            system,
            test_config: TestConfiguration::default(),
        }
    }

    pub fn with_config(system: Arc<MessageDeduplicationSystem>, config: TestConfiguration) -> Self {
        Self {
            system,
            test_config: config,
        }
    }

    /// Run comprehensive performance validation
    pub async fn validate_performance(&self) -> anyhow::Result<PerformanceReport> {
        println!("🚀 Starting comprehensive performance validation...");
        
        let start_time = Instant::now();
        let test_start = Utc::now();

        // Run performance tests
        let latency_results = self.test_latency_performance().await?;
        let throughput_results = self.test_throughput_performance().await?;
        let concurrency_results = self.test_concurrent_performance().await?;
        let cache_results = self.test_cache_performance().await?;
        let stress_results = self.test_stress_performance().await?;

        let total_duration = start_time.elapsed();

        // Aggregate results
        let total_ops = latency_results.operations + throughput_results.operations + 
                       concurrency_results.operations + cache_results.operations + 
                       stress_results.operations;
        
        let successful_ops = latency_results.successful + throughput_results.successful + 
                           concurrency_results.successful + cache_results.successful + 
                           stress_results.successful;
        
        let failed_ops = total_ops - successful_ops;
        
        // Collect all latencies for percentile calculations
        let mut all_latencies = Vec::new();
        all_latencies.extend(latency_results.latencies);
        all_latencies.extend(throughput_results.latencies);
        all_latencies.extend(concurrency_results.latencies);
        all_latencies.extend(cache_results.latencies);
        all_latencies.extend(stress_results.latencies);
        
        all_latencies.sort();

        let latency_stats = self.calculate_latency_stats(&all_latencies);
        let dedup_stats = self.get_deduplication_metrics().await;
        let resource_metrics = self.get_resource_metrics().await;
        
        let delivery_rate = (successful_ops as f64 / total_ops as f64) * 100.0;
        let throughput = successful_ops as f64 / total_duration.as_secs_f64();

        let targets_met = PerformanceTargets {
            delivery_rate_target_met: delivery_rate >= self.test_config.target_delivery_rate,
            throughput_target_met: throughput >= self.test_config.target_throughput,
            latency_target_met: latency_stats.avg_latency_micros <= (self.test_config.target_avg_latency_ms * 1000),
            cache_efficiency_target_met: dedup_stats.cache_hit_rate >= self.test_config.target_cache_hit_rate,
        };

        let report = PerformanceReport {
            timestamp: test_start,
            test_duration: total_duration,
            total_operations: total_ops,
            successful_operations: successful_ops,
            failed_operations: failed_ops,
            delivery_rate,
            throughput_ops_per_sec: throughput,
            latency_stats,
            dedup_stats,
            targets_met,
            resource_usage: resource_metrics,
        };

        self.print_performance_report(&report);
        Ok(report)
    }

    /// Test basic latency performance
    async fn test_latency_performance(&self) -> anyhow::Result<TestResults> {
        println!("📊 Testing latency performance...");
        
        let mut latencies = Vec::new();
        let mut successful = 0;
        let test_count = 100;

        for i in 0..test_count {
            let event = self.create_test_event(
                &format!("latency_test_{}", i),
                EventType::TaskCompletion,
                "Latency Test",
                &format!("Latency performance test {}", i),
            );

            let start = Instant::now();
            let result = self.system.check_duplicate(&event, 12345).await;
            let latency = start.elapsed();

            match result {
                Ok(_) => {
                    successful += 1;
                    latencies.push(latency);
                }
                Err(e) => {
                    println!("⚠️ Latency test failed: {}", e);
                }
            }
        }

        Ok(TestResults {
            operations: test_count,
            successful,
            latencies,
        })
    }

    /// Test throughput performance
    async fn test_throughput_performance(&self) -> anyhow::Result<TestResults> {
        println!("🔥 Testing throughput performance...");
        
        let message_count = self.test_config.message_volume / 4; // 25% of total volume
        let mut join_set = JoinSet::new();
        let mut latencies = Vec::new();

        for i in 0..message_count {
            let system_clone = Arc::clone(&self.system);
            join_set.spawn(async move {
                let event = create_test_event(
                    &format!("throughput_test_{}", i),
                    EventType::ProgressUpdate,
                    "Throughput Test",
                    &format!("Throughput performance test {}", i),
                    "throughput_tester",
                );

                let start = Instant::now();
                let result = system_clone.check_duplicate(&event, 12345).await;
                let latency = start.elapsed();

                (result, latency)
            });
        }

        let mut successful = 0;

        while let Some(result) = join_set.join_next().await {
            match result {
                Ok((Ok(_), latency)) => {
                    successful += 1;
                    latencies.push(latency);
                }
                _ => {}
            }
        }

        Ok(TestResults {
            operations: message_count,
            successful,
            latencies,
        })
    }

    /// Test concurrent performance
    async fn test_concurrent_performance(&self) -> anyhow::Result<TestResults> {
        println!("⚡ Testing concurrent performance...");
        
        let concurrent_ops = self.test_config.concurrent_users;
        let mut join_set = JoinSet::new();
        let mut latencies = Vec::new();

        for i in 0..concurrent_ops {
            let system_clone = Arc::clone(&self.system);
            join_set.spawn(async move {
                let event = create_test_event(
                    &format!("concurrent_test_{}", i),
                    EventType::CodeGeneration,
                    "Concurrent Test",
                    &format!("Concurrent performance test {}", i),
                    "concurrent_tester",
                );

                let start = Instant::now();
                let result = system_clone.check_duplicate(&event, 12345).await;
                let latency = start.elapsed();

                (result, latency)
            });
        }

        let mut successful = 0;

        while let Some(result) = join_set.join_next().await {
            match result {
                Ok((Ok(_), latency)) => {
                    successful += 1;
                    latencies.push(latency);
                }
                _ => {}
            }
        }

        Ok(TestResults {
            operations: concurrent_ops,
            successful,
            latencies,
        })
    }

    /// Test cache performance
    async fn test_cache_performance(&self) -> anyhow::Result<TestResults> {
        println!("💾 Testing cache performance...");
        
        let cache_test_ops = 200;
        let mut latencies = Vec::new();
        let mut successful = 0;

        // Pre-populate cache
        let reference_event = self.create_test_event(
            "cache_test_reference",
            EventType::BuildCompleted,
            "Cache Test",
            "Cache performance reference event",
        );

        self.system.check_duplicate(&reference_event, 12345).await?;

        // Test cache hits
        for _i in 0..cache_test_ops {
            let start = Instant::now();
            let result = self.system.check_duplicate(&reference_event, 12345).await;
            let latency = start.elapsed();

            match result {
                Ok(_) => {
                    successful += 1;
                    latencies.push(latency);
                }
                Err(_) => {}
            }
        }

        Ok(TestResults {
            operations: cache_test_ops,
            successful,
            latencies,
        })
    }

    /// Test stress performance with high load
    async fn test_stress_performance(&self) -> anyhow::Result<TestResults> {
        println!("💪 Testing stress performance...");
        
        let stress_ops = self.test_config.message_volume / 2;
        let duplicate_threshold = (stress_ops as f64 * self.test_config.duplicate_ratio) as u32;
        let mut join_set = JoinSet::new();
        let mut latencies = Vec::new();

        for i in 0..stress_ops {
            let system_clone = Arc::clone(&self.system);
            let task_id = if i < duplicate_threshold {
                "stress_duplicate".to_string()
            } else {
                format!("stress_unique_{}", i)
            };

            join_set.spawn(async move {
                let event = create_test_event(
                    &task_id,
                    EventType::AlertNotification,
                    "Stress Test",
                    &format!("Stress performance test {}", i),
                    "stress_tester",
                );

                let start = Instant::now();
                let result = system_clone.check_duplicate(&event, 12345).await;
                let latency = start.elapsed();

                (result, latency)
            });
        }

        let mut successful = 0;

        while let Some(result) = join_set.join_next().await {
            match result {
                Ok((Ok(_), latency)) => {
                    successful += 1;
                    latencies.push(latency);
                }
                _ => {}
            }
        }

        Ok(TestResults {
            operations: stress_ops,
            successful,
            latencies,
        })
    }

    fn create_test_event(&self, task_id: &str, event_type: EventType, title: &str, description: &str) -> Event {
        Event {
            event_id: Uuid::new_v4().to_string(),
            event_type,
            source: "performance_validator".to_string(),
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

    fn calculate_latency_stats(&self, latencies: &[Duration]) -> LatencyStats {
        if latencies.is_empty() {
            return LatencyStats {
                min_latency_micros: 0,
                max_latency_micros: 0,
                avg_latency_micros: 0,
                p95_latency_micros: 0,
                p99_latency_micros: 0,
            };
        }

        let total_micros: u64 = latencies.iter().map(|d| d.as_micros() as u64).sum();
        let avg_micros = total_micros / latencies.len() as u64;

        let p95_index = ((latencies.len() as f64) * 0.95) as usize;
        let p99_index = ((latencies.len() as f64) * 0.99) as usize;

        LatencyStats {
            min_latency_micros: latencies[0].as_micros() as u64,
            max_latency_micros: latencies[latencies.len() - 1].as_micros() as u64,
            avg_latency_micros: avg_micros,
            p95_latency_micros: latencies[p95_index.min(latencies.len() - 1)].as_micros() as u64,
            p99_latency_micros: latencies[p99_index.min(latencies.len() - 1)].as_micros() as u64,
        }
    }

    async fn get_deduplication_metrics(&self) -> DeduplicationMetrics {
        let stats = self.system.get_stats().await;
        
        let cache_hit_rate = if stats.cache_hits + stats.cache_misses > 0 {
            (stats.cache_hits as f64) / (stats.cache_hits + stats.cache_misses) as f64
        } else {
            0.0
        };

        DeduplicationMetrics {
            unique_messages: stats.unique_messages as u32,
            duplicate_messages: stats.duplicates_detected as u32,
            similar_messages: stats.similar_messages_detected as u32,
            cache_hits: stats.cache_hits as u32,
            cache_misses: stats.cache_misses as u32,
            cache_hit_rate,
            cache_size: stats.cache_size,
        }
    }

    async fn get_resource_metrics(&self) -> ResourceMetrics {
        // Simplified resource metrics - in production would use sysinfo
        ResourceMetrics {
            memory_usage_mb: 0.0, // Would calculate actual memory usage
            database_size_kb: 0,   // Would calculate database file size
            cache_memory_usage_kb: 0, // Would calculate cache memory usage
        }
    }

    fn print_performance_report(&self, report: &PerformanceReport) {
        println!("\n🎯 PERFORMANCE VALIDATION REPORT");
        println!("=====================================");
        println!("Test completed: {}", report.timestamp.format("%Y-%m-%d %H:%M:%S UTC"));
        println!("Duration: {:.2}s", report.test_duration.as_secs_f64());
        println!();

        println!("📈 DELIVERY METRICS:");
        println!("  Total operations: {}", report.total_operations);
        println!("  Successful: {}", report.successful_operations);
        println!("  Failed: {}", report.failed_operations);
        println!("  Delivery rate: {:.3}% {}", 
                 report.delivery_rate,
                 if report.targets_met.delivery_rate_target_met { "✅" } else { "❌" });
        println!("  Throughput: {:.1} ops/sec {}", 
                 report.throughput_ops_per_sec,
                 if report.targets_met.throughput_target_met { "✅" } else { "❌" });
        println!();

        println!("⏱️ LATENCY METRICS:");
        println!("  Min: {}μs", report.latency_stats.min_latency_micros);
        println!("  Max: {}μs", report.latency_stats.max_latency_micros);
        println!("  Avg: {}μs {}", 
                 report.latency_stats.avg_latency_micros,
                 if report.targets_met.latency_target_met { "✅" } else { "❌" });
        println!("  P95: {}μs", report.latency_stats.p95_latency_micros);
        println!("  P99: {}μs", report.latency_stats.p99_latency_micros);
        println!();

        println!("🔄 DEDUPLICATION METRICS:");
        println!("  Unique messages: {}", report.dedup_stats.unique_messages);
        println!("  Duplicate messages: {}", report.dedup_stats.duplicate_messages);
        println!("  Similar messages: {}", report.dedup_stats.similar_messages);
        println!("  Cache hits: {}", report.dedup_stats.cache_hits);
        println!("  Cache misses: {}", report.dedup_stats.cache_misses);
        println!("  Cache hit rate: {:.1}% {}", 
                 report.dedup_stats.cache_hit_rate * 100.0,
                 if report.targets_met.cache_efficiency_target_met { "✅" } else { "❌" });
        println!("  Cache size: {}", report.dedup_stats.cache_size);
        println!();

        let all_targets_met = report.targets_met.delivery_rate_target_met &&
                              report.targets_met.throughput_target_met &&
                              report.targets_met.latency_target_met &&
                              report.targets_met.cache_efficiency_target_met;

        println!("🎯 TARGET VALIDATION:");
        println!("  Delivery rate ≥99.5%: {}", if report.targets_met.delivery_rate_target_met { "✅" } else { "❌" });
        println!("  Throughput ≥100 ops/sec: {}", if report.targets_met.throughput_target_met { "✅" } else { "❌" });
        println!("  Avg latency ≤20ms: {}", if report.targets_met.latency_target_met { "✅" } else { "❌" });
        println!("  Cache hit rate ≥70%: {}", if report.targets_met.cache_efficiency_target_met { "✅" } else { "❌" });
        println!();

        if all_targets_met {
            println!("🏆 ALL PERFORMANCE TARGETS MET - SYSTEM READY FOR PRODUCTION");
        } else {
            println!("⚠️ PERFORMANCE TARGETS NOT MET - OPTIMIZATION REQUIRED");
        }
        println!("=====================================");
    }
}

#[derive(Debug)]
struct TestResults {
    operations: u32,
    successful: u32,
    latencies: Vec<Duration>,
}

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
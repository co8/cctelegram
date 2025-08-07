use std::sync::Arc;
use cc_telegram_bridge::storage::message_deduplication::{MessageDeduplicationSystem, DeduplicationConfig};
use cc_telegram_bridge::utils::{PerformanceValidator, TestConfiguration};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();
    
    println!("🚀 Message Deduplication Performance Validation Demo");
    println!("===================================================");
    
    // Create optimized configuration for performance testing
    let config = DeduplicationConfig {
        database_path: ":memory:".to_string(), // Use in-memory DB for performance
        deduplication_window_seconds: 3600,    // 1 hour window
        cleanup_interval_hours: 6,
        max_connections: 10,                    // Higher connection pool
        enable_content_normalization: true,
        enable_similar_detection: false,       // Disabled for max performance
        similarity_threshold: 0.85,
        cache_size_limit: 10000,               // Large cache
    };
    
    println!("📋 Test Configuration:");
    println!("  Database: {}", if config.database_path == ":memory:" { "In-Memory" } else { "File-based" });
    println!("  Cache size: {}", config.cache_size_limit);
    println!("  Max connections: {}", config.max_connections);
    println!("  Content normalization: {}", config.enable_content_normalization);
    println!("  Similar detection: {}", config.enable_similar_detection);
    println!();

    // Initialize the deduplication system
    let system = Arc::new(MessageDeduplicationSystem::new(config).await?);
    println!("✅ Deduplication system initialized");

    // Configure performance tests
    let test_config = TestConfiguration {
        message_volume: 2000,          // Test with 2000 messages
        concurrent_users: 25,          // 25 concurrent operations
        duplicate_ratio: 0.25,         // 25% duplicates
        test_duration_secs: 60,        // 1 minute test
        target_delivery_rate: 99.5,    // 99.5% delivery rate target
        target_throughput: 100.0,      // 100 ops/sec minimum
        target_avg_latency_ms: 20,     // 20ms average latency
        target_cache_hit_rate: 0.7,    // 70% cache hit rate
    };
    
    println!("🎯 Performance Targets:");
    println!("  Delivery rate: ≥{:.1}%", test_config.target_delivery_rate);
    println!("  Throughput: ≥{:.0} ops/sec", test_config.target_throughput);
    println!("  Average latency: ≤{}ms", test_config.target_avg_latency_ms);
    println!("  Cache hit rate: ≥{:.0}%", test_config.target_cache_hit_rate * 100.0);
    println!();

    // Create performance validator
    let validator = PerformanceValidator::with_config(system, test_config);

    // Run comprehensive performance validation
    println!("🔥 Starting performance validation...");
    let report = validator.validate_performance().await?;

    // Analyze results
    println!("\n📊 FINAL ANALYSIS:");
    
    if report.targets_met.delivery_rate_target_met {
        println!("✅ DELIVERY RATE: {:.3}% meets 99.5% target", report.delivery_rate);
    } else {
        println!("❌ DELIVERY RATE: {:.3}% BELOW 99.5% target", report.delivery_rate);
    }
    
    if report.targets_met.throughput_target_met {
        println!("✅ THROUGHPUT: {:.1} ops/sec meets target", report.throughput_ops_per_sec);
    } else {
        println!("❌ THROUGHPUT: {:.1} ops/sec below target", report.throughput_ops_per_sec);
    }
    
    if report.targets_met.latency_target_met {
        println!("✅ LATENCY: {}μs average meets target", report.latency_stats.avg_latency_micros);
    } else {
        println!("❌ LATENCY: {}μs average exceeds target", report.latency_stats.avg_latency_micros);
    }
    
    if report.targets_met.cache_efficiency_target_met {
        println!("✅ CACHE EFFICIENCY: {:.1}% hit rate meets target", report.dedup_stats.cache_hit_rate * 100.0);
    } else {
        println!("❌ CACHE EFFICIENCY: {:.1}% hit rate below target", report.dedup_stats.cache_hit_rate * 100.0);
    }

    let overall_pass = report.targets_met.delivery_rate_target_met &&
                      report.targets_met.throughput_target_met &&
                      report.targets_met.latency_target_met &&
                      report.targets_met.cache_efficiency_target_met;

    println!();
    if overall_pass {
        println!("🏆 PERFORMANCE VALIDATION: PASSED");
        println!("   System meets all performance requirements for production deployment");
        println!("   99.5% delivery rate target achieved with deduplication enabled");
    } else {
        println!("⚠️ PERFORMANCE VALIDATION: FAILED");
        println!("   System requires optimization before production deployment");
    }

    // Additional insights
    println!("\n🔍 DETAILED INSIGHTS:");
    println!("  Message breakdown:");
    println!("    - Unique messages: {}", report.dedup_stats.unique_messages);
    println!("    - Duplicates detected: {}", report.dedup_stats.duplicate_messages);
    println!("    - Similar messages: {}", report.dedup_stats.similar_messages);
    
    println!("  Performance distribution:");
    println!("    - P95 latency: {}μs", report.latency_stats.p95_latency_micros);
    println!("    - P99 latency: {}μs", report.latency_stats.p99_latency_micros);
    println!("    - Max latency: {}μs", report.latency_stats.max_latency_micros);
    
    let deduplication_effectiveness = if report.dedup_stats.unique_messages + report.dedup_stats.duplicate_messages > 0 {
        (report.dedup_stats.duplicate_messages as f64) / 
        ((report.dedup_stats.unique_messages + report.dedup_stats.duplicate_messages) as f64) * 100.0
    } else {
        0.0
    };
    
    println!("  Deduplication effectiveness: {:.1}%", deduplication_effectiveness);
    
    // Resource efficiency
    println!("  Resource efficiency:");
    println!("    - Cache size: {} entries", report.dedup_stats.cache_size);
    println!("    - Cache utilization: {:.1}%", 
             if report.dedup_stats.cache_hits + report.dedup_stats.cache_misses > 0 {
                 (report.dedup_stats.cache_hits as f64) / 
                 (report.dedup_stats.cache_hits + report.dedup_stats.cache_misses) as f64 * 100.0
             } else { 0.0 });

    println!("\n📄 Test completed successfully!");
    Ok(())
}
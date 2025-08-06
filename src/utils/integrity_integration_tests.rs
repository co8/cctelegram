#[cfg(test)]
mod integration_tests {
    use crate::utils::integrity::{
        DefaultIntegrityValidator, ValidationCheckpoint, ValidationMetadata, 
        ValidationResult, IntegrityError, get_global_validator, IntegrityValidator
    };
    use crate::storage::compression_integrity::IntegrityAwareCompressionService;
    use crate::storage::queue_integrity::IntegrityAwareEventQueue;
    use crate::storage::queue::EnhancedEventQueue;
    use crate::events::types::{Event, EventType, EventData, ProcessingStatus};
    use std::sync::Arc;
    use tokio::test;

    /// Test end-to-end integrity validation across all system boundaries
    #[test]
    async fn test_end_to_end_integrity_validation() {
        // Initialize logging for test visibility
        let _ = tracing_subscriber::fmt::try_init();

        println!("🔒 Starting end-to-end integrity validation test");

        // Reset global validator metrics for clean test (do this first)
        let validator = get_global_validator();
        validator.reset_metrics();
        
        // Also reset any compression service metrics by creating a new one
        let compression_service = IntegrityAwareCompressionService::new_optimized();
        compression_service.reset_metrics();

        // Create test event with substantial content
        let original_event = create_test_event("e2e-test-001", "End-to-end integrity test");

        // Step 1: Validate at ingress checkpoint
        println!("📥 Step 1: Ingress validation");
        let validator = get_global_validator();
        let original_data = serde_json::to_vec(&original_event).unwrap();
        let ingress_metadata = validator
            .validate(&original_data, ValidationCheckpoint::Ingress)
            .unwrap();
        
        println!("✅ Ingress validation successful: hash={}, size={}", 
                &ingress_metadata.content_hash[..8], ingress_metadata.content_size);

        // Step 2: Buffer processing validation
        println!("📦 Step 2: Buffer validation");
        let buffer_metadata = validator
            .chain_validate(
                &original_data,
                &original_data, // No transformation in buffer
                ValidationCheckpoint::Ingress,
                ValidationCheckpoint::Buffer,
                &ingress_metadata,
            )
            .unwrap();
        
        println!("✅ Buffer validation successful: hash={}, chain_depth={}", 
                &buffer_metadata.content_hash[..8], buffer_metadata.chain_depth);

        // Step 3: Compression validation
        println!("🗜️ Step 3: Compression validation");
        let (compressed_event, compression_metadata) = compression_service
            .compress_event_with_integrity(&original_event)
            .await
            .unwrap();
        
        println!("✅ Compression validation successful: original={}B, compressed={}B, ratio={:.2}%", 
                compression_metadata.previous_hash.as_ref().map(|_| original_data.len()).unwrap_or(0),
                compressed_event.compressed_size,
                (1.0 - compressed_event.compression_ratio) * 100.0);

        // Step 4: Queue storage validation  
        println!("📋 Step 4: Queue validation");
        let enhanced_queue = EnhancedEventQueue::new(100, None);
        let mut integrity_queue = IntegrityAwareEventQueue::new_optimized(enhanced_queue);
        let queue_metadata = integrity_queue
            .enqueue_with_integrity_validation(original_event.clone())
            .await
            .unwrap();
        
        println!("✅ Queue validation successful: hash={}, checkpoint={:?}", 
                &queue_metadata.content_hash[..8], queue_metadata.checkpoint);

        // Step 5: Decompression validation
        println!("📤 Step 5: Decompression validation");
        let (decompressed_event, decompression_metadata) = compression_service
            .decompress_event_with_integrity(&compressed_event, &compression_metadata)
            .await
            .unwrap();
        
        println!("✅ Decompression validation successful: size={}B, chain_depth={}", 
                decompression_metadata.content_size, decompression_metadata.chain_depth);

        // Step 6: Egress validation
        println!("📤 Step 6: Egress validation");
        let decompressed_data = serde_json::to_vec(&decompressed_event).unwrap();
        let egress_metadata = validator
            .chain_validate(
                &decompressed_data,
                &decompressed_data, // No transformation at egress
                ValidationCheckpoint::FileSystem,
                ValidationCheckpoint::Egress,
                &decompression_metadata,
            )
            .unwrap();
        
        println!("✅ Egress validation successful: hash={}, final_chain_depth={}", 
                &egress_metadata.content_hash[..8], egress_metadata.chain_depth);

        // Step 7: Verify data integrity across entire pipeline
        println!("🔍 Step 7: End-to-end data integrity verification");
        assert_eq!(original_event.event_id, decompressed_event.event_id);
        assert_eq!(original_event.title, decompressed_event.title);
        assert_eq!(original_event.description, decompressed_event.description);
        assert_eq!(original_event.task_id, decompressed_event.task_id);
        
        // Verify chain depth progression
        assert_eq!(ingress_metadata.chain_depth, 0);
        assert_eq!(buffer_metadata.chain_depth, 1);
        assert_eq!(compression_metadata.chain_depth, 1); // From buffer processing
        assert_eq!(decompression_metadata.chain_depth, 2);
        assert_eq!(egress_metadata.chain_depth, 3);
        
        println!("✅ End-to-end data integrity verified successfully");

        // Step 8: Validate comprehensive metrics
        println!("📊 Step 8: Metrics validation");
        let integrity_report = integrity_queue.validate_queue_storage_integrity().await.unwrap();
        let compression_metrics = compression_service.get_comprehensive_metrics();
        let validator_metrics = validator.get_metrics();

        println!("📊 Final metrics:");
        println!("   - Queue health score: {:.3}", integrity_report.overall_health_score);
        println!("   - Compression health score: {:.3}", compression_metrics.health_score());
        println!("   - Integrity validations: {}", validator_metrics.total_validations);
        println!("   - Integrity success rate: {:.3}", validator_metrics.successful_validations as f64 / validator_metrics.total_validations as f64);
        
        // Assert health thresholds
        assert!(integrity_report.overall_health_score > 0.95, "Queue health score too low");
        assert!(compression_metrics.health_score() > 0.95, "Compression health score too low");
        assert!(validator_metrics.corruption_errors == 0, "Corruption errors detected");
        assert!(validator_metrics.truncation_errors == 0, "Truncation errors detected");

        println!("🎉 End-to-end integrity validation test completed successfully!");
    }

    /// Test integrity validation failure scenarios
    #[test]
    async fn test_integrity_validation_failure_scenarios() {
        println!("🚨 Testing integrity validation failure scenarios");

        // Reset global validator metrics for clean test
        let validator = get_global_validator();
        validator.reset_metrics();
        let original_event = create_test_event("failure-test-001", "Failure scenario test");
        let original_data = serde_json::to_vec(&original_event).unwrap();

        // Test 1: Content corruption detection
        println!("🔍 Test 1: Content corruption detection");
        let metadata = validator
            .validate(&original_data, ValidationCheckpoint::Buffer)
            .unwrap();
        
        let mut corrupted_data = original_data.clone();
        corrupted_data[10] = corrupted_data[10].wrapping_add(1); // Corrupt one byte
        
        let corruption_result = validator.verify(&corrupted_data, &metadata);
        assert!(corruption_result.is_failed(), "Should detect corruption");
        
        if let ValidationResult::Failed(IntegrityError::Corruption { checkpoint, .. }) = corruption_result {
            assert_eq!(checkpoint, ValidationCheckpoint::Buffer);
            println!("✅ Corruption detection successful at checkpoint: {:?}", checkpoint);
        } else {
            panic!("Expected corruption error");
        }

        // Test 2: Content truncation detection
        println!("🔍 Test 2: Content truncation detection");
        let truncated_data = &original_data[..original_data.len() - 10]; // Remove 10 bytes
        
        let truncation_result = validator.verify(truncated_data, &metadata);
        assert!(truncation_result.is_failed(), "Should detect truncation");
        
        if let ValidationResult::Failed(IntegrityError::Truncation { expected_size, actual_size, checkpoint }) = truncation_result {
            assert_eq!(expected_size, original_data.len());
            assert_eq!(actual_size, truncated_data.len());
            assert_eq!(checkpoint, ValidationCheckpoint::Buffer);
            println!("✅ Truncation detection successful: expected={}B, actual={}B", expected_size, actual_size);
        } else {
            panic!("Expected truncation error");
        }

        // Test 3: Chain validation failure
        println!("🔍 Test 3: Chain validation failure");
        let different_data = serde_json::to_vec(&create_test_event("different", "Different event")).unwrap();
        
        let chain_result = validator.chain_validate(
            &different_data, // Wrong original data
            &original_data,
            ValidationCheckpoint::Buffer,
            ValidationCheckpoint::Compression,
            &metadata,
        );
        
        assert!(chain_result.is_err(), "Chain validation should fail with wrong original data");
        println!("✅ Chain validation failure detected successfully");

        println!("🎉 Integrity validation failure scenarios test completed!");
    }

    /// Test performance characteristics of integrity validation
    #[test]
    async fn test_integrity_validation_performance() {
        println!("⚡ Testing integrity validation performance");

        // Reset global validator metrics for clean test
        let validator = get_global_validator();
        validator.reset_metrics();
        
        // Test with various message sizes
        let test_sizes = vec![1024, 10240, 102400, 1024000]; // 1KB, 10KB, 100KB, 1MB
        
        for size in test_sizes {
            println!("📏 Testing with {}B message", size);
            
            let test_data = generate_test_data(size);
            let iterations = 100;
            
            let start_time = std::time::Instant::now();
            
            for i in 0..iterations {
                let metadata = validator
                    .validate(&test_data, ValidationCheckpoint::Buffer)
                    .unwrap();
                
                let result = validator.verify(&test_data, &metadata);
                assert!(result.is_valid(), "Validation should succeed for iteration {}", i);
            }
            
            let total_time = start_time.elapsed();
            let avg_time_per_validation = total_time / (iterations * 2); // 2 operations per iteration
            
            println!("   Average validation time: {:.2}ms", avg_time_per_validation.as_millis());
            
            // Performance assertions
            assert!(avg_time_per_validation.as_millis() < 50, 
                   "Validation too slow for {}B: {}ms", size, avg_time_per_validation.as_millis());
        }

        // Test chain validation performance
        println!("🔗 Testing chain validation performance");
        let test_data = generate_test_data(10240);
        let iterations = 50;
        
        let start_time = std::time::Instant::now();
        let mut current_metadata = validator
            .validate(&test_data, ValidationCheckpoint::Ingress)
            .unwrap();
        
        let checkpoints = [
            ValidationCheckpoint::Buffer,
            ValidationCheckpoint::Compression,
            ValidationCheckpoint::Queue,
            ValidationCheckpoint::FileSystem,
            ValidationCheckpoint::Egress,
        ];
        
        for i in 0..iterations {
            for (j, &checkpoint) in checkpoints.iter().enumerate() {
                current_metadata = validator
                    .chain_validate(
                        &test_data,
                        &test_data,
                        if j == 0 { ValidationCheckpoint::Ingress } else { checkpoints[j-1] },
                        checkpoint,
                        &current_metadata,
                    )
                    .unwrap();
            }
        }
        
        let chain_time = start_time.elapsed();
        let avg_chain_time = chain_time / iterations;
        
        println!("   Average chain validation time: {:.2}ms", avg_chain_time.as_millis());
        assert!(avg_chain_time.as_millis() < 100, "Chain validation too slow: {}ms", avg_chain_time.as_millis());

        println!("🎉 Performance test completed successfully!");
    }

    /// Test concurrent integrity validation
    #[test]
    async fn test_concurrent_integrity_validation() {
        println!("🔄 Testing concurrent integrity validation");

        // Reset global validator metrics for clean test
        let validator = get_global_validator();
        validator.reset_metrics();
        let test_data = generate_test_data(10240);
        let num_concurrent = 50;
        
        let mut handles = Vec::new();
        
        let start_time = std::time::Instant::now();
        
        for i in 0..num_concurrent {
            let validator = get_global_validator();
            let data = test_data.clone();
            
            let handle = tokio::spawn(async move {
                let metadata = validator
                    .validate(&data, ValidationCheckpoint::Buffer)
                    .unwrap();
                
                let result = validator.verify(&data, &metadata);
                assert!(result.is_valid(), "Concurrent validation {} should succeed", i);
                
                i
            });
            
            handles.push(handle);
        }
        
        // Wait for all concurrent validations to complete
        for handle in handles {
            handle.await.unwrap();
        }
        
        let concurrent_time = start_time.elapsed();
        println!("   Concurrent validation time: {:.2}ms", concurrent_time.as_millis());
        
        // Verify metrics
        let final_metrics = validator.get_metrics();
        assert!(final_metrics.total_validations >= num_concurrent * 2, 
               "Should have at least {} validations", num_concurrent * 2);
        
        println!("🎉 Concurrent validation test completed successfully!");
    }

    // Helper functions

    fn create_test_event(id: &str, title: &str) -> Event {
        Event {
            event_id: id.to_string(),
            event_type: EventType::TaskCompletion,
            source: "integrity_test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: format!("task-{}", id),
            title: title.to_string(),
            description: format!("Comprehensive test event for integrity validation: {}", title).repeat(10),
            data: EventData::default(),
            correlation_id: Some(format!("corr-{}", id)),
            parent_event_id: None,
            retry_count: 0,
            processing_status: ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: chrono::Utc::now(),
            processed_at: None,
        }
    }

    fn generate_test_data(size: usize) -> Vec<u8> {
        let pattern = b"INTEGRITY_TEST_DATA_PATTERN_";
        let mut data = Vec::with_capacity(size);
        
        for i in 0..size {
            data.push(pattern[i % pattern.len()]);
        }
        
        data
    }
}
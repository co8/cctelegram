use anyhow::{Result, Context};
use tracing::{debug, warn, error, info, instrument};
use sha2::{Sha256, Digest};
use std::sync::Arc;
use super::compression::{CompressionService, CompressedEvent};
use crate::utils::integrity::{
    IntegrityValidator, DefaultIntegrityValidator, InstrumentedIntegrityValidator,
    ValidationCheckpoint, ValidationMetadata, ValidationResult, IntegrityError
};
use crate::events::types::Event;

/// Enhanced compression service with integrity validation at compression boundaries
pub struct IntegrityAwareCompressionService {
    /// Inner compression service
    compression_service: CompressionService,
    /// Integrity validator for checksum validation
    integrity_validator: InstrumentedIntegrityValidator,
}

impl IntegrityAwareCompressionService {
    /// Create new integrity-aware compression service
    pub fn new(compression_service: CompressionService) -> Self {
        let validator = DefaultIntegrityValidator::new_default();
        let instrumented_validator = InstrumentedIntegrityValidator::new(Box::new(validator));
        
        Self {
            compression_service,
            integrity_validator: instrumented_validator,
        }
    }

    /// Create with optimized settings for queue processing
    pub fn new_optimized() -> Self {
        let compression_service = CompressionService::new_optimized();
        Self::new(compression_service)
    }
    
    /// Get a reference to the underlying compression service  
    pub fn get_compression_service(&self) -> Arc<CompressionService> {
        // Create a new optimized compression service since CompressionService doesn't implement Clone
        Arc::new(CompressionService::new_optimized())
    }

    /// Compress event with end-to-end integrity validation
    #[instrument(skip(self, event), fields(event_id = %event.event_id, event_type = ?event.event_type))]
    pub async fn compress_event_with_integrity(&self, event: &Event) -> Result<(CompressedEvent, ValidationMetadata)> {
        info!("Starting compression with integrity validation for event {}", event.event_id);
        
        // Step 1: Validate original event content
        let original_data = serde_json::to_vec(event)
            .context("Failed to serialize event for integrity validation")?;
            
        let original_validation = self.integrity_validator
            .validate(&original_data, ValidationCheckpoint::Compression)
            .context("Failed to validate original event content")?;
            
        debug!("Original event validation: hash={}, size={}", 
               &original_validation.content_hash[..8], original_validation.content_size);

        // Step 2: Perform compression using existing service
        let mut compressed_event = self.compression_service
            .compress_event(event)
            .await
            .context("Compression operation failed")?;

        // Step 3: Validate compressed content integrity
        let mut compressed_validation = self.integrity_validator
            .chain_validate(
                &original_data,
                &compressed_event.compressed_data,
                ValidationCheckpoint::Compression,
                ValidationCheckpoint::Queue,
                &original_validation,
            )
            .context("Failed to validate compressed content")?;

        // Store original data hash for later decompression validation
        compressed_validation.previous_hash = Some(original_validation.content_hash.clone());

        // Step 4: Enhance compressed event with validation metadata
        // Set integrity_hash to original content hash for base compression service validation
        compressed_event.integrity_hash = Some(original_validation.content_hash.clone());

        info!("Compression with integrity validation complete for event {}: original={}B, compressed={}B, ratio={:.2}%",
              event.event_id, 
              original_validation.content_size,
              compressed_event.compressed_size,
              (1.0 - compressed_event.compression_ratio) * 100.0);

        Ok((compressed_event, compressed_validation))
    }

    /// Decompress event with integrity validation
    #[instrument(skip(self, compressed_event, validation_metadata), fields(event_id = %compressed_event.event_id))]
    pub async fn decompress_event_with_integrity(
        &self, 
        compressed_event: &CompressedEvent,
        validation_metadata: &ValidationMetadata
    ) -> Result<(Event, ValidationMetadata)> {
        info!("Starting decompression with integrity validation for event {}", compressed_event.event_id);

        // Step 1: Validate compressed content against metadata
        let verification_result = self.integrity_validator
            .verify(&compressed_event.compressed_data, validation_metadata);
            
        if let ValidationResult::Failed(error) = verification_result {
            error!("Compressed content integrity validation failed for event {}: {:?}", 
                   compressed_event.event_id, error);
            return Err(anyhow::anyhow!("Compressed content integrity validation failed: {:?}", error));
        }

        debug!("Compressed content integrity validated for event {}", compressed_event.event_id);

        // Step 2: Perform decompression using existing service
        let decompressed_event = self.compression_service
            .decompress_event(compressed_event)
            .await
            .context("Decompression operation failed")?;

        // Step 3: Validate decompressed content
        let decompressed_data = serde_json::to_vec(&decompressed_event)
            .context("Failed to serialize decompressed event for validation")?;

        let decompressed_validation = self.integrity_validator
            .chain_validate(
                &compressed_event.compressed_data,
                &decompressed_data,
                ValidationCheckpoint::Queue,
                ValidationCheckpoint::FileSystem,
                validation_metadata,
            )
            .context("Failed to validate decompressed content")?;

        // Step 4: Verify decompressed content matches original if we have the original hash
        if let Some(expected_original_hash) = &validation_metadata.previous_hash {
            let mut hasher = sha2::Sha256::new();
            hasher.update(&decompressed_data);
            let actual_hash = format!("{:x}", hasher.finalize());
            
            if actual_hash != *expected_original_hash {
                error!("Decompressed content does not match original hash for event {}", compressed_event.event_id);
                return Err(anyhow::anyhow!("Decompressed content integrity validation failed"));
            }
        }

        info!("Decompression with integrity validation complete for event {}: size={}B", 
              compressed_event.event_id, decompressed_data.len());

        Ok((decompressed_event, decompressed_validation))
    }

    /// Batch compression with integrity validation for multiple events
    #[instrument(skip(self, events))]
    pub async fn batch_compress_with_integrity(&self, events: &[Event]) -> Result<Vec<(CompressedEvent, ValidationMetadata)>> {
        info!("Starting batch compression with integrity validation for {} events", events.len());
        
        let mut results = Vec::with_capacity(events.len());
        let mut successful = 0;
        let mut failed = 0;

        for event in events {
            match self.compress_event_with_integrity(event).await {
                Ok(result) => {
                    results.push(result);
                    successful += 1;
                }
                Err(error) => {
                    error!("Failed to compress event {} with integrity: {}", event.event_id, error);
                    failed += 1;
                    // Continue with other events rather than failing the entire batch
                }
            }
        }

        info!("Batch compression completed: {} successful, {} failed", successful, failed);

        if results.is_empty() {
            return Err(anyhow::anyhow!("All events in batch compression failed"));
        }

        Ok(results)
    }

    /// Get comprehensive metrics including integrity validation statistics
    pub fn get_comprehensive_metrics(&self) -> CompressionIntegrityMetrics {
        let compression_metrics = self.compression_service.get_metrics();
        let integrity_metrics = self.integrity_validator.get_metrics();

        CompressionIntegrityMetrics {
            compression: compression_metrics,
            integrity_validation_success_rate: integrity_metrics.total_validations as f64 / 
                std::cmp::max(integrity_metrics.total_validations, 1) as f64,
            integrity_failures: integrity_metrics.failed_validations,
            corruption_errors: integrity_metrics.corruption_errors,
            truncation_errors: integrity_metrics.truncation_errors,
            average_validation_latency_ms: integrity_metrics.validation_latency_ms,
        }
    }

    /// Reset all metrics
    pub fn reset_metrics(&self) {
        self.compression_service.reset_metrics();
        self.integrity_validator.reset_metrics();
    }

    /// Validate compression boundaries for existing compressed event
    pub async fn validate_compression_boundaries(&self, compressed_event: &CompressedEvent) -> Result<ValidationResult> {
        debug!("Validating compression boundaries for event {}", compressed_event.event_id);

        // Check if we have integrity hash
        let integrity_hash = compressed_event.integrity_hash.as_ref()
            .ok_or_else(|| anyhow::anyhow!("No integrity hash found in compressed event"))?;

        // Create validation metadata from compressed event
        let validation_metadata = ValidationMetadata {
            correlation_id: compressed_event.event_id.clone(),
            content_hash: integrity_hash.clone(),
            content_size: compressed_event.compressed_size,
            checkpoint: ValidationCheckpoint::Queue,
            validated_at: compressed_event.compressed_at.timestamp() as u64,
            previous_hash: None,
            chain_depth: 0,
        };

        // Verify compressed content
        let result = self.integrity_validator.verify(&compressed_event.compressed_data, &validation_metadata);
        
        match &result {
            ValidationResult::Valid => {
                debug!("Compression boundary validation successful for event {}", compressed_event.event_id);
            }
            ValidationResult::Failed(error) => {
                warn!("Compression boundary validation failed for event {}: {:?}", 
                      compressed_event.event_id, error);
            }
        }

        Ok(result)
    }
}

/// Combined metrics for compression and integrity validation
#[derive(Debug, Clone)]
pub struct CompressionIntegrityMetrics {
    /// Standard compression metrics
    pub compression: super::compression::CompressionMetrics,
    /// Integrity validation success rate
    pub integrity_validation_success_rate: f64,
    /// Total integrity validation failures
    pub integrity_failures: u64,
    /// Number of corruption errors detected
    pub corruption_errors: u64,
    /// Number of truncation errors detected  
    pub truncation_errors: u64,
    /// Average validation latency in milliseconds
    pub average_validation_latency_ms: f64,
}

impl CompressionIntegrityMetrics {
    /// Get overall system health score (0.0 - 1.0)
    pub fn health_score(&self) -> f64 {
        let compression_health = if self.compression.compression_failures == 0 { 1.0 } else {
            let failure_rate = self.compression.compression_failures as f64 / 
                std::cmp::max(self.compression.total_compressions, 1) as f64;
            1.0 - failure_rate
        };
        
        let integrity_health = self.integrity_validation_success_rate;
        
        // Weighted average: 70% compression health, 30% integrity health
        0.7 * compression_health + 0.3 * integrity_health
    }

    /// Check if system is operating within acceptable parameters
    pub fn is_healthy(&self) -> bool {
        self.health_score() >= 0.95 && // 95% overall health
        self.integrity_validation_success_rate >= 0.99 && // 99% integrity validation success
        self.corruption_errors == 0 && // No corruption tolerated
        self.average_validation_latency_ms < 50.0 // Validation latency under 50ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{Event, EventType, EventData};
    use crate::storage::compression::CompressionConfig;
    
    #[tokio::test]
    async fn test_compress_event_with_integrity() {
        let service = IntegrityAwareCompressionService::new_optimized();
        
        // Create test event with substantial content for compression
        let event = Event {
            event_id: "integrity-test-123".to_string(),
            event_type: EventType::TaskCompletion,
            source: "test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: "task-456".to_string(),
            title: "Integrity Test Event".to_string(),
            description: "A comprehensive test event for integrity validation".repeat(50),
            data: EventData::default(),
            correlation_id: Some("corr-789".to_string()),
            parent_event_id: None,
            retry_count: 0,
            processing_status: crate::events::types::ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: chrono::Utc::now(),
            processed_at: None,
        };

        // Test compression with integrity
        let (compressed_event, validation_metadata) = service
            .compress_event_with_integrity(&event)
            .await
            .unwrap();

        assert!(compressed_event.integrity_hash.is_some());
        assert_eq!(validation_metadata.checkpoint, ValidationCheckpoint::Queue);
        assert!(validation_metadata.content_size > 0);
        assert!(!validation_metadata.content_hash.is_empty());

        // Test decompression with integrity  
        let (decompressed_event, _) = service
            .decompress_event_with_integrity(&compressed_event, &validation_metadata)
            .await
            .unwrap();

        assert_eq!(decompressed_event.event_id, event.event_id);
        assert_eq!(decompressed_event.title, event.title);
        assert_eq!(decompressed_event.description, event.description);
    }

    #[tokio::test]
    async fn test_compression_boundary_validation() {
        let service = IntegrityAwareCompressionService::new_optimized();
        
        let event = Event::default_with_task_id("boundary-test".to_string());
        let (compressed_event, _) = service
            .compress_event_with_integrity(&event)
            .await
            .unwrap();

        // Test boundary validation
        let validation_result = service
            .validate_compression_boundaries(&compressed_event)
            .await
            .unwrap();

        assert!(validation_result.is_valid());
    }

    #[tokio::test]  
    async fn test_batch_compression_with_integrity() {
        let service = IntegrityAwareCompressionService::new_optimized();
        
        let events = vec![
            Event::default_with_task_id("batch-1".to_string()),
            Event::default_with_task_id("batch-2".to_string()),
            Event::default_with_task_id("batch-3".to_string()),
        ];

        let results = service
            .batch_compress_with_integrity(&events)
            .await
            .unwrap();

        assert_eq!(results.len(), 3);
        
        for (compressed_event, validation_metadata) in &results {
            assert!(compressed_event.integrity_hash.is_some());
            assert_eq!(validation_metadata.checkpoint, ValidationCheckpoint::Queue);
        }
    }

    #[tokio::test]
    async fn test_comprehensive_metrics() {
        let service = IntegrityAwareCompressionService::new_optimized();
        // Create a larger event to ensure it gets compressed rather than just wrapped
        let event = Event {
            description: "A comprehensive test event for integrity validation metrics testing ".repeat(50),
            ..Event::default_with_task_id("metrics-test".to_string())
        };

        // Reset metrics for clean test
        service.reset_metrics();

        // Perform some operations
        let _ = service.compress_event_with_integrity(&event).await.unwrap();
        
        let metrics = service.get_comprehensive_metrics();
        assert!(metrics.compression.total_compressions >= 1, "Expected at least 1 compression, got {}", metrics.compression.total_compressions);
        assert!(metrics.integrity_validation_success_rate >= 0.0);
        assert!(metrics.health_score() >= 0.0 && metrics.health_score() <= 1.0);
    }
}
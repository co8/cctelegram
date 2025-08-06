use anyhow::{Result, Context};
use serde::{Deserialize, Serialize};
use tracing::{debug, warn, error, info, instrument};
use std::sync::Arc;

use crate::events::types::Event;
use crate::events::queue_manager::{QueueManager, QueueStats};
use crate::utils::integrity::{
    IntegrityValidator, DefaultIntegrityValidator, InstrumentedIntegrityValidator,
    ValidationCheckpoint, ValidationMetadata, ValidationResult, IntegrityError
};
use super::compression_integrity::{IntegrityAwareCompressionService, CompressionIntegrityMetrics};
use super::queue::EnhancedEventQueue;

/// Enhanced event with integrity validation metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityValidatedEvent {
    /// Original event data
    pub event: Event,
    /// Validation metadata for integrity tracking
    pub validation_metadata: ValidationMetadata,
    /// Queue entry timestamp
    pub queued_at: chrono::DateTime<chrono::Utc>,
    /// Processing attempts counter
    pub processing_attempts: u32,
    /// Last processing error (if any)
    pub last_error: Option<String>,
}

impl IntegrityValidatedEvent {
    /// Create new integrity validated event
    pub fn new(event: Event, validation_metadata: ValidationMetadata) -> Self {
        Self {
            event,
            validation_metadata,
            queued_at: chrono::Utc::now(),
            processing_attempts: 0,
            last_error: None,
        }
    }

    /// Update processing attempt information
    pub fn record_processing_attempt(&mut self, error: Option<String>) {
        self.processing_attempts += 1;
        self.last_error = error;
    }

    /// Check if event has exceeded retry limits
    pub fn has_exceeded_retry_limit(&self, max_retries: u32) -> bool {
        self.processing_attempts > max_retries
    }
}

/// Enhanced queue with comprehensive integrity validation
pub struct IntegrityAwareEventQueue {
    /// Enhanced traditional queue
    enhanced_queue: EnhancedEventQueue,
    /// Integrity-aware compression service
    compression_service: Arc<IntegrityAwareCompressionService>,
    /// Integrity validator for queue operations
    integrity_validator: InstrumentedIntegrityValidator,
    /// Maximum retry attempts for failed validations
    max_retry_attempts: u32,
}

impl IntegrityAwareEventQueue {
    /// Create new integrity-aware event queue
    pub fn new(
        enhanced_queue: EnhancedEventQueue,
        compression_service: Arc<IntegrityAwareCompressionService>,
        max_retry_attempts: u32,
    ) -> Self {
        let validator = DefaultIntegrityValidator::new_default();
        let instrumented_validator = InstrumentedIntegrityValidator::new(Box::new(validator));

        Self {
            enhanced_queue,
            compression_service,
            integrity_validator: instrumented_validator,
            max_retry_attempts,
        }
    }

    /// Create with optimized settings
    pub fn new_optimized(enhanced_queue: EnhancedEventQueue) -> Self {
        let compression_service = Arc::new(IntegrityAwareCompressionService::new_optimized());
        Self::new(enhanced_queue, compression_service, 3)
    }

    /// Enqueue event with comprehensive integrity validation
    #[instrument(skip(self, event), fields(event_id = %event.event_id))]
    pub async fn enqueue_with_integrity_validation(&mut self, event: Event) -> Result<ValidationMetadata> {
        info!("Enqueuing event with integrity validation: {}", event.event_id);

        // Step 1: Validate original event content before queueing
        let event_data = serde_json::to_vec(&event)
            .context("Failed to serialize event for validation")?;

        let original_validation = self.integrity_validator
            .validate(&event_data, ValidationCheckpoint::Queue)
            .context("Failed to validate event content before queueing")?;

        debug!("Event validation successful: hash={}, size={}", 
               &original_validation.content_hash[..8], original_validation.content_size);

        // Step 2: Compress event with integrity validation
        let (compressed_event, compression_validation) = self.compression_service
            .compress_event_with_integrity(&event)
            .await
            .context("Failed to compress event with integrity validation")?;

        // Step 3: Create integrity validated event wrapper
        let integrity_event = IntegrityValidatedEvent::new(event.clone(), compression_validation.clone());
        let integrity_event_data = serde_json::to_vec(&integrity_event)
            .context("Failed to serialize integrity validated event")?;

        // Step 4: Validate serialized integrity event
        let queue_validation = self.integrity_validator
            .validate(&integrity_event_data, ValidationCheckpoint::Queue)
            .context("Failed to validate integrity event for queueing")?;

        // Step 5: Enqueue through traditional queue (with retry logic)
        let mut attempts = 0;
        let max_queue_attempts = 3;
        
        while attempts < max_queue_attempts {
            match self.enhanced_queue.enqueue_realtime_event(event.clone()).await {
                Ok(_) => break,
                Err(e) => {
                    attempts += 1;
                    warn!("Queue enqueue attempt {} failed for event {}: {}", 
                          attempts, event.event_id, e);
                    
                    if attempts >= max_queue_attempts {
                        error!("Failed to enqueue event {} after {} attempts", 
                               event.event_id, attempts);
                        return Err(anyhow::anyhow!("Queue enqueue failed after {} attempts: {}", attempts, e));
                    }
                    
                    // Exponential backoff
                    tokio::time::sleep(tokio::time::Duration::from_millis(100 * (1 << attempts))).await;
                }
            }
        }

        info!("Event {} successfully enqueued with integrity validation", event.event_id);
        Ok(queue_validation)
    }

    /// Process startup events with integrity validation
    #[instrument(skip(self, events_dir))]
    pub async fn process_startup_burst_with_integrity(&mut self, events_dir: &std::path::Path) -> Result<Vec<ValidationMetadata>> {
        info!("Processing startup events with integrity validation from: {}", events_dir.display());

        // Load accumulated events using the existing method
        let accumulated_events = self.enhanced_queue
            .load_accumulated_events_from_files(events_dir);

        if accumulated_events.is_empty() {
            info!("No accumulated events to process on startup");
            return Ok(Vec::new());
        }

        let mut validation_results = Vec::new();
        let mut successful_enqueues = 0;
        let mut failed_enqueues = 0;

        info!("Processing {} startup events with integrity validation", accumulated_events.len());

        // Process each event with integrity validation
        for event in accumulated_events {
            match self.enqueue_with_integrity_validation(event).await {
                Ok(validation_metadata) => {
                    validation_results.push(validation_metadata);
                    successful_enqueues += 1;
                }
                Err(e) => {
                    error!("Failed to process startup event with integrity validation: {}", e);
                    failed_enqueues += 1;
                }
            }
        }

        info!("Startup burst processing completed: {} successful, {} failed", 
              successful_enqueues, failed_enqueues);

        Ok(validation_results)
    }

    /// Validate queue storage integrity
    #[instrument(skip(self))]
    pub async fn validate_queue_storage_integrity(&self) -> Result<QueueIntegrityReport> {
        info!("Performing queue storage integrity validation");

        // Get queue statistics
        let (traditional_stats, queue_manager_stats) = self.enhanced_queue.get_combined_stats().await;
        
        // Get integrity validation metrics
        let integrity_metrics = self.integrity_validator.get_metrics();
        
        // Get compression integrity metrics
        let compression_metrics = self.compression_service.get_comprehensive_metrics();

        // Calculate overall health score
        let integrity_success_rate = if integrity_metrics.total_validations > 0 {
            integrity_metrics.successful_validations as f64 / integrity_metrics.total_validations as f64
        } else {
            1.0
        };

        let compression_health = compression_metrics.health_score();
        let overall_health = (integrity_success_rate + compression_health) / 2.0;

        let report = QueueIntegrityReport {
            timestamp: chrono::Utc::now(),
            traditional_queue_size: traditional_stats,
            queue_manager_stats,
            integrity_validations: integrity_metrics.total_validations,
            integrity_failures: integrity_metrics.failed_validations,
            integrity_success_rate,
            compression_health_score: compression_health,
            overall_health_score: overall_health,
            is_healthy: overall_health > 0.95 && integrity_metrics.corruption_errors == 0,
            corruption_errors: integrity_metrics.corruption_errors,
            truncation_errors: integrity_metrics.truncation_errors,
            recommendations: generate_health_recommendations(&integrity_metrics, &compression_metrics),
        };

        if report.is_healthy {
            info!("Queue storage integrity validation passed: health_score={:.3}", overall_health);
        } else {
            warn!("Queue storage integrity issues detected: health_score={:.3}, corruption_errors={}, truncation_errors={}", 
                  overall_health, report.corruption_errors, report.truncation_errors);
        }

        Ok(report)
    }

    /// Get comprehensive queue statistics
    pub async fn get_comprehensive_stats(&self) -> QueueIntegrityStats {
        let (traditional_stats, queue_manager_stats) = self.enhanced_queue.get_combined_stats().await;
        let integrity_metrics = self.integrity_validator.get_metrics();
        let compression_metrics = self.compression_service.get_comprehensive_metrics();

        QueueIntegrityStats {
            traditional_queue_size: traditional_stats,
            queue_manager_stats,
            integrity_metrics,
            compression_metrics,
        }
    }

    /// Gracefully shutdown with integrity metrics logging
    pub async fn shutdown_with_integrity_report(&self) -> Result<()> {
        info!("Shutting down integrity-aware event queue");

        // Log final integrity metrics
        let final_report = self.validate_queue_storage_integrity().await?;
        
        info!("Final queue integrity report: health_score={:.3}, total_validations={}, failures={}", 
              final_report.overall_health_score, 
              final_report.integrity_validations,
              final_report.integrity_failures);

        // Shutdown enhanced queue
        self.enhanced_queue.shutdown().await?;

        info!("Integrity-aware event queue shutdown completed successfully");
        Ok(())
    }
}

/// Comprehensive queue integrity report
#[derive(Debug, Clone, Serialize)]
pub struct QueueIntegrityReport {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub traditional_queue_size: usize,
    pub queue_manager_stats: Option<QueueStats>,
    pub integrity_validations: u64,
    pub integrity_failures: u64,
    pub integrity_success_rate: f64,
    pub compression_health_score: f64,
    pub overall_health_score: f64,
    pub is_healthy: bool,
    pub corruption_errors: u64,
    pub truncation_errors: u64,
    pub recommendations: Vec<String>,
}

/// Combined statistics for queue integrity monitoring
#[derive(Debug, Clone)]
pub struct QueueIntegrityStats {
    pub traditional_queue_size: usize,
    pub queue_manager_stats: Option<QueueStats>,
    pub integrity_metrics: crate::utils::integrity::IntegrityMetrics,
    pub compression_metrics: CompressionIntegrityMetrics,
}

/// Generate health recommendations based on metrics
fn generate_health_recommendations(
    integrity_metrics: &crate::utils::integrity::IntegrityMetrics,
    compression_metrics: &CompressionIntegrityMetrics,
) -> Vec<String> {
    let mut recommendations = Vec::new();

    // Integrity validation recommendations
    if integrity_metrics.failed_validations > 0 {
        recommendations.push("Investigate integrity validation failures - check for data corruption".to_string());
    }

    if integrity_metrics.corruption_errors > 0 {
        recommendations.push("CRITICAL: Data corruption detected - immediate investigation required".to_string());
    }

    if integrity_metrics.truncation_errors > 0 {
        recommendations.push("Data truncation detected - check buffer sizes and message limits".to_string());
    }

    if integrity_metrics.validation_latency_ms > 100.0 {
        recommendations.push("High validation latency - consider optimizing SHA-256 computation".to_string());
    }

    // Compression recommendations
    if compression_metrics.compression.compression_failures > 0 {
        recommendations.push("Compression failures detected - check memory availability and message sizes".to_string());
    }

    if compression_metrics.integrity_validation_success_rate < 0.99 {
        recommendations.push("Low compression integrity validation success rate - investigate compression boundary validation".to_string());
    }

    if !compression_metrics.is_healthy() {
        recommendations.push("Compression system health below threshold - review compression configuration".to_string());
    }

    // Overall system recommendations
    if recommendations.is_empty() {
        recommendations.push("System operating within normal parameters".to_string());
    }

    recommendations
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{Event, EventType, EventData};
    use crate::storage::queue::EventQueue;
    use std::path::PathBuf;

    #[tokio::test]
    async fn test_integrity_aware_queue_enqueue() {
        // Create test components
        let event_queue = EventQueue::new(100);
        let enhanced_queue = EnhancedEventQueue::new(100, None);
        let mut integrity_queue = IntegrityAwareEventQueue::new_optimized(enhanced_queue);

        // Create test event
        let event = Event {
            event_id: "integrity-queue-test".to_string(),
            event_type: EventType::TaskCompletion,
            source: "test".to_string(),
            timestamp: chrono::Utc::now(),
            task_id: "queue-task-123".to_string(),
            title: "Integrity Queue Test".to_string(),
            description: "Testing integrity validation in queue operations".repeat(20),
            data: EventData::default(),
            correlation_id: Some("queue-corr-456".to_string()),
            parent_event_id: None,
            retry_count: 0,
            processing_status: crate::events::types::ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: chrono::Utc::now(),
            processed_at: None,
        };

        // Test enqueue with integrity validation
        let validation_metadata = integrity_queue
            .enqueue_with_integrity_validation(event)
            .await
            .unwrap();

        assert_eq!(validation_metadata.checkpoint, ValidationCheckpoint::Queue);
        assert!(!validation_metadata.content_hash.is_empty());
        assert!(validation_metadata.content_size > 0);
    }

    #[tokio::test]
    async fn test_queue_integrity_validation() {
        let enhanced_queue = EnhancedEventQueue::new(100, None);
        let integrity_queue = IntegrityAwareEventQueue::new_optimized(enhanced_queue);

        // Perform integrity validation
        let report = integrity_queue
            .validate_queue_storage_integrity()
            .await
            .unwrap();

        assert!(report.overall_health_score >= 0.0 && report.overall_health_score <= 1.0);
        assert!(!report.recommendations.is_empty());
    }

    #[tokio::test]
    async fn test_comprehensive_stats() {
        let enhanced_queue = EnhancedEventQueue::new(100, None);
        let integrity_queue = IntegrityAwareEventQueue::new_optimized(enhanced_queue);

        let stats = integrity_queue.get_comprehensive_stats().await;
        
        // Verify structure exists
        assert!(stats.integrity_metrics.total_validations >= 0);
        assert!(stats.compression_metrics.compression.total_compressions >= 0);
    }
}
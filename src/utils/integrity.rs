use anyhow::{Result, Context};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, warn, error, info, instrument};
use uuid::Uuid;

/// Validation checkpoint types across the message processing pipeline
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ValidationCheckpoint {
    /// Initial message ingress at webhook endpoints
    Ingress,
    /// Buffer allocation and processing in DynamicBufferManager
    Buffer,
    /// Compression/decompression operations
    Compression,
    /// Queue storage and retrieval operations
    Queue,
    /// File system write and read operations  
    FileSystem,
    /// Final message egress to external systems
    Egress,
}

impl ValidationCheckpoint {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ingress => "ingress",
            Self::Buffer => "buffer", 
            Self::Compression => "compression",
            Self::Queue => "queue",
            Self::FileSystem => "filesystem",
            Self::Egress => "egress",
        }
    }
}

/// Integrity validation metadata carried across system boundaries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationMetadata {
    /// Unique correlation ID for tracking across system boundaries
    pub correlation_id: String,
    /// SHA-256 hash of message content at validation checkpoint
    pub content_hash: String,
    /// Message size in bytes for truncation detection
    pub content_size: usize,
    /// Validation checkpoint where this metadata was generated
    pub checkpoint: ValidationCheckpoint,
    /// Timestamp when validation occurred (Unix timestamp)
    pub validated_at: u64,
    /// Optional previous checkpoint hash for chain validation
    pub previous_hash: Option<String>,
    /// Validation chain depth for tracking processing stages
    pub chain_depth: u32,
}

impl ValidationMetadata {
    /// Create new validation metadata for content at specific checkpoint
    pub fn new(
        content: &[u8],
        checkpoint: ValidationCheckpoint,
        correlation_id: Option<String>,
        previous_hash: Option<String>,
        chain_depth: u32,
    ) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(content);
        let content_hash = format!("{:x}", hasher.finalize());
        
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            correlation_id: correlation_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            content_hash,
            content_size: content.len(),
            checkpoint,
            validated_at: now,
            previous_hash,
            chain_depth,
        }
    }

    /// Validate content against this metadata
    pub fn validate_content(&self, content: &[u8]) -> ValidationResult {
        // Check content size for truncation detection
        if content.len() != self.content_size {
            return ValidationResult::Failed(IntegrityError::Truncation {
                expected_size: self.content_size,
                actual_size: content.len(),
                checkpoint: self.checkpoint,
            });
        }

        // Compute content hash
        let mut hasher = Sha256::new();
        hasher.update(content);
        let actual_hash = format!("{:x}", hasher.finalize());

        // Use constant-time comparison to prevent timing attacks
        if constant_time_eq(&self.content_hash, &actual_hash) {
            ValidationResult::Valid
        } else {
            ValidationResult::Failed(IntegrityError::Corruption {
                expected_hash: self.content_hash.clone(),
                actual_hash,
                checkpoint: self.checkpoint,
            })
        }
    }

    /// Create next validation metadata in chain
    pub fn next_checkpoint(
        &self, 
        content: &[u8], 
        next_checkpoint: ValidationCheckpoint
    ) -> Self {
        Self::new(
            content,
            next_checkpoint, 
            Some(self.correlation_id.clone()),
            Some(self.content_hash.clone()),
            self.chain_depth + 1,
        )
    }
}

/// Result of integrity validation
#[derive(Debug, Clone, PartialEq)]
pub enum ValidationResult {
    /// Content is valid and matches expected hash
    Valid,
    /// Content validation failed with specific error
    Failed(IntegrityError),
}

impl ValidationResult {
    pub fn is_valid(&self) -> bool {
        matches!(self, Self::Valid)
    }

    pub fn is_failed(&self) -> bool {
        matches!(self, Self::Failed(_))
    }
}

/// Types of integrity validation errors
#[derive(Debug, Clone, PartialEq)]
pub enum IntegrityError {
    /// Content corruption detected (hash mismatch)
    Corruption {
        expected_hash: String,
        actual_hash: String,
        checkpoint: ValidationCheckpoint,
    },
    /// Content truncation detected (size mismatch)
    Truncation {
        expected_size: usize,
        actual_size: usize,
        checkpoint: ValidationCheckpoint,
    },
    /// Chain validation failure (previous hash mismatch)
    ChainValidation {
        checkpoint: ValidationCheckpoint,
        error: String,
    },
    /// Validation timeout or processing error
    Processing {
        checkpoint: ValidationCheckpoint,
        error: String,
    },
}

impl IntegrityError {
    pub fn checkpoint(&self) -> ValidationCheckpoint {
        match self {
            Self::Corruption { checkpoint, .. } => *checkpoint,
            Self::Truncation { checkpoint, .. } => *checkpoint,
            Self::ChainValidation { checkpoint, .. } => *checkpoint,
            Self::Processing { checkpoint, .. } => *checkpoint,
        }
    }

    pub fn severity(&self) -> IntegritySeverity {
        match self {
            Self::Corruption { .. } => IntegritySeverity::Critical,
            Self::Truncation { .. } => IntegritySeverity::High,
            Self::ChainValidation { .. } => IntegritySeverity::Medium,
            Self::Processing { .. } => IntegritySeverity::Low,
        }
    }
}

/// Severity levels for integrity violations
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum IntegritySeverity {
    Low = 1,
    Medium = 2, 
    High = 3,
    Critical = 4,
}

/// Trait for implementing integrity validation across system components
pub trait IntegrityValidator {
    /// Validate content and generate validation metadata
    fn validate(&self, content: &[u8], checkpoint: ValidationCheckpoint) -> Result<ValidationMetadata>;
    
    /// Verify content against existing validation metadata
    fn verify(&self, content: &[u8], metadata: &ValidationMetadata) -> ValidationResult;
    
    /// Create validation chain entry for content transformation
    fn chain_validate(
        &self, 
        original_content: &[u8],
        transformed_content: &[u8],
        from_checkpoint: ValidationCheckpoint,
        to_checkpoint: ValidationCheckpoint,
        metadata: &ValidationMetadata,
    ) -> Result<ValidationMetadata>;
}

/// Default implementation of integrity validator
pub struct DefaultIntegrityValidator {
    /// Enable chain validation (validate against previous checkpoint)
    enable_chain_validation: bool,
}

impl DefaultIntegrityValidator {
    pub fn new(enable_chain_validation: bool) -> Self {
        Self {
            enable_chain_validation,
        }
    }

    pub fn new_default() -> Self {
        Self::new(true)
    }
}

impl IntegrityValidator for DefaultIntegrityValidator {
    #[instrument(skip(self, content), fields(checkpoint = ?checkpoint, size = content.len()))]
    fn validate(&self, content: &[u8], checkpoint: ValidationCheckpoint) -> Result<ValidationMetadata> {
        debug!("Generating validation metadata for checkpoint {:?}", checkpoint);
        
        let metadata = ValidationMetadata::new(
            content,
            checkpoint,
            None,
            None,
            0,
        );

        debug!(
            "Generated validation metadata: hash={}, size={}, correlation_id={}",
            &metadata.content_hash[..8], // Log first 8 chars of hash for debugging
            metadata.content_size,
            metadata.correlation_id
        );

        Ok(metadata)
    }

    #[instrument(skip(self, content, metadata), fields(checkpoint = ?metadata.checkpoint, correlation_id = %metadata.correlation_id))]
    fn verify(&self, content: &[u8], metadata: &ValidationMetadata) -> ValidationResult {
        debug!("Verifying content integrity at checkpoint {:?}", metadata.checkpoint);
        
        let result = metadata.validate_content(content);
        
        match &result {
            ValidationResult::Valid => {
                debug!("Integrity validation successful");
            }
            ValidationResult::Failed(error) => {
                warn!("Integrity validation failed: {:?}", error);
            }
        }

        result
    }

    #[instrument(skip(self, original_content, transformed_content, metadata), fields(from = ?from_checkpoint, to = ?to_checkpoint, correlation_id = %metadata.correlation_id))]
    fn chain_validate(
        &self,
        original_content: &[u8],
        transformed_content: &[u8],
        from_checkpoint: ValidationCheckpoint,
        to_checkpoint: ValidationCheckpoint,
        metadata: &ValidationMetadata,
    ) -> Result<ValidationMetadata> {
        debug!("Performing chain validation from {:?} to {:?}", from_checkpoint, to_checkpoint);

        // First verify the original content matches the provided metadata
        if self.enable_chain_validation {
            let verification_result = self.verify(original_content, metadata);
            if let ValidationResult::Failed(error) = verification_result {
                error!("Chain validation failed: original content validation failed");
                return Err(anyhow::anyhow!("Chain validation failed: {:?}", error));
            }
        }

        // Generate new metadata for transformed content
        let next_metadata = metadata.next_checkpoint(transformed_content, to_checkpoint);
        
        debug!(
            "Chain validation successful: new_hash={}, chain_depth={}",
            &next_metadata.content_hash[..8],
            next_metadata.chain_depth
        );

        Ok(next_metadata)
    }
}

/// Integrity validation metrics and monitoring
#[derive(Debug, Default, Clone, Serialize)]
pub struct IntegrityMetrics {
    pub total_validations: u64,
    pub successful_validations: u64,
    pub failed_validations: u64,
    pub corruption_errors: u64,
    pub truncation_errors: u64,
    pub chain_validation_errors: u64,
    pub processing_errors: u64,
    pub validation_latency_ms: f64,
}

impl IntegrityMetrics {
    pub fn success_rate(&self) -> f64 {
        if self.total_validations == 0 {
            0.0
        } else {
            (self.successful_validations as f64) / (self.total_validations as f64)
        }
    }

    pub fn failure_rate(&self) -> f64 {
        1.0 - self.success_rate()
    }

    pub fn record_validation(&mut self, result: &ValidationResult, latency_ms: f64) {
        self.total_validations += 1;
        self.validation_latency_ms = 
            0.9 * self.validation_latency_ms + 0.1 * latency_ms; // Exponential moving average

        match result {
            ValidationResult::Valid => {
                self.successful_validations += 1;
            }
            ValidationResult::Failed(error) => {
                self.failed_validations += 1;
                match error {
                    IntegrityError::Corruption { .. } => self.corruption_errors += 1,
                    IntegrityError::Truncation { .. } => self.truncation_errors += 1,
                    IntegrityError::ChainValidation { .. } => self.chain_validation_errors += 1,
                    IntegrityError::Processing { .. } => self.processing_errors += 1,
                }
            }
        }
    }
}

/// Instrumented integrity validator with metrics collection
pub struct InstrumentedIntegrityValidator {
    inner: Box<dyn IntegrityValidator + Send + Sync>,
    metrics: std::sync::RwLock<IntegrityMetrics>,
}

impl InstrumentedIntegrityValidator {
    pub fn new(validator: Box<dyn IntegrityValidator + Send + Sync>) -> Self {
        Self {
            inner: validator,
            metrics: std::sync::RwLock::new(IntegrityMetrics::default()),
        }
    }

    pub fn get_metrics(&self) -> IntegrityMetrics {
        (*self.metrics.read().unwrap()).clone()
    }

    pub fn reset_metrics(&self) {
        let mut metrics = self.metrics.write().unwrap();
        *metrics = IntegrityMetrics::default();
    }
}

impl IntegrityValidator for InstrumentedIntegrityValidator {
    fn validate(&self, content: &[u8], checkpoint: ValidationCheckpoint) -> Result<ValidationMetadata> {
        let start = std::time::Instant::now();
        let result = self.inner.validate(content, checkpoint);
        let latency_ms = start.elapsed().as_millis() as f64;

        // Record metrics based on success/failure
        let validation_result = if result.is_ok() { 
            ValidationResult::Valid 
        } else { 
            ValidationResult::Failed(IntegrityError::Processing {
                checkpoint,
                error: "Validation processing failed".to_string(),
            })
        };

        let mut metrics = self.metrics.write().unwrap();
        metrics.record_validation(&validation_result, latency_ms);

        result
    }

    fn verify(&self, content: &[u8], metadata: &ValidationMetadata) -> ValidationResult {
        let start = std::time::Instant::now();
        let result = self.inner.verify(content, metadata);
        let latency_ms = start.elapsed().as_millis() as f64;

        let mut metrics = self.metrics.write().unwrap();
        metrics.record_validation(&result, latency_ms);

        result
    }

    fn chain_validate(
        &self,
        original_content: &[u8],
        transformed_content: &[u8],
        from_checkpoint: ValidationCheckpoint,
        to_checkpoint: ValidationCheckpoint,
        metadata: &ValidationMetadata,
    ) -> Result<ValidationMetadata> {
        let start = std::time::Instant::now();
        let result = self.inner.chain_validate(
            original_content,
            transformed_content,
            from_checkpoint,
            to_checkpoint,
            metadata,
        );
        let latency_ms = start.elapsed().as_millis() as f64;

        // Record metrics based on success/failure
        let validation_result = if result.is_ok() { 
            ValidationResult::Valid 
        } else { 
            ValidationResult::Failed(IntegrityError::ChainValidation {
                checkpoint: to_checkpoint,
                error: "Chain validation processing failed".to_string(),
            })
        };

        let mut metrics = self.metrics.write().unwrap();
        metrics.record_validation(&validation_result, latency_ms);

        result
    }
}

/// Constant-time string comparison to prevent timing attacks
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    
    let mut result = 0u8;
    for (byte_a, byte_b) in a.bytes().zip(b.bytes()) {
        result |= byte_a ^ byte_b;
    }
    
    result == 0
}

/// Global integrity validator instance
static mut GLOBAL_VALIDATOR: Option<InstrumentedIntegrityValidator> = None;
static VALIDATOR_INIT: std::sync::Once = std::sync::Once::new();

/// Get or initialize global integrity validator
pub fn get_global_validator() -> &'static InstrumentedIntegrityValidator {
    unsafe {
        VALIDATOR_INIT.call_once(|| {
            let validator = DefaultIntegrityValidator::new_default();
            GLOBAL_VALIDATOR = Some(InstrumentedIntegrityValidator::new(Box::new(validator)));
        });
        
        GLOBAL_VALIDATOR.as_ref().unwrap()
    }
}

/// Convenience function for simple content validation
pub fn validate_content(content: &[u8], checkpoint: ValidationCheckpoint) -> Result<ValidationMetadata> {
    get_global_validator().validate(content, checkpoint)
}

/// Convenience function for content verification
pub fn verify_content(content: &[u8], metadata: &ValidationMetadata) -> ValidationResult {
    get_global_validator().verify(content, metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_validation_metadata_creation() {
        let content = b"test message content";
        let metadata = ValidationMetadata::new(
            content,
            ValidationCheckpoint::Ingress,
            Some("test-correlation-id".to_string()),
            None,
            0,
        );
        
        assert_eq!(metadata.correlation_id, "test-correlation-id");
        assert_eq!(metadata.content_size, content.len());
        assert_eq!(metadata.checkpoint, ValidationCheckpoint::Ingress);
        assert_eq!(metadata.chain_depth, 0);
        assert!(metadata.previous_hash.is_none());
    }
    
    #[test]
    fn test_content_validation_success() {
        let content = b"test message content";
        let metadata = ValidationMetadata::new(
            content,
            ValidationCheckpoint::Buffer,
            None,
            None,
            0,
        );
        
        let result = metadata.validate_content(content);
        assert!(result.is_valid());
    }
    
    #[test]
    fn test_content_validation_corruption() {
        let original_content = b"original content";
        let corrupted_content = b"corrupted content";
        
        let metadata = ValidationMetadata::new(
            original_content,
            ValidationCheckpoint::Queue,
            None,
            None,
            0,
        );
        
        let result = metadata.validate_content(corrupted_content);
        assert!(result.is_failed());
        
        if let ValidationResult::Failed(IntegrityError::Corruption { checkpoint, .. }) = result {
            assert_eq!(checkpoint, ValidationCheckpoint::Queue);
        } else {
            panic!("Expected corruption error");
        }
    }
    
    #[test]
    fn test_content_validation_truncation() {
        let original_content = b"this is longer content";
        let truncated_content = b"this is";
        
        let metadata = ValidationMetadata::new(
            original_content,
            ValidationCheckpoint::FileSystem,
            None,
            None,
            0,
        );
        
        let result = metadata.validate_content(truncated_content);
        assert!(result.is_failed());
        
        if let ValidationResult::Failed(IntegrityError::Truncation { 
            expected_size, 
            actual_size,
            checkpoint 
        }) = result {
            assert_eq!(expected_size, original_content.len());
            assert_eq!(actual_size, truncated_content.len());
            assert_eq!(checkpoint, ValidationCheckpoint::FileSystem);
        } else {
            panic!("Expected truncation error");
        }
    }
    
    #[test]
    fn test_chain_validation() {
        let validator = DefaultIntegrityValidator::new_default();
        let original_content = b"original message";
        let transformed_content = b"ORIGINAL MESSAGE"; // Transformed content
        
        // Generate initial metadata
        let initial_metadata = validator.validate(original_content, ValidationCheckpoint::Ingress).unwrap();
        
        // Perform chain validation
        let next_metadata = validator.chain_validate(
            original_content,
            transformed_content,
            ValidationCheckpoint::Ingress,
            ValidationCheckpoint::Buffer,
            &initial_metadata,
        ).unwrap();
        
        assert_eq!(next_metadata.chain_depth, 1);
        assert_eq!(next_metadata.checkpoint, ValidationCheckpoint::Buffer);
        assert_eq!(next_metadata.correlation_id, initial_metadata.correlation_id);
        assert_eq!(next_metadata.previous_hash, Some(initial_metadata.content_hash.clone()));
        
        // Verify transformed content validates against new metadata
        let verification_result = validator.verify(transformed_content, &next_metadata);
        assert!(verification_result.is_valid());
    }
    
    #[test]
    fn test_constant_time_eq() {
        assert!(constant_time_eq("hello", "hello"));
        assert!(!constant_time_eq("hello", "world"));
        assert!(!constant_time_eq("hello", "hello world"));
        assert!(!constant_time_eq("hello world", "hello"));
    }
    
    #[test]
    fn test_integrity_metrics() {
        let mut metrics = IntegrityMetrics::default();
        
        // Record successful validation
        metrics.record_validation(&ValidationResult::Valid, 10.0);
        assert_eq!(metrics.success_rate(), 1.0);
        assert_eq!(metrics.failure_rate(), 0.0);
        
        // Record failed validation
        let error = IntegrityError::Corruption {
            expected_hash: "abc".to_string(),
            actual_hash: "def".to_string(),
            checkpoint: ValidationCheckpoint::Queue,
        };
        metrics.record_validation(&ValidationResult::Failed(error), 15.0);
        
        assert_eq!(metrics.success_rate(), 0.5);
        assert_eq!(metrics.failure_rate(), 0.5);
        assert_eq!(metrics.corruption_errors, 1);
        assert_eq!(metrics.total_validations, 2);
    }
}
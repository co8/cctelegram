/**
 * Integrity Validation System for CCTelegram MCP Server
 * Task 39.5: End-to-End Integrity Validation Engineer Implementation
 * 
 * Provides SHA-256 based message integrity validation across webhook ingress,
 * buffer operations, and cross-system communication boundaries.
 */

import { createHash, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { performance } from 'perf_hooks';
import { secureLog } from '../security.js';

export enum ValidationCheckpoint {
  Ingress = 'ingress',
  Buffer = 'buffer', 
  Compression = 'compression',
  Queue = 'queue',
  FileSystem = 'filesystem',
  Egress = 'egress'
}

export interface ValidationMetadata {
  correlationId: string;
  contentHash: string;
  contentSize: number;
  checkpoint: ValidationCheckpoint;
  validatedAt: number;
  previousHash?: string;
  chainDepth: number;
}

export interface ValidationResult {
  isValid: boolean;
  error?: IntegrityError;
}

export interface IntegrityError {
  type: 'corruption' | 'truncation' | 'chain_validation' | 'processing';
  checkpoint: ValidationCheckpoint;
  expectedHash?: string;
  actualHash?: string;
  expectedSize?: number;
  actualSize?: number;
  message: string;
  severity: IntegritySeverity;
}

export enum IntegritySeverity {
  Low = 1,
  Medium = 2,
  High = 3,
  Critical = 4
}

export interface IntegrityMetrics {
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  corruptionErrors: number;
  truncationErrors: number;
  chainValidationErrors: number;
  processingErrors: number;
  averageLatencyMs: number;
}

/**
 * Interface for implementing integrity validation across system components
 */
export interface IIntegrityValidator {
  /**
   * Validate content and generate validation metadata
   */
  validate(content: Buffer, checkpoint: ValidationCheckpoint, correlationId?: string): Promise<ValidationMetadata>;
  
  /**
   * Verify content against existing validation metadata
   */
  verify(content: Buffer, metadata: ValidationMetadata): Promise<ValidationResult>;
  
  /**
   * Create validation chain entry for content transformation
   */
  chainValidate(
    originalContent: Buffer,
    transformedContent: Buffer,
    fromCheckpoint: ValidationCheckpoint,
    toCheckpoint: ValidationCheckpoint,
    metadata: ValidationMetadata
  ): Promise<ValidationMetadata>;
}

/**
 * Default implementation of integrity validator using SHA-256
 */
export class DefaultIntegrityValidator implements IIntegrityValidator {
  private readonly enableChainValidation: boolean;

  constructor(enableChainValidation: boolean = true) {
    this.enableChainValidation = enableChainValidation;
  }

  /**
   * Generate SHA-256 hash for content
   */
  private generateContentHash(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Create new validation metadata for content at specific checkpoint
   */
  private createValidationMetadata(
    content: Buffer,
    checkpoint: ValidationCheckpoint,
    correlationId?: string,
    previousHash?: string,
    chainDepth: number = 0
  ): ValidationMetadata {
    const contentHash = this.generateContentHash(content);
    const now = Date.now();

    return {
      correlationId: correlationId || uuidv4(),
      contentHash,
      contentSize: content.length,
      checkpoint,
      validatedAt: now,
      previousHash,
      chainDepth
    };
  }

  /**
   * Validate content against metadata with constant-time comparison
   */
  private validateContent(content: Buffer, metadata: ValidationMetadata): ValidationResult {
    // Check content size for truncation detection
    if (content.length !== metadata.contentSize) {
      return {
        isValid: false,
        error: {
          type: 'truncation',
          checkpoint: metadata.checkpoint,
          expectedSize: metadata.contentSize,
          actualSize: content.length,
          message: `Content truncation detected: expected ${metadata.contentSize} bytes, got ${content.length} bytes`,
          severity: IntegritySeverity.High
        }
      };
    }

    // Compute and compare content hash using timing-safe comparison
    const actualHash = this.generateContentHash(content);
    const expectedHashBuffer = Buffer.from(metadata.contentHash, 'hex');
    const actualHashBuffer = Buffer.from(actualHash, 'hex');

    if (!timingSafeEqual(expectedHashBuffer, actualHashBuffer)) {
      return {
        isValid: false,
        error: {
          type: 'corruption',
          checkpoint: metadata.checkpoint,
          expectedHash: metadata.contentHash,
          actualHash,
          message: `Content corruption detected: hash mismatch at ${metadata.checkpoint}`,
          severity: IntegritySeverity.Critical
        }
      };
    }

    return { isValid: true };
  }

  /**
   * Validate content and generate validation metadata
   */
  async validate(
    content: Buffer, 
    checkpoint: ValidationCheckpoint, 
    correlationId?: string
  ): Promise<ValidationMetadata> {
    secureLog('debug', 'Generating validation metadata', {
      checkpoint,
      contentSize: content.length,
      correlationId: correlationId || 'auto-generated'
    });

    const metadata = this.createValidationMetadata(content, checkpoint, correlationId);

    secureLog('debug', 'Generated validation metadata', {
      checkpoint,
      contentHash: metadata.contentHash.substring(0, 8) + '...',
      contentSize: metadata.contentSize,
      correlationId: metadata.correlationId
    });

    return metadata;
  }

  /**
   * Verify content against existing validation metadata
   */
  async verify(content: Buffer, metadata: ValidationMetadata): Promise<ValidationResult> {
    secureLog('debug', 'Verifying content integrity', {
      checkpoint: metadata.checkpoint,
      correlationId: metadata.correlationId,
      expectedSize: metadata.contentSize,
      actualSize: content.length
    });

    const result = this.validateContent(content, metadata);

    if (result.isValid) {
      secureLog('debug', 'Integrity validation successful', {
        checkpoint: metadata.checkpoint,
        correlationId: metadata.correlationId
      });
    } else {
      secureLog('warn', 'Integrity validation failed', {
        checkpoint: metadata.checkpoint,
        correlationId: metadata.correlationId,
        error: result.error
      });
    }

    return result;
  }

  /**
   * Create validation chain entry for content transformation
   */
  async chainValidate(
    originalContent: Buffer,
    transformedContent: Buffer,
    fromCheckpoint: ValidationCheckpoint,
    toCheckpoint: ValidationCheckpoint,
    metadata: ValidationMetadata
  ): Promise<ValidationMetadata> {
    secureLog('debug', 'Performing chain validation', {
      from: fromCheckpoint,
      to: toCheckpoint,
      correlationId: metadata.correlationId,
      originalSize: originalContent.length,
      transformedSize: transformedContent.length
    });

    // Verify original content matches the provided metadata if chain validation is enabled
    if (this.enableChainValidation) {
      const verificationResult = await this.verify(originalContent, metadata);
      if (!verificationResult.isValid) {
        throw new Error(`Chain validation failed: original content validation failed - ${verificationResult.error?.message}`);
      }
    }

    // Create new metadata for transformed content
    const nextMetadata = this.createValidationMetadata(
      transformedContent,
      toCheckpoint,
      metadata.correlationId,
      metadata.contentHash,
      metadata.chainDepth + 1
    );

    secureLog('debug', 'Chain validation successful', {
      from: fromCheckpoint,
      to: toCheckpoint,
      correlationId: nextMetadata.correlationId,
      newContentHash: nextMetadata.contentHash.substring(0, 8) + '...',
      chainDepth: nextMetadata.chainDepth
    });

    return nextMetadata;
  }
}

/**
 * Instrumented integrity validator with metrics collection
 */
export class InstrumentedIntegrityValidator implements IIntegrityValidator {
  private readonly inner: IIntegrityValidator;
  private metrics: IntegrityMetrics;

  constructor(validator: IIntegrityValidator) {
    this.inner = validator;
    this.metrics = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      corruptionErrors: 0,
      truncationErrors: 0,
      chainValidationErrors: 0,
      processingErrors: 0,
      averageLatencyMs: 0
    };
  }

  private recordValidation(result: ValidationResult, latencyMs: number): void {
    this.metrics.totalValidations++;
    this.metrics.averageLatencyMs = 
      0.9 * this.metrics.averageLatencyMs + 0.1 * latencyMs; // Exponential moving average

    if (result.isValid) {
      this.metrics.successfulValidations++;
    } else {
      this.metrics.failedValidations++;
      
      if (result.error) {
        switch (result.error.type) {
          case 'corruption':
            this.metrics.corruptionErrors++;
            break;
          case 'truncation':
            this.metrics.truncationErrors++;
            break;
          case 'chain_validation':
            this.metrics.chainValidationErrors++;
            break;
          case 'processing':
            this.metrics.processingErrors++;
            break;
        }
      }
    }
  }

  async validate(content: Buffer, checkpoint: ValidationCheckpoint, correlationId?: string): Promise<ValidationMetadata> {
    const startTime = performance.now();
    
    try {
      const result = await this.inner.validate(content, checkpoint, correlationId);
      const latencyMs = performance.now() - startTime;
      
      this.recordValidation({ isValid: true }, latencyMs);
      return result;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      
      this.recordValidation({
        isValid: false,
        error: {
          type: 'processing',
          checkpoint,
          message: error instanceof Error ? error.message : 'Validation processing failed',
          severity: IntegritySeverity.Medium
        }
      }, latencyMs);
      
      throw error;
    }
  }

  async verify(content: Buffer, metadata: ValidationMetadata): Promise<ValidationResult> {
    const startTime = performance.now();
    const result = await this.inner.verify(content, metadata);
    const latencyMs = performance.now() - startTime;
    
    this.recordValidation(result, latencyMs);
    return result;
  }

  async chainValidate(
    originalContent: Buffer,
    transformedContent: Buffer,
    fromCheckpoint: ValidationCheckpoint,
    toCheckpoint: ValidationCheckpoint,
    metadata: ValidationMetadata
  ): Promise<ValidationMetadata> {
    const startTime = performance.now();
    
    try {
      const result = await this.inner.chainValidate(
        originalContent,
        transformedContent,
        fromCheckpoint,
        toCheckpoint,
        metadata
      );
      const latencyMs = performance.now() - startTime;
      
      this.recordValidation({ isValid: true }, latencyMs);
      return result;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      
      this.recordValidation({
        isValid: false,
        error: {
          type: 'chain_validation',
          checkpoint: toCheckpoint,
          message: error instanceof Error ? error.message : 'Chain validation processing failed',
          severity: IntegritySeverity.Medium
        }
      }, latencyMs);
      
      throw error;
    }
  }

  getMetrics(): IntegrityMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      corruptionErrors: 0,
      truncationErrors: 0,
      chainValidationErrors: 0,
      processingErrors: 0,
      averageLatencyMs: 0
    };
  }

  getSuccessRate(): number {
    return this.metrics.totalValidations === 0 ? 
      0 : this.metrics.successfulValidations / this.metrics.totalValidations;
  }

  getFailureRate(): number {
    return 1.0 - this.getSuccessRate();
  }
}

/**
 * Global integrity validator instance
 */
let globalValidator: InstrumentedIntegrityValidator | null = null;

/**
 * Get or create global integrity validator
 */
export function getGlobalIntegrityValidator(): InstrumentedIntegrityValidator {
  if (!globalValidator) {
    const validator = new DefaultIntegrityValidator(true);
    globalValidator = new InstrumentedIntegrityValidator(validator);
    
    secureLog('info', 'Global integrity validator initialized', {
      chainValidation: true,
      metricsEnabled: true
    });
  }
  
  return globalValidator;
}

/**
 * Convenience function for simple content validation
 */
export async function validateContent(
  content: Buffer, 
  checkpoint: ValidationCheckpoint,
  correlationId?: string
): Promise<ValidationMetadata> {
  return getGlobalIntegrityValidator().validate(content, checkpoint, correlationId);
}

/**
 * Convenience function for content verification
 */
export async function verifyContent(
  content: Buffer, 
  metadata: ValidationMetadata
): Promise<ValidationResult> {
  return getGlobalIntegrityValidator().verify(content, metadata);
}

/**
 * Express middleware for webhook payload integrity validation
 */
export function integrityValidationMiddleware(
  checkpoint: ValidationCheckpoint = ValidationCheckpoint.Ingress
) {
  return async (req: any, res: any, next: any) => {
    try {
      // Skip validation for non-POST requests or requests without body
      if (req.method !== 'POST' || !req.body) {
        return next();
      }

      const startTime = performance.now();
      
      // Get correlation ID from headers or generate new one
      const correlationId = req.correlationId || req.headers['x-correlation-id'] || uuidv4();
      
      // Convert request body to Buffer for validation
      const content = Buffer.from(JSON.stringify(req.body));
      
      // Generate validation metadata
      const validator = getGlobalIntegrityValidator();
      const metadata = await validator.validate(content, checkpoint, correlationId);
      
      // Attach validation metadata to request for downstream processing
      req.integrityMetadata = metadata;
      
      const validationTime = performance.now() - startTime;
      
      secureLog('debug', 'Request integrity validation completed', {
        correlationId,
        checkpoint,
        contentSize: content.length,
        validationTimeMs: Math.round(validationTime * 100) / 100,
        contentHash: metadata.contentHash.substring(0, 8) + '...'
      });
      
      next();
      
    } catch (error) {
      secureLog('error', 'Request integrity validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        correlationId: req.correlationId
      });
      
      res.status(500).json({
        success: false,
        error: 'Integrity validation failed',
        correlationId: req.correlationId,
        timestamp: new Date().toISOString()
      });
    }
  };
}

/**
 * Response integrity validation middleware
 */
export function responseIntegrityValidationMiddleware() {
  return (req: any, res: any, next: any) => {
    const originalJson = res.json;
    
    res.json = function(data: any) {
      try {
        const content = Buffer.from(JSON.stringify(data));
        const correlationId = req.correlationId || 'unknown';
        
        // Add integrity metadata to response headers
        const validator = getGlobalIntegrityValidator();
        validator.validate(content, ValidationCheckpoint.Egress, correlationId)
          .then((metadata) => {
            res.setHeader('X-Content-Hash', metadata.contentHash);
            res.setHeader('X-Content-Size', metadata.contentSize.toString());
            res.setHeader('X-Validation-Checkpoint', metadata.checkpoint);
            res.setHeader('X-Correlation-ID', metadata.correlationId);
            
            secureLog('debug', 'Response integrity validation completed', {
              correlationId,
              contentSize: metadata.contentSize,
              contentHash: metadata.contentHash.substring(0, 8) + '...'
            });
          })
          .catch((error) => {
            secureLog('warn', 'Response integrity validation failed', {
              error: error instanceof Error ? error.message : 'Unknown error',
              correlationId
            });
          });
        
        return originalJson.call(this, data);
      } catch (error) {
        secureLog('error', 'Response integrity middleware error', {
          error: error instanceof Error ? error.message : 'Unknown error',
          correlationId: req.correlationId
        });
        
        return originalJson.call(this, data);
      }
    };
    
    next();
  };
}
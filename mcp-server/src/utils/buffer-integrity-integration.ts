/**
 * Buffer Integrity Integration for Dynamic Buffer Manager
 * Task 39.5: End-to-End Integrity Validation Implementation
 * 
 * Extends the DynamicBufferManager with SHA-256 integrity validation
 * for secure buffer operations and memory leak prevention.
 */

import { 
  DynamicBufferPool, 
  DynamicBuffer, 
  MessageStreamProcessor,
  type BufferStats,
  type StreamProcessorOptions 
} from './dynamic-buffer-manager.js';
import { 
  ValidationCheckpoint,
  getGlobalIntegrityValidator,
  type ValidationMetadata,
  type ValidationResult,
  type IntegrityMetrics
} from './integrity-validator.js';
import { secureLog } from '../security.js';

export interface BufferIntegrityStats extends BufferStats {
  integrityValidations: number;
  integrityFailures: number;
  integritySuccessRate: number;
  corruptionDetected: number;
  truncationDetected: number;
}

/**
 * Enhanced Dynamic Buffer Pool with integrity validation
 */
export class IntegrityAwareDynamicBufferPool extends DynamicBufferPool {
  private integrityValidator = getGlobalIntegrityValidator();
  private integrityStats = {
    validations: 0,
    failures: 0,
    corruptionDetected: 0,
    truncationDetected: 0
  };

  constructor(config: any = {}) {
    super(config);
    
    secureLog('info', 'Integrity-aware dynamic buffer pool initialized', {
      integrityValidation: 'enabled',
      bufferPoolConfig: {
        initialPoolSize: config.initialPoolSize || 10,
        maxPoolSize: config.maxPoolSize || 100,
        bufferSize: config.bufferSize || 16384
      }
    });
  }

  /**
   * Acquire buffer with integrity metadata initialization
   */
  acquireWithIntegrity(size?: number, correlationId?: string): Promise<IntegrityAwareBuffer> {
    const buffer = this.acquire(size);
    
    secureLog('debug', 'Buffer acquired with integrity validation', {
      bufferSize: buffer.length,
      correlationId: correlationId || 'none',
      poolSizeRemaining: this.getStats().poolSize
    });

    return Promise.resolve(new IntegrityAwareBuffer(buffer, this, correlationId));
  }

  /**
   * Get enhanced statistics including integrity validation
   */
  getIntegrityStats(): BufferIntegrityStats {
    const baseStats = super.getStats();
    
    return {
      ...baseStats,
      integrityValidations: this.integrityStats.validations,
      integrityFailures: this.integrityStats.failures,
      integritySuccessRate: this.integrityStats.validations > 0 ? 
        (this.integrityStats.validations - this.integrityStats.failures) / this.integrityStats.validations : 1.0,
      corruptionDetected: this.integrityStats.corruptionDetected,
      truncationDetected: this.integrityStats.truncationDetected
    };
  }

  /**
   * Internal method to record integrity validation result
   */
  recordIntegrityResult(result: ValidationResult): void {
    this.integrityStats.validations++;
    
    if (!result.isValid && result.error) {
      this.integrityStats.failures++;
      
      switch (result.error.type) {
        case 'corruption':
          this.integrityStats.corruptionDetected++;
          break;
        case 'truncation':
          this.integrityStats.truncationDetected++;
          break;
      }
    }
  }

  /**
   * Validate buffer content integrity
   */
  async validateBufferIntegrity(buffer: Buffer, metadata: ValidationMetadata): Promise<ValidationResult> {
    const result = await this.integrityValidator.verify(buffer, metadata);
    this.recordIntegrityResult(result);
    
    if (!result.isValid) {
      secureLog('warn', 'Buffer integrity validation failed', {
        error: result.error,
        bufferSize: buffer.length,
        expectedSize: metadata.contentSize,
        correlationId: metadata.correlationId
      });
    }
    
    return result;
  }

  /**
   * Create dynamic buffer with integrity validation
   */
  createIntegrityAwareDynamicBuffer(initialSize: number = 1024, correlationId?: string): IntegrityAwareDynamicBuffer {
    return new IntegrityAwareDynamicBuffer(initialSize, this, correlationId);
  }
}

/**
 * Buffer wrapper with integrity validation capabilities
 */
export class IntegrityAwareBuffer {
  private buffer: Buffer;
  private integrityPool: IntegrityAwareDynamicBufferPool;
  private correlationId: string;
  private validationMetadata: ValidationMetadata | null = null;
  private isValidated = false;

  constructor(buffer: Buffer, pool: IntegrityAwareDynamicBufferPool, correlationId?: string) {
    this.buffer = buffer;
    this.integrityPool = pool;
    this.correlationId = correlationId || `buffer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get buffer content with integrity validation
   */
  async getContent(): Promise<Buffer> {
    if (this.isValidated && this.validationMetadata) {
      const validationResult = await this.integrityPool.validateBufferIntegrity(this.buffer, this.validationMetadata);
      
      if (!validationResult.isValid) {
        throw new Error(`Buffer integrity validation failed: ${validationResult.error?.message}`);
      }
    }
    
    return this.buffer;
  }

  /**
   * Write data to buffer with integrity validation
   */
  async writeWithIntegrity(data: Buffer, checkpoint: ValidationCheckpoint = ValidationCheckpoint.Buffer): Promise<void> {
    const validator = getGlobalIntegrityValidator();
    
    // Validate input data
    const inputMetadata = await validator.validate(data, checkpoint, this.correlationId);
    
    // Copy data to buffer
    data.copy(this.buffer, 0);
    
    // Generate validation metadata for buffer content
    this.validationMetadata = await validator.validate(
      this.buffer.subarray(0, data.length), 
      checkpoint, 
      this.correlationId
    );
    
    this.isValidated = true;
    
    secureLog('debug', 'Buffer write with integrity validation completed', {
      correlationId: this.correlationId,
      dataSize: data.length,
      bufferSize: this.buffer.length,
      contentHash: this.validationMetadata.contentHash.substring(0, 8) + '...'
    });
  }

  /**
   * Verify buffer integrity against expected metadata
   */
  async verifyIntegrity(expectedMetadata: ValidationMetadata): Promise<ValidationResult> {
    return await this.integrityPool.validateBufferIntegrity(this.buffer, expectedMetadata);
  }

  /**
   * Get validation metadata
   */
  getValidationMetadata(): ValidationMetadata | null {
    return this.validationMetadata;
  }

  /**
   * Get buffer size
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Get correlation ID
   */
  get id(): string {
    return this.correlationId;
  }

  /**
   * Release buffer back to pool
   */
  release(): void {
    // Clear validation metadata on release for security
    this.validationMetadata = null;
    this.isValidated = false;
    
    // Zero out buffer content before release
    this.buffer.fill(0);
    
    this.integrityPool.release(this.buffer);
    
    secureLog('debug', 'Integrity-aware buffer released', {
      correlationId: this.correlationId,
      bufferSize: this.buffer.length
    });
  }
}

/**
 * Enhanced Dynamic Buffer with integrity validation
 */
export class IntegrityAwareDynamicBuffer extends DynamicBuffer {
  private integrityPool: IntegrityAwareDynamicBufferPool;
  private correlationId: string;
  private validationMetadata: ValidationMetadata | null = null;
  private writeCount = 0;

  constructor(initialSize: number, pool: IntegrityAwareDynamicBufferPool, correlationId?: string) {
    super(initialSize, pool as any); // Cast to base type for compatibility
    this.integrityPool = pool;
    this.correlationId = correlationId || `dynamic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Write data with integrity validation
   */
  async writeWithIntegrity(data: Buffer | string, encoding?: BufferEncoding): Promise<number> {
    const writeBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
    
    // Perform the write operation
    const written = this.write(data, encoding);
    this.writeCount++;
    
    // Generate validation metadata for current buffer content
    const validator = getGlobalIntegrityValidator();
    const currentContent = this.toBuffer();
    
    this.validationMetadata = await validator.validate(
      currentContent, 
      ValidationCheckpoint.Buffer, 
      this.correlationId
    );
    
    secureLog('debug', 'Dynamic buffer write with integrity validation', {
      correlationId: this.correlationId,
      writeCount: this.writeCount,
      dataSize: writeBuffer.length,
      totalBufferSize: currentContent.length,
      contentHash: this.validationMetadata.contentHash.substring(0, 8) + '...'
    });
    
    return written;
  }

  /**
   * Read data with integrity validation
   */
  async readWithIntegrity(size?: number): Promise<Buffer> {
    const content = this.read(size);
    
    // Validate integrity if we have validation metadata
    if (this.validationMetadata) {
      const validationResult = await this.integrityPool.validateBufferIntegrity(content, this.validationMetadata);
      
      if (!validationResult.isValid) {
        secureLog('error', 'Dynamic buffer integrity validation failed on read', {
          correlationId: this.correlationId,
          error: validationResult.error,
          expectedSize: this.validationMetadata.contentSize,
          actualSize: content.length
        });
        
        throw new Error(`Buffer integrity validation failed: ${validationResult.error?.message}`);
      }
    }
    
    return content;
  }

  /**
   * Get buffer content with integrity validation
   */
  async toBufferWithIntegrity(): Promise<{ content: Buffer; metadata: ValidationMetadata | null }> {
    const content = this.toBuffer();
    
    // Validate if we have metadata
    if (this.validationMetadata) {
      const validationResult = await this.integrityPool.validateBufferIntegrity(content, this.validationMetadata);
      
      if (!validationResult.isValid) {
        throw new Error(`Buffer integrity validation failed: ${validationResult.error?.message}`);
      }
    }
    
    return {
      content,
      metadata: this.validationMetadata
    };
  }

  /**
   * Reset buffer with integrity clearing
   */
  resetWithIntegrity(): void {
    this.reset();
    this.validationMetadata = null;
    this.writeCount = 0;
    
    secureLog('debug', 'Dynamic buffer reset with integrity clearing', {
      correlationId: this.correlationId
    });
  }

  /**
   * Get validation metadata
   */
  getValidationMetadata(): ValidationMetadata | null {
    return this.validationMetadata;
  }

  /**
   * Get write count
   */
  getWriteCount(): number {
    return this.writeCount;
  }

  /**
   * Release buffer with security clearing
   */
  releaseWithIntegrity(): void {
    // Clear validation metadata
    this.validationMetadata = null;
    this.writeCount = 0;
    
    // Release underlying buffer
    this.release();
    
    secureLog('debug', 'Dynamic buffer released with integrity clearing', {
      correlationId: this.correlationId
    });
  }
}

/**
 * Enhanced Message Stream Processor with integrity validation
 */
export class IntegrityAwareMessageStreamProcessor extends MessageStreamProcessor {
  private integrityPool: IntegrityAwareDynamicBufferPool;
  private validationStats = {
    messagesProcessed: 0,
    validationFailures: 0,
    corruptionDetected: 0
  };

  constructor(bufferPool: IntegrityAwareDynamicBufferPool, options: StreamProcessorOptions = {}) {
    super(bufferPool as any, options); // Cast to base type
    this.integrityPool = bufferPool;
  }

  /**
   * Process message with integrity validation
   */
  protected async processMessageWithIntegrity(message: string): Promise<void> {
    try {
      this.validationStats.messagesProcessed++;
      
      // Validate message content
      const messageBuffer = Buffer.from(message, 'utf8');
      const validator = getGlobalIntegrityValidator();
      const metadata = await validator.validate(messageBuffer, ValidationCheckpoint.Buffer);
      
      // Parse and validate JSON
      const parsed = JSON.parse(message);
      
      // Create buffer for output with integrity validation
      const outputBuffer = await this.integrityPool.acquireWithIntegrity();
      const output = JSON.stringify(parsed);
      
      await outputBuffer.writeWithIntegrity(Buffer.from(output, 'utf8'));
      const validatedContent = await outputBuffer.getContent();
      
      this.push(validatedContent.subarray(0, Buffer.byteLength(output)));
      
      // Release buffer
      outputBuffer.release();
      
      secureLog('debug', 'Message processed with integrity validation', {
        messageLength: message.length,
        outputLength: output.length,
        contentHash: metadata.contentHash.substring(0, 8) + '...'
      });
      
    } catch (error) {
      this.validationStats.validationFailures++;
      
      if (error instanceof SyntaxError) {
        // JSON parsing error - not integrity issue
        secureLog('warn', 'Message parsing failed', {
          error: error.message,
          messagePreview: message.substring(0, 100)
        });
        
        // Forward raw message
        this.push(Buffer.from(message + '\n'));
      } else {
        // Potential integrity issue
        this.validationStats.corruptionDetected++;
        
        secureLog('error', 'Message integrity validation failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          messagesProcessed: this.validationStats.messagesProcessed
        });
        
        throw error;
      }
    }
  }

  /**
   * Get validation statistics
   */
  getValidationStats() {
    return {
      ...this.validationStats,
      successRate: this.validationStats.messagesProcessed > 0 ? 
        (this.validationStats.messagesProcessed - this.validationStats.validationFailures) / this.validationStats.messagesProcessed : 1.0
    };
  }
}

/**
 * Global integrity-aware buffer pool instance
 */
let globalIntegrityBufferPool: IntegrityAwareDynamicBufferPool | null = null;

/**
 * Get or create global integrity-aware buffer pool
 */
export function getGlobalIntegrityBufferPool(config?: any): IntegrityAwareDynamicBufferPool {
  if (!globalIntegrityBufferPool) {
    globalIntegrityBufferPool = new IntegrityAwareDynamicBufferPool(config);
    
    secureLog('info', 'Global integrity-aware buffer pool initialized', {
      integrityValidation: 'enabled',
      memoryMonitoring: 'enabled'
    });
    
    // Graceful shutdown handling
    process.on('exit', () => {
      if (globalIntegrityBufferPool) {
        globalIntegrityBufferPool.shutdown();
      }
    });
  }
  
  return globalIntegrityBufferPool;
}

/**
 * Utility function for creating integrity-aware message processors
 */
export function createIntegrityAwareMessageProcessor(
  options: StreamProcessorOptions = {},
  pool?: IntegrityAwareDynamicBufferPool
): IntegrityAwareMessageStreamProcessor {
  const bufferPool = pool || getGlobalIntegrityBufferPool();
  return new IntegrityAwareMessageStreamProcessor(bufferPool, options);
}
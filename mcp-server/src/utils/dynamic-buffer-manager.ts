/**
 * Dynamic Buffer Manager for CCTelegram MCP Server
 * Task 39.3: Dynamic Buffer Engineer Implementation
 * 
 * Implements Node.js buffer patterns with dynamic allocation, buffer pooling,
 * and memory leak prevention for optimal performance and queue compatibility.
 */

import { EventEmitter } from 'events';
import { Transform, Readable, Writable } from 'stream';
import { promisify } from 'util';
import { secureLog } from '../security.js';

export interface BufferPoolConfig {
  initialPoolSize: number;
  maxPoolSize: number;
  bufferSize: number;
  enableMonitoring: boolean;
  memoryPressureThreshold: number; // MB
  gcInterval: number; // milliseconds
}

export interface BufferStats {
  totalAllocated: number;
  poolSize: number;
  activeBuffers: number;
  memoryPressure: number;
  allocationRate: number;
  hitRate: number;
}

export interface StreamProcessorOptions {
  highWaterMark?: number;
  enableBackpressure?: boolean;
  maxMessageSize?: number;
  compressionEnabled?: boolean;
}

/**
 * Dynamic Buffer Pool for efficient memory management
 */
export class DynamicBufferPool extends EventEmitter {
  private pool: Buffer[] = [];
  private activeBuffers: Set<Buffer> = new Set();
  private config: BufferPoolConfig;
  private stats: BufferStats;
  private gcTimer: NodeJS.Timeout | null = null;
  private lastCleanup: number = Date.now();

  constructor(config: Partial<BufferPoolConfig> = {}) {
    super();
    
    this.config = {
      initialPoolSize: 10,
      maxPoolSize: 100,
      bufferSize: 16384, // 16KB default
      enableMonitoring: true,
      memoryPressureThreshold: 100, // 100MB
      gcInterval: 30000, // 30 seconds
      ...config
    };

    this.stats = {
      totalAllocated: 0,
      poolSize: 0,
      activeBuffers: 0,
      memoryPressure: 0,
      allocationRate: 0,
      hitRate: 0
    };

    this.initializePool();
    this.startMonitoring();
  }

  private initializePool(): void {
    // Pre-allocate initial pool
    for (let i = 0; i < this.config.initialPoolSize; i++) {
      const buffer = Buffer.allocUnsafe(this.config.bufferSize);
      buffer.fill(0); // Zero out for security
      this.pool.push(buffer);
    }
    
    this.stats.poolSize = this.pool.length;
    this.stats.totalAllocated = this.pool.length * this.config.bufferSize;
    
    secureLog('info', 'Dynamic buffer pool initialized', {
      initial_pool_size: this.config.initialPoolSize,
      buffer_size: this.config.bufferSize,
      total_allocated_kb: Math.round(this.stats.totalAllocated / 1024)
    });
  }

  /**
   * Acquire a buffer from the pool or create new one
   */
  acquire(size?: number): Buffer {
    const requestedSize = size || this.config.bufferSize;
    let buffer: Buffer;

    // Try to reuse from pool if size matches
    if (requestedSize === this.config.bufferSize && this.pool.length > 0) {
      buffer = this.pool.pop()!;
      this.stats.hitRate = (this.stats.hitRate + 1) / 2; // Rolling average
      
      secureLog('debug', 'Buffer acquired from pool', {
        pool_size_remaining: this.pool.length,
        buffer_size: requestedSize
      });
    } else {
      // Create new buffer with optimal allocation
      if (requestedSize <= 64 * 1024) {
        // Use allocUnsafe for performance-critical small buffers
        buffer = Buffer.allocUnsafe(requestedSize);
        buffer.fill(0); // Zero out for security
      } else {
        // Use alloc for large buffers to avoid security issues
        buffer = Buffer.alloc(requestedSize);
      }
      
      this.stats.allocationRate = (this.stats.allocationRate + 1) / 2; // Rolling average
      this.stats.totalAllocated += requestedSize;
      
      secureLog('debug', 'New buffer allocated', {
        size: requestedSize,
        total_allocated_kb: Math.round(this.stats.totalAllocated / 1024)
      });
    }

    this.activeBuffers.add(buffer);
    this.stats.activeBuffers = this.activeBuffers.size;
    
    // Check memory pressure
    this.checkMemoryPressure();
    
    return buffer;
  }

  /**
   * Release buffer back to pool
   */
  release(buffer: Buffer): void {
    if (!this.activeBuffers.has(buffer)) {
      secureLog('warn', 'Attempted to release buffer not managed by pool');
      return;
    }

    this.activeBuffers.delete(buffer);
    this.stats.activeBuffers = this.activeBuffers.size;

    // Return to pool if it matches standard size and pool isn't full
    if (buffer.length === this.config.bufferSize && 
        this.pool.length < this.config.maxPoolSize) {
      
      // Clear buffer for security before returning to pool
      buffer.fill(0);
      this.pool.push(buffer);
      this.stats.poolSize = this.pool.length;
      
      secureLog('debug', 'Buffer returned to pool', {
        pool_size: this.pool.length,
        active_buffers: this.stats.activeBuffers
      });
    } else {
      // Buffer doesn't match pool criteria, let it be GC'd
      this.stats.totalAllocated -= buffer.length;
      
      secureLog('debug', 'Buffer released for garbage collection', {
        buffer_size: buffer.length,
        reason: buffer.length !== this.config.bufferSize ? 'size_mismatch' : 'pool_full'
      });
    }
  }

  /**
   * Create dynamic buffer that grows as needed
   */
  createDynamicBuffer(initialSize: number = 1024): DynamicBuffer {
    return new DynamicBuffer(initialSize, this);
  }

  /**
   * Concatenate multiple buffers efficiently
   */
  concat(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) {
      return Buffer.alloc(0);
    }
    
    if (buffers.length === 1) {
      return buffers[0];
    }

    // Calculate total size
    const totalSize = buffers.reduce((sum, buf) => sum + buf.length, 0);
    
    // Acquire appropriately sized buffer
    const result = this.acquire(totalSize);
    
    // Copy data efficiently
    let offset = 0;
    for (const buffer of buffers) {
      buffer.copy(result, offset);
      offset += buffer.length;
    }

    return result.subarray(0, totalSize);
  }

  private checkMemoryPressure(): void {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / (1024 * 1024);
    
    this.stats.memoryPressure = heapUsedMB;
    
    if (heapUsedMB > this.config.memoryPressureThreshold) {
      secureLog('warn', 'Memory pressure detected', {
        heap_used_mb: Math.round(heapUsedMB),
        threshold_mb: this.config.memoryPressureThreshold,
        pool_size: this.pool.length,
        active_buffers: this.stats.activeBuffers
      });
      
      this.emit('memoryPressure', {
        heapUsedMB,
        threshold: this.config.memoryPressureThreshold
      });
      
      // Trigger aggressive cleanup
      this.performCleanup(true);
    }
  }

  private startMonitoring(): void {
    if (!this.config.enableMonitoring) return;
    
    this.gcTimer = setInterval(() => {
      this.performCleanup(false);
      
      if (this.listenerCount('stats') > 0) {
        this.emit('stats', { ...this.stats });
      }
      
      secureLog('debug', 'Buffer pool stats', this.stats);
    }, this.config.gcInterval);
  }

  private performCleanup(aggressive: boolean = false): void {
    const beforeSize = this.pool.length;
    const targetSize = aggressive ? 
      Math.max(this.config.initialPoolSize, Math.floor(this.pool.length * 0.5)) :
      Math.max(this.config.initialPoolSize, this.pool.length - 10);

    // Reduce pool size if needed
    while (this.pool.length > targetSize) {
      const buffer = this.pool.pop()!;
      this.stats.totalAllocated -= buffer.length;
    }

    this.stats.poolSize = this.pool.length;
    
    if (beforeSize > this.pool.length) {
      secureLog('info', 'Buffer pool cleanup completed', {
        before_size: beforeSize,
        after_size: this.pool.length,
        freed_buffers: beforeSize - this.pool.length,
        aggressive
      });
    }

    // Force garbage collection if available and under pressure
    if (aggressive && global.gc) {
      global.gc();
      secureLog('info', 'Manual garbage collection triggered');
    }
    
    this.lastCleanup = Date.now();
  }

  /**
   * Get current statistics
   */
  getStats(): BufferStats {
    return { ...this.stats };
  }

  /**
   * Shutdown the buffer pool
   */
  shutdown(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    
    // Release all pooled buffers
    this.pool.length = 0;
    this.activeBuffers.clear();
    
    this.stats.poolSize = 0;
    this.stats.activeBuffers = 0;
    this.stats.totalAllocated = 0;
    
    secureLog('info', 'Dynamic buffer pool shutdown completed');
  }
}

/**
 * Dynamic Buffer that grows as needed
 */
export class DynamicBuffer {
  private buffer: Buffer;
  private position: number = 0;
  private pool: DynamicBufferPool;

  constructor(initialSize: number, pool: DynamicBufferPool) {
    this.buffer = pool.acquire(initialSize);
    this.pool = pool;
  }

  /**
   * Write data to buffer, growing if necessary
   */
  write(data: Buffer | string, encoding?: BufferEncoding): number {
    const writeBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
    const requiredSize = this.position + writeBuffer.length;

    // Grow buffer if needed
    if (requiredSize > this.buffer.length) {
      this.grow(requiredSize);
    }

    const written = writeBuffer.copy(this.buffer, this.position);
    this.position += written;
    return written;
  }

  /**
   * Read data from buffer
   */
  read(size?: number): Buffer {
    const readSize = Math.min(size || this.position, this.position);
    const result = this.buffer.subarray(0, readSize);
    return result;
  }

  /**
   * Get current content as buffer
   */
  toBuffer(): Buffer {
    return this.buffer.subarray(0, this.position);
  }

  /**
   * Reset buffer position
   */
  reset(): void {
    this.position = 0;
    this.buffer.fill(0);
  }

  private grow(newSize: number): void {
    // Calculate optimal new size (power of 2 growth)
    let targetSize = this.buffer.length;
    while (targetSize < newSize) {
      targetSize *= 2;
    }

    // Acquire new buffer and copy data
    const newBuffer = this.pool.acquire(targetSize);
    this.buffer.copy(newBuffer, 0, 0, this.position);
    
    // Release old buffer
    this.pool.release(this.buffer);
    this.buffer = newBuffer;
    
    secureLog('debug', 'Dynamic buffer grown', {
      old_size: this.buffer.length / 2,
      new_size: targetSize,
      utilization: Math.round(this.position / targetSize * 100) + '%'
    });
  }

  /**
   * Release buffer back to pool
   */
  release(): void {
    this.pool.release(this.buffer);
  }
}

/**
 * Stream processor for large message handling with backpressure
 */
export class MessageStreamProcessor extends Transform {
  private bufferPool: DynamicBufferPool;
  private options: StreamProcessorOptions;
  private currentBuffer: DynamicBuffer;
  private messageCount: number = 0;

  constructor(bufferPool: DynamicBufferPool, options: StreamProcessorOptions = {}) {
    const streamOptions = {
      highWaterMark: options.highWaterMark || 16384,
      objectMode: false
    };
    
    super(streamOptions);
    
    this.bufferPool = bufferPool;
    this.options = {
      enableBackpressure: true,
      maxMessageSize: 1024 * 1024, // 1MB default
      compressionEnabled: false,
      ...options
    };
    
    this.currentBuffer = this.bufferPool.createDynamicBuffer(1024);
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: Function): void {
    try {
      // Check message size limits
      if (this.options.maxMessageSize && 
          (this.currentBuffer.toBuffer().length + chunk.length) > this.options.maxMessageSize) {
        
        secureLog('warn', 'Message size exceeds limit', {
          current_size: this.currentBuffer.toBuffer().length,
          chunk_size: chunk.length,
          limit: this.options.maxMessageSize
        });
        
        return callback(new Error('Message size exceeds maximum allowed size'));
      }

      // Write chunk to current buffer
      this.currentBuffer.write(chunk);
      
      // Process complete messages (assuming newline-delimited)
      const content = this.currentBuffer.toBuffer().toString();
      const messages = content.split('\n');
      
      if (messages.length > 1) {
        // Process all complete messages
        for (let i = 0; i < messages.length - 1; i++) {
          const message = messages[i];
          if (message.trim()) {
            this.processMessage(message);
          }
        }
        
        // Keep incomplete message in buffer
        this.currentBuffer.reset();
        if (messages[messages.length - 1]) {
          this.currentBuffer.write(messages[messages.length - 1]);
        }
      }
      
      callback();
      
    } catch (error) {
      secureLog('error', 'Stream processing error', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        message_count: this.messageCount
      });
      
      callback(error);
    }
  }

  _flush(callback: Function): void {
    try {
      // Process any remaining data
      const remaining = this.currentBuffer.toBuffer().toString().trim();
      if (remaining) {
        this.processMessage(remaining);
      }
      
      // Clean up
      this.currentBuffer.release();
      
      secureLog('info', 'Message stream processing completed', {
        total_messages: this.messageCount
      });
      
      callback();
      
    } catch (error) {
      callback(error);
    }
  }

  private processMessage(message: string): void {
    this.messageCount++;
    
    try {
      // Parse and validate message
      const parsed = JSON.parse(message);
      
      // Create optimized buffer for output
      const outputBuffer = this.bufferPool.acquire();
      const output = JSON.stringify(parsed);
      
      outputBuffer.write(output, 'utf8');
      this.push(outputBuffer.subarray(0, Buffer.byteLength(output)));
      
      // Release buffer
      this.bufferPool.release(outputBuffer);
      
    } catch (parseError) {
      secureLog('warn', 'Failed to parse message', {
        message_preview: message.substring(0, 100),
        error: parseError instanceof Error ? parseError.message : 'Unknown error'
      });
      
      // Forward raw message if parsing fails
      this.push(Buffer.from(message + '\n'));
    }
  }
}

/**
 * Create optimized readable stream from data
 */
export function createOptimizedReadableStream(
  data: Buffer | string,
  bufferPool: DynamicBufferPool,
  options: StreamProcessorOptions = {}
): Readable {
  
  const sourceBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let position = 0;
  
  return new Readable({
    highWaterMark: options.highWaterMark || 16384,
    
    read(size: number) {
      if (position >= sourceBuffer.length) {
        this.push(null); // End of stream
        return;
      }
      
      const chunkSize = Math.min(size, sourceBuffer.length - position);
      const chunk = bufferPool.acquire(chunkSize);
      
      sourceBuffer.copy(chunk, 0, position, position + chunkSize);
      position += chunkSize;
      
      this.push(chunk.subarray(0, chunkSize));
      
      // Release buffer after use
      setImmediate(() => bufferPool.release(chunk));
    }
  });
}

/**
 * Global buffer pool instance
 */
let globalBufferPool: DynamicBufferPool | null = null;

/**
 * Get or create global buffer pool
 */
export function getGlobalBufferPool(config?: Partial<BufferPoolConfig>): DynamicBufferPool {
  if (!globalBufferPool) {
    globalBufferPool = new DynamicBufferPool(config);
    
    // Graceful shutdown handling
    process.on('exit', () => {
      if (globalBufferPool) {
        globalBufferPool.shutdown();
      }
    });
    
    process.on('SIGINT', () => {
      if (globalBufferPool) {
        globalBufferPool.shutdown();
      }
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      if (globalBufferPool) {
        globalBufferPool.shutdown();
      }
      process.exit(0);
    });
  }
  
  return globalBufferPool;
}

/**
 * Utility function for safe buffer operations
 */
export function safeBufferConcat(buffers: Buffer[], pool?: DynamicBufferPool): Buffer {
  const bufferPool = pool || getGlobalBufferPool();
  return bufferPool.concat(buffers);
}

/**
 * Utility function for creating message processor streams
 */
export function createMessageProcessor(
  options: StreamProcessorOptions = {},
  pool?: DynamicBufferPool
): MessageStreamProcessor {
  const bufferPool = pool || getGlobalBufferPool();
  return new MessageStreamProcessor(bufferPool, options);
}
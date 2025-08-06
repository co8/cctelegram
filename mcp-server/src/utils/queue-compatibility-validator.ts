/**
 * Queue Compatibility Validator for Task 39.3
 * Ensures dynamic buffer changes maintain compatibility with existing queue system
 */

import { CCTelegramEvent } from '../types.js';
import { getGlobalBufferPool, safeBufferConcat } from './dynamic-buffer-manager.js';
import { secureLog } from '../security.js';

export interface QueueMessage {
  id: string;
  type: string;
  payload: CCTelegramEvent;
  timestamp: string;
  priority: number;
  retry_count: number;
  max_retries: number;
}

export interface ValidationResult {
  isCompatible: boolean;
  serializedSize: number;
  deserializedCorrectly: boolean;
  bufferEfficient: boolean;
  errors: string[];
  recommendations: string[];
}

export class QueueCompatibilityValidator {
  private bufferPool = getGlobalBufferPool();
  
  /**
   * Validate that a message can be properly serialized/deserialized 
   * with dynamic buffer management
   */
  async validateQueueMessage(event: CCTelegramEvent): Promise<ValidationResult> {
    const errors: string[] = [];
    const recommendations: string[] = [];
    let serializedSize = 0;
    let deserializedCorrectly = false;
    let bufferEfficient = false;
    
    try {
      // Create queue message structure
      const queueMessage: QueueMessage = {
        id: event.task_id || 'test-message',
        type: event.type,
        payload: event,
        timestamp: event.timestamp || new Date().toISOString(),
        priority: 1,
        retry_count: 0,
        max_retries: 3
      };
      
      // Test serialization with dynamic buffer
      const originalJson = JSON.stringify(queueMessage);
      serializedSize = Buffer.byteLength(originalJson, 'utf8');
      
      // Test buffer pool allocation for the message
      const buffer = this.bufferPool.acquire(serializedSize);
      buffer.write(originalJson, 'utf8');
      
      // Extract data from buffer
      const extractedJson = buffer.toString('utf8', 0, serializedSize);
      
      // Test deserialization
      const deserializedMessage = JSON.parse(extractedJson) as QueueMessage;
      
      // Validate structure integrity
      const structureValid = this.validateMessageStructure(queueMessage, deserializedMessage);
      if (structureValid) {
        deserializedCorrectly = true;
      } else {
        errors.push('Message structure integrity compromised during buffer operations');
      }
      
      // Check buffer efficiency
      const poolStats = this.bufferPool.getStats();
      bufferEfficient = poolStats.hitRate > 0.5 || serializedSize > 1024;
      
      if (!bufferEfficient) {
        recommendations.push(`Message size (${serializedSize} bytes) may benefit from buffer pooling optimization`);
      }
      
      // Release buffer
      this.bufferPool.release(buffer);
      
      // Additional compatibility checks
      this.validateEventFieldLimits(event, errors, recommendations);
      this.validateSerializationSafety(queueMessage, errors, recommendations);
      
      secureLog('debug', 'Queue compatibility validation completed', {
        event_type: event.type,
        serialized_size: serializedSize,
        buffer_efficient: bufferEfficient,
        errors_count: errors.length,
        recommendations_count: recommendations.length
      });
      
    } catch (error) {
      errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      secureLog('error', 'Queue compatibility validation error', {
        event_type: event.type,
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    
    return {
      isCompatible: errors.length === 0,
      serializedSize,
      deserializedCorrectly,
      bufferEfficient,
      errors,
      recommendations
    };
  }
  
  /**
   * Validate multiple messages for batch compatibility
   */
  async validateMessageBatch(events: CCTelegramEvent[]): Promise<{
    overallCompatible: boolean;
    individual: ValidationResult[];
    batchStats: {
      totalSize: number;
      averageSize: number;
      maxSize: number;
      minSize: number;
      bufferPoolEfficiency: number;
    };
  }> {
    const individual: ValidationResult[] = [];
    let totalSize = 0;
    let maxSize = 0;
    let minSize = Number.MAX_SAFE_INTEGER;
    
    const poolStatsBefore = this.bufferPool.getStats();
    
    for (const event of events) {
      const result = await this.validateQueueMessage(event);
      individual.push(result);
      
      totalSize += result.serializedSize;
      maxSize = Math.max(maxSize, result.serializedSize);
      minSize = Math.min(minSize, result.serializedSize);
    }
    
    const poolStatsAfter = this.bufferPool.getStats();
    const bufferPoolEfficiency = poolStatsAfter.hitRate;
    
    const overallCompatible = individual.every(result => result.isCompatible);
    
    const batchStats = {
      totalSize,
      averageSize: totalSize / events.length,
      maxSize: maxSize === 0 ? 0 : maxSize,
      minSize: minSize === Number.MAX_SAFE_INTEGER ? 0 : minSize,
      bufferPoolEfficiency
    };
    
    secureLog('info', 'Batch queue compatibility validation completed', {
      message_count: events.length,
      overall_compatible: overallCompatible,
      batch_stats: batchStats
    });
    
    return {
      overallCompatible,
      individual,
      batchStats
    };
  }
  
  /**
   * Test message serialization with different buffer strategies
   */
  async testBufferStrategies(event: CCTelegramEvent): Promise<{
    standard: { time: number; size: number };
    buffered: { time: number; size: number; poolHitRate: number };
    concatenated: { time: number; size: number };
    recommendation: string;
  }> {
    const message: QueueMessage = {
      id: event.task_id || 'test-message',
      type: event.type,
      payload: event,
      timestamp: event.timestamp || new Date().toISOString(),
      priority: 1,
      retry_count: 0,
      max_retries: 3
    };
    
    // Test standard JSON serialization
    const standardStart = process.hrtime.bigint();
    const standardJson = JSON.stringify(message);
    const standardBuffer = Buffer.from(standardJson, 'utf8');
    const standardEnd = process.hrtime.bigint();
    const standardTime = Number(standardEnd - standardStart) / 1000000; // Convert to ms
    
    // Test buffer pool strategy
    const bufferedStart = process.hrtime.bigint();
    const poolBuffer = this.bufferPool.acquire(standardBuffer.length);
    poolBuffer.write(standardJson, 'utf8');
    const bufferedEnd = process.hrtime.bigint();
    const bufferedTime = Number(bufferedEnd - bufferedStart) / 1000000;
    const poolHitRate = this.bufferPool.getStats().hitRate;
    
    // Test concatenated buffer approach
    const concatStart = process.hrtime.bigint();
    const parts = [
      Buffer.from(`{"id":"${message.id}","type":"${message.type}",`, 'utf8'),
      Buffer.from(`"payload":${JSON.stringify(message.payload)},`, 'utf8'),
      Buffer.from(`"timestamp":"${message.timestamp}","priority":${message.priority},`, 'utf8'),
      Buffer.from(`"retry_count":${message.retry_count},"max_retries":${message.max_retries}}`, 'utf8')
    ];
    const concatenatedBuffer = safeBufferConcat(parts, this.bufferPool);
    const concatEnd = process.hrtime.bigint();
    const concatenatedTime = Number(concatEnd - concatStart) / 1000000;
    
    // Release buffers
    this.bufferPool.release(poolBuffer);
    
    // Determine recommendation
    let recommendation = 'standard';
    if (bufferedTime < standardTime && poolHitRate > 0.3) {
      recommendation = 'buffered';
    } else if (concatenatedTime < standardTime && standardBuffer.length > 2048) {
      recommendation = 'concatenated';
    }
    
    return {
      standard: { time: standardTime, size: standardBuffer.length },
      buffered: { time: bufferedTime, size: poolBuffer.length, poolHitRate },
      concatenated: { time: concatenatedTime, size: concatenatedBuffer.length },
      recommendation
    };
  }
  
  private validateMessageStructure(original: QueueMessage, deserialized: QueueMessage): boolean {
    // Check essential fields
    if (original.id !== deserialized.id) return false;
    if (original.type !== deserialized.type) return false;
    if (original.timestamp !== deserialized.timestamp) return false;
    if (original.priority !== deserialized.priority) return false;
    
    // Deep check payload
    if (!this.deepEqual(original.payload, deserialized.payload)) {
      return false;
    }
    
    return true;
  }
  
  private validateEventFieldLimits(event: CCTelegramEvent, errors: string[], recommendations: string[]): void {
    // Check field size limits based on typical queue constraints
    if (event.title && Buffer.byteLength(event.title, 'utf8') > 256) {
      errors.push('Event title exceeds 256 byte limit');
    }
    
    if (event.description && Buffer.byteLength(event.description, 'utf8') > 4096) {
      errors.push('Event description exceeds 4KB limit');
    }
    
    if (event.task_id && event.task_id.length > 64) {
      errors.push('Task ID exceeds 64 character limit');
    }
    
    // Check data field size
    if (event.data) {
      const dataSize = Buffer.byteLength(JSON.stringify(event.data), 'utf8');
      if (dataSize > 64 * 1024) { // 64KB limit
        errors.push('Event data field exceeds 64KB limit');
      } else if (dataSize > 16 * 1024) { // 16KB warning
        recommendations.push('Event data field is large (>16KB), consider compression');
      }
    }
  }
  
  private validateSerializationSafety(message: QueueMessage, errors: string[], recommendations: string[]): void {
    // Check for potentially problematic characters
    const jsonString = JSON.stringify(message);
    
    // Check for null bytes that could cause issues
    if (jsonString.includes('\0')) {
      errors.push('Message contains null bytes that may cause serialization issues');
    }
    
    // Check for very long strings that might cause buffer issues
    if (jsonString.length > 1024 * 1024) { // 1MB limit
      errors.push('Serialized message exceeds 1MB size limit');
    } else if (jsonString.length > 256 * 1024) { // 256KB warning
      recommendations.push('Serialized message is large (>256KB), consider data optimization');
    }
    
    // Check for circular references (would cause JSON.stringify to fail)
    try {
      JSON.parse(jsonString);
    } catch (error) {
      errors.push('Message contains data that cannot be safely serialized/deserialized');
    }
  }
  
  private deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return obj1 === obj2;
    if (typeof obj1 !== typeof obj2) return false;
    
    if (typeof obj1 !== 'object') return obj1 === obj2;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this.deepEqual(obj1[key], obj2[key])) return false;
    }
    
    return true;
  }
  
  /**
   * Generate compatibility report
   */
  async generateCompatibilityReport(events: CCTelegramEvent[]): Promise<string> {
    const batchResult = await this.validateMessageBatch(events);
    const bufferStats = this.bufferPool.getStats();
    
    let report = '# Queue Compatibility Report\n\n';
    report += `**Generated**: ${new Date().toISOString()}\n`;
    report += `**Messages Tested**: ${events.length}\n`;
    report += `**Overall Compatible**: ${batchResult.overallCompatible ? '✅ Yes' : '❌ No'}\n\n`;
    
    report += '## Batch Statistics\n';
    report += `- Total Size: ${Math.round(batchResult.batchStats.totalSize / 1024 * 100) / 100} KB\n`;
    report += `- Average Size: ${Math.round(batchResult.batchStats.averageSize)} bytes\n`;
    report += `- Size Range: ${batchResult.batchStats.minSize} - ${batchResult.batchStats.maxSize} bytes\n`;
    report += `- Buffer Pool Efficiency: ${Math.round(batchResult.batchStats.bufferPoolEfficiency * 100)}%\n\n`;
    
    report += '## Buffer Pool Statistics\n';
    report += `- Pool Size: ${bufferStats.poolSize}\n`;
    report += `- Active Buffers: ${bufferStats.activeBuffers}\n`;
    report += `- Memory Allocated: ${Math.round(bufferStats.totalAllocated / 1024 * 100) / 100} KB\n`;
    report += `- Hit Rate: ${Math.round(bufferStats.hitRate * 100)}%\n\n`;
    
    // Individual message issues
    const problemMessages = batchResult.individual.filter(result => !result.isCompatible);
    if (problemMessages.length > 0) {
      report += '## Compatibility Issues\n';
      problemMessages.forEach((result, index) => {
        report += `### Message ${index + 1}\n`;
        result.errors.forEach(error => {
          report += `- ❌ ${error}\n`;
        });
        report += '\n';
      });
    }
    
    // Recommendations
    const allRecommendations = batchResult.individual
      .flatMap(result => result.recommendations)
      .filter((rec, index, arr) => arr.indexOf(rec) === index); // Remove duplicates
    
    if (allRecommendations.length > 0) {
      report += '## Recommendations\n';
      allRecommendations.forEach(rec => {
        report += `- 💡 ${rec}\n`;
      });
    }
    
    return report;
  }
}

// Export singleton instance
let validatorInstance: QueueCompatibilityValidator | null = null;

export function getQueueValidator(): QueueCompatibilityValidator {
  if (!validatorInstance) {
    validatorInstance = new QueueCompatibilityValidator();
  }
  return validatorInstance;
}

// Export validation utility functions
export async function validateEvent(event: CCTelegramEvent): Promise<ValidationResult> {
  const validator = getQueueValidator();
  return validator.validateQueueMessage(event);
}

export async function validateEventBatch(events: CCTelegramEvent[]): Promise<boolean> {
  const validator = getQueueValidator();
  const result = await validator.validateMessageBatch(events);
  return result.overallCompatible;
}
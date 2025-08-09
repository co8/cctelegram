/**
 * Test Utilities
 * Common utilities and helpers for testing
 */

import { jest } from '@jest/globals';
import { EventType, CCTelegramEvent } from '../src/types.js';

/**
 * Wait for a specified amount of time
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a mock function that resolves after a delay
 */
export function createDelayedMock<T>(value: T, delayMs = 0): jest.MockedFunction<() => Promise<T>> {
  return jest.fn(async () => {
    if (delayMs > 0) {
      await delay(delayMs);
    }
    return value;
  });
}

/**
 * Generate a valid UUID v4 for testing
 */
export function generateTestUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a valid ISO8601 timestamp for testing
 */
export function generateTestTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * Create a test event with random data
 */
export function createRandomEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
  const eventTypes: EventType[] = [
    'task_completion', 'task_started', 'code_generation', 'performance_alert',
    'build_completed', 'test_suite_run', 'approval_request', 'info_notification'
  ];

  return {
    type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
    source: 'test-source',
    timestamp: generateTestTimestamp(),
    task_id: generateTestUUID(),
    title: `Test Event ${Math.floor(Math.random() * 1000)}`,
    description: `Random test event description ${Math.random().toString(36).substring(7)}`,
    data: {
      status: 'completed',
      test_data: Math.random()
    },
    ...overrides
  };
}

/**
 * Assert that an object has all required security headers
 */
export function expectSecurityHeaders(obj: any): void {
  expect(obj).toHaveProperty('client_id');
  expect(obj).toHaveProperty('authenticated');
  expect(obj).toHaveProperty('timestamp');
  expect(typeof obj.client_id).toBe('string');
  expect(typeof obj.authenticated).toBe('boolean');
  expect(typeof obj.timestamp).toBe('number');
}

/**
 * Measure execution time of an async function
 */
export async function measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
  const startTime = Date.now();
  const result = await fn();
  const timeMs = Date.now() - startTime;
  return { result, timeMs };
}

/**
 * Run a function multiple times and collect results
 */
export async function runMultipleTimes<T>(
  fn: () => Promise<T>, 
  count: number
): Promise<{ results: T[]; errors: Error[]; avgTimeMs: number }> {
  const results: T[] = [];
  const errors: Error[] = [];
  const times: number[] = [];

  for (let i = 0; i < count; i++) {
    try {
      const { result, timeMs } = await measureExecutionTime(fn);
      results.push(result);
      times.push(timeMs);
    } catch (error) {
      errors.push(error as Error);
    }
  }

  const avgTimeMs = times.reduce((sum, time) => sum + time, 0) / times.length;

  return { results, errors, avgTimeMs };
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const result = await condition();
    if (result) {
      return;
    }
    await delay(intervalMs);
  }
  
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Mock console methods and capture output
 */
export function mockConsole(): {
  log: jest.MockedFunction<typeof console.log>;
  error: jest.MockedFunction<typeof console.error>;
  warn: jest.MockedFunction<typeof console.warn>;
  restore: () => void;
} {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const mockLog = jest.fn();
  const mockError = jest.fn();
  const mockWarn = jest.fn();

  console.log = mockLog;
  console.error = mockError;
  console.warn = mockWarn;

  return {
    log: mockLog,
    error: mockError,
    warn: mockWarn,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    }
  };
}

/**
 * Create a mock file system structure
 */
export function createMockFileStructure(): Record<string, string | Record<string, any>> {
  return {
    '/test/events': {},
    '/test/responses': {},
    '/test/events/event1.json': JSON.stringify(createRandomEvent()),
    '/test/events/event2.json': JSON.stringify(createRandomEvent()),
    '/test/responses/response1.json': JSON.stringify({
      id: generateTestUUID(),
      user_id: 123456789,
      message: 'Test response',
      timestamp: generateTestTimestamp()
    }),
    '/test/.env': 'TELEGRAM_BOT_TOKEN=test-token\nTELEGRAM_ALLOWED_USERS=123456789'
  };
}

/**
 * Validate event structure
 */
export function validateEventStructure(event: any): void {
  expect(event).toHaveProperty('type');
  expect(event).toHaveProperty('source');
  expect(event).toHaveProperty('timestamp');
  expect(event).toHaveProperty('task_id');
  expect(event).toHaveProperty('title');
  expect(event).toHaveProperty('description');
  expect(event).toHaveProperty('data');

  expect(typeof event.type).toBe('string');
  expect(typeof event.source).toBe('string');
  expect(typeof event.timestamp).toBe('string');
  expect(typeof event.task_id).toBe('string');
  expect(typeof event.title).toBe('string');
  expect(typeof event.description).toBe('string');
  expect(typeof event.data).toBe('object');

  expect(event.timestamp).toBeValidISO8601();
  expect(event.task_id).toBeValidUUID();
}

/**
 * Create a batch of test data
 */
export function createTestBatch<T>(factory: (index: number) => T, count: number): T[] {
  return Array.from({ length: count }, (_, index) => factory(index));
}

/**
 * Simulate network conditions
 */
export interface NetworkConditions {
  latency: number;
  jitter: number;
  packetLoss: number;
  bandwidth: number; // bytes per second
}

export function simulateNetworkDelay(conditions: Partial<NetworkConditions> = {}): Promise<void> {
  const { latency = 0, jitter = 0, packetLoss = 0 } = conditions;
  
  // Simulate packet loss
  if (packetLoss > 0 && Math.random() < packetLoss) {
    throw new Error('Simulated packet loss');
  }
  
  // Simulate latency with jitter
  const actualLatency = latency + (Math.random() - 0.5) * jitter;
  return delay(Math.max(0, actualLatency));
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
  private metrics: {
    operations: number;
    totalTime: number;
    errors: number;
    startTime: number;
  } = {
    operations: 0,
    totalTime: 0,
    errors: 0,
    startTime: Date.now()
  };

  recordOperation(timeMs: number, success: boolean = true): void {
    this.metrics.operations++;
    this.metrics.totalTime += timeMs;
    if (!success) {
      this.metrics.errors++;
    }
  }

  getStats(): {
    totalOperations: number;
    averageTimeMs: number;
    errorRate: number;
    throughputPerSecond: number;
    totalDurationMs: number;
  } {
    const totalDurationMs = Date.now() - this.metrics.startTime;
    return {
      totalOperations: this.metrics.operations,
      averageTimeMs: this.metrics.operations > 0 ? this.metrics.totalTime / this.metrics.operations : 0,
      errorRate: this.metrics.operations > 0 ? (this.metrics.errors / this.metrics.operations) * 100 : 0,
      throughputPerSecond: (this.metrics.operations / totalDurationMs) * 1000,
      totalDurationMs
    };
  }

  reset(): void {
    this.metrics = {
      operations: 0,
      totalTime: 0,
      errors: 0,
      startTime: Date.now()
    };
  }
}

/**
 * Security testing utilities
 */
export const SecurityTestUtils = {
  createMaliciousPayload: (type: 'xss' | 'sql' | 'path_traversal' | 'oversized'): any => {
    switch (type) {
      case 'xss':
        return '<script>alert("xss")</script>';
      case 'sql':
        return "'; DROP TABLE events; --";
      case 'path_traversal':
        return '../../../etc/passwd';
      case 'oversized':
        return 'A'.repeat(10000);
      default:
        return 'malicious-payload';
    }
  },

  validateNoSecurityVulnerabilities: (input: any): void => {
    const inputString = JSON.stringify(input);
    
    // Check for XSS patterns
    expect(inputString).not.toMatch(/<script/i);
    expect(inputString).not.toMatch(/javascript:/i);
    expect(inputString).not.toMatch(/on\w+=/i);
    
    // Check for SQL injection patterns
    expect(inputString).not.toMatch(/DROP\s+TABLE/i);
    expect(inputString).not.toMatch(/DELETE\s+FROM/i);
    expect(inputString).not.toMatch(/INSERT\s+INTO/i);
    expect(inputString).not.toMatch(/UPDATE\s+\w+\s+SET/i);
    
    // Check for path traversal
    expect(inputString).not.toContain('../');
    expect(inputString).not.toContain('..\\');
  }
};

/**
 * Load testing utilities
 */
export const LoadTestUtils = {
  async runConcurrentOperations<T>(
    operations: (() => Promise<T>)[],
    maxConcurrent = 10
  ): Promise<{ results: T[]; errors: Error[]; totalTimeMs: number }> {
    const startTime = Date.now();
    const results: T[] = [];
    const errors: Error[] = [];

    for (let i = 0; i < operations.length; i += maxConcurrent) {
      const batch = operations.slice(i, i + maxConcurrent);
      const batchResults = await Promise.allSettled(
        batch.map(op => op())
      );

      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          errors.push(result.reason);
        }
      });
    }

    return {
      results,
      errors,
      totalTimeMs: Date.now() - startTime
    };
  },

  createLoadTestScenario(
    operationFactory: (index: number) => () => Promise<any>,
    count: number
  ): (() => Promise<any>)[] {
    return Array.from({ length: count }, (_, index) => operationFactory(index));
  }
};
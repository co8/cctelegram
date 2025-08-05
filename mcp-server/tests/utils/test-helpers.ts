/**
 * Test Helper Utilities
 * Provides common testing utilities and setup/teardown helpers
 */

import { randomUUID } from 'crypto';
import { jest } from '@jest/globals';
import { setupFsMocks, createMockFileSystem, type MockFileSystem } from '../mocks/fs-mock.js';
import { setupHttpMocks, setupBridgeMocks } from '../mocks/http-mock.js';
import { setupProcessMocks, createBridgeProcessScenarios } from '../mocks/process-mock.js';

/**
 * Complete test environment setup
 */
export interface TestEnvironment {
  fsMocks: any;
  mockFs: MockFileSystem;
  httpMocks: any;
  processMocks: any;
  bridgeMocks: any;
  processScenarios: any;
  cleanup: () => void;
}

/**
 * Setup complete test environment
 */
export function setupTestEnvironment(): TestEnvironment {
  // File system mocks
  const mockFs = createMockFileSystem();
  const { fsMocks } = setupFsMocks(mockFs);
  
  // HTTP mocks
  const httpMocks = setupHttpMocks();
  const bridgeMocks = setupBridgeMocks(httpMocks);
  
  // Process mocks
  const processMocks = setupProcessMocks();
  const processScenarios = createBridgeProcessScenarios(processMocks);
  
  // Setup environment variables
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    CC_TELEGRAM_EVENTS_DIR: '/tmp/test-events',
    CC_TELEGRAM_RESPONSES_DIR: '/tmp/test-responses',
    MCP_ENABLE_AUTH: 'false',
    MCP_ENABLE_RATE_LIMIT: 'false',
    MCP_ENABLE_INPUT_VALIDATION: 'true',
    MCP_LOG_LEVEL: 'error'
  };
  
  const cleanup = () => {
    process.env = originalEnv;
    jest.clearAllMocks();
  };
  
  return {
    fsMocks,
    mockFs,
    httpMocks,
    processMocks,
    bridgeMocks,
    processScenarios,
    cleanup
  };
}

/**
 * Generate test data helpers
 */
export const TestData = {
  // Generate valid UUID
  generateUUID: () => randomUUID(),
  
  // Generate timestamp
  generateTimestamp: (offsetMs: number = 0) => new Date(Date.now() + offsetMs).toISOString(),
  
  // Generate user ID
  generateUserId: () => Math.floor(Math.random() * 1000000000),
  
  // Generate file names
  generateEventFileName: (id?: string) => `event-${id ?? randomUUID()}.json`,
  generateResponseFileName: (id?: string) => `response-${id ?? randomUUID()}.json`,
  
  // Generate paths
  generateEventPath: (fileName?: string) => `/tmp/test-events/${fileName ?? TestData.generateEventFileName()}`,
  generateResponsePath: (fileName?: string) => `/tmp/test-responses/${fileName ?? TestData.generateResponseFileName()}`,
  
  // Generate random strings
  generateString: (length: number, chars: string = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') => {
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  },
  
  // Generate test event data
  generateEventData: (overrides: any = {}) => ({
    type: 'info_notification',
    title: 'Test Event',
    description: 'Test event description',
    source: 'claude-code',
    timestamp: TestData.generateTimestamp(),
    ...overrides
  }),
  
  // Generate test response data
  generateResponseData: (overrides: any = {}) => ({
    id: `response-${randomUUID()}`,
    user_id: TestData.generateUserId(),
    message: 'Test response',
    timestamp: TestData.generateTimestamp(),
    ...overrides
  })
};

/**
 * Async test helpers
 */
export const AsyncHelpers = {
  // Wait for a specified time
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Wait for a condition with timeout
  waitFor: async (condition: () => boolean | Promise<boolean>, timeoutMs: number = 5000, intervalMs: number = 100) => {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      const result = await condition();
      if (result) {
        return true;
      }
      await AsyncHelpers.wait(intervalMs);
    }
    
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  },
  
  // Race between promise and timeout
  withTimeout: async <T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(errorMessage ?? `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    
    return Promise.race([promise, timeoutPromise]);
  },
  
  // Retry operation with exponential backoff
  retry: async <T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 100
  ): Promise<T> => {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxAttempts) {
          throw lastError;
        }
        
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await AsyncHelpers.wait(delay);
      }
    }
    
    throw lastError!;
  }
};

/**
 * Validation helpers
 */
export const ValidationHelpers = {
  // Validate UUID format
  isValidUUID: (uuid: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  },
  
  // Validate ISO 8601 timestamp
  isValidISOTimestamp: (timestamp: string): boolean => {
    const date = new Date(timestamp);
    return date.toISOString() === timestamp;
  },
  
  // Validate event type
  isValidEventType: (type: string): boolean => {
    const validTypes = [
      'task_completion', 'task_started', 'task_failed', 'task_progress', 'task_cancelled',
      'code_generation', 'code_analysis', 'code_refactoring', 'code_review', 'code_testing', 'code_deployment',
      'build_completed', 'build_failed', 'test_suite_run', 'lint_check', 'type_check',
      'performance_alert', 'error_occurred', 'system_health',
      'approval_request', 'user_response',
      'info_notification', 'alert_notification', 'progress_update'
    ];
    return validTypes.includes(type);
  },
  
  // Validate file path
  isValidFilePath: (path: string): boolean => {
    return typeof path === 'string' && path.length > 0 && !path.includes('..');
  },
  
  // Validate source pattern
  isValidSource: (source: string): boolean => {
    const sourceRegex = /^[a-zA-Z0-9\-_]+$/;
    return sourceRegex.test(source);
  }
};

/**
 * Error simulation helpers
 */
export const ErrorHelpers = {
  // Create file system errors
  createFsError: (code: string, message: string, path?: string) => {
    const error = new Error(message) as any;
    error.code = code;
    error.errno = -2;
    error.syscall = 'open';
    error.path = path;
    return error;
  },
  
  // Create HTTP errors
  createHttpError: (status: number, message: string, code?: string) => {
    const error = new Error(message) as any;
    error.response = {
      status,
      data: { error: message }
    };
    error.code = code;
    return error;
  },
  
  // Create timeout errors
  createTimeoutError: (message: string = 'Operation timed out') => {
    const error = new Error(message) as any;
    error.code = 'ETIMEDOUT';
    return error;
  },
  
  // Create permission errors
  createPermissionError: (path: string) => {
    return ErrorHelpers.createFsError('EACCES', `EACCES: permission denied, open '${path}'`, path);
  },
  
  // Create disk full errors
  createDiskFullError: (path: string) => {
    return ErrorHelpers.createFsError('ENOSPC', `ENOSPC: no space left on device, write '${path}'`, path);
  }
};

/**
 * Mock reset helpers
 */
export const MockHelpers = {
  // Reset all mocks
  resetAllMocks: () => {
    jest.clearAllMocks();
  },
  
  // Reset specific mock
  resetMock: (mock: jest.MockedFunction<any>) => {
    mock.mockReset();
  },
  
  // Get mock call history
  getMockCalls: (mock: jest.MockedFunction<any>) => {
    return mock.mock.calls;
  },
  
  // Get last mock call
  getLastMockCall: (mock: jest.MockedFunction<any>) => {
    const calls = mock.mock.calls;
    return calls[calls.length - 1] ?? null;
  },
  
  // Check if mock was called with specific arguments
  wasMockCalledWith: (mock: jest.MockedFunction<any>, ...args: any[]) => {
    return mock.mock.calls.some(call => 
      call.length === args.length && 
      call.every((arg, index) => arg === args[index])
    );
  }
};

/**
 * Performance testing helpers
 */
export const PerformanceHelpers = {
  // Measure execution time
  measureTime: async <T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> => {
    const start = performance.now();
    const result = await operation();
    const duration = performance.now() - start;
    return { result, duration };
  },
  
  // Run performance benchmark
  benchmark: async <T>(
    operation: () => Promise<T>,
    iterations: number = 100
  ): Promise<{
    min: number;
    max: number;
    avg: number;
    median: number;
    results: T[];
  }> => {
    const durations: number[] = [];
    const results: T[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const { result, duration } = await PerformanceHelpers.measureTime(operation);
      durations.push(duration);
      results.push(result);
    }
    
    durations.sort((a, b) => a - b);
    
    return {
      min: durations[0],
      max: durations[durations.length - 1],
      avg: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      median: durations[Math.floor(durations.length / 2)],
      results
    };
  }
};
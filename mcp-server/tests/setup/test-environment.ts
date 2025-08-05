/**
 * Test Environment Setup
 * Global test environment configuration and setup
 */

import { jest } from '@jest/globals';
import { setupTestEnvironment, type TestEnvironment } from '../utils/test-helpers.js';

// Global test environment
let globalTestEnv: TestEnvironment;

/**
 * Setup test environment before all tests
 */
export function setupGlobalTestEnvironment() {
  beforeAll(() => {
    // Setup global test environment
    globalTestEnv = setupTestEnvironment();
    
    // Mock console methods to reduce noise in tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    
    // Reset environment variables
    process.env.CC_TELEGRAM_EVENTS_DIR = '/tmp/test-events';
    process.env.CC_TELEGRAM_RESPONSES_DIR = '/tmp/test-responses';
    process.env.MCP_ENABLE_AUTH = 'false';
    process.env.MCP_ENABLE_RATE_LIMIT = 'false';
    process.env.MCP_ENABLE_INPUT_VALIDATION = 'true';
    process.env.MCP_ENABLE_SECURE_LOGGING = 'false';
    process.env.MCP_LOG_LEVEL = 'error';
  });
  
  afterAll(() => {
    // Cleanup global test environment
    if (globalTestEnv) {
      globalTestEnv.cleanup();
    }
    
    // Restore console methods
    jest.restoreAllMocks();
  });
}

/**
 * Get global test environment
 */
export function getGlobalTestEnvironment(): TestEnvironment {
  if (!globalTestEnv) {
    throw new Error('Global test environment not initialized. Call setupGlobalTestEnvironment() first.');
  }
  return globalTestEnv;
}

/**
 * Common test constants
 */
export const TEST_CONSTANTS = {
  VALID_UUID: '550e8400-e29b-41d4-a716-446655440000',
  VALID_USER_ID: 123456789,
  VALID_TIMESTAMP: '2025-08-05T10:00:00.000Z',
  VALID_EVENT_ID: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  
  PATHS: {
    EVENTS_DIR: '/tmp/test-events',
    RESPONSES_DIR: '/tmp/test-responses',
    TEST_EVENT_FILE: '/tmp/test-events/test-event.json',
    TEST_RESPONSE_FILE: '/tmp/test-responses/test-response.json'
  },
  
  TIMEOUTS: {
    SHORT: 1000,    // 1 second
    MEDIUM: 5000,   // 5 seconds
    LONG: 10000     // 10 seconds
  },
  
  LIMITS: {
    MAX_TITLE_LENGTH: 200,
    MAX_DESCRIPTION_LENGTH: 2000,
    MAX_SOURCE_LENGTH: 100,
    MAX_MESSAGE_LENGTH: 1000,
    MAX_FILES_AFFECTED: 50,
    MAX_DURATION_MS: 86400000  // 24 hours
  }
};

/**
 * Common test assertions
 */
export const TestAssertions = {
  // Assert valid event structure
  assertValidEvent: (event: any) => {
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('title');
    expect(event).toHaveProperty('description');
    expect(event).toHaveProperty('source');
    expect(event).toHaveProperty('timestamp');
    
    expect(typeof event.type).toBe('string');
    expect(typeof event.title).toBe('string');
    expect(typeof event.description).toBe('string');
    expect(typeof event.source).toBe('string');
    expect(typeof event.timestamp).toBe('string');
    
    expect(event.title.length).toBeLessThanOrEqual(TEST_CONSTANTS.LIMITS.MAX_TITLE_LENGTH);
    expect(event.description.length).toBeLessThanOrEqual(TEST_CONSTANTS.LIMITS.MAX_DESCRIPTION_LENGTH);
    expect(event.source.length).toBeLessThanOrEqual(TEST_CONSTANTS.LIMITS.MAX_SOURCE_LENGTH);
  },
  
  // Assert valid response structure
  assertValidResponse: (response: any) => {
    expect(response).toHaveProperty('id');
    expect(response).toHaveProperty('user_id');
    expect(response).toHaveProperty('message');
    expect(response).toHaveProperty('timestamp');
    
    expect(typeof response.id).toBe('string');
    expect(typeof response.user_id).toBe('number');
    expect(typeof response.message).toBe('string');
    expect(typeof response.timestamp).toBe('string');
    
    expect(response.user_id).toBeGreaterThan(0);
    expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
  },
  
  // Assert valid bridge status structure
  assertValidBridgeStatus: (status: any) => {
    expect(status).toHaveProperty('success');
    expect(status).toHaveProperty('status');
    expect(status).toHaveProperty('version');
    
    expect(typeof status.success).toBe('boolean');
    expect(typeof status.status).toBe('string');
    expect(typeof status.version).toBe('string');
    
    if (status.success) {
      expect(status).toHaveProperty('uptime');
      expect(typeof status.uptime).toBe('number');
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    }
  },
  
  // Assert valid MCP response structure
  assertValidMcpResponse: (response: any) => {
    expect(response).toHaveProperty('success');
    expect(typeof response.success).toBe('boolean');
    
    if (!response.success) {
      expect(response).toHaveProperty('error');
      expect(typeof response.error).toBe('string');
    }
  },
  
  // Assert file system operations
  assertFileSystemCalls: (fsMocks: any, expectedCalls: { method: string; path?: string; count?: number }[]) => {
    expectedCalls.forEach(({ method, path, count = 1 }) => {
      expect(fsMocks[method]).toHaveBeenCalledTimes(count);
      
      if (path) {
        expect(fsMocks[method]).toHaveBeenCalledWith(
          expect.stringContaining(path),
          expect.anything()
        );
      }
    });
  },
  
  // Assert HTTP requests
  assertHttpCalls: (httpMocks: any, expectedCalls: { method: string; url?: string; count?: number }[]) => {
    expectedCalls.forEach(({ method, url, count = 1 }) => {
      expect(httpMocks[method]).toHaveBeenCalledTimes(count);
      
      if (url) {
        expect(httpMocks[method]).toHaveBeenCalledWith(
          expect.stringContaining(url),
          expect.anything()
        );
      }
    });
  }
};

/**
 * Common test scenarios
 */
export const TestScenarios = {
  // Setup valid file system state
  setupValidFileSystem: (testEnv: TestEnvironment) => {
    const { fsMocks, mockFs } = testEnv;
    
    // Ensure directories exist
    fsMocks.ensureDir.mockResolvedValue(undefined);
    fsMocks.pathExists.mockResolvedValue(true);
    
    // Mock successful file operations
    fsMocks.writeJson.mockResolvedValue(undefined);
    fsMocks.readJson.mockResolvedValue({});
    fsMocks.readdir.mockResolvedValue([]);
    fsMocks.remove.mockResolvedValue(undefined);
    fsMocks.stat.mockResolvedValue({ mtime: new Date() });
  },
  
  // Setup file system errors
  setupFileSystemErrors: (testEnv: TestEnvironment, errorType: 'permission' | 'disk_full' | 'not_found') => {
    const { fsMocks } = testEnv;
    
    switch (errorType) {
      case 'permission':
        fsMocks.writeJson.mockRejectedValue(new Error('EACCES: permission denied'));
        fsMocks.ensureDir.mockRejectedValue(new Error('EACCES: permission denied'));
        break;
        
      case 'disk_full':
        fsMocks.writeJson.mockRejectedValue(new Error('ENOSPC: no space left on device'));
        break;
        
      case 'not_found':
        fsMocks.readJson.mockRejectedValue(new Error('ENOENT: no such file or directory'));
        fsMocks.pathExists.mockResolvedValue(false);
        break;
    }
  },
  
  // Setup healthy bridge
  setupHealthyBridge: (testEnv: TestEnvironment) => {
    testEnv.bridgeMocks.mockHealthyBridge();
  },
  
  // Setup bridge errors
  setupBridgeErrors: (testEnv: TestEnvironment, errorType: 'timeout' | 'connection_refused' | 'not_found') => {
    switch (errorType) {
      case 'timeout':
        testEnv.bridgeMocks.mockTimeoutError();
        break;
        
      case 'connection_refused':
        testEnv.bridgeMocks.mockConnectionRefused();
        break;
        
      case 'not_found':
        testEnv.bridgeMocks.mockNotFound();
        break;
    }
  },
  
  // Setup successful process operations
  setupSuccessfulProcesses: (testEnv: TestEnvironment) => {
    testEnv.processScenarios.bridgeStartSuccess();
    testEnv.processScenarios.bridgeProcessFound();
    testEnv.processScenarios.bridgeStopSuccess();
  },
  
  // Setup process errors
  setupProcessErrors: (testEnv: TestEnvironment, errorType: 'spawn_failed' | 'process_not_found' | 'port_in_use') => {
    switch (errorType) {
      case 'spawn_failed':
        testEnv.processScenarios.bridgeBinaryNotFound();
        break;
        
      case 'process_not_found':
        testEnv.processScenarios.bridgeProcessNotFound();
        break;
        
      case 'port_in_use':
        testEnv.processScenarios.bridgeStartPortInUse();
        break;
    }
  }
};
/**
 * Jest Setup Configuration
 * Global test environment setup and utilities
 */

import { jest } from '@jest/globals';
import '@testing-library/jest-dom';
import fs from 'fs-extra';
import path from 'path';

// Get __dirname equivalent for Jest
const setupDir = __filename ? path.dirname(__filename) : path.join(process.cwd(), 'tests', 'setup');

// Extend Jest matchers
expect.extend({
  toBeValidUUID(received: string) {
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = typeof received === 'string' && uuidV4Regex.test(received);
    
    return {
      message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid UUIDv4`,
      pass
    };
  },
  
  toBeValidISO8601(received: string) {
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    const pass = typeof received === 'string' && iso8601Regex.test(received) && !isNaN(Date.parse(received));
    
    return {
      message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid ISO8601 timestamp`,
      pass
    };
  },
  
  toHaveSecurityHeaders(received: any) {
    const requiredHeaders = ['client_id', 'authenticated', 'timestamp'];
    const hasHeaders = requiredHeaders.every(header => header in received);
    
    return {
      message: () => `expected object ${hasHeaders ? 'not ' : ''}to have security headers: ${requiredHeaders.join(', ')}`,
      pass: hasHeaders
    };
  },

  toMatchEventStructure(received: any) {
    const requiredFields = ['type', 'title', 'description', 'source', 'timestamp'];
    const missingFields = requiredFields.filter(field => !(field in received));
    const pass = missingFields.length === 0;
    
    return {
      message: () =>
        pass
          ? `Expected object not to have event structure`
          : `Expected object to have event structure. Missing fields: ${missingFields.join(', ')}`,
      pass
    };
  },

  toMatchResponseStructure(received: any) {
    const requiredFields = ['id', 'user_id', 'message', 'timestamp'];
    const missingFields = requiredFields.filter(field => !(field in received));
    const pass = missingFields.length === 0;
    
    return {
      message: () =>
        pass
          ? `Expected object not to have response structure`
          : `Expected object to have response structure. Missing fields: ${missingFields.join(', ')}`,
      pass
    };
  },

  toMatchBridgeStatusStructure(received: any) {
    const requiredFields = ['success', 'status', 'version'];
    const missingFields = requiredFields.filter(field => !(field in received));
    const pass = missingFields.length === 0;
    
    return {
      message: () =>
        pass
          ? `Expected object not to have bridge status structure`
          : `Expected object to have bridge status structure. Missing fields: ${missingFields.join(', ')}`,
      pass
    };
  }
});

// Global test configuration
beforeAll(async () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.MCP_ENABLE_AUTH = 'false'; // Disable auth for most tests
  process.env.MCP_ENABLE_RATE_LIMIT = 'false'; // Disable rate limiting for tests
  process.env.MCP_ENABLE_SECURE_LOGGING = 'true';
  process.env.MCP_LOG_LEVEL = 'error'; // Reduce noise in tests
  
  // Set up test directories
  const testDataDir = path.join(setupDir, '..', 'fixtures', 'data');
  process.env.CC_TELEGRAM_EVENTS_DIR = path.join(testDataDir, 'events');
  process.env.CC_TELEGRAM_RESPONSES_DIR = path.join(testDataDir, 'responses');
  
  // Ensure test directories exist
  await fs.ensureDir(process.env.CC_TELEGRAM_EVENTS_DIR);
  await fs.ensureDir(process.env.CC_TELEGRAM_RESPONSES_DIR);
});

// Clean up after each test
afterEach(async () => {
  // Clear test directories
  if (process.env.CC_TELEGRAM_EVENTS_DIR) {
    await fs.emptyDir(process.env.CC_TELEGRAM_EVENTS_DIR);
  }
  if (process.env.CC_TELEGRAM_RESPONSES_DIR) {
    await fs.emptyDir(process.env.CC_TELEGRAM_RESPONSES_DIR);
  }
  
  // Reset all mocks
  jest.clearAllMocks();
});

// Global cleanup
afterAll(async () => {
  // Clean up test directories
  const testDataDir = path.join(setupDir, '..', 'fixtures', 'data');
  if (await fs.pathExists(testDataDir)) {
    await fs.remove(testDataDir);
  }
});

// Console override for test environment
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  // Filter out MCP logging noise in tests unless explicitly needed
  const message = args[0];
  if (typeof message === 'string' && message.includes('[MCP-SECURITY-')) {
    return; // Skip MCP security logs in tests
  }
  originalConsoleError.apply(console, args);
};

// Global error handler for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Mock network calls by default
jest.setTimeout(30000);

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toBeValidISO8601(): R;
      toHaveSecurityHeaders(): R;
      toMatchEventStructure(): R;
      toMatchResponseStructure(): R;
      toMatchBridgeStatusStructure(): R;
    }
  }
}
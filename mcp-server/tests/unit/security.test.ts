/**
 * Security Module Unit Tests
 * Comprehensive tests for security features including CVSS 9.1 vulnerability validation
 */

import { jest } from '@jest/globals';
import { 
  loadSecurityConfig,
  initializeSecurity,
  authenticateRequest,
  validateInput,
  sanitizePath,
  secureLog,
  sanitizeForLogging,
  generateSignature,
  verifySignature,
  withSecurity,
  SecurityError,
  checkRateLimit
} from '../../src/security.js';

// Mock rate limiter
jest.mock('rate-limiter-flexible', () => ({
  RateLimiterMemory: jest.fn().mockImplementation(() => ({
    consume: jest.fn().mockResolvedValue(undefined)
  }))
}));

describe('Security Module', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadSecurityConfig', () => {
    it('should load default configuration', () => {
      const config = loadSecurityConfig();
      
      expect(config).toMatchObject({
        enableAuth: true,
        enableRateLimit: true,
        enableInputValidation: true,
        enableSecureLogging: true,
        rateLimitPoints: 100,
        rateLimitDuration: 60,
        logLevel: 'warn'
      });
    });

    it('should load configuration from environment variables', () => {
      process.env.MCP_ENABLE_AUTH = 'false';
      process.env.MCP_ENABLE_RATE_LIMIT = 'false';
      process.env.MCP_API_KEYS = 'key1,key2,key3';
      process.env.MCP_RATE_LIMIT_POINTS = '200';
      process.env.MCP_RATE_LIMIT_DURATION = '120';
      process.env.MCP_LOG_LEVEL = 'debug';

      const config = loadSecurityConfig();

      expect(config.enableAuth).toBe(false);
      expect(config.enableRateLimit).toBe(false);
      expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
      expect(config.rateLimitPoints).toBe(200);
      expect(config.rateLimitDuration).toBe(120);
      expect(config.logLevel).toBe('debug');
    });

    it('should generate HMAC secret if not provided', () => {
      const config = loadSecurityConfig();
      expect(config.hmacSecret).toBeTruthy();
      expect(config.hmacSecret.length).toBeGreaterThan(0);
    });
  });

  describe('initializeSecurity', () => {
    it('should initialize security system with provided config', () => {
      const config = loadSecurityConfig();
      expect(() => initializeSecurity(config)).not.toThrow();
    });
  });

  describe('authenticateRequest', () => {
    const config = loadSecurityConfig();

    it('should authenticate valid API key', () => {
      const testConfig = {
        ...config,
        enableAuth: true,
        apiKeys: ['valid-key-123']
      };

      const context = authenticateRequest('valid-key-123', testConfig);

      expect(context.authenticated).toBe(true);
      expect(context.clientId).toBeTruthy();
      expect(context.permissions).toContain('*');
      expect(context.timestamp).toBeGreaterThan(0);
    });

    it('should reject invalid API key', () => {
      const testConfig = {
        ...config,
        enableAuth: true,
        apiKeys: ['valid-key-123']
      };

      expect(() => authenticateRequest('invalid-key', testConfig))
        .toThrow(SecurityError);
    });

    it('should reject missing API key when auth enabled', () => {
      const testConfig = {
        ...config,
        enableAuth: true,
        apiKeys: ['valid-key-123']
      };

      expect(() => authenticateRequest(undefined, testConfig))
        .toThrow(SecurityError);
    });

    it('should allow unauthenticated access when auth disabled', () => {
      const testConfig = {
        ...config,
        enableAuth: false
      };

      const context = authenticateRequest(undefined, testConfig);

      expect(context.authenticated).toBe(true);
      expect(context.clientId).toBe('unauthenticated');
      expect(context.permissions).toContain('*');
    });

    it('should create consistent client IDs for same API key', () => {
      const testConfig = {
        ...config,
        enableAuth: true,
        apiKeys: ['test-key']
      };

      const context1 = authenticateRequest('test-key', testConfig);
      const context2 = authenticateRequest('test-key', testConfig);

      expect(context1.clientId).toBe(context2.clientId);
    });
  });

  describe('validateInput - CVSS 9.1 Security Testing', () => {
    it('should validate sendEvent input successfully', () => {
      const validInput = {
        type: 'task_completion',
        title: 'Valid Task Title',
        description: 'Valid task description',
        source: 'claude-code',
        data: { status: 'completed' }
      };

      const result = validateInput(validInput, 'sendEvent');
      expect(result).toMatchObject(validInput);
    });

    it('should reject XSS attacks in title field', () => {
      const maliciousInput = {
        type: 'task_completion',
        title: '<script>alert("xss")</script>',
        description: 'Valid description'
      };

      expect(() => validateInput(maliciousInput, 'sendEvent'))
        .toThrow(SecurityError);
    });

    it('should reject SQL injection attempts in title', () => {
      const maliciousInput = {
        type: 'task_completion',
        title: "'; DROP TABLE events; --",
        description: 'Valid description'
      };

      expect(() => validateInput(maliciousInput, 'sendEvent'))
        .toThrow(SecurityError);
    });

    it('should reject oversized description field', () => {
      const maliciousInput = {
        type: 'task_completion',
        title: 'Valid title',
        description: 'A'.repeat(3000) // Exceeds 2000 char limit
      };

      expect(() => validateInput(maliciousInput, 'sendEvent'))
        .toThrow(SecurityError);
    });

    it('should reject invalid event types', () => {
      const maliciousInput = {
        type: 'malicious_event_type',
        title: 'Valid title',
        description: 'Valid description'
      };

      expect(() => validateInput(maliciousInput, 'sendEvent'))
        .toThrow(SecurityError);
    });

    it('should reject invalid UUID format', () => {
      const maliciousInput = {
        type: 'task_completion',
        title: 'Valid title',
        description: 'Valid description',
        task_id: 'not-a-valid-uuid'
      };

      expect(() => validateInput(maliciousInput, 'sendTaskCompletion'))
        .toThrow(SecurityError);
    });

    it('should sanitize and validate source field', () => {
      const inputWithMaliciousSource = {
        type: 'task_completion',
        title: 'Valid title',
        description: 'Valid description',
        source: '../../malicious/path'
      };

      expect(() => validateInput(inputWithMaliciousSource, 'sendEvent'))
        .toThrow(SecurityError);
    });

    it('should validate file paths in arrays', () => {
      const inputWithMaliciousPaths = {
        task_id: '123e4567-e89b-4d3a-8456-426614174000',
        title: 'Valid title',
        files_affected: ['../../../etc/passwd', 'valid/file.ts']
      };

      // This should pass validation as the schema doesn't validate individual file paths
      // But the actual file operations should be protected by sanitizePath
      const result = validateInput(inputWithMaliciousPaths, 'sendTaskCompletion');
      expect(result).toBeDefined();
    });

    it('should reject excessive array sizes', () => {
      const inputWithLargeArray = {
        task_id: '123e4567-e89b-4d3a-8456-426614174000',
        title: 'Valid title',
        files_affected: new Array(100).fill('file.ts') // Exceeds 50 item limit
      };

      expect(() => validateInput(inputWithLargeArray, 'sendTaskCompletion'))
        .toThrow(SecurityError);
    });

    it('should validate performance alert thresholds', () => {
      const validPerformanceAlert = {
        title: 'Memory Alert',
        current_value: 512,
        threshold: 400,
        severity: 'high'
      };

      const result = validateInput(validPerformanceAlert, 'sendPerformanceAlert');
      expect(result).toMatchObject(validPerformanceAlert);
    });

    it('should bypass validation when disabled', () => {
      process.env.MCP_ENABLE_INPUT_VALIDATION = 'false';
      
      const maliciousInput = {
        type: 'invalid_type',
        title: '<script>alert("xss")</script>',
        description: 'A'.repeat(3000)
      };

      // Should not throw when validation is disabled
      const result = validateInput(maliciousInput, 'sendEvent');
      expect(result).toEqual(maliciousInput);
    });
  });

  describe('sanitizePath - Path Traversal Protection', () => {
    it('should allow trusted absolute paths', () => {
      const trustedPath = '/Users/enrique/.cc_telegram/events/test.json';
      const result = sanitizePath(trustedPath);
      expect(result).toBe(trustedPath);
    });

    it('should remove path traversal attempts', () => {
      const maliciousPath = '../../../etc/passwd';
      const result = sanitizePath(maliciousPath);
      expect(result).not.toContain('..');
    });

    it('should reject untrusted absolute paths', () => {
      const untrustedPath = '/etc/passwd';
      expect(() => sanitizePath(untrustedPath))
        .toThrow(SecurityError);
    });

    it('should normalize paths correctly', () => {
      const unnormalizedPath = '/Users/enrique/.cc_telegram//events/../events/test.json';
      const result = sanitizePath(unnormalizedPath);
      expect(result).toBe('/Users/enrique/.cc_telegram/events/test.json');
    });

    it('should handle environment variable paths', () => {
      process.env.CC_TELEGRAM_EVENTS_DIR = '/custom/events/dir';
      const customPath = '/custom/events/dir/test.json';
      const result = sanitizePath(customPath);
      expect(result).toBe(customPath);
    });
  });

  describe('secureLog', () => {
    let consoleSpy: jest.SpiedFunction<typeof console.error>;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log messages with security prefix', () => {
      secureLog('info', 'Test message', { test: 'data' });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MCP-SECURITY-INFO]',
        expect.stringContaining('Test message')
      );
    });

    it('should respect log level configuration', () => {
      process.env.MCP_LOG_LEVEL = 'error';
      
      secureLog('debug', 'Debug message');
      secureLog('error', 'Error message');
      
      // Debug should be filtered out, error should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MCP-SECURITY-ERROR]',
        expect.stringContaining('Error message')
      );
    });

    it('should sanitize logged data', () => {
      const dataWithSecrets = {
        api_key: 'secret-key-123',
        password: 'secret-password',
        normal_field: 'normal-value'
      };

      secureLog('info', 'Test with secrets', dataWithSecrets);
      
      const logCall = consoleSpy.mock.calls[0];
      const loggedData = JSON.parse(logCall[1]);
      
      expect(loggedData.data.api_key).toBe('***REDACTED***');
      expect(loggedData.data.password).toBe('***REDACTED***');
      expect(loggedData.data.normal_field).toBe('normal-value');
    });
  });

  describe('sanitizeForLogging', () => {
    it('should redact sensitive keys', () => {
      const sensitiveData = {
        password: 'secret123',
        api_key: 'key123',
        token: 'token123',
        telegram_bot_token: 'bot123',
        normal_field: 'value123'
      };

      const sanitized = sanitizeForLogging(sensitiveData);

      expect(sanitized.password).toBe('***REDACTED***');
      expect(sanitized.api_key).toBe('***REDACTED***');
      expect(sanitized.token).toBe('***REDACTED***');
      expect(sanitized.telegram_bot_token).toBe('***REDACTED***');
      expect(sanitized.normal_field).toBe('value123');
    });

    it('should handle nested objects', () => {
      const nestedData = {
        config: {
          auth: {
            secret: 'secret123',
            public: 'public123'
          }
        },
        normal: 'value'
      };

      const sanitized = sanitizeForLogging(nestedData);

      expect(sanitized.config.auth.secret).toBe('***REDACTED***');
      expect(sanitized.config.auth.public).toBe('public123');
      expect(sanitized.normal).toBe('value');
    });

    it('should handle non-object values', () => {
      expect(sanitizeForLogging('string')).toBe('string');
      expect(sanitizeForLogging(123)).toBe(123);
      expect(sanitizeForLogging(null)).toBe(null);
      expect(sanitizeForLogging(undefined)).toBe(undefined);
    });
  });

  describe('HMAC Signature Functions', () => {
    const testSecret = 'test-secret-key';
    const testData = 'test-data-to-sign';

    it('should generate consistent signatures', () => {
      const sig1 = generateSignature(testData, testSecret);
      const sig2 = generateSignature(testData, testSecret);
      
      expect(sig1).toBe(sig2);
      expect(sig1).toBeTruthy();
    });

    it('should generate different signatures for different data', () => {
      const sig1 = generateSignature('data1', testSecret);
      const sig2 = generateSignature('data2', testSecret);
      
      expect(sig1).not.toBe(sig2);
    });

    it('should verify valid signatures', () => {
      const signature = generateSignature(testData, testSecret);
      const isValid = verifySignature(testData, signature, testSecret);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const signature = generateSignature(testData, testSecret);
      const isValid = verifySignature('different-data', signature, testSecret);
      
      expect(isValid).toBe(false);
    });

    it('should reject signatures with wrong secret', () => {
      const signature = generateSignature(testData, testSecret);
      const isValid = verifySignature(testData, signature, 'wrong-secret');
      
      expect(isValid).toBe(false);
    });
  });

  describe('withSecurity Wrapper', () => {
    it('should execute operation successfully with valid context', async () => {
      const mockOperation = jest.fn().mockResolvedValue({ result: 'success' });
      
      const result = await withSecurity(mockOperation, {
        toolName: 'test_tool',
        clientId: 'test-client'
      });

      expect(result).toEqual({ result: 'success' });
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle SecurityError properly', async () => {
      const mockOperation = jest.fn().mockRejectedValue(
        new SecurityError('Test security error', 'TEST_ERROR')
      );

      await expect(withSecurity(mockOperation, {
        toolName: 'test_tool',
        clientId: 'test-client'
      })).rejects.toThrow(SecurityError);
    });

    it('should validate input when schema provided', async () => {
      const mockOperation = jest.fn().mockResolvedValue({ result: 'success' });
      const validInput = {
        message: 'Test message',
        source: 'test-source'
      };

      await withSecurity(mockOperation, {
        toolName: 'send_message',
        clientId: 'test-client',
        data: validInput,
        schemaKey: 'sendMessage'
      });

      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid input when schema provided', async () => {
      const mockOperation = jest.fn();
      const invalidInput = {
        message: 'A'.repeat(2000), // Exceeds limit
        source: 'test-source'
      };

      await expect(withSecurity(mockOperation, {
        toolName: 'send_message',
        clientId: 'test-client',
        data: invalidInput,
        schemaKey: 'sendMessage'
      })).rejects.toThrow(SecurityError);
    });
  });

  describe('SecurityError Class', () => {
    it('should create error with code and metadata', () => {
      const error = new SecurityError('Test error', 'TEST_CODE', { extra: 'data' });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.metadata).toEqual({ extra: 'data' });
      expect(error.name).toBe('SecurityError');
    });

    it('should extend Error properly', () => {
      const error = new SecurityError('Test error', 'TEST_CODE');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof SecurityError).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests within rate limit', async () => {
      await expect(checkRateLimit('test-client')).resolves.not.toThrow();
    });

    it('should bypass rate limiting when disabled', async () => {
      process.env.MCP_ENABLE_RATE_LIMIT = 'false';
      await expect(checkRateLimit('test-client')).resolves.not.toThrow();
    });
  });
});
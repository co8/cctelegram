/**
 * Resilience Framework Integration Tests
 * 
 * Comprehensive tests for the resilience engineering framework including
 * circuit breakers, retry mechanisms, health monitoring, and recovery systems.
 */

import { ResilienceManager } from '../../src/resilience/manager.js';
import { ResilientBridgeClient } from '../../src/resilient-bridge-client.js';
import { createDefaultResilienceConfig } from '../../src/resilience/config.js';
import { 
  BridgeError, 
  NetworkError, 
  createResilienceError 
} from '../../src/resilience/errors/resilience-errors.js';
import { BaseResilienceError } from '../../src/resilience/errors/base-error.js';
import { ChaosEngineer } from '../../src/resilience/testing/chaos-engineer.js';

describe('Resilience Framework Integration', () => {
  let resilienceManager: ResilienceManager;
  let client: ResilientBridgeClient;
  let chaosEngineer: ChaosEngineer;

  beforeEach(async () => {
    // Create test configuration
    const testConfig = {
      ...createDefaultResilienceConfig(),
      environment: 'development' as const,
      health: {
        enabled: false, // Disable for tests to avoid external dependencies
        interval: 5000,
        timeout: 1000,
        failureThreshold: 2,
        recoveryThreshold: 1,
        gracePeriod: 1000,
        endpoints: []
      },
      monitoring: {
        enabled: false, // Disable for tests
        metricsInterval: 1000,
        alertThresholds: {
          errorRate: 0.1,
          responseTime: 1000,
          memoryUsage: 0.8,
          cpuUsage: 0.8
        },
        retention: {
          metrics: 60000,
          events: 300000,
          logs: 180000
        },
        exporters: []
      }
    };

    resilienceManager = new ResilienceManager(testConfig);
    await resilienceManager.initialize();

    client = new ResilientBridgeClient(testConfig);
    chaosEngineer = new ChaosEngineer(testConfig);
  });

  afterEach(async () => {
    if (resilienceManager) {
      await resilienceManager.shutdown();
    }
    if (client) {
      await client.shutdown();
    }
  });

  describe('Error Handling System', () => {
    test('should create appropriate error types from standard errors', () => {
      // Test network error creation
      const connectionError = createResilienceError(
        new Error('Connection refused'), 
        { metadata: { url: 'http://localhost:8080' } }
      );
      expect(connectionError).toBeInstanceOf(BaseResilienceError);
      expect(connectionError.category).toBe('unknown'); // Falls back to unknown for generic errors

      // Test bridge-specific error
      const bridgeError = new BridgeError(
        'Bridge not responding',
        'BRIDGE_TIMEOUT',
        'high'
      );
      expect(bridgeError.code).toBe('BRIDGE_TIMEOUT');
      expect(bridgeError.category).toBe('bridge');
      expect(bridgeError.severity).toBe('high');
      expect(bridgeError.retryable).toBe(true);
    });

    test('should provide recovery strategies based on error type', () => {
      const networkError = new NetworkError(
        'Connection timeout',
        'NETWORK_TIMEOUT',
        'medium'
      );
      expect(networkError.recovery.strategy).toBe('retry');

      const bridgeError = new BridgeError(
        'Bridge crashed',
        'BRIDGE_CRASHED',
        'critical'
      );
      expect(bridgeError.recovery.strategy).toBe('restart');
    });

    test('should track recovery attempts', () => {
      const error = new BridgeError(
        'Test error',
        'TEST_ERROR',
        'medium'
      );

      // Record a recovery attempt
      error.recordRecoveryAttempt('retry', false, 1000, 'First attempt failed');
      
      expect(error.recovery.currentAttempt).toBe(1);
      expect(error.recovery.recoveryHistory).toHaveLength(1);
      expect(error.recovery.recoveryHistory[0].success).toBe(false);
      expect(error.recovery.recoveryHistory[0].strategy).toBe('retry');
    });

    test('should support escalation', () => {
      const error = new BridgeError(
        'Test error',
        'TEST_ERROR',
        'medium'
      );

      const originalStrategy = error.recovery.strategy;
      error.escalate();
      
      expect(error.recovery.escalationLevel).toBe(1);
      expect(error.recovery.strategy).not.toBe(originalStrategy);
    });
  });

  describe('Circuit Breaker Integration', () => {
    test('should execute operations through circuit breaker', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await resilienceManager.execute(operation, {
        operation: 'test_operation',
        component: 'bridge',
        priority: 'normal'
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should handle circuit breaker failures', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Operation failed'));
      
      await expect(
        resilienceManager.execute(operation, {
          operation: 'test_operation',
          component: 'bridge',
          priority: 'normal'
        })
      ).rejects.toThrow('Operation failed');

      expect(operation).toHaveBeenCalled();
    });

    test('should provide circuit breaker statistics', async () => {
      const stats = resilienceManager.getCircuitBreakerStats();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });
  });

  describe('Retry Mechanisms', () => {
    test('should retry failed operations', async () => {
      let attempts = 0;
      const operation = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      const result = await resilienceManager.execute(operation, {
        operation: 'test_retry',
        component: 'bridge',
        priority: 'normal'
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    test('should provide retry statistics', () => {
      const stats = resilienceManager.getRetryStats();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });
  });

  describe('Health Monitoring', () => {
    test('should provide system status', async () => {
      const status = await resilienceManager.getSystemStatus();
      
      expect(status).toHaveProperty('overall');
      expect(status).toHaveProperty('components');
      expect(status).toHaveProperty('metrics');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(status.overall);
    });

    test('should provide detailed health report', async () => {
      const report = await resilienceManager.getHealthReport();
      
      expect(report).toHaveProperty('system');
      expect(report).toHaveProperty('middleware');
      expect(report).toHaveProperty('monitoring');
      expect(report).toHaveProperty('recovery');
    });
  });

  describe('Recovery Management', () => {
    test('should provide recovery history', () => {
      const history = resilienceManager.getRecoveryHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    test('should handle manual recovery triggers', async () => {
      await expect(
        resilienceManager.triggerRecovery(
          'test_component',
          'MANUAL_TEST',
          'Manual recovery test'
        )
      ).resolves.not.toThrow();
    });
  });

  describe('Metrics Collection', () => {
    test('should collect and provide metrics', () => {
      const metrics = resilienceManager.getMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('object');
    });
  });

  describe('Configuration Management', () => {
    test('should allow configuration updates', async () => {
      const newConfig = {
        retry: {
          bridge: {
            enabled: true,
            maxAttempts: 5,
            baseDelay: 2000,
            maxDelay: 20000,
            exponentialBase: 2.0,
            jitterEnabled: true,
            jitterMax: 1000,
            retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
            nonRetryableErrors: ['AUTH_FAILED']
          },
          telegram: {
            enabled: true,
            maxAttempts: 5,
            baseDelay: 2000,
            maxDelay: 30000,
            exponentialBase: 1.5,
            jitterEnabled: true,
            jitterMax: 1000,
            retryableErrors: ['TELEGRAM_RATE_LIMIT'],
            nonRetryableErrors: ['TELEGRAM_INVALID_TOKEN']
          },
          filesystem: {
            enabled: true,
            maxAttempts: 3,
            baseDelay: 500,
            maxDelay: 5000,
            exponentialBase: 2.0,
            jitterEnabled: false,
            jitterMax: 0,
            retryableErrors: ['EMFILE', 'ENFILE'],
            nonRetryableErrors: ['ENOENT', 'EACCES']
          },
          network: {
            enabled: true,
            maxAttempts: 4,
            baseDelay: 1000,
            maxDelay: 15000,
            exponentialBase: 2.0,
            jitterEnabled: true,
            jitterMax: 500,
            retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
            nonRetryableErrors: ['ECONNABORTED', 'ECANCELED']
          }
        }
      };

      await expect(
        resilienceManager.updateConfig(newConfig)
      ).resolves.not.toThrow();

      const currentConfig = resilienceManager.getConfig();
      expect(currentConfig.retry.bridge.maxAttempts).toBe(5);
    });

    test('should validate configuration', () => {
      const config = resilienceManager.getConfig();
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('environment');
      expect(config).toHaveProperty('circuitBreaker');
      expect(config).toHaveProperty('retry');
    });
  });

  describe('Chaos Engineering', () => {
    test('should be available in development environment', () => {
      const chaosEng = resilienceManager.getChaosEngineer();
      expect(chaosEng).toBeInstanceOf(ChaosEngineer);
    });

    test('should respect safety mode', () => {
      chaosEngineer.setSafetyMode(true);
      expect(chaosEngineer.getSafetyMode()).toBe(true);

      chaosEngineer.setSafetyMode(false);
      expect(chaosEngineer.getSafetyMode()).toBe(false);
    });

    test('should provide experiment management', () => {
      const runningExperiments = chaosEngineer.getRunningExperiments();
      expect(Array.isArray(runningExperiments)).toBe(true);

      const history = chaosEngineer.getExperimentHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('Integration with Bridge Client', () => {
    test('should provide resilience status through bridge client', async () => {
      const status = await client.getResilienceStatus();
      expect(status).toHaveProperty('overall');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(status.overall);
    });

    test('should provide health report through bridge client', async () => {
      const report = await client.getResilienceHealthReport();
      expect(report).toHaveProperty('system');
      expect(report).toHaveProperty('middleware');
    });

    test('should provide metrics through bridge client', () => {
      const metrics = client.getResilienceMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('object');
    });
  });

  describe('Performance and Resource Usage', () => {
    test('should have minimal performance overhead', async () => {
      const startTime = process.hrtime.bigint();
      
      // Execute multiple operations
      const operations = Array(100).fill(0).map(async (_, i) => {
        return resilienceManager.execute(
          async () => `result-${i}`,
          {
            operation: `test_operation_${i}`,
            component: 'test',
            priority: 'normal'
          }
        );
      });

      const results = await Promise.all(operations);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;

      expect(results).toHaveLength(100);
      expect(durationMs).toBeLessThan(1000); // Should complete within 1 second
      
      // Check that all operations succeeded
      results.forEach((result, i) => {
        expect(result).toBe(`result-${i}`);
      });
    });

    test('should manage memory usage appropriately', () => {
      const initialMemory = process.memoryUsage();
      
      // Perform operations that might accumulate memory
      const promises = Array(50).fill(0).map(async (_, i) => {
        return resilienceManager.execute(
          async () => Buffer.alloc(1024, i), // 1KB buffer
          {
            operation: `memory_test_${i}`,
            component: 'test',
            priority: 'low'
          }
        );
      });

      return Promise.all(promises).then(() => {
        const finalMemory = process.memoryUsage();
        const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
        
        // Memory increase should be reasonable (less than 10MB for this test)
        expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
      });
    });
  });

  describe('Error Scenarios and Edge Cases', () => {
    test('should handle malformed operations gracefully', async () => {
      await expect(
        resilienceManager.execute(
          null as any,
          {
            operation: 'null_operation',
            component: 'test',
            priority: 'normal'
          }
        )
      ).rejects.toThrow();
    });

    test('should handle operations that throw non-Error objects', async () => {
      await expect(
        resilienceManager.execute(
          async () => {
            throw 'string error';
          },
          {
            operation: 'string_error_operation',
            component: 'test',
            priority: 'normal'
          }
        )
      ).rejects.toThrow();
    });

    test('should handle extremely long-running operations', async () => {
      const longOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
        return 'completed';
      };

      const result = await resilienceManager.execute(longOperation, {
        operation: 'long_operation',
        component: 'test',
        priority: 'low',
        timeout: 500 // 500ms timeout
      });

      expect(result).toBe('completed');
    });

    test('should handle concurrent operations correctly', async () => {
      const concurrentOps = Array(20).fill(0).map(async (_, i) => {
        return resilienceManager.execute(
          async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
            return `concurrent-${i}`;
          },
          {
            operation: `concurrent_op_${i}`,
            component: 'test',
            priority: 'normal'
          }
        );
      });

      const results = await Promise.all(concurrentOps);
      expect(results).toHaveLength(20);
      
      // Verify all operations completed successfully
      results.forEach((result, i) => {
        expect(result).toBe(`concurrent-${i}`);
      });
    });
  });

  describe('System State Management', () => {
    test('should properly initialize and be ready', () => {
      expect(resilienceManager.isReady()).toBe(true);
    });

    test('should handle graceful shutdown', async () => {
      // This is tested in the afterEach cleanup, but we can verify it doesn't throw
      await expect(resilienceManager.shutdown()).resolves.not.toThrow();
    });

    test('should reset state properly', () => {
      expect(() => resilienceManager.reset()).not.toThrow();
    });
  });
});

describe('Resilience Error Classes', () => {
  test('should create bridge errors with proper metadata', () => {
    const error = new BridgeError(
      'Bridge connection failed',
      'BRIDGE_CONNECTION_ERROR',
      'high',
      {
        operation: 'sendEvent',
        component: 'bridge',
        metadata: { endpoint: 'http://localhost:8080' }
      }
    );

    expect(error.name).toBe('BridgeError');
    expect(error.code).toBe('BRIDGE_CONNECTION_ERROR');
    expect(error.category).toBe('bridge');
    expect(error.severity).toBe('high');
    expect(error.retryable).toBe(true);
    expect(error.context.operation).toBe('sendEvent');
    expect(error.context.component).toBe('bridge');
  });

  test('should create network errors with proper recovery strategies', () => {
    const error = new NetworkError(
      'Connection timeout',
      'NETWORK_TIMEOUT',
      'medium',
      {
        operation: 'httpRequest',
        metadata: { url: 'http://example.com', timeout: 5000 }
      }
    );

    expect(error.name).toBe('NetworkError');
    expect(error.code).toBe('NETWORK_TIMEOUT');
    expect(error.category).toBe('network');
    expect(error.recovery.strategy).toBe('retry');
  });

  test('should serialize errors to JSON properly', () => {
    const error = new BridgeError(
      'Test error',
      'TEST_ERROR',
      'medium',
      {
        operation: 'test',
        component: 'bridge',
        correlationId: 'test-123'
      }
    );

    const json = error.toJSON();
    
    expect(json).toHaveProperty('name', 'BridgeError');
    expect(json).toHaveProperty('code', 'TEST_ERROR');
    expect(json).toHaveProperty('category', 'bridge');
    expect(json).toHaveProperty('severity', 'medium');
    expect(json).toHaveProperty('retryable', true);
    expect(json).toHaveProperty('context');
    expect(json.context).toHaveProperty('operation', 'test');
    expect(json.context).toHaveProperty('correlationId', 'test-123');
  });

  test('should provide error summaries', () => {
    const error = new NetworkError(
      'Connection failed',
      'NETWORK_CONNECTION_FAILED',
      'high'
    );

    const summary = error.getSummary();
    
    expect(summary).toHaveProperty('code', 'NETWORK_CONNECTION_FAILED');
    expect(summary).toHaveProperty('category', 'network');
    expect(summary).toHaveProperty('severity', 'high');
    expect(summary).toHaveProperty('retryable', true);
    expect(summary).toHaveProperty('recovery');
    expect(summary.recovery).toHaveProperty('strategy');
  });
});

describe('Error Factory', () => {
  test('should create appropriate errors from Node.js errors', () => {
    // Test ECONNREFUSED
    const connRefusedError = createResilienceError(
      Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' }),
      { metadata: { url: 'http://localhost:8080' } }
    );
    expect(connRefusedError.code).toBe('ECONNREFUSED');
    expect(connRefusedError.category).toBe('network');

    // Test ETIMEDOUT
    const timeoutError = createResilienceError(
      Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }),
      { metadata: { url: 'http://localhost:8080', timeout: 5000 } }
    );
    expect(timeoutError.code).toBe('ETIMEDOUT');
    expect(timeoutError.category).toBe('network');

    // Test filesystem errors
    const noentError = createResilienceError(
      Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      { metadata: { path: '/some/path' } }
    );
    expect(noentError.code).toBe('ENOENT');
    expect(noentError.category).toBe('filesystem');
  });

  test('should infer error types from messages', () => {
    const timeoutError = createResilienceError(
      new Error('Operation timeout after 5000ms'),
      { operation: 'test', metadata: { timeout: 5000 } }
    );
    expect(timeoutError.category).toBe('timeout');

    const permissionError = createResilienceError(
      new Error('Permission denied to access file'),
      { metadata: { path: '/etc/secure' } }
    );
    expect(permissionError.category).toBe('filesystem');

    const connectionError = createResilienceError(
      new Error('Connection failed to server'),
      { metadata: { url: 'http://server.com' } }
    );
    expect(connectionError.category).toBe('network');
  });
});
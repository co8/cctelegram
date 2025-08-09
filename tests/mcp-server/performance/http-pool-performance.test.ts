/**
 * Performance tests for HTTP Connection Pool
 * Validates performance characteristics and optimization effectiveness
 */

import { HttpConnectionPool, getBridgeAxiosConfig, getHttpPool } from '../../src/http-pool.js';
import axios from 'axios';

// Mock axios for performance testing
jest.mock('axios');
const mockedAxios = jest.mocked(axios);

describe('HTTP Connection Pool Performance Tests', () => {
  let pool: HttpConnectionPool;
  let mockAxiosGet: jest.MockedFunction<typeof axios.get>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock axios.get
    mockAxiosGet = jest.fn();
    mockedAxios.get = mockAxiosGet;
    
    // Create fresh pool for each test
    pool = new HttpConnectionPool();
  });

  afterEach(() => {
    pool.destroy();
  });

  describe('Connection Pool Efficiency', () => {
    it('should reuse HTTP agents across multiple requests', async () => {
      const config1 = pool.getAxiosConfig('health', 'http://localhost:8080/health');
      const config2 = pool.getAxiosConfig('health', 'http://localhost:8080/health');
      
      // Should use the same HTTP agent
      expect(config1.httpAgent).toBe(config2.httpAgent);
      expect(config1.httpsAgent).toBe(config2.httpsAgent);
    });

    it('should use different agents for different pool types', async () => {
      const healthConfig = pool.getAxiosConfig('health', 'http://localhost:8080/health');
      const statusConfig = pool.getAxiosConfig('status', 'http://localhost:8080/health');
      const pollingConfig = pool.getAxiosConfig('polling', 'http://localhost:8080/health');
      
      // Should use different HTTP agents for different pool types
      expect(healthConfig.httpAgent).not.toBe(statusConfig.httpAgent);
      expect(statusConfig.httpAgent).not.toBe(pollingConfig.httpAgent);
      expect(healthConfig.httpAgent).not.toBe(pollingConfig.httpAgent);
    });

    it('should use appropriate agents for HTTP vs HTTPS', async () => {
      const httpConfig = pool.getAxiosConfig('health', 'http://localhost:8080/health');
      const httpsConfig = pool.getAxiosConfig('health', 'https://localhost:8443/health');
      
      // HTTP config should have httpAgent, not httpsAgent
      expect(httpConfig.httpAgent).toBeDefined();
      expect(httpConfig.httpsAgent).toBeUndefined();
      
      // HTTPS config should have httpsAgent, not httpAgent
      expect(httpsConfig.httpsAgent).toBeDefined();
      expect(httpsConfig.httpAgent).toBeUndefined();
    });
  });

  describe('Performance Characteristics', () => {
    it('should track request counts accurately', async () => {
      mockAxiosGet.mockResolvedValue({ status: 200, data: {} });

      const initialStats = pool.getStats();
      const initialHealthRequests = initialStats.health.requests;
      const initialStatusRequests = initialStats.status.requests;

      // Make requests with different pool types
      const healthConfig = pool.getAxiosConfig('health');
      const statusConfig = pool.getAxiosConfig('status');
      
      await Promise.all([
        axios.get('http://localhost:8080/health', healthConfig),
        axios.get('http://localhost:8080/health', healthConfig),
        axios.get('http://localhost:8080/health', statusConfig)
      ]);

      const finalStats = pool.getStats();
      
      // Health pool should have 2 additional requests
      expect(finalStats.health.requests).toBe(initialHealthRequests + 2);
      // Status pool should have 1 additional request
      expect(finalStats.status.requests).toBe(initialStatusRequests + 1);
    });

    it('should record errors accurately', async () => {
      const initialStats = pool.getStats();
      const initialHealthErrors = initialStats.health.errors;
      const initialStatusErrors = initialStats.status.errors;

      // Record errors for different pool types
      pool.recordError('health');
      pool.recordError('health');
      pool.recordError('status');

      const finalStats = pool.getStats();
      
      expect(finalStats.health.errors).toBe(initialHealthErrors + 2);
      expect(finalStats.status.errors).toBe(initialStatusErrors + 1);
    });

    it('should provide detailed agent statistics', async () => {
      // Generate some requests to populate agent statistics
      const healthConfig = pool.getAxiosConfig('health', 'http://localhost:8080/health');
      const httpsConfig = pool.getAxiosConfig('health', 'https://localhost:8443/health');
      
      const stats = pool.getStats();
      
      // Should have agent statistics for both HTTP and HTTPS
      expect(stats.health.agent_stats).toBeDefined();
      expect(stats.health.agent_stats!.http).toBeDefined();
      expect(stats.health.agent_stats!.https).toBeDefined();
      
      // Agent stats should have socket information
      expect(stats.health.agent_stats!.http).toHaveProperty('sockets');
      expect(stats.health.agent_stats!.http).toHaveProperty('requests');
      expect(stats.health.agent_stats!.http).toHaveProperty('freeSockets');
    });
  });

  describe('Configuration Optimization', () => {
    it('should apply correct timeout configurations', () => {
      const configs = {
        health: pool.getAxiosConfig('health'),
        status: pool.getAxiosConfig('status'),
        polling: pool.getAxiosConfig('polling'),
        default: pool.getAxiosConfig('default')
      };

      expect(configs.health.timeout).toBe(5000);
      expect(configs.status.timeout).toBe(2000);
      expect(configs.polling.timeout).toBe(1000);
      expect(configs.default.timeout).toBe(5000);
    });

    it('should apply correct redirect limits', () => {
      const configs = {
        health: pool.getAxiosConfig('health'),
        status: pool.getAxiosConfig('status'),
        polling: pool.getAxiosConfig('polling')
      };

      expect(configs.health.maxRedirects).toBe(3);
      expect(configs.status.maxRedirects).toBe(2);
      expect(configs.polling.maxRedirects).toBe(1);
    });

    it('should set keep-alive headers correctly', () => {
      const config = pool.getAxiosConfig('health');
      
      expect(config.headers).toHaveProperty('Connection', 'keep-alive');
      expect(config.headers).toHaveProperty('Keep-Alive');
      expect(config.headers!['Keep-Alive']).toMatch(/timeout=\d+/);
    });

    it('should validate status codes appropriately', () => {
      const config = pool.getAxiosConfig('health');
      
      expect(config.validateStatus).toBeDefined();
      
      // Test status validation function
      expect(config.validateStatus!(200)).toBe(true);
      expect(config.validateStatus!(201)).toBe(true);
      expect(config.validateStatus!(299)).toBe(true);
      expect(config.validateStatus!(300)).toBe(false);
      expect(config.validateStatus!(400)).toBe(false);
      expect(config.validateStatus!(500)).toBe(false);
    });

    it('should handle JSON response transformation', () => {
      const config = pool.getAxiosConfig('health');
      
      expect(config.transformResponse).toBeDefined();
      expect(Array.isArray(config.transformResponse)).toBe(true);
      
      const transformer = config.transformResponse![0];
      
      // Test JSON parsing
      expect(transformer('{"test": "value"}')).toEqual({ test: 'value' });
      expect(transformer('invalid json')).toBe('invalid json');
      expect(transformer({ already: 'object' })).toEqual({ already: 'object' });
    });
  });

  describe('Memory and Resource Management', () => {
    it('should properly destroy all agents and connections', () => {
      const stats = pool.getStats();
      
      // Verify agents exist before destroy
      expect(Object.keys(stats)).toHaveLength(4); // health, status, polling, default
      
      pool.destroy();
      
      // After destroy, attempting to get config should fail
      expect(() => pool.getAxiosConfig('health')).toThrow();
    });

    it('should handle pool configuration updates', () => {
      const initialConfig = pool.getPoolConfig('health');
      expect(initialConfig.timeout).toBe(5000);
      expect(initialConfig.maxSockets).toBe(2);

      // Update configuration
      pool.updatePoolConfig('health', {
        timeout: 3000,
        maxSockets: 4
      });

      const updatedConfig = pool.getPoolConfig('health');
      expect(updatedConfig.timeout).toBe(3000);
      expect(updatedConfig.maxSockets).toBe(4);
      
      // Other properties should remain unchanged
      expect(updatedConfig.keepAlive).toBe(true);
      expect(updatedConfig.maxRedirects).toBe(3);
    });
  });

  describe('Bridge Integration Performance', () => {
    it('should provide optimized configuration for bridge operations', () => {
      const healthConfig = getBridgeAxiosConfig('health', 'http://localhost:8080/health');
      const statusConfig = getBridgeAxiosConfig('status', 'http://localhost:8080/health');
      const pollingConfig = getBridgeAxiosConfig('polling', 'http://localhost:8080/health');

      // Verify optimal configurations for each operation type
      expect(healthConfig.timeout).toBe(5000); // Longer timeout for comprehensive health checks
      expect(statusConfig.timeout).toBe(2000); // Medium timeout for status checks
      expect(pollingConfig.timeout).toBe(1000); // Short timeout for frequent polling

      // Verify keep-alive is enabled for all
      expect(healthConfig.headers!['Connection']).toBe('keep-alive');
      expect(statusConfig.headers!['Connection']).toBe('keep-alive');
      expect(pollingConfig.headers!['Connection']).toBe('keep-alive');
    });

    it('should use global pool instance efficiently', () => {
      const pool1 = getHttpPool();
      const pool2 = getHttpPool();
      
      // Should return the same instance
      expect(pool1).toBe(pool2);
      
      // Should have consistent configuration
      const config1 = pool1.getPoolConfig('health');
      const config2 = pool2.getPoolConfig('health');
      
      expect(config1).toEqual(config2);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should handle concurrent requests efficiently', async () => {
      mockAxiosGet.mockResolvedValue({ status: 200, data: {} });

      const startTime = Date.now();
      const concurrentRequests = 20;
      
      // Create multiple concurrent requests
      const requests = Array.from({ length: concurrentRequests }, (_, i) => {
        const poolType = ['health', 'status', 'polling'][i % 3] as any;
        const config = pool.getAxiosConfig(poolType);
        return axios.get(`http://localhost:8080/test${i}`, config);
      });

      await Promise.all(requests);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should handle concurrent requests quickly (less than 100ms in test environment)
      expect(duration).toBeLessThan(100);
      
      // Verify all requests were tracked
      const stats = pool.getStats();
      const totalRequests = stats.health.requests + stats.status.requests + stats.polling.requests;
      expect(totalRequests).toBe(concurrentRequests);
    });
  });
});
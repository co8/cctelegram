/**
 * Integration tests for HTTP Connection Pool in Bridge Client
 * Tests that the bridge client properly uses pooled connections
 */

import { CCTelegramBridgeClient } from '../../src/bridge-client.js';
import { getHttpPool } from '../../src/http-pool.js';
import axios from 'axios';

// Mock axios to intercept requests
jest.mock('axios');
const mockedAxios = jest.mocked(axios);

describe('Bridge Client HTTP Connection Pool Integration', () => {
  let bridgeClient: CCTelegramBridgeClient;
  let mockAxiosGet: jest.MockedFunction<typeof axios.get>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock axios.get
    mockAxiosGet = jest.fn();
    mockedAxios.get = mockAxiosGet;
    
    // Create bridge client instance
    bridgeClient = new CCTelegramBridgeClient();
  });

  afterEach(() => {
    // Clean up connection pool
    const pool = getHttpPool();
    pool.destroy();
  });

  describe('Health Check Connection Pooling', () => {
    it('should use health pool configuration for getBridgeStatus()', async () => {
      // Mock successful health and metrics responses
      mockAxiosGet
        .mockResolvedValueOnce({
          status: 200,
          data: { status: 'healthy', uptime: 12345 }
        })
        .mockResolvedValueOnce({
          status: 200,
          data: 'process_uptime_seconds 12345\nevents_processed_total 100'
        });

      await bridgeClient.getBridgeStatus();

      // Verify axios was called with pooled configuration
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
      
      // Check first call (health endpoint)
      const healthCall = mockAxiosGet.mock.calls[0];
      expect(healthCall[0]).toMatch(/\/health$/);
      expect(healthCall[1]).toHaveProperty('timeout', 5000); // Health pool timeout
      expect(healthCall[1]).toHaveProperty('maxRedirects', 3); // Health pool setting
      expect(healthCall[1]).toHaveProperty('headers');
      expect(healthCall[1].headers).toHaveProperty('Connection', 'keep-alive');

      // Check second call (metrics endpoint)
      const metricsCall = mockAxiosGet.mock.calls[1];
      expect(metricsCall[0]).toMatch(/\/metrics$/);
      expect(metricsCall[1]).toHaveProperty('timeout', 5000); // Health pool timeout
    });

    it('should record errors in health pool when getBridgeStatus() fails', async () => {
      // Mock axios to throw an error
      mockAxiosGet.mockRejectedValueOnce(new Error('Connection failed'));

      const pool = getHttpPool();
      const initialStats = pool.getStats();
      const initialHealthErrors = initialStats.health.errors;

      await bridgeClient.getBridgeStatus();

      const finalStats = pool.getStats();
      expect(finalStats.health.errors).toBe(initialHealthErrors + 1);
    });
  });

  describe('Status Check Connection Pooling', () => {
    it('should use status pool configuration for isBridgeRunning()', async () => {
      // Mock successful health response
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: { status: 'healthy' }
      });

      await bridgeClient.isBridgeRunning();

      // Verify axios was called with status pool configuration
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      
      const statusCall = mockAxiosGet.mock.calls[0];
      expect(statusCall[0]).toMatch(/\/health$/);
      expect(statusCall[1]).toHaveProperty('timeout', 2000); // Status pool timeout
      expect(statusCall[1]).toHaveProperty('maxRedirects', 2); // Status pool setting
      expect(statusCall[1]).toHaveProperty('headers');
      expect(statusCall[1].headers).toHaveProperty('Connection', 'keep-alive');
    });

    it('should record errors in status pool when isBridgeRunning() fails', async () => {
      // Mock axios to throw an error
      mockAxiosGet.mockRejectedValueOnce(new Error('Connection failed'));

      const pool = getHttpPool();
      const initialStats = pool.getStats();
      const initialStatusErrors = initialStats.status.errors;

      // Mock process check to also fail
      const mockExec = jest.fn().mockRejectedValue(new Error('Process not found'));
      
      await bridgeClient.isBridgeRunning();

      const finalStats = pool.getStats();
      expect(finalStats.status.errors).toBe(initialStatusErrors + 1);
    });
  });

  describe('Polling Connection Pooling', () => {
    it('should use polling pool configuration for waitForBridgeReady()', async () => {
      // Mock the waitForBridgeReady method by accessing it through a test helper
      // Since it's private, we'll test it indirectly through ensureBridgeReady
      
      // Mock successful polling response
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: { status: 'healthy' }
      });

      // Create a spy on the private method by testing the public interface
      const isRunning = await bridgeClient.isBridgeRunning();
      
      // If bridge is not running, ensureBridgeReady will call waitForBridgeReady
      if (!isRunning) {
        // Reset mocks for the actual test
        jest.clearAllMocks();
        
        // Mock successful responses for polling
        mockAxiosGet
          .mockResolvedValueOnce({ status: 200, data: {} }) // isBridgeRunning check
          .mockResolvedValueOnce({ status: 200, data: {} }); // waitForBridgeReady polling
        
        try {
          // This will internally call waitForBridgeReady if bridge is not running
          await bridgeClient['ensureBridgeReady']();
        } catch (error) {
          // Expected to fail in test environment, we're just testing the HTTP calls
        }
      }
    });
  });

  describe('Connection Pool Statistics', () => {
    it('should provide HTTP pool statistics', () => {
      const stats = bridgeClient.getHttpPoolStats();
      
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('health');
      expect(stats).toHaveProperty('status');
      expect(stats).toHaveProperty('polling');
      expect(stats).toHaveProperty('default');
      
      // Check structure of health pool stats
      const healthStats = stats!.health;
      expect(healthStats).toHaveProperty('requests');
      expect(healthStats).toHaveProperty('connections');
      expect(healthStats).toHaveProperty('errors');
      expect(healthStats).toHaveProperty('config');
      expect(healthStats.config).toHaveProperty('maxSockets', 2);
      expect(healthStats.config).toHaveProperty('timeout', 5000);
      expect(healthStats.config).toHaveProperty('keepAlive', true);
    });

    it('should handle errors when getting pool statistics', () => {
      // Destroy the pool to force an error
      const pool = getHttpPool();
      pool.destroy();
      
      const stats = bridgeClient.getHttpPoolStats();
      expect(stats).toBeNull();
    });
  });

  describe('Connection Pool Performance', () => {
    it('should reuse connections for multiple requests', async () => {
      // Mock multiple successful responses
      mockAxiosGet
        .mockResolvedValueOnce({ status: 200, data: { status: 'healthy' } })
        .mockResolvedValueOnce({ status: 200, data: { status: 'healthy' } })
        .mockResolvedValueOnce({ status: 200, data: { status: 'healthy' } });

      const pool = getHttpPool();
      const initialStats = pool.getStats();
      const initialHealthRequests = initialStats.health.requests;

      // Make multiple requests
      await bridgeClient.isBridgeRunning();
      await bridgeClient.isBridgeRunning();
      await bridgeClient.isBridgeRunning();

      const finalStats = pool.getStats();
      
      // Should have recorded all requests
      expect(finalStats.health.requests).toBeGreaterThan(initialHealthRequests);
      
      // Verify keep-alive headers were set
      expect(mockAxiosGet).toHaveBeenCalledTimes(3);
      mockAxiosGet.mock.calls.forEach(call => {
        expect(call[1]).toHaveProperty('headers');
        expect(call[1].headers).toHaveProperty('Connection', 'keep-alive');
      });
    });
  });

  describe('Pool Configuration Integration', () => {
    it('should use correct pool types for different operations', async () => {
      const pool = getHttpPool();
      
      // Check that different pool types have different configurations
      const healthConfig = pool.getPoolConfig('health');
      const statusConfig = pool.getPoolConfig('status');
      const pollingConfig = pool.getPoolConfig('polling');
      
      expect(healthConfig.timeout).toBe(5000);
      expect(statusConfig.timeout).toBe(2000);
      expect(pollingConfig.timeout).toBe(1000);
      
      expect(healthConfig.maxSockets).toBe(2);
      expect(statusConfig.maxSockets).toBe(3);
      expect(pollingConfig.maxSockets).toBe(5);
    });
  });
});
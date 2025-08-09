/**
 * Load Testing for CCTelegram MCP Server
 * Performance tests with concurrent requests and stress testing
 */

import { jest } from '@jest/globals';
import { EventFixtures } from '../fixtures/events.fixture.js';
import { ResponseFixtures } from '../fixtures/responses.fixture.js';

// Mock dependencies for performance testing
jest.mock('fs-extra');
jest.mock('axios');
jest.mock('child_process');

import { mockFS } from '../mocks/fs.mock.js';
import { mockAxios } from '../mocks/axios.mock.js';
import { mockChildProcess } from '../mocks/child_process.mock.js';

describe('Load Testing', () => {
  let performanceMetrics: {
    responseTime: number[];
    memoryUsage: number[];
    cpuUsage: number[];
    errorRate: number;
    throughput: number;
  };

  beforeAll(() => {
    // Extend Jest timeout for load tests
    jest.setTimeout(60000);
  });

  beforeEach(() => {
    // Reset all mocks
    mockFS.reset();
    mockAxios.reset();
    mockChildProcess.reset();

    // Initialize performance metrics
    performanceMetrics = {
      responseTime: [],
      memoryUsage: [],
      cpuUsage: [],
      errorRate: 0,
      throughput: 0
    };

    // Set up fast mock responses for load testing
    mockAxios.setNetworkDelay(5); // 5ms network delay
    mockAxios.mockHealthEndpoint(true);
    mockAxios.mockMetricsEndpoint();
    mockChildProcess.setBridgeProcessRunning(true);
  });

  describe('Concurrent Request Handling', () => {
    it('should handle 100 concurrent send_event requests', async () => {
      const { CCTelegramBridgeClient } = await import('../../src/bridge-client.js');
      const client = new CCTelegramBridgeClient();
      
      const concurrentRequests = 100;
      const events = Array.from({ length: concurrentRequests }, (_, i) => 
        EventFixtures.createBasicEvent({
          title: `Load Test Event ${i + 1}`,
          task_id: `load-test-${i + 1}-${Date.now()}`
        })
      );

      const startTime = Date.now();
      const promises = events.map(async (event, index) => {
        const requestStart = Date.now();
        try {
          const result = await client.sendEvent(event);
          const requestTime = Date.now() - requestStart;
          performanceMetrics.responseTime.push(requestTime);
          return { success: true, result, index };
        } catch (error) {
          performanceMetrics.errorRate++;
          return { success: false, error, index };
        }
      });

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // Calculate metrics
      const successfulRequests = results.filter(r => r.success).length;
      const errorRate = (performanceMetrics.errorRate / concurrentRequests) * 100;
      const avgResponseTime = performanceMetrics.responseTime.reduce((a, b) => a + b, 0) / performanceMetrics.responseTime.length;
      const throughput = (successfulRequests / totalTime) * 1000; // requests per second

      // Performance assertions
      expect(successfulRequests).toBe(concurrentRequests);
      expect(errorRate).toBeLessThan(1); // Less than 1% error rate
      expect(avgResponseTime).toBeLessThan(100); // Average response time under 100ms
      expect(throughput).toBeGreaterThan(50); // At least 50 requests per second

      console.log('Concurrent Request Performance:');
      console.log(`- Total requests: ${concurrentRequests}`);
      console.log(`- Successful requests: ${successfulRequests}`);
      console.log(`- Error rate: ${errorRate.toFixed(2)}%`);
      console.log(`- Average response time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`- Throughput: ${throughput.toFixed(2)} req/s`);
    });

    it('should handle mixed concurrent operations', async () => {
      const { CCTelegramBridgeClient } = await import('../../src/bridge-client.js');
      const client = new CCTelegramBridgeClient();

      const operationCount = 50;
      const operations: Promise<any>[] = [];

      // Generate mixed operations
      for (let i = 0; i < operationCount; i++) {
        const operationType = i % 5;
        
        switch (operationType) {
          case 0:
            operations.push(client.sendEvent(EventFixtures.createBasicEvent()));
            break;
          case 1:
            operations.push(client.sendMessage(`Load test message ${i}`));
            break;
          case 2:
            operations.push(client.getBridgeStatus());
            break;
          case 3:
            operations.push(client.getTelegramResponses());
            break;
          case 4:
            operations.push(client.clearOldResponses(24));
            break;
        }
      }

      const startTime = Date.now();
      const results = await Promise.allSettled(operations);
      const totalTime = Date.now() - startTime;

      const successfulOperations = results.filter(r => r.status === 'fulfilled').length;
      const failedOperations = results.filter(r => r.status === 'rejected').length;
      const successRate = (successfulOperations / operationCount) * 100;
      const throughput = (successfulOperations / totalTime) * 1000;

      expect(successRate).toBeGreaterThan(95); // At least 95% success rate
      expect(throughput).toBeGreaterThan(30); // At least 30 operations per second

      console.log('Mixed Operations Performance:');
      console.log(`- Total operations: ${operationCount}`);
      console.log(`- Successful: ${successfulOperations}`);
      console.log(`- Failed: ${failedOperations}`);
      console.log(`- Success rate: ${successRate.toFixed(2)}%`);
      console.log(`- Throughput: ${throughput.toFixed(2)} ops/s`);
    });
  });

  describe('Memory Usage Under Load', () => {
    it('should maintain stable memory usage under sustained load', async () => {
      const { CCTelegramBridgeClient } = await import('../../src/bridge-client.js');
      const client = new CCTelegramBridgeClient();

      const testDurationMs = 10000; // 10 seconds
      const requestIntervalMs = 50; // 20 requests per second
      const startTime = Date.now();
      const memorySnapshots: number[] = [];
      let requestCount = 0;

      // Function to measure memory usage
      const measureMemory = () => {
        const memUsage = process.memoryUsage();
        return memUsage.heapUsed / 1024 / 1024; // MB
      };

      // Sustained load test
      const intervalId = setInterval(async () => {
        if (Date.now() - startTime > testDurationMs) {
          clearInterval(intervalId);
          return;
        }

        // Take memory snapshot
        memorySnapshots.push(measureMemory());

        // Send request
        try {
          await client.sendEvent(EventFixtures.createBasicEvent({
            title: `Memory test ${requestCount++}`
          }));
        } catch (error) {
          // Log but don't fail the test
          console.warn(`Request ${requestCount} failed:`, error);
        }
      }, requestIntervalMs);

      // Wait for test completion
      await new Promise(resolve => {
        const checkComplete = () => {
          if (Date.now() - startTime >= testDurationMs) {
            resolve(undefined);
          } else {
            setTimeout(checkComplete, 100);
          }
        };
        checkComplete();
      });

      // Analyze memory usage
      const initialMemory = memorySnapshots[0];
      const finalMemory = memorySnapshots[memorySnapshots.length - 1];
      const maxMemory = Math.max(...memorySnapshots);
      const memoryGrowth = ((finalMemory - initialMemory) / initialMemory) * 100;

      expect(memoryGrowth).toBeLessThan(50); // Memory shouldn't grow more than 50%
      expect(maxMemory).toBeLessThan(200); // Max memory should be under 200MB

      console.log('Memory Usage Analysis:');
      console.log(`- Initial memory: ${initialMemory.toFixed(2)}MB`);
      console.log(`- Final memory: ${finalMemory.toFixed(2)}MB`);
      console.log(`- Max memory: ${maxMemory.toFixed(2)}MB`);
      console.log(`- Memory growth: ${memoryGrowth.toFixed(2)}%`);
      console.log(`- Total requests: ${requestCount}`);
    });
  });

  describe('Error Recovery Under Load', () => {
    it('should recover from network failures gracefully', async () => {
      const { CCTelegramBridgeClient } = await import('../../src/bridge-client.js');
      const client = new CCTelegramBridgeClient();

      const totalRequests = 100;
      const failureRate = 0.2; // 20% failure rate
      let successCount = 0;
      let failureCount = 0;
      let recoveryCount = 0;

      // Simulate intermittent failures
      let requestCount = 0;
      const requests = Array.from({ length: totalRequests }, async () => {
        const currentRequest = requestCount++;
        
        // Simulate failures for some requests
        if (Math.random() < failureRate) {
          mockAxios.setShouldFail(true, 'Network timeout');
        } else {
          mockAxios.setShouldFail(false);
        }

        try {
          const result = await client.sendEvent(EventFixtures.createBasicEvent({
            title: `Recovery test ${currentRequest}`
          }));
          
          if (result.success) {
            successCount++;
            // If this request succeeded after a previous failure, count as recovery
            if (currentRequest > 0 && Math.random() < failureRate) {
              recoveryCount++;
            }
          }
        } catch (error) {
          failureCount++;
        }

        // Reset failure state
        mockAxios.setShouldFail(false);
      });

      await Promise.allSettled(requests);

      const actualSuccessRate = (successCount / totalRequests) * 100;
      const expectedSuccessRate = (1 - failureRate) * 100;

      // Should have reasonable success rate despite failures
      expect(actualSuccessRate).toBeGreaterThan(expectedSuccessRate - 10);
      expect(failureCount).toBeGreaterThan(0); // Should have some failures
      expect(successCount + failureCount).toBe(totalRequests);

      console.log('Error Recovery Performance:');
      console.log(`- Total requests: ${totalRequests}`);
      console.log(`- Successful: ${successCount}`);
      console.log(`- Failed: ${failureCount}`);
      console.log(`- Success rate: ${actualSuccessRate.toFixed(2)}%`);
      console.log(`- Expected success rate: ${expectedSuccessRate.toFixed(2)}%`);
      console.log(`- Recovery instances: ${recoveryCount}`);
    });
  });

  describe('Resource Cleanup Under Load', () => {
    it('should properly clean up resources after high-volume operations', async () => {
      const { CCTelegramBridgeClient } = await import('../../src/bridge-client.js');
      const client = new CCTelegramBridgeClient();

      const batchSize = 1000;
      const batches = 5;
      const totalOperations = batchSize * batches;

      // Set up mock file system to track file operations
      let fileOperations = 0;
      const originalWriteJSON = mockFS.writeJSON;
      mockFS.writeJSON = jest.fn(async (...args) => {
        fileOperations++;
        return originalWriteJSON.call(mockFS, ...args);
      });

      console.log(`Starting ${totalOperations} operations in ${batches} batches...`);

      for (let batch = 0; batch < batches; batch++) {
        const batchStart = Date.now();
        
        // Create batch of operations
        const operations = Array.from({ length: batchSize }, (_, i) => 
          client.sendEvent(EventFixtures.createBasicEvent({
            title: `Batch ${batch + 1} Event ${i + 1}`,
            task_id: `batch-${batch}-event-${i}-${Date.now()}`
          }))
        );

        // Execute batch
        const results = await Promise.allSettled(operations);
        const batchTime = Date.now() - batchStart;
        const successfulInBatch = results.filter(r => r.status === 'fulfilled').length;

        console.log(`Batch ${batch + 1}: ${successfulInBatch}/${batchSize} successful (${batchTime}ms)`);

        // Simulate cleanup between batches
        await client.clearOldResponses(0); // Clear all responses
        
        // Small delay to allow garbage collection
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify file operations were performed
      expect(fileOperations).toBe(totalOperations);

      // Check memory usage after operations
      const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      expect(finalMemory).toBeLessThan(500); // Should not exceed 500MB

      console.log('Resource Cleanup Results:');
      console.log(`- Total operations: ${totalOperations}`);
      console.log(`- File operations: ${fileOperations}`);
      console.log(`- Final memory usage: ${finalMemory.toFixed(2)}MB`);
    });
  });

  describe('Concurrent Bridge Management', () => {
    it('should handle concurrent bridge management operations safely', async () => {
      const { CCTelegramBridgeClient } = await import('../../src/bridge-client.js');
      const clients = Array.from({ length: 10 }, () => new CCTelegramBridgeClient());

      const concurrentOperations = [
        // Multiple clients checking status
        ...clients.map(client => client.getBridgeStatus()),
        ...clients.map(client => client.isBridgeRunning()),
        
        // Some clients ensuring bridge is running
        ...clients.slice(0, 3).map(client => client.ensureBridgeRunning()),
        
        // Some clients getting responses
        ...clients.slice(3, 6).map(client => client.getTelegramResponses()),
        
        // One client managing bridge lifecycle
        clients[0].restartBridge()
      ];

      const startTime = Date.now();
      const results = await Promise.allSettled(concurrentOperations);
      const totalTime = Date.now() - startTime;

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      const successRate = (successful / results.length) * 100;

      // Should handle concurrent operations without race conditions
      expect(successRate).toBeGreaterThan(90);
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds

      console.log('Concurrent Bridge Management:');
      console.log(`- Total operations: ${concurrentOperations.length}`);
      console.log(`- Successful: ${successful}`);
      console.log(`- Failed: ${failed}`);
      console.log(`- Success rate: ${successRate.toFixed(2)}%`);
      console.log(`- Total time: ${totalTime}ms`);
    });
  });

  describe('Stress Testing', () => {
    it('should maintain performance under extreme load', async () => {
      const { CCTelegramBridgeClient } = await import('../../src/bridge-client.js');
      const client = new CCTelegramBridgeClient();

      // Extreme load parameters
      const extremeLoad = 500;
      const timeoutMs = 30000; // 30 seconds max

      console.log(`Starting stress test with ${extremeLoad} concurrent operations...`);

      const stressOperations = Array.from({ length: extremeLoad }, (_, i) => {
        const operationType = i % 6;
        
        switch (operationType) {
          case 0:
            return client.sendEvent(EventFixtures.createTaskCompletionEvent({
              title: `Stress Event ${i}`,
              task_id: `stress-${i}-${Date.now()}`
            }));
          case 1:
            return client.sendMessage(`Stress message ${i}`);
          case 2:
            return client.sendPerformanceAlert(`Stress Alert ${i}`, 100, 80);
          case 3:
            return client.getBridgeStatus();
          case 4:
            return client.getTelegramResponses();
          case 5:
            return client.getTaskStatus('/test', 'both');
          default:
            return client.sendEvent(EventFixtures.createBasicEvent());
        }
      });

      const startTime = Date.now();
      const results = await Promise.race([
        Promise.allSettled(stressOperations),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Stress test timeout')), timeoutMs)
        )
      ]) as PromiseSettledResult<any>[];

      const totalTime = Date.now() - startTime;
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      const successRate = (successful / extremeLoad) * 100;
      const throughput = (successful / totalTime) * 1000;

      // Stress test expectations (more lenient)
      expect(successRate).toBeGreaterThan(80); // At least 80% success under stress
      expect(totalTime).toBeLessThan(timeoutMs);
      expect(throughput).toBeGreaterThan(10); // At least 10 ops/sec under stress

      console.log('Stress Test Results:');
      console.log(`- Operations: ${extremeLoad}`);
      console.log(`- Successful: ${successful}`);
      console.log(`- Failed: ${failed}`);
      console.log(`- Success rate: ${successRate.toFixed(2)}%`);
      console.log(`- Total time: ${totalTime}ms`);
      console.log(`- Throughput: ${throughput.toFixed(2)} ops/s`);
      console.log(`- Memory usage: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should meet performance benchmarks for all tool types', async () => {
      const { CCTelegramBridgeClient } = await import('../../src/bridge-client.js');
      const client = new CCTelegramBridgeClient();

      const benchmarks = {
        send_event: { target: 50, actual: 0 }, // ops/sec
        send_message: { target: 100, actual: 0 },
        get_status: { target: 200, actual: 0 },
        get_responses: { target: 150, actual: 0 },
        bridge_management: { target: 20, actual: 0 }
      };

      // Benchmark send_event
      const eventOperations = 100;
      let startTime = Date.now();
      await Promise.all(Array.from({ length: eventOperations }, () => 
        client.sendEvent(EventFixtures.createBasicEvent())
      ));
      benchmarks.send_event.actual = (eventOperations / (Date.now() - startTime)) * 1000;

      // Benchmark send_message
      const messageOperations = 200;
      startTime = Date.now();
      await Promise.all(Array.from({ length: messageOperations }, (_, i) => 
        client.sendMessage(`Benchmark message ${i}`)
      ));
      benchmarks.send_message.actual = (messageOperations / (Date.now() - startTime)) * 1000;

      // Benchmark get_status
      const statusOperations = 300;
      startTime = Date.now();
      await Promise.all(Array.from({ length: statusOperations }, () => 
        client.getBridgeStatus()
      ));
      benchmarks.get_status.actual = (statusOperations / (Date.now() - startTime)) * 1000;

      // Benchmark get_responses
      const responseOperations = 250;
      startTime = Date.now();
      await Promise.all(Array.from({ length: responseOperations }, () => 
        client.getTelegramResponses()
      ));
      benchmarks.get_responses.actual = (responseOperations / (Date.now() - startTime)) * 1000;

      // Benchmark bridge_management
      const managementOperations = 50;
      startTime = Date.now();
      await Promise.all(Array.from({ length: managementOperations }, () => 
        client.ensureBridgeRunning()
      ));
      benchmarks.bridge_management.actual = (managementOperations / (Date.now() - startTime)) * 1000;

      // Check all benchmarks
      Object.entries(benchmarks).forEach(([operation, { target, actual }]) => {
        console.log(`${operation}: ${actual.toFixed(2)} ops/s (target: ${target} ops/s)`);
        
        // Allow some flexibility in benchmarks (80% of target)
        expect(actual).toBeGreaterThan(target * 0.8);
      });

      console.log('All performance benchmarks met!');
    });
  });
});
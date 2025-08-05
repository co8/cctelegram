/**
 * Memory Leak Detector Performance Tests
 * 
 * Tests the performance characteristics of the memory leak detection system
 * under various load conditions and stress scenarios.
 */

import { 
  MemoryLeakDetector, 
  MemoryLeakConfig,
  DEFAULT_MEMORY_LEAK_CONFIG 
} from '../../src/observability/performance/memory-leak-detector.js';
import { MetricsCollector } from '../../src/observability/metrics/metrics-collector.js';
import { PerformanceHelpers, AsyncHelpers } from '../utils/test-helpers.js';

// Mock dependencies
jest.mock('../../src/security.js', () => ({
  secureLog: jest.fn()
}));

jest.mock('fs-extra');
jest.mock('memwatch-next');

// Mock process.memoryUsage
const mockMemoryUsage = jest.fn();
(global as any).process.memoryUsage = mockMemoryUsage;
(global as any).gc = jest.fn();

describe('Memory Leak Detector Performance Tests', () => {
  let detector: MemoryLeakDetector;
  let metricsCollector: MetricsCollector;
  let mockMemwatch: any;
  
  const createMockMemoryUsage = (heapUsedMB: number = 40): NodeJS.MemoryUsage => ({
    rss: 100 * 1024 * 1024,
    heapTotal: 80 * 1024 * 1024,
    heapUsed: heapUsedMB * 1024 * 1024,
    external: 5 * 1024 * 1024,
    arrayBuffers: 1 * 1024 * 1024
  });
  
  const createPerformanceConfig = (): MemoryLeakConfig => ({
    ...DEFAULT_MEMORY_LEAK_CONFIG,
    thresholds: {
      maxHeapUsageMB: 50,
      memoryGrowthRateMBPerMin: 2,
      heapGrowthPercentage: 10,
      eventFileAccumulationThreshold: 1000
    },
    monitoring: {
      snapshotIntervalMs: 100, // Very fast for performance testing
      heapDiffIntervalMs: 1000,
      gcMonitoringEnabled: true,
      alertCooldownMs: 50
    },
    heapDumps: {
      enabled: true,
      maxDumps: 10,
      dumpOnThreshold: false, // Disable for performance testing
      dumpDirectory: '/tmp/perf-test-heapdumps',
      autoAnalyze: false
    }
  });
  
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Mock memwatch-next
    mockMemwatch = {
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      writeHeapSnapshot: jest.fn((path, callback) => callback()),
      HeapDiff: jest.fn().mockImplementation(() => ({
        end: jest.fn().mockReturnValue({
          change: {
            details: [
              { what: 'String', size_bytes: 1024, '+': 10 },
              { what: 'Object', size_bytes: 2048, '+': 20 }
            ]
          }
        })
      }))
    };
    
    jest.doMock('memwatch-next', () => mockMemwatch);
    
    // Mock fs-extra with fast responses
    const fs = require('fs-extra');
    (fs.ensureDir as jest.Mock).mockResolvedValue(undefined);
    (fs.pathExists as jest.Mock).mockResolvedValue(true);
    (fs.readdir as jest.Mock).mockResolvedValue(['file1.json', 'file2.json']);
    (fs.stat as jest.Mock).mockResolvedValue({ size: 1024 });
    
    // Mock process.memoryUsage
    mockMemoryUsage.mockReturnValue(createMockMemoryUsage());
    
    // Create fast metrics collector
    metricsCollector = new MetricsCollector({
      enabled: true,
      prometheusEnabled: false,
      customMetrics: true,
      retentionDays: 1
    });
    
    detector = new MemoryLeakDetector(createPerformanceConfig(), metricsCollector);
    await detector.start();
  });
  
  afterEach(async () => {
    if (detector) {
      await detector.stop();
    }
    jest.clearAllMocks();
  });

  describe('Snapshot Performance', () => {
    it('should take memory snapshots quickly', async () => {
      const benchmark = await PerformanceHelpers.benchmark(
        () => detector.takeSnapshot('global'),
        100
      );
      
      // Each snapshot should take less than 10ms on average
      expect(benchmark.avg).toBeLessThan(10);
      expect(benchmark.max).toBeLessThan(50);
      
      console.log(`Snapshot Performance - Avg: ${benchmark.avg.toFixed(2)}ms, Max: ${benchmark.max.toFixed(2)}ms`);
    });
    
    it('should handle concurrent snapshots efficiently', async () => {
      const concurrentSnapshots = async () => {
        const promises = Array.from({ length: 10 }, (_, i) => 
          detector.takeSnapshot(i % 2 === 0 ? 'global' : 'event_files')
        );
        
        return Promise.all(promises);
      };
      
      const { duration, result } = await PerformanceHelpers.measureTime(concurrentSnapshots);
      
      // 10 concurrent snapshots should complete in under 100ms
      expect(duration).toBeLessThan(100);
      expect(result).toHaveLength(10);
      
      console.log(`Concurrent Snapshots Performance - Duration: ${duration.toFixed(2)}ms`);
    });
    
    it('should maintain performance under high-frequency snapshots', async () => {
      const highFrequencyTest = async () => {
        for (let i = 0; i < 50; i++) {
          await detector.takeSnapshot('global');
          // No delay - maximum frequency
        }
      };
      
      const { duration } = await PerformanceHelpers.measureTime(highFrequencyTest);
      
      // 50 sequential snapshots should complete in under 500ms
      expect(duration).toBeLessThan(500);
      
      console.log(`High-Frequency Snapshots Performance - Duration: ${duration.toFixed(2)}ms for 50 snapshots`);
    });
  });

  describe('Heap Analysis Performance', () => {
    it('should perform heap analysis quickly', async () => {
      const benchmark = await PerformanceHelpers.benchmark(
        () => detector.analyzeHeap(),
        20 // Fewer iterations for heap analysis
      );
      
      // Heap analysis should complete in under 50ms on average
      expect(benchmark.avg).toBeLessThan(50);
      expect(benchmark.max).toBeLessThan(200);
      
      console.log(`Heap Analysis Performance - Avg: ${benchmark.avg.toFixed(2)}ms, Max: ${benchmark.max.toFixed(2)}ms`);
    });
    
    it('should handle multiple concurrent heap analyses', async () => {
      const concurrentAnalyses = async () => {
        const promises = Array.from({ length: 5 }, () => detector.analyzeHeap());
        return Promise.all(promises);
      };
      
      const { duration, result } = await PerformanceHelpers.measureTime(concurrentAnalyses);
      
      // 5 concurrent analyses should complete in under 300ms
      expect(duration).toBeLessThan(300);
      expect(result.every(analysis => analysis !== null)).toBe(true);
      
      console.log(`Concurrent Heap Analysis Performance - Duration: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Dashboard Generation Performance', () => {
    beforeEach(async () => {
      // Pre-populate with some data
      for (let i = 0; i < 10; i++) {
        await detector.takeSnapshot('global');
        await detector.takeSnapshot('event_files');
      }
    });
    
    it('should generate dashboard data quickly', async () => {
      const benchmark = await PerformanceHelpers.benchmark(
        () => detector.getMemoryDashboard(),
        50
      );
      
      // Dashboard generation should be very fast (under 5ms)
      expect(benchmark.avg).toBeLessThan(5);
      expect(benchmark.max).toBeLessThan(20);
      
      console.log(`Dashboard Generation Performance - Avg: ${benchmark.avg.toFixed(2)}ms, Max: ${benchmark.max.toFixed(2)}ms`);
    });
    
    it('should handle multiple concurrent dashboard requests', async () => {
      const concurrentDashboards = async () => {
        const promises = Array.from({ length: 20 }, () => detector.getMemoryDashboard());
        return Promise.all(promises);
      };
      
      const { duration, result } = await PerformanceHelpers.measureTime(concurrentDashboards);
      
      // 20 concurrent dashboard requests should complete very quickly
      expect(duration).toBeLessThan(50);
      expect(result.every(dashboard => dashboard !== null)).toBe(true);
      
      console.log(`Concurrent Dashboard Requests Performance - Duration: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Alert Processing Performance', () => {
    it('should process memory alerts quickly', async () => {
      const alerts: any[] = [];
      detector.on('memory_alert', (alert) => alerts.push(alert));
      
      // Simulate memory threshold breach
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage(60));
      
      const alertProcessingTest = async () => {
        for (let i = 0; i < 10; i++) {
          await detector.takeSnapshot('global');
          await AsyncHelpers.wait(10); // Small delay to prevent cooldown
        }
      };
      
      const { duration } = await PerformanceHelpers.measureTime(alertProcessingTest);
      
      // Alert processing should not significantly slow down snapshots
      expect(duration).toBeLessThan(200);
      expect(alerts.length).toBeGreaterThan(0);
      
      console.log(`Alert Processing Performance - Duration: ${duration.toFixed(2)}ms, Alerts: ${alerts.length}`);
    });
  });

  describe('Memory Usage of the Detector Itself', () => {
    it('should not consume excessive memory during operation', async () => {
      const initialMemory = process.memoryUsage();
      
      // Run intensive operations
      for (let i = 0; i < 100; i++) {
        await detector.takeSnapshot('global');
        if (i % 10 === 0) {
          await detector.analyzeHeap();
        }
      }
      
      const finalMemory = process.memoryUsage();
      const memoryGrowth = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);
      
      // Memory growth should be reasonable (under 10MB)
      expect(memoryGrowth).toBeLessThan(10);
      
      console.log(`Memory Detector Self-Usage - Growth: ${memoryGrowth.toFixed(2)}MB`);
    });
    
    it('should clean up old data automatically', async () => {
      // Generate lots of snapshots to test cleanup
      for (let i = 0; i < 200; i++) {
        mockMemoryUsage.mockReturnValue(createMockMemoryUsage(30 + (i % 20)));
        await detector.takeSnapshot('global');
      }
      
      const dashboard = detector.getMemoryDashboard();
      
      // Should still be able to generate dashboard efficiently
      expect(dashboard).toBeDefined();
      expect(dashboard.timestamp).toBeGreaterThan(0);
      
      const stats = detector.getMemoryStats();
      
      // Snapshots should be limited (cleanup working)
      expect(stats.snapshots).toBeLessThan(500); // Much less than 200 * areas
      
      console.log(`Data Cleanup - Total snapshots stored: ${stats.snapshots}`);
    });
  });

  describe('Stress Testing', () => {
    it('should handle sustained high-load monitoring', async () => {
      let totalSnapshots = 0;
      let totalAnalyses = 0;
      let totalDashboards = 0;
      
      const stressTest = async () => {
        const duration = 5000; // 5 seconds of stress testing
        const startTime = Date.now();
        
        const operations = [];
        
        // Continuous snapshot operations
        operations.push((async () => {
          while (Date.now() - startTime < duration) {
            await detector.takeSnapshot('global');
            totalSnapshots++;
            await AsyncHelpers.wait(10);
          }
        })());
        
        // Periodic heap analysis
        operations.push((async () => {
          while (Date.now() - startTime < duration) {
            await detector.analyzeHeap();
            totalAnalyses++;
            await AsyncHelpers.wait(100);
          }
        })());
        
        // Frequent dashboard requests
        operations.push((async () => {
          while (Date.now() - startTime < duration) {
            detector.getMemoryDashboard();
            totalDashboards++;
            await AsyncHelpers.wait(50);
          }
        })());
        
        await Promise.all(operations);
      };
      
      const { duration } = await PerformanceHelpers.measureTime(stressTest);
      
      expect(duration).toBeLessThan(6000); // Should complete within reasonable time
      expect(totalSnapshots).toBeGreaterThan(100);
      expect(totalAnalyses).toBeGreaterThan(10);
      expect(totalDashboards).toBeGreaterThan(50);
      
      console.log(`Stress Test Results - Snapshots: ${totalSnapshots}, Analyses: ${totalAnalyses}, Dashboards: ${totalDashboards}`);
    });
    
    it('should maintain accuracy under load', async () => {
      const alerts: any[] = [];
      detector.on('memory_alert', (alert) => alerts.push(alert));
      
      // Simulate memory leak pattern under load
      let heapSize = 30;
      
      for (let i = 0; i < 50; i++) {
        heapSize += 1; // Gradual increase
        mockMemoryUsage.mockReturnValue(createMockMemoryUsage(heapSize));
        
        // Multiple concurrent operations
        await Promise.all([
          detector.takeSnapshot('global'),
          detector.takeSnapshot('event_files'),
          detector.getMemoryDashboard()
        ]);
      }
      
      // Should still detect threshold breach accurately
      expect(alerts.some(alert => alert.type === 'threshold_breach')).toBe(true);
      expect(alerts.some(alert => alert.type === 'growth_rate')).toBe(true);
      
      console.log(`Load Testing - Detected ${alerts.length} alerts correctly`);
    });
  });

  describe('Resource Cleanup Performance', () => {
    it('should clean up resources efficiently on stop', async () => {
      // Generate some data
      for (let i = 0; i < 50; i++) {
        await detector.takeSnapshot('global');
      }
      
      const { duration } = await PerformanceHelpers.measureTime(async () => {
        await detector.stop();
      });
      
      // Cleanup should be fast
      expect(duration).toBeLessThan(100);
      
      console.log(`Cleanup Performance - Duration: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Integration Performance', () => {
    it('should maintain performance when integrated with metrics collector', async () => {
      const recordSpy = jest.spyOn(metricsCollector, 'recordCustomMetric');
      
      const benchmark = await PerformanceHelpers.benchmark(
        () => detector.takeSnapshot('global'),
        50
      );
      
      // Performance should remain good even with metrics recording
      expect(benchmark.avg).toBeLessThan(15); // Slightly higher due to metrics
      expect(recordSpy).toHaveBeenCalled();
      
      console.log(`Integrated Performance - Avg: ${benchmark.avg.toFixed(2)}ms with metrics`);
    });
  });
});
/**
 * Memory Leak Detection Integration Tests
 * 
 * Tests the integration of the memory leak detector with the enhanced performance monitor,
 * observability manager, and real-world memory leak scenarios.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import { 
  MemoryLeakDetector, 
  MemoryLeakConfig, 
  MemoryLeakAlert,
  DEFAULT_MEMORY_LEAK_CONFIG 
} from '../../src/observability/performance/memory-leak-detector.js';
import { 
  EnhancedPerformanceMonitor,
  PerformanceDashboard 
} from '../../src/observability/performance/enhanced-performance-monitor.js';
import { PerformanceMonitor } from '../../src/observability/performance/performance-monitor.js';
import { MetricsCollector } from '../../src/observability/metrics/metrics-collector.js';
import { ObservabilityManager } from '../../src/observability/manager.js';
import { TestData, AsyncHelpers, PerformanceHelpers } from '../utils/test-helpers.js';

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

describe('Memory Leak Detection Integration', () => {
  let performanceMonitor: PerformanceMonitor;
  let enhancedMonitor: EnhancedPerformanceMonitor;
  let memoryDetector: MemoryLeakDetector;
  let metricsCollector: MetricsCollector;
  let mockMemwatch: any;
  
  const createMockMemoryUsage = (heapUsedMB: number = 40): NodeJS.MemoryUsage => ({
    rss: 100 * 1024 * 1024,
    heapTotal: 80 * 1024 * 1024,
    heapUsed: heapUsedMB * 1024 * 1024,
    external: 5 * 1024 * 1024,
    arrayBuffers: 1 * 1024 * 1024
  });
  
  const createMemoryLeakConfig = (): MemoryLeakConfig => ({
    ...DEFAULT_MEMORY_LEAK_CONFIG,
    thresholds: {
      maxHeapUsageMB: 50,
      memoryGrowthRateMBPerMin: 2,
      heapGrowthPercentage: 10,
      eventFileAccumulationThreshold: 100
    },
    monitoring: {
      snapshotIntervalMs: 500, // Fast for testing
      heapDiffIntervalMs: 2000,
      gcMonitoringEnabled: true,
      alertCooldownMs: 100
    },
    heapDumps: {
      enabled: true,
      maxDumps: 3,
      dumpOnThreshold: true,
      dumpDirectory: '/tmp/test-integration-heapdumps',
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
              { what: 'String', size_bytes: 1024 * 1024, '+': 100 },
              { what: 'Buffer', size_bytes: 3 * 1024 * 1024, '+': 300 }
            ]
          }
        })
      }))
    };
    
    jest.doMock('memwatch-next', () => mockMemwatch);
    
    // Mock fs-extra
    (fs.ensureDir as jest.Mock).mockResolvedValue(undefined);
    (fs.pathExists as jest.Mock).mockResolvedValue(true);
    (fs.readdir as jest.Mock).mockResolvedValue(['file1.json', 'file2.json']);
    (fs.stat as jest.Mock).mockResolvedValue({ size: 1024 });
    
    // Mock process.memoryUsage
    mockMemoryUsage.mockReturnValue(createMockMemoryUsage());
    
    // Create metrics collector
    metricsCollector = new MetricsCollector({
      enabled: true,
      prometheusEnabled: false,
      customMetrics: true,
      retentionDays: 1
    });
    
    // Create performance monitor
    performanceMonitor = new PerformanceMonitor({
      enabled: true,
      profiling: { enabled: false, heapSnapshots: false, cpuProfile: false, interval: 30000 },
      optimization: { enabled: true, recommendationEngine: true, autoTuning: false },
      slaTargets: { availability: 99.9, responseTime: 500, errorRate: 1, throughput: 100 },
      thresholds: { cpu: 80, memory: 85, responseTime: 1000, errorRate: 5 }
    }, metricsCollector);
    
    // Create enhanced monitor with memory leak detector
    enhancedMonitor = new EnhancedPerformanceMonitor(
      performanceMonitor,
      undefined, // No clinic profiler for integration tests
      metricsCollector,
      createMemoryLeakConfig()
    );
    
    // Get the memory leak detector instance
    await enhancedMonitor.initialize();
    memoryDetector = enhancedMonitor.getMemoryLeakDetector()!;
    
    expect(memoryDetector).toBeDefined();
  });
  
  afterEach(async () => {
    if (enhancedMonitor) {
      await enhancedMonitor.stop();
    }
    jest.clearAllMocks();
  });

  describe('Integration with Enhanced Performance Monitor', () => {
    it('should initialize memory leak detector within enhanced monitor', async () => {
      expect(memoryDetector).toBeInstanceOf(MemoryLeakDetector);
      
      const memoryStats = enhancedMonitor.getMemoryStats();
      expect(memoryStats).toBeDefined();
      expect(memoryStats.currentUsage).toBeDefined();
    });
    
    it('should provide memory dashboard through enhanced monitor', async () => {
      await enhancedMonitor.start();
      
      const memoryDashboard = enhancedMonitor.getMemoryDashboard();
      expect(memoryDashboard).toBeDefined();
      expect(memoryDashboard?.timestamp).toBeGreaterThan(0);
    });
    
    it('should forward memory alerts through enhanced monitor', async () => {
      await enhancedMonitor.start();
      
      const alertPromise = new Promise<MemoryLeakAlert>((resolve) => {
        enhancedMonitor.once('memory_leak_alert', resolve);
      });
      
      // Simulate memory threshold breach
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage(60));
      
      // Trigger memory snapshot (normally done by timer)
      await memoryDetector.takeSnapshot('global');
      
      const alert = await AsyncHelpers.withTimeout(alertPromise, 5000);
      
      expect(alert.type).toBe('threshold_breach');
      expect(alert.severity).toBe('critical');
    });
    
    it('should integrate memory metrics into performance dashboard', async (done) => {
      await enhancedMonitor.start();
      
      enhancedMonitor.on('dashboard_updated', (dashboard: PerformanceDashboard) => {
        expect(dashboard.realtime.memoryLeaks).toBeDefined();
        expect(dashboard.memory).toBeDefined();
        expect(dashboard.memory?.summary).toBeDefined();
        done();
      });
    });
  });

  describe('Memory Leak Simulation Scenarios', () => {
    beforeEach(async () => {
      await enhancedMonitor.start();
    });
    
    it('should detect gradual memory leak over time', async () => {
      const alerts: MemoryLeakAlert[] = [];
      
      enhancedMonitor.on('memory_leak_alert', (alert) => {
        alerts.push(alert);
      });
      
      // Simulate gradual memory growth
      let heapSize = 30;
      
      for (let i = 0; i < 5; i++) {
        heapSize += 8; // 8MB increase each iteration
        mockMemoryUsage.mockReturnValue(createMockMemoryUsage(heapSize));
        
        await memoryDetector.takeSnapshot('global');
        await AsyncHelpers.wait(200);
      }
      
      // Should detect both growth rate and threshold breach
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.some(alert => alert.type === 'growth_rate')).toBe(true);
      expect(alerts.some(alert => alert.type === 'threshold_breach')).toBe(true);
    });
    
    it('should detect event file accumulation leak', async () => {
      const cleanupRequests: any[] = [];
      
      enhancedMonitor.on('memory_cleanup_requested', (request) => {
        cleanupRequests.push(request);
      });
      
      // Simulate large number of event files
      (fs.readdir as jest.Mock).mockResolvedValue(
        Array.from({ length: 200 }, (_, i) => `event${i}.json`)
      );
      
      await memoryDetector.takeSnapshot('event_files');
      
      await AsyncHelpers.waitFor(() => cleanupRequests.length > 0, 3000);
      
      expect(cleanupRequests).toHaveLength(1);
      expect(cleanupRequests[0].area).toBe('event_files');
    });
    
    it('should trigger heap dump on critical memory usage', async () => {
      const heapDumps: any[] = [];
      
      enhancedMonitor.on('heap_dump_generated', (info) => {
        heapDumps.push(info);
      });
      
      // Simulate critical memory usage
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage(75)); // Well above 50MB threshold
      
      await memoryDetector.takeSnapshot('global');
      
      await AsyncHelpers.waitFor(() => heapDumps.length > 0, 3000);
      
      expect(heapDumps).toHaveLength(1);
      expect(heapDumps[0].reason).toContain('alert_threshold_breach');
    });
  });

  describe('Performance Impact Assessment', () => {
    it('should have minimal performance impact during normal operation', async () => {
      await enhancedMonitor.start();
      
      const { duration } = await PerformanceHelpers.measureTime(async () => {
        // Simulate normal memory monitoring operations
        for (let i = 0; i < 10; i++) {
          await memoryDetector.takeSnapshot('global');
          await AsyncHelpers.wait(10);
        }
      });
      
      // Memory monitoring should be fast (under 100ms for 10 snapshots)
      expect(duration).toBeLessThan(100);
    });
    
    it('should handle concurrent operations efficiently', async () => {
      await enhancedMonitor.start();
      
      const operations = [
        () => memoryDetector.takeSnapshot('global'),
        () => memoryDetector.takeSnapshot('event_files'),
        () => memoryDetector.analyzeHeap(),
        () => enhancedMonitor.getMemoryDashboard(),
        () => enhancedMonitor.getMemoryStats()
      ];
      
      const { duration } = await PerformanceHelpers.measureTime(async () => {
        await Promise.all(operations.map(op => op()));
      });
      
      // Concurrent operations should complete quickly
      expect(duration).toBeLessThan(200);
    });
  });

  describe('Integration with Metrics Collection', () => {
    beforeEach(async () => {
      await metricsCollector.initialize();
      await enhancedMonitor.start();
    });
    
    afterEach(async () => {
      await metricsCollector.stop();
    });
    
    it('should record memory metrics to collector', async () => {
      const recordSpy = jest.spyOn(metricsCollector, 'recordCustomMetric');
      
      await memoryDetector.takeSnapshot('global');
      
      expect(recordSpy).toHaveBeenCalledWith({
        name: 'memory_heap_used_mb',
        value: 40,
        labels: { area: 'global' }
      });
      
      expect(recordSpy).toHaveBeenCalledWith({
        name: 'memory_total_mb',
        value: 100,
        labels: { area: 'global' }
      });
    });
    
    it('should provide metrics through collector interface', async () => {
      await memoryDetector.takeSnapshot('global');
      await memoryDetector.takeSnapshot('event_files');
      
      const allMetrics = metricsCollector.getAllMetrics();
      
      // Verify memory metrics are present
      expect(Object.keys(allMetrics)).toContain('memory_heap_used_mb');
      expect(Object.keys(allMetrics)).toContain('memory_total_mb');
    });
  });

  describe('Real-World Integration Scenarios', () => {
    beforeEach(async () => {
      await enhancedMonitor.start();
    });
    
    it('should handle MCP tool execution memory tracking', async () => {
      // Simulate MCP tool executions that might cause memory growth
      const tools = ['Read', 'Write', 'Bash', 'Grep', 'Edit'];
      
      let currentMemory = 30;
      
      for (const tool of tools) {
        // Simulate tool execution with memory growth
        enhancedMonitor.recordToolExecution(tool, Math.random() * 100, true);
        
        currentMemory += 2; // Each tool adds 2MB
        mockMemoryUsage.mockReturnValue(createMockMemoryUsage(currentMemory));
        
        await memoryDetector.takeSnapshot('global');
        await AsyncHelpers.wait(50);
      }
      
      const toolMetrics = enhancedMonitor.getToolMetrics();
      const memoryDashboard = enhancedMonitor.getMemoryDashboard();
      
      expect(toolMetrics.size).toBe(5);
      expect(memoryDashboard).toBeDefined();
      expect(memoryDashboard?.summary.heapUsedMB).toBe(40); // Final memory usage
    });
    
    it('should correlate memory alerts with performance degradation', async () => {
      const alerts: any[] = [];
      
      enhancedMonitor.on('memory_leak_alert', (alert) => alerts.push({ type: 'memory', alert }));
      enhancedMonitor.on('degradation_alert', (alert) => alerts.push({ type: 'performance', alert }));
      
      // Simulate high memory usage that affects performance
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage(65));
      
      // Take snapshot to trigger memory alert
      await memoryDetector.takeSnapshot('global');
      
      // Simulate performance metrics that would trigger degradation alert
      const highMemoryMetrics = {
        timestamp: Date.now(),
        cpu: { usage: 85 },
        memory: { usage: 90, heapUtilization: 85 },
        application: { 
          requests: { duration: { avg: 1500 } },
          errors: { rate: 3 }
        }
      };
      
      // Simulate metrics collection (normally from base monitor)
      (performanceMonitor as any).emit('metrics_collected', highMemoryMetrics);
      
      await AsyncHelpers.wait(500);
      
      // Should have both memory and performance alerts
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.some(a => a.type === 'memory')).toBe(true);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from temporary file system errors', async () => {
      await enhancedMonitor.start();
      
      // Simulate temporary file system error
      (fs.readdir as jest.Mock).mockRejectedValueOnce(new Error('Temporary FS error'));
      
      let snapshot1, snapshot2;
      
      // First snapshot should handle error gracefully
      snapshot1 = await memoryDetector.takeSnapshot('event_files');
      expect(snapshot1.specific).toEqual({});
      
      // Second snapshot should work normally
      (fs.readdir as jest.Mock).mockResolvedValue(['file1.json']);
      snapshot2 = await memoryDetector.takeSnapshot('event_files');
      expect(snapshot2.specific.eventFilesCount).toBe(1);
    });
    
    it('should maintain operation during memwatch failures', async () => {
      await enhancedMonitor.start();
      
      // Simulate memwatch failure
      mockMemwatch.HeapDiff.mockImplementation(() => {
        throw new Error('Memwatch failure');
      });
      
      const analysis = await memoryDetector.analyzeHeap();
      
      // Should return null but not crash
      expect(analysis).toBeNull();
      
      // Other operations should still work
      const snapshot = await memoryDetector.takeSnapshot('global');
      expect(snapshot).toBeDefined();
    });
  });

  describe('Dashboard Integration', () => {
    beforeEach(async () => {
      await enhancedMonitor.start();
    });
    
    it('should provide comprehensive memory data in performance dashboard', async (done) => {
      enhancedMonitor.on('dashboard_updated', (dashboard: PerformanceDashboard) => {
        expect(dashboard.memory).toBeDefined();
        expect(dashboard.memory?.summary).toBeDefined();
        expect(dashboard.memory?.trends).toBeDefined();
        expect(dashboard.memory?.areas).toBeDefined();
        
        expect(dashboard.realtime.memoryLeaks).toBeDefined();
        expect(dashboard.charts.memoryUsage).toBeDefined();
        
        done();
      });
    });
    
    it('should update memory status in real-time', async () => {
      // Initial state
      let dashboard = enhancedMonitor.getPerformanceDashboard();
      expect(dashboard?.realtime.memory).toBeDefined();
      
      // Simulate memory increase
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage(55));
      await memoryDetector.takeSnapshot('global');
      
      // Wait for dashboard update
      await AsyncHelpers.wait(500);
      
      dashboard = enhancedMonitor.getPerformanceDashboard();
      expect(dashboard?.memory?.summary.heapUsedMB).toBe(55);
    });
  });

  describe('Configuration and Customization', () => {
    it('should respect custom memory leak configuration', async () => {
      const customConfig = {
        ...createMemoryLeakConfig(),
        thresholds: { 
          maxHeapUsageMB: 100, // Higher threshold
          memoryGrowthRateMBPerMin: 5,
          heapGrowthPercentage: 20,
          eventFileAccumulationThreshold: 500
        }
      };
      
      const customEnhancedMonitor = new EnhancedPerformanceMonitor(
        performanceMonitor,
        undefined,
        metricsCollector,
        customConfig
      );
      
      await customEnhancedMonitor.initialize();
      await customEnhancedMonitor.start();
      
      const customDetector = customEnhancedMonitor.getMemoryLeakDetector()!;
      
      // Test higher threshold - should not alert at 60MB
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage(60));
      
      let alertTriggered = false;
      customDetector.once('memory_alert', () => { alertTriggered = true; });
      
      await customDetector.takeSnapshot('global');
      await AsyncHelpers.wait(200);
      
      expect(alertTriggered).toBe(false);
      
      await customEnhancedMonitor.stop();
    });
  });
});
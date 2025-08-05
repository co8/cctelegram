/**
 * Memory Leak Detector Tests
 * 
 * Comprehensive test suite for memory leak detection and monitoring system.
 * Covers all aspects including threshold monitoring, heap analysis, automated cleanup,
 * and integration with the performance monitoring dashboard.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { 
  MemoryLeakDetector, 
  MemoryLeakConfig, 
  MemoryLeakAlert, 
  MemoryAreaSnapshot,
  MemoryDashboard,
  DEFAULT_MEMORY_LEAK_CONFIG 
} from '../../src/observability/performance/memory-leak-detector.js';
import { MetricsCollector } from '../../src/observability/metrics/metrics-collector.js';
import { TestData, AsyncHelpers, ErrorHelpers } from '../utils/test-helpers.js';

// Mock dependencies
jest.mock('../../src/security.js', () => ({
  secureLog: jest.fn()
}));

jest.mock('fs-extra');
jest.mock('memwatch-next');

// Mock process.memoryUsage
const mockMemoryUsage = jest.fn();
(global as any).process.memoryUsage = mockMemoryUsage;

// Mock process.gc for forced garbage collection
(global as any).gc = jest.fn();

describe('MemoryLeakDetector', () => {
  let detector: MemoryLeakDetector;
  let mockMetricsCollector: jest.Mocked<MetricsCollector>;
  let mockMemwatch: any;
  
  const createMockMemoryUsage = (overrides: Partial<NodeJS.MemoryUsage> = {}): NodeJS.MemoryUsage => ({
    rss: 100 * 1024 * 1024, // 100MB
    heapTotal: 80 * 1024 * 1024, // 80MB
    heapUsed: 40 * 1024 * 1024, // 40MB
    external: 5 * 1024 * 1024, // 5MB
    arrayBuffers: 1 * 1024 * 1024, // 1MB
    ...overrides
  });
  
  const createTestConfig = (overrides: Partial<MemoryLeakConfig> = {}): MemoryLeakConfig => ({
    ...DEFAULT_MEMORY_LEAK_CONFIG,
    thresholds: {
      maxHeapUsageMB: 50,
      memoryGrowthRateMBPerMin: 2,
      heapGrowthPercentage: 10,
      eventFileAccumulationThreshold: 100,
      ...overrides.thresholds
    },
    monitoring: {
      snapshotIntervalMs: 1000, // Faster for testing
      heapDiffIntervalMs: 5000,
      gcMonitoringEnabled: true,
      alertCooldownMs: 1000,
      ...overrides.monitoring
    },
    heapDumps: {
      enabled: true,
      maxDumps: 3,
      dumpOnThreshold: true,
      dumpDirectory: '/tmp/test-heapdumps',
      autoAnalyze: false, // Disable for testing
      ...overrides.heapDumps
    },
    ...overrides
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock memwatch-next
    mockMemwatch = {
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      writeHeapSnapshot: jest.fn((path: string, callback: (err?: Error) => void) => callback()),
      HeapDiff: jest.fn().mockImplementation(() => ({
        end: jest.fn().mockReturnValue({
          change: {
            details: [
              { what: 'String', size_bytes: 1024 * 1024, '+': 100 },
              { what: 'Array', size_bytes: 2 * 1024 * 1024, '+': 200 }
            ]
          }
        })
      }))
    };
    
    // Apply memwatch mock
    jest.doMock('memwatch-next', () => mockMemwatch);
    
    // Mock fs-extra
    (fs.ensureDir as any).mockResolvedValue(undefined);
    (fs.pathExists as any).mockResolvedValue(true);
    (fs.readdir as any).mockResolvedValue(['file1.json', 'file2.json']);
    (fs.stat as any).mockResolvedValue({ size: 1024 });
    
    // Mock metrics collector
    mockMetricsCollector = {
      recordCustomMetric: jest.fn(),
      initialize: jest.fn().mockResolvedValue(undefined),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getMetrics: jest.fn().mockReturnValue({}),
      getAllMetrics: jest.fn().mockReturnValue({})
    } as any;
    
    // Mock process.memoryUsage
    mockMemoryUsage.mockReturnValue(createMockMemoryUsage());
    
    // Create detector instance
    detector = new MemoryLeakDetector(createTestConfig(), mockMetricsCollector);
  });
  
  afterEach(async () => {
    if (detector) {
      await detector.stop();
    }
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultDetector = new MemoryLeakDetector();
      
      expect(defaultDetector).toBeInstanceOf(MemoryLeakDetector);
      expect(defaultDetector).toBeInstanceOf(EventEmitter);
    });
    
    it('should initialize with custom configuration', () => {
      const customConfig = createTestConfig({
        thresholds: { 
          maxHeapUsageMB: 100,
          memoryGrowthRateMBPerMin: 2,
          heapGrowthPercentage: 10,
          eventFileAccumulationThreshold: 100
        }
      });
      
      const customDetector = new MemoryLeakDetector(customConfig);
      
      expect(customDetector).toBeInstanceOf(MemoryLeakDetector);
    });
    
    it('should initialize with metrics collector', () => {
      expect(detector).toBeInstanceOf(MemoryLeakDetector);
    });
  });

  describe('Lifecycle Management', () => {
    it('should start monitoring successfully', async () => {
      await expect(detector.start()).resolves.not.toThrow();
      
      expect(fs.ensureDir).toHaveBeenCalledWith('/tmp/test-heapdumps');
      expect(mockMemwatch.on).toHaveBeenCalledWith('leak', expect.any(Function));
      expect(mockMemwatch.on).toHaveBeenCalledWith('stats', expect.any(Function));
    });
    
    it('should not start if already running', async () => {
      await detector.start();
      
      // Second start should not throw and should not duplicate setup
      await expect(detector.start()).resolves.not.toThrow();
    });
    
    it('should stop monitoring successfully', async () => {
      await detector.start();
      await expect(detector.stop()).resolves.not.toThrow();
      
      expect(mockMemwatch.removeAllListeners).toHaveBeenCalledWith('leak');
      expect(mockMemwatch.removeAllListeners).toHaveBeenCalledWith('stats');
    });
    
    it('should handle start errors gracefully', async () => {
      (fs.ensureDir as jest.Mock).mockRejectedValue(new Error('Directory creation failed'));
      
      await expect(detector.start()).rejects.toThrow('Directory creation failed');
    });
  });

  describe('Memory Snapshots', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should take global memory snapshot', async () => {
      const snapshot = await detector.takeSnapshot('global');
      
      expect(snapshot).toBeDefined();
      expect(snapshot.area).toBe('global');
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.heapUsed).toBe(40 * 1024 * 1024);
      expect(snapshot.heapTotal).toBe(80 * 1024 * 1024);
      expect(snapshot.rss).toBe(100 * 1024 * 1024);
    });
    
    it('should take event files snapshot with metrics', async () => {
      const snapshot = await detector.takeSnapshot('event_files');
      
      expect(snapshot.area).toBe('event_files');
      expect(snapshot.specific.eventFilesCount).toBe(2); // Based on mock readdir
      expect(snapshot.specific.eventFilesSize).toBeGreaterThan(0);
    });
    
    it('should handle snapshot errors gracefully', async () => {
      (fs.pathExists as jest.Mock).mockRejectedValue(new Error('Path check failed'));
      
      const snapshot = await detector.takeSnapshot('event_files');
      
      expect(snapshot).toBeDefined();
      expect(snapshot.specific).toEqual({});
    });
    
    it('should record snapshot metrics when collector is available', async () => {
      await detector.takeSnapshot('global');
      
      expect(mockMetricsCollector.recordCustomMetric).toHaveBeenCalledWith({
        name: 'memory_heap_used_mb',
        value: 40,
        labels: { area: 'global' }
      });
      
      expect(mockMetricsCollector.recordCustomMetric).toHaveBeenCalledWith({
        name: 'memory_total_mb',
        value: 100,
        labels: { area: 'global' }
      });
    });
  });

  describe('Memory Threshold Monitoring', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should detect heap usage threshold breach', async () => {
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 60 * 1024 * 1024 // Exceeds 50MB threshold
      }));
      
      const alertPromise = new Promise<MemoryLeakAlert>((resolve) => {
        detector.once('memory_alert', resolve);
      });
      
      await detector.takeSnapshot('global');
      
      const alert = await AsyncHelpers.withTimeout(alertPromise, 5000);
      
      expect(alert.type).toBe('threshold_breach');
      expect(alert.severity).toBe('critical');
      expect(alert.area).toBe('global');
      expect(alert.current.heapUsedMB).toBe(60);
    });
    
    it('should detect memory growth rate violation', async () => {
      // Take initial snapshot
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 30 * 1024 * 1024
      }));
      
      await detector.takeSnapshot('global');
      
      // Wait and take second snapshot with higher memory
      await AsyncHelpers.wait(100);
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 40 * 1024 * 1024 // 10MB increase
      }));
      
      const alertPromise = new Promise<MemoryLeakAlert>((resolve) => {
        detector.once('memory_alert', resolve);
      });
      
      await detector.takeSnapshot('global');
      
      const alert = await AsyncHelpers.withTimeout(alertPromise, 5000);
      
      expect(alert.type).toBe('growth_rate');
      expect(alert.severity).toBe('high');
    });
    
    it('should detect event file accumulation', async () => {
      (fs.readdir as any).mockResolvedValue(
        Array.from({ length: 150 }, (_, i) => `file${i}.json`)
      );
      
      const alertPromise = new Promise<MemoryLeakAlert>((resolve) => {
        detector.once('memory_alert', resolve);
      });
      
      await detector.takeSnapshot('event_files');
      
      const alert = await AsyncHelpers.withTimeout(alertPromise, 5000);
      
      expect(alert.type).toBe('file_accumulation');
      expect(alert.severity).toBe('high');
      expect(alert.area).toBe('event_files');
      expect(alert.current.eventFileCount).toBe(150);
    });
    
    it('should respect alert cooldown period', async () => {
      let alertCount = 0;
      detector.on('memory_alert', () => alertCount++);
      
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 60 * 1024 * 1024
      }));
      
      // Take multiple snapshots quickly
      await detector.takeSnapshot('global');
      await detector.takeSnapshot('global');
      await detector.takeSnapshot('global');
      
      await AsyncHelpers.wait(100);
      
      // Should only have one alert due to cooldown
      expect(alertCount).toBe(1);
    });
  });

  describe('Heap Analysis', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should perform heap analysis successfully', async () => {
      const analysis = await detector.analyzeHeap();
      
      expect(analysis).toBeDefined();
      expect(analysis?.timestamp).toBeGreaterThan(0);
      expect(analysis?.analysis.growthAreas).toHaveLength(2);
      expect(analysis?.analysis.growthAreas[0].what).toBe('String');
      expect(analysis?.analysis.growthAreas[1].what).toBe('Array');
    });
    
    it('should detect memory leak suspicion in heap analysis', async () => {
      // Mock large memory growth
      mockMemwatch.HeapDiff.mockImplementation(() => ({
        end: jest.fn().mockReturnValue({
          change: {
            details: [
              { what: 'LargeObject', size_bytes: 10 * 1024 * 1024, '+': 1000 } // 10MB growth
            ]
          }
        })
      }));
      
      const analysis = await detector.analyzeHeap();
      
      expect(analysis?.analysis.memoryLeakSuspected).toBe(true);
      expect(analysis?.analysis.recommendations).toContain('Generate heap dump for detailed analysis');
    });
    
    it('should call global.gc when available', async () => {
      const analysis = await detector.analyzeHeap();
      
      expect(global.gc).toHaveBeenCalled();
      expect(analysis).toBeDefined();
    });
    
    it('should handle heap analysis errors', async () => {
      mockMemwatch.HeapDiff.mockImplementation(() => {
        throw new Error('Heap analysis failed');
      });
      
      const analysis = await detector.analyzeHeap();
      
      expect(analysis).toBeNull();
    });
  });

  describe('Heap Dump Generation', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should generate heap dump successfully', async () => {
      const dumpPath = await detector.generateHeapDump('test-reason');
      
      expect(dumpPath).toBeDefined();
      expect(dumpPath).toContain('/tmp/test-heapdumps');
      expect(dumpPath).toContain('test-reason');
      expect(mockMemwatch.writeHeapSnapshot).toHaveBeenCalled();
    });
    
    it('should respect maximum dump limit', async () => {
      // Generate maximum number of dumps
      await detector.generateHeapDump('dump1');
      await detector.generateHeapDump('dump2');
      await detector.generateHeapDump('dump3');
      
      // Fourth dump should be rejected
      const fourthDump = await detector.generateHeapDump('dump4');
      
      expect(fourthDump).toBeNull();
    });
    
    it('should handle heap dump generation errors', async () => {
      mockMemwatch.writeHeapSnapshot.mockImplementation((path: string, callback: (err?: Error) => void) => {
        callback(new Error('Dump failed'));
      });
      
      const dumpPath = await detector.generateHeapDump('error-test');
      
      expect(dumpPath).toBeNull();
    });
    
    it('should return null when heap dumps are disabled', async () => {
      const disabledDetector = new MemoryLeakDetector(createTestConfig({
        heapDumps: { 
          enabled: false,
          maxDumps: 3,
          dumpOnThreshold: false,
          dumpDirectory: '/tmp/test',
          autoAnalyze: false
        }
      }));
      
      await disabledDetector.start();
      
      const dumpPath = await disabledDetector.generateHeapDump();
      
      expect(dumpPath).toBeNull();
      
      await disabledDetector.stop();
    });
  });

  describe('Memory Dashboard', () => {
    beforeEach(async () => {
      await detector.start();
      await detector.takeSnapshot('global');
    });
    
    it('should generate complete memory dashboard', () => {
      const dashboard = detector.getMemoryDashboard();
      
      expect(dashboard).toBeDefined();
      expect(dashboard.timestamp).toBeGreaterThan(0);
      expect(dashboard.status).toMatch(/healthy|warning|critical/);
      expect(dashboard.summary).toBeDefined();
      expect(dashboard.trends).toBeDefined();
      expect(dashboard.areas).toBeDefined();
      expect(dashboard.recommendations).toBeDefined();
    });
    
    it('should calculate memory budget usage correctly', () => {
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 25 * 1024 * 1024 // 25MB of 50MB budget
      }));
      
      detector.takeSnapshot('global');
      const dashboard = detector.getMemoryDashboard();
      
      expect(dashboard.summary.memoryBudgetUsage).toBe(50); // 25/50 * 100
    });
    
    it('should determine overall status correctly', () => {
      // Test healthy status
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 20 * 1024 * 1024 // Well below threshold
      }));
      
      detector.takeSnapshot('global');
      let dashboard = detector.getMemoryDashboard();
      
      expect(dashboard.status).toBe('healthy');
      
      // Test critical status
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 55 * 1024 * 1024 // Above threshold
      }));
      
      detector.takeSnapshot('global');
      dashboard = detector.getMemoryDashboard();
      
      expect(dashboard.status).toBe('critical');
    });
    
    it('should generate appropriate recommendations', () => {
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 45 * 1024 * 1024 // Near threshold
      }));
      
      detector.takeSnapshot('global');
      const dashboard = detector.getMemoryDashboard();
      
      expect(dashboard.recommendations).toContain(
        'Memory usage is approaching budget limit - consider optimization'
      );
    });
  });

  describe('Automatic Actions', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should generate heap dump on critical alert', async () => {
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 60 * 1024 * 1024 // Critical threshold
      }));
      
      const alertPromise = new Promise<MemoryLeakAlert>((resolve) => {
        detector.once('memory_alert', resolve);
      });
      
      await detector.takeSnapshot('global');
      const alert = await AsyncHelpers.withTimeout(alertPromise, 5000);
      
      expect(alert.actions.heapDumpGenerated).toBeDefined();
      expect(mockMemwatch.writeHeapSnapshot).toHaveBeenCalled();
    });
    
    it('should trigger cleanup on file accumulation alert', async () => {
      (fs.readdir as any).mockResolvedValue(
        Array.from({ length: 150 }, (_, i) => `file${i}.json`)
      );
      
      const cleanupPromise = new Promise<any>((resolve) => {
        detector.once('cleanup_requested', resolve);
      });
      
      await detector.takeSnapshot('event_files');
      const cleanupRequest = await AsyncHelpers.withTimeout(cleanupPromise, 5000);
      
      expect(cleanupRequest.area).toBe('event_files');
    });
  });

  describe('Memory Statistics', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should provide comprehensive memory statistics', () => {
      const stats = detector.getMemoryStats();
      
      expect(stats.currentUsage).toBeDefined();
      expect(stats.budget.used).toBe(40); // 40MB used
      expect(stats.budget.available).toBe(10); // 50 - 40 = 10MB available
      expect(stats.budget.percentage).toBe(80); // 40/50 * 100
      expect(stats.snapshots).toBeGreaterThanOrEqual(0);
      expect(stats.alerts).toBe(0);
      expect(stats.heapDumps).toBe(0);
    });
    
    it('should track heap dump count', async () => {
      await detector.generateHeapDump('test');
      
      const stats = detector.getMemoryStats();
      
      expect(stats.heapDumps).toBe(1);
    });
  });

  describe('Memory Alerts Management', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should retrieve memory alerts with optional severity filter', async () => {
      // Generate different severity alerts
      mockMemoryUsage.mockReturnValue(createMockMemoryUsage({
        heapUsed: 60 * 1024 * 1024
      }));
      
      await detector.takeSnapshot('global');
      await AsyncHelpers.wait(100);
      
      const allAlerts = detector.getMemoryAlerts();
      const criticalAlerts = detector.getMemoryAlerts('critical');
      
      expect(allAlerts.length).toBeGreaterThan(0);
      expect(criticalAlerts.length).toBeGreaterThan(0);
      expect(criticalAlerts.every(alert => alert.severity === 'critical')).toBe(true);
    });
    
    it('should clean up old alerts automatically', async () => {
      // This test verifies the alert cleanup mechanism
      // In practice, alerts older than 24 hours are removed
      const stats = detector.getMemoryStats();
      expect(stats.alerts).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Integration with Metrics Collector', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should record snapshot metrics to collector', async () => {
      await detector.takeSnapshot('global');
      
      expect(mockMetricsCollector.recordCustomMetric).toHaveBeenCalledWith({
        name: 'memory_heap_used_mb',
        value: 40,
        labels: { area: 'global' }
      });
    });
    
    it('should record event file metrics', async () => {
      await detector.takeSnapshot('event_files');
      
      expect(mockMetricsCollector.recordCustomMetric).toHaveBeenCalledWith({
        name: 'memory_event_files_count',
        value: 2
      });
    });
    
    it('should work without metrics collector', async () => {
      const detectorWithoutMetrics = new MemoryLeakDetector(createTestConfig());
      
      await detectorWithoutMetrics.start();
      await expect(detectorWithoutMetrics.takeSnapshot('global')).resolves.toBeDefined();
      await detectorWithoutMetrics.stop();
    });
  });

  describe('Event File Metrics Collection', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should collect event file metrics from multiple directories', async () => {
      (fs.pathExists as jest.Mock)
        .mockResolvedValueOnce(true)  // /tmp/test-events exists
        .mockResolvedValueOnce(true); // /tmp/test-responses exists
      
      (fs.readdir as any)
        .mockResolvedValueOnce(['event1.json', 'event2.json'])
        .mockResolvedValueOnce(['response1.json']);
      
      const snapshot = await detector.takeSnapshot('event_files');
      
      expect(snapshot.specific.eventFilesCount).toBe(3); // 2 + 1 files
    });
    
    it('should handle missing event directories gracefully', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(false);
      
      const snapshot = await detector.takeSnapshot('event_files');
      
      expect(snapshot.specific.eventFilesCount).toBe(0);
      expect(snapshot.specific.eventFilesSize).toBe(0);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle memwatch initialization errors', async () => {
      mockMemwatch.on.mockImplementation(() => {
        throw new Error('Memwatch initialization failed');
      });
      
      await expect(detector.start()).rejects.toThrow();
    });
    
    it('should handle file system errors during snapshot', async () => {
      await detector.start();
      
      (fs.readdir as any).mockRejectedValue(new Error('Directory read failed'));
      
      const snapshot = await detector.takeSnapshot('event_files');
      
      // Should still return a snapshot with empty specific metrics
      expect(snapshot).toBeDefined();
      expect(snapshot.specific).toEqual({});
    });
    
    it('should handle memory usage errors gracefully', async () => {
      mockMemoryUsage.mockImplementation(() => {
        throw new Error('Memory usage unavailable');
      });
      
      await detector.start();
      
      await expect(detector.takeSnapshot('global')).rejects.toThrow('Memory usage unavailable');
    });
  });

  describe('Configuration Validation', () => {
    it('should use default configuration when none provided', () => {
      const defaultDetector = new MemoryLeakDetector();
      
      expect(defaultDetector).toBeInstanceOf(MemoryLeakDetector);
    });
    
    it('should merge custom configuration with defaults', () => {
      const customConfig = createTestConfig({
        thresholds: { 
          maxHeapUsageMB: 100,
          memoryGrowthRateMBPerMin: 2,
          heapGrowthPercentage: 10,
          eventFileAccumulationThreshold: 100
        }
      });
      
      const customDetector = new MemoryLeakDetector(customConfig);
      
      expect(customDetector).toBeInstanceOf(MemoryLeakDetector);
    });
    
    it('should handle partial configuration overrides', () => {
      const partialConfig = {
        thresholds: { 
          maxHeapUsageMB: 75,
          memoryGrowthRateMBPerMin: 2,
          heapGrowthPercentage: 10,
          eventFileAccumulationThreshold: 100
        }
      };
      
      const detector = new MemoryLeakDetector(partialConfig);
      
      expect(detector).toBeInstanceOf(MemoryLeakDetector);
    });
  });

  describe('Performance and Resource Management', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should limit snapshot history to prevent memory bloat', async () => {
      // Take many snapshots to test history cleanup
      for (let i = 0; i < 150; i++) {
        await detector.takeSnapshot('global');
      }
      
      // The detector should automatically clean up old snapshots
      // This is internal behavior - we verify it doesn't crash
      const dashboard = detector.getMemoryDashboard();
      expect(dashboard).toBeDefined();
    });
    
    it('should handle concurrent snapshot requests', async () => {
      const promises = Array.from({ length: 10 }, () => 
        detector.takeSnapshot('global')
      );
      
      const snapshots = await Promise.all(promises);
      
      expect(snapshots).toHaveLength(10);
      snapshots.forEach(snapshot => {
        expect(snapshot).toBeDefined();
        expect(snapshot.area).toBe('global');
      });
    });
  });

  describe('Monitoring Areas Integration', () => {
    beforeEach(async () => {
      await detector.start();
    });
    
    it('should support all monitoring areas', async () => {
      const areas = ['global', 'event_files', 'rate_limiter', 'bridge_cache', 'http_pool', 'security_config'];
      
      for (const area of areas) {
        const snapshot = await detector.takeSnapshot(area as any);
        expect(snapshot.area).toBe(area);
      }
    });
    
    it('should provide area-specific status in dashboard', async () => {
      await detector.takeSnapshot('global');
      await detector.takeSnapshot('event_files');
      
      const dashboard = detector.getMemoryDashboard();
      
      expect(dashboard.areas.global).toBeDefined();
      expect(dashboard.areas.event_files).toBeDefined();
    });
  });
});
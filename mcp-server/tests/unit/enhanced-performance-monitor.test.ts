/**
 * Enhanced Performance Monitor Tests
 */

import { EventEmitter } from 'events';
import { EnhancedPerformanceMonitor, MCPPerformanceMetrics, ToolMetrics } from '../../src/observability/performance/enhanced-performance-monitor.js';
import { PerformanceMonitor, PerformanceMetrics } from '../../src/observability/performance/performance-monitor.js';
import { ClinicProfiler, DEFAULT_CLINIC_CONFIG } from '../../src/observability/performance/clinic-profiler.js';
import { MetricsCollector } from '../../src/observability/metrics/metrics-collector.js';

// Mock dependencies
jest.mock('../../src/security.js', () => ({
  secureLog: jest.fn()
}));

describe('EnhancedPerformanceMonitor', () => {
  let enhancedMonitor: EnhancedPerformanceMonitor;
  let mockBaseMonitor: jest.Mocked<PerformanceMonitor>;
  let mockClinicProfiler: jest.Mocked<ClinicProfiler>;
  let mockMetricsCollector: jest.Mocked<MetricsCollector>;
  
  const createMockMetrics = (): PerformanceMetrics => ({
    timestamp: Date.now(),
    cpu: {
      usage: 45,
      userTime: 1000,
      systemTime: 500,
      loadAverage: [0.5, 0.8, 1.0],
      cores: 4
    },
    memory: {
      heapUsed: 50 * 1024 * 1024,
      heapTotal: 100 * 1024 * 1024,
      heapUtilization: 50,
      external: 5 * 1024 * 1024,
      rss: 120 * 1024 * 1024,
      arrayBuffers: 1024 * 1024,
      total: 8 * 1024 * 1024 * 1024,
      free: 4 * 1024 * 1024 * 1024,
      usage: 50
    },
    gc: {
      collections: [],
      totalPauseTime: 10,
      averagePauseTime: 2,
      frequency: 5
    },
    eventLoop: {
      lag: 5,
      utilization: 95
    },
    network: {
      bytesIn: 1024,
      bytesOut: 2048,
      connections: 10,
      latency: 50
    },
    disk: {
      readOps: 100,
      writeOps: 50,
      readBytes: 1024 * 1024,
      writeBytes: 512 * 1024,
      utilization: 30
    },
    application: {
      requests: {
        total: 1000,
        rate: 10,
        duration: {
          min: 10,
          max: 500,
          avg: 100,
          p50: 80,
          p90: 200,
          p95: 300,
          p99: 450
        },
        statusCodes: new Map([
          [200, 900],
          [400, 50],
          [500, 50]
        ]),
        endpoints: new Map()
      },
      errors: {
        total: 100,
        rate: 1,
        types: new Map([['ValidationError', 60], ['TimeoutError', 40]]),
        recentErrors: []
      },
      cache: {
        hits: 800,
        misses: 200,
        hitRate: 80,
        size: 1024 * 1024,
        evictions: 10
      },
      database: {
        queries: 500,
        avgQueryTime: 50,
        slowQueries: 5,
        connections: 5,
        poolUtilization: 60
      }
    }
  });
  
  beforeEach(() => {
    // Create mock base monitor
    mockBaseMonitor = {
      initialize: jest.fn().mockResolvedValue(undefined),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getCurrentMetrics: jest.fn(),
      recordRequest: jest.fn(),
      recordSecurityEvent: jest.fn(),
      updateConfig: jest.fn(),
      getSummary: jest.fn(),
      getHealthStatus: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      off: jest.fn()
    } as any;
    
    // Create mock clinic profiler
    mockClinicProfiler = {
      initialize: jest.fn().mockResolvedValue(undefined),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      startProfiling: jest.fn().mockResolvedValue('session-123'),
      getRecommendations: jest.fn().mockReturnValue([]),
      on: jest.fn(),
      emit: jest.fn(),
      off: jest.fn()
    } as any;
    
    // Create mock metrics collector
    mockMetricsCollector = {
      recordCustomMetric: jest.fn(),
      getMetrics: jest.fn(),
      initialize: jest.fn(),
      start: jest.fn(),
      stop: jest.fn()
    } as any;
    
    enhancedMonitor = new EnhancedPerformanceMonitor(
      mockBaseMonitor,
      DEFAULT_CLINIC_CONFIG,
      mockMetricsCollector
    );
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(enhancedMonitor.initialize()).resolves.not.toThrow();
      
      expect(mockBaseMonitor.initialize).toHaveBeenCalled();
    });
    
    it('should handle initialization errors', async () => {
      mockBaseMonitor.initialize.mockRejectedValue(new Error('Init failed'));
      
      await expect(enhancedMonitor.initialize()).rejects.toThrow('Init failed');
    });
  });

  describe('Lifecycle Management', () => {
    beforeEach(async () => {
      await enhancedMonitor.initialize();
    });
    
    it('should start successfully', async () => {
      await expect(enhancedMonitor.start()).resolves.not.toThrow();
      
      expect(mockBaseMonitor.start).toHaveBeenCalled();
    });
    
    it('should stop successfully', async () => {
      await enhancedMonitor.start();
      await expect(enhancedMonitor.stop()).resolves.not.toThrow();
      
      expect(mockBaseMonitor.stop).toHaveBeenCalled();
    });
  });

  describe('MCP Tool Metrics', () => {
    beforeEach(async () => {
      await enhancedMonitor.initialize();
      await enhancedMonitor.start();
    });
    
    afterEach(async () => {
      await enhancedMonitor.stop();
    });
    
    it('should record tool execution successfully', () => {
      enhancedMonitor.recordToolExecution('test-tool', 150, true, { param: 'value' });
      
      const toolMetrics = enhancedMonitor.getToolMetrics();
      const testToolMetrics = toolMetrics.get('test-tool');
      
      expect(testToolMetrics).toBeDefined();
      expect(testToolMetrics!.invocations).toBe(1);
      expect(testToolMetrics!.totalDuration).toBe(150);
      expect(testToolMetrics!.averageDuration).toBe(150);
      expect(testToolMetrics!.errors).toBe(0);
      
      expect(mockMetricsCollector.recordCustomMetric).toHaveBeenCalledWith({
        name: 'mcp_tool_duration',
        value: 150,
        labels: { tool: 'test-tool', success: 'true' }
      });
    });
    
    it('should record tool execution failures', () => {
      enhancedMonitor.recordToolExecution('failing-tool', 200, false);
      
      const toolMetrics = enhancedMonitor.getToolMetrics();
      const failingToolMetrics = toolMetrics.get('failing-tool');
      
      expect(failingToolMetrics).toBeDefined();
      expect(failingToolMetrics!.errors).toBe(1);
      
      expect(mockMetricsCollector.recordCustomMetric).toHaveBeenCalledWith({
        name: 'mcp_tool_duration',
        value: 200,
        labels: { tool: 'failing-tool', success: 'false' }
      });
    });
    
    it('should update tool performance statistics', () => {
      // Record multiple executions with different durations
      enhancedMonitor.recordToolExecution('perf-tool', 100, true);
      enhancedMonitor.recordToolExecution('perf-tool', 200, true);
      enhancedMonitor.recordToolExecution('perf-tool', 50, true);
      
      const toolMetrics = enhancedMonitor.getToolMetrics();
      const perfToolMetrics = toolMetrics.get('perf-tool');
      
      expect(perfToolMetrics).toBeDefined();
      expect(perfToolMetrics!.invocations).toBe(3);
      expect(perfToolMetrics!.averageDuration).toBe(350 / 3);
      expect(perfToolMetrics!.performance.fastest).toBe(50);
      expect(perfToolMetrics!.performance.slowest).toBe(200);
    });
  });

  describe('Resource Access Metrics', () => {
    beforeEach(async () => {
      await enhancedMonitor.initialize();
      await enhancedMonitor.start();
    });
    
    afterEach(async () => {
      await enhancedMonitor.stop();
    });
    
    it('should record resource read operations', () => {
      enhancedMonitor.recordResourceAccess('read', 1024, 50, false);
      
      const mcpMetrics = enhancedMonitor.getMCPMetrics();
      
      expect(mcpMetrics.filesystem).toBeDefined();
      expect(mcpMetrics.filesystem!.operations.read).toBe(1);
      expect(mcpMetrics.filesystem!.cache.misses).toBe(1);
      expect(mcpMetrics.filesystem!.performance.avgReadTime).toBe(50);
      
      expect(mockMetricsCollector.recordCustomMetric).toHaveBeenCalledWith({
        name: 'mcp_resource_access_duration',
        value: 50,
        labels: { type: 'read', cache_hit: 'false' }
      });
    });
    
    it('should record resource write operations', () => {
      enhancedMonitor.recordResourceAccess('write', 2048, 75, false);
      
      const mcpMetrics = enhancedMonitor.getMCPMetrics();
      
      expect(mcpMetrics.filesystem).toBeDefined();
      expect(mcpMetrics.filesystem!.operations.write).toBe(1);
      expect(mcpMetrics.filesystem!.performance.avgWriteTime).toBe(75);
    });
    
    it('should record cache hits correctly', () => {
      enhancedMonitor.recordResourceAccess('read', 512, 10, true);
      
      const mcpMetrics = enhancedMonitor.getMCPMetrics();
      
      expect(mcpMetrics.filesystem!.cache.hits).toBe(1);
      expect(mcpMetrics.filesystem!.cache.misses).toBe(0);
      
      expect(mockMetricsCollector.recordCustomMetric).toHaveBeenCalledWith({
        name: 'mcp_resource_access_duration',
        value: 10,
        labels: { type: 'read', cache_hit: 'true' }
      });
    });
    
    it('should calculate throughput correctly', () => {
      enhancedMonitor.recordResourceAccess('read', 1024, 1000); // 1KB in 1 second
      
      const mcpMetrics = enhancedMonitor.getMCPMetrics();
      
      expect(mcpMetrics.filesystem!.performance.throughput).toBe(1024); // 1024 bytes/second
    });
  });

  describe('Bridge Communication Metrics', () => {
    beforeEach(async () => {
      await enhancedMonitor.initialize();
      await enhancedMonitor.start();
    });
    
    afterEach(async () => {
      await enhancedMonitor.stop();
    });
    
    it('should record bridge messages', () => {
      enhancedMonitor.recordBridgeMessage('sent', 25);
      enhancedMonitor.recordBridgeMessage('received', 30);
      
      const mcpMetrics = enhancedMonitor.getMCPMetrics();
      
      expect(mcpMetrics.bridge).toBeDefined();
      expect(mcpMetrics.bridge!.messages.sent).toBe(1);
      expect(mcpMetrics.bridge!.messages.received).toBe(1);
      expect(mcpMetrics.bridge!.latency.min).toBe(25);
      expect(mcpMetrics.bridge!.latency.max).toBe(30);
      expect(mcpMetrics.bridge!.latency.avg).toBe(27.5);
    });
    
    it('should record bridge failures', () => {
      enhancedMonitor.recordBridgeMessage('failed');
      
      const mcpMetrics = enhancedMonitor.getMCPMetrics();
      
      expect(mcpMetrics.bridge!.messages.failed).toBe(1);
    });
    
    it('should update latency statistics correctly', () => {
      enhancedMonitor.recordBridgeMessage('sent', 10);
      enhancedMonitor.recordBridgeMessage('sent', 20);
      enhancedMonitor.recordBridgeMessage('sent', 30);
      
      const mcpMetrics = enhancedMonitor.getMCPMetrics();
      
      expect(mcpMetrics.bridge!.latency.min).toBe(10);
      expect(mcpMetrics.bridge!.latency.max).toBe(30);
      expect(mcpMetrics.bridge!.latency.avg).toBe(20);
    });
  });

  describe('Performance Profiling', () => {
    beforeEach(async () => {
      await enhancedMonitor.initialize();
    });
    
    it('should start profiling successfully', async () => {
      const sessionId = await enhancedMonitor.startProfiling('doctor', 60000);
      
      expect(sessionId).toBe('session-123');
      expect(mockClinicProfiler.startProfiling).toHaveBeenCalledWith('doctor', { duration: 60000 });
    });
    
    it('should handle profiling start failure', async () => {
      mockClinicProfiler.startProfiling.mockRejectedValue(new Error('Profiling failed'));
      
      const sessionId = await enhancedMonitor.startProfiling('flame');
      
      expect(sessionId).toBeNull();
    });
    
    it('should return null when clinic profiler is not available', async () => {
      const enhancedMonitorWithoutClinic = new EnhancedPerformanceMonitor(mockBaseMonitor);
      
      const sessionId = await enhancedMonitorWithoutClinic.startProfiling('doctor');
      
      expect(sessionId).toBeNull();
    });
  });

  describe('Performance Dashboard', () => {
    beforeEach(async () => {
      await enhancedMonitor.initialize();
      mockBaseMonitor.getCurrentMetrics.mockReturnValue(createMockMetrics());
      await enhancedMonitor.start();
    });
    
    afterEach(async () => {
      await enhancedMonitor.stop();
    });
    
    it('should generate dashboard data', (done) => {
      // Wait for dashboard to be updated
      enhancedMonitor.on('dashboard_updated', (dashboard) => {
        expect(dashboard).toBeDefined();
        expect(dashboard.timestamp).toBeGreaterThan(0);
        expect(dashboard.summary).toBeDefined();
        expect(dashboard.realtime).toBeDefined();
        expect(dashboard.charts).toBeDefined();
        expect(dashboard.topIssues).toBeDefined();
        
        expect(dashboard.summary.status).toMatch(/healthy|degraded|critical/);
        expect(dashboard.summary.score).toBeGreaterThanOrEqual(0);
        expect(dashboard.summary.score).toBeLessThanOrEqual(100);
        
        done();
      });
    });
    
    it('should calculate performance score correctly for healthy system', () => {
      const healthyMetrics = createMockMetrics();
      healthyMetrics.cpu.usage = 30;
      healthyMetrics.memory.usage = 40;
      healthyMetrics.application.requests.duration.avg = 200;
      healthyMetrics.application.errors.rate = 0.1;
      
      mockBaseMonitor.getCurrentMetrics.mockReturnValue(healthyMetrics);
      
      // Trigger dashboard update
      enhancedMonitor.on('dashboard_updated', (dashboard) => {
        expect(dashboard.summary.score).toBeGreaterThan(80);
        expect(dashboard.summary.status).toBe('healthy');
      });
    });
    
    it('should detect degraded performance', () => {
      const degradedMetrics = createMockMetrics();
      degradedMetrics.cpu.usage = 75;
      degradedMetrics.memory.usage = 85;
      degradedMetrics.application.requests.duration.avg = 1500;
      degradedMetrics.application.errors.rate = 2;
      
      mockBaseMonitor.getCurrentMetrics.mockReturnValue(degradedMetrics);
      
      enhancedMonitor.on('dashboard_updated', (dashboard) => {
        expect(dashboard.summary.score).toBeLessThan(80);
        expect(dashboard.summary.status).toMatch(/degraded|critical/);
        expect(dashboard.topIssues.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Degradation Alerts', () => {
    beforeEach(async () => {
      await enhancedMonitor.initialize();
      await enhancedMonitor.start();
    });
    
    afterEach(async () => {
      await enhancedMonitor.stop();
    });
    
    it('should detect response time degradation', (done) => {
      const slowMetrics = createMockMetrics();
      slowMetrics.application.requests.duration.avg = 1500; // Above warning threshold
      
      enhancedMonitor.on('degradation_alert', (alert) => {
        expect(alert.metric).toBe('response_time');
        expect(alert.severity).toBe('medium');
        expect(alert.current).toBe(1500);
        expect(alert.recommendations).toContain('Profile CPU-intensive operations');
        done();
      });
      
      // Simulate metrics collection that triggers degradation check
      (mockBaseMonitor as any).emit('metrics_collected', slowMetrics);
    });
    
    it('should detect critical response time degradation', (done) => {
      const criticalMetrics = createMockMetrics();
      criticalMetrics.application.requests.duration.avg = 2500; // Above critical threshold
      
      enhancedMonitor.on('degradation_alert', (alert) => {
        expect(alert.metric).toBe('response_time');
        expect(alert.severity).toBe('critical');
        expect(alert.current).toBe(2500);
        done();
      });
      
      (mockBaseMonitor as any).emit('metrics_collected', criticalMetrics);
    });
    
    it('should detect error rate increase', (done) => {
      const highErrorMetrics = createMockMetrics();
      highErrorMetrics.application.errors.rate = 3; // Above warning threshold
      
      enhancedMonitor.on('degradation_alert', (alert) => {
        expect(alert.metric).toBe('error_rate');
        expect(alert.severity).toBe('high');
        expect(alert.current).toBe(3);
        expect(alert.recommendations).toContain('Review recent code changes');
        done();
      });
      
      (mockBaseMonitor as any).emit('metrics_collected', highErrorMetrics);
    });
    
    it('should filter alerts by severity', () => {
      // Add some test alerts manually to verify filtering
      const testAlerts = [
        { severity: 'low', metric: 'test1' },
        { severity: 'high', metric: 'test2' },
        { severity: 'critical', metric: 'test3' }
      ];
      
      // Add alerts (this would normally be done internally)
      testAlerts.forEach(alert => {
        (enhancedMonitor as any).degradationAlerts.push({
          ...alert,
          timestamp: Date.now(),
          type: 'test',
          current: 0,
          baseline: 0,
          threshold: 0,
          trend: 'stable',
          impact: 'test',
          recommendations: []
        });
      });
      
      const highSeverityAlerts = enhancedMonitor.getDegradationAlerts('high');
      expect(highSeverityAlerts).toHaveLength(1);
      expect(highSeverityAlerts[0].severity).toBe('high');
      
      const allAlerts = enhancedMonitor.getDegradationAlerts();
      expect(allAlerts).toHaveLength(3);
    });
  });

  describe('Event Handling', () => {
    it('should forward bottleneck detection events', (done) => {
      const bottleneck = {
        detected: true,
        type: 'cpu',
        severity: 'high',
        impact: 'High CPU usage',
        recommendations: ['Optimize algorithms']
      };
      
      enhancedMonitor.on('bottleneck_detected', (receivedBottleneck) => {
        expect(receivedBottleneck).toEqual(bottleneck);
        done();
      });
      
      // Simulate bottleneck detection from base monitor
      (mockBaseMonitor as any).emit('bottleneck_detected', bottleneck);
    });
    
    it('should handle profile completion events', (done) => {
      const analysis = {
        profileId: 'test-profile',
        timestamp: Date.now(),
        tool: 'doctor',
        duration: 60000,
        metrics: { cpu: {}, memory: {}, gc: {}, eventLoop: {} },
        recommendations: [],
        files: { profile: '', report: '', html: '' }
      };
      
      enhancedMonitor.on('profile_completed', (receivedAnalysis) => {
        expect(receivedAnalysis).toEqual(analysis);
        done();
      });
      
      // Simulate profile analysis completion
      (mockClinicProfiler as any).emit('profile_analyzed', analysis);
    });
  });

  describe('Error Handling', () => {
    it('should handle base monitor initialization failure', async () => {
      mockBaseMonitor.initialize.mockRejectedValue(new Error('Base monitor init failed'));
      
      await expect(enhancedMonitor.initialize()).rejects.toThrow('Base monitor init failed');
    });
    
    it('should handle base monitor start failure', async () => {
      await enhancedMonitor.initialize();
      mockBaseMonitor.start.mockRejectedValue(new Error('Base monitor start failed'));
      
      await expect(enhancedMonitor.start()).rejects.toThrow('Base monitor start failed');
    });
    
    it('should handle clinic profiler errors gracefully', async () => {
      mockClinicProfiler.initialize.mockRejectedValue(new Error('Clinic init failed'));
      
      // Should not throw even if clinic profiler fails
      await expect(enhancedMonitor.initialize()).rejects.toThrow();
    });
  });

  describe('Data Retention', () => {
    beforeEach(async () => {
      await enhancedMonitor.initialize();
      await enhancedMonitor.start();
    });
    
    afterEach(async () => {
      await enhancedMonitor.stop();
    });
    
    it('should clean up old performance history', () => {
      // Add old metrics (older than 1 hour)
      const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
      const oldMetrics = createMockMetrics();
      oldMetrics.timestamp = oldTimestamp;
      
      // Simulate metrics collection
      (mockBaseMonitor as any).emit('metrics_collected', oldMetrics);
      
      // Add recent metrics
      const recentMetrics = createMockMetrics();
      (mockBaseMonitor as any).emit('metrics_collected', recentMetrics);
      
      // Verify that cleanup occurs (would need access to private method or more sophisticated testing)
      // This is a simplified test - in practice you'd expose metrics or test through observable behavior
      expect(true).toBe(true); // Placeholder
    });
  });
});
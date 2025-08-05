/**
 * Enhanced Performance Monitor with Clinic.js Integration
 * 
 * Extends the base PerformanceMonitor with clinic.js profiling capabilities,
 * MCP-specific metrics, and comprehensive performance dashboards.
 */

import { EventEmitter } from 'events';
import { PerformanceMonitor, PerformanceMetrics } from './performance-monitor.js';
import { ClinicProfiler, ClinicProfilerConfig, ProfileAnalysis } from './clinic-profiler.js';
import { MetricsCollector } from '../metrics/metrics-collector.js';
import { 
  MemoryLeakDetector, 
  MemoryLeakConfig, 
  MemoryLeakAlert, 
  MemoryDashboard,
  DEFAULT_MEMORY_LEAK_CONFIG 
} from './memory-leak-detector.js';
import { secureLog } from '../../security.js';

/**
 * MCP-specific performance metrics
 */
export interface MCPPerformanceMetrics {
  timestamp: number;
  
  // MCP protocol metrics
  mcp: {
    requests: {
      total: number;
      rate: number; // requests per second
      duration: {
        avg: number;
        p50: number;
        p90: number;
        p95: number;
        p99: number;
      };
      byTool: Map<string, ToolMetrics>;
    };
    
    // Tool execution metrics
    tools: {
      total: number;
      successful: number;
      failed: number;
      averageDuration: number;
      slowest: Array<{
        tool: string;
        duration: number;
        timestamp: number;
      }>;
    };
    
    // Resource access metrics
    resources: {
      reads: number;
      writes: number;
      cacheHits: number;
      cacheMisses: number;
      averageSize: number;
    };
    
    // Connection metrics
    connections: {
      active: number;
      total: number;
      errors: number;
      reconnects: number;
      averageLifetime: number;
    };
  };
  
  // File system operation metrics
  filesystem: {
    operations: {
      read: number;
      write: number;
      delete: number;
      list: number;
    };
    performance: {
      avgReadTime: number;
      avgWriteTime: number;
      ioWait: number;
      throughput: number; // bytes per second
    };
    cache: {
      hits: number;
      misses: number;
      size: number;
      evictions: number;
    };
  };
  
  // Bridge communication metrics
  bridge: {
    messages: {
      sent: number;
      received: number;
      failed: number;
      retries: number;
    };
    latency: {
      avg: number;
      min: number;
      max: number;
      distribution: number[]; // latency histogram
    };
    health: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      uptime: number;
      lastCheck: number;
    };
  };
}

/**
 * Tool-specific performance metrics
 */
export interface ToolMetrics {
  name: string;
  invocations: number;
  totalDuration: number;
  averageDuration: number;
  errors: number;
  lastUsed: number;
  performance: {
    fastest: number;
    slowest: number;
    p95: number;
  };
}

/**
 * Performance degradation alert
 */
export interface PerformanceDegradationAlert {
  timestamp: number;
  type: 'regression' | 'threshold_breach' | 'anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: string;
  current: number;
  baseline: number;
  threshold: number;
  trend: 'improving' | 'stable' | 'degrading';
  impact: string;
  recommendations: string[];
}

/**
 * Performance dashboard data
 */
export interface PerformanceDashboard {
  timestamp: number;
  summary: {
    status: 'healthy' | 'degraded' | 'critical';
    score: number; // 0-100 overall performance score
    alerts: number;
    trends: {
      responseTime: 'improving' | 'stable' | 'degrading';
      throughput: 'improving' | 'stable' | 'degrading';
      errors: 'improving' | 'stable' | 'degrading';
      memory: 'improving' | 'stable' | 'degrading';
    };
  };
  
  realtime: {
    timestamp: number;
    cpu: number;
    memory: number;
    responseTime: number;
    throughput: number;
    errorRate: number;
    activeConnections: number;
    memoryLeaks: number;
  };
  
  charts: {
    responseTime: ChartData;
    throughput: ChartData;
    errorRate: ChartData;
    resourceUsage: ChartData;
    toolPerformance: ChartData;
    memoryUsage: ChartData;
  };
  
  topIssues: Array<{
    type: string;
    description: string;
    severity: string;
    count: number;
  }>;
  
  // Memory leak monitoring
  memory?: MemoryDashboard;
}

/**
 * Chart data structure
 */
export interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    borderColor?: string;
    backgroundColor?: string;
  }>;
}

/**
 * Enhanced Performance Monitor
 * 
 * Combines base performance monitoring with clinic.js profiling,
 * MCP-specific metrics, and real-time dashboards.
 */
export class EnhancedPerformanceMonitor extends EventEmitter {
  private baseMonitor: PerformanceMonitor;
  private clinicProfiler?: ClinicProfiler;
  private metricsCollector?: MetricsCollector;
  private memoryLeakDetector?: MemoryLeakDetector;
  
  // MCP metrics tracking
  private mcpMetrics: Partial<MCPPerformanceMetrics> = {};
  private toolMetrics: Map<string, ToolMetrics> = new Map();
  private performanceHistory: PerformanceMetrics[] = [];
  private mcpMetricsHistory: MCPPerformanceMetrics[] = [];
  private degradationAlerts: PerformanceDegradationAlert[] = [];
  private memoryAlerts: MemoryLeakAlert[] = [];
  
  // Real-time data for dashboard
  private dashboardData: PerformanceDashboard | null = null;
  private dashboardUpdateInterval?: NodeJS.Timeout;
  
  // Configuration
  private readonly historyRetention = 3600000; // 1 hour
  private readonly alertThresholds = {
    responseTime: { warning: 1000, critical: 2000 }, // ms
    errorRate: { warning: 1, critical: 5 }, // %
    cpuUsage: { warning: 70, critical: 85 }, // %
    memoryUsage: { warning: 80, critical: 90 }, // %
    throughputDrop: { warning: 20, critical: 50 } // % decrease
  };
  
  constructor(
    baseMonitor: PerformanceMonitor,
    clinicConfig?: ClinicProfilerConfig,
    metricsCollector?: MetricsCollector,
    memoryLeakConfig?: Partial<MemoryLeakConfig>
  ) {
    super();
    this.baseMonitor = baseMonitor;
    this.metricsCollector = metricsCollector;
    
    if (clinicConfig) {
      this.clinicProfiler = new ClinicProfiler(clinicConfig);
    }
    
    // Initialize memory leak detector
    this.memoryLeakDetector = new MemoryLeakDetector(
      memoryLeakConfig || DEFAULT_MEMORY_LEAK_CONFIG,
      metricsCollector
    );
    
    this.setupEventHandlers();
    
    secureLog('info', 'Enhanced performance monitor initialized', {
      hasClinicProfiler: !!this.clinicProfiler,
      hasMetricsCollector: !!this.metricsCollector,
      hasMemoryLeakDetector: !!this.memoryLeakDetector
    });
  }

  /**
   * Initialize the enhanced performance monitor
   */
  public async initialize(): Promise<void> {
    try {
      // Initialize base monitor
      await this.baseMonitor.initialize();
      
      // Initialize clinic profiler if available
      if (this.clinicProfiler) {
        await this.clinicProfiler.initialize();
      }
      
      // Initialize memory leak detector
      if (this.memoryLeakDetector) {
        await this.memoryLeakDetector.start();
      }
      
      secureLog('info', 'Enhanced performance monitor initialized successfully');
      
    } catch (error) {
      secureLog('error', 'Failed to initialize enhanced performance monitor', {
        error: error instanceof Error ? error.message : 'unknown'  
      });
      throw error;
    }
  }

  /**
   * Start enhanced monitoring
   */
  public async start(): Promise<void> {
    try {
      // Start base monitor
      await this.baseMonitor.start();
      
      // Start clinic profiler if available
      if (this.clinicProfiler) {
        await this.clinicProfiler.start();
      }
      
      // Memory leak detector is already started in initialize()
      
      // Start dashboard updates
      this.startDashboardUpdates();
      
      secureLog('info', 'Enhanced performance monitoring started');
      this.emit('started');
      
    } catch (error) {
      secureLog('error', 'Failed to start enhanced performance monitoring', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Stop enhanced monitoring
   */
  public async stop(): Promise<void> {
    try {
      // Stop dashboard updates
      if (this.dashboardUpdateInterval) {
        clearInterval(this.dashboardUpdateInterval);
        this.dashboardUpdateInterval = undefined;
      }
      
      // Stop memory leak detector
      if (this.memoryLeakDetector) {
        await this.memoryLeakDetector.stop();
      }
      
      // Stop clinic profiler if available
      if (this.clinicProfiler) {
        await this.clinicProfiler.stop();
      }
      
      // Stop base monitor
      await this.baseMonitor.stop();
      
      secureLog('info', 'Enhanced performance monitoring stopped');
      this.emit('stopped');
      
    } catch (error) {
      secureLog('error', 'Failed to stop enhanced performance monitoring', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Record MCP tool execution
   */
  public recordToolExecution(
    toolName: string,
    duration: number,
    success: boolean,
    metadata?: Record<string, any>
  ): void {
    const now = Date.now();
    
    // Update tool-specific metrics
    const existing = this.toolMetrics.get(toolName) || {
      name: toolName,
      invocations: 0,
      totalDuration: 0,
      averageDuration: 0,
      errors: 0,
      lastUsed: 0,
      performance: {
        fastest: Infinity,
        slowest: 0,
        p95: 0
      }
    };
    
    existing.invocations++;
    existing.totalDuration += duration;
    existing.averageDuration = existing.totalDuration / existing.invocations;
    existing.lastUsed = now;
    
    if (!success) {
      existing.errors++;
    }
    
    // Update performance stats
    existing.performance.fastest = Math.min(existing.performance.fastest, duration);
    existing.performance.slowest = Math.max(existing.performance.slowest, duration);
    
    this.toolMetrics.set(toolName, existing);
    
    // Record in metrics collector if available
    if (this.metricsCollector) {
      this.metricsCollector.recordCustomMetric({
        name: 'mcp_tool_duration',
        value: duration,
        labels: { tool: toolName, success: success.toString() }
      });
      
      this.metricsCollector.recordCustomMetric({
        name: 'mcp_tool_invocations_total',
        value: 1,
        labels: { tool: toolName }
      });
    }
    
    secureLog('debug', 'Tool execution recorded', {
      toolName,
      duration,
      success,
      totalInvocations: existing.invocations
    });
  }

  /**
   * Record MCP resource access
   */
  public recordResourceAccess(
    type: 'read' | 'write',
    size: number,
    duration: number,
    cacheHit: boolean = false
  ): void {
    // Update MCP metrics
    if (!this.mcpMetrics.filesystem) {
      this.mcpMetrics.filesystem = {
        operations: { read: 0, write: 0, delete: 0, list: 0 },
        performance: { avgReadTime: 0, avgWriteTime: 0, ioWait: 0, throughput: 0 },
        cache: { hits: 0, misses: 0, size: 0, evictions: 0 }
      };
    }
    
    this.mcpMetrics.filesystem.operations[type]++;
    
    if (cacheHit) {
      this.mcpMetrics.filesystem.cache.hits++;
    } else {
      this.mcpMetrics.filesystem.cache.misses++;
    }
    
    // Update performance metrics
    const perfKey = type === 'read' ? 'avgReadTime' : 'avgWriteTime';
    const currentAvg = this.mcpMetrics.filesystem.performance[perfKey];
    const totalOps = this.mcpMetrics.filesystem.operations[type];
    
    this.mcpMetrics.filesystem.performance[perfKey] = 
      (currentAvg * (totalOps - 1) + duration) / totalOps;
    
    // Calculate throughput (bytes per second)
    if (duration > 0) {
      this.mcpMetrics.filesystem.performance.throughput = size / (duration / 1000);
    }
    
    // Record in metrics collector if available
    if (this.metricsCollector) {
      this.metricsCollector.recordCustomMetric({
        name: 'mcp_resource_access_duration',
        value: duration,
        labels: { type, cache_hit: cacheHit.toString() }
      });
      
      this.metricsCollector.recordCustomMetric({
        name: 'mcp_resource_size_bytes',
        value: size,
        labels: { type }
      });
    }
  }

  /**
   * Record bridge communication metrics
   */
  public recordBridgeMessage(
    type: 'sent' | 'received' | 'failed',
    latency?: number
  ): void {
    if (!this.mcpMetrics.bridge) {
      this.mcpMetrics.bridge = {
        messages: { sent: 0, received: 0, failed: 0, retries: 0 },
        latency: { avg: 0, min: Infinity, max: 0, distribution: [] },
        health: { status: 'healthy', uptime: 0, lastCheck: Date.now() }
      };
    }
    
    this.mcpMetrics.bridge.messages[type]++;
    
    if (latency !== undefined && type !== 'failed') {
      const latencyMetrics = this.mcpMetrics.bridge.latency;
      
      // Update latency statistics
      latencyMetrics.min = Math.min(latencyMetrics.min, latency);
      latencyMetrics.max = Math.max(latencyMetrics.max, latency);
      
      // Calculate running average
      const totalMessages = this.mcpMetrics.bridge.messages.sent + 
                           this.mcpMetrics.bridge.messages.received;
      
      latencyMetrics.avg = (latencyMetrics.avg * (totalMessages - 1) + latency) / totalMessages;
    }
    
    // Record in metrics collector if available
    if (this.metricsCollector) {
      this.metricsCollector.recordCustomMetric({
        name: 'mcp_bridge_messages_total',
        value: 1,
        labels: { type }
      });
      
      if (latency !== undefined) {
        this.metricsCollector.recordCustomMetric({
          name: 'mcp_bridge_latency_ms',
          value: latency
        });
      }
    }
  }

  /**
   * Trigger performance profiling
   */
  public async startProfiling(
    tool: 'doctor' | 'flame' | 'bubbleprof' | 'heapprofiler',
    duration?: number
  ): Promise<string | null> {
    if (!this.clinicProfiler) {
      secureLog('warn', 'Clinic profiler not available');
      return null;
    }
    
    try {
      const sessionId = await this.clinicProfiler.startProfiling(tool, { duration });
      
      secureLog('info', 'Performance profiling started', {
        tool,
        sessionId,
        duration
      });
      
      return sessionId;
      
    } catch (error) {
      secureLog('error', 'Failed to start profiling', {
        tool,
        error: error instanceof Error ? error.message : 'unknown'
      });
      return null;
    }
  }

  /**
   * Get comprehensive performance dashboard
   */
  public getPerformanceDashboard(): PerformanceDashboard | null {
    return this.dashboardData;
  }

  /**
   * Get MCP-specific metrics
   */
  public getMCPMetrics(): Partial<MCPPerformanceMetrics> {
    return { ...this.mcpMetrics };
  }

  /**
   * Get tool performance metrics
   */
  public getToolMetrics(): Map<string, ToolMetrics> {
    return new Map(this.toolMetrics);
  }

  /**
   * Get performance degradation alerts
   */
  public getDegradationAlerts(severity?: string): PerformanceDegradationAlert[] {
    if (!severity) {
      return [...this.degradationAlerts];
    }
    
    return this.degradationAlerts.filter(alert => alert.severity === severity);
  }

  /**
   * Get profiling recommendations
   */
  public getProfilingRecommendations(): any[] {
    if (!this.clinicProfiler) {
      return [];
    }
    
    return this.clinicProfiler.getRecommendations();
  }

  /**
   * Get memory leak detector instance
   */
  public getMemoryLeakDetector(): MemoryLeakDetector | null {
    return this.memoryLeakDetector || null;
  }

  /**
   * Get memory dashboard data
   */
  public getMemoryDashboard(): MemoryDashboard | null {
    if (!this.memoryLeakDetector) {
      return null;
    }
    
    return this.memoryLeakDetector.getMemoryDashboard();
  }

  /**
   * Get memory alerts
   */
  public getMemoryAlerts(severity?: string): MemoryLeakAlert[] {
    if (!this.memoryLeakDetector) {
      return [];
    }
    
    return this.memoryLeakDetector.getMemoryAlerts(severity);
  }

  /**
   * Force memory analysis
   */
  public async analyzeMemory(): Promise<any> {
    if (!this.memoryLeakDetector) {
      return null;
    }
    
    return await this.memoryLeakDetector.analyzeHeap();
  }

  /**
   * Generate heap dump
   */
  public async generateHeapDump(reason?: string): Promise<string | null> {
    if (!this.memoryLeakDetector) {
      return null;
    }
    
    return await this.memoryLeakDetector.generateHeapDump(reason);
  }

  /**
   * Get memory statistics
   */
  public getMemoryStats(): any {
    if (!this.memoryLeakDetector) {
      return null;
    }
    
    return this.memoryLeakDetector.getMemoryStats();
  }

  /**
   * Setup event handlers for base monitor and clinic profiler
   */
  private setupEventHandlers(): void {
    // Base monitor events
    this.baseMonitor.on('metrics_collected', (metrics: PerformanceMetrics) => {
      this.performanceHistory.push(metrics);
      this.cleanupHistory();
      this.checkForDegradation(metrics);
      this.emit('metrics_updated', metrics);
    });
    
    this.baseMonitor.on('bottleneck_detected', (bottleneck: any) => {
      this.emit('bottleneck_detected', bottleneck);
    });
    
    // Clinic profiler events
    if (this.clinicProfiler) {
      this.clinicProfiler.on('profile_analyzed', (analysis: ProfileAnalysis) => {
        this.handleProfileAnalysis(analysis);
        this.emit('profile_completed', analysis);
      });
      
      this.clinicProfiler.on('profiling_failed', (error: any) => {
        this.emit('profiling_failed', error);
      });
    }
    
    // Memory leak detector events
    if (this.memoryLeakDetector) {
      this.memoryLeakDetector.on('memory_alert', (alert: MemoryLeakAlert) => {
        this.memoryAlerts.push(alert);
        this.emit('memory_leak_alert', alert);
        
        // Log critical memory alerts
        if (alert.severity === 'critical') {
          secureLog('error', 'Critical memory leak alert', {
            type: alert.type,
            area: alert.area,
            message: alert.message
          });
        }
      });
      
      this.memoryLeakDetector.on('heap_analyzed', (analysis: any) => {
        this.emit('heap_analysis_completed', analysis);
      });
      
      this.memoryLeakDetector.on('heap_dump_generated', (info: any) => {
        this.emit('heap_dump_generated', info);
      });
      
      this.memoryLeakDetector.on('cleanup_requested', (request: any) => {
        this.emit('memory_cleanup_requested', request);
      });
    }
  }

  /**
   * Start dashboard data updates
   */
  private startDashboardUpdates(): void {
    this.dashboardUpdateInterval = setInterval(() => {
      this.updateDashboardData();
    }, 10000); // Update every 10 seconds
    
    // Initial update
    this.updateDashboardData();
  }

  /**
   * Update dashboard data
   */
  private updateDashboardData(): void {
    const now = Date.now();
    const currentMetrics = this.baseMonitor.getCurrentMetrics();
    
    if (!currentMetrics) {
      return;
    }
    
    // Calculate overall performance score
    const score = this.calculatePerformanceScore(currentMetrics);
    
    // Determine status
    const status = this.getOverallStatus(currentMetrics, score);
    
    // Build dashboard data
    this.dashboardData = {
      timestamp: now,
      summary: {
        status,
        score,
        alerts: this.degradationAlerts.length,
        trends: this.calculateTrends()
      },
      
      realtime: {
        timestamp: now,
        cpu: currentMetrics.cpu.usage,
        memory: currentMetrics.memory.usage,
        responseTime: currentMetrics.application.requests.duration.avg,
        throughput: currentMetrics.application.requests.rate,
        errorRate: currentMetrics.application.errors.rate,
        activeConnections: this.mcpMetrics.bridge?.messages.sent || 0
      },
      
      charts: this.generateChartData(),
      
      topIssues: this.getTopIssues()
    };
    
    this.emit('dashboard_updated', this.dashboardData);
  }

  /**
   * Calculate overall performance score (0-100)
   */
  private calculatePerformanceScore(metrics: PerformanceMetrics): number {
    let score = 100;
    
    // CPU impact (0-25 points)
    const cpuPenalty = Math.max(0, (metrics.cpu.usage - 50) / 2);
    score -= Math.min(25, cpuPenalty);
    
    // Memory impact (0-25 points)
    const memoryPenalty = Math.max(0, (metrics.memory.usage - 60) / 2);
    score -= Math.min(25, memoryPenalty);
    
    // Response time impact (0-25 points)
    const responsePenalty = Math.max(0, (metrics.application.requests.duration.avg - 500) / 20);
    score -= Math.min(25, responsePenalty);
    
    // Error rate impact (0-25 points)
    const errorPenalty = metrics.application.errors.rate * 5;
    score -= Math.min(25, errorPenalty);
    
    return Math.max(0, Math.round(score));
  }

  /**
   * Get overall system status
   */
  private getOverallStatus(
    metrics: PerformanceMetrics,
    score: number
  ): 'healthy' | 'degraded' | 'critical' {
    if (score >= 80 && metrics.application.errors.rate < 1) {
      return 'healthy';
    } else if (score >= 60 && metrics.application.errors.rate < 5) {
      return 'degraded';
    } else {
      return 'critical';
    }
  }

  /**
   * Calculate performance trends
   */
  private calculateTrends(): any {
    if (this.performanceHistory.length < 2) {
      return {
        responseTime: 'stable',
        throughput: 'stable',
        errors: 'stable'
      };
    }
    
    const recent = this.performanceHistory.slice(-10);
    const older = this.performanceHistory.slice(-20, -10);
    
    if (older.length === 0) {
      return {
        responseTime: 'stable',
        throughput: 'stable',
        errors: 'stable'
      };
    }
    
    const recentAvgResponse = recent.reduce((sum, m) => sum + m.application.requests.duration.avg, 0) / recent.length;
    const olderAvgResponse = older.reduce((sum, m) => sum + m.application.requests.duration.avg, 0) / older.length;
    
    const recentAvgThroughput = recent.reduce((sum, m) => sum + m.application.requests.rate, 0) / recent.length;
    const olderAvgThroughput = older.reduce((sum, m) => sum + m.application.requests.rate, 0) / older.length;
    
    const recentAvgErrors = recent.reduce((sum, m) => sum + m.application.errors.rate, 0) / recent.length;
    const olderAvgErrors = older.reduce((sum, m) => sum + m.application.errors.rate, 0) / older.length;
    
    return {
      responseTime: this.getTrend(recentAvgResponse, olderAvgResponse, false),
      throughput: this.getTrend(recentAvgThroughput, olderAvgThroughput, true),
      errors: this.getTrend(recentAvgErrors, olderAvgErrors, false)
    };
  }

  /**
   * Get trend direction
   */
  private getTrend(recent: number, older: number, higherIsBetter: boolean): 'improving' | 'stable' | 'degrading' {
    const changePercent = ((recent - older) / older) * 100;
    
    if (Math.abs(changePercent) < 5) {
      return 'stable';
    }
    
    const isImproving = higherIsBetter ? changePercent > 0 : changePercent < 0;
    return isImproving ? 'improving' : 'degrading';
  }

  /**
   * Generate chart data for dashboard
   */
  private generateChartData(): any {
    const recentHistory = this.performanceHistory.slice(-30); // Last 30 data points
    
    if (recentHistory.length === 0) {
      return {
        responseTime: { labels: [], datasets: [] },
        throughput: { labels: [], datasets: [] },
        errorRate: { labels: [], datasets: [] },
        resourceUsage: { labels: [], datasets: [] },
        toolPerformance: { labels: [], datasets: [] }
      };
    }
    
    const labels = recentHistory.map(m => new Date(m.timestamp).toISOString());
    
    return {
      responseTime: {
        labels,
        datasets: [{
          label: 'Response Time (ms)',
          data: recentHistory.map(m => m.application.requests.duration.avg),
          borderColor: '#2196F3',
          backgroundColor: 'rgba(33, 150, 243, 0.1)'
        }]
      },
      
      throughput: {
        labels,
        datasets: [{
          label: 'Throughput (req/s)',
          data: recentHistory.map(m => m.application.requests.rate),
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76, 175, 80, 0.1)'
        }]
      },
      
      errorRate: {
        labels,
        datasets: [{
          label: 'Error Rate (%)',
          data: recentHistory.map(m => m.application.errors.rate),
          borderColor: '#F44336',
          backgroundColor: 'rgba(244, 67, 54, 0.1)'
        }]
      },
      
      resourceUsage: {
        labels,
        datasets: [
          {
            label: 'CPU Usage (%)',
            data: recentHistory.map(m => m.cpu.usage),
            borderColor: '#FF9800',
            backgroundColor: 'rgba(255, 152, 0, 0.1)'
          },
          {
            label: 'Memory Usage (%)',
            data: recentHistory.map(m => m.memory.usage),
            borderColor: '#9C27B0',
            backgroundColor: 'rgba(156, 39, 176, 0.1)'
          }
        ]
      },
      
      toolPerformance: this.generateToolPerformanceChart()
    };
  }

  /**
   * Generate tool performance chart data
   */
  private generateToolPerformanceChart(): ChartData {
    const topTools = Array.from(this.toolMetrics.values())
      .sort((a, b) => b.invocations - a.invocations)
      .slice(0, 10);
    
    return {
      labels: topTools.map(t => t.name),
      datasets: [{
        label: 'Average Duration (ms)',
        data: topTools.map(t => t.averageDuration),
        borderColor: '#607D8B',
        backgroundColor: 'rgba(96, 125, 139, 0.1)'
      }]
    };
  }

  /**
   * Get top performance issues
   */
  private getTopIssues(): Array<{ type: string; description: string; severity: string; count: number }> {
    const issues: Array<{ type: string; description: string; severity: string; count: number }> = [];
    
    // High error rate
    const currentMetrics = this.baseMonitor.getCurrentMetrics();
    if (currentMetrics && currentMetrics.application.errors.rate > 1) {
      issues.push({
        type: 'error_rate',
        description: `Error rate at ${currentMetrics.application.errors.rate.toFixed(2)}%`,
        severity: currentMetrics.application.errors.rate > 5 ? 'critical' : 'high',
        count: 1
      });
    }
    
    // Slow response time
    if (currentMetrics && currentMetrics.application.requests.duration.avg > 1000) {
      issues.push({
        type: 'response_time',
        description: `Slow response time: ${currentMetrics.application.requests.duration.avg.toFixed(0)}ms`,
        severity: currentMetrics.application.requests.duration.avg > 2000 ? 'critical' : 'medium',
        count: 1
      });
    }
    
    // High resource usage
    if (currentMetrics && currentMetrics.cpu.usage > 70) {
      issues.push({
        type: 'cpu_usage',
        description: `High CPU usage: ${currentMetrics.cpu.usage.toFixed(1)}%`,
        severity: currentMetrics.cpu.usage > 85 ? 'critical' : 'high',
        count: 1
      });
    }
    
    if (currentMetrics && currentMetrics.memory.usage > 80) {
      issues.push({
        type: 'memory_usage',
        description: `High memory usage: ${currentMetrics.memory.usage.toFixed(1)}%`,
        severity: currentMetrics.memory.usage > 90 ? 'critical' : 'high',
        count: 1
      });
    }
    
    return issues.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity as keyof typeof severityOrder] - severityOrder[a.severity as keyof typeof severityOrder];
    });
  }

  /**
   * Check for performance degradation
   */
  private checkForDegradation(metrics: PerformanceMetrics): void {
    const now = Date.now();
    
    // Check response time degradation
    if (metrics.application.requests.duration.avg > this.alertThresholds.responseTime.warning) {
      this.addDegradationAlert({
        timestamp: now,
        type: 'threshold_breach',
        severity: metrics.application.requests.duration.avg > this.alertThresholds.responseTime.critical ? 'critical' : 'medium',
        metric: 'response_time',
        current: metrics.application.requests.duration.avg,
        baseline: this.alertThresholds.responseTime.warning,
        threshold: this.alertThresholds.responseTime.warning,
        trend: 'degrading',
        impact: 'User experience degradation',
        recommendations: [
          'Profile CPU-intensive operations',
          'Check for database query optimization opportunities',
          'Review caching strategies'
        ]
      });
    }
    
    // Check error rate increase
    if (metrics.application.errors.rate > this.alertThresholds.errorRate.warning) {
      this.addDegradationAlert({
        timestamp: now,
        type: 'threshold_breach',
        severity: metrics.application.errors.rate > this.alertThresholds.errorRate.critical ? 'critical' : 'high',
        metric: 'error_rate',
        current: metrics.application.errors.rate,
        baseline: 0,
        threshold: this.alertThresholds.errorRate.warning,
        trend: 'degrading',
        impact: 'Service reliability issues',
        recommendations: [
          'Review recent code changes',
          'Check error logs for patterns',
          'Verify external service dependencies'
        ]
      });
    }
  }

  /**
   * Add degradation alert
   */
  private addDegradationAlert(alert: PerformanceDegradationAlert): void {
    this.degradationAlerts.push(alert);
    
    // Keep only recent alerts (last 24 hours)
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.degradationAlerts = this.degradationAlerts.filter(a => a.timestamp > dayAgo);
    
    this.emit('degradation_alert', alert);
    
    secureLog('warn', 'Performance degradation detected', {
      metric: alert.metric,
      current: alert.current,
      threshold: alert.threshold,
      severity: alert.severity
    });
  }

  /**
   * Handle profile analysis from clinic.js
   */
  private handleProfileAnalysis(analysis: ProfileAnalysis): void {
    // Convert clinic.js recommendations to degradation alerts
    for (const recommendation of analysis.recommendations) {
      this.addDegradationAlert({
        timestamp: analysis.timestamp,
        type: 'anomaly',
        severity: recommendation.priority as any,
        metric: recommendation.category,
        current: 0, // Would extract from analysis
        baseline: 0,
        threshold: 0,
        trend: 'degrading',
        impact: recommendation.impact,
        recommendations: recommendation.implementation
      });
    }
  }

  /**
   * Clean up old history data
   */
  private cleanupHistory(): void {
    const cutoff = Date.now() - this.historyRetention;
    
    this.performanceHistory = this.performanceHistory.filter(m => m.timestamp > cutoff);
    this.mcpMetricsHistory = this.mcpMetricsHistory.filter(m => m.timestamp > cutoff);
  }
}
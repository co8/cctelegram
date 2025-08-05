/**
 * Performance Monitor
 * 
 * Comprehensive performance monitoring with SLA tracking, baseline comparisons,
 * bottleneck detection, and optimization recommendations.
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import * as v8 from 'v8';
import { performance, PerformanceObserver } from 'perf_hooks';
import { PerformanceMonitoringConfig } from '../config.js';
import { MetricsCollector } from '../metrics/metrics-collector.js';
import { secureLog } from '../../security.js';

export interface PerformanceMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    userTime: number;
    systemTime: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    heapUtilization: number;
    external: number;
    rss: number;
    arrayBuffers: number;
    total: number;
    free: number;
    usage: number;
  };
  gc: {
    collections: GCMetrics[];
    totalPauseTime: number;
    averagePauseTime: number;
    frequency: number;
  };
  eventLoop: {
    lag: number;
    utilization: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    connections: number;
    latency: number;
  };
  disk: {
    readOps: number;
    writeOps: number;
    readBytes: number;
    writeBytes: number;
    utilization: number;
  };
  application: {
    requests: RequestMetrics;
    errors: ErrorMetrics;
    cache: CacheMetrics;
    database: DatabaseMetrics;
  };
}

export interface GCMetrics {
  type: string;
  duration: number;
  timestamp: number;
  heapBefore: number;
  heapAfter: number;
  freedMemory: number;
}

export interface RequestMetrics {
  total: number;
  rate: number; // requests per second
  duration: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  statusCodes: Map<number, number>;
  endpoints: Map<string, EndpointMetrics>;
}

export interface EndpointMetrics {
  count: number;
  avgDuration: number;
  errorRate: number;
  lastAccessed: number;
}

export interface ErrorMetrics {
  total: number;
  rate: number; // errors per second
  types: Map<string, number>;
  recentErrors: Array<{
    timestamp: number;
    type: string;
    message: string;
    stack?: string;
  }>;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  evictions: number;
}

export interface DatabaseMetrics {
  queries: number;
  avgQueryTime: number;
  slowQueries: number;
  connections: number;
  poolUtilization: number;
}

export interface SLAMetrics {
  availability: {
    uptime: number;
    downtime: number;
    percentage: number;
    target: number;
    status: 'met' | 'at_risk' | 'violated';
  };
  responseTime: {
    current: number;
    target: number;
    p95: number;
    status: 'met' | 'at_risk' | 'violated';
  };
  errorRate: {
    current: number;
    target: number;
    status: 'met' | 'at_risk' | 'violated';
  };
  throughput: {
    current: number;
    target: number;
    status: 'met' | 'at_risk' | 'violated';
  };
}

export interface PerformanceBaseline {
  cpu: { normal: number; warning: number; critical: number };
  memory: { normal: number; warning: number; critical: number };
  responseTime: { normal: number; warning: number; critical: number };
  errorRate: { normal: number; warning: number; critical: number };
  throughput: { normal: number; warning: number; critical: number };
  lastUpdated: number;
}

export interface BottleneckAnalysis {
  detected: boolean;
  type: 'cpu' | 'memory' | 'io' | 'network' | 'application';
  severity: 'low' | 'medium' | 'high' | 'critical';
  impact: string;
  recommendations: string[];
  metrics: Record<string, number>;
}

export interface OptimizationRecommendation {
  category: 'performance' | 'resource' | 'architecture' | 'configuration';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  implementation: string[];
  metrics: Record<string, number>;
}

export class PerformanceMonitor extends EventEmitter {
  private config: PerformanceMonitoringConfig;
  private metricsCollector?: MetricsCollector;
  private currentMetrics?: PerformanceMetrics;
  private baseline: PerformanceBaseline;
  private slaMetrics: SLAMetrics;
  private monitoringInterval?: NodeJS.Timeout;
  private performanceObserver?: PerformanceObserver;
  private isRunning: boolean = false;
  private startTime: number;

  // Performance tracking
  private requestDurations: number[] = [];
  private errorCounts: Map<string, number> = new Map();
  private gcEvents: GCMetrics[] = [];
  private eventLoopLag: number = 0;
  private requestCount: number = 0;
  private errorCount: number = 0;

  // Baselines and trends
  private performanceHistory: PerformanceMetrics[] = [];
  private bottlenecks: BottleneckAnalysis[] = [];
  private recommendations: OptimizationRecommendation[] = [];

  constructor(config: PerformanceMonitoringConfig, metricsCollector?: MetricsCollector) {
    super();
    this.config = config;
    this.metricsCollector = metricsCollector;
    this.startTime = Date.now();
    this.baseline = this.initializeBaseline();
    this.slaMetrics = this.initializeSLAMetrics();

    secureLog('info', 'Performance monitor initialized', {
      enabled: config.enabled,
      profiling: config.profiling.enabled,
      optimization: config.optimization.enabled,
      slaTargets: config.slaTargets
    });
  }

  /**
   * Initialize the performance monitor
   */
  public async initialize(): Promise<void> {
    try {
      // Set up performance observers
      this.setupPerformanceObservers();

      // Set up garbage collection monitoring
      this.setupGCMonitoring();

      // Set up event loop monitoring
      this.setupEventLoopMonitoring();

      // Start profiling if enabled
      if (this.config.profiling.enabled) {
        this.startProfiling();
      }

      secureLog('info', 'Performance monitor initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize performance monitor', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Initialize baseline performance metrics
   */
  private initializeBaseline(): PerformanceBaseline {
    return {
      cpu: { normal: 30, warning: 60, critical: 80 },
      memory: { normal: 50, warning: 70, critical: 85 },
      responseTime: { normal: 500, warning: 1000, critical: 2000 },
      errorRate: { normal: 0.1, warning: 1.0, critical: 5.0 },
      throughput: { normal: 50, warning: 20, critical: 10 },
      lastUpdated: Date.now()
    };
  }

  /**
   * Initialize SLA metrics
   */
  private initializeSLAMetrics(): SLAMetrics {
    return {
      availability: {
        uptime: 0,
        downtime: 0,
        percentage: 100,
        target: this.config.slaTargets.availability,
        status: 'met'
      },
      responseTime: {
        current: 0,
        target: this.config.slaTargets.responseTime,
        p95: 0,
        status: 'met'
      },
      errorRate: {
        current: 0,
        target: this.config.slaTargets.errorRate,
        status: 'met'
      },
      throughput: {
        current: 0,
        target: this.config.slaTargets.throughput,
        status: 'met'
      }
    };
  }

  /**
   * Set up performance observers
   */
  private setupPerformanceObservers(): void {
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      
      entries.forEach((entry) => {
        switch (entry.entryType) {
          case 'measure':
            this.recordMeasurement(entry);
            break;
          case 'navigation':
            this.recordNavigation(entry);
            break;
          case 'resource':
            this.recordResourceTiming(entry);
            break;
        }
      });
    });

    // Observe different types of performance entries
    try {
      this.performanceObserver.observe({ entryTypes: ['measure', 'navigation'] });
    } catch (error) {
      secureLog('warn', 'Some performance observers not supported', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Set up garbage collection monitoring
   */
  private setupGCMonitoring(): void {
    if (typeof v8.getHeapStatistics === 'function') {
      // Use V8 hooks for GC monitoring (if available)
      try {
        const { getHeapStatistics } = v8;
        let lastGCStats = getHeapStatistics();

        setInterval(() => {
          const currentStats = getHeapStatistics();
          
          // Detect GC events by changes in heap statistics
          if (currentStats.used_heap_size < lastGCStats.used_heap_size) {
            const gcEvent: GCMetrics = {
              type: 'major', // Simplified, real implementation would distinguish types
              duration: 0, // Would need more sophisticated detection
              timestamp: Date.now(),
              heapBefore: lastGCStats.used_heap_size,
              heapAfter: currentStats.used_heap_size,
              freedMemory: lastGCStats.used_heap_size - currentStats.used_heap_size
            };

            this.gcEvents.push(gcEvent);
            this.emit('gc_event', gcEvent);

            // Keep only recent GC events
            this.gcEvents = this.gcEvents.filter(event => 
              event.timestamp > Date.now() - 300000 // Last 5 minutes
            );
          }

          lastGCStats = currentStats;
        }, 5000); // Check every 5 seconds

      } catch (error) {
        secureLog('warn', 'Advanced GC monitoring not available');
      }
    }
  }

  /**
   * Set up event loop monitoring
   */
  private setupEventLoopMonitoring(): void {
    const checkEventLoop = () => {
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1e6; // Convert to milliseconds
        this.eventLoopLag = lag;
      });
    };

    // Check event loop lag every second
    setInterval(checkEventLoop, 1000);
  }

  /**
   * Start profiling
   */
  private startProfiling(): void {
    if (this.config.profiling.heapSnapshots) {
      // Take heap snapshots at intervals
      setInterval(() => {
        try {
          const snapshot = v8.writeHeapSnapshot();
          secureLog('debug', 'Heap snapshot taken', { snapshot });
        } catch (error) {
          secureLog('warn', 'Failed to take heap snapshot', {
            error: error instanceof Error ? error.message : 'unknown'
          });
        }
      }, this.config.profiling.interval);
    }

    if (this.config.profiling.cpuProfile) {
      // CPU profiling would be implemented here
      secureLog('info', 'CPU profiling enabled');
    }
  }

  /**
   * Start performance monitoring
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Start periodic metrics collection
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, 10000); // Every 10 seconds

    // Initial metrics collection
    await this.collectMetrics();

    secureLog('info', 'Performance monitoring started');
  }

  /**
   * Collect comprehensive performance metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = Date.now();
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const heapStats = v8.getHeapStatistics();

      // Calculate CPU usage percentage
      const totalCpuTime = cpuUsage.user + cpuUsage.system;
      const cpuPercent = this.currentMetrics ? 
        this.calculateCPUPercent(cpuUsage, this.currentMetrics.cpu) : 0;

      this.currentMetrics = {
        timestamp,
        cpu: {
          usage: cpuPercent,
          userTime: cpuUsage.user / 1000, // Convert to milliseconds
          systemTime: cpuUsage.system / 1000,
          loadAverage: os.loadavg(),
          cores: os.cpus().length
        },
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          heapUtilization: (memUsage.heapUsed / memUsage.heapTotal) * 100,
          external: memUsage.external,
          rss: memUsage.rss,
          arrayBuffers: memUsage.arrayBuffers || 0,
          total: os.totalmem(),
          free: os.freemem(),
          usage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
        },
        gc: this.calculateGCMetrics(),
        eventLoop: {
          lag: this.eventLoopLag,
          utilization: this.calculateEventLoopUtilization()
        },
        network: {
          bytesIn: 0, // Would be populated by network monitoring
          bytesOut: 0,
          connections: 0,
          latency: 0
        },
        disk: {
          readOps: 0, // Would be populated by disk monitoring
          writeOps: 0,
          readBytes: 0,
          writeBytes: 0,
          utilization: 0
        },
        application: {
          requests: this.calculateRequestMetrics(),
          errors: this.calculateErrorMetrics(),
          cache: this.calculateCacheMetrics(),
          database: this.calculateDatabaseMetrics()
        }
      };

      // Update performance history
      this.updatePerformanceHistory();

      // Update SLA metrics
      this.updateSLAMetrics();

      // Detect bottlenecks
      this.detectBottlenecks();

      // Generate recommendations
      if (this.config.optimization.recommendationEngine) {
        this.generateRecommendations();
      }

      // Update metrics collector if available
      if (this.metricsCollector) {
        this.updateMetricsCollector();
      }

      // Emit metrics event
      this.emit('metrics_collected', this.currentMetrics);

      // Check for SLA violations
      this.checkSLAViolations();

    } catch (error) {
      secureLog('error', 'Failed to collect performance metrics', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Calculate CPU usage percentage
   */
  private calculateCPUPercent(current: NodeJS.CpuUsage, previous: PerformanceMetrics['cpu']): number {
    const timeDiff = Date.now() - (this.currentMetrics?.timestamp || Date.now());
    if (timeDiff <= 0) return 0;

    const userDiff = (current.user / 1000) - previous.userTime;
    const systemDiff = (current.system / 1000) - previous.systemTime;
    const totalDiff = userDiff + systemDiff;

    return Math.min(100, Math.max(0, (totalDiff / timeDiff) * 100));
  }

  /**
   * Calculate GC metrics
   */
  private calculateGCMetrics() {
    const recentGC = this.gcEvents.filter(event => 
      event.timestamp > Date.now() - 60000 // Last minute
    );

    const totalPauseTime = recentGC.reduce((sum, gc) => sum + gc.duration, 0);
    const averagePauseTime = recentGC.length > 0 ? totalPauseTime / recentGC.length : 0;
    const frequency = recentGC.length; // GC events per minute

    return {
      collections: recentGC,
      totalPauseTime,
      averagePauseTime,
      frequency
    };
  }

  /**
   * Calculate event loop utilization
   */
  private calculateEventLoopUtilization(): number {
    // Simplified calculation based on event loop lag
    if (this.eventLoopLag < 10) return 100; // Low lag = high utilization
    if (this.eventLoopLag < 50) return 80;
    if (this.eventLoopLag < 100) return 60;
    return 40; // High lag = low utilization
  }

  /**
   * Calculate request metrics
   */
  private calculateRequestMetrics(): RequestMetrics {
    const durations = this.requestDurations.slice(); // Copy array
    durations.sort((a, b) => a - b);

    const statusCodes = new Map<number, number>();
    const endpoints = new Map<string, EndpointMetrics>();

    return {
      total: this.requestCount,
      rate: this.calculateRate(this.requestCount),
      duration: {
        min: durations.length > 0 ? durations[0] : 0,
        max: durations.length > 0 ? durations[durations.length - 1] : 0,
        avg: durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0,
        p50: this.percentile(durations, 0.5),
        p90: this.percentile(durations, 0.9),
        p95: this.percentile(durations, 0.95),
        p99: this.percentile(durations, 0.99)
      },
      statusCodes,
      endpoints
    };
  }

  /**
   * Calculate error metrics
   */
  private calculateErrorMetrics(): ErrorMetrics {
    const recentErrors: ErrorMetrics['recentErrors'] = [];

    return {
      total: this.errorCount,
      rate: this.calculateRate(this.errorCount),
      types: new Map(this.errorCounts),
      recentErrors
    };
  }

  /**
   * Calculate cache metrics (placeholder)
   */
  private calculateCacheMetrics(): CacheMetrics {
    return {
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: 0,
      evictions: 0
    };
  }

  /**
   * Calculate database metrics (placeholder)
   */
  private calculateDatabaseMetrics(): DatabaseMetrics {
    return {
      queries: 0,
      avgQueryTime: 0,
      slowQueries: 0,
      connections: 0,
      poolUtilization: 0
    };
  }

  /**
   * Calculate rate per second
   */
  private calculateRate(count: number): number {
    const uptime = Date.now() - this.startTime;
    return count / (uptime / 1000);
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Update performance history
   */
  private updatePerformanceHistory(): void {
    if (!this.currentMetrics) return;

    this.performanceHistory.push(this.currentMetrics);

    // Keep only last hour of history
    const oneHourAgo = Date.now() - 3600000;
    this.performanceHistory = this.performanceHistory.filter(
      metrics => metrics.timestamp > oneHourAgo
    );
  }

  /**
   * Update SLA metrics
   */
  private updateSLAMetrics(): void {
    if (!this.currentMetrics) return;

    const uptime = Date.now() - this.startTime;
    
    // Update availability
    this.slaMetrics.availability.uptime = uptime;
    this.slaMetrics.availability.percentage = 
      (this.slaMetrics.availability.uptime / (this.slaMetrics.availability.uptime + this.slaMetrics.availability.downtime)) * 100;
    this.slaMetrics.availability.status = 
      this.slaMetrics.availability.percentage >= this.slaMetrics.availability.target ? 'met' : 'violated';

    // Update response time
    this.slaMetrics.responseTime.current = this.currentMetrics.application.requests.duration.avg;
    this.slaMetrics.responseTime.p95 = this.currentMetrics.application.requests.duration.p95;
    this.slaMetrics.responseTime.status = 
      this.slaMetrics.responseTime.p95 <= this.slaMetrics.responseTime.target ? 'met' : 'violated';

    // Update error rate
    this.slaMetrics.errorRate.current = this.currentMetrics.application.errors.rate;
    this.slaMetrics.errorRate.status = 
      this.slaMetrics.errorRate.current <= this.slaMetrics.errorRate.target ? 'met' : 'violated';

    // Update throughput
    this.slaMetrics.throughput.current = this.currentMetrics.application.requests.rate;
    this.slaMetrics.throughput.status = 
      this.slaMetrics.throughput.current >= this.slaMetrics.throughput.target ? 'met' : 'violated';
  }

  /**
   * Detect performance bottlenecks
   */
  private detectBottlenecks(): void {
    if (!this.currentMetrics) return;

    this.bottlenecks = [];

    // CPU bottleneck
    if (this.currentMetrics.cpu.usage > this.baseline.cpu.critical) {
      this.bottlenecks.push({
        detected: true,
        type: 'cpu',
        severity: 'critical',
        impact: 'High CPU usage affecting response times',
        recommendations: [
          'Optimize CPU-intensive operations',
          'Scale horizontally',
          'Profile and optimize hot code paths'
        ],
        metrics: { cpu: this.currentMetrics.cpu.usage }
      });
    }

    // Memory bottleneck
    if (this.currentMetrics.memory.usage > this.baseline.memory.critical) {
      this.bottlenecks.push({
        detected: true,
        type: 'memory',
        severity: 'critical',
        impact: 'High memory usage causing garbage collection pressure',
        recommendations: [
          'Optimize memory usage patterns',
          'Fix memory leaks',
          'Increase available memory'
        ],
        metrics: { memory: this.currentMetrics.memory.usage }
      });
    }

    // Event loop bottleneck
    if (this.currentMetrics.eventLoop.lag > 100) {
      this.bottlenecks.push({
        detected: true,
        type: 'application',
        severity: 'high',
        impact: 'Event loop lag affecting request processing',
        recommendations: [
          'Optimize synchronous operations',
          'Use worker threads for CPU-intensive tasks',
          'Reduce blocking operations'
        ],
        metrics: { eventLoopLag: this.currentMetrics.eventLoop.lag }
      });
    }

    // Emit bottleneck events
    this.bottlenecks.forEach(bottleneck => {
      this.emit('bottleneck_detected', bottleneck);
    });
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(): void {
    if (!this.currentMetrics) return;

    this.recommendations = [];

    // Memory optimization recommendations
    if (this.currentMetrics.memory.heapUtilization > 80) {
      this.recommendations.push({
        category: 'performance',
        priority: 'high',
        title: 'Optimize Memory Usage',
        description: 'High heap utilization detected',
        impact: 'Reduce garbage collection pressure and improve response times',
        effort: 'medium',
        implementation: [
          'Profile memory usage patterns',
          'Implement object pooling',
          'Optimize data structures'
        ],
        metrics: { heapUtilization: this.currentMetrics.memory.heapUtilization }
      });
    }

    // GC optimization recommendations
    if (this.currentMetrics.gc.frequency > 10) {
      this.recommendations.push({
        category: 'performance',
        priority: 'medium',
        title: 'Reduce Garbage Collection Frequency',
        description: 'High GC frequency affecting performance',
        impact: 'Smoother performance with fewer GC pauses',
        effort: 'medium',
        implementation: [
          'Optimize object allocation patterns',
          'Reuse objects where possible',
          'Tune GC parameters'
        ],
        metrics: { gcFrequency: this.currentMetrics.gc.frequency }
      });
    }

    // Event loop optimization
    if (this.currentMetrics.eventLoop.lag > 50) {
      this.recommendations.push({
        category: 'architecture',
        priority: 'high',
        title: 'Improve Event Loop Performance',
        description: 'Event loop lag detected',
        impact: 'Better request handling and responsiveness',
        effort: 'high',
        implementation: [
          'Move CPU-intensive work to worker threads',
          'Optimize synchronous operations',
          'Use asynchronous patterns consistently'
        ],
        metrics: { eventLoopLag: this.currentMetrics.eventLoop.lag }
      });
    }
  }

  /**
   * Check for SLA violations
   */
  private checkSLAViolations(): void {
    Object.entries(this.slaMetrics).forEach(([key, sla]) => {
      if ('status' in sla && sla.status === 'violated') {
        this.emit('sla_violation', {
          type: key,
          current: (sla as any).current,
          target: (sla as any).target,
          severity: this.getSLAViolationSeverity(key, sla as any)
        });
      }
    });
  }

  /**
   * Get SLA violation severity
   */
  private getSLAViolationSeverity(type: string, sla: any): 'low' | 'medium' | 'high' | 'critical' {
    switch (type) {
      case 'availability':
        return sla.percentage < 99 ? 'critical' : 'high';
      case 'responseTime':
        return sla.current > sla.target * 2 ? 'critical' : 'high';
      case 'errorRate':
        return sla.current > sla.target * 5 ? 'critical' : 'medium';
      default:
        return 'medium';
    }
  }

  /**
   * Update metrics collector with performance data
   */
  private updateMetricsCollector(): void {
    if (!this.metricsCollector || !this.currentMetrics) return;

    // Record custom metrics
    this.metricsCollector.recordCustomMetric({
      name: 'cpu_usage_percent',
      value: this.currentMetrics.cpu.usage
    });

    this.metricsCollector.recordCustomMetric({
      name: 'memory_heap_utilization',
      value: this.currentMetrics.memory.heapUtilization
    });

    this.metricsCollector.recordCustomMetric({
      name: 'event_loop_lag_ms',
      value: this.currentMetrics.eventLoop.lag
    });

    this.metricsCollector.recordCustomMetric({
      name: 'gc_frequency',
      value: this.currentMetrics.gc.frequency
    });
  }

  /**
   * Record measurement from performance observer
   */
  private recordMeasurement(entry: PerformanceEntry): void {
    secureLog('debug', 'Performance measurement', {
      name: entry.name,
      duration: entry.duration,
      startTime: entry.startTime
    });
  }

  /**
   * Record navigation timing
   */
  private recordNavigation(entry: PerformanceEntry): void {
    secureLog('debug', 'Navigation timing', {
      name: entry.name,
      duration: entry.duration
    });
  }

  /**
   * Record resource timing
   */
  private recordResourceTiming(entry: PerformanceEntry): void {
    secureLog('debug', 'Resource timing', {
      name: entry.name,
      duration: entry.duration
    });
  }

  /**
   * Record request performance
   */
  public recordRequest(duration: number, statusCode: number, endpoint?: string): void {
    this.requestCount++;
    this.requestDurations.push(duration);

    // Keep only recent durations
    if (this.requestDurations.length > 1000) {
      this.requestDurations = this.requestDurations.slice(-1000);
    }

    if (statusCode >= 400) {
      this.errorCount++;
      const errorType = `http_${Math.floor(statusCode / 100)}xx`;
      this.errorCounts.set(errorType, (this.errorCounts.get(errorType) || 0) + 1);
    }
  }

  /**
   * Record security event (for correlation with performance)
   */
  public recordSecurityEvent(event: any): void {
    // Correlate security events with performance impact
    if (event.type === 'rate_limit_exceeded' || event.type === 'malicious_request') {
      // These events might impact performance
      this.emit('security_performance_correlation', {
        securityEvent: event,
        currentMetrics: this.currentMetrics
      });
    }
  }

  /**
   * Get current performance metrics
   */
  public getCurrentMetrics(): PerformanceMetrics | undefined {
    return this.currentMetrics;
  }

  /**
   * Get SLA metrics
   */
  public getSLAMetrics(): SLAMetrics {
    return { ...this.slaMetrics };
  }

  /**
   * Get performance baseline
   */
  public getBaseline(): PerformanceBaseline {
    return { ...this.baseline };
  }

  /**
   * Get detected bottlenecks
   */
  public getBottlenecks(): BottleneckAnalysis[] {
    return [...this.bottlenecks];
  }

  /**
   * Get optimization recommendations
   */
  public getRecommendations(): OptimizationRecommendation[] {
    return [...this.recommendations];
  }

  /**
   * Get performance summary
   */
  public getSummary(): Record<string, any> {
    if (!this.currentMetrics) {
      return { status: 'no_data' };
    }

    return {
      timestamp: this.currentMetrics.timestamp,
      uptime: Date.now() - this.startTime,
      cpu: {
        usage: this.currentMetrics.cpu.usage,
        status: this.getResourceStatus('cpu', this.currentMetrics.cpu.usage)
      },
      memory: {
        usage: this.currentMetrics.memory.usage,
        heapUtilization: this.currentMetrics.memory.heapUtilization,
        status: this.getResourceStatus('memory', this.currentMetrics.memory.usage)
      },
      application: {
        requests: this.currentMetrics.application.requests,
        errors: this.currentMetrics.application.errors
      },
      sla: this.slaMetrics,
      bottlenecks: this.bottlenecks.length,
      recommendations: this.recommendations.length
    };
  }

  /**
   * Get resource status based on thresholds
   */
  private getResourceStatus(resource: keyof PerformanceBaseline, value: number): string {
    const thresholds = this.baseline[resource];
    
    if (value >= thresholds.critical) return 'critical';
    if (value >= thresholds.warning) return 'warning';
    return 'normal';
  }

  /**
   * Get health status
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  }> {
    const details: Record<string, any> = {
      isRunning: this.isRunning,
      uptime: Date.now() - this.startTime,
      currentMetrics: !!this.currentMetrics,
      bottlenecksDetected: this.bottlenecks.length,
      slaStatus: Object.fromEntries(
        Object.entries(this.slaMetrics).map(([key, sla]) => [
          key, 
          'status' in sla ? sla.status : 'unknown'
        ])
      )
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!this.isRunning) {
      status = 'unhealthy';
      details.reason = 'Performance monitoring not running';
    } else if (this.bottlenecks.some(b => b.severity === 'critical')) {
      status = 'unhealthy';
      details.reason = 'Critical performance bottlenecks detected';
    } else if (Object.values(this.slaMetrics).some((sla: any) => sla.status === 'violated')) {
      status = 'degraded';
      details.reason = 'SLA violations detected';
    } else if (this.bottlenecks.length > 0) {
      status = 'degraded';
      details.reason = 'Performance bottlenecks detected';
    }

    return { status, details };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<PerformanceMonitoringConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.slaTargets) {
      this.slaMetrics = this.initializeSLAMetrics();
    }

    if (config.thresholds) {
      // Update baseline thresholds
      Object.assign(this.baseline, {
        cpu: { 
          normal: config.thresholds.cpu * 0.4,
          warning: config.thresholds.cpu * 0.7,
          critical: config.thresholds.cpu
        },
        memory: {
          normal: config.thresholds.memory * 0.6,
          warning: config.thresholds.memory * 0.8,
          critical: config.thresholds.memory
        }
      });
    }

    secureLog('info', 'Performance monitor configuration updated');
  }

  /**
   * Stop performance monitoring
   */
  public async stop(): Promise<void> {
    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = undefined;
    }

    secureLog('info', 'Performance monitoring stopped');
  }
}
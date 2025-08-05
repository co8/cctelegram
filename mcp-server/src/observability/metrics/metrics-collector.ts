/**
 * Enhanced Metrics Collector
 * 
 * Production-grade metrics collection with Prometheus integration,
 * custom metrics, histograms, and automated alerting on thresholds.
 */

import { EventEmitter } from 'events';
import * as promClient from 'prom-client';
import * as os from 'os';
import * as fs from 'fs-extra';
import { MetricsConfig } from '../config.js';
import { secureLog } from '../../security.js';

export interface MetricDefinition {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  labels?: string[];
  buckets?: number[]; // For histograms
  percentiles?: number[]; // For summaries
}

export interface CustomMetric {
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
}

export interface MetricThreshold {
  metric: string;
  condition: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';
  value: number;
  duration: number; // in ms
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    used: number;
    free: number;
    total: number;
    usage: number; // percentage
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
    connections: number;
  };
  disk: {
    used: number;
    free: number;
    total: number;
    usage: number; // percentage
    readOps: number;
    writeOps: number;
    readBytes: number;
    writeBytes: number;
  };
  process: {
    pid: number;
    ppid: number;
    uptime: number;
    version: string;
    platform: string;
    arch: string;
  };
  application: {
    requests: number;
    errors: number;
    responseTime: number;
    activeConnections: number;
    queueDepth: number;
    cacheHits: number;
    cacheMisses: number;
  };
  resilience: {
    circuitBreakerTrips: number;
    retryAttempts: number;
    recoveryAttempts: number;
    healthCheckFailures: number;
    timeouts: number;
  };
}

export class MetricsCollector extends EventEmitter {
  private config: MetricsConfig;
  private registry: promClient.Registry;
  private metrics: Map<string, promClient.Metric> = new Map();
  private customMetrics: Map<string, CustomMetric[]> = new Map();
  private thresholds: MetricThreshold[] = [];
  private collectionInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastSystemMetrics?: SystemMetrics;
  private httpServer?: any;

  // Standard metrics
  private requestsTotal: promClient.Counter;
  private requestDuration: promClient.Histogram;
  private responseSize: promClient.Histogram;
  private activeConnections: promClient.Gauge;
  private errorTotal: promClient.Counter;
  private cpuUsage: promClient.Gauge;
  private memoryUsage: promClient.Gauge;
  private diskUsage: promClient.Gauge;
  private networkIO: promClient.Counter;
  private processUptime: promClient.Gauge;
  private healthStatus: promClient.Gauge;

  constructor(config: MetricsConfig) {
    super();
    this.config = config;
    this.registry = new promClient.Registry();
    
    // Set default labels
    this.registry.setDefaultLabels(config.customMetrics.labels);
    
    // Create standard metrics
    this.createStandardMetrics();
    
    secureLog('info', 'Metrics collector initialized', {
      enabled: config.enabled,
      prometheus: config.prometheus.enabled,
      port: config.port,
      prefix: config.customMetrics.prefix
    });
  }

  /**
   * Initialize the metrics collector
   */
  public async initialize(): Promise<void> {
    try {
      // Register default Node.js metrics
      promClient.collectDefaultMetrics({
        register: this.registry,
        prefix: this.config.customMetrics.prefix,
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]
      });

      // Set up Prometheus gateway if configured
      if (this.config.prometheus.enabled && this.config.prometheus.pushGateway) {
        const gateway = new promClient.Pushgateway(
          this.config.prometheus.pushGateway,
          {
            timeout: 5000,
            replace: true
          },
          this.registry
        );
        
        // Push metrics periodically
        setInterval(async () => {
          try {
            await gateway.pushAdd({
              jobName: this.config.prometheus.job,
              groupings: { instance: this.config.prometheus.instance }
            });
          } catch (error) {
            secureLog('error', 'Failed to push metrics to gateway', {
              error: error instanceof Error ? error.message : 'unknown'
            });
          }
        }, 30000); // Every 30 seconds
      }

      // Start HTTP server for metrics endpoint
      if (this.config.prometheus.enabled) {
        await this.startMetricsServer();
      }

      // Set up default thresholds
      this.setupDefaultThresholds();

      secureLog('info', 'Metrics collector initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize metrics collector', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Create standard Prometheus metrics
   */
  private createStandardMetrics(): void {
    const prefix = this.config.customMetrics.prefix;

    this.requestsTotal = new promClient.Counter({
      name: `${prefix}requests_total`,
      help: 'Total number of requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry]
    });

    this.requestDuration = new promClient.Histogram({
      name: `${prefix}request_duration_seconds`,
      help: 'Request duration in seconds',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry]
    });

    this.responseSize = new promClient.Histogram({
      name: `${prefix}response_size_bytes`,
      help: 'Response size in bytes',
      buckets: [100, 1000, 10000, 100000, 1000000],
      labelNames: ['method', 'route'],
      registers: [this.registry]
    });

    this.activeConnections = new promClient.Gauge({
      name: `${prefix}active_connections`,
      help: 'Number of active connections',
      registers: [this.registry]
    });

    this.errorTotal = new promClient.Counter({
      name: `${prefix}errors_total`,
      help: 'Total number of errors',
      labelNames: ['type', 'operation'],
      registers: [this.registry]
    });

    this.cpuUsage = new promClient.Gauge({
      name: `${prefix}cpu_usage_percent`,
      help: 'CPU usage percentage',
      registers: [this.registry]
    });

    this.memoryUsage = new promClient.Gauge({
      name: `${prefix}memory_usage_bytes`,
      help: 'Memory usage in bytes',
      labelNames: ['type'],
      registers: [this.registry]
    });

    this.diskUsage = new promClient.Gauge({
      name: `${prefix}disk_usage_bytes`,
      help: 'Disk usage in bytes',
      labelNames: ['type'],
      registers: [this.registry]
    });

    this.networkIO = new promClient.Counter({
      name: `${prefix}network_io_bytes_total`,
      help: 'Network I/O in bytes',
      labelNames: ['direction'],
      registers: [this.registry]
    });

    this.processUptime = new promClient.Gauge({
      name: `${prefix}process_uptime_seconds`,
      help: 'Process uptime in seconds',
      registers: [this.registry]
    });

    this.healthStatus = new promClient.Gauge({
      name: `${prefix}health_status`,
      help: 'Health status (1=healthy, 0.5=degraded, 0=unhealthy)',
      labelNames: ['component'],
      registers: [this.registry]
    });

    // Store references for easy access
    this.metrics.set('requests_total', this.requestsTotal);
    this.metrics.set('request_duration', this.requestDuration);
    this.metrics.set('response_size', this.responseSize);
    this.metrics.set('active_connections', this.activeConnections);
    this.metrics.set('errors_total', this.errorTotal);
    this.metrics.set('cpu_usage', this.cpuUsage);
    this.metrics.set('memory_usage', this.memoryUsage);
    this.metrics.set('disk_usage', this.diskUsage);
    this.metrics.set('network_io', this.networkIO);
    this.metrics.set('process_uptime', this.processUptime);
    this.metrics.set('health_status', this.healthStatus);
  }

  /**
   * Start HTTP server for metrics endpoint
   */
  private async startMetricsServer(): Promise<void> {
    const http = await import('http');
    
    this.httpServer = http.createServer(async (req, res) => {
      if (req.url === this.config.path && req.method === 'GET') {
        try {
          const metrics = await this.registry.metrics();
          res.writeHead(200, {
            'Content-Type': this.registry.contentType,
            'Content-Length': Buffer.byteLength(metrics)
          });
          res.end(metrics);
        } catch (error) {
          res.writeHead(500);
          res.end('Error generating metrics');
          secureLog('error', 'Error generating metrics', {
            error: error instanceof Error ? error.message : 'unknown'
          });
        }
      } else if (req.url === '/health' && req.method === 'GET') {
        const status = await this.getHealthStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.config.port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          secureLog('info', 'Metrics server started', {
            port: this.config.port,
            path: this.config.path
          });
          resolve();
        }
      });
    });
  }

  /**
   * Set up default threshold monitoring
   */
  private setupDefaultThresholds(): void {
    this.thresholds = [
      {
        metric: 'cpu_usage_percent',
        condition: 'gt',
        value: 80,
        duration: 300000, // 5 minutes
        severity: 'high'
      },
      {
        metric: 'memory_usage_percent',
        condition: 'gt',
        value: 85,
        duration: 300000, // 5 minutes
        severity: 'high'
      },
      {
        metric: 'disk_usage_percent',
        condition: 'gt',
        value: 90,
        duration: 180000, // 3 minutes
        severity: 'critical'
      },
      {
        metric: 'error_rate_percent',
        condition: 'gt',
        value: 5,
        duration: 120000, // 2 minutes
        severity: 'critical'
      },
      {
        metric: 'response_time_ms',
        condition: 'gt',
        value: 2000,
        duration: 180000, // 3 minutes
        severity: 'medium'
      }
    ];
  }

  /**
   * Start metrics collection
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    
    // Start collection interval
    this.collectionInterval = setInterval(
      () => this.collectSystemMetrics(),
      this.config.interval
    );

    // Initial collection
    await this.collectSystemMetrics();

    secureLog('info', 'Metrics collection started', {
      interval: this.config.interval
    });
  }

  /**
   * Stop metrics collection
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer.close(() => resolve());
      });
    }

    secureLog('info', 'Metrics collection stopped');
  }

  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      const metrics = await this.getSystemMetrics();
      
      // Update Prometheus metrics
      this.cpuUsage.set(metrics.cpu.usage);
      this.memoryUsage.set({ type: 'used' }, metrics.memory.used);
      this.memoryUsage.set({ type: 'free' }, metrics.memory.free);
      this.memoryUsage.set({ type: 'heap_used' }, metrics.memory.heapUsed);
      this.memoryUsage.set({ type: 'heap_total' }, metrics.memory.heapTotal);
      this.memoryUsage.set({ type: 'external' }, metrics.memory.external);
      this.memoryUsage.set({ type: 'rss' }, metrics.memory.rss);
      
      this.diskUsage.set({ type: 'used' }, metrics.disk.used);
      this.diskUsage.set({ type: 'free' }, metrics.disk.free);
      
      this.processUptime.set(metrics.process.uptime);
      
      // Check thresholds
      await this.checkThresholds(metrics);
      
      this.lastSystemMetrics = metrics;
      this.emit('metrics_collected', metrics);

    } catch (error) {
      secureLog('error', 'Failed to collect system metrics', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Get comprehensive system metrics
   */
  private async getSystemMetrics(): Promise<SystemMetrics> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Calculate CPU usage percentage
    const totalCpuTime = cpuUsage.user + cpuUsage.system;
    const cpuPercent = this.lastSystemMetrics ? 
      ((totalCpuTime - (this.lastSystemMetrics.cpu.usage * 1000000)) / 1000000) * 100 : 0;

    // Get disk usage (simplified)
    let diskStats = { used: 0, free: 0, total: 0, usage: 0, readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 };
    try {
      const stats = await fs.stat(process.cwd());
      diskStats.used = stats.size || 0;
      // Note: Real disk usage would require platform-specific calls
    } catch (error) {
      // Ignore disk stat errors
    }

    return {
      timestamp: Date.now(),
      cpu: {
        usage: Math.min(Math.max(cpuPercent, 0), 100),
        loadAverage: os.loadavg(),
        cores: os.cpus().length
      },
      memory: {
        used: memUsage.rss,
        free: os.freemem(),
        total: os.totalmem(),
        usage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      network: {
        bytesIn: 0, // Would need platform-specific implementation
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
        connections: 0
      },
      disk: diskStats,
      process: {
        pid: process.pid,
        ppid: process.ppid || 0,
        uptime: process.uptime(),
        version: process.version,
        platform: process.platform,
        arch: process.arch
      },
      application: {
        requests: 0, // Will be updated by request handlers
        errors: 0,
        responseTime: 0,
        activeConnections: 0,
        queueDepth: 0,
        cacheHits: 0,
        cacheMisses: 0
      },
      resilience: {
        circuitBreakerTrips: 0, // Will be updated by resilience components
        retryAttempts: 0,
        recoveryAttempts: 0,
        healthCheckFailures: 0,
        timeouts: 0
      }
    };
  }

  /**
   * Check metric thresholds and emit alerts
   */
  private async checkThresholds(metrics: SystemMetrics): Promise<void> {
    for (const threshold of this.thresholds) {
      const value = this.getMetricValue(metrics, threshold.metric);
      if (value === undefined) continue;

      const violated = this.evaluateCondition(value, threshold.condition, threshold.value);
      
      if (violated) {
        this.emit('threshold_violation', {
          metric: threshold.metric,
          currentValue: value,
          threshold: threshold.value,
          condition: threshold.condition,
          severity: threshold.severity,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Get metric value from system metrics
   */
  private getMetricValue(metrics: SystemMetrics, metricName: string): number | undefined {
    switch (metricName) {
      case 'cpu_usage_percent':
        return metrics.cpu.usage;
      case 'memory_usage_percent':
        return metrics.memory.usage;
      case 'disk_usage_percent':
        return metrics.disk.usage;
      case 'response_time_ms':
        return metrics.application.responseTime;
      case 'error_rate_percent':
        const total = metrics.application.requests;
        return total > 0 ? (metrics.application.errors / total) * 100 : 0;
      default:
        return undefined;
    }
  }

  /**
   * Evaluate threshold condition
   */
  private evaluateCondition(value: number, condition: string, threshold: number): boolean {
    switch (condition) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      case 'ne': return value !== threshold;
      default: return false;
    }
  }

  /**
   * Record custom metric
   */
  public recordCustomMetric(metric: CustomMetric): void {
    const timestamp = metric.timestamp || Date.now();
    
    if (!this.customMetrics.has(metric.name)) {
      this.customMetrics.set(metric.name, []);
    }
    
    const metrics = this.customMetrics.get(metric.name)!;
    metrics.push({ ...metric, timestamp });
    
    // Clean up old metrics
    const retention = Date.now() - this.config.retention;
    this.customMetrics.set(
      metric.name,
      metrics.filter(m => m.timestamp > retention)
    );

    secureLog('debug', 'Custom metric recorded', {
      name: metric.name,
      value: metric.value,
      labels: metric.labels
    });
  }

  /**
   * Record HTTP request metrics
   */
  public recordRequest(method: string, route: string, statusCode: number, duration: number, size?: number): void {
    this.requestsTotal.inc({ method, route, status_code: statusCode.toString() });
    this.requestDuration.observe(
      { method, route, status_code: statusCode.toString() },
      duration / 1000
    );
    
    if (size !== undefined) {
      this.responseSize.observe({ method, route }, size);
    }

    if (statusCode >= 400) {
      this.errorTotal.inc({ type: 'http', operation: route });
    }
  }

  /**
   * Record span metrics from tracing
   */
  public recordSpanMetrics(span: any): void {
    if (span.duration) {
      this.recordCustomMetric({
        name: 'span_duration_ms',
        value: span.duration,
        labels: {
          operation: span.operationName,
          service: span.serviceName || 'unknown'
        }
      });
    }
  }

  /**
   * Update health status
   */
  public updateHealthStatus(component: string, status: 'healthy' | 'degraded' | 'unhealthy'): void {
    let value: number;
    switch (status) {
      case 'healthy': value = 1; break;
      case 'degraded': value = 0.5; break;
      case 'unhealthy': value = 0; break;
    }
    
    this.healthStatus.set({ component }, value);
  }

  /**
   * Get all metrics
   */
  public async getAllMetrics(): Promise<Record<string, any>> {
    const prometheusMetrics = await this.registry.metrics();
    const customMetrics: Record<string, any> = {};
    
    this.customMetrics.forEach((values, name) => {
      customMetrics[name] = values;
    });

    return {
      prometheus: prometheusMetrics,
      custom: customMetrics,
      system: this.lastSystemMetrics,
      timestamp: Date.now()
    };
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
      metricsCount: this.metrics.size,
      customMetricsCount: this.customMetrics.size,
      lastCollection: this.lastSystemMetrics?.timestamp,
      httpServerRunning: !!this.httpServer,
      prometheusEnabled: this.config.prometheus.enabled
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!this.isRunning) {
      status = 'unhealthy';
      details.reason = 'Collection not running';
    } else if (this.lastSystemMetrics && (Date.now() - this.lastSystemMetrics.timestamp) > this.config.interval * 2) {
      status = 'degraded';
      details.reason = 'Stale metrics data';
    }

    return { status, details };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<MetricsConfig>): void {
    this.config = { ...this.config, ...config };
    secureLog('info', 'Metrics configuration updated');
  }

  /**
   * Add custom threshold
   */
  public addThreshold(threshold: MetricThreshold): void {
    this.thresholds.push(threshold);
    secureLog('info', 'Metric threshold added', { metric: threshold.metric });
  }

  /**
   * Remove threshold
   */
  public removeThreshold(metricName: string): void {
    this.thresholds = this.thresholds.filter(t => t.metric !== metricName);
    secureLog('info', 'Metric threshold removed', { metric: metricName });
  }
}
/**
 * Metrics Collector
 * 
 * Collects, aggregates, and exports system metrics for monitoring
 * and alerting purposes in the resilience framework.
 */

import { MonitoringConfig, MonitoringExporterConfig } from '../config.js';
import { secureLog, sanitizeForLogging } from '../../security.js';

export interface MetricValue {
  name: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
  unit?: string;
}

export interface MetricSeries {
  name: string;
  values: MetricValue[];
  retention: number;
  aggregations?: {
    avg: number;
    min: number;
    max: number;
    sum: number;
    count: number;
  };
}

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    usage: number;
    used: number;
    total: number;
    free: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    connections: number;
  };
  application: {
    requestCount: number;
    errorCount: number;
    averageResponseTime: number;
    activeConnections: number;
  };
  resilience: {
    circuitBreakerTrips: number;
    retryAttempts: number;
    recoveryAttempts: number;
    healthCheckFailures: number;
  };
}

export class MetricsCollector {
  private config: MonitoringConfig;
  private metrics: Map<string, MetricSeries> = new Map();
  private collectionInterval: NodeJS.Timeout | null = null;
  private exportIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isCollecting: boolean = false;

  constructor(config: MonitoringConfig) {
    this.config = config;
    
    secureLog('info', 'Metrics collector initialized', {
      enabled: config.enabled,
      interval: config.metricsInterval,
      exporters: config.exporters.length
    });

    if (config.enabled) {
      this.startCollection();
    }
  }

  /**
   * Start metrics collection
   */
  public startCollection(): void {
    if (this.isCollecting) {
      return;
    }

    this.isCollecting = true;
    
    // Start main collection interval
    this.collectionInterval = setInterval(
      () => this.collectSystemMetrics(),
      this.config.metricsInterval
    );

    // Start exporter intervals
    this.config.exporters.forEach(exporter => {
      if (exporter.enabled && exporter.interval) {
        const interval = setInterval(
          () => this.exportMetrics(exporter),
          exporter.interval
        );
        this.exportIntervals.set(exporter.name, interval);
      }
    });

    secureLog('info', 'Metrics collection started');
  }

  /**
   * Stop metrics collection
   */
  public stopCollection(): void {
    if (!this.isCollecting) {
      return;
    }

    this.isCollecting = false;

    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    this.exportIntervals.forEach((interval, name) => {
      clearInterval(interval);
    });
    this.exportIntervals.clear();

    secureLog('info', 'Metrics collection stopped');
  }

  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      const timestamp = Date.now();
      
      // Collect system metrics
      const systemMetrics = await this.getSystemMetrics();
      
      // Record individual metrics
      this.recordMetric('cpu.usage', systemMetrics.cpu.usage, timestamp, { unit: 'percent' });
      this.recordMetric('cpu.load_average_1m', systemMetrics.cpu.loadAverage[0], timestamp);
      this.recordMetric('cpu.load_average_5m', systemMetrics.cpu.loadAverage[1], timestamp);
      this.recordMetric('cpu.load_average_15m', systemMetrics.cpu.loadAverage[2], timestamp);
      
      this.recordMetric('memory.usage', systemMetrics.memory.usage, timestamp, { unit: 'percent' });
      this.recordMetric('memory.used', systemMetrics.memory.used, timestamp, { unit: 'bytes' });
      this.recordMetric('memory.free', systemMetrics.memory.free, timestamp, { unit: 'bytes' });
      this.recordMetric('memory.total', systemMetrics.memory.total, timestamp, { unit: 'bytes' });
      
      this.recordMetric('network.bytes_in', systemMetrics.network.bytesIn, timestamp, { unit: 'bytes' });
      this.recordMetric('network.bytes_out', systemMetrics.network.bytesOut, timestamp, { unit: 'bytes' });
      this.recordMetric('network.connections', systemMetrics.network.connections, timestamp);
      
      this.recordMetric('app.request_count', systemMetrics.application.requestCount, timestamp);
      this.recordMetric('app.error_count', systemMetrics.application.errorCount, timestamp);
      this.recordMetric('app.avg_response_time', systemMetrics.application.averageResponseTime, timestamp, { unit: 'ms' });
      this.recordMetric('app.active_connections', systemMetrics.application.activeConnections, timestamp);
      
      this.recordMetric('resilience.circuit_breaker_trips', systemMetrics.resilience.circuitBreakerTrips, timestamp);
      this.recordMetric('resilience.retry_attempts', systemMetrics.resilience.retryAttempts, timestamp);
      this.recordMetric('resilience.recovery_attempts', systemMetrics.resilience.recoveryAttempts, timestamp);
      this.recordMetric('resilience.health_check_failures', systemMetrics.resilience.healthCheckFailures, timestamp);

      // Clean up old metrics
      this.cleanupOldMetrics();

    } catch (error) {
      secureLog('error', 'Failed to collect system metrics', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Get system metrics
   */
  private async getSystemMetrics(): Promise<SystemMetrics> {
    // In a real implementation, this would use system APIs or libraries
    // For now, simulate realistic metrics
    
    const timestamp = Date.now();
    
    return {
      timestamp,
      cpu: {
        usage: Math.random() * 100,
        loadAverage: [
          Math.random() * 4,
          Math.random() * 4,
          Math.random() * 4
        ]
      },
      memory: {
        usage: 60 + Math.random() * 30, // 60-90%
        used: 500_000_000 + Math.random() * 200_000_000, // ~500-700MB
        total: 2_000_000_000, // 2GB
        free: 1_500_000_000 - Math.random() * 200_000_000 // ~1.3-1.5GB
      },
      network: {
        bytesIn: Math.floor(Math.random() * 1000000),
        bytesOut: Math.floor(Math.random() * 1000000),
        connections: Math.floor(Math.random() * 100)
      },
      application: {
        requestCount: Math.floor(Math.random() * 1000),
        errorCount: Math.floor(Math.random() * 50),
        averageResponseTime: 100 + Math.random() * 400, // 100-500ms
        activeConnections: Math.floor(Math.random() * 50)
      },
      resilience: {
        circuitBreakerTrips: Math.floor(Math.random() * 10),
        retryAttempts: Math.floor(Math.random() * 100),
        recoveryAttempts: Math.floor(Math.random() * 20),
        healthCheckFailures: Math.floor(Math.random() * 5)
      }
    };
  }

  /**
   * Record a metric value
   */
  public recordMetric(
    name: string, 
    value: number, 
    timestamp?: number, 
    options?: { labels?: Record<string, string>; unit?: string }
  ): void {
    const metricValue: MetricValue = {
      name,
      value,
      timestamp: timestamp || Date.now(),
      labels: options?.labels,
      unit: options?.unit
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        values: [],
        retention: this.config.retention.metrics
      });
    }

    const series = this.metrics.get(name)!;
    series.values.push(metricValue);

    // Update aggregations
    this.updateAggregations(series);

    secureLog('debug', 'Metric recorded', {
      name,
      value,
      timestamp: metricValue.timestamp,
      labels: metricValue.labels
    });
  }

  /**
   * Update metric aggregations
   */
  private updateAggregations(series: MetricSeries): void {
    if (series.values.length === 0) {
      return;
    }

    const values = series.values.map(v => v.value);
    
    series.aggregations = {
      avg: values.reduce((sum, v) => sum + v, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      sum: values.reduce((sum, v) => sum + v, 0),
      count: values.length
    };
  }

  /**
   * Get metric series
   */
  public getMetricSeries(name: string, limit?: number): MetricSeries | undefined {
    const series = this.metrics.get(name);
    
    if (!series) {
      return undefined;
    }

    if (limit && series.values.length > limit) {
      return {
        ...series,
        values: series.values.slice(-limit)
      };
    }

    return series;
  }

  /**
   * Get all metrics
   */
  public getAllMetrics(): Record<string, MetricSeries> {
    const result: Record<string, MetricSeries> = {};
    
    this.metrics.forEach((series, name) => {
      result[name] = series;
    });

    return result;
  }

  /**
   * Get metrics summary
   */
  public getMetricsSummary(): Record<string, any> {
    const summary: Record<string, any> = {};
    
    this.metrics.forEach((series, name) => {
      if (series.aggregations) {
        summary[name] = {
          current: series.values[series.values.length - 1]?.value,
          ...series.aggregations,
          data_points: series.values.length
        };
      }
    });

    return summary;
  }

  /**
   * Export metrics to configured exporters
   */
  private async exportMetrics(exporter: MonitoringExporterConfig): Promise<void> {
    if (!exporter.enabled) {
      return;
    }

    try {
      switch (exporter.type) {
        case 'logs':
          await this.exportToLogs(exporter);
          break;
        case 'prometheus':
          await this.exportToPrometheus(exporter);
          break;
        case 'events':
          await this.exportToEvents(exporter);
          break;
        case 'custom':
          await this.exportToCustom(exporter);
          break;
        default:
          secureLog('warn', 'Unknown exporter type', { type: exporter.type });
      }
    } catch (error) {
      secureLog('error', 'Failed to export metrics', {
        exporter: exporter.name,
        type: exporter.type,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Export metrics to logs
   */
  private async exportToLogs(exporter: MonitoringExporterConfig): Promise<void> {
    const summary = this.getMetricsSummary();
    
    secureLog('info', 'Metrics summary', {
      exporter: exporter.name,
      timestamp: Date.now(),
      metrics: sanitizeForLogging(summary)
    });
  }

  /**
   * Export metrics to Prometheus
   */
  private async exportToPrometheus(exporter: MonitoringExporterConfig): Promise<void> {
    // In a real implementation, this would push to Prometheus pushgateway
    // or expose metrics endpoint for scraping
    
    const prometheusMetrics = this.formatPrometheusMetrics();
    
    secureLog('debug', 'Prometheus metrics exported', {
      exporter: exporter.name,
      endpoint: exporter.endpoint,
      metrics_count: prometheusMetrics.split('\n').length
    });
  }

  /**
   * Export metrics to events
   */
  private async exportToEvents(exporter: MonitoringExporterConfig): Promise<void> {
    const summary = this.getMetricsSummary();
    
    // Check for threshold violations
    const violations = this.checkThresholdViolations(summary);
    
    if (violations.length > 0) {
      secureLog('warn', 'Metric threshold violations detected', {
        exporter: exporter.name,
        violations
      });
    }
  }

  /**
   * Export to custom exporter
   */
  private async exportToCustom(exporter: MonitoringExporterConfig): Promise<void> {
    // Custom export logic would be implemented here
    secureLog('debug', 'Custom metrics export', {
      exporter: exporter.name,
      endpoint: exporter.endpoint
    });
  }

  /**
   * Format metrics for Prometheus
   */
  private formatPrometheusMetrics(): string {
    const lines: string[] = [];
    
    this.metrics.forEach((series, name) => {
      const metricName = name.replace(/\./g, '_');
      
      // Add help text
      lines.push(`# HELP ${metricName} Metric ${name}`);
      lines.push(`# TYPE ${metricName} gauge`);
      
      // Add current value
      const current = series.values[series.values.length - 1];
      if (current) {
        const labels = current.labels 
          ? Object.entries(current.labels).map(([k, v]) => `${k}="${v}"`).join(',')
          : '';
        
        lines.push(`${metricName}{${labels}} ${current.value} ${current.timestamp}`);
      }
    });
    
    return lines.join('\n');
  }

  /**
   * Check for threshold violations
   */
  private checkThresholdViolations(summary: Record<string, any>): Array<{
    metric: string;
    current: number;
    threshold: number;
    severity: string;
  }> {
    const violations: Array<{
      metric: string;
      current: number;
      threshold: number;
      severity: string;
    }> = [];

    // Check CPU usage
    if (summary['cpu.usage']?.current > this.config.alertThresholds.cpuUsage * 100) {
      violations.push({
        metric: 'cpu.usage',
        current: summary['cpu.usage'].current,
        threshold: this.config.alertThresholds.cpuUsage * 100,
        severity: 'high'
      });
    }

    // Check memory usage
    if (summary['memory.usage']?.current > this.config.alertThresholds.memoryUsage * 100) {
      violations.push({
        metric: 'memory.usage',
        current: summary['memory.usage'].current,
        threshold: this.config.alertThresholds.memoryUsage * 100,
        severity: 'high'
      });
    }

    // Check response time
    if (summary['app.avg_response_time']?.current > this.config.alertThresholds.responseTime) {
      violations.push({
        metric: 'app.avg_response_time',
        current: summary['app.avg_response_time'].current,
        threshold: this.config.alertThresholds.responseTime,
        severity: 'medium'
      });
    }

    // Check error rate
    const requestCount = summary['app.request_count']?.current || 0;
    const errorCount = summary['app.error_count']?.current || 0;
    const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
    
    if (errorRate > this.config.alertThresholds.errorRate) {
      violations.push({
        metric: 'app.error_rate',
        current: errorRate,
        threshold: this.config.alertThresholds.errorRate,
        severity: 'critical'
      });
    }

    return violations;
  }

  /**
   * Clean up old metrics based on retention policy
   */
  private cleanupOldMetrics(): void {
    const now = Date.now();
    
    this.metrics.forEach((series, name) => {
      const cutoffTime = now - series.retention;
      
      series.values = series.values.filter(value => value.timestamp > cutoffTime);
      
      // Update aggregations after cleanup
      this.updateAggregations(series);
    });
  }

  /**
   * Get metrics health status
   */
  public getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  } {
    const summary = this.getMetricsSummary();
    const violations = this.checkThresholdViolations(summary);
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (violations.length > 0) {
      const criticalViolations = violations.filter(v => v.severity === 'critical');
      const highViolations = violations.filter(v => v.severity === 'high');
      
      if (criticalViolations.length > 0) {
        status = 'unhealthy';
      } else if (highViolations.length > 0) {
        status = 'degraded';
      } else {
        status = 'degraded';
      }
    }

    return {
      status,
      details: {
        is_collecting: this.isCollecting,
        metrics_count: this.metrics.size,
        violations_count: violations.length,
        violations: violations.map(v => ({
          metric: v.metric,
          severity: v.severity,
          exceeded_by: ((v.current - v.threshold) / v.threshold * 100).toFixed(1) + '%'
        })),
        collection_interval: this.config.metricsInterval,
        active_exporters: this.config.exporters.filter(e => e.enabled).length
      }
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<MonitoringConfig>): void {
    const wasCollecting = this.isCollecting;
    
    if (wasCollecting) {
      this.stopCollection();
    }
    
    this.config = { ...this.config, ...config };
    
    if (wasCollecting && this.config.enabled) {
      this.startCollection();
    }
    
    secureLog('info', 'Metrics collector configuration updated', {
      updates: sanitizeForLogging(config)
    });
  }

  /**
   * Get configuration
   */
  public getConfig(): MonitoringConfig {
    return { ...this.config };
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    this.metrics.clear();
    secureLog('info', 'All metrics reset');
  }
}
/**
 * System Monitor
 * 
 * Real-time system monitoring during chaos experiments.
 * Collects metrics, detects anomalies, and provides alerting.
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import pidusage from 'pidusage';
import si from 'systeminformation';
import { secureLog } from '../../../src/security.js';

export interface SystemMetrics {
  timestamp: number;
  cpu: CPUMetrics;
  memory: MemoryMetrics;
  network: NetworkMetrics;
  disk: DiskMetrics;
  application: ApplicationMetrics;
  custom: Record<string, number>;
}

export interface CPUMetrics {
  usage: number; // CPU usage percentage (0-1)
  loadAverage: number[]; // Load average [1min, 5min, 15min]
  temperature?: number; // CPU temperature in Celsius
  processes: number; // Number of running processes
}

export interface MemoryMetrics {
  usage: number; // Memory usage percentage (0-1)
  used: number; // Used memory in bytes
  available: number; // Available memory in bytes
  total: number; // Total memory in bytes
  swapUsed: number; // Swap usage in bytes
  swapTotal: number; // Total swap in bytes
}

export interface NetworkMetrics {
  bytesReceived: number; // Bytes received per second
  bytesSent: number; // Bytes sent per second
  packetsReceived: number; // Packets received per second
  packetsSent: number; // Packets sent per second
  connections: number; // Active network connections
  errors: number; // Network errors per second
}

export interface DiskMetrics {
  usage: number; // Disk usage percentage (0-1)
  used: number; // Used disk space in bytes
  available: number; // Available disk space in bytes
  total: number; // Total disk space in bytes
  readRate: number; // Disk read rate (bytes/sec)
  writeRate: number; // Disk write rate (bytes/sec)
  iops: number; // I/O operations per second
}

export interface ApplicationMetrics {
  responseTime: number; // Average response time in milliseconds
  errorRate: number; // Error rate percentage (0-1)
  throughput: number; // Requests per second
  uptime: number; // Application uptime in milliseconds
  memoryUsage: number; // Application memory usage in bytes
  cpuUsage: number; // Application CPU usage percentage (0-1)
  activeConnections: number; // Active application connections
  queueLength: number; // Request queue length
}

export interface AlertConfiguration {
  enabled: boolean;
  thresholds: AlertThresholds;
  cooldownPeriod: number; // Minimum time between alerts in milliseconds
  channels: AlertChannel[];
}

export interface AlertThresholds {
  cpu: { warning: number; critical: number; };
  memory: { warning: number; critical: number; };
  disk: { warning: number; critical: number; };
  responseTime: { warning: number; critical: number; };
  errorRate: { warning: number; critical: number; };
  customMetrics: Record<string, { warning: number; critical: number; }>;
}

export interface AlertChannel {
  type: 'console' | 'webhook' | 'email' | 'sms';
  enabled: boolean;
  configuration: Record<string, any>;
}

export interface Alert {
  id: string;
  timestamp: number;
  level: 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  acknowledged: boolean;
  resolvedAt?: number;
}

export class SystemMonitor extends EventEmitter {
  private monitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;
  private metricsHistory: SystemMetrics[] = [];
  private alerts: Alert[] = [];
  private alertConfiguration: AlertConfiguration;
  private lastAlertTimes: Map<string, number> = new Map();
  private baselineMetrics?: SystemMetrics;

  constructor() {
    super();
    this.initializeAlertConfiguration();
  }

  /**
   * Start system monitoring
   */
  public async startMonitoring(intervalMs: number = 1000): Promise<void> {
    if (this.monitoring) {
      secureLog('warn', 'System monitoring already started');
      return;
    }

    this.monitoring = true;
    
    secureLog('info', 'Starting system monitoring', {
      interval_ms: intervalMs
    });

    // Collect baseline metrics
    this.baselineMetrics = await this.collectMetrics();
    
    this.monitoringInterval = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics();
        this.metricsHistory.push(metrics);
        
        // Keep only last 1000 metrics (about 16 minutes at 1s intervals)
        if (this.metricsHistory.length > 1000) {
          this.metricsHistory.splice(0, this.metricsHistory.length - 1000);
        }

        // Check for alerts
        await this.checkAlerts(metrics);

        // Emit metrics for real-time monitoring
        this.emit('metricsCollected', metrics);

      } catch (error) {
        secureLog('error', 'Error collecting system metrics', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, intervalMs);

    this.emit('monitoringStarted', { intervalMs });
  }

  /**
   * Stop system monitoring
   */
  public async stopMonitoring(): Promise<void> {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    secureLog('info', 'System monitoring stopped', {
      metrics_collected: this.metricsHistory.length,
      alerts_generated: this.alerts.length
    });

    this.emit('monitoringStopped', {
      metricsCollected: this.metricsHistory.length,
      alertsGenerated: this.alerts.length
    });
  }

  /**
   * Collect current system metrics
   */
  public async collectMetrics(): Promise<SystemMetrics> {
    const timestamp = Date.now();
    
    try {
      // Collect system information
      const [cpuInfo, memInfo, networkStats, diskInfo] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.networkStats(),
        si.fsSize()
      ]);

      // Collect application-specific metrics
      const appMetrics = await this.collectApplicationMetrics();

      const metrics: SystemMetrics = {
        timestamp,
        cpu: {
          usage: cpuInfo.currentLoad / 100,
          loadAverage: cpuInfo.avgLoad ? [cpuInfo.avgLoad] : [0],
          temperature: cpuInfo.cpus?.[0]?.temp || undefined,
          processes: cpuInfo.cpus?.length || 1
        },
        memory: {
          usage: memInfo.used / memInfo.total,
          used: memInfo.used,
          available: memInfo.available,
          total: memInfo.total,
          swapUsed: memInfo.swapused,
          swapTotal: memInfo.swaptotal
        },
        network: {
          bytesReceived: networkStats[0]?.rx_bytes || 0,
          bytesSent: networkStats[0]?.tx_bytes || 0,
          packetsReceived: networkStats[0]?.rx_packets || 0,
          packetsSent: networkStats[0]?.tx_packets || 0,
          connections: 0, // Would need additional collection
          errors: (networkStats[0]?.rx_errors || 0) + (networkStats[0]?.tx_errors || 0)
        },
        disk: {
          usage: diskInfo[0] ? diskInfo[0].used / diskInfo[0].size : 0,
          used: diskInfo[0]?.used || 0,
          available: diskInfo[0]?.available || 0,
          total: diskInfo[0]?.size || 0,
          readRate: 0, // Would need additional collection over time
          writeRate: 0, // Would need additional collection over time
          iops: 0 // Would need additional collection
        },
        application: appMetrics,
        custom: {}
      };

      return metrics;

    } catch (error) {
      secureLog('error', 'Failed to collect system metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Return minimal metrics on error
      return {
        timestamp,
        cpu: { usage: 0, loadAverage: [0], processes: 0 },
        memory: { usage: 0, used: 0, available: 0, total: 0, swapUsed: 0, swapTotal: 0 },
        network: { bytesReceived: 0, bytesSent: 0, packetsReceived: 0, packetsSent: 0, connections: 0, errors: 0 },
        disk: { usage: 0, used: 0, available: 0, total: 0, readRate: 0, writeRate: 0, iops: 0 },
        application: this.getDefaultApplicationMetrics(),
        custom: {}
      };
    }
  }

  /**
   * Collect application-specific metrics
   */
  private async collectApplicationMetrics(): Promise<ApplicationMetrics> {
    try {
      // Collect metrics from various sources
      const [bridgeMetrics, processMetrics] = await Promise.all([
        this.collectBridgeMetrics(),
        this.collectProcessMetrics()
      ]);

      return {
        responseTime: bridgeMetrics.responseTime || 0,
        errorRate: bridgeMetrics.errorRate || 0,
        throughput: bridgeMetrics.throughput || 0,
        uptime: process.uptime() * 1000,
        memoryUsage: processMetrics.memory || 0,
        cpuUsage: processMetrics.cpu || 0,
        activeConnections: bridgeMetrics.activeConnections || 0,
        queueLength: bridgeMetrics.queueLength || 0
      };

    } catch (error) {
      return this.getDefaultApplicationMetrics();
    }
  }

  /**
   * Collect bridge-specific metrics
   */
  private async collectBridgeMetrics(): Promise<Partial<ApplicationMetrics>> {
    try {
      const healthEndpoint = process.env.CC_TELEGRAM_HEALTH_ENDPOINT || 'http://localhost:8080/health';
      const metricsEndpoint = healthEndpoint.replace('/health', '/metrics');

      const [healthResponse, metricsResponse] = await Promise.allSettled([
        axios.get(healthEndpoint, { timeout: 2000 }),
        axios.get(metricsEndpoint, { timeout: 2000 })
      ]);

      let responseTime = 0;
      let errorRate = 0;
      let throughput = 0;

      // Calculate response time from health check
      if (healthResponse.status === 'fulfilled') {
        responseTime = 100; // Placeholder - would measure actual response time
      } else {
        responseTime = 5000; // High response time for failed health check
        errorRate = 1.0; // 100% error rate if health check fails
      }

      // Extract metrics from metrics endpoint
      if (metricsResponse.status === 'fulfilled') {
        const metrics = metricsResponse.value.data;
        if (metrics && typeof metrics === 'object') {
          throughput = metrics.requestsPerSecond || 0;
          errorRate = Math.min(errorRate, metrics.errorRate || 0);
        }
      }

      return {
        responseTime,
        errorRate,
        throughput,
        activeConnections: 0, // Would need specific implementation
        queueLength: 0 // Would need specific implementation
      };

    } catch (error) {
      return {
        responseTime: 5000,
        errorRate: 1.0,
        throughput: 0,
        activeConnections: 0,
        queueLength: 0
      };
    }
  }

  /**
   * Collect process-specific metrics
   */
  private async collectProcessMetrics(): Promise<{ memory: number; cpu: number; }> {
    try {
      const stats = await pidusage(process.pid);
      return {
        memory: stats.memory,
        cpu: stats.cpu / 100 // Convert to 0-1 range
      };
    } catch (error) {
      return {
        memory: process.memoryUsage().rss,
        cpu: 0
      };
    }
  }

  /**
   * Check for alert conditions
   */
  private async checkAlerts(metrics: SystemMetrics): Promise<void> {
    if (!this.alertConfiguration.enabled) {
      return;
    }

    const alerts: Alert[] = [];

    // CPU alerts
    alerts.push(...this.checkThresholdAlerts(
      'cpu', 
      metrics.cpu.usage, 
      this.alertConfiguration.thresholds.cpu,
      `CPU usage: ${(metrics.cpu.usage * 100).toFixed(1)}%`
    ));

    // Memory alerts
    alerts.push(...this.checkThresholdAlerts(
      'memory', 
      metrics.memory.usage, 
      this.alertConfiguration.thresholds.memory,
      `Memory usage: ${(metrics.memory.usage * 100).toFixed(1)}%`
    ));

    // Disk alerts
    alerts.push(...this.checkThresholdAlerts(
      'disk', 
      metrics.disk.usage, 
      this.alertConfiguration.thresholds.disk,
      `Disk usage: ${(metrics.disk.usage * 100).toFixed(1)}%`
    ));

    // Response time alerts
    alerts.push(...this.checkThresholdAlerts(
      'responseTime', 
      metrics.application.responseTime, 
      this.alertConfiguration.thresholds.responseTime,
      `Response time: ${metrics.application.responseTime}ms`
    ));

    // Error rate alerts
    alerts.push(...this.checkThresholdAlerts(
      'errorRate', 
      metrics.application.errorRate, 
      this.alertConfiguration.thresholds.errorRate,
      `Error rate: ${(metrics.application.errorRate * 100).toFixed(1)}%`
    ));

    // Custom metric alerts
    for (const [metricName, thresholds] of Object.entries(this.alertConfiguration.thresholds.customMetrics)) {
      const value = metrics.custom[metricName];
      if (value !== undefined) {
        alerts.push(...this.checkThresholdAlerts(
          `custom.${metricName}`, 
          value, 
          thresholds,
          `${metricName}: ${value}`
        ));
      }
    }

    // Process new alerts
    for (const alert of alerts) {
      await this.processAlert(alert);
    }
  }

  /**
   * Check threshold alerts for a metric
   */
  private checkThresholdAlerts(
    metricName: string,
    value: number,
    thresholds: { warning: number; critical: number; },
    message: string
  ): Alert[] {
    const alerts: Alert[] = [];
    const now = Date.now();

    // Check if we're in cooldown period
    const lastAlertTime = this.lastAlertTimes.get(metricName) || 0;
    if (now - lastAlertTime < this.alertConfiguration.cooldownPeriod) {
      return alerts;
    }

    // Check critical threshold
    if (value >= thresholds.critical) {
      alerts.push({
        id: `${metricName}_critical_${now}`,
        timestamp: now,
        level: 'critical',
        metric: metricName,
        value,
        threshold: thresholds.critical,
        message: `CRITICAL: ${message} exceeds threshold ${thresholds.critical}`,
        acknowledged: false
      });
      this.lastAlertTimes.set(metricName, now);
    }
    // Check warning threshold (only if not already critical)
    else if (value >= thresholds.warning) {
      alerts.push({
        id: `${metricName}_warning_${now}`,
        timestamp: now,
        level: 'warning',
        metric: metricName,
        value,
        threshold: thresholds.warning,
        message: `WARNING: ${message} exceeds threshold ${thresholds.warning}`,
        acknowledged: false
      });
      this.lastAlertTimes.set(metricName, now);
    }

    return alerts;
  }

  /**
   * Process a new alert
   */
  private async processAlert(alert: Alert): Promise<void> {
    this.alerts.push(alert);
    
    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.splice(0, this.alerts.length - 100);
    }

    secureLog(alert.level === 'critical' ? 'error' : 'warn', 'System alert triggered', {
      alert_id: alert.id,
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
      level: alert.level
    });

    // Send alert through configured channels
    for (const channel of this.alertConfiguration.channels) {
      if (channel.enabled) {
        try {
          await this.sendAlert(alert, channel);
        } catch (error) {
          secureLog('error', 'Failed to send alert', {
            alert_id: alert.id,
            channel_type: channel.type,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    // Emit alert event
    this.emit('alertTriggered', alert);
  }

  /**
   * Send alert through specific channel
   */
  private async sendAlert(alert: Alert, channel: AlertChannel): Promise<void> {
    switch (channel.type) {
      case 'console':
        console.log(`[${alert.level.toUpperCase()}] ${alert.message}`);
        break;

      case 'webhook':
        if (channel.configuration.url) {
          await axios.post(channel.configuration.url, {
            alert: {
              id: alert.id,
              timestamp: alert.timestamp,
              level: alert.level,
              metric: alert.metric,
              value: alert.value,
              threshold: alert.threshold,
              message: alert.message
            }
          }, { timeout: 5000 });
        }
        break;

      case 'email':
        // Email implementation would go here
        secureLog('info', 'Email alert not implemented', { alert_id: alert.id });
        break;

      case 'sms':
        // SMS implementation would go here
        secureLog('info', 'SMS alert not implemented', { alert_id: alert.id });
        break;
    }
  }

  /**
   * Get metrics history
   */
  public getMetricsHistory(limit?: number): SystemMetrics[] {
    if (limit) {
      return this.metricsHistory.slice(-limit);
    }
    return [...this.metricsHistory];
  }

  /**
   * Get current alerts
   */
  public getAlerts(activeOnly: boolean = false): Alert[] {
    if (activeOnly) {
      return this.alerts.filter(alert => !alert.acknowledged && !alert.resolvedAt);
    }
    return [...this.alerts];
  }

  /**
   * Acknowledge alert
   */
  public acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.emit('alertAcknowledged', alert);
      return true;
    }
    return false;
  }

  /**
   * Resolve alert
   */
  public resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolvedAt = Date.now();
      this.emit('alertResolved', alert);
      return true;
    }
    return false;
  }

  /**
   * Add custom metric
   */
  public addCustomMetric(name: string, value: number): void {
    if (this.metricsHistory.length > 0) {
      const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1];
      latestMetrics.custom[name] = value;
    }
  }

  /**
   * Update alert configuration
   */
  public updateAlertConfiguration(config: Partial<AlertConfiguration>): void {
    this.alertConfiguration = { ...this.alertConfiguration, ...config };
    secureLog('info', 'Alert configuration updated', config);
  }

  /**
   * Get system health status
   */
  public getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    issues: string[];
    metrics: SystemMetrics | null;
  } {
    const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1];
    const activeAlerts = this.getAlerts(true);
    const issues: string[] = [];

    if (!latestMetrics) {
      return {
        status: 'unhealthy',
        issues: ['No metrics available'],
        metrics: null
      };
    }

    // Check for critical issues
    const criticalAlerts = activeAlerts.filter(a => a.level === 'critical');
    if (criticalAlerts.length > 0) {
      issues.push(`${criticalAlerts.length} critical alerts active`);
      return {
        status: 'unhealthy',
        issues,
        metrics: latestMetrics
      };
    }

    // Check for warnings
    const warningAlerts = activeAlerts.filter(a => a.level === 'warning');
    if (warningAlerts.length > 0) {
      issues.push(`${warningAlerts.length} warning alerts active`);
    }

    // Check key metrics
    if (latestMetrics.cpu.usage > 0.8) {
      issues.push('High CPU usage');
    }
    if (latestMetrics.memory.usage > 0.8) {
      issues.push('High memory usage');
    }
    if (latestMetrics.application.errorRate > 0.1) {
      issues.push('High error rate');
    }

    const status = issues.length > 0 ? 'degraded' : 'healthy';
    
    return {
      status,
      issues,
      metrics: latestMetrics
    };
  }

  /**
   * Initialize default alert configuration
   */
  private initializeAlertConfiguration(): void {
    this.alertConfiguration = {
      enabled: true,
      cooldownPeriod: 60000, // 1 minute
      thresholds: {
        cpu: { warning: 0.7, critical: 0.9 },
        memory: { warning: 0.8, critical: 0.95 },
        disk: { warning: 0.8, critical: 0.95 },
        responseTime: { warning: 5000, critical: 10000 },
        errorRate: { warning: 0.1, critical: 0.5 },
        customMetrics: {}
      },
      channels: [
        {
          type: 'console',
          enabled: true,
          configuration: {}
        }
      ]
    };
  }

  /**
   * Get default application metrics
   */
  private getDefaultApplicationMetrics(): ApplicationMetrics {
    return {
      responseTime: 0,
      errorRate: 0,
      throughput: 0,
      uptime: process.uptime() * 1000,
      memoryUsage: process.memoryUsage().rss,
      cpuUsage: 0,
      activeConnections: 0,
      queueLength: 0
    };
  }

  /**
   * Get monitoring status
   */
  public isMonitoring(): boolean {
    return this.monitoring;
  }

  /**
   * Get baseline metrics
   */
  public getBaselineMetrics(): SystemMetrics | undefined {
    return this.baselineMetrics;
  }
}
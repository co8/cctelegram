/**
 * Observability Manager
 * 
 * Central orchestration system for all observability components including
 * metrics, logging, tracing, security monitoring, and alerting.
 */

import { EventEmitter } from 'events';
import { ObservabilityConfig } from './config.js';
import { MetricsCollector } from './metrics/metrics-collector.js';
import { StructuredLogger } from './logging/structured-logger.js';
import { TracingManager } from './tracing/tracing-manager.js';
import { SecurityMonitor } from './security/security-monitor.js';
import { PerformanceMonitor } from './performance/performance-monitor.js';
import { AlertingEngine } from './alerting/alerting-engine.js';
import { DashboardManager } from './dashboard/dashboard-manager.js';
import { HealthChecker } from './health/health-checker.js';
import { secureLog } from '../security.js';

export interface ObservabilityEvent {
  type: 'metric' | 'log' | 'trace' | 'alert' | 'health' | 'security';
  timestamp: number;
  source: string;
  data: any;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  correlationId?: string;
}

export interface ObservabilityStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    metrics: ComponentStatus;
    logging: ComponentStatus;
    tracing: ComponentStatus;
    security: ComponentStatus;
    performance: ComponentStatus;
    alerting: ComponentStatus;
    dashboard: ComponentStatus;
    health: ComponentStatus;
  };
  startTime: number;
  uptime: number;
  version: string;
}

export interface ComponentStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'disabled';
  enabled: boolean;
  lastCheck: number;
  details: Record<string, any>;
  errors?: string[];
}

export class ObservabilityManager extends EventEmitter {
  private config: ObservabilityConfig;
  private components: Map<string, any> = new Map();
  private startTime: number;
  private isRunning: boolean = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // Component instances
  private metrics?: MetricsCollector;
  private logger?: StructuredLogger;
  private tracing?: TracingManager;
  private security?: SecurityMonitor;
  private performance?: PerformanceMonitor;
  private alerting?: AlertingEngine;
  private dashboard?: DashboardManager;
  private health?: HealthChecker;

  constructor(config: ObservabilityConfig) {
    super();
    this.config = config;
    this.startTime = Date.now();
    
    secureLog('info', 'Observability manager initialized', {
      enabled: config.enabled,
      environment: config.environment,
      service: config.serviceName,
      version: config.serviceVersion
    });

    if (config.enabled) {
      this.initializeComponents();
    }
  }

  /**
   * Initialize all observability components
   */
  private async initializeComponents(): Promise<void> {
    try {
      // Initialize logger first as other components depend on it
      if (this.config.logging.enabled) {
        this.logger = new StructuredLogger(this.config.logging);
        this.components.set('logging', this.logger);
        await this.logger.initialize();
      }

      // Initialize metrics collector
      if (this.config.metrics.enabled) {
        this.metrics = new MetricsCollector(this.config.metrics);
        this.components.set('metrics', this.metrics);
        await this.metrics.initialize();
      }

      // Initialize distributed tracing
      if (this.config.tracing.enabled) {
        this.tracing = new TracingManager(this.config.tracing);
        this.components.set('tracing', this.tracing);
        await this.tracing.initialize();
      }

      // Initialize security monitoring
      if (this.config.security.enabled) {
        this.security = new SecurityMonitor(this.config.security, this.logger);
        this.components.set('security', this.security);
        await this.security.initialize();
      }

      // Initialize performance monitoring
      if (this.config.performance.enabled) {
        this.performance = new PerformanceMonitor(this.config.performance, this.metrics);
        this.components.set('performance', this.performance);
        await this.performance.initialize();
      }

      // Initialize alerting engine
      if (this.config.alerting.enabled) {
        this.alerting = new AlertingEngine(this.config.alerting, this.logger);
        this.components.set('alerting', this.alerting);
        await this.alerting.initialize();
      }

      // Initialize dashboard
      if (this.config.dashboard.enabled) {
        this.dashboard = new DashboardManager(this.config.dashboard, this.metrics);
        this.components.set('dashboard', this.dashboard);
        await this.dashboard.initialize();
      }

      // Initialize health checker
      if (this.config.health.enabled) {
        this.health = new HealthChecker(this.config.health, this.logger);
        this.components.set('health', this.health);
        await this.health.initialize();
      }

      // Set up component event listeners
      this.setupEventListeners();

      secureLog('info', 'All observability components initialized', {
        components: Array.from(this.components.keys())
      });

    } catch (error) {
      secureLog('error', 'Failed to initialize observability components', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Set up event listeners between components
   */
  private setupEventListeners(): void {
    // Metrics to alerting
    if (this.metrics && this.alerting) {
      this.metrics.on('threshold_violation', (event) => {
        this.alerting?.processAlert({
          type: 'metric',
          source: 'metrics',
          timestamp: Date.now(),
          data: event,
          severity: event.severity || 'medium'
        });
      });
    }

    // Security to alerting
    if (this.security && this.alerting) {
      this.security.on('security_event', (event) => {
        this.alerting?.processAlert({
          type: 'security',
          source: 'security',
          timestamp: Date.now(),
          data: event,
          severity: event.severity || 'high'
        });
      });
    }

    // Performance to alerting
    if (this.performance && this.alerting) {
      this.performance.on('sla_violation', (event) => {
        this.alerting?.processAlert({
          type: 'performance',
          source: 'performance',
          timestamp: Date.now(),
          data: event,
          severity: event.severity || 'medium'
        });
      });
    }

    // Health to alerting
    if (this.health && this.alerting) {
      this.health.on('health_change', (event) => {
        if (event.status === 'unhealthy') {
          this.alerting?.processAlert({
            type: 'health',
            source: 'health',
            timestamp: Date.now(),
            data: event,
            severity: 'critical'
          });
        }
      });
    }

    // Cross-component correlation
    this.setupCorrelation();
  }

  /**
   * Set up correlation between components
   */
  private setupCorrelation(): void {
    // Correlate traces with metrics
    if (this.tracing && this.metrics) {
      this.tracing.on('span_finished', (span) => {
        this.metrics?.recordSpanMetrics(span);
      });
    }

    // Correlate logs with traces
    if (this.logger && this.tracing) {
      this.logger.setTraceContext(this.tracing.getTracer());
    }

    // Correlate security events with performance
    if (this.security && this.performance) {
      this.security.on('suspicious_activity', (event) => {
        this.performance?.recordSecurityEvent(event);
      });
    }
  }

  /**
   * Start the observability system
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    try {
      // Start all components
      for (const [name, component] of this.components) {
        if (component.start) {
          await component.start();
          secureLog('debug', `Started ${name} component`);
        }
      }

      // Start health checking
      if (this.config.health.enabled) {
        this.startHealthChecking();
      }

      this.isRunning = true;
      this.emit('started');

      secureLog('info', 'Observability system started', {
        components: Array.from(this.components.keys()),
        uptime: Date.now() - this.startTime
      });

    } catch (error) {
      secureLog('error', 'Failed to start observability system', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Stop the observability system
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Stop health checking
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Stop all components in reverse order
      const componentEntries = Array.from(this.components.entries()).reverse();
      for (const [name, component] of componentEntries) {
        if (component.stop) {
          await component.stop();
          secureLog('debug', `Stopped ${name} component`);
        }
      }

      this.isRunning = false;
      this.emit('stopped');

      secureLog('info', 'Observability system stopped', {
        uptime: Date.now() - this.startTime
      });

    } catch (error) {
      secureLog('error', 'Failed to stop observability system', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Start periodic health checking
   */
  private startHealthChecking(): void {
    const checkHealth = async () => {
      try {
        const status = await this.getSystemStatus();
        this.emit('health_check', status);

        // Alert on system degradation
        if (status.overall !== 'healthy' && this.alerting) {
          this.alerting.processAlert({
            type: 'health',
            source: 'observability_manager',
            timestamp: Date.now(),
            data: {
              status: status.overall,
              unhealthy_components: Object.entries(status.components)
                .filter(([_, comp]) => comp.status !== 'healthy')
                .map(([name, comp]) => ({ name, status: comp.status, errors: comp.errors }))
            },
            severity: status.overall === 'unhealthy' ? 'critical' : 'high'
          });
        }

      } catch (error) {
        secureLog('error', 'Health check failed', {
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    };

    // Run initial health check
    checkHealth();

    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(checkHealth, 60000); // Every minute
  }

  /**
   * Get system status
   */
  public async getSystemStatus(): Promise<ObservabilityStatus> {
    const componentStatuses: ObservabilityStatus['components'] = {
      metrics: await this.getComponentStatus('metrics'),
      logging: await this.getComponentStatus('logging'),
      tracing: await this.getComponentStatus('tracing'),
      security: await this.getComponentStatus('security'),
      performance: await this.getComponentStatus('performance'),
      alerting: await this.getComponentStatus('alerting'),
      dashboard: await this.getComponentStatus('dashboard'),
      health: await this.getComponentStatus('health')
    };

    // Determine overall status
    const statuses = Object.values(componentStatuses).map(comp => comp.status);
    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (statuses.includes('unhealthy')) {
      overall = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      overall = 'degraded';
    }

    return {
      overall,
      components: componentStatuses,
      startTime: this.startTime,
      uptime: Date.now() - this.startTime,
      version: this.config.serviceVersion
    };
  }

  /**
   * Get status of a specific component
   */
  private async getComponentStatus(componentName: string): Promise<ComponentStatus> {
    const component = this.components.get(componentName);
    
    if (!component) {
      return {
        status: 'disabled',
        enabled: false,
        lastCheck: Date.now(),
        details: { message: 'Component not initialized' }
      };
    }

    try {
      const status = component.getHealthStatus ? await component.getHealthStatus() : { status: 'healthy' };
      
      return {
        status: status.status || 'healthy',
        enabled: true,
        lastCheck: Date.now(),
        details: status.details || {},
        errors: status.errors
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        enabled: true,
        lastCheck: Date.now(),
        details: { message: 'Health check failed' },
        errors: [error instanceof Error ? error.message : 'unknown error']
      };
    }
  }

  /**
   * Record an observability event
   */
  public recordEvent(event: ObservabilityEvent): void {
    // Add correlation ID if not present
    if (!event.correlationId && this.tracing) {
      event.correlationId = this.tracing.getCurrentTraceId();
    }

    // Route to appropriate component
    switch (event.type) {
      case 'metric':
        this.metrics?.recordCustomMetric(event.data);
        break;
      case 'log':
        this.logger?.logEvent(event);
        break;
      case 'trace':
        this.tracing?.recordSpan(event.data);
        break;
      case 'alert':
        this.alerting?.processAlert(event);
        break;
      case 'security':
        this.security?.recordSecurityEvent(event.data);
        break;
      case 'health':
        this.health?.recordHealthEvent(event.data);
        break;
    }

    // Emit for any listeners
    this.emit('event', event);
  }

  /**
   * Get metrics data
   */
  public getMetrics(): Record<string, any> {
    return this.metrics?.getAllMetrics() || {};
  }

  /**
   * Get recent logs
   */
  public getRecentLogs(limit: number = 100): any[] {
    return this.logger?.getRecentLogs(limit) || [];
  }

  /**
   * Get active alerts
   */
  public getActiveAlerts(): any[] {
    return this.alerting?.getActiveAlerts() || [];
  }

  /**
   * Get security events
   */
  public getSecurityEvents(limit: number = 50): any[] {
    return this.security?.getRecentEvents(limit) || [];
  }

  /**
   * Get performance summary
   */
  public getPerformanceSummary(): Record<string, any> {
    return this.performance?.getSummary() || {};
  }

  /**
   * Update configuration
   */
  public async updateConfig(newConfig: Partial<ObservabilityConfig>): Promise<void> {
    const wasRunning = this.isRunning;

    // Stop if running
    if (wasRunning) {
      await this.stop();
    }

    // Update configuration
    this.config = { ...this.config, ...newConfig };

    // Update component configurations
    for (const [name, component] of this.components) {
      if (component.updateConfig) {
        const componentConfig = (newConfig as any)[name];
        if (componentConfig) {
          component.updateConfig(componentConfig);
        }
      }
    }

    // Restart if it was running
    if (wasRunning) {
      await this.start();
    }

    secureLog('info', 'Observability configuration updated', {
      updates: Object.keys(newConfig)
    });
  }

  /**
   * Export configuration
   */
  public getConfig(): ObservabilityConfig {
    return { ...this.config };
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    await this.stop();
    this.components.clear();
    this.removeAllListeners();
  }
}
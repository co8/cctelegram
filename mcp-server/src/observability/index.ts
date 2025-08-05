/**
 * Observability Module Index
 * 
 * Central exports for the complete observability stack including metrics,
 * logging, tracing, security monitoring, performance monitoring, alerting,
 * dashboard, and health checking components.
 */

// Core orchestration
export { ObservabilityManager } from './manager.js';
export type { ObservabilityConfig } from './config.js';

// Metrics collection
export { MetricsCollector } from './metrics/metrics-collector.js';
export type { 
  MetricDefinition, 
  CustomMetric, 
  MetricThreshold,
  MetricsSummary 
} from './metrics/metrics-collector.js';

// Structured logging
export { StructuredLogger } from './logging/structured-logger.js';
export type { 
  LogEntry, 
  LogAggregation, 
  LogConfig 
} from './logging/structured-logger.js';

// Distributed tracing
export { TracingManager } from './tracing/tracing-manager.js';
export type { 
  SpanData, 
  TraceMetrics 
} from './tracing/tracing-manager.js';

// Security monitoring
export { SecurityMonitor } from './security/security-monitor.js';
export type { 
  SecurityEvent, 
  SecurityEventType,
  SecurityClassification,
  SecurityMitigation,
  ThreatIndicator,
  SecurityMetrics,
  ComplianceCheck 
} from './security/security-monitor.js';

// Performance monitoring
export { PerformanceMonitor } from './performance/performance-monitor.js';
export type { 
  PerformanceMetrics,
  SLAMetrics,
  PerformanceBaseline,
  BottleneckAnalysis,
  OptimizationRecommendation 
} from './performance/performance-monitor.js';

// Alerting engine
export { AlertingEngine } from './alerting/alerting-engine.js';
export type { 
  Alert, 
  AlertNotification,
  AlertStatistics,
  SuppressionRule 
} from './alerting/alerting-engine.js';

// Dashboard management
export { DashboardManager } from './dashboard/dashboard-manager.js';
export type { 
  DashboardData,
  SystemOverview,
  AlertSummary,
  PerformanceSummary,
  SecuritySummary 
} from './dashboard/dashboard-manager.js';

// Health checking
export { HealthChecker } from './health/health-checker.js';
export type { 
  HealthStatus,
  HealthCheckResult,
  DependencyStatus,
  CircuitBreaker 
} from './health/health-checker.js';

// Configuration types
export type {
  MetricsConfig,
  LoggingConfig, 
  TracingConfig,
  SecurityMonitoringConfig,
  PerformanceMonitoringConfig,
  AlertingConfig,
  DashboardConfig,
  HealthConfig,
  AlertChannel,
  AlertRule,
  EscalationLevel,
  EscalationRule,
  TracingExporter,
  DashboardPanel,
  DashboardUser,
  HealthCheck
} from './config.js';

// Utility functions
export { 
  createObservabilityConfig, 
  validateObservabilityConfig 
} from './config.js';

/**
 * Factory function to create a complete observability system
 */
export async function createObservabilitySystem(config: ObservabilityConfig): Promise<ObservabilityManager> {
  const manager = new ObservabilityManager(config);
  await manager.initialize();
  return manager;
}

/**
 * Re-export integration utilities
 */
export { 
  createObservabilityIntegration,
  integrateWithExpress,
  integrateWithHttpServer
} from './integration.js';
export type { ObservabilityIntegration } from './integration.js';

/**
 * Health check factory for common checks
 */
export function createSystemHealthChecks(): HealthCheck[] {
  return [
    {
      id: 'memory',
      name: 'Memory Usage',
      type: 'system',
      enabled: true,
      timeout: 1000,
      interval: 30000,
      retryCount: 1,
      critical: true,
      thresholds: { warning: 70, critical: 85 }
    },
    {
      id: 'cpu',
      name: 'CPU Usage', 
      type: 'system',
      enabled: true,
      timeout: 1000,
      interval: 30000,
      retryCount: 1,
      critical: true,
      thresholds: { warning: 70, critical: 90 }
    },
    {
      id: 'event_loop',
      name: 'Event Loop Lag',
      type: 'system',
      enabled: true,
      timeout: 1000,
      interval: 15000,
      retryCount: 1,
      critical: true,
      thresholds: { warning: 50, critical: 100 }
    }
  ];
}

/**
 * Default observability configuration
 */
export function getDefaultObservabilityConfig(): Partial<ObservabilityConfig> {
  return {
    enabled: true,
    environment: process.env.NODE_ENV || 'development',
    serviceName: 'cctelegram-mcp-server',
    serviceVersion: '1.5.0',
    
    metrics: {
      enabled: true,
      port: 9090,
      endpoint: '/metrics',
      interval: 10000,
      retention: 3600000,
      defaultLabels: {
        service: 'cctelegram-mcp-server',
        version: '1.5.0'
      },
      customMetrics: [],
      thresholds: []
    },

    logging: {
      enabled: true,
      level: 'info',
      format: 'json',
      outputs: ['console'],
      rotation: {
        enabled: false,
        maxFiles: 10,
        maxSize: '100MB'
      },
      sanitization: {
        enabled: true,
        patterns: [],
        redactFields: ['password', 'token', 'secret', 'key']
      },
      aggregation: {
        enabled: true,
        window: 60000,
        threshold: 10
      }
    },

    tracing: {
      enabled: false, // Disabled by default due to overhead
      serviceName: 'cctelegram-mcp-server',
      serviceVersion: '1.5.0',
      environment: process.env.NODE_ENV || 'development',
      samplingRate: 0.1,
      exporters: [
        {
          type: 'console',
          enabled: true,
          endpoint: '',
          options: {}
        }
      ],
      instrumentation: {
        http: true,
        filesystem: false,
        database: false
      },
      context: {
        propagation: true,
        headers: ['x-trace-id', 'x-span-id']
      }
    },

    health: {
      enabled: true,
      endpoint: '/health',
      interval: 30000,
      timeout: 5000,
      checks: createSystemHealthChecks()
    }
  };
}
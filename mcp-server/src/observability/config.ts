/**
 * Observability Configuration System
 * 
 * Enterprise-grade configuration for comprehensive monitoring,
 * logging, tracing, and alerting systems.
 */

export interface MetricsConfig {
  enabled: boolean;
  port: number;
  path: string;
  interval: number; // Collection interval in ms
  retention: number; // Retention period in ms
  prometheus: {
    enabled: boolean;
    endpoint: string;
    pushGateway?: string;
    job: string;
    instance: string;
  };
  customMetrics: {
    enabled: boolean;
    prefix: string;
    labels: Record<string, string>;
  };
}

export interface LoggingConfig {
  enabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  format: 'json' | 'pretty' | 'text';
  outputs: LogOutput[];
  structured: boolean;
  correlation: {
    enabled: boolean;
    traceHeader: string;
    spanHeader: string;
  };
  security: {
    sanitization: boolean;
    maskPatterns: string[];
    redactFields: string[];
  };
  aggregation: {
    enabled: boolean;
    windowSize: number; // in ms
    maxEntries: number;
  };
}

export interface LogOutput {
  type: 'console' | 'file' | 'elasticsearch' | 'loki' | 'custom';
  enabled: boolean;
  level?: string;
  options: Record<string, any>;
}

export interface TracingConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  samplingRate: number; // 0.0 to 1.0
  exporters: TracingExporter[];
  instrumentation: {
    http: boolean;
    filesystem: boolean;
    database: boolean;
    external: boolean;
  };
  context: {
    propagation: boolean;
    headers: string[];
  };
}

export interface TracingExporter {
  type: 'jaeger' | 'zipkin' | 'otlp' | 'console';
  enabled: boolean;
  endpoint?: string;
  options?: Record<string, any>;
}

export interface SecurityMonitoringConfig {
  enabled: boolean;
  threatDetection: {
    enabled: boolean;
    suspiciousPatterns: string[];
    rateLimitThresholds: {
      requests: number;
      timeWindow: number; // in ms
    };
    authFailureThreshold: number;
    ipWhitelist: string[];
    ipBlacklist: string[];
  };
  compliance: {
    enabled: boolean;
    standards: ('SOC2' | 'PCI-DSS' | 'GDPR' | 'HIPAA')[];
    auditTrail: boolean;
    dataClassification: boolean;
  };
  incidentResponse: {
    enabled: boolean;
    autoBlock: boolean;
    escalationRules: EscalationRule[];
    notificationChannels: string[];
  };
}

export interface EscalationRule {
  condition: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'log' | 'alert' | 'block' | 'escalate';
  delay: number; // in ms
}

export interface PerformanceMonitoringConfig {
  enabled: boolean;
  slaTargets: {
    availability: number; // percentage
    responseTime: number; // in ms
    errorRate: number; // percentage
    throughput: number; // requests per second
  };
  thresholds: {
    cpu: number; // percentage
    memory: number; // percentage
    disk: number; // percentage
    network: number; // bytes per second
  };
  profiling: {
    enabled: boolean;
    interval: number; // in ms
    duration: number; // in ms
    heapSnapshots: boolean;
    cpuProfile: boolean;
  };
  optimization: {
    enabled: boolean;
    autoTuning: boolean;
    recommendationEngine: boolean;
  };
}

export interface AlertingConfig {
  enabled: boolean;
  channels: AlertChannel[];
  rules: AlertRule[];
  escalation: {
    enabled: boolean;
    levels: EscalationLevel[];
    timeout: number; // in ms
  };
  suppression: {
    enabled: boolean;
    duplicateWindow: number; // in ms
    maxAlertsPerMinute: number;
  };
  recovery: {
    enabled: boolean;
    autoResolve: boolean;
    resolutionTimeout: number; // in ms
  };
}

export interface AlertChannel {
  name: string;
  type: 'telegram' | 'email' | 'slack' | 'webhook' | 'pagerduty';
  enabled: boolean;
  config: Record<string, any>;
  severity: ('low' | 'medium' | 'high' | 'critical')[];
}

export interface AlertRule {
  name: string;
  description: string;
  enabled: boolean;
  metric: string;
  condition: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';
  threshold: number;
  duration: number; // in ms
  severity: 'low' | 'medium' | 'high' | 'critical';
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface EscalationLevel {
  level: number;
  delay: number; // in ms
  channels: string[];
  actions: string[];
}

export interface DashboardConfig {
  enabled: boolean;
  port: number;
  authentication: {
    enabled: boolean;
    type: 'basic' | 'oauth' | 'saml';
    users: DashboardUser[];
  };
  panels: DashboardPanel[];
  refresh: {
    enabled: boolean;
    interval: number; // in ms
  };
  export: {
    enabled: boolean;
    formats: ('pdf' | 'png' | 'json')[];
  };
}

export interface DashboardUser {
  username: string;
  password: string;
  role: 'viewer' | 'editor' | 'admin';
}

export interface DashboardPanel {
  id: string;
  title: string;
  type: 'graph' | 'table' | 'stat' | 'gauge' | 'heatmap';
  query: string;
  position: { x: number; y: number; width: number; height: number };
  options: Record<string, any>;
}

export interface ObservabilityConfig {
  enabled: boolean;
  environment: 'development' | 'staging' | 'production';
  serviceName: string;
  serviceVersion: string;
  
  metrics: MetricsConfig;
  logging: LoggingConfig;
  tracing: TracingConfig;
  security: SecurityMonitoringConfig;
  performance: PerformanceMonitoringConfig;
  alerting: AlertingConfig;
  dashboard: DashboardConfig;
  
  // Integration with existing resilience framework
  resilience: {
    enabled: boolean;
    metricsIntegration: boolean;
    alertingIntegration: boolean;
  };
  
  // Health checks and uptime monitoring
  health: {
    enabled: boolean;
    endpoint: string;
    checks: HealthCheck[];
    timeout: number; // in ms
  };
}

export interface HealthCheck {
  name: string;
  type: 'http' | 'tcp' | 'command' | 'custom';
  target: string;
  interval: number; // in ms
  timeout: number; // in ms
  retries: number;
  critical: boolean;
}

// Default configuration factory
export function createDefaultObservabilityConfig(): ObservabilityConfig {
  const environment = (process.env.NODE_ENV as any) || 'development';
  const serviceName = process.env.SERVICE_NAME || 'cctelegram-mcp-server';
  const serviceVersion = process.env.SERVICE_VERSION || '1.5.0';

  return {
    enabled: true,
    environment,
    serviceName,
    serviceVersion,
    
    metrics: {
      enabled: true,
      port: parseInt(process.env.METRICS_PORT || '9090'),
      path: '/metrics',
      interval: 10000, // 10 seconds
      retention: 24 * 60 * 60 * 1000, // 24 hours
      prometheus: {
        enabled: process.env.PROMETHEUS_ENABLED === 'true',
        endpoint: process.env.PROMETHEUS_ENDPOINT || 'http://localhost:9090',
        pushGateway: process.env.PROMETHEUS_PUSHGATEWAY,
        job: serviceName,
        instance: process.env.HOSTNAME || 'localhost'
      },
      customMetrics: {
        enabled: true,
        prefix: 'cctelegram_',
        labels: {
          service: serviceName,
          version: serviceVersion,
          environment
        }
      }
    },
    
    logging: {
      enabled: true,
      level: (process.env.LOG_LEVEL as any) || 'info',
      format: environment === 'production' ? 'json' : 'pretty',
      structured: true,
      outputs: [
        {
          type: 'console',
          enabled: true,
          level: 'info'
        },
        {
          type: 'file',
          enabled: environment === 'production',
          options: {
            filename: 'logs/application.log',
            maxSize: '100MB',
            maxFiles: 10,
            compress: true
          }
        }
      ],
      correlation: {
        enabled: true,
        traceHeader: 'x-trace-id',
        spanHeader: 'x-span-id'
      },
      security: {
        sanitization: true,
        maskPatterns: [
          '\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b', // Credit cards
          '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b', // Emails
          'Bearer\\s+[A-Za-z0-9\\-\\._~\\+\\/]+=*', // Bearer tokens
          'password["\']?\\s*[:=]\\s*["\']?[^\\s"\']+' // Passwords
        ],
        redactFields: ['password', 'token', 'api_key', 'secret', 'authorization']
      },
      aggregation: {
        enabled: true,
        windowSize: 60000, // 1 minute
        maxEntries: 1000
      }
    },
    
    tracing: {
      enabled: process.env.TRACING_ENABLED === 'true',
      serviceName,
      serviceVersion,
      environment,
      samplingRate: parseFloat(process.env.TRACING_SAMPLE_RATE || '0.1'),
      exporters: [
        {
          type: 'jaeger',
          enabled: process.env.JAEGER_ENABLED === 'true',
          endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces'
        },
        {
          type: 'console',
          enabled: environment === 'development'
        }
      ],
      instrumentation: {
        http: true,
        filesystem: true,
        database: false,
        external: true
      },
      context: {
        propagation: true,
        headers: ['x-trace-id', 'x-span-id', 'x-request-id']
      }
    },
    
    security: {
      enabled: true,
      threatDetection: {
        enabled: true,
        suspiciousPatterns: [
          'union.*select',
          'script.*alert',
          '../',
          'eval\\(',
          'exec\\(',
          'system\\('
        ],
        rateLimitThresholds: {
          requests: 100,
          timeWindow: 60000 // 1 minute
        },
        authFailureThreshold: 5,
        ipWhitelist: [],
        ipBlacklist: []
      },
      compliance: {
        enabled: environment === 'production',
        standards: ['SOC2'],
        auditTrail: true,
        dataClassification: true
      },
      incidentResponse: {
        enabled: true,
        autoBlock: environment === 'production',
        escalationRules: [
          {
            condition: 'auth_failure_rate > 10',
            severity: 'high',
            action: 'alert',
            delay: 0
          },
          {
            condition: 'suspicious_pattern_detected',
            severity: 'critical',
            action: 'block',
            delay: 0
          }
        ],
        notificationChannels: ['telegram']
      }
    },
    
    performance: {
      enabled: true,
      slaTargets: {
        availability: 99.9,
        responseTime: 1000, // 1 second
        errorRate: 0.1, // 0.1%
        throughput: 100 // 100 RPS
      },
      thresholds: {
        cpu: 80, // 80%
        memory: 85, // 85%
        disk: 90, // 90%
        network: 100 * 1024 * 1024 // 100 MB/s
      },
      profiling: {
        enabled: environment === 'development',
        interval: 60000, // 1 minute
        duration: 30000, // 30 seconds
        heapSnapshots: false,
        cpuProfile: false
      },
      optimization: {
        enabled: true,
        autoTuning: false,
        recommendationEngine: true
      }
    },
    
    alerting: {
      enabled: true,
      channels: [
        {
          name: 'telegram',
          type: 'telegram',
          enabled: true,
          config: {
            // Will use existing CCTelegram integration
          },
          severity: ['medium', 'high', 'critical']
        }
      ],
      rules: [
        {
          name: 'high_cpu_usage',
          description: 'CPU usage above 80%',
          enabled: true,
          metric: 'cpu_usage_percent',
          condition: 'gt',
          threshold: 80,
          duration: 300000, // 5 minutes
          severity: 'high',
          labels: { component: 'system' },
          annotations: { runbook: 'cpu-high-usage.md' }
        },
        {
          name: 'high_memory_usage',
          description: 'Memory usage above 85%',
          enabled: true,
          metric: 'memory_usage_percent',
          condition: 'gt',
          threshold: 85,
          duration: 300000, // 5 minutes
          severity: 'high',
          labels: { component: 'system' },
          annotations: { runbook: 'memory-high-usage.md' }
        },
        {
          name: 'high_error_rate',
          description: 'Error rate above 5%',
          enabled: true,
          metric: 'error_rate_percent',
          condition: 'gt',
          threshold: 5,
          duration: 120000, // 2 minutes
          severity: 'critical',
          labels: { component: 'application' },
          annotations: { runbook: 'high-error-rate.md' }
        },
        {
          name: 'slow_response_time',
          description: 'Average response time above 2 seconds',
          enabled: true,
          metric: 'response_time_ms',
          condition: 'gt',
          threshold: 2000,
          duration: 180000, // 3 minutes
          severity: 'medium',
          labels: { component: 'performance' },
          annotations: { runbook: 'slow-response.md' }
        }
      ],
      escalation: {
        enabled: true,
        levels: [
          {
            level: 1,
            delay: 0,
            channels: ['telegram'],
            actions: ['notify']
          },
          {
            level: 2,
            delay: 900000, // 15 minutes
            channels: ['telegram'],
            actions: ['notify', 'page']
          }
        ],
        timeout: 3600000 // 1 hour
      },
      suppression: {
        enabled: true,
        duplicateWindow: 300000, // 5 minutes
        maxAlertsPerMinute: 10
      },
      recovery: {
        enabled: true,
        autoResolve: true,
        resolutionTimeout: 1800000 // 30 minutes
      }
    },
    
    dashboard: {
      enabled: process.env.DASHBOARD_ENABLED === 'true',
      port: parseInt(process.env.DASHBOARD_PORT || '3000'),
      authentication: {
        enabled: environment === 'production',
        type: 'basic',
        users: [
          {
            username: process.env.DASHBOARD_USER || 'admin',
            password: process.env.DASHBOARD_PASSWORD || 'admin123',
            role: 'admin'
          }
        ]
      },
      panels: [
        {
          id: 'system_overview',
          title: 'System Overview',
          type: 'stat',
          query: 'system_health_status',
          position: { x: 0, y: 0, width: 6, height: 3 },
          options: {}
        },
        {
          id: 'response_time',
          title: 'Response Time',
          type: 'graph',
          query: 'response_time_ms',
          position: { x: 6, y: 0, width: 6, height: 3 },
          options: { unit: 'ms' }
        },
        {
          id: 'error_rate',
          title: 'Error Rate',
          type: 'graph',
          query: 'error_rate_percent',
          position: { x: 0, y: 3, width: 6, height: 3 },
          options: { unit: '%' }
        },
        {
          id: 'throughput',
          title: 'Throughput',
          type: 'graph',
          query: 'requests_per_second',
          position: { x: 6, y: 3, width: 6, height: 3 },
          options: { unit: 'rps' }
        }
      ],
      refresh: {
        enabled: true,
        interval: 30000 // 30 seconds
      },
      export: {
        enabled: true,
        formats: ['pdf', 'png']
      }
    },
    
    resilience: {
      enabled: true,
      metricsIntegration: true,
      alertingIntegration: true
    },
    
    health: {
      enabled: true,
      endpoint: '/health',
      timeout: 5000, // 5 seconds
      checks: [
        {
          name: 'bridge_connectivity',
          type: 'http',
          target: 'http://localhost:8080/health',
          interval: 30000, // 30 seconds
          timeout: 5000, // 5 seconds
          retries: 3,
          critical: true
        },
        {
          name: 'filesystem_write',
          type: 'custom',
          target: 'filesystem_check',
          interval: 60000, // 1 minute
          timeout: 5000, // 5 seconds
          retries: 2,
          critical: false
        }
      ]
    }
  };
}

// Configuration validation
export function validateObservabilityConfig(config: ObservabilityConfig): string[] {
  const errors: string[] = [];
  
  // Validate metrics config
  if (config.metrics.enabled) {
    if (config.metrics.port <= 0 || config.metrics.port > 65535) {
      errors.push('Metrics port must be between 1 and 65535');
    }
    if (config.metrics.interval <= 0) {
      errors.push('Metrics interval must be > 0');
    }
  }
  
  // Validate logging config
  if (!['debug', 'info', 'warn', 'error', 'fatal'].includes(config.logging.level)) {
    errors.push('Invalid logging level');
  }
  
  // Validate tracing config
  if (config.tracing.enabled) {
    if (config.tracing.samplingRate < 0 || config.tracing.samplingRate > 1) {
      errors.push('Tracing sampling rate must be between 0 and 1');
    }
  }
  
  // Validate performance thresholds
  Object.entries(config.performance.thresholds).forEach(([key, threshold]) => {
    if (threshold <= 0) {
      errors.push(`Performance threshold ${key} must be > 0`);
    }
  });
  
  // Validate SLA targets
  if (config.performance.slaTargets.availability < 0 || config.performance.slaTargets.availability > 100) {
    errors.push('SLA availability target must be between 0 and 100');
  }
  
  return errors;
}

// Environment-specific configuration merger
export function mergeObservabilityConfig(
  base: ObservabilityConfig,
  override: Partial<ObservabilityConfig>
): ObservabilityConfig {
  return {
    ...base,
    ...override,
    metrics: { ...base.metrics, ...override.metrics },
    logging: { ...base.logging, ...override.logging },
    tracing: { ...base.tracing, ...override.tracing },
    security: { ...base.security, ...override.security },
    performance: { ...base.performance, ...override.performance },
    alerting: { ...base.alerting, ...override.alerting },
    dashboard: { ...base.dashboard, ...override.dashboard },
    resilience: { ...base.resilience, ...override.resilience },
    health: { ...base.health, ...override.health }
  };
}
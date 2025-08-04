/**
 * Resilience Configuration System
 * 
 * Centralized configuration for all resilience components including
 * circuit breakers, retry policies, health checks, and monitoring.
 */

import { EventType } from '../types.js';

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  successThreshold: number;
  timeout: number; // Circuit open duration in ms
  monitoringWindow: number; // Time window for failure rate calculation
  maxConcurrentRequests?: number;
  volumeThreshold?: number; // Minimum requests before circuit can trip
}

export interface RetryConfig {
  enabled: boolean;
  maxAttempts: number;
  baseDelay: number; // Base delay in ms
  maxDelay: number; // Maximum delay in ms
  exponentialBase: number; // Exponential backoff base (e.g., 2.0)
  jitterEnabled: boolean;
  jitterMax: number; // Maximum jitter in ms
  retryableErrors: string[]; // Error codes that should trigger retry
  nonRetryableErrors: string[]; // Error codes that should not trigger retry
}

export interface HealthCheckConfig {
  enabled: boolean;
  interval: number; // Health check interval in ms
  timeout: number; // Individual health check timeout in ms
  failureThreshold: number; // Consecutive failures before unhealthy
  recoveryThreshold: number; // Consecutive successes before healthy
  gracePeriod: number; // Initial grace period before health checks start
  endpoints: HealthEndpointConfig[];
}

export interface HealthEndpointConfig {
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  timeout: number;
  retries: number;
  headers?: Record<string, string>;
  expectedStatus?: number[];
  critical: boolean; // If true, failure causes overall unhealthy status
}

export interface RecoveryConfig {
  enabled: boolean;
  autoRecoveryEnabled: boolean;
  maxRecoveryAttempts: number;
  recoveryDelay: number; // Delay between recovery attempts in ms
  escalationThreshold: number; // Failures before escalating recovery
  gracefulShutdownTimeout: number; // Max time to wait for graceful shutdown
  restartDelay: number; // Delay before restart in ms
  backupStrategies: BackupStrategyConfig[];
}

export interface BackupStrategyConfig {
  name: string;
  priority: number; // Lower number = higher priority
  enabled: boolean;
  timeout: number;
  maxAttempts: number;
  conditions: string[]; // Conditions when this strategy applies
}

export interface MonitoringConfig {
  enabled: boolean;
  metricsInterval: number; // Metrics collection interval in ms
  alertThresholds: {
    errorRate: number; // Error rate threshold (0-1)
    responseTime: number; // Response time threshold in ms
    memoryUsage: number; // Memory usage threshold (0-1)
    cpuUsage: number; // CPU usage threshold (0-1)
  };
  retention: {
    metrics: number; // Metrics retention in ms
    events: number; // Events retention in ms
    logs: number; // Logs retention in ms
  };
  exporters: MonitoringExporterConfig[];
}

export interface MonitoringExporterConfig {
  name: string;
  type: 'prometheus' | 'logs' | 'events' | 'custom';
  enabled: boolean;
  endpoint?: string;
  interval?: number;
  format?: string;
  labels?: Record<string, string>;
}

export interface ResilienceConfig {
  enabled: boolean;
  environment: 'development' | 'staging' | 'production';
  
  // Component configurations
  circuitBreaker: {
    bridge: CircuitBreakerConfig;
    telegram: CircuitBreakerConfig;
    filesystem: CircuitBreakerConfig;
    network: CircuitBreakerConfig;
  };
  
  retry: {
    bridge: RetryConfig;
    telegram: RetryConfig;
    filesystem: RetryConfig;
    network: RetryConfig;
  };
  
  health: HealthCheckConfig;
  recovery: RecoveryConfig;
  monitoring: MonitoringConfig;
  
  // Operation-specific configurations
  operations: {
    [key: string]: {
      circuitBreaker?: Partial<CircuitBreakerConfig>;
      retry?: Partial<RetryConfig>;
      timeout?: number;
      priority?: 'low' | 'normal' | 'high' | 'critical';
    };
  };
  
  // Event-specific configurations
  events: {
    [K in EventType]?: {
      priority: 'low' | 'normal' | 'high' | 'critical';
      timeout?: number;
      retryConfig?: Partial<RetryConfig>;
    };
  };
}

// Default configuration factory
export function createDefaultResilienceConfig(): ResilienceConfig {
  return {
    enabled: true,
    environment: (process.env.NODE_ENV as any) || 'development',
    
    circuitBreaker: {
      bridge: {
        enabled: true,
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 30000, // 30 seconds
        monitoringWindow: 60000, // 1 minute
        maxConcurrentRequests: 10,
        volumeThreshold: 5
      },
      telegram: {
        enabled: true,
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 15000, // 15 seconds
        monitoringWindow: 30000, // 30 seconds
        maxConcurrentRequests: 5,
        volumeThreshold: 3
      },
      filesystem: {
        enabled: true,
        failureThreshold: 10,
        successThreshold: 5,
        timeout: 5000, // 5 seconds
        monitoringWindow: 60000, // 1 minute
        maxConcurrentRequests: 20,
        volumeThreshold: 10
      },
      network: {
        enabled: true,
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 20000, // 20 seconds
        monitoringWindow: 60000, // 1 minute
        maxConcurrentRequests: 10,
        volumeThreshold: 5
      }
    },
    
    retry: {
      bridge: {
        enabled: true,
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        exponentialBase: 2.0,
        jitterEnabled: true,
        jitterMax: 500,
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'BRIDGE_NOT_READY'],
        nonRetryableErrors: ['AUTH_FAILED', 'INVALID_INPUT', 'BRIDGE_CRASHED']
      },
      telegram: {
        enabled: true,
        maxAttempts: 5,
        baseDelay: 2000,
        maxDelay: 30000,
        exponentialBase: 1.5,
        jitterEnabled: true,
        jitterMax: 1000,
        retryableErrors: ['TELEGRAM_RATE_LIMIT', 'TELEGRAM_SERVER_ERROR', 'NETWORK_ERROR'],
        nonRetryableErrors: ['TELEGRAM_INVALID_TOKEN', 'TELEGRAM_FORBIDDEN', 'TELEGRAM_INVALID_CHAT']
      },
      filesystem: {
        enabled: true,
        maxAttempts: 3,
        baseDelay: 500,
        maxDelay: 5000,
        exponentialBase: 2.0,
        jitterEnabled: false,
        jitterMax: 0,
        retryableErrors: ['EMFILE', 'ENFILE', 'EAGAIN', 'EBUSY'],
        nonRetryableErrors: ['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR']
      },
      network: {
        enabled: true,
        maxAttempts: 4,
        baseDelay: 1000,
        maxDelay: 15000,
        exponentialBase: 2.0,
        jitterEnabled: true,
        jitterMax: 500,
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'],
        nonRetryableErrors: ['ECONNABORTED', 'ECANCELED', 'HTTP_4XX']
      }
    },
    
    health: {
      enabled: true,
      interval: 30000, // 30 seconds
      timeout: 5000, // 5 seconds
      failureThreshold: 3,
      recoveryThreshold: 2,
      gracePeriod: 10000, // 10 seconds
      endpoints: [
        {
          name: 'bridge-health',
          url: 'http://localhost:8080/health',
          method: 'GET',
          timeout: 3000,
          retries: 2,
          expectedStatus: [200],
          critical: true
        },
        {
          name: 'bridge-metrics',
          url: 'http://localhost:8080/metrics',
          method: 'GET',
          timeout: 3000,
          retries: 1,
          expectedStatus: [200],
          critical: false
        }
      ]
    },
    
    recovery: {
      enabled: true,
      autoRecoveryEnabled: true,
      maxRecoveryAttempts: 5,
      recoveryDelay: 5000, // 5 seconds
      escalationThreshold: 3,
      gracefulShutdownTimeout: 30000, // 30 seconds
      restartDelay: 2000, // 2 seconds
      backupStrategies: [
        {
          name: 'bridge-restart',
          priority: 1,
          enabled: true,
          timeout: 15000,
          maxAttempts: 3,
          conditions: ['BRIDGE_DOWN', 'BRIDGE_UNHEALTHY']
        },
        {
          name: 'process-restart',
          priority: 2,
          enabled: true,
          timeout: 30000,
          maxAttempts: 2,
          conditions: ['BRIDGE_CRASHED', 'BRIDGE_UNRESPONSIVE']
        },
        {
          name: 'fallback-mode',
          priority: 3,
          enabled: true,
          timeout: 5000,
          maxAttempts: 1,
          conditions: ['ALL_RECOVERY_FAILED']
        }
      ]
    },
    
    monitoring: {
      enabled: true,
      metricsInterval: 10000, // 10 seconds
      alertThresholds: {
        errorRate: 0.1, // 10%
        responseTime: 5000, // 5 seconds
        memoryUsage: 0.8, // 80%
        cpuUsage: 0.8, // 80%
      },
      retention: {
        metrics: 24 * 60 * 60 * 1000, // 24 hours
        events: 7 * 24 * 60 * 60 * 1000, // 7 days
        logs: 3 * 24 * 60 * 60 * 1000, // 3 days
      },
      exporters: [
        {
          name: 'console-logs',
          type: 'logs',
          enabled: true,
          format: 'json'
        },
        {
          name: 'prometheus-metrics',
          type: 'prometheus',
          enabled: process.env.PROMETHEUS_ENABLED === 'true',
          endpoint: process.env.PROMETHEUS_ENDPOINT || 'http://localhost:9090/metrics',
          interval: 15000
        }
      ]
    },
    
    operations: {
      'sendEvent': {
        priority: 'high',
        timeout: 10000,
        circuitBreaker: {
          failureThreshold: 3,
          timeout: 15000
        }
      },
      'sendMessage': {
        priority: 'normal',
        timeout: 5000
      },
      'sendTaskCompletion': {
        priority: 'high',
        timeout: 8000
      },
      'sendPerformanceAlert': {
        priority: 'critical',
        timeout: 3000,
        circuitBreaker: {
          failureThreshold: 2,
          timeout: 10000
        }
      },
      'sendApprovalRequest': {
        priority: 'high',
        timeout: 5000
      },
      'getBridgeStatus': {
        priority: 'normal',
        timeout: 3000,
        retry: {
          maxAttempts: 2,
          baseDelay: 500
        }
      },
      'startBridge': {
        priority: 'critical',
        timeout: 30000,
        retry: {
          maxAttempts: 3,
          baseDelay: 5000
        }
      },
      'stopBridge': {
        priority: 'critical',
        timeout: 15000
      },
      'restartBridge': {
        priority: 'critical',
        timeout: 45000
      }
    },
    
    events: {
      'task_completion': {
        priority: 'high',
        timeout: 8000
      },
      'task_started': {
        priority: 'normal',
        timeout: 5000
      },
      'task_failed': {
        priority: 'high',
        timeout: 8000
      },
      'performance_alert': {
        priority: 'critical',
        timeout: 3000,
        retryConfig: {
          maxAttempts: 5,
          baseDelay: 500
        }
      },
      'error_occurred': {
        priority: 'critical',
        timeout: 3000,
        retryConfig: {
          maxAttempts: 5,
          baseDelay: 500
        }
      },
      'approval_request': {
        priority: 'high',
        timeout: 5000
      },
      'info_notification': {
        priority: 'low',
        timeout: 10000
      },
      'system_health': {
        priority: 'normal',
        timeout: 5000
      }
    }
  };
}

// Configuration validation
export function validateResilienceConfig(config: ResilienceConfig): string[] {
  const errors: string[] = [];
  
  // Validate circuit breaker configs
  Object.entries(config.circuitBreaker).forEach(([name, cb]) => {
    if (cb.failureThreshold <= 0) {
      errors.push(`Circuit breaker ${name}: failureThreshold must be > 0`);
    }
    if (cb.successThreshold <= 0) {
      errors.push(`Circuit breaker ${name}: successThreshold must be > 0`);
    }
    if (cb.timeout <= 0) {
      errors.push(`Circuit breaker ${name}: timeout must be > 0`);
    }
    if (cb.monitoringWindow <= 0) {
      errors.push(`Circuit breaker ${name}: monitoringWindow must be > 0`);
    }
  });
  
  // Validate retry configs
  Object.entries(config.retry).forEach(([name, retry]) => {
    if (retry.maxAttempts <= 0) {
      errors.push(`Retry ${name}: maxAttempts must be > 0`);
    }
    if (retry.baseDelay <= 0) {
      errors.push(`Retry ${name}: baseDelay must be > 0`);
    }
    if (retry.maxDelay < retry.baseDelay) {
      errors.push(`Retry ${name}: maxDelay must be >= baseDelay`);
    }
    if (retry.exponentialBase <= 1) {
      errors.push(`Retry ${name}: exponentialBase must be > 1`);
    }
  });
  
  // Validate health check config
  if (config.health.interval <= 0) {
    errors.push('Health check: interval must be > 0');
  }
  if (config.health.timeout <= 0) {
    errors.push('Health check: timeout must be > 0');
  }
  if (config.health.failureThreshold <= 0) {
    errors.push('Health check: failureThreshold must be > 0');
  }
  if (config.health.recoveryThreshold <= 0) {
    errors.push('Health check: recoveryThreshold must be > 0');
  }
  
  // Validate monitoring config
  if (config.monitoring.metricsInterval <= 0) {
    errors.push('Monitoring: metricsInterval must be > 0');
  }
  if (config.monitoring.alertThresholds.errorRate < 0 || config.monitoring.alertThresholds.errorRate > 1) {
    errors.push('Monitoring: errorRate threshold must be between 0 and 1');
  }
  
  return errors;
}

// Configuration merger for environment-specific overrides
export function mergeResilienceConfig(
  base: ResilienceConfig, 
  override: Partial<ResilienceConfig>
): ResilienceConfig {
  return {
    ...base,
    ...override,
    circuitBreaker: {
      ...base.circuitBreaker,
      ...override.circuitBreaker
    },
    retry: {
      ...base.retry,
      ...override.retry
    },
    health: {
      ...base.health,
      ...override.health
    },
    recovery: {
      ...base.recovery,
      ...override.recovery
    },
    monitoring: {
      ...base.monitoring,
      ...override.monitoring
    },
    operations: {
      ...base.operations,
      ...override.operations
    },
    events: {
      ...base.events,
      ...override.events
    }
  };
}
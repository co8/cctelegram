/**
 * Resilience Middleware
 * 
 * Automatic application of resilience patterns (circuit breakers, retries,
 * error handling) to all operations through middleware integration.
 */

import { CircuitBreaker } from '../circuit-breaker/circuit-breaker.js';
import { RetryExecutor } from '../retry/retry-executor.js';
import { ResilienceConfig } from '../config.js';
import { secureLog, sanitizeForLogging } from '../../security.js';
import { BaseResilienceError } from '../errors/base-error.js';
import { MetricsCollector } from '../monitoring/metrics-collector.js';

export interface ResilienceContext {
  operation: string;
  component: string;
  correlationId?: string;
  timeout?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

export interface ResilienceResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  executionTime: number;
  retryAttempts: number;
  circuitBreakerUsed: boolean;
  fallbackUsed: boolean;
  metadata: Record<string, any>;
}

export class ResilienceMiddleware {
  private config: ResilienceConfig;
  private circuitBreakers: Map<string, CircuitBreaker>;
  private retryExecutors: Map<string, RetryExecutor>;
  private metricsCollector?: MetricsCollector;

  constructor(
    config: ResilienceConfig,
    metricsCollector?: MetricsCollector
  ) {
    this.config = config;
    this.circuitBreakers = new Map();
    this.retryExecutors = new Map();
    this.metricsCollector = metricsCollector;

    this.initializeCircuitBreakers();
    this.initializeRetryExecutors();

    secureLog('info', 'Resilience middleware initialized', {
      circuit_breakers: this.circuitBreakers.size,
      retry_executors: this.retryExecutors.size,
      metrics_enabled: !!metricsCollector
    });
  }

  /**
   * Execute operation with resilience patterns
   */
  public async execute<T>(
    operation: () => Promise<T>,
    context: ResilienceContext
  ): Promise<ResilienceResult<T>> {
    const startTime = Date.now();
    const executionId = this.generateExecutionId();
    
    const executionContext = {
      execution_id: executionId,
      operation: context.operation,
      component: context.component,
      correlation_id: context.correlationId,
      priority: context.priority || 'normal',
      ...context.metadata
    };

    secureLog('debug', 'Resilience execution started', executionContext);

    // Record operation start
    this.recordMetric('operation_started', 1, {
      operation: context.operation,
      component: context.component
    });

    try {
      // Get appropriate resilience components
      const circuitBreaker = this.getCircuitBreaker(context.component);
      const retryExecutor = this.getRetryExecutor(context.component);

      // Apply timeout if specified
      const timeoutMs = context.timeout || this.getDefaultTimeout(context);
      const wrappedOperation = timeoutMs > 0 
        ? () => this.executeWithTimeout(operation, timeoutMs)
        : operation;

      let result: T;
      let retryAttempts = 0;
      let circuitBreakerUsed = false;
      let fallbackUsed = false;

      // Execute with circuit breaker if available
      if (circuitBreaker && this.shouldUseCircuitBreaker(context)) {
        const cbResult = await circuitBreaker.execute(async () => {
          // Execute with retry if available
          if (retryExecutor && this.shouldUseRetry(context)) {
            const retryResult = await retryExecutor.execute(wrappedOperation, {
              operation: context.operation,
              component: context.component,
              correlationId: context.correlationId
            });
            
            retryAttempts = retryResult.attempts;
            return retryResult.result;
          } else {
            return await wrappedOperation();
          }
        }, executionContext);

        result = cbResult.result!;
        circuitBreakerUsed = true;
        fallbackUsed = cbResult.executedViaFallback;

        if (!cbResult.success) {
          throw cbResult.error!;
        }

      } else if (retryExecutor && this.shouldUseRetry(context)) {
        // Execute with retry only
        const retryResult = await retryExecutor.execute(wrappedOperation, {
          operation: context.operation,
          component: context.component,
          correlationId: context.correlationId
        });
        
        result = retryResult.result;
        retryAttempts = retryResult.attempts;

      } else {
        // Execute directly
        result = await wrappedOperation();
      }

      const executionTime = Date.now() - startTime;

      // Record success metrics
      this.recordMetric('operation_success', 1, {
        operation: context.operation,
        component: context.component
      });
      
      this.recordMetric('operation_duration', executionTime, {
        operation: context.operation,
        component: context.component
      });

      secureLog('debug', 'Resilience execution succeeded', {
        ...executionContext,
        execution_time: executionTime,
        retry_attempts: retryAttempts,
        circuit_breaker_used: circuitBreakerUsed,
        fallback_used: fallbackUsed
      });

      return {
        success: true,
        result,
        executionTime,
        retryAttempts,
        circuitBreakerUsed,
        fallbackUsed,
        metadata: {
          ...executionContext,
          execution_successful: true
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const isResilienceError = error instanceof BaseResilienceError;

      // Record failure metrics
      this.recordMetric('operation_failure', 1, {
        operation: context.operation,
        component: context.component,
        error_type: error instanceof Error ? error.constructor.name : 'unknown'
      });

      secureLog('warn', 'Resilience execution failed', {
        ...executionContext,
        execution_time: executionTime,
        error_message: error instanceof Error ? error.message : 'unknown',
        error_type: error instanceof Error ? error.constructor.name : 'unknown',
        is_resilience_error: isResilienceError
      });

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        executionTime,
        retryAttempts: 0, // Would be tracked in actual retry execution
        circuitBreakerUsed: false,
        fallbackUsed: false,
        metadata: {
          ...executionContext,
          execution_failed: true,
          error_type: error instanceof Error ? error.constructor.name : 'unknown'
        }
      };
    }
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      operation()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Initialize circuit breakers for each component
   */
  private initializeCircuitBreakers(): void {
    Object.entries(this.config.circuitBreaker).forEach(([component, config]) => {
      if (config.enabled) {
        const circuitBreaker = new CircuitBreaker({
          name: `${component}-circuit-breaker`,
          ...config,
          onStateChange: (from, to, reason) => {
            secureLog('info', 'Circuit breaker state changed', {
              component,
              from_state: from,
              to_state: to,
              reason
            });

            this.recordMetric('circuit_breaker_state_change', 1, {
              component,
              from_state: from,
              to_state: to
            });
          }
        });

        this.circuitBreakers.set(component, circuitBreaker);
      }
    });
  }

  /**
   * Initialize retry executors for each component
   */
  private initializeRetryExecutors(): void {
    Object.entries(this.config.retry).forEach(([component, config]) => {
      if (config.enabled) {
        const retryExecutor = new RetryExecutor(config);
        this.retryExecutors.set(component, retryExecutor);
      }
    });
  }

  /**
   * Get circuit breaker for component
   */
  private getCircuitBreaker(component: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(component) || 
           this.circuitBreakers.get('network'); // Fallback to network CB
  }

  /**
   * Get retry executor for component
   */
  private getRetryExecutor(component: string): RetryExecutor | undefined {
    return this.retryExecutors.get(component) || 
           this.retryExecutors.get('network'); // Fallback to network retry
  }

  /**
   * Determine if circuit breaker should be used
   */
  private shouldUseCircuitBreaker(context: ResilienceContext): boolean {
    // Use circuit breaker for critical and high priority operations
    return context.priority === 'critical' || context.priority === 'high' ||
           context.component === 'bridge' || context.component === 'telegram';
  }

  /**
   * Determine if retry should be used
   */
  private shouldUseRetry(context: ResilienceContext): boolean {
    // Use retry for most operations except manual ones
    return context.operation !== 'manual_intervention';
  }

  /**
   * Get default timeout for operation
   */
  private getDefaultTimeout(context: ResilienceContext): number {
    const operationConfig = this.config.operations[context.operation];
    if (operationConfig?.timeout) {
      return operationConfig.timeout;
    }

    // Default timeouts based on priority
    switch (context.priority) {
      case 'critical':
        return 3000; // 3 seconds
      case 'high':
        return 5000; // 5 seconds
      case 'normal':
        return 10000; // 10 seconds
      case 'low':
        return 30000; // 30 seconds
      default:
        return 10000;
    }
  }

  /**
   * Record metric
   */
  private recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    if (this.metricsCollector) {
      this.metricsCollector.recordMetric(`resilience.${name}`, value, Date.now(), { labels });
    }
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get circuit breaker statistics
   */
  public getCircuitBreakerStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    this.circuitBreakers.forEach((cb, component) => {
      stats[component] = cb.getStatistics();
    });

    return stats;
  }

  /**
   * Get retry statistics
   */
  public getRetryStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    this.retryExecutors.forEach((executor, component) => {
      stats[component] = executor.getStatistics();
    });

    return stats;
  }

  /**
   * Get overall middleware health
   */
  public getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  } {
    const cbStats = this.getCircuitBreakerStats();
    const retryStats = this.getRetryStats();

    // Check if any circuit breakers are unhealthy
    const unhealthyCBs = Object.entries(cbStats).filter(([_, stats]: [string, any]) => 
      !stats.health || stats.health.health !== 'healthy'
    );

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (unhealthyCBs.length > 0) {
      // If more than half are unhealthy, system is unhealthy
      if (unhealthyCBs.length >= Object.keys(cbStats).length / 2) {
        status = 'unhealthy';
      } else {
        status = 'degraded';
      }
    }

    return {
      status,
      details: {
        circuit_breakers: {
          total: this.circuitBreakers.size,
          unhealthy: unhealthyCBs.length,
          details: cbStats
        },
        retry_executors: {
          total: this.retryExecutors.size,
          details:  Object.fromEntries(
            Object.entries(retryStats).map(([k, v]: [string, any]) => [k, {
              total_attempts: v.totalAttempts || 0,
              success_rate: v.successRate || 1.0
            }])
          )
        },
        configuration: {
          components_with_cb: Object.keys(this.config.circuitBreaker).filter(
            k => this.config.circuitBreaker[k].enabled
          ).length,
          components_with_retry: Object.keys(this.config.retry).filter(
            k => this.config.retry[k].enabled
          ).length
        }
      }
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ResilienceConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Reinitialize components if needed
    this.initializeCircuitBreakers();
    this.initializeRetryExecutors();
    
    secureLog('info', 'Resilience middleware configuration updated', {
      updates: sanitizeForLogging(config)
    });
  }

  /**
   * Get current configuration
   */
  public getConfig(): ResilienceConfig {
    return { ...this.config };
  }

  /**
   * Reset all resilience state
   */
  public reset(): void {
    this.circuitBreakers.forEach(cb => cb.reset());
    // Retry executors don't need reset as they're stateless
    
    secureLog('info', 'Resilience middleware state reset');
  }
}
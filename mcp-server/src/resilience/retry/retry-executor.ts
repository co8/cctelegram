/**
 * Retry Executor
 * 
 * Orchestrates retry execution using retry policies with comprehensive
 * execution tracking, context management, and adaptive behavior.
 */

import { RetryPolicy, RetryExecution, RetryAttempt, RetryPolicyConfig } from './retry-policy.js';
import { BaseResilienceError } from '../errors/base-error.js';
import { RetryError } from '../errors/resilience-errors.js';
import { secureLog } from '../../security.js';
import { randomUUID } from 'crypto';

export interface RetryExecutorOptions {
  defaultPolicy?: string;
  enableCircuitBreaker?: boolean;
  enableMetrics?: boolean;
  maxConcurrentExecutions?: number;
  executionTimeout?: number;
}

export interface ExecutionContext {
  operation: string;
  operationId?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  metadata?: Record<string, any>;
  timeout?: number;
  skipRetryFor?: string[]; // Error codes to skip retry for
  forceRetryFor?: string[]; // Error codes to force retry for
}

export interface ExecutionMetrics {
  executionId: string;
  operation: string;
  policyName: string;
  totalDuration: number;
  totalAttempts: number;
  success: boolean;
  finalError?: string;
  averageAttemptDuration: number;
  totalDelayTime: number;
  adaptiveAdjustments: number;
}

/**
 * Retry executor with intelligent policy management and execution tracking
 */
export class RetryExecutor {
  private policies: Map<string, RetryPolicy> = new Map();
  private activeExecutions: Map<string, Promise<any>> = new Map();
  private executionMetrics: ExecutionMetrics[] = [];
  private options: RetryExecutorOptions;
  private maxMetricsHistory = 1000;

  constructor(options: RetryExecutorOptions = {}) {
    this.options = {
      enableCircuitBreaker: true,
      enableMetrics: true,
      maxConcurrentExecutions: 10,
      executionTimeout: 300000, // 5 minutes default
      ...options
    };

    secureLog('info', 'Retry executor initialized', {
      max_concurrent: this.options.maxConcurrentExecutions,
      default_policy: this.options.defaultPolicy,
      metrics_enabled: this.options.enableMetrics
    });
  }

  /**
   * Register a retry policy
   */
  public registerPolicy(policy: RetryPolicy): void {
    this.policies.set(policy.getName(), policy);
    
    secureLog('debug', 'Retry policy registered', {
      policy_name: policy.getName(),
      total_policies: this.policies.size
    });
  }

  /**
   * Unregister a retry policy
   */
  public unregisterPolicy(policyName: string): boolean {
    const removed = this.policies.delete(policyName);
    
    if (removed) {
      secureLog('debug', 'Retry policy unregistered', {
        policy_name: policyName,
        total_policies: this.policies.size
      });
    }
    
    return removed;
  }

  /**
   * Execute operation with retry policy
   */
  public async execute<T>(
    operation: () => Promise<T>,
    policyName?: string,
    context?: ExecutionContext
  ): Promise<T> {
    // Resolve policy
    const policy = this.resolvePolicy(policyName);
    if (!policy) {
      throw new RetryError(
        `Retry policy not found: ${policyName || 'default'}`,
        'POLICY_NOT_FOUND',
        'configuration',
        context || {}
      );
    }

    // Check concurrency limits
    if (this.activeExecutions.size >= (this.options.maxConcurrentExecutions || 10)) {
      throw new RetryError(
        'Maximum concurrent executions reached',
        'CONCURRENCY_LIMIT_EXCEEDED',
        'resource',
        { 
          active_executions: this.activeExecutions.size,
          max_concurrent: this.options.maxConcurrentExecutions,
          ...context
        }
      );
    }

    const executionId = randomUUID();
    const executionContext: ExecutionContext = {
      operation: 'unknown',
      operationId: executionId,
      priority: 'normal',
      ...context
    };

    // Initialize execution tracking
    const execution: RetryExecution = {
      id: executionId,
      policyName: policy.getName(),
      operation: executionContext.operation,
      startTime: Date.now(),
      totalAttempts: 0,
      maxAttempts: policy.getConfig().maxAttempts,
      attempts: [],
      finalResult: {
        success: false,
        totalDuration: 0
      },
      context: executionContext
    };

    const executionPromise = this.executeWithRetry(operation, policy, execution, executionContext);
    this.activeExecutions.set(executionId, executionPromise);

    try {
      const result = await executionPromise;
      return result;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy,
    execution: RetryExecution,
    context: ExecutionContext
  ): Promise<T> {
    let lastError: Error | undefined;
    let attempt = 0;
    const startTime = Date.now();

    secureLog('debug', 'Starting retry execution', {
      execution_id: execution.id,
      policy_name: policy.getName(),
      operation: context.operation,
      max_attempts: execution.maxAttempts
    });

    while (attempt < execution.maxAttempts) {
      attempt++;
      execution.totalAttempts = attempt;

      const attemptStart = Date.now();
      let attemptResult: RetryAttempt;

      try {
        // Check execution timeout
        const elapsed = Date.now() - startTime;
        if (this.options.executionTimeout && elapsed > this.options.executionTimeout) {
          throw new RetryError(
            `Execution timeout after ${elapsed}ms`,
            'EXECUTION_TIMEOUT',
            'timeout',
            { elapsed, timeout: this.options.executionTimeout, ...context }
          );
        }

        secureLog('debug', 'Executing retry attempt', {
          execution_id: execution.id,
          attempt,
          policy_name: policy.getName(),
          operation: context.operation
        });

        // Execute operation
        const result = await this.executeWithTimeout(operation, context.timeout);
        const duration = Date.now() - attemptStart;

        // Record successful attempt
        attemptResult = {
          attempt,
          startTime: attemptStart,
          endTime: Date.now(),
          delay: 0,
          success: true,
          duration,
          metadata: {
            operation: context.operation,
            policy_name: policy.getName()
          }
        };

        execution.attempts.push(attemptResult);
        execution.endTime = Date.now();
        execution.finalResult = {
          success: true,
          result,
          totalDuration: execution.endTime - execution.startTime
        };

        // Record execution in policy for adaptive learning
        policy.recordExecution(execution);

        // Record metrics
        if (this.options.enableMetrics) {
          this.recordExecutionMetrics(execution, true);
        }

        secureLog('info', 'Retry execution succeeded', {
          execution_id: execution.id,
          attempt,
          total_duration: execution.finalResult.totalDuration,
          policy_name: policy.getName(),
          operation: context.operation
        });

        return result;

      } catch (error) {
        const duration = Date.now() - attemptStart;
        lastError = error instanceof Error ? error : new Error(String(error));

        // Record failed attempt
        attemptResult = {
          attempt,
          startTime: attemptStart,
          endTime: Date.now(),
          delay: 0, // Will be set below if we retry
          error: lastError,
          success: false,
          duration,
          metadata: {
            operation: context.operation,
            policy_name: policy.getName(),
            error_code: (lastError as any).code || lastError.name,
            error_message: lastError.message
          }
        };

        execution.attempts.push(attemptResult);

        secureLog('debug', 'Retry attempt failed', {
          execution_id: execution.id,
          attempt,
          error_message: lastError.message,
          error_code: (lastError as any).code || lastError.name,
          duration,
          policy_name: policy.getName(),
          operation: context.operation
        });

        // Check if we should retry
        const shouldRetry = this.shouldRetry(lastError, attempt, policy, context);
        
        if (!shouldRetry || attempt >= execution.maxAttempts) {
          // No more retries, execution failed
          execution.endTime = Date.now();
          execution.finalResult = {
            success: false,
            error: lastError,
            totalDuration: execution.endTime - execution.startTime
          };

          // Record execution in policy for adaptive learning
          policy.recordExecution(execution);

          // Record metrics
          if (this.options.enableMetrics) {
            this.recordExecutionMetrics(execution, false, lastError.message);
          }

          secureLog('warn', 'Retry execution failed', {
            execution_id: execution.id,
            total_attempts: attempt,
            total_duration: execution.finalResult.totalDuration,
            final_error: lastError.message,
            policy_name: policy.getName(),
            operation: context.operation
          });

          throw lastError;
        }

        // Calculate delay for next attempt
        const delay = policy.calculateDelay(attempt + 1, {
          lastError,
          operation: context.operation,
          attempt,
          ...context.metadata
        });

        // Update attempt with delay information
        attemptResult.delay = delay;

        secureLog('debug', 'Retry delay calculated', {
          execution_id: execution.id,
          next_attempt: attempt + 1,
          delay,
          policy_name: policy.getName(),
          operation: context.operation
        });

        // Wait before next attempt
        if (delay > 0) {
          await this.delay(delay);
        }
      }
    }

    // This should never be reached due to the loop logic above,
    // but included for completeness
    throw lastError || new Error('Maximum retry attempts exceeded');
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    if (!timeoutMs) {
      return operation();
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new RetryError(
          `Operation timeout after ${timeoutMs}ms`,
          'OPERATION_TIMEOUT',
          'timeout',
          { timeout: timeoutMs }
        ));
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
   * Check if error should be retried
   */
  private shouldRetry(
    error: Error,
    attempt: number,
    policy: RetryPolicy,
    context: ExecutionContext
  ): boolean {
    // Check context-specific skip rules
    if (context.skipRetryFor) {
      const errorCode = (error as any).code || error.name;
      if (context.skipRetryFor.includes(errorCode)) {
        return false;
      }
    }

    // Check context-specific force rules
    if (context.forceRetryFor) {
      const errorCode = (error as any).code || error.name;
      if (context.forceRetryFor.includes(errorCode)) {
        return attempt < policy.getConfig().maxAttempts;
      }
    }

    // Use policy's retry logic
    return policy.shouldRetry(error, attempt, {
      operation: context.operation,
      priority: context.priority,
      ...context.metadata
    });
  }

  /**
   * Resolve retry policy by name
   */
  private resolvePolicy(policyName?: string): RetryPolicy | undefined {
    if (policyName) {
      return this.policies.get(policyName);
    }

    if (this.options.defaultPolicy) {
      return this.policies.get(this.options.defaultPolicy);
    }

    // Return first available policy if no default specified
    const firstPolicy = this.policies.values().next();
    return firstPolicy.done ? undefined : firstPolicy.value;
  }

  /**
   * Record execution metrics
   */
  private recordExecutionMetrics(
    execution: RetryExecution,
    success: boolean,
    finalError?: string
  ): void {
    const totalDelayTime = execution.attempts
      .reduce((sum, attempt) => sum + attempt.delay, 0);

    const averageAttemptDuration = execution.attempts.length > 0
      ? execution.attempts.reduce((sum, attempt) => sum + attempt.duration, 0) / execution.attempts.length
      : 0;

    const metrics: ExecutionMetrics = {
      executionId: execution.id,
      operation: execution.operation,
      policyName: execution.policyName,
      totalDuration: execution.finalResult.totalDuration,
      totalAttempts: execution.totalAttempts,
      success,
      finalError,
      averageAttemptDuration,
      totalDelayTime,
      adaptiveAdjustments: 0 // Could be enhanced to track adaptive policy adjustments
    };

    this.executionMetrics.push(metrics);

    // Trim metrics history if needed
    if (this.executionMetrics.length > this.maxMetricsHistory) {
      this.executionMetrics = this.executionMetrics.slice(-this.maxMetricsHistory);
    }

    secureLog('debug', 'Execution metrics recorded', {
      execution_id: execution.id,
      success,
      total_attempts: execution.totalAttempts,
      total_duration: execution.finalResult.totalDuration,
      policy_name: execution.policyName
    });
  }

  /**
   * Delay helper with cancellation support
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get registered policies
   */
  public getPolicies(): string[] {
    return Array.from(this.policies.keys());
  }

  /**
   * Get policy by name
   */
  public getPolicy(name: string): RetryPolicy | undefined {
    return this.policies.get(name);
  }

  /**
   * Get active executions count
   */
  public getActiveExecutionsCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * Get execution metrics
   */
  public getExecutionMetrics(limit?: number): ExecutionMetrics[] {
    const metrics = [...this.executionMetrics].reverse(); // Most recent first
    return limit ? metrics.slice(0, limit) : metrics;
  }

  /**
   * Get execution statistics
   */
  public getExecutionStatistics() {
    const totalExecutions = this.executionMetrics.length;
    if (totalExecutions === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        averageDuration: 0,
        averageAttempts: 0,
        totalDelayTime: 0,
        policyUsage: {}
      };
    }

    const successfulExecutions = this.executionMetrics
      .filter(metric => metric.success).length;

    const totalDuration = this.executionMetrics
      .reduce((sum, metric) => sum + metric.totalDuration, 0);

    const totalAttempts = this.executionMetrics
      .reduce((sum, metric) => sum + metric.totalAttempts, 0);

    const totalDelayTime = this.executionMetrics
      .reduce((sum, metric) => sum + metric.totalDelayTime, 0);

    // Policy usage statistics
    const policyUsage: Record<string, { count: number; successRate: number }> = {};
    for (const metric of this.executionMetrics) {
      if (!policyUsage[metric.policyName]) {
        policyUsage[metric.policyName] = { count: 0, successRate: 0 };
      }
      policyUsage[metric.policyName].count++;
      if (metric.success) {
        policyUsage[metric.policyName].successRate++;
      }
    }

    // Convert success counts to rates
    for (const policy in policyUsage) {
      policyUsage[policy].successRate = 
        policyUsage[policy].successRate / policyUsage[policy].count;
    }

    return {
      totalExecutions,
      successRate: successfulExecutions / totalExecutions,
      averageDuration: totalDuration / totalExecutions,
      averageAttempts: totalAttempts / totalExecutions,
      totalDelayTime,
      policyUsage
    };
  }

  /**
   * Clear execution metrics
   */
  public clearMetrics(): void {
    this.executionMetrics = [];
    
    secureLog('info', 'Retry executor metrics cleared', {
      cleared_count: this.executionMetrics.length
    });
  }

  /**
   * Update executor options
   */
  public updateOptions(updates: Partial<RetryExecutorOptions>): void {
    this.options = { ...this.options, ...updates };
    
    secureLog('info', 'Retry executor options updated', {
      updates: Object.keys(updates)
    });
  }

  /**
   * Get current options
   */
  public getOptions(): RetryExecutorOptions {
    return { ...this.options };
  }

  /**
   * Shutdown executor (cancel active executions)
   */
  public async shutdown(timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    
    secureLog('info', 'Retry executor shutdown initiated', {
      active_executions: this.activeExecutions.size,
      timeout: timeoutMs
    });

    // Wait for active executions to complete or timeout
    while (this.activeExecutions.size > 0 && (Date.now() - startTime) < timeoutMs) {
      await this.delay(100); // Check every 100ms
    }

    if (this.activeExecutions.size > 0) {
      secureLog('warn', 'Retry executor shutdown with active executions', {
        remaining_executions: this.activeExecutions.size
      });
    }

    // Clear active executions map
    this.activeExecutions.clear();

    secureLog('info', 'Retry executor shutdown completed', {
      duration: Date.now() - startTime
    });
  }
}
/**
 * Retry Policy System
 * 
 * Configurable retry policies with multiple backoff strategies,
 * error-specific handling, and adaptive behavior.
 */

import { BaseResilienceError, ErrorCategory } from '../errors/base-error.js';
import { secureLog } from '../../security.js';

export type RetryStrategy = 
  | 'fixed' 
  | 'linear' 
  | 'exponential' 
  | 'polynomial' 
  | 'fibonacci' 
  | 'adaptive';

export interface RetryPolicyConfig {
  name: string;
  maxAttempts: number;
  strategy: RetryStrategy;
  baseDelay: number; // Base delay in ms
  maxDelay: number; // Maximum delay in ms
  jitterEnabled: boolean;
  jitterMax: number; // Maximum jitter in ms
  jitterType: 'uniform' | 'exponential' | 'decorrelated';
  multiplier?: number; // For exponential/polynomial strategies
  polynomialDegree?: number; // For polynomial strategy
  retryableErrors: string[]; // Error codes that should trigger retry
  nonRetryableErrors: string[]; // Error codes that should not trigger retry
  retryableCategories: ErrorCategory[]; // Error categories that should trigger retry
  nonRetryableCategories: ErrorCategory[]; // Error categories that should not trigger retry
  contextualRules: RetryContextRule[]; // Context-specific retry rules
  timeoutMultiplier?: number; // Multiply timeout for each retry
  maxTotalTime?: number; // Maximum total time across all retries
}

export interface RetryContextRule {
  condition: string; // Condition expression
  override: Partial<RetryPolicyConfig>; // Override config when condition matches
  description: string;
}

export interface RetryAttempt {
  attempt: number;
  startTime: number;
  endTime?: number;
  delay: number;
  error?: Error;
  success: boolean;
  duration: number;
  metadata?: Record<string, any>;
}

export interface RetryExecution {
  id: string;
  policyName: string;
  operation: string;
  startTime: number;
  endTime?: number;
  totalAttempts: number;
  maxAttempts: number;
  attempts: RetryAttempt[];
  finalResult: {
    success: boolean;
    result?: any;
    error?: Error;
    totalDuration: number;
  };
  context: Record<string, any>;
}

/**
 * Intelligent retry policy with adaptive behavior
 */
export class RetryPolicy {
  private config: RetryPolicyConfig;
  private executionHistory: RetryExecution[] = [];
  private adaptiveMetrics: {
    successRateByAttempt: number[];
    averageDelayByAttempt: number[];
    errorPatterns: Map<string, { count: number; successRate: number }>;
  };
  private maxHistorySize = 1000;

  constructor(config: RetryPolicyConfig) {
    this.config = { ...config };
    this.adaptiveMetrics = {
      successRateByAttempt: new Array(config.maxAttempts).fill(0),
      averageDelayByAttempt: new Array(config.maxAttempts).fill(0),
      errorPatterns: new Map()
    };

    this.validateConfig();
    
    secureLog('info', 'Retry policy created', {
      name: config.name,
      strategy: config.strategy,
      max_attempts: config.maxAttempts,
      base_delay: config.baseDelay,
      jitter_enabled: config.jitterEnabled
    });
  }

  /**
   * Validate retry policy configuration
   */
  private validateConfig(): void {
    const errors: string[] = [];

    if (this.config.maxAttempts <= 0) {
      errors.push('maxAttempts must be greater than 0');
    }

    if (this.config.baseDelay < 0) {
      errors.push('baseDelay must be non-negative');
    }

    if (this.config.maxDelay < this.config.baseDelay) {
      errors.push('maxDelay must be greater than or equal to baseDelay');
    }

    if (this.config.jitterMax < 0) {
      errors.push('jitterMax must be non-negative');
    }

    if (this.config.strategy === 'exponential' && (!this.config.multiplier || this.config.multiplier <= 1)) {
      errors.push('exponential strategy requires multiplier > 1');
    }

    if (this.config.strategy === 'polynomial' && (!this.config.polynomialDegree || this.config.polynomialDegree <= 1)) {
      errors.push('polynomial strategy requires polynomialDegree > 1');
    }

    if (errors.length > 0) {
      throw new Error(`Retry policy configuration errors: ${errors.join(', ')}`);
    }
  }

  /**
   * Check if an error should be retried
   */
  public shouldRetry(error: Error | BaseResilienceError, attempt: number, context?: Record<string, any>): boolean {
    // Check attempt limit
    if (attempt >= this.config.maxAttempts) {
      return false;
    }

    // Get effective config (with contextual overrides)
    const effectiveConfig = this.getEffectiveConfig(context);

    // Check non-retryable errors first
    if (error instanceof BaseResilienceError) {
      // Check error code
      if (effectiveConfig.nonRetryableErrors.includes(error.code)) {
        return false;
      }

      // Check error category
      if (effectiveConfig.nonRetryableCategories.includes(error.category)) {
        return false;
      }

      // Check if explicitly retryable
      if (effectiveConfig.retryableErrors.includes(error.code)) {
        return true;
      }

      if (effectiveConfig.retryableCategories.includes(error.category)) {
        return true;
      }

      // Use error's own retryable flag
      return error.retryable;
    } else {
      // Handle standard Error objects
      const errorCode = (error as any).code || error.name || 'UNKNOWN';
      
      if (effectiveConfig.nonRetryableErrors.includes(errorCode)) {
        return false;
      }

      if (effectiveConfig.retryableErrors.includes(errorCode)) {
        return true;
      }

      // Default to retryable for unknown errors
      return true;
    }
  }

  /**
   * Calculate delay for next retry attempt
   */
  public calculateDelay(attempt: number, context?: Record<string, any>): number {
    const effectiveConfig = this.getEffectiveConfig(context);
    let delay: number;

    switch (effectiveConfig.strategy) {
      case 'fixed':
        delay = effectiveConfig.baseDelay;
        break;

      case 'linear':
        delay = effectiveConfig.baseDelay * attempt;
        break;

      case 'exponential':
        const multiplier = effectiveConfig.multiplier || 2;
        delay = effectiveConfig.baseDelay * Math.pow(multiplier, attempt - 1);
        break;

      case 'polynomial':
        const degree = effectiveConfig.polynomialDegree || 2;
        delay = effectiveConfig.baseDelay * Math.pow(attempt, degree);
        break;

      case 'fibonacci':
        delay = effectiveConfig.baseDelay * this.fibonacci(attempt);
        break;

      case 'adaptive':
        delay = this.calculateAdaptiveDelay(attempt, context);
        break;

      default:
        delay = effectiveConfig.baseDelay;
    }

    // Apply maximum delay limit
    delay = Math.min(delay, effectiveConfig.maxDelay);

    // Apply jitter if enabled
    if (effectiveConfig.jitterEnabled) {
      delay = this.applyJitter(delay, effectiveConfig);
    }

    return Math.max(0, Math.round(delay));
  }

  /**
   * Calculate Fibonacci number for retry delays
   */
  private fibonacci(n: number): number {
    if (n <= 1) return 1;
    let a = 1, b = 1;
    for (let i = 2; i <= n; i++) {
      [a, b] = [b, a + b];
    }
    return b;
  }

  /**
   * Calculate adaptive delay based on historical success rates
   */
  private calculateAdaptiveDelay(attempt: number, context?: Record<string, any>): number {
    const baseDelay = this.config.baseDelay;
    const attemptIndex = Math.min(attempt - 1, this.adaptiveMetrics.successRateByAttempt.length - 1);
    
    // Get success rate for this attempt number
    const successRate = this.adaptiveMetrics.successRateByAttempt[attemptIndex] || 0;
    
    // Increase delay if success rate is low
    let adaptiveMultiplier = 1;
    if (successRate < 0.3) {
      adaptiveMultiplier = 3; // High delay for low success rate
    } else if (successRate < 0.6) {
      adaptiveMultiplier = 2; // Medium delay for medium success rate
    } else {
      adaptiveMultiplier = 1; // Normal delay for high success rate
    }

    // Consider error patterns
    if (context?.lastError) {
      const errorCode = context.lastError.code || context.lastError.name || 'UNKNOWN';
      const pattern = this.adaptiveMetrics.errorPatterns.get(errorCode);
      
      if (pattern && pattern.successRate < 0.5) {
        adaptiveMultiplier *= 1.5; // Increase delay for problematic errors
      }
    }

    return baseDelay * Math.pow(2, attempt - 1) * adaptiveMultiplier;
  }

  /**
   * Apply jitter to delay
   */
  private applyJitter(delay: number, config: RetryPolicyConfig): number {
    const jitterAmount = Math.min(config.jitterMax, delay * 0.1); // Max 10% of delay
    
    switch (config.jitterType) {
      case 'uniform':
        return delay + (Math.random() * jitterAmount);
      
      case 'exponential':
        // Exponential distribution for jitter
        const lambda = 1 / jitterAmount;
        const exponentialJitter = -Math.log(1 - Math.random()) / lambda;
        return delay + Math.min(exponentialJitter, jitterAmount);
      
      case 'decorrelated':
        // Decorrelated jitter (prevents thundering herd)
        const previousDelay = this.adaptiveMetrics.averageDelayByAttempt[0] || delay;
        const decorrelatedJitter = Math.random() * (3 * previousDelay - delay) + delay;
        return Math.max(delay, decorrelatedJitter);
      
      default:
        return delay + (Math.random() * jitterAmount);
    }
  }

  /**
   * Get effective configuration with contextual overrides
   */
  private getEffectiveConfig(context?: Record<string, any>): RetryPolicyConfig {
    if (!context || this.config.contextualRules.length === 0) {
      return this.config;
    }

    let effectiveConfig = { ...this.config };

    for (const rule of this.config.contextualRules) {
      if (this.evaluateCondition(rule.condition, context)) {
        effectiveConfig = { ...effectiveConfig, ...rule.override };
        
        secureLog('debug', 'Retry policy contextual rule applied', {
          policy_name: this.config.name,
          rule_description: rule.description,
          condition: rule.condition
        });
      }
    }

    return effectiveConfig;
  }

  /**
   * Evaluate contextual condition
   */
  private evaluateCondition(condition: string, context: Record<string, any>): boolean {
    try {
      // Simple condition evaluation (could be extended with a proper expression parser)
      // For now, support basic key-value checks
      const parts = condition.split('=');
      if (parts.length === 2) {
        const key = parts[0].trim();
        const expectedValue = parts[1].trim().replace(/['"]/g, '');
        const actualValue = String(context[key] || '');
        return actualValue === expectedValue;
      }
      
      // Support simple existence checks
      if (condition.startsWith('exists:')) {
        const key = condition.substring(7).trim();
        return context[key] !== undefined;
      }
      
      return false;
    } catch (error) {
      secureLog('warn', 'Failed to evaluate retry policy condition', {
        policy_name: this.config.name,
        condition,
        error: error instanceof Error ? error.message : 'unknown'
      });
      return false;
    }
  }

  /**
   * Record retry execution for adaptive learning
   */
  public recordExecution(execution: RetryExecution): void {
    this.executionHistory.push(execution);
    
    // Trim history if needed
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
    }

    // Update adaptive metrics
    this.updateAdaptiveMetrics(execution);

    secureLog('debug', 'Retry execution recorded', {
      policy_name: this.config.name,
      execution_id: execution.id,
      total_attempts: execution.totalAttempts,
      success: execution.finalResult.success,
      total_duration: execution.finalResult.totalDuration
    });
  }

  /**
   * Update adaptive metrics based on execution results
   */
  private updateAdaptiveMetrics(execution: RetryExecution): void {
    // Update success rate by attempt
    for (let i = 0; i < execution.attempts.length; i++) {
      const attempt = execution.attempts[i];
      const attemptIndex = Math.min(i, this.adaptiveMetrics.successRateByAttempt.length - 1);
      
      // Simple moving average for success rate
      const currentRate = this.adaptiveMetrics.successRateByAttempt[attemptIndex] || 0;
      const newRate = attempt.success ? 1 : 0;
      this.adaptiveMetrics.successRateByAttempt[attemptIndex] = 
        (currentRate * 0.9) + (newRate * 0.1);
      
      // Update average delay
      const currentDelay = this.adaptiveMetrics.averageDelayByAttempt[attemptIndex] || 0;
      this.adaptiveMetrics.averageDelayByAttempt[attemptIndex] = 
        (currentDelay * 0.9) + (attempt.delay * 0.1);
    }

    // Update error patterns
    for (const attempt of execution.attempts) {
      if (attempt.error) {
        const errorCode = (attempt.error as any).code || attempt.error.name || 'UNKNOWN';
        const pattern = this.adaptiveMetrics.errorPatterns.get(errorCode) || 
          { count: 0, successRate: 0 };
        
        pattern.count++;
        pattern.successRate = (pattern.successRate * 0.9) + (attempt.success ? 0.1 : 0);
        
        this.adaptiveMetrics.errorPatterns.set(errorCode, pattern);
      }
    }
  }

  /**
   * Get policy configuration
   */
  public getConfig(): RetryPolicyConfig {
    return { ...this.config };
  }

  /**
   * Update policy configuration
   */
  public updateConfig(updates: Partial<RetryPolicyConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfig();
    
    secureLog('info', 'Retry policy configuration updated', {
      policy_name: this.config.name,
      updates: Object.keys(updates)
    });
  }

  /**
   * Get execution history
   */
  public getExecutionHistory(limit?: number): RetryExecution[] {
    const history = [...this.executionHistory].reverse(); // Most recent first
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Get adaptive metrics
   */
  public getAdaptiveMetrics() {
    return {
      successRateByAttempt: [...this.adaptiveMetrics.successRateByAttempt],
      averageDelayByAttempt: [...this.adaptiveMetrics.averageDelayByAttempt],
      errorPatterns: new Map(this.adaptiveMetrics.errorPatterns)
    };
  }

  /**
   * Get policy statistics
   */
  public getStatistics() {
    const totalExecutions = this.executionHistory.length;
    if (totalExecutions === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        averageAttempts: 0,
        averageDuration: 0,
        mostCommonErrors: []
      };
    }

    const successfulExecutions = this.executionHistory
      .filter(exec => exec.finalResult.success).length;
    
    const totalAttempts = this.executionHistory
      .reduce((sum, exec) => sum + exec.totalAttempts, 0);
    
    const totalDuration = this.executionHistory
      .reduce((sum, exec) => sum + exec.finalResult.totalDuration, 0);

    // Get most common errors
    const errorCounts = new Map<string, number>();
    for (const execution of this.executionHistory) {
      for (const attempt of execution.attempts) {
        if (attempt.error) {
          const errorCode = (attempt.error as any).code || attempt.error.name || 'UNKNOWN';
          errorCounts.set(errorCode, (errorCounts.get(errorCode) || 0) + 1);
        }
      }
    }

    const mostCommonErrors = Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([error, count]) => ({ error, count }));

    return {
      totalExecutions,
      successRate: successfulExecutions / totalExecutions,
      averageAttempts: totalAttempts / totalExecutions,
      averageDuration: totalDuration / totalExecutions,
      mostCommonErrors,
      adaptiveMetrics: this.getAdaptiveMetrics()
    };
  }

  /**
   * Reset adaptive metrics
   */
  public resetAdaptiveMetrics(): void {
    this.adaptiveMetrics = {
      successRateByAttempt: new Array(this.config.maxAttempts).fill(0),
      averageDelayByAttempt: new Array(this.config.maxAttempts).fill(0),
      errorPatterns: new Map()
    };
    
    secureLog('info', 'Retry policy adaptive metrics reset', {
      policy_name: this.config.name
    });
  }

  /**
   * Clear execution history
   */
  public clearHistory(): void {
    this.executionHistory = [];
    
    secureLog('info', 'Retry policy execution history cleared', {
      policy_name: this.config.name
    });
  }

  /**
   * Get policy name
   */
  public getName(): string {
    return this.config.name;
  }
}
/**
 * Retry Manager
 * 
 * Central orchestrator for retry policies and execution,
 * providing simplified API and intelligent policy selection.
 */

import { RetryPolicy, RetryPolicyConfig } from './retry-policy.js';
import { RetryExecutor, RetryExecutorOptions, ExecutionContext } from './retry-executor.js';
import { RETRY_STRATEGIES, getRetryStrategy, createAdaptiveRetryStrategy } from './retry-strategies.js';
import { RetryError } from '../errors/resilience-errors.js';
import { secureLog } from '../../security.js';

export interface RetryManagerConfig {
  defaultStrategy?: string;
  autoRegisterStrategies?: boolean;
  executorOptions?: RetryExecutorOptions;
  enableAdaptiveLearning?: boolean;
  metricsRetentionDays?: number;
}

export interface RetryOptions {
  strategy?: string;
  maxAttempts?: number;
  baseDelay?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  timeout?: number;
  skipRetryFor?: string[];
  forceRetryFor?: string[];
  metadata?: Record<string, any>;
}

export interface RetryManagerMetrics {
  totalExecutions: number;
  successRate: number;
  averageDuration: number;
  averageAttempts: number;
  strategyPerformance: Record<string, {
    executions: number;
    successRate: number;
    averageAttempts: number;
  }>;
  recentFailures: Array<{
    operation: string;
    strategy: string;
    error: string;
    timestamp: number;
  }>;
}

/**
 * Centralized retry management with intelligent policy selection
 */
export class RetryManager {
  private executor: RetryExecutor;
  private policies: Map<string, RetryPolicy> = new Map();
  private config: RetryManagerConfig;
  private strategyUsage: Map<string, { count: number; lastUsed: number }> = new Map();

  constructor(config: RetryManagerConfig = {}) {
    this.config = {
      defaultStrategy: 'network',
      autoRegisterStrategies: true,
      enableAdaptiveLearning: true,
      metricsRetentionDays: 7,
      ...config
    };

    // Initialize executor
    this.executor = new RetryExecutor(this.config.executorOptions);

    // Auto-register predefined strategies if enabled
    if (this.config.autoRegisterStrategies) {
      this.registerPredefinedStrategies();
    }

    secureLog('info', 'Retry manager initialized', {
      default_strategy: this.config.defaultStrategy,
      auto_register: this.config.autoRegisterStrategies,
      adaptive_learning: this.config.enableAdaptiveLearning
    });
  }

  /**
   * Register predefined retry strategies
   */
  private registerPredefinedStrategies(): void {
    for (const [name, config] of Object.entries(RETRY_STRATEGIES)) {
      try {
        const policy = new RetryPolicy(config);
        this.policies.set(name, policy);
        this.executor.registerPolicy(policy);
        
        secureLog('debug', 'Predefined retry strategy registered', {
          strategy_name: name,
          max_attempts: config.maxAttempts,
          strategy_type: config.strategy
        });
      } catch (error) {
        secureLog('error', 'Failed to register predefined retry strategy', {
          strategy_name: name,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }
  }

  /**
   * Register custom retry strategy
   */
  public registerStrategy(config: RetryPolicyConfig): void {
    try {
      const policy = new RetryPolicy(config);
      this.policies.set(config.name, policy);
      this.executor.registerPolicy(policy);
      
      secureLog('info', 'Custom retry strategy registered', {
        strategy_name: config.name,
        max_attempts: config.maxAttempts,
        strategy_type: config.strategy
      });
    } catch (error) {
      throw new RetryError(
        `Failed to register retry strategy: ${error instanceof Error ? error.message : 'unknown'}`,
        'STRATEGY_REGISTRATION_FAILED',
        'configuration',
        { strategy_name: config.name }
      );
    }
  }

  /**
   * Unregister retry strategy
   */
  public unregisterStrategy(name: string): boolean {
    const policy = this.policies.get(name);
    if (!policy) {
      return false;
    }

    this.policies.delete(name);
    this.executor.unregisterPolicy(name);
    this.strategyUsage.delete(name);
    
    secureLog('info', 'Retry strategy unregistered', {
      strategy_name: name
    });
    
    return true;
  }

  /**
   * Execute operation with retry
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: RetryOptions = {}
  ): Promise<T> {
    // Resolve strategy
    const strategyName = this.resolveStrategy(operationName, options);
    
    // Record strategy usage
    this.recordStrategyUsage(strategyName);

    // Build execution context
    const context: ExecutionContext = {
      operation: operationName,
      priority: options.priority || 'normal',
      timeout: options.timeout,
      skipRetryFor: options.skipRetryFor,
      forceRetryFor: options.forceRetryFor,
      metadata: {
        retry_manager: true,
        resolved_strategy: strategyName,
        ...options.metadata
      }
    };

    try {
      secureLog('debug', 'Executing operation with retry', {
        operation: operationName,
        strategy: strategyName,
        priority: context.priority,
        timeout: context.timeout
      });

      const result = await this.executor.execute(operation, strategyName, context);
      
      secureLog('debug', 'Operation executed successfully', {
        operation: operationName,
        strategy: strategyName
      });

      return result;
    } catch (error) {
      secureLog('warn', 'Operation failed after retries', {
        operation: operationName,
        strategy: strategyName,
        error: error instanceof Error ? error.message : 'unknown'
      });

      throw error;
    }
  }

  /**
   * Resolve strategy based on operation and options
   */
  private resolveStrategy(operationName: string, options: RetryOptions): string {
    // Use explicit strategy if provided
    if (options.strategy && this.policies.has(options.strategy)) {
      return options.strategy;
    }

    // Intelligent strategy selection based on operation name
    const inferredStrategy = this.inferStrategyFromOperation(operationName);
    if (inferredStrategy && this.policies.has(inferredStrategy)) {
      return inferredStrategy;
    }

    // Use default strategy
    if (this.config.defaultStrategy && this.policies.has(this.config.defaultStrategy)) {
      return this.config.defaultStrategy;
    }

    // Fallback to first available strategy
    const availableStrategies = this.executor.getPolicies();
    if (availableStrategies.length > 0) {
      return availableStrategies[0];
    }

    throw new RetryError(
      'No retry strategy available',
      'NO_STRATEGY_AVAILABLE',
      'configuration',
      { operation: operationName, requested_strategy: options.strategy }
    );
  }

  /**
   * Infer strategy from operation name patterns
   */
  private inferStrategyFromOperation(operationName: string): string | undefined {
    const operation = operationName.toLowerCase();

    // Bridge operations
    if (operation.includes('bridge') || operation.includes('process')) {
      return 'bridge';
    }

    // Telegram operations
    if (operation.includes('telegram') || operation.includes('bot') || operation.includes('message')) {
      return 'telegram';
    }

    // File operations
    if (operation.includes('file') || operation.includes('write') || operation.includes('read')) {
      return 'filesystem';
    }

    // Database operations
    if (operation.includes('db') || operation.includes('database') || operation.includes('query')) {
      return 'database';
    }

    // Critical operations
    if (operation.includes('critical') || operation.includes('important')) {
      return 'critical';
    }

    // Background operations
    if (operation.includes('background') || operation.includes('async') || operation.includes('queue')) {
      return 'background';
    }

    // Fast operations
    if (operation.includes('fast') || operation.includes('quick') || operation.includes('immediate')) {
      return 'fast';
    }

    // Default to network for unknown operations
    return 'network';
  }

  /**
   * Record strategy usage for analytics
   */
  private recordStrategyUsage(strategyName: string): void {
    const usage = this.strategyUsage.get(strategyName) || { count: 0, lastUsed: 0 };
    usage.count++;
    usage.lastUsed = Date.now();
    this.strategyUsage.set(strategyName, usage);
  }

  /**
   * Create and register adaptive strategy
   */
  public createAdaptiveStrategy(
    name: string,
    baseConfig?: Partial<RetryPolicyConfig>
  ): void {
    const config = createAdaptiveRetryStrategy(name, baseConfig);
    this.registerStrategy(config);
  }

  /**
   * Update strategy configuration
   */
  public updateStrategy(name: string, updates: Partial<RetryPolicyConfig>): void {
    const policy = this.policies.get(name);
    if (!policy) {
      throw new RetryError(
        `Strategy not found: ${name}`,
        'STRATEGY_NOT_FOUND',
        'configuration',
        { strategy_name: name }
      );
    }

    policy.updateConfig(updates);
    
    secureLog('info', 'Retry strategy updated', {
      strategy_name: name,
      updates: Object.keys(updates)
    });
  }

  /**
   * Get strategy configuration
   */
  public getStrategy(name: string): RetryPolicyConfig | undefined {
    const policy = this.policies.get(name);
    return policy ? policy.getConfig() : undefined;
  }

  /**
   * Get all registered strategies
   */
  public getStrategies(): string[] {
    return Array.from(this.policies.keys());
  }

  /**
   * Get strategy statistics
   */
  public getStrategyStatistics(name: string) {
    const policy = this.policies.get(name);
    if (!policy) {
      return undefined;
    }

    const usage = this.strategyUsage.get(name) || { count: 0, lastUsed: 0 };
    
    return {
      name,
      usage,
      statistics: policy.getStatistics(),
      adaptiveMetrics: policy.getAdaptiveMetrics()
    };
  }

  /**
   * Get retry manager metrics
   */
  public getMetrics(): RetryManagerMetrics {
    const executorStats = this.executor.getExecutionStatistics();
    const executorMetrics = this.executor.getExecutionMetrics(100);

    // Calculate strategy performance
    const strategyPerformance: Record<string, {
      executions: number;
      successRate: number;
      averageAttempts: number;
    }> = {};

    for (const [name, policy] of this.policies) {
      const stats = policy.getStatistics();
      strategyPerformance[name] = {
        executions: stats.totalExecutions,
        successRate: stats.successRate,
        averageAttempts: stats.averageAttempts
      };
    }

    // Get recent failures
    const recentFailures = executorMetrics
      .filter(metric => !metric.success)
      .slice(0, 10)
      .map(metric => ({
        operation: metric.operation,
        strategy: metric.policyName,
        error: metric.finalError || 'unknown',
        timestamp: Date.now() - metric.totalDuration // Approximate
      }));

    return {
      totalExecutions: executorStats.totalExecutions,
      successRate: executorStats.successRate,
      averageDuration: executorStats.averageDuration,
      averageAttempts: executorStats.averageAttempts,
      strategyPerformance,
      recentFailures
    };
  }

  /**
   * Reset all metrics and adaptive learning
   */
  public resetMetrics(): void {
    // Reset executor metrics
    this.executor.clearMetrics();

    // Reset strategy usage tracking
    this.strategyUsage.clear();

    // Reset adaptive metrics for all policies
    for (const policy of this.policies.values()) {
      policy.resetAdaptiveMetrics();
      policy.clearHistory();
    }

    secureLog('info', 'Retry manager metrics reset');
  }

  /**
   * Get recommended strategy for operation
   */
  public getRecommendedStrategy(operationName: string): string {
    // Use inference logic
    const inferred = this.inferStrategyFromOperation(operationName);
    if (inferred && this.policies.has(inferred)) {
      return inferred;
    }

    // Fallback to most successful strategy
    const metrics = this.getMetrics();
    const bestStrategy = Object.entries(metrics.strategyPerformance)
      .filter(([_, perf]) => perf.executions > 0)
      .sort((a, b) => b[1].successRate - a[1].successRate)[0];

    if (bestStrategy) {
      return bestStrategy[0];
    }

    // Final fallback
    return this.config.defaultStrategy || 'network';
  }

  /**
   * Health check for retry manager
   */
  public getHealthStatus() {
    const activeExecutions = this.executor.getActiveExecutionsCount();
    const maxConcurrent = this.executor.getOptions().maxConcurrentExecutions || 10;
    const utilizationRate = activeExecutions / maxConcurrent;

    let health: 'healthy' | 'degraded' | 'unhealthy';

    if (utilizationRate < 0.7) {
      health = 'healthy';
    } else if (utilizationRate < 0.9) {
      health = 'degraded';
    } else {
      health = 'unhealthy';
    }

    return {
      health,
      activeExecutions,
      maxConcurrentExecutions: maxConcurrent,
      utilizationRate,
      registeredStrategies: this.policies.size,
      enabledFeatures: {
        adaptiveLearning: this.config.enableAdaptiveLearning,
        autoRegisterStrategies: this.config.autoRegisterStrategies
      }
    };
  }

  /**
   * Shutdown retry manager
   */
  public async shutdown(timeoutMs: number = 30000): Promise<void> {
    secureLog('info', 'Retry manager shutdown initiated');
    
    await this.executor.shutdown(timeoutMs);
    
    secureLog('info', 'Retry manager shutdown completed');
  }

  /**
   * Update manager configuration
   */
  public updateConfig(updates: Partial<RetryManagerConfig>): void {
    this.config = { ...this.config, ...updates };
    
    // Update executor options if provided
    if (updates.executorOptions) {
      this.executor.updateOptions(updates.executorOptions);
    }
    
    secureLog('info', 'Retry manager configuration updated', {
      updates: Object.keys(updates)
    });
  }

  /**
   * Get current configuration
   */
  public getConfig(): RetryManagerConfig {
    return { ...this.config };
  }
}
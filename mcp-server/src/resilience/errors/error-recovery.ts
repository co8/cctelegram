/**
 * Error Recovery System
 * 
 * Advanced error recovery orchestration with multiple strategies,
 * automatic escalation, and intelligent recovery pattern learning.
 */

import { BaseResilienceError, RecoveryStrategy } from './base-error.js';
import { ErrorHandler, ErrorHandlingContext } from './error-handler.js';
import { secureLog, sanitizeForLogging } from '../../security.js';

export interface RecoveryPlan {
  id: string;
  errorCode: string;
  strategies: RecoveryStep[];
  maxDuration: number;
  priority: 'low' | 'normal' | 'high' | 'critical';
  conditions: RecoveryCondition[];
  metadata: Record<string, any>;
}

export interface RecoveryStep {
  strategy: RecoveryStrategy;
  order: number;
  timeout: number;
  maxAttempts: number;
  condition?: string; // Condition expression for execution
  onSuccess?: string; // Action to take on success
  onFailure?: string; // Action to take on failure
  metadata?: Record<string, any>;
}

export interface RecoveryCondition {
  type: 'error_code' | 'error_category' | 'error_count' | 'time_since_last' | 'system_state';
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'matches';
  value: any;
  negate?: boolean;
}

export interface RecoveryExecution {
  planId: string;
  errorId: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  steps: RecoveryStepExecution[];
  result?: RecoveryResult;
}

export interface RecoveryStepExecution {
  step: RecoveryStep;
  startTime: number;
  endTime?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  attempts: number;
  result?: any;
  error?: string;
}

export interface RecoveryResult {
  success: boolean;
  strategy: RecoveryStrategy;
  duration: number;
  stepsExecuted: number;
  finalStatus: string;
  metadata: Record<string, any>;
}

export interface RecoveryMetrics {
  totalRecoveries: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  averageRecoveryTime: number;
  strategiesUsed: Record<RecoveryStrategy, number>;
  mostEffectiveStrategy: RecoveryStrategy | null;
  recentSuccessRate: number;
  trendsOverTime: Array<{
    timestamp: number;
    successRate: number;
    averageTime: number;
  }>;
}

/**
 * Advanced error recovery orchestrator
 */
export class ErrorRecoverySystem {
  private plans: Map<string, RecoveryPlan> = new Map();
  private activeExecutions: Map<string, RecoveryExecution> = new Map();
  private completedExecutions: RecoveryExecution[] = [];
  private metrics: RecoveryMetrics;
  private errorHandler: ErrorHandler;
  private maxConcurrentRecoveries = 5;
  private maxCompletedExecutions = 1000;

  constructor(errorHandler: ErrorHandler) {
    this.errorHandler = errorHandler;
    this.metrics = this.initializeMetrics();
    this.loadDefaultRecoveryPlans();

    secureLog('info', 'Error recovery system initialized', {
      plans_loaded: this.plans.size,
      max_concurrent: this.maxConcurrentRecoveries
    });
  }

  /**
   * Initialize recovery metrics
   */
  private initializeMetrics(): RecoveryMetrics {
    return {
      totalRecoveries: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      averageRecoveryTime: 0,
      strategiesUsed: {} as Record<RecoveryStrategy, number>,
      mostEffectiveStrategy: null,
      recentSuccessRate: 0,
      trendsOverTime: []
    };
  }

  /**
   * Load default recovery plans
   */
  private loadDefaultRecoveryPlans(): void {
    // Bridge restart recovery plan
    this.addRecoveryPlan({
      id: 'bridge_restart_recovery',
      errorCode: 'BRIDGE_NOT_RUNNING',
      maxDuration: 60000, // 1 minute
      priority: 'high',
      conditions: [
        {
          type: 'error_code',
          operator: 'equals',
          value: 'BRIDGE_NOT_RUNNING'
        }
      ],
      strategies: [
        {
          strategy: 'retry',
          order: 1,
          timeout: 5000,
          maxAttempts: 2,
          onFailure: 'continue'
        },
        {
          strategy: 'restart',
          order: 2,
          timeout: 30000,
          maxAttempts: 3,
          onFailure: 'escalate'
        },
        {
          strategy: 'escalate',
          order: 3,
          timeout: 5000,
          maxAttempts: 1
        }
      ],
      metadata: {
        description: 'Comprehensive recovery plan for bridge restart scenarios',
        category: 'bridge'
      }
    });

    // Network failure recovery plan
    this.addRecoveryPlan({
      id: 'network_failure_recovery',
      errorCode: 'NETWORK_CONNECTION_REFUSED',
      maxDuration: 30000, // 30 seconds
      priority: 'normal',
      conditions: [
        {
          type: 'error_code',
          operator: 'contains',
          value: 'NETWORK'
        }
      ],
      strategies: [
        {
          strategy: 'retry',
          order: 1,
          timeout: 5000,
          maxAttempts: 3,
          onFailure: 'continue'
        },
        {
          strategy: 'circuit_breaker',
          order: 2,
          timeout: 10000,
          maxAttempts: 1,
          onFailure: 'continue'
        },
        {
          strategy: 'fallback',
          order: 3,
          timeout: 5000,
          maxAttempts: 1
        }
      ],
      metadata: {
        description: 'Recovery plan for network connectivity issues',
        category: 'network'
      }
    });

    // Telegram rate limit recovery plan
    this.addRecoveryPlan({
      id: 'telegram_rate_limit_recovery',
      errorCode: 'TELEGRAM_RATE_LIMITED',
      maxDuration: 120000, // 2 minutes
      priority: 'normal',
      conditions: [
        {
          type: 'error_code',
          operator: 'equals',
          value: 'TELEGRAM_RATE_LIMITED'
        }
      ],
      strategies: [
        {
          strategy: 'circuit_breaker',
          order: 1,
          timeout: 60000,
          maxAttempts: 1,
          onSuccess: 'complete'
        }
      ],
      metadata: {
        description: 'Recovery plan for Telegram API rate limiting',
        category: 'telegram'
      }
    });

    // Resource exhaustion recovery plan
    this.addRecoveryPlan({
      id: 'resource_exhaustion_recovery',
      errorCode: 'RESOURCE_EXHAUSTED',
      maxDuration: 45000, // 45 seconds
      priority: 'critical',
      conditions: [
        {
          type: 'error_code',
          operator: 'equals',
          value: 'RESOURCE_EXHAUSTED'
        }
      ],
      strategies: [
        {
          strategy: 'graceful_degradation',
          order: 1,
          timeout: 10000,
          maxAttempts: 1,
          onFailure: 'continue'
        },
        {
          strategy: 'restart',
          order: 2,
          timeout: 30000,
          maxAttempts: 2,
          onFailure: 'escalate'
        },
        {
          strategy: 'escalate',
          order: 3,
          timeout: 5000,
          maxAttempts: 1
        }
      ],
      metadata: {
        description: 'Recovery plan for resource exhaustion scenarios',
        category: 'resource'
      }
    });

    // Generic retry recovery plan
    this.addRecoveryPlan({
      id: 'generic_retry_recovery',
      errorCode: 'GENERIC',
      maxDuration: 20000, // 20 seconds
      priority: 'low',
      conditions: [
        {
          type: 'error_category',
          operator: 'equals',
          value: 'unknown'
        }
      ],
      strategies: [
        {
          strategy: 'retry',
          order: 1,
          timeout: 10000,
          maxAttempts: 2,
          onFailure: 'continue'
        },
        {
          strategy: 'fallback',
          order: 2,
          timeout: 5000,
          maxAttempts: 1
        }
      ],
      metadata: {
        description: 'Generic recovery plan for unknown errors',
        category: 'generic'
      }
    });
  }

  /**
   * Execute recovery for an error
   */
  public async executeRecovery(
    error: BaseResilienceError,
    context: ErrorHandlingContext
  ): Promise<RecoveryResult> {
    // Check concurrent execution limit
    if (this.activeExecutions.size >= this.maxConcurrentRecoveries) {
      secureLog('warn', 'Max concurrent recoveries limit reached', {
        active_count: this.activeExecutions.size,
        max_concurrent: this.maxConcurrentRecoveries,
        error_code: error.code
      });
      
      return {
        success: false,
        strategy: 'manual',
        duration: 0,
        stepsExecuted: 0,
        finalStatus: 'rejected_concurrent_limit',
        metadata: { reason: 'max_concurrent_recoveries_exceeded' }
      };
    }

    // Find appropriate recovery plan
    const plan = this.findRecoveryPlan(error);
    if (!plan) {
      secureLog('warn', 'No recovery plan found for error', {
        error_code: error.code,
        error_category: error.category
      });
      
      return {
        success: false,
        strategy: 'manual',
        duration: 0,
        stepsExecuted: 0,
        finalStatus: 'no_plan_found',
        metadata: { error_code: error.code }
      };
    }

    // Create execution context
    const executionId = `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const execution: RecoveryExecution = {
      planId: plan.id,
      errorId: `${error.code}_${error.timestamp}`,
      startTime: Date.now(),
      status: 'running',
      currentStep: 0,
      steps: plan.strategies.map(step => ({
        step,
        startTime: 0,
        status: 'pending',
        attempts: 0
      }))
    };

    this.activeExecutions.set(executionId, execution);

    secureLog('info', 'Recovery execution started', {
      execution_id: executionId,
      plan_id: plan.id,
      error_code: error.code,
      steps_count: plan.strategies.length,
      max_duration: plan.maxDuration
    });

    try {
      const result = await this.executeRecoveryPlan(execution, error, context);
      
      // Update metrics
      this.updateMetrics(result);
      
      // Move to completed executions
      execution.endTime = Date.now();
      execution.status = result.success ? 'completed' : 'failed';
      execution.result = result;
      
      this.completedExecutions.push(execution);
      this.activeExecutions.delete(executionId);
      
      // Trim completed executions if needed
      if (this.completedExecutions.length > this.maxCompletedExecutions) {
        this.completedExecutions = this.completedExecutions.slice(-this.maxCompletedExecutions);
      }

      secureLog('info', 'Recovery execution completed', {
        execution_id: executionId,
        success: result.success,
        duration: result.duration,
        steps_executed: result.stepsExecuted,
        final_status: result.finalStatus
      });

      return result;

    } catch (executionError) {
      const duration = Date.now() - execution.startTime;
      
      execution.endTime = Date.now();
      execution.status = 'failed';
      
      this.completedExecutions.push(execution);
      this.activeExecutions.delete(executionId);

      secureLog('error', 'Recovery execution failed with error', {
        execution_id: executionId,
        execution_error: executionError instanceof Error ? executionError.message : 'unknown',
        duration
      });

      return {
        success: false,
        strategy: 'manual',
        duration,
        stepsExecuted: execution.currentStep,
        finalStatus: 'execution_error',
        metadata: {
          execution_error: executionError instanceof Error ? executionError.message : 'unknown'
        }
      };
    }
  }

  /**
   * Execute a recovery plan
   */
  private async executeRecoveryPlan(
    execution: RecoveryExecution,
    error: BaseResilienceError,
    context: ErrorHandlingContext
  ): Promise<RecoveryResult> {
    const plan = this.plans.get(execution.planId)!;
    const startTime = Date.now();
    let success = false;
    let finalStrategy: RecoveryStrategy = 'manual';

    // Set overall timeout
    const overallTimeout = setTimeout(() => {
      execution.status = 'cancelled';
      secureLog('warn', 'Recovery execution timed out', {
        execution_id: execution.planId,
        max_duration: plan.maxDuration
      });
    }, plan.maxDuration);

    try {
      for (let i = 0; i < execution.steps.length; i++) {
        execution.currentStep = i;
        const stepExecution = execution.steps[i];
        const step = stepExecution.step;

        // Check if execution was cancelled
        if (execution.status === 'cancelled') {
          break;
        }

        // Check step condition if exists
        if (step.condition && !this.evaluateCondition(step.condition, error, context)) {
          stepExecution.status = 'skipped';
          secureLog('debug', 'Recovery step skipped due to condition', {
            step_order: step.order,
            strategy: step.strategy,
            condition: step.condition
          });
          continue;
        }

        stepExecution.status = 'running';
        stepExecution.startTime = Date.now();
        finalStrategy = step.strategy;

        secureLog('debug', 'Recovery step started', {
          step_order: step.order,
          strategy: step.strategy,
          timeout: step.timeout,
          max_attempts: step.maxAttempts
        });

        // Execute step with retries
        let stepSuccess = false;
        for (let attempt = 1; attempt <= step.maxAttempts && !stepSuccess; attempt++) {
          stepExecution.attempts = attempt;

          try {
            stepSuccess = await this.executeRecoveryStep(step, error, context);
            
            if (stepSuccess) {
              stepExecution.result = 'success';
              stepExecution.status = 'completed';
              
              secureLog('debug', 'Recovery step completed successfully', {
                step_order: step.order,
                strategy: step.strategy,
                attempt: attempt
              });

              // Check onSuccess action
              if (step.onSuccess === 'complete') {
                success = true;
                break;
              }
            } else {
              secureLog('debug', 'Recovery step attempt failed', {
                step_order: step.order,
                strategy: step.strategy,
                attempt: attempt,
                max_attempts: step.maxAttempts
              });
            }

          } catch (stepError) {
            stepExecution.error = stepError instanceof Error ? stepError.message : 'unknown';
            
            secureLog('error', 'Recovery step threw error', {
              step_order: step.order,
              strategy: step.strategy,
              attempt: attempt,
              step_error: stepExecution.error
            });
          }

          // Wait between attempts if not the last attempt
          if (attempt < step.maxAttempts && !stepSuccess) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        stepExecution.endTime = Date.now();

        if (!stepSuccess) {
          stepExecution.status = 'failed';
          
          // Check onFailure action
          if (step.onFailure === 'escalate') {
            // Continue to next step (which should be escalation)
            continue;
          } else if (step.onFailure === 'stop') {
            break;
          }
          // Otherwise continue to next step
        } else {
          success = true;
          break; // Step succeeded, recovery complete
        }
      }

    } finally {
      clearTimeout(overallTimeout);
    }

    const duration = Date.now() - startTime;
    
    return {
      success,
      strategy: finalStrategy,
      duration,
      stepsExecuted: execution.currentStep + 1,
      finalStatus: success ? 'recovered' : 'failed',
      metadata: {
        plan_id: plan.id,
        steps_total: execution.steps.length,
        execution_cancelled: execution.status === 'cancelled'
      }
    };
  }

  /**
   * Execute a single recovery step
   */
  private async executeRecoveryStep(
    step: RecoveryStep,
    error: BaseResilienceError,
    context: ErrorHandlingContext
  ): Promise<boolean> {
    const recoveryHandler = this.errorHandler['recoveryHandlers'].get(step.strategy);
    
    if (!recoveryHandler) {
      secureLog('warn', 'No recovery handler found for strategy', {
        strategy: step.strategy
      });
      return false;
    }

    // Execute with timeout
    const timeoutPromise = new Promise<boolean>((_, reject) => {
      setTimeout(() => reject(new Error(`Recovery step timeout (${step.timeout}ms)`)), step.timeout);
    });

    const handlerPromise = recoveryHandler.handler(error, context);
    
    try {
      return await Promise.race([handlerPromise, timeoutPromise]);
    } catch (error) {
      return false;
    }
  }

  /**
   * Find appropriate recovery plan for an error
   */
  private findRecoveryPlan(error: BaseResilienceError): RecoveryPlan | null {
    const candidatePlans = Array.from(this.plans.values())
      .filter(plan => this.evaluatePlanConditions(plan, error))
      .sort((a, b) => {
        // Sort by priority then by specificity
        const priorityOrder = { critical: 4, high: 3, normal: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        // More specific conditions = higher score
        return b.conditions.length - a.conditions.length;
      });

    return candidatePlans[0] || null;
  }

  /**
   * Evaluate if a recovery plan matches an error
   */
  private evaluatePlanConditions(plan: RecoveryPlan, error: BaseResilienceError): boolean {
    return plan.conditions.every(condition => this.evaluateCondition(condition, error, null));
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    condition: RecoveryCondition | string,
    error: BaseResilienceError,
    context: ErrorHandlingContext | null
  ): boolean {
    // Handle string conditions (simple expressions)
    if (typeof condition === 'string') {
      // TODO: Implement expression evaluation
      return true;
    }

    let result = false;

    switch (condition.type) {
      case 'error_code':
        result = this.evaluateStringCondition(error.code, condition.operator, condition.value);
        break;
      
      case 'error_category':
        result = this.evaluateStringCondition(error.category, condition.operator, condition.value);
        break;
      
      case 'error_count':
        // TODO: Implement error count tracking
        result = true;
        break;
      
      case 'time_since_last':
        // TODO: Implement time-based conditions
        result = true;
        break;
      
      case 'system_state':
        // TODO: Implement system state conditions
        result = true;
        break;
      
      default:
        result = false;
    }

    return condition.negate ? !result : result;
  }

  /**
   * Evaluate string-based conditions
   */
  private evaluateStringCondition(value: string, operator: string, expected: any): boolean {
    switch (operator) {
      case 'equals':
        return value === expected;
      case 'contains':
        return value.includes(expected);
      case 'matches':
        return new RegExp(expected).test(value);
      default:
        return false;
    }
  }

  /**
   * Update recovery metrics
   */
  private updateMetrics(result: RecoveryResult): void {
    this.metrics.totalRecoveries++;
    
    if (result.success) {
      this.metrics.successfulRecoveries++;
    } else {
      this.metrics.failedRecoveries++;
    }

    // Update average recovery time
    this.metrics.averageRecoveryTime = 
      (this.metrics.averageRecoveryTime * (this.metrics.totalRecoveries - 1) + result.duration) / 
      this.metrics.totalRecoveries;

    // Update strategy usage
    this.metrics.strategiesUsed[result.strategy] = 
      (this.metrics.strategiesUsed[result.strategy] || 0) + 1;

    // Update success rate
    this.metrics.recentSuccessRate = this.metrics.successfulRecoveries / this.metrics.totalRecoveries;

    // Update most effective strategy
    this.updateMostEffectiveStrategy();

    // Add trend data point (hourly)
    this.addTrendDataPoint();
  }

  /**
   * Update most effective strategy
   */
  private updateMostEffectiveStrategy(): void {
    let maxEffectiveness = 0;
    let mostEffective: RecoveryStrategy | null = null;

    for (const [strategy, count] of Object.entries(this.metrics.strategiesUsed)) {
      // Calculate effectiveness based on usage and success rate
      // TODO: Track success rate per strategy
      const effectiveness = count; // Simplified for now
      
      if (effectiveness > maxEffectiveness) {
        maxEffectiveness = effectiveness;
        mostEffective = strategy as RecoveryStrategy;
      }
    }

    this.metrics.mostEffectiveStrategy = mostEffective;
  }

  /**
   * Add trend data point
   */
  private addTrendDataPoint(): void {
    const now = Date.now();
    const hourStart = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
    
    // Check if we already have data for this hour
    const existingTrend = this.metrics.trendsOverTime.find(trend => trend.timestamp === hourStart);
    
    if (existingTrend) {
      existingTrend.successRate = this.metrics.recentSuccessRate;
      existingTrend.averageTime = this.metrics.averageRecoveryTime;
    } else {
      this.metrics.trendsOverTime.push({
        timestamp: hourStart,
        successRate: this.metrics.recentSuccessRate,
        averageTime: this.metrics.averageRecoveryTime
      });
    }

    // Keep only last 24 hours of trend data
    const cutoff = now - (24 * 60 * 60 * 1000);
    this.metrics.trendsOverTime = this.metrics.trendsOverTime.filter(
      trend => trend.timestamp > cutoff
    );
  }

  /**
   * Add recovery plan
   */
  public addRecoveryPlan(plan: RecoveryPlan): void {
    this.plans.set(plan.id, plan);
    
    secureLog('info', 'Recovery plan added', {
      plan_id: plan.id,
      error_code: plan.errorCode,
      priority: plan.priority,
      strategies_count: plan.strategies.length
    });
  }

  /**
   * Remove recovery plan
   */
  public removeRecoveryPlan(planId: string): boolean {
    const removed = this.plans.delete(planId);
    
    if (removed) {
      secureLog('info', 'Recovery plan removed', {
        plan_id: planId
      });
    }
    
    return removed;
  }

  /**
   * Get recovery plan
   */
  public getRecoveryPlan(planId: string): RecoveryPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Get all recovery plans
   */
  public getRecoveryPlans(): RecoveryPlan[] {
    return Array.from(this.plans.values());
  }

  /**
   * Get active executions
   */
  public getActiveExecutions(): RecoveryExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * Get completed executions
   */
  public getCompletedExecutions(limit?: number): RecoveryExecution[] {
    const executions = [...this.completedExecutions].reverse(); // Most recent first
    return limit ? executions.slice(0, limit) : executions;
  }

  /**
   * Get recovery metrics
   */
  public getMetrics(): RecoveryMetrics {
    return { ...this.metrics };
  }

  /**
   * Cancel active recovery
   */
  public cancelRecovery(executionId: string): boolean {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.status = 'cancelled';
      execution.endTime = Date.now();
      
      secureLog('info', 'Recovery execution cancelled', {
        execution_id: executionId,
        plan_id: execution.planId
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Clear completed executions
   */
  public clearCompletedExecutions(): void {
    this.completedExecutions = [];
    secureLog('info', 'Completed recovery executions cleared');
  }

  /**
   * Get recovery statistics
   */
  public getStatistics() {
    return {
      plans: {
        total: this.plans.size,
        byPriority: Array.from(this.plans.values()).reduce((acc, plan) => {
          acc[plan.priority] = (acc[plan.priority] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      },
      executions: {
        active: this.activeExecutions.size,
        completed: this.completedExecutions.length,
        recentSuccess: this.completedExecutions.slice(-10).filter(e => e.result?.success).length
      },
      metrics: this.metrics
    };
  }
}
/**
 * Circuit Breaker Implementation
 * 
 * Production-grade circuit breaker with comprehensive failure tracking,
 * automatic recovery, and intelligent request routing.
 */

import { CircuitBreakerStateManager, CircuitBreakerConfig, CircuitBreakerState } from './circuit-breaker-state.js';
import { CircuitBreakerError } from '../errors/resilience-errors.js';
import { secureLog, sanitizeForLogging } from '../../security.js';

export interface CircuitBreakerOptions extends CircuitBreakerConfig {
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState, reason: string) => void;
  onRequestRejected?: (circuitName: string) => void;
  onRequestSuccess?: (circuitName: string, duration: number) => void;
  onRequestFailure?: (circuitName: string, duration: number, error: any) => void;
  fallback?: () => Promise<any>;
  requestTimeout?: number;
}

export interface CircuitBreakerExecutionResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  duration: number;
  circuitState: CircuitBreakerState;
  executedViaFallback: boolean;
  metadata: Record<string, any>;
}

/**
 * Circuit breaker implementation with automatic failure detection and recovery
 */
export class CircuitBreaker {
  private stateManager: CircuitBreakerStateManager;
  private options: CircuitBreakerOptions;
  private requestCounter: number = 0;

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
    this.stateManager = new CircuitBreakerStateManager(options);
    
    secureLog('info', 'Circuit breaker created', {
      name: options.name,
      failure_threshold: options.failureThreshold,
      success_threshold: options.successThreshold,
      timeout: options.timeout
    });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  public async execute<T>(
    operation: () => Promise<T>,
    context?: Record<string, any>
  ): Promise<CircuitBreakerExecutionResult<T>> {
    const requestId = ++this.requestCounter;
    const startTime = Date.now();
    const operationContext = {
      request_id: requestId,
      circuit_name: this.options.name,
      ...context
    };

    secureLog('debug', 'Circuit breaker execution requested', {
      ...operationContext,
      circuit_state: this.stateManager.getState(),
      can_execute: this.stateManager.canExecute()
    });

    // Check if request can proceed
    if (!this.stateManager.canExecute()) {
      this.stateManager.recordRejection();
      
      // Trigger rejection callback
      if (this.options.onRequestRejected) {
        this.options.onRequestRejected(this.options.name);
      }

      // Try fallback if available
      if (this.options.fallback) {
        secureLog('debug', 'Circuit breaker executing fallback', operationContext);
        
        try {
          const fallbackResult = await this.executeFallback();
          const duration = Date.now() - startTime;
          
          return {
            success: true,
            result: fallbackResult,
            duration,
            circuitState: this.stateManager.getState(),
            executedViaFallback: true,
            metadata: { ...operationContext, fallback_used: true }
          };
        } catch (fallbackError) {
          const duration = Date.now() - startTime;
          
          secureLog('error', 'Circuit breaker fallback failed', {
            ...operationContext,
            fallback_error: fallbackError instanceof Error ? fallbackError.message : 'unknown',
            duration
          });
          
          return {
            success: false,
            error: new CircuitBreakerError(
              'Circuit is open and fallback failed',
              this.options.name,
              this.stateManager.getState(),
              operationContext,
              fallbackError instanceof Error ? fallbackError : undefined
            ),
            duration,
            circuitState: this.stateManager.getState(),
            executedViaFallback: true,
            metadata: { ...operationContext, fallback_failed: true }
          };
        }
      }

      // No fallback available, return circuit breaker error
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: new CircuitBreakerError(
          'Circuit breaker is open',
          this.options.name,
          this.stateManager.getState(),
          operationContext
        ),
        duration,
        circuitState: this.stateManager.getState(),
        executedViaFallback: false,
        metadata: { ...operationContext, circuit_open: true }
      };
    }

    // Record request start
    this.stateManager.recordRequestStart();

    try {
      secureLog('debug', 'Circuit breaker executing operation', operationContext);

      // Execute operation with timeout if configured
      let result: T;
      if (this.options.requestTimeout) {
        result = await this.executeWithTimeout(operation, this.options.requestTimeout);
      } else {
        result = await operation();
      }

      const duration = Date.now() - startTime;
      
      // Record success
      this.stateManager.recordSuccess(duration);
      
      // Trigger success callback
      if (this.options.onRequestSuccess) {
        this.options.onRequestSuccess(this.options.name, duration);
      }

      secureLog('debug', 'Circuit breaker operation succeeded', {
        ...operationContext,
        duration,
        circuit_state: this.stateManager.getState()
      });

      return {
        success: true,
        result,
        duration,
        circuitState: this.stateManager.getState(),
        executedViaFallback: false,
        metadata: { ...operationContext, operation_success: true }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const isTimeout = error instanceof Error && error.message.includes('timeout');
      
      // Record failure or timeout
      if (isTimeout) {
        this.stateManager.recordTimeout(duration);
      } else {
        this.stateManager.recordFailure(
          duration, 
          error instanceof Error ? error.message : 'unknown'
        );
      }
      
      // Trigger failure callback
      if (this.options.onRequestFailure) {
        this.options.onRequestFailure(this.options.name, duration, error);
      }

      secureLog('warn', 'Circuit breaker operation failed', {
        ...operationContext,
        duration,
        circuit_state: this.stateManager.getState(),
        error_message: error instanceof Error ? error.message : 'unknown',
        is_timeout: isTimeout
      });

      // Try fallback on failure if available
      if (this.options.fallback) {
        secureLog('debug', 'Circuit breaker attempting fallback after failure', operationContext);
        
        try {
          const fallbackResult = await this.executeFallback();
          
          return {
            success: true,
            result: fallbackResult,
            duration: Date.now() - startTime,
            circuitState: this.stateManager.getState(),
            executedViaFallback: true,
            metadata: { 
              ...operationContext, 
              original_error: error instanceof Error ? error.message : 'unknown',
              fallback_after_failure: true 
            }
          };
        } catch (fallbackError) {
          secureLog('error', 'Circuit breaker fallback failed after operation failure', {
            ...operationContext,
            original_error: error instanceof Error ? error.message : 'unknown',
            fallback_error: fallbackError instanceof Error ? fallbackError.message : 'unknown'
          });
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
        circuitState: this.stateManager.getState(),
        executedViaFallback: false,
        metadata: { ...operationContext, operation_failed: true, is_timeout: isTimeout }
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
   * Execute fallback with its own timeout protection
   */
  private async executeFallback(): Promise<any> {
    if (!this.options.fallback) {
      throw new Error('No fallback configured');
    }

    const fallbackTimeout = this.options.requestTimeout || 5000; // Default 5s fallback timeout
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Fallback timeout after ${fallbackTimeout}ms`));
      }, fallbackTimeout);

      this.options.fallback!()
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
   * Get current state
   */
  public getState(): CircuitBreakerState {
    return this.stateManager.getState();
  }

  /**
   * Get circuit breaker metrics
   */
  public getMetrics() {
    return {
      name: this.options.name,
      ...this.stateManager.getStateInfo(),
      healthStatus: this.stateManager.getHealthStatus()
    };
  }

  /**
   * Get circuit breaker statistics
   */
  public getStatistics() {
    return {
      name: this.options.name,
      state: this.stateManager.getState(),
      stats: this.stateManager.getStats(),
      config: this.stateManager.getConfig(),
      recentHistory: this.stateManager.getStateHistory(10),
      health: this.stateManager.getHealthStatus()
    };
  }

  /**
   * Check if circuit breaker is healthy
   */
  public isHealthy(): boolean {
    const health = this.stateManager.getHealthStatus();
    return health.health === 'healthy';
  }

  /**
   * Check if circuit can execute requests
   */
  public canExecute(): boolean {
    return this.stateManager.canExecute();
  }

  /**
   * Force circuit state (for manual intervention)
   */
  public forceState(state: CircuitBreakerState, reason?: string): void {
    const currentState = this.stateManager.getState();
    
    secureLog('warn', 'Circuit breaker state forced', {
      circuit_name: this.options.name,
      from_state: currentState,
      to_state: state,
      reason: reason || 'manual_override'
    });

    this.stateManager.forceState(state, reason);
    
    // Trigger state change callback
    if (this.options.onStateChange) {
      this.options.onStateChange(currentState, state, reason || 'manual_override');
    }
  }

  /**
   * Reset circuit breaker to initial state
   */
  public reset(): void {
    secureLog('info', 'Circuit breaker reset', {
      circuit_name: this.options.name,
      previous_state: this.stateManager.getState()
    });

    const currentState = this.stateManager.getState();
    this.stateManager.reset();
    
    // Trigger state change callback
    if (this.options.onStateChange) {
      this.options.onStateChange(currentState, 'closed', 'reset');
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<CircuitBreakerOptions>): void {
    this.options = { ...this.options, ...updates };
    
    secureLog('info', 'Circuit breaker configuration updated', {
      circuit_name: this.options.name,
      updates: sanitizeForLogging(updates)
    });
  }

  /**
   * Get current configuration
   */
  public getConfig(): CircuitBreakerOptions {
    return { ...this.options };
  }

  /**
   * Set state change callback
   */
  public onStateChange(callback: (from: CircuitBreakerState, to: CircuitBreakerState, reason: string) => void): void {
    this.options.onStateChange = callback;
  }

  /**
   * Set request rejected callback
   */
  public onRequestRejected(callback: (circuitName: string) => void): void {
    this.options.onRequestRejected = callback;
  }

  /**
   * Set request success callback
   */
  public onRequestSuccess(callback: (circuitName: string, duration: number) => void): void {
    this.options.onRequestSuccess = callback;
  }

  /**
   * Set request failure callback
   */
  public onRequestFailure(callback: (circuitName: string, duration: number, error: any) => void): void {
    this.options.onRequestFailure = callback;
  }

  /**
   * Set fallback function
   */
  public setFallback(fallback: () => Promise<any>): void {
    this.options.fallback = fallback;
    
    secureLog('info', 'Circuit breaker fallback updated', {
      circuit_name: this.options.name,
      has_fallback: true
    });
  }

  /**
   * Remove fallback function
   */
  public removeFallback(): void {
    this.options.fallback = undefined;
    
    secureLog('info', 'Circuit breaker fallback removed', {
      circuit_name: this.options.name,
      has_fallback: false
    });
  }

  /**
   * Test circuit breaker with a dummy operation
   */
  public async test(shouldFail: boolean = false): Promise<CircuitBreakerExecutionResult<string>> {
    const testOperation = async (): Promise<string> => {
      if (shouldFail) {
        throw new Error('Test operation failure');
      }
      return 'test_success';
    };

    return this.execute(testOperation, { test_operation: true, should_fail: shouldFail });
  }

  /**
   * Get name
   */
  public getName(): string {
    return this.options.name;
  }
}
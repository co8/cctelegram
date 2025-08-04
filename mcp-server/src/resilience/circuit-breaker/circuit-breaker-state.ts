/**
 * Circuit Breaker State Management
 * 
 * State machine implementation for circuit breaker with transitions,
 * metrics tracking, and event handling.
 */

import { secureLog } from '../../security.js';

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface StateTransition {
  from: CircuitBreakerState;
  to: CircuitBreakerState;
  reason: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface CircuitBreakerStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rejectedRequests: number;
  timeoutRequests: number;
  averageResponseTime: number;
  lastRequestTime: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;
  successThreshold: number;
  timeout: number; // Circuit open duration in ms
  monitoringWindow: number; // Time window for failure rate calculation
  maxConcurrentRequests?: number;
  volumeThreshold?: number; // Minimum requests before circuit can trip
}

/**
 * Circuit breaker state machine with comprehensive tracking
 */
export class CircuitBreakerStateManager {
  private state: CircuitBreakerState = 'closed';
  private config: CircuitBreakerConfig;
  private stats: CircuitBreakerStats;
  private stateHistory: StateTransition[] = [];
  private lastStateChange: number = Date.now();
  private halfOpenStartTime: number = 0;
  private activeRequests: number = 0;
  private recentRequests: Array<{ timestamp: number; success: boolean; duration: number }> = [];
  private maxHistorySize = 1000;
  private maxRecentRequests = 100;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    this.stats = this.initializeStats();
    
    secureLog('info', 'Circuit breaker state manager initialized', {
      name: config.name,
      initial_state: this.state,
      failure_threshold: config.failureThreshold,
      success_threshold: config.successThreshold,
      timeout: config.timeout
    });
  }

  /**
   * Initialize statistics
   */
  private initializeStats(): CircuitBreakerStats {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      timeoutRequests: 0,
      averageResponseTime: 0,
      lastRequestTime: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0
    };
  }

  /**
   * Check if request can proceed
   */
  public canExecute(): boolean {
    const now = Date.now();
    
    switch (this.state) {
      case 'closed':
        // Allow all requests
        return this.checkConcurrencyLimit();
      
      case 'open':
        // Check if timeout has elapsed
        if (now - this.lastStateChange >= this.config.timeout) {
          this.transitionTo('half-open', 'timeout_elapsed');
          return this.checkConcurrencyLimit();
        }
        return false;
      
      case 'half-open':
        // Allow limited requests to test if service has recovered
        return this.checkConcurrencyLimit() && this.activeRequests === 0;
      
      default:
        return false;
    }
  }

  /**
   * Check concurrency limits
   */
  private checkConcurrencyLimit(): boolean {
    if (this.config.maxConcurrentRequests && 
        this.activeRequests >= this.config.maxConcurrentRequests) {
      return false;
    }
    return true;
  }

  /**
   * Record request start
   */
  public recordRequestStart(): void {
    this.activeRequests++;
    this.stats.totalRequests++;
    this.stats.lastRequestTime = Date.now();
  }

  /**
   * Record request success
   */
  public recordSuccess(duration: number): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.stats.successfulRequests++;
    this.stats.lastSuccessTime = Date.now();
    this.stats.consecutiveSuccesses++;
    this.stats.consecutiveFailures = 0;
    
    this.updateAverageResponseTime(duration);
    this.addRecentRequest(true, duration);
    
    // State transitions based on success
    switch (this.state) {
      case 'half-open':
        if (this.stats.consecutiveSuccesses >= this.config.successThreshold) {
          this.transitionTo('closed', 'success_threshold_reached');
        }
        break;
      
      case 'open':
        // This shouldn't happen, but handle gracefully
        secureLog('warn', 'Success recorded while circuit is open', {
          circuit_name: this.config.name,
          state: this.state
        });
        break;
    }

    secureLog('debug', 'Circuit breaker success recorded', {
      circuit_name: this.config.name,
      state: this.state,
      consecutive_successes: this.stats.consecutiveSuccesses,
      duration
    });
  }

  /**
   * Record request failure
   */
  public recordFailure(duration: number, error?: string): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.stats.failedRequests++;
    this.stats.lastFailureTime = Date.now();
    this.stats.consecutiveFailures++;
    this.stats.consecutiveSuccesses = 0;
    
    this.updateAverageResponseTime(duration);
    this.addRecentRequest(false, duration);
    
    // State transitions based on failure
    switch (this.state) {
      case 'closed':
        if (this.shouldOpenCircuit()) {
          this.transitionTo('open', 'failure_threshold_exceeded', { error });
        }
        break;
      
      case 'half-open':
        this.transitionTo('open', 'half_open_failure', { error });
        break;
    }

    secureLog('debug', 'Circuit breaker failure recorded', {
      circuit_name: this.config.name,
      state: this.state,
      consecutive_failures: this.stats.consecutiveFailures,
      duration,
      error
    });
  }

  /**
   * Record request timeout
   */
  public recordTimeout(duration: number): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.stats.timeoutRequests++;
    this.stats.failedRequests++; // Timeouts count as failures
    this.stats.consecutiveFailures++;
    this.stats.consecutiveSuccesses = 0;
    
    this.updateAverageResponseTime(duration);
    this.addRecentRequest(false, duration);
    
    // Timeouts are treated as failures for state transitions
    this.recordFailure(duration, 'timeout');
  }

  /**
   * Record request rejection (circuit open)
   */
  public recordRejection(): void {
    this.stats.rejectedRequests++;
    
    secureLog('debug', 'Circuit breaker request rejected', {
      circuit_name: this.config.name,
      state: this.state,
      total_rejections: this.stats.rejectedRequests
    });
  }

  /**
   * Determine if circuit should open
   */
  private shouldOpenCircuit(): boolean {
    // Must have minimum volume of requests
    if (this.config.volumeThreshold && 
        this.stats.totalRequests < this.config.volumeThreshold) {
      return false;
    }

    // Check consecutive failures
    if (this.stats.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }

    // Check failure rate within monitoring window
    const failureRate = this.calculateRecentFailureRate();
    const failureRateThreshold = this.config.failureThreshold / 10; // Convert to percentage
    
    return failureRate >= failureRateThreshold;
  }

  /**
   * Calculate recent failure rate within monitoring window
   */
  private calculateRecentFailureRate(): number {
    const now = Date.now();
    const windowStart = now - this.config.monitoringWindow;
    
    const recentRequests = this.recentRequests.filter(req => req.timestamp >= windowStart);
    
    if (recentRequests.length === 0) {
      return 0;
    }
    
    const failures = recentRequests.filter(req => !req.success).length;
    return failures / recentRequests.length;
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitBreakerState, reason: string, metadata?: Record<string, any>): void {
    const oldState = this.state;
    const now = Date.now();
    
    this.state = newState;
    this.lastStateChange = now;
    
    if (newState === 'half-open') {
      this.halfOpenStartTime = now;
    }
    
    // Record transition
    const transition: StateTransition = {
      from: oldState,
      to: newState,
      reason,
      timestamp: now,
      metadata
    };
    
    this.stateHistory.push(transition);
    
    // Trim history if needed
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory = this.stateHistory.slice(-this.maxHistorySize);
    }
    
    secureLog('info', 'Circuit breaker state transition', {
      circuit_name: this.config.name,
      from_state: oldState,
      to_state: newState,
      reason,
      consecutive_failures: this.stats.consecutiveFailures,
      consecutive_successes: this.stats.consecutiveSuccesses,
      metadata
    });
  }

  /**
   * Update average response time
   */
  private updateAverageResponseTime(duration: number): void {
    const totalResponses = this.stats.successfulRequests + this.stats.failedRequests;
    this.stats.averageResponseTime = 
      (this.stats.averageResponseTime * (totalResponses - 1) + duration) / totalResponses;
  }

  /**
   * Add request to recent requests buffer
   */
  private addRecentRequest(success: boolean, duration: number): void {
    this.recentRequests.push({
      timestamp: Date.now(),
      success,
      duration
    });
    
    // Trim if needed
    if (this.recentRequests.length > this.maxRecentRequests) {
      this.recentRequests = this.recentRequests.slice(-this.maxRecentRequests);
    }
    
    // Also clean old requests outside monitoring window
    const windowStart = Date.now() - this.config.monitoringWindow;
    this.recentRequests = this.recentRequests.filter(req => req.timestamp >= windowStart);
  }

  /**
   * Get current state
   */
  public getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get configuration
   */
  public getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Get current statistics
   */
  public getStats(): CircuitBreakerStats {
    return { ...this.stats };
  }

  /**
   * Get state history
   */
  public getStateHistory(limit?: number): StateTransition[] {
    const history = [...this.stateHistory];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get detailed state information
   */
  public getStateInfo() {
    const now = Date.now();
    const timeInCurrentState = now - this.lastStateChange;
    const timeUntilNextTransition = this.state === 'open' 
      ? Math.max(0, this.config.timeout - timeInCurrentState)
      : null;
    
    return {
      state: this.state,
      timeInCurrentState,
      timeUntilNextTransition,
      activeRequests: this.activeRequests,
      recentFailureRate: this.calculateRecentFailureRate(),
      canExecute: this.canExecute(),
      stats: this.getStats(),
      config: this.getConfig()
    };
  }

  /**
   * Force state transition (for testing or manual intervention)
   */
  public forceState(newState: CircuitBreakerState, reason: string = 'manual_override'): void {
    secureLog('warn', 'Circuit breaker state forced', {
      circuit_name: this.config.name,
      from_state: this.state,
      to_state: newState,
      reason
    });
    
    this.transitionTo(newState, reason, { manual: true });
  }

  /**
   * Reset circuit breaker to initial state
   */
  public reset(): void {
    secureLog('info', 'Circuit breaker reset', {
      circuit_name: this.config.name,
      previous_state: this.state
    });
    
    this.state = 'closed';
    this.stats = this.initializeStats();
    this.lastStateChange = Date.now();
    this.halfOpenStartTime = 0;
    this.activeRequests = 0;
    this.recentRequests = [];
    
    // Keep state history but add reset event
    this.stateHistory.push({
      from: this.state,
      to: 'closed',
      reason: 'reset',
      timestamp: Date.now(),
      metadata: { manual_reset: true }
    });
  }

  /**
   * Get health status
   */
  public getHealthStatus() {
    const recentFailureRate = this.calculateRecentFailureRate();
    const timeInCurrentState = Date.now() - this.lastStateChange;
    
    let health: 'healthy' | 'degraded' | 'unhealthy';
    
    if (this.state === 'closed' && recentFailureRate < 0.1) {
      health = 'healthy';
    } else if (this.state === 'half-open' || (this.state === 'closed' && recentFailureRate < 0.5)) {
      health = 'degraded';
    } else {
      health = 'unhealthy';
    }
    
    return {
      health,
      state: this.state,
      failureRate: recentFailureRate,
      consecutiveFailures: this.stats.consecutiveFailures,
      timeInCurrentState,
      activeRequests: this.activeRequests
    };
  }
}
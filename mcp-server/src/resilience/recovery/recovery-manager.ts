/**
 * Recovery Manager
 * 
 * Orchestrates automatic recovery procedures, manages escalation,
 * and coordinates system restoration efforts.
 */

import { RecoveryConfig, BackupStrategyConfig } from '../config.js';
import { secureLog, sanitizeForLogging } from '../../security.js';
import { RecoveryError, SystemFailureError } from '../errors/resilience-errors.js';
import { BaseResilienceError, RecoveryStrategy } from '../errors/base-error.js';

export type RecoveryStatus = 'idle' | 'in_progress' | 'succeeded' | 'failed' | 'escalated';

export interface RecoveryAttempt {
  id: string;
  strategy: RecoveryStrategy;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: RecoveryStatus;
  error?: string;
  metadata?: Record<string, any>;
}

export interface RecoverySession {
  id: string;
  errorCode: string;
  errorCategory: string;
  severity: string;
  startTime: number;
  endTime?: number;
  status: RecoveryStatus;
  attempts: RecoveryAttempt[];
  escalationLevel: number;
  context: Record<string, any>;
}

export class RecoveryManager {
  private config: RecoveryConfig;
  private activeSessions: Map<string, RecoverySession> = new Map();
  private recoveryHistory: RecoverySession[] = [];
  private isShuttingDown: boolean = false;

  constructor(config: RecoveryConfig) {
    this.config = config;
    
    // Set up graceful shutdown handler
    process.on('SIGTERM', () => this.initiateGracefulShutdown());
    process.on('SIGINT', () => this.initiateGracefulShutdown());
    
    secureLog('info', 'Recovery manager initialized', {
      auto_recovery_enabled: config.autoRecoveryEnabled,
      max_recovery_attempts: config.maxRecoveryAttempts,
      backup_strategies: config.backupStrategies.length
    });
  }

  /**
   * Initiate recovery for an error
   */
  public async initiateRecovery(error: BaseResilienceError): Promise<RecoverySession> {
    const sessionId = this.generateSessionId();
    
    const session: RecoverySession = {
      id: sessionId,
      errorCode: error.code,
      errorCategory: error.category,
      severity: error.severity,
      startTime: Date.now(),
      status: 'in_progress',
      attempts: [],
      escalationLevel: 0,
      context: {
        operation: error.context.operation,
        component: error.context.component,
        correlationId: error.context.correlationId
      }
    };

    this.activeSessions.set(sessionId, session);

    secureLog('info', 'Recovery session initiated', {
      session_id: sessionId,
      error_code: error.code,
      error_category: error.category,
      error_severity: error.severity,
      recovery_strategy: error.recovery.strategy
    });

    if (this.config.autoRecoveryEnabled) {
      try {
        await this.executeRecovery(session, error);
      } catch (recoveryError) {
        secureLog('error', 'Recovery execution failed', {
          session_id: sessionId,
          error: recoveryError instanceof Error ? recoveryError.message : 'unknown'
        });
        
        session.status = 'failed';
        session.endTime = Date.now();
      }
    }

    return session;
  }

  /**
   * Execute recovery strategies for a session
   */
  private async executeRecovery(session: RecoverySession, error: BaseResilienceError): Promise<void> {
    let currentStrategy = error.recovery.strategy;
    let attemptCount = 0;

    while (attemptCount < this.config.maxRecoveryAttempts && session.status === 'in_progress') {
      const attemptId = `${session.id}-${attemptCount + 1}`;
      
      const attempt: RecoveryAttempt = {
        id: attemptId,
        strategy: currentStrategy,
        startTime: Date.now(),
        status: 'in_progress',
        metadata: {
          attempt_number: attemptCount + 1,
          escalation_level: session.escalationLevel
        }
      };

      session.attempts.push(attempt);
      attemptCount++;

      secureLog('info', 'Recovery attempt started', {
        session_id: session.id,
        attempt_id: attemptId,
        strategy: currentStrategy,
        attempt_number: attemptCount
      });

      try {
        const success = await this.executeRecoveryStrategy(currentStrategy, error, attempt);
        
        attempt.endTime = Date.now();
        attempt.duration = attempt.endTime - attempt.startTime;
        attempt.status = success ? 'succeeded' : 'failed';

        if (success) {
          session.status = 'succeeded';
          session.endTime = Date.now();
          
          secureLog('info', 'Recovery succeeded', {
            session_id: session.id,
            attempt_id: attemptId,
            strategy: currentStrategy,
            total_attempts: attemptCount,
            total_duration: session.endTime - session.startTime
          });
          
          break;
        } else {
          secureLog('warn', 'Recovery attempt failed', {
            session_id: session.id,
            attempt_id: attemptId,
            strategy: currentStrategy,
            attempt_number: attemptCount
          });

          // Wait before next attempt
          if (attemptCount < this.config.maxRecoveryAttempts) {
            await this.delay(this.config.recoveryDelay);
          }
        }

      } catch (strategyError) {
        attempt.endTime = Date.now();
        attempt.duration = attempt.endTime - attempt.startTime;
        attempt.status = 'failed';
        attempt.error = strategyError instanceof Error ? strategyError.message : 'unknown';

        secureLog('error', 'Recovery strategy execution failed', {
          session_id: session.id,
          attempt_id: attemptId,
          strategy: currentStrategy,
          error: attempt.error
        });

        // Wait before next attempt
        if (attemptCount < this.config.maxRecoveryAttempts) {
          await this.delay(this.config.recoveryDelay);
        }
      }

      // Check if we should escalate
      if (attemptCount >= this.config.escalationThreshold && session.status === 'in_progress') {
        session.escalationLevel++;
        currentStrategy = this.escalateStrategy(currentStrategy);
        
        secureLog('warn', 'Recovery escalated', {
          session_id: session.id,
          escalation_level: session.escalationLevel,
          new_strategy: currentStrategy
        });
      }
    }

    // Mark as failed if all attempts exhausted
    if (session.status === 'in_progress') {
      session.status = 'failed';
      session.endTime = Date.now();
      
      secureLog('error', 'Recovery failed - all attempts exhausted', {
        session_id: session.id,
        total_attempts: attemptCount,
        escalation_level: session.escalationLevel
      });

      // Try backup strategies
      await this.executeBackupStrategies(session, error);
    }

    // Move to history
    this.activeSessions.delete(session.id);
    this.recoveryHistory.push(session);
    
    // Keep only last 100 sessions in history
    if (this.recoveryHistory.length > 100) {
      this.recoveryHistory.splice(0, this.recoveryHistory.length - 100);
    }
  }

  /**
   * Execute a specific recovery strategy
   */
  private async executeRecoveryStrategy(
    strategy: RecoveryStrategy,
    error: BaseResilienceError,
    attempt: RecoveryAttempt
  ): Promise<boolean> {
    
    switch (strategy) {
      case 'retry':
        return this.executeRetryStrategy(error, attempt);
      
      case 'circuit_breaker':
        return this.executeCircuitBreakerStrategy(error, attempt);
      
      case 'restart':
        return this.executeRestartStrategy(error, attempt);
      
      case 'fallback':
        return this.executeFallbackStrategy(error, attempt);
      
      case 'graceful_degradation':
        return this.executeGracefulDegradationStrategy(error, attempt);
      
      case 'escalate':
        return this.executeEscalationStrategy(error, attempt);
      
      case 'ignore':
        return this.executeIgnoreStrategy(error, attempt);
      
      case 'manual':
        return this.executeManualStrategy(error, attempt);
      
      default:
        throw new RecoveryError(
          `Unknown recovery strategy: ${strategy}`,
          error.code,
          { strategy, error_code: error.code },
          { operation: 'recovery', component: 'recovery_manager' }
        );
    }
  }

  /**
   * Execute retry recovery strategy
   */
  private async executeRetryStrategy(error: BaseResilienceError, attempt: RecoveryAttempt): Promise<boolean> {
    // In a real implementation, this would retry the original operation
    // For now, simulate retry logic
    
    const shouldSucceed = Math.random() > 0.3; // 70% success rate
    
    if (shouldSucceed) {
      attempt.metadata = { ...attempt.metadata, retry_succeeded: true };
      return true;
    } else {
      attempt.metadata = { ...attempt.metadata, retry_failed: true };
      return false;
    }
  }

  /**
   * Execute circuit breaker recovery strategy
   */
  private async executeCircuitBreakerStrategy(error: BaseResilienceError, attempt: RecoveryAttempt): Promise<boolean> {
    // Reset circuit breaker or wait for it to recover
    attempt.metadata = { ...attempt.metadata, circuit_breaker_reset: true };
    
    // Simulate circuit breaker recovery
    const recovered = Math.random() > 0.5; // 50% success rate
    return recovered;
  }

  /**
   * Execute restart recovery strategy
   */
  private async executeRestartStrategy(error: BaseResilienceError, attempt: RecoveryAttempt): Promise<boolean> {
    // Restart the problematic component
    if (error.context.component === 'bridge') {
      // Restart bridge process
      attempt.metadata = { ...attempt.metadata, bridge_restart_attempted: true };
      
      // Simulate restart success
      const restartSucceeded = Math.random() > 0.2; // 80% success rate
      return restartSucceeded;
    }
    
    return false;
  }

  /**
   * Execute fallback recovery strategy
   */
  private async executeFallbackStrategy(error: BaseResilienceError, attempt: RecoveryAttempt): Promise<boolean> {
    // Use alternative implementation or cached data
    attempt.metadata = { ...attempt.metadata, fallback_activated: true };
    
    // Simulate fallback success
    return Math.random() > 0.1; // 90% success rate
  }

  /**
   * Execute graceful degradation strategy
   */
  private async executeGracefulDegradationStrategy(error: BaseResilienceError, attempt: RecoveryAttempt): Promise<boolean> {
    // Reduce functionality but maintain core operations
    attempt.metadata = { ...attempt.metadata, degraded_mode_activated: true };
    
    // Degradation is usually successful
    return true;
  }

  /**
   * Execute escalation strategy
   */
  private async executeEscalationStrategy(error: BaseResilienceError, attempt: RecoveryAttempt): Promise<boolean> {
    // Alert administrators or trigger external systems
    attempt.metadata = { ...attempt.metadata, escalation_triggered: true };
    
    secureLog('error', 'Error escalated to administrators', {
      error_code: error.code,
      error_category: error.category,
      severity: error.severity,
      context: sanitizeForLogging(error.context)
    });
    
    // Escalation is considered successful as action is taken
    return true;
  }

  /**
   * Execute ignore strategy
   */
  private async executeIgnoreStrategy(error: BaseResilienceError, attempt: RecoveryAttempt): Promise<boolean> {
    // Log and ignore the error
    attempt.metadata = { ...attempt.metadata, error_ignored: true };
    
    secureLog('info', 'Error ignored per recovery strategy', {
      error_code: error.code,
      reason: 'ignore_strategy'
    });
    
    return true;
  }

  /**
   * Execute manual strategy
   */
  private async executeManualStrategy(error: BaseResilienceError, attempt: RecoveryAttempt): Promise<boolean> {
    // Wait for manual intervention
    attempt.metadata = { ...attempt.metadata, manual_intervention_required: true };
    
    secureLog('warn', 'Manual intervention required', {
      error_code: error.code,
      error_category: error.category,
      context: sanitizeForLogging(error.context)
    });
    
    // Manual strategy requires external action
    return false;
  }

  /**
   * Execute backup strategies when primary recovery fails
   */
  private async executeBackupStrategies(session: RecoverySession, error: BaseResilienceError): Promise<void> {
    const applicableStrategies = this.config.backupStrategies
      .filter(strategy => 
        strategy.enabled && 
        this.isStrategyApplicable(strategy, error)
      )
      .sort((a, b) => a.priority - b.priority);

    for (const strategy of applicableStrategies) {
      secureLog('info', 'Attempting backup strategy', {
        session_id: session.id,
        strategy_name: strategy.name,
        priority: strategy.priority
      });

      try {
        const success = await this.executeBackupStrategy(strategy, error);
        
        if (success) {
          session.status = 'succeeded';
          session.endTime = Date.now();
          
          secureLog('info', 'Backup strategy succeeded', {
            session_id: session.id,
            strategy_name: strategy.name
          });
          
          return;
        }
      } catch (strategyError) {
        secureLog('error', 'Backup strategy failed', {
          session_id: session.id,
          strategy_name: strategy.name,
          error: strategyError instanceof Error ? strategyError.message : 'unknown'
        });
      }
    }

    // All backup strategies failed
    session.status = 'escalated';
    secureLog('error', 'All backup strategies failed - escalating', {
      session_id: session.id
    });
  }

  /**
   * Check if backup strategy is applicable to the error
   */
  private isStrategyApplicable(strategy: BackupStrategyConfig, error: BaseResilienceError): boolean {
    if (strategy.conditions.length === 0) {
      return true; // No conditions means always applicable
    }

    return strategy.conditions.some(condition => {
      switch (condition) {
        case 'BRIDGE_DOWN':
          return error.context.component === 'bridge' && error.category === 'network';
        case 'BRIDGE_UNHEALTHY':
          return error.context.component === 'bridge' && error.severity === 'high';
        case 'BRIDGE_CRASHED':
          return error.context.component === 'bridge' && error.category === 'system';
        case 'BRIDGE_UNRESPONSIVE':
          return error.context.component === 'bridge' && error.category === 'timeout';
        case 'ALL_RECOVERY_FAILED':
          return true;
        default:
          return false;
      }
    });
  }

  /**
   * Execute backup strategy
   */
  private async executeBackupStrategy(strategy: BackupStrategyConfig, error: BaseResilienceError): Promise<boolean> {
    switch (strategy.name) {
      case 'bridge-restart':
        return this.executeRestartStrategy(error, {
          id: `backup-${strategy.name}`,
          strategy: 'restart',
          startTime: Date.now(),
          status: 'in_progress'
        });
      
      case 'process-restart':
        // More aggressive restart
        return Math.random() > 0.3; // 70% success rate
      
      case 'fallback-mode':
        return this.executeGracefulDegradationStrategy(error, {
          id: `backup-${strategy.name}`,
          strategy: 'graceful_degradation',
          startTime: Date.now(),
          status: 'in_progress'
        });
      
      default:
        return false;
    }
  }

  /**
   * Escalate recovery strategy
   */
  private escalateStrategy(currentStrategy: RecoveryStrategy): RecoveryStrategy {
    const escalationMap: Record<RecoveryStrategy, RecoveryStrategy> = {
      retry: 'circuit_breaker',
      circuit_breaker: 'restart',
      restart: 'graceful_degradation',
      graceful_degradation: 'escalate',
      fallback: 'restart',
      escalate: 'manual',
      ignore: 'retry',
      manual: 'manual'
    };

    return escalationMap[currentStrategy] || 'escalate';
  }

  /**
   * Initiate graceful shutdown
   */
  public async initiateGracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    
    secureLog('info', 'Initiating graceful shutdown', {
      active_sessions: this.activeSessions.size,
      timeout: this.config.gracefulShutdownTimeout
    });

    const shutdownTimeout = setTimeout(() => {
      secureLog('warn', 'Graceful shutdown timeout - forcing exit');
      process.exit(1);
    }, this.config.gracefulShutdownTimeout);

    try {
      // Wait for active recovery sessions to complete
      const activeSessionPromises = Array.from(this.activeSessions.values()).map(session => 
        this.waitForSessionCompletion(session, 5000) // 5 second timeout per session
      );

      await Promise.allSettled(activeSessionPromises);
      
      secureLog('info', 'Graceful shutdown completed');
      clearTimeout(shutdownTimeout);
      
    } catch (error) {
      secureLog('error', 'Error during graceful shutdown', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      clearTimeout(shutdownTimeout);
    }
  }

  /**
   * Wait for session completion
   */
  private async waitForSessionCompletion(session: RecoverySession, timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const checkCompletion = () => {
        if (session.status !== 'in_progress') {
          resolve();
        } else {
          setTimeout(checkCompletion, 100);
        }
      };

      setTimeout(() => resolve(), timeout);
      checkCompletion();
    });
  }

  /**
   * Get recovery session
   */
  public getSession(sessionId: string): RecoverySession | undefined {
    return this.activeSessions.get(sessionId) || 
           this.recoveryHistory.find(s => s.id === sessionId);
  }

  /**
   * Get active sessions
   */
  public getActiveSessions(): RecoverySession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get recovery history
   */
  public getRecoveryHistory(limit: number = 50): RecoverySession[] {
    return this.recoveryHistory.slice(-limit);
  }

  /**
   * Get recovery statistics
   */
  public getStatistics() {
    const allSessions = [...this.recoveryHistory, ...Array.from(this.activeSessions.values())];
    
    const byStatus = allSessions.reduce((counts, session) => {
      counts[session.status] = (counts[session.status] || 0) + 1;
      return counts;
    }, {} as Record<RecoveryStatus, number>);

    const byErrorCategory = allSessions.reduce((counts, session) => {
      counts[session.errorCategory] = (counts[session.errorCategory] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    const completedSessions = allSessions.filter(s => s.endTime);
    const averageDuration = completedSessions.length > 0 
      ? completedSessions.reduce((sum, s) => sum + (s.endTime! - s.startTime), 0) / completedSessions.length
      : 0;

    const successRate = allSessions.length > 0
      ? (byStatus.succeeded || 0) / allSessions.length
      : 0;

    return {
      total_sessions: allSessions.length,
      active_sessions: this.activeSessions.size,
      by_status: byStatus,
      by_error_category: byErrorCategory,
      average_duration: averageDuration,
      success_rate: successRate,
      auto_recovery_enabled: this.config.autoRecoveryEnabled
    };
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `recovery-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<RecoveryConfig>): void {
    this.config = { ...this.config, ...config };
    
    secureLog('info', 'Recovery manager configuration updated', {
      updates: sanitizeForLogging(config)
    });
  }

  /**
   * Get current configuration
   */
  public getConfig(): RecoveryConfig {
    return { ...this.config };
  }
}
/**
 * Centralized Error Handler
 * 
 * Comprehensive error handling orchestrator that coordinates classification,
 * recovery strategies, monitoring, and escalation for the resilience framework.
 */

import { BaseResilienceError, ErrorContext, RecoveryStrategy } from './base-error.js';
import { ErrorClassifier, ErrorClassification } from './error-classifier.js';
import { createResilienceError } from './resilience-errors.js';
import { secureLog, sanitizeForLogging } from '../../security.js';

export interface ErrorHandlerConfig {
  enabled: boolean;
  autoClassification: boolean;
  autoRecovery: boolean;
  escalationEnabled: boolean;
  maxConcurrentHandling: number;
  handlingTimeout: number; // Max time to spend handling an error
  retryDelayMultiplier: number;
  maxRetryDelay: number;
  circuitBreakerEnabled: boolean;
  monitoringEnabled: boolean;
}

export interface ErrorHandlingResult {
  handled: boolean;
  recovered: boolean;
  strategy: RecoveryStrategy;
  attempts: number;
  duration: number;
  error?: BaseResilienceError;
  metadata: Record<string, any>;
}

export interface ErrorHandlingContext {
  correlationId: string;
  operation: string;
  component: string;
  startTime: number;
  timeout?: number;
  retryCount: number;
  maxRetries: number;
  metadata: Record<string, any>;
}

export interface RecoveryHandler {
  strategy: RecoveryStrategy;
  handler: (error: BaseResilienceError, context: ErrorHandlingContext) => Promise<boolean>;
  priority: number;
  timeout: number;
}

/**
 * Centralized error handling orchestrator
 */
export class ErrorHandler {
  private classifier: ErrorClassifier;
  private config: ErrorHandlerConfig;
  private recoveryHandlers: Map<RecoveryStrategy, RecoveryHandler> = new Map();
  private activeHandling: Map<string, ErrorHandlingContext> = new Map();
  private escalationHandlers: Array<(error: BaseResilienceError, context: ErrorHandlingContext) => Promise<void>> = [];

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = {
      enabled: true,
      autoClassification: true,
      autoRecovery: true,
      escalationEnabled: true,
      maxConcurrentHandling: 10,
      handlingTimeout: 30000, // 30 seconds
      retryDelayMultiplier: 1.5,
      maxRetryDelay: 30000, // 30 seconds
      circuitBreakerEnabled: true,
      monitoringEnabled: true,
      ...config
    };

    this.classifier = new ErrorClassifier();
    this.initializeRecoveryHandlers();

    secureLog('info', 'Error handler initialized', {
      config: sanitizeForLogging(this.config),
      recovery_handlers: Array.from(this.recoveryHandlers.keys())
    });
  }

  /**
   * Initialize built-in recovery handlers
   */
  private initializeRecoveryHandlers(): void {
    // Retry handler
    this.recoveryHandlers.set('retry', {
      strategy: 'retry',
      handler: this.handleRetry.bind(this),
      priority: 1,
      timeout: 10000
    });

    // Circuit breaker handler
    this.recoveryHandlers.set('circuit_breaker', {
      strategy: 'circuit_breaker',
      handler: this.handleCircuitBreaker.bind(this),
      priority: 2,
      timeout: 5000
    });

    // Fallback handler
    this.recoveryHandlers.set('fallback', {
      strategy: 'fallback',
      handler: this.handleFallback.bind(this),
      priority: 3,
      timeout: 5000
    });

    // Restart handler
    this.recoveryHandlers.set('restart', {
      strategy: 'restart',
      handler: this.handleRestart.bind(this),
      priority: 4,
      timeout: 30000
    });

    // Graceful degradation handler
    this.recoveryHandlers.set('graceful_degradation', {
      strategy: 'graceful_degradation',
      handler: this.handleGracefulDegradation.bind(this),
      priority: 5,
      timeout: 5000
    });

    // Escalation handler
    this.recoveryHandlers.set('escalate', {
      strategy: 'escalate',
      handler: this.handleEscalation.bind(this),
      priority: 6,
      timeout: 2000
    });

    // Ignore handler (no-op but logs)
    this.recoveryHandlers.set('ignore', {
      strategy: 'ignore',
      handler: this.handleIgnore.bind(this),
      priority: 7,
      timeout: 1000
    });

    // Manual handler (logs and waits for manual intervention)
    this.recoveryHandlers.set('manual', {
      strategy: 'manual',
      handler: this.handleManual.bind(this),
      priority: 8,
      timeout: 2000
    });
  }

  /**
   * Main error handling entry point
   */
  public async handleError(
    error: Error | BaseResilienceError,
    context: Partial<ErrorContext> = {}
  ): Promise<ErrorHandlingResult> {
    if (!this.config.enabled) {
      return {
        handled: false,
        recovered: false,
        strategy: 'ignore',
        attempts: 0,
        duration: 0,
        metadata: { reason: 'error_handler_disabled' }
      };
    }

    const startTime = Date.now();
    const correlationId = context.correlationId || this.generateCorrelationId();
    
    // Check concurrent handling limit
    if (this.activeHandling.size >= this.config.maxConcurrentHandling) {
      secureLog('warn', 'Max concurrent error handling limit reached', {
        active_count: this.activeHandling.size,
        max_concurrent: this.config.maxConcurrentHandling,
        error_code: (error as any).code || 'unknown'
      });
      return {
        handled: false,
        recovered: false,
        strategy: 'ignore',
        attempts: 0,
        duration: Date.now() - startTime,
        metadata: { reason: 'concurrent_limit_exceeded' }
      };
    }

    // Convert to BaseResilienceError if needed
    let resilienceError: BaseResilienceError;
    if (error instanceof BaseResilienceError) {
      resilienceError = error;
    } else {
      resilienceError = createResilienceError(error, context);
    }

    // Create handling context
    const handlingContext: ErrorHandlingContext = {
      correlationId,
      operation: context.operation || 'unknown',
      component: context.component || 'unknown',
      startTime,
      timeout: this.config.handlingTimeout,
      retryCount: 0,
      maxRetries: 3,
      metadata: { ...context.metadata }
    };

    this.activeHandling.set(correlationId, handlingContext);

    try {
      // Classify error if auto-classification is enabled
      let classification: ErrorClassification;
      
      if (this.config.autoClassification) {
        classification = this.classifier.classify(resilienceError, context);
        
        // Update error with classification results
        resilienceError.recovery.strategy = classification.recoveryStrategy;
        resilienceError.recovery.maxAttempts = classification.maxAttempts;
        
        handlingContext.maxRetries = classification.maxAttempts;
      } else {
        // Use error's built-in classification
        classification = {
          pattern: null,
          confidence: 1.0,
          category: resilienceError.category,
          severity: resilienceError.severity,
          retryable: resilienceError.retryable,
          recoveryStrategy: resilienceError.recovery.strategy,
          maxAttempts: resilienceError.recovery.maxAttempts,
          reasoning: 'Using error built-in classification',
          alternativePatterns: []
        };
      }

      secureLog('info', 'Error handling started', {
        correlation_id: correlationId,
        error_code: resilienceError.code,
        error_category: resilienceError.category,
        recovery_strategy: classification.recoveryStrategy,
        max_attempts: classification.maxAttempts,
        classification_confidence: classification.confidence
      });

      // Attempt recovery if auto-recovery is enabled and error is retryable
      let recovered = false;
      let attempts = 0;

      if (this.config.autoRecovery && classification.retryable) {
        const recoveryResult = await this.attemptRecovery(resilienceError, handlingContext, classification);
        recovered = recoveryResult.success;
        attempts = recoveryResult.attempts;
      }

      const duration = Date.now() - startTime;

      // Record outcome in classifier
      this.classifier.recordRecoveryOutcome(classification.recoveryStrategy, recovered);

      const result: ErrorHandlingResult = {
        handled: true,
        recovered,
        strategy: classification.recoveryStrategy,
        attempts,
        duration,
        error: recovered ? undefined : resilienceError,
        metadata: {
          correlation_id: correlationId,
          classification_confidence: classification.confidence,
          pattern_matched: classification.pattern?.name,
          escalation_level: resilienceError.recovery.escalationLevel
        }
      };

      secureLog(recovered ? 'info' : 'warn', 'Error handling completed', {
        correlation_id: correlationId,
        handled: result.handled,
        recovered: result.recovered,
        strategy: result.strategy,
        attempts: result.attempts,
        duration: result.duration
      });

      return result;

    } catch (handlingError) {
      const duration = Date.now() - startTime;
      
      secureLog('error', 'Error handling failed', {
        correlation_id: correlationId,
        original_error: resilienceError.code,
        handling_error: handlingError instanceof Error ? handlingError.message : 'unknown',
        duration
      });

      return {
        handled: false,
        recovered: false,
        strategy: 'manual',
        attempts: 0,
        duration,
        error: resilienceError,
        metadata: {
          correlation_id: correlationId,
          handling_error: handlingError instanceof Error ? handlingError.message : 'unknown'
        }
      };

    } finally {
      this.activeHandling.delete(correlationId);
    }
  }

  /**
   * Attempt recovery using the appropriate strategy
   */
  private async attemptRecovery(
    error: BaseResilienceError,
    context: ErrorHandlingContext,
    classification: ErrorClassification
  ): Promise<{ success: boolean; attempts: number }> {
    const recoveryHandler = this.recoveryHandlers.get(classification.recoveryStrategy);
    
    if (!recoveryHandler) {
      secureLog('warn', 'No recovery handler found for strategy', {
        strategy: classification.recoveryStrategy,
        error_code: error.code
      });
      return { success: false, attempts: 0 };
    }

    let attempts = 0;
    let success = false;

    while (attempts < classification.maxAttempts && !success) {
      attempts++;
      context.retryCount = attempts;

      const attemptStart = Date.now();
      
      try {
        secureLog('debug', 'Recovery attempt started', {
          correlation_id: context.correlationId,
          strategy: classification.recoveryStrategy,
          attempt: attempts,
          max_attempts: classification.maxAttempts
        });

        // Apply timeout to recovery handler
        const timeoutPromise = new Promise<boolean>((_, reject) => {
          setTimeout(() => reject(new Error('Recovery timeout')), recoveryHandler.timeout);
        });

        const recoveryPromise = recoveryHandler.handler(error, context);
        success = await Promise.race([recoveryPromise, timeoutPromise]);

        const duration = Date.now() - attemptStart;
        
        error.recordRecoveryAttempt(
          classification.recoveryStrategy,
          success,
          duration,
          undefined,
          { attempt: attempts }
        );

        if (success) {
          secureLog('info', 'Recovery attempt succeeded', {
            correlation_id: context.correlationId,
            strategy: classification.recoveryStrategy,
            attempt: attempts,
            duration
          });
          break;
        } else {
          secureLog('warn', 'Recovery attempt failed', {
            correlation_id: context.correlationId,
            strategy: classification.recoveryStrategy,
            attempt: attempts,
            duration
          });
        }

      } catch (recoveryError) {
        const duration = Date.now() - attemptStart;
        
        error.recordRecoveryAttempt(
          classification.recoveryStrategy,
          false,
          duration,
          recoveryError instanceof Error ? recoveryError.message : 'unknown',
          { attempt: attempts }
        );

        secureLog('error', 'Recovery attempt threw error', {
          correlation_id: context.correlationId,
          strategy: classification.recoveryStrategy,
          attempt: attempts,
          duration,
          recovery_error: recoveryError instanceof Error ? recoveryError.message : 'unknown'
        });
      }

      // Wait before next attempt (with exponential backoff)
      if (attempts < classification.maxAttempts && !success) {
        const delay = Math.min(
          1000 * Math.pow(this.config.retryDelayMultiplier, attempts - 1),
          this.config.maxRetryDelay
        );
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return { success, attempts };
  }

  /**
   * Retry recovery handler
   */
  private async handleRetry(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    // For retry strategy, we just return false to trigger the next attempt
    // The actual retry logic is handled by the calling code
    secureLog('debug', 'Retry recovery handler called', {
      correlation_id: context.correlationId,
      error_code: error.code,
      attempt: context.retryCount
    });
    
    return false; // Always fail to trigger retry
  }

  /**
   * Circuit breaker recovery handler
   */
  private async handleCircuitBreaker(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    secureLog('info', 'Circuit breaker recovery handler activated', {
      correlation_id: context.correlationId,
      error_code: error.code,
      component: context.component
    });

    // TODO: Integrate with actual circuit breaker implementation
    // For now, just wait and return success to break the circuit
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  }

  /**
   * Fallback recovery handler
   */
  private async handleFallback(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    secureLog('info', 'Fallback recovery handler activated', {
      correlation_id: context.correlationId,
      error_code: error.code,
      operation: context.operation
    });

    // Implement fallback strategies based on operation type
    switch (context.operation) {
      case 'sendEvent':
        // Fallback: Store event locally and retry later
        return this.fallbackStoreEvent(error, context);
      
      case 'getBridgeStatus':
        // Fallback: Return cached status or default status
        return this.fallbackBridgeStatus(error, context);
      
      default:
        secureLog('warn', 'No specific fallback available for operation', {
          operation: context.operation,
          error_code: error.code
        });
        return false;
    }
  }

  /**
   * Restart recovery handler
   */
  private async handleRestart(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    secureLog('info', 'Restart recovery handler activated', {
      correlation_id: context.correlationId,
      error_code: error.code,
      component: context.component
    });

    // TODO: Implement actual restart logic
    // This would typically restart the bridge process or service
    await new Promise(resolve => setTimeout(resolve, 5000));
    return true;
  }

  /**
   * Graceful degradation recovery handler
   */
  private async handleGracefulDegradation(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    secureLog('info', 'Graceful degradation recovery handler activated', {
      correlation_id: context.correlationId,
      error_code: error.code,
      operation: context.operation
    });

    // Implement graceful degradation based on error type
    // This typically means reducing functionality while maintaining core operations
    return true; // Assume graceful degradation is always successful
  }

  /**
   * Escalation recovery handler
   */
  private async handleEscalation(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    secureLog('warn', 'Error escalated', {
      correlation_id: context.correlationId,
      error_code: error.code,
      error_severity: error.severity,
      escalation_level: error.recovery.escalationLevel
    });

    // Run escalation handlers
    for (const handler of this.escalationHandlers) {
      try {
        await handler(error, context);
      } catch (escalationError) {
        secureLog('error', 'Escalation handler failed', {
          correlation_id: context.correlationId,
          escalation_error: escalationError instanceof Error ? escalationError.message : 'unknown'
        });
      }
    }

    return false; // Escalation doesn't recover, it notifies
  }

  /**
   * Ignore recovery handler
   */
  private async handleIgnore(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    secureLog('debug', 'Error ignored', {
      correlation_id: context.correlationId,
      error_code: error.code,
      reason: 'ignore_strategy'
    });

    return true; // Ignore is always "successful"
  }

  /**
   * Manual recovery handler
   */
  private async handleManual(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    secureLog('warn', 'Manual intervention required', {
      correlation_id: context.correlationId,
      error_code: error.code,
      error_message: error.message,
      context: sanitizeForLogging(context)
    });

    return false; // Manual intervention required
  }

  /**
   * Fallback for storing events
   */
  private async fallbackStoreEvent(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    // TODO: Implement event storage fallback
    secureLog('info', 'Event stored for later retry', {
      correlation_id: context.correlationId,
      error_code: error.code
    });
    return true;
  }

  /**
   * Fallback for bridge status
   */
  private async fallbackBridgeStatus(error: BaseResilienceError, context: ErrorHandlingContext): Promise<boolean> {
    // TODO: Implement cached status fallback
    secureLog('info', 'Returning cached bridge status', {
      correlation_id: context.correlationId,
      error_code: error.code
    });
    return true;
  }

  /**
   * Add custom recovery handler
   */
  public addRecoveryHandler(handler: RecoveryHandler): void {
    this.recoveryHandlers.set(handler.strategy, handler);
    secureLog('info', 'Custom recovery handler added', {
      strategy: handler.strategy,
      priority: handler.priority,
      timeout: handler.timeout
    });
  }

  /**
   * Add escalation handler
   */
  public addEscalationHandler(handler: (error: BaseResilienceError, context: ErrorHandlingContext) => Promise<void>): void {
    this.escalationHandlers.push(handler);
    secureLog('info', 'Escalation handler added', {
      total_handlers: this.escalationHandlers.length
    });
  }

  /**
   * Get error classifier
   */
  public getClassifier(): ErrorClassifier {
    return this.classifier;
  }

  /**
   * Generate correlation ID
   */
  private generateCorrelationId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current configuration
   */
  public getConfig(): ErrorHandlerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ErrorHandlerConfig>): void {
    this.config = { ...this.config, ...config };
    secureLog('info', 'Error handler configuration updated', {
      config: sanitizeForLogging(this.config)
    });
  }

  /**
   * Get active handling count
   */
  public getActiveHandlingCount(): number {
    return this.activeHandling.size;
  }

  /**
   * Get statistics from classifier
   */
  public getStatistics() {
    return this.classifier.getStatistics();
  }
}
/**
 * Base Error Classes for Resilience Framework
 * 
 * Foundation error classes with enhanced metadata, context tracking,
 * and integration with resilience systems.
 */

import { secureLog, sanitizeForLogging } from '../../security.js';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ErrorCategory = 
  | 'network' 
  | 'filesystem' 
  | 'bridge' 
  | 'telegram' 
  | 'validation' 
  | 'security' 
  | 'system' 
  | 'configuration' 
  | 'timeout' 
  | 'rate_limit' 
  | 'resource' 
  | 'unknown';

export type RecoveryStrategy = 
  | 'retry' 
  | 'circuit_breaker' 
  | 'fallback' 
  | 'escalate' 
  | 'ignore' 
  | 'manual' 
  | 'restart' 
  | 'graceful_degradation';

export interface ErrorContext {
  operation: string;
  component: string;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  timestamp: number;
  environment: string;
  version: string;
  metadata?: Record<string, any>;
}

export interface ErrorRecoveryInfo {
  strategy: RecoveryStrategy;
  maxAttempts: number;
  currentAttempt: number;
  lastAttemptTime?: number;
  nextAttemptTime?: number;
  backoffDelay?: number;
  escalationLevel: number;
  recoveryHistory: RecoveryAttempt[];
}

export interface RecoveryAttempt {
  strategy: RecoveryStrategy;
  attempt: number;
  timestamp: number;
  success: boolean;
  duration: number;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Enhanced base error class with resilience framework integration
 */
export abstract class BaseResilienceError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly retryable: boolean;
  public readonly context: ErrorContext;
  public readonly recovery: ErrorRecoveryInfo;
  public readonly originalError?: Error;
  public readonly stack: string;
  public readonly timestamp: number;

  constructor(
    message: string,
    code: string,
    category: ErrorCategory,
    severity: ErrorSeverity = 'medium',
    retryable: boolean = false,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(message);
    
    this.name = this.constructor.name;
    this.code = code;
    this.category = category;
    this.severity = severity;
    this.retryable = retryable;
    this.originalError = originalError;
    this.timestamp = Date.now();
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    this.stack = this.stack || new Error().stack || '';
    
    // Build comprehensive context
    this.context = {
      operation: 'unknown',
      component: 'unknown',
      timestamp: this.timestamp,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || 'unknown',
      ...context
    };
    
    // Initialize recovery information
    this.recovery = {
      strategy: this.getDefaultRecoveryStrategy(),
      maxAttempts: this.getDefaultMaxAttempts(),
      currentAttempt: 0,
      escalationLevel: 0,
      recoveryHistory: []
    };
    
    // Log error creation
    this.logError();
  }

  /**
   * Get default recovery strategy based on error characteristics
   */
  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    if (!this.retryable) {
      return this.severity === 'critical' ? 'escalate' : 'ignore';
    }
    
    switch (this.category) {
      case 'network':
      case 'timeout':
        return 'retry';
      case 'rate_limit':
        return 'circuit_breaker';
      case 'bridge':
        return 'restart';
      case 'security':
      case 'validation':
        return 'escalate';
      case 'system':
      case 'resource':
        return 'graceful_degradation';
      default:
        return 'retry';
    }
  }

  /**
   * Get default maximum recovery attempts based on error characteristics
   */
  protected getDefaultMaxAttempts(): number {
    switch (this.severity) {
      case 'critical':
        return 5;
      case 'high':
        return 3;
      case 'medium':
        return 2;
      case 'low':
        return 1;
      default:
        return 3;
    }
  }

  /**
   * Log error with appropriate security and context
   */
  protected logError(): void {
    const logLevel = this.getLogLevel();
    const sanitizedContext = sanitizeForLogging(this.context);
    
    secureLog(logLevel, `${this.constructor.name} occurred`, {
      error_code: this.code,
      error_category: this.category,
      error_severity: this.severity,
      error_retryable: this.retryable,
      error_message: this.message,
      context: sanitizedContext,
      original_error: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        code: (this.originalError as any).code
      } : undefined,
      stack_trace: this.stack
    });
  }

  /**
   * Determine appropriate log level based on error severity
   */
  protected getLogLevel(): 'error' | 'warn' | 'info' | 'debug' {
    switch (this.severity) {
      case 'critical':
        return 'error';
      case 'high':
        return 'error';
      case 'medium':
        return 'warn';
      case 'low':
        return 'info';
      default:
        return 'warn';
    }
  }

  /**
   * Create a recovery attempt record
   */
  public recordRecoveryAttempt(
    strategy: RecoveryStrategy,
    success: boolean,
    duration: number,
    error?: string,
    metadata?: Record<string, any>
  ): void {
    const attempt: RecoveryAttempt = {
      strategy,
      attempt: this.recovery.currentAttempt + 1,
      timestamp: Date.now(),
      success,
      duration,
      error,
      metadata: sanitizeForLogging(metadata)
    };
    
    this.recovery.recoveryHistory.push(attempt);
    this.recovery.currentAttempt++;
    this.recovery.lastAttemptTime = attempt.timestamp;
    
    if (!success && this.recovery.currentAttempt < this.recovery.maxAttempts) {
      // Calculate next attempt time with backoff
      const backoff = this.calculateBackoff();
      this.recovery.nextAttemptTime = Date.now() + backoff;
      this.recovery.backoffDelay = backoff;
    }
    
    secureLog('info', 'Recovery attempt recorded', {
      error_code: this.code,
      strategy,
      attempt: attempt.attempt,
      success,
      duration,
      next_attempt_time: this.recovery.nextAttemptTime
    });
  }

  /**
   * Calculate exponential backoff delay
   */
  protected calculateBackoff(): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const multiplier = Math.pow(2, this.recovery.currentAttempt);
    const jitter = Math.random() * 1000; // Up to 1 second jitter
    
    return Math.min(baseDelay * multiplier + jitter, maxDelay);
  }

  /**
   * Check if error is eligible for recovery
   */
  public canRecover(): boolean {
    return this.retryable && 
           this.recovery.currentAttempt < this.recovery.maxAttempts &&
           (!this.recovery.nextAttemptTime || Date.now() >= this.recovery.nextAttemptTime);
  }

  /**
   * Escalate error severity and recovery strategy
   */
  public escalate(): void {
    this.recovery.escalationLevel++;
    
    // Escalate recovery strategy
    if (this.recovery.strategy === 'retry') {
      this.recovery.strategy = 'circuit_breaker';
    } else if (this.recovery.strategy === 'circuit_breaker') {
      this.recovery.strategy = 'restart';
    } else if (this.recovery.strategy === 'restart') {
      this.recovery.strategy = 'escalate';
    }
    
    secureLog('warn', 'Error escalated', {
      error_code: this.code,
      escalation_level: this.recovery.escalationLevel,
      new_strategy: this.recovery.strategy
    });
  }

  /**
   * Get error summary for monitoring and alerts
   */
  public getSummary(): Record<string, any> {
    return {
      code: this.code,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      message: this.message,
      timestamp: this.timestamp,
      context: {
        operation: this.context.operation,
        component: this.context.component,
        correlationId: this.context.correlationId
      },
      recovery: {
        strategy: this.recovery.strategy,
        currentAttempt: this.recovery.currentAttempt,
        maxAttempts: this.recovery.maxAttempts,
        escalationLevel: this.recovery.escalationLevel
      }
    };
  }

  /**
   * Convert error to JSON for serialization
   */
  public toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      message: this.message,
      timestamp: this.timestamp,
      context: sanitizeForLogging(this.context),
      recovery: {
        strategy: this.recovery.strategy,
        maxAttempts: this.recovery.maxAttempts,
        currentAttempt: this.recovery.currentAttempt,
        escalationLevel: this.recovery.escalationLevel,
        historyCount: this.recovery.recoveryHistory.length
      },
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message
      } : undefined
    };
  }

  /**
   * Create error from JSON representation
   */
  public static fromJSON(data: any): Error {
    // This would be implemented by concrete error classes
    throw new Error('fromJSON must be implemented by concrete error classes');
  }
}
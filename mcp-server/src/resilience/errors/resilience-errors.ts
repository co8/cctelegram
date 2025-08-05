/**
 * Specific Resilience Error Classes
 * 
 * Domain-specific error classes for different components and scenarios
 * in the CCTelegram MCP Server with built-in recovery strategies.
 */

import { BaseResilienceError, ErrorContext, RecoveryStrategy } from './base-error.js';

/**
 * Bridge-related errors
 */
export class BridgeError extends BaseResilienceError {
  constructor(
    message: string,
    code: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'high',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(message, code, 'bridge', severity, true, context, originalError);
    this.name = 'BridgeError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case 'BRIDGE_NOT_RUNNING':
      case 'BRIDGE_CRASHED':
        return 'restart';
      case 'BRIDGE_TIMEOUT':
      case 'BRIDGE_SLOW_RESPONSE':
        return 'retry';
      case 'BRIDGE_UNAVAILABLE':
        return 'circuit_breaker';
      case 'BRIDGE_CONFIGURATION_ERROR':
        return 'escalate';
      default:
        return 'retry';
    }
  }
}

export class BridgeConnectionError extends BridgeError {
  constructor(message: string, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(message, 'BRIDGE_CONNECTION_ERROR', 'high', context, originalError);
    this.name = 'BridgeConnectionError';
  }
}

export class BridgeTimeoutError extends BridgeError {
  constructor(message: string, timeoutMs: number, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(
      `${message} (timeout: ${timeoutMs}ms)`, 
      'BRIDGE_TIMEOUT', 
      'medium', 
      { ...context, metadata: { ...context.metadata, timeoutMs } }, 
      originalError
    );
    this.name = 'BridgeTimeoutError';
  }
}

export class BridgeHealthCheckError extends BridgeError {
  constructor(message: string, endpoint: string, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(
      message, 
      'BRIDGE_HEALTH_CHECK_FAILED', 
      'high', 
      { ...context, metadata: { ...context.metadata, endpoint } }, 
      originalError
    );
    this.name = 'BridgeHealthCheckError';
  }
}

/**
 * Network-related errors
 */
export class NetworkError extends BaseResilienceError {
  constructor(
    message: string,
    code: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(message, code, 'network', severity, true, context, originalError);
    this.name = 'NetworkError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case 'NETWORK_TIMEOUT':
      case 'NETWORK_CONNECTION_REFUSED':
        return 'retry';
      case 'NETWORK_RATE_LIMITED':
        return 'circuit_breaker';
      case 'NETWORK_DNS_ERROR':
        return 'fallback';
      case 'NETWORK_SSL_ERROR':
        return 'escalate';
      default:
        return 'retry';
    }
  }
}

export class NetworkTimeoutError extends NetworkError {
  constructor(message: string, url: string, timeoutMs: number, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(
      `Network timeout: ${message}`, 
      'NETWORK_TIMEOUT', 
      'medium', 
      { ...context, metadata: { ...context.metadata, url, timeoutMs } }, 
      originalError
    );
    this.name = 'NetworkTimeoutError';
  }
}

export class NetworkConnectionError extends NetworkError {
  constructor(message: string, url: string, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(
      `Connection failed: ${message}`, 
      'NETWORK_CONNECTION_REFUSED', 
      'medium', 
      { ...context, metadata: { ...context.metadata, url } }, 
      originalError
    );
    this.name = 'NetworkConnectionError';
  }
}

/**
 * Telegram-specific errors
 */
export class TelegramError extends BaseResilienceError {
  constructor(
    message: string,
    code: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(message, code, 'telegram', severity, true, context, originalError);
    this.name = 'TelegramError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case 'TELEGRAM_RATE_LIMITED':
        return 'circuit_breaker';
      case 'TELEGRAM_SERVER_ERROR':
      case 'TELEGRAM_TIMEOUT':
        return 'retry';
      case 'TELEGRAM_INVALID_TOKEN':
      case 'TELEGRAM_FORBIDDEN':
        return 'escalate';
      case 'TELEGRAM_CHAT_NOT_FOUND':
        return 'fallback';
      default:
        return 'retry';
    }
  }

  protected getDefaultMaxAttempts(): number {
    if (this.code === 'TELEGRAM_RATE_LIMITED') {
      return 5; // More attempts for rate limiting
    }
    return super.getDefaultMaxAttempts();
  }
}

export class TelegramRateLimitError extends TelegramError {
  constructor(message: string, retryAfter: number, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(
      `Telegram rate limited: ${message}`, 
      'TELEGRAM_RATE_LIMITED', 
      'medium', 
      { ...context, metadata: { ...context.metadata, retryAfter } }, 
      originalError
    );
    this.name = 'TelegramRateLimitError';
  }

  protected calculateBackoff(): number {
    const retryAfter = this.context.metadata?.retryAfter || 1000;
    const jitter = Math.random() * 1000;
    return retryAfter + jitter;
  }
}

export class TelegramAuthError extends TelegramError {
  constructor(message: string, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(
      `Telegram authentication failed: ${message}`, 
      'TELEGRAM_AUTH_FAILED', 
      'critical', 
      context, 
      originalError
    );
    this.name = 'TelegramAuthError';
    // Auth errors are not retryable
    (this as any).retryable = false;
  }
}

/**
 * Filesystem-related errors
 */
export class FilesystemError extends BaseResilienceError {
  constructor(
    message: string,
    code: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(message, code, 'filesystem', severity, true, context, originalError);
    this.name = 'FilesystemError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case 'FILESYSTEM_PERMISSION_DENIED':
        return 'escalate';
      case 'FILESYSTEM_NOT_FOUND':
        return 'fallback';
      case 'FILESYSTEM_DISK_FULL':
        return 'graceful_degradation';
      case 'FILESYSTEM_BUSY':
      case 'FILESYSTEM_LOCKED':
        return 'retry';
      default:
        return 'retry';
    }
  }
}

export class FilesystemPermissionError extends FilesystemError {
  constructor(message: string, path: string, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(
      `Permission denied: ${message}`, 
      'FILESYSTEM_PERMISSION_DENIED', 
      'high', 
      { ...context, metadata: { ...context.metadata, path } }, 
      originalError
    );
    this.name = 'FilesystemPermissionError';
    // Permission errors are not retryable
    (this as any).retryable = false;
  }
}

export class FilesystemNotFoundError extends FilesystemError {
  constructor(message: string, path: string, context: Partial<ErrorContext> = {}, originalError?: Error) {
    super(
      `File not found: ${message}`, 
      'FILESYSTEM_NOT_FOUND', 
      'medium', 
      { ...context, metadata: { ...context.metadata, path } }, 
      originalError
    );
    this.name = 'FilesystemNotFoundError';
  }
}

/**
 * Circuit Breaker errors
 */
export class CircuitBreakerError extends BaseResilienceError {
  constructor(
    message: string,
    circuitName: string,
    state: 'open' | 'half-open' | 'closed',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Circuit breaker ${circuitName} is ${state}: ${message}`, 
      'CIRCUIT_BREAKER_OPEN', 
      'medium', 
      { ...context, metadata: { ...context.metadata, circuitName, state } }, 
      originalError
    );
    this.name = 'CircuitBreakerError';
    // Circuit breaker errors are not retryable (circuit handles retry logic)
    (this as any).retryable = false;
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    return 'fallback';
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends BaseResilienceError {
  constructor(
    message: string,
    operation: string,
    timeoutMs: number,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Operation timeout: ${message}`, 
      'OPERATION_TIMEOUT', 
      'medium', 
      { ...context, operation, metadata: { ...context.metadata, timeoutMs } }, 
      originalError
    );
    this.name = 'TimeoutError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    return 'retry';
  }
}

/**
 * Resource errors
 */
export class ResourceError extends BaseResilienceError {
  constructor(
    message: string,
    code: string,
    resourceType: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'high',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      message, 
      code, 
      'resource', 
      severity, 
      false, // Resource errors typically require manual intervention
      { ...context, metadata: { ...context.metadata, resourceType } }, 
      originalError
    );
    this.name = 'ResourceError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case 'RESOURCE_EXHAUSTED':
        return 'graceful_degradation';
      case 'RESOURCE_UNAVAILABLE':
        return 'fallback';
      case 'RESOURCE_CORRUPTED':
        return 'escalate';
      default:
        return 'manual';
    }
  }
}

export class ResourceExhaustedError extends ResourceError {
  constructor(
    message: string, 
    resourceType: string, 
    currentUsage: number, 
    limit: number, 
    context: Partial<ErrorContext> = {}, 
    originalError?: Error
  ) {
    super(
      `Resource exhausted: ${message}`, 
      'RESOURCE_EXHAUSTED', 
      resourceType, 
      'critical', 
      { ...context, metadata: { ...context.metadata, currentUsage, limit } }, 
      originalError
    );
    this.name = 'ResourceExhaustedError';
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends BaseResilienceError {
  constructor(
    message: string,
    configKey: string,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Configuration error: ${message}`, 
      'CONFIGURATION_ERROR', 
      'configuration', 
      'high', 
      false, // Config errors typically require manual fix
      { ...context, metadata: { ...context.metadata, configKey } }, 
      originalError
    );
    this.name = 'ConfigurationError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    return 'escalate';
  }
}

/**
 * Validation errors (extending from existing SecurityError pattern)
 */
export class ValidationError extends BaseResilienceError {
  constructor(
    message: string,
    validationField: string,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Validation failed: ${message}`, 
      'VALIDATION_FAILED', 
      'validation', 
      'medium', 
      false, // Validation errors are not retryable
      { ...context, metadata: { ...context.metadata, validationField } }, 
      originalError
    );
    this.name = 'ValidationError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    return 'escalate';
  }
}

/**
 * System errors
 */
export class SystemError extends BaseResilienceError {
  constructor(
    message: string,
    code: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'high',
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(message, code, 'system', severity, false, context, originalError);
    this.name = 'SystemError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    switch (this.code) {
      case 'SYSTEM_OVERLOADED':
        return 'graceful_degradation';
      case 'SYSTEM_DEPENDENCY_FAILED':
        return 'fallback';
      case 'SYSTEM_CORRUPTED':
        return 'restart';
      default:
        return 'escalate';
    }
  }
}

export class SystemFailureError extends SystemError {
  constructor(
    message: string,
    component: string,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `System failure: ${message}`,
      'SYSTEM_FAILURE',
      'critical',
      { ...context, metadata: { ...context.metadata, component } },
      originalError
    );
    this.name = 'SystemFailureError';
  }
}

/**
 * Retry-specific errors
 */
export class RetryError extends BaseResilienceError {
  constructor(
    message: string,
    maxAttempts: number,
    actualAttempts: number,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Retry failed after ${actualAttempts} attempts: ${message}`,
      'RETRY_EXHAUSTED',
      'system',
      'medium',
      false,
      { ...context, metadata: { ...context.metadata, maxAttempts, actualAttempts } },
      originalError
    );
    this.name = 'RetryError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    return 'escalate';
  }
}

/**
 * Recovery-specific errors
 */
export class RecoveryError extends BaseResilienceError {
  constructor(
    message: string,
    errorCode: string,
    context: Partial<ErrorContext> = {},
    originalContext?: Partial<ErrorContext>,
    originalError?: Error
  ) {
    super(
      `Recovery failed: ${message}`,
      'RECOVERY_FAILED',
      'system',
      'high',
      false,
      { ...context, metadata: { ...context.metadata, originalErrorCode: errorCode, originalContext } },
      originalError
    );
    this.name = 'RecoveryError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    return 'escalate';
  }
}

/**
 * Health check specific errors
 */
export class HealthCheckError extends BaseResilienceError {
  constructor(
    message: string,
    endpoint: string,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Health check failed: ${message}`,
      'HEALTH_CHECK_FAILED',
      'system',
      'medium',
      true,
      { ...context, metadata: { ...context.metadata, endpoint } },
      originalError
    );
    this.name = 'HealthCheckError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    return 'retry';
  }
}

/**
 * Unknown/Generic errors
 */
export class UnknownError extends BaseResilienceError {
  constructor(
    message: string,
    context: Partial<ErrorContext> = {},
    originalError?: Error
  ) {
    super(
      `Unknown error: ${message}`, 
      'UNKNOWN_ERROR', 
      'unknown', 
      'medium', 
      true, 
      context, 
      originalError
    );
    this.name = 'UnknownError';
  }

  protected getDefaultRecoveryStrategy(): RecoveryStrategy {
    return 'retry';
  }
}

/**
 * Factory function to create appropriate error types from standard errors
 */
export function createResilienceError(
  error: Error | any,
  context: Partial<ErrorContext> = {}
): BaseResilienceError {
  const message = error?.message || 'Unknown error occurred';
  const code = error?.code || error?.name || 'UNKNOWN';
  
  // Map common Node.js error codes to appropriate error types
  switch (code) {
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'ENOTFOUND':
      return new NetworkConnectionError(message, context.metadata?.url || 'unknown', context, error);
    
    case 'ETIMEDOUT':
      return new NetworkTimeoutError(message, context.metadata?.url || 'unknown', context.metadata?.timeout || 0, context, error);
    
    case 'ENOENT':
      return new FilesystemNotFoundError(message, context.metadata?.path || 'unknown', context, error);
    
    case 'EACCES':
    case 'EPERM':
      return new FilesystemPermissionError(message, context.metadata?.path || 'unknown', context, error);
    
    case 'EMFILE':
    case 'ENFILE':
      return new ResourceExhaustedError(message, 'file_descriptors', 0, 0, context, error);
    
    case 'ENOSPC':
      return new ResourceExhaustedError(message, 'disk_space', 0, 0, context, error);
    
    // Bridge-specific error codes
    case 'BRIDGE_NOT_RUNNING':
    case 'BRIDGE_CRASHED':
    case 'BRIDGE_TIMEOUT':
      return new BridgeError(message, code, 'high', context, error);
    
    // Telegram-specific error codes
    case 'TELEGRAM_RATE_LIMITED':
      return new TelegramRateLimitError(message, context.metadata?.retryAfter || 1000, context, error);
    
    case 'TELEGRAM_AUTH_FAILED':
      return new TelegramAuthError(message, context, error);
    
    // Generic cases
    default:
      // Try to infer error type from message or properties
      if (message.toLowerCase().includes('timeout')) {
        return new TimeoutError(message, context.operation || 'unknown', context.metadata?.timeout || 0, context, error);
      }
      if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('access denied')) {
        return new FilesystemPermissionError(message, context.metadata?.path || 'unknown', context, error);
      }
      if (message.toLowerCase().includes('connection')) {
        return new NetworkConnectionError(message, context.metadata?.url || 'unknown', context, error);
      }
      
      return new UnknownError(message, context, error);
  }
}
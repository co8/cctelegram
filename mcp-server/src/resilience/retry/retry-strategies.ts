/**
 * Retry Strategies
 * 
 * Pre-configured retry strategies for common use cases with optimized
 * settings for different types of operations and failure scenarios.
 */

import { RetryPolicyConfig, RetryContextRule } from './retry-policy.js';
import { ErrorCategory } from '../errors/base-error.js';

/**
 * Bridge communication retry strategy
 * Optimized for network timeouts and bridge process failures
 */
export const BRIDGE_RETRY_STRATEGY: RetryPolicyConfig = {
  name: 'bridge_communication',
  maxAttempts: 5,
  strategy: 'exponential',
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  multiplier: 2,
  jitterEnabled: true,
  jitterMax: 5000, // 5 seconds max jitter
  jitterType: 'decorrelated',
  retryableErrors: [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'BRIDGE_TIMEOUT',
    'BRIDGE_NOT_RESPONDING',
    'BRIDGE_CONNECTION_FAILED'
  ],
  nonRetryableErrors: [
    'BRIDGE_AUTH_FAILED',
    'BRIDGE_INVALID_CONFIG',
    'BRIDGE_PERMISSION_DENIED'
  ],
  retryableCategories: ['network', 'timeout', 'temporary'],
  nonRetryableCategories: ['authentication', 'authorization', 'configuration'],
  contextualRules: [
    {
      condition: 'priority=high',
      override: { maxAttempts: 7, baseDelay: 500 },
      description: 'Increased retries for high priority operations'
    },
    {
      condition: 'operation=bridge_start',
      override: { maxAttempts: 3, baseDelay: 2000, maxDelay: 10000 },
      description: 'Conservative retries for bridge startup'
    }
  ],
  timeoutMultiplier: 1.5,
  maxTotalTime: 300000 // 5 minutes total
};

/**
 * Telegram API retry strategy
 * Optimized for Telegram API rate limits and network issues
 */
export const TELEGRAM_RETRY_STRATEGY: RetryPolicyConfig = {
  name: 'telegram_api',
  maxAttempts: 4,
  strategy: 'adaptive',
  baseDelay: 2000, // 2 seconds
  maxDelay: 60000, // 1 minute
  multiplier: 1.5,
  jitterEnabled: true,
  jitterMax: 10000, // 10 seconds max jitter
  jitterType: 'exponential',
  retryableErrors: [
    'TELEGRAM_RATE_LIMIT',
    'TELEGRAM_SERVER_ERROR',
    'TELEGRAM_TIMEOUT',
    'TELEGRAM_NETWORK_ERROR',
    'ECONNRESET',
    'ETIMEDOUT'
  ],
  nonRetryableErrors: [
    'TELEGRAM_AUTH_FAILED',
    'TELEGRAM_INVALID_TOKEN',
    'TELEGRAM_BOT_BLOCKED',
    'TELEGRAM_CHAT_NOT_FOUND',
    'TELEGRAM_INVALID_REQUEST'
  ],
  retryableCategories: ['network', 'rate_limit', 'server_error'],
  nonRetryableCategories: ['authentication', 'authorization', 'validation'],
  contextualRules: [
    {
      condition: 'error_code=TELEGRAM_RATE_LIMIT',
      override: { baseDelay: 30000, maxDelay: 300000, strategy: 'linear' },
      description: 'Extended delays for rate limiting'
    },
    {
      condition: 'operation=send_message',
      override: { maxAttempts: 3 },
      description: 'Reduced retries for message sending'
    }
  ],
  maxTotalTime: 600000 // 10 minutes total
};

/**
 * File system retry strategy
 * Optimized for file system operations and temporary locks
 */
export const FILESYSTEM_RETRY_STRATEGY: RetryPolicyConfig = {
  name: 'filesystem_operations',
  maxAttempts: 3,
  strategy: 'linear',
  baseDelay: 500, // 500ms
  maxDelay: 5000, // 5 seconds
  jitterEnabled: true,
  jitterMax: 1000, // 1 second max jitter
  jitterType: 'uniform',
  retryableErrors: [
    'EBUSY',
    'EAGAIN',
    'EMFILE',
    'ENFILE',
    'ENOENT',
    'TEMPORARY_FILE_LOCK'
  ],
  nonRetryableErrors: [
    'EACCES',
    'EPERM',
    'ENOSPC',
    'EROFS',
    'INVALID_PATH',
    'PERMISSION_DENIED'
  ],
  retryableCategories: ['temporary', 'resource'],
  nonRetryableCategories: ['permission', 'configuration', 'validation'],
  contextualRules: [
    {
      condition: 'operation=file_write',
      override: { maxAttempts: 5, baseDelay: 200 },
      description: 'More aggressive retries for file writes'
    }
  ],
  maxTotalTime: 15000 // 15 seconds total
};

/**
 * Network operation retry strategy
 * General purpose network retry with reasonable defaults
 */
export const NETWORK_RETRY_STRATEGY: RetryPolicyConfig = {
  name: 'network_operations',
  maxAttempts: 4,
  strategy: 'exponential',
  baseDelay: 1000, // 1 second
  maxDelay: 16000, // 16 seconds
  multiplier: 2,
  jitterEnabled: true,
  jitterMax: 2000, // 2 seconds max jitter
  jitterType: 'decorrelated',
  retryableErrors: [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
    '503',
    '502',
    '504'
  ],
  nonRetryableErrors: [
    '400',
    '401',
    '403',
    '404',
    '422',
    'INVALID_URL',
    'MALFORMED_REQUEST'
  ],
  retryableCategories: ['network', 'timeout', 'server_error'],
  nonRetryableCategories: ['validation', 'authentication', 'authorization'],
  contextualRules: [],
  maxTotalTime: 120000 // 2 minutes total
};

/**
 * Database operation retry strategy
 * Optimized for database connection issues and deadlocks
 */
export const DATABASE_RETRY_STRATEGY: RetryPolicyConfig = {
  name: 'database_operations',
  maxAttempts: 5,
  strategy: 'fibonacci',
  baseDelay: 100, // 100ms
  maxDelay: 10000, // 10 seconds
  jitterEnabled: true,
  jitterMax: 500, // 500ms max jitter
  jitterType: 'uniform',
  retryableErrors: [
    'CONNECTION_LOST',
    'DEADLOCK',
    'LOCK_WAIT_TIMEOUT',
    'CONNECTION_TIMEOUT',
    'TEMPORARY_FAILURE'
  ],
  nonRetryableErrors: [
    'SYNTAX_ERROR',
    'ACCESS_DENIED',
    'TABLE_NOT_EXISTS',
    'CONSTRAINT_VIOLATION',
    'SCHEMA_ERROR'
  ],
  retryableCategories: ['connection', 'temporary', 'concurrency'],
  nonRetryableCategories: ['validation', 'authorization', 'schema'],
  contextualRules: [
    {
      condition: 'error_code=DEADLOCK',
      override: { strategy: 'exponential', baseDelay: 50, multiplier: 1.5 },
      description: 'Fast exponential backoff for deadlocks'
    }
  ],
  maxTotalTime: 60000 // 1 minute total
};

/**
 * Critical operation retry strategy
 * Conservative strategy for critical operations that must succeed
 */
export const CRITICAL_RETRY_STRATEGY: RetryPolicyConfig = {
  name: 'critical_operations',
  maxAttempts: 7,
  strategy: 'adaptive',
  baseDelay: 2000, // 2 seconds
  maxDelay: 60000, // 1 minute
  multiplier: 1.8,
  jitterEnabled: true,
  jitterMax: 15000, // 15 seconds max jitter
  jitterType: 'decorrelated',
  retryableErrors: [], // Will retry most errors
  nonRetryableErrors: [
    'CRITICAL_VALIDATION_ERROR',
    'SECURITY_VIOLATION',
    'CORRUPTED_DATA'
  ],
  retryableCategories: ['network', 'timeout', 'temporary', 'resource'],
  nonRetryableCategories: ['security', 'corruption'],
  contextualRules: [
    {
      condition: 'attempt>=5',
      override: { baseDelay: 30000, strategy: 'fixed' },
      description: 'Extended delays for later attempts'
    }
  ],
  timeoutMultiplier: 2,
  maxTotalTime: 900000 // 15 minutes total
};

/**
 * Fast retry strategy
 * For operations that should fail fast with minimal delays
 */
export const FAST_RETRY_STRATEGY: RetryPolicyConfig = {
  name: 'fast_operations',
  maxAttempts: 2,
  strategy: 'fixed',
  baseDelay: 100, // 100ms
  maxDelay: 500, // 500ms
  jitterEnabled: false,
  jitterMax: 0,
  jitterType: 'uniform',
  retryableErrors: [
    'TEMPORARY_UNAVAILABLE',
    'RATE_LIMIT_BRIEF'
  ],
  nonRetryableErrors: [], // Most errors won't be retried due to low attempt count
  retryableCategories: ['temporary'],
  nonRetryableCategories: ['validation', 'authentication', 'authorization', 'configuration'],
  contextualRules: [],
  maxTotalTime: 2000 // 2 seconds total
};

/**
 * Background task retry strategy
 * For non-urgent background operations with extended retry windows
 */
export const BACKGROUND_RETRY_STRATEGY: RetryPolicyConfig = {
  name: 'background_tasks',
  maxAttempts: 10,
  strategy: 'polynomial',
  baseDelay: 5000, // 5 seconds
  maxDelay: 3600000, // 1 hour
  polynomialDegree: 2,
  jitterEnabled: true,
  jitterMax: 30000, // 30 seconds max jitter
  jitterType: 'exponential',
  retryableErrors: [], // Retry most errors for background tasks
  nonRetryableErrors: [
    'PERMANENT_FAILURE',
    'CONFIGURATION_ERROR',
    'SECURITY_ERROR'
  ],
  retryableCategories: ['network', 'timeout', 'temporary', 'resource', 'rate_limit'],
  nonRetryableCategories: ['security', 'configuration'],
  contextualRules: [
    {
      condition: 'attempt>=7',
      override: { baseDelay: 300000, strategy: 'fixed' },
      description: 'Long delays for final attempts'
    }
  ],
  maxTotalTime: 7200000 // 2 hours total
};

/**
 * All predefined retry strategies
 */
export const RETRY_STRATEGIES: Record<string, RetryPolicyConfig> = {
  bridge: BRIDGE_RETRY_STRATEGY,
  telegram: TELEGRAM_RETRY_STRATEGY,
  filesystem: FILESYSTEM_RETRY_STRATEGY,
  network: NETWORK_RETRY_STRATEGY,
  database: DATABASE_RETRY_STRATEGY,
  critical: CRITICAL_RETRY_STRATEGY,
  fast: FAST_RETRY_STRATEGY,
  background: BACKGROUND_RETRY_STRATEGY
};

/**
 * Get retry strategy by name
 */
export function getRetryStrategy(name: string): RetryPolicyConfig | undefined {
  return RETRY_STRATEGIES[name];
}

/**
 * Get all available retry strategy names
 */
export function getRetryStrategyNames(): string[] {
  return Object.keys(RETRY_STRATEGIES);
}

/**
 * Create custom retry strategy based on operation type
 */
export function createRetryStrategyForOperation(
  operationType: 'api' | 'filesystem' | 'network' | 'database' | 'critical' | 'background',
  customization?: Partial<RetryPolicyConfig>
): RetryPolicyConfig {
  const baseStrategies: Record<string, RetryPolicyConfig> = {
    api: TELEGRAM_RETRY_STRATEGY,
    filesystem: FILESYSTEM_RETRY_STRATEGY,
    network: NETWORK_RETRY_STRATEGY,
    database: DATABASE_RETRY_STRATEGY,
    critical: CRITICAL_RETRY_STRATEGY,
    background: BACKGROUND_RETRY_STRATEGY
  };

  const baseStrategy = baseStrategies[operationType];
  if (!baseStrategy) {
    throw new Error(`Unknown operation type: ${operationType}`);
  }

  return {
    ...baseStrategy,
    name: `custom_${operationType}_${Date.now()}`,
    ...customization
  };
}

/**
 * Create adaptive retry strategy that learns from operation patterns
 */
export function createAdaptiveRetryStrategy(
  name: string,
  baseConfig?: Partial<RetryPolicyConfig>
): RetryPolicyConfig {
  return {
    name,
    maxAttempts: 5,
    strategy: 'adaptive',
    baseDelay: 1000,
    maxDelay: 30000,
    multiplier: 2,
    jitterEnabled: true,
    jitterMax: 5000,
    jitterType: 'decorrelated',
    retryableErrors: [],
    nonRetryableErrors: [],
    retryableCategories: ['network', 'timeout', 'temporary', 'resource'],
    nonRetryableCategories: ['validation', 'authentication', 'authorization', 'configuration'],
    contextualRules: [],
    maxTotalTime: 300000,
    ...baseConfig
  };
}

/**
 * Merge multiple retry strategies (for complex operations)
 */
export function mergeRetryStrategies(
  strategies: RetryPolicyConfig[],
  name: string
): RetryPolicyConfig {
  if (strategies.length === 0) {
    throw new Error('At least one strategy must be provided');
  }

  if (strategies.length === 1) {
    return { ...strategies[0], name };
  }

  // Take most conservative approach from all strategies
  const maxAttempts = Math.max(...strategies.map(s => s.maxAttempts));
  const maxDelay = Math.max(...strategies.map(s => s.maxDelay));
  const baseDelay = Math.min(...strategies.map(s => s.baseDelay));
  const maxTotalTime = Math.max(...strategies.map(s => s.maxTotalTime || 300000));

  // Merge retryable/non-retryable errors and categories
  const retryableErrors = Array.from(new Set(
    strategies.flatMap(s => s.retryableErrors)
  ));
  const nonRetryableErrors = Array.from(new Set(
    strategies.flatMap(s => s.nonRetryableErrors)
  ));
  const retryableCategories = Array.from(new Set(
    strategies.flatMap(s => s.retryableCategories)
  )) as ErrorCategory[];
  const nonRetryableCategories = Array.from(new Set(
    strategies.flatMap(s => s.nonRetryableCategories)
  )) as ErrorCategory[];

  // Merge contextual rules
  const contextualRules = strategies.flatMap(s => s.contextualRules);

  // Use adaptive strategy for merged strategies
  return {
    name,
    maxAttempts,
    strategy: 'adaptive',
    baseDelay,
    maxDelay,
    multiplier: 2,
    jitterEnabled: true,
    jitterMax: Math.min(5000, maxDelay * 0.1),
    jitterType: 'decorrelated',
    retryableErrors,
    nonRetryableErrors,
    retryableCategories,
    nonRetryableCategories,
    contextualRules,
    maxTotalTime
  };
}
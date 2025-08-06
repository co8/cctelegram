import * as Joi from 'joi';
import * as CryptoJS from 'crypto-js';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import * as fs from 'fs-extra';
import * as path from 'path';
import { EventType } from './types.js';

// Security Configuration
export interface SecurityConfig {
  enableAuth: boolean;
  enableRateLimit: boolean;
  enableInputValidation: boolean;
  enableSecureLogging: boolean;
  apiKeys: string[];
  hmacSecret: string;
  rateLimitPoints: number;
  rateLimitDuration: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

// Security configuration cache
interface SecurityConfigCache {
  config: SecurityConfig;
  timestamp: number;
  ttl: number;
}

let configCache: SecurityConfigCache | null = null;

// Default security configuration
const DEFAULT_CONFIG: SecurityConfig = {
  enableAuth: true,
  enableRateLimit: true,
  enableInputValidation: true,
  enableSecureLogging: true,
  apiKeys: [],
  hmacSecret: '',
  rateLimitPoints: 100, // 100 requests
  rateLimitDuration: 60, // per 60 seconds
  logLevel: 'warn'
};

// Rate limiter instance
let rateLimiter: RateLimiterMemory | null = null;

// Security context for requests
export interface SecurityContext {
  clientId: string;
  authenticated: boolean;
  permissions: string[];
  timestamp: number;
}

/**
 * Load security configuration from environment and config files (with caching)
 */
export function loadSecurityConfig(forceFresh = false): SecurityConfig {
  const now = Date.now();
  const defaultTTL = parseInt(process.env.MCP_CONFIG_CACHE_TTL || '300000', 10); // 5 minutes default
  
  // Return cached config if valid and not forcing fresh load
  if (!forceFresh && configCache && (now - configCache.timestamp) < configCache.ttl) {
    secureLog('debug', 'Using cached security configuration', {
      age_ms: now - configCache.timestamp,
      ttl_ms: configCache.ttl
    });
    return configCache.config;
  }
  
  secureLog('debug', 'Loading fresh security configuration', {
    forced: forceFresh,
    cache_expired: configCache ? (now - configCache.timestamp) >= configCache.ttl : true
  });
  
  const config = { ...DEFAULT_CONFIG };
  
  // Load from environment variables
  config.enableAuth = process.env.MCP_ENABLE_AUTH !== 'false';
  config.enableRateLimit = process.env.MCP_ENABLE_RATE_LIMIT !== 'false';
  config.enableInputValidation = process.env.MCP_ENABLE_INPUT_VALIDATION !== 'false';
  config.enableSecureLogging = process.env.MCP_ENABLE_SECURE_LOGGING !== 'false';
  
  // Load API keys
  if (process.env.MCP_API_KEYS) {
    config.apiKeys = process.env.MCP_API_KEYS.split(',').map(key => key.trim());
  }
  
  // Load HMAC secret
  config.hmacSecret = process.env.MCP_HMAC_SECRET || generateSecureSecret();
  
  // Rate limiting configuration
  if (process.env.MCP_RATE_LIMIT_POINTS) {
    config.rateLimitPoints = parseInt(process.env.MCP_RATE_LIMIT_POINTS, 10);
  }
  if (process.env.MCP_RATE_LIMIT_DURATION) {
    config.rateLimitDuration = parseInt(process.env.MCP_RATE_LIMIT_DURATION, 10);
  }
  
  // Log level
  if (process.env.MCP_LOG_LEVEL) {
    config.logLevel = process.env.MCP_LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug';
  }
  
  // Cache the configuration
  configCache = {
    config: { ...config },
    timestamp: now,
    ttl: defaultTTL
  };
  
  secureLog('info', 'Security configuration loaded and cached', {
    ttl_ms: defaultTTL,
    auth_enabled: config.enableAuth,
    rate_limit_enabled: config.enableRateLimit
  });
  
  return config;
}

/**
 * Invalidate security configuration cache (force reload on next access)
 */
export function invalidateSecurityConfigCache(): void {
  configCache = null;
  secureLog('info', 'Security configuration cache invalidated');
}

/**
 * Get cache statistics for monitoring
 */
export function getSecurityConfigCacheStats(): {
  cached: boolean;
  age_ms: number | null;
  ttl_ms: number | null;
  hit_ratio: number | null;
} {
  if (!configCache) {
    return {
      cached: false,
      age_ms: null,
      ttl_ms: null,
      hit_ratio: null
    };
  }
  
  const now = Date.now();
  return {
    cached: true,
    age_ms: now - configCache.timestamp,
    ttl_ms: configCache.ttl,
    hit_ratio: null // TODO: Implement hit/miss tracking
  };
}

/**
 * Generate a secure random secret for HMAC
 */
function generateSecureSecret(): string {
  return CryptoJS.lib.WordArray.random(32).toString();
}

/**
 * Initialize security system
 */
export function initializeSecurity(config: SecurityConfig): void {
  // Initialize configuration file watcher if not already initialized
  try {
    const { initializeConfigWatcher } = require('./config-watcher.js');
    initializeConfigWatcher();
  } catch (error) {
    secureLog('warn', 'Failed to initialize configuration file watcher', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  
  // Initialize rate limiter
  if (config.enableRateLimit) {
    rateLimiter = new RateLimiterMemory({
      points: config.rateLimitPoints,
      duration: config.rateLimitDuration,
    });
    secureLog('info', 'Rate limiter initialized', { 
      points: config.rateLimitPoints, 
      duration: config.rateLimitDuration 
    });
  }
  
  // Log security initialization (without sensitive data)
  secureLog('info', 'Security system initialized', {
    auth_enabled: config.enableAuth,
    rate_limit_enabled: config.enableRateLimit,
    input_validation_enabled: config.enableInputValidation,
    secure_logging_enabled: config.enableSecureLogging,
    api_keys_count: config.apiKeys.length
  });
}

/**
 * Authenticate request using API key
 */
export function authenticateRequest(apiKey?: string, config?: SecurityConfig): SecurityContext {
  const cfg = config || loadSecurityConfig();
  
  if (!cfg.enableAuth) {
    return {
      clientId: 'unauthenticated',
      authenticated: true,
      permissions: ['*'],
      timestamp: Date.now()
    };
  }
  
  if (!apiKey) {
    throw new SecurityError('Authentication required: Missing API key', 'AUTH_MISSING_KEY');
  }
  
  if (!cfg.apiKeys.includes(apiKey)) {
    secureLog('warn', 'Authentication failed: Invalid API key', { api_key_prefix: apiKey.substring(0, 8) });
    throw new SecurityError('Authentication failed: Invalid API key', 'AUTH_INVALID_KEY');
  }
  
  const clientId = CryptoJS.SHA256(apiKey).toString().substring(0, 16);
  
  secureLog('info', 'Authentication successful', { client_id: clientId });
  
  return {
    clientId,
    authenticated: true,
    permissions: ['*'], // Full permissions for now
    timestamp: Date.now()
  };
}

/**
 * Check rate limits for a client
 */
export async function checkRateLimit(clientId: string, config?: SecurityConfig): Promise<void> {
  const cfg = config || loadSecurityConfig();
  
  if (!cfg.enableRateLimit || !rateLimiter) {
    return;
  }
  
  try {
    await rateLimiter.consume(clientId);
  } catch (rejRes: any) {
    const remainingHits = rejRes?.remainingHits || 0;
    const msBeforeNext = rejRes?.msBeforeNext || 0;
    
    secureLog('warn', 'Rate limit exceeded', { 
      client_id: clientId, 
      remaining_hits: remainingHits,
      retry_after_ms: msBeforeNext
    });
    
    throw new SecurityError(
      `Rate limit exceeded. Try again in ${Math.ceil(msBeforeNext / 1000)} seconds.`,
      'RATE_LIMIT_EXCEEDED',
      { retryAfter: msBeforeNext }
    );
  }
}

/**
 * Custom security error class
 */
export class SecurityError extends Error {
  public readonly code: string;
  public readonly metadata?: any;
  
  constructor(message: string, code: string, metadata?: any) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.metadata = metadata;
    
    // Log security errors
    secureLog('error', 'Security error occurred', {
      error_code: code,
      error_message: message,
      metadata: sanitizeForLogging(metadata)
    });
  }
}

/**
 * Input validation schemas
 */
export const inputSchemas = {
  sendEvent: Joi.object({
    type: Joi.string().valid(...getAllowedEventTypes()).required(),
    title: Joi.string().max(200).pattern(/^[a-zA-Z0-9\s\-_.,!?()[\]{}]+$/).required(),
    description: Joi.string().max(2000).required(),
    task_id: Joi.string().uuid().optional(),
    source: Joi.string().max(100).pattern(/^[a-zA-Z0-9\-_]+$/).default('claude-code'),
    data: Joi.object().unknown(true).optional()
  }),
  
  sendMessage: Joi.object({
    message: Joi.string().max(1000).required(),
    source: Joi.string().max(100).pattern(/^[a-zA-Z0-9\-_]+$/).default('claude-code')
  }),
  
  sendTaskCompletion: Joi.object({
    task_id: Joi.string().uuid().required(),
    title: Joi.string().max(200).required(),
    results: Joi.string().max(5000).optional(),
    files_affected: Joi.array().items(Joi.string().max(500)).max(50).optional(),
    duration_ms: Joi.number().min(0).max(86400000).optional() // Max 24 hours
  }),
  
  sendPerformanceAlert: Joi.object({
    title: Joi.string().max(200).required(),
    current_value: Joi.number().required(),
    threshold: Joi.number().required(),
    severity: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium')
  }),
  
  sendApprovalRequest: Joi.object({
    title: Joi.string().max(200).required(),
    description: Joi.string().max(2000).required(),
    options: Joi.array().items(Joi.string().max(100)).min(1).max(10).default(['Approve', 'Deny'])
  }),
  
  getTelegramResponses: Joi.object({
    limit: Joi.number().min(1).max(100).default(10)
  }),
  
  clearOldResponses: Joi.object({
    older_than_hours: Joi.number().min(1).max(8760).default(24) // Max 1 year
  }),
  
  processPendingResponses: Joi.object({
    since_minutes: Joi.number().min(1).max(1440).default(10) // Max 24 hours
  }),
  
  listEventTypes: Joi.object({
    category: Joi.string().max(100).optional()
  }),
  
  getTaskStatus: Joi.object({
    project_root: Joi.string().max(500).optional(),
    task_system: Joi.string().valid('claude-code', 'taskmaster', 'both').default('both'),
    status_filter: Joi.string().valid('pending', 'in_progress', 'completed', 'blocked').optional(),
    summary_only: Joi.boolean().default(false)
  }),

  todo: Joi.object({
    project_root: Joi.string().max(500).optional(),
    task_system: Joi.string().valid('claude-code', 'taskmaster', 'both').default('taskmaster'),
    sections: Joi.array().items(
      Joi.string().valid('completed', 'current', 'upcoming', 'blocked')
    ).default(['completed', 'current', 'upcoming']),
    limit_completed: Joi.number().integer().min(1).max(50).default(5),
    show_subtasks: Joi.boolean().default(true)
  })
};

/**
 * Get allowed event types for validation
 */
function getAllowedEventTypes(): EventType[] {
  return [
    'task_completion', 'task_started', 'task_failed', 'task_progress', 'task_cancelled',
    'code_generation', 'code_analysis', 'code_refactoring', 'code_review', 'code_testing', 'code_deployment',
    'build_completed', 'build_failed', 'test_suite_run', 'lint_check', 'type_check',
    'performance_alert', 'error_occurred', 'system_health',
    'approval_request', 'user_response',
    'info_notification', 'alert_notification', 'progress_update'
  ];
}

/**
 * Validate input data against schema
 */
export function validateInput(data: any, schemaKey: keyof typeof inputSchemas): any {
  const config = loadSecurityConfig();
  
  if (!config.enableInputValidation) {
    return data;
  }
  
  const schema = inputSchemas[schemaKey];
  if (!schema) {
    throw new SecurityError(`Invalid schema key: ${schemaKey}`, 'VALIDATION_INVALID_SCHEMA');
  }
  
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
  
  if (error) {
    const errorMessages = error.details.map(detail => detail.message).join(', ');
    secureLog('warn', 'Input validation failed', { 
      schema_key: schemaKey, 
      error_count: error.details.length,
      errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
    });
    throw new SecurityError(`Input validation failed: ${errorMessages}`, 'VALIDATION_FAILED');
  }
  
  return value;
}

/**
 * Sanitize path to prevent directory traversal
 */
export function sanitizePath(inputPath: string): string {
  // Remove any path traversal attempts
  const sanitized = path.normalize(inputPath).replace(/\.\./g, '');
  
  // For MCP server initialization, allow absolute paths in trusted directories
  const trustedPaths = [
    '/Users/enrique/.cc_telegram',
    process.env.HOME && path.join(process.env.HOME, '.cc_telegram'),
    process.env.CC_TELEGRAM_EVENTS_DIR,
    process.env.CC_TELEGRAM_RESPONSES_DIR
  ].filter(Boolean);
  
  // Check if this is a trusted absolute path
  if (path.isAbsolute(sanitized)) {
    const isTrusted = trustedPaths.some(trustedPath => 
      trustedPath && sanitized.startsWith(trustedPath)
    );
    
    if (!isTrusted) {
      throw new SecurityError('Absolute paths not allowed', 'PATH_TRAVERSAL_ATTEMPT');
    }
  }
  
  return sanitized;
}

/**
 * Secure logging function that removes sensitive data
 */
export function secureLog(level: 'error' | 'warn' | 'info' | 'debug', message: string, data?: any): void {
  // Avoid circular dependency during config loading
  let config: SecurityConfig;
  try {
    config = configCache?.config || DEFAULT_CONFIG;
    // Only call loadSecurityConfig if we don't have a cached config
    if (!configCache) {
      config = DEFAULT_CONFIG; // Use default during initial load
    }
  } catch (error) {
    config = DEFAULT_CONFIG;
  }
  
  if (!config.enableSecureLogging) {
    return;
  }
  
  // Check if we should log this level
  const levels = ['error', 'warn', 'info', 'debug'];
  const configLevelIndex = levels.indexOf(config.logLevel);
  const messageLevelIndex = levels.indexOf(level);
  
  if (messageLevelIndex > configLevelIndex) {
    return;
  }
  
  const sanitizedData = data ? sanitizeForLogging(data) : undefined;
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data: sanitizedData
  };
  
  // Use console.error for logging to stderr (MCP convention)
  console.error(`[MCP-SECURITY-${level.toUpperCase()}]`, JSON.stringify(logEntry));
}

/**
 * Sanitize data for logging (remove sensitive information)
 */
export function sanitizeForLogging(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  
  const sensitiveKeys = [
    'password', 'token', 'key', 'secret', 'auth', 'credential', 'api_key',
    'telegram_bot_token', 'hmac_secret', 'private_key', 'bearer'
  ];
  
  const sanitized = { ...data };
  
  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 0) {
        sanitized[key] = '***REDACTED***';
      }
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }
  
  return sanitized;
}

/**
 * Generate HMAC signature for data integrity
 */
export function generateSignature(data: string, secret: string): string {
  return CryptoJS.HmacSHA256(data, secret).toString();
}

/**
 * Verify HMAC signature
 */
export function verifySignature(data: string, signature: string, secret: string): boolean {
  const expectedSignature = generateSignature(data, secret);
  return CryptoJS.enc.Hex.stringify(CryptoJS.HmacSHA256(signature, secret)) === 
         CryptoJS.enc.Hex.stringify(CryptoJS.HmacSHA256(expectedSignature, secret));
}

/**
 * Security middleware wrapper for MCP tools
 */
export async function withSecurity<T>(
  operation: () => Promise<T>,
  context: {
    toolName: string;
    clientId?: string;
    data?: any;
    schemaKey?: keyof typeof inputSchemas;
  }
): Promise<T> {
  const config = loadSecurityConfig();
  const startTime = Date.now();
  
  try {
    // Rate limiting
    if (context.clientId) {
      await checkRateLimit(context.clientId, config);
    }
    
    // Input validation
    if (context.data && context.schemaKey) {
      context.data = validateInput(context.data, context.schemaKey);
    }
    
    // Execute operation
    const result = await operation();
    
    // Log successful operation
    secureLog('info', 'Security operation completed', {
      tool_name: context.toolName,
      client_id: context.clientId,
      duration_ms: Date.now() - startTime,
      status: 'success'
    });
    
    return result;
    
  } catch (error) {
    // Log failed operation
    secureLog('error', 'Security operation failed', {
      tool_name: context.toolName,
      client_id: context.clientId,
      duration_ms: Date.now() - startTime,
      status: 'error',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      error_code: error instanceof SecurityError ? error.code : 'UNKNOWN_ERROR'
    });
    
    throw error;
  }
}
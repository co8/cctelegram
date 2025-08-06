/**
 * Configuration Schema Management System
 * 
 * Comprehensive configuration validation using zod with strict typing,
 * default values, and environment variable mapping.
 */

import { z } from 'zod';
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import { ResilienceConfig } from '../resilience/config.js';

// Load and expand environment variables
const env = config();
if (env.parsed) {
  expand(env);
}

/**
 * Base configuration schema for common settings
 */
export const BaseConfigSchema = z.object({
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  enableMetrics: z.boolean().default(true),
  enableTracing: z.boolean().default(false),
  enableProfiling: z.boolean().default(false)
});

/**
 * Server configuration schema
 */
export const ServerConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().int().min(1024).max(65535).default(8080),
  maxConnections: z.number().int().positive().default(1000),
  requestTimeout: z.number().int().positive().default(30000),
  enableCors: z.boolean().default(true),
  corsOrigins: z.array(z.string()).default(['*']),
  enableHttps: z.boolean().default(false),
  sslCertPath: z.string().optional(),
  sslKeyPath: z.string().optional(),
  enableKeepAlive: z.boolean().default(true),
  keepAliveTimeout: z.number().int().positive().default(65000)
});

/**
 * Database configuration schema
 */
export const DatabaseConfigSchema = z.object({
  connectionString: z.string().url().optional(),
  host: z.string().default('localhost'),
  port: z.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  maxConnections: z.number().int().positive().default(10),
  connectionTimeout: z.number().int().positive().default(30000),
  idleTimeout: z.number().int().positive().default(10000),
  enableSsl: z.boolean().default(true),
  sslMode: z.enum(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']).default('prefer'),
  enableLogging: z.boolean().default(false),
  logQueries: z.boolean().default(false)
});

/**
 * Telegram configuration schema
 */
export const TelegramConfigSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
  apiUrl: z.string().url().default('https://api.telegram.org'),
  enableWebhook: z.boolean().default(false),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().optional(),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryDelay: z.number().int().positive().default(1000),
  requestTimeout: z.number().int().positive().default(10000),
  enableRateLimiting: z.boolean().default(true),
  rateLimit: z.object({
    maxRequests: z.number().int().positive().default(30),
    windowMs: z.number().int().positive().default(60000)
  }),
  enableMarkdown: z.boolean().default(true),
  enableHtml: z.boolean().default(false)
});

/**
 * Security configuration schema
 */
export const SecurityConfigSchema = z.object({
  enableEncryption: z.boolean().default(true),
  encryptionKey: z.string().min(32).optional(),
  enableAuthentication: z.boolean().default(true),
  jwtSecret: z.string().min(32).optional(),
  jwtExpiresIn: z.string().default('24h'),
  enableRateLimiting: z.boolean().default(true),
  rateLimit: z.object({
    maxRequests: z.number().int().positive().default(100),
    windowMs: z.number().int().positive().default(60000),
    skipSuccessfulRequests: z.boolean().default(false),
    skipFailedRequests: z.boolean().default(false)
  }),
  enableCsrfProtection: z.boolean().default(true),
  csrfSecret: z.string().min(32).optional(),
  enableHelmet: z.boolean().default(true),
  helmetOptions: z.record(z.any()).default({}),
  trustedProxies: z.array(z.string()).default([]),
  allowedHosts: z.array(z.string()).default(['localhost'])
});

/**
 * Monitoring configuration schema
 */
export const MonitoringConfigSchema = z.object({
  enableHealthChecks: z.boolean().default(true),
  healthCheckInterval: z.number().int().positive().default(30000),
  enableMetricsCollection: z.boolean().default(true),
  metricsPort: z.number().int().min(1024).max(65535).default(9090),
  enablePrometheus: z.boolean().default(false),
  prometheusEndpoint: z.string().default('/metrics'),
  enableTracing: z.boolean().default(false),
  tracingEndpoint: z.string().url().optional(),
  enableLogging: z.boolean().default(true),
  logFormat: z.enum(['json', 'text', 'combined']).default('json'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  enableLogRotation: z.boolean().default(true),
  maxLogSize: z.string().default('50MB'),
  maxLogFiles: z.number().int().positive().default(10)
});

/**
 * Cache configuration schema
 */
export const CacheConfigSchema = z.object({
  enableCache: z.boolean().default(true),
  cacheType: z.enum(['memory', 'redis', 'file']).default('memory'),
  redisUrl: z.string().url().optional(),
  redisPassword: z.string().optional(),
  defaultTtl: z.number().int().positive().default(300000), // 5 minutes
  maxMemoryUsage: z.number().int().positive().default(100 * 1024 * 1024), // 100MB
  enableCompression: z.boolean().default(true),
  compressionThreshold: z.number().int().positive().default(1024),
  enablePersistence: z.boolean().default(false),
  persistenceInterval: z.number().int().positive().default(60000)
});

/**
 * File system configuration schema
 */
export const FileSystemConfigSchema = z.object({
  dataDirectory: z.string().default('./data'),
  tempDirectory: z.string().default('./tmp'),
  logsDirectory: z.string().default('./logs'),
  enableBackup: z.boolean().default(true),
  backupDirectory: z.string().default('./backups'),
  backupInterval: z.number().int().positive().default(86400000), // 24 hours
  maxBackupFiles: z.number().int().positive().default(7),
  enableCompression: z.boolean().default(true),
  compressionLevel: z.number().int().min(1).max(9).default(6),
  enableChecksums: z.boolean().default(true),
  maxFileSize: z.number().int().positive().default(100 * 1024 * 1024), // 100MB
  allowedExtensions: z.array(z.string()).default(['.json', '.txt', '.log', '.csv'])
});

/**
 * Resilience configuration schema (extending existing config)
 */
export const ResilienceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  circuitBreaker: z.record(z.object({
    enabled: z.boolean().default(true),
    failureThreshold: z.number().int().positive().default(5),
    successThreshold: z.number().int().positive().default(3),
    timeout: z.number().int().positive().default(30000),
    monitoringWindow: z.number().int().positive().default(60000),
    maxConcurrentRequests: z.number().int().positive().default(10),
    volumeThreshold: z.number().int().positive().default(5)
  })),
  retry: z.record(z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().int().positive().default(3),
    baseDelay: z.number().int().positive().default(1000),
    maxDelay: z.number().int().positive().default(10000),
    exponentialBase: z.number().positive().default(2.0),
    jitterEnabled: z.boolean().default(true),
    jitterMax: z.number().int().positive().default(500),
    retryableErrors: z.array(z.string()).default([]),
    nonRetryableErrors: z.array(z.string()).default([])
  })),
  health: z.object({
    enabled: z.boolean().default(true),
    interval: z.number().int().positive().default(30000),
    timeout: z.number().int().positive().default(5000),
    failureThreshold: z.number().int().positive().default(3),
    recoveryThreshold: z.number().int().positive().default(2),
    gracePeriod: z.number().int().positive().default(10000),
    endpoints: z.array(z.object({
      name: z.string().min(1),
      url: z.string().url(),
      method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
      timeout: z.number().int().positive().default(3000),
      retries: z.number().int().min(0).default(2),
      headers: z.record(z.string()).optional(),
      expectedStatus: z.array(z.number().int()).default([200]),
      critical: z.boolean().default(true)
    })).default([])
  }),
  recovery: z.object({
    enabled: z.boolean().default(true),
    autoRecoveryEnabled: z.boolean().default(true),
    maxRecoveryAttempts: z.number().int().positive().default(5),
    recoveryDelay: z.number().int().positive().default(5000),
    escalationThreshold: z.number().int().positive().default(3),
    gracefulShutdownTimeout: z.number().int().positive().default(30000),
    restartDelay: z.number().int().positive().default(2000),
    backupStrategies: z.array(z.object({
      name: z.string().min(1),
      priority: z.number().int().positive(),
      enabled: z.boolean().default(true),
      timeout: z.number().int().positive().default(15000),
      maxAttempts: z.number().int().positive().default(3),
      conditions: z.array(z.string()).default([])
    })).default([])
  }),
  monitoring: z.object({
    enabled: z.boolean().default(true),
    metricsInterval: z.number().int().positive().default(10000),
    alertThresholds: z.object({
      errorRate: z.number().min(0).max(1).default(0.1),
      responseTime: z.number().int().positive().default(5000),
      memoryUsage: z.number().min(0).max(1).default(0.8),
      cpuUsage: z.number().min(0).max(1).default(0.8)
    }),
    retention: z.object({
      metrics: z.number().int().positive().default(24 * 60 * 60 * 1000),
      events: z.number().int().positive().default(7 * 24 * 60 * 60 * 1000),
      logs: z.number().int().positive().default(3 * 24 * 60 * 60 * 1000)
    }),
    exporters: z.array(z.object({
      name: z.string().min(1),
      type: z.enum(['prometheus', 'logs', 'events', 'custom']),
      enabled: z.boolean().default(true),
      endpoint: z.string().optional(),
      interval: z.number().int().positive().optional(),
      format: z.string().optional(),
      labels: z.record(z.string()).optional()
    })).default([])
  }),
  operations: z.record(z.object({
    priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
    timeout: z.number().int().positive().default(5000),
    circuitBreaker: z.object({
      failureThreshold: z.number().int().positive().optional(),
      timeout: z.number().int().positive().optional()
    }).optional(),
    retry: z.object({
      maxAttempts: z.number().int().positive().optional(),
      baseDelay: z.number().int().positive().optional()
    }).optional()
  })).default({})
});

/**
 * Main application configuration schema
 */
export const ApplicationConfigSchema = z.object({
  // Schema metadata
  $schema: z.object({
    version: z.string().default('1.0.0'),
    description: z.string().default('CCTelegram Bridge Configuration'),
    lastUpdated: z.string().datetime().default(new Date().toISOString())
  }).default({}),

  // Base configuration
  base: BaseConfigSchema,
  
  // Component configurations
  server: ServerConfigSchema,
  database: DatabaseConfigSchema.optional(),
  telegram: TelegramConfigSchema,
  security: SecurityConfigSchema,
  monitoring: MonitoringConfigSchema,
  cache: CacheConfigSchema,
  fileSystem: FileSystemConfigSchema,
  resilience: ResilienceConfigSchema
});

/**
 * Configuration types
 */
export type BaseConfig = z.infer<typeof BaseConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type FileSystemConfig = z.infer<typeof FileSystemConfigSchema>;
export type ApplicationConfig = z.infer<typeof ApplicationConfigSchema>;

/**
 * Environment variable mapping
 */
export const EnvironmentMappings = {
  // Base configuration
  'NODE_ENV': 'base.environment',
  'LOG_LEVEL': 'base.logLevel',
  'ENABLE_METRICS': 'base.enableMetrics',
  'ENABLE_TRACING': 'base.enableTracing',
  'ENABLE_PROFILING': 'base.enableProfiling',

  // Server configuration
  'SERVER_HOST': 'server.host',
  'SERVER_PORT': 'server.port',
  'SERVER_MAX_CONNECTIONS': 'server.maxConnections',
  'SERVER_REQUEST_TIMEOUT': 'server.requestTimeout',
  'ENABLE_CORS': 'server.enableCors',
  'CORS_ORIGINS': 'server.corsOrigins',
  'ENABLE_HTTPS': 'server.enableHttps',
  'SSL_CERT_PATH': 'server.sslCertPath',
  'SSL_KEY_PATH': 'server.sslKeyPath',

  // Database configuration
  'DATABASE_URL': 'database.connectionString',
  'DB_HOST': 'database.host',
  'DB_PORT': 'database.port',
  'DB_NAME': 'database.database',
  'DB_USER': 'database.username',
  'DB_PASSWORD': 'database.password',
  'DB_MAX_CONNECTIONS': 'database.maxConnections',
  'DB_ENABLE_SSL': 'database.enableSsl',

  // Telegram configuration
  'TELEGRAM_BOT_TOKEN': 'telegram.botToken',
  'TELEGRAM_CHAT_ID': 'telegram.chatId',
  'TELEGRAM_API_URL': 'telegram.apiUrl',
  'TELEGRAM_WEBHOOK_URL': 'telegram.webhookUrl',
  'TELEGRAM_WEBHOOK_SECRET': 'telegram.webhookSecret',
  'TELEGRAM_MAX_RETRIES': 'telegram.maxRetries',

  // Security configuration
  'ENABLE_ENCRYPTION': 'security.enableEncryption',
  'ENCRYPTION_KEY': 'security.encryptionKey',
  'JWT_SECRET': 'security.jwtSecret',
  'JWT_EXPIRES_IN': 'security.jwtExpiresIn',
  'ENABLE_RATE_LIMITING': 'security.enableRateLimiting',
  'CSRF_SECRET': 'security.csrfSecret',

  // Monitoring configuration
  'ENABLE_HEALTH_CHECKS': 'monitoring.enableHealthChecks',
  'METRICS_PORT': 'monitoring.metricsPort',
  'ENABLE_PROMETHEUS': 'monitoring.enablePrometheus',
  'PROMETHEUS_ENDPOINT': 'monitoring.prometheusEndpoint',
  'TRACING_ENDPOINT': 'monitoring.tracingEndpoint',

  // Cache configuration
  'ENABLE_CACHE': 'cache.enableCache',
  'CACHE_TYPE': 'cache.cacheType',
  'REDIS_URL': 'cache.redisUrl',
  'REDIS_PASSWORD': 'cache.redisPassword',
  'CACHE_DEFAULT_TTL': 'cache.defaultTtl',

  // File system configuration
  'DATA_DIRECTORY': 'fileSystem.dataDirectory',
  'TEMP_DIRECTORY': 'fileSystem.tempDirectory',
  'LOGS_DIRECTORY': 'fileSystem.logsDirectory',
  'BACKUP_DIRECTORY': 'fileSystem.backupDirectory',
  'ENABLE_BACKUP': 'fileSystem.enableBackup'
} as const;

/**
 * Configuration validation function
 */
export function validateConfiguration(config: unknown): { 
  success: boolean; 
  data?: ApplicationConfig; 
  error?: z.ZodError;
  warnings?: string[];
} {
  try {
    const result = ApplicationConfigSchema.safeParse(config);
    
    if (result.success) {
      const warnings: string[] = [];
      
      // Check for potential security issues
      if (result.data.security.enableAuthentication && !result.data.security.jwtSecret) {
        warnings.push('JWT authentication is enabled but no JWT secret is configured');
      }
      
      if (result.data.security.enableEncryption && !result.data.security.encryptionKey) {
        warnings.push('Encryption is enabled but no encryption key is configured');
      }
      
      if (result.data.base.environment === 'production' && result.data.base.logLevel === 'debug') {
        warnings.push('Debug logging is enabled in production environment');
      }
      
      if (!result.data.server.enableHttps && result.data.base.environment === 'production') {
        warnings.push('HTTPS is disabled in production environment');
      }
      
      return {
        success: true,
        data: result.data,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    }
    
    return {
      success: false,
      error: result.error
    };
  } catch (error) {
    return {
      success: false,
      error: error as z.ZodError
    };
  }
}

/**
 * Generate configuration template
 */
export function generateConfigTemplate(environment: 'development' | 'staging' | 'production'): Partial<ApplicationConfig> {
  const baseTemplate = {
    $schema: {
      version: '1.0.0',
      description: `CCTelegram Bridge Configuration - ${environment}`,
      lastUpdated: new Date().toISOString()
    },
    base: {
      environment,
      logLevel: environment === 'production' ? 'info' as const : 'debug' as const,
      enableMetrics: true,
      enableTracing: environment !== 'development',
      enableProfiling: environment === 'development'
    },
    server: {
      host: environment === 'production' ? '0.0.0.0' : 'localhost',
      port: environment === 'production' ? 443 : 8080,
      enableHttps: environment === 'production',
      enableCors: environment !== 'production'
    },
    security: {
      enableAuthentication: environment !== 'development',
      enableRateLimiting: true,
      enableCsrfProtection: environment === 'production',
      enableHelmet: environment === 'production'
    },
    monitoring: {
      enableHealthChecks: true,
      enableMetricsCollection: true,
      enablePrometheus: environment === 'production',
      enableTracing: environment !== 'development'
    }
  };

  return baseTemplate;
}

/**
 * Configuration schema utilities
 */
export const ConfigSchemaUtils = {
  /**
   * Get schema for specific configuration section
   */
  getSchemaForSection(section: keyof ApplicationConfig): z.ZodTypeAny {
    const schemas = {
      $schema: ApplicationConfigSchema.shape.$schema,
      base: BaseConfigSchema,
      server: ServerConfigSchema,
      database: DatabaseConfigSchema,
      telegram: TelegramConfigSchema,
      security: SecurityConfigSchema,
      monitoring: MonitoringConfigSchema,
      cache: CacheConfigSchema,
      fileSystem: FileSystemConfigSchema,
      resilience: ResilienceConfigSchema
    };
    
    return schemas[section];
  },

  /**
   * Validate specific configuration section
   */
  validateSection(section: keyof ApplicationConfig, config: unknown): {
    success: boolean;
    data?: any;
    error?: z.ZodError;
  } {
    const schema = this.getSchemaForSection(section);
    const result = schema.safeParse(config);
    
    return {
      success: result.success,
      data: result.success ? result.data : undefined,
      error: result.success ? undefined : result.error
    };
  },

  /**
   * Get environment variable mappings for a section
   */
  getEnvironmentMappingsForSection(section: keyof ApplicationConfig): Record<string, string> {
    const sectionPrefix = section === 'base' ? '' : `${section}.`;
    const mappings: Record<string, string> = {};
    
    Object.entries(EnvironmentMappings).forEach(([envVar, configPath]) => {
      if (configPath.startsWith(sectionPrefix)) {
        mappings[envVar] = configPath;
      }
    });
    
    return mappings;
  },

  /**
   * Generate schema documentation
   */
  generateSchemaDocumentation(): string {
    // This would generate comprehensive documentation
    // For now, return a basic description
    return `
# Configuration Schema Documentation

## Sections

### Base Configuration
- environment: Application environment (development, staging, production)
- logLevel: Logging verbosity level
- enableMetrics: Enable metrics collection
- enableTracing: Enable distributed tracing
- enableProfiling: Enable performance profiling

### Server Configuration
- host: Server bind address
- port: Server port number
- maxConnections: Maximum concurrent connections
- requestTimeout: Request timeout in milliseconds
- enableCors: Enable CORS support
- enableHttps: Enable HTTPS/TLS

### Database Configuration
- connectionString: Database connection URL
- host: Database host
- port: Database port
- database: Database name
- username: Database username
- password: Database password

### Telegram Configuration
- botToken: Telegram bot token
- chatId: Target chat ID
- apiUrl: Telegram API base URL
- maxRetries: Maximum retry attempts
- enableWebhook: Enable webhook mode

### Security Configuration
- enableEncryption: Enable data encryption
- encryptionKey: Encryption key
- enableAuthentication: Enable authentication
- jwtSecret: JWT signing secret
- enableRateLimiting: Enable rate limiting

### Monitoring Configuration
- enableHealthChecks: Enable health check endpoints
- enableMetricsCollection: Enable metrics collection
- enablePrometheus: Enable Prometheus metrics
- enableTracing: Enable distributed tracing

### Cache Configuration
- enableCache: Enable caching
- cacheType: Cache backend type (memory, redis, file)
- defaultTtl: Default cache TTL in milliseconds

### File System Configuration
- dataDirectory: Data storage directory
- tempDirectory: Temporary files directory
- logsDirectory: Log files directory
- enableBackup: Enable automatic backups

### Resilience Configuration
- Circuit breaker settings
- Retry policies
- Health check configuration
- Recovery strategies
- Monitoring and alerting
    `;
  }
};
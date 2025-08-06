/**
 * Configuration Validation Middleware
 * 
 * Provides comprehensive configuration validation that runs on startup and configuration changes,
 * with detailed error messages, security checks, and environment-specific validation rules.
 */

import { EventEmitter } from 'events';
import { ApplicationConfig, validateConfiguration, ConfigSchemaUtils } from './config-schema.js';
import { EnvironmentConfigManager } from './environment-config.js';
import { secureLog } from '../security.js';

export interface ValidationRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  environments?: ('development' | 'staging' | 'production' | 'test')[];
  validate: (config: ApplicationConfig) => ValidationResult;
}

export interface ValidationResult {
  passed: boolean;
  message: string;
  details?: any;
  suggestion?: string;
  documentationLink?: string;
}

export interface ValidationReport {
  valid: boolean;
  timestamp: Date;
  environment: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    errors: number;
  };
  results: Array<{
    rule: string;
    severity: string;
    passed: boolean;
    message: string;
    details?: any;
    suggestion?: string;
    documentationLink?: string;
  }>;
  recommendations: string[];
  securityIssues: string[];
  performanceWarnings: string[];
}

export interface ValidationOptions {
  enableSecurityChecks?: boolean;
  enablePerformanceChecks?: boolean;
  enableEnvironmentSpecificChecks?: boolean;
  includeWarnings?: boolean;
  strictMode?: boolean;
  customRules?: ValidationRule[];
}

export class ConfigurationValidationMiddleware extends EventEmitter {
  private validationRules: Map<string, ValidationRule> = new Map();
  private lastValidationReport: ValidationReport | null = null;
  private options: Required<ValidationOptions>;

  constructor(options: ValidationOptions = {}) {
    super();
    
    this.options = {
      enableSecurityChecks: options.enableSecurityChecks ?? true,
      enablePerformanceChecks: options.enablePerformanceChecks ?? true,
      enableEnvironmentSpecificChecks: options.enableEnvironmentSpecificChecks ?? true,
      includeWarnings: options.includeWarnings ?? true,
      strictMode: options.strictMode ?? false,
      customRules: options.customRules ?? []
    };

    this.registerBuiltInRules();
    this.registerCustomRules(this.options.customRules);
  }

  /**
   * Register built-in validation rules
   */
  private registerBuiltInRules(): void {
    // Security validation rules
    if (this.options.enableSecurityChecks) {
      this.registerSecurityRules();
    }

    // Performance validation rules
    if (this.options.enablePerformanceChecks) {
      this.registerPerformanceRules();
    }

    // Environment-specific validation rules
    if (this.options.enableEnvironmentSpecificChecks) {
      this.registerEnvironmentRules();
    }

    // General configuration rules
    this.registerGeneralRules();
  }

  /**
   * Register security validation rules
   */
  private registerSecurityRules(): void {
    this.registerRule({
      name: 'jwt-secret-required',
      description: 'JWT secret must be configured when authentication is enabled',
      severity: 'error',
      validate: (config) => {
        if (config.security.enableAuthentication && !config.security.jwtSecret) {
          return {
            passed: false,
            message: 'JWT authentication is enabled but no JWT secret is configured',
            suggestion: 'Set SECURITY_JWT_SECRET environment variable or configure security.jwtSecret',
            documentationLink: 'https://docs.example.com/security/jwt'
          };
        }
        return { passed: true, message: 'JWT secret validation passed' };
      }
    });

    this.registerRule({
      name: 'encryption-key-required',
      description: 'Encryption key must be configured when encryption is enabled',
      severity: 'error',
      validate: (config) => {
        if (config.security.enableEncryption && !config.security.encryptionKey) {
          return {
            passed: false,
            message: 'Encryption is enabled but no encryption key is configured',
            suggestion: 'Set SECURITY_ENCRYPTION_KEY environment variable or configure security.encryptionKey',
            documentationLink: 'https://docs.example.com/security/encryption'
          };
        }
        return { passed: true, message: 'Encryption key validation passed' };
      }
    });

    this.registerRule({
      name: 'csrf-secret-required',
      description: 'CSRF secret must be configured when CSRF protection is enabled',
      severity: 'error',
      environments: ['production', 'staging'],
      validate: (config) => {
        if (config.security.enableCsrfProtection && !config.security.csrfSecret) {
          return {
            passed: false,
            message: 'CSRF protection is enabled but no CSRF secret is configured',
            suggestion: 'Set SECURITY_CSRF_SECRET environment variable or configure security.csrfSecret'
          };
        }
        return { passed: true, message: 'CSRF secret validation passed' };
      }
    });

    this.registerRule({
      name: 'https-required-production',
      description: 'HTTPS must be enabled in production environment',
      severity: 'error',
      environments: ['production'],
      validate: (config) => {
        if (config.base.environment === 'production' && !config.server.enableHttps) {
          return {
            passed: false,
            message: 'HTTPS is disabled in production environment',
            suggestion: 'Enable HTTPS by setting server.enableHttps to true and configuring SSL certificates'
          };
        }
        return { passed: true, message: 'HTTPS configuration validated' };
      }
    });

    this.registerRule({
      name: 'weak-jwt-secret',
      description: 'JWT secret should be sufficiently complex',
      severity: 'warning',
      validate: (config) => {
        if (config.security.jwtSecret && config.security.jwtSecret.length < 32) {
          return {
            passed: false,
            message: 'JWT secret is shorter than recommended minimum of 32 characters',
            suggestion: 'Use a longer, more complex JWT secret for better security'
          };
        }
        return { passed: true, message: 'JWT secret complexity validated' };
      }
    });

    this.registerRule({
      name: 'rate-limiting-enabled',
      description: 'Rate limiting should be enabled for security',
      severity: 'warning',
      environments: ['production', 'staging'],
      validate: (config) => {
        if (!config.security.enableRateLimiting) {
          return {
            passed: false,
            message: 'Rate limiting is disabled',
            suggestion: 'Enable rate limiting to protect against abuse'
          };
        }
        return { passed: true, message: 'Rate limiting is enabled' };
      }
    });
  }

  /**
   * Register performance validation rules
   */
  private registerPerformanceRules(): void {
    this.registerRule({
      name: 'connection-pool-size',
      description: 'Database connection pool size should be appropriate',
      severity: 'warning',
      validate: (config) => {
        if (config.database && config.database.maxConnections > 50) {
          return {
            passed: false,
            message: 'Database connection pool size is very large',
            details: { maxConnections: config.database.maxConnections },
            suggestion: 'Consider reducing database.maxConnections for better resource usage'
          };
        }
        return { passed: true, message: 'Database connection pool size is appropriate' };
      }
    });

    this.registerRule({
      name: 'request-timeout-reasonable',
      description: 'Request timeout should be reasonable',
      severity: 'warning',
      validate: (config) => {
        if (config.server.requestTimeout > 60000) {
          return {
            passed: false,
            message: 'Server request timeout is very high',
            details: { timeout: config.server.requestTimeout },
            suggestion: 'Consider reducing server.requestTimeout to prevent hanging requests'
          };
        }
        return { passed: true, message: 'Request timeout is reasonable' };
      }
    });

    this.registerRule({
      name: 'cache-memory-usage',
      description: 'Cache memory usage should be limited',
      severity: 'warning',
      validate: (config) => {
        const maxMemoryMB = config.cache.maxMemoryUsage / (1024 * 1024);
        if (maxMemoryMB > 500) {
          return {
            passed: false,
            message: 'Cache memory usage limit is very high',
            details: { maxMemoryMB },
            suggestion: 'Consider reducing cache.maxMemoryUsage to prevent memory issues'
          };
        }
        return { passed: true, message: 'Cache memory usage limit is appropriate' };
      }
    });

    this.registerRule({
      name: 'log-rotation-enabled',
      description: 'Log rotation should be enabled to prevent disk space issues',
      severity: 'warning',
      environments: ['production', 'staging'],
      validate: (config) => {
        if (!config.monitoring.enableLogRotation) {
          return {
            passed: false,
            message: 'Log rotation is disabled',
            suggestion: 'Enable log rotation to prevent disk space issues'
          };
        }
        return { passed: true, message: 'Log rotation is enabled' };
      }
    });
  }

  /**
   * Register environment-specific validation rules
   */
  private registerEnvironmentRules(): void {
    this.registerRule({
      name: 'debug-logging-production',
      description: 'Debug logging should not be enabled in production',
      severity: 'warning',
      environments: ['production'],
      validate: (config) => {
        if (config.base.environment === 'production' && config.base.logLevel === 'debug') {
          return {
            passed: false,
            message: 'Debug logging is enabled in production environment',
            suggestion: 'Change log level to "info" or "warn" for production'
          };
        }
        return { passed: true, message: 'Log level is appropriate for production' };
      }
    });

    this.registerRule({
      name: 'cors-restricted-production',
      description: 'CORS should be restricted in production',
      severity: 'warning',
      environments: ['production'],
      validate: (config) => {
        if (config.base.environment === 'production' && 
            config.server.enableCors && 
            config.server.corsOrigins.includes('*')) {
          return {
            passed: false,
            message: 'CORS allows all origins in production environment',
            suggestion: 'Restrict CORS origins to specific domains in production'
          };
        }
        return { passed: true, message: 'CORS configuration is appropriate for production' };
      }
    });

    this.registerRule({
      name: 'monitoring-enabled-production',
      description: 'Comprehensive monitoring should be enabled in production',
      severity: 'warning',
      environments: ['production'],
      validate: (config) => {
        const issues = [];
        if (!config.monitoring.enableHealthChecks) issues.push('health checks');
        if (!config.monitoring.enableMetricsCollection) issues.push('metrics collection');
        if (!config.monitoring.enablePrometheus) issues.push('Prometheus metrics');

        if (issues.length > 0) {
          return {
            passed: false,
            message: `Monitoring features disabled in production: ${issues.join(', ')}`,
            suggestion: 'Enable comprehensive monitoring in production environment'
          };
        }
        return { passed: true, message: 'Monitoring is properly configured for production' };
      }
    });

    this.registerRule({
      name: 'telegram-webhook-production',
      description: 'Telegram webhook should be configured for production',
      severity: 'info',
      environments: ['production'],
      validate: (config) => {
        if (!config.telegram.enableWebhook) {
          return {
            passed: false,
            message: 'Telegram webhook is not enabled in production',
            suggestion: 'Consider enabling webhook mode for better performance in production'
          };
        }
        return { passed: true, message: 'Telegram webhook is enabled' };
      }
    });
  }

  /**
   * Register general validation rules
   */
  private registerGeneralRules(): void {
    this.registerRule({
      name: 'telegram-credentials-required',
      description: 'Telegram bot credentials must be configured',
      severity: 'error',
      validate: (config) => {
        if (!config.telegram.botToken) {
          return {
            passed: false,
            message: 'Telegram bot token is not configured',
            suggestion: 'Set TELEGRAM_BOT_TOKEN environment variable'
          };
        }
        if (!config.telegram.chatId) {
          return {
            passed: false,
            message: 'Telegram chat ID is not configured',
            suggestion: 'Set TELEGRAM_CHAT_ID environment variable'
          };
        }
        return { passed: true, message: 'Telegram credentials are configured' };
      }
    });

    this.registerRule({
      name: 'server-port-valid',
      description: 'Server port must be valid and available',
      severity: 'error',
      validate: (config) => {
        if (config.server.port < 1024 || config.server.port > 65535) {
          return {
            passed: false,
            message: 'Server port is outside valid range (1024-65535)',
            details: { port: config.server.port },
            suggestion: 'Configure a valid port number between 1024 and 65535'
          };
        }
        return { passed: true, message: 'Server port is valid' };
      }
    });

    this.registerRule({
      name: 'resilience-enabled',
      description: 'Resilience features should be enabled',
      severity: 'warning',
      environments: ['production', 'staging'],
      validate: (config) => {
        if (!config.resilience.enabled) {
          return {
            passed: false,
            message: 'Resilience features are disabled',
            suggestion: 'Enable resilience features for better system stability'
          };
        }
        return { passed: true, message: 'Resilience features are enabled' };
      }
    });

    this.registerRule({
      name: 'health-check-endpoints',
      description: 'Health check endpoints should be configured',
      severity: 'warning',
      validate: (config) => {
        if (config.resilience.health.enabled && config.resilience.health.endpoints.length === 0) {
          return {
            passed: false,
            message: 'Health checks are enabled but no endpoints are configured',
            suggestion: 'Configure health check endpoints for monitoring'
          };
        }
        return { passed: true, message: 'Health check endpoints are properly configured' };
      }
    });
  }

  /**
   * Register custom validation rules
   */
  private registerCustomRules(rules: ValidationRule[]): void {
    rules.forEach(rule => this.registerRule(rule));
  }

  /**
   * Register a validation rule
   */
  public registerRule(rule: ValidationRule): void {
    if (this.validationRules.has(rule.name)) {
      throw new Error(`Validation rule '${rule.name}' is already registered`);
    }

    this.validationRules.set(rule.name, rule);
    
    secureLog('debug', 'Validation rule registered', {
      name: rule.name,
      severity: rule.severity,
      environments: rule.environments?.join(', ') || 'all'
    });
  }

  /**
   * Validate configuration and generate comprehensive report
   */
  public async validateConfiguration(config: ApplicationConfig): Promise<ValidationReport> {
    const startTime = Date.now();
    
    secureLog('info', 'Starting configuration validation', {
      environment: config.base.environment,
      rules_count: this.validationRules.size
    });

    // First, validate against the schema
    const schemaValidation = validateConfiguration(config);
    
    const report: ValidationReport = {
      valid: schemaValidation.success,
      timestamp: new Date(),
      environment: config.base.environment,
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        warnings: 0,
        errors: 0
      },
      results: [],
      recommendations: [],
      securityIssues: [],
      performanceWarnings: []
    };

    // Add schema validation results
    if (!schemaValidation.success) {
      report.results.push({
        rule: 'schema-validation',
        severity: 'error',
        passed: false,
        message: `Schema validation failed: ${schemaValidation.error?.message}`,
        suggestion: 'Fix configuration schema violations'
      });
      report.summary.errors++;
    }

    // Add schema warnings
    if (schemaValidation.warnings) {
      schemaValidation.warnings.forEach(warning => {
        report.results.push({
          rule: 'schema-warning',
          severity: 'warning',
          passed: false,
          message: warning,
          suggestion: 'Review configuration warnings'
        });
        report.summary.warnings++;
      });
    }

    // Run validation rules
    for (const [ruleName, rule] of this.validationRules) {
      try {
        // Check if rule applies to current environment
        if (rule.environments && !rule.environments.includes(config.base.environment as any)) {
          continue;
        }

        // Skip warnings in strict mode if not including warnings
        if (!this.options.includeWarnings && rule.severity === 'warning') {
          continue;
        }

        const result = rule.validate(config);
        
        report.results.push({
          rule: ruleName,
          severity: rule.severity,
          passed: result.passed,
          message: result.message,
          details: result.details,
          suggestion: result.suggestion,
          documentationLink: result.documentationLink
        });

        report.summary.total++;
        
        if (result.passed) {
          report.summary.passed++;
        } else {
          report.summary.failed++;
          
          if (rule.severity === 'error') {
            report.summary.errors++;
            report.valid = false;
          } else if (rule.severity === 'warning') {
            report.summary.warnings++;
          }

          // Categorize issues
          if (ruleName.includes('security') || ruleName.includes('jwt') || 
              ruleName.includes('encryption') || ruleName.includes('csrf')) {
            report.securityIssues.push(result.message);
          }
          
          if (ruleName.includes('performance') || ruleName.includes('timeout') || 
              ruleName.includes('memory') || ruleName.includes('connection')) {
            report.performanceWarnings.push(result.message);
          }
        }

        // Add suggestions as recommendations
        if (!result.passed && result.suggestion) {
          report.recommendations.push(result.suggestion);
        }

      } catch (error) {
        secureLog('error', 'Validation rule execution failed', {
          rule: ruleName,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        report.results.push({
          rule: ruleName,
          severity: 'error',
          passed: false,
          message: `Validation rule failed to execute: ${error instanceof Error ? error.message : 'Unknown error'}`,
          suggestion: 'Check validation rule implementation'
        });

        report.summary.total++;
        report.summary.failed++;
        report.summary.errors++;
        report.valid = false;
      }
    }

    // In strict mode, warnings also fail validation
    if (this.options.strictMode && report.summary.warnings > 0) {
      report.valid = false;
    }

    const duration = Date.now() - startTime;
    
    secureLog('info', 'Configuration validation completed', {
      valid: report.valid,
      total: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      warnings: report.summary.warnings,
      errors: report.summary.errors,
      duration
    });

    this.lastValidationReport = report;
    this.emit('validationCompleted', report);

    return report;
  }

  /**
   * Validate configuration and throw on failure
   */
  public async validateConfigurationStrict(config: ApplicationConfig): Promise<void> {
    const report = await this.validateConfiguration(config);
    
    if (!report.valid) {
      const errorMessages = report.results
        .filter(r => !r.passed && r.severity === 'error')
        .map(r => r.message);
      
      throw new Error(`Configuration validation failed:\n${errorMessages.join('\n')}`);
    }
  }

  /**
   * Get validation middleware for startup
   */
  public getStartupValidationMiddleware() {
    return async (configManager: EnvironmentConfigManager): Promise<void> => {
      try {
        const config = configManager.getConfiguration();
        await this.validateConfigurationStrict(config);
        
        secureLog('info', 'Startup configuration validation passed');
      } catch (error) {
        secureLog('error', 'Startup configuration validation failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (this.options.strictMode) {
          throw error;
        }
      }
    };
  }

  /**
   * Get validation middleware for configuration changes
   */
  public getHotReloadValidationMiddleware() {
    return async (config: ApplicationConfig): Promise<void> => {
      const report = await this.validateConfiguration(config);
      
      if (!report.valid && this.options.strictMode) {
        throw new Error('Configuration validation failed during hot reload');
      }
      
      if (report.summary.warnings > 0) {
        secureLog('warn', 'Configuration validation warnings during hot reload', {
          warnings: report.summary.warnings
        });
      }
    };
  }

  /**
   * Get last validation report
   */
  public getLastValidationReport(): ValidationReport | null {
    return this.lastValidationReport;
  }

  /**
   * Generate validation report summary
   */
  public generateValidationSummary(report: ValidationReport): string {
    const lines = [
      '='.repeat(60),
      'CONFIGURATION VALIDATION REPORT',
      '='.repeat(60),
      '',
      `Environment: ${report.environment}`,
      `Timestamp: ${report.timestamp.toISOString()}`,
      `Overall Status: ${report.valid ? 'VALID' : 'INVALID'}`,
      '',
      'Summary:',
      `  Total Rules: ${report.summary.total}`,
      `  Passed: ${report.summary.passed}`,
      `  Failed: ${report.summary.failed}`,
      `  Errors: ${report.summary.errors}`,
      `  Warnings: ${report.summary.warnings}`,
      ''
    ];

    if (report.summary.errors > 0) {
      lines.push('ERRORS:', '');
      report.results
        .filter(r => !r.passed && r.severity === 'error')
        .forEach(r => {
          lines.push(`  ❌ ${r.rule}: ${r.message}`);
          if (r.suggestion) {
            lines.push(`     💡 ${r.suggestion}`);
          }
          lines.push('');
        });
    }

    if (report.summary.warnings > 0 && this.options.includeWarnings) {
      lines.push('WARNINGS:', '');
      report.results
        .filter(r => !r.passed && r.severity === 'warning')
        .forEach(r => {
          lines.push(`  ⚠️  ${r.rule}: ${r.message}`);
          if (r.suggestion) {
            lines.push(`     💡 ${r.suggestion}`);
          }
          lines.push('');
        });
    }

    if (report.securityIssues.length > 0) {
      lines.push('SECURITY ISSUES:', '');
      report.securityIssues.forEach(issue => {
        lines.push(`  🔒 ${issue}`);
      });
      lines.push('');
    }

    if (report.performanceWarnings.length > 0) {
      lines.push('PERFORMANCE WARNINGS:', '');
      report.performanceWarnings.forEach(warning => {
        lines.push(`  ⚡ ${warning}`);
      });
      lines.push('');
    }

    if (report.recommendations.length > 0) {
      lines.push('RECOMMENDATIONS:', '');
      report.recommendations.forEach((rec, index) => {
        lines.push(`  ${index + 1}. ${rec}`);
      });
      lines.push('');
    }

    lines.push('='.repeat(60));

    return lines.join('\n');
  }

  /**
   * Get validation rules list
   */
  public getValidationRules(): ValidationRule[] {
    return Array.from(this.validationRules.values());
  }

  /**
   * Remove validation rule
   */
  public unregisterRule(ruleName: string): void {
    this.validationRules.delete(ruleName);
    secureLog('debug', 'Validation rule unregistered', { name: ruleName });
  }

  /**
   * Clear all validation rules
   */
  public clearRules(): void {
    this.validationRules.clear();
    secureLog('debug', 'All validation rules cleared');
  }
}
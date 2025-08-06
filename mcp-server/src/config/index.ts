/**
 * Configuration Management System - Main Entry Point
 * 
 * Comprehensive configuration management system with schema validation, environment-specific
 * configurations, hot-reload, caching, migration, and observability integration.
 */

import { EnvironmentConfigManager, Environment } from './environment-config.js';
import { ConfigurationMigrationManager } from './config-migration.js';
import { HotReloadManager } from './hot-reload-manager.js';
import { ConfigurationValidationMiddleware } from './validation-middleware.js';
import { ConfigurationCache } from './config-cache.js';
import { ConfigurationObservabilityIntegration } from './observability-integration.js';
import { ApplicationConfig } from './config-schema.js';
import { secureLog } from '../security.js';

export interface ConfigurationSystemOptions {
  environment?: Environment;
  configDirectory?: string;
  enableHotReload?: boolean;
  enableCaching?: boolean;
  enableMigration?: boolean;
  enableValidation?: boolean;
  enableObservability?: boolean;
  strictValidation?: boolean;
  cacheTTL?: number;
  hotReloadDebounce?: number;
}

export class ConfigurationSystem {
  private configManager: EnvironmentConfigManager;
  private migrationManager: ConfigurationMigrationManager;
  private hotReloadManager: HotReloadManager;
  private validationMiddleware: ConfigurationValidationMiddleware;
  private cache: ConfigurationCache;
  private observability: ConfigurationObservabilityIntegration;
  private options: Required<ConfigurationSystemOptions>;
  private initialized: boolean = false;

  constructor(options: ConfigurationSystemOptions = {}) {
    this.options = {
      environment: options.environment ?? 'development',
      configDirectory: options.configDirectory ?? './config',
      enableHotReload: options.enableHotReload ?? true,
      enableCaching: options.enableCaching ?? true,
      enableMigration: options.enableMigration ?? true,
      enableValidation: options.enableValidation ?? true,
      enableObservability: options.enableObservability ?? true,
      strictValidation: options.strictValidation ?? false,
      cacheTTL: options.cacheTTL ?? 300000, // 5 minutes
      hotReloadDebounce: options.hotReloadDebounce ?? 1000
    };

    this.initializeComponents();
    this.setupIntegrations();
  }

  /**
   * Initialize configuration system components
   */
  private initializeComponents(): void {
    // Initialize configuration manager
    this.configManager = new EnvironmentConfigManager({
      environment: this.options.environment,
      configDirectory: this.options.configDirectory
    });

    // Initialize migration manager
    if (this.options.enableMigration) {
      this.migrationManager = new ConfigurationMigrationManager(
        `${this.options.configDirectory}/backups`
      );
    }

    // Initialize validation middleware
    if (this.options.enableValidation) {
      this.validationMiddleware = new ConfigurationValidationMiddleware({
        strictMode: this.options.strictValidation,
        enableSecurityChecks: true,
        enablePerformanceChecks: true,
        enableEnvironmentSpecificChecks: true
      });
    }

    // Initialize cache
    if (this.options.enableCaching) {
      this.cache = new ConfigurationCache({
        defaultTTL: this.options.cacheTTL,
        enableChecksumValidation: true,
        enableFileWatching: true,
        enablePersistence: this.options.environment === 'production'
      });
    }

    // Initialize observability
    if (this.options.enableObservability) {
      this.observability = new ConfigurationObservabilityIntegration({
        enableMetrics: true,
        enableTracing: true,
        enableAuditLog: true,
        enableEventStreaming: true
      });
    }

    // Initialize hot reload manager
    if (this.options.enableHotReload) {
      this.hotReloadManager = new HotReloadManager(
        this.configManager,
        this.migrationManager,
        {
          enabled: true,
          watchPaths: [this.options.configDirectory],
          debounceDelay: this.options.hotReloadDebounce,
          enableMigration: this.options.enableMigration,
          validateBeforeReload: this.options.enableValidation
        }
      );
    }
  }

  /**
   * Setup integrations between components
   */
  private setupIntegrations(): void {
    if (!this.options.enableObservability) {
      return;
    }

    // Integrate hot reload with observability
    if (this.hotReloadManager && this.observability) {
      this.hotReloadManager.on('reloadCompleted', (context, result) => {
        const correlationId = this.observability.generateCorrelationId();
        this.observability.trackConfigurationReload(correlationId, context, result);
      });

      this.hotReloadManager.on('reloadError', (error, reloadId) => {
        const correlationId = this.observability.generateCorrelationId();
        this.observability.trackError(correlationId, error, 'hot-reload-manager', {
          reloadId,
          environment: this.options.environment
        });
      });
    }

    // Integrate cache with observability
    if (this.cache && this.observability) {
      this.cache.on('cached', ({ key }) => {
        const correlationId = this.observability.generateCorrelationId();
        this.observability.trackCacheOperation(correlationId, 'set', key);
      });

      this.cache.on('invalidated', ({ key }) => {
        const correlationId = this.observability.generateCorrelationId();
        this.observability.trackCacheOperation(correlationId, 'invalidate', key);
      });

      this.cache.on('evicted', ({ key }) => {
        const correlationId = this.observability.generateCorrelationId();
        this.observability.trackCacheOperation(correlationId, 'evict', key);
      });
    }

    // Integrate validation with observability
    if (this.validationMiddleware && this.observability) {
      this.validationMiddleware.on('validationCompleted', (report) => {
        const correlationId = this.observability.generateCorrelationId();
        this.observability.trackConfigurationValidation(
          correlationId,
          this.configManager.getConfiguration(),
          report,
          1000 // Placeholder duration
        );
      });
    }
  }

  /**
   * Initialize the configuration system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const correlationId = this.observability?.generateCorrelationId() || 'init';
    let span;

    try {
      // Start distributed trace if observability enabled
      if (this.observability) {
        span = this.observability.startTrace('configuration_system_init', correlationId);
        this.observability.addTraceTag(span.spanId, 'environment', this.options.environment);
      }

      secureLog('info', 'Initializing configuration system', {
        correlation_id: correlationId,
        environment: this.options.environment,
        config_directory: this.options.configDirectory
      });

      // Load initial configuration
      const config = await this.configManager.loadConfiguration();

      // Run migration if needed and enabled
      if (this.options.enableMigration && this.migrationManager) {
        const needsMigration = this.migrationManager.needsMigration(config);
        if (needsMigration) {
          secureLog('info', 'Configuration migration required', { correlation_id: correlationId });
          
          const migrationResult = await this.migrationManager.executeMigration(
            config,
            this.migrationManager.getLatestVersion()
          );

          if (this.observability) {
            this.observability.trackConfigurationMigration(correlationId, migrationResult, 1000);
          }

          if (!migrationResult.success) {
            throw new Error(`Configuration migration failed: ${migrationResult.errors.join(', ')}`);
          }
        }
      }

      // Validate configuration if enabled
      if (this.options.enableValidation && this.validationMiddleware) {
        const startTime = Date.now();
        const validationReport = await this.validationMiddleware.validateConfiguration(config);
        const duration = Date.now() - startTime;

        if (this.observability) {
          this.observability.trackConfigurationValidation(correlationId, config, validationReport, duration);
        }

        if (!validationReport.valid && this.options.strictValidation) {
          throw new Error('Configuration validation failed in strict mode');
        }
      }

      // Initialize cache
      if (this.cache) {
        const cacheKey = `config-${this.options.environment}`;
        await this.cache.set(cacheKey, config);
      }

      // Initialize hot reload
      if (this.hotReloadManager) {
        await this.hotReloadManager.initialize();
      }

      this.initialized = true;

      secureLog('info', 'Configuration system initialized successfully', {
        correlation_id: correlationId,
        environment: this.options.environment
      });

      if (span && this.observability) {
        this.observability.addTraceTag(span.spanId, 'success', true);
        this.observability.finishTrace(span.spanId, 'success');
      }

    } catch (error) {
      secureLog('error', 'Failed to initialize configuration system', {
        correlation_id: correlationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (this.observability) {
        this.observability.trackError(correlationId, error as Error, 'configuration-system', {
          environment: this.options.environment,
          phase: 'initialization'
        });

        if (span) {
          this.observability.finishTrace(span.spanId, 'error', (error as Error).message);
        }
      }

      throw error;
    }
  }

  /**
   * Get current configuration
   */
  public getConfiguration(): ApplicationConfig {
    if (!this.initialized) {
      throw new Error('Configuration system not initialized');
    }

    const correlationId = this.observability?.generateCorrelationId();
    
    // Try cache first if enabled
    if (this.cache && correlationId) {
      const cacheKey = `config-${this.options.environment}`;
      // Note: This would need to be made async in a real implementation
      this.observability?.trackCacheOperation(correlationId, 'hit', cacheKey);
    }

    return this.configManager.getConfiguration();
  }

  /**
   * Reload configuration manually
   */
  public async reloadConfiguration(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Configuration system not initialized');
    }

    if (!this.hotReloadManager) {
      throw new Error('Hot reload is not enabled');
    }

    const correlationId = this.observability?.generateCorrelationId() || 'manual-reload';
    
    secureLog('info', 'Manual configuration reload triggered', {
      correlation_id: correlationId
    });

    await this.hotReloadManager.reloadConfiguration({
      trigger: 'manual'
    });
  }

  /**
   * Validate current configuration
   */
  public async validateConfiguration(): Promise<boolean> {
    if (!this.initialized) {
      throw new Error('Configuration system not initialized');
    }

    if (!this.validationMiddleware) {
      throw new Error('Validation is not enabled');
    }

    const config = this.getConfiguration();
    const correlationId = this.observability?.generateCorrelationId() || 'validation';
    
    const startTime = Date.now();
    const report = await this.validationMiddleware.validateConfiguration(config);
    const duration = Date.now() - startTime;

    if (this.observability) {
      this.observability.trackConfigurationValidation(correlationId, config, report, duration);
    }

    return report.valid;
  }

  /**
   * Get system metrics
   */
  public getMetrics(): any {
    if (!this.observability) {
      throw new Error('Observability is not enabled');
    }

    return {
      configuration: this.observability.getMetrics(),
      cache: this.cache?.getMetrics(),
      hotReload: this.hotReloadManager?.getReloadStatistics(),
      validation: this.validationMiddleware?.getLastValidationReport()
    };
  }

  /**
   * Export observability data
   */
  public exportObservabilityData(): any {
    if (!this.observability) {
      throw new Error('Observability is not enabled');
    }

    return this.observability.exportObservabilityData();
  }

  /**
   * Shutdown configuration system
   */
  public async shutdown(): Promise<void> {
    secureLog('info', 'Shutting down configuration system');

    if (this.hotReloadManager) {
      await this.hotReloadManager.shutdown();
    }

    if (this.cache) {
      await this.cache.shutdown();
    }

    if (this.observability) {
      await this.observability.shutdown();
    }

    this.initialized = false;
  }
}

// Export all configuration system components
export {
  EnvironmentConfigManager,
  ConfigurationMigrationManager,
  HotReloadManager,
  ConfigurationValidationMiddleware,
  ConfigurationCache,
  ConfigurationObservabilityIntegration,
  ApplicationConfig,
  Environment
} from './config-schema.js';

export * from './environment-config.js';
export * from './config-migration.js';
export * from './hot-reload-manager.js';
export * from './validation-middleware.js';
export * from './config-cache.js';
export * from './observability-integration.js';

// Default export
export default ConfigurationSystem;
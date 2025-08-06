/**
 * Configuration Migration System
 * 
 * Implements semver-based configuration versioning with automatic schema upgrades,
 * rollback capabilities, and migration validation.
 */

import fs from 'fs-extra';
import path from 'path';
import semver from 'semver';
import { merge, cloneDeep } from 'lodash-es';
import { ApplicationConfig, validateConfiguration, generateConfigTemplate } from './config-schema.js';
import { secureLog } from '../security.js';

export interface ConfigurationMigration {
  version: string;
  name: string;
  description: string;
  up: (config: any) => any;
  down: (config: any) => any;
  validate?: (config: any) => boolean;
  required?: boolean;
  breaking?: boolean;
}

export interface MigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  appliedMigrations: string[];
  skippedMigrations: string[];
  errors: string[];
  warnings: string[];
  rollbackAvailable: boolean;
}

export interface MigrationPlan {
  currentVersion: string;
  targetVersion: string;
  migrations: ConfigurationMigration[];
  requiresBackup: boolean;
  hasBreakingChanges: boolean;
  estimatedDuration: number;
}

export class ConfigurationMigrationManager {
  private migrations: Map<string, ConfigurationMigration> = new Map();
  private migrationHistory: MigrationRecord[] = [];
  private backupDirectory: string;
  private currentVersion: string = '1.0.0';

  constructor(backupDirectory: string = './config/backups') {
    this.backupDirectory = backupDirectory;
    this.registerBuiltInMigrations();
  }

  /**
   * Register a configuration migration
   */
  public registerMigration(migration: ConfigurationMigration): void {
    if (!semver.valid(migration.version)) {
      throw new Error(`Invalid migration version: ${migration.version}`);
    }

    if (this.migrations.has(migration.version)) {
      throw new Error(`Migration for version ${migration.version} already exists`);
    }

    this.migrations.set(migration.version, migration);
    
    secureLog('debug', 'Migration registered', {
      version: migration.version,
      name: migration.name,
      breaking: migration.breaking || false
    });
  }

  /**
   * Register built-in migrations
   */
  private registerBuiltInMigrations(): void {
    // Migration from 0.x to 1.0.0
    this.registerMigration({
      version: '1.0.0',
      name: 'Initialize Configuration Schema',
      description: 'Initialize configuration with new schema structure',
      up: (config: any) => {
        const template = generateConfigTemplate('development');
        return merge(template, config);
      },
      down: (config: any) => {
        // Remove schema metadata for downgrade
        const { $schema, ...rest } = config;
        return rest;
      },
      validate: (config: any) => {
        return validateConfiguration(config).success;
      },
      required: true
    });

    // Migration for security enhancements
    this.registerMigration({
      version: '1.1.0',
      name: 'Enhanced Security Configuration',
      description: 'Add enhanced security configuration options',
      up: (config: any) => {
        return {
          ...config,
          security: {
            ...config.security,
            enableHelmet: config.base?.environment === 'production',
            helmetOptions: {
              contentSecurityPolicy: true,
              hsts: true,
              noSniff: true,
              xssFilter: true
            },
            trustedProxies: [],
            allowedHosts: ['localhost']
          }
        };
      },
      down: (config: any) => {
        const { enableHelmet, helmetOptions, trustedProxies, allowedHosts, ...security } = config.security || {};
        return {
          ...config,
          security
        };
      }
    });

    // Migration for monitoring improvements
    this.registerMigration({
      version: '1.2.0',
      name: 'Enhanced Monitoring Configuration',
      description: 'Add comprehensive monitoring and observability options',
      up: (config: any) => {
        return {
          ...config,
          monitoring: {
            ...config.monitoring,
            enableLogRotation: true,
            maxLogSize: '50MB',
            maxLogFiles: 10,
            enableTracing: config.base?.environment !== 'development',
            tracingEndpoint: undefined
          }
        };
      },
      down: (config: any) => {
        const { 
          enableLogRotation, 
          maxLogSize, 
          maxLogFiles, 
          enableTracing, 
          tracingEndpoint, 
          ...monitoring 
        } = config.monitoring || {};
        
        return {
          ...config,
          monitoring
        };
      }
    });

    // Migration for resilience configuration
    this.registerMigration({
      version: '1.3.0',
      name: 'Resilience Configuration Integration',
      description: 'Integrate comprehensive resilience configuration',
      up: (config: any) => {
        return {
          ...config,
          resilience: {
            enabled: true,
            environment: config.base?.environment || 'development',
            circuitBreaker: {
              bridge: {
                enabled: true,
                failureThreshold: 5,
                successThreshold: 3,
                timeout: 30000,
                monitoringWindow: 60000,
                maxConcurrentRequests: 10,
                volumeThreshold: 5
              },
              telegram: {
                enabled: true,
                failureThreshold: 3,
                successThreshold: 2,
                timeout: 15000,
                monitoringWindow: 30000,
                maxConcurrentRequests: 5,
                volumeThreshold: 3
              }
            },
            retry: {
              bridge: {
                enabled: true,
                maxAttempts: 3,
                baseDelay: 1000,
                maxDelay: 10000,
                exponentialBase: 2.0,
                jitterEnabled: true,
                jitterMax: 500,
                retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
                nonRetryableErrors: ['AUTH_FAILED', 'INVALID_INPUT']
              }
            },
            health: {
              enabled: true,
              interval: 30000,
              timeout: 5000,
              failureThreshold: 3,
              recoveryThreshold: 2,
              gracePeriod: 10000,
              endpoints: []
            },
            recovery: {
              enabled: true,
              autoRecoveryEnabled: true,
              maxRecoveryAttempts: 5,
              recoveryDelay: 5000,
              escalationThreshold: 3,
              gracefulShutdownTimeout: 30000,
              restartDelay: 2000,
              backupStrategies: []
            },
            monitoring: {
              enabled: true,
              metricsInterval: 10000,
              alertThresholds: {
                errorRate: 0.1,
                responseTime: 5000,
                memoryUsage: 0.8,
                cpuUsage: 0.8
              },
              retention: {
                metrics: 24 * 60 * 60 * 1000,
                events: 7 * 24 * 60 * 60 * 1000,
                logs: 3 * 24 * 60 * 60 * 1000
              },
              exporters: []
            },
            operations: {}
          }
        };
      },
      down: (config: any) => {
        const { resilience, ...rest } = config;
        return rest;
      },
      breaking: true
    });

    // Migration for cache configuration enhancements
    this.registerMigration({
      version: '1.4.0',
      name: 'Enhanced Cache Configuration',
      description: 'Add advanced caching options and Redis support',
      up: (config: any) => {
        return {
          ...config,
          cache: {
            ...config.cache,
            enableCompression: true,
            compressionThreshold: 1024,
            enablePersistence: false,
            persistenceInterval: 60000,
            maxMemoryUsage: 100 * 1024 * 1024 // 100MB
          }
        };
      },
      down: (config: any) => {
        const { 
          enableCompression, 
          compressionThreshold, 
          enablePersistence, 
          persistenceInterval, 
          maxMemoryUsage, 
          ...cache 
        } = config.cache || {};
        
        return {
          ...config,
          cache
        };
      }
    });
  }

  /**
   * Get current configuration version
   */
  public getCurrentVersion(config: any): string {
    if (config?.$schema?.version) {
      return config.$schema.version;
    }
    
    // Attempt to detect version based on configuration structure
    if (config?.resilience) {
      return '1.3.0';
    }
    
    if (config?.monitoring?.enableTracing !== undefined) {
      return '1.2.0';
    }
    
    if (config?.security?.enableHelmet !== undefined) {
      return '1.1.0';
    }
    
    if (config?.$schema) {
      return '1.0.0';
    }
    
    return '0.1.0';
  }

  /**
   * Create migration plan
   */
  public createMigrationPlan(fromVersion: string, toVersion: string): MigrationPlan {
    if (!semver.valid(fromVersion) || !semver.valid(toVersion)) {
      throw new Error('Invalid version format');
    }

    if (semver.gte(fromVersion, toVersion)) {
      throw new Error('Target version must be greater than current version');
    }

    const applicableMigrations = Array.from(this.migrations.values())
      .filter(migration => 
        semver.gt(migration.version, fromVersion) && 
        semver.lte(migration.version, toVersion)
      )
      .sort((a, b) => semver.compare(a.version, b.version));

    const hasBreakingChanges = applicableMigrations.some(m => m.breaking);
    const requiresBackup = hasBreakingChanges || applicableMigrations.length > 0;

    // Estimate duration (30 seconds per migration, +60 seconds for breaking changes)
    const estimatedDuration = applicableMigrations.length * 30000 + 
      (hasBreakingChanges ? 60000 : 0);

    return {
      currentVersion: fromVersion,
      targetVersion: toVersion,
      migrations: applicableMigrations,
      requiresBackup,
      hasBreakingChanges,
      estimatedDuration
    };
  }

  /**
   * Execute migration plan
   */
  public async executeMigration(
    config: any, 
    targetVersion: string,
    options: {
      createBackup?: boolean;
      dryRun?: boolean;
      stopOnError?: boolean;
    } = {}
  ): Promise<MigrationResult> {
    const currentVersion = this.getCurrentVersion(config);
    const plan = this.createMigrationPlan(currentVersion, targetVersion);
    
    secureLog('info', 'Starting configuration migration', {
      from_version: currentVersion,
      to_version: targetVersion,
      migrations_count: plan.migrations.length,
      has_breaking_changes: plan.hasBreakingChanges,
      dry_run: options.dryRun || false
    });

    const result: MigrationResult = {
      success: true,
      fromVersion: currentVersion,
      toVersion: targetVersion,
      appliedMigrations: [],
      skippedMigrations: [],
      errors: [],
      warnings: [],
      rollbackAvailable: false
    };

    let migratedConfig = cloneDeep(config);
    let backupPath: string | undefined;

    try {
      // Create backup if requested
      if (options.createBackup !== false && plan.requiresBackup && !options.dryRun) {
        backupPath = await this.createConfigBackup(config, currentVersion);
        result.rollbackAvailable = true;
        
        secureLog('info', 'Configuration backup created', {
          backup_path: backupPath
        });
      }

      // Execute migrations in order
      for (const migration of plan.migrations) {
        try {
          secureLog('debug', 'Applying migration', {
            version: migration.version,
            name: migration.name,
            breaking: migration.breaking || false
          });

          if (!options.dryRun) {
            // Apply migration
            migratedConfig = migration.up(migratedConfig);

            // Update schema version
            if (!migratedConfig.$schema) {
              migratedConfig.$schema = {};
            }
            migratedConfig.$schema.version = migration.version;
            migratedConfig.$schema.lastUpdated = new Date().toISOString();

            // Validate migrated configuration if validation function provided
            if (migration.validate && !migration.validate(migratedConfig)) {
              throw new Error(`Migration validation failed for version ${migration.version}`);
            }

            // Validate against schema
            const validation = validateConfiguration(migratedConfig);
            if (!validation.success) {
              throw new Error(`Schema validation failed after migration: ${validation.error?.message}`);
            }

            if (validation.warnings && validation.warnings.length > 0) {
              result.warnings.push(...validation.warnings.map(w => `${migration.version}: ${w}`));
            }

            // Record migration in history
            await this.recordMigration({
              version: migration.version,
              name: migration.name,
              appliedAt: new Date(),
              backupPath,
              success: true
            });
          }

          result.appliedMigrations.push(migration.version);
          
          secureLog('info', 'Migration applied successfully', {
            version: migration.version,
            name: migration.name
          });

        } catch (error) {
          const errorMessage = `Migration ${migration.version} failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.errors.push(errorMessage);
          
          secureLog('error', 'Migration failed', {
            version: migration.version,
            name: migration.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          if (migration.required || options.stopOnError) {
            result.success = false;
            break;
          } else {
            result.skippedMigrations.push(migration.version);
            result.warnings.push(`Skipped optional migration ${migration.version}`);
          }
        }
      }

      // Final validation
      if (result.success && !options.dryRun) {
        const finalValidation = validateConfiguration(migratedConfig);
        if (!finalValidation.success) {
          result.success = false;
          result.errors.push(`Final configuration validation failed: ${finalValidation.error?.message}`);
        }
      }

    } catch (error) {
      result.success = false;
      result.errors.push(`Migration execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      secureLog('error', 'Migration execution failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    secureLog('info', 'Configuration migration completed', {
      success: result.success,
      applied_migrations: result.appliedMigrations.length,
      errors: result.errors.length,
      warnings: result.warnings.length
    });

    // Return the original config if dry run, otherwise return migrated config
    return {
      ...result,
      migratedConfig: options.dryRun ? config : migratedConfig
    } as MigrationResult & { migratedConfig: any };
  }

  /**
   * Rollback to previous version
   */
  public async rollbackMigration(backupPath: string): Promise<{
    success: boolean;
    restoredVersion: string;
    error?: string;
  }> {
    try {
      if (!await fs.pathExists(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      const backupConfig = await fs.readJson(backupPath);
      const restoredVersion = this.getCurrentVersion(backupConfig);

      secureLog('info', 'Rolling back configuration', {
        backup_path: backupPath,
        restored_version: restoredVersion
      });

      // Validate backup configuration
      const validation = validateConfiguration(backupConfig);
      if (!validation.success) {
        throw new Error(`Backup configuration is invalid: ${validation.error?.message}`);
      }

      // Record rollback in history
      await this.recordMigration({
        version: restoredVersion,
        name: 'Rollback from backup',
        appliedAt: new Date(),
        backupPath,
        success: true,
        rollback: true
      });

      return {
        success: true,
        restoredVersion,
        restoredConfig: backupConfig
      } as any;

    } catch (error) {
      secureLog('error', 'Configuration rollback failed', {
        backup_path: backupPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        restoredVersion: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Create configuration backup
   */
  private async createConfigBackup(config: any, version: string): Promise<string> {
    await fs.ensureDir(this.backupDirectory);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `config-backup-v${version}-${timestamp}.json`;
    const backupPath = path.join(this.backupDirectory, backupFileName);

    await fs.writeJson(backupPath, config, { spaces: 2 });
    
    return backupPath;
  }

  /**
   * Record migration in history
   */
  private async recordMigration(record: MigrationRecord): Promise<void> {
    this.migrationHistory.push(record);
    
    const historyPath = path.join(this.backupDirectory, 'migration-history.json');
    await fs.ensureDir(path.dirname(historyPath));
    await fs.writeJson(historyPath, this.migrationHistory, { spaces: 2 });
  }

  /**
   * Get migration history
   */
  public async getMigrationHistory(): Promise<MigrationRecord[]> {
    const historyPath = path.join(this.backupDirectory, 'migration-history.json');
    
    if (await fs.pathExists(historyPath)) {
      this.migrationHistory = await fs.readJson(historyPath);
    }
    
    return this.migrationHistory;
  }

  /**
   * List available migrations
   */
  public listAvailableMigrations(): ConfigurationMigration[] {
    return Array.from(this.migrations.values())
      .sort((a, b) => semver.compare(a.version, b.version));
  }

  /**
   * Get latest available version
   */
  public getLatestVersion(): string {
    const migrations = this.listAvailableMigrations();
    return migrations.length > 0 ? migrations[migrations.length - 1].version : this.currentVersion;
  }

  /**
   * Check if migration is needed
   */
  public needsMigration(config: any, targetVersion?: string): boolean {
    const currentVersion = this.getCurrentVersion(config);
    const target = targetVersion || this.getLatestVersion();
    
    return semver.lt(currentVersion, target);
  }

  /**
   * Validate migration path
   */
  public validateMigrationPath(fromVersion: string, toVersion: string): {
    valid: boolean;
    missingMigrations: string[];
    error?: string;
  } {
    try {
      const plan = this.createMigrationPlan(fromVersion, toVersion);
      
      // Check for gaps in migration path
      const versions = [fromVersion, ...plan.migrations.map(m => m.version)];
      const missingMigrations: string[] = [];
      
      for (let i = 1; i < versions.length; i++) {
        const current = versions[i - 1];
        const next = versions[i];
        
        // Check if there are any missing intermediate versions
        const intermediate = Array.from(this.migrations.keys())
          .filter(v => semver.gt(v, current) && semver.lt(v, next))
          .sort(semver.compare);
        
        missingMigrations.push(...intermediate);
      }

      return {
        valid: missingMigrations.length === 0,
        missingMigrations
      };

    } catch (error) {
      return {
        valid: false,
        missingMigrations: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: Date;
  backupPath?: string;
  success: boolean;
  rollback?: boolean;
}

/**
 * Utility functions for migration management
 */
export const MigrationUtils = {
  /**
   * Extract configuration differences between versions
   */
  extractConfigDifferences(oldConfig: any, newConfig: any): {
    added: string[];
    removed: string[];
    modified: string[];
  } {
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    const findDifferences = (old: any, newer: any, path: string = '') => {
      if (typeof old !== typeof newer) {
        modified.push(path);
        return;
      }

      if (typeof old === 'object' && old !== null && newer !== null) {
        const oldKeys = Object.keys(old);
        const newKeys = Object.keys(newer);
        
        // Find added keys
        newKeys.filter(key => !oldKeys.includes(key))
          .forEach(key => added.push(path ? `${path}.${key}` : key));
        
        // Find removed keys
        oldKeys.filter(key => !newKeys.includes(key))
          .forEach(key => removed.push(path ? `${path}.${key}` : key));
        
        // Check modified keys
        oldKeys.filter(key => newKeys.includes(key))
          .forEach(key => {
            const newPath = path ? `${path}.${key}` : key;
            findDifferences(old[key], newer[key], newPath);
          });
      } else if (old !== newer) {
        modified.push(path);
      }
    };

    findDifferences(oldConfig, newConfig);
    
    return { added, removed, modified };
  },

  /**
   * Generate migration template
   */
  generateMigrationTemplate(version: string, name: string): string {
    return `
/**
 * Migration: ${name}
 * Version: ${version}
 */

import { ConfigurationMigration } from './config-migration.js';

export const migration_${version.replace(/\./g, '_')}: ConfigurationMigration = {
  version: '${version}',
  name: '${name}',
  description: 'Description of what this migration does',
  
  up: (config: any) => {
    // Apply forward migration
    return {
      ...config,
      // Add your migration logic here
    };
  },
  
  down: (config: any) => {
    // Apply rollback migration
    return {
      ...config,
      // Add your rollback logic here
    };
  },
  
  validate: (config: any) => {
    // Optional: Add validation logic
    return true;
  },
  
  required: false,
  breaking: false
};
    `.trim();
  }
};
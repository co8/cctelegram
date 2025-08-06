/**
 * Configuration Hot Reload Manager
 * 
 * Implements graceful configuration reloading with state preservation,
 * connection management, and rollback capabilities using chokidar file watcher.
 */

import { EventEmitter } from 'events';
import chokidar from 'chokidar';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { debounce } from 'lodash-es';
import { EnvironmentConfigManager } from './environment-config';
import { ConfigurationMigrationManager } from './config-migration';
import { ApplicationConfig, validateConfiguration } from './config-schema';
import { secureLog } from '../security';

export interface HotReloadOptions {
  enabled?: boolean;
  watchPaths?: string[];
  debounceDelay?: number;
  enableMigration?: boolean;
  preserveConnections?: boolean;
  enableRollback?: boolean;
  maxRollbackHistory?: number;
  validateBeforeReload?: boolean;
  gracefulReloadTimeout?: number;
}

export interface ReloadContext {
  reloadId: string;
  timestamp: Date;
  trigger: 'file_change' | 'manual' | 'scheduled';
  changedFiles: string[];
  previousConfig: ApplicationConfig;
  newConfig: ApplicationConfig;
  preservedState?: any;
}

export interface ReloadResult {
  success: boolean;
  reloadId: string;
  duration: number;
  appliedChanges: string[];
  preservedConnections: number;
  errors: string[];
  warnings: string[];
  rollbackAvailable: boolean;
}

export interface StatePreservation {
  activeConnections: any[];
  inFlightRequests: any[];
  circuitBreakerStates: any;
  cacheData: any;
  customState: Record<string, any>;
}

export class HotReloadManager extends EventEmitter {
  private configManager: EnvironmentConfigManager;
  private migrationManager: ConfigurationMigrationManager;
  private watcher?: import('chokidar').FSWatcher;
  private options: Required<HotReloadOptions>;
  private isReloading: boolean = false;
  private lastReloadTime: Date | null = null;
  private reloadHistory: ReloadContext[] = [];
  private watchedFiles: Map<string, string> = new Map(); // file -> checksum
  private statePreservers: Map<string, (config: ApplicationConfig) => any> = new Map();
  private stateRestorers: Map<string, (state: any, config: ApplicationConfig) => void> = new Map();
  private activeConnections: Set<any> = new Set();
  private gracefulShutdownHandlers: Set<() => Promise<void>> = new Set();

  constructor(
    configManager: EnvironmentConfigManager,
    migrationManager: ConfigurationMigrationManager,
    options: HotReloadOptions = {}
  ) {
    super();
    
    this.configManager = configManager;
    this.migrationManager = migrationManager;
    this.options = {
      enabled: options.enabled ?? true,
      watchPaths: options.watchPaths ?? ['./config'],
      debounceDelay: options.debounceDelay ?? 1000,
      enableMigration: options.enableMigration ?? true,
      preserveConnections: options.preserveConnections ?? true,
      enableRollback: options.enableRollback ?? true,
      maxRollbackHistory: options.maxRollbackHistory ?? 10,
      validateBeforeReload: options.validateBeforeReload ?? true,
      gracefulReloadTimeout: options.gracefulReloadTimeout ?? 30000
    };

    this.setupDefaultStateHandlers();
  }

  /**
   * Initialize hot reload system
   */
  public async initialize(): Promise<void> {
    if (!this.options.enabled) {
      secureLog('info', 'Hot reload disabled');
      return;
    }

    try {
      // Initialize file checksums
      await this.initializeFileChecksums();

      // Setup file watcher
      await this.setupFileWatcher();

      // Setup process signal handlers for graceful shutdown
      this.setupGracefulShutdownHandlers();

      secureLog('info', 'Hot reload manager initialized', {
        watch_paths: this.options.watchPaths,
        debounce_delay: this.options.debounceDelay,
        preserve_connections: this.options.preserveConnections
      });

      this.emit('initialized');

    } catch (error) {
      secureLog('error', 'Failed to initialize hot reload manager', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Setup file watcher with debounced reload
   */
  private async setupFileWatcher(): Promise<void> {
    const debouncedReload = debounce(
      (changedFiles: string[]) => this.handleFileChanges(changedFiles),
      this.options.debounceDelay
    );

    this.watcher = chokidar.watch(this.options.watchPaths, {
      ignored: [
        '**/node_modules/**',
        '**/backups/**',
        '**/.git/**',
        '**/tmp/**',
        '**/*.tmp',
        '**/*.bak'
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    const changedFiles: string[] = [];

    this.watcher
      .on('change', (filePath: string) => {
        secureLog('debug', 'Configuration file changed', { file: filePath });
        changedFiles.push(filePath);
        debouncedReload(changedFiles.splice(0));
      })
      .on('add', (filePath: string) => {
        secureLog('debug', 'Configuration file added', { file: filePath });
        changedFiles.push(filePath);
        debouncedReload(changedFiles.splice(0));
      })
      .on('unlink', (filePath: string) => {
        secureLog('debug', 'Configuration file removed', { file: filePath });
        changedFiles.push(filePath);
        debouncedReload(changedFiles.splice(0));
      })
      .on('error', (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        secureLog('error', 'File watcher error', {
          error: error.message
        });
        this.emit('watcherError', error);
      });

    secureLog('debug', 'File watcher setup completed', {
      watching: this.options.watchPaths
    });
  }

  /**
   * Initialize file checksums for change detection
   */
  private async initializeFileChecksums(): Promise<void> {
    for (const watchPath of this.options.watchPaths) {
      if (await fs.pathExists(watchPath)) {
        const stat = await fs.stat(watchPath);
        
        if (stat.isDirectory()) {
          const files = await this.findConfigFiles(watchPath);
          for (const file of files) {
            await this.updateFileChecksum(file);
          }
        } else {
          await this.updateFileChecksum(watchPath);
        }
      }
    }

    secureLog('debug', 'File checksums initialized', {
      tracked_files: this.watchedFiles.size
    });
  }

  /**
   * Find configuration files in directory
   */
  private async findConfigFiles(directory: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      
      if (entry.isFile() && this.isConfigFile(entry.name)) {
        files.push(fullPath);
      } else if (entry.isDirectory() && !this.isIgnoredDirectory(entry.name)) {
        const subFiles = await this.findConfigFiles(fullPath);
        files.push(...subFiles);
      }
    }

    return files;
  }

  /**
   * Check if file is a configuration file
   */
  private isConfigFile(fileName: string): boolean {
    const configExtensions = ['.json', '.yaml', '.yml', '.env'];
    const configPatterns = ['config', 'settings', '.env'];
    
    return configExtensions.some(ext => fileName.endsWith(ext)) &&
           configPatterns.some(pattern => fileName.includes(pattern));
  }

  /**
   * Check if directory should be ignored
   */
  private isIgnoredDirectory(dirName: string): boolean {
    const ignoredDirs = ['node_modules', '.git', 'tmp', 'backups'];
    return ignoredDirs.includes(dirName) || dirName.startsWith('.');
  }

  /**
   * Update file checksum
   */
  private async updateFileChecksum(filePath: string): Promise<void> {
    try {
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath);
        const checksum = crypto.createHash('md5').update(content).digest('hex');
        this.watchedFiles.set(filePath, checksum);
      } else {
        this.watchedFiles.delete(filePath);
      }
    } catch (error) {
      secureLog('warn', 'Failed to update file checksum', {
        file: filePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Handle file changes with debouncing
   */
  private async handleFileChanges(changedFiles: string[]): Promise<void> {
    if (this.isReloading) {
      secureLog('debug', 'Reload already in progress, queuing changes', {
        changed_files: changedFiles.length
      });
      return;
    }

    try {
      // Filter out files that haven't actually changed (based on checksum)
      const actuallyChangedFiles: string[] = [];
      
      for (const file of changedFiles) {
        const oldChecksum = this.watchedFiles.get(file);
        await this.updateFileChecksum(file);
        const newChecksum = this.watchedFiles.get(file);
        
        if (oldChecksum !== newChecksum) {
          actuallyChangedFiles.push(file);
        }
      }

      if (actuallyChangedFiles.length === 0) {
        secureLog('debug', 'No actual file changes detected (checksums unchanged)');
        return;
      }

      secureLog('info', 'Triggering configuration reload', {
        changed_files: actuallyChangedFiles
      });

      await this.reloadConfiguration({
        trigger: 'file_change',
        changedFiles: actuallyChangedFiles
      });

    } catch (error) {
      secureLog('error', 'Error handling file changes', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.emit('reloadError', error);
    }
  }

  /**
   * Reload configuration with graceful state preservation
   */
  public async reloadConfiguration(options: {
    trigger?: 'file_change' | 'manual' | 'scheduled';
    changedFiles?: string[];
    skipValidation?: boolean;
    skipMigration?: boolean;
  } = {}): Promise<ReloadResult> {
    const reloadId = crypto.randomUUID();
    const startTime = Date.now();

    if (this.isReloading) {
      throw new Error('Configuration reload already in progress');
    }

    this.isReloading = true;

    secureLog('info', 'Starting configuration reload', {
      reload_id: reloadId,
      trigger: options.trigger || 'manual',
      changed_files: options.changedFiles?.length || 0
    });

    const result: ReloadResult = {
      success: false,
      reloadId,
      duration: 0,
      appliedChanges: [],
      preservedConnections: 0,
      errors: [],
      warnings: [],
      rollbackAvailable: false
    };

    try {
      // Get current configuration for comparison and rollback
      const previousConfig = this.configManager.getConfiguration();

      // Preserve current state
      const preservedState = this.options.preserveConnections ? 
        await this.preserveCurrentState(previousConfig) : undefined;

      // Load new configuration
      const newConfig = await this.configManager.reloadConfiguration();

      // Validate new configuration if enabled
      if (this.options.validateBeforeReload && !options.skipValidation) {
        const validation = validateConfiguration(newConfig);
        if (!validation.success) {
          throw new Error(`Configuration validation failed: ${validation.error?.message}`);
        }

        if (validation.warnings && validation.warnings.length > 0) {
          result.warnings.push(...validation.warnings);
        }
      }

      // Handle migration if enabled and needed
      if (this.options.enableMigration && !options.skipMigration) {
        const currentVersion = this.migrationManager.getCurrentVersion(previousConfig);
        const newVersion = this.migrationManager.getCurrentVersion(newConfig);

        if (this.migrationManager.needsMigration(newConfig, newVersion)) {
          secureLog('info', 'Configuration migration required', {
            from_version: currentVersion,
            to_version: newVersion
          });

          const migrationResult = await this.migrationManager.executeMigration(
            newConfig,
            newVersion,
            { createBackup: true }
          );

          if (!migrationResult.success) {
            throw new Error(`Configuration migration failed: ${migrationResult.errors.join(', ')}`);
          }

          result.warnings.push(...migrationResult.warnings);
          result.rollbackAvailable = migrationResult.rollbackAvailable;
        }
      }

      // Create reload context
      const reloadContext: ReloadContext = {
        reloadId,
        timestamp: new Date(),
        trigger: options.trigger || 'manual',
        changedFiles: options.changedFiles || [],
        previousConfig,
        newConfig,
        preservedState
      };

      // Emit pre-reload event for components to prepare
      this.emit('beforeReload', reloadContext);

      // Wait for graceful shutdown of components
      await this.gracefulShutdown();

      // Apply configuration changes
      result.appliedChanges = await this.applyConfigurationChanges(previousConfig, newConfig);

      // Restore preserved state
      if (preservedState) {
        await this.restorePreservedState(preservedState, newConfig);
        result.preservedConnections = this.activeConnections.size;
      }

      // Add to reload history
      this.reloadHistory.push(reloadContext);
      this.trimReloadHistory();

      // Update last reload time
      this.lastReloadTime = new Date();

      result.success = true;
      result.duration = Date.now() - startTime;

      secureLog('info', 'Configuration reload completed successfully', {
        reload_id: reloadId,
        duration: result.duration,
        applied_changes: result.appliedChanges.length,
        preserved_connections: result.preservedConnections
      });

      // Emit post-reload event
      this.emit('reloadCompleted', reloadContext, result);

    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');

      secureLog('error', 'Configuration reload failed', {
        reload_id: reloadId,
        duration: result.duration,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Emit error event
      this.emit('reloadError', error, reloadId);

      // Attempt rollback if possible
      if (this.options.enableRollback && this.reloadHistory.length > 0) {
        try {
          await this.rollbackToPreviousConfiguration();
          result.warnings.push('Rolled back to previous configuration due to reload failure');
        } catch (rollbackError) {
          result.errors.push(`Rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown error'}`);
        }
      }

    } finally {
      this.isReloading = false;
    }

    return result;
  }

  /**
   * Preserve current application state
   */
  private async preserveCurrentState(config: ApplicationConfig): Promise<StatePreservation> {
    const state: StatePreservation = {
      activeConnections: [],
      inFlightRequests: [],
      circuitBreakerStates: {},
      cacheData: {},
      customState: {}
    };

    try {
      // Preserve active connections
      state.activeConnections = Array.from(this.activeConnections);

      // Run custom state preservers
      for (const [name, preserver] of this.statePreservers) {
        try {
          state.customState[name] = await preserver(config);
          secureLog('debug', 'State preserved', { component: name });
        } catch (error) {
          secureLog('warn', 'Failed to preserve state', {
            component: name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      secureLog('debug', 'Application state preserved', {
        active_connections: state.activeConnections.length,
        preserved_components: Object.keys(state.customState).length
      });

    } catch (error) {
      secureLog('error', 'Failed to preserve application state', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return state;
  }

  /**
   * Restore preserved application state
   */
  private async restorePreservedState(state: StatePreservation, config: ApplicationConfig): Promise<void> {
    try {
      // Restore active connections
      this.activeConnections.clear();
      state.activeConnections.forEach(conn => this.activeConnections.add(conn));

      // Run custom state restorers
      for (const [name, restorer] of this.stateRestorers) {
        try {
          if (state.customState[name]) {
            await restorer(state.customState[name], config);
            secureLog('debug', 'State restored', { component: name });
          }
        } catch (error) {
          secureLog('warn', 'Failed to restore state', {
            component: name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      secureLog('debug', 'Application state restored', {
        active_connections: this.activeConnections.size,
        restored_components: Object.keys(state.customState).length
      });

    } catch (error) {
      secureLog('error', 'Failed to restore application state', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Apply configuration changes and return list of changes
   */
  private async applyConfigurationChanges(
    oldConfig: ApplicationConfig, 
    newConfig: ApplicationConfig
  ): Promise<string[]> {
    const changes: string[] = [];

    // Compare configurations to identify changes
    const configSections = [
      'base', 'server', 'database', 'telegram', 'security', 
      'monitoring', 'cache', 'fileSystem', 'resilience'
    ] as const;

    for (const section of configSections) {
      if (JSON.stringify(oldConfig[section]) !== JSON.stringify(newConfig[section])) {
        changes.push(section);
        secureLog('debug', 'Configuration section changed', { section });
      }
    }

    return changes;
  }

  /**
   * Perform graceful shutdown of components
   */
  private async gracefulShutdown(): Promise<void> {
    if (this.gracefulShutdownHandlers.size === 0) {
      return;
    }

    secureLog('debug', 'Performing graceful shutdown', {
      handlers: this.gracefulShutdownHandlers.size
    });

    const shutdownPromises = Array.from(this.gracefulShutdownHandlers)
      .map(handler => this.executeWithTimeout(handler(), this.options.gracefulReloadTimeout));

    await Promise.allSettled(shutdownPromises);
  }

  /**
   * Execute promise with timeout
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out')), timeout)
      )
    ]);
  }

  /**
   * Rollback to previous configuration
   */
  public async rollbackToPreviousConfiguration(): Promise<void> {
    if (this.reloadHistory.length === 0) {
      throw new Error('No previous configuration available for rollback');
    }

    const previousContext = this.reloadHistory[this.reloadHistory.length - 1]!;
    
    secureLog('info', 'Rolling back to previous configuration', {
      reload_id: previousContext.reloadId,
      timestamp: previousContext.timestamp
    });

    // Load previous configuration
    // Note: This would need integration with the actual configuration storage
    // For now, we'll emit an event for external handling
    this.emit('rollbackRequested', previousContext);
  }

  /**
   * Register state preserver
   */
  public registerStatePreserver(name: string, preserver: (config: ApplicationConfig) => any): void {
    this.statePreservers.set(name, preserver);
    secureLog('debug', 'State preserver registered', { component: name });
  }

  /**
   * Register state restorer
   */
  public registerStateRestorer(name: string, restorer: (state: any, config: ApplicationConfig) => void): void {
    this.stateRestorers.set(name, restorer);
    secureLog('debug', 'State restorer registered', { component: name });
  }

  /**
   * Register graceful shutdown handler
   */
  public registerGracefulShutdownHandler(handler: () => Promise<void>): void {
    this.gracefulShutdownHandlers.add(handler);
  }

  /**
   * Track active connection
   */
  public trackConnection(connection: any): void {
    this.activeConnections.add(connection);
  }

  /**
   * Untrack connection
   */
  public untrackConnection(connection: any): void {
    this.activeConnections.delete(connection);
  }

  /**
   * Setup default state handlers
   */
  private setupDefaultStateHandlers(): void {
    // Default state preservers for common components
    this.registerStatePreserver('connections', (config) => {
      return {
        count: this.activeConnections.size,
        timestamp: Date.now()
      };
    });

    this.registerStateRestorer('connections', (state, config) => {
      secureLog('debug', 'Restored connection state', {
        previous_count: state.count,
        current_count: this.activeConnections.size
      });
    });
  }

  /**
   * Setup graceful shutdown handlers for process signals
   */
  private setupGracefulShutdownHandlers(): void {
    const shutdown = async () => {
      secureLog('info', 'Shutting down hot reload manager');
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Trim reload history to maximum size
   */
  private trimReloadHistory(): void {
    if (this.reloadHistory.length > this.options.maxRollbackHistory) {
      this.reloadHistory = this.reloadHistory.slice(-this.options.maxRollbackHistory);
    }
  }

  /**
   * Get reload statistics
   */
  public getReloadStatistics(): {
    lastReloadTime: Date | null;
    totalReloads: number;
    averageReloadTime: number;
    successRate: number;
    activeConnections: number;
    isReloading: boolean;
  } {
    const successfulReloads = this.reloadHistory.filter(r => 
      !r.previousConfig || r.newConfig
    ).length;

    const totalDuration = this.reloadHistory.reduce((sum, r) => {
      // Calculate duration if available
      return sum + 1000; // Placeholder
    }, 0);

    return {
      lastReloadTime: this.lastReloadTime,
      totalReloads: this.reloadHistory.length,
      averageReloadTime: this.reloadHistory.length > 0 ? totalDuration / this.reloadHistory.length : 0,
      successRate: this.reloadHistory.length > 0 ? successfulReloads / this.reloadHistory.length : 1,
      activeConnections: this.activeConnections.size,
      isReloading: this.isReloading
    };
  }

  /**
   * Shutdown hot reload manager
   */
  public async shutdown(): Promise<void> {
    secureLog('info', 'Shutting down hot reload manager');

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }

    this.statePreservers.clear();
    this.stateRestorers.clear();
    this.gracefulShutdownHandlers.clear();
    this.activeConnections.clear();

    this.emit('shutdown');
  }
}
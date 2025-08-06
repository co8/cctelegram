/**
 * Environment-Specific Configuration Management
 * 
 * Implements hierarchical configuration loading with environment-specific overrides,
 * environment variable substitution, and configuration merging strategies.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { merge } from 'lodash-es';
import { config as dotenvConfig } from 'dotenv';
import { expand as dotenvExpand } from 'dotenv-expand';
import * as yaml from 'js-yaml';
import { 
  ApplicationConfig, 
  ApplicationConfigSchema, 
  validateConfiguration, 
  generateConfigTemplate,
  EnvironmentMappings 
} from './config-schema.js';
import { secureLog } from '../security.js';

export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface ConfigurationSource {
  name: string;
  priority: number;
  path?: string;
  data?: Partial<ApplicationConfig>;
  required?: boolean;
  format?: 'json' | 'yaml' | 'env';
}

export interface EnvironmentConfigOptions {
  environment?: Environment;
  configDirectory?: string;
  enableEnvironmentVariables?: boolean;
  enableFileWatching?: boolean;
  validateOnLoad?: boolean;
  createMissingFiles?: boolean;
  backupOnChange?: boolean;
}

export class EnvironmentConfigManager {
  private environment: Environment;
  private configDirectory: string;
  private loadedConfig: ApplicationConfig | null = null;
  private configSources: ConfigurationSource[] = [];
  private options: Required<EnvironmentConfigOptions>;
  private lastLoadTime: Date | null = null;

  constructor(options: EnvironmentConfigOptions = {}) {
    this.environment = options.environment || this.detectEnvironment();
    this.configDirectory = options.configDirectory || './config';
    this.options = {
      environment: this.environment,
      configDirectory: this.configDirectory,
      enableEnvironmentVariables: options.enableEnvironmentVariables ?? true,
      enableFileWatching: options.enableFileWatching ?? true,
      validateOnLoad: options.validateOnLoad ?? true,
      createMissingFiles: options.createMissingFiles ?? false,
      backupOnChange: options.backupOnChange ?? true
    };

    this.setupConfigurationSources();
  }

  /**
   * Detect environment from NODE_ENV or default to development
   */
  private detectEnvironment(): Environment {
    const nodeEnv = process.env.NODE_ENV?.toLowerCase();
    
    switch (nodeEnv) {
      case 'production':
      case 'prod':
        return 'production';
      case 'staging':
      case 'stage':
        return 'staging';
      case 'test':
      case 'testing':
        return 'test';
      case 'development':
      case 'dev':
      default:
        return 'development';
    }
  }

  /**
   * Setup configuration sources in priority order
   */
  private setupConfigurationSources(): void {
    this.configSources = [
      // Environment variables (highest priority)
      {
        name: 'environment-variables',
        priority: 100,
        required: false,
        format: 'env'
      },
      // Environment-specific configuration
      {
        name: `config.${this.environment}`,
        priority: 90,
        path: path.join(this.configDirectory, `config.${this.environment}.json`),
        required: false,
        format: 'json'
      },
      {
        name: `config.${this.environment}.yaml`,
        priority: 89,
        path: path.join(this.configDirectory, `config.${this.environment}.yaml`),
        required: false,
        format: 'yaml'
      },
      // Local override (for development)
      {
        name: 'config.local',
        priority: 85,
        path: path.join(this.configDirectory, 'config.local.json'),
        required: false,
        format: 'json'
      },
      // Base configuration (lowest priority)
      {
        name: 'config.base',
        priority: 10,
        path: path.join(this.configDirectory, 'config.json'),
        required: false,
        format: 'json'
      },
      {
        name: 'config.base.yaml',
        priority: 9,
        path: path.join(this.configDirectory, 'config.yaml'),
        required: false,
        format: 'yaml'
      },
      // Default configuration (fallback)
      {
        name: 'default',
        priority: 1,
        data: generateConfigTemplate(this.environment === 'test' ? 'development' : this.environment),
        required: true
      }
    ];

    // Sort by priority (descending)
    this.configSources.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Load configuration from all sources
   */
  public async loadConfiguration(): Promise<ApplicationConfig> {
    secureLog('info', 'Loading configuration', {
      environment: this.environment,
      config_directory: this.configDirectory,
      sources: this.configSources.length
    });

    const configData: Partial<ApplicationConfig>[] = [];

    // Load environment variables first
    if (this.options.enableEnvironmentVariables) {
      await this.loadEnvironmentVariables();
    }

    // Load from each source
    for (const source of this.configSources) {
      try {
        const sourceData = await this.loadConfigurationSource(source);
        if (sourceData) {
          configData.push(sourceData);
          secureLog('debug', 'Loaded configuration source', {
            source: source.name,
            priority: source.priority,
            has_data: Object.keys(sourceData).length > 0
          });
        }
      } catch (error) {
        if (source.required) {
          throw new Error(`Failed to load required configuration source '${source.name}': ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        secureLog('warn', 'Failed to load optional configuration source', {
          source: source.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Merge configurations in reverse priority order (lowest to highest)
    const mergedConfig = configData.reverse().reduce((acc, config) => {
      return merge(acc, config);
    }, {} as Partial<ApplicationConfig>);

    // Validate merged configuration
    if (this.options.validateOnLoad) {
      const validation = validateConfiguration(mergedConfig);
      
      if (!validation.success) {
        throw new Error(`Configuration validation failed: ${validation.error?.message}`);
      }

      if (validation.warnings && validation.warnings.length > 0) {
        validation.warnings.forEach(warning => {
          secureLog('warn', 'Configuration warning', { warning });
        });
      }

      this.loadedConfig = validation.data!;
    } else {
      this.loadedConfig = mergedConfig as ApplicationConfig;
    }

    this.lastLoadTime = new Date();

    secureLog('info', 'Configuration loaded successfully', {
      environment: this.loadedConfig.base.environment,
      validation_warnings: this.options.validateOnLoad ? 'enabled' : 'disabled',
      last_load_time: this.lastLoadTime.toISOString()
    });

    return this.loadedConfig;
  }

  /**
   * Load environment variables and map to configuration
   */
  private async loadEnvironmentVariables(): Promise<void> {
    // Load .env files in order of specificity
    const envFiles = [
      '.env',
      `.env.${this.environment}`,
      '.env.local'
    ];

    for (const envFile of envFiles) {
      const envPath = path.resolve(envFile);
      if (await fs.pathExists(envPath)) {
        const result = dotenvConfig({ path: envPath });
        if (result.parsed) {
          dotenvExpand(result);
          secureLog('debug', 'Loaded environment file', {
            file: envFile,
            variables: Object.keys(result.parsed).length
          });
        }
      }
    }
  }

  /**
   * Load configuration from a specific source
   */
  private async loadConfigurationSource(source: ConfigurationSource): Promise<Partial<ApplicationConfig> | null> {
    // Handle environment variables
    if (source.format === 'env') {
      return this.loadFromEnvironmentVariables();
    }

    // Handle inline data
    if (source.data) {
      return source.data;
    }

    // Handle file sources
    if (!source.path) {
      return null;
    }

    if (!await fs.pathExists(source.path)) {
      if (this.options.createMissingFiles && source.format === 'json') {
        await this.createMissingConfigFile(source);
      }
      return null;
    }

    const fileContent = await fs.readFile(source.path, 'utf-8');
    
    switch (source.format) {
      case 'json':
        return JSON.parse(fileContent);
      case 'yaml':
        return yaml.load(fileContent) as Partial<ApplicationConfig>;
      default:
        throw new Error(`Unsupported configuration format: ${source.format}`);
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironmentVariables(): Partial<ApplicationConfig> {
    const config: any = {};

    Object.entries(EnvironmentMappings).forEach(([envVar, configPath]) => {
      const value = process.env[envVar];
      if (value !== undefined) {
        this.setNestedProperty(config, configPath, this.parseEnvironmentValue(value));
      }
    });

    return config;
  }

  /**
   * Parse environment variable value to appropriate type
   */
  private parseEnvironmentValue(value: string): any {
    // Boolean values
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Number values
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

    // Array values (comma-separated)
    if (value.includes(',')) {
      return value.split(',').map(item => item.trim());
    }

    // String value
    return value;
  }

  /**
   * Set nested property in object using dot notation
   */
  private setNestedProperty(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!key) continue;
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey) {
      current[lastKey] = value;
    }
  }

  /**
   * Create missing configuration file with template
   */
  private async createMissingConfigFile(source: ConfigurationSource): Promise<void> {
    if (!source.path) return;

    const template = generateConfigTemplate(this.environment === 'test' ? 'development' : this.environment);
    const configDir = path.dirname(source.path);
    
    await fs.ensureDir(configDir);
    await fs.writeJson(source.path, template, { spaces: 2 });
    
    secureLog('info', 'Created missing configuration file', {
      path: source.path,
      environment: this.environment
    });
  }

  /**
   * Get current configuration
   */
  public getConfiguration(): ApplicationConfig {
    if (!this.loadedConfig) {
      throw new Error('Configuration not loaded. Call loadConfiguration() first.');
    }
    return this.loadedConfig;
  }

  /**
   * Get configuration for specific section
   */
  public getConfigurationSection<K extends keyof ApplicationConfig>(section: K): ApplicationConfig[K] {
    const config = this.getConfiguration();
    return config[section];
  }

  /**
   * Reload configuration
   */
  public async reloadConfiguration(): Promise<ApplicationConfig> {
    secureLog('info', 'Reloading configuration');
    
    if (this.options.backupOnChange && this.loadedConfig) {
      await this.backupCurrentConfiguration();
    }

    return await this.loadConfiguration();
  }

  /**
   * Backup current configuration
   */
  private async backupCurrentConfiguration(): Promise<void> {
    if (!this.loadedConfig) return;

    const backupDir = path.join(this.configDirectory, 'backups');
    await fs.ensureDir(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `config-backup-${timestamp}.json`);

    await fs.writeJson(backupPath, this.loadedConfig, { spaces: 2 });

    secureLog('debug', 'Configuration backed up', {
      backup_path: backupPath
    });
  }

  /**
   * Get configuration metadata
   */
  public getConfigurationMetadata(): {
    environment: Environment;
    lastLoadTime: Date | null;
    sources: ConfigurationSource[];
    isLoaded: boolean;
  } {
    return {
      environment: this.environment,
      lastLoadTime: this.lastLoadTime,
      sources: this.configSources,
      isLoaded: this.loadedConfig !== null
    };
  }

  /**
   * Validate current configuration
   */
  public validateCurrentConfiguration(): {
    success: boolean;
    error?: string;
    warnings?: string[];
  } {
    if (!this.loadedConfig) {
      return { success: false, error: 'No configuration loaded' };
    }

    const validation = validateConfiguration(this.loadedConfig);
    
    return {
      success: validation.success,
      error: validation.error?.message,
      warnings: validation.warnings
    };
  }

  /**
   * Update configuration section
   */
  public async updateConfigurationSection<K extends keyof ApplicationConfig>(
    section: K, 
    updates: Partial<ApplicationConfig[K]>,
    persist: boolean = false
  ): Promise<void> {
    if (!this.loadedConfig) {
      throw new Error('Configuration not loaded. Call loadConfiguration() first.');
    }

    // Backup current configuration
    if (this.options.backupOnChange) {
      await this.backupCurrentConfiguration();
    }

    // Apply updates
    this.loadedConfig[section] = merge(this.loadedConfig[section], updates);

    // Validate updated configuration
    const validation = validateConfiguration(this.loadedConfig);
    if (!validation.success) {
      throw new Error(`Configuration update validation failed: ${validation.error?.message}`);
    }

    if (validation.warnings && validation.warnings.length > 0) {
      validation.warnings.forEach(warning => {
        secureLog('warn', 'Configuration update warning', { warning });
      });
    }

    this.loadedConfig = validation.data!;

    if (persist) {
      await this.persistConfiguration();
    }

    secureLog('info', 'Configuration section updated', {
      section,
      persisted: persist
    });
  }

  /**
   * Persist current configuration to file
   */
  private async persistConfiguration(): Promise<void> {
    if (!this.loadedConfig) return;

    const configPath = path.join(this.configDirectory, `config.${this.environment}.json`);
    await fs.ensureDir(this.configDirectory);
    await fs.writeJson(configPath, this.loadedConfig, { spaces: 2 });

    secureLog('debug', 'Configuration persisted', {
      path: configPath
    });
  }

  /**
   * Compare configurations
   */
  public compareConfigurations(other: ApplicationConfig): {
    differences: Array<{
      path: string;
      current: any;
      other: any;
    }>;
    identical: boolean;
  } {
    const differences: Array<{ path: string; current: any; other: any; }> = [];
    
    if (!this.loadedConfig) {
      throw new Error('No configuration loaded for comparison');
    }

    this.findDifferences(this.loadedConfig, other, '', differences);

    return {
      differences,
      identical: differences.length === 0
    };
  }

  /**
   * Find differences between configurations recursively
   */
  private findDifferences(
    current: any, 
    other: any, 
    path: string, 
    differences: Array<{ path: string; current: any; other: any; }>
  ): void {
    if (typeof current !== typeof other) {
      differences.push({ path, current, other });
      return;
    }

    if (typeof current === 'object' && current !== null && other !== null) {
      const allKeys = new Set([...Object.keys(current), ...Object.keys(other)]);
      
      for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key;
        
        if (!(key in current)) {
          differences.push({ path: newPath, current: undefined, other: other[key] });
        } else if (!(key in other)) {
          differences.push({ path: newPath, current: current[key], other: undefined });
        } else {
          this.findDifferences(current[key], other[key], newPath, differences);
        }
      }
    } else if (current !== other) {
      differences.push({ path, current, other });
    }
  }

  /**
   * Export configuration for debugging
   */
  public exportConfiguration(includeSecrets: boolean = false): any {
    if (!this.loadedConfig) {
      throw new Error('No configuration loaded for export');
    }

    const config = JSON.parse(JSON.stringify(this.loadedConfig));

    if (!includeSecrets) {
      // Redact sensitive information
      this.redactSecrets(config);
    }

    return config;
  }

  /**
   * Redact sensitive information from configuration
   */
  private redactSecrets(config: any): void {
    const sensitiveKeys = [
      'password', 'secret', 'key', 'token', 'apiKey', 'encryptionKey', 
      'jwtSecret', 'csrfSecret', 'webhookSecret', 'botToken'
    ];

    const redact = (obj: any, path: string = ''): void => {
      if (typeof obj === 'object' && obj !== null) {
        Object.keys(obj).forEach(key => {
          const currentPath = path ? `${path}.${key}` : key;
          
          if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
            obj[key] = '[REDACTED]';
          } else {
            redact(obj[key], currentPath);
          }
        });
      }
    };

    redact(config);
  }
}
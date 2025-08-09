/**
 * Data Seeding Utilities
 * 
 * Utilities for seeding test data for integration tests and mock API responses
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { Factory } from '../factories/factory-bot.js';
import { CCTelegramEvent, TelegramResponse, BridgeStatus } from '../../src/types.js';

/**
 * Seeding configuration interface
 */
export interface SeedingConfig {
  output_directory: string;
  file_format: 'json' | 'yaml' | 'csv';
  pretty_print: boolean;
  include_metadata: boolean;
  file_naming_pattern: string;
  batch_size: number;
  compression: boolean;
}

/**
 * Seeding operation result
 */
export interface SeedingResult {
  files_created: string[];
  total_records: number;
  duration_ms: number;
  errors: string[];
}

/**
 * Data seeding patterns
 */
export interface SeedingPattern {
  name: string;
  description: string;
  factory_name: string;
  count: number;
  traits: string[];
  overrides: Record<string, any>;
  file_prefix: string;
}

/**
 * Main data seeder class
 */
export class DataSeeder {
  private config: SeedingConfig;
  private patterns = new Map<string, SeedingPattern>();

  constructor(config: Partial<SeedingConfig> = {}) {
    this.config = {
      output_directory: '/tmp/test-data',
      file_format: 'json',
      pretty_print: true,
      include_metadata: true,
      file_naming_pattern: '{prefix}-{index:04d}.{extension}',
      batch_size: 100,
      compression: false,
      ...config
    };
  }

  /**
   * Register a seeding pattern
   */
  registerPattern(pattern: SeedingPattern): void {
    this.patterns.set(pattern.name, pattern);
  }

  /**
   * Seed data using a registered pattern
   */
  async seedPattern(patternName: string, customCount?: number): Promise<SeedingResult> {
    const pattern = this.patterns.get(patternName);
    if (!pattern) {
      throw new Error(`Seeding pattern "${patternName}" not found`);
    }

    const count = customCount ?? pattern.count;
    const startTime = Date.now();
    const result: SeedingResult = {
      files_created: [],
      total_records: 0,
      duration_ms: 0,
      errors: []
    };

    try {
      // Ensure output directory exists
      await fs.mkdir(this.config.output_directory, { recursive: true });

      // Generate data in batches
      const batches = Math.ceil(count / this.config.batch_size);
      
      for (let batch = 0; batch < batches; batch++) {
        const batchStart = batch * this.config.batch_size;
        const batchEnd = Math.min(batchStart + this.config.batch_size, count);
        const batchSize = batchEnd - batchStart;

        // Generate data for this batch
        const data = Factory.buildList(
          pattern.factory_name,
          batchSize,
          pattern.overrides,
          pattern.traits
        );

        // Write batch to file
        const filename = this.generateFilename(pattern.file_prefix, batch);
        const filepath = join(this.config.output_directory, filename);
        
        await this.writeDataFile(filepath, data);
        
        result.files_created.push(filepath);
        result.total_records += batchSize;
      }

      // Write metadata if enabled
      if (this.config.include_metadata) {
        const metadata = this.generateMetadata(pattern, count, result);
        const metadataPath = join(this.config.output_directory, `${pattern.file_prefix}-metadata.json`);
        await this.writeDataFile(metadataPath, metadata);
        result.files_created.push(metadataPath);
      }

    } catch (error) {
      result.errors.push(`Seeding failed: ${error}`);
    }

    result.duration_ms = Date.now() - startTime;
    return result;
  }

  /**
   * Seed multiple patterns in sequence
   */
  async seedMultiple(patternNames: string[]): Promise<Record<string, SeedingResult>> {
    const results: Record<string, SeedingResult> = {};
    
    for (const patternName of patternNames) {
      try {
        results[patternName] = await this.seedPattern(patternName);
      } catch (error) {
        results[patternName] = {
          files_created: [],
          total_records: 0,
          duration_ms: 0,
          errors: [`Failed to seed pattern "${patternName}": ${error}`]
        };
      }
    }

    return results;
  }

  /**
   * Generate test data for specific scenarios
   */
  async seedScenario(scenarioName: string): Promise<SeedingResult> {
    const scenarios = this.getBuiltInScenarios();
    const scenario = scenarios[scenarioName];
    
    if (!scenario) {
      throw new Error(`Scenario "${scenarioName}" not found`);
    }

    return await this.seedMultiple(scenario.patterns);
  }

  /**
   * Clean up seeded data
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.config.output_directory, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Cleanup warning: ${error}`);
    }
  }

  /**
   * Get list of registered patterns
   */
  getPatterns(): string[] {
    return Array.from(this.patterns.keys());
  }

  /**
   * Generate filename using the configured pattern
   */
  private generateFilename(prefix: string, index: number): string {
    const extension = this.config.file_format;
    return this.config.file_naming_pattern
      .replace('{prefix}', prefix)
      .replace('{index:04d}', index.toString().padStart(4, '0'))
      .replace('{extension}', extension);
  }

  /**
   * Write data to file in the configured format
   */
  private async writeDataFile(filepath: string, data: any): Promise<void> {
    // Ensure parent directory exists
    await fs.mkdir(dirname(filepath), { recursive: true });

    let content: string;
    
    switch (this.config.file_format) {
      case 'json':
        content = this.config.pretty_print 
          ? JSON.stringify(data, null, 2)
          : JSON.stringify(data);
        break;
      
      case 'yaml':
        // Simple YAML serialization (would use a proper YAML library in production)
        content = this.jsonToYaml(data);
        break;
      
      case 'csv':
        content = this.jsonToCsv(data);
        break;
      
      default:
        throw new Error(`Unsupported file format: ${this.config.file_format}`);
    }

    await fs.writeFile(filepath, content, 'utf8');
  }

  /**
   * Generate metadata for seeded data
   */
  private generateMetadata(pattern: SeedingPattern, count: number, result: SeedingResult): any {
    return {
      pattern: {
        name: pattern.name,
        description: pattern.description,
        factory_name: pattern.factory_name,
        traits: pattern.traits,
        overrides: pattern.overrides
      },
      seeding: {
        total_records: count,
        files_created: result.files_created.length,
        duration_ms: result.duration_ms,
        created_at: new Date().toISOString()
      },
      config: this.config,
      files: result.files_created.map(filepath => ({
        path: filepath,
        relative_path: filepath.replace(this.config.output_directory + '/', '')
      }))
    };
  }

  /**
   * Simple JSON to YAML conversion (basic implementation)
   */
  private jsonToYaml(obj: any, indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    
    if (Array.isArray(obj)) {
      return obj.map(item => `${spaces}- ${this.jsonToYaml(item, indent + 1).trim()}`).join('\n');
    }
    
    if (typeof obj === 'object' && obj !== null) {
      return Object.entries(obj)
        .map(([key, value]) => {
          if (typeof value === 'object') {
            return `${spaces}${key}:\n${this.jsonToYaml(value, indent + 1)}`;
          }
          return `${spaces}${key}: ${JSON.stringify(value)}`;
        })
        .join('\n');
    }
    
    return JSON.stringify(obj);
  }

  /**
   * Convert JSON array to CSV format
   */
  private jsonToCsv(data: any[]): string {
    if (!Array.isArray(data) || data.length === 0) {
      return '';
    }

    // Get all unique keys from all objects
    const keys = new Set<string>();
    data.forEach(item => {
      if (typeof item === 'object' && item !== null) {
        Object.keys(item).forEach(key => keys.add(key));
      }
    });

    const headers = Array.from(keys);
    const csvRows = [headers.join(',')];

    data.forEach(item => {
      const row = headers.map(header => {
        const value = item[header];
        const stringValue = typeof value === 'object' 
          ? JSON.stringify(value) 
          : String(value ?? '');
        // Escape quotes and wrap in quotes if contains comma or quote
        return stringValue.includes(',') || stringValue.includes('"')
          ? `"${stringValue.replace(/"/g, '""')}"`
          : stringValue;
      });
      csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
  }

  /**
   * Get built-in seeding scenarios
   */
  private getBuiltInScenarios(): Record<string, { patterns: string[] }> {
    return {
      'basic_test': {
        patterns: ['basic_events', 'basic_responses']
      },
      'performance_test': {
        patterns: ['high_volume_events', 'high_volume_responses', 'system_metrics']
      },
      'error_scenarios': {
        patterns: ['error_events', 'invalid_responses', 'timeout_scenarios']
      },
      'integration_test': {
        patterns: ['workflow_events', 'approval_responses', 'bridge_status']
      }
    };
  }
}

/**
 * Pre-configured data seeder for common scenarios
 */
export class CommonDataSeeder extends DataSeeder {
  constructor(outputDir: string = '/tmp/test-data') {
    super({
      output_directory: outputDir,
      file_format: 'json',
      pretty_print: true,
      include_metadata: true,
      batch_size: 50
    });

    this.registerCommonPatterns();
  }

  /**
   * Register commonly used seeding patterns
   */
  private registerCommonPatterns(): void {
    // Basic event patterns
    this.registerPattern({
      name: 'basic_events',
      description: 'Basic events for standard testing',
      factory_name: 'event',
      count: 20,
      traits: [],
      overrides: {},
      file_prefix: 'events'
    });

    this.registerPattern({
      name: 'task_events',
      description: 'Task-related events',
      factory_name: 'event',
      count: 15,
      traits: ['task_completion', 'task_started', 'task_failed'],
      overrides: {},
      file_prefix: 'task-events'
    });

    this.registerPattern({
      name: 'performance_events',
      description: 'Performance monitoring events',
      factory_name: 'event',
      count: 30,
      traits: ['performance_alert', 'system_health'],
      overrides: {},
      file_prefix: 'perf-events'
    });

    this.registerPattern({
      name: 'error_events',
      description: 'Error and failure events',
      factory_name: 'event',
      count: 10,
      traits: ['build_failed', 'task_failed', 'security_alert'],
      overrides: {},
      file_prefix: 'error-events'
    });

    // Response patterns
    this.registerPattern({
      name: 'basic_responses',
      description: 'Basic Telegram responses',
      factory_name: 'telegram_response',
      count: 15,
      traits: [],
      overrides: {},
      file_prefix: 'responses'
    });

    this.registerPattern({
      name: 'approval_responses',
      description: 'Approval workflow responses',
      factory_name: 'telegram_response',
      count: 12,
      traits: ['approve', 'deny', 'defer'],
      overrides: {},
      file_prefix: 'approval-responses'
    });

    this.registerPattern({
      name: 'invalid_responses',
      description: 'Invalid responses for error testing',
      factory_name: 'telegram_response',
      count: 8,
      traits: ['invalid_user_id', 'invalid_timestamp', 'empty_message'],
      overrides: {},
      file_prefix: 'invalid-responses'
    });

    // System state patterns
    this.registerPattern({
      name: 'bridge_status',
      description: 'Bridge status data',
      factory_name: 'bridge_status',
      count: 10,
      traits: ['healthy', 'degraded', 'unhealthy'],
      overrides: {},
      file_prefix: 'bridge-status'
    });

    this.registerPattern({
      name: 'system_metrics',
      description: 'System metrics data',
      factory_name: 'system_metrics',
      count: 20,
      traits: ['healthy_system', 'stressed_system'],
      overrides: {},
      file_prefix: 'system-metrics'
    });

    // High volume patterns for performance testing
    this.registerPattern({
      name: 'high_volume_events',
      description: 'High volume events for load testing',
      factory_name: 'event',
      count: 1000,
      traits: [],
      overrides: {},
      file_prefix: 'load-events'
    });

    this.registerPattern({
      name: 'high_volume_responses',
      description: 'High volume responses for load testing',
      factory_name: 'telegram_response',
      count: 500,
      traits: [],
      overrides: {},
      file_prefix: 'load-responses'
    });

    // Workflow patterns
    this.registerPattern({
      name: 'workflow_events',
      description: 'Complete workflow event sequences',
      factory_name: 'event_workflow',
      count: 5,
      traits: [],
      overrides: {},
      file_prefix: 'workflow'
    });

    this.registerPattern({
      name: 'timeline_events',
      description: 'Time-based event sequences',
      factory_name: 'event_timeline',
      count: 3,
      traits: [],
      overrides: {},
      file_prefix: 'timeline'
    });
  }
}

/**
 * Mock API response seeder for external service mocking
 */
export class MockAPISeeder {
  private responses = new Map<string, any[]>();

  /**
   * Add mock responses for an endpoint
   */
  addEndpointResponses(endpoint: string, responses: any[]): void {
    this.responses.set(endpoint, responses);
  }

  /**
   * Generate mock responses for Telegram API
   */
  generateTelegramMocks(): void {
    // Bot info response
    this.addEndpointResponses('/bot{token}/getMe', [
      Factory.build('api_response', {
        status: 200,
        data: {
          ok: true,
          result: {
            id: 123456789,
            is_bot: true,
            first_name: 'CCTelegram',
            username: 'cctelegram_bot'
          }
        }
      }, ['success'])
    ]);

    // Send message responses
    this.addEndpointResponses('/bot{token}/sendMessage', [
      Factory.build('api_response', {
        status: 200,
        data: {
          ok: true,
          result: {
            message_id: Factory.sequence('responseId'),
            date: Math.floor(Date.now() / 1000),
            text: 'Message sent successfully'
          }
        }
      }, ['success'])
    ]);

    // Error responses
    this.addEndpointResponses('/bot{token}/error', [
      Factory.build('api_response', {}, ['client_error']),
      Factory.build('api_response', {}, ['server_error']),
      Factory.build('api_response', {}, ['rate_limited'])
    ]);
  }

  /**
   * Generate mock responses for bridge health endpoints
   */
  generateBridgeMocks(): void {
    this.addEndpointResponses('/health', [
      Factory.build('bridge_status', {}, ['healthy']),
      Factory.build('bridge_status', {}, ['degraded']),
      Factory.build('bridge_status', {}, ['unhealthy'])
    ]);

    this.addEndpointResponses('/metrics', [
      Factory.build('system_metrics', {}, ['healthy_system']),
      Factory.build('system_metrics', {}, ['stressed_system'])
    ]);
  }

  /**
   * Export all mock responses
   */
  exportMocks(): Record<string, any[]> {
    return Object.fromEntries(this.responses);
  }

  /**
   * Save mock responses to files
   */
  async saveMocks(outputDir: string): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });

    for (const [endpoint, responses] of this.responses) {
      const filename = endpoint.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
      const filepath = join(outputDir, filename);
      await fs.writeFile(filepath, JSON.stringify(responses, null, 2));
    }
  }
}

/**
 * Utility functions for data seeding
 */
export const SeedingUtils = {
  /**
   * Create a quick test data setup
   */
  async quickSetup(testName: string, counts: { events?: number; responses?: number } = {}): Promise<string> {
    const seeder = new CommonDataSeeder(`/tmp/test-${testName}`);
    
    // Override counts if provided
    if (counts.events) {
      seeder.registerPattern({
        name: 'quick_events',
        description: 'Quick test events',
        factory_name: 'event',
        count: counts.events,
        traits: [],
        overrides: {},
        file_prefix: 'events'
      });
    }

    if (counts.responses) {
      seeder.registerPattern({
        name: 'quick_responses',
        description: 'Quick test responses',
        factory_name: 'telegram_response',
        count: counts.responses,
        traits: [],
        overrides: {},
        file_prefix: 'responses'
      });
    }

    const patterns = [];
    if (counts.events) patterns.push('quick_events');
    if (counts.responses) patterns.push('quick_responses');

    await seeder.seedMultiple(patterns);
    return seeder.config.output_directory;
  },

  /**
   * Generate test data for specific file counts
   */
  async generateFileSet(outputDir: string, fileCount: number, recordsPerFile: number = 10): Promise<string[]> {
    const seeder = new DataSeeder({
      output_directory: outputDir,
      batch_size: recordsPerFile
    });

    seeder.registerPattern({
      name: 'file_set',
      description: `Generate ${fileCount} files with ${recordsPerFile} records each`,
      factory_name: 'event',
      count: fileCount * recordsPerFile,
      traits: [],
      overrides: {},
      file_prefix: 'test-data'
    });

    const result = await seeder.seedPattern('file_set');
    return result.files_created;
  }
};
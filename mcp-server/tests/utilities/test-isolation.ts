/**
 * Test Isolation and Cleanup Mechanisms
 * 
 * Comprehensive test isolation system ensuring clean test environments
 * and proper cleanup between test runs.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { Factory } from '../factories/factory-bot.js';
import { fixtureManager } from '../fixtures/fixture-manager.js';

/**
 * Test isolation configuration
 */
export interface IsolationConfig {
  isolated_directories: string[];
  cleanup_patterns: string[];
  preserve_files: string[];
  environment_isolation: boolean;
  factory_reset: boolean;
  fixture_cleanup: boolean;
  process_cleanup: boolean;
  network_isolation: boolean;
  timeout_ms: number;
}

/**
 * Test context information
 */
export interface TestContext {
  test_id: string;
  test_name: string;
  test_file: string;
  start_time: number;
  temp_directories: string[];
  created_files: string[];
  modified_env_vars: string[];
  spawned_processes: number[];
  active_fixtures: string[];
  isolation_level: 'minimal' | 'standard' | 'complete';
}

/**
 * Cleanup operation result
 */
export interface CleanupResult {
  success: boolean;
  duration_ms: number;
  cleaned_files: number;
  cleaned_directories: number;
  errors: string[];
  warnings: string[];
}

/**
 * Test isolation manager
 */
export class TestIsolationManager {
  private config: IsolationConfig;
  private activeContexts = new Map<string, TestContext>();
  private originalEnv: Record<string, string> = {};
  private cleanupQueue: Array<() => Promise<void>> = [];

  constructor(config: Partial<IsolationConfig> = {}) {
    this.config = {
      isolated_directories: ['/tmp/test-*'],
      cleanup_patterns: ['*.tmp', '*.log', '*.test', 'test-*'],
      preserve_files: ['.gitkeep', 'README.md'],
      environment_isolation: true,
      factory_reset: true,
      fixture_cleanup: true,
      process_cleanup: true,
      network_isolation: false,
      timeout_ms: 30000,
      ...config
    };

    // Save original environment
    this.originalEnv = { ...process.env };
  }

  /**
   * Begin test isolation for a specific test
   */
  async beginTestIsolation(testName: string, testFile: string, isolationLevel: 'minimal' | 'standard' | 'complete' = 'standard'): Promise<string> {
    const testId = this.generateTestId(testName);
    const context: TestContext = {
      test_id: testId,
      test_name: testName,
      test_file: testFile,
      start_time: Date.now(),
      temp_directories: [],
      created_files: [],
      modified_env_vars: [],
      spawned_processes: [],
      active_fixtures: [],
      isolation_level: isolationLevel
    };

    // Setup isolation based on level
    switch (isolationLevel) {
      case 'complete':
        await this.setupCompleteIsolation(context);
        break;
      case 'standard':
        await this.setupStandardIsolation(context);
        break;
      case 'minimal':
        await this.setupMinimalIsolation(context);
        break;
    }

    this.activeContexts.set(testId, context);
    return testId;
  }

  /**
   * End test isolation and cleanup
   */
  async endTestIsolation(testId: string): Promise<CleanupResult> {
    const context = this.activeContexts.get(testId);
    if (!context) {
      return {
        success: false,
        duration_ms: 0,
        cleaned_files: 0,
        cleaned_directories: 0,
        errors: [`Test context ${testId} not found`],
        warnings: []
      };
    }

    const startTime = Date.now();
    const result: CleanupResult = {
      success: true,
      duration_ms: 0,
      cleaned_files: 0,
      cleaned_directories: 0,
      errors: [],
      warnings: []
    };

    try {
      // Cleanup based on isolation level
      switch (context.isolation_level) {
        case 'complete':
          await this.cleanupCompleteIsolation(context, result);
          break;
        case 'standard':
          await this.cleanupStandardIsolation(context, result);
          break;
        case 'minimal':
          await this.cleanupMinimalIsolation(context, result);
          break;
      }

    } catch (error) {
      result.errors.push(`Cleanup failed: ${error}`);
      result.success = false;
    }

    result.duration_ms = Date.now() - startTime;
    this.activeContexts.delete(testId);
    
    return result;
  }

  /**
   * Create isolated test directory
   */
  async createIsolatedDirectory(testId: string, purpose: string = 'general'): Promise<string> {
    const context = this.activeContexts.get(testId);
    if (!context) {
      throw new Error(`Test context ${testId} not found`);
    }

    const dirPath = join('/tmp', `test-${testId}-${purpose}-${Date.now()}`);
    await fs.mkdir(dirPath, { recursive: true });
    
    context.temp_directories.push(dirPath);
    return dirPath;
  }

  /**
   * Track file creation for cleanup
   */
  trackFileCreation(testId: string, filePath: string): void {
    const context = this.activeContexts.get(testId);
    if (context) {
      context.created_files.push(filePath);
    }
  }

  /**
   * Track environment variable modification
   */
  trackEnvModification(testId: string, varName: string): void {
    const context = this.activeContexts.get(testId);
    if (context && !context.modified_env_vars.includes(varName)) {
      context.modified_env_vars.push(varName);
    }
  }

  /**
   * Track process spawning
   */
  trackProcessSpawn(testId: string, pid: number): void {
    const context = this.activeContexts.get(testId);
    if (context) {
      context.spawned_processes.push(pid);
    }
  }

  /**
   * Track fixture usage
   */
  trackFixtureUsage(testId: string, fixtureName: string): void {
    const context = this.activeContexts.get(testId);
    if (context && !context.active_fixtures.includes(fixtureName)) {
      context.active_fixtures.push(fixtureName);
    }
  }

  /**
   * Cleanup all active test contexts
   */
  async cleanupAll(): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];
    const activeTests = Array.from(this.activeContexts.keys());
    
    for (const testId of activeTests) {
      const result = await this.endTestIsolation(testId);
      results.push(result);
    }

    // Run global cleanup queue
    for (const cleanupFn of this.cleanupQueue) {
      try {
        await cleanupFn();
      } catch (error) {
        console.warn('Global cleanup error:', error);
      }
    }
    this.cleanupQueue = [];

    return results;
  }

  /**
   * Add a global cleanup function
   */
  addGlobalCleanup(cleanupFn: () => Promise<void>): void {
    this.cleanupQueue.push(cleanupFn);
  }

  /**
   * Get active test contexts
   */
  getActiveContexts(): TestContext[] {
    return Array.from(this.activeContexts.values());
  }

  /**
   * Setup minimal isolation (basic cleanup only)
   */
  private async setupMinimalIsolation(context: TestContext): Promise<void> {
    // Reset factory sequences
    if (this.config.factory_reset) {
      Factory.resetSequences();
    }
  }

  /**
   * Setup standard isolation (recommended for most tests)
   */
  private async setupStandardIsolation(context: TestContext): Promise<void> {
    await this.setupMinimalIsolation(context);

    // Environment isolation
    if (this.config.environment_isolation) {
      // Set test-specific environment variables
      process.env.NODE_ENV = 'test';
      process.env.CC_TELEGRAM_EVENTS_DIR = await this.createIsolatedDirectory(context.test_id, 'events');
      process.env.CC_TELEGRAM_RESPONSES_DIR = await this.createIsolatedDirectory(context.test_id, 'responses');
      
      context.modified_env_vars.push('NODE_ENV', 'CC_TELEGRAM_EVENTS_DIR', 'CC_TELEGRAM_RESPONSES_DIR');
    }
  }

  /**
   * Setup complete isolation (maximum isolation for sensitive tests)
   */
  private async setupCompleteIsolation(context: TestContext): Promise<void> {
    await this.setupStandardIsolation(context);

    // Additional complete isolation setup
    if (this.config.network_isolation) {
      // Mock network interfaces (implementation would depend on testing framework)
      process.env.MOCK_NETWORK = 'true';
      context.modified_env_vars.push('MOCK_NETWORK');
    }

    // Create additional isolated directories
    await this.createIsolatedDirectory(context.test_id, 'temp');
    await this.createIsolatedDirectory(context.test_id, 'logs');
    await this.createIsolatedDirectory(context.test_id, 'cache');
  }

  /**
   * Cleanup minimal isolation
   */
  private async cleanupMinimalIsolation(context: TestContext, result: CleanupResult): Promise<void> {
    // Reset factory sequences
    if (this.config.factory_reset) {
      Factory.resetSequences();
    }
  }

  /**
   * Cleanup standard isolation
   */
  private async cleanupStandardIsolation(context: TestContext, result: CleanupResult): Promise<void> {
    await this.cleanupMinimalIsolation(context, result);

    // Cleanup temporary directories
    for (const dirPath of context.temp_directories) {
      try {
        await this.cleanupDirectory(dirPath);
        result.cleaned_directories++;
      } catch (error) {
        result.errors.push(`Failed to cleanup directory ${dirPath}: ${error}`);
      }
    }

    // Cleanup created files
    for (const filePath of context.created_files) {
      try {
        await fs.unlink(filePath);
        result.cleaned_files++;
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          result.warnings.push(`Failed to cleanup file ${filePath}: ${error}`);
        }
      }
    }

    // Restore environment variables
    if (this.config.environment_isolation) {
      for (const varName of context.modified_env_vars) {
        if (varName in this.originalEnv) {
          process.env[varName] = this.originalEnv[varName];
        } else {
          delete process.env[varName];
        }
      }
    }

    // Cleanup fixtures
    if (this.config.fixture_cleanup) {
      for (const fixtureName of context.active_fixtures) {
        try {
          await fixtureManager.teardown(fixtureName);
        } catch (error) {
          result.warnings.push(`Failed to cleanup fixture ${fixtureName}: ${error}`);
        }
      }
    }
  }

  /**
   * Cleanup complete isolation
   */
  private async cleanupCompleteIsolation(context: TestContext, result: CleanupResult): Promise<void> {
    await this.cleanupStandardIsolation(context, result);

    // Cleanup spawned processes
    if (this.config.process_cleanup) {
      for (const pid of context.spawned_processes) {
        try {
          process.kill(pid, 'SIGTERM');
          // Give process time to exit gracefully
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            process.kill(pid, 0); // Check if process still exists
            process.kill(pid, 'SIGKILL'); // Force kill if still running
          } catch {
            // Process already dead, which is what we want
          }
        } catch (error) {
          result.warnings.push(`Failed to cleanup process ${pid}: ${error}`);
        }
      }
    }
  }

  /**
   * Cleanup a directory and its contents
   */
  private async cleanupDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          await this.cleanupDirectory(fullPath);
        } else {
          // Check if file should be preserved
          const shouldPreserve = this.config.preserve_files.some(pattern => 
            entry.name.includes(pattern)
          );
          
          if (!shouldPreserve) {
            await fs.unlink(fullPath);
          }
        }
      }
      
      // Remove directory if empty
      const remainingEntries = await fs.readdir(dirPath);
      if (remainingEntries.length === 0) {
        await fs.rmdir(dirPath);
      }
      
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Generate unique test ID
   */
  private generateTestId(testName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const sanitized = testName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return `${sanitized}-${timestamp}-${random}`;
  }
}

// Global test isolation manager instance
export const testIsolation = new TestIsolationManager();

/**
 * Test isolation decorator for automatic setup/teardown
 */
export function withIsolation(isolationLevel: 'minimal' | 'standard' | 'complete' = 'standard') {
  return function(target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      const testId = await testIsolation.beginTestIsolation(
        propertyName, 
        target.constructor.name, 
        isolationLevel
      );
      
      try {
        return await method.apply(this, args);
      } finally {
        await testIsolation.endTestIsolation(testId);
      }
    };
    
    return descriptor;
  };
}

/**
 * Jest hooks for automatic test isolation
 */
export const JestIsolationHooks = {
  /**
   * Setup isolation before each test
   */
  beforeEach: async () => {
    const testName = expect.getState().currentTestName || 'unknown';
    const testFile = expect.getState().testPath || 'unknown';
    
    return await testIsolation.beginTestIsolation(testName, testFile, 'standard');
  },

  /**
   * Cleanup isolation after each test
   */
  afterEach: async (testId?: string) => {
    if (testId) {
      return await testIsolation.endTestIsolation(testId);
    } else {
      // Cleanup all if testId not provided
      const results = await testIsolation.cleanupAll();
      return results[0]; // Return first result for backward compatibility
    }
  },

  /**
   * Global cleanup after all tests
   */
  afterAll: async () => {
    return await testIsolation.cleanupAll();
  }
};

/**
 * Utility functions for test isolation
 */
export const IsolationUtils = {
  /**
   * Create a temporary test environment
   */
  async createTempEnvironment(testName: string): Promise<{ testId: string; directories: Record<string, string> }> {
    const testId = await testIsolation.beginTestIsolation(testName, 'manual', 'standard');
    
    const directories = {
      events: await testIsolation.createIsolatedDirectory(testId, 'events'),
      responses: await testIsolation.createIsolatedDirectory(testId, 'responses'),
      temp: await testIsolation.createIsolatedDirectory(testId, 'temp'),
      logs: await testIsolation.createIsolatedDirectory(testId, 'logs')
    };

    return { testId, directories };
  },

  /**
   * Setup test environment with specific configuration
   */
  async setupEnvironment(testId: string, config: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      process.env[key] = value;
      testIsolation.trackEnvModification(testId, key);
    }
  },

  /**
   * Create test files in isolated directory
   */
  async createTestFiles(testId: string, files: Array<{ name: string; content: string }>): Promise<string[]> {
    const directory = await testIsolation.createIsolatedDirectory(testId, 'files');
    const filePaths: string[] = [];

    for (const file of files) {
      const filePath = join(directory, file.name);
      await fs.writeFile(filePath, file.content);
      testIsolation.trackFileCreation(testId, filePath);
      filePaths.push(filePath);
    }

    return filePaths;
  },

  /**
   * Wait for test cleanup with timeout
   */
  async waitForCleanup(testId: string, timeoutMs: number = 30000): Promise<CleanupResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Cleanup timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      testIsolation.endTestIsolation(testId)
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }
};
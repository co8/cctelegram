/**
 * Fixture Management System
 * 
 * Comprehensive fixture management for test environment setup and teardown
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { Factory } from '../factories/factory-bot.js';

/**
 * Fixture metadata interface
 */
export interface FixtureMetadata {
  name: string;
  description: string;
  dependencies: string[];
  cleanup_priority: number;
  created_at: string;
  expires_at?: string;
}

/**
 * Fixture file interface
 */
export interface FixtureFile {
  path: string;
  content: string | Buffer;
  encoding?: BufferEncoding;
  mode?: number;
}

/**
 * Fixture directory interface
 */
export interface FixtureDirectory {
  path: string;
  mode?: number;
  recursive?: boolean;
}

/**
 * Environment variable fixture
 */
export interface FixtureEnvironment {
  variables: Record<string, string>;
  restore_original: boolean;
}

/**
 * Process fixture interface
 */
export interface FixtureProcess {
  command: string;
  args: string[];
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  };
  expected_exit_code?: number;
  kill_on_cleanup?: boolean;
}

/**
 * Fixture definition interface
 */
export interface FixtureDefinition {
  metadata: FixtureMetadata;
  directories?: FixtureDirectory[];
  files?: FixtureFile[];
  environment?: FixtureEnvironment;
  processes?: FixtureProcess[];
  setup_hooks?: Array<() => Promise<void>>;
  teardown_hooks?: Array<() => Promise<void>>;
}

/**
 * Fixture state tracking
 */
interface FixtureState {
  name: string;
  active: boolean;
  created_directories: string[];
  created_files: string[];
  original_env: Record<string, string>;
  spawned_processes: any[];
  setup_completed: boolean;
  teardown_required: boolean;
}

/**
 * Main fixture manager class
 */
export class FixtureManager {
  private fixtures = new Map<string, FixtureDefinition>();
  private activeFixtures = new Map<string, FixtureState>();
  private cleanupQueue: string[] = [];

  /**
   * Register a fixture definition
   */
  register(definition: FixtureDefinition): void {
    this.fixtures.set(definition.metadata.name, definition);
  }

  /**
   * Setup a fixture by name
   */
  async setup(fixtureName: string): Promise<void> {
    const definition = this.fixtures.get(fixtureName);
    if (!definition) {
      throw new Error(`Fixture "${fixtureName}" not found`);
    }

    if (this.activeFixtures.has(fixtureName)) {
      throw new Error(`Fixture "${fixtureName}" is already active`);
    }

    const state: FixtureState = {
      name: fixtureName,
      active: true,
      created_directories: [],
      created_files: [],
      original_env: {},
      spawned_processes: [],
      setup_completed: false,
      teardown_required: true
    };

    try {
      // Setup dependencies first
      for (const dependency of definition.metadata.dependencies) {
        if (!this.activeFixtures.has(dependency)) {
          await this.setup(dependency);
        }
      }

      // Create directories
      if (definition.directories) {
        for (const dir of definition.directories) {
          await this.createDirectory(dir, state);
        }
      }

      // Create files
      if (definition.files) {
        for (const file of definition.files) {
          await this.createFile(file, state);
        }
      }

      // Setup environment variables
      if (definition.environment) {
        this.setupEnvironment(definition.environment, state);
      }

      // Start processes
      if (definition.processes) {
        for (const process of definition.processes) {
          await this.startProcess(process, state);
        }
      }

      // Run setup hooks
      if (definition.setup_hooks) {
        for (const hook of definition.setup_hooks) {
          await hook();
        }
      }

      state.setup_completed = true;
      this.activeFixtures.set(fixtureName, state);
      this.cleanupQueue.unshift(fixtureName); // Add to front for LIFO cleanup

    } catch (error) {
      // Cleanup partial state on error
      await this.cleanupState(state);
      throw new Error(`Failed to setup fixture "${fixtureName}": ${error}`);
    }
  }

  /**
   * Teardown a specific fixture
   */
  async teardown(fixtureName: string): Promise<void> {
    const state = this.activeFixtures.get(fixtureName);
    if (!state) {
      return; // Already torn down or never setup
    }

    const definition = this.fixtures.get(fixtureName);
    if (!definition) {
      throw new Error(`Fixture definition "${fixtureName}" not found`);
    }

    try {
      // Run teardown hooks first
      if (definition.teardown_hooks) {
        for (const hook of definition.teardown_hooks.reverse()) {
          await hook();
        }
      }

      await this.cleanupState(state);
      this.activeFixtures.delete(fixtureName);
      
      // Remove from cleanup queue
      const index = this.cleanupQueue.indexOf(fixtureName);
      if (index > -1) {
        this.cleanupQueue.splice(index, 1);
      }

    } catch (error) {
      console.error(`Error during teardown of fixture "${fixtureName}":`, error);
      // Continue cleanup even if there are errors
    }
  }

  /**
   * Teardown all active fixtures
   */
  async teardownAll(): Promise<void> {
    // Cleanup in reverse order (LIFO)
    const fixturesToCleanup = [...this.cleanupQueue];
    
    for (const fixtureName of fixturesToCleanup) {
      await this.teardown(fixtureName);
    }

    this.cleanupQueue = [];
  }

  /**
   * Check if a fixture is active
   */
  isActive(fixtureName: string): boolean {
    return this.activeFixtures.has(fixtureName);
  }

  /**
   * Get list of active fixtures
   */
  getActiveFixtures(): string[] {
    return Array.from(this.activeFixtures.keys());
  }

  /**
   * Create a directory and track it for cleanup
   */
  private async createDirectory(dir: FixtureDirectory, state: FixtureState): Promise<void> {
    try {
      await fs.mkdir(dir.path, { 
        recursive: dir.recursive ?? true, 
        mode: dir.mode 
      });
      state.created_directories.push(dir.path);
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Create a file and track it for cleanup
   */
  private async createFile(file: FixtureFile, state: FixtureState): Promise<void> {
    // Ensure parent directory exists
    const parentDir = dirname(file.path);
    try {
      await fs.mkdir(parentDir, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }

    await fs.writeFile(file.path, file.content, {
      encoding: file.encoding ?? 'utf8',
      mode: file.mode
    });
    state.created_files.push(file.path);
  }

  /**
   * Setup environment variables and save originals
   */
  private setupEnvironment(env: FixtureEnvironment, state: FixtureState): void {
    if (env.restore_original) {
      // Save original values
      for (const key of Object.keys(env.variables)) {
        if (key in process.env) {
          state.original_env[key] = process.env[key]!;
        }
      }
    }

    // Set new values
    Object.assign(process.env, env.variables);
  }

  /**
   * Start a process and track it for cleanup
   */
  private async startProcess(processConfig: FixtureProcess, state: FixtureState): Promise<void> {
    const { spawn } = await import('child_process');
    
    const child = spawn(processConfig.command, processConfig.args, {
      cwd: processConfig.options?.cwd,
      env: { ...process.env, ...processConfig.options?.env },
      stdio: 'pipe'
    });

    // Setup timeout if specified
    let timeoutId: NodeJS.Timeout | undefined;
    if (processConfig.options?.timeout) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
      }, processConfig.options.timeout);
    }

    // Track process for cleanup
    state.spawned_processes.push({
      child,
      timeoutId,
      kill_on_cleanup: processConfig.kill_on_cleanup ?? true
    });

    // Wait for process to start (give it a moment)
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Cleanup state (files, directories, processes, environment)
   */
  private async cleanupState(state: FixtureState): Promise<void> {
    const errors: Error[] = [];

    // Kill processes
    for (const proc of state.spawned_processes) {
      try {
        if (proc.timeoutId) {
          clearTimeout(proc.timeoutId);
        }
        if (proc.kill_on_cleanup && !proc.child.killed) {
          proc.child.kill('SIGTERM');
          // Give process time to exit gracefully
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!proc.child.killed) {
            proc.child.kill('SIGKILL');
          }
        }
      } catch (error) {
        errors.push(error as Error);
      }
    }

    // Remove files
    for (const filePath of state.created_files.reverse()) {
      try {
        await fs.unlink(filePath);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          errors.push(error);
        }
      }
    }

    // Remove directories (in reverse order)
    for (const dirPath of state.created_directories.reverse()) {
      try {
        await fs.rmdir(dirPath);
      } catch (error: any) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') {
          errors.push(error);
        }
      }
    }

    // Restore environment variables
    for (const [key, value] of Object.entries(state.original_env)) {
      process.env[key] = value;
    }

    if (errors.length > 0) {
      console.warn(`Cleanup errors for fixture "${state.name}":`, errors);
    }
  }
}

// Global fixture manager instance
export const fixtureManager = new FixtureManager();

/**
 * Fixture helper functions for common patterns
 */
export class Fixtures {
  /**
   * Create a temporary directory fixture
   */
  static tempDirectory(name: string, basePath: string = '/tmp'): FixtureDefinition {
    const path = join(basePath, `test-${name}-${Date.now()}`);
    
    return {
      metadata: {
        name: `temp_dir_${name}`,
        description: `Temporary directory for ${name}`,
        dependencies: [],
        cleanup_priority: 100,
        created_at: new Date().toISOString()
      },
      directories: [{
        path,
        recursive: true,
        mode: 0o755
      }]
    };
  }

  /**
   * Create a test data files fixture
   */
  static testDataFiles(name: string, dataCount: number = 10): FixtureDefinition {
    const basePath = `/tmp/test-data-${name}-${Date.now()}`;
    const events = Factory.buildList('event', dataCount);
    const responses = Factory.buildList('telegram_response', Math.floor(dataCount / 2));

    const files: FixtureFile[] = [
      // Event files
      ...events.map((event, index) => ({
        path: join(basePath, 'events', `event-${index.toString().padStart(3, '0')}.json`),
        content: JSON.stringify(event, null, 2)
      })),
      // Response files
      ...responses.map((response, index) => ({
        path: join(basePath, 'responses', `response-${index.toString().padStart(3, '0')}.json`),
        content: JSON.stringify(response, null, 2)
      }))
    ];

    return {
      metadata: {
        name: `test_data_${name}`,
        description: `Test data files for ${name}`,
        dependencies: [],
        cleanup_priority: 90,
        created_at: new Date().toISOString()
      },
      directories: [
        { path: join(basePath, 'events'), recursive: true },
        { path: join(basePath, 'responses'), recursive: true }
      ],
      files
    };
  }

  /**
   * Create a bridge configuration fixture
   */
  static bridgeConfig(name: string, traits: string[] = []): FixtureDefinition {
    const config = Factory.build('bridge_config', {}, traits);
    const configPath = `/tmp/bridge-config-${name}-${Date.now()}.toml`;

    // Convert config to TOML format (simplified)
    const tomlContent = Object.entries(config)
      .map(([section, values]) => {
        const sectionContent = Object.entries(values as any)
          .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
          .join('\n');
        return `[${section}]\n${sectionContent}`;
      })
      .join('\n\n');

    return {
      metadata: {
        name: `bridge_config_${name}`,
        description: `Bridge configuration for ${name}`,
        dependencies: [],
        cleanup_priority: 80,
        created_at: new Date().toISOString()
      },
      files: [{
        path: configPath,
        content: tomlContent
      }]
    };
  }

  /**
   * Create an environment fixture
   */
  static environment(name: string, envVars: Record<string, string>): FixtureDefinition {
    return {
      metadata: {
        name: `env_${name}`,
        description: `Environment setup for ${name}`,
        dependencies: [],
        cleanup_priority: 70,
        created_at: new Date().toISOString()
      },
      environment: {
        variables: envVars,
        restore_original: true
      }
    };
  }

  /**
   * Create a mock server fixture
   */
  static mockServer(name: string, port: number, responses: any[]): FixtureDefinition {
    return {
      metadata: {
        name: `mock_server_${name}`,
        description: `Mock server for ${name}`,
        dependencies: [],
        cleanup_priority: 60,
        created_at: new Date().toISOString()
      },
      setup_hooks: [
        async () => {
          // Start mock server (implementation would depend on testing framework)
          console.log(`Starting mock server for ${name} on port ${port}`);
        }
      ],
      teardown_hooks: [
        async () => {
          console.log(`Stopping mock server for ${name}`);
        }
      ]
    };
  }

  /**
   * Create a composite fixture combining multiple fixtures
   */
  static composite(name: string, fixtures: string[]): FixtureDefinition {
    return {
      metadata: {
        name: `composite_${name}`,
        description: `Composite fixture combining: ${fixtures.join(', ')}`,
        dependencies: fixtures,
        cleanup_priority: 10,
        created_at: new Date().toISOString()
      }
    };
  }
}

/**
 * Test helper functions for fixture management
 */
export const FixtureHelpers = {
  /**
   * Setup common test fixtures
   */
  async setupCommonFixtures(): Promise<void> {
    // Register common fixtures
    fixtureManager.register(Fixtures.tempDirectory('events'));
    fixtureManager.register(Fixtures.tempDirectory('responses'));
    fixtureManager.register(Fixtures.environment('testing', {
      NODE_ENV: 'test',
      CC_TELEGRAM_EVENTS_DIR: '/tmp/test-events',
      CC_TELEGRAM_RESPONSES_DIR: '/tmp/test-responses'
    }));

    // Setup the fixtures
    await fixtureManager.setup('env_testing');
    await fixtureManager.setup('temp_dir_events');
    await fixtureManager.setup('temp_dir_responses');
  },

  /**
   * Create a complete test environment
   */
  async setupTestEnvironment(testName: string): Promise<string> {
    const envFixture = Fixtures.environment(`test_${testName}`, {
      NODE_ENV: 'test',
      MCP_LOG_LEVEL: 'error',
      CC_TELEGRAM_EVENTS_DIR: `/tmp/test-${testName}-events`,
      CC_TELEGRAM_RESPONSES_DIR: `/tmp/test-${testName}-responses`
    });

    const dataFixture = Fixtures.testDataFiles(testName, 20);
    const compositeFixture = Fixtures.composite(testName, [
      `env_test_${testName}`,
      `test_data_${testName}`
    ]);

    fixtureManager.register(envFixture);
    fixtureManager.register(dataFixture);
    fixtureManager.register(compositeFixture);

    await fixtureManager.setup(`composite_${testName}`);
    return `composite_${testName}`;
  },

  /**
   * Clean up after tests
   */
  async cleanup(): Promise<void> {
    await fixtureManager.teardownAll();
    Factory.resetSequences();
  }
};
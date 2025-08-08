/**
 * Bridge Process Manager
 * Manages the Rust CCTelegram bridge process for testing
 */

import { spawn, ChildProcess } from 'child_process';
import { DebugLogger } from './debug-logger';
import axios from 'axios';
import path from 'path';

export interface BridgeConfig {
  project: {
    root: string;
    bridge_binary_path: string;
  };
  ports: {
    bridge_health: number;
    bridge_webhook: number;
  };
  timeouts: {
    bridge_startup: number;
  };
  debug: {
    enable_verbose_logging: boolean;
  };
}

export class BridgeProcessManager {
  private process: ChildProcess | null = null;
  private config: BridgeConfig;
  private logger: DebugLogger;
  private logBuffer: string[] = [];
  private isCapturingLogs = false;

  constructor(config: BridgeConfig, logger: DebugLogger) {
    this.config = config;
    this.logger = logger;
  }

  async start(env: Record<string, string> = {}): Promise<ChildProcess> {
    if (this.process) {
      this.logger.warn('Bridge process already running, stopping first...');
      await this.stop();
    }

    this.logger.info('Starting bridge process...');

    // Determine the bridge binary path
    const binaryPath = this.resolveBinaryPath();
    this.logger.info(`Using bridge binary: ${binaryPath}`);

    // Build the bridge if needed
    await this.ensureBinaryExists(binaryPath);

    // Spawn the bridge process
    this.process = spawn(binaryPath, [], {
      env: {
        ...process.env,
        ...env
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.config.project.root
    });

    // Set up log capture
    this.setupLogCapture();

    // Wait for startup
    await this.waitForStartup();

    this.logger.info('✓ Bridge process started successfully');
    return this.process;
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.logger.info('Stopping bridge process...');

    return new Promise((resolve) => {
      const cleanup = () => {
        this.process = null;
        this.logger.info('✓ Bridge process stopped');
        resolve();
      };

      if (this.process!.killed) {
        cleanup();
        return;
      }

      this.process!.on('exit', cleanup);
      
      // Try graceful shutdown first
      this.process!.kill('SIGTERM');

      // Force kill if needed
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.logger.warn('Force killing bridge process...');
          this.process.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  async restart(env?: Record<string, string>): Promise<ChildProcess> {
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    return this.start(env);
  }

  async waitForHealth(timeoutMs: number = this.config.timeouts.bridge_startup): Promise<void> {
    const startTime = Date.now();
    const healthUrl = `http://localhost:${this.config.ports.bridge_health}/health`;

    this.logger.info(`Waiting for bridge health check at ${healthUrl}...`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await axios.get(healthUrl, {
          timeout: 2000,
          validateStatus: () => true // Accept any status code
        });

        if (response.status === 200) {
          this.logger.info('✓ Bridge health check passed');
          return;
        }

        this.logger.debug(`Health check returned status ${response.status}`);
      } catch (error) {
        // Expected while starting up
        this.logger.debug(`Health check failed: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`Bridge failed to become healthy within ${timeoutMs}ms`);
  }

  async ensureRunning(): Promise<void> {
    if (!this.process || this.process.killed) {
      throw new Error('Bridge process is not running');
    }

    await this.waitForHealth(5000);
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await axios.get(`http://localhost:${this.config.ports.bridge_health}/health`, {
        timeout: 2000
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  startLogCapture(): { stop: () => string[] } {
    this.isCapturingLogs = true;
    this.logBuffer = [];

    return {
      stop: () => {
        this.isCapturingLogs = false;
        const logs = [...this.logBuffer];
        this.logBuffer = [];
        return logs;
      }
    };
  }

  async cleanup(): Promise<void> {
    await this.stop();
  }

  private resolveBinaryPath(): string {
    const projectRoot = this.config.project.root;
    const binaryPath = this.config.project.bridge_binary_path;

    if (path.isAbsolute(binaryPath)) {
      return binaryPath;
    }

    // Try different possible locations
    const possiblePaths = [
      path.join(projectRoot, binaryPath),
      path.join(projectRoot, 'target', 'release', 'cc-telegram-bridge'),
      path.join(projectRoot, 'target', 'debug', 'cc-telegram-bridge'),
      path.join(projectRoot, 'cc-telegram-bridge'),
    ];

    for (const possiblePath of possiblePaths) {
      try {
        require('fs').accessSync(possiblePath, require('fs').constants.X_OK);
        return possiblePath;
      } catch {
        // Continue to next path
      }
    }

    // If not found, assume we need to build it
    return path.join(projectRoot, 'target', 'release', 'cc-telegram-bridge');
  }

  private async ensureBinaryExists(binaryPath: string): Promise<void> {
    try {
      require('fs').accessSync(binaryPath, require('fs').constants.X_OK);
      this.logger.info('Bridge binary found');
      return;
    } catch {
      this.logger.info('Bridge binary not found, building...');
    }

    // Build the project
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const buildProcess = spawn('cargo', ['build', '--release'], {
        cwd: this.config.project.root,
        stdio: 'inherit'
      });

      buildProcess.on('exit', (code) => {
        if (code === 0) {
          this.logger.info('✓ Bridge binary built successfully');
          resolve(undefined);
        } else {
          reject(new Error(`Build failed with exit code ${code}`));
        }
      });

      buildProcess.on('error', (error) => {
        reject(new Error(`Build process error: ${error.message}`));
      });
    });
  }

  private async waitForStartup(): Promise<void> {
    if (!this.process) {
      throw new Error('No process to wait for');
    }

    return new Promise((resolve, reject) => {
      let resolved = false;

      // Set up timeout
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Bridge startup timeout after ${this.config.timeouts.bridge_startup}ms`));
        }
      }, this.config.timeouts.bridge_startup);

      // Wait for initial output or health check success
      let outputReceived = false;
      
      const checkHealth = async () => {
        if (resolved || !this.process) return;
        
        try {
          if (await this.isHealthy()) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve();
            }
          } else {
            setTimeout(checkHealth, 500);
          }
        } catch {
          setTimeout(checkHealth, 500);
        }
      };

      // Start health check polling
      setTimeout(checkHealth, 2000);

      // Handle process errors
      this.process!.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Bridge process error: ${error.message}`));
        }
      });

      this.process!.on('exit', (code, signal) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Bridge process exited early with code ${code} and signal ${signal}`));
        }
      });
    });
  }

  private setupLogCapture(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (data) => {
      const logLine = data.toString();
      if (this.config.debug.enable_verbose_logging) {
        this.logger.debug('[BRIDGE STDOUT]', logLine.trim());
      }
      if (this.isCapturingLogs) {
        this.logBuffer.push(`[STDOUT] ${logLine.trim()}`);
      }
    });

    this.process.stderr?.on('data', (data) => {
      const logLine = data.toString();
      if (this.config.debug.enable_verbose_logging) {
        this.logger.debug('[BRIDGE STDERR]', logLine.trim());
      }
      if (this.isCapturingLogs) {
        this.logBuffer.push(`[STDERR] ${logLine.trim()}`);
      }
    });
  }
}
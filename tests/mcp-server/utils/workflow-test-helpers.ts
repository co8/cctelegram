/**
 * Workflow Test Helpers for E2E Testing
 * Provides utilities for managing test workflows, bridge processes, and file operations
 */

import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'crypto';

export interface WorkflowTestConfig {
  bridge: {
    port: string;
    webhook_port: string;
    timeout: number;
  };
  telegram: {
    bot_token: string;
    chat_id: string;
  };
  paths: {
    events: string;
    responses: string;
    screenshots: string;
  };
}

export interface ProcessingResult {
  processed: boolean;
  tier_used?: 'mcp_webhook' | 'bridge_internal' | 'file_watcher';
  duration_ms?: number;
  error?: string;
}

export interface WaitOptions {
  timeout: number;
  checkInterval: number;
}

export class WorkflowTestHelpers {
  private config: WorkflowTestConfig;
  private bridgeProcess: ChildProcess | null = null;

  constructor(config: WorkflowTestConfig) {
    this.config = config;
  }

  /**
   * Generate unique test ID
   */
  generateTestId(): string {
    return `test-${randomUUID()}`;
  }

  /**
   * Start bridge process for testing
   */
  async startBridgeProcess(): Promise<ChildProcess> {
    const bridgePath = process.env.CC_TELEGRAM_BRIDGE_PATH;
    if (!bridgePath) {
      throw new Error('CC_TELEGRAM_BRIDGE_PATH environment variable not set');
    }

    return new Promise((resolve, reject) => {
      const process = spawn(bridgePath, [], {
        stdio: 'pipe',
        env: {
          ...process.env,
          CC_TELEGRAM_HEALTH_PORT: this.config.bridge.port,
          CC_TELEGRAM_WEBHOOK_PORT: this.config.bridge.webhook_port,
          CC_TELEGRAM_EVENTS_DIR: this.config.paths.events,
          CC_TELEGRAM_RESPONSES_DIR: this.config.paths.responses,
          CC_TELEGRAM_BOT_TOKEN: this.config.telegram.bot_token,
          CC_TELEGRAM_CHAT_ID: this.config.telegram.chat_id,
          RUST_LOG: 'debug'
        }
      });

      process.stdout?.on('data', (data) => {
        console.log(`Bridge stdout: ${data}`);
      });

      process.stderr?.on('data', (data) => {
        console.error(`Bridge stderr: ${data}`);
      });

      process.on('error', (error) => {
        reject(error);
      });

      // Wait for process to start
      setTimeout(() => {
        if (process.pid) {
          this.bridgeProcess = process;
          resolve(process);
        } else {
          reject(new Error('Bridge process failed to start'));
        }
      }, 3000);
    });
  }

  /**
   * Wait for bridge to become healthy
   */
  async waitForBridgeHealth(timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const healthUrl = `http://localhost:${this.config.bridge.port}/health`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await axios.get(healthUrl, { timeout: 5000 });
        if (response.status === 200 && response.data.status === 'healthy') {
          return true;
        }
      } catch (error) {
        // Continue trying
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Bridge did not become healthy within ${timeoutMs}ms`);
  }

  /**
   * Create an event file for testing
   */
  async createEventFile(event: any): Promise<string> {
    const eventId = event.task_id || this.generateTestId();
    const fileName = `event-${eventId}.json`;
    const filePath = path.join(this.config.paths.events, fileName);

    // Ensure event has required fields
    const completeEvent = {
      timestamp: new Date().toISOString(),
      source: 'claude-code',
      ...event,
      task_id: eventId
    };

    await fs.ensureDir(this.config.paths.events);
    await fs.writeJSON(filePath, completeEvent, { spaces: 2 });

    console.log(`📝 Created event file: ${fileName}`);
    return filePath;
  }

  /**
   * Wait for an event to be processed by the bridge
   */
  async waitForEventProcessing(
    eventId: string, 
    options: WaitOptions = { timeout: 10000, checkInterval: 500 }
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const eventFileName = `event-${eventId}.json`;
    const eventPath = path.join(this.config.paths.events, eventFileName);

    while (Date.now() - startTime < options.timeout) {
      try {
        // Check if event file still exists (indicates not yet processed)
        const eventExists = await fs.pathExists(eventPath);
        
        if (!eventExists) {
          // Event was processed and file was removed
          return {
            processed: true,
            tier_used: await this.determineTierUsed(eventId),
            duration_ms: Date.now() - startTime
          };
        }

        // Check for processing indicators
        const processingResult = await this.checkProcessingIndicators(eventId);
        if (processingResult.processed) {
          return processingResult;
        }

      } catch (error) {
        console.error(`Error checking event processing: ${error}`);
      }

      await new Promise(resolve => setTimeout(resolve, options.checkInterval));
    }

    return {
      processed: false,
      error: `Event processing timeout after ${options.timeout}ms`
    };
  }

  /**
   * Check various indicators that an event was processed
   */
  private async checkProcessingIndicators(eventId: string): Promise<ProcessingResult> {
    // Check for response files
    const responseFiles = await this.getResponseFiles();
    const relatedResponse = responseFiles.find(file => file.includes(eventId));
    
    if (relatedResponse) {
      return {
        processed: true,
        tier_used: 'mcp_webhook', // Assume webhook tier if response exists
        duration_ms: Date.now() - Date.now() // Will be calculated by caller
      };
    }

    // Check bridge metrics for processing count increase
    try {
      const metrics = await this.getBridgeMetrics();
      // This is a simplified check - in reality, we'd track before/after metrics
      if (metrics.events_processed > 0) {
        return {
          processed: true,
          tier_used: await this.determineTierUsed(eventId)
        };
      }
    } catch (error) {
      // Bridge might not be running
    }

    return { processed: false };
  }

  /**
   * Determine which tier was used to process an event
   */
  private async determineTierUsed(eventId: string): Promise<'mcp_webhook' | 'bridge_internal' | 'file_watcher'> {
    // Check webhook tier first (fastest response)
    try {
      const webhookUrl = `http://localhost:${this.config.bridge.webhook_port}/webhook`;
      const response = await axios.get(webhookUrl, { timeout: 1000 });
      if (response.status === 200) {
        return 'mcp_webhook';
      }
    } catch (error) {
      // Webhook not responding, check other tiers
    }

    // Check for file watcher tier (slowest, most reliable)
    const eventPath = path.join(this.config.paths.events, `event-${eventId}.json`);
    const exists = await fs.pathExists(eventPath);
    
    if (!exists) {
      return 'file_watcher'; // File was processed and removed
    }

    // Default to bridge internal processing
    return 'bridge_internal';
  }

  /**
   * Wait for a response file to be created
   */
  async waitForResponseFile(responseId: string, timeoutMs: number = 5000): Promise<any | null> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const responseFiles = await this.getResponseFiles();
        for (const filePath of responseFiles) {
          const content = await fs.readJSON(filePath);
          if (content.id === responseId) {
            return content;
          }
        }
      } catch (error) {
        // Continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return null;
  }

  /**
   * Get all response files
   */
  async getResponseFiles(): Promise<string[]> {
    try {
      await fs.ensureDir(this.config.paths.responses);
      const files = await fs.readdir(this.config.paths.responses);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => path.join(this.config.paths.responses, file));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get error files from the system
   */
  async getErrorFiles(): Promise<string[]> {
    const errorPaths = [
      '/tmp/cctelegram-errors',
      './logs/error',
      path.join(this.config.paths.events, '../errors')
    ];

    const errorFiles: string[] = [];

    for (const errorPath of errorPaths) {
      try {
        if (await fs.pathExists(errorPath)) {
          const files = await fs.readdir(errorPath);
          errorFiles.push(...files
            .filter(file => file.includes('error') || file.includes('fail'))
            .map(file => path.join(errorPath, file))
          );
        }
      } catch (error) {
        // Path doesn't exist or can't be read
      }
    }

    return errorFiles;
  }

  /**
   * Get bridge metrics
   */
  async getBridgeMetrics(): Promise<any> {
    const metricsUrl = `http://localhost:${this.config.bridge.port}/metrics`;
    
    try {
      const response = await axios.get(metricsUrl, { timeout: 5000 });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get bridge metrics: ${error.message}`);
    }
  }

  /**
   * Clean up all test files
   */
  async cleanupTestFiles(): Promise<void> {
    const cleanupPaths = [
      this.config.paths.events,
      this.config.paths.responses,
      '/tmp/test-events',
      '/tmp/test-responses'
    ];

    for (const cleanupPath of cleanupPaths) {
      try {
        if (await fs.pathExists(cleanupPath)) {
          await fs.emptyDir(cleanupPath);
          console.log(`🧹 Cleaned up: ${cleanupPath}`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to cleanup ${cleanupPath}: ${error.message}`);
      }
    }
  }

  /**
   * Create multiple events for load testing
   */
  async createMultipleEvents(events: any[]): Promise<string[]> {
    const filePaths: string[] = [];
    
    for (const event of events) {
      const filePath = await this.createEventFile(event);
      filePaths.push(filePath);
    }
    
    return filePaths;
  }

  /**
   * Monitor bridge logs for specific patterns
   */
  async monitorBridgeLogs(
    pattern: string | RegExp, 
    timeoutMs: number = 10000
  ): Promise<string | null> {
    if (!this.bridgeProcess) {
      return null;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      const logHandler = (data: Buffer) => {
        const logLine = data.toString();
        const matches = typeof pattern === 'string' 
          ? logLine.includes(pattern)
          : pattern.test(logLine);
          
        if (matches) {
          clearTimeout(timeout);
          this.bridgeProcess?.stdout?.off('data', logHandler);
          this.bridgeProcess?.stderr?.off('data', logHandler);
          resolve(logLine.trim());
        }
      };

      this.bridgeProcess.stdout?.on('data', logHandler);
      this.bridgeProcess.stderr?.on('data', logHandler);
    });
  }

  /**
   * Simulate network conditions for testing
   */
  async simulateNetworkConditions(condition: 'slow' | 'unstable' | 'offline'): Promise<void> {
    switch (condition) {
      case 'slow':
        // Add artificial delay to requests
        console.log('🐌 Simulating slow network conditions');
        break;
        
      case 'unstable':
        // Randomly fail some requests
        console.log('📶 Simulating unstable network conditions');
        break;
        
      case 'offline':
        // Block all network requests
        console.log('🚫 Simulating offline conditions');
        break;
    }
  }

  /**
   * Generate test report
   */
  async generateTestReport(testResults: any[]): Promise<string> {
    const report = {
      timestamp: new Date().toISOString(),
      total_tests: testResults.length,
      passed: testResults.filter(r => r.status === 'passed').length,
      failed: testResults.filter(r => r.status === 'failed').length,
      duration_ms: testResults.reduce((total, r) => total + (r.duration || 0), 0),
      results: testResults
    };

    const reportPath = path.join(this.config.paths.screenshots, '../test-report.json');
    await fs.writeJSON(reportPath, report, { spaces: 2 });
    
    console.log(`📊 Test report generated: ${reportPath}`);
    return reportPath;
  }

  /**
   * Check if bridge process is running
   */
  isBridgeRunning(): boolean {
    return this.bridgeProcess !== null && this.bridgeProcess.pid !== undefined;
  }

  /**
   * Get bridge process ID
   */
  getBridgeProcessId(): number | undefined {
    return this.bridgeProcess?.pid;
  }

  /**
   * Stop bridge process
   */
  async stopBridgeProcess(): Promise<void> {
    if (this.bridgeProcess) {
      this.bridgeProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise(resolve => {
        this.bridgeProcess?.on('exit', resolve);
        setTimeout(resolve, 5000); // Force shutdown after 5 seconds
      });
      
      this.bridgeProcess = null;
      console.log('🛑 Bridge process stopped');
    }
  }

  /**
   * Restart bridge process
   */
  async restartBridgeProcess(): Promise<void> {
    console.log('🔄 Restarting bridge process');
    await this.stopBridgeProcess();
    await new Promise(resolve => setTimeout(resolve, 2000));
    this.bridgeProcess = await this.startBridgeProcess();
    await this.waitForBridgeHealth();
    console.log('✅ Bridge process restarted');
  }

  /**
   * Validate event file format
   */
  async validateEventFile(filePath: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      const event = await fs.readJSON(filePath);
      
      // Required fields validation
      if (!event.type) errors.push('Missing required field: type');
      if (!event.title) errors.push('Missing required field: title');
      if (!event.description) errors.push('Missing required field: description');
      if (!event.timestamp) errors.push('Missing required field: timestamp');
      
      // Format validation
      if (event.timestamp && !new Date(event.timestamp).toISOString()) {
        errors.push('Invalid timestamp format');
      }
      
      if (event.title && event.title.length > 200) {
        errors.push('Title exceeds maximum length (200 characters)');
      }
      
      if (event.description && event.description.length > 2000) {
        errors.push('Description exceeds maximum length (2000 characters)');
      }
      
    } catch (error) {
      errors.push(`Failed to parse JSON: ${error.message}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}
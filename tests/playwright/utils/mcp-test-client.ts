/**
 * MCP Test Client
 * Manages MCP server process and provides testing interface
 */

import { spawn, ChildProcess } from 'child_process';
import { DebugLogger } from './debug-logger';
import axios from 'axios';
import path from 'path';

export interface McpResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpTestClient {
  private process: ChildProcess | null = null;
  private port: number;
  private logger: DebugLogger;
  private nextRequestId = 1;

  constructor(port: number, logger: DebugLogger) {
    this.port = port;
    this.logger = logger;
  }

  async startMcpServer(mcpServerPath: string): Promise<ChildProcess> {
    if (this.process) {
      this.logger.warn('MCP server already running, stopping first...');
      await this.stop();
    }

    this.logger.info('Starting MCP server...');

    const serverDir = path.resolve(mcpServerPath);
    const serverScript = path.join(serverDir, 'dist', 'index.js');

    // Ensure the server is built
    await this.ensureServerBuilt(serverDir);

    // Start the MCP server
    this.process = spawn('node', [serverScript], {
      cwd: serverDir,
      env: {
        ...process.env,
        PORT: this.port.toString(),
        MCP_ENABLE_AUTH: 'false',
        MCP_ENABLE_RATE_LIMIT: 'false',
        MCP_LOG_LEVEL: 'debug'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Set up logging
    this.setupLogging();

    // Wait for server to be ready
    await this.waitForReady();

    this.logger.info('✓ MCP server started successfully');
    return this.process;
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.logger.info('Stopping MCP server...');

    return new Promise((resolve) => {
      const cleanup = () => {
        this.process = null;
        this.logger.info('✓ MCP server stopped');
        resolve();
      };

      if (this.process!.killed) {
        cleanup();
        return;
      }

      this.process!.on('exit', cleanup);
      
      // Try graceful shutdown
      this.process!.kill('SIGTERM');

      // Force kill if needed
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.logger.warn('Force killing MCP server...');
          this.process.kill('SIGKILL');
        }
      }, 3000);
    });
  }

  async start(mcpServerPath: string): Promise<ChildProcess> {
    return this.startMcpServer(mcpServerPath);
  }

  async waitForReady(timeoutMs: number = 10000): Promise<void> {
    if (!this.process) {
      throw new Error('MCP server process not started');
    }

    const startTime = Date.now();
    this.logger.info('Waiting for MCP server to be ready...');

    while (Date.now() - startTime < timeoutMs) {
      if (this.process.killed) {
        throw new Error('MCP server process died during startup');
      }

      try {
        // Test basic MCP functionality
        await this.callFunction('list_tools', {});
        this.logger.info('✓ MCP server is ready');
        return;
      } catch (error) {
        this.logger.debug(`MCP server not ready yet: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`MCP server failed to be ready within ${timeoutMs}ms`);
  }

  async ensureRunning(): Promise<void> {
    if (!this.process || this.process.killed) {
      throw new Error('MCP server is not running');
    }

    // Quick health check
    try {
      await this.callFunction('list_tools', {});
    } catch (error) {
      throw new Error(`MCP server health check failed: ${error.message}`);
    }
  }

  async callFunction(functionName: string, args: Record<string, any>): Promise<McpResponse> {
    if (!this.process || this.process.killed) {
      throw new Error('MCP server is not running');
    }

    const requestId = this.nextRequestId++;
    
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name: functionName,
        arguments: args
      }
    };

    this.logger.debug(`MCP Request: ${JSON.stringify(request)}`);

    return new Promise((resolve, reject) => {
      let responseReceived = false;
      let responseBuffer = '';

      const timeout = setTimeout(() => {
        if (!responseReceived) {
          responseReceived = true;
          reject(new Error(`MCP call timed out after 5000ms: ${functionName}`));
        }
      }, 5000);

      // Send the request
      const requestStr = JSON.stringify(request) + '\n';
      
      if (!this.process!.stdin) {
        clearTimeout(timeout);
        reject(new Error('MCP server stdin not available'));
        return;
      }

      this.process!.stdin.write(requestStr, (error) => {
        if (error) {
          clearTimeout(timeout);
          if (!responseReceived) {
            responseReceived = true;
            reject(new Error(`Failed to send MCP request: ${error.message}`));
          }
        }
      });

      // Listen for response
      const onStdout = (data: Buffer) => {
        if (responseReceived) return;

        responseBuffer += data.toString();
        
        // Try to parse complete JSON responses
        const lines = responseBuffer.split('\n');
        responseBuffer = lines.pop() || ''; // Keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const response = JSON.parse(line) as McpResponse;
            
            if (response.id === requestId) {
              responseReceived = true;
              clearTimeout(timeout);
              this.process!.stdout?.off('data', onStdout);
              
              this.logger.debug(`MCP Response: ${JSON.stringify(response)}`);
              resolve(response);
              return;
            }
          } catch (parseError) {
            this.logger.debug(`Failed to parse MCP response line: ${line}`);
          }
        }
      };

      this.process!.stdout?.on('data', onStdout);
    });
  }

  async cleanup(): Promise<void> {
    await this.stop();
  }

  private async ensureServerBuilt(serverDir: string): Promise<void> {
    const distDir = path.join(serverDir, 'dist');
    const indexJs = path.join(distDir, 'index.js');

    try {
      require('fs').accessSync(indexJs);
      this.logger.info('MCP server build found');
      return;
    } catch {
      this.logger.info('MCP server not built, building...');
    }

    // Build the server
    return new Promise((resolve, reject) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        cwd: serverDir,
        stdio: 'inherit'
      });

      buildProcess.on('exit', (code) => {
        if (code === 0) {
          this.logger.info('✓ MCP server built successfully');
          resolve(undefined);
        } else {
          reject(new Error(`MCP server build failed with exit code ${code}`));
        }
      });

      buildProcess.on('error', (error) => {
        reject(new Error(`MCP server build process error: ${error.message}`));
      });
    });
  }

  private setupLogging(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (data) => {
      const logLine = data.toString().trim();
      if (logLine && !logLine.startsWith('{')) {
        // Only log non-JSON output (JSON is MCP protocol)
        this.logger.debug('[MCP STDOUT]', logLine);
      }
    });

    this.process.stderr?.on('data', (data) => {
      const logLine = data.toString().trim();
      if (logLine) {
        this.logger.debug('[MCP STDERR]', logLine);
      }
    });

    this.process.on('error', (error) => {
      this.logger.error('[MCP ERROR]', error.message);
    });

    this.process.on('exit', (code, signal) => {
      if (code !== 0) {
        this.logger.warn(`[MCP EXIT] Code: ${code}, Signal: ${signal}`);
      }
    });
  }
}
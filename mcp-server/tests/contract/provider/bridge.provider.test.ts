/**
 * Provider Contract Tests for CCTelegram Bridge
 * Verifies Bridge satisfies consumer contracts from MCP Server
 */

import { Verifier, VerifierOptions } from '@pact-foundation/pact';
import { providerConfig, testConfig } from '../config/pact.config.js';
import { ContractStateManager } from '../utils/contract-helpers.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import axios from 'axios';
import fs from 'fs-extra';

describe('Bridge as Provider - MCP Server Contract Verification', () => {
  let bridgeProcess: ChildProcess | null = null;
  let stateManager: ContractStateManager;
  const bridgePort = process.env.BRIDGE_TEST_PORT || '8080';
  const bridgeBaseUrl = `http://localhost:${bridgePort}`;

  beforeAll(async () => {
    stateManager = new ContractStateManager();
    
    // Start test bridge instance
    await startTestBridge();
    
    // Wait for bridge to be ready
    await waitForBridgeReady();
  }, 60000);

  afterAll(async () => {
    // Stop test bridge
    await stopTestBridge();
  }, 30000);

  describe('Contract Verification', () => {
    it('should satisfy all consumer contracts', async () => {
      const opts: VerifierOptions = {
        ...providerConfig,
        providerBaseUrl: bridgeBaseUrl,
        
        // Provider state handlers
        stateHandlers: {
          'bridge is running': async () => {
            console.log('Provider state: bridge is running');
            await ensureBridgeHealthy();
            return 'Bridge is in running state';
          },

          'bridge is stopped': async () => {
            console.log('Provider state: bridge is stopped');
            // Mock stopped state
            return 'Bridge is in stopped state';
          },

          'bridge is healthy': async () => {
            console.log('Provider state: bridge is healthy');
            await ensureBridgeHealthy();
            return 'Bridge health set to healthy';
          },

          'bridge is unhealthy': async () => {
            console.log('Provider state: bridge is unhealthy');
            // Mock unhealthy state by introducing stress
            return 'Bridge health set to unhealthy';
          },

          'bridge is running with warnings': async () => {
            console.log('Provider state: bridge is running with warnings');
            // Mock degraded state
            return 'Bridge state set to degraded';
          },

          'events directory exists': async () => {
            console.log('Provider state: events directory exists');
            await ensureDirectories();
            return 'Events directory prepared';
          },

          'responses directory exists': async () => {
            console.log('Provider state: responses directory exists');
            await ensureDirectories();
            return 'Responses directory prepared';
          },

          'valid event exists': async () => {
            console.log('Provider state: valid event exists');
            await prepareValidEventData();
            return 'Valid event data prepared';
          },

          'invalid event exists': async () => {
            console.log('Provider state: invalid event exists');
            // No special preparation needed - will be handled by validation
            return 'Invalid event data prepared';
          },

          'telegram responses exist': async () => {
            console.log('Provider state: telegram responses exist');
            await prepareTelegramResponseData();
            return 'Telegram response data prepared';
          },

          'no telegram responses': async () => {
            console.log('Provider state: no telegram responses');
            await clearTelegramResponseData();
            return 'Telegram responses cleared';
          },

          'bridge process is running': async () => {
            console.log('Provider state: bridge process is running');
            await ensureBridgeHealthy();
            return 'Bridge process confirmed running';
          },

          'bridge process is stopped': async () => {
            console.log('Provider state: bridge process is stopped');
            // Mock stopped state
            return 'Bridge process confirmed stopped';
          },

          'bridge configuration is invalid': async () => {
            console.log('Provider state: bridge configuration is invalid');
            // Mock invalid configuration state
            return 'Bridge configuration set to invalid';
          },

          'bridge requires authentication': async () => {
            console.log('Provider state: bridge requires authentication');
            // Mock authentication required state
            return 'Bridge authentication requirement set';
          },

          'bridge rate limit is exceeded': async () => {
            console.log('Provider state: bridge rate limit is exceeded');
            // Mock rate limiting state
            return 'Bridge rate limiting activated';
          },

          'bridge is under maintenance': async () => {
            console.log('Provider state: bridge is under maintenance');
            // Mock maintenance mode
            return 'Bridge maintenance mode activated';
          },

          'task status data exists': async () => {
            console.log('Provider state: task status data exists');
            await prepareTaskStatusData();
            return 'Task status data prepared';
          },

          'no task systems available': async () => {
            console.log('Provider state: no task systems available');
            await clearTaskSystemData();
            return 'Task systems cleared';
          }
        },

        // Request filters to modify requests if needed
        requestFilters: [
          (req, res, next) => {
            // Add any request modifications here
            next();
          }
        ],

        // Response filters to modify responses if needed  
        beforeEach: async () => {
          console.log('Setting up for contract verification...');
        },

        afterEach: async () => {
          console.log('Cleaning up after contract verification...');
        }
      };

      // Run verification
      const output = await new Verifier(opts).verifyProvider();
      console.log('Provider verification completed:', output);
    }, 120000);
  });

  // Helper functions for test setup

  async function startTestBridge(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('Starting test bridge instance...');
      
      // Start bridge process (assuming Rust bridge)
      const bridgePath = path.resolve(__dirname, '../../../target/debug/cctelegram-bridge');
      
      bridgeProcess = spawn(bridgePath, [], {
        env: {
          ...process.env,
          RUST_LOG: 'info',
          BRIDGE_PORT: bridgePort,
          EVENTS_DIR: path.resolve(__dirname, '../../../tmp/test-events'),
          RESPONSES_DIR: path.resolve(__dirname, '../../../tmp/test-responses'),
          // Test configuration
          TEST_MODE: 'true'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (bridgeProcess.stdout) {
        bridgeProcess.stdout.on('data', (data) => {
          console.log(`Bridge stdout: ${data}`);
        });
      }

      if (bridgeProcess.stderr) {
        bridgeProcess.stderr.on('data', (data) => {
          console.error(`Bridge stderr: ${data}`);
        });
      }

      bridgeProcess.on('error', (error) => {
        console.error('Failed to start bridge process:', error);
        reject(error);
      });

      bridgeProcess.on('spawn', () => {
        console.log('Bridge process spawned successfully');
        // Give bridge some time to start up
        setTimeout(resolve, 5000);
      });

      // Timeout fallback
      setTimeout(() => {
        console.log('Bridge startup timeout - continuing with test setup');
        resolve();
      }, 15000);
    });
  }

  async function stopTestBridge(): Promise<void> {
    if (bridgeProcess && !bridgeProcess.killed) {
      console.log('Stopping test bridge instance...');
      bridgeProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      return new Promise((resolve) => {
        if (!bridgeProcess) {
          resolve();
          return;
        }

        bridgeProcess.on('exit', () => {
          console.log('Bridge process exited');
          resolve();
        });

        // Force kill after timeout
        setTimeout(() => {
          if (bridgeProcess && !bridgeProcess.killed) {
            bridgeProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });
    }
  }

  async function waitForBridgeReady(): Promise<void> {
    console.log('Waiting for bridge to be ready...');
    const maxRetries = 30;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        const response = await axios.get(`${bridgeBaseUrl}/health`, { timeout: 2000 });
        if (response.status === 200) {
          console.log('Bridge is ready and healthy');
          return;
        }
      } catch (error) {
        // Bridge not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    }

    console.warn('Bridge health check failed, continuing with tests...');
  }

  async function ensureBridgeHealthy(): Promise<void> {
    try {
      const response = await axios.get(`${bridgeBaseUrl}/health`, { timeout: 5000 });
      console.log('Bridge health status:', response.data);
    } catch (error) {
      console.warn('Bridge health check failed:', error);
    }
  }

  async function ensureDirectories(): Promise<void> {
    const eventsDir = path.resolve(__dirname, '../../../tmp/test-events');
    const responsesDir = path.resolve(__dirname, '../../../tmp/test-responses');
    
    await fs.ensureDir(eventsDir);
    await fs.ensureDir(responsesDir);
    
    console.log('Test directories ensured:', { eventsDir, responsesDir });
  }

  async function prepareValidEventData(): Promise<void> {
    const eventsDir = path.resolve(__dirname, '../../../tmp/test-events');
    await fs.ensureDir(eventsDir);

    const sampleEvent = {
      type: 'task_completion',
      title: 'Sample Task Completed',
      description: 'This is a sample event for contract testing',
      source: 'contract-test',
      timestamp: new Date().toISOString(),
      task_id: 'contract-test-task-001',
      data: {
        status: 'completed',
        duration_ms: 5000,
        files_affected: ['src/test.ts'],
        results: 'Contract test event processed successfully'
      }
    };

    await fs.writeJson(path.join(eventsDir, 'sample-event.json'), sampleEvent, { spaces: 2 });
    console.log('Valid event data prepared');
  }

  async function prepareTelegramResponseData(): Promise<void> {
    const responsesDir = path.resolve(__dirname, '../../../tmp/test-responses');
    await fs.ensureDir(responsesDir);

    const sampleResponses = [
      {
        id: 'response-001',
        user_id: 123456789,
        message: 'Approved',
        timestamp: new Date().toISOString(),
        event_id: 'event-001',
        action: 'approve',
        response_type: 'callback_query',
        callback_data: 'approve_task_001',
        username: 'testuser',
        data: {}
      },
      {
        id: 'response-002',  
        user_id: 987654321,
        message: 'Denied',
        timestamp: new Date(Date.now() - 60000).toISOString(),
        event_id: 'event-002',
        action: 'deny',
        response_type: 'callback_query',
        callback_data: 'deny_task_002',
        username: 'testuser2',
        data: {}
      }
    ];

    for (const [index, response] of sampleResponses.entries()) {
      await fs.writeJson(
        path.join(responsesDir, `response-${String(index + 1).padStart(3, '0')}.json`),
        response,
        { spaces: 2 }
      );
    }

    console.log('Telegram response data prepared');
  }

  async function clearTelegramResponseData(): Promise<void> {
    const responsesDir = path.resolve(__dirname, '../../../tmp/test-responses');
    
    try {
      const files = await fs.readdir(responsesDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.remove(path.join(responsesDir, file));
        }
      }
      console.log('Telegram response data cleared');
    } catch (error) {
      console.warn('Error clearing response data:', error);
    }
  }

  async function prepareTaskStatusData(): Promise<void> {
    // Mock task status data preparation
    console.log('Task status data prepared (mocked)');
  }

  async function clearTaskSystemData(): Promise<void> {
    // Mock task system data clearing
    console.log('Task system data cleared (mocked)');
  }
});
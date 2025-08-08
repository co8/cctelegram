/**
 * CCTelegram Bridge Debug Test Suite
 * Systematic debugging framework for the /tasks command issue
 * 
 * PROBLEM: Users see old static data (28/29 tasks, 96.55%) instead of live TaskMaster data
 * GOAL: Use automation to identify and fix the data flow issue
 */

import { test, expect, Page, Browser } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { BridgeProcessManager } from './utils/bridge-process-manager';
import { McpTestClient } from './utils/mcp-test-client';
import { TelegramMockServer } from './utils/telegram-mock-server';
import { TaskMasterDataGenerator } from './utils/taskmaster-data-generator';
import { DebugLogger } from './utils/debug-logger';

// Test configuration with comprehensive debugging
const DEBUG_CONFIG = {
  project: {
    root: '/Users/enrique/Documents/cctelegram',
    taskmaster_path: '.taskmaster/tasks/tasks.json',
    mcp_server_path: 'mcp-server',
    bridge_binary_path: 'target/release/cc-telegram-bridge' // Adjust if needed
  },
  ports: {
    bridge_health: 8080,
    bridge_webhook: 3000,
    mcp_server: 3001,
    telegram_mock: 3002
  },
  timeouts: {
    bridge_startup: 15000,
    mcp_response: 5000,
    telegram_response: 3000,
    data_sync: 10000
  },
  debug: {
    enable_verbose_logging: true,
    capture_network_traffic: true,
    save_debug_artifacts: true,
    screenshot_on_failure: true
  }
};

test.describe('CCTelegram Bridge Debug Suite - /tasks Command Issue', () => {
  let bridgeManager: BridgeProcessManager;
  let mcpClient: McpTestClient;
  let telegramMock: TelegramMockServer;
  let taskMasterData: TaskMasterDataGenerator;
  let logger: DebugLogger;
  let browser: Browser;
  let page: Page;

  test.beforeAll(async ({ browser: testBrowser }) => {
    browser = testBrowser;
    page = await browser.newPage();
    
    // Initialize debug utilities
    logger = new DebugLogger('cctelegram-debug', DEBUG_CONFIG.debug.enable_verbose_logging);
    logger.info('Starting CCTelegram Bridge Debug Suite');

    // Initialize test managers
    bridgeManager = new BridgeProcessManager(DEBUG_CONFIG, logger);
    mcpClient = new McpTestClient(DEBUG_CONFIG.ports.mcp_server, logger);
    telegramMock = new TelegramMockServer(DEBUG_CONFIG.ports.telegram_mock, logger);
    taskMasterData = new TaskMasterDataGenerator(DEBUG_CONFIG.project.root, logger);

    // Start mock services
    logger.info('Starting mock services...');
    await telegramMock.start();
    
    // Create test TaskMaster data
    logger.info('Generating test TaskMaster data...');
    await taskMasterData.createTestProject();
  });

  test.afterAll(async () => {
    logger.info('Cleaning up test environment...');
    
    // Cleanup in reverse order
    await bridgeManager.cleanup();
    await mcpClient.cleanup();
    await telegramMock.stop();
    await taskMasterData.cleanup();
    
    if (page) await page.close();
    
    logger.info('Test cleanup completed');
  });

  test.describe('Data Flow Analysis', () => {
    
    test('Step 1: Verify TaskMaster File Data Structure', async () => {
      logger.info('=== STEP 1: TaskMaster File Analysis ===');
      
      // Generate fresh TaskMaster data that should show live values
      const expectedStats = await taskMasterData.generateLiveTaskData({
        completed: 27,
        total: 30,
        pending: 2,
        in_progress: 1,
        blocked: 0,
        subtasks_completed: 45,
        subtasks_total: 50
      });

      logger.info('Expected stats:', expectedStats);

      // Verify the file was written correctly
      const taskMasterFilePath = path.join(DEBUG_CONFIG.project.root, DEBUG_CONFIG.project.taskmaster_path);
      const fileExists = await fs.access(taskMasterFilePath).then(() => true).catch(() => false);
      
      expect(fileExists).toBe(true);
      logger.info('✓ TaskMaster file exists');

      // Read and parse the file
      const fileContent = await fs.readFile(taskMasterFilePath, 'utf-8');
      const taskData = JSON.parse(fileContent);
      
      logger.info('TaskMaster file content structure:', Object.keys(taskData));
      logger.info('TaskMaster tags:', Object.keys(taskData.tags || {}));

      // Verify data structure matches expected format
      expect(taskData).toHaveProperty('tags');
      expect(taskData.tags).toHaveProperty('master');
      expect(taskData.tags.master).toHaveProperty('tasks');
      
      logger.info('✓ TaskMaster file structure is valid');

      // Count actual tasks in file
      const tasks = taskData.tags.master.tasks;
      const actualStats = tasks.reduce((acc, task) => {
        acc.total++;
        switch (task.status) {
          case 'done':
          case 'completed':
            acc.completed++;
            break;
          case 'pending':
            acc.pending++;
            break;
          case 'in-progress':
            acc.in_progress++;
            break;
          case 'blocked':
            acc.blocked++;
            break;
        }

        // Count subtasks
        if (task.subtasks && Array.isArray(task.subtasks)) {
          task.subtasks.forEach(subtask => {
            acc.subtasks_total++;
            if (subtask.status === 'done' || subtask.status === 'completed') {
              acc.subtasks_completed++;
            }
          });
        }

        return acc;
      }, { total: 0, completed: 0, pending: 0, in_progress: 0, blocked: 0, subtasks_total: 0, subtasks_completed: 0 });

      logger.info('Actual file stats:', actualStats);
      logger.info('Expected stats:', expectedStats);

      // Verify the stats match our expectations
      expect(actualStats.completed).toBe(expectedStats.completed);
      expect(actualStats.total).toBe(expectedStats.total);
      
      logger.info('✓ TaskMaster file contains expected data');
    });

    test('Step 2: Test MCP Server Data Retrieval', async () => {
      logger.info('=== STEP 2: MCP Server Analysis ===');
      
      // Start MCP server
      logger.info('Starting MCP server...');
      const mcpProcess = await mcpClient.startMcpServer(DEBUG_CONFIG.project.mcp_server_path);
      
      // Wait for MCP server to be ready
      await mcpClient.waitForReady();
      logger.info('✓ MCP server is ready');

      // Test get_task_status function
      logger.info('Testing get_task_status MCP function...');
      
      try {
        const mcpResponse = await mcpClient.callFunction('get_task_status', {
          project_root: DEBUG_CONFIG.project.root
        });
        
        logger.info('MCP response received:', mcpResponse);

        // Analyze the MCP response format
        expect(mcpResponse).toBeDefined();
        
        if (mcpResponse.error) {
          logger.error('MCP Error:', mcpResponse.error);
          throw new Error(`MCP function failed: ${mcpResponse.error.message}`);
        }

        expect(mcpResponse).toHaveProperty('result');
        
        // Extract data from MCP response
        const mcpData = mcpResponse.result;
        logger.info('MCP data structure:', typeof mcpData);
        
        if (typeof mcpData === 'string') {
          // If it's a string, try to parse it
          const parsedData = JSON.parse(mcpData);
          logger.info('Parsed MCP data:', parsedData);
          
          // Check if it has the expected data structure
          if (parsedData.data && parsedData.data.stats) {
            logger.info('✓ MCP response has expected data.stats structure');
            logger.info('MCP stats:', parsedData.data.stats);
          } else {
            logger.warn('❌ MCP response missing expected data.stats structure');
          }
        } else if (typeof mcpData === 'object') {
          logger.info('MCP data keys:', Object.keys(mcpData));
        }
        
        logger.info('✓ MCP server responds to get_task_status');
        
      } catch (error) {
        logger.error('MCP call failed:', error);
        throw error;
      }
    });

    test('Step 3: Test Bridge Rust MCP Connection', async () => {
      logger.info('=== STEP 3: Bridge MCP Connection Analysis ===');
      
      // Ensure MCP server is running
      await mcpClient.ensureRunning();
      
      // Start the Rust bridge with MCP integration enabled
      logger.info('Starting Rust bridge with MCP integration...');
      
      const bridgeEnv = {
        ...process.env,
        CC_TELEGRAM_HEALTH_PORT: DEBUG_CONFIG.ports.bridge_health.toString(),
        CC_TELEGRAM_WEBHOOK_PORT: DEBUG_CONFIG.ports.bridge_webhook.toString(),
        CC_TELEGRAM_BOT_TOKEN: 'test-token-for-debugging',
        CC_TELEGRAM_ALLOWED_USERS: '123456789',
        CC_TELEGRAM_EVENTS_DIR: '/tmp/test-events',
        CC_TELEGRAM_RESPONSES_DIR: '/tmp/test-responses',
        RUST_LOG: 'debug',
        RUST_BACKTRACE: '1'
      };

      const bridgeProcess = await bridgeManager.start(bridgeEnv);
      
      // Wait for bridge to be healthy
      await bridgeManager.waitForHealth();
      logger.info('✓ Bridge is healthy');

      // Test bridge MCP connection through HTTP API
      logger.info('Testing bridge MCP integration via HTTP...');
      
      try {
        // Make HTTP request to bridge health endpoint to see if MCP is connected
        const response = await page.request.get(`http://localhost:${DEBUG_CONFIG.ports.bridge_health}/health`);
        
        expect(response.ok()).toBe(true);
        
        const healthData = await response.json();
        logger.info('Bridge health response:', healthData);
        
        // Check if MCP integration is mentioned in health response
        if (healthData.mcp_status) {
          logger.info('✓ Bridge reports MCP status:', healthData.mcp_status);
        } else {
          logger.warn('❌ Bridge health response missing MCP status');
        }
        
      } catch (error) {
        logger.error('Bridge health check failed:', error);
        throw error;
      }
    });

    test('Step 4: Test /tasks Command End-to-End', async () => {
      logger.info('=== STEP 4: /tasks Command E2E Test ===');
      
      // Ensure all services are running
      await bridgeManager.ensureRunning();
      await mcpClient.ensureRunning();
      
      logger.info('Simulating /tasks command...');
      
      // Configure Telegram mock to capture outgoing messages
      const messagesReceived = [];
      telegramMock.onMessage((message) => {
        messagesReceived.push(message);
        logger.info('Telegram message received:', message);
      });
      
      // Simulate incoming /tasks command from user
      const incomingMessage = {
        message_id: 12345,
        from: {
          id: 123456789,
          first_name: 'Test',
          username: 'testuser'
        },
        chat: {
          id: 123456789,
          type: 'private'
        },
        date: Math.floor(Date.now() / 1000),
        text: '/tasks'
      };
      
      logger.info('Sending /tasks command to bridge...');
      
      // Send command to bridge webhook
      const webhookResponse = await page.request.post(
        `http://localhost:${DEBUG_CONFIG.ports.bridge_webhook}/webhook`,
        {
          data: {
            update_id: 12345,
            message: incomingMessage
          },
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('Webhook response status:', webhookResponse.status());
      
      if (!webhookResponse.ok()) {
        const responseText = await webhookResponse.text();
        logger.error('Webhook response error:', responseText);
      }
      
      // Wait for bridge to process the command
      logger.info('Waiting for bridge to process /tasks command...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check what messages were sent to Telegram
      logger.info(`Messages sent to Telegram: ${messagesReceived.length}`);
      
      if (messagesReceived.length > 0) {
        const tasksMessage = messagesReceived.find(msg => msg.text && msg.text.includes('TaskMaster'));
        
        if (tasksMessage) {
          logger.info('✓ /tasks response found');
          logger.info('Tasks message content:', tasksMessage.text);
          
          // Analyze the message content for old vs new data
          const messageText = tasksMessage.text;
          
          // Check for static data indicators
          if (messageText.includes('28/29') || messageText.includes('96.55%')) {
            logger.error('❌ FOUND OLD STATIC DATA in /tasks response!');
            logger.error('Response contains static data: 28/29 tasks, 96.55%');
          } else {
            logger.info('✓ No old static data found in response');
          }
          
          // Check for live data indicators
          if (messageText.includes('27/30') || messageText.includes('90%')) {
            logger.info('✓ Found expected live data in response');
          } else {
            logger.warn('❌ Expected live data not found in response');
          }
          
          // Extract all numbers from the response to analyze data source
          const numbers = messageText.match(/\d+/g) || [];
          logger.info('Numbers found in response:', numbers);
          
        } else {
          logger.error('❌ No /tasks response message found');
        }
      } else {
        logger.error('❌ No messages sent to Telegram mock server');
      }
    });
  });

  test.describe('Issue Diagnosis', () => {
    
    test('Diagnose Data Source Priority', async () => {
      logger.info('=== DIAGNOSIS: Data Source Priority ===');
      
      // Test 1: Remove TaskMaster file and see if bridge falls back to MCP
      logger.info('Test 1: Remove TaskMaster file, test MCP fallback...');
      
      const taskMasterPath = path.join(DEBUG_CONFIG.project.root, DEBUG_CONFIG.project.taskmaster_path);
      const backupPath = `${taskMasterPath}.backup`;
      
      // Backup original file
      await fs.copyFile(taskMasterPath, backupPath);
      await fs.unlink(taskMasterPath);
      
      // Trigger /tasks command
      await triggerTasksCommand();
      
      // Check response - should use MCP or show "no tasks found"
      const response1 = await getLastTelegramMessage();
      logger.info('Response without file (should use MCP):', response1?.text || 'No response');
      
      // Restore file
      await fs.copyFile(backupPath, taskMasterPath);
      await fs.unlink(backupPath);
      
      // Test 2: Stop MCP server and see if bridge uses file
      logger.info('Test 2: Stop MCP server, test file fallback...');
      
      await mcpClient.stop();
      
      // Trigger /tasks command
      await triggerTasksCommand();
      
      // Check response - should use file data
      const response2 = await getLastTelegramMessage();
      logger.info('Response without MCP (should use file):', response2?.text || 'No response');
      
      // Restart MCP server
      await mcpClient.start(DEBUG_CONFIG.project.mcp_server_path);
      
      // Test 3: Both available - which takes priority?
      logger.info('Test 3: Both sources available, checking priority...');
      
      await triggerTasksCommand();
      
      const response3 = await getLastTelegramMessage();
      logger.info('Response with both sources:', response3?.text || 'No response');
      
      // Analyze the responses to determine data source priority
      logger.info('=== ANALYSIS COMPLETE ===');
    });

    test('Code Path Analysis via Debug Logging', async () => {
      logger.info('=== DIAGNOSIS: Code Path Analysis ===');
      
      // Restart bridge with maximum debug logging
      await bridgeManager.restart({
        ...process.env,
        RUST_LOG: 'trace',
        CC_TELEGRAM_DEBUG: 'true'
      });
      
      // Trigger /tasks command and capture all logs
      logger.info('Triggering /tasks with full debug logging...');
      
      const logCapture = bridgeManager.startLogCapture();
      
      await triggerTasksCommand();
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const logs = logCapture.stop();
      
      // Analyze logs for data source decision path
      logger.info('Analyzing bridge logs for data source decision...');
      
      const relevantLogs = logs.filter(log => 
        log.includes('TaskMaster') || 
        log.includes('MCP') || 
        log.includes('get_tasks') ||
        log.includes('fallback') ||
        log.includes('data source')
      );
      
      logger.info('Relevant log entries:', relevantLogs);
      
      // Look for specific patterns that indicate the issue
      const mcpLogs = logs.filter(log => log.includes('MCP'));
      const fileLogs = logs.filter(log => log.includes('TaskMaster file'));
      const errorLogs = logs.filter(log => log.toLowerCase().includes('error'));
      
      logger.info(`MCP-related logs: ${mcpLogs.length}`);
      logger.info(`File-related logs: ${fileLogs.length}`);
      logger.info(`Error logs: ${errorLogs.length}`);
      
      if (errorLogs.length > 0) {
        logger.error('Errors found in logs:', errorLogs);
      }
    });
  });

  test.describe('Fix Validation', () => {
    
    test('Apply Potential Fix and Validate', async () => {
      logger.info('=== FIX VALIDATION ===');
      
      // Based on diagnosis, apply the most likely fix
      // This might involve:
      // 1. Fixing MCP connection priority
      // 2. Updating data transformation logic
      // 3. Clearing cached data
      
      logger.info('Applying potential fixes...');
      
      // Fix 1: Clear any cached data in bridge
      try {
        await page.request.post(`http://localhost:${DEBUG_CONFIG.ports.bridge_health}/debug/clear-cache`);
        logger.info('✓ Cleared bridge cache');
      } catch (error) {
        logger.warn('Cache clear failed (may not be implemented):', error.message);
      }
      
      // Fix 2: Force MCP refresh
      try {
        const mcpRefreshResponse = await mcpClient.callFunction('get_task_status', {
          project_root: DEBUG_CONFIG.project.root,
          force_refresh: true
        });
        logger.info('✓ Forced MCP data refresh');
      } catch (error) {
        logger.warn('MCP refresh failed:', error.message);
      }
      
      // Fix 3: Update TaskMaster file with new timestamp to ensure it's fresh
      await taskMasterData.updateTimestamp();
      logger.info('✓ Updated TaskMaster file timestamp');
      
      // Restart bridge to ensure clean state
      await bridgeManager.restart();
      logger.info('✓ Restarted bridge');
      
      // Wait for services to be ready
      await mcpClient.ensureRunning();
      await bridgeManager.waitForHealth();
      
      // Test the fix
      logger.info('Testing fix...');
      
      await triggerTasksCommand();
      
      const fixedResponse = await getLastTelegramMessage();
      logger.info('Response after fix:', fixedResponse?.text || 'No response');
      
      // Validate fix worked
      if (fixedResponse?.text) {
        const hasOldData = fixedResponse.text.includes('28/29') || fixedResponse.text.includes('96.55%');
        const hasNewData = fixedResponse.text.includes('27/30') || fixedResponse.text.includes('90%');
        
        if (!hasOldData && hasNewData) {
          logger.info('✅ FIX SUCCESSFUL - Live data is now showing');
        } else if (hasOldData) {
          logger.error('❌ FIX FAILED - Still showing old static data');
        } else {
          logger.warn('⚠️ FIX UNCLEAR - Neither old nor expected new data found');
        }
      }
    });
  });

  // Helper functions
  async function triggerTasksCommand() {
    const message = {
      message_id: Date.now(),
      from: { id: 123456789, first_name: 'Test', username: 'testuser' },
      chat: { id: 123456789, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: '/tasks'
    };
    
    await page.request.post(
      `http://localhost:${DEBUG_CONFIG.ports.bridge_webhook}/webhook`,
      {
        data: { update_id: Date.now(), message },
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  async function getLastTelegramMessage() {
    return telegramMock.getLastMessage();
  }
});
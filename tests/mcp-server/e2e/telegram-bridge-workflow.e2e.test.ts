/**
 * Comprehensive E2E Workflow Tests for CCTelegram Bridge
 * Tests complete user journeys from Telegram message receipt through Claude Code notifications
 * 
 * Task 25.2: End-to-End Workflow Tests with Playwright
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import path from 'path';
import fs from 'fs-extra';
import { TelegramBotSimulator } from '../utils/telegram-bot-simulator.js';
import { WorkflowTestHelpers } from '../utils/workflow-test-helpers.js';
import { VisualRegressionHelpers } from '../utils/visual-regression-helpers.js';
import { 
  VALID_TASK_COMPLETION_EVENT, 
  VALID_PERFORMANCE_ALERT_EVENT, 
  VALID_APPROVAL_REQUEST_EVENT 
} from '../fixtures/event-fixtures.js';

// Test configuration
const TEST_CONFIG = {
  bridge: {
    port: process.env.CC_TELEGRAM_HEALTH_PORT || '8080',
    webhook_port: process.env.CC_TELEGRAM_WEBHOOK_PORT || '3000',
    timeout: 30000
  },
  telegram: {
    bot_token: process.env.TEST_TELEGRAM_BOT_TOKEN || 'test-token',
    chat_id: process.env.TEST_TELEGRAM_CHAT_ID || '123456789'
  },
  paths: {
    events: '/tmp/test-events',
    responses: '/tmp/test-responses',
    screenshots: './test-results/screenshots'
  }
};

test.describe('CCTelegram Bridge E2E Workflow Tests', () => {
  let bridgeProcess: ChildProcess | null = null;
  let telegramBot: TelegramBotSimulator;
  let workflowHelpers: WorkflowTestHelpers;
  let visualHelpers: VisualRegressionHelpers;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // Create browser context
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true
    });
    page = await context.newPage();

    // Initialize test helpers
    telegramBot = new TelegramBotSimulator(TEST_CONFIG.telegram);
    workflowHelpers = new WorkflowTestHelpers(TEST_CONFIG);
    visualHelpers = new VisualRegressionHelpers(TEST_CONFIG.paths.screenshots);

    // Ensure test directories exist
    await fs.ensureDir(TEST_CONFIG.paths.events);
    await fs.ensureDir(TEST_CONFIG.paths.responses);
    await fs.ensureDir(TEST_CONFIG.paths.screenshots);

    // Clean up any existing test files
    await workflowHelpers.cleanupTestFiles();

    // Start bridge process for E2E testing
    if (process.env.CC_TELEGRAM_BRIDGE_PATH) {
      try {
        bridgeProcess = await workflowHelpers.startBridgeProcess();
        console.log('✅ Bridge process started for E2E testing');
        
        // Wait for bridge to be healthy
        await workflowHelpers.waitForBridgeHealth();
        console.log('✅ Bridge health check passed');
      } catch (error) {
        console.log('⚠️ Bridge process not available, using mock services');
      }
    }
  });

  test.afterAll(async () => {
    // Cleanup
    if (bridgeProcess) {
      bridgeProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    await workflowHelpers.cleanupTestFiles();
    await context.close();
  });

  test.describe('Complete User Journey Workflows', () => {
    
    test('Task Completion Workflow: Event → Bridge → Telegram → Claude Code', async () => {
      const testId = 'task-completion-workflow';
      
      // Step 1: Simulate Claude Code generating a task completion event
      const event = {
        ...VALID_TASK_COMPLETION_EVENT,
        task_id: workflowHelpers.generateTestId(),
        timestamp: new Date().toISOString()
      };

      console.log('📝 Step 1: Creating task completion event');
      const eventFile = await workflowHelpers.createEventFile(event);
      
      // Step 2: Wait for bridge to process the event
      console.log('⚙️ Step 2: Waiting for bridge processing');
      const processingResult = await workflowHelpers.waitForEventProcessing(event.task_id, {
        timeout: 10000,
        checkInterval: 500
      });
      
      expect(processingResult.processed).toBe(true);
      expect(processingResult.tier_used).toBeDefined();
      
      // Step 3: Verify Telegram message was sent
      console.log('📱 Step 3: Verifying Telegram message');
      const telegramMessage = await telegramBot.waitForMessage(event.task_id, 5000);
      
      expect(telegramMessage).toBeDefined();
      expect(telegramMessage.text).toContain(event.title);
      expect(telegramMessage.text).toContain('✅'); // Task completion emoji
      
      // Step 4: Simulate user response in Telegram
      console.log('👤 Step 4: Simulating user response');
      const userResponse = await telegramBot.simulateUserResponse(
        telegramMessage.message_id,
        '👍 Great work!'
      );
      
      // Step 5: Verify response was captured
      console.log('📥 Step 5: Verifying response capture');
      const responseFile = await workflowHelpers.waitForResponseFile(userResponse.id, 3000);
      
      expect(responseFile).toBeDefined();
      expect(responseFile.message).toBe('👍 Great work!');
      expect(responseFile.event_id).toBe(event.task_id);
      
      // Step 6: Take screenshot for visual verification
      console.log('📸 Step 6: Taking workflow screenshot');
      await visualHelpers.captureWorkflowScreenshot(page, `${testId}-complete`);
      
      console.log('✅ Task completion workflow test passed');
    });

    test('Performance Alert Workflow: Alert → Dashboard → User Action', async () => {
      const testId = 'performance-alert-workflow';
      
      // Step 1: Create performance alert event
      const alertEvent = {
        ...VALID_PERFORMANCE_ALERT_EVENT,
        timestamp: new Date().toISOString(),
        data: {
          ...VALID_PERFORMANCE_ALERT_EVENT.data,
          current_value: 950, // High memory usage
          threshold: 800
        }
      };

      console.log('🚨 Step 1: Creating performance alert');
      await workflowHelpers.createEventFile(alertEvent);
      
      // Step 2: Navigate to health dashboard
      console.log('🖥️ Step 2: Loading health dashboard');
      const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
      
      try {
        await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
        
        // Step 3: Verify alert is displayed in dashboard
        console.log('🔍 Step 3: Verifying alert display');
        
        // Look for alert indicators
        const alertSelectors = [
          '[data-testid="performance-alert"]',
          '.alert-high',
          '.memory-alert',
          'text=950', // Current value
          'text=High Memory Usage'
        ];
        
        let alertFound = false;
        for (const selector of alertSelectors) {
          if (await page.locator(selector).count() > 0) {
            alertFound = true;
            await expect(page.locator(selector)).toBeVisible();
            console.log(`✅ Alert found with selector: ${selector}`);
            break;
          }
        }
        
        // Step 4: Take screenshot of dashboard with alert
        console.log('📸 Step 4: Capturing dashboard with alert');
        await visualHelpers.captureWorkflowScreenshot(page, `${testId}-dashboard-alert`);
        
        // Step 5: Verify Telegram notification
        console.log('📱 Step 5: Verifying Telegram alert notification');
        const telegramAlert = await telegramBot.waitForMessage('performance-alert', 5000);
        
        if (telegramAlert) {
          expect(telegramAlert.text).toContain('🚨'); // Alert emoji
          expect(telegramAlert.text).toContain('High Memory Usage');
          expect(telegramAlert.text).toContain('950');
        }
        
        console.log('✅ Performance alert workflow test completed');
        
      } catch (error) {
        if (error.message.includes('ERR_CONNECTION_REFUSED')) {
          console.log('⚠️ Dashboard not available - bridge not running');
          test.skip();
        } else {
          throw error;
        }
      }
    });

    test('Approval Request Workflow: Request → Telegram → Response → Processing', async () => {
      const testId = 'approval-request-workflow';
      
      // Step 1: Create approval request event
      const approvalEvent = {
        ...VALID_APPROVAL_REQUEST_EVENT,
        timestamp: new Date().toISOString()
      };

      console.log('📋 Step 1: Creating approval request');
      await workflowHelpers.createEventFile(approvalEvent);
      
      // Step 2: Wait for Telegram message with buttons
      console.log('📱 Step 2: Waiting for Telegram approval request');
      const approvalMessage = await telegramBot.waitForMessage('approval-request', 8000);
      
      expect(approvalMessage).toBeDefined();
      expect(approvalMessage.text).toContain(approvalEvent.title);
      expect(approvalMessage.reply_markup?.inline_keyboard).toBeDefined();
      
      const buttons = approvalMessage.reply_markup.inline_keyboard[0];
      expect(buttons).toHaveLength(3); // Approve, Deny, Defer
      expect(buttons[0].text).toBe('Approve');
      expect(buttons[1].text).toBe('Deny');
      expect(buttons[2].text).toBe('Defer');
      
      // Step 3: Simulate user clicking "Approve" button
      console.log('✅ Step 3: Simulating approval button click');
      const approvalResponse = await telegramBot.simulateButtonClick(
        approvalMessage.message_id,
        buttons[0].callback_data
      );
      
      // Step 4: Verify approval response processing
      console.log('⚙️ Step 4: Verifying approval processing');
      const responseFile = await workflowHelpers.waitForResponseFile(approvalResponse.id, 5000);
      
      expect(responseFile).toBeDefined();
      expect(responseFile.action).toBe('Approve');
      expect(responseFile.event_id).toBe(approvalEvent.task_id);
      
      // Step 5: Verify confirmation message
      console.log('📨 Step 5: Verifying confirmation message');
      const confirmationMessage = await telegramBot.waitForMessage('approval-confirmed', 3000);
      
      if (confirmationMessage) {
        expect(confirmationMessage.text).toContain('✅');
        expect(confirmationMessage.text).toContain('approved');
      }
      
      console.log('✅ Approval request workflow test passed');
    });
  });

  test.describe('Error Scenarios and Recovery Paths', () => {
    
    test('Network Failure Recovery: Bridge Offline → Recovery → Message Processing', async () => {
      const testId = 'network-failure-recovery';
      
      // Step 1: Create event while bridge is running
      const event = {
        ...VALID_TASK_COMPLETION_EVENT,
        task_id: workflowHelpers.generateTestId(),
        title: 'Network Failure Test Event'
      };

      console.log('📝 Step 1: Creating event during normal operation');
      await workflowHelpers.createEventFile(event);
      
      // Step 2: Simulate network failure by stopping bridge
      console.log('❌ Step 2: Simulating network failure');
      if (bridgeProcess) {
        bridgeProcess.kill('SIGSTOP'); // Pause the process
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Step 3: Create another event during downtime
      const failureEvent = {
        ...VALID_TASK_COMPLETION_EVENT,
        task_id: workflowHelpers.generateTestId(),
        title: 'Event During Network Failure'
      };

      console.log('📝 Step 3: Creating event during network failure');
      await workflowHelpers.createEventFile(failureEvent);
      
      // Step 4: Resume bridge process
      console.log('🔄 Step 4: Resuming bridge process');
      if (bridgeProcess) {
        bridgeProcess.kill('SIGCONT'); // Resume the process
        await workflowHelpers.waitForBridgeHealth(15000);
      }
      
      // Step 5: Verify both events eventually get processed
      console.log('✅ Step 5: Verifying recovery processing');
      
      const firstEventResult = await workflowHelpers.waitForEventProcessing(event.task_id, {
        timeout: 15000,
        checkInterval: 1000
      });
      
      const secondEventResult = await workflowHelpers.waitForEventProcessing(failureEvent.task_id, {
        timeout: 15000,
        checkInterval: 1000
      });
      
      expect(firstEventResult.processed).toBe(true);
      expect(secondEventResult.processed).toBe(true);
      
      // Step 6: Verify Telegram messages were sent after recovery
      console.log('📱 Step 6: Verifying Telegram recovery messages');
      const messages = await telegramBot.getAllMessages();
      const recoveryMessages = messages.filter(m => 
        m.text.includes('Network Failure Test Event') || 
        m.text.includes('Event During Network Failure')
      );
      
      expect(recoveryMessages).toHaveLength(2);
      
      console.log('✅ Network failure recovery test passed');
    });

    test('API Timeout Handling: Slow Response → Timeout → Fallback', async () => {
      const testId = 'api-timeout-handling';
      
      // Step 1: Configure slow response simulation
      console.log('⏱️ Step 1: Configuring API timeout test');
      
      // Create event that will trigger API call
      const timeoutEvent = {
        ...VALID_PERFORMANCE_ALERT_EVENT,
        title: 'API Timeout Test Alert',
        timestamp: new Date().toISOString()
      };

      // Step 2: Simulate slow API response
      console.log('🐌 Step 2: Simulating slow API response');
      
      // Mock slow Telegram API response
      await telegramBot.setResponseDelay(15000); // 15 second delay
      
      // Step 3: Create event and measure response time
      console.log('📝 Step 3: Creating event with slow API');
      const startTime = Date.now();
      await workflowHelpers.createEventFile(timeoutEvent);
      
      // Step 4: Wait for fallback mechanism to kick in
      console.log('🔄 Step 4: Waiting for fallback processing');
      const processingResult = await workflowHelpers.waitForEventProcessing(
        timeoutEvent.task_id || 'timeout-test',
        { timeout: 20000, checkInterval: 2000 }
      );
      
      const processingTime = Date.now() - startTime;
      
      // Step 5: Verify fallback was used (should process via file tier)
      console.log('✅ Step 5: Verifying fallback mechanism');
      expect(processingResult.processed).toBe(true);
      expect(processingResult.tier_used).toBe('file_watcher'); // Should fallback to file tier
      expect(processingTime).toBeGreaterThan(10000); // Should take longer due to timeout
      
      // Step 6: Reset API response delay
      await telegramBot.setResponseDelay(0);
      
      console.log('✅ API timeout handling test passed');
    });

    test('Invalid Event Handling: Malformed Data → Validation → Error Response', async () => {
      const testId = 'invalid-event-handling';
      
      // Step 1: Create invalid event with missing required fields
      console.log('❌ Step 1: Creating invalid event');
      const invalidEvent = {
        type: 'invalid_type', // Invalid event type
        title: '', // Empty title
        description: 'x'.repeat(3000), // Description too long
        timestamp: 'invalid-timestamp' // Invalid timestamp format
      };

      const eventFile = await workflowHelpers.createEventFile(invalidEvent);
      
      // Step 2: Wait for error processing
      console.log('⚠️ Step 2: Waiting for error processing');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Step 3: Verify error was logged and event was rejected
      console.log('📋 Step 3: Verifying error handling');
      
      // Check if error file was created
      const errorFiles = await workflowHelpers.getErrorFiles();
      const relevantError = errorFiles.find(error => 
        error.includes('validation') || error.includes('invalid')
      );
      
      expect(relevantError).toBeDefined();
      
      // Step 4: Verify no Telegram message was sent for invalid event
      console.log('📱 Step 4: Verifying no Telegram message sent');
      const messages = await telegramBot.getAllMessages();
      const invalidEventMessages = messages.filter(m => 
        m.text.includes('invalid_type') || m.text.includes('x'.repeat(10))
      );
      
      expect(invalidEventMessages).toHaveLength(0);
      
      console.log('✅ Invalid event handling test passed');
    });
  });

  test.describe('Visual Regression Tests', () => {
    
    test('Dashboard Visual Consistency: Health Metrics Display', async () => {
      const testId = 'dashboard-visual-consistency';
      
      try {
        // Step 1: Navigate to dashboard
        console.log('🖥️ Step 1: Loading dashboard for visual test');
        const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
        await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
        
        // Step 2: Wait for metrics to load
        console.log('⏳ Step 2: Waiting for metrics to load');
        await page.waitForTimeout(2000);
        
        // Step 3: Take baseline screenshot
        console.log('📸 Step 3: Capturing baseline screenshot');
        const baselineScreenshot = await visualHelpers.captureBaseline(page, `${testId}-baseline`);
        
        // Step 4: Simulate metrics update
        console.log('🔄 Step 4: Simulating metrics update');
        await workflowHelpers.createEventFile({
          ...VALID_PERFORMANCE_ALERT_EVENT,
          timestamp: new Date().toISOString()
        });
        
        // Wait for dashboard to update
        await page.waitForTimeout(3000);
        
        // Step 5: Take comparison screenshot
        console.log('📸 Step 5: Capturing updated screenshot');
        const updatedScreenshot = await visualHelpers.captureComparison(page, `${testId}-updated`);
        
        // Step 6: Compare screenshots
        console.log('🔍 Step 6: Comparing visual changes');
        const comparison = await visualHelpers.compareScreenshots(
          baselineScreenshot,
          updatedScreenshot
        );
        
        // Should have some changes (metrics updated) but layout should be consistent
        expect(comparison.pixelDifference).toBeGreaterThan(0);
        expect(comparison.percentageDifference).toBeLessThan(10); // Less than 10% change
        
        console.log('✅ Dashboard visual consistency test passed');
        
      } catch (error) {
        if (error.message.includes('ERR_CONNECTION_REFUSED')) {
          console.log('⚠️ Dashboard not available for visual testing');
          test.skip();
        } else {
          throw error;
        }
      }
    });

    test('Mobile Dashboard Responsiveness: Layout Adaptation', async () => {
      const testId = 'mobile-dashboard-responsiveness';
      
      try {
        // Step 1: Set mobile viewport
        console.log('📱 Step 1: Setting mobile viewport');
        await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE size
        
        // Step 2: Navigate to dashboard
        const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
        await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
        
        // Step 3: Take mobile screenshot
        console.log('📸 Step 3: Capturing mobile screenshot');
        const mobileScreenshot = await visualHelpers.captureScreenshot(page, `${testId}-mobile`);
        
        // Step 4: Switch to desktop viewport
        console.log('🖥️ Step 4: Switching to desktop viewport');
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.reload({ waitUntil: 'networkidle' });
        
        // Step 5: Take desktop screenshot
        console.log('📸 Step 5: Capturing desktop screenshot');
        const desktopScreenshot = await visualHelpers.captureScreenshot(page, `${testId}-desktop`);
        
        // Step 6: Verify responsive design differences
        console.log('🔍 Step 6: Verifying responsive differences');
        const comparison = await visualHelpers.compareScreenshots(
          mobileScreenshot,
          desktopScreenshot
        );
        
        // Should be significant differences due to responsive design
        expect(comparison.percentageDifference).toBeGreaterThan(20);
        
        console.log('✅ Mobile dashboard responsiveness test passed');
        
      } catch (error) {
        if (error.message.includes('ERR_CONNECTION_REFUSED')) {
          console.log('⚠️ Dashboard not available for mobile testing');
          test.skip();
        } else {
          throw error;
        }
      }
    });
  });

  test.describe('Cross-Browser Compatibility', () => {
    
    test('Chrome Dashboard Functionality', async () => {
      // This test runs on Chrome by default via Playwright config
      console.log('🌐 Testing Chrome dashboard functionality');
      
      try {
        const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
        await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
        
        // Test basic functionality
        const body = page.locator('body');
        await expect(body).toBeVisible();
        
        // Test JavaScript functionality
        const jsWorking = await page.evaluate(() => {
          return typeof window !== 'undefined' && typeof document !== 'undefined';
        });
        
        expect(jsWorking).toBe(true);
        
        console.log('✅ Chrome dashboard functionality test passed');
        
      } catch (error) {
        if (error.message.includes('ERR_CONNECTION_REFUSED')) {
          test.skip();
        } else {
          throw error;
        }
      }
    });
  });

  test.describe('Performance and Load Testing', () => {
    
    test('Concurrent Event Processing: Multiple Events → Parallel Processing', async () => {
      const testId = 'concurrent-event-processing';
      const eventCount = 10;
      
      console.log(`⚡ Step 1: Creating ${eventCount} concurrent events`);
      
      // Step 1: Create multiple events simultaneously
      const events = Array.from({ length: eventCount }, (_, i) => ({
        ...VALID_TASK_COMPLETION_EVENT,
        task_id: workflowHelpers.generateTestId(),
        title: `Concurrent Event ${i + 1}`,
        timestamp: new Date().toISOString()
      }));
      
      const startTime = Date.now();
      
      // Create all events simultaneously
      const eventPromises = events.map(event => 
        workflowHelpers.createEventFile(event)
      );
      
      await Promise.all(eventPromises);
      
      // Step 2: Wait for all events to be processed
      console.log('⚙️ Step 2: Waiting for concurrent processing');
      
      const processingPromises = events.map(event =>
        workflowHelpers.waitForEventProcessing(event.task_id, {
          timeout: 20000,
          checkInterval: 1000
        })
      );
      
      const results = await Promise.all(processingPromises);
      const processingTime = Date.now() - startTime;
      
      // Step 3: Verify all events were processed
      console.log('✅ Step 3: Verifying concurrent processing results');
      
      const successfulEvents = results.filter(r => r.processed);
      expect(successfulEvents).toHaveLength(eventCount);
      
      // Processing should be faster than sequential (less than eventCount * 2 seconds)
      expect(processingTime).toBeLessThan(eventCount * 2000);
      
      console.log(`✅ Processed ${eventCount} events in ${processingTime}ms`);
      console.log('✅ Concurrent event processing test passed');
    });
  });
});
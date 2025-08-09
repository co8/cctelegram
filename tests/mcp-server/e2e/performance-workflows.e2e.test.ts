/**
 * Performance-Focused E2E Workflow Tests
 * Tests system performance under various load conditions and network scenarios
 */

import { test, expect } from '@playwright/test';
import { WorkflowTestHelpers } from '../utils/workflow-test-helpers.js';
import { VisualRegressionHelpers } from '../utils/visual-regression-helpers.js';
import { TelegramBotSimulator } from '../utils/telegram-bot-simulator.js';
import { 
  VALID_TASK_COMPLETION_EVENT,
  VALID_PERFORMANCE_ALERT_EVENT 
} from '../fixtures/event-fixtures.js';

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

test.describe('Performance E2E Workflow Tests', () => {
  let workflowHelpers: WorkflowTestHelpers;
  let visualHelpers: VisualRegressionHelpers;
  let telegramBot: TelegramBotSimulator;

  test.beforeEach(async () => {
    workflowHelpers = new WorkflowTestHelpers(TEST_CONFIG);
    visualHelpers = new VisualRegressionHelpers(TEST_CONFIG.paths.screenshots);
    telegramBot = new TelegramBotSimulator(TEST_CONFIG.telegram);
    
    await workflowHelpers.cleanupTestFiles();
  });

  test('High-volume event processing: 50 concurrent events', async () => {
    const testId = 'high-volume-processing';
    const eventCount = 50;
    
    console.log(`⚡ Starting high-volume test with ${eventCount} events`);
    
    // Generate multiple events with different types
    const events = Array.from({ length: eventCount }, (_, i) => {
      const eventTypes = ['task_completion', 'performance_alert', 'info_notification', 'error_occurred'];
      const eventType = eventTypes[i % eventTypes.length];
      
      return {
        ...VALID_TASK_COMPLETION_EVENT,
        type: eventType,
        task_id: workflowHelpers.generateTestId(),
        title: `High Volume Event ${i + 1}`,
        description: `Performance test event number ${i + 1}`,
        timestamp: new Date(Date.now() + i * 100).toISOString() // Stagger timestamps
      };
    });
    
    // Measure event creation time
    console.log('📝 Creating events...');
    const createStartTime = Date.now();
    
    const eventPromises = events.map(event => 
      workflowHelpers.createEventFile(event)
    );
    
    await Promise.all(eventPromises);
    const createDuration = Date.now() - createStartTime;
    
    console.log(`📝 Created ${eventCount} events in ${createDuration}ms`);
    
    // Measure processing time
    console.log('⚙️ Waiting for processing...');
    const processStartTime = Date.now();
    
    const processingPromises = events.map(event =>
      workflowHelpers.waitForEventProcessing(event.task_id, {
        timeout: 60000, // Extended timeout for high volume
        checkInterval: 2000
      })
    );
    
    const results = await Promise.all(processingPromises);
    const processDuration = Date.now() - processStartTime;
    
    // Analyze results
    const successfulEvents = results.filter(r => r.processed);
    const failedEvents = results.filter(r => !r.processed);
    
    console.log(`⚡ Processed ${successfulEvents.length}/${eventCount} events in ${processDuration}ms`);
    console.log(`📊 Average processing time: ${processDuration / eventCount}ms per event`);
    console.log(`📊 Throughput: ${(eventCount / processDuration * 1000).toFixed(2)} events/second`);
    
    // Performance assertions
    expect(successfulEvents.length).toBeGreaterThan(eventCount * 0.9); // At least 90% success rate
    expect(processDuration).toBeLessThan(120000); // Should complete within 2 minutes
    expect(processDuration / eventCount).toBeLessThan(2000); // Average < 2 seconds per event
    
    // Check for memory leaks or performance degradation
    try {
      const finalMetrics = await workflowHelpers.getBridgeMetrics();
      console.log('📊 Final bridge metrics:', finalMetrics);
      
      if (finalMetrics.memory_usage_mb) {
        expect(finalMetrics.memory_usage_mb).toBeLessThan(500); // Less than 500MB
      }
    } catch (error) {
      console.log('⚠️ Could not retrieve final metrics');
    }
    
    console.log('✅ High-volume processing test completed');
  });

  test('Slow network conditions: 3G simulation', async ({ page }) => {
    const testId = 'slow-network-3g';
    
    console.log('🐌 Testing slow network conditions (3G simulation)');
    
    // Simulate slow 3G network
    await page.route('**/*', async route => {
      // Add artificial delay to simulate slow network
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      await route.continue();
    });
    
    // Test dashboard load time under slow network
    const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
    
    try {
      const startTime = Date.now();
      await page.goto(dashboardUrl, { 
        waitUntil: 'networkidle',
        timeout: 60000 // Extended timeout for slow network
      });
      const loadTime = Date.now() - startTime;
      
      console.log(`🐌 Dashboard loaded in ${loadTime}ms under slow network`);
      
      // Should still load within reasonable time (10 seconds for 3G)
      expect(loadTime).toBeLessThan(10000);
      
      // Take screenshot
      await visualHelpers.captureScreenshot(page, `${testId}-dashboard-loaded`, {
        fullPage: true
      });
      
      // Test event processing under slow network
      const slowNetworkEvent = {
        ...VALID_PERFORMANCE_ALERT_EVENT,
        task_id: workflowHelpers. generateTestId(),
        title: 'Slow Network Test Event',
        timestamp: new Date().toISOString()
      };
      
      const eventStartTime = Date.now();
      await workflowHelpers.createEventFile(slowNetworkEvent);
      
      const processingResult = await workflowHelpers.waitForEventProcessing(
        slowNetworkEvent.task_id,
        { timeout: 30000, checkInterval: 3000 }
      );
      
      const eventProcessTime = Date.now() - eventStartTime;
      
      console.log(`🐌 Event processing time under slow network: ${eventProcessTime}ms`);
      console.log(`🐌 Processing result:`, processingResult);
      
      // Should still process successfully, even if slower
      expect(processingResult.processed).toBe(true);
      expect(eventProcessTime).toBeLessThan(30000); // Within 30 seconds
      
    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        console.log('⚠️ Dashboard not available for slow network testing');
        test.skip();
      } else {
        throw error;
      }
    }
    
    console.log('✅ Slow network test completed');
  });

  test('Memory usage stability during extended operation', async () => {
    const testId = 'memory-stability';
    const testDurationMs = 30000; // 30 seconds
    const eventInterval = 2000; // Create event every 2 seconds
    
    console.log(`🧠 Testing memory stability over ${testDurationMs}ms`);
    
    const memorySnapshots = [];
    const startTime = Date.now();
    let eventCounter = 0;
    
    // Function to take memory snapshot
    const takeMemorySnapshot = async () => {
      try {
        const metrics = await workflowHelpers.getBridgeMetrics();
        const snapshot = {
          timestamp: Date.now(),
          memory_mb: metrics.memory_usage_mb || 0,
          events_processed: metrics.events_processed || 0,
          uptime: metrics.uptime_seconds || 0
        };
        memorySnapshots.push(snapshot);
        console.log(`🧠 Memory snapshot: ${snapshot.memory_mb}MB, Events: ${snapshot.events_processed}`);
      } catch (error) {
        console.log('⚠️ Could not take memory snapshot');
      }
    };
    
    // Initial memory snapshot
    await takeMemorySnapshot();
    
    // Run test for specified duration
    const testInterval = setInterval(async () => {
      // Create test event
      eventCounter++;
      const event = {
        ...VALID_TASK_COMPLETION_EVENT,
        task_id: workflowHelpers.generateTestId(),
        title: `Memory Test Event ${eventCounter}`,
        timestamp: new Date().toISOString()
      };
      
      await workflowHelpers.createEventFile(event);
      
      // Take memory snapshot
      await takeMemorySnapshot();
      
    }, eventInterval);
    
    // Wait for test duration
    await new Promise(resolve => setTimeout(resolve, testDurationMs));
    clearInterval(testInterval);
    
    // Final memory snapshot
    await takeMemorySnapshot();
    
    console.log(`🧠 Memory test completed. Created ${eventCounter} events over ${testDurationMs}ms`);
    
    // Analyze memory usage patterns
    if (memorySnapshots.length >= 2) {
      const initialMemory = memorySnapshots[0].memory_mb;
      const finalMemory = memorySnapshots[memorySnapshots.length - 1].memory_mb;
      const maxMemory = Math.max(...memorySnapshots.map(s => s.memory_mb));
      const avgMemory = memorySnapshots.reduce((sum, s) => sum + s.memory_mb, 0) / memorySnapshots.length;
      
      console.log(`🧠 Memory analysis:`);
      console.log(`   Initial: ${initialMemory}MB`);
      console.log(`   Final: ${finalMemory}MB`);
      console.log(`   Max: ${maxMemory}MB`);
      console.log(`   Average: ${avgMemory.toFixed(2)}MB`);
      console.log(`   Growth: ${finalMemory - initialMemory}MB`);
      
      // Memory stability assertions
      expect(maxMemory).toBeLessThan(1000); // Should not exceed 1GB
      expect(finalMemory - initialMemory).toBeLessThan(200); // Growth should be < 200MB
      
      // Check for memory leaks (steady increase)
      const memoryTrend = memorySnapshots.slice(-3).map(s => s.memory_mb);
      const isIncreasing = memoryTrend.every((val, i) => i === 0 || val >= memoryTrend[i - 1]);
      
      if (isIncreasing && memoryTrend[memoryTrend.length - 1] - memoryTrend[0] > 100) {
        console.warn('⚠️ Potential memory leak detected');
      }
    }
    
    console.log('✅ Memory stability test completed');
  });

  test('Dashboard performance under concurrent user simulation', async ({ browser }) => {
    const testId = 'concurrent-users';
    const userCount = 5;
    
    console.log(`👥 Simulating ${userCount} concurrent users`);
    
    // Create multiple browser contexts (users)
    const contexts = [];
    const pages = [];
    
    for (let i = 0; i < userCount; i++) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 }
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }
    
    try {
      const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
      
      // Measure concurrent load times
      const loadPromises = pages.map(async (page, index) => {
        const startTime = Date.now();
        await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
        const loadTime = Date.now() - startTime;
        
        console.log(`👤 User ${index + 1} loaded dashboard in ${loadTime}ms`);
        return { user: index + 1, loadTime };
      });
      
      const loadResults = await Promise.all(loadPromises);
      
      // Analyze load times
      const avgLoadTime = loadResults.reduce((sum, r) => sum + r.loadTime, 0) / loadResults.length;
      const maxLoadTime = Math.max(...loadResults.map(r => r.loadTime));
      const minLoadTime = Math.min(...loadResults.map(r => r.loadTime));
      
      console.log(`👥 Concurrent load analysis:`);
      console.log(`   Average: ${avgLoadTime.toFixed(0)}ms`);
      console.log(`   Max: ${maxLoadTime}ms`);
      console.log(`   Min: ${minLoadTime}ms`);
      
      // Performance assertions for concurrent access
      expect(avgLoadTime).toBeLessThan(5000); // Average < 5 seconds
      expect(maxLoadTime).toBeLessThan(10000); // Max < 10 seconds
      
      // Test concurrent interactions
      const interactionPromises = pages.map(async (page, index) => {
        // Simulate user interactions
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
        
        // Click around if interactive elements exist
        const buttons = await page.locator('button').count();
        if (buttons > 0) {
          await page.locator('button').first().click();
        }
        
        // Take screenshot of each user's view
        await visualHelpers.captureScreenshot(page, `${testId}-user-${index + 1}`);
      });
      
      await Promise.all(interactionPromises);
      
    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        console.log('⚠️ Dashboard not available for concurrent user testing');
        test.skip();
      } else {
        throw error;
      }
    } finally {
      // Clean up contexts
      await Promise.all(contexts.map(context => context.close()));
    }
    
    console.log('✅ Concurrent users test completed');
  });

  test('Event processing performance degradation under load', async () => {
    const testId = 'performance-degradation';
    const loadSteps = [1, 5, 10, 20]; // Increasing load levels
    
    console.log('📈 Testing performance degradation under increasing load');
    
    const performanceData = [];
    
    for (const eventCount of loadSteps) {
      console.log(`📈 Testing with ${eventCount} concurrent events`);
      
      // Create events for this load level
      const events = Array.from({ length: eventCount }, (_, i) => ({
        ...VALID_TASK_COMPLETION_EVENT,
        task_id: workflowHelpers.generateTestId(),
        title: `Load Test ${eventCount}x - Event ${i + 1}`,
        timestamp: new Date().toISOString()
      }));
      
      // Measure processing time
      const startTime = Date.now();
      
      // Create all events
      const createPromises = events.map(event => 
        workflowHelpers.createEventFile(event)
      );
      await Promise.all(createPromises);
      
      // Wait for processing
      const processPromises = events.map(event =>
        workflowHelpers.waitForEventProcessing(event.task_id, {
          timeout: 30000,
          checkInterval: 1000
        })
      );
      
      const results = await Promise.all(processPromises);
      const totalTime = Date.now() - startTime;
      
      const successCount = results.filter(r => r.processed).length;
      const avgTimePerEvent = totalTime / eventCount;
      const throughput = (successCount / totalTime) * 1000; // events per second
      
      const performanceEntry = {
        eventCount,
        totalTime,
        avgTimePerEvent,
        throughput,
        successRate: (successCount / eventCount) * 100
      };
      
      performanceData.push(performanceEntry);
      
      console.log(`📈 Load ${eventCount}: ${totalTime}ms total, ${avgTimePerEvent.toFixed(0)}ms avg, ${throughput.toFixed(2)} events/sec, ${performanceEntry.successRate.toFixed(1)}% success`);
      
      // Brief pause between load tests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Analyze performance degradation
    console.log('📈 Performance degradation analysis:');
    
    for (let i = 1; i < performanceData.length; i++) {
      const current = performanceData[i];
      const previous = performanceData[i - 1];
      
      const timeIncrease = ((current.avgTimePerEvent - previous.avgTimePerEvent) / previous.avgTimePerEvent) * 100;
      const throughputDecrease = ((previous.throughput - current.throughput) / previous.throughput) * 100;
      
      console.log(`📈 ${previous.eventCount} → ${current.eventCount} events:`);
      console.log(`   Time increase: ${timeIncrease.toFixed(1)}%`);
      console.log(`   Throughput decrease: ${throughputDecrease.toFixed(1)}%`);
      
      // Performance degradation should be reasonable
      expect(timeIncrease).toBeLessThan(200); // Time shouldn't increase more than 200%
      expect(throughputDecrease).toBeLessThan(80); // Throughput shouldn't decrease more than 80%
    }
    
    // Overall performance requirements
    const maxLoadPerformance = performanceData[performanceData.length - 1];
    expect(maxLoadPerformance.avgTimePerEvent).toBeLessThan(5000); // < 5 seconds average at max load
    expect(maxLoadPerformance.successRate).toBeGreaterThan(90); // > 90% success rate
    
    console.log('✅ Performance degradation test completed');
  });
});
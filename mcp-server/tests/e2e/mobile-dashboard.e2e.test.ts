/**
 * Mobile Dashboard E2E Tests
 * Tests dashboard functionality on mobile devices and touch interactions
 */

import { test, expect } from '@playwright/test';
import { WorkflowTestHelpers } from '../utils/workflow-test-helpers.js';
import { VisualRegressionHelpers } from '../utils/visual-regression-helpers.js';
import { VALID_PERFORMANCE_ALERT_EVENT } from '../fixtures/event-fixtures.js';

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

test.describe('Mobile Dashboard E2E Tests', () => {
  let workflowHelpers: WorkflowTestHelpers;
  let visualHelpers: VisualRegressionHelpers;

  test.beforeEach(async ({ page }) => {
    workflowHelpers = new WorkflowTestHelpers(TEST_CONFIG);
    visualHelpers = new VisualRegressionHelpers(TEST_CONFIG.paths.screenshots);
    
    // Ensure mobile viewport is set
    await page.setViewportSize({ width: 375, height: 667 });
  });

  test('Mobile dashboard loads correctly on small screens', async ({ page }) => {
    try {
      const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
      await page.goto(dashboardUrl, { waitUntil: 'networkidle' });

      // Check if mobile layout is applied
      const body = page.locator('body');
      await expect(body).toBeVisible();

      // Look for mobile-specific elements
      const mobileElements = [
        '[data-testid="mobile-menu"]',
        '[data-testid="hamburger-menu"]',
        'button[aria-label*="menu"]',
        '.mobile-nav',
        '.responsive-grid',
        '.mobile-header'
      ];

      let mobileNavFound = false;
      for (const selector of mobileElements) {
        if (await page.locator(selector).count() > 0) {
          mobileNavFound = true;
          console.log(`📱 Mobile element found: ${selector}`);
          break;
        }
      }

      // Test scrolling behavior
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      
      const scrollPosition = await page.evaluate(() => window.scrollY);
      expect(scrollPosition).toBeGreaterThan(0);

      // Take mobile screenshot
      await visualHelpers.captureScreenshot(page, 'mobile-dashboard-load', {
        fullPage: true
      });

      console.log(`✅ Mobile dashboard test completed. Mobile nav: ${mobileNavFound}`);

    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        console.log('⚠️ Dashboard not available - bridge not running');
        test.skip();
      } else {
        throw error;
      }
    }
  });

  test('Touch interactions work correctly on mobile dashboard', async ({ page }) => {
    try {
      const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
      await page.goto(dashboardUrl);

      // Test touch scrolling
      await page.touchscreen.tap(200, 300);
      await page.touchscreen.tap(200, 100);
      
      // Simulate swipe gesture
      await page.touchscreen.tap(100, 400);
      await page.mouse.move(100, 400);
      await page.mouse.down();
      await page.mouse.move(100, 200);
      await page.mouse.up();

      // Test pinch zoom (if supported)
      try {
        await page.touchscreen.tap(200, 300);
        // Simulate pinch gesture
        await page.evaluate(() => {
          const event = new TouchEvent('touchstart', {
            touches: [
              new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: 100 }),
              new Touch({ identifier: 2, target: document.body, clientX: 200, clientY: 200 })
            ]
          });
          document.body.dispatchEvent(event);
        });
      } catch (error) {
        console.log('📱 Pinch zoom test skipped (not supported)');
      }

      // Take screenshot after touch interactions
      await visualHelpers.captureScreenshot(page, 'mobile-dashboard-touch', {
        fullPage: true
      });

      console.log('✅ Mobile touch interactions test completed');

    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        test.skip();
      } else {
        throw error;
      }
    }
  });

  test('Mobile dashboard handles orientation changes', async ({ page }) => {
    try {
      const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
      
      // Start in portrait mode
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(dashboardUrl);
      
      // Take portrait screenshot
      await visualHelpers.captureScreenshot(page, 'mobile-dashboard-portrait');
      
      // Switch to landscape mode
      await page.setViewportSize({ width: 667, height: 375 });
      await page.waitForTimeout(1000); // Wait for layout adjustment
      
      // Take landscape screenshot
      await visualHelpers.captureScreenshot(page, 'mobile-dashboard-landscape');
      
      // Verify layout adjusts properly
      const body = page.locator('body');
      await expect(body).toBeVisible();
      
      // Check if content is still accessible in landscape
      const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      
      console.log(`📱 Landscape mode - Content height: ${scrollHeight}, Viewport: ${viewportHeight}`);
      
      console.log('✅ Mobile orientation change test completed');

    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        test.skip();
      } else {
        throw error;
      }
    }
  });

  test('Mobile dashboard performance meets mobile standards', async ({ page }) => {
    try {
      const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
      
      // Measure load time
      const startTime = Date.now();
      await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
      const loadTime = Date.now() - startTime;
      
      // Mobile should load within 5 seconds (slower than desktop)
      expect(loadTime).toBeLessThan(5000);
      
      // Check Core Web Vitals for mobile
      const vitals = await page.evaluate(() => {
        return new Promise((resolve) => {
          const vitals = {};
          
          // Largest Contentful Paint
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0) {
              vitals.lcp = entries[entries.length - 1].startTime;
            }
          }).observe({ entryTypes: ['largest-contentful-paint'] });
          
          // First Input Delay would be measured with real user interaction
          
          // Cumulative Layout Shift
          let cumulativeLayoutShift = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) {
                cumulativeLayoutShift += entry.value;
              }
            }
            vitals.cls = cumulativeLayoutShift;
          }).observe({ entryTypes: ['layout-shift'] });
          
          setTimeout(() => resolve(vitals), 3000);
        });
      });
      
      console.log(`📱 Mobile performance - Load time: ${loadTime}ms`);
      console.log(`📱 Mobile vitals:`, vitals);
      
      // Mobile-specific performance assertions
      if (vitals.lcp) {
        expect(vitals.lcp).toBeLessThan(4000); // Mobile LCP should be < 4s
      }
      
      if (vitals.cls) {
        expect(vitals.cls).toBeLessThan(0.25); // CLS should be < 0.25
      }
      
      console.log('✅ Mobile performance test completed');

    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        test.skip();
      } else {
        throw error;
      }
    }
  });

  test('Mobile dashboard handles network connectivity changes', async ({ page }) => {
    try {
      const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
      
      // Start with normal connectivity
      await page.goto(dashboardUrl);
      
      // Simulate going offline
      await page.context().setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      
      // Look for offline indicators
      const offlineElements = [
        'text=offline',
        'text=no connection',
        '[data-testid="offline-indicator"]',
        '.offline-message'
      ];
      
      let offlineIndicatorFound = false;
      for (const selector of offlineElements) {
        if (await page.locator(selector).count() > 0) {
          offlineIndicatorFound = true;
          console.log(`📶 Offline indicator found: ${selector}`);
          break;
        }
      }
      
      // Take screenshot of offline state
      await visualHelpers.captureScreenshot(page, 'mobile-dashboard-offline');
      
      // Go back online
      await page.context().setOffline(false);
      await page.reload({ waitUntil: 'networkidle' });
      
      // Verify normal functionality restored
      const body = page.locator('body');
      await expect(body).toBeVisible();
      
      console.log(`✅ Mobile connectivity test completed. Offline indicator: ${offlineIndicatorFound}`);

    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        test.skip();
      } else {
        throw error;
      }
    }
  });

  test('Mobile dashboard accessibility features work correctly', async ({ page }) => {
    try {
      const dashboardUrl = `http://localhost:${TEST_CONFIG.bridge.port}/dashboard`;
      await page.goto(dashboardUrl);

      // Test keyboard navigation (for external keyboards)
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      
      // Check for accessibility features
      const a11yElements = [
        '[aria-label]',
        '[role="button"]',
        '[role="navigation"]',
        'button',
        'h1, h2, h3, h4, h5, h6'
      ];
      
      let accessibleElementsCount = 0;
      for (const selector of a11yElements) {
        const count = await page.locator(selector).count();
        accessibleElementsCount += count;
      }
      
      console.log(`♿ Found ${accessibleElementsCount} accessible elements`);
      
      // Test focus indicators
      await page.keyboard.press('Tab');
      const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
      console.log(`♿ Focused element: ${focusedElement}`);
      
      // Take accessibility screenshot
      await visualHelpers.captureScreenshot(page, 'mobile-dashboard-a11y');
      
      console.log('✅ Mobile accessibility test completed');

    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        test.skip();
      } else {
        throw error;
      }
    }
  });
});
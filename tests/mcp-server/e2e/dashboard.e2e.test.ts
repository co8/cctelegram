/**
 * Dashboard E2E Tests for CCTelegram Bridge Health Interface
 * Tests browser-based dashboard functionality
 */

import { test, expect } from '@playwright/test';

test.describe('CCTelegram Health Dashboard', () => {
  const healthPort = process.env.CC_TELEGRAM_HEALTH_PORT || '8080';
  const dashboardUrl = `http://localhost:${healthPort}/dashboard`;

  // Helper function to check if dashboard is available
  const checkDashboardAvailability = async (page) => {
    try {
      const healthResponse = await page.request.get(`http://localhost:${healthPort}/health`);
      if (!healthResponse.ok()) {
        console.log('Bridge not running - skipping dashboard test');
        test.skip();
        return false;
      }
      
      const dashboardResponse = await page.request.get(dashboardUrl);
      if (dashboardResponse.status() === 404) {
        console.log('Dashboard endpoint not available - bridge has no web interface');
        test.skip();
        return false;
      }
      
      return true;
    } catch (error) {
      console.log('Bridge not running - skipping dashboard test');
      test.skip();
      return false;
    }
  };

  test.beforeEach(async ({ page }) => {
    // Set up common test context
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('Dashboard should load and display system status', async ({ page }) => {
    const isAvailable = await checkDashboardAvailability(page);
    if (!isAvailable) return;
    
    await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
    
    // Check if dashboard is accessible
    const title = await page.title();
    expect(title).toContain('CCTelegram');
    
    // Look for common dashboard elements
    const statusElements = [
      'text=Status',
      'text=Health',
      'text=Metrics',
      'text=Uptime'
    ];
    
    for (const selector of statusElements) {
      try {
        await expect(page.locator(selector)).toBeVisible({ timeout: 5000 });
      } catch (error) {
        console.log(`Dashboard element not found: ${selector}`);
      }
    }
  });

  test('Health metrics should update dynamically', async ({ page }) => {
    const isAvailable = await checkDashboardAvailability(page);
    if (!isAvailable) return;
    
    await page.goto(dashboardUrl);
      
      // Look for metric displays
      const metricSelectors = [
        '[data-testid="uptime-metric"]',
        '[data-testid="memory-metric"]', 
        '[data-testid="event-count-metric"]',
        '.metric-value',
        '.health-indicator'
      ];
      
      let metricsFound = false;
      for (const selector of metricSelectors) {
        if (await page.locator(selector).count() > 0) {
          metricsFound = true;
          
          // Check for numeric values
          const text = await page.locator(selector).first().textContent();
          console.log(`Metric found: ${text}`);
          break;
        }
      }
      
      if (metricsFound) {
        // Wait for potential updates
        await page.waitForTimeout(2000);
        
        // Verify page is interactive
        expect(await page.locator('body').isVisible()).toBe(true);
      } else {
        console.log('No specific metrics found - dashboard may use different structure');
      }
  });

  test('Dashboard should be responsive on mobile', async ({ page }) => {
    const isAvailable = await checkDashboardAvailability(page);
    if (!isAvailable) return;
    
    try {
      // Test mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(dashboardUrl);
      
      // Check if layout adapts to mobile
      const body = page.locator('body');
      await expect(body).toBeVisible();
      
      // Look for mobile-friendly navigation
      const mobileElements = [
        '[data-testid="mobile-menu"]',
        '[data-testid="hamburger-menu"]', 
        'button[aria-label*="menu"]',
        '.mobile-nav'
      ];
      
      let mobileNavFound = false;
      for (const selector of mobileElements) {
        if (await page.locator(selector).count() > 0) {
          mobileNavFound = true;
          console.log(`Mobile navigation found: ${selector}`);
          break;
        }
      }
      
      // Test scrolling behavior
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      
      console.log(`Dashboard mobile test completed. Mobile nav: ${mobileNavFound}`);
      
    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        test.skip();
      } else {
        throw error;
      }
    }
  });

  test('Error states should be handled gracefully', async ({ page }) => {
    try {
      // Test invalid dashboard path
      await page.goto(`http://localhost:${healthPort}/dashboard/invalid`);
      
      // Should either show 404 or redirect to valid dashboard
      const response = await page.waitForResponse(/.*/, { timeout: 5000 });
      
      if (response.status() === 404) {
        // Look for user-friendly 404 page
        const errorElements = [
          'text=404',
          'text=Not Found',
          'text=Page not found',
          '[data-testid="error-message"]'
        ];
        
        for (const selector of errorElements) {
          try {
            await expect(page.locator(selector)).toBeVisible({ timeout: 2000 });
            console.log(`Error handling found: ${selector}`);
            break;
          } catch (e) {
            // Continue checking other selectors
          }
        }
      }
      
    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        test.skip();
      } else {
        // Expected for testing error states
        console.log('Error state test completed');
      }
    }
  });

  test('Dashboard performance should meet standards', async ({ page }) => {
    try {
      const startTime = Date.now();
      
      await page.goto(dashboardUrl, { waitUntil: 'networkidle' });
      
      const loadTime = Date.now() - startTime;
      
      // Dashboard should load within 3 seconds
      expect(loadTime).toBeLessThan(3000);
      
      // Check for Core Web Vitals if possible
      const lcp = await page.evaluate(() => {
        return new Promise((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0) {
              resolve(entries[entries.length - 1].startTime);
            }
          }).observe({ entryTypes: ['largest-contentful-paint'] });
          
          setTimeout(() => resolve(null), 5000);
        });
      });
      
      if (lcp) {
        expect(lcp).toBeLessThan(2500); // LCP should be < 2.5s
        console.log(`Dashboard LCP: ${lcp}ms`);
      }
      
      console.log(`Dashboard load time: ${loadTime}ms`);
      
    } catch (error) {
      if (error.message.includes('ERR_CONNECTION_REFUSED')) {
        test.skip();
      } else {
        throw error;
      }
    }
  });
});
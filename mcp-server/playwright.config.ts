/**
 * Playwright Configuration for CCTelegram MCP Server E2E Tests
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  
  // Test configuration
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter options
  reporter: [
    ['html', { outputFolder: 'test-results/playwright-report' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }]
  ],
  
  // Global test configuration
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Network settings
    ignoreHTTPSErrors: true,
    
    // Test timeout
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  // Test timeout
  timeout: 60000,
  expect: {
    timeout: 10000
  },

  // Projects for different browsers and scenarios
  projects: [
    {
      name: 'API Tests',
      testMatch: '**/*.e2e.test.ts',
      use: {
        // No browser needed for API tests
        headless: true,
      },
    },
    
    {
      name: 'Chrome - Health Dashboard',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/dashboard.e2e.test.ts',
    },

    {
      name: 'Firefox - Health Dashboard', 
      use: { ...devices['Desktop Firefox'] },
      testMatch: '**/dashboard.e2e.test.ts',
    },

    {
      name: 'Safari - Health Dashboard',
      use: { ...devices['Desktop Safari'] },
      testMatch: '**/dashboard.e2e.test.ts',
    },

    // Mobile testing
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/mobile.e2e.test.ts',
    },

    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
      testMatch: '**/mobile.e2e.test.ts',
    },
  ],

  // Web server configuration (if needed)
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    port: 8080,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  // Output directories
  outputDir: 'test-results/playwright-output',
});
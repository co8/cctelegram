/**
 * Enhanced Playwright Configuration for CCTelegram MCP Server E2E Tests
 * Comprehensive cross-browser testing with mobile scenarios and visual regression
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  
  // Test configuration for comprehensive E2E testing
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  
  // Enhanced reporter options
  reporter: [
    ['html', { 
      outputFolder: 'test-results/playwright-report',
      open: process.env.CI ? 'never' : 'on-failure'
    }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }],
    ['line'],
    ...(process.env.CI ? [['github'] as const] : [])
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
    actionTimeout: 15000,
    navigationTimeout: 30000,
    
    // Enhanced settings for E2E workflows
    launchOptions: {
      slowMo: process.env.SLOW_MO ? parseInt(process.env.SLOW_MO) : 0,
    }
  },

  // Test timeout
  timeout: 120000, // Increased for complex E2E workflows
  expect: {
    timeout: 10000,
    // Visual comparison threshold
    toHaveScreenshot: { threshold: 0.2, mode: 'pixel' },
    toMatchSnapshot: { threshold: 0.2, mode: 'pixel' }
  },

  // Comprehensive cross-browser and device testing projects
  projects: [
    // API and Bridge Health Tests (no browser needed)
    {
      name: 'API Tests',
      testMatch: '**/bridge-health.e2e.test.ts',
      use: {
        headless: true,
      },
    },

    // Desktop Chrome - Full workflow testing
    {
      name: 'Chrome Desktop - Workflows',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          args: [
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-sandbox'
          ]
        }
      },
      testMatch: '**/telegram-bridge-workflow.e2e.test.ts',
    },

    // Desktop Firefox - Cross-browser validation
    {
      name: 'Firefox Desktop - Workflows',
      use: { 
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 }
      },
      testMatch: '**/telegram-bridge-workflow.e2e.test.ts',
    },

    // Desktop Safari - WebKit engine testing
    {
      name: 'Safari Desktop - Workflows',
      use: { 
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 }
      },
      testMatch: '**/telegram-bridge-workflow.e2e.test.ts',
    },

    // Dashboard-specific browser testing
    {
      name: 'Chrome - Dashboard',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 }
      },
      testMatch: '**/dashboard.e2e.test.ts',
    },

    {
      name: 'Firefox - Dashboard',
      use: { 
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 }
      },
      testMatch: '**/dashboard.e2e.test.ts',
    },

    {
      name: 'Safari - Dashboard',
      use: { 
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 }
      },
      testMatch: '**/dashboard.e2e.test.ts',
    },

    // Mobile Chrome - Android simulation
    {
      name: 'Mobile Chrome',
      use: { 
        ...devices['Pixel 5'],
        isMobile: true,
        hasTouch: true
      },
      testMatch: '**/mobile-*.e2e.test.ts',
    },

    // Mobile Safari - iOS simulation
    {
      name: 'Mobile Safari',
      use: { 
        ...devices['iPhone 12'],
        isMobile: true,
        hasTouch: true
      },
      testMatch: '**/mobile-*.e2e.test.ts',
    },

    // Tablet testing
    {
      name: 'iPad - Tablet Testing',
      use: { 
        ...devices['iPad Pro'],
        isMobile: true,
        hasTouch: true
      },
      testMatch: '**/tablet-*.e2e.test.ts',
    },

    // High DPI testing
    {
      name: 'Chrome - High DPI',
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 2,
        viewport: { width: 1920, height: 1080 }
      },
      testMatch: '**/visual-*.e2e.test.ts',
    },

    // Slow network simulation
    {
      name: 'Chrome - Slow Network',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--force-device-scale-factor=1']
        },
        // Simulate slow 3G
        contextOptions: {
          offline: false,
          downloadThroughput: 1.5 * 1024 * 1024 / 8, // 1.5 Mbps
          uploadThroughput: 0.75 * 1024 * 1024 / 8,   // 0.75 Mbps
          latency: 300 // 300ms latency
        }
      },
      testMatch: '**/performance-*.e2e.test.ts',
    },

    // Accessibility testing
    {
      name: 'Chrome - Accessibility',
      use: {
        ...devices['Desktop Chrome'],
        // Simulate reduced motion preference
        reducedMotion: 'reduce',
        // High contrast mode
        forcedColors: 'active'
      },
      testMatch: '**/accessibility-*.e2e.test.ts',
    }
  ],

  // Web server configuration for local development
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    port: 8080,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      CC_TELEGRAM_HEALTH_PORT: '8080',
      CC_TELEGRAM_WEBHOOK_PORT: '3000',
      NODE_ENV: 'test'
    }
  },

  // Output directories
  outputDir: 'test-results/playwright-output',
  
  // Global setup and teardown
  globalSetup: require.resolve('./tests/setup/global-setup.ts'),
  globalTeardown: require.resolve('./tests/setup/global-teardown.ts'),
  
  // Test metadata
  metadata: {
    'test-framework': 'playwright',
    'project': 'cctelegram-mcp-server',
    'test-type': 'e2e-workflow'
  }
});
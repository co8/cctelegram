/**
 * Playwright Configuration for CCTelegram Bridge Testing
 * Optimized for debugging the /tasks command issue
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  // Test directory
  testDir: '.',
  
  // Output directory for test artifacts
  outputDir: './test-results/output',
  
  // Test timeout (increased for debugging operations)
  timeout: 120000, // 2 minutes per test
  expect: {
    timeout: 10000 // 10 seconds for assertions
  },

  // Run tests in sequence for better debugging control
  fullyParallel: false,
  workers: 1,

  // Retry configuration - disabled for debugging
  retries: 0,

  // Reporter configuration with detailed output
  reporter: [
    ['html', { 
      outputFolder: './test-results/report',
      open: 'never' 
    }],
    ['json', { 
      outputFile: './test-results/results.json' 
    }],
    ['list'],
    // Custom debug reporter
    [path.resolve(__dirname, 'reporters/debug-reporter.ts')]
  ],

  // Global test configuration
  use: {
    // Base URL for API requests
    baseURL: 'http://localhost:8080',
    
    // Browser context options
    headless: false, // Show browser for debugging
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    
    // Network and timing
    actionTimeout: 10000,
    navigationTimeout: 30000,
    
    // Debugging features
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Additional context options for API testing
    extraHTTPHeaders: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  },

  // Test projects for different scenarios
  projects: [
    {
      name: 'cctelegram-debug',
      use: { 
        ...devices['Desktop Chrome'],
        // Specific settings for CCTelegram debugging
        launchOptions: {
          args: [
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-sandbox',
            '--disable-dev-shm-usage'
          ]
        }
      },
      testMatch: '**/cctelegram-bridge-debug.spec.ts'
    },
    
    {
      name: 'integration-tests',
      use: { 
        ...devices['Desktop Chrome'],
        headless: true // Run integration tests headless for speed
      },
      testMatch: '**/integration-*.spec.ts'
    }
  ],

  // Global setup and teardown
  globalSetup: require.resolve('./setup/global-setup.ts'),
  globalTeardown: require.resolve('./setup/global-teardown.ts'),

  // Test directory structure
  testIgnore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**'
  ],

  // Web server for local testing (if needed)
  webServer: process.env.CI ? undefined : [
    // Start mock services for local development
    {
      command: 'npm run start-mocks',
      port: 3002,
      timeout: 30000,
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test'
      }
    }
  ]
});
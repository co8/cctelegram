/**
 * Playwright configuration for CCTelegram debugging agents
 */

import { defineConfig, devices } from '@playwright/test';
import { agentConfig, timeouts } from './agents.config';

export default defineConfig({
  // Test directory
  testDir: './integration-tests',
  
  // Run tests in files in parallel
  fullyParallel: false, // Sequential for debugging clarity
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Workers
  workers: 1, // Single worker for debugging
  
  // Timeout configuration
  timeout: timeouts.agentExecution * 3, // 3 minutes per test
  expect: {
    timeout: 10000 // 10 seconds for expect assertions
  },
  
  // Global setup and teardown
  globalSetup: './setup/global-setup.ts',
  globalTeardown: './setup/global-teardown.ts',
  
  // Reporter configuration
  reporter: [
    ['html', { 
      outputFolder: 'test-results/html-report',
      open: 'never'
    }],
    ['json', {
      outputFile: 'test-results/test-results.json'
    }],
    ['line'],
    ['./reporters/debug-reporter.ts']
  ],
  
  // Output directory
  outputDir: 'test-results/',
  
  use: {
    // Base URL for testing
    baseURL: 'http://localhost:3000',
    
    // Browser context options
    viewport: { width: 1280, height: 720 },
    
    // Collect trace when retrying the failed test
    trace: 'retain-on-failure',
    
    // Take screenshot on failure
    screenshot: 'only-on-failure',
    
    // Record video on failure
    video: 'retain-on-failure',
    
    // Ignore HTTPS errors
    ignoreHTTPSErrors: true,
    
    // Accept downloads
    acceptDownloads: true,
    
    // Enable web security for testing
    bypassCSP: false,
    
    // Set user agent
    userAgent: 'CCTelegram-DebugAgent-Playwright/1.0.0',
    
    // Extra HTTP headers
    extraHTTPHeaders: {
      'X-Debug-Agent': 'CCTelegram-Playwright',
      'X-Session-Type': 'debugging'
    }
  },

  // Project configurations for different test types
  projects: [
    {
      name: 'agent-integration',
      testMatch: /.*integration.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        headless: !process.env.HEADED,
        launchOptions: {
          args: [
            '--disable-web-security',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ]
        }
      },
      timeout: timeouts.agentExecution * 4, // Extra time for integration tests
      retries: 1
    },
    
    {
      name: 'data-flow-tests',
      testMatch: /.*data-flow.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        headless: true
      },
      timeout: timeouts.agentExecution,
      retries: 0
    },
    
    {
      name: 'mcp-integration-tests', 
      testMatch: /.*mcp-integration.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        headless: true
      },
      timeout: timeouts.agentExecution * 2, // MCP tests may take longer
      retries: 2 // MCP connections can be flaky
    },
    
    {
      name: 'orchestration-tests',
      testMatch: /.*orchestration.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        headless: true
      },
      timeout: timeouts.agentExecution * 5, // Orchestration tests take longest
      retries: 1
    }
  ],

  // Configure web servers to start before tests
  webServer: [
    {
      command: 'npm run start:test-server',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'debug'
      }
    }
  ],
  
  // Test metadata
  metadata: {
    testType: 'debugging-agents',
    framework: 'playwright',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'test',
    debugLevel: agentConfig.global.debugLevel,
    agentSystemVersion: '1.0.0'
  }
});
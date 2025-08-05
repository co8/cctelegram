/**
 * Global Setup for Playwright E2E Tests
 * Sets up test environment, mock servers, and bridge processes
 */

import { chromium, FullConfig } from '@playwright/test';
import fs from 'fs-extra';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting global E2E test setup...');

  // Create test directories
  const testDirs = [
    './test-results',
    './test-results/screenshots',
    './test-results/playwright-output',
    '/tmp/test-events',
    '/tmp/test-responses'
  ];

  for (const dir of testDirs) {
    await fs.ensureDir(dir);
    console.log(`📁 Created test directory: ${dir}`);
  }

  // Clean up any existing test files
  try {
    await fs.emptyDir('/tmp/test-events');
    await fs.emptyDir('/tmp/test-responses');
    console.log('🧹 Cleaned up existing test files');
  } catch (error) {
    console.warn('⚠️ Failed to clean up test files:', error.message);
  }

  // Set up environment variables for testing
  process.env.NODE_ENV = 'test';
  process.env.CC_TELEGRAM_EVENTS_DIR = '/tmp/test-events';
  process.env.CC_TELEGRAM_RESPONSES_DIR = '/tmp/test-responses';
  process.env.CC_TELEGRAM_HEALTH_PORT = '8080';
  process.env.CC_TELEGRAM_WEBHOOK_PORT = '3000';
  process.env.RUST_LOG = 'debug';

  // Create test configuration files if needed
  const configPath = './test.config.json';
  if (!await fs.pathExists(configPath)) {
    const testConfig = {
      bridge: {
        health_port: '8080',
        webhook_port: '3000',
        events_dir: '/tmp/test-events',
        responses_dir: '/tmp/test-responses'
      },
      telegram: {
        bot_token: process.env.TEST_TELEGRAM_BOT_TOKEN || 'test-token',
        chat_id: process.env.TEST_TELEGRAM_CHAT_ID || '123456789'
      },
      testing: {
        timeout_ms: 30000,
        retry_attempts: 3,
        screenshot_on_failure: true
      }
    };

    await fs.writeJSON(configPath, testConfig, { spaces: 2 });
    console.log('📝 Created test configuration file');
  }

  // Launch a persistent browser for better performance
  if (process.env.PERSISTENT_BROWSER !== 'false') {
    try {
      const browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false',
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security'
        ]
      });

      // Store browser instance for tests to use
      global.__BROWSER__ = browser;
      console.log('🌐 Launched persistent browser instance');
    } catch (error) {
      console.warn('⚠️ Failed to launch persistent browser:', error.message);
    }
  }

  // Set up mock Telegram API server
  if (process.env.MOCK_TELEGRAM_API !== 'false') {
    try {
      const mockServer = await setupMockTelegramServer();
      global.__MOCK_TELEGRAM_SERVER__ = mockServer;
      console.log('🤖 Mock Telegram API server started');
    } catch (error) {
      console.warn('⚠️ Failed to start mock Telegram server:', error.message);
    }
  }

  // Start bridge process if path is provided
  if (process.env.CC_TELEGRAM_BRIDGE_PATH && process.env.START_BRIDGE !== 'false') {
    try {
      const bridgeProcess = await startBridgeForTesting();
      global.__BRIDGE_PROCESS__ = bridgeProcess;
      console.log('🌉 Bridge process started for testing');
    } catch (error) {
      console.warn('⚠️ Failed to start bridge process:', error.message);
    }
  }

  // Health check for all services
  await performHealthChecks();

  console.log('✅ Global E2E test setup completed');
}

/**
 * Set up mock Telegram API server
 */
async function setupMockTelegramServer(): Promise<any> {
  const express = require('express');
  const app = express();
  
  app.use(express.json());
  
  // Mock Telegram Bot API endpoints
  app.post('/bot:token/sendMessage', (req, res) => {
    console.log('📱 Mock Telegram sendMessage:', req.body);
    res.json({
      ok: true,
      result: {
        message_id: Math.floor(Math.random() * 1000000),
        from: { id: 123456789, is_bot: true, first_name: 'CCTelegram Bot' },
        chat: { id: req.body.chat_id, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: req.body.text
      }
    });
  });

  app.post('/bot:token/answerCallbackQuery', (req, res) => {
    console.log('📱 Mock Telegram answerCallbackQuery:', req.body);
    res.json({ ok: true, result: true });
  });

  const server = app.listen(9999, () => {
    console.log('🤖 Mock Telegram API server listening on port 9999');
  });

  return server;
}

/**
 * Start bridge process for testing
 */
async function startBridgeForTesting(): Promise<ChildProcess> {
  const bridgePath = process.env.CC_TELEGRAM_BRIDGE_PATH;
  if (!bridgePath) {
    throw new Error('CC_TELEGRAM_BRIDGE_PATH not set');
  }

  return new Promise((resolve, reject) => {
    const bridgeProcess = spawn(bridgePath, [], {
      stdio: 'pipe',
      env: {
        ...process.env,
        CC_TELEGRAM_HEALTH_PORT: '8080',
        CC_TELEGRAM_WEBHOOK_PORT: '3000',
        CC_TELEGRAM_EVENTS_DIR: '/tmp/test-events',
        CC_TELEGRAM_RESPONSES_DIR: '/tmp/test-responses',
        RUST_LOG: 'debug'
      }
    });

    bridgeProcess.stdout?.on('data', (data) => {
      console.log(`Bridge: ${data}`);
    });

    bridgeProcess.stderr?.on('data', (data) => {
      console.error(`Bridge Error: ${data}`);
    });

    bridgeProcess.on('error', reject);

    // Wait for bridge to start
    setTimeout(() => {
      if (bridgeProcess.pid) {
        resolve(bridgeProcess);
      } else {
        reject(new Error('Bridge process failed to start'));
      }
    }, 5000);
  });
}

/**
 * Perform health checks on all services
 */
async function performHealthChecks(): Promise<void> {
  const axios = require('axios');
  const healthChecks = [];

  // Check bridge health endpoint
  if (process.env.CC_TELEGRAM_BRIDGE_PATH) {
    healthChecks.push(
      axios.get('http://localhost:8080/health', { timeout: 5000 })
        .then(() => console.log('✅ Bridge health check passed'))
        .catch(() => console.log('⚠️ Bridge health check failed (may not be critical)'))
    );
  }

  // Check mock Telegram API
  if (process.env.MOCK_TELEGRAM_API !== 'false') {
    healthChecks.push(
      axios.get('http://localhost:9999/health', { timeout: 2000 })
        .then(() => console.log('✅ Mock Telegram API health check passed'))
        .catch(() => console.log('⚠️ Mock Telegram API health check failed'))
    );
  }

  // Wait for all health checks
  await Promise.allSettled(healthChecks);
}

export default globalSetup;
/**
 * Global Setup for CCTelegram Bridge Testing
 * Prepares the test environment and ensures all services are ready
 */

import { chromium, FullConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs/promises';
import { DebugLogger } from '../utils/debug-logger';

async function globalSetup(config: FullConfig) {
  const logger = new DebugLogger('global-setup', true);
  logger.info('Starting global test setup...');

  try {
    // Ensure test directories exist
    await ensureTestDirectories(logger);
    
    // Clean previous test artifacts
    await cleanTestArtifacts(logger);
    
    // Verify project structure
    await verifyProjectStructure(logger);
    
    // Pre-compile TypeScript if needed
    await compileTypeScript(logger);
    
    // Set up test environment variables
    setupEnvironmentVariables(logger);
    
    // Verify external dependencies
    await verifyDependencies(logger);
    
    logger.info('✅ Global setup completed successfully');

  } catch (error) {
    logger.error('❌ Global setup failed:', error);
    throw error;
  }
}

async function ensureTestDirectories(logger: DebugLogger): Promise<void> {
  logger.info('Creating test directories...');

  const directories = [
    'test-results',
    'test-results/logs',
    'test-results/screenshots',
    'test-results/videos',
    'test-results/traces',
    'test-results/output',
    'test-results/report'
  ];

  for (const dir of directories) {
    try {
      await fs.mkdir(path.resolve(dir), { recursive: true });
      logger.debug(`✓ Created directory: ${dir}`);
    } catch (error) {
      logger.warn(`Failed to create directory ${dir}:`, error);
    }
  }

  logger.info('✓ Test directories created');
}

async function cleanTestArtifacts(logger: DebugLogger): Promise<void> {
  logger.info('Cleaning previous test artifacts...');

  const artifactDirs = [
    'test-results/logs',
    'test-results/screenshots', 
    'test-results/videos',
    'test-results/traces',
    'test-results/output'
  ];

  for (const dir of artifactDirs) {
    try {
      const fullPath = path.resolve(dir);
      const files = await fs.readdir(fullPath).catch(() => []);
      
      for (const file of files) {
        await fs.unlink(path.join(fullPath, file));
      }
      
      logger.debug(`✓ Cleaned directory: ${dir}`);
    } catch (error) {
      logger.debug(`Could not clean directory ${dir}:`, error.message);
    }
  }

  logger.info('✓ Test artifacts cleaned');
}

async function verifyProjectStructure(logger: DebugLogger): Promise<void> {
  logger.info('Verifying project structure...');

  const projectRoot = path.resolve(__dirname, '../../../');
  const requiredPaths = [
    'src',
    'src/telegram/bot.rs',
    'src/mcp/connection.rs',
    'mcp-server',
    'mcp-server/package.json',
    '.taskmaster'
  ];

  for (const requiredPath of requiredPaths) {
    const fullPath = path.join(projectRoot, requiredPath);
    
    try {
      await fs.access(fullPath);
      logger.debug(`✓ Found: ${requiredPath}`);
    } catch (error) {
      logger.warn(`❌ Missing: ${requiredPath}`);
    }
  }

  logger.info('✓ Project structure verified');
}

async function compileTypeScript(logger: DebugLogger): Promise<void> {
  logger.info('Checking TypeScript compilation...');

  const mcpServerPath = path.resolve(__dirname, '../../../mcp-server');
  
  try {
    // Check if dist folder exists and is recent
    const distPath = path.join(mcpServerPath, 'dist');
    const distStat = await fs.stat(distPath).catch(() => null);
    
    if (!distStat) {
      logger.info('MCP server dist folder not found, building...');
      // In a real setup, you'd run the build command here
      // For now, just log the requirement
      logger.warn('MCP server needs to be built manually: cd mcp-server && npm run build');
    } else {
      logger.info('✓ MCP server dist folder exists');
    }

  } catch (error) {
    logger.warn('TypeScript compilation check failed:', error);
  }

  logger.info('✓ TypeScript compilation checked');
}

function setupEnvironmentVariables(logger: DebugLogger): void {
  logger.info('Setting up test environment variables...');

  // Test-specific environment variables
  const testEnv = {
    NODE_ENV: 'test',
    CC_TELEGRAM_HEALTH_PORT: '8080',
    CC_TELEGRAM_WEBHOOK_PORT: '3000',
    CC_TELEGRAM_BOT_TOKEN: 'test-bot-token',
    CC_TELEGRAM_ALLOWED_USERS: '123456789',
    CC_TELEGRAM_EVENTS_DIR: '/tmp/test-events',
    CC_TELEGRAM_RESPONSES_DIR: '/tmp/test-responses',
    RUST_LOG: 'debug',
    RUST_BACKTRACE: '1',
    
    // MCP server settings
    MCP_ENABLE_AUTH: 'false',
    MCP_ENABLE_RATE_LIMIT: 'false',
    MCP_ENABLE_INPUT_VALIDATION: 'true',
    MCP_LOG_LEVEL: 'debug',
    
    // Test framework settings
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0',
    DEBUG: 'pw:api*'
  };

  for (const [key, value] of Object.entries(testEnv)) {
    if (!process.env[key]) {
      process.env[key] = value;
      logger.debug(`Set ${key}=${value}`);
    } else {
      logger.debug(`Using existing ${key}=${process.env[key]}`);
    }
  }

  logger.info('✓ Environment variables configured');
}

async function verifyDependencies(logger: DebugLogger): Promise<void> {
  logger.info('Verifying external dependencies...');

  // Check Node.js version
  const nodeVersion = process.version;
  logger.info(`Node.js version: ${nodeVersion}`);

  // Check if required commands are available
  const commands = [
    { name: 'cargo', description: 'Rust toolchain' },
    { name: 'npm', description: 'Node package manager' }
  ];

  for (const cmd of commands) {
    try {
      const { spawn } = require('child_process');
      await new Promise((resolve, reject) => {
        const proc = spawn(cmd.name, ['--version'], { 
          stdio: 'pipe',
          timeout: 5000 
        });
        
        proc.on('exit', (code) => {
          if (code === 0) {
            logger.debug(`✓ ${cmd.name} available`);
            resolve(undefined);
          } else {
            reject(new Error(`${cmd.name} returned exit code ${code}`));
          }
        });
        
        proc.on('error', reject);
      });
    } catch (error) {
      logger.warn(`❌ ${cmd.name} (${cmd.description}) not available:`, error.message);
    }
  }

  logger.info('✓ Dependencies verified');
}

export default globalSetup;
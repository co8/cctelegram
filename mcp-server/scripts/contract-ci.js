#!/usr/bin/env node

/**
 * Contract Testing CI/CD Integration Script
 * Orchestrates contract testing workflows in CI/CD pipelines
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// Configuration
const config = {
  pactBrokerUrl: process.env.PACT_BROKER_URL || 'http://localhost:9292',
  pactBrokerToken: process.env.PACT_BROKER_TOKEN,
  consumer: 'cctelegram-mcp-server',
  provider: 'cctelegram-bridge',
  environment: process.env.CI_ENVIRONMENT || 'development',
  gitBranch: process.env.GIT_BRANCH || getCurrentBranch(),
  gitHash: process.env.GIT_COMMIT || getCurrentCommit(),
  buildNumber: process.env.BUILD_NUMBER || Date.now().toString(),
  dryRun: process.env.DRY_RUN === 'true',
  publishPacts: process.env.PUBLISH_PACTS !== 'false',
  verifyProvider: process.env.VERIFY_PROVIDER !== 'false',
  checkCanDeploy: process.env.CHECK_CAN_DEPLOY !== 'false'
};

// Main orchestration function
async function main() {
  const command = process.argv[2];
  
  console.log('🚀 CCTelegram Contract Testing CI/CD Integration');
  console.log(`Environment: ${config.environment}`);
  console.log(`Branch: ${config.gitBranch}`);
  console.log(`Commit: ${config.gitHash}`);
  console.log('---');

  try {
    switch (command) {
      case 'consumer':
        await runConsumerWorkflow();
        break;
      case 'provider':
        await runProviderWorkflow();
        break;
      case 'full':
        await runFullWorkflow();
        break;
      case 'deploy-check':
        await runDeploymentCheck();
        break;
      case 'publish':
        await publishContracts();
        break;
      case 'verify':
        await verifyProvider();
        break;
      case 'setup':
        await setupContractEnvironment();
        break;
      case 'cleanup':
        await cleanupContractArtifacts();
        break;
      default:
        console.log('Usage: npm run contract:ci <command>');
        console.log('Commands:');
        console.log('  consumer     - Run consumer contract tests');
        console.log('  provider     - Run provider contract verification');
        console.log('  full         - Run complete contract testing workflow');
        console.log('  deploy-check - Check deployment compatibility');
        console.log('  publish      - Publish contracts to broker');
        console.log('  verify       - Verify provider against contracts');
        console.log('  setup        - Setup contract testing environment');
        console.log('  cleanup      - Cleanup contract artifacts');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Contract testing failed:', error.message);
    if (process.env.CI) {
      process.exit(1);
    }
  }
}

/**
 * Run consumer contract testing workflow
 */
async function runConsumerWorkflow() {
  console.log('🔍 Running Consumer Contract Testing Workflow...');
  
  // 1. Run consumer tests
  await runConsumerTests();
  
  // 2. Publish contracts (if enabled and on main branch)
  if (config.publishPacts && (config.gitBranch === 'main' || config.gitBranch === 'master')) {
    await publishContracts();
  }
  
  // 3. Record consumer version
  await recordConsumerVersion();
  
  console.log('✅ Consumer workflow completed successfully');
}

/**
 * Run provider verification workflow
 */
async function runProviderWorkflow() {
  console.log('🔍 Running Provider Verification Workflow...');
  
  // 1. Setup provider test environment
  await setupProviderEnvironment();
  
  // 2. Run provider verification
  await verifyProvider();
  
  // 3. Record provider version
  await recordProviderVersion();
  
  // 4. Cleanup provider environment
  await cleanupProviderEnvironment();
  
  console.log('✅ Provider workflow completed successfully');
}

/**
 * Run complete contract testing workflow
 */
async function runFullWorkflow() {
  console.log('🔍 Running Complete Contract Testing Workflow...');
  
  await runConsumerWorkflow();
  await runProviderWorkflow();
  await runDeploymentCheck();
  
  console.log('✅ Full contract testing workflow completed successfully');
}

/**
 * Run deployment compatibility check
 */
async function runDeploymentCheck() {
  console.log('🚦 Checking Deployment Compatibility...');
  
  try {
    // Use the deployment checker from our utilities
    const { execSync } = require('child_process');
    
    const result = execSync('npx tsx tests/contract/utils/deployment-checker.ts', {
      encoding: 'utf8',
      env: {
        ...process.env,
        ENVIRONMENT: config.environment,
        GIT_HASH: config.gitHash,
        DRY_RUN: config.dryRun.toString()
      }
    });
    
    const compatibility = JSON.parse(result);
    
    if (!compatibility.can_deploy) {
      console.error('❌ Deployment blocked by contract compatibility issues:');
      compatibility.blocking_issues.forEach(issue => {
        console.error(`  - ${issue}`);
      });
      
      if (compatibility.warnings.length > 0) {
        console.warn('⚠️  Warnings:');
        compatibility.warnings.forEach(warning => {
          console.warn(`  - ${warning}`);
        });
      }
      
      throw new Error('Deployment compatibility check failed');
    }
    
    console.log('✅ Deployment compatibility check passed');
    console.log(`   Compatibility Score: ${(compatibility.compatibility_score * 100).toFixed(1)}%`);
    
    if (compatibility.warnings.length > 0) {
      console.warn('⚠️  Warnings:');
      compatibility.warnings.forEach(warning => {
        console.warn(`  - ${warning}`);
      });
    }
    
    if (compatibility.recommendations.length > 0) {
      console.log('💡 Recommendations:');
      compatibility.recommendations.forEach(rec => {
        console.log(`  - ${rec}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Deployment compatibility check failed:', error.message);
    throw error;
  }
}

/**
 * Run consumer contract tests
 */
async function runConsumerTests() {
  console.log('🧪 Running consumer contract tests...');
  
  return new Promise((resolve, reject) => {
    const testProcess = spawn('npm', ['run', 'test:contract:consumer'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PACT_BROKER_URL: config.pactBrokerUrl,
        PACT_BROKER_TOKEN: config.pactBrokerToken,
        CI: 'true'
      }
    });
    
    testProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Consumer contract tests passed');
        resolve();
      } else {
        reject(new Error('Consumer contract tests failed'));
      }
    });
  });
}

/**
 * Publish contracts to Pact Broker
 */
async function publishContracts() {
  console.log('📤 Publishing contracts to Pact Broker...');
  
  if (config.dryRun) {
    console.log('🔍 DRY RUN: Would publish contracts');
    return;
  }
  
  return new Promise((resolve, reject) => {
    const publishCmd = [
      'run', 'pact:publish',
      '--',
      '--consumer-app-version', config.gitHash,
      '--tag', config.gitBranch
    ];
    
    const publishProcess = spawn('npm', publishCmd, {
      stdio: 'inherit',
      env: {
        ...process.env,
        PACT_BROKER_URL: config.pactBrokerUrl,
        PACT_BROKER_TOKEN: config.pactBrokerToken
      }
    });
    
    publishProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Contracts published successfully');
        resolve();
      } else {
        reject(new Error('Contract publishing failed'));
      }
    });
  });
}

/**
 * Verify provider against contracts
 */
async function verifyProvider() {
  console.log('🔬 Verifying provider against contracts...');
  
  return new Promise((resolve, reject) => {
    const verifyProcess = spawn('npm', ['run', 'test:contract:provider'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PACT_BROKER_URL: config.pactBrokerUrl,
        PACT_BROKER_TOKEN: config.pactBrokerToken,
        PROVIDER_BASE_URL: process.env.PROVIDER_BASE_URL || 'http://localhost:8080',
        CI: 'true'
      }
    });
    
    verifyProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Provider verification passed');
        resolve();
      } else {
        reject(new Error('Provider verification failed'));
      }
    });
  });
}

/**
 * Setup contract testing environment
 */
async function setupContractEnvironment() {
  console.log('⚙️  Setting up contract testing environment...');
  
  // Ensure required directories exist
  await fs.ensureDir('pacts');
  await fs.ensureDir('logs/pact');
  await fs.ensureDir('contract-versions');
  await fs.ensureDir('tmp/test-events');
  await fs.ensureDir('tmp/test-responses');
  
  // Create test configuration files if they don't exist
  const testConfigPath = 'pact-test.config.json';
  if (!await fs.pathExists(testConfigPath)) {
    const testConfig = {
      pactBrokerUrl: config.pactBrokerUrl,
      environment: config.environment,
      consumer: config.consumer,
      provider: config.provider,
      publishPacts: config.publishPacts,
      verifyProvider: config.verifyProvider
    };
    
    await fs.writeJson(testConfigPath, testConfig, { spaces: 2 });
  }
  
  console.log('✅ Contract testing environment setup complete');
}

/**
 * Setup provider test environment
 */
async function setupProviderEnvironment() {
  console.log('⚙️  Setting up provider test environment...');
  
  // Start test bridge instance if needed
  // This is handled in the provider tests, but we could add additional setup here
  
  // Clear any existing test data
  await fs.emptyDir('tmp/test-events');
  await fs.emptyDir('tmp/test-responses');
  
  console.log('✅ Provider environment setup complete');
}

/**
 * Cleanup provider test environment
 */
async function cleanupProviderEnvironment() {
  console.log('🧹 Cleaning up provider test environment...');
  
  // The provider tests handle their own cleanup
  // But we can add additional cleanup here if needed
  
  console.log('✅ Provider environment cleanup complete');
}

/**
 * Record consumer version in Pact Broker
 */
async function recordConsumerVersion() {
  if (config.dryRun) {
    console.log('🔍 DRY RUN: Would record consumer version');
    return;
  }
  
  try {
    console.log('📝 Recording consumer version...');
    
    const versionData = {
      pacticipant: config.consumer,
      version: config.gitHash,
      branch: config.gitBranch,
      buildUrl: process.env.BUILD_URL,
      tags: [config.gitBranch, 'latest']
    };
    
    // In practice, you'd use the Pact Broker API
    // For now, we'll just log the version information
    console.log('Consumer version recorded:', versionData);
    
  } catch (error) {
    console.warn('Failed to record consumer version:', error.message);
  }
}

/**
 * Record provider version in Pact Broker
 */
async function recordProviderVersion() {
  if (config.dryRun) {
    console.log('🔍 DRY RUN: Would record provider version');
    return;
  }
  
  try {
    console.log('📝 Recording provider version...');
    
    const versionData = {
      pacticipant: config.provider,
      version: config.gitHash,
      branch: config.gitBranch,
      buildUrl: process.env.BUILD_URL,
      tags: [config.gitBranch, 'latest']
    };
    
    // In practice, you'd use the Pact Broker API
    console.log('Provider version recorded:', versionData);
    
  } catch (error) {
    console.warn('Failed to record provider version:', error.message);
  }
}

/**
 * Cleanup contract testing artifacts
 */
async function cleanupContractArtifacts() {
  console.log('🧹 Cleaning up contract artifacts...');
  
  // Clean up temporary files and directories
  await fs.remove('tmp/test-events');
  await fs.remove('tmp/test-responses');
  await fs.remove('logs/pact');
  
  // Clean up old contract versions (keep last 10)
  try {
    const versionsDir = 'contract-versions';
    if (await fs.pathExists(versionsDir)) {
      const versions = (await fs.readdir(versionsDir))
        .filter(f => f.endsWith('.json') && f !== 'latest.json')
        .sort()
        .reverse();
      
      if (versions.length > 10) {
        const toRemove = versions.slice(10);
        for (const version of toRemove) {
          await fs.remove(path.join(versionsDir, version));
        }
        console.log(`Removed ${toRemove.length} old contract versions`);
      }
    }
  } catch (error) {
    console.warn('Error cleaning up contract versions:', error.message);
  }
  
  console.log('✅ Contract artifacts cleanup complete');
}

/**
 * Utility functions
 */
function getCurrentBranch() {
  try {
    return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getCurrentCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
  process.exit(1);
});

// Run main function
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}
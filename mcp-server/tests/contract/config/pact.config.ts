/**
 * Pact Configuration for Contract Testing
 * Configures consumer and provider settings for CCTelegram contract tests
 */

import { PactOptions, VerifierOptions } from '@pact-foundation/pact';
import { randomUUID } from 'crypto';
import path from 'path';

// Base directories
const contractsDir = path.resolve(__dirname, '../../../pacts');
const logsDir = path.resolve(__dirname, '../../../logs/pact');

// Git information for versioning
const getGitInfo = () => {
  try {
    const { execSync } = require('child_process');
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    return { commit, branch };
  } catch (error) {
    return { commit: randomUUID().slice(0, 8), branch: 'local' };
  }
};

const gitInfo = getGitInfo();

/**
 * Consumer configuration for MCP Server
 */
export const consumerConfig: PactOptions = {
  consumer: 'cctelegram-mcp-server',
  provider: 'cctelegram-bridge',
  port: 8989, // Port for Pact mock server
  host: '127.0.0.1',
  dir: contractsDir,
  log: path.join(logsDir, 'consumer.log'),
  logLevel: 'info',
  spec: 3, // Pact specification version
  pactfileWriteMode: 'update',
  timeout: 30000,
  cors: true,
  
  // Consumer version for contract evolution
  consumerVersion: gitInfo.commit,
  consumerVersionTags: [gitInfo.branch, 'latest'],
  
  // Enable contract publishing
  publishPacts: process.env.CI === 'true' || process.env.PACT_PUBLISH === 'true',
  
  // Pact Broker configuration
  pactBrokerUrl: process.env.PACT_BROKER_URL || 'http://localhost:9292',
  pactBrokerToken: process.env.PACT_BROKER_TOKEN,
  pactBrokerUsername: process.env.PACT_BROKER_USERNAME,
  pactBrokerPassword: process.env.PACT_BROKER_PASSWORD,
};

/**
 * Provider configuration for Bridge
 */
export const providerConfig: VerifierOptions = {
  provider: 'cctelegram-bridge',
  providerVersion: gitInfo.commit,
  providerVersionTags: [gitInfo.branch, 'latest'],
  
  // Provider base URL
  providerBaseUrl: process.env.BRIDGE_BASE_URL || 'http://localhost:8080',
  
  // Pact sources
  pactUrls: [
    path.join(contractsDir, 'cctelegram-mcp-server-cctelegram-bridge.json')
  ],
  
  // Pact Broker configuration
  pactBrokerUrl: process.env.PACT_BROKER_URL || 'http://localhost:9292',
  pactBrokerToken: process.env.PACT_BROKER_TOKEN,
  pactBrokerUsername: process.env.PACT_BROKER_USERNAME,
  pactBrokerPassword: process.env.PACT_BROKER_PASSWORD,
  
  // Consumer version selectors
  consumerVersionSelectors: [
    { tag: 'main', latest: true },
    { tag: 'master', latest: true },
    { deployed: true },
    { released: true }
  ],
  
  // State change URL for provider states
  stateHandlers: {
    'bridge is running': () => Promise.resolve('Bridge state set to running'),
    'bridge is stopped': () => Promise.resolve('Bridge state set to stopped'),
    'bridge is healthy': () => Promise.resolve('Bridge health set to healthy'),
    'bridge is unhealthy': () => Promise.resolve('Bridge health set to unhealthy'),
    'events directory exists': () => Promise.resolve('Events directory created'),
    'responses directory exists': () => Promise.resolve('Responses directory created'),
    'valid event exists': () => Promise.resolve('Valid event data prepared'),
    'invalid event exists': () => Promise.resolve('Invalid event data prepared'),
    'telegram responses exist': () => Promise.resolve('Telegram response data prepared'),
    'no telegram responses': () => Promise.resolve('Telegram responses cleared'),
    'bridge process is running': () => Promise.resolve('Bridge process started'),
    'bridge process is stopped': () => Promise.resolve('Bridge process stopped'),
    'task status data exists': () => Promise.resolve('Task status data prepared')
  },
  
  // Logging
  logDir: logsDir,
  logLevel: 'info',
  
  // Timeout settings
  timeout: 60000,
  
  // Publishing results
  publishVerificationResult: process.env.CI === 'true' || process.env.PACT_PUBLISH === 'true',
  
  // Ignore SSL certificate issues in development
  insecure: process.env.NODE_ENV !== 'production'
};

/**
 * Broker configuration for contract management
 */
export const brokerConfig = {
  brokerUrl: process.env.PACT_BROKER_URL || 'http://localhost:9292',
  pacticipant: 'cctelegram-mcp-server',
  version: gitInfo.commit,
  tags: [gitInfo.branch, 'latest'],
  
  // Authentication
  token: process.env.PACT_BROKER_TOKEN,
  username: process.env.PACT_BROKER_USERNAME,
  password: process.env.PACT_BROKER_PASSWORD,
  
  // Webhook configuration
  webhooks: {
    provider: 'cctelegram-bridge',
    consumer: 'cctelegram-mcp-server',
    events: ['contract_changed', 'provider_verification_published']
  }
};

/**
 * Contract evolution configuration
 */
export const evolutionConfig = {
  // Breaking change detection
  breakingChangeRules: {
    // Allow new optional fields
    allowNewOptionalFields: true,
    // Disallow removing required fields
    allowRemoveRequiredFields: false,
    // Allow adding new endpoints
    allowNewEndpoints: true,
    // Disallow removing endpoints
    allowRemoveEndpoints: false,
    // Allow changes to response formats with proper versioning
    allowResponseFormatChanges: false
  },
  
  // Version compatibility matrix
  compatibilityMatrix: {
    // Major version changes require explicit approval
    majorVersionChange: 'manual_approval',
    // Minor version changes can be automatic if backward compatible
    minorVersionChange: 'automatic_if_compatible',
    // Patch versions should be automatic
    patchVersionChange: 'automatic'
  },
  
  // Deployment gates
  deploymentGates: {
    // Require all consumers to verify before deployment
    requireConsumerVerification: true,
    // Allow deployment if critical consumers verify
    allowPartialVerification: false,
    // Timeout for verification process
    verificationTimeout: 300000 // 5 minutes
  }
};

/**
 * Test environment configuration
 */
export const testConfig = {
  // Mock server ports (avoid conflicts)
  mockServerPorts: {
    consumer: 8989,
    provider: 8990,
    broker: 9292
  },
  
  // Test timeouts
  timeouts: {
    consumer: 30000,
    provider: 60000,
    broker: 120000
  },
  
  // Test data configuration
  testData: {
    // Use deterministic IDs for contract stability
    deterministicIds: true,
    // Include example data in contracts
    includeExamples: true,
    // Mask sensitive data
    maskSensitiveData: true
  },
  
  // Contract validation rules
  validationRules: {
    // Require all requests to have proper schemas
    requireRequestSchemas: true,
    // Require all responses to have proper schemas
    requireResponseSchemas: true,
    // Validate all examples against schemas
    validateExamples: true,
    // Check for common API design issues
    checkApiDesign: true
  }
};

/**
 * CI/CD integration configuration
 */
export const ciConfig = {
  // Contract testing in CI pipeline
  pipeline: {
    // Run consumer tests in PR builds
    runConsumerInPR: true,
    // Run provider tests in main branch
    runProviderInMain: true,
    // Publish contracts from main branch only
    publishFromMain: true,
    // Block deployment on contract failures
    blockOnFailure: true
  },
  
  // Webhook integrations
  webhooks: {
    // Notify on contract changes
    notifyOnContractChange: true,
    // Notify on verification failures
    notifyOnVerificationFailure: true,
    // Include detailed failure information
    includeFailureDetails: true
  },
  
  // Deployment integration
  deployment: {
    // Check can-i-deploy before deployment
    checkBeforeDeploy: true,
    // Record deployment in Pact Broker
    recordDeployment: true,
    // Tag successful deployments
    tagDeployments: true
  }
};

// Export default configuration
export default {
  consumer: consumerConfig,
  provider: providerConfig,
  broker: brokerConfig,
  evolution: evolutionConfig,
  test: testConfig,
  ci: ciConfig
};
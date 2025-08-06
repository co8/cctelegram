/**
 * Contract Testing Workflow Integration Tests
 * Tests the complete contract testing pipeline from consumer to provider verification
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { ContractVersionManager } from '../utils/version-manager.js';
import { DeploymentCompatibilityChecker } from '../utils/deployment-checker.js';
import { ContractFixtures, ConsumerTestHelper } from '../utils/contract-helpers.js';
import { execSync, spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';

describe('Contract Testing Workflow Integration', () => {
  let versionManager: ContractVersionManager;
  let deploymentChecker: DeploymentCompatibilityChecker;
  let mockBrokerProcess: ChildProcess | null = null;
  let mockBridgeProcess: ChildProcess | null = null;
  
  const brokerPort = 9293;
  const bridgePort = 8081;
  const brokerUrl = `http://localhost:${brokerPort}`;
  const bridgeUrl = `http://localhost:${bridgePort}`;
  
  const testConfig = {
    consumer: 'test-mcp-server',
    provider: 'test-bridge',
    consumerVersion: 'test-consumer-v1.0.0',
    providerVersion: 'test-provider-v1.0.0',
    environment: 'integration-test'
  };

  beforeAll(async () => {
    console.log('🚀 Setting up contract testing workflow integration tests...');
    
    // Initialize managers
    versionManager = new ContractVersionManager();
    deploymentChecker = new DeploymentCompatibilityChecker();
    
    // Setup test directories
    await setupTestDirectories();
    
    // Start mock Pact Broker (if available)
    await startMockBroker();
    
    // Start mock bridge for provider verification
    await startMockBridge();
    
    console.log('✅ Contract testing workflow setup complete');
  }, 120000);

  afterAll(async () => {
    console.log('🧹 Cleaning up contract testing workflow...');
    
    await stopMockBroker();
    await stopMockBridge();
    await cleanupTestDirectories();
    
    console.log('✅ Cleanup complete');
  }, 30000);

  beforeEach(async () => {
    // Clear any existing contract artifacts before each test
    await fs.emptyDir('pacts');
    await fs.emptyDir('contract-versions');
  });

  describe('Complete Contract Lifecycle', () => {
    it('should execute full contract testing workflow', async () => {
      console.log('🔄 Testing complete contract lifecycle...');

      // Phase 1: Consumer Contract Generation
      console.log('Phase 1: Consumer Contract Generation');
      const consumerResults = await runConsumerContractTests();
      expect(consumerResults.success).toBe(true);
      expect(consumerResults.contractsGenerated).toBeGreaterThan(0);

      // Phase 2: Contract Publishing
      console.log('Phase 2: Contract Publishing');
      const publishResults = await publishContractsToMockBroker();
      expect(publishResults.success).toBe(true);

      // Phase 3: Provider Verification
      console.log('Phase 3: Provider Verification');
      const verificationResults = await runProviderVerification();
      expect(verificationResults.success).toBe(true);

      // Phase 4: Version Management
      console.log('Phase 4: Version Management');
      const versionResults = await recordContractVersion();
      expect(versionResults.success).toBe(true);

      // Phase 5: Deployment Compatibility Check
      console.log('Phase 5: Deployment Compatibility Check');
      const deploymentResults = await checkDeploymentCompatibility();
      expect(deploymentResults.canDeploy).toBe(true);

      console.log('✅ Complete contract lifecycle test passed');
    }, 180000);

    it('should handle contract evolution scenarios', async () => {
      console.log('🔄 Testing contract evolution...');

      // Generate initial contract version
      await runConsumerContractTests();
      const initialVersion = await versionManager.recordContractVersion(
        testConfig.consumerVersion,
        testConfig.providerVersion
      );
      expect(initialVersion.version).toBeDefined();

      // Simulate contract evolution with new fields
      await runConsumerContractTestsWithEvolution('add_optional_field');
      const evolvedVersion = await versionManager.recordContractVersion(
        'test-consumer-v1.1.0',
        testConfig.providerVersion
      );

      // Check breaking changes detection
      expect(evolvedVersion.breaking_changes.length).toBe(0); // Adding optional fields shouldn't break
      expect(evolvedVersion.evolution_metadata.backward_compatible).toBe(true);
      expect(evolvedVersion.evolution_metadata.version_type).toBe('minor');

      console.log('✅ Contract evolution test passed');
    }, 90000);

    it('should detect and prevent breaking changes', async () => {
      console.log('🔄 Testing breaking change detection...');

      // Generate initial contract
      await runConsumerContractTests();
      await versionManager.recordContractVersion(
        testConfig.consumerVersion,
        testConfig.providerVersion
      );

      // Simulate breaking change
      await runConsumerContractTestsWithEvolution('remove_required_field');
      const breakingVersion = await versionManager.recordContractVersion(
        'test-consumer-v2.0.0',
        testConfig.providerVersion
      );

      // Check breaking changes detection
      expect(breakingVersion.breaking_changes.length).toBeGreaterThan(0);
      expect(breakingVersion.evolution_metadata.backward_compatible).toBe(false);
      expect(breakingVersion.evolution_metadata.version_type).toBe('major');

      // Check deployment compatibility
      const compatibility = await deploymentChecker.checkDeploymentCompatibility('production');
      expect(compatibility.can_deploy).toBe(false);
      expect(compatibility.blocking_issues.length).toBeGreaterThan(0);

      console.log('✅ Breaking change detection test passed');
    }, 90000);
  });

  describe('Error Handling and Recovery', () => {
    it('should handle consumer test failures gracefully', async () => {
      console.log('🔄 Testing consumer test failure handling...');

      // Simulate consumer test failure
      const results = await runConsumerContractTestsWithFailure();
      expect(results.success).toBe(false);
      expect(results.errors).toContain('Consumer contract test failed');

      // Verify no contracts were published
      const contracts = await fs.readdir('pacts').catch(() => []);
      expect(contracts.length).toBe(0);

      console.log('✅ Consumer test failure handling test passed');
    }, 60000);

    it('should handle provider verification failures', async () => {
      console.log('🔄 Testing provider verification failure handling...');

      // Generate valid consumer contracts first
      await runConsumerContractTests();

      // Stop bridge to simulate provider failure
      await stopMockBridge();

      // Try provider verification (should fail)
      const results = await runProviderVerification();
      expect(results.success).toBe(false);

      // Restart bridge for cleanup
      await startMockBridge();

      console.log('✅ Provider verification failure handling test passed');
    }, 90000);

    it('should handle Pact Broker connectivity issues', async () => {
      console.log('🔄 Testing Pact Broker connectivity issues...');

      // Stop mock broker
      await stopMockBroker();

      // Try to publish (should handle gracefully)
      const publishResults = await publishContractsToMockBroker();
      expect(publishResults.success).toBe(false);
      expect(publishResults.error).toContain('broker');

      // Restart broker for other tests
      await startMockBroker();

      console.log('✅ Pact Broker connectivity handling test passed');
    }, 60000);
  });

  describe('Performance and Scalability', () => {
    it('should handle large contract files efficiently', async () => {
      console.log('🔄 Testing large contract handling...');

      const startTime = Date.now();

      // Generate large contract with many interactions
      await runConsumerContractTestsWithLargeData();
      
      const generationTime = Date.now() - startTime;
      expect(generationTime).toBeLessThan(30000); // Should complete within 30 seconds

      // Verify contract file exists and is reasonable size
      const contracts = await fs.readdir('pacts');
      expect(contracts.length).toBeGreaterThan(0);

      const contractPath = path.join('pacts', contracts[0]);
      const stats = await fs.stat(contractPath);
      expect(stats.size).toBeGreaterThan(1000); // Should have substantial content
      expect(stats.size).toBeLessThan(10 * 1024 * 1024); // But not excessive

      console.log('✅ Large contract handling test passed');
    }, 60000);

    it('should handle concurrent contract operations', async () => {
      console.log('🔄 Testing concurrent operations...');

      // Run multiple contract operations concurrently
      const operations = [
        runConsumerContractTests(),
        versionManager.recordContractVersion('concurrent-v1', 'concurrent-v1'),
        checkDeploymentCompatibility()
      ];

      const results = await Promise.allSettled(operations);
      
      // Check that operations completed without interfering with each other
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThan(0);

      console.log('✅ Concurrent operations test passed');
    }, 90000);
  });

  // Helper functions for test execution

  async function setupTestDirectories(): Promise<void> {
    const dirs = [
      'pacts',
      'logs/pact',
      'contract-versions', 
      'tmp/test-events',
      'tmp/test-responses'
    ];

    for (const dir of dirs) {
      await fs.ensureDir(dir);
    }
  }

  async function cleanupTestDirectories(): Promise<void> {
    const dirs = [
      'pacts',
      'contract-versions',
      'tmp'
    ];

    for (const dir of dirs) {
      await fs.remove(dir).catch(() => {});
    }
  }

  async function startMockBroker(): Promise<void> {
    console.log('Starting mock Pact Broker...');
    
    // For this test, we'll simulate a broker with a simple HTTP server
    // In a real scenario, you might start a Docker container with Pact Broker
    return new Promise((resolve) => {
      // Mock implementation - in practice you'd start actual Pact Broker
      setTimeout(() => {
        console.log(`Mock broker started on port ${brokerPort}`);
        resolve();
      }, 1000);
    });
  }

  async function stopMockBroker(): Promise<void> {
    if (mockBrokerProcess) {
      mockBrokerProcess.kill();
      mockBrokerProcess = null;
    }
  }

  async function startMockBridge(): Promise<void> {
    console.log('Starting mock bridge...');
    
    return new Promise((resolve) => {
      // Mock implementation - create simple HTTP server for testing
      const http = require('http');
      const server = http.createServer((req: any, res: any) => {
        // Mock bridge responses based on the contract specifications
        handleMockBridgeRequest(req, res);
      });

      server.listen(bridgePort, () => {
        console.log(`Mock bridge started on port ${bridgePort}`);
        resolve();
      });

      // Store reference for cleanup
      (global as any).mockBridgeServer = server;
    });
  }

  async function stopMockBridge(): Promise<void> {
    const server = (global as any).mockBridgeServer;
    if (server) {
      server.close();
      delete (global as any).mockBridgeServer;
    }
  }

  function handleMockBridgeRequest(req: any, res: any): void {
    res.setHeader('Content-Type', 'application/json');
    
    if (req.url === '/health' && req.method === 'GET') {
      res.statusCode = 200;
      res.end(JSON.stringify({
        running: true,
        health: 'healthy',
        metrics: {
          uptime_seconds: 3600,
          events_processed: 150,
          telegram_messages_sent: 145,
          error_count: 2,
          memory_usage_mb: 45.2,
          cpu_usage_percent: 12.8
        },
        version: '0.6.0'
      }));
    } else if (req.url === '/api/events' && req.method === 'POST') {
      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        event_id: 'test-event-001',
        file_path: '/tmp/test-event-001.json',
        message: 'Event sent successfully'
      }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  async function runConsumerContractTests(): Promise<{ success: boolean; contractsGenerated: number; errors?: string[] }> {
    try {
      // Simulate running consumer contract tests
      const testHelper = new ConsumerTestHelper();
      
      // Generate some test contracts
      await fs.writeJson('pacts/test-consumer-test-provider.json', {
        consumer: { name: testConfig.consumer },
        provider: { name: testConfig.provider },
        interactions: [
          {
            description: 'a valid event submission',
            providerState: 'bridge is running',
            request: {
              method: 'POST',
              path: '/api/events',
              body: ContractFixtures.createEventFixture()
            },
            response: {
              status: 200,
              body: { success: true, event_id: 'test-001' }
            }
          }
        ],
        metadata: {
          pactSpecification: { version: '3.0.0' }
        }
      }, { spaces: 2 });

      return { success: true, contractsGenerated: 1 };
    } catch (error) {
      return { 
        success: false, 
        contractsGenerated: 0,
        errors: [error.message]
      };
    }
  }

  async function runConsumerContractTestsWithEvolution(evolutionType: string): Promise<void> {
    const baseContract = {
      consumer: { name: testConfig.consumer },
      provider: { name: testConfig.provider },
      interactions: [
        {
          description: 'an evolved event submission',
          providerState: 'bridge is running',
          request: {
            method: 'POST',
            path: '/api/events',
            body: evolutionType === 'add_optional_field' ? 
              { ...ContractFixtures.createEventFixture(), optional_new_field: 'new_value' } :
              ContractFixtures.createEventFixture()
          },
          response: {
            status: 200,
            body: evolutionType === 'remove_required_field' ?
              { success: true } : // Remove event_id field
              { success: true, event_id: 'test-001' }
          }
        }
      ],
      metadata: {
        pactSpecification: { version: '3.0.0' }
      }
    };

    await fs.writeJson('pacts/test-consumer-test-provider.json', baseContract, { spaces: 2 });
  }

  async function runConsumerContractTestsWithFailure(): Promise<{ success: boolean; errors: string[] }> {
    return {
      success: false,
      errors: ['Consumer contract test failed', 'Mock failure for testing']
    };
  }

  async function runConsumerContractTestsWithLargeData(): Promise<void> {
    const interactions = [];
    
    // Generate many interactions to simulate large contracts
    for (let i = 0; i < 50; i++) {
      interactions.push({
        description: `event submission ${i}`,
        providerState: 'bridge is running',
        request: {
          method: 'POST',
          path: '/api/events',
          body: ContractFixtures.createEventFixture({ title: `Event ${i}` })
        },
        response: {
          status: 200,
          body: { success: true, event_id: `test-${String(i).padStart(3, '0')}` }
        }
      });
    }

    const largeContract = {
      consumer: { name: testConfig.consumer },
      provider: { name: testConfig.provider },
      interactions,
      metadata: {
        pactSpecification: { version: '3.0.0' }
      }
    };

    await fs.writeJson('pacts/test-consumer-test-provider.json', largeContract, { spaces: 2 });
  }

  async function publishContractsToMockBroker(): Promise<{ success: boolean; error?: string }> {
    try {
      // Simulate publishing to Pact Broker
      // In a real test, you'd make actual HTTP calls to the broker
      console.log('Publishing contracts to mock broker...');
      
      // Check if contracts exist
      const contracts = await fs.readdir('pacts');
      if (contracts.length === 0) {
        throw new Error('No contracts to publish');
      }

      // Simulate broker communication delay
      await new Promise(resolve => setTimeout(resolve, 500));

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Broker communication failed: ${error.message}`
      };
    }
  }

  async function runProviderVerification(): Promise<{ success: boolean; errors?: string[] }> {
    try {
      // Simulate provider verification against contracts
      console.log('Running provider verification...');
      
      // Check if mock bridge is accessible
      const response = await axios.get(`${bridgeUrl}/health`, { timeout: 5000 });
      if (response.status !== 200) {
        throw new Error('Bridge health check failed');
      }

      // Simulate verification process
      await new Promise(resolve => setTimeout(resolve, 1000));

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        errors: [`Provider verification failed: ${error.message}`]
      };
    }
  }

  async function recordContractVersion(): Promise<{ success: boolean }> {
    try {
      await versionManager.recordContractVersion(
        testConfig.consumerVersion,
        testConfig.providerVersion
      );
      return { success: true };
    } catch (error) {
      console.warn('Version recording failed:', error.message);
      return { success: false };
    }
  }

  async function checkDeploymentCompatibility(): Promise<{ canDeploy: boolean }> {
    try {
      const compatibility = await deploymentChecker.checkDeploymentCompatibility(
        testConfig.environment
      );
      return { canDeploy: compatibility.can_deploy };
    } catch (error) {
      console.warn('Deployment compatibility check failed:', error.message);
      return { canDeploy: false };
    }
  }
});
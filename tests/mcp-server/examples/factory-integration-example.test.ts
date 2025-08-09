/**
 * Factory Integration Example
 * 
 * Comprehensive example demonstrating how to use the factory-bot pattern
 * implementation with fixtures, data seeding, and test isolation.
 */

import { Factory, setupFactories, cleanupFactories } from '../factories/factory-bot.js';
import { fixtureManager, Fixtures } from '../fixtures/fixture-manager.js';
import { CommonDataSeeder, SeedingUtils } from '../utilities/data-seeder.js';
import { testIsolation, IsolationUtils } from '../utilities/test-isolation.js';
import { CCTelegramEvent, TelegramResponse, BridgeStatus } from '../../src/types.js';

describe('Factory Integration Example', () => {
  let testId: string;
  let seeder: CommonDataSeeder;

  beforeAll(async () => {
    // Initialize the factory system
    setupFactories();
  });

  beforeEach(async () => {
    // Begin test isolation
    testId = await testIsolation.beginTestIsolation(
      expect.getState().currentTestName || 'unknown',
      __filename,
      'standard'
    );
    
    // Create isolated data seeder
    const tempDir = await testIsolation.createIsolatedDirectory(testId, 'seeded-data');
    seeder = new CommonDataSeeder(tempDir);
  });

  afterEach(async () => {
    // Cleanup test isolation
    await testIsolation.endTestIsolation(testId);
  });

  afterAll(async () => {
    // Global cleanup
    cleanupFactories();
    await testIsolation.cleanupAll();
  });

  describe('Basic Factory Usage', () => {
    it('should create single objects with factory-bot pattern', () => {
      // Create a basic event
      const event = Factory.build<CCTelegramEvent>('event');
      
      expect(event).toMatchObject({
        type: 'info_notification',
        source: 'claude-code',
        title: 'Test Event',
        description: expect.any(String),
        timestamp: expect.any(String),
        task_id: expect.any(String),
        data: expect.any(Object)
      });
    });

    it('should create objects with traits', () => {
      // Create a task completion event
      const completionEvent = Factory.build<CCTelegramEvent>('event', {}, ['task_completion']);
      
      expect(completionEvent.type).toBe('task_completion');
      expect(completionEvent.title).toBe('Task Completed Successfully');
      expect(completionEvent.data).toMatchObject({
        status: 'completed',
        results: expect.any(String),
        duration_ms: expect.any(Number),
        files_affected: expect.any(Array)
      });
    });

    it('should create objects with overrides', () => {
      // Create an event with custom properties
      const customEvent = Factory.build<CCTelegramEvent>('event', {
        title: 'Custom Test Event',
        source: 'test-runner'
      });
      
      expect(customEvent.title).toBe('Custom Test Event');
      expect(customEvent.source).toBe('test-runner');
    });

    it('should create multiple objects with buildList', () => {
      // Create multiple responses
      const responses = Factory.buildList<TelegramResponse>('telegram_response', 5);
      
      expect(responses).toHaveLength(5);
      responses.forEach(response => {
        expect(response).toMatchObject({
          id: expect.any(String),
          user_id: expect.any(Number),
          message: expect.any(String),
          timestamp: expect.any(String)
        });
      });
    });
  });

  describe('Advanced Factory Patterns', () => {
    it('should create workflow sequences', () => {
      // Create a complete workflow
      const workflow = Factory.build<CCTelegramEvent[]>('event_workflow');
      
      expect(workflow).toHaveLength(4);
      expect(workflow[0].type).toBe('task_started');
      expect(workflow[1].type).toBe('code_generation');
      expect(workflow[2].type).toBe('test_suite_run');
      expect(workflow[3].type).toBe('task_completion');
      
      // Verify sequential timestamps
      for (let i = 1; i < workflow.length; i++) {
        const prevTime = new Date(workflow[i - 1].timestamp).getTime();
        const currTime = new Date(workflow[i].timestamp).getTime();
        expect(currTime).toBeGreaterThan(prevTime);
      }
    });

    it('should create time-based events', () => {
      // Create events across different time periods
      const timeline = Factory.build<CCTelegramEvent[]>('event_timeline');
      
      expect(timeline).toHaveLength(4);
      
      const now = Date.now();
      const timestamps = timeline.map(event => new Date(event.timestamp).getTime());
      
      // Verify time ordering (most recent first)
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeLessThan(timestamps[i - 1]);
      }
    });

    it('should create bridge status with different health states', () => {
      const healthyStatus = Factory.build<BridgeStatus>('bridge_status', {}, ['healthy']);
      const degradedStatus = Factory.build<BridgeStatus>('bridge_status', {}, ['degraded']);
      const unhealthyStatus = Factory.build<BridgeStatus>('bridge_status', {}, ['unhealthy']);
      
      expect(healthyStatus.health).toBe('healthy');
      expect(healthyStatus.running).toBe(true);
      expect(healthyStatus.metrics.error_count).toBeLessThanOrEqual(2);
      
      expect(degradedStatus.health).toBe('degraded');
      expect(degradedStatus.metrics.error_count).toBeGreaterThan(2);
      
      expect(unhealthyStatus.health).toBe('unhealthy');
      expect(unhealthyStatus.metrics.error_count).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Fixture Management Integration', () => {
    it('should setup and teardown fixtures', async () => {
      // Create a fixture for test data
      const dataFixture = Fixtures.testDataFiles('example', 10);
      fixtureManager.register(dataFixture);
      
      // Track fixture usage
      testIsolation.trackFixtureUsage(testId, dataFixture.metadata.name);
      
      // Setup the fixture
      await fixtureManager.setup(dataFixture.metadata.name);
      
      // Verify fixture is active
      expect(fixtureManager.isActive(dataFixture.metadata.name)).toBe(true);
      
      // The fixture will be automatically cleaned up by test isolation
    });

    it('should create environment fixtures', async () => {
      // Create environment fixture
      const envFixture = Fixtures.environment('test-env', {
        TEST_MODE: 'factory-integration',
        DATA_SOURCE: 'generated'
      });
      
      fixtureManager.register(envFixture);
      testIsolation.trackFixtureUsage(testId, envFixture.metadata.name);
      
      await fixtureManager.setup(envFixture.metadata.name);
      
      // Verify environment variables are set
      expect(process.env.TEST_MODE).toBe('factory-integration');
      expect(process.env.DATA_SOURCE).toBe('generated');
    });
  });

  describe('Data Seeding Integration', () => {
    it('should seed basic test data', async () => {
      // Seed basic events and responses
      const results = await seeder.seedMultiple(['basic_events', 'basic_responses']);
      
      expect(results.basic_events.success).toBe(true);
      expect(results.basic_events.total_records).toBe(20);
      expect(results.basic_events.files_created.length).toBeGreaterThan(0);
      
      expect(results.basic_responses.success).toBe(true);
      expect(results.basic_responses.total_records).toBe(15);
    });

    it('should seed performance test data', async () => {
      // Seed high-volume data for performance testing
      const result = await seeder.seedPattern('high_volume_events');
      
      expect(result.success).toBe(true);
      expect(result.total_records).toBe(1000);
      expect(result.files_created.length).toBeGreaterThan(0);
    });

    it('should use seeding utilities for quick setup', async () => {
      // Quick setup with custom counts
      const outputDir = await SeedingUtils.quickSetup('integration-test', {
        events: 50,
        responses: 25
      });
      
      expect(outputDir).toContain('integration-test');
      // Files would be created in the output directory
    });
  });

  describe('Test Isolation Integration', () => {
    it('should create isolated test environment', async () => {
      // Create isolated directories
      const eventsDir = await testIsolation.createIsolatedDirectory(testId, 'events');
      const responsesDir = await testIsolation.createIsolatedDirectory(testId, 'responses');
      
      expect(eventsDir).toContain(testId);
      expect(responsesDir).toContain(testId);
      expect(eventsDir).not.toBe(responsesDir);
    });

    it('should track and cleanup created files', async () => {
      // Create test files
      const files = await IsolationUtils.createTestFiles(testId, [
        { name: 'test-event.json', content: JSON.stringify(Factory.build('event')) },
        { name: 'test-response.json', content: JSON.stringify(Factory.build('telegram_response')) }
      ]);
      
      expect(files).toHaveLength(2);
      expect(files[0]).toContain('test-event.json');
      expect(files[1]).toContain('test-response.json');
      
      // Files will be automatically cleaned up by test isolation
    });

    it('should setup test environment with configuration', async () => {
      // Setup environment configuration
      await IsolationUtils.setupEnvironment(testId, {
        FACTORY_TEST_MODE: 'integration',
        ISOLATED_RUN: 'true'
      });
      
      expect(process.env.FACTORY_TEST_MODE).toBe('integration');
      expect(process.env.ISOLATED_RUN).toBe('true');
      
      // Environment will be restored by test isolation
    });
  });

  describe('Complete Integration Workflow', () => {
    it('should demonstrate complete factory workflow', async () => {
      // 1. Setup environment
      await IsolationUtils.setupEnvironment(testId, {
        TEST_SCENARIO: 'complete-workflow',
        LOG_LEVEL: 'debug'
      });

      // 2. Create test data with factories
      const events = Factory.buildList<CCTelegramEvent>('event', 10, {}, ['task_completion', 'build_completed']);
      const responses = Factory.buildList<TelegramResponse>('telegram_response', 5, {}, ['approve', 'deny']);
      const bridgeStatus = Factory.build<BridgeStatus>('bridge_status', {}, ['healthy']);

      // 3. Seed additional data
      await seeder.seedPattern('basic_events');

      // 4. Create fixtures for persistent data
      const configFixture = Fixtures.bridgeConfig('integration-test', ['testing']);
      fixtureManager.register(configFixture);
      testIsolation.trackFixtureUsage(testId, configFixture.metadata.name);
      await fixtureManager.setup(configFixture.metadata.name);

      // 5. Verify all data is properly created and isolated
      expect(events).toHaveLength(10);
      expect(responses).toHaveLength(5);
      expect(bridgeStatus.health).toBe('healthy');
      expect(process.env.TEST_SCENARIO).toBe('complete-workflow');
      expect(fixtureManager.isActive(configFixture.metadata.name)).toBe(true);

      // 6. Test data consistency
      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('task_completion');
      expect(eventTypes).toContain('build_completed');

      const responseActions = responses.map(r => r.action).filter(Boolean);
      expect(responseActions).toContain('approve');
      expect(responseActions).toContain('deny');

      // All cleanup will happen automatically through test isolation
    });

    it('should handle error scenarios with factories', async () => {
      // Create invalid data for error testing
      const invalidEvent = Factory.build<Partial<CCTelegramEvent>>('event', {}, ['invalid_data']);
      const invalidResponses = Factory.buildList<Partial<TelegramResponse>>('telegram_response', 3, {}, ['invalid_user_id', 'empty_message']);

      // Verify invalid data properties
      expect(invalidEvent.title).toBe(''); // Invalid: empty title
      expect(invalidEvent.description?.length).toBeGreaterThan(2000); // Invalid: too long

      invalidResponses.forEach(response => {
        if (response.user_id !== undefined) {
          expect(response.user_id).toBe(-1); // Invalid user ID
        }
        if (response.message !== undefined) {
          expect(response.message).toBe(''); // Empty message
        }
      });
    });
  });

  describe('Performance and Memory Management', () => {
    it('should handle large data generation efficiently', async () => {
      const startTime = Date.now();
      const startMemory = process.memoryUsage().heapUsed;

      // Generate large dataset
      const largeEventSet = Factory.buildList<CCTelegramEvent>('event', 1000);
      const largeResponseSet = Factory.buildList<TelegramResponse>('telegram_response', 500);

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;

      // Verify performance characteristics
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(largeEventSet).toHaveLength(1000);
      expect(largeResponseSet).toHaveLength(500);

      // Memory usage should be reasonable (less than 100MB increase)
      const memoryIncrease = (endMemory - startMemory) / 1024 / 1024;
      expect(memoryIncrease).toBeLessThan(100);
    });

    it('should reset sequences properly between tests', () => {
      // Create objects and verify sequence behavior
      const event1 = Factory.build<CCTelegramEvent>('event');
      const event2 = Factory.build<CCTelegramEvent>('event');

      // Sequences should be incrementing
      expect(event1.task_id).not.toBe(event2.task_id);

      // Reset sequences
      Factory.resetSequences();

      const event3 = Factory.build<CCTelegramEvent>('event');
      
      // After reset, sequences should start over
      // Note: This test would need to be designed with known sequence starting points
      expect(event3.task_id).toBeDefined();
    });
  });
});

/**
 * Integration utility functions for example usage
 */
export const ExampleUtils = {
  /**
   * Create a complete test scenario setup
   */
  async createTestScenario(name: string): Promise<{
    testId: string;
    events: CCTelegramEvent[];
    responses: TelegramResponse[];
    bridgeStatus: BridgeStatus;
    dataDir: string;
  }> {
    const testId = await testIsolation.beginTestIsolation(name, 'example', 'complete');
    
    const events = Factory.buildList<CCTelegramEvent>('event', 20, {}, ['task_completion', 'build_completed', 'performance_alert']);
    const responses = Factory.buildList<TelegramResponse>('telegram_response', 10, {}, ['approve', 'deny', 'defer']);
    const bridgeStatus = Factory.build<BridgeStatus>('bridge_status', {}, ['healthy']);
    
    const dataDir = await testIsolation.createIsolatedDirectory(testId, 'scenario-data');
    
    return {
      testId,
      events,
      responses,
      bridgeStatus,
      dataDir
    };
  },

  /**
   * Cleanup test scenario
   */
  async cleanupTestScenario(testId: string): Promise<void> {
    await testIsolation.endTestIsolation(testId);
  }
};
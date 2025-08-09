# CCTelegram Test Data Factories and Fixtures

Comprehensive test data factory system implementing the factory-bot pattern for consistent, reproducible test scenarios across integration and E2E tests.

## 🏗️ Architecture Overview

### Core Components

1. **Factory-Bot Pattern Implementation** (`factories/factory-bot.ts`)
   - Registry-based factory management
   - Trait system for variations
   - Sequence generators for unique values
   - Utility functions for common patterns

2. **Specialized Factories** (`factories/`)
   - Event factories with 20+ traits
   - Response factories for Telegram interactions
   - Bridge status and system state factories
   - Configuration factories for different environments

3. **Fixture Management** (`fixtures/fixture-manager.ts`)
   - Declarative fixture definitions
   - Dependency management
   - Automatic cleanup and teardown
   - Support for files, directories, processes, and environment

4. **Data Seeding** (`utilities/data-seeder.ts`)
   - Batch data generation for integration tests
   - Multiple output formats (JSON, YAML, CSV)
   - Pre-configured patterns for common scenarios
   - Mock API response generation

5. **Test Isolation** (`utilities/test-isolation.ts`)
   - Environment isolation between tests
   - Automatic cleanup mechanisms
   - Process and resource tracking
   - Multiple isolation levels

## 🚀 Quick Start

### Basic Factory Usage

```typescript
import { Factory, setupFactories } from './factories/factory-bot.js';

// Initialize factories (call once in test setup)
setupFactories();

// Create a single event
const event = Factory.build('event');

// Create event with traits
const taskCompletion = Factory.build('event', {}, ['task_completion']);

// Create event with overrides
const customEvent = Factory.build('event', {
  title: 'Custom Event',
  source: 'my-test'
});

// Create multiple objects
const events = Factory.buildList('event', 10, {}, ['performance_alert']);
```

### Advanced Factory Patterns

```typescript
// Create complete workflows
const workflow = Factory.build('event_workflow'); // Returns 4 related events

// Create time-based scenarios
const timeline = Factory.build('event_timeline'); // Events across time periods

// Create approval workflow responses
const approvalFlow = Factory.build('approval_workflow');

// Create system state scenarios
const metrics = Factory.build('system_metrics', {}, ['stressed_system']);
```

### Fixture Management

```typescript
import { fixtureManager, Fixtures } from './fixtures/fixture-manager.js';

// Create and setup fixtures
const dataFixture = Fixtures.testDataFiles('my-test', 20);
fixtureManager.register(dataFixture);
await fixtureManager.setup(dataFixture.metadata.name);

// Use fixture data...

// Automatic cleanup happens via test isolation
```

### Data Seeding

```typescript
import { CommonDataSeeder, SeedingUtils } from './utilities/data-seeder.js';

// Quick setup for simple scenarios
const dataDir = await SeedingUtils.quickSetup('integration-test', {
  events: 100,
  responses: 50
});

// Advanced seeding with custom patterns
const seeder = new CommonDataSeeder('/tmp/test-data');
await seeder.seedMultiple(['basic_events', 'performance_events']);
```

### Test Isolation

```typescript
import { testIsolation, IsolationUtils } from './utilities/test-isolation.js';

// In your test setup
const testId = await testIsolation.beginTestIsolation('my-test', __filename);

// Create isolated environment
const dirs = await IsolationUtils.createTempEnvironment('my-test');
await IsolationUtils.setupEnvironment(testId, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error'
});

// Test runs in isolation...

// Cleanup happens automatically
await testIsolation.endTestIsolation(testId);
```

## 📊 Available Factories

### Event Factories (`event`)

**Base Factory**: Creates basic `CCTelegramEvent` objects

**Available Traits**:
- Task Management: `task_completion`, `task_failed`, `task_started`
- Code Operations: `code_generation`, `code_refactoring`
- Build & Test: `build_completed`, `build_failed`, `test_suite_run`
- Performance: `performance_alert`, `system_health`
- Git Operations: `git_commit`, `pull_request_created`
- API & Integration: `api_call`, `webhook_received`
- User Interaction: `approval_request`, `user_response`
- Security: `security_alert`
- File System: `file_created`, `file_modified`
- Priority: `high_priority`, `low_priority`
- Source: `from_mcp_server`, `from_bridge`, `from_external`
- Testing: `invalid_data`, `missing_required`

**Batch Factories**:
- `event_batch`: Multiple related events
- `event_workflow`: Complete task workflow sequence
- `event_timeline`: Events across different time periods

### Response Factories (`telegram_response`)

**Base Factory**: Creates `TelegramResponse` objects

**Available Traits**:
- Approval Actions: `approve`, `deny`, `defer`
- Detailed Actions: `detailed_approve`, `detailed_deny`
- Custom Actions: `custom_action`, `emergency`, `status_inquiry`
- Time-based: `very_recent`, `recent`, `old`, `very_old`
- User Types: `admin_user`, `standard_user`, `developer_user`
- Validation: `invalid_user_id`, `invalid_timestamp`, `missing_message`
- Internationalization: `spanish`, `french`, `emoji_response`

**Batch Factories**:
- `response_batch`: Multiple related responses
- `approval_workflow`: Complete approval sequence
- `mixed_approval_responses`: Various approval types
- `time_based_responses`: Responses across time periods
- `role_based_responses`: Responses from different user types

### Bridge Status Factories (`bridge_status`)

**Base Factory**: Creates `BridgeStatus` objects

**Available Traits**:
- Health States: `healthy`, `degraded`, `unhealthy`
- Running States: `starting`, `stopped`, `restarting`
- Performance: `high_load`, `low_load`
- Uptime: `fresh_start`, `long_running`
- Errors: `high_errors`, `no_errors`
- Activity: `active`, `inactive`
- Memory: `memory_leak`, `low_memory`
- Testing: `connection_timeout`, `invalid_data`

### System Factories

**Environment Factory** (`system_environment`):
- Traits: `development`, `production`, `testing`, `secure`, `insecure`

**Filesystem Factory** (`filesystem_state`):
- Traits: `healthy_filesystem`, `low_disk_space`, `permission_denied`

**Network Factory** (`network_state`):
- Traits: `healthy_network`, `slow_network`, `telegram_down`, `rate_limited`

**Test Scenario Factory** (`test_scenario`):
- Traits: `happy_path`, `error_recovery`, `resource_constraints`, `high_load`

### Configuration Factories

**MCP Config Factory** (`mcp_config`):
- Traits: `development`, `production`, `testing`, `high_security`

**Bridge Config Factory** (`bridge_config`):
- Traits: `development`, `production`, `testing`, `fast_polling`

**Test Config Factory** (`test_config`):
- Traits: `unit_test`, `integration_test`, `e2e_test`, `performance_test`

## 🎯 Usage Patterns

### Integration Testing

```typescript
describe('Bridge Integration Tests', () => {
  let testId: string;
  let seeder: CommonDataSeeder;

  beforeEach(async () => {
    // Setup isolated test environment
    testId = await testIsolation.beginTestIsolation(
      expect.getState().currentTestName,
      __filename,
      'standard'
    );
    
    // Create data seeder
    const tempDir = await testIsolation.createIsolatedDirectory(testId, 'data');
    seeder = new CommonDataSeeder(tempDir);
    
    // Seed test data
    await seeder.seedMultiple(['basic_events', 'basic_responses']);
  });

  afterEach(async () => {
    await testIsolation.endTestIsolation(testId);
  });

  it('should process events correctly', async () => {
    // Create test events
    const events = Factory.buildList('event', 5, {}, ['task_completion']);
    
    // Process events through system...
    
    // Verify expected behavior
  });
});
```

### Performance Testing

```typescript
describe('Performance Tests', () => {
  it('should handle high event volume', async () => {
    // Generate large dataset
    const events = Factory.buildList('event', 10000);
    const responses = Factory.buildList('telegram_response', 5000);
    
    // Seed high-volume data
    const seeder = new CommonDataSeeder('/tmp/perf-test');
    await seeder.seedPattern('high_volume_events');
    
    // Run performance tests...
  });
});
```

### Error Scenario Testing

```typescript
describe('Error Handling', () => {
  it('should handle invalid data gracefully', async () => {
    // Create invalid data for testing
    const invalidEvents = Factory.buildList('event', 5, {}, ['invalid_data']);
    const invalidResponses = Factory.buildList('telegram_response', 3, {}, ['invalid_user_id']);
    
    // Test error handling...
  });
});
```

## 🧪 Test Environment Setup

### Jest Integration

```typescript
// jest.setup.ts
import { setupFactories, cleanupFactories } from './tests/factories/factory-bot.js';
import { testIsolation } from './tests/utilities/test-isolation.js';

beforeAll(async () => {
  setupFactories();
});

beforeEach(async () => {
  const testName = expect.getState().currentTestName || 'unknown';
  const testFile = expect.getState().testPath || 'unknown';
  return await testIsolation.beginTestIsolation(testName, testFile, 'standard');
});

afterEach(async () => {
  await testIsolation.cleanupAll();
});

afterAll(async () => {
  cleanupFactories();
  await testIsolation.cleanupAll();
});
```

### Custom Test Helpers

```typescript
// Custom test utility
export async function createTestScenario(name: string) {
  const testId = await testIsolation.beginTestIsolation(name, 'helper', 'complete');
  
  // Setup environment
  await IsolationUtils.setupEnvironment(testId, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error'
  });
  
  // Create data
  const events = Factory.buildList('event', 20);
  const responses = Factory.buildList('telegram_response', 10);
  
  return { testId, events, responses };
}
```

## 📚 API Reference

### Factory Class Methods
- `Factory.define(name, buildFn, options)`: Register a factory
- `Factory.build(name, overrides, traits)`: Create single object
- `Factory.buildList(name, count, overrides, traits)`: Create multiple objects
- `Factory.sequence(name)`: Get next sequence value
- `Factory.resetSequences()`: Reset all sequences

### Fixture Manager Methods
- `fixtureManager.register(definition)`: Register fixture
- `fixtureManager.setup(name)`: Setup fixture
- `fixtureManager.teardown(name)`: Teardown fixture
- `fixtureManager.teardownAll()`: Cleanup all fixtures

### Test Isolation Methods
- `testIsolation.beginTestIsolation(name, file, level)`: Start isolation
- `testIsolation.endTestIsolation(testId)`: End isolation
- `testIsolation.createIsolatedDirectory(testId, purpose)`: Create temp directory

For complete API documentation, see the TypeScript interfaces in each module.
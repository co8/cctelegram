/**
 * Test Fixtures Index
 * Centralized export of all test fixtures
 */

// Legacy Event fixtures (for backward compatibility)
export * from './event-fixtures.js';
export * from './response-fixtures.js';
export * from './bridge-fixtures.js';

// Factory-Bot Pattern System
export * from '../factories/factory-bot.js';
export * from '../factories/event-factories.js';
export * from '../factories/response-factories.js';
export * from '../factories/bridge-factories.js';
export * from '../factories/system-factories.js';
export * from '../factories/config-factories.js';

// Legacy factories (for backward compatibility)
export * from '../factories/data-factory.js';

// Fixture Management System
export * from './fixture-manager.js';

// Data Seeding Utilities
export * from '../utilities/data-seeder.js';

// Test Isolation System
export * from '../utilities/test-isolation.js';

// Mocks
export * from '../mocks/fs-mock.js';
export * from '../mocks/http-mock.js';
export * from '../mocks/process-mock.js';

// Utilities
export * from '../utils/test-helpers.js';
export * from '../setup/test-environment.js';
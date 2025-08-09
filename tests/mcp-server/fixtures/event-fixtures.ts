/**
 * Event Test Fixtures
 * Provides pre-built event objects for testing all MCP tools
 */

import { EventType, CCTelegramEvent } from '../../src/types.js';

// Base timestamp for consistent testing
export const BASE_TIMESTAMP = '2025-08-05T10:00:00.000Z';
export const VALID_TASK_ID = '550e8400-e29b-41d4-a716-446655440000';
export const VALID_EVENT_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Complete valid event for task completion
 */
export const VALID_TASK_COMPLETION_EVENT: CCTelegramEvent = {
  type: 'task_completion' as EventType,
  title: 'User Authentication System Complete',
  description: 'Successfully implemented JWT-based authentication system with bcrypt password hashing',
  task_id: VALID_TASK_ID,
  source: 'claude-code',
  timestamp: BASE_TIMESTAMP,
  data: {
    results: 'JWT authentication system implemented with secure password hashing',
    duration_ms: 45000,
    files_affected: ['src/auth.ts', 'src/middleware/auth.ts', 'tests/auth.test.ts'],
    performance_metrics: {
      login_time_ms: 250,
      token_validation_ms: 50
    }
  }
};

/**
 * Valid performance alert event
 */
export const VALID_PERFORMANCE_ALERT_EVENT: CCTelegramEvent = {
  type: 'performance_alert' as EventType,
  title: 'High Memory Usage Detected',
  description: 'Application memory usage has exceeded the configured threshold',
  source: 'claude-code',
  timestamp: BASE_TIMESTAMP,
  data: {
    current_value: 850,
    threshold: 800,
    severity: 'high',
    metric_name: 'memory_usage_mb',
    duration_ms: 300000
  }
};

/**
 * Valid approval request event
 */
export const VALID_APPROVAL_REQUEST_EVENT: CCTelegramEvent = {
  type: 'approval_request' as EventType,
  title: 'Deploy to Production Environment',
  description: 'Ready to deploy version 1.2.0 to production. All tests passing.',
  source: 'claude-code',
  timestamp: BASE_TIMESTAMP,
  data: {
    options: ['Approve', 'Deny', 'Defer'],
    deployment_details: {
      version: '1.2.0',
      environment: 'production',
      tests_passed: 156,
      tests_failed: 0
    }
  }
};

/**
 * Valid info notification event
 */
export const VALID_INFO_NOTIFICATION_EVENT: CCTelegramEvent = {
  type: 'info_notification' as EventType,
  title: 'Build Process Started',
  description: 'Starting build process for branch: feature/auth-system',
  source: 'github-actions',
  timestamp: BASE_TIMESTAMP,
  data: {
    branch: 'feature/auth-system',
    commit_hash: 'a1b2c3d4e5f6',
    build_number: 142
  }
};

/**
 * Valid error notification event
 */
export const VALID_ERROR_EVENT: CCTelegramEvent = {
  type: 'error_occurred' as EventType,
  title: 'Database Connection Failed',
  description: 'Unable to establish connection to primary database server',
  source: 'application-monitor',
  timestamp: BASE_TIMESTAMP,
  data: {
    error_code: 'DB_CONNECTION_TIMEOUT',
    error_message: 'Connection timeout after 30 seconds',
    server: 'db-primary-01',
    retry_count: 3
  }
};

/**
 * All valid event types for testing
 */
export const ALL_EVENT_TYPES: EventType[] = [
  'task_completion', 'task_started', 'task_failed', 'task_progress', 'task_cancelled',
  'code_generation', 'code_analysis', 'code_refactoring', 'code_review', 'code_testing', 'code_deployment',
  'build_completed', 'build_failed', 'test_suite_run', 'lint_check', 'type_check',
  'performance_alert', 'error_occurred', 'system_health',
  'approval_request', 'user_response',
  'info_notification', 'alert_notification', 'progress_update'
];

/**
 * Invalid events for negative testing
 */
export const INVALID_EVENTS = {
  MISSING_TITLE: {
    type: 'task_completion' as EventType,
    description: 'Event missing required title field',
    source: 'claude-code',
    timestamp: BASE_TIMESTAMP
  },
  
  MISSING_DESCRIPTION: {
    type: 'task_completion' as EventType,
    title: 'Valid Title',
    source: 'claude-code',
    timestamp: BASE_TIMESTAMP
  },
  
  INVALID_EVENT_TYPE: {
    type: 'invalid_event_type' as any,
    title: 'Valid Title',
    description: 'Valid description',
    source: 'claude-code',
    timestamp: BASE_TIMESTAMP
  },
  
  TITLE_TOO_LONG: {
    type: 'task_completion' as EventType,
    title: 'x'.repeat(201), // Exceeds 200 char limit
    description: 'Valid description',
    source: 'claude-code',
    timestamp: BASE_TIMESTAMP
  },
  
  DESCRIPTION_TOO_LONG: {
    type: 'task_completion' as EventType,
    title: 'Valid Title',
    description: 'x'.repeat(2001), // Exceeds 2000 char limit
    source: 'claude-code',
    timestamp: BASE_TIMESTAMP
  },
  
  INVALID_TASK_ID: {
    type: 'task_completion' as EventType,
    title: 'Valid Title',
    description: 'Valid description',
    task_id: 'not-a-valid-uuid',
    source: 'claude-code',
    timestamp: BASE_TIMESTAMP
  },
  
  INVALID_SOURCE_PATTERN: {
    type: 'task_completion' as EventType,
    title: 'Valid Title',
    description: 'Valid description',
    source: 'invalid source with spaces and @symbols',
    timestamp: BASE_TIMESTAMP
  }
};

/**
 * Event fixtures for different scenarios
 */
export const EVENT_SCENARIOS = {
  MINIMAL_VALID: {
    type: 'info_notification' as EventType,
    title: 'Minimal Event',
    description: 'Minimal valid event with required fields only'
  },
  
  MAXIMUM_VALID: {
    type: 'task_completion' as EventType,
    title: 'x'.repeat(200), // Maximum title length
    description: 'x'.repeat(2000), // Maximum description length
    task_id: VALID_TASK_ID,
    source: 'a'.repeat(100), // Maximum source length
    timestamp: BASE_TIMESTAMP,
    data: {
      complex_nested_data: {
        level1: {
          level2: {
            level3: 'Deep nesting test'
          }
        },
        array_data: [1, 2, 3, 'test'],
        boolean_data: true,
        number_data: 12345.67
      }
    }
  }
};
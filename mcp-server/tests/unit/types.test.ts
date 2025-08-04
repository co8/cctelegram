/**
 * Types Module Unit Tests
 * Tests for TypeScript interfaces and type definitions
 */

import { jest } from '@jest/globals';
import { 
  CCTelegramEvent, 
  EventType, 
  EventData, 
  BridgeStatus, 
  TelegramResponse, 
  EventTemplate 
} from '../../src/types.js';
import { EventFixtures } from '../fixtures/events.fixture.js';
import { ResponseFixtures } from '../fixtures/responses.fixture.js';
import { BridgeStatusFixtures } from '../fixtures/bridge-status.fixture.js';

describe('Types Module', () => {
  describe('CCTelegramEvent Interface', () => {
    it('should accept valid event structure', () => {
      const event: CCTelegramEvent = {
        type: 'task_completion',
        source: 'claude-code',
        timestamp: '2023-12-01T10:00:00.000Z',
        task_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Event',
        description: 'This is a test event',
        data: {
          status: 'completed',
          duration_ms: 5000
        }
      };

      expect(event.type).toBe('task_completion');
      expect(event.source).toBe('claude-code');
      expect(event.timestamp).toBeValidISO8601();
      expect(event.task_id).toBeValidUUID();
      expect(event.title).toBe('Test Event');
      expect(event.description).toBe('This is a test event');
      expect(event.data).toMatchObject({
        status: 'completed',
        duration_ms: 5000
      });
    });

    it('should accept all valid EventType values', () => {
      const validEventTypes: EventType[] = [
        // Task Management
        'task_completion', 'task_started', 'task_failed', 'task_progress', 'task_cancelled',
        // Code Operations
        'code_generation', 'code_analysis', 'code_refactoring', 'code_review', 'code_testing', 'code_deployment',
        // File System
        'file_created', 'file_modified', 'file_deleted', 'directory_created', 'directory_deleted',
        // Build & Development
        'build_started', 'build_completed', 'build_failed', 'test_suite_run', 'test_passed', 'test_failed', 'lint_check', 'type_check',
        // Git Operations
        'git_commit', 'git_push', 'git_merge', 'git_branch', 'git_tag', 'pull_request_created', 'pull_request_merged',
        // System Monitoring
        'system_health', 'performance_alert', 'security_alert', 'error_occurred', 'resource_usage',
        // User Interaction
        'approval_request', 'user_response', 'command_executed',
        // Notifications
        'progress_update', 'status_change', 'alert_notification', 'info_notification',
        // Integration
        'api_call', 'webhook_received', 'service_integration',
        // Custom
        'custom_event'
      ];

      validEventTypes.forEach(eventType => {
        const event: CCTelegramEvent = EventFixtures.createBasicEvent({ type: eventType });
        expect(event.type).toBe(eventType);
      });
    });

    it('should accept various data field combinations', () => {
      const eventWithAllData: CCTelegramEvent = {
        type: 'test_suite_run',
        source: 'test-runner',
        timestamp: new Date().toISOString(),
        task_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Suite Completed',
        description: 'All tests have been executed',
        data: {
          status: 'completed',
          results: 'All tests passed',
          duration_ms: 45000,
          files_affected: ['src/test1.ts', 'src/test2.ts'],
          memory_usage_mb: 128,
          cpu_usage_percent: 75.5,
          error_message: undefined,
          severity: 'low',
          build_target: 'test',
          test_count: 150,
          tests_passed: 148,
          tests_failed: 2,
          coverage_percentage: 92.5,
          current_value: 92.5,
          threshold: 90,
          hash: 'abc123def456',
          message: 'Test suite completed successfully',
          author: 'test-runner@example.com',
          files: ['test1.spec.ts', 'test2.spec.ts'],
          branch_name: 'feature/testing',
          url: 'https://github.com/user/repo/actions/run/123',
          endpoint: '/api/test/run',
          response_code: 200,
          response_time_ms: 250,
          custom_field: 'custom_value'
        }
      };

      expect(eventWithAllData.data.status).toBe('completed');
      expect(eventWithAllData.data.test_count).toBe(150);
      expect(eventWithAllData.data.coverage_percentage).toBe(92.5);
      expect(eventWithAllData.data.custom_field).toBe('custom_value');
    });
  });

  describe('EventData Interface', () => {
    it('should accept optional fields', () => {
      const minimalData: EventData = {};
      const fullData: EventData = {
        status: 'completed',
        results: 'Success',
        duration_ms: 1000,
        files_affected: ['file1.ts'],
        memory_usage_mb: 50,
        cpu_usage_percent: 25.5,
        error_message: 'No errors',
        severity: 'medium',
        build_target: 'production',
        test_count: 100,
        tests_passed: 95,
        tests_failed: 5,
        coverage_percentage: 85.5,
        current_value: 75,
        threshold: 80,
        hash: 'abc123',
        message: 'Task completed',
        author: 'user@example.com',
        files: ['file1.ts', 'file2.ts'],
        branch_name: 'main',
        url: 'https://example.com',
        endpoint: '/api/endpoint',
        response_code: 200,
        response_time_ms: 150
      };

      expect(minimalData).toBeDefined();
      expect(fullData.severity).toBe('medium');
      expect(fullData.files_affected).toHaveLength(1);
      expect(fullData.tests_passed).toBe(95);
    });

    it('should allow custom fields through index signature', () => {
      const dataWithCustomFields: EventData = {
        status: 'completed',
        custom_metric: 'custom_value',
        another_field: 123,
        nested_object: {
          key: 'value'
        }
      };

      expect(dataWithCustomFields.status).toBe('completed');
      expect(dataWithCustomFields.custom_metric).toBe('custom_value');
      expect(dataWithCustomFields.another_field).toBe(123);
      expect(dataWithCustomFields.nested_object).toEqual({ key: 'value' });
    });

    it('should accept valid severity levels', () => {
      const severityLevels: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical'];
      
      severityLevels.forEach(severity => {
        const data: EventData = { severity };
        expect(data.severity).toBe(severity);
      });
    });
  });

  describe('BridgeStatus Interface', () => {
    it('should accept valid bridge status structure', () => {
      const status: BridgeStatus = {
        running: true,
        health: 'healthy',
        metrics: {
          uptime_seconds: 3600,
          events_processed: 150,
          telegram_messages_sent: 145,
          error_count: 2,
          memory_usage_mb: 50,
          cpu_usage_percent: 15.5
        },
        last_event_time: '2023-12-01T10:00:00.000Z'
      };

      expect(status.running).toBe(true);
      expect(status.health).toBe('healthy');
      expect(status.metrics.uptime_seconds).toBe(3600);
      expect(status.last_event_time).toBeValidISO8601();
    });

    it('should accept all valid health states', () => {
      const healthStates: Array<'healthy' | 'degraded' | 'unhealthy'> = ['healthy', 'degraded', 'unhealthy'];
      
      healthStates.forEach(health => {
        const status: BridgeStatus = BridgeStatusFixtures.createHealthyStatus({ health });
        expect(status.health).toBe(health);
      });
    });

    it('should make last_event_time optional', () => {
      const statusWithoutLastEvent: BridgeStatus = {
        running: false,
        health: 'unhealthy',
        metrics: {
          uptime_seconds: 0,
          events_processed: 0,
          telegram_messages_sent: 0,
          error_count: 0,
          memory_usage_mb: 0,
          cpu_usage_percent: 0
        }
      };

      expect(statusWithoutLastEvent.last_event_time).toBeUndefined();
    });

    it('should validate metrics structure', () => {
      const status: BridgeStatus = BridgeStatusFixtures.createHealthyStatus();

      expect(status.metrics).toHaveProperty('uptime_seconds');
      expect(status.metrics).toHaveProperty('events_processed');
      expect(status.metrics).toHaveProperty('telegram_messages_sent');
      expect(status.metrics).toHaveProperty('error_count');
      expect(status.metrics).toHaveProperty('memory_usage_mb');
      expect(status.metrics).toHaveProperty('cpu_usage_percent');

      expect(typeof status.metrics.uptime_seconds).toBe('number');
      expect(typeof status.metrics.events_processed).toBe('number');
      expect(typeof status.metrics.telegram_messages_sent).toBe('number');
      expect(typeof status.metrics.error_count).toBe('number');
      expect(typeof status.metrics.memory_usage_mb).toBe('number');
      expect(typeof status.metrics.cpu_usage_percent).toBe('number');
    });
  });

  describe('TelegramResponse Interface', () => {
    it('should accept valid response structure', () => {
      const response: TelegramResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: 123456789,
        message: 'Test response message',
        timestamp: '2023-12-01T10:00:00.000Z'
      };

      expect(response.id).toBeValidUUID();
      expect(response.user_id).toBe(123456789);
      expect(response.message).toBe('Test response message');
      expect(response.timestamp).toBeValidISO8601();
    });

    it('should make optional fields optional', () => {
      const minimalResponse: TelegramResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: 123456789,
        message: 'Minimal response',
        timestamp: new Date().toISOString()
      };

      const fullResponse: TelegramResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        user_id: 123456789,
        message: 'Full response',
        timestamp: new Date().toISOString(),
        event_id: '456e7890-e89b-12d3-a456-426614174000',
        action: 'approve'
      };

      expect(minimalResponse.event_id).toBeUndefined();
      expect(minimalResponse.action).toBeUndefined();
      expect(fullResponse.event_id).toBeValidUUID();
      expect(fullResponse.action).toBe('approve');
    });

    it('should handle various user_id formats', () => {
      const responses: TelegramResponse[] = [
        ResponseFixtures.createBasicResponse({ user_id: 123456789 }),
        ResponseFixtures.createBasicResponse({ user_id: 987654321 }),
        ResponseFixtures.createBasicResponse({ user_id: 1 })
      ];

      responses.forEach(response => {
        expect(typeof response.user_id).toBe('number');
        expect(response.user_id).toBeGreaterThan(0);
      });
    });
  });

  describe('EventTemplate Interface', () => {
    it('should accept valid template structure', () => {
      const template: EventTemplate = {
        id: 'task-completion-template',
        name: 'Task Completion Template',
        description: 'Template for task completion events',
        event_type: 'task_completion',
        template: {
          type: 'task_completion',
          source: 'template',
          data: {
            status: 'completed'
          }
        }
      };

      expect(template.id).toBe('task-completion-template');
      expect(template.event_type).toBe('task_completion');
      expect(template.template.type).toBe('task_completion');
      expect(template.template.data?.status).toBe('completed');
    });

    it('should accept partial event as template', () => {
      const partialTemplate: EventTemplate = {
        id: 'approval-template',
        name: 'Approval Request Template',
        description: 'Template for approval requests',
        event_type: 'approval_request',
        template: {
          type: 'approval_request',
          data: {
            requires_response: true,
            timeout_minutes: 30
          }
        }
      };

      expect(partialTemplate.template.timestamp).toBeUndefined();
      expect(partialTemplate.template.task_id).toBeUndefined();
      expect(partialTemplate.template.title).toBeUndefined();
      expect(partialTemplate.template.description).toBeUndefined();
      expect(partialTemplate.template.data?.requires_response).toBe(true);
    });

    it('should maintain consistency between event_type and template.type', () => {
      const consistentTemplate: EventTemplate = {
        id: 'performance-alert-template',
        name: 'Performance Alert Template',
        description: 'Template for performance alerts',
        event_type: 'performance_alert',
        template: {
          type: 'performance_alert',
          source: 'monitoring',
          data: {
            severity: 'medium'
          }
        }
      };

      expect(consistentTemplate.event_type).toBe(consistentTemplate.template.type);
    });
  });

  describe('Type Compatibility', () => {
    it('should allow fixtures to match interfaces', () => {
      const event: CCTelegramEvent = EventFixtures.createTaskCompletionEvent();
      const response: TelegramResponse = ResponseFixtures.createApprovalResponse(true);
      const status: BridgeStatus = BridgeStatusFixtures.createHealthyStatus();

      expect(event.type).toBe('task_completion');
      expect(response.user_id).toBe(123456789);
      expect(status.running).toBe(true);
    });

    it('should handle complex event data structures', () => {
      const complexEvent: CCTelegramEvent = {
        type: 'test_suite_run',
        source: 'jest',
        timestamp: new Date().toISOString(),
        task_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Jest Test Suite',
        description: 'Complete test suite execution',
        data: {
          status: 'completed',
          test_count: 250,
          tests_passed: 245,
          tests_failed: 5,
          coverage_percentage: 89.5,
          duration_ms: 45000,
          files_affected: [
            'src/components/Button.test.tsx',
            'src/utils/helpers.test.ts',
            'src/services/api.test.ts'
          ],
          error_message: '5 tests failed with assertion errors',
          severity: 'medium',
          build_target: 'test',
          custom_test_metadata: {
            framework: 'jest',
            version: '29.7.0',
            parallel: true,
            workers: 4
          }
        }
      };

      expect(complexEvent.data.test_count).toBe(250);
      expect(complexEvent.data.files_affected).toHaveLength(3);
      expect(complexEvent.data.custom_test_metadata).toEqual({
        framework: 'jest',
        version: '29.7.0',
        parallel: true,
        workers: 4
      });
    });

    it('should handle edge cases in data types', () => {
      const edgeCaseEvent: CCTelegramEvent = {
        type: 'performance_alert',
        source: 'monitoring',
        timestamp: new Date().toISOString(),
        task_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Edge Case Performance Alert',
        description: 'Testing edge cases in performance metrics',
        data: {
          current_value: 0,
          threshold: 0,
          duration_ms: 0,
          memory_usage_mb: 0.001,
          cpu_usage_percent: 0.1,
          test_count: 0,
          tests_passed: 0,
          coverage_percentage: 100,
          files_affected: [],
          response_time_ms: 1
        }
      };

      expect(edgeCaseEvent.data.current_value).toBe(0);
      expect(edgeCaseEvent.data.memory_usage_mb).toBe(0.001);
      expect(edgeCaseEvent.data.files_affected).toEqual([]);
    });
  });

  describe('Type Guards and Validation', () => {
    it('should validate event type enum values', () => {
      const validTypes: EventType[] = [
        'task_completion',
        'code_generation',
        'performance_alert',
        'approval_request'
      ];

      validTypes.forEach(type => {
        const event: CCTelegramEvent = EventFixtures.createBasicEvent({ type });
        expect(event.type).toBe(type);
      });
    });

    it('should validate severity enum values', () => {
      const severityLevels: Array<'low' | 'medium' | 'high' | 'critical'> = 
        ['low', 'medium', 'high', 'critical'];

      severityLevels.forEach(severity => {
        const event: CCTelegramEvent = EventFixtures.createPerformanceAlertEvent({
          data: { severity }
        });
        expect(event.data.severity).toBe(severity);
      });
    });

    it('should validate health status enum values', () => {
      const healthStates: Array<'healthy' | 'degraded' | 'unhealthy'> = 
        ['healthy', 'degraded', 'unhealthy'];

      healthStates.forEach(health => {
        const status: BridgeStatus = BridgeStatusFixtures.createHealthyStatus({ health });
        expect(status.health).toBe(health);
      });
    });
  });
});
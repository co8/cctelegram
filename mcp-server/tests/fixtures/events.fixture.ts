/**
 * Event Fixtures
 * Sample data for testing CCTelegram events
 */

import { CCTelegramEvent, EventType, EventData } from '../../src/types.js';
import { v4 as uuidv4 } from 'uuid';

export class EventFixtures {
  static createBasicEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return {
      type: 'info_notification',
      source: 'claude-code',
      timestamp: new Date().toISOString(),
      task_id: uuidv4(),
      title: 'Test Event',
      description: 'This is a test event',
      data: {},
      ...overrides
    };
  }

  static createTaskCompletionEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'task_completion',
      title: 'Task Completed Successfully',
      description: 'The task has been completed without errors',
      data: {
        status: 'completed',
        duration_ms: 5000,
        files_affected: ['src/test.ts', 'src/utils.ts'],
        results: 'All tests passed successfully'
      },
      ...overrides
    });
  }

  static createPerformanceAlertEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'performance_alert',
      title: 'High Memory Usage',
      description: 'Memory usage has exceeded the threshold',
      data: {
        severity: 'high' as const,
        current_value: 512,
        threshold: 400,
        error_message: 'Memory usage is 512MB, which exceeds threshold of 400MB'
      },
      ...overrides
    });
  }

  static createApprovalRequestEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'approval_request',
      title: 'Deploy to Production',
      description: 'Approve deployment of version 1.2.0 to production',
      data: {
        approval_prompt: 'Approve deployment of version 1.2.0 to production',
        options: ['Approve', 'Deny'],
        requires_response: true,
        response_options: ['Approve', 'Deny'],
        timeout_minutes: 30
      },
      ...overrides
    });
  }

  static createCodeGenerationEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'code_generation',
      title: 'Code Generated',
      description: 'New TypeScript interfaces generated',
      data: {
        files_affected: ['src/types.ts', 'src/interfaces.ts'],
        files: ['src/types.ts', 'src/interfaces.ts'],
        status: 'completed'
      },
      ...overrides
    });
  }

  static createBuildCompletedEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'build_completed',
      title: 'Build Successful',
      description: 'Production build completed successfully',
      data: {
        status: 'completed',
        build_target: 'production',
        duration_ms: 45000
      },
      ...overrides
    });
  }

  static createErrorEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'error_occurred',
      title: 'Runtime Error',
      description: 'An error occurred during execution',
      data: {
        severity: 'high' as const,
        error_message: 'TypeError: Cannot read property of undefined',
        status: 'failed'
      },
      ...overrides
    });
  }

  static createSecurityAlertEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'security_alert',
      title: 'Security Vulnerability Detected',
      description: 'High severity vulnerability found in dependencies',
      data: {
        severity: 'critical' as const,
        error_message: 'CVE-2023-12345: Remote code execution vulnerability',
        status: 'requires_action'
      },
      ...overrides
    });
  }

  static createTestSuiteEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'test_suite_run',
      title: 'Test Suite Completed',
      description: 'Unit test suite execution finished',
      data: {
        status: 'completed',
        test_count: 156,
        tests_passed: 150,
        tests_failed: 6,
        coverage_percentage: 92.5,
        duration_ms: 12000
      },
      ...overrides
    });
  }

  static createGitCommitEvent(overrides: Partial<CCTelegramEvent> = {}): CCTelegramEvent {
    return this.createBasicEvent({
      type: 'git_commit',
      title: 'Code Committed',
      description: 'New commit pushed to repository',
      data: {
        hash: 'a1b2c3d4e5f6',
        message: 'feat: add comprehensive testing framework',
        author: 'developer@example.com',
        files: ['tests/setup.ts', 'jest.config.js'],
        branch_name: 'feature/testing-framework'
      },
      ...overrides
    });
  }

  // Batch event creation
  static createEventBatch(count: number, type?: EventType): CCTelegramEvent[] {
    const events: CCTelegramEvent[] = [];
    
    for (let i = 0; i < count; i++) {
      const eventType = type || this.getRandomEventType();
      events.push(this.createBasicEvent({
        type: eventType,
        title: `${eventType} Event ${i + 1}`,
        description: `Generated test event ${i + 1} of type ${eventType}`,
        task_id: uuidv4()
      }));
    }
    
    return events;
  }

  // Invalid/malicious events for security testing
  static createInvalidEvent(invalidField: string): any {
    const baseEvent = this.createBasicEvent();
    
    switch (invalidField) {
      case 'missing_type':
        delete (baseEvent as any).type;
        break;
      case 'invalid_type':
        (baseEvent as any).type = 'invalid_event_type';
        break;
      case 'xss_title':
        baseEvent.title = '<script>alert("xss")</script>';
        break;
      case 'oversized_description':
        baseEvent.description = 'A'.repeat(5000); // Exceeds 2000 char limit
        break;
      case 'path_traversal':
        baseEvent.data = { file_path: '../../../etc/passwd' };
        break;
      case 'sql_injection':
        baseEvent.title = "'; DROP TABLE events; --";
        break;
      case 'invalid_uuid':
        baseEvent.task_id = 'not-a-uuid';
        break;
      case 'invalid_timestamp':
        baseEvent.timestamp = 'not-a-timestamp';
        break;
      case 'malicious_source':
        baseEvent.source = '../../malicious/source';
        break;
    }
    
    return baseEvent;
  }

  private static getRandomEventType(): EventType {
    const eventTypes: EventType[] = [
      'task_completion', 'task_started', 'task_failed',
      'code_generation', 'code_analysis', 'code_review',
      'build_completed', 'build_failed', 'test_suite_run',
      'performance_alert', 'error_occurred', 'system_health',
      'approval_request', 'info_notification', 'alert_notification'
    ];
    
    return eventTypes[Math.floor(Math.random() * eventTypes.length)];
  }
}

// Event data builders for specific scenarios
export class EventDataBuilder {
  private data: EventData = {};

  static new(): EventDataBuilder {
    return new EventDataBuilder();
  }

  withStatus(status: string): EventDataBuilder {
    this.data.status = status;
    return this;
  }

  withDuration(ms: number): EventDataBuilder {
    this.data.duration_ms = ms;
    return this;
  }

  withFiles(files: string[]): EventDataBuilder {
    this.data.files_affected = files;
    return this;
  }

  withResults(results: string): EventDataBuilder {
    this.data.results = results;
    return this;
  }

  withSeverity(severity: 'low' | 'medium' | 'high' | 'critical'): EventDataBuilder {
    this.data.severity = severity;
    return this;
  }

  withError(message: string): EventDataBuilder {
    this.data.error_message = message;
    return this;
  }

  withPerformanceMetrics(current: number, threshold: number): EventDataBuilder {
    this.data.current_value = current;
    this.data.threshold = threshold;
    return this;
  }

  withTestResults(total: number, passed: number, failed: number, coverage?: number): EventDataBuilder {
    this.data.test_count = total;
    this.data.tests_passed = passed;
    this.data.tests_failed = failed;
    if (coverage !== undefined) {
      this.data.coverage_percentage = coverage;
    }
    return this;
  }

  withApprovalOptions(options: string[]): EventDataBuilder {
    this.data.options = options;
    this.data.response_options = options;
    this.data.requires_response = true;
    return this;
  }

  build(): EventData {
    return { ...this.data };
  }
}
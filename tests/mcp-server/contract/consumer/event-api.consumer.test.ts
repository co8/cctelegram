/**
 * Event API Consumer Contract Tests
 * Specialized tests for event-related API interactions
 */

import { Pact, Matchers } from '@pact-foundation/pact';
import { consumerConfig } from '../config/pact.config.js';
import { ContractFixtures, ConsumerTestHelper } from '../utils/contract-helpers.js';
import { ContractSpecification } from '../shared/contracts.js';
import axios from 'axios';

const { like, string, integer, boolean, uuid, iso8601DateTime, eachLike, term } = Matchers;

describe('Event API Consumer Contracts', () => {
  let pact: Pact;
  let consumerHelper: ConsumerTestHelper;

  beforeAll(async () => {
    consumerHelper = new ConsumerTestHelper({
      consumer: 'cctelegram-mcp-server-events',
      provider: 'cctelegram-bridge-events',
      port: 8991 // Different port to avoid conflicts
    });
    pact = consumerHelper.getPact();
    await consumerHelper.setup();
  });

  afterEach(async () => {
    await consumerHelper.verify();
  });

  afterAll(async () => {
    await consumerHelper.finalize();
  });

  describe('Event Type Validation Contracts', () => {
    const eventTypes = [
      'task_completion',
      'task_started', 
      'task_failed',
      'task_progress',
      'task_cancelled',
      'code_generation',
      'code_analysis',
      'code_refactoring',
      'code_review',
      'code_testing',
      'code_deployment',
      'build_completed',
      'build_failed',
      'test_suite_run',
      'performance_alert',
      'error_occurred',
      'approval_request',
      'info_notification'
    ];

    eventTypes.forEach(eventType => {
      it(`should accept ${eventType} events`, async () => {
        const eventRequest = ContractFixtures.createEventFixture({
          type: eventType as any,
          title: `${eventType} Event`,
          description: `Testing ${eventType} event submission`,
          data: getEventTypeSpecificData(eventType)
        });

        pact
          .given('bridge is running')
          .uponReceiving(`a valid ${eventType} event`)
          .withRequest({
            method: 'POST',
            path: '/api/events',
            headers: {
              'Content-Type': 'application/json',
              'X-Event-Type': eventType
            },
            body: eventRequest
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.events.eventSubmissionResponse
          });

        const response = await axios.post(
          `${pact.mockService.baseUrl}/api/events`,
          eventRequest,
          { 
            headers: { 
              'Content-Type': 'application/json',
              'X-Event-Type': eventType
            } 
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.event_id).toBeDefined();
      });
    });

    function getEventTypeSpecificData(eventType: string): any {
      switch (eventType) {
        case 'task_completion':
          return {
            status: 'completed',
            duration_ms: 5000,
            files_affected: ['src/index.ts'],
            results: 'Task completed successfully'
          };
        
        case 'task_failed':
          return {
            status: 'failed',
            error_message: 'Task failed due to validation error',
            exit_code: 1,
            logs: 'Error logs here'
          };

        case 'performance_alert':
          return {
            metric: 'cpu_usage_percent',
            current_value: 85.7,
            threshold: 80.0,
            severity: 'high',
            duration_ms: 300000
          };

        case 'build_completed':
          return {
            build_id: 'build-001',
            duration_ms: 45000,
            artifacts: ['dist/app.js', 'dist/styles.css'],
            exit_code: 0,
            branch: 'main'
          };

        case 'approval_request':
          return {
            requires_response: true,
            response_options: ['Approve', 'Deny', 'Review'],
            timeout_minutes: 30,
            priority: 'high'
          };

        default:
          return {
            status: 'success',
            message: `${eventType} event processed`
          };
      }
    }
  });

  describe('Event Data Validation Contracts', () => {
    it('should validate event size limits', async () => {
      const largeEvent = ContractFixtures.createEventFixture({
        title: 'x'.repeat(250), // Exceeds 200 char limit
        description: 'Valid description'
      });

      pact
        .given('bridge is running')
        .uponReceiving('an event with title exceeding size limit')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json'
          },
          body: largeEvent
        })
        .willRespondWith({
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            success: boolean(false),
            error: like('Validation failed'),
            details: like({
              field: 'title',
              message: 'Title exceeds maximum length of 200 characters',
              max_length: 200,
              actual_length: 250
            })
          }
        });

      try {
        await axios.post(
          `${pact.mockService.baseUrl}/api/events`,
          largeEvent,
          { headers: { 'Content-Type': 'application/json' } }
        );
        fail('Expected validation error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.success).toBe(false);
        expect(error.response.data.details.field).toBe('title');
      }
    });

    it('should validate event data structure complexity', async () => {
      const complexEvent = ContractFixtures.createEventFixture({
        data: {
          // Deeply nested object to test complexity limits
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: 'Too deep'
                }
              }
            }
          },
          large_array: new Array(1000).fill('item'), // Large array
          many_properties: Object.fromEntries(
            new Array(100).fill(0).map((_, i) => [`prop${i}`, `value${i}`])
          )
        }
      });

      pact
        .given('bridge is running')
        .uponReceiving('an event with complex data structure')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json'
          },
          body: complexEvent
        })
        .willRespondWith({
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            success: boolean(false),
            error: like('Event data too complex'),
            details: like({
              reason: 'Data structure exceeds complexity limits',
              max_properties: 20,
              max_array_size: 50,
              max_nesting_depth: 3
            })
          }
        });

      try {
        await axios.post(
          `${pact.mockService.baseUrl}/api/events`,
          complexEvent,
          { headers: { 'Content-Type': 'application/json' } }
        );
        fail('Expected complexity validation error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.success).toBe(false);
      }
    });

    it('should validate special characters in event fields', async () => {
      const eventWithSpecialChars = ContractFixtures.createEventFixture({
        title: 'Event with <script>alert("xss")</script>',
        description: 'Description with ${injection} attempt',
        source: 'source-with-@#$%^&*()[]{}|\\:";\'<>?,./',
        data: {
          malicious_field: '<img src="x" onerror="alert(1)">'
        }
      });

      pact
        .given('bridge is running')
        .uponReceiving('an event with potentially malicious content')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json'
          },
          body: eventWithSpecialChars
        })
        .willRespondWith({
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            success: boolean(false),
            error: like('Security validation failed'),
            details: like({
              field: 'title',
              message: 'Field contains potentially dangerous content',
              sanitized_value: 'Event with alert("xss")'
            })
          }
        });

      try {
        await axios.post(
          `${pact.mockService.baseUrl}/api/events`,
          eventWithSpecialChars,
          { headers: { 'Content-Type': 'application/json' } }
        );
        fail('Expected security validation error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.success).toBe(false);
      }
    });
  });

  describe('Event Idempotency Contracts', () => {
    it('should handle duplicate event submissions', async () => {
      const eventRequest = ContractFixtures.createEventFixture({
        task_id: 'duplicate-test-task-001',
        title: 'Duplicate Event Test'
      });

      // First submission
      pact
        .given('bridge is running')
        .uponReceiving('the first submission of an event')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': 'duplicate-test-key-001'
          },
          body: eventRequest
        })
        .willRespondWith({
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            ...ContractSpecification.events.eventSubmissionResponse,
            event_id: uuid('event-duplicate-001'),
            duplicate: boolean(false)
          }
        });

      // Duplicate submission
      pact
        .given('bridge has already processed this event')
        .uponReceiving('a duplicate submission of the same event')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': 'duplicate-test-key-001'
          },
          body: eventRequest
        })
        .willRespondWith({
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            ...ContractSpecification.events.eventSubmissionResponse,
            event_id: uuid('event-duplicate-001'), // Same ID as first submission
            duplicate: boolean(true),
            message: like('Event already processed - returning original response')
          }
        });

      // First submission
      const response1 = await axios.post(
        `${pact.mockService.baseUrl}/api/events`,
        eventRequest,
        { 
          headers: { 
            'Content-Type': 'application/json',
            'X-Idempotency-Key': 'duplicate-test-key-001'
          } 
        }
      );

      expect(response1.status).toBe(200);
      expect(response1.data.success).toBe(true);
      expect(response1.data.duplicate).toBe(false);
      const originalEventId = response1.data.event_id;

      // Duplicate submission
      const response2 = await axios.post(
        `${pact.mockService.baseUrl}/api/events`,
        eventRequest,
        { 
          headers: { 
            'Content-Type': 'application/json',
            'X-Idempotency-Key': 'duplicate-test-key-001'
          } 
        }
      );

      expect(response2.status).toBe(200);
      expect(response2.data.success).toBe(true);
      expect(response2.data.duplicate).toBe(true);
      expect(response2.data.event_id).toBe(originalEventId);
    });
  });

  describe('Event Priority and Routing Contracts', () => {
    const priorityLevels = ['low', 'medium', 'high', 'critical'];

    priorityLevels.forEach(priority => {
      it(`should handle ${priority} priority events`, async () => {
        const priorityEvent = ContractFixtures.createEventFixture({
          title: `${priority.toUpperCase()} Priority Event`,
          description: `Testing ${priority} priority event processing`,
          data: {
            priority: priority,
            urgent: priority === 'critical'
          }
        });

        pact
          .given(`bridge accepts ${priority} priority events`)
          .uponReceiving(`a ${priority} priority event`)
          .withRequest({
            method: 'POST',
            path: '/api/events',
            headers: {
              'Content-Type': 'application/json',
              'X-Event-Priority': priority
            },
            body: priorityEvent
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: {
              ...ContractSpecification.events.eventSubmissionResponse,
              priority: like(priority),
              processing_time_ms: priority === 'critical' ? integer(100) : integer(500),
              queue_position: priority === 'critical' ? integer(1) : integer(5)
            }
          });

        const response = await axios.post(
          `${pact.mockService.baseUrl}/api/events`,
          priorityEvent,
          { 
            headers: { 
              'Content-Type': 'application/json',
              'X-Event-Priority': priority
            } 
          }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.priority).toBe(priority);
      });
    });
  });

  describe('Event Metadata and Tracing Contracts', () => {
    it('should handle events with tracing headers', async () => {
      const tracingEvent = ContractFixtures.createEventFixture({
        title: 'Traced Event',
        description: 'Event with distributed tracing information'
      });

      pact
        .given('bridge supports distributed tracing')
        .uponReceiving('an event with tracing headers')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json',
            'X-Trace-Id': term({
              matcher: '^[a-f0-9]{32}$',
              generate: 'abcdef1234567890abcdef1234567890'
            }),
            'X-Span-Id': term({
              matcher: '^[a-f0-9]{16}$',
              generate: 'abcdef1234567890'
            }),
            'X-Request-Id': uuid('req-trace-001'),
            'X-Correlation-Id': uuid('corr-trace-001')
          },
          body: tracingEvent
        })
        .willRespondWith({
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Trace-Id': 'abcdef1234567890abcdef1234567890',
            'X-Span-Id': 'abcdef1234567890',
            'X-Request-Id': uuid('req-trace-001'),
            'X-Correlation-Id': uuid('corr-trace-001')
          },
          body: {
            ...ContractSpecification.events.eventSubmissionResponse,
            trace_id: like('abcdef1234567890abcdef1234567890'),
            span_id: like('abcdef1234567890'),
            request_id: uuid('req-trace-001')
          }
        });

      const response = await axios.post(
        `${pact.mockService.baseUrl}/api/events`,
        tracingEvent,
        { 
          headers: { 
            'Content-Type': 'application/json',
            'X-Trace-Id': 'abcdef1234567890abcdef1234567890',
            'X-Span-Id': 'abcdef1234567890',
            'X-Request-Id': 'req-trace-001',
            'X-Correlation-Id': 'corr-trace-001'
          } 
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.trace_id).toBe('abcdef1234567890abcdef1234567890');
      expect(response.data.request_id).toBe('req-trace-001');
    });

    it('should generate tracing IDs when not provided', async () => {
      const nonTracingEvent = ContractFixtures.createEventFixture({
        title: 'Non-Traced Event',
        description: 'Event without tracing headers'
      });

      pact
        .given('bridge generates tracing IDs when missing')
        .uponReceiving('an event without tracing headers')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json'
          },
          body: nonTracingEvent
        })
        .willRespondWith({
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Trace-Id': term({
              matcher: '^[a-f0-9]{32}$',
              generate: '1234567890abcdef1234567890abcdef'
            }),
            'X-Request-Id': uuid('req-generated-001')
          },
          body: {
            ...ContractSpecification.events.eventSubmissionResponse,
            trace_id: term({
              matcher: '^[a-f0-9]{32}$',
              generate: '1234567890abcdef1234567890abcdef'
            }),
            request_id: uuid('req-generated-001'),
            generated_trace: boolean(true)
          }
        });

      const response = await axios.post(
        `${pact.mockService.baseUrl}/api/events`,
        nonTracingEvent,
        { headers: { 'Content-Type': 'application/json' } }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.trace_id).toMatch(/^[a-f0-9]{32}$/);
      expect(response.data.generated_trace).toBe(true);
    });
  });
});
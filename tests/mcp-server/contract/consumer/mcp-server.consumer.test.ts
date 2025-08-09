/**
 * Consumer Contract Tests for MCP Server
 * Tests MCP Server's expectations of Bridge API interactions
 */

import { Pact, Matchers } from '@pact-foundation/pact';
import { consumerConfig } from '../config/pact.config.js';
import { ContractFixtures, ConsumerTestHelper } from '../utils/contract-helpers.js';
import { ContractSpecification } from '../shared/contracts.js';
import axios from 'axios';
import { CCTelegramEvent, TelegramResponse, BridgeStatus } from '../../../src/types.js';

const { like, string, integer, boolean, uuid, iso8601DateTime, eachLike } = Matchers;

describe('MCP Server as Consumer - Bridge API Contracts', () => {
  let pact: Pact;
  let consumerHelper: ConsumerTestHelper;

  beforeAll(async () => {
    consumerHelper = new ConsumerTestHelper();
    pact = consumerHelper.getPact();
    await consumerHelper.setup();
  });

  afterEach(async () => {
    await consumerHelper.verify();
  });

  afterAll(async () => {
    await consumerHelper.finalize();
  });

  describe('Event Submission API', () => {
    describe('POST /api/events - Send Event to Bridge', () => {
      it('should successfully send a valid task completion event', async () => {
        // Given: Bridge is running and can accept events
        const eventRequest = ContractFixtures.createEventFixture({
          type: 'task_completion',
          title: 'Task completed successfully',
          description: 'The task has been completed with all requirements met',
          data: {
            status: 'completed',
            duration_ms: 5000,
            files_affected: ['src/index.ts', 'tests/unit.test.ts'],
            results: 'All tests passed and code was deployed'
          }
        });

        const expectedResponse = ContractSpecification.events.eventSubmissionResponse;

        pact
          .given('bridge is running')
          .uponReceiving('a valid task completion event')
          .withRequest({
            method: 'POST',
            path: '/api/events',
            headers: {
              'Content-Type': 'application/json'
            },
            body: eventRequest
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: expectedResponse
          });

        // When: MCP Server sends event to bridge
        const response = await axios.post(`${pact.mockService.baseUrl}/api/events`, eventRequest, {
          headers: { 'Content-Type': 'application/json' }
        });

        // Then: Response should match contract
        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.event_id).toBeDefined();
        expect(response.data.file_path).toBeDefined();
        expect(response.data.message).toBeDefined();
      });

      it('should handle performance alert events', async () => {
        const performanceAlert = ContractFixtures.createEventFixture({
          type: 'performance_alert',
          title: 'High CPU Usage Detected',
          description: 'CPU usage has exceeded threshold',
          data: {
            current_value: 85.7,
            threshold: 80.0,
            severity: 'high',
            metric: 'cpu_usage_percent'
          }
        });

        pact
          .given('bridge is running')
          .uponReceiving('a performance alert event')
          .withRequest({
            method: 'POST',
            path: '/api/events',
            headers: {
              'Content-Type': 'application/json'
            },
            body: performanceAlert
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
          performanceAlert,
          { headers: { 'Content-Type': 'application/json' } }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      });

      it('should handle approval request events', async () => {
        const approvalRequest = ContractFixtures.createEventFixture({
          type: 'approval_request',
          title: 'Deploy to Production',
          description: 'Ready to deploy version 1.5.0 to production?',
          data: {
            requires_response: true,
            response_options: ['Deploy', 'Cancel', 'Review'],
            timeout_minutes: 30,
            deployment_target: 'production',
            version: '1.5.0'
          }
        });

        pact
          .given('bridge is running')
          .uponReceiving('an approval request event')
          .withRequest({
            method: 'POST',
            path: '/api/events',
            headers: {
              'Content-Type': 'application/json'
            },
            body: approvalRequest
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
          approvalRequest,
          { headers: { 'Content-Type': 'application/json' } }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
      });

      it('should handle batch event submissions', async () => {
        const batchRequest = {
          events: [
            ContractFixtures.createEventFixture({ type: 'info_notification', title: 'Event 1' }),
            ContractFixtures.createEventFixture({ type: 'info_notification', title: 'Event 2' }),
            ContractFixtures.createEventFixture({ type: 'task_completion', title: 'Task Done' })
          ]
        };

        pact
          .given('bridge is running')
          .uponReceiving('a batch event submission')
          .withRequest({
            method: 'POST',
            path: '/api/events/batch',
            headers: {
              'Content-Type': 'application/json'
            },
            body: batchRequest
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.events.batchEventSubmissionResponse
          });

        const response = await axios.post(
          `${pact.mockService.baseUrl}/api/events/batch`,
          batchRequest,
          { headers: { 'Content-Type': 'application/json' } }
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.total_events).toBe(3);
        expect(response.data.successful_events).toBeGreaterThanOrEqual(0);
        expect(response.data.failed_events).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(response.data.event_ids)).toBe(true);
      });

      it('should handle validation errors for invalid events', async () => {
        const invalidEvent = {
          // Missing required 'type' field
          title: 'Invalid Event',
          description: 'This event is missing required fields',
          source: 'test'
        };

        pact
          .given('bridge is running')
          .uponReceiving('an invalid event with validation errors')
          .withRequest({
            method: 'POST',
            path: '/api/events',
            headers: {
              'Content-Type': 'application/json'
            },
            body: invalidEvent
          })
          .willRespondWith({
            status: 400,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.events.eventValidationErrorResponse
          });

        try {
          await axios.post(
            `${pact.mockService.baseUrl}/api/events`,
            invalidEvent,
            { headers: { 'Content-Type': 'application/json' } }
          );
          fail('Expected request to fail with validation error');
        } catch (error: any) {
          expect(error.response.status).toBe(400);
          expect(error.response.data.success).toBe(false);
          expect(error.response.data.error).toBeDefined();
          expect(error.response.data.details).toBeDefined();
        }
      });
    });
  });

  describe('Health Check API', () => {
    describe('GET /health - Bridge Health Status', () => {
      it('should return healthy status when bridge is healthy', async () => {
        pact
          .given('bridge is healthy')
          .uponReceiving('a health check request')
          .withRequest({
            method: 'GET',
            path: '/health'
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.health.healthyResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/health`);

        expect(response.status).toBe(200);
        expect(response.data.running).toBe(true);
        expect(response.data.health).toBe('healthy');
        expect(response.data.metrics).toBeDefined();
        expect(response.data.metrics.uptime_seconds).toBeGreaterThan(0);
        expect(response.data.metrics.events_processed).toBeGreaterThanOrEqual(0);
        expect(response.data.version).toBeDefined();
      });

      it('should return unhealthy status when bridge is unhealthy', async () => {
        pact
          .given('bridge is unhealthy')
          .uponReceiving('a health check request for unhealthy bridge')
          .withRequest({
            method: 'GET',
            path: '/health'
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.health.unhealthyResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/health`);

        expect(response.status).toBe(200);
        expect(response.data.running).toBe(false);
        expect(response.data.health).toBe('unhealthy');
        expect(response.data.error).toBeDefined();
      });

      it('should return degraded status when bridge has warnings', async () => {
        pact
          .given('bridge is running with warnings')
          .uponReceiving('a health check request for degraded bridge')
          .withRequest({
            method: 'GET',
            path: '/health'
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.health.degradedResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/health`);

        expect(response.status).toBe(200);
        expect(response.data.running).toBe(true);
        expect(response.data.health).toBe('degraded');
        expect(Array.isArray(response.data.warnings)).toBe(true);
      });
    });
  });

  describe('Response Management API', () => {
    describe('GET /api/responses - Get Telegram Responses', () => {
      it('should return list of telegram responses', async () => {
        pact
          .given('telegram responses exist')
          .uponReceiving('a request for telegram responses')
          .withRequest({
            method: 'GET',
            path: '/api/responses',
            query: {
              limit: '10',
              since_minutes: '60'
            }
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.responses.responsesListResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/api/responses`, {
          params: { limit: 10, since_minutes: 60 }
        });

        expect(response.status).toBe(200);
        expect(response.data.count).toBeGreaterThanOrEqual(0);
        expect(response.data.total).toBeGreaterThanOrEqual(response.data.count);
        expect(Array.isArray(response.data.responses)).toBe(true);
      });

      it('should return empty list when no responses exist', async () => {
        pact
          .given('no telegram responses')
          .uponReceiving('a request for responses when none exist')
          .withRequest({
            method: 'GET',
            path: '/api/responses',
            query: {
              limit: '10'
            }
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.responses.emptyResponsesResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/api/responses`, {
          params: { limit: 10 }
        });

        expect(response.status).toBe(200);
        expect(response.data.count).toBe(0);
        expect(response.data.total).toBe(0);
        expect(response.data.responses).toEqual([]);
      });
    });

    describe('DELETE /api/responses - Clear Old Responses', () => {
      it('should clear old response files', async () => {
        pact
          .given('telegram responses exist')
          .uponReceiving('a request to clear old responses')
          .withRequest({
            method: 'DELETE',
            path: '/api/responses',
            query: {
              older_than_hours: '24'
            }
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.responses.clearResponsesResponse
          });

        const response = await axios.delete(`${pact.mockService.baseUrl}/api/responses`, {
          params: { older_than_hours: 24 }
        });

        expect(response.status).toBe(200);
        expect(response.data.deleted_count).toBeGreaterThanOrEqual(0);
        expect(response.data.message).toBeDefined();
        expect(response.data.summary).toBeDefined();
      });
    });

    describe('POST /api/responses/process - Process Pending Responses', () => {
      it('should process pending approval responses', async () => {
        pact
          .given('telegram responses exist')
          .uponReceiving('a request to process pending responses')
          .withRequest({
            method: 'POST',
            path: '/api/responses/process',
            headers: {
              'Content-Type': 'application/json'
            },
            body: {
              since_minutes: 10
            }
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.responses.processPendingResponse
          });

        const response = await axios.post(
          `${pact.mockService.baseUrl}/api/responses/process`,
          { since_minutes: 10 },
          { headers: { 'Content-Type': 'application/json' } }
        );

        expect(response.status).toBe(200);
        expect(response.data.summary).toBeDefined();
        expect(response.data.summary.total_recent_responses).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(response.data.actionable_responses)).toBe(true);
        expect(Array.isArray(response.data.recommendations)).toBe(true);
      });
    });
  });

  describe('Bridge Management API', () => {
    describe('POST /api/bridge/start - Start Bridge', () => {
      it('should start bridge process successfully', async () => {
        pact
          .given('bridge process is stopped')
          .uponReceiving('a request to start the bridge')
          .withRequest({
            method: 'POST',
            path: '/api/bridge/start'
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.bridge.startBridgeSuccessResponse
          });

        const response = await axios.post(`${pact.mockService.baseUrl}/api/bridge/start`);

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.message).toBeDefined();
        expect(response.data.pid).toBeDefined();
        expect(response.data.startup_time_ms).toBeGreaterThan(0);
        expect(response.data.configuration).toBeDefined();
      });

      it('should handle bridge start failures', async () => {
        pact
          .given('bridge configuration is invalid')
          .uponReceiving('a request to start bridge with invalid config')
          .withRequest({
            method: 'POST',
            path: '/api/bridge/start'
          })
          .willRespondWith({
            status: 500,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.bridge.startBridgeFailureResponse
          });

        try {
          await axios.post(`${pact.mockService.baseUrl}/api/bridge/start`);
          fail('Expected request to fail');
        } catch (error: any) {
          expect(error.response.status).toBe(500);
          expect(error.response.data.success).toBe(false);
          expect(error.response.data.error_code).toBeDefined();
          expect(error.response.data.details).toBeDefined();
        }
      });
    });

    describe('POST /api/bridge/stop - Stop Bridge', () => {
      it('should stop bridge process successfully', async () => {
        pact
          .given('bridge process is running')
          .uponReceiving('a request to stop the bridge')
          .withRequest({
            method: 'POST',
            path: '/api/bridge/stop'
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.bridge.stopBridgeResponse
          });

        const response = await axios.post(`${pact.mockService.baseUrl}/api/bridge/stop`);

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.message).toBeDefined();
        expect(response.data.processes_terminated).toBeGreaterThanOrEqual(0);
        expect(response.data.cleanup_summary).toBeDefined();
      });
    });

    describe('GET /api/bridge/status - Bridge Status', () => {
      it('should return bridge running status', async () => {
        pact
          .given('bridge process is running')
          .uponReceiving('a request for bridge status')
          .withRequest({
            method: 'GET',
            path: '/api/bridge/status'
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.bridge.bridgeRunningResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/api/bridge/status`);

        expect(response.status).toBe(200);
        expect(response.data.running).toBe(true);
        expect(response.data.process_info).toBeDefined();
        expect(response.data.process_info.pid).toBeDefined();
      });

      it('should return bridge stopped status', async () => {
        pact
          .given('bridge process is stopped')
          .uponReceiving('a request for bridge status when stopped')
          .withRequest({
            method: 'GET',
            path: '/api/bridge/status'
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.bridge.bridgeStoppedResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/api/bridge/status`);

        expect(response.status).toBe(200);
        expect(response.data.running).toBe(false);
        expect(response.data.message).toBeDefined();
        expect(response.data.reason).toBeDefined();
      });
    });
  });

  describe('Task Management API', () => {
    describe('GET /api/tasks/status - Get Task Status', () => {
      it('should return task status from both systems', async () => {
        pact
          .given('task status data exists')
          .uponReceiving('a request for task status')
          .withRequest({
            method: 'GET',
            path: '/api/tasks/status',
            query: {
              project_root: '/path/to/project',
              task_system: 'both',
              summary_only: 'false'
            }
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.tasks.taskStatusResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/api/tasks/status`, {
          params: {
            project_root: '/path/to/project',
            task_system: 'both',
            summary_only: false
          }
        });

        expect(response.status).toBe(200);
        expect(response.data.claude_code_tasks).toBeDefined();
        expect(response.data.taskmaster_tasks).toBeDefined();
        expect(response.data.combined_summary).toBeDefined();
        expect(response.data.combined_summary.grand_total).toBeGreaterThanOrEqual(0);
      });

      it('should handle unavailable task systems', async () => {
        pact
          .given('no task systems available')
          .uponReceiving('a request for task status when unavailable')
          .withRequest({
            method: 'GET',
            path: '/api/tasks/status',
            query: {
              task_system: 'both'
            }
          })
          .willRespondWith({
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            },
            body: ContractSpecification.tasks.taskStatusUnavailableResponse
          });

        const response = await axios.get(`${pact.mockService.baseUrl}/api/tasks/status`, {
          params: { task_system: 'both' }
        });

        expect(response.status).toBe(200);
        expect(response.data.claude_code_tasks.available).toBe(false);
        expect(response.data.taskmaster_tasks.available).toBe(false);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors', async () => {
      pact
        .given('bridge requires authentication')
        .uponReceiving('a request without authentication')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json'
          },
          body: ContractFixtures.createEventFixture()
        })
        .willRespondWith({
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          },
          body: ContractSpecification.errors.authenticationError
        });

      try {
        await axios.post(`${pact.mockService.baseUrl}/api/events`, 
          ContractFixtures.createEventFixture(),
          { headers: { 'Content-Type': 'application/json' } }
        );
        fail('Expected authentication error');
      } catch (error: any) {
        expect(error.response.status).toBe(401);
        expect(error.response.data.error).toBe(true);
        expect(error.response.data.code).toBe('AUTHENTICATION_ERROR');
      }
    });

    it('should handle rate limiting', async () => {
      pact
        .given('bridge rate limit is exceeded')
        .uponReceiving('a request when rate limited')
        .withRequest({
          method: 'POST',
          path: '/api/events',
          headers: {
            'Content-Type': 'application/json'
          },
          body: ContractFixtures.createEventFixture()
        })
        .willRespondWith({
          status: 429,
          headers: {
            'Content-Type': 'application/json'
          },
          body: ContractSpecification.errors.rateLimitError
        });

      try {
        await axios.post(`${pact.mockService.baseUrl}/api/events`,
          ContractFixtures.createEventFixture(),
          { headers: { 'Content-Type': 'application/json' } }
        );
        fail('Expected rate limit error');
      } catch (error: any) {
        expect(error.response.status).toBe(429);
        expect(error.response.data.error).toBe(true);
        expect(error.response.data.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.response.data.retry_after_seconds).toBeDefined();
      }
    });

    it('should handle service unavailable errors', async () => {
      pact
        .given('bridge is under maintenance')
        .uponReceiving('a request during maintenance')
        .withRequest({
          method: 'GET',
          path: '/health'
        })
        .willRespondWith({
          status: 503,
          headers: {
            'Content-Type': 'application/json'
          },
          body: ContractSpecification.errors.serviceUnavailableError
        });

      try {
        await axios.get(`${pact.mockService.baseUrl}/health`);
        fail('Expected service unavailable error');
      } catch (error: any) {
        expect(error.response.status).toBe(503);
        expect(error.response.data.error).toBe(true);
        expect(error.response.data.code).toBe('SERVICE_UNAVAILABLE');
      }
    });
  });
});
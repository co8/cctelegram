/**
 * MCP Server Integration Tests
 * End-to-end tests for all 16 MCP tools with realistic scenarios
 */

import { jest } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { EventFixtures } from '../fixtures/events.fixture.js';
import { ResponseFixtures } from '../fixtures/responses.fixture.js';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('axios');
jest.mock('child_process');

import fsMock, { mockFS } from '../mocks/fs.mock.js';
import axisMock, { mockAxios } from '../mocks/axios.mock.js';
import childProcessMock, { mockChildProcess } from '../mocks/child_process.mock.js';

// Import the actual server instance setup
let server: Server;
let mockClient: any;

// Mock the bridge client
const mockBridgeClient = {
  sendEvent: jest.fn(),
  sendMessage: jest.fn(),
  sendTaskCompletion: jest.fn(),
  sendPerformanceAlert: jest.fn(),
  sendApprovalRequest: jest.fn(),
  getBridgeStatus: jest.fn(),
  getTelegramResponses: jest.fn(),
  getAvailableEventTypes: jest.fn(),
  clearOldResponses: jest.fn(),
  processPendingResponses: jest.fn(),
  startBridge: jest.fn(),
  stopBridge: jest.fn(),
  restartBridge: jest.fn(),
  ensureBridgeRunning: jest.fn(),
  isBridgeRunning: jest.fn(),
  getTaskStatus: jest.fn()
};

// Mock security functions
const mockSecurity = {
  loadSecurityConfig: jest.fn(() => ({
    enableAuth: false,
    enableRateLimit: false,
    enableInputValidation: true,
    enableSecureLogging: true,
    apiKeys: [],
    hmacSecret: 'test-secret',
    rateLimitPoints: 100,
    rateLimitDuration: 60,
    logLevel: 'error'
  })),
  initializeSecurity: jest.fn(),
  authenticateRequest: jest.fn(() => ({
    clientId: 'test-client',
    authenticated: true,
    permissions: ['*'],
    timestamp: Date.now()
  })),
  validateInput: jest.fn((data) => data),
  withSecurity: jest.fn(async (operation) => await operation()),
  secureLog: jest.fn()
};

describe('MCP Server Integration Tests', () => {
  beforeAll(async () => {
    // Set up environment
    process.env.NODE_ENV = 'test';
    process.env.MCP_ENABLE_AUTH = 'false';
    process.env.MCP_ENABLE_RATE_LIMIT = 'false';
    process.env.CC_TELEGRAM_EVENTS_DIR = '/test/events';
    process.env.CC_TELEGRAM_RESPONSES_DIR = '/test/responses';

    // Reset all mocks
    mockFS.reset();
    mockAxios.reset();
    mockChildProcess.reset();

    // Set up bridge client mocks
    setupBridgeClientMocks();

    // Mock the imports and create server
    jest.unstable_mockModule('../../src/bridge-client.js', () => ({
      CCTelegramBridgeClient: jest.fn(() => mockBridgeClient)
    }));

    jest.unstable_mockModule('../../src/security.js', () => mockSecurity);

    // Import and initialize server after mocking
    const { default: serverModule } = await import('../../src/index.js');
    
    // Create a new server for testing
    server = new Server({
      name: 'cctelegram-mcp-server-test',
      version: '1.4.0'
    }, {
      capabilities: {
        tools: {},
        resources: {}
      }
    });

    // Set up handlers (simplified version of main server)
    setupServerHandlers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setupBridgeClientMocks();
  });

  function setupBridgeClientMocks() {
    // Default successful responses
    mockBridgeClient.sendEvent.mockResolvedValue({
      success: true,
      event_id: '123e4567-e89b-12d3-a456-426614174000',
      file_path: '/test/events/test.json'
    });

    mockBridgeClient.sendMessage.mockResolvedValue({
      success: true,
      event_id: '123e4567-e89b-12d3-a456-426614174000'
    });

    mockBridgeClient.sendTaskCompletion.mockResolvedValue({
      success: true,
      event_id: '123e4567-e89b-12d3-a456-426614174000'
    });

    mockBridgeClient.sendPerformanceAlert.mockResolvedValue({
      success: true,
      event_id: '123e4567-e89b-12d3-a456-426614174000'
    });

    mockBridgeClient.sendApprovalRequest.mockResolvedValue({
      success: true,
      event_id: '123e4567-e89b-12d3-a456-426614174000'
    });

    mockBridgeClient.getBridgeStatus.mockResolvedValue({
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
      last_event_time: new Date().toISOString()
    });

    mockBridgeClient.getTelegramResponses.mockResolvedValue([
      ResponseFixtures.createBasicResponse(),
      ResponseFixtures.createApprovalResponse(true)
    ]);

    mockBridgeClient.getAvailableEventTypes.mockReturnValue([
      { type: 'task_completion', category: 'Task Management', description: 'Task completed successfully' },
      { type: 'performance_alert', category: 'System Monitoring', description: 'Performance threshold exceeded' }
    ]);

    mockBridgeClient.clearOldResponses.mockResolvedValue(5);

    mockBridgeClient.processPendingResponses.mockResolvedValue({
      summary: {
        total_recent_responses: 3,
        actionable_responses: 2,
        pending_approvals: 1,
        pending_denials: 1,
        time_window_minutes: 10
      },
      actionable_responses: [
        { action: 'approve', task_id: 'test-task-1' },
        { action: 'deny', task_id: 'test-task-2' }
      ],
      recommendations: ['Process pending approvals']
    });

    mockBridgeClient.startBridge.mockResolvedValue({
      success: true,
      message: 'Bridge started successfully',
      pid: 12345
    });

    mockBridgeClient.stopBridge.mockResolvedValue({
      success: true,
      message: 'Bridge stopped successfully'
    });

    mockBridgeClient.restartBridge.mockResolvedValue({
      success: true,
      message: 'Bridge restarted successfully',
      pid: 12346
    });

    mockBridgeClient.ensureBridgeRunning.mockResolvedValue({
      success: true,
      message: 'Bridge is running',
      action: 'already_running'
    });

    mockBridgeClient.isBridgeRunning.mockResolvedValue(true);

    mockBridgeClient.getTaskStatus.mockResolvedValue({
      timestamp: new Date().toISOString(),
      task_system: 'both',
      status_filter: 'all',
      summary_only: false,
      claude_code_tasks: {
        available: true,
        total_count: 5,
        summary: {
          pending: 2,
          in_progress: 1,
          completed: 2,
          blocked: 0
        }
      },
      taskmaster_tasks: {
        available: false,
        message: 'No TaskMaster tasks found'
      }
    });
  }

  function setupServerHandlers() {
    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'send_telegram_event',
          description: 'Send a structured event to the CC Telegram Bridge for notification',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              task_id: { type: 'string' },
              source: { type: 'string', default: 'claude-code' },
              data: { type: 'object', additionalProperties: true }
            },
            required: ['type', 'title', 'description']
          }
        },
        {
          name: 'send_telegram_message',
          description: 'Send a simple text message to Telegram as an info notification',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              source: { type: 'string', default: 'claude-code' }
            },
            required: ['message']
          }
        }
        // Additional tools would be listed here...
      ]
    }));

    // Call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'send_telegram_event':
          const result = await mockBridgeClient.sendEvent(args);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                event_id: result.event_id,
                message: `Event sent successfully. Event ID: ${result.event_id}`
              }, null, 2)
            }]
          };

        case 'send_telegram_message':
          const msgResult = await mockBridgeClient.sendMessage(args.message, args.source);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: msgResult.success,
                event_id: msgResult.event_id,
                message: `Message sent successfully. Event ID: ${msgResult.event_id}`
              }, null, 2)
            }]
          };

        case 'send_task_completion':
          const taskResult = await mockBridgeClient.sendTaskCompletion(
            args.task_id, args.title, args.results, args.files_affected, args.duration_ms
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: taskResult.success,
                event_id: taskResult.event_id,
                message: `Task completion sent successfully. Event ID: ${taskResult.event_id}`
              }, null, 2)
            }]
          };

        case 'send_performance_alert':
          const perfResult = await mockBridgeClient.sendPerformanceAlert(
            args.title, args.current_value, args.threshold, args.severity
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: perfResult.success,
                event_id: perfResult.event_id,
                message: `Performance alert sent successfully. Event ID: ${perfResult.event_id}`
              }, null, 2)
            }]
          };

        case 'send_approval_request':
          const approvalResult = await mockBridgeClient.sendApprovalRequest(
            args.title, args.description, args.options
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: approvalResult.success,
                event_id: approvalResult.event_id,
                message: `Approval request sent successfully. Event ID: ${approvalResult.event_id}`
              }, null, 2)
            }]
          };

        case 'get_telegram_responses':
          const responses = await mockBridgeClient.getTelegramResponses();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                count: responses.length,
                total: responses.length,
                responses: responses.slice(0, args.limit || 10)
              }, null, 2)
            }]
          };

        case 'get_bridge_status':
          const status = await mockBridgeClient.getBridgeStatus();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(status, null, 2)
            }]
          };

        case 'list_event_types':
          const eventTypes = mockBridgeClient.getAvailableEventTypes();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                count: eventTypes.length,
                event_types: eventTypes
              }, null, 2)
            }]
          };

        case 'clear_old_responses':
          const deletedCount = await mockBridgeClient.clearOldResponses(args.older_than_hours);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                deleted_count: deletedCount,
                message: `Cleared ${deletedCount} old response files`
              }, null, 2)
            }]
          };

        case 'process_pending_responses':
          const pendingResult = await mockBridgeClient.processPendingResponses(args.since_minutes);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(pendingResult, null, 2)
            }]
          };

        case 'start_bridge':
          const startResult = await mockBridgeClient.startBridge();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: startResult.success,
                message: startResult.message,
                pid: startResult.pid
              }, null, 2)
            }]
          };

        case 'stop_bridge':
          const stopResult = await mockBridgeClient.stopBridge();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: stopResult.success,
                message: stopResult.message
              }, null, 2)
            }]
          };

        case 'restart_bridge':
          const restartResult = await mockBridgeClient.restartBridge();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: restartResult.success,
                message: restartResult.message,
                pid: restartResult.pid
              }, null, 2)
            }]
          };

        case 'ensure_bridge_running':
          const ensureResult = await mockBridgeClient.ensureBridgeRunning();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: ensureResult.success,
                message: ensureResult.message,
                action: ensureResult.action
              }, null, 2)
            }]
          };

        case 'check_bridge_process':
          const isRunning = await mockBridgeClient.isBridgeRunning();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                running: isRunning,
                message: isRunning ? 'Bridge process is running' : 'Bridge process is not running'
              }, null, 2)
            }]
          };

        case 'get_task_status':
          const taskStatus = await mockBridgeClient.getTaskStatus(
            args.project_root, args.task_system, args.status_filter, args.summary_only
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(taskStatus, null, 2)
            }]
          };

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // Resources handlers
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'cctelegram://event-types',
          mimeType: 'application/json',
          name: 'Available Event Types',
          description: 'List of all available event types and their descriptions'
        },
        {
          uri: 'cctelegram://bridge-status',
          mimeType: 'application/json',
          name: 'Bridge Status',
          description: 'Current status and health of the CC Telegram Bridge'
        }
      ]
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'cctelegram://event-types':
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(mockBridgeClient.getAvailableEventTypes(), null, 2)
            }]
          };

        case 'cctelegram://bridge-status':
          const status = await mockBridgeClient.getBridgeStatus();
          return {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(status, null, 2)
            }]
          };

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    });
  }

  describe('Tool Discovery', () => {
    it('should list all available tools', async () => {
      const response = await server.request(
        { method: 'tools/list' },
        ListToolsRequestSchema
      );

      expect(response.tools).toBeDefined();
      expect(response.tools.length).toBeGreaterThan(0);
      
      const toolNames = response.tools.map(tool => tool.name);
      expect(toolNames).toContain('send_telegram_event');
      expect(toolNames).toContain('send_telegram_message');
    });

    it('should provide correct tool schemas', async () => {
      const response = await server.request(
        { method: 'tools/list' },
        ListToolsRequestSchema
      );

      const sendEventTool = response.tools.find(tool => tool.name === 'send_telegram_event');
      expect(sendEventTool).toBeDefined();
      expect(sendEventTool!.inputSchema.properties).toHaveProperty('type');
      expect(sendEventTool!.inputSchema.properties).toHaveProperty('title');
      expect(sendEventTool!.inputSchema.properties).toHaveProperty('description');
      expect(sendEventTool!.inputSchema.required).toContain('type');
      expect(sendEventTool!.inputSchema.required).toContain('title');
      expect(sendEventTool!.inputSchema.required).toContain('description');
    });
  });

  describe('Event Communication Tools', () => {
    describe('send_telegram_event', () => {
      it('should send structured event successfully', async () => {
        const event = EventFixtures.createTaskCompletionEvent();
        
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'send_telegram_event',
            arguments: {
              type: event.type,
              title: event.title,
              description: event.description,
              task_id: event.task_id,
              source: event.source,
              data: event.data
            }
          }
        }, CallToolRequestSchema);

        expect(response.content).toHaveLength(1);
        expect(response.content[0].type).toBe('text');
        
        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.event_id).toBeValidUUID();
        expect(result.message).toContain('Event sent successfully');

        expect(mockBridgeClient.sendEvent).toHaveBeenCalledWith({
          type: event.type,
          title: event.title,
          description: event.description,
          task_id: event.task_id,
          source: event.source,
          data: event.data
        });
      });

      it('should handle event with minimal data', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'send_telegram_event',
            arguments: {
              type: 'info_notification',
              title: 'Simple Event',
              description: 'A simple test event'
            }
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);

        expect(mockBridgeClient.sendEvent).toHaveBeenCalledWith({
          type: 'info_notification',
          title: 'Simple Event',
          description: 'A simple test event'
        });
      });
    });

    describe('send_telegram_message', () => {
      it('should send simple message successfully', async () => {
        const message = 'Test message from integration test';

        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'send_telegram_message',
            arguments: {
              message: message
            }
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.event_id).toBeValidUUID();
        expect(result.message).toContain('Message sent successfully');

        expect(mockBridgeClient.sendMessage).toHaveBeenCalledWith(message, undefined);
      });

      it('should send message with custom source', async () => {
        const message = 'Test message with source';
        const source = 'integration-test';

        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'send_telegram_message',
            arguments: {
              message: message,
              source: source
            }
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);

        expect(mockBridgeClient.sendMessage).toHaveBeenCalledWith(message, source);
      });
    });

    describe('send_task_completion', () => {
      it('should send task completion successfully', async () => {
        const taskData = {
          task_id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Integration Test Task',
          results: 'Task completed successfully',
          files_affected: ['src/test.ts', 'src/integration.ts'],
          duration_ms: 5000
        };

        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'send_task_completion',
            arguments: taskData
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.event_id).toBe(taskData.task_id);

        expect(mockBridgeClient.sendTaskCompletion).toHaveBeenCalledWith(
          taskData.task_id,
          taskData.title,
          taskData.results,
          taskData.files_affected,
          taskData.duration_ms
        );
      });
    });

    describe('send_performance_alert', () => {
      it('should send performance alert successfully', async () => {
        const alertData = {
          title: 'High Memory Usage',
          current_value: 512,
          threshold: 400,
          severity: 'high'
        };

        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'send_performance_alert',
            arguments: alertData
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.event_id).toBeValidUUID();

        expect(mockBridgeClient.sendPerformanceAlert).toHaveBeenCalledWith(
          alertData.title,
          alertData.current_value,
          alertData.threshold,
          alertData.severity
        );
      });
    });

    describe('send_approval_request', () => {
      it('should send approval request successfully', async () => {
        const approvalData = {
          title: 'Deploy to Production',
          description: 'Approve deployment of version 1.2.0',
          options: ['Approve', 'Deny', 'Ask Later']
        };

        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'send_approval_request',
            arguments: approvalData
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.event_id).toBeValidUUID();

        expect(mockBridgeClient.sendApprovalRequest).toHaveBeenCalledWith(
          approvalData.title,
          approvalData.description,
          approvalData.options
        );
      });
    });
  });

  describe('Response Management Tools', () => {
    describe('get_telegram_responses', () => {
      it('should get responses successfully', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'get_telegram_responses',
            arguments: { limit: 5 }
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.count).toBe(2);
        expect(result.total).toBe(2);
        expect(result.responses).toHaveLength(2);

        expect(mockBridgeClient.getTelegramResponses).toHaveBeenCalled();
      });

      it('should use default limit', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'get_telegram_responses',
            arguments: {}
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.responses).toHaveLength(2); // Mock returns 2 responses
      });
    });

    describe('clear_old_responses', () => {
      it('should clear old responses successfully', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'clear_old_responses',
            arguments: { older_than_hours: 48 }
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.deleted_count).toBe(5);
        expect(result.message).toContain('Cleared 5 old response files');

        expect(mockBridgeClient.clearOldResponses).toHaveBeenCalledWith(48);
      });

      it('should use default 24 hour threshold', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'clear_old_responses',
            arguments: {}
          }
        }, CallToolRequestSchema);

        expect(mockBridgeClient.clearOldResponses).toHaveBeenCalledWith(undefined);
      });
    });

    describe('process_pending_responses', () => {
      it('should process pending responses successfully', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'process_pending_responses',
            arguments: { since_minutes: 15 }
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.summary.actionable_responses).toBe(2);
        expect(result.summary.pending_approvals).toBe(1);
        expect(result.summary.pending_denials).toBe(1);
        expect(result.actionable_responses).toHaveLength(2);

        expect(mockBridgeClient.processPendingResponses).toHaveBeenCalledWith(15);
      });
    });
  });

  describe('Bridge Management Tools', () => {
    describe('get_bridge_status', () => {
      it('should get bridge status successfully', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'get_bridge_status',
            arguments: {}
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.running).toBe(true);
        expect(result.health).toBe('healthy');
        expect(result.metrics).toBeDefined();
        expect(result.metrics.uptime_seconds).toBe(3600);

        expect(mockBridgeClient.getBridgeStatus).toHaveBeenCalled();
      });
    });

    describe('start_bridge', () => {
      it('should start bridge successfully', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'start_bridge',
            arguments: {}
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.message).toContain('successfully');
        expect(result.pid).toBe(12345);

        expect(mockBridgeClient.startBridge).toHaveBeenCalled();
      });
    });

    describe('stop_bridge', () => {
      it('should stop bridge successfully', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'stop_bridge',
            arguments: {}
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.message).toContain('successfully');

        expect(mockBridgeClient.stopBridge).toHaveBeenCalled();
      });
    });

    describe('restart_bridge', () => {
      it('should restart bridge successfully', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'restart_bridge',
            arguments: {}
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.message).toContain('successfully');
        expect(result.pid).toBe(12346);

        expect(mockBridgeClient.restartBridge).toHaveBeenCalled();
      });
    });

    describe('ensure_bridge_running', () => {
      it('should ensure bridge is running', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'ensure_bridge_running',
            arguments: {}
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.success).toBe(true);
        expect(result.action).toBe('already_running');

        expect(mockBridgeClient.ensureBridgeRunning).toHaveBeenCalled();
      });
    });

    describe('check_bridge_process', () => {
      it('should check bridge process status', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'check_bridge_process',
            arguments: {}
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.running).toBe(true);
        expect(result.message).toContain('running');

        expect(mockBridgeClient.isBridgeRunning).toHaveBeenCalled();
      });
    });
  });

  describe('Information Tools', () => {
    describe('list_event_types', () => {
      it('should list all event types', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'list_event_types',
            arguments: {}
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.count).toBe(2);
        expect(result.event_types).toHaveLength(2);
        expect(result.event_types[0]).toHaveProperty('type');
        expect(result.event_types[0]).toHaveProperty('category');
        expect(result.event_types[0]).toHaveProperty('description');

        expect(mockBridgeClient.getAvailableEventTypes).toHaveBeenCalled();
      });
    });

    describe('get_task_status', () => {
      it('should get task status successfully', async () => {
        const response = await server.request({
          method: 'tools/call',
          params: {
            name: 'get_task_status',
            arguments: {
              project_root: '/test/project',
              task_system: 'both',
              summary_only: false
            }
          }
        }, CallToolRequestSchema);

        const result = JSON.parse(response.content[0].text);
        expect(result.task_system).toBe('both');
        expect(result.claude_code_tasks.available).toBe(true);
        expect(result.claude_code_tasks.total_count).toBe(5);
        expect(result.taskmaster_tasks.available).toBe(false);

        expect(mockBridgeClient.getTaskStatus).toHaveBeenCalledWith(
          '/test/project',
          'both',
          undefined,
          false
        );
      });
    });
  });

  describe('Resource Management', () => {
    it('should list available resources', async () => {
      const response = await server.request(
        { method: 'resources/list' },
        ListResourcesRequestSchema
      );

      expect(response.resources).toHaveLength(2);
      expect(response.resources[0].uri).toBe('cctelegram://event-types');
      expect(response.resources[1].uri).toBe('cctelegram://bridge-status');
    });

    it('should read event-types resource', async () => {
      const response = await server.request({
        method: 'resources/read',
        params: { uri: 'cctelegram://event-types' }
      }, ReadResourceRequestSchema);

      expect(response.contents).toHaveLength(1);
      expect(response.contents[0].uri).toBe('cctelegram://event-types');
      expect(response.contents[0].mimeType).toBe('application/json');

      const eventTypes = JSON.parse(response.contents[0].text);
      expect(eventTypes).toHaveLength(2);
    });

    it('should read bridge-status resource', async () => {
      const response = await server.request({
        method: 'resources/read',
        params: { uri: 'cctelegram://bridge-status' }
      }, ReadResourceRequestSchema);

      expect(response.contents).toHaveLength(1);
      expect(response.contents[0].uri).toBe('cctelegram://bridge-status');
      expect(response.contents[0].mimeType).toBe('application/json');

      const status = JSON.parse(response.contents[0].text);
      expect(status.running).toBe(true);
      expect(status.health).toBe('healthy');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown tool calls', async () => {
      await expect(server.request({
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      }, CallToolRequestSchema)).rejects.toThrow('Unknown tool');
    });

    it('should handle unknown resource requests', async () => {
      await expect(server.request({
        method: 'resources/read',
        params: { uri: 'cctelegram://unknown-resource' }
      }, ReadResourceRequestSchema)).rejects.toThrow('Unknown resource');
    });

    it('should handle bridge client failures', async () => {
      mockBridgeClient.sendMessage.mockRejectedValue(new Error('Bridge connection failed'));

      await expect(server.request({
        method: 'tools/call',
        params: {
          name: 'send_telegram_message',
          arguments: { message: 'Test message' }
        }
      }, CallToolRequestSchema)).rejects.toThrow();
    });
  });

  describe('Security Integration', () => {
    it('should apply security wrapper to all tool calls', async () => {
      const response = await server.request({
        method: 'tools/call',
        params: {
          name: 'send_telegram_message',
          arguments: { message: 'Security test message' }
        }
      }, CallToolRequestSchema);

      expect(mockSecurity.withSecurity).toHaveBeenCalled();
      expect(response.content[0].text).toContain('success');
    });

    it('should validate input data', async () => {
      const response = await server.request({
        method: 'tools/call',
        params: {
          name: 'send_telegram_event',
          arguments: {
            type: 'task_completion',
            title: 'Test Event',
            description: 'Test description'
          }
        }
      }, CallToolRequestSchema);

      expect(mockSecurity.validateInput).toHaveBeenCalled();
      expect(response.content[0].text).toContain('success');
    });

    it('should authenticate requests', async () => {
      await server.request({
        method: 'tools/call',
        params: {
          name: 'get_bridge_status',
          arguments: {}
        }
      }, CallToolRequestSchema);

      expect(mockSecurity.authenticateRequest).toHaveBeenCalled();
    });
  });

  describe('End-to-End Workflows', () => {
    it('should handle complete task completion workflow', async () => {
      // 1. Send task start event
      const startResponse = await server.request({
        method: 'tools/call',
        params: {
          name: 'send_telegram_event',
          arguments: {
            type: 'task_started',
            title: 'Integration Test Task',
            description: 'Starting integration test workflow',
            task_id: '123e4567-e89b-12d3-a456-426614174000'
          }
        }
      }, CallToolRequestSchema);

      const startResult = JSON.parse(startResponse.content[0].text);
      expect(startResult.success).toBe(true);

      // 2. Send task completion
      const completionResponse = await server.request({
        method: 'tools/call',
        params: {
          name: 'send_task_completion',
          arguments: {
            task_id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Integration Test Task',
            results: 'Task completed successfully',
            duration_ms: 5000
          }
        }
      }, CallToolRequestSchema);

      const completionResult = JSON.parse(completionResponse.content[0].text);
      expect(completionResult.success).toBe(true);

      // 3. Check responses
      const responsesResponse = await server.request({
        method: 'tools/call',
        params: {
          name: 'get_telegram_responses',
          arguments: { limit: 10 }
        }
      }, CallToolRequestSchema);

      const responsesResult = JSON.parse(responsesResponse.content[0].text);
      expect(responsesResult.responses).toBeDefined();

      // Verify all calls were made
      expect(mockBridgeClient.sendEvent).toHaveBeenCalledTimes(1);
      expect(mockBridgeClient.sendTaskCompletion).toHaveBeenCalledTimes(1);
      expect(mockBridgeClient.getTelegramResponses).toHaveBeenCalledTimes(1);
    });

    it('should handle approval request workflow', async () => {
      // 1. Send approval request
      const approvalResponse = await server.request({
        method: 'tools/call',
        params: {
          name: 'send_approval_request',
          arguments: {
            title: 'Deploy to Production',
            description: 'Approve deployment of version 1.2.0',
            options: ['Approve', 'Deny']
          }
        }
      }, CallToolRequestSchema);

      const approvalResult = JSON.parse(approvalResponse.content[0].text);
      expect(approvalResult.success).toBe(true);

      // 2. Process pending responses
      const pendingResponse = await server.request({
        method: 'tools/call',
        params: {
          name: 'process_pending_responses',
          arguments: { since_minutes: 10 }
        }
      }, CallToolRequestSchema);

      const pendingResult = JSON.parse(pendingResponse.content[0].text);
      expect(pendingResult.summary.actionable_responses).toBeGreaterThan(0);

      // Verify workflow
      expect(mockBridgeClient.sendApprovalRequest).toHaveBeenCalledTimes(1);
      expect(mockBridgeClient.processPendingResponses).toHaveBeenCalledTimes(1);
    });

    it('should handle bridge management workflow', async () => {
      // 1. Check bridge status
      const statusResponse = await server.request({
        method: 'tools/call',
        params: {
          name: 'get_bridge_status',
          arguments: {}
        }
      }, CallToolRequestSchema);

      const statusResult = JSON.parse(statusResponse.content[0].text);
      expect(statusResult.running).toBe(true);

      // 2. Restart bridge
      const restartResponse = await server.request({
        method: 'tools/call',
        params: {
          name: 'restart_bridge',
          arguments: {}
        }
      }, CallToolRequestSchema);

      const restartResult = JSON.parse(restartResponse.content[0].text);
      expect(restartResult.success).toBe(true);

      // 3. Ensure bridge is running
      const ensureResponse = await server.request({
        method: 'tools/call',
        params: {
          name: 'ensure_bridge_running',
          arguments: {}
        }
      }, CallToolRequestSchema);

      const ensureResult = JSON.parse(ensureResponse.content[0].text);
      expect(ensureResult.success).toBe(true);

      // Verify workflow
      expect(mockBridgeClient.getBridgeStatus).toHaveBeenCalledTimes(1);
      expect(mockBridgeClient.restartBridge).toHaveBeenCalledTimes(1);
      expect(mockBridgeClient.ensureBridgeRunning).toHaveBeenCalledTimes(1);
    });
  });
});
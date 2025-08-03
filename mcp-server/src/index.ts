#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CCTelegramBridgeClient } from './bridge-client.js';
import { CCTelegramEvent, EventType } from './types.js';

const client = new CCTelegramBridgeClient();

const server = new Server({
  name: 'cctelegram-mcp-server',
  version: '1.0.0',
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'send_telegram_event',
        description: 'Send a structured event to the CC Telegram Bridge for notification',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: client.getAvailableEventTypes().map(et => et.type),
              description: 'Type of event to send'
            },
            title: {
              type: 'string',
              description: 'Event title'
            },
            description: {
              type: 'string',
              description: 'Event description'
            },
            task_id: {
              type: 'string',
              description: 'Optional task ID (will be generated if not provided)'
            },
            source: {
              type: 'string',
              description: 'Event source (defaults to "claude-code")',
              default: 'claude-code'
            },
            data: {
              type: 'object',
              description: 'Additional event data (varies by event type)',
              additionalProperties: true
            }
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
            message: {
              type: 'string',
              description: 'Message text to send'
            },
            source: {
              type: 'string',
              description: 'Message source (defaults to "claude-code")',
              default: 'claude-code'
            }
          },
          required: ['message']
        }
      },
      {
        name: 'send_task_completion',
        description: 'Send a task completion notification with results',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'Task identifier'
            },
            title: {
              type: 'string',
              description: 'Task title'
            },
            results: {
              type: 'string',
              description: 'Task results or summary'
            },
            files_affected: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of files that were affected'
            },
            duration_ms: {
              type: 'number',
              description: 'Task duration in milliseconds'
            }
          },
          required: ['task_id', 'title']
        }
      },
      {
        name: 'send_performance_alert',
        description: 'Send a performance alert when thresholds are exceeded',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Alert title (e.g., "Memory Usage High")'
            },
            current_value: {
              type: 'number',
              description: 'Current metric value'
            },
            threshold: {
              type: 'number',
              description: 'Threshold that was exceeded'
            },
            severity: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'Alert severity level',
              default: 'medium'
            }
          },
          required: ['title', 'current_value', 'threshold']
        }
      },
      {
        name: 'send_approval_request',
        description: 'Send an approval request with interactive buttons',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Request title'
            },
            description: {
              type: 'string',
              description: 'Request description'
            },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Response options (defaults to ["Approve", "Deny"])',
              default: ['Approve', 'Deny']
            }
          },
          required: ['title', 'description']
        }
      },
      {
        name: 'get_telegram_responses',
        description: 'Get user responses from Telegram interactions',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of responses to return (default: 10)',
              default: 10
            }
          }
        }
      },
      {
        name: 'get_bridge_status',
        description: 'Get the current status and health of the CC Telegram Bridge',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'list_event_types',
        description: 'List all available event types with descriptions',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Filter by event category'
            }
          }
        }
      },
      {
        name: 'clear_old_responses',
        description: 'Clear old response files to prevent accumulation',
        inputSchema: {
          type: 'object',
          properties: {
            older_than_hours: {
              type: 'number',
              description: 'Clear responses older than this many hours (default: 24)',
              default: 24
            }
          }
        }
      },
      {
        name: 'process_pending_responses',
        description: 'Process pending approval responses and return actionable information',
        inputSchema: {
          type: 'object',
          properties: {
            since_minutes: {
              type: 'number',
              description: 'Process responses from the last N minutes (default: 10)',
              default: 10
            }
          }
        }
      },
      {
        name: 'start_bridge',
        description: 'Start the CCTelegram Bridge process if not running',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'stop_bridge',
        description: 'Stop the CCTelegram Bridge process',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'restart_bridge',
        description: 'Restart the CCTelegram Bridge process',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'ensure_bridge_running',
        description: 'Ensure the bridge is running, start it if needed',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'check_bridge_process',
        description: 'Check if the bridge process is running',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
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
      },
      {
        uri: 'cctelegram://responses',
        mimeType: 'application/json',
        name: 'Recent Responses',
        description: 'Recent user responses from Telegram'
      },
      {
        uri: 'cctelegram://event-templates',
        mimeType: 'application/json',
        name: 'Event Templates',
        description: 'Pre-configured event templates for common use cases'
      }
    ]
  };
});

// Handle resource reads
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case 'cctelegram://event-types':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(client.getAvailableEventTypes(), null, 2)
          }
        ]
      };

    case 'cctelegram://bridge-status':
      const status = await client.getBridgeStatus();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(status, null, 2)
          }
        ]
      };

    case 'cctelegram://responses':
      const responses = await client.getTelegramResponses();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(responses.slice(0, 20), null, 2)
          }
        ]
      };

    case 'cctelegram://event-templates':
      const templates = getEventTemplates();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(templates, null, 2)
          }
        ]
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'send_telegram_event': {
      const { type, title, description, task_id, source = 'claude-code', data = {} } = args as any;
      
      const event: CCTelegramEvent = {
        type: type as EventType,
        source,
        timestamp: new Date().toISOString(),
        task_id: task_id || '',
        title,
        description,
        data
      };

      const result = await client.sendEvent(event);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              event_id: result.event_id,
              message: `Event sent successfully. Event ID: ${result.event_id}`
            }, null, 2)
          }
        ]
      };
    }

    case 'send_telegram_message': {
      const { message, source = 'claude-code' } = args as any;
      const result = await client.sendMessage(message, source);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              event_id: result.event_id,
              message: `Message sent successfully. Event ID: ${result.event_id}`
            }, null, 2)
          }
        ]
      };
    }

    case 'send_task_completion': {
      const { task_id, title, results, files_affected, duration_ms } = args as any;
      const result = await client.sendTaskCompletion(task_id, title, results, files_affected, duration_ms);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              event_id: result.event_id,
              message: `Task completion sent successfully. Event ID: ${result.event_id}`
            }, null, 2)
          }
        ]
      };
    }

    case 'send_performance_alert': {
      const { title, current_value, threshold, severity = 'medium' } = args as any;
      const result = await client.sendPerformanceAlert(title, current_value, threshold, severity);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              event_id: result.event_id,
              message: `Performance alert sent successfully. Event ID: ${result.event_id}`
            }, null, 2)
          }
        ]
      };
    }

    case 'send_approval_request': {
      const { title, description, options = ['Approve', 'Deny'] } = args as any;
      const result = await client.sendApprovalRequest(title, description, options);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              event_id: result.event_id,
              message: `Approval request sent successfully. Event ID: ${result.event_id}`
            }, null, 2)
          }
        ]
      };
    }

    case 'get_telegram_responses': {
      const { limit = 10 } = args as any;
      const responses = await client.getTelegramResponses();
      const limitedResponses = responses.slice(0, limit);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              count: limitedResponses.length,
              total: responses.length,
              responses: limitedResponses
            }, null, 2)
          }
        ]
      };
    }

    case 'get_bridge_status': {
      const status = await client.getBridgeStatus();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2)
          }
        ]
      };
    }

    case 'list_event_types': {
      const { category } = args as any;
      let eventTypes = client.getAvailableEventTypes();
      
      if (category) {
        eventTypes = eventTypes.filter(et => 
          et.category.toLowerCase().includes(category.toLowerCase())
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              count: eventTypes.length,
              event_types: eventTypes
            }, null, 2)
          }
        ]
      };
    }

    case 'clear_old_responses': {
      const { older_than_hours = 24 } = args as any;
      const deletedCount = await client.clearOldResponses(older_than_hours);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              deleted_count: deletedCount,
              message: `Cleared ${deletedCount} old response files`
            }, null, 2)
          }
        ]
      };
    }

    case 'process_pending_responses': {
      const { since_minutes = 10 } = args as any;
      const result = await client.processPendingResponses(since_minutes);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    case 'start_bridge': {
      const result = await client.startBridge();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              message: result.message,
              pid: result.pid
            }, null, 2)
          }
        ]
      };
    }

    case 'stop_bridge': {
      const result = await client.stopBridge();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              message: result.message
            }, null, 2)
          }
        ]
      };
    }

    case 'restart_bridge': {
      const result = await client.restartBridge();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              message: result.message,
              pid: result.pid
            }, null, 2)
          }
        ]
      };
    }

    case 'ensure_bridge_running': {
      const result = await client.ensureBridgeRunning();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              message: result.message,
              action: result.action
            }, null, 2)
          }
        ]
      };
    }

    case 'check_bridge_process': {
      const isRunning = await client.isBridgeRunning();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              running: isRunning,
              message: isRunning ? 'Bridge process is running' : 'Bridge process is not running'
            }, null, 2)
          }
        ]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

function getEventTemplates() {
  return [
    {
      id: 'claude-task-complete',
      name: 'Claude Task Completion',
      description: 'Standard task completion notification from Claude Code',
      event_type: 'task_completion',
      template: {
        type: 'task_completion',
        source: 'claude-code',
        data: {
          status: 'completed'
        }
      }
    },
    {
      id: 'build-success',
      name: 'Build Success',
      description: 'Successful build completion notification',
      event_type: 'build_completed',
      template: {
        type: 'build_completed',
        source: 'build-system',
        data: {
          status: 'completed',
          build_target: 'release'
        }
      }
    },
    {
      id: 'performance-warning',
      name: 'Performance Warning',
      description: 'Performance threshold warning alert',
      event_type: 'performance_alert',
      template: {
        type: 'performance_alert',
        source: 'monitoring',
        data: {
          severity: 'medium'
        }
      }
    },
    {
      id: 'approval-needed',
      name: 'Approval Request',
      description: 'Request user approval for an action',
      event_type: 'approval_request',
      template: {
        type: 'approval_request',
        source: 'claude-code',
        data: {
          requires_response: true,
          response_options: ['Approve', 'Deny'],
          timeout_minutes: 30
        }
      }
    }
  ];
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CC Telegram MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
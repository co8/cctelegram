#!/usr/bin/env node

/**
 * Resilient CCTelegram MCP Server
 * 
 * Enhanced MCP server with integrated resilience patterns including
 * circuit breakers, retries, health monitoring, and automatic recovery.
 */

import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ResilientBridgeClient } from './resilient-bridge-client.js';
import { CCTelegramEvent, EventType } from './types.js';
import {
  loadSecurityConfig,
  initializeSecurity,
  authenticateRequest,
  validateInput,
  withSecurity,
  secureLog,
  SecurityError
} from './security.js';
import { ResilienceConfig, createDefaultResilienceConfig } from './resilience/config.js';
import { createResilienceError } from './resilience/errors/resilience-errors.js';

// Load environment variables from .env files before initializing security
const loadEnvFiles = () => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const envFilePaths = [
    // Project directory
    path.join(process.cwd(), '..', '.env'),
    path.join(process.cwd(), '.env'),
    // User's .cc_telegram directory
    path.join(homeDir, '.cc_telegram', '.env')
  ];

  for (const envPath of envFilePaths) {
    try {
      if (fs.existsSync(envPath)) {
        console.error(`[MCP-ENV] Loading .env file: ${envPath}`);
        const result = dotenv.config({ path: envPath });
        if (result.parsed) {
          console.error(`[MCP-ENV] Loaded ${Object.keys(result.parsed).length} variables from ${envPath}`);
          console.error(`[MCP-ENV] MCP_ENABLE_AUTH=${process.env.MCP_ENABLE_AUTH}`);
        }
      }
    } catch (error) {
      console.error(`[MCP-ENV] Failed to load .env file ${envPath}:`, error);
    }
  }
};

// Create resilience configuration from environment
const createResilienceConfigFromEnv = (): Partial<ResilienceConfig> => {
  const config: Partial<ResilienceConfig> = {};
  
  // Environment-based configuration
  if (process.env.RESILIENCE_ENABLED === 'false') {
    config.enabled = false;
  }
  
  if (process.env.NODE_ENV) {
    config.environment = process.env.NODE_ENV as 'development' | 'staging' | 'production';
  }
  
  // Circuit breaker configuration
  if (process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    config.circuitBreaker = {
      bridge: {
        enabled: true,
        failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD, 10),
        successThreshold: parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '2', 10),
        timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '30000', 10),
        monitoringWindow: parseInt(process.env.CIRCUIT_BREAKER_MONITORING_WINDOW || '60000', 10),
        maxConcurrentRequests: parseInt(process.env.CIRCUIT_BREAKER_MAX_CONCURRENT || '5', 10),
        volumeThreshold: parseInt(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD || '3', 10)
      },
      telegram: {
        enabled: true,
        failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '3', 10),
        successThreshold: parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '2', 10),
        timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '15000', 10),
        monitoringWindow: parseInt(process.env.CIRCUIT_BREAKER_MONITORING_WINDOW || '30000', 10),
        maxConcurrentRequests: parseInt(process.env.CIRCUIT_BREAKER_MAX_CONCURRENT || '5', 10),
        volumeThreshold: parseInt(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD || '3', 10)
      },
      filesystem: {
        enabled: true,
        failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '10', 10),
        successThreshold: parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '5', 10),
        timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '5000', 10),
        monitoringWindow: parseInt(process.env.CIRCUIT_BREAKER_MONITORING_WINDOW || '60000', 10),
        maxConcurrentRequests: parseInt(process.env.CIRCUIT_BREAKER_MAX_CONCURRENT || '20', 10),
        volumeThreshold: parseInt(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD || '10', 10)
      },
      network: {
        enabled: true,
        failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
        successThreshold: parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '3', 10),
        timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '20000', 10),
        monitoringWindow: parseInt(process.env.CIRCUIT_BREAKER_MONITORING_WINDOW || '60000', 10),
        maxConcurrentRequests: parseInt(process.env.CIRCUIT_BREAKER_MAX_CONCURRENT || '10', 10),
        volumeThreshold: parseInt(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD || '5', 10)
      }
    };
  }
  
  // Retry configuration
  if (process.env.RETRY_MAX_ATTEMPTS) {
    const maxAttempts = parseInt(process.env.RETRY_MAX_ATTEMPTS, 10);
    const baseDelay = parseInt(process.env.RETRY_BASE_DELAY || '1000', 10);
    const maxDelay = parseInt(process.env.RETRY_MAX_DELAY || '10000', 10);
    
    config.retry = {
      bridge: {
        enabled: true,
        maxAttempts,
        baseDelay,
        maxDelay,
        exponentialBase: parseFloat(process.env.RETRY_EXPONENTIAL_BASE || '2.0'),
        jitterEnabled: process.env.RETRY_JITTER_ENABLED !== 'false',
        jitterMax: parseInt(process.env.RETRY_JITTER_MAX || '500', 10),
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'BRIDGE_NOT_READY'],
        nonRetryableErrors: ['AUTH_FAILED', 'INVALID_INPUT', 'BRIDGE_CRASHED']
      },
      telegram: {
        enabled: true,
        maxAttempts: maxAttempts + 2, // More attempts for Telegram
        baseDelay: baseDelay * 2,
        maxDelay: maxDelay * 3,
        exponentialBase: 1.5,
        jitterEnabled: true,
        jitterMax: 1000,
        retryableErrors: ['TELEGRAM_RATE_LIMIT', 'TELEGRAM_SERVER_ERROR', 'NETWORK_ERROR'],
        nonRetryableErrors: ['TELEGRAM_INVALID_TOKEN', 'TELEGRAM_FORBIDDEN', 'TELEGRAM_INVALID_CHAT']
      },
      filesystem: {
        enabled: true,
        maxAttempts,
        baseDelay: baseDelay / 2,
        maxDelay: maxDelay / 2,
        exponentialBase: 2.0,
        jitterEnabled: false,
        jitterMax: 0,
        retryableErrors: ['EMFILE', 'ENFILE', 'EAGAIN', 'EBUSY'],
        nonRetryableErrors: ['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR']
      },
      network: {
        enabled: true,
        maxAttempts,
        baseDelay,
        maxDelay,
        exponentialBase: 2.0,
        jitterEnabled: true,
        jitterMax: 500,
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'],
        nonRetryableErrors: ['ECONNABORTED', 'ECANCELED', 'HTTP_4XX']
      }
    };
  }
  
  // Health check configuration
  if (process.env.HEALTH_CHECK_INTERVAL) {
    config.health = {
      enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL, 10),
      timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000', 10),
      failureThreshold: parseInt(process.env.HEALTH_CHECK_FAILURE_THRESHOLD || '3', 10),
      recoveryThreshold: parseInt(process.env.HEALTH_CHECK_RECOVERY_THRESHOLD || '2', 10),
      gracePeriod: parseInt(process.env.HEALTH_CHECK_GRACE_PERIOD || '10000', 10),
      endpoints: [
        {
          name: 'bridge-health',
          url: `http://localhost:${process.env.CC_TELEGRAM_HEALTH_PORT || '8080'}/health`,
          method: 'GET',
          timeout: 5000,
          retries: 2,
          expectedStatus: [200],
          critical: true
        }
      ]
    };
  }
  
  // Monitoring configuration
  if (process.env.MONITORING_ENABLED === 'true') {
    config.monitoring = {
      enabled: true,
      metricsInterval: parseInt(process.env.MONITORING_METRICS_INTERVAL || '10000', 10),
      alertThresholds: {
        errorRate: parseFloat(process.env.MONITORING_ERROR_RATE_THRESHOLD || '0.1'),
        responseTime: parseInt(process.env.MONITORING_RESPONSE_TIME_THRESHOLD || '5000', 10),
        memoryUsage: parseFloat(process.env.MONITORING_MEMORY_USAGE_THRESHOLD || '0.8'),
        cpuUsage: parseFloat(process.env.MONITORING_CPU_USAGE_THRESHOLD || '0.8')
      },
      retention: {
        metrics: parseInt(process.env.MONITORING_METRICS_RETENTION || '86400000', 10), // 24 hours
        events: parseInt(process.env.MONITORING_EVENTS_RETENTION || '604800000', 10), // 7 days
        logs: parseInt(process.env.MONITORING_LOGS_RETENTION || '259200000', 10) // 3 days
      },
      exporters: [
        {
          name: 'console-logs',
          type: 'logs',
          enabled: true,
          format: 'json'
        }
      ]
    };
  }
  
  return config;
};

// Load environment variables first
loadEnvFiles();

// Initialize security system
const securityConfig = loadSecurityConfig();
initializeSecurity(securityConfig);

// Create resilience configuration
const resilienceConfig = createResilienceConfigFromEnv();

// Initialize resilient bridge client
const client = new ResilientBridgeClient(resilienceConfig);

// Create MCP server with enhanced capabilities
const server = new Server({
  name: 'cctelegram-mcp-server-resilient',
  version: '1.5.0',
}, {
  capabilities: {
    tools: {},
    resources: {}
  }
});

// Enhanced error handling wrapper
const withResilienceAndSecurity = async (fn: () => Promise<any>) => {
  try {
    return await withSecurity(fn);
  } catch (error) {
    secureLog('error', 'Operation failed with resilience', {
      error: error instanceof Error ? error.message : 'unknown',
      error_type: error instanceof Error ? error.constructor.name : 'unknown'
    });
    
    // Convert to resilience error if not already
    if (!(error instanceof Error) || error.name === 'Error') {
      throw createResilienceError(error, {
        operation: 'mcp_operation',
        component: 'mcp_server'
      });
    }
    
    throw error;
  }
};

// List available tools with resilience information
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return await withResilienceAndSecurity(async () => {
    const eventTypes = await client.getAvailableEventTypes?.() || [
      { type: 'task_completion', description: 'Task completion notification' },
      { type: 'task_started', description: 'Task started notification' },
      { type: 'task_failed', description: 'Task failure notification' },
      { type: 'task_progress', description: 'Task progress update' },
      { type: 'task_cancelled', description: 'Task cancellation notification' },
      { type: 'code_generation', description: 'Code generation event' },
      { type: 'code_analysis', description: 'Code analysis event' },
      { type: 'code_refactoring', description: 'Code refactoring event' },
      { type: 'code_review', description: 'Code review event' },
      { type: 'code_testing', description: 'Code testing event' },
      { type: 'code_deployment', description: 'Code deployment event' },
      { type: 'build_completed', description: 'Build completion notification' },
      { type: 'build_failed', description: 'Build failure notification' },
      { type: 'test_suite_run', description: 'Test suite execution' },
      { type: 'lint_check', description: 'Linting check result' },
      { type: 'type_check', description: 'Type checking result' },
      { type: 'performance_alert', description: 'Performance threshold alert' },
      { type: 'error_occurred', description: 'System error notification' },
      { type: 'system_health', description: 'System health status' },
      { type: 'approval_request', description: 'User approval request' },
      { type: 'user_response', description: 'User response notification' },
      { type: 'info_notification', description: 'General information' },
      { type: 'alert_notification', description: 'Alert notification' },
      { type: 'progress_update', description: 'Progress update notification' }
    ];

    return {
      tools: [
        {
          name: 'send_telegram_event',
          description: 'Send a structured event to the CC Telegram Bridge for notification with resilience patterns',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: eventTypes.map(et => et.type),
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
          description: 'Send a simple text message to Telegram as an info notification with resilience',
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
          description: 'Send a task completion notification with results and resilience',
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
              duration_ms: {
                type: 'number',
                description: 'Task duration in milliseconds'
              },
              files_affected: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of files that were affected'
              }
            },
            required: ['task_id', 'title']
          }
        },
        {
          name: 'send_performance_alert',
          description: 'Send a performance alert when thresholds are exceeded with resilience',
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
                default: 'medium',
                description: 'Alert severity level'
              }
            },
            required: ['title', 'current_value', 'threshold']
          }
        },
        {
          name: 'send_approval_request',
          description: 'Send an approval request with interactive buttons and resilience',
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
                default: ['Approve', 'Deny'],
                description: 'Response options (defaults to ["Approve", "Deny"])'
              }
            },
            required: ['title', 'description']
          }
        },
        {
          name: 'get_telegram_responses',
          description: 'Get user responses from Telegram interactions with resilience',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                default: 10,
                description: 'Maximum number of responses to return (default: 10)'
              }
            }
          }
        },
        {
          name: 'get_bridge_status',
          description: 'Get the current status and health of the CC Telegram Bridge with resilience metrics',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'clear_old_responses',
          description: 'Clear old response files to prevent accumulation with resilience',
          inputSchema: {
            type: 'object',
            properties: {
              older_than_hours: {
                type: 'number',
                default: 24,
                description: 'Clear responses older than this many hours (default: 24)'
              }
            }
          }
        },
        {
          name: 'get_resilience_status',
          description: 'Get current resilience system status and health metrics',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_resilience_health_report',
          description: 'Get detailed resilience health report with component status',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_resilience_metrics',
          description: 'Get current resilience metrics and performance data',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    };
  });
});

// Handle tool calls with enhanced resilience
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return await withResilienceAndSecurity(async () => {
    const { name, arguments: args } = request.params;
    
    secureLog('info', 'Tool call received', {
      tool_name: name,
      has_args: !!args,
      arg_keys: args ? Object.keys(args) : []
    });

    try {
      switch (name) {
        case 'send_telegram_event': {
          await validateInput('event', args);
          
          const event: CCTelegramEvent = {
            type: args.type as EventType,
            title: args.title,
            description: args.description,
            task_id: args.task_id,
            source: args.source || 'claude-code',
            data: args.data || {}
          };
          
          const result = await client.sendEvent(event);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                event_id: result.event_id,
                message: `Event '${event.type}' sent successfully`,
                details: {
                  title: event.title,
                  source: event.source,
                  file_path: result.file_path
                }
              }, null, 2)
            }]
          };
        }

        case 'send_telegram_message': {
          await validateInput('message', args);
          
          const event: CCTelegramEvent = {
            type: 'info_notification',
            title: 'Message',
            description: args.message,
            source: args.source || 'claude-code',
            data: {}
          };
          
          const result = await client.sendEvent(event);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                event_id: result.event_id,
                message: 'Message sent successfully',
                details: {
                  text: args.message,
                  source: event.source
                }
              }, null, 2)
            }]
          };
        }

        case 'send_task_completion': {
          await validateInput('task_completion', args);
          
          const event: CCTelegramEvent = {
            type: 'task_completion',
            title: args.title,
            description: args.results || 'Task completed successfully',
            task_id: args.task_id,
            source: 'claude-code',
            data: {
              results: args.results,
              duration_ms: args.duration_ms,
              files_affected: args.files_affected || []
            }
          };
          
          const result = await client.sendEvent(event);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                event_id: result.event_id,
                message: 'Task completion notification sent',
                details: {
                  task_id: args.task_id,
                  title: args.title,
                  duration_ms: args.duration_ms
                }
              }, null, 2)
            }]
          };
        }

        case 'send_performance_alert': {
          await validateInput('performance_alert', args);
          
          const event: CCTelegramEvent = {
            type: 'performance_alert',
            title: args.title,
            description: `Performance threshold exceeded: ${args.current_value} > ${args.threshold}`,
            source: 'claude-code',
            data: {
              current_value: args.current_value,
              threshold: args.threshold,
              severity: args.severity || 'medium'
            }
          };
          
          const result = await client.sendEvent(event);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                event_id: result.event_id,
                message: 'Performance alert sent',
                details: {
                  title: args.title,
                  current_value: args.current_value,
                  threshold: args.threshold,
                  severity: args.severity
                }
              }, null, 2)
            }]
          };
        }

        case 'send_approval_request': {
          await validateInput('approval_request', args);
          
          const event: CCTelegramEvent = {
            type: 'approval_request',
            title: args.title,
            description: args.description,
            source: 'claude-code',
            data: {
              options: args.options || ['Approve', 'Deny']
            }
          };
          
          const result = await client.sendEvent(event);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                event_id: result.event_id,
                message: 'Approval request sent',
                details: {
                  title: args.title,
                  options: args.options || ['Approve', 'Deny']
                }
              }, null, 2)
            }]
          };
        }

        case 'get_telegram_responses': {
          const limit = args?.limit || 10;
          const responses = await client.getResponses(limit);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                responses,
                count: responses.length,
                message: `Retrieved ${responses.length} responses`
              }, null, 2)
            }]
          };
        }

        case 'get_bridge_status': {
          const status = await client.getBridgeStatus();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(status, null, 2)
            }]
          };
        }

        case 'clear_old_responses': {
          const olderThanHours = args?.older_than_hours || 24;
          const deletedCount = await client.clearOldResponses(olderThanHours);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                deleted_count: deletedCount,
                older_than_hours: olderThanHours,
                message: `Cleared ${deletedCount} old response files`
              }, null, 2)
            }]
          };
        }

        case 'get_resilience_status': {
          const status = await client.getResilienceStatus();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(status, null, 2)
            }]
          };
        }

        case 'get_resilience_health_report': {
          const report = await client.getResilienceHealthReport();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(report, null, 2)
            }]
          };
        }

        case 'get_resilience_metrics': {
          const metrics = client.getResilienceMetrics();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(metrics, null, 2)
            }]
          };
        }

        default: {
          throw new SecurityError(
            `Unknown tool: ${name}`,
            'UNKNOWN_TOOL',
            { operation: 'call_tool', component: 'mcp_server', metadata: { toolName: name } }
          );
        }
      }
      
    } catch (error) {
      secureLog('error', 'Tool execution failed', {
        tool_name: name,
        error: error instanceof Error ? error.message : 'unknown',
        error_type: error instanceof Error ? error.constructor.name : 'unknown'
      });
      
      throw createResilienceError(error, {
        operation: name,
        component: 'mcp_server',
        metadata: { toolName: name, args }
      });
    }
  });
});

// Enhanced resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return await withResilienceAndSecurity(async () => {
    return {
      resources: [
        {
          uri: 'cctelegram://bridge/status',
          name: 'Bridge Status',
          description: 'Current status of the CC Telegram Bridge with resilience metrics',
          mimeType: 'application/json'
        },
        {
          uri: 'cctelegram://bridge/health',
          name: 'Bridge Health',
          description: 'Detailed health information including resilience status',
          mimeType: 'application/json'
        },
        {
          uri: 'cctelegram://resilience/status',
          name: 'Resilience Status',
          description: 'Current resilience system status and metrics',
          mimeType: 'application/json'
        },
        {
          uri: 'cctelegram://resilience/health',
          name: 'Resilience Health Report',
          description: 'Detailed resilience health report with component analysis',
          mimeType: 'application/json'
        },
        {
          uri: 'cctelegram://resilience/metrics',
          name: 'Resilience Metrics',
          description: 'Real-time resilience metrics and performance data',
          mimeType: 'application/json'
        }
      ]
    };
  });
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return await withResilienceAndSecurity(async () => {
    const { uri } = request.params;
    
    switch (uri) {
      case 'cctelegram://bridge/status': {
        const status = await client.getBridgeStatus();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(status, null, 2)
          }]
        };
      }
      
      case 'cctelegram://bridge/health': {
        const status = await client.getBridgeStatus();
        const healthReport = await client.getResilienceHealthReport();
        
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              bridge_status: status,
              resilience_health: healthReport,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
      
      case 'cctelegram://resilience/status': {
        const status = await client.getResilienceStatus();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(status, null, 2)
          }]
        };
      }
      
      case 'cctelegram://resilience/health': {
        const report = await client.getResilienceHealthReport();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(report, null, 2)
          }]
        };
      }
      
      case 'cctelegram://resilience/metrics': {
        const metrics = client.getResilienceMetrics();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(metrics, null, 2)
          }]
        };
      }
      
      default: {
        throw new SecurityError(
          `Unknown resource: ${uri}`,
          'UNKNOWN_RESOURCE',
          { operation: 'read_resource', component: 'mcp_server', metadata: { uri } }
        );
      }
    }
  });
});

// Enhanced error handling and graceful shutdown
const handleShutdown = async (signal: string) => {
  secureLog('info', `Received ${signal}, shutting down gracefully`);
  
  try {
    await client.shutdown();
    secureLog('info', 'Resilient bridge client shutdown completed');
    process.exit(0);
  } catch (error) {
    secureLog('error', 'Error during shutdown', {
      error: error instanceof Error ? error.message : 'unknown'
    });
    process.exit(1);
  }
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Handle uncaught exceptions with resilience
process.on('uncaughtException', (error) => {
  secureLog('error', 'Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  
  // Try graceful shutdown
  handleShutdown('uncaughtException').catch(() => {
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  secureLog('error', 'Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: String(promise)
  });
  
  // Try graceful shutdown
  handleShutdown('unhandledRejection').catch(() => {
    process.exit(1);
  });
});

// Start the server
async function main() {
  try {
    secureLog('info', 'Starting Resilient CCTelegram MCP Server', {
      version: '1.5.0',
      node_version: process.version,
      resilience_enabled: resilienceConfig.enabled !== false
    });
    
    // Initialize server transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    secureLog('info', 'Resilient CCTelegram MCP Server started successfully');
    
  } catch (error) {
    secureLog('error', 'Failed to start server', {
      error: error instanceof Error ? error.message : 'unknown'
    });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
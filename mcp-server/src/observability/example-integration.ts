/**
 * Example Integration
 * 
 * Complete example showing how to integrate the observability system
 * with the CCTelegram MCP Server for production monitoring.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { 
  createObservabilityIntegration
} from './integration.js';
import {
  ObservabilityConfig,
  getDefaultObservabilityConfig 
} from './index.js';
import { secureLog } from '../security.js';

/**
 * Production observability configuration for CCTelegram MCP Server
 */
const PRODUCTION_CONFIG: ObservabilityConfig = {
  ...getDefaultObservabilityConfig(),
  
  // Override defaults for production
  enabled: true,
  environment: 'production',
  serviceName: 'cctelegram-mcp-server',
  serviceVersion: '1.5.0',

  // Enhanced metrics configuration
  metrics: {
    enabled: true,
    port: 9090,
    endpoint: '/metrics',
    interval: 10000,
    retention: 7200000, // 2 hours
    defaultLabels: {
      service: 'cctelegram-mcp-server',
      version: '1.5.0',
      environment: 'production'
    },
    customMetrics: [
      {
        name: 'telegram_messages_total',
        help: 'Total Telegram messages processed',
        type: 'counter',
        labels: ['direction', 'type', 'status']
      },
      {
        name: 'mcp_requests_total',
        help: 'Total MCP requests processed',
        type: 'counter',
        labels: ['method', 'status']
      },
      {
        name: 'mcp_request_duration_seconds',
        help: 'MCP request processing duration',
        type: 'histogram',
        labels: ['method'],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0]
      },
      {
        name: 'active_connections',
        help: 'Number of active connections',
        type: 'gauge',
        labels: ['type']
      }
    ],
    thresholds: [
      {
        metric: 'cpu_usage_percent',
        warning: 70,
        critical: 85,
        duration: 300000 // 5 minutes
      },
      {
        metric: 'memory_usage_percent',
        warning: 75,
        critical: 90,
        duration: 300000 // 5 minutes
      },
      {
        metric: 'error_rate_percent',
        warning: 1,
        critical: 5,
        duration: 60000 // 1 minute
      }
    ]
  },

  // Enhanced logging configuration
  logging: {
    enabled: true,
    level: 'info',
    format: 'json',
    outputs: ['console', 'file'],
    file: {
      filename: 'logs/cctelegram-mcp-server.log',
      maxsize: 100 * 1024 * 1024, // 100MB
      maxFiles: 10
    },
    rotation: {
      enabled: true,
      maxFiles: 10,
      maxSize: '100MB'
    },
    sanitization: {
      enabled: true,
      patterns: [
        /token["\s]*[:=]["\s]*[a-zA-Z0-9_-]+/gi,
        /password["\s]*[:=]["\s]*[a-zA-Z0-9_-]+/gi,
        /secret["\s]*[:=]["\s]*[a-zA-Z0-9_-]+/gi
      ],
      redactFields: ['password', 'token', 'secret', 'key', 'authorization']
    },
    aggregation: {
      enabled: true,
      window: 60000,
      threshold: 10
    }
  },

  // Security monitoring configuration
  security: {
    enabled: true,
    threatDetection: {
      enabled: true,
      suspiciousPatterns: [
        'union.*select',
        'insert.*into',
        'delete.*from',
        'drop.*table',
        '<script.*>',
        'javascript:',
        '\\.\\.\\/\\.\\.\\/'
      ],
      rateLimitThresholds: {
        requests: 100,
        timeWindow: 60000 // 1 minute
      }
    },
    compliance: {
      enabled: true,
      standards: ['SOC2', 'GDPR'],
      reporting: {
        enabled: true,
        interval: 86400000, // Daily
        recipients: ['compliance@company.com']
      }
    },
    incidentResponse: {
      enabled: true,
      escalationRules: [
        {
          condition: 'severity = critical',
          action: 'escalate',
          delay: 0
        },
        {
          condition: 'severity = high',
          action: 'alert',
          delay: 300000 // 5 minutes
        }
      ]
    }
  },

  // Performance monitoring configuration
  performance: {
    enabled: true,
    slaTargets: {
      availability: 99.9,
      responseTime: 500,
      errorRate: 1.0,
      throughput: 100
    },
    profiling: {
      enabled: true,
      heapSnapshots: false, // Disabled in production
      cpuProfile: false,
      interval: 300000 // 5 minutes
    },
    optimization: {
      enabled: true,
      recommendationEngine: true,
      autoTuning: false // Manual approval required
    },
    thresholds: {
      cpu: 85,
      memory: 90,
      responseTime: 2000,
      errorRate: 5
    }
  },

  // Alerting configuration
  alerting: {
    enabled: true,
    channels: [
      {
        name: 'telegram_critical',
        type: 'telegram',
        enabled: true,
        severity: ['critical'],
        config: {
          botToken: process.env.TELEGRAM_BOT_TOKEN,
          chatId: process.env.TELEGRAM_CRITICAL_CHAT_ID
        }
      },
      {
        name: 'telegram_alerts',
        type: 'telegram',
        enabled: true,
        severity: ['high', 'medium'],
        config: {
          botToken: process.env.TELEGRAM_BOT_TOKEN,
          chatId: process.env.TELEGRAM_ALERTS_CHAT_ID
        }
      },
      {
        name: 'email_critical',
        type: 'email',
        enabled: true,
        severity: ['critical'],
        config: {
          smtp: {
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false,
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS
            }
          },
          from: process.env.ALERT_FROM_EMAIL,
          to: [process.env.ALERT_TO_EMAIL]
        }
      }
    ],
    rules: [
      {
        name: 'high_cpu_usage',
        description: 'CPU usage above 80%',
        metric: 'cpu_usage_percent',
        condition: 'gt',
        threshold: 80,
        duration: 300000, // 5 minutes
        severity: 'high',
        enabled: true,
        labels: {},
        annotations: {
          summary: 'High CPU usage detected',
          description: 'CPU usage has been above 80% for 5 minutes'
        }
      },
      {
        name: 'critical_memory_usage',
        description: 'Memory usage above 90%',
        metric: 'memory_usage_percent',
        condition: 'gt',
        threshold: 90,
        duration: 180000, // 3 minutes
        severity: 'critical',
        enabled: true,
        labels: {},
        annotations: {
          summary: 'Critical memory usage detected',
          description: 'Memory usage has been above 90% for 3 minutes'
        }
      },
      {
        name: 'high_error_rate',
        description: 'Error rate above 5%',
        metric: 'error_rate_percent',
        condition: 'gt',
        threshold: 5,
        duration: 60000, // 1 minute
        severity: 'critical',
        enabled: true,
        labels: {},
        annotations: {
          summary: 'High error rate detected',
          description: 'Error rate has been above 5% for 1 minute'
        }
      }
    ],
    escalation: {
      enabled: true,
      levels: [
        {
          level: 0,
          delay: 0,
          channels: ['telegram_alerts']
        },
        {
          level: 1,
          delay: 300000, // 5 minutes
          channels: ['email_critical', 'telegram_critical']
        },
        {
          level: 2,
          delay: 900000, // 15 minutes
          channels: ['pagerduty'] // If configured
        }
      ]
    },
    suppression: {
      enabled: true,
      duplicateWindow: 300000, // 5 minutes
      maxAlertsPerMinute: 10
    },
    recovery: {
      autoResolve: true,
      resolutionTimeout: 3600000 // 1 hour
    }
  },

  // Dashboard configuration
  dashboard: {
    enabled: true,
    port: 8080,
    authentication: {
      enabled: false, // Enable in production with proper credentials
      users: []
    },
    panels: [
      {
        id: 'system_overview',
        title: 'System Overview',
        type: 'stat',
        query: 'up',
        position: { x: 0, y: 0, w: 6, h: 4 }
      },
      {
        id: 'telegram_messages',
        title: 'Telegram Messages',
        type: 'graph',
        query: 'rate(telegram_messages_total[5m])',
        position: { x: 6, y: 0, w: 6, h: 4 }
      },
      {
        id: 'mcp_requests',
        title: 'MCP Requests',
        type: 'graph',
        query: 'rate(mcp_requests_total[5m])',
        position: { x: 0, y: 4, w: 6, h: 4 }
      },
      {
        id: 'response_times',
        title: 'Response Times',
        type: 'graph',
        query: 'histogram_quantile(0.95, mcp_request_duration_seconds)',
        position: { x: 6, y: 4, w: 6, h: 4 }
      }
    ],
    refresh: {
      interval: 5000,
      enabled: true
    }
  },

  // Health checking configuration
  health: {
    enabled: true,
    endpoint: '/health',
    interval: 30000,
    timeout: 5000,
    checks: [
      {
        id: 'memory',
        name: 'Memory Usage',
        type: 'system',
        enabled: true,
        timeout: 1000,
        interval: 30000,
        retryCount: 1,
        critical: true,
        thresholds: { warning: 70, critical: 85 }
      },
      {
        id: 'cpu',
        name: 'CPU Usage',
        type: 'system',
        enabled: true,
        timeout: 1000,
        interval: 30000,
        retryCount: 1,
        critical: true,
        thresholds: { warning: 70, critical: 90 }
      },
      {
        id: 'event_loop',
        name: 'Event Loop Lag',
        type: 'system',
        enabled: true,
        timeout: 1000,
        interval: 15000,
        retryCount: 1,
        critical: true,
        thresholds: { warning: 50, critical: 100 }
      },
      {
        id: 'telegram_bridge',
        name: 'Telegram Bridge',
        type: 'dependency',
        enabled: true,
        timeout: 5000,
        interval: 60000,
        retryCount: 3,
        critical: false,
        thresholds: { warning: 2000, critical: 5000 }
      }
    ]
  },

  // Resilience integration
  resilience: {
    enabled: true,
    metricsIntegration: true,
    alertingIntegration: true
  }
};

/**
 * Enhanced MCP Server with full observability integration
 */
export class ObservableMCPServer {
  private server: Server;
  private observability: any;
  private isShuttingDown: boolean = false;

  constructor() {
    this.server = new Server(
      {
        name: 'cctelegram-mcp-server',
        version: '1.5.0'
      },
      {
        capabilities: {
          resources: {},
          tools: {},
          prompts: {}
        }
      }
    );
  }

  /**
   * Initialize server with observability
   */
  public async initialize(): Promise<void> {
    try {
      // Create observability integration
      this.observability = await createObservabilityIntegration(PRODUCTION_CONFIG);

      // Set up MCP server handlers with observability
      this.setupMCPHandlers();

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      secureLog('info', 'Observable MCP Server initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize Observable MCP Server', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Set up MCP server handlers with observability integration
   */
  private setupMCPHandlers(): void {
    // Wrap tool handlers with observability
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      const toolName = request.params.name;

      try {
        // Record tool call start
        this.observability.manager.getMetrics()?.recordCustomMetric({
          name: 'mcp_tool_calls_total',
          value: 1,
          labels: { tool: toolName, status: 'started' }
        });

        // Start tracing span
        const span = this.observability.manager.getTracing()?.startSpan(`tool_call_${toolName}`, {
          tags: {
            'tool.name': toolName,
            'tool.arguments': JSON.stringify(request.params.arguments)
          }
        });

        // Execute tool (placeholder - implement actual tool logic)
        const result = await this.executeTool(toolName, request.params.arguments || {});

        const duration = Date.now() - startTime;

        // Record successful completion
        this.observability.manager.getMetrics()?.recordCustomMetric({
          name: 'mcp_tool_calls_total',
          value: 1,
          labels: { tool: toolName, status: 'completed' }
        });

        this.observability.manager.getMetrics()?.recordCustomMetric({
          name: 'mcp_request_duration_seconds',
          value: duration / 1000,
          labels: { method: 'tools/call' }
        });

        // Finish tracing span
        if (span) {
          span.setTag('success', true);
          span.setTag('duration_ms', duration);
          span.finish();
        }

        // Log successful tool call
        this.observability.manager.getLogger()?.info('Tool call completed', {
          tool: toolName,
          duration,
          arguments: request.params.arguments || {},
          trace_id: this.observability.manager.getTracing()?.getCurrentTraceId()
        });

        return result;

      } catch (error) {
        const duration = Date.now() - startTime;

        // Record error
        this.observability.manager.getMetrics()?.recordCustomMetric({
          name: 'mcp_tool_calls_total',
          value: 1,
          labels: { tool: toolName, status: 'failed' }
        });

        this.observability.manager.getMetrics()?.recordError('tool_call_error', (error as Error).message, {
          tool: toolName,
          duration
        });

        // Log error
        this.observability.manager.getLogger()?.error('Tool call failed', error as Error, {
          tool: toolName,
          duration,
          arguments: request.params.arguments || {}
        });

        // Call error hook
        this.observability.hooks.onError(error as Error, {
          tool: toolName,
          duration,
          arguments: request.params.arguments || {}
        });

        throw error;
      }
    });

    // Add similar wrappers for other MCP handlers (resources, prompts, etc.)
  }

  /**
   * Execute tool with observability (placeholder implementation)
   */
  private async executeTool(toolName: string, toolArguments: any): Promise<any> {
    // Simulate tool execution
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    
    return {
      content: [
        {
          type: 'text',
          text: `Tool ${toolName} executed successfully with arguments: ${JSON.stringify(toolArguments)}`
        }
      ]
    };
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Start observability system
      await this.observability.hooks.onServerStart();

      // Start MCP server
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      // Record server start
      this.observability.manager.getMetrics()?.recordCustomMetric({
        name: 'server_starts_total',
        value: 1
      });

      secureLog('info', 'Observable MCP Server started successfully', {
        version: '1.5.0',
        observability_enabled: true,
        health_endpoint: '/health',
        metrics_endpoint: '/metrics',
        dashboard_endpoint: '/dashboard'
      });

    } catch (error) {
      secureLog('error', 'Failed to start Observable MCP Server', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Set up graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      secureLog('info', `Received ${signal}, starting graceful shutdown`);

      try {
        // Stop accepting new requests
        // (MCP server doesn't have explicit close method, but transport handles it)

        // Stop observability system
        await this.observability.hooks.onServerStop();

        secureLog('info', 'Graceful shutdown completed');
        process.exit(0);

      } catch (error) {
        secureLog('error', 'Error during graceful shutdown', {
          error: error instanceof Error ? error.message : 'unknown'
        });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart
  }

  /**
   * Get observability manager for external access
   */
  public getObservability(): any {
    return this.observability;
  }
}

/**
 * Main entry point for the observable MCP server
 */
export async function main(): Promise<void> {
  try {
    const server = new ObservableMCPServer();
    await server.initialize();
    await server.start();

  } catch (error) {
    secureLog('error', 'Failed to start Observable MCP Server', {
      error: error instanceof Error ? error.message : 'unknown'
    });
    process.exit(1);
  }
}

// Auto-start if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

/**
 * Example usage for external integration
 */
export function createProductionMCPServer(): ObservableMCPServer {
  return new ObservableMCPServer();
}

/**
 * Example Docker health check endpoint
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:8080/health');
    const health = await response.json();
    return health.status === 'healthy';
  } catch {
    return false;
  }
}
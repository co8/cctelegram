/**
 * Observability Integration
 * 
 * Integration layer that connects the observability system with the main MCP server,
 * providing seamless monitoring, alerting, and health checking capabilities.
 */

import { ObservabilityManager, ObservabilityConfig, getDefaultObservabilityConfig } from './index.js';
import { secureLog } from '../security.js';

export interface ObservabilityIntegration {
  manager: ObservabilityManager;
  middleware: {
    requestTracking: (req: any, res: any, next: any) => void;
    errorHandling: (error: Error, req: any, res: any, next: any) => void;
    performanceMonitoring: (req: any, res: any, next: any) => void;
    securityMonitoring: (req: any, res: any, next: any) => void;
  };
  hooks: {
    onServerStart: () => Promise<void>;
    onServerStop: () => Promise<void>;
    onRequest: (request: any) => void;
    onResponse: (response: any, duration: number) => void;
    onError: (error: Error, context?: any) => void;
    onHealthCheck: () => Promise<{ status: string; details: any }>;
  };
}

/**
 * Create and configure observability integration for MCP server
 */
export async function createObservabilityIntegration(
  customConfig?: Partial<ObservabilityConfig>
): Promise<ObservabilityIntegration> {
  try {
    // Merge default config with custom config
    const defaultConfig = getDefaultObservabilityConfig();
    const config: ObservabilityConfig = {
      ...defaultConfig,
      ...customConfig,
      // Ensure required fields are present
      enabled: customConfig?.enabled ?? defaultConfig.enabled ?? true,
      environment: customConfig?.environment ?? defaultConfig.environment ?? 'development',
      serviceName: customConfig?.serviceName ?? defaultConfig.serviceName ?? 'cctelegram-mcp-server',
      serviceVersion: customConfig?.serviceVersion ?? defaultConfig.serviceVersion ?? '1.5.0'
    } as ObservabilityConfig;

    // Create and initialize observability manager
    const manager = new ObservabilityManager(config);
    await manager.initialize();

    // Create middleware functions
    const middleware = createMiddleware(manager);

    // Create hooks for server integration
    const hooks = createHooks(manager);

    secureLog('info', 'Observability integration created successfully', {
      enabled: config.enabled,
      serviceName: config.serviceName,
      environment: config.environment
    });

    return {
      manager,
      middleware,
      hooks
    };

  } catch (error) {
    secureLog('error', 'Failed to create observability integration', {
      error: error instanceof Error ? error.message : 'unknown'
    });
    throw error;
  }
}

/**
 * Create middleware functions for Express/HTTP server integration
 */
function createMiddleware(manager: ObservabilityManager) {
  return {
    /**
     * Request tracking middleware
     */
    requestTracking: (req: any, res: any, next: any) => {
      const startTime = Date.now();
      const requestId = generateRequestId();
      
      // Add request context
      req.observability = {
        requestId,
        startTime,
        traceId: manager.getTracing()?.getCurrentTraceId()
      };

      // Track request start
      manager.getMetrics()?.recordRequest(req.method, req.url, 'started');

      // Override res.end to capture response
      const originalEnd = res.end;
      res.end = function(chunk: any, encoding: any) {
        const duration = Date.now() - startTime;
        
        // Record request completion
        manager.getMetrics()?.recordRequest(req.method, req.url, 'completed', {
          status_code: res.statusCode,
          duration,
          request_id: requestId
        });

        // Record performance metrics
        manager.getPerformanceMonitor()?.recordRequest(duration, res.statusCode, req.route?.path);

        // Call hooks
        if (manager.integration?.hooks?.onResponse) {
          manager.integration.hooks.onResponse(res, duration);
        }

        originalEnd.call(this, chunk, encoding);
      };

      next();
    },

    /**
     * Error handling middleware
     */
    errorHandling: (error: Error, req: any, res: any, next: any) => {
      const requestId = req.observability?.requestId;
      const duration = req.observability ? Date.now() - req.observability.startTime : 0;

      // Log the error
      manager.getLogger()?.error('Request error', error, {
        request_id: requestId,
        method: req.method,
        url: req.url,
        status_code: res.statusCode,
        duration,
        client_ip: req.ip,
        user_agent: req.get('User-Agent')
      });

      // Record error metrics
      manager.getMetrics()?.recordError(error.name, error.message, {
        request_id: requestId,
        endpoint: req.url,
        method: req.method
      });

      // Record performance impact
      manager.getPerformanceMonitor()?.recordRequest(duration, 500, req.route?.path);

      // Call error hook
      if (manager.integration?.hooks?.onError) {
        manager.integration.hooks.onError(error, {
          requestId,
          method: req.method,
          url: req.url,
          duration
        });
      }

      next(error);
    },

    /**
     * Performance monitoring middleware
     */
    performanceMonitoring: (req: any, res: any, next: any) => {
      const startTime = process.hrtime.bigint();

      // Override res.end to capture performance metrics
      const originalEnd = res.end;
      res.end = function(chunk: any, encoding: any) {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1e6; // Convert to milliseconds

        // Record detailed performance metrics
        const performanceMonitor = manager.getPerformanceMonitor();
        if (performanceMonitor) {
          performanceMonitor.recordRequest(duration, res.statusCode, req.route?.path);
        }

        // Track resource usage
        const memUsage = process.memoryUsage();
        manager.getMetrics()?.recordCustomMetric({
          name: 'request_memory_usage',
          value: memUsage.heapUsed,
          labels: {
            endpoint: req.url,
            method: req.method
          }
        });

        originalEnd.call(this, chunk, encoding);
      };

      next();
    },

    /**
     * Security monitoring middleware
     */
    securityMonitoring: (req: any, res: any, next: any) => {
      const securityMonitor = manager.getSecurityMonitor();
      if (!securityMonitor) {
        next();
        return;
      }

      // Analyze request for security threats
      const analysisResult = securityMonitor.analyzeRequest({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || '',
        userId: req.user?.id,
        sessionId: req.sessionID
      });

      // Handle security threats
      if (analysisResult.threat) {
        secureLog('warn', 'Security threat detected', {
          request_id: req.observability?.requestId,
          threat_events: analysisResult.events.length,
          client_ip: req.ip,
          method: req.method,
          url: req.url
        });

        // Check if request should be blocked
        const shouldBlock = analysisResult.events.some(event => 
          event.severity === 'critical' || event.type === 'injection_attack'
        );

        if (shouldBlock) {
          res.status(403).json({ 
            error: 'Request blocked due to security policy',
            request_id: req.observability?.requestId
          });
          return;
        }
      }

      next();
    }
  };
}

/**
 * Create hooks for server lifecycle integration
 */
function createHooks(manager: ObservabilityManager) {
  return {
    /**
     * Called when server starts
     */
    onServerStart: async (): Promise<void> => {
      try {
        await manager.start();
        
        secureLog('info', 'Observability system started with server', {
          components: manager.getEnabledComponents(),
          health_endpoint: manager.getHealthChecker() ? '/health' : 'disabled'
        });

        // Record server start event
        manager.getMetrics()?.recordCustomMetric({
          name: 'server_starts_total',
          value: 1
        });

      } catch (error) {
        secureLog('error', 'Failed to start observability system', {
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    },

    /**
     * Called when server stops
     */
    onServerStop: async (): Promise<void> => {
      try {
        await manager.stop();
        
        secureLog('info', 'Observability system stopped with server');

      } catch (error) {
        secureLog('error', 'Failed to stop observability system gracefully', {
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    },

    /**
     * Called on each request
     */
    onRequest: (request: any) => {
      // Additional request processing if needed
      const tracing = manager.getTracing();
      if (tracing) {
        const span = tracing.startSpan('http_request', {
          tags: {
            'http.method': request.method,
            'http.url': request.url,
            'http.user_agent': request.headers['user-agent']
          }
        });
        
        request.span = span;
      }
    },

    /**
     * Called on each response
     */
    onResponse: (response: any, duration: number) => {
      // Finish tracing span if exists
      if (response.req?.span) {
        response.req.span.setTag('http.status_code', response.statusCode);
        response.req.span.setTag('duration_ms', duration);
        response.req.span.finish();
      }

      // Update response time metrics
      manager.getMetrics()?.recordCustomMetric({
        name: 'http_response_time_ms',
        value: duration,
        labels: {
          status_code: response.statusCode.toString(),
          method: response.req?.method
        }
      });
    },

    /**
     * Called on errors
     */
    onError: (error: Error, context?: any) => {
      // Record error in tracing
      const currentSpan = manager.getTracing()?.getCurrentSpanId();
      if (currentSpan) {
        manager.getTracing()?.addTags({
          error: true,
          'error.message': error.message,
          'error.stack': error.stack
        });
      }

      // Trigger alerting if configured
      const alerting = manager.getAlerting();
      if (alerting) {
        alerting.processAlert({
          type: 'error',
          source: 'mcp_server',
          timestamp: Date.now(),
          data: {
            error_name: error.name,
            error_message: error.message,
            context
          },
          severity: context?.severity || 'medium'
        });
      }
    },

    /**
     * Called for health checks
     */
    onHealthCheck: async (): Promise<{ status: string; details: any }> => {
      const healthChecker = manager.getHealthChecker();
      if (healthChecker) {
        const health = await healthChecker.getHealthStatus();
        return {
          status: health.status,
          details: {
            uptime: health.uptime,
            checks: health.summary,
            dependencies: health.dependencies.length,
            version: health.version
          }
        };
      }

      return {
        status: 'healthy',
        details: {
          message: 'Health checking disabled'
        }
      };
    }
  };
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Integration helper for Express.js applications
 */
export function integrateWithExpress(app: any, integration: ObservabilityIntegration): void {
  // Add middleware in correct order
  app.use(integration.middleware.requestTracking);
  app.use(integration.middleware.performanceMonitoring);
  app.use(integration.middleware.securityMonitoring);
  
  // Add error handling middleware last
  app.use(integration.middleware.errorHandling);

  // Add health check endpoint
  app.get('/health', async (req: any, res: any) => {
    try {
      const health = await integration.hooks.onHealthCheck();
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: 'Health check failed'
      });
    }
  });

  // Add metrics endpoint if metrics are enabled
  const metrics = integration.manager.getMetrics();
  if (metrics) {
    app.get('/metrics', async (req: any, res: any) => {
      try {
        const metricsData = await metrics.getPrometheusMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metricsData);
      } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve metrics' });
      }
    });
  }

  secureLog('info', 'Observability integrated with Express application', {
    health_endpoint: '/health',
    metrics_endpoint: metrics ? '/metrics' : 'disabled'
  });
}

/**
 * Integration helper for generic HTTP servers
 */
export function integrateWithHttpServer(server: any, integration: ObservabilityIntegration): void {
  // Listen for server events
  server.on('listening', integration.hooks.onServerStart);
  server.on('close', integration.hooks.onServerStop);

  // Wrap request handling
  const originalEmit = server.emit;
  server.emit = function(event: string, ...args: any[]) {
    if (event === 'request') {
      const [req, res] = args;
      integration.hooks.onRequest(req);
      
      // Wrap response end
      const originalEnd = res.end;
      res.end = function(...endArgs: any[]) {
        const duration = Date.now() - (req._startTime || Date.now());
        integration.hooks.onResponse(res, duration);
        return originalEnd.apply(this, endArgs);
      };
    }
    
    return originalEmit.apply(this, [event, ...args]);
  };

  secureLog('info', 'Observability integrated with HTTP server');
}
/**
 * Distributed Tracing Manager
 * 
 * OpenTelemetry-based distributed tracing with automatic instrumentation,
 * context propagation, and multiple exporters support.
 */

import { EventEmitter } from 'events';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FsInstrumentation } from '@opentelemetry/instrumentation-fs';
import * as api from '@opentelemetry/api';
import { TracingConfig, TracingExporter } from '../config.js';
import { secureLog } from '../../security.js';

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'ok' | 'error' | 'timeout';
  tags: Record<string, any>;
  logs: Array<{
    timestamp: number;
    fields: Record<string, any>;
  }>;
  serviceName: string;
  context?: Record<string, any>;
}

export interface TraceMetrics {
  totalSpans: number;
  activeSpans: number;
  errorRate: number;
  averageDuration: number;
  serviceMap: Map<string, Set<string>>;
  operationCounts: Map<string, number>;
  slowestOperations: Array<{ operation: string; duration: number }>;
}

export class TracingManager extends EventEmitter {
  private config: TracingConfig;
  private sdk?: NodeSDK;
  private tracer: api.Tracer;
  private spans: Map<string, SpanData> = new Map();
  private activeSpans: Set<string> = new Set();
  private metrics: TraceMetrics;
  private isInitialized: boolean = false;
  private metricsInterval?: NodeJS.Timeout;

  constructor(config: TracingConfig) {
    super();
    this.config = config;
    this.metrics = this.initializeMetrics();
    
    // Get tracer early for immediate use
    this.tracer = api.trace.getTracer(
      config.serviceName,
      config.serviceVersion
    );

    secureLog('info', 'Tracing manager initialized', {
      enabled: config.enabled,
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      samplingRate: config.samplingRate,
      exporters: config.exporters.filter(e => e.enabled).length
    });
  }

  /**
   * Initialize the tracing system
   */
  public async initialize(): Promise<void> {
    if (!this.config.enabled) {
      secureLog('info', 'Tracing disabled, skipping initialization');
      return;
    }

    try {
      // Create resource with service information
      const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
        [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: process.env.HOSTNAME || 'localhost'
      });

      // Set up instrumentations
      const instrumentations = this.createInstrumentations();

      // Set up exporters
      const traceExporter = this.createTraceExporter();

      // Create and configure SDK
      this.sdk = new NodeSDK({
        resource,
        instrumentations,
        traceExporter,
        sampler: this.createSampler()
      });

      // Start the SDK
      this.sdk.start();

      // Get configured tracer
      this.tracer = api.trace.getTracer(
        this.config.serviceName,
        this.config.serviceVersion
      );

      // Set up context propagation
      this.setupContextPropagation();

      // Start metrics collection
      this.startMetricsCollection();

      this.isInitialized = true;
      secureLog('info', 'Tracing system initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize tracing system', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Initialize metrics structure
   */
  private initializeMetrics(): TraceMetrics {
    return {
      totalSpans: 0,
      activeSpans: 0,
      errorRate: 0,
      averageDuration: 0,
      serviceMap: new Map(),
      operationCounts: new Map(),
      slowestOperations: []
    };
  }

  /**
   * Create instrumentations based on configuration
   */
  private createInstrumentations(): any[] {
    const instrumentations: any[] = [];

    if (this.config.instrumentation.http) {
      instrumentations.push(new HttpInstrumentation({
        requestHook: (span, request) => {
          this.recordSpanStart(span, 'http_request');
        },
        responseHook: (span, response) => {
          this.recordSpanEnd(span);
        }
      }));
    }

    if (this.config.instrumentation.filesystem) {
      instrumentations.push(new FsInstrumentation());
    }

    return instrumentations;
  }

  /**
   * Create trace exporter based on configuration
   */
  private createTraceExporter(): any {
    const enabledExporters = this.config.exporters.filter(e => e.enabled);
    
    if (enabledExporters.length === 0) {
      secureLog('warn', 'No trace exporters enabled');
      return undefined;
    }

    // For now, use the first enabled exporter
    // In a full implementation, we'd support multiple exporters
    const primaryExporter = enabledExporters[0];

    switch (primaryExporter.type) {
      case 'jaeger':
        return new JaegerExporter({
          endpoint: primaryExporter.endpoint || 'http://localhost:14268/api/traces',
          ...primaryExporter.options
        });

      case 'console':
        return new (require('@opentelemetry/exporter-trace-otlp-http').OTLPTraceExporter)({
          url: 'console'
        });

      default:
        secureLog('warn', 'Unknown trace exporter type', { type: primaryExporter.type });
        return undefined;
    }
  }

  /**
   * Create sampler based on configuration
   */
  private createSampler(): any {
    const { TraceIdRatioBasedSampler } = require('@opentelemetry/core');
    return new TraceIdRatioBasedSampler(this.config.samplingRate);
  }

  /**
   * Set up context propagation
   */
  private setupContextPropagation(): void {
    if (this.config.context.propagation) {
      // Context propagation is handled automatically by OpenTelemetry
      // Additional custom propagation logic can be added here
      secureLog('debug', 'Context propagation enabled', {
        headers: this.config.context.headers
      });
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 30000); // Every 30 seconds
  }

  /**
   * Update tracing metrics
   */
  private updateMetrics(): void {
    const now = Date.now();
    const recentSpans = Array.from(this.spans.values())
      .filter(span => span.endTime && (now - span.endTime) < 300000); // Last 5 minutes

    this.metrics.totalSpans = this.spans.size;
    this.metrics.activeSpans = this.activeSpans.size;

    if (recentSpans.length > 0) {
      const errorSpans = recentSpans.filter(span => span.status === 'error');
      this.metrics.errorRate = errorSpans.length / recentSpans.length;

      const durations = recentSpans
        .filter(span => span.duration)
        .map(span => span.duration!);
      
      this.metrics.averageDuration = durations.length > 0 
        ? durations.reduce((sum, d) => sum + d, 0) / durations.length 
        : 0;

      // Update slowest operations
      this.metrics.slowestOperations = recentSpans
        .filter(span => span.duration)
        .sort((a, b) => (b.duration || 0) - (a.duration || 0))
        .slice(0, 10)
        .map(span => ({
          operation: span.operationName,
          duration: span.duration || 0
        }));

      // Update operation counts
      this.metrics.operationCounts.clear();
      recentSpans.forEach(span => {
        const count = this.metrics.operationCounts.get(span.operationName) || 0;
        this.metrics.operationCounts.set(span.operationName, count + 1);
      });
    }

    this.emit('metrics_updated', this.metrics);
  }

  /**
   * Start a new span
   */
  public startSpan(
    operationName: string,
    options?: {
      parent?: api.Span | api.SpanContext;
      tags?: Record<string, any>;
      startTime?: number;
    }
  ): api.Span {
    const spanOptions: api.SpanOptions = {
      startTime: options?.startTime,
      attributes: options?.tags
    };

    if (options?.parent) {
      spanOptions.parent = options.parent;
    }

    const span = this.tracer.startSpan(operationName, spanOptions);
    this.recordSpanStart(span, operationName);
    
    return span;
  }

  /**
   * Record span start
   */
  private recordSpanStart(span: any, operationName: string): void {
    const spanContext = span.spanContext();
    const spanData: SpanData = {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      parentSpanId: span.parentSpanId,
      operationName,
      startTime: Date.now(),
      status: 'ok',
      tags: {},
      logs: [],
      serviceName: this.config.serviceName
    };

    this.spans.set(spanData.spanId, spanData);
    this.activeSpans.add(spanData.spanId);

    this.emit('span_started', spanData);
  }

  /**
   * Record span end
   */
  private recordSpanEnd(span: any): void {
    const spanContext = span.spanContext();
    const spanData = this.spans.get(spanContext.spanId);
    
    if (spanData) {
      spanData.endTime = Date.now();
      spanData.duration = spanData.endTime - spanData.startTime;
      this.activeSpans.delete(spanContext.spanId);

      this.emit('span_finished', spanData);
    }
  }

  /**
   * Record a span (for external use)
   */
  public recordSpan(spanData: Partial<SpanData>): void {
    if (!spanData.spanId || !spanData.operationName) {
      return;
    }

    const fullSpanData: SpanData = {
      traceId: spanData.traceId || this.generateTraceId(),
      spanId: spanData.spanId,
      parentSpanId: spanData.parentSpanId,
      operationName: spanData.operationName,
      startTime: spanData.startTime || Date.now(),
      endTime: spanData.endTime,
      duration: spanData.duration,
      status: spanData.status || 'ok',
      tags: spanData.tags || {},
      logs: spanData.logs || [],
      serviceName: spanData.serviceName || this.config.serviceName,
      context: spanData.context
    };

    this.spans.set(fullSpanData.spanId, fullSpanData);

    if (!fullSpanData.endTime) {
      this.activeSpans.add(fullSpanData.spanId);
    }

    this.emit('span_recorded', fullSpanData);
  }

  /**
   * Get current trace ID
   */
  public getCurrentTraceId(): string | undefined {
    const activeSpan = api.trace.getActiveSpan();
    if (activeSpan) {
      return activeSpan.spanContext().traceId;
    }
    return undefined;
  }

  /**
   * Get current span ID
   */
  public getCurrentSpanId(): string | undefined {
    const activeSpan = api.trace.getActiveSpan();
    if (activeSpan) {
      return activeSpan.spanContext().spanId;
    }
    return undefined;
  }

  /**
   * Get tracer instance
   */
  public getTracer(): api.Tracer {
    return this.tracer;
  }

  /**
   * Create a traced function wrapper
   */
  public traced<T extends (...args: any[]) => any>(
    operationName: string,
    fn: T,
    options?: {
      tags?: Record<string, any>;
      onStart?: (span: api.Span, args: Parameters<T>) => void;
      onEnd?: (span: api.Span, result: ReturnType<T>, error?: Error) => void;
    }
  ): T {
    return ((...args: Parameters<T>): ReturnType<T> => {
      const span = this.startSpan(operationName, {
        tags: options?.tags
      });

      try {
        if (options?.onStart) {
          options.onStart(span, args);
        }

        const result = fn(...args);

        // Handle promises
        if (result && typeof result.then === 'function') {
          return result
            .then((value: any) => {
              if (options?.onEnd) {
                options.onEnd(span, value);
              }
              span.setStatus({ code: api.SpanStatusCode.OK });
              span.end();
              return value;
            })
            .catch((error: Error) => {
              if (options?.onEnd) {
                options.onEnd(span, undefined, error);
              }
              span.setStatus({
                code: api.SpanStatusCode.ERROR,
                message: error.message
              });
              span.recordException(error);
              span.end();
              throw error;
            });
        }

        // Handle synchronous functions
        if (options?.onEnd) {
          options.onEnd(span, result);
        }
        span.setStatus({ code: api.SpanStatusCode.OK });
        span.end();
        return result;

      } catch (error) {
        if (options?.onEnd) {
          options.onEnd(span, undefined, error as Error);
        }
        span.setStatus({
          code: api.SpanStatusCode.ERROR,
          message: (error as Error).message
        });
        span.recordException(error as Error);
        span.end();
        throw error;
      }
    }) as T;
  }

  /**
   * Add tags to current span
   */
  public addTags(tags: Record<string, any>): void {
    const activeSpan = api.trace.getActiveSpan();
    if (activeSpan) {
      Object.entries(tags).forEach(([key, value]) => {
        activeSpan.setAttribute(key, value);
      });

      // Update local span data
      const spanContext = activeSpan.spanContext();
      const spanData = this.spans.get(spanContext.spanId);
      if (spanData) {
        spanData.tags = { ...spanData.tags, ...tags };
      }
    }
  }

  /**
   * Add log to current span
   */
  public addLog(fields: Record<string, any>): void {
    const activeSpan = api.trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent('log', fields);

      // Update local span data
      const spanContext = activeSpan.spanContext();
      const spanData = this.spans.get(spanContext.spanId);
      if (spanData) {
        spanData.logs.push({
          timestamp: Date.now(),
          fields
        });
      }
    }
  }

  /**
   * Generate trace ID
   */
  private generateTraceId(): string {
    return Array.from({ length: 32 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  /**
   * Get all spans
   */
  public getAllSpans(): SpanData[] {
    return Array.from(this.spans.values());
  }

  /**
   * Get spans by trace ID
   */
  public getSpansByTraceId(traceId: string): SpanData[] {
    return Array.from(this.spans.values())
      .filter(span => span.traceId === traceId);
  }

  /**
   * Get trace metrics
   */
  public getMetrics(): TraceMetrics {
    return { ...this.metrics };
  }

  /**
   * Search spans
   */
  public searchSpans(query: {
    operation?: string;
    service?: string;
    minDuration?: number;
    maxDuration?: number;
    status?: string;
    tags?: Record<string, any>;
    timeRange?: { start: number; end: number };
  }): SpanData[] {
    return Array.from(this.spans.values()).filter(span => {
      if (query.operation && !span.operationName.includes(query.operation)) {
        return false;
      }

      if (query.service && span.serviceName !== query.service) {
        return false;
      }

      if (query.minDuration && (!span.duration || span.duration < query.minDuration)) {
        return false;
      }

      if (query.maxDuration && (!span.duration || span.duration > query.maxDuration)) {
        return false;
      }

      if (query.status && span.status !== query.status) {
        return false;
      }

      if (query.tags) {
        for (const [key, value] of Object.entries(query.tags)) {
          if (span.tags[key] !== value) {
            return false;
          }
        }
      }

      if (query.timeRange) {
        if (span.startTime < query.timeRange.start || 
            span.startTime > query.timeRange.end) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get health status
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  }> {
    const details: Record<string, any> = {
      initialized: this.isInitialized,
      enabled: this.config.enabled,
      totalSpans: this.metrics.totalSpans,
      activeSpans: this.metrics.activeSpans,
      errorRate: this.metrics.errorRate,
      averageDuration: this.metrics.averageDuration,
      samplingRate: this.config.samplingRate,
      exportersEnabled: this.config.exporters.filter(e => e.enabled).length
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!this.config.enabled) {
      status = 'degraded';
      details.reason = 'Tracing disabled';
    } else if (!this.isInitialized) {
      status = 'unhealthy';
      details.reason = 'Tracing not initialized';
    } else if (this.metrics.errorRate > 0.1) { // 10% error rate
      status = 'degraded';
      details.reason = 'High error rate in traces';
    }

    return { status, details };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<TracingConfig>): void {
    this.config = { ...this.config, ...config };
    secureLog('info', 'Tracing configuration updated');
  }

  /**
   * Stop the tracing system
   */
  public async stop(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }

    if (this.sdk) {
      await this.sdk.shutdown();
    }

    secureLog('info', 'Tracing system stopped');
  }
}
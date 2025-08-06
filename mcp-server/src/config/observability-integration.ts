/**
 * Configuration Observability Integration
 * 
 * Integrates configuration management with observability stack for comprehensive monitoring,
 * audit logging, metrics collection, and correlation tracking across distributed systems.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { ApplicationConfig } from './config-schema.js';
import { ReloadContext, ReloadResult } from './hot-reload-manager.js';
import { ValidationReport } from './validation-middleware.js';
import { MigrationResult } from './config-migration.js';
import { secureLog } from '../security.js';

export interface ObservabilityOptions {
  enableMetrics?: boolean;
  enableTracing?: boolean;
  enableAuditLog?: boolean;
  enableEventStreaming?: boolean;
  correlationIdHeader?: string;
  metricsPrefix?: string;
  auditLogLevel?: 'info' | 'warn' | 'error';
  retentionPolicy?: {
    metrics: number; // milliseconds
    traces: number;
    auditLogs: number;
    events: number;
  };
}

export interface ConfigurationEvent {
  id: string;
  correlationId: string;
  timestamp: Date;
  type: 'reload' | 'validation' | 'migration' | 'cache_operation' | 'error';
  source: string;
  userId?: string;
  sessionId?: string;
  environment: string;
  metadata: Record<string, any>;
  duration?: number;
  success: boolean;
  error?: string;
}

export interface ConfigurationMetrics {
  reloads: {
    total: number;
    success: number;
    failures: number;
    averageDuration: number;
    lastReload: Date | null;
  };
  validations: {
    total: number;
    passed: number;
    failed: number;
    averageDuration: number;
  };
  migrations: {
    total: number;
    success: number;
    failures: number;
    rollbacks: number;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    invalidations: number;
  };
  errors: {
    total: number;
    byType: Record<string, number>;
    lastError: Date | null;
  };
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tags: Record<string, any>;
  logs: Array<{
    timestamp: Date;
    fields: Record<string, any>;
  }>;
  status: 'success' | 'error' | 'timeout';
  error?: string;
}

export interface AuditLogEntry {
  id: string;
  correlationId: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  operation: string;
  actor: {
    type: 'system' | 'user' | 'service';
    id: string;
    name?: string;
  };
  target: {
    type: 'configuration' | 'schema' | 'migration' | 'cache';
    id: string;
    version?: string;
  };
  context: {
    environment: string;
    session?: string;
    request?: string;
  };
  changes?: {
    before: any;
    after: any;
    diff: string[];
  };
  metadata: Record<string, any>;
  compliance?: {
    regulation: string[];
    retention: number;
    classification: 'public' | 'internal' | 'confidential' | 'restricted';
  };
}

export class ConfigurationObservabilityIntegration extends EventEmitter {
  private options: Required<ObservabilityOptions>;
  private metrics: ConfigurationMetrics;
  private events: ConfigurationEvent[] = [];
  private auditLogs: AuditLogEntry[] = [];
  private activeSpans: Map<string, TraceSpan> = new Map();
  private correlationContext: Map<string, string> = new Map();
  private metricsCollectionTimer?: NodeJS.Timeout;
  private retentionTimer?: NodeJS.Timeout;

  constructor(options: ObservabilityOptions = {}) {
    super();

    this.options = {
      enableMetrics: options.enableMetrics ?? true,
      enableTracing: options.enableTracing ?? true,
      enableAuditLog: options.enableAuditLog ?? true,
      enableEventStreaming: options.enableEventStreaming ?? true,
      correlationIdHeader: options.correlationIdHeader ?? 'x-correlation-id',
      metricsPrefix: options.metricsPrefix ?? 'cctelegram_config',
      auditLogLevel: options.auditLogLevel ?? 'info',
      retentionPolicy: {
        metrics: options.retentionPolicy?.metrics ?? 24 * 60 * 60 * 1000, // 24 hours
        traces: options.retentionPolicy?.traces ?? 7 * 24 * 60 * 60 * 1000, // 7 days
        auditLogs: options.retentionPolicy?.auditLogs ?? 30 * 24 * 60 * 60 * 1000, // 30 days
        events: options.retentionPolicy?.events ?? 7 * 24 * 60 * 60 * 1000 // 7 days
      }
    };

    this.initializeMetrics();
    this.setupRetentionPolicy();
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): void {
    this.metrics = {
      reloads: {
        total: 0,
        success: 0,
        failures: 0,
        averageDuration: 0,
        lastReload: null
      },
      validations: {
        total: 0,
        passed: 0,
        failed: 0,
        averageDuration: 0
      },
      migrations: {
        total: 0,
        success: 0,
        failures: 0,
        rollbacks: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        evictions: 0,
        invalidations: 0
      },
      errors: {
        total: 0,
        byType: {},
        lastError: null
      }
    };

    if (this.options.enableMetrics) {
      this.startMetricsCollection();
    }

    secureLog('debug', 'Configuration observability initialized', {
      metrics: this.options.enableMetrics,
      tracing: this.options.enableTracing,
      audit_log: this.options.enableAuditLog,
      event_streaming: this.options.enableEventStreaming
    });
  }

  /**
   * Start metrics collection timer
   */
  private startMetricsCollection(): void {
    this.metricsCollectionTimer = setInterval(() => {
      this.collectMetrics();
    }, 60000); // Collect metrics every minute
  }

  /**
   * Setup data retention policy
   */
  private setupRetentionPolicy(): void {
    this.retentionTimer = setInterval(() => {
      this.applyRetentionPolicy();
    }, 60 * 60 * 1000); // Run retention cleanup every hour
  }

  /**
   * Generate correlation ID
   */
  public generateCorrelationId(): string {
    return crypto.randomUUID();
  }

  /**
   * Set correlation context
   */
  public setCorrelationContext(correlationId: string, context: string): void {
    this.correlationContext.set(correlationId, context);
  }

  /**
   * Get correlation context
   */
  public getCorrelationContext(correlationId: string): string | undefined {
    return this.correlationContext.get(correlationId);
  }

  /**
   * Track configuration reload event
   */
  public trackConfigurationReload(
    correlationId: string,
    reloadContext: ReloadContext,
    result: ReloadResult
  ): void {
    const event: ConfigurationEvent = {
      id: crypto.randomUUID(),
      correlationId,
      timestamp: new Date(),
      type: 'reload',
      source: 'hot-reload-manager',
      environment: reloadContext.previousConfig.base.environment,
      metadata: {
        trigger: reloadContext.trigger,
        changedFiles: reloadContext.changedFiles,
        appliedChanges: result.appliedChanges,
        preservedConnections: result.preservedConnections,
        reloadId: result.reloadId
      },
      duration: result.duration,
      success: result.success,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined
    };

    this.recordEvent(event);

    // Update metrics
    this.metrics.reloads.total++;
    if (result.success) {
      this.metrics.reloads.success++;
    } else {
      this.metrics.reloads.failures++;
    }
    this.metrics.reloads.lastReload = new Date();
    this.updateAverageDuration('reloads', result.duration);

    // Create audit log entry
    if (this.options.enableAuditLog) {
      this.createAuditLogEntry({
        correlationId,
        operation: 'configuration_reload',
        actor: { type: 'system', id: 'hot-reload-manager' },
        target: { type: 'configuration', id: 'main' },
        context: {
          environment: reloadContext.previousConfig.base.environment
        },
        changes: {
          before: this.sanitizeConfig(reloadContext.previousConfig),
          after: this.sanitizeConfig(reloadContext.newConfig),
          diff: result.appliedChanges
        },
        metadata: {
          trigger: reloadContext.trigger,
          duration: result.duration,
          success: result.success
        }
      });
    }

    secureLog('info', 'Configuration reload tracked', {
      correlation_id: correlationId,
      success: result.success,
      duration: result.duration,
      changes: result.appliedChanges.length
    });
  }

  /**
   * Track configuration validation
   */
  public trackConfigurationValidation(
    correlationId: string,
    config: ApplicationConfig,
    report: ValidationReport,
    duration: number
  ): void {
    const event: ConfigurationEvent = {
      id: crypto.randomUUID(),
      correlationId,
      timestamp: new Date(),
      type: 'validation',
      source: 'validation-middleware',
      environment: config.base.environment,
      metadata: {
        rulesTotal: report.summary.total,
        rulesPassed: report.summary.passed,
        rulesFailed: report.summary.failed,
        warnings: report.summary.warnings,
        errors: report.summary.errors,
        securityIssues: report.securityIssues.length,
        performanceWarnings: report.performanceWarnings.length
      },
      duration,
      success: report.valid
    };

    this.recordEvent(event);

    // Update metrics
    this.metrics.validations.total++;
    if (report.valid) {
      this.metrics.validations.passed++;
    } else {
      this.metrics.validations.failed++;
    }
    this.updateAverageDuration('validations', duration);

    // Create audit log entry for validation failures
    if (!report.valid && this.options.enableAuditLog) {
      this.createAuditLogEntry({
        correlationId,
        operation: 'configuration_validation_failure',
        actor: { type: 'system', id: 'validation-middleware' },
        target: { type: 'configuration', id: 'main' },
        context: {
          environment: config.base.environment
        },
        metadata: {
          errors: report.summary.errors,
          warnings: report.summary.warnings,
          security_issues: report.securityIssues,
          performance_warnings: report.performanceWarnings,
          duration
        }
      });
    }

    secureLog('debug', 'Configuration validation tracked', {
      correlation_id: correlationId,
      valid: report.valid,
      errors: report.summary.errors,
      warnings: report.summary.warnings
    });
  }

  /**
   * Track configuration migration
   */
  public trackConfigurationMigration(
    correlationId: string,
    result: MigrationResult,
    duration: number
  ): void {
    const event: ConfigurationEvent = {
      id: crypto.randomUUID(),
      correlationId,
      timestamp: new Date(),
      type: 'migration',
      source: 'migration-manager',
      environment: 'system',
      metadata: {
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
        appliedMigrations: result.appliedMigrations,
        skippedMigrations: result.skippedMigrations,
        rollbackAvailable: result.rollbackAvailable
      },
      duration,
      success: result.success,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined
    };

    this.recordEvent(event);

    // Update metrics
    this.metrics.migrations.total++;
    if (result.success) {
      this.metrics.migrations.success++;
    } else {
      this.metrics.migrations.failures++;
    }

    // Create audit log entry
    if (this.options.enableAuditLog) {
      this.createAuditLogEntry({
        correlationId,
        operation: 'configuration_migration',
        actor: { type: 'system', id: 'migration-manager' },
        target: { 
          type: 'migration',
          id: `${result.fromVersion}->${result.toVersion}`,
          version: result.toVersion
        },
        context: { environment: 'system' },
        metadata: {
          applied_migrations: result.appliedMigrations,
          skipped_migrations: result.skippedMigrations,
          success: result.success,
          duration,
          rollback_available: result.rollbackAvailable
        }
      });
    }

    secureLog('info', 'Configuration migration tracked', {
      correlation_id: correlationId,
      from_version: result.fromVersion,
      to_version: result.toVersion,
      success: result.success
    });
  }

  /**
   * Track cache operations
   */
  public trackCacheOperation(
    correlationId: string,
    operation: 'hit' | 'miss' | 'set' | 'invalidate' | 'evict',
    key: string,
    metadata: Record<string, any> = {}
  ): void {
    const event: ConfigurationEvent = {
      id: crypto.randomUUID(),
      correlationId,
      timestamp: new Date(),
      type: 'cache_operation',
      source: 'config-cache',
      environment: 'system',
      metadata: {
        operation,
        key,
        ...metadata
      },
      success: true
    };

    this.recordEvent(event);

    // Update cache metrics
    switch (operation) {
      case 'hit':
        this.metrics.cache.hits++;
        break;
      case 'miss':
        this.metrics.cache.misses++;
        break;
      case 'evict':
        this.metrics.cache.evictions++;
        break;
      case 'invalidate':
        this.metrics.cache.invalidations++;
        break;
    }

    // Update hit rate
    const totalRequests = this.metrics.cache.hits + this.metrics.cache.misses;
    this.metrics.cache.hitRate = totalRequests > 0 ? this.metrics.cache.hits / totalRequests : 0;

    secureLog('debug', 'Cache operation tracked', {
      correlation_id: correlationId,
      operation,
      key
    });
  }

  /**
   * Track error events
   */
  public trackError(
    correlationId: string,
    error: Error,
    source: string,
    context: Record<string, any> = {}
  ): void {
    const event: ConfigurationEvent = {
      id: crypto.randomUUID(),
      correlationId,
      timestamp: new Date(),
      type: 'error',
      source,
      environment: context.environment || 'unknown',
      metadata: {
        errorType: error.constructor.name,
        errorMessage: error.message,
        stack: error.stack,
        ...context
      },
      success: false,
      error: error.message
    };

    this.recordEvent(event);

    // Update error metrics
    this.metrics.errors.total++;
    this.metrics.errors.lastError = new Date();
    
    const errorType = error.constructor.name;
    this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1;

    // Create audit log entry for critical errors
    if (this.options.enableAuditLog) {
      this.createAuditLogEntry({
        correlationId,
        operation: 'error_occurrence',
        actor: { type: 'system', id: source },
        target: { type: 'configuration', id: 'system' },
        context: {
          environment: context.environment || 'unknown'
        },
        metadata: {
          error_type: errorType,
          error_message: error.message,
          context
        }
      });
    }

    secureLog('error', 'Error tracked in observability', {
      correlation_id: correlationId,
      error_type: errorType,
      source
    });
  }

  /**
   * Start distributed trace
   */
  public startTrace(
    operationName: string,
    correlationId?: string,
    parentSpanId?: string
  ): TraceSpan {
    if (!this.options.enableTracing) {
      throw new Error('Tracing is not enabled');
    }

    const traceId = correlationId || this.generateCorrelationId();
    const spanId = crypto.randomUUID();

    const span: TraceSpan = {
      traceId,
      spanId,
      parentSpanId,
      operationName,
      startTime: new Date(),
      tags: {},
      logs: [],
      status: 'success'
    };

    this.activeSpans.set(spanId, span);

    secureLog('debug', 'Trace span started', {
      trace_id: traceId,
      span_id: spanId,
      operation: operationName
    });

    return span;
  }

  /**
   * Finish distributed trace
   */
  public finishTrace(
    spanId: string,
    status: 'success' | 'error' | 'timeout' = 'success',
    error?: string
  ): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      return;
    }

    span.endTime = new Date();
    span.duration = span.endTime.getTime() - span.startTime.getTime();
    span.status = status;
    span.error = error;

    this.activeSpans.delete(spanId);

    secureLog('debug', 'Trace span finished', {
      trace_id: span.traceId,
      span_id: spanId,
      duration: span.duration,
      status
    });

    // Emit trace for external collectors
    if (this.options.enableEventStreaming) {
      this.emit('trace', span);
    }
  }

  /**
   * Add tags to trace span
   */
  public addTraceTag(spanId: string, key: string, value: any): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.tags[key] = value;
    }
  }

  /**
   * Add log to trace span
   */
  public addTraceLog(spanId: string, fields: Record<string, any>): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.logs.push({
        timestamp: new Date(),
        fields
      });
    }
  }

  /**
   * Record configuration event
   */
  private recordEvent(event: ConfigurationEvent): void {
    this.events.push(event);

    // Emit event for external processing
    if (this.options.enableEventStreaming) {
      this.emit('configurationEvent', event);
    }

    secureLog('debug', 'Configuration event recorded', {
      event_id: event.id,
      type: event.type,
      success: event.success
    });
  }

  /**
   * Create audit log entry
   */
  private createAuditLogEntry(params: {
    correlationId: string;
    operation: string;
    actor: { type: 'system' | 'user' | 'service'; id: string; name?: string };
    target: { type: 'configuration' | 'schema' | 'migration' | 'cache'; id: string; version?: string };
    context: { environment: string; session?: string; request?: string };
    changes?: { before: any; after: any; diff: string[] };
    metadata: Record<string, any>;
  }): void {
    const auditEntry: AuditLogEntry = {
      id: crypto.randomUUID(),
      correlationId: params.correlationId,
      timestamp: new Date(),
      level: this.options.auditLogLevel,
      operation: params.operation,
      actor: params.actor,
      target: params.target,
      context: params.context,
      changes: params.changes,
      metadata: params.metadata,
      compliance: {
        regulation: ['SOC2', 'ISO27001'],
        retention: this.options.retentionPolicy.auditLogs,
        classification: 'internal'
      }
    };

    this.auditLogs.push(auditEntry);

    // Emit audit log for external systems
    if (this.options.enableEventStreaming) {
      this.emit('auditLog', auditEntry);
    }

    secureLog('info', 'Audit log entry created', {
      audit_id: auditEntry.id,
      correlation_id: params.correlationId,
      operation: params.operation
    });
  }

  /**
   * Sanitize configuration for logging
   */
  private sanitizeConfig(config: ApplicationConfig): any {
    const sensitiveFields = ['password', 'secret', 'key', 'token', 'credential'];
    
    const sanitize = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }

      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = sanitize(value);
        }
      }
      return sanitized;
    };

    return sanitize(config);
  }

  /**
   * Update average duration metric
   */
  private updateAverageDuration(category: 'reloads' | 'validations', newDuration: number): void {
    const current = this.metrics[category].averageDuration;
    const total = this.metrics[category].total;
    
    // Simple moving average
    this.metrics[category].averageDuration = total === 1 ? 
      newDuration : 
      ((current * (total - 1)) + newDuration) / total;
  }

  /**
   * Collect and emit metrics
   */
  private collectMetrics(): void {
    const metricsSnapshot = {
      timestamp: new Date(),
      metrics: { ...this.metrics },
      activeSpans: this.activeSpans.size,
      eventCount: this.events.length,
      auditLogCount: this.auditLogs.length
    };

    if (this.options.enableEventStreaming) {
      this.emit('metrics', metricsSnapshot);
    }

    secureLog('debug', 'Metrics collected', {
      total_events: this.events.length,
      total_audit_logs: this.auditLogs.length,
      active_spans: this.activeSpans.size
    });
  }

  /**
   * Apply data retention policy
   */
  private applyRetentionPolicy(): void {
    const now = Date.now();

    // Clean up old events
    const eventRetention = now - this.options.retentionPolicy.events;
    this.events = this.events.filter(event => 
      event.timestamp.getTime() > eventRetention
    );

    // Clean up old audit logs
    const auditRetention = now - this.options.retentionPolicy.auditLogs;
    this.auditLogs = this.auditLogs.filter(log => 
      log.timestamp.getTime() > auditRetention
    );

    // Clean up correlation context
    this.correlationContext.clear();

    secureLog('debug', 'Retention policy applied', {
      remaining_events: this.events.length,
      remaining_audit_logs: this.auditLogs.length
    });
  }

  /**
   * Get current metrics
   */
  public getMetrics(): ConfigurationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get recent events
   */
  public getRecentEvents(limit: number = 100): ConfigurationEvent[] {
    return this.events
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get recent audit logs
   */
  public getRecentAuditLogs(limit: number = 100): AuditLogEntry[] {
    return this.auditLogs
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get active traces
   */
  public getActiveTraces(): TraceSpan[] {
    return Array.from(this.activeSpans.values());
  }

  /**
   * Export observability data
   */
  public exportObservabilityData(): {
    metrics: ConfigurationMetrics;
    events: ConfigurationEvent[];
    auditLogs: AuditLogEntry[];
    activeSpans: TraceSpan[];
    exportedAt: Date;
  } {
    return {
      metrics: this.getMetrics(),
      events: this.events,
      auditLogs: this.auditLogs,
      activeSpans: this.getActiveTraces(),
      exportedAt: new Date()
    };
  }

  /**
   * Shutdown observability integration
   */
  public async shutdown(): Promise<void> {
    secureLog('info', 'Shutting down configuration observability integration');

    // Clear timers
    if (this.metricsCollectionTimer) {
      clearInterval(this.metricsCollectionTimer);
      this.metricsCollectionTimer = undefined;
    }

    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = undefined;
    }

    // Finish any active spans
    for (const span of this.activeSpans.values()) {
      this.finishTrace(span.spanId, 'timeout', 'System shutdown');
    }

    // Final metrics collection
    this.collectMetrics();

    this.emit('shutdown');
  }
}
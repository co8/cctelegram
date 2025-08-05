/**
 * Structured Logger
 * 
 * Production-grade structured logging with correlation IDs,
 * security sanitization, log aggregation, and multiple outputs.
 */

import { EventEmitter } from 'events';
import * as winston from 'winston';
import * as pino from 'pino';
import * as fs from 'fs-extra';
import * as path from 'path';
import { LoggingConfig, LogOutput } from '../config.js';
import { secureLog } from '../../security.js';

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  service: string;
  version: string;
  environment: string;
  component?: string;
  operation?: string;
  duration?: number;
  metadata?: Record<string, any>;
  tags?: string[];
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface LogContext {
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  component?: string;
  operation?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface LogAggregation {
  pattern: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  level: string;
  examples: LogEntry[];
}

export class StructuredLogger extends EventEmitter {
  private config: LoggingConfig;
  private winston: winston.Logger;
  private pino?: pino.Logger;
  private recentLogs: LogEntry[] = [];
  private aggregations: Map<string, LogAggregation> = new Map();
  private context: LogContext = {};
  private tracer?: any;
  private isInitialized: boolean = false;
  private logRotation?: NodeJS.Timeout;

  // Security patterns for sanitization
  private sensitivePatterns: RegExp[] = [];
  private redactFields: Set<string> = new Set();

  constructor(config: LoggingConfig) {
    super();
    this.config = config;
    this.setupSensitivePatterns();
    this.setupRedactFields();
    this.createWinstonLogger();
    
    if (config.format === 'json') {
      this.createPinoLogger();
    }

    secureLog('info', 'Structured logger initialized', {
      level: config.level,
      format: config.format,
      outputs: config.outputs.length,
      structured: config.structured,
      correlation: config.correlation.enabled
    });
  }

  /**
   * Initialize the logger
   */
  public async initialize(): Promise<void> {
    try {
      // Create log directories
      for (const output of this.config.outputs) {
        if (output.type === 'file' && output.options.filename) {
          const logDir = path.dirname(output.options.filename);
          await fs.ensureDir(logDir);
        }
      }

      // Set up log rotation
      if (this.config.aggregation.enabled) {
        this.setupLogRotation();
      }

      this.isInitialized = true;
      this.log('info', 'Structured logger initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize structured logger', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Set up sensitive data patterns for sanitization
   */
  private setupSensitivePatterns(): void {
    if (this.config.security.sanitization) {
      this.sensitivePatterns = this.config.security.maskPatterns.map(pattern => 
        new RegExp(pattern, 'gi')
      );
    }
  }

  /**
   * Set up fields to redact
   */
  private setupRedactFields(): void {
    this.redactFields = new Set(this.config.security.redactFields);
  }

  /**
   * Create Winston logger
   */
  private createWinstonLogger(): void {
    const transports: winston.transport[] = [];

    for (const output of this.config.outputs) {
      if (!output.enabled) continue;

      switch (output.type) {
        case 'console':
          transports.push(new winston.transports.Console({
            level: output.level || this.config.level,
            format: this.getWinstonFormat(output)
          }));
          break;

        case 'file':
          transports.push(new winston.transports.File({
            filename: output.options.filename,
            level: output.level || this.config.level,
            maxsize: this.parseSize(output.options.maxSize || '100MB'),
            maxFiles: output.options.maxFiles || 10,
            tailable: true,
            format: this.getWinstonFormat(output)
          }));
          break;

        // Additional transport types can be added here
      }
    }

    this.winston = winston.createLogger({
      level: this.config.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports,
      exitOnError: false
    });
  }

  /**
   * Create Pino logger for high-performance JSON logging
   */
  private createPinoLogger(): void {
    const streams: pino.StreamEntry[] = [];

    for (const output of this.config.outputs) {
      if (!output.enabled) continue;

      if (output.type === 'console') {
        streams.push({
          level: (output.level || this.config.level) as pino.Level,
          stream: process.stdout
        });
      } else if (output.type === 'file') {
        streams.push({
          level: (output.level || this.config.level) as pino.Level,
          stream: pino.destination({
            dest: output.options.filename,
            sync: false,
            mkdir: true
          })
        });
      }
    }

    this.pino = pino({
      level: this.config.level,
      formatters: {
        level: (label) => ({ level: label }),
        log: (obj) => this.sanitizeLogObject(obj)
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: {
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res
      }
    }, pino.multistream(streams));
  }

  /**
   * Get Winston format based on output configuration
   */
  private getWinstonFormat(output: LogOutput): winston.Logform.Format {
    const formats: winston.Logform.Format[] = [
      winston.format.timestamp(),
      winston.format.errors({ stack: true })
    ];

    if (this.config.format === 'json' || output.options.format === 'json') {
      formats.push(winston.format.json());
    } else if (this.config.format === 'pretty') {
      formats.push(winston.format.printf((info) => {
        const { timestamp, level, message, ...meta } = info;
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
      }));
    } else {
      formats.push(winston.format.simple());
    }

    return winston.format.combine(...formats);
  }

  /**
   * Parse size string to bytes
   */
  private parseSize(sizeStr: string): number {
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };

    const match = sizeStr.match(/^(\d+)(\w+)$/);
    if (!match) return 100 * 1024 * 1024; // Default 100MB

    const [, size, unit] = match;
    return parseInt(size) * (units[unit.toUpperCase()] || 1);
  }

  /**
   * Set up log rotation and cleanup
   */
  private setupLogRotation(): void {
    this.logRotation = setInterval(() => {
      this.rotateLogs();
      this.cleanupAggregations();
    }, this.config.aggregation.windowSize);
  }

  /**
   * Rotate and cleanup logs
   */
  private rotateLogs(): void {
    const maxLogs = 1000;
    if (this.recentLogs.length > maxLogs) {
      this.recentLogs = this.recentLogs.slice(-maxLogs);
    }
  }

  /**
   * Clean up old aggregations
   */
  private cleanupAggregations(): void {
    const cutoff = Date.now() - this.config.aggregation.windowSize;
    
    for (const [key, aggregation] of this.aggregations) {
      if (aggregation.lastSeen < cutoff) {
        this.aggregations.delete(key);
      }
    }
  }

  /**
   * Set trace context for correlation
   */
  public setTraceContext(tracer: any): void {
    this.tracer = tracer;
  }

  /**
   * Set logging context
   */
  public setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear logging context
   */
  public clearContext(): void {
    this.context = {};
  }

  /**
   * Main logging method
   */
  public log(
    level: string,
    message: string,
    metadata?: Record<string, any>,
    error?: Error
  ): void {
    const entry = this.createLogEntry(level, message, metadata, error);
    
    // Add to recent logs
    this.recentLogs.push(entry);
    
    // Handle aggregation
    if (this.config.aggregation.enabled) {
      this.handleAggregation(entry);
    }

    // Log to Winston
    this.winston.log(level, message, this.sanitizeLogObject({
      ...entry,
      message: this.sanitizeMessage(message)
    }));

    // Log to Pino if available
    if (this.pino) {
      this.pino[level as pino.Level](this.sanitizeLogObject({
        ...entry,
        message: this.sanitizeMessage(message)
      }), this.sanitizeMessage(message));
    }

    // Emit event for listeners
    this.emit('log', entry);

    // Emit alert for high-severity logs
    if (['error', 'fatal'].includes(level)) {
      this.emit('alert', {
        type: 'log',
        level,
        message: this.sanitizeMessage(message),
        timestamp: entry.timestamp,
        metadata: this.sanitizeLogObject(metadata || {})
      });
    }
  }

  /**
   * Create structured log entry
   */
  private createLogEntry(
    level: string,
    message: string,
    metadata?: Record<string, any>,
    error?: Error
  ): LogEntry {
    const now = new Date();
    const correlationId = this.context.correlationId || this.generateCorrelationId();
    
    let traceId = this.context.traceId;
    let spanId = this.context.spanId;

    // Get trace context from tracer if available
    if (this.tracer && this.config.correlation.enabled) {
      const activeSpan = this.tracer.getActiveSpan();
      if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        traceId = spanContext.traceId;
        spanId = spanContext.spanId;
      }
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: now.toISOString(),
      correlationId,
      traceId,
      spanId,
      service: process.env.SERVICE_NAME || 'cctelegram-mcp-server',
      version: process.env.SERVICE_VERSION || '1.5.0',
      environment: process.env.NODE_ENV || 'development',
      component: this.context.component,
      operation: this.context.operation,
      metadata: this.sanitizeLogObject(metadata || {}),
      tags: []
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      };
    }

    if (this.context.metadata) {
      entry.metadata = { ...entry.metadata, ...this.sanitizeLogObject(this.context.metadata) };
    }

    return entry;
  }

  /**
   * Handle log aggregation
   */
  private handleAggregation(entry: LogEntry): void {
    if (!this.config.aggregation.enabled) return;

    const pattern = this.extractPattern(entry.message);
    const key = `${entry.level}:${pattern}`;

    if (this.aggregations.has(key)) {
      const aggregation = this.aggregations.get(key)!;
      aggregation.count++;
      aggregation.lastSeen = Date.now();
      
      if (aggregation.examples.length < 5) {
        aggregation.examples.push(entry);
      }
    } else {
      this.aggregations.set(key, {
        pattern,
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        level: entry.level,
        examples: [entry]
      });
    }

    // Check if aggregation threshold is reached
    const aggregation = this.aggregations.get(key)!;
    if (aggregation.count > this.config.aggregation.maxEntries) {
      this.emit('aggregation_alert', {
        pattern,
        count: aggregation.count,
        level: entry.level,
        timeWindow: Date.now() - aggregation.firstSeen
      });
    }
  }

  /**
   * Extract pattern from log message for aggregation
   */
  private extractPattern(message: string): string {
    // Remove dynamic parts like numbers, UUIDs, timestamps
    return message
      .replace(/\d+/g, 'N')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g, 'TIMESTAMP')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP')
      .replace(/\/[a-zA-Z0-9_/-]+/g, '/PATH')
      .trim();
  }

  /**
   * Sanitize log message
   */
  private sanitizeMessage(message: string): string {
    if (!this.config.security.sanitization) return message;

    let sanitized = message;
    for (const pattern of this.sensitivePatterns) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }

  /**
   * Sanitize log object
   */
  private sanitizeLogObject(obj: any): any {
    if (!this.config.security.sanitization) return obj;

    const sanitized = { ...obj };
    
    const sanitizeValue = (value: any, key?: string): any => {
      if (key && this.redactFields.has(key.toLowerCase())) {
        return '[REDACTED]';
      }

      if (typeof value === 'string') {
        let sanitizedStr = value;
        for (const pattern of this.sensitivePatterns) {
          sanitizedStr = sanitizedStr.replace(pattern, '[REDACTED]');
        }
        return sanitizedStr;
      }

      if (typeof value === 'object' && value !== null) {
        const sanitizedObj: any = Array.isArray(value) ? [] : {};
        for (const [k, v] of Object.entries(value)) {
          sanitizedObj[k] = sanitizeValue(v, k);
        }
        return sanitizedObj;
      }

      return value;
    };

    for (const [key, value] of Object.entries(sanitized)) {
      sanitized[key] = sanitizeValue(value, key);
    }

    return sanitized;
  }

  /**
   * Generate correlation ID
   */
  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log event from observability system
   */
  public logEvent(event: any): void {
    this.log(event.severity || 'info', event.data.message || 'Observability event', {
      event_type: event.type,
      source: event.source,
      correlation_id: event.correlationId,
      ...event.data
    });
  }

  /**
   * Convenience methods for different log levels
   */
  public debug(message: string, metadata?: Record<string, any>): void {
    this.log('debug', message, metadata);
  }

  public info(message: string, metadata?: Record<string, any>): void {
    this.log('info', message, metadata);
  }

  public warn(message: string, metadata?: Record<string, any>): void {
    this.log('warn', message, metadata);
  }

  public error(message: string, error?: Error, metadata?: Record<string, any>): void {
    this.log('error', message, metadata, error);
  }

  public fatal(message: string, error?: Error, metadata?: Record<string, any>): void {
    this.log('fatal', message, metadata, error);
  }

  /**
   * Get recent logs
   */
  public getRecentLogs(limit: number = 100): LogEntry[] {
    return this.recentLogs.slice(-limit);
  }

  /**
   * Get log aggregations
   */
  public getAggregations(): LogAggregation[] {
    return Array.from(this.aggregations.values());
  }

  /**
   * Search logs
   */
  public searchLogs(query: string, limit: number = 50): LogEntry[] {
    const regex = new RegExp(query, 'i');
    return this.recentLogs
      .filter(entry => 
        regex.test(entry.message) || 
        regex.test(JSON.stringify(entry.metadata))
      )
      .slice(-limit);
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
      recentLogsCount: this.recentLogs.length,
      aggregationsCount: this.aggregations.size,
      winstonActive: !!this.winston,
      pinoActive: !!this.pino,
      outputsEnabled: this.config.outputs.filter(o => o.enabled).length
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!this.isInitialized) {
      status = 'unhealthy';
      details.reason = 'Logger not initialized';
    } else if (this.recentLogs.length === 0) {
      status = 'degraded';
      details.reason = 'No recent log activity';
    }

    return { status, details };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<LoggingConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.security) {
      this.setupSensitivePatterns();
      this.setupRedactFields();
    }

    this.info('Logger configuration updated', { updates: Object.keys(config) });
  }

  /**
   * Stop the logger
   */
  public async stop(): Promise<void> {
    if (this.logRotation) {
      clearInterval(this.logRotation);
      this.logRotation = undefined;
    }

    this.winston.close();
    
    if (this.pino) {
      // Pino doesn't have a close method, but we can flush
      await new Promise<void>((resolve) => {
        this.pino?.flush();
        setTimeout(resolve, 100);
      });
    }

    this.info('Structured logger stopped');
  }
}
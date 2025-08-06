/**
 * Logging Utility Module
 * Provides a centralized logging interface using Winston
 */

import * as winston from 'winston';
import * as path from 'path';

export interface LogEntry {
  level: string;
  message: string;
  timestamp?: string;
  [key: string]: any;
}

export interface LoggerConfig {
  level: string;
  enableConsole: boolean;
  enableFile: boolean;
  logDir: string;
  maxFiles: number;
  maxSize: string;
}

/**
 * Default logger configuration
 */
const defaultConfig: LoggerConfig = {
  level: process.env.LOG_LEVEL || 'info',
  enableConsole: process.env.NODE_ENV !== 'test',
  enableFile: true,
  logDir: 'logs',
  maxFiles: 5,
  maxSize: '10m'
};

/**
 * Create logger instance with Winston
 */
function createLogger(config: LoggerConfig = defaultConfig): winston.Logger {
  const transports: winston.transport[] = [];

  // Console transport
  if (config.enableConsole) {
    transports.push(
      new winston.transports.Console({
        level: config.level,
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaString = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}]: ${message}${metaString}`;
          })
        )
      })
    );
  }

  // File transport
  if (config.enableFile) {
    transports.push(
      new winston.transports.File({
        level: config.level,
        filename: path.join(config.logDir, 'app.log'),
        maxFiles: config.maxFiles,
        maxsize: parseInt(config.maxSize.replace('m', '')) * 1024 * 1024,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      })
    );

    // Error log file
    transports.push(
      new winston.transports.File({
        level: 'error',
        filename: path.join(config.logDir, 'error.log'),
        maxFiles: config.maxFiles,
        maxsize: parseInt(config.maxSize.replace('m', '')) * 1024 * 1024,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      })
    );
  }

  return winston.createLogger({
    level: config.level,
    transports,
    exitOnError: false,
    handleExceptions: true,
    handleRejections: true
  });
}

/**
 * Default logger instance
 */
export const logger = createLogger();

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: Record<string, any>, config?: LoggerConfig): winston.Logger {
  const parentLogger = config ? createLogger(config) : logger;
  return parentLogger.child(context);
}

/**
 * Logger utility functions
 */
export const loggerUtils = {
  /**
   * Log performance timing
   */
  timing(label: string, startTime: number): void {
    const duration = Date.now() - startTime;
    logger.debug(`Performance: ${label} took ${duration}ms`);
  },

  /**
   * Log with request context
   */
  request(method: string, url: string, statusCode?: number, duration?: number): void {
    const meta = { method, url, statusCode, duration };
    logger.info('HTTP Request', meta);
  },

  /**
   * Log error with stack trace
   */
  error(message: string, error?: Error, context?: Record<string, any>): void {
    const meta = {
      ...context,
      stack: error?.stack,
      errorMessage: error?.message,
      errorName: error?.name
    };
    logger.error(message, meta);
  },

  /**
   * Log security events
   */
  security(event: string, details: Record<string, any>): void {
    logger.warn(`Security Event: ${event}`, { 
      ...details, 
      timestamp: new Date().toISOString(),
      category: 'security'
    });
  },

  /**
   * Log audit events
   */
  audit(action: string, user?: string, resource?: string, details?: Record<string, any>): void {
    logger.info(`Audit: ${action}`, {
      user,
      resource,
      ...details,
      timestamp: new Date().toISOString(),
      category: 'audit'
    });
  }
};

/**
 * Export logger methods for convenient usage
 */
export const log = {
  debug: (message: string, meta?: any) => logger.debug(message, meta),
  info: (message: string, meta?: any) => logger.info(message, meta),
  warn: (message: string, meta?: any) => logger.warn(message, meta),
  error: (message: string, meta?: any) => logger.error(message, meta),
  timing: loggerUtils.timing,
  request: loggerUtils.request,
  security: loggerUtils.security,
  audit: loggerUtils.audit
};

export default logger;
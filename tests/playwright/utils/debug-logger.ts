/**
 * Debug Logger
 * Provides comprehensive logging for debugging CCTelegram bridge issues
 */

import fs from 'fs/promises';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  data?: any;
}

export class DebugLogger {
  private context: string;
  private verbose: boolean;
  private logLevel: LogLevel;
  private logFile: string | null = null;
  private logEntries: LogEntry[] = [];

  constructor(context: string, verbose: boolean = false, logLevel: LogLevel = LogLevel.INFO) {
    this.context = context;
    this.verbose = verbose;
    this.logLevel = logLevel;

    // Set up log file if verbose logging is enabled
    if (verbose) {
      this.setupLogFile();
    }
  }

  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  // Create a child logger with extended context
  child(childContext: string): DebugLogger {
    const fullContext = `${this.context}:${childContext}`;
    const child = new DebugLogger(fullContext, this.verbose, this.logLevel);
    child.logFile = this.logFile; // Share log file
    return child;
  }

  // Get all log entries
  getLogEntries(): LogEntry[] {
    return [...this.logEntries];
  }

  // Clear log entries
  clearLogs(): void {
    this.logEntries = [];
  }

  // Save logs to file
  async saveLogs(filePath: string): Promise<void> {
    const logContent = this.logEntries
      .map(entry => this.formatLogEntry(entry))
      .join('\n');

    await fs.writeFile(filePath, logContent);
    this.info(`Logs saved to ${filePath}`);
  }

  // Filter logs by level
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logEntries.filter(entry => entry.level >= level);
  }

  // Find logs containing specific text
  findLogs(searchText: string): LogEntry[] {
    return this.logEntries.filter(entry => 
      entry.message.toLowerCase().includes(searchText.toLowerCase())
    );
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      context: this.context,
      data
    };

    this.logEntries.push(logEntry);

    // Console output
    const formattedMessage = this.formatLogEntry(logEntry);
    
    if (this.verbose || level >= LogLevel.WARN) {
      this.outputToConsole(level, formattedMessage);
    }

    // File output
    if (this.logFile && this.verbose) {
      this.outputToFile(formattedMessage);
    }
  }

  private formatLogEntry(entry: LogEntry): string {
    const levelName = LogLevel[entry.level];
    const timestamp = entry.timestamp;
    const context = entry.context ? `[${entry.context}]` : '';
    
    let formatted = `${timestamp} ${levelName.padEnd(5)} ${context} ${entry.message}`;
    
    if (entry.data !== undefined) {
      if (typeof entry.data === 'object') {
        formatted += `\n${JSON.stringify(entry.data, null, 2)}`;
      } else {
        formatted += ` ${entry.data}`;
      }
    }
    
    return formatted;
  }

  private outputToConsole(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(message);
        break;
      case LogLevel.INFO:
        console.log(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
        console.error(message);
        break;
    }
  }

  private outputToFile(message: string): void {
    if (!this.logFile) return;

    // Async file write (fire and forget for performance)
    fs.appendFile(this.logFile, message + '\n').catch(error => {
      console.error('Failed to write to log file:', error);
    });
  }

  private setupLogFile(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `debug-${this.context}-${timestamp}.log`;
    this.logFile = path.join(process.cwd(), 'test-results', 'logs', filename);

    // Ensure log directory exists
    const logDir = path.dirname(this.logFile);
    fs.mkdir(logDir, { recursive: true }).catch(error => {
      console.error('Failed to create log directory:', error);
      this.logFile = null;
    });
  }
}
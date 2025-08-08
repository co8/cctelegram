/**
 * Common utilities for CCTelegram debugging agents
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import {
  TaskMasterStats,
  BridgeProcessState,
  TestEnvironmentState,
  SystemResources,
  LogEntry,
  DataPoint,
  Evidence,
  EvidenceType,
  Component
} from './types';

export class AgentUtilities {
  private static instance: AgentUtilities;
  private logBuffer: LogEntry[] = [];
  
  public static getInstance(): AgentUtilities {
    if (!AgentUtilities.instance) {
      AgentUtilities.instance = new AgentUtilities();
    }
    return AgentUtilities.instance;
  }
  
  /**
   * Parse TaskMaster tasks.json file and extract statistics
   */
  public async parseTaskMasterFile(filePath: string): Promise<TaskMasterStats> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      // Handle both array and object formats
      const tasks = Array.isArray(data) ? data : (data.tasks || []);
      
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t: any) => t.status === 'done' || t.status === 'completed').length;
      const pendingTasks = tasks.filter((t: any) => t.status === 'pending').length;
      const inProgressTasks = tasks.filter((t: any) => t.status === 'in-progress' || t.status === 'in_progress').length;
      const blockedTasks = tasks.filter((t: any) => t.status === 'blocked').length;
      
      // Count subtasks
      let subtasksTotal = 0;
      let subtasksCompleted = 0;
      
      tasks.forEach((task: any) => {
        if (task.subtasks && Array.isArray(task.subtasks)) {
          subtasksTotal += task.subtasks.length;
          subtasksCompleted += task.subtasks.filter((st: any) => 
            st.status === 'done' || st.status === 'completed'
          ).length;
        }
      });
      
      const fileStats = await fs.stat(filePath);
      const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      
      return {
        projectName: this.extractProjectName(filePath),
        taskFile: filePath,
        lastModified: fileStats.mtime,
        totalTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        blockedTasks,
        subtasksTotal,
        subtasksCompleted,
        completionPercentage,
        isLiveData: this.isLiveData(completionPercentage, totalTasks),
        dataSource: 'file'
      };
    } catch (error) {
      throw new Error(`Failed to parse TaskMaster file ${filePath}: ${error}`);
    }
  }
  
  /**
   * Extract task statistics from Telegram message response
   */
  public parseTaskDataFromMessage(message: string): Partial<TaskMasterStats> | null {
    try {
      // Look for pattern: "X/Y tasks, Z%"
      const taskPattern = /(\d+)\/(\d+)\s+tasks,\s+([\d.]+)%/i;
      const match = message.match(taskPattern);
      
      if (match) {
        const completedTasks = parseInt(match[1]);
        const totalTasks = parseInt(match[2]);
        const completionPercentage = parseFloat(match[3]);
        
        return {
          completedTasks,
          totalTasks,
          completionPercentage,
          pendingTasks: totalTasks - completedTasks,
          isLiveData: this.isLiveData(completionPercentage, totalTasks),
          dataSource: this.determineDataSource(completionPercentage, totalTasks)
        };
      }
      
      return null;
    } catch (error) {
      this.log('warn', Component.TEST_FRAMEWORK, `Failed to parse task data from message: ${error}`);
      return null;
    }
  }
  
  /**
   * Check if a process is running on a specific port
   */
  public async checkPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const tester = net.createServer()
        .once('error', () => resolve(true))  // Port in use
        .once('listening', () => {
          tester.once('close', () => resolve(false))  // Port available
            .close();
        })
        .listen(port);
    });
  }
  
  /**
   * Get system resource usage
   */
  public async getSystemResources(): Promise<SystemResources> {
    const os = require('os');
    
    const cpus = os.cpus();
    const totalCpu = cpus.reduce((acc: number, cpu: any) => {
      const total = Object.values(cpu.times).reduce((a: number, b: number) => a + b, 0) as number;
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0);
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    // Check available ports
    const commonPorts = [3000, 3001, 3002, 3003, 8080, 8081, 8082];
    const availablePorts: number[] = [];
    
    for (const port of commonPorts) {
      const inUse = await this.checkPortInUse(port);
      if (!inUse) {
        availablePorts.push(port);
      }
    }
    
    return {
      cpuUsage: Math.round(cpuUsage / cpus.length),
      memoryUsage: Math.round((usedMem / totalMem) * 100),
      diskUsage: 0, // Would need additional system calls
      networkLatency: 0, // Would need network test
      availablePorts
    };
  }
  
  /**
   * Start a process and monitor its state
   */
  public async startProcess(
    command: string, 
    args: string[], 
    options: any = {}
  ): Promise<{ process: ChildProcess; state: BridgeProcessState }> {
    const process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    });
    
    const startTime = Date.now();
    
    const state: BridgeProcessState = {
      pid: process.pid,
      status: 'starting',
      uptime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      lastActivity: new Date(),
      healthPort: 8080,
      webhookPort: 3000,
      logLevel: 'info',
      version: '1.0.0'
    };
    
    // Monitor process state
    process.on('spawn', () => {
      state.status = 'running';
    });
    
    process.on('error', (error) => {
      state.status = 'error';
      this.log('error', Component.RUST_BRIDGE, `Process error: ${error.message}`);
    });
    
    process.on('exit', (code) => {
      state.status = 'stopped';
      this.log('info', Component.RUST_BRIDGE, `Process exited with code ${code}`);
    });
    
    // Capture output for analysis
    if (process.stdout) {
      process.stdout.on('data', (data) => {
        const output = data.toString();
        this.log('info', Component.RUST_BRIDGE, `STDOUT: ${output.trim()}`);
        state.lastActivity = new Date();
      });
    }
    
    if (process.stderr) {
      process.stderr.on('data', (data) => {
        const output = data.toString();
        this.log('warn', Component.RUST_BRIDGE, `STDERR: ${output.trim()}`);
        state.lastActivity = new Date();
      });
    }
    
    // Update uptime periodically
    const uptimeInterval = setInterval(() => {
      if (state.status === 'running') {
        state.uptime = Date.now() - startTime;
      } else {
        clearInterval(uptimeInterval);
      }
    }, 1000);
    
    return { process, state };
  }
  
  /**
   * Wait for a condition to be met with timeout
   */
  public async waitForCondition(
    condition: () => Promise<boolean> | boolean,
    timeoutMs: number = 30000,
    intervalMs: number = 1000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await condition();
        if (result) {
          return true;
        }
      } catch (error) {
        this.log('warn', Component.TEST_FRAMEWORK, `Condition check failed: ${error}`);
      }
      
      await this.sleep(intervalMs);
    }
    
    return false;
  }
  
  /**
   * Create evidence from various sources
   */
  public createEvidence(
    type: EvidenceType,
    description: string,
    data: any,
    source: string,
    reliable: boolean = true
  ): Evidence {
    return {
      type,
      description,
      data,
      source,
      timestamp: new Date(),
      reliable
    };
  }
  
  /**
   * Create a data point for tracking
   */
  public createDataPoint(
    name: string,
    value: any,
    source: string,
    reliable: boolean = true,
    metadata?: Record<string, any>
  ): DataPoint {
    return {
      name,
      value,
      type: this.getValueType(value),
      source,
      timestamp: new Date(),
      reliable,
      metadata
    };
  }
  
  /**
   * Take a screenshot for evidence
   */
  public async takeScreenshot(page: any, filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = join(
      process.cwd(), 
      'test-results', 
      'screenshots', 
      filename || `screenshot-${timestamp}.png`
    );
    
    await fs.mkdir(join(process.cwd(), 'test-results', 'screenshots'), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    return screenshotPath;
  }
  
  /**
   * Save artifacts for later analysis
   */
  public async saveArtifact(filename: string, content: string | Buffer): Promise<string> {
    const artifactPath = join(process.cwd(), 'test-results', 'artifacts', filename);
    await fs.mkdir(join(process.cwd(), 'test-results', 'artifacts'), { recursive: true });
    await fs.writeFile(artifactPath, content);
    return artifactPath;
  }
  
  /**
   * Generate unique session ID
   */
  public generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Sleep for specified milliseconds
   */
  public async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Log a message with timestamp and component
   */
  public log(level: LogEntry['level'], component: Component, message: string, data?: any): void {
    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      component,
      message,
      data
    };
    
    this.logBuffer.push(logEntry);
    
    // Console output for immediate feedback
    const timestamp = logEntry.timestamp.toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] [${component}] ${message}`;
    
    switch (level) {
      case 'error':
        console.error(formattedMessage, data || '');
        break;
      case 'warn':
        console.warn(formattedMessage, data || '');
        break;
      case 'info':
        console.info(formattedMessage, data || '');
        break;
      default:
        console.log(formattedMessage, data || '');
    }
  }
  
  /**
   * Get all logged entries
   */
  public getLogEntries(): LogEntry[] {
    return [...this.logBuffer];
  }
  
  /**
   * Clear log buffer
   */
  public clearLogs(): void {
    this.logBuffer = [];
  }
  
  /**
   * Filter logs by component
   */
  public getLogsByComponent(component: Component): LogEntry[] {
    return this.logBuffer.filter(log => log.component === component);
  }
  
  /**
   * Filter logs by level
   */
  public getLogsByLevel(level: LogEntry['level']): LogEntry[] {
    return this.logBuffer.filter(log => log.level === level);
  }
  
  /**
   * Export logs to file
   */
  public async exportLogs(filename: string): Promise<string> {
    const logPath = join(process.cwd(), 'test-results', 'logs', filename);
    await fs.mkdir(join(process.cwd(), 'test-results', 'logs'), { recursive: true });
    
    const formattedLogs = this.logBuffer.map(log => 
      `[${log.timestamp.toISOString()}] [${log.level.toUpperCase()}] [${log.component}] ${log.message}` +
      (log.data ? `\nData: ${JSON.stringify(log.data, null, 2)}\n` : '')
    ).join('\n');
    
    await fs.writeFile(logPath, formattedLogs);
    return logPath;
  }
  
  private extractProjectName(filePath: string): string {
    const parts = filePath.split('/');
    const taskMasterIndex = parts.findIndex(part => part === '.taskmaster');
    return taskMasterIndex > 0 ? parts[taskMasterIndex - 1] : 'unknown';
  }
  
  private isLiveData(completionPercentage: number, totalTasks: number): boolean {
    // Heuristic: old static data is typically 28/29 tasks (96.55%)
    // Live data is more likely to be 27/30 tasks (90%) or other ratios
    const isStaticPattern = (
      (completionPercentage >= 96.0 && completionPercentage <= 97.0) ||
      (totalTasks === 29 && completionPercentage > 95)
    );
    
    return !isStaticPattern;
  }
  
  private determineDataSource(completionPercentage: number, totalTasks: number): 'file' | 'mcp' | 'cache' | 'unknown' {
    if (this.isLiveData(completionPercentage, totalTasks)) {
      return 'file'; // Likely from fresh file data
    } else {
      return 'cache'; // Likely from stale cache
    }
  }
  
  private getValueType(value: any): 'string' | 'number' | 'boolean' | 'object' | 'array' {
    if (Array.isArray(value)) return 'array';
    if (value === null || value === undefined) return 'object';
    return typeof value as any;
  }
}
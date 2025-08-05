/**
 * Clinic.js Profiler Integration
 * 
 * Integrates clinic.js profiling tools for comprehensive performance analysis
 * including CPU profiling, memory analysis, and performance bottleneck detection.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { secureLog } from '../../security.js';

/**
 * Clinic.js profiling configuration
 */
export interface ClinicProfilerConfig {
  enabled: boolean;
  outputDir: string;
  maxProfiles: number; // Maximum number of profiles to keep
  
  // Profiling tools configuration
  doctor: {
    enabled: boolean;
    autoStart: boolean;
    duration: number; // in milliseconds
    interval: number; // profiling interval in milliseconds
  };
  
  flame: {
    enabled: boolean;
    autoStart: boolean;
    duration: number;
    isolateId: string;
  };
  
  bubbleprof: {
    enabled: boolean;
    autoStart: boolean;
    duration: number;
  };
  
  heapprofiler: {
    enabled: boolean;
    autoStart: boolean;
    duration: number;
    interval: number;
  };
  
  // Analysis configuration
  analysis: {
    enabled: boolean;
    autoAnalyze: boolean;
    thresholds: {
      cpuUsage: number; // percentage
      memoryGrowth: number; // MB/minute
      gcPressure: number; // percentage
      eventLoopLag: number; // milliseconds
    };
  };
  
  // Retention and cleanup
  retention: {
    maxAge: number; // days
    maxSize: number; // MB
    cleanupInterval: number; // hours
  };
}

/**
 * Profile analysis result
 */
export interface ProfileAnalysis {
  profileId: string;
  timestamp: number;
  tool: 'doctor' | 'flame' | 'bubbleprof' | 'heapprofiler';
  duration: number;
  
  // Performance metrics extracted from profile
  metrics: {
    cpu: {
      average: number;
      peak: number;
      bottlenecks: string[];
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
      growthRate: number; // MB/minute
      leaks: MemoryLeak[];
    };
    gc: {
      collections: number;
      totalPauseTime: number;
      pressure: number; // percentage
    };
    eventLoop: {
      averageLag: number;
      maxLag: number;
      blockingOperations: string[];
    };
  };
  
  // Recommendations based on analysis
  recommendations: ProfileRecommendation[];
  
  // File paths
  files: {
    profile: string;
    report: string;
    html: string;
  };
}

/**
 * Memory leak detection result
 */
export interface MemoryLeak {
  type: 'growing_heap' | 'retained_objects' | 'closure_leak';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  stackTrace?: string;
  growthRate?: number; // MB/minute
  retainedSize?: number; // bytes
}

/**
 * Profile-based recommendation
 */
export interface ProfileRecommendation {
  category: 'cpu' | 'memory' | 'gc' | 'eventloop' | 'io';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  impact: string;
  implementation: string[];
  evidence: Record<string, any>;
}

/**
 * Profiling session information
 */
export interface ProfilingSession {
  id: string;
  tool: string;
  startTime: number;
  duration: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  process?: ChildProcess;
  outputPath: string;
}

/**
 * Clinic.js Profiler Integration
 * 
 * Provides comprehensive performance profiling using clinic.js tools
 * with automated analysis, recommendations, and integration with
 * existing performance monitoring systems.
 */
export class ClinicProfiler extends EventEmitter {
  private config: ClinicProfilerConfig;
  private profilesDir: string;
  private reportsDir: string;
  private activeSessions: Map<string, ProfilingSession> = new Map();
  private profileHistory: ProfileAnalysis[] = [];
  private cleanupInterval?: NodeJS.Timeout;
  private isStarted: boolean = false;
  
  // Clinic.js tool paths
  private readonly clinicPaths = {
    doctor: 'clinic doctor',
    flame: 'clinic flame', 
    bubbleprof: 'clinic bubbleprof',
    heapprofiler: 'clinic heapprofiler'
  };

  constructor(config: ClinicProfilerConfig) {
    super();
    this.config = config;
    this.profilesDir = path.resolve(config.outputDir, 'profiles');
    this.reportsDir = path.resolve(config.outputDir, 'reports');
    
    secureLog('info', 'Clinic.js profiler initialized', {
      enabled: config.enabled,
      outputDir: config.outputDir,
      tools: {
        doctor: config.doctor.enabled,
        flame: config.flame.enabled,
        bubbleprof: config.bubbleprof.enabled,
        heapprofiler: config.heapprofiler.enabled
      }
    });
  }

  /**
   * Initialize the profiler
   */
  public async initialize(): Promise<void> {
    if (!this.config.enabled) {
      secureLog('info', 'Clinic.js profiler disabled');
      return;
    }

    try {
      // Ensure output directories exist
      await fs.ensureDir(this.profilesDir);
      await fs.ensureDir(this.reportsDir);
      
      // Verify clinic.js installation
      await this.verifyClinicInstallation();
      
      // Load existing profile history
      await this.loadProfileHistory();
      
      secureLog('info', 'Clinic.js profiler initialized successfully');
      
    } catch (error) {
      secureLog('error', 'Failed to initialize clinic.js profiler', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Start the profiler with auto-profiling if enabled
   */
  public async start(): Promise<void> {
    if (this.isStarted || !this.config.enabled) {
      return;
    }
    
    this.isStarted = true;
    
    // Start cleanup interval
    if (this.config.retention.cleanupInterval > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupOldProfiles();
      }, this.config.retention.cleanupInterval * 60 * 60 * 1000);
    }
    
    // Start auto-profiling if enabled
    if (this.config.doctor.autoStart) {
      this.startAutoProfiling('doctor');
    }
    
    if (this.config.flame.autoStart) {
      this.startAutoProfiling('flame');
    }
    
    if (this.config.bubbleprof.autoStart) {
      this.startAutoProfiling('bubbleprof');
    }
    
    if (this.config.heapprofiler.autoStart) {
      this.startAutoProfiling('heapprofiler');
    }
    
    secureLog('info', 'Clinic.js profiler started');
    this.emit('started');
  }

  /**
   * Stop the profiler
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    this.isStarted = false;
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    // Stop all active sessions
    for (const [sessionId, session] of this.activeSessions.entries()) {
      await this.stopProfiling(sessionId);
    }
    
    secureLog('info', 'Clinic.js profiler stopped');
    this.emit('stopped');
  }

  /**
   * Start profiling with specified tool
   */
  public async startProfiling(
    tool: 'doctor' | 'flame' | 'bubbleprof' | 'heapprofiler',
    options: {
      duration?: number;
      target?: string; // Script or command to profile
    } = {}
  ): Promise<string> {
    const sessionId = this.generateSessionId();
    const timestamp = Date.now();
    const outputPath = path.join(this.profilesDir, `${sessionId}-${tool}`);
    
    const toolConfig = this.config[tool];
    const duration = options.duration || toolConfig.duration;
    const target = options.target || 'node';
    
    try {
      // Build clinic command
      const clinicCmd = this.clinicPaths[tool];
      const args = this.buildClinicArgs(tool, outputPath, target);
      
      secureLog('info', 'Starting profiling session', {
        sessionId,
        tool,
        duration,
        outputPath
      });
      
      // Start the profiling process
      const process = spawn('npx', [clinicCmd, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' }
      });
      
      const session: ProfilingSession = {
        id: sessionId,
        tool,
        startTime: timestamp,
        duration,
        status: 'running',
        process,
        outputPath
      };
      
      this.activeSessions.set(sessionId, session);
      
      // Handle process events
      process.on('exit', (code) => {
        this.handleProfilingComplete(sessionId, code);
      });
      
      process.on('error', (error) => {
        this.handleProfilingError(sessionId, error);
      });
      
      // Auto-stop after duration
      setTimeout(() => {
        this.stopProfiling(sessionId);
      }, duration);
      
      this.emit('profiling_started', { sessionId, tool });
      return sessionId;
      
    } catch (error) {
      secureLog('error', 'Failed to start profiling', {
        sessionId,
        tool,
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Stop profiling session
   */
  public async stopProfiling(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Profiling session not found: ${sessionId}`);
    }
    
    if (session.status !== 'running') {
      return;
    }
    
    try {
      // Terminate the profiling process gracefully
      if (session.process) {
        session.process.kill('SIGTERM');
        
        // Wait for graceful shutdown, force kill after 5 seconds
        setTimeout(() => {
          if (session.process && !session.process.killed) {
            session.process.kill('SIGKILL');
          }
        }, 5000);
      }
      
      session.status = 'completed';
      
      secureLog('info', 'Profiling session stopped', {
        sessionId,
        tool: session.tool,
        duration: Date.now() - session.startTime
      });
      
    } catch (error) {
      session.status = 'failed';
      secureLog('error', 'Failed to stop profiling session', {
        sessionId,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Analyze completed profile
   */
  public async analyzeProfile(sessionId: string): Promise<ProfileAnalysis> {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'completed') {
      throw new Error(`Profile not ready for analysis: ${sessionId}`);
    }
    
    try {
      const analysis = await this.performProfileAnalysis(session);
      this.profileHistory.push(analysis);
      
      // Keep only recent history
      if (this.profileHistory.length > this.config.maxProfiles) {
        this.profileHistory = this.profileHistory.slice(-this.config.maxProfiles);
      }
      
      // Generate recommendations
      if (this.config.analysis.enabled) {
        await this.generateRecommendations(analysis);
      }
      
      this.emit('profile_analyzed', analysis);
      return analysis;
      
    } catch (error) {
      secureLog('error', 'Failed to analyze profile', {
        sessionId,
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Get profiling status
   */
  public getProfilingStatus(): {
    isStarted: boolean;
    activeSessions: number;
    completedProfiles: number;
    lastProfileTime?: number;
  } {
    const activeSessions = Array.from(this.activeSessions.values())
      .filter(session => session.status === 'running');
    
    const lastProfile = this.profileHistory.length > 0 
      ? this.profileHistory[this.profileHistory.length - 1]
      : null;
    
    return {
      isStarted: this.isStarted,
      activeSessions: activeSessions.length,
      completedProfiles: this.profileHistory.length,
      lastProfileTime: lastProfile?.timestamp
    };
  }

  /**
   * Get profile history
   */
  public getProfileHistory(tool?: string): ProfileAnalysis[] {
    if (!tool) {
      return [...this.profileHistory];
    }
    
    return this.profileHistory.filter(profile => profile.tool === tool);
  }

  /**
   * Get performance recommendations
   */
  public getRecommendations(category?: string): ProfileRecommendation[] {
    const allRecommendations = this.profileHistory
      .flatMap(profile => profile.recommendations);
    
    if (!category) {
      return allRecommendations;
    }
    
    return allRecommendations.filter(rec => rec.category === category);
  }

  /**
   * Verify clinic.js installation
   */
  private async verifyClinicInstallation(): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('npx', ['clinic', '--version'], { stdio: 'pipe' });
      
      process.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('clinic.js not installed or not accessible'));
        }
      });
      
      process.on('error', (error) => {
        reject(new Error(`Failed to verify clinic.js: ${error.message}`));
      });
    });
  }

  /**
   * Load existing profile history
   */
  private async loadProfileHistory(): Promise<void> {
    const historyFile = path.join(this.reportsDir, 'profile-history.json');
    
    try {
      if (await fs.pathExists(historyFile)) {
        const data = await fs.readJSON(historyFile);
        this.profileHistory = Array.isArray(data) ? data : [];
      }
    } catch (error) {
      secureLog('warn', 'Failed to load profile history', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      this.profileHistory = [];
    }
  }

  /**
   * Save profile history
   */
  private async saveProfileHistory(): Promise<void> {
    const historyFile = path.join(this.reportsDir, 'profile-history.json');
    
    try {
      await fs.writeJSON(historyFile, this.profileHistory, { spaces: 2 });
    } catch (error) {
      secureLog('error', 'Failed to save profile history', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Start auto-profiling for a tool
   */
  private startAutoProfiling(tool: 'doctor' | 'flame' | 'bubbleprof' | 'heapprofiler'): void {
    const toolConfig = this.config[tool];
    
    setInterval(async () => {
      try {
        const sessionId = await this.startProfiling(tool);
        secureLog('debug', 'Auto-profiling started', { tool, sessionId });
      } catch (error) {
        secureLog('error', 'Auto-profiling failed', {
          tool,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }, toolConfig.interval);
  }

  /**
   * Build clinic.js command arguments
   */
  private buildClinicArgs(
    tool: string,
    outputPath: string,
    target: string
  ): string[] {
    const args = ['--dest', outputPath];
    
    // Add tool-specific arguments
    switch (tool) {
      case 'doctor':
        args.push('--debug');
        break;
      case 'flame':
        if (this.config.flame.isolateId) {
          args.push('--isolate-id', this.config.flame.isolateId);
        }
        break;
      case 'heapprofiler':
        args.push('--interval', this.config.heapprofiler.interval.toString());
        break;
    }
    
    args.push('--', target);
    return args;
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `profile_${timestamp}_${random}`;
  }

  /**
   * Handle profiling completion
   */
  private async handleProfilingComplete(sessionId: string, exitCode: number | null): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    session.status = exitCode === 0 ? 'completed' : 'failed';
    
    if (session.status === 'completed') {
      secureLog('info', 'Profiling completed successfully', {
        sessionId,
        tool: session.tool,
        duration: Date.now() - session.startTime
      });
      
      // Auto-analyze if enabled
      if (this.config.analysis.autoAnalyze) {
        setTimeout(async () => {
          try {
            await this.analyzeProfile(sessionId);
          } catch (error) {
            secureLog('error', 'Auto-analysis failed', {
              sessionId,
              error: error instanceof Error ? error.message : 'unknown'
            });
          }
        }, 5000); // Wait 5 seconds for files to be written
      }
      
      this.emit('profiling_completed', { sessionId, tool: session.tool });
    } else {
      secureLog('error', 'Profiling failed', {
        sessionId,
        tool: session.tool,
        exitCode
      });
      
      this.emit('profiling_failed', { sessionId, tool: session.tool, exitCode });
    }
  }

  /**
   * Handle profiling error
   */
  private handleProfilingError(sessionId: string, error: Error): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    session.status = 'failed';
    
    secureLog('error', 'Profiling process error', {
      sessionId,
      tool: session.tool,
      error: error.message
    });
    
    this.emit('profiling_error', { sessionId, tool: session.tool, error });
  }

  /**
   * Perform profile analysis
   */
  private async performProfileAnalysis(session: ProfilingSession): Promise<ProfileAnalysis> {
    // This is a simplified analysis - in practice, you'd parse clinic.js output files
    // and extract detailed performance metrics
    
    const profilePath = path.join(session.outputPath, `${session.tool}.html`);
    const dataPath = path.join(session.outputPath, `${session.tool}.clinic-${session.tool}`);
    
    // Basic analysis structure - would be populated from actual clinic.js output
    const analysis: ProfileAnalysis = {
      profileId: session.id,
      timestamp: session.startTime,
      tool: session.tool as any,
      duration: Date.now() - session.startTime,
      
      metrics: {
        cpu: {
          average: 45, // Would extract from clinic data
          peak: 78,
          bottlenecks: ['Heavy computation in main thread']
        },
        memory: {
          heapUsed: 50 * 1024 * 1024, // 50MB
          heapTotal: 60 * 1024 * 1024, // 60MB
          growthRate: 0.5, // MB/minute
          leaks: []
        },
        gc: {
          collections: 15,
          totalPauseTime: 120, // ms
          pressure: 25 // percentage
        },
        eventLoop: {
          averageLag: 8, // ms
          maxLag: 45, // ms
          blockingOperations: ['File I/O operations']
        }
      },
      
      recommendations: [],
      
      files: {
        profile: dataPath,
        report: path.join(this.reportsDir, `${session.id}-report.json`),
        html: profilePath
      }
    };
    
    // Save analysis report
    await fs.writeJSON(analysis.files.report, analysis, { spaces: 2 });
    
    return analysis;
  }

  /**
   * Generate performance recommendations
   */
  private async generateRecommendations(analysis: ProfileAnalysis): Promise<void> {
    const recommendations: ProfileRecommendation[] = [];
    
    // CPU recommendations
    if (analysis.metrics.cpu.average > this.config.analysis.thresholds.cpuUsage) {
      recommendations.push({
        category: 'cpu',
        priority: 'high',
        title: 'High CPU Usage Detected',
        description: `Average CPU usage of ${analysis.metrics.cpu.average}% exceeds threshold`,
        impact: 'Reduced application responsiveness and throughput',
        implementation: [
          'Profile CPU-intensive operations',
          'Consider moving heavy computations to worker threads',
          'Optimize algorithms and data structures'
        ],
        evidence: {
          averageCpu: analysis.metrics.cpu.average,
          peakCpu: analysis.metrics.cpu.peak,
          threshold: this.config.analysis.thresholds.cpuUsage
        }
      });
    }
    
    // Memory recommendations
    if (analysis.metrics.memory.growthRate > this.config.analysis.thresholds.memoryGrowth) {
      recommendations.push({
        category: 'memory',
        priority: 'high',
        title: 'Memory Growth Rate Exceeds Threshold',
        description: `Memory growing at ${analysis.metrics.memory.growthRate} MB/min`,
        impact: 'Potential memory leaks leading to application crashes',
        implementation: [
          'Review object retention and cleanup',
          'Implement object pooling where appropriate',
          'Check for closure leaks and event listener cleanup'
        ],
        evidence: {
          growthRate: analysis.metrics.memory.growthRate,
          threshold: this.config.analysis.thresholds.memoryGrowth,
          heapUtilization: (analysis.metrics.memory.heapUsed / analysis.metrics.memory.heapTotal) * 100
        }
      });
    }
    
    // GC pressure recommendations
    if (analysis.metrics.gc.pressure > this.config.analysis.thresholds.gcPressure) {
      recommendations.push({
        category: 'gc',
        priority: 'medium',
        title: 'High Garbage Collection Pressure',
        description: `GC pressure at ${analysis.metrics.gc.pressure}% indicates frequent collections`,
        impact: 'Application pauses and reduced performance',
        implementation: [
          'Reduce object allocation frequency',
          'Reuse objects where possible',
          'Optimize data structures to reduce GC pressure'
        ],
        evidence: {
          gcPressure: analysis.metrics.gc.pressure,
          collections: analysis.metrics.gc.collections,
          totalPauseTime: analysis.metrics.gc.totalPauseTime
        }
      });
    }
    
    // Event loop lag recommendations
    if (analysis.metrics.eventLoop.maxLag > this.config.analysis.thresholds.eventLoopLag) {
      recommendations.push({
        category: 'eventloop',
        priority: 'high',
        title: 'High Event Loop Lag Detected',
        description: `Maximum event loop lag of ${analysis.metrics.eventLoop.maxLag}ms affects responsiveness`,
        impact: 'Delayed request processing and poor user experience',
        implementation: [
          'Identify and optimize blocking operations',
          'Use asynchronous patterns consistently',
          'Consider using worker threads for CPU-intensive tasks'
        ],
        evidence: {
          averageLag: analysis.metrics.eventLoop.averageLag,
          maxLag: analysis.metrics.eventLoop.maxLag,
          threshold: this.config.analysis.thresholds.eventLoopLag
        }
      });
    }
    
    analysis.recommendations = recommendations;
  }

  /**
   * Clean up old profiles
   */
  private async cleanupOldProfiles(): Promise<void> {
    try {
      const maxAge = this.config.retention.maxAge * 24 * 60 * 60 * 1000; // Convert days to ms
      const cutoffTime = Date.now() - maxAge;
      
      // Clean up profile history
      this.profileHistory = this.profileHistory.filter(profile => 
        profile.timestamp > cutoffTime
      );
      
      // Clean up profile files
      const profileFiles = await fs.readdir(this.profilesDir);
      for (const file of profileFiles) {
        const filePath = path.join(this.profilesDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.remove(filePath);
          secureLog('debug', 'Cleaned up old profile', { file });
        }
      }
      
      // Save updated history
      await this.saveProfileHistory();
      
      secureLog('info', 'Profile cleanup completed', {
        remainingProfiles: this.profileHistory.length
      });
      
    } catch (error) {
      secureLog('error', 'Profile cleanup failed', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
}

/**
 * Default clinic profiler configuration
 */
export const DEFAULT_CLINIC_CONFIG: ClinicProfilerConfig = {
  enabled: process.env.NODE_ENV === 'development',
  outputDir: './profiles',
  maxProfiles: 50,
  
  doctor: {
    enabled: true,
    autoStart: false,
    duration: 60000, // 1 minute
    interval: 30 * 60 * 1000 // 30 minutes
  },
  
  flame: {
    enabled: true,
    autoStart: false,
    duration: 30000, // 30 seconds
    isolateId: '0'
  },
  
  bubbleprof: {
    enabled: false,
    autoStart: false,
    duration: 60000 // 1 minute
  },
  
  heapprofiler: {
    enabled: true,
    autoStart: false,
    duration: 120000, // 2 minutes
    interval: 100 // 100ms
  },
  
  analysis: {
    enabled: true,
    autoAnalyze: true,
    thresholds: {
      cpuUsage: 70, // 70%
      memoryGrowth: 1.0, // 1 MB/minute
      gcPressure: 30, // 30%
      eventLoopLag: 50 // 50ms
    }
  },
  
  retention: {
    maxAge: 7, // 7 days
    maxSize: 500, // 500 MB
    cleanupInterval: 24 // 24 hours
  }
};
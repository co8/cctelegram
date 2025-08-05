/**
 * Event File Cleanup Automation
 * 
 * Automated cleanup system for event files based on age, size, and count thresholds.
 * Prevents accumulation of old files and maintains optimal disk usage.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { EventEmitter } from 'events';
import { FileSystemOptimizer } from './fs-optimizer.js';
import { secureLog } from '../security.js';

/**
 * Cleanup policy configuration
 */
export interface CleanupPolicy {
  // Age-based cleanup
  maxAge?: {
    enabled: boolean;
    thresholdMs: number; // milliseconds
    deleteOlderThan: number; // days
  };
  
  // Size-based cleanup  
  maxSize?: {
    enabled: boolean;
    thresholdBytes: number; // bytes
    targetSizeBytes: number; // target size after cleanup
  };
  
  // Count-based cleanup
  maxCount?: {
    enabled: boolean;
    maxFiles: number;
    targetCount: number; // target count after cleanup
  };
  
  // File patterns
  filePatterns: string[]; // glob patterns for files to consider
  excludePatterns?: string[]; // patterns to exclude
  
  // Safety and performance
  batchSize: number; // files processed per batch
  dryRun: boolean; // preview mode
  preserveMostRecent: number; // always keep N most recent files
}

/**
 * Cleanup schedule configuration
 */
export interface CleanupSchedule {
  enabled: boolean;
  intervalMs: number; // cleanup interval in milliseconds
  runOnStart: boolean; // run cleanup when automator starts
  maxConcurrentRuns: number; // prevent overlapping runs
}

/**
 * Cleanup execution result
 */
export interface CleanupResult {
  timestamp: number;
  duration: number;
  processed: {
    scanned: number;
    eligible: number;
    deleted: number;
    errors: number;
  };
  sizeBefore: number;
  sizeAfter: number;
  spaceSaved: number;
  errors: Array<{
    file: string;
    error: string;
  }>;
  dryRun: boolean;
}

/**
 * Directory cleanup statistics
 */
export interface DirectoryStats {
  totalFiles: number;
  totalSize: number;
  oldestFile: string | null;
  newestFile: string | null;
  avgFileAge: number;
  largestFile: { name: string; size: number };
}

/**
 * Event File Cleanup Automator
 * 
 * Provides automated cleanup of event files based on configurable policies.
 * Integrates with existing FileSystemOptimizer for efficient operations.
 */
export class EventFileCleanupAutomator extends EventEmitter {
  private fsOptimizer: FileSystemOptimizer;
  private cleanupPolicies: Map<string, CleanupPolicy> = new Map();
  private schedules: Map<string, CleanupSchedule> = new Map();
  private scheduledJobs: Map<string, NodeJS.Timeout> = new Map();
  private runningCleanups: Set<string> = new Set();
  private isStarted: boolean = false;
  
  // Performance tracking
  private cleanupHistory: CleanupResult[] = [];
  private readonly maxHistoryEntries = 100;
  
  constructor(fsOptimizer?: FileSystemOptimizer) {
    super();
    this.fsOptimizer = fsOptimizer || new FileSystemOptimizer();
    
    secureLog('info', 'Event file cleanup automator initialized');
  }

  /**
   * Add cleanup policy for a directory
   */
  public addCleanupPolicy(directory: string, policy: CleanupPolicy, schedule?: CleanupSchedule): void {
    const normalizedDir = path.resolve(directory);
    
    // Validate policy
    this.validateCleanupPolicy(policy);
    
    this.cleanupPolicies.set(normalizedDir, policy);
    
    if (schedule) {
      this.schedules.set(normalizedDir, schedule);
    }
    
    // Start scheduled cleanup if automator is running
    if (this.isStarted && schedule?.enabled) {
      this.scheduleCleanup(normalizedDir, schedule);
    }
    
    secureLog('info', 'Cleanup policy added', {
      directory: normalizedDir,
      hasSchedule: !!schedule,
      dryRun: policy.dryRun
    });
  }

  /**
   * Remove cleanup policy for a directory
   */
  public removeCleanupPolicy(directory: string): void {
    const normalizedDir = path.resolve(directory);
    
    // Stop scheduled cleanup
    const scheduledJob = this.scheduledJobs.get(normalizedDir);
    if (scheduledJob) {
      clearInterval(scheduledJob);
      this.scheduledJobs.delete(normalizedDir);
    }
    
    this.cleanupPolicies.delete(normalizedDir);
    this.schedules.delete(normalizedDir);
    
    secureLog('info', 'Cleanup policy removed', { directory: normalizedDir });
  }

  /**
   * Start the cleanup automator
   */
  public async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }
    
    this.isStarted = true;
    
    // Start scheduled cleanups
    for (const [directory, schedule] of this.schedules.entries()) {
      if (schedule.enabled) {
        this.scheduleCleanup(directory, schedule);
        
        // Run immediately if configured
        if (schedule.runOnStart) {
          setImmediate(() => this.runCleanup(directory));
        }
      }
    }
    
    secureLog('info', 'Event file cleanup automator started', {
      policies: this.cleanupPolicies.size,
      schedules: this.schedules.size
    });
    
    this.emit('started');
  }

  /**
   * Stop the cleanup automator
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    this.isStarted = false;
    
    // Clear all scheduled jobs
    for (const [directory, job] of this.scheduledJobs.entries()) {
      clearInterval(job);
    }
    this.scheduledJobs.clear();
    
    // Wait for running cleanups to complete
    while (this.runningCleanups.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    secureLog('info', 'Event file cleanup automator stopped');
    this.emit('stopped');
  }

  /**
   * Run cleanup for a specific directory
   */
  public async runCleanup(directory: string): Promise<CleanupResult> {
    const normalizedDir = path.resolve(directory);
    const policy = this.cleanupPolicies.get(normalizedDir);
    
    if (!policy) {
      throw new Error(`No cleanup policy found for directory: ${directory}`);
    }
    
    // Check for concurrent runs
    const schedule = this.schedules.get(normalizedDir);
    if (schedule && this.runningCleanups.size >= schedule.maxConcurrentRuns) {
      throw new Error(`Maximum concurrent cleanups reached for: ${directory}`);
    }
    
    if (this.runningCleanups.has(normalizedDir)) {
      throw new Error(`Cleanup already running for: ${directory}`);
    }
    
    this.runningCleanups.add(normalizedDir);
    
    try {
      const result = await this.executeCleanup(normalizedDir, policy);
      this.addToHistory(result);
      
      secureLog('info', 'Cleanup completed', {
        directory: normalizedDir,
        deleted: result.processed.deleted,
        spaceSaved: result.spaceSaved,
        duration: result.duration,
        dryRun: result.dryRun
      });
      
      this.emit('cleanup_completed', result);
      return result;
      
    } finally {
      this.runningCleanups.delete(normalizedDir);
    }
  }

  /**
   * Get directory statistics
   */
  public async getDirectoryStats(directory: string): Promise<DirectoryStats> {
    const policy = this.cleanupPolicies.get(path.resolve(directory));
    if (!policy) {
      throw new Error(`No cleanup policy found for directory: ${directory}`);
    }
    
    const { files, fileStats } = await this.fsOptimizer.getFilteredFiles(directory, {
      extensions: this.getFileExtensions(policy.filePatterns)
    });
    
    if (files.length === 0) {
      return {
        totalFiles: 0,
        totalSize: 0,
        oldestFile: null,
        newestFile: null,
        avgFileAge: 0,
        largestFile: { name: '', size: 0 }
      };
    }
    
    let totalSize = 0;
    let oldestTime = Date.now();
    let newestTime = 0;
    let oldestFile = '';
    let newestFile = '';
    let largestFile = { name: '', size: 0 };
    
    for (const [fileName, stats] of fileStats.entries()) {
      totalSize += stats.size;
      
      const mtime = stats.mtime.getTime();
      if (mtime < oldestTime) {
        oldestTime = mtime;
        oldestFile = fileName;
      }
      if (mtime > newestTime) {
        newestTime = mtime;
        newestFile = fileName;
      }
      
      if (stats.size > largestFile.size) {
        largestFile = { name: fileName, size: stats.size };
      }
    }
    
    const avgFileAge = files.length > 0 ? (Date.now() - (oldestTime + newestTime) / 2) : 0;
    
    return {
      totalFiles: files.length,
      totalSize,
      oldestFile,
      newestFile,
      avgFileAge,
      largestFile
    };
  }

  /**
   * Get cleanup history
   */
  public getCleanupHistory(directory?: string): CleanupResult[] {
    if (!directory) {
      return [...this.cleanupHistory];
    }
    
    const normalizedDir = path.resolve(directory);
    return this.cleanupHistory.filter(result => 
      result.toString().includes(normalizedDir)
    );
  }

  /**
   * Get current status
   */
  public getStatus(): {
    isStarted: boolean;
    runningCleanups: string[];
    policies: number;
    schedules: number;
    historyEntries: number;
  } {
    return {
      isStarted: this.isStarted,
      runningCleanups: Array.from(this.runningCleanups),
      policies: this.cleanupPolicies.size,
      schedules: this.schedules.size,
      historyEntries: this.cleanupHistory.length
    };
  }

  /**
   * Validate cleanup policy
   */
  private validateCleanupPolicy(policy: CleanupPolicy): void {
    if (!policy.filePatterns || policy.filePatterns.length === 0) {
      throw new Error('Cleanup policy must specify file patterns');
    }
    
    if (policy.batchSize <= 0) {
      throw new Error('Batch size must be positive');
    }
    
    if (policy.preserveMostRecent < 0) {
      throw new Error('Preserve most recent count cannot be negative');
    }
    
    // Validate age policy
    if (policy.maxAge?.enabled) {
      if (policy.maxAge.thresholdMs <= 0 || policy.maxAge.deleteOlderThan <= 0) {
        throw new Error('Age policy thresholds must be positive');
      }
    }
    
    // Validate size policy
    if (policy.maxSize?.enabled) {
      if (policy.maxSize.thresholdBytes <= 0 || policy.maxSize.targetSizeBytes <= 0) {
        throw new Error('Size policy thresholds must be positive');
      }
      if (policy.maxSize.targetSizeBytes >= policy.maxSize.thresholdBytes) {
        throw new Error('Target size must be less than threshold size');
      }
    }
    
    // Validate count policy
    if (policy.maxCount?.enabled) {
      if (policy.maxCount.maxFiles <= 0 || policy.maxCount.targetCount <= 0) {
        throw new Error('Count policy thresholds must be positive');
      }
      if (policy.maxCount.targetCount >= policy.maxCount.maxFiles) {
        throw new Error('Target count must be less than max files');
      }
    }
  }

  /**
   * Schedule cleanup for a directory
   */
  private scheduleCleanup(directory: string, schedule: CleanupSchedule): void {
    // Clear existing schedule
    const existingJob = this.scheduledJobs.get(directory);
    if (existingJob) {
      clearInterval(existingJob);
    }
    
    // Create new scheduled job
    const job = setInterval(async () => {
      try {
        await this.runCleanup(directory);
      } catch (error) {
        secureLog('error', 'Scheduled cleanup failed', {
          directory,
          error: error instanceof Error ? error.message : 'unknown'
        });
        this.emit('cleanup_error', { directory, error });
      }
    }, schedule.intervalMs);
    
    this.scheduledJobs.set(directory, job);
    
    secureLog('debug', 'Cleanup scheduled', {
      directory,
      intervalMs: schedule.intervalMs
    });
  }

  /**
   * Execute cleanup for a directory
   */
  private async executeCleanup(directory: string, policy: CleanupPolicy): Promise<CleanupResult> {
    const startTime = Date.now();
    
    const result: CleanupResult = {
      timestamp: startTime,
      duration: 0,
      processed: {
        scanned: 0,
        eligible: 0,
        deleted: 0,
        errors: 0
      },
      sizeBefore: 0,
      sizeAfter: 0,
      spaceSaved: 0,
      errors: [],
      dryRun: policy.dryRun
    };
    
    try {
      // Get directory statistics before cleanup
      const statsBefore = await this.getDirectoryStats(directory);
      result.sizeBefore = statsBefore.totalSize;
      result.processed.scanned = statsBefore.totalFiles;
      
      if (result.processed.scanned === 0) {
        result.duration = Date.now() - startTime;
        return result;
      }
      
      // Determine files to delete based on policies
      const filesToDelete = await this.determineFilesToDelete(directory, policy);
      result.processed.eligible = filesToDelete.length;
      
      if (filesToDelete.length === 0) {
        result.duration = Date.now() - startTime;
        result.sizeAfter = result.sizeBefore;
        return result;
      }
      
      // Execute deletion (or dry run)
      if (policy.dryRun) {
        secureLog('info', 'Dry run cleanup', {
          directory,
          eligible: filesToDelete.length,
          wouldDelete: filesToDelete.slice(0, 5) // Log first 5 files
        });
      } else {
        const { deleted, errors } = await this.fsOptimizer.batchFileCleanup(
          directory,
          (file) => filesToDelete.includes(file),
          policy.batchSize
        );
        
        result.processed.deleted = deleted.length;
        result.processed.errors = errors.length;
        result.errors = errors.map(e => ({ file: e.file, error: e.error.message }));
      }
      
      // Get statistics after cleanup
      const statsAfter = await this.getDirectoryStats(directory);
      result.sizeAfter = statsAfter.totalSize;
      result.spaceSaved = result.sizeBefore - result.sizeAfter;
      
    } catch (error) {
      result.errors.push({
        file: 'cleanup_execution',
        error: error instanceof Error ? error.message : 'unknown'
      });
      result.processed.errors++;
    }
    
    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Determine which files should be deleted based on policies
   */
  private async determineFilesToDelete(directory: string, policy: CleanupPolicy): Promise<string[]> {
    const { files, fileStats } = await this.fsOptimizer.getFilteredFiles(directory, {
      extensions: this.getFileExtensions(policy.filePatterns)
    });
    
    if (files.length === 0) {
      return [];
    }
    
    // Sort files by modification time (oldest first)
    const sortedFiles = files
      .map(file => ({ file, stat: fileStats.get(file)! }))
      .filter(item => item.stat)
      .sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime());
    
    let filesToDelete: string[] = [];
    const now = Date.now();
    
    // Age-based cleanup
    if (policy.maxAge?.enabled) {
      const ageThreshold = now - policy.maxAge.thresholdMs;
      const oldFiles = sortedFiles
        .filter(item => item.stat.mtime.getTime() < ageThreshold)
        .map(item => item.file);
      
      filesToDelete = [...filesToDelete, ...oldFiles];
    }
    
    // Size-based cleanup
    if (policy.maxSize?.enabled) {
      const totalSize = sortedFiles.reduce((sum, item) => sum + item.stat.size, 0);
      
      if (totalSize > policy.maxSize.thresholdBytes) {
        let currentSize = totalSize;
        for (const item of sortedFiles) {
          if (currentSize <= policy.maxSize.targetSizeBytes) break;
          if (!filesToDelete.includes(item.file)) {
            filesToDelete.push(item.file);
            currentSize -= item.stat.size;
          }
        }
      }
    }
    
    // Count-based cleanup
    if (policy.maxCount?.enabled && sortedFiles.length > policy.maxCount.maxFiles) {
      const excessCount = sortedFiles.length - policy.maxCount.targetCount;
      for (let i = 0; i < excessCount && i < sortedFiles.length; i++) {
        const file = sortedFiles[i].file;
        if (!filesToDelete.includes(file)) {
          filesToDelete.push(file);
        }
      }
    }
    
    // Remove duplicates and preserve most recent files
    const uniqueFilesToDelete = [...new Set(filesToDelete)];
    
    if (policy.preserveMostRecent > 0) {
      const mostRecentFiles = sortedFiles
        .slice(-policy.preserveMostRecent)
        .map(item => item.file);
      
      return uniqueFilesToDelete.filter(file => !mostRecentFiles.includes(file));
    }
    
    return uniqueFilesToDelete;
  }

  /**
   * Extract file extensions from patterns
   */
  private getFileExtensions(patterns: string[]): string[] {
    const extensions: string[] = [];
    
    for (const pattern of patterns) {
      if (pattern.includes('*.')) {
        const ext = pattern.substring(pattern.lastIndexOf('*.') + 1);
        if (ext && !extensions.includes(ext)) {
          extensions.push(ext);
        }
      }
    }
    
    return extensions.length > 0 ? extensions : ['.json', '.log', '.tmp'];
  }

  /**
   * Add result to history
   */
  private addToHistory(result: CleanupResult): void {
    this.cleanupHistory.push(result);
    
    // Keep only recent history
    if (this.cleanupHistory.length > this.maxHistoryEntries) {
      this.cleanupHistory = this.cleanupHistory.slice(-this.maxHistoryEntries);
    }
  }
}

/**
 * Default cleanup policies for common scenarios
 */
export const DEFAULT_CLEANUP_POLICIES = {
  /**
   * Event files cleanup - conservative policy
   */
  eventFiles: {
    filePatterns: ['*.json', 'event_*.json', 'response_*.json'],
    maxAge: {
      enabled: true,
      thresholdMs: 24 * 60 * 60 * 1000, // 24 hours
      deleteOlderThan: 1 // 1 day
    },
    maxSize: {
      enabled: true,
      thresholdBytes: 100 * 1024 * 1024, // 100MB
      targetSizeBytes: 50 * 1024 * 1024  // 50MB target
    },
    maxCount: {
      enabled: true,
      maxFiles: 1000,
      targetCount: 500
    },
    batchSize: 50,
    dryRun: false,
    preserveMostRecent: 10
  } as CleanupPolicy,
  
  /**
   * Log files cleanup - aggressive policy
   */
  logFiles: {
    filePatterns: ['*.log', '*.log.*'],
    maxAge: {
      enabled: true,
      thresholdMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      deleteOlderThan: 7
    },
    maxSize: {
      enabled: true,
      thresholdBytes: 500 * 1024 * 1024, // 500MB
      targetSizeBytes: 200 * 1024 * 1024  // 200MB target
    },
    batchSize: 100,
    dryRun: false,
    preserveMostRecent: 5
  } as CleanupPolicy,
  
  /**
   * Temporary files cleanup - immediate policy
   */
  tempFiles: {
    filePatterns: ['*.tmp', '*.temp', '.tmp*'],
    maxAge: {
      enabled: true,
      thresholdMs: 60 * 60 * 1000, // 1 hour
      deleteOlderThan: 0.04 // ~1 hour
    },
    batchSize: 200,
    dryRun: false,
    preserveMostRecent: 0
  } as CleanupPolicy
};

/**
 * Default cleanup schedules
 */
export const DEFAULT_CLEANUP_SCHEDULES = {
  hourly: {
    enabled: true,
    intervalMs: 60 * 60 * 1000, // 1 hour
    runOnStart: false,
    maxConcurrentRuns: 1
  } as CleanupSchedule,
  
  daily: {
    enabled: true,
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    runOnStart: true,
    maxConcurrentRuns: 1
  } as CleanupSchedule,
  
  frequent: {
    enabled: true,
    intervalMs: 15 * 60 * 1000, // 15 minutes
    runOnStart: false,
    maxConcurrentRuns: 2
  } as CleanupSchedule
};
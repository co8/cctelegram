/**
 * Memory Leak Detection and Monitoring System
 * 
 * Comprehensive memory leak detection using memwatch-next with focus on:
 * - Event file accumulation patterns
 * - Rate limiter memory storage monitoring  
 * - Bridge status caching memory tracking
 * - HTTP connection pool memory usage
 * - Security config cache memory patterns
 * 
 * Provides automated monitoring, threshold alerting, and production debugging capabilities.
 */

import { EventEmitter } from 'events';
// import * as memwatch from 'memwatch-next'; // Temporarily disabled for Node.js compatibility
import * as fs from 'fs-extra';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { secureLog } from '../../security.js';
import { MetricsCollector } from '../metrics/metrics-collector.js';

/**
 * Memory usage snapshot for specific monitoring areas
 */
export interface MemoryAreaSnapshot {
  area: MemoryMonitoringArea;
  timestamp: number;
  
  // Memory metrics
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  
  // Area-specific metrics
  specific: {
    eventFilesCount?: number;
    eventFilesSize?: number;
    rateLimiterEntries?: number;
    cacheEntries?: number;
    connectionPoolSize?: number;
    activeConnections?: number;
  };
}

/**
 * Memory leak detection configuration
 */
export interface MemoryLeakConfig {
  // Global thresholds
  thresholds: {
    maxHeapUsageMB: number; // 50MB budget
    memoryGrowthRateMBPerMin: number; // Growth rate alert
    heapGrowthPercentage: number; // % growth alert
    eventFileAccumulationThreshold: number; // File count
  };
  
  // Monitoring intervals
  monitoring: {
    snapshotIntervalMs: number; // Regular snapshots
    heapDiffIntervalMs: number; // Heap diff analysis
    gcMonitoringEnabled: boolean;
    alertCooldownMs: number; // Prevent alert spam
  };
  
  // Heap dump configuration
  heapDumps: {
    enabled: boolean;
    maxDumps: number;
    dumpOnThreshold: boolean;
    dumpDirectory: string;
    autoAnalyze: boolean;
  };
  
  // Integration settings
  integration: {
    enableEventFileTracking: boolean;
    enableRateLimiterTracking: boolean;
    enableCacheTracking: boolean;
    enableConnectionPoolTracking: boolean;
  };
}

/**
 * Memory monitoring areas
 */
export type MemoryMonitoringArea = 
  | 'global'
  | 'event_files'
  | 'rate_limiter'
  | 'bridge_cache'
  | 'http_pool'
  | 'security_config';

/**
 * Memory leak detection alert
 */
export interface MemoryLeakAlert {
  id: string;
  timestamp: number;
  type: 'threshold_breach' | 'growth_rate' | 'heap_growth' | 'file_accumulation' | 'gc_pressure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  area: MemoryMonitoringArea;
  
  // Current state
  current: {
    heapUsedMB: number;
    totalMemoryMB: number;
    eventFileCount?: number;
    eventFileSizeMB?: number;
  };
  
  // Comparison data
  baseline?: {
    heapUsedMB: number;
    timestamp: number;
  };
  
  // Alert details
  message: string;
  details: string;
  recommendations: string[];
  
  // Automatic actions taken
  actions: {
    heapDumpGenerated?: string;
    cleanupTriggered?: boolean;
    alertsSuppressed?: boolean;
  };
}

/**
 * Heap analysis result
 */
export interface HeapAnalysis {
  timestamp: number;
  before: memwatch.HeapDiff;
  after: memwatch.HeapDiff;
  
  analysis: {
    memoryLeakSuspected: boolean;
    growthAreas: Array<{
      what: string;
      sizeDelta: number;
      retainedDelta: number;
    }>;
    recommendations: string[];
  };
}

/**
 * Memory leak detector dashboard data
 */
export interface MemoryDashboard {
  timestamp: number;
  status: 'healthy' | 'warning' | 'critical';
  
  summary: {
    totalMemoryMB: number;
    heapUsedMB: number;
    memoryBudgetUsage: number; // % of 50MB budget
    activeAlerts: number;
    recentLeaks: number;
  };
  
  trends: {
    memoryGrowthRate: number; // MB per minute
    eventFileGrowthRate: number; // Files per minute  
    gcFrequency: number; // GC events per minute
    gcEffectiveness: number; // % memory reclaimed
  };
  
  areas: {
    [area in MemoryMonitoringArea]: {
      memoryUsageMB: number;
      trend: 'increasing' | 'stable' | 'decreasing';
      alertLevel: 'none' | 'warning' | 'critical';
    };
  };
  
  recommendations: string[];
}

/**
 * Memory Leak Detector
 * 
 * Provides comprehensive memory leak detection and monitoring with:
 * - Real-time memory usage tracking
 * - Automated heap analysis and leak detection
 * - Event file accumulation monitoring
 * - Threshold-based alerting with escalation
 * - Production heap dump generation and analysis
 */
export class MemoryLeakDetector extends EventEmitter {
  private config: MemoryLeakConfig;
  private metricsCollector?: MetricsCollector;
  
  // Memory monitoring state
  private snapshots: Map<MemoryMonitoringArea, MemoryAreaSnapshot[]> = new Map();
  private heapDiffs: memwatch.HeapDiff[] = [];
  private alerts: MemoryLeakAlert[] = [];
  private lastAlertTimes: Map<string, number> = new Map();
  
  // Monitoring intervals
  private snapshotInterval?: NodeJS.Timeout;
  private heapDiffInterval?: NodeJS.Timeout;
  
  // Heap monitoring
  private heapDumpCount = 0;
  private gcStats = {
    count: 0,
    totalReclaimed: 0,
    averageReclaimed: 0,
    lastGcTime: 0
  };
  
  // Memory baseline
  private baseline?: MemoryAreaSnapshot;
  private isStarted = false;
  
  constructor(config: Partial<MemoryLeakConfig> = {}, metricsCollector?: MetricsCollector) {
    super();
    
    this.config = {
      thresholds: {
        maxHeapUsageMB: 50,
        memoryGrowthRateMBPerMin: 2,
        heapGrowthPercentage: 10,
        eventFileAccumulationThreshold: 1000,
        ...config.thresholds
      },
      monitoring: {
        snapshotIntervalMs: 30000, // 30 seconds
        heapDiffIntervalMs: 300000, // 5 minutes
        gcMonitoringEnabled: true,
        alertCooldownMs: 300000, // 5 minutes
        ...config.monitoring
      },
      heapDumps: {
        enabled: true,
        maxDumps: 5,
        dumpOnThreshold: true,
        dumpDirectory: '/tmp/heapdumps',
        autoAnalyze: true,
        ...config.heapDumps
      },
      integration: {
        enableEventFileTracking: true,
        enableRateLimiterTracking: true,
        enableCacheTracking: true,
        enableConnectionPoolTracking: true,
        ...config.integration
      }
    };
    
    this.metricsCollector = metricsCollector;
    
    // Initialize snapshot storage
    this.initializeSnapshotStorage();
    
    secureLog('info', 'Memory leak detector initialized', {
      maxHeapUsageMB: this.config.thresholds.maxHeapUsageMB,
      snapshotInterval: this.config.monitoring.snapshotIntervalMs,
      heapDumpsEnabled: this.config.heapDumps.enabled
    });
  }

  /**
   * Start memory leak monitoring
   */
  public async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }
    
    try {
      // Setup memwatch-next monitoring
      this.setupMemwatchMonitoring();
      
      // Create heap dump directory
      if (this.config.heapDumps.enabled) {
        await fs.ensureDir(this.config.heapDumps.dumpDirectory);
      }
      
      // Start periodic snapshots
      this.startPeriodicSnapshots();
      
      // Start heap diff analysis
      this.startHeapDiffAnalysis();
      
      // Take initial baseline
      await this.takeBaseline();
      
      this.isStarted = true;
      
      secureLog('info', 'Memory leak monitoring started');
      this.emit('started');
      
    } catch (error) {
      secureLog('error', 'Failed to start memory leak monitoring', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Stop memory leak monitoring
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    // Clear intervals
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = undefined;
    }
    
    if (this.heapDiffInterval) {
      clearInterval(this.heapDiffInterval);
      this.heapDiffInterval = undefined;
    }
    
    // Remove memwatch listeners
    memwatch.removeAllListeners('leak');
    memwatch.removeAllListeners('stats');
    
    this.isStarted = false;
    
    secureLog('info', 'Memory leak monitoring stopped');
    this.emit('stopped');
  }

  /**
   * Take memory snapshot for specific area
   */
  public async takeSnapshot(area: MemoryMonitoringArea): Promise<MemoryAreaSnapshot> {
    const memUsage = process.memoryUsage();
    const timestamp = Date.now();
    
    const snapshot: MemoryAreaSnapshot = {
      area,
      timestamp,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      specific: {}
    };
    
    // Add area-specific metrics
    try {
      switch (area) {
        case 'event_files':
          snapshot.specific = await this.getEventFileMetrics();
          break;
        case 'rate_limiter':
          snapshot.specific = await this.getRateLimiterMetrics();
          break;
        case 'bridge_cache':
          snapshot.specific = await this.getBridgeCacheMetrics();
          break;
        case 'http_pool':
          snapshot.specific = await this.getHttpPoolMetrics();
          break;
        case 'security_config':
          snapshot.specific = await this.getSecurityConfigMetrics();
          break;
        case 'global':
        default:
          // Global snapshot - no specific metrics needed
          break;
      }
    } catch (error) {
      secureLog('warn', 'Failed to collect area-specific metrics', {
        area,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
    
    // Store snapshot
    this.storeSnapshot(area, snapshot);
    
    // Record metrics
    if (this.metricsCollector) {
      this.recordSnapshotMetrics(snapshot);
    }
    
    return snapshot;
  }

  /**
   * Force heap analysis
   */
  public async analyzeHeap(): Promise<HeapAnalysis | null> {
    try {
      const before = new memwatch.HeapDiff();
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Wait for GC to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const after = before.end();
      
      const analysis: HeapAnalysis = {
        timestamp: Date.now(),
        before,
        after,
        analysis: this.analyzeHeapDiff(after)
      };
      
      secureLog('info', 'Heap analysis completed', {
        memoryLeakSuspected: analysis.analysis.memoryLeakSuspected,
        growthAreas: analysis.analysis.growthAreas.length
      });
      
      this.emit('heap_analyzed', analysis);
      return analysis;
      
    } catch (error) {
      secureLog('error', 'Heap analysis failed', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      return null;
    }
  }

  /**
   * Generate heap dump for debugging
   */
  public async generateHeapDump(reason: string = 'manual'): Promise<string | null> {
    if (!this.config.heapDumps.enabled) {
      secureLog('warn', 'Heap dumps are disabled');
      return null;
    }
    
    if (this.heapDumpCount >= this.config.heapDumps.maxDumps) {
      secureLog('warn', 'Maximum heap dumps reached', {
        current: this.heapDumpCount,
        max: this.config.heapDumps.maxDumps
      });
      return null;
    }
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `heapdump-${timestamp}-${reason}.heapsnapshot`;
      const filepath = path.join(this.config.heapDumps.dumpDirectory, filename);
      
      // Generate heap snapshot
      await new Promise<void>((resolve, reject) => {
        memwatch.writeHeapSnapshot(filepath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      this.heapDumpCount++;
      
      secureLog('info', 'Heap dump generated', {
        filepath,
        reason,
        size: await this.getFileSize(filepath)
      });
      
      // Auto-analyze if enabled
      if (this.config.heapDumps.autoAnalyze) {
        await this.analyzeHeapDumpFile(filepath);
      }
      
      this.emit('heap_dump_generated', { filepath, reason });
      return filepath;
      
    } catch (error) {
      secureLog('error', 'Failed to generate heap dump', {
        reason,
        error: error instanceof Error ? error.message : 'unknown'
      });
      return null;
    }
  }

  /**
   * Get memory dashboard data
   */
  public getMemoryDashboard(): MemoryDashboard {
    const now = Date.now();
    const globalSnapshots = this.snapshots.get('global') || [];
    const recentSnapshots = globalSnapshots.filter(s => now - s.timestamp < 300000); // Last 5 minutes
    
    if (recentSnapshots.length === 0) {
      return this.getEmptyDashboard();
    }
    
    const latest = recentSnapshots[recentSnapshots.length - 1];
    const heapUsedMB = latest.heapUsed / (1024 * 1024);
    const totalMemoryMB = latest.rss / (1024 * 1024);
    
    // Calculate trends
    const trends = this.calculateMemoryTrends(recentSnapshots);
    
    // Get area status
    const areas = this.getAreaStatus();
    
    // Determine overall status
    const status = this.getOverallMemoryStatus(heapUsedMB, this.alerts);
    
    return {
      timestamp: now,
      status,
      summary: {
        totalMemoryMB: Math.round(totalMemoryMB),
        heapUsedMB: Math.round(heapUsedMB),
        memoryBudgetUsage: Math.round((heapUsedMB / this.config.thresholds.maxHeapUsageMB) * 100),
        activeAlerts: this.alerts.filter(a => now - a.timestamp < 300000).length,
        recentLeaks: this.alerts.filter(a => 
          now - a.timestamp < 3600000 && // Last hour
          (a.type === 'heap_growth' || a.type === 'growth_rate')
        ).length
      },
      trends,
      areas,
      recommendations: this.generateRecommendations(heapUsedMB, trends, areas)
    };
  }

  /**
   * Get current memory alerts
   */
  public getMemoryAlerts(severity?: string): MemoryLeakAlert[] {
    const now = Date.now();
    let alerts = this.alerts.filter(a => now - a.timestamp < 3600000); // Last hour
    
    if (severity) {
      alerts = alerts.filter(a => a.severity === severity);
    }
    
    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get memory statistics
   */
  public getMemoryStats(): {
    currentUsage: NodeJS.MemoryUsage;
    budget: { used: number; available: number; percentage: number };
    snapshots: number;
    alerts: number;
    heapDumps: number;
    gcStats: typeof this.gcStats;
  } {
    const currentUsage = process.memoryUsage();
    const heapUsedMB = currentUsage.heapUsed / (1024 * 1024);
    
    return {
      currentUsage,
      budget: {
        used: Math.round(heapUsedMB),
        available: Math.round(this.config.thresholds.maxHeapUsageMB - heapUsedMB),
        percentage: Math.round((heapUsedMB / this.config.thresholds.maxHeapUsageMB) * 100)
      },
      snapshots: Array.from(this.snapshots.values()).reduce((sum, arr) => sum + arr.length, 0),
      alerts: this.alerts.length,
      heapDumps: this.heapDumpCount,
      gcStats: { ...this.gcStats }
    };
  }

  /**
   * Initialize snapshot storage for all monitoring areas
   */
  private initializeSnapshotStorage(): void {
    const areas: MemoryMonitoringArea[] = [
      'global', 'event_files', 'rate_limiter', 
      'bridge_cache', 'http_pool', 'security_config'
    ];
    
    for (const area of areas) {
      this.snapshots.set(area, []);
    }
  }

  /**
   * Setup memwatch-next monitoring
   */
  private setupMemwatchMonitoring(): void {
    if (!this.config.monitoring.gcMonitoringEnabled) {
      return;
    }
    
    // Monitor potential memory leaks
    memwatch.on('leak', (info) => {
      const alert = this.createLeakAlert('heap_growth', 'high', 'global', {
        message: 'Potential memory leak detected',
        details: `Growth detected: ${JSON.stringify(info)}`,
        current: {
          heapUsedMB: process.memoryUsage().heapUsed / (1024 * 1024),
          totalMemoryMB: process.memoryUsage().rss / (1024 * 1024)
        }
      });
      
      this.handleMemoryAlert(alert);
    });
    
    // Monitor GC statistics
    memwatch.on('stats', (stats) => {
      this.updateGcStats(stats);
      
      // Check for GC pressure
      if (stats.usage_trend > 0 && stats.num_full_gc > 10) {
        const alert = this.createLeakAlert('gc_pressure', 'medium', 'global', {
          message: 'High GC pressure detected',
          details: `GC events: ${stats.num_full_gc}, Usage trend: ${stats.usage_trend}`,
          current: {
            heapUsedMB: stats.current_base / (1024 * 1024),
            totalMemoryMB: process.memoryUsage().rss / (1024 * 1024)
          }
        });
        
        this.handleMemoryAlert(alert);
      }
    });
  }

  /**
   * Start periodic memory snapshots
   */
  private startPeriodicSnapshots(): void {
    this.snapshotInterval = setInterval(async () => {
      try {
        // Take snapshots for all enabled areas
        await this.takeSnapshot('global');
        
        if (this.config.integration.enableEventFileTracking) {
          await this.takeSnapshot('event_files');
        }
        
        if (this.config.integration.enableRateLimiterTracking) {
          await this.takeSnapshot('rate_limiter');
        }
        
        if (this.config.integration.enableCacheTracking) {
          await this.takeSnapshot('bridge_cache');
        }
        
        if (this.config.integration.enableConnectionPoolTracking) {
          await this.takeSnapshot('http_pool');
        }
        
        // Check for threshold breaches
        await this.checkMemoryThresholds();
        
      } catch (error) {
        secureLog('error', 'Periodic snapshot failed', {
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }, this.config.monitoring.snapshotIntervalMs);
  }

  /**
   * Start heap diff analysis
   */
  private startHeapDiffAnalysis(): void {
    this.heapDiffInterval = setInterval(async () => {
      await this.analyzeHeap();
    }, this.config.monitoring.heapDiffIntervalMs);
  }

  /**
   * Take baseline memory snapshot
   */
  private async takeBaseline(): Promise<void> {
    this.baseline = await this.takeSnapshot('global');
    
    secureLog('info', 'Memory baseline established', {
      heapUsedMB: Math.round(this.baseline.heapUsed / (1024 * 1024)),
      totalMemoryMB: Math.round(this.baseline.rss / (1024 * 1024))
    });
  }

  /**
   * Store snapshot with cleanup
   */
  private storeSnapshot(area: MemoryMonitoringArea, snapshot: MemoryAreaSnapshot): void {
    const snapshots = this.snapshots.get(area) || [];
    snapshots.push(snapshot);
    
    // Keep only recent snapshots (last hour)
    const cutoff = Date.now() - 3600000;
    const filtered = snapshots.filter(s => s.timestamp > cutoff);
    
    this.snapshots.set(area, filtered);
  }

  /**
   * Record snapshot metrics
   */
  private recordSnapshotMetrics(snapshot: MemoryAreaSnapshot): void {
    if (!this.metricsCollector) return;
    
    const heapUsedMB = snapshot.heapUsed / (1024 * 1024);
    const totalMemoryMB = snapshot.rss / (1024 * 1024);
    
    this.metricsCollector.recordCustomMetric({
      name: 'memory_heap_used_mb',
      value: heapUsedMB,
      labels: { area: snapshot.area }
    });
    
    this.metricsCollector.recordCustomMetric({
      name: 'memory_total_mb',
      value: totalMemoryMB,
      labels: { area: snapshot.area }
    });
    
    if (snapshot.specific.eventFilesCount !== undefined) {
      this.metricsCollector.recordCustomMetric({
        name: 'memory_event_files_count',
        value: snapshot.specific.eventFilesCount
      });
    }
    
    if (snapshot.specific.eventFilesSize !== undefined) {
      this.metricsCollector.recordCustomMetric({
        name: 'memory_event_files_size_mb',
        value: snapshot.specific.eventFilesSize / (1024 * 1024)
      });
    }
  }

  /**
   * Check memory thresholds and generate alerts
   */
  private async checkMemoryThresholds(): Promise<void> {
    const globalSnapshots = this.snapshots.get('global') || [];
    if (globalSnapshots.length === 0) return;
    
    const latest = globalSnapshots[globalSnapshots.length - 1];
    const heapUsedMB = latest.heapUsed / (1024 * 1024);
    
    // Check heap usage threshold
    if (heapUsedMB > this.config.thresholds.maxHeapUsageMB) {
      const alert = this.createLeakAlert('threshold_breach', 'critical', 'global', {
        message: `Heap usage exceeded budget: ${Math.round(heapUsedMB)}MB > ${this.config.thresholds.maxHeapUsageMB}MB`,
        details: 'Memory usage has exceeded the configured budget of 50MB',
        current: {
          heapUsedMB,
          totalMemoryMB: latest.rss / (1024 * 1024)
        },
        baseline: this.baseline ? {
          heapUsedMB: this.baseline.heapUsed / (1024 * 1024),
          timestamp: this.baseline.timestamp
        } : undefined
      });
      
      await this.handleMemoryAlert(alert);
    }
    
    // Check growth rate
    if (globalSnapshots.length >= 2) {
      const growthRate = this.calculateGrowthRate(globalSnapshots);
      
      if (growthRate > this.config.thresholds.memoryGrowthRateMBPerMin) {
        const alert = this.createLeakAlert('growth_rate', 'high', 'global', {
          message: `High memory growth rate: ${growthRate.toFixed(2)} MB/min`,
          details: `Memory is growing faster than expected rate of ${this.config.thresholds.memoryGrowthRateMBPerMin} MB/min`,
          current: {
            heapUsedMB,
            totalMemoryMB: latest.rss / (1024 * 1024)
          }
        });
        
        await this.handleMemoryAlert(alert);
      }
    }
    
    // Check event file accumulation
    await this.checkEventFileAccumulation();
  }

  /**
   * Check event file accumulation
   */
  private async checkEventFileAccumulation(): Promise<void> {
    if (!this.config.integration.enableEventFileTracking) return;
    
    const eventSnapshots = this.snapshots.get('event_files') || [];
    if (eventSnapshots.length === 0) return;
    
    const latest = eventSnapshots[eventSnapshots.length - 1];
    const fileCount = latest.specific.eventFilesCount || 0;
    
    if (fileCount >= this.config.thresholds.eventFileAccumulationThreshold) {
      const alert = this.createLeakAlert('file_accumulation', 'high', 'event_files', {
        message: `Event file accumulation detected: ${fileCount} files`,
        details: `Event files have exceeded threshold of ${this.config.thresholds.eventFileAccumulationThreshold}`,
        current: {
          heapUsedMB: latest.heapUsed / (1024 * 1024),
          totalMemoryMB: latest.rss / (1024 * 1024),
          eventFileCount: fileCount,
          eventFileSizeMB: (latest.specific.eventFilesSize || 0) / (1024 * 1024)
        }
      });
      
      await this.handleMemoryAlert(alert);
    }
  }

  /**
   * Handle memory alert
   */
  private async handleMemoryAlert(alert: MemoryLeakAlert): Promise<void> {
    // Check cooldown to prevent spam
    const alertKey = `${alert.type}_${alert.area}`;
    const lastAlert = this.lastAlertTimes.get(alertKey);
    
    if (lastAlert && Date.now() - lastAlert < this.config.monitoring.alertCooldownMs) {
      return; // Still in cooldown
    }
    
    this.lastAlertTimes.set(alertKey, Date.now());
    
    // Store alert
    this.alerts.push(alert);
    
    // Clean up old alerts
    const cutoff = Date.now() - 86400000; // Keep 24 hours
    this.alerts = this.alerts.filter(a => a.timestamp > cutoff);
    
    // Take automatic actions
    await this.takeAutomaticActions(alert);
    
    // Emit alert
    this.emit('memory_alert', alert);
    
    secureLog('warn', 'Memory leak alert generated', {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      area: alert.area,
      message: alert.message
    });
  }

  /**
   * Take automatic actions for alerts
   */
  private async takeAutomaticActions(alert: MemoryLeakAlert): Promise<void> {
    // Generate heap dump for critical alerts
    if (alert.severity === 'critical' && this.config.heapDumps.dumpOnThreshold) {
      const dumpPath = await this.generateHeapDump(`alert_${alert.type}`);
      if (dumpPath) {
        alert.actions.heapDumpGenerated = dumpPath;
      }
    }
    
    // Trigger cleanup for file accumulation
    if (alert.type === 'file_accumulation') {
      try {
        // This would integrate with the EventFileCleanupAutomator
        alert.actions.cleanupTriggered = true;
        this.emit('cleanup_requested', { area: alert.area });
      } catch (error) {
        secureLog('warn', 'Failed to trigger automatic cleanup', {
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }
  }

  /**
   * Create memory leak alert
   */
  private createLeakAlert(
    type: MemoryLeakAlert['type'],
    severity: MemoryLeakAlert['severity'],
    area: MemoryMonitoringArea,
    data: {
      message: string;
      details: string;
      current: MemoryLeakAlert['current'];
      baseline?: MemoryLeakAlert['baseline'];
    }
  ): MemoryLeakAlert {
    return {
      id: `${type}_${area}_${Date.now()}`,
      timestamp: Date.now(),
      type,
      severity,
      area,
      current: data.current,
      baseline: data.baseline,
      message: data.message,
      details: data.details,
      recommendations: this.getAlertRecommendations(type, area),
      actions: {}
    };
  }

  /**
   * Get recommendations for alert type
   */
  private getAlertRecommendations(type: MemoryLeakAlert['type'], area: MemoryMonitoringArea): string[] {
    const recommendations: string[] = [];
    
    switch (type) {
      case 'threshold_breach':
        recommendations.push(
          'Review recent code changes for memory leaks',
          'Check for unclosed resources (files, connections)',
          'Consider increasing memory limits if appropriate',
          'Run heap analysis to identify memory hotspots'
        );
        break;
        
      case 'growth_rate':
        recommendations.push(
          'Monitor memory usage patterns',
          'Check for accumulating data structures',
          'Review caching strategies and TTL settings',
          'Investigate event loop blocking operations'
        );
        break;
        
      case 'file_accumulation':
        recommendations.push(
          'Enable automatic event file cleanup',
          'Reduce event file retention period',
          'Check disk space and I/O performance',
          'Review event generation patterns'
        );
        break;
        
      case 'gc_pressure':
        recommendations.push(
          'Review object creation patterns',
          'Optimize frequent allocations',
          'Consider object pooling for hot paths',
          'Investigate long-running operations'
        );
        break;
        
      case 'heap_growth':
        recommendations.push(
          'Run detailed heap analysis',
          'Check for retained objects',
          'Review closure usage and scope',
          'Investigate potential circular references'
        );
        break;
    }
    
    // Add area-specific recommendations
    switch (area) {
      case 'event_files':
        recommendations.push('Configure event file cleanup automation');
        break;
      case 'rate_limiter':
        recommendations.push('Review rate limiter TTL settings');
        break;
      case 'bridge_cache':
        recommendations.push('Optimize cache eviction policies');
        break;
      case 'http_pool':
        recommendations.push('Check connection pool sizing and timeouts');
        break;
    }
    
    return recommendations;
  }

  /**
   * Get area-specific memory metrics
   */
  private async getEventFileMetrics(): Promise<{ eventFilesCount?: number; eventFilesSize?: number }> {
    try {
      const eventDirs = ['/tmp/test-events', '/tmp/test-responses'];
      let totalFiles = 0;
      let totalSize = 0;
      
      for (const dir of eventDirs) {
        if (await fs.pathExists(dir)) {
          const files = await fs.readdir(dir);
          totalFiles += files.length;
          
          for (const file of files) {
            const filePath = path.join(dir, file);
            const stats = await fs.stat(filePath);
            totalSize += stats.size;
          }
        }
      }
      
      return { eventFilesCount: totalFiles, eventFilesSize: totalSize };
    } catch (error) {
      return {};
    }
  }

  private async getRateLimiterMetrics(): Promise<{ rateLimiterEntries?: number }> {
    // This would integrate with the rate limiter to get entry count
    // For now, return empty metrics
    return {};
  }

  private async getBridgeCacheMetrics(): Promise<{ cacheEntries?: number }> {
    // This would integrate with bridge caching to get cache size
    // For now, return empty metrics
    return {};
  }

  private async getHttpPoolMetrics(): Promise<{ connectionPoolSize?: number; activeConnections?: number }> {
    // This would integrate with the HTTP pool to get connection metrics
    // For now, return empty metrics
    return {};
  }

  private async getSecurityConfigMetrics(): Promise<{ cacheEntries?: number }> {
    // This would integrate with security config cache
    // For now, return empty metrics
    return {};
  }

  /**
   * Calculate memory growth rate
   */
  private calculateGrowthRate(snapshots: MemoryAreaSnapshot[]): number {
    if (snapshots.length < 2) return 0;
    
    const recent = snapshots.slice(-5); // Last 5 snapshots
    if (recent.length < 2) return 0;
    
    const first = recent[0];
    const last = recent[recent.length - 1];
    
    const timeDeltaMs = last.timestamp - first.timestamp;
    const memoryDeltaMB = (last.heapUsed - first.heapUsed) / (1024 * 1024);
    
    if (timeDeltaMs <= 0) return 0;
    
    // Convert to MB per minute
    return (memoryDeltaMB / timeDeltaMs) * 60000;
  }

  /**
   * Analyze heap diff for leaks
   */
  private analyzeHeapDiff(heapDiff: any): HeapAnalysis['analysis'] {
    const analysis = {
      memoryLeakSuspected: false,
      growthAreas: [],
      recommendations: []
    };
    
    if (!heapDiff.change || !heapDiff.change.details) {
      return analysis;
    }
    
    // Analyze memory changes
    for (const item of heapDiff.change.details) {
      if (item.size_bytes > 1024 * 1024) { // > 1MB change
        analysis.growthAreas.push({
          what: item.what,
          sizeDelta: item.size_bytes,
          retainedDelta: item['+'] || 0
        });
        
        if (item.size_bytes > 5 * 1024 * 1024) { // > 5MB
          analysis.memoryLeakSuspected = true;
        }
      }
    }
    
    // Generate recommendations based on growth areas
    if (analysis.growthAreas.length > 0) {
      analysis.recommendations.push(
        'Review objects with significant memory growth',
        'Check for proper cleanup of large objects',
        'Consider memory optimization for hot paths'
      );
    }
    
    if (analysis.memoryLeakSuspected) {
      analysis.recommendations.push(
        'Generate heap dump for detailed analysis',
        'Review recent code changes',
        'Check for memory leak patterns'
      );
    }
    
    return analysis;
  }

  /**
   * Update GC statistics
   */
  private updateGcStats(stats: any): void {
    this.gcStats.count++;
    this.gcStats.lastGcTime = Date.now();
    
    // Calculate reclaimed memory (approximate)
    const reclaimedMB = (stats.max - stats.min) / (1024 * 1024);
    this.gcStats.totalReclaimed += reclaimedMB;
    this.gcStats.averageReclaimed = this.gcStats.totalReclaimed / this.gcStats.count;
  }

  /**
   * Calculate memory trends
   */
  private calculateMemoryTrends(snapshots: MemoryAreaSnapshot[]): MemoryDashboard['trends'] {
    if (snapshots.length < 2) {
      return {
        memoryGrowthRate: 0,
        eventFileGrowthRate: 0,
        gcFrequency: 0,
        gcEffectiveness: 0
      };
    }
    
    const memoryGrowthRate = this.calculateGrowthRate(snapshots);
    
    // Calculate event file growth rate
    const eventSnapshots = this.snapshots.get('event_files') || [];
    let eventFileGrowthRate = 0;
    if (eventSnapshots.length >= 2) {
      const first = eventSnapshots[0];
      const last = eventSnapshots[eventSnapshots.length - 1];
      const timeDelta = (last.timestamp - first.timestamp) / 60000; // minutes
      const fileDelta = (last.specific.eventFilesCount || 0) - (first.specific.eventFilesCount || 0);
      eventFileGrowthRate = timeDelta > 0 ? fileDelta / timeDelta : 0;
    }
    
    // Calculate GC frequency (events per minute)
    const gcFrequency = this.gcStats.count > 0 ? 
      (this.gcStats.count / ((Date.now() - (this.baseline?.timestamp || Date.now())) / 60000)) : 0;
    
    return {
      memoryGrowthRate: Math.round(memoryGrowthRate * 100) / 100,
      eventFileGrowthRate: Math.round(eventFileGrowthRate * 100) / 100,
      gcFrequency: Math.round(gcFrequency * 100) / 100,
      gcEffectiveness: Math.round(this.gcStats.averageReclaimed * 100) / 100
    };
  }

  /**
   * Get area status
   */
  private getAreaStatus(): MemoryDashboard['areas'] {
    const areas: MemoryDashboard['areas'] = {} as any;
    
    for (const area of this.snapshots.keys()) {
      const snapshots = this.snapshots.get(area) || [];
      const recentAlerts = this.alerts.filter(a => 
        a.area === area && Date.now() - a.timestamp < 300000
      );
      
      let memoryUsageMB = 0;
      let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
      
      if (snapshots.length > 0) {
        const latest = snapshots[snapshots.length - 1];
        memoryUsageMB = latest.heapUsed / (1024 * 1024);
        
        if (snapshots.length >= 2) {
          const growthRate = this.calculateGrowthRate(snapshots);
          trend = growthRate > 0.5 ? 'increasing' : 
                  growthRate < -0.5 ? 'decreasing' : 'stable';
        }
      }
      
      const criticalAlerts = recentAlerts.filter(a => a.severity === 'critical');
      const warningAlerts = recentAlerts.filter(a => a.severity === 'high' || a.severity === 'medium');
      
      const alertLevel = criticalAlerts.length > 0 ? 'critical' :
                        warningAlerts.length > 0 ? 'warning' : 'none';
      
      areas[area] = {
        memoryUsageMB: Math.round(memoryUsageMB),
        trend,
        alertLevel
      };
    }
    
    return areas;
  }

  /**
   * Get overall memory status
   */
  private getOverallMemoryStatus(heapUsedMB: number, alerts: MemoryLeakAlert[]): 'healthy' | 'warning' | 'critical' {
    const recentAlerts = alerts.filter(a => Date.now() - a.timestamp < 300000);
    const criticalAlerts = recentAlerts.filter(a => a.severity === 'critical');
    const warningAlerts = recentAlerts.filter(a => a.severity === 'high' || a.severity === 'medium');
    
    if (criticalAlerts.length > 0 || heapUsedMB > this.config.thresholds.maxHeapUsageMB * 0.9) {
      return 'critical';
    }
    
    if (warningAlerts.length > 0 || heapUsedMB > this.config.thresholds.maxHeapUsageMB * 0.7) {
      return 'warning';
    }
    
    return 'healthy';
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    heapUsedMB: number, 
    trends: MemoryDashboard['trends'], 
    areas: MemoryDashboard['areas']
  ): string[] {
    const recommendations: string[] = [];
    
    // Budget usage recommendations
    const budgetUsage = (heapUsedMB / this.config.thresholds.maxHeapUsageMB) * 100;
    if (budgetUsage > 80) {
      recommendations.push('Memory usage is approaching budget limit - consider optimization');
    }
    
    // Growth rate recommendations
    if (trends.memoryGrowthRate > 1) {
      recommendations.push('High memory growth rate detected - monitor for leaks');
    }
    
    // Event file recommendations
    if (trends.eventFileGrowthRate > 10) {
      recommendations.push('Event files are accumulating rapidly - enable cleanup automation');
    }
    
    // GC recommendations
    if (trends.gcFrequency > 5) {
      recommendations.push('High GC frequency suggests memory pressure - optimize allocations');
    }
    
    if (trends.gcEffectiveness < 1) {
      recommendations.push('Low GC effectiveness - check for retained objects');
    }
    
    // Area-specific recommendations
    for (const [area, status] of Object.entries(areas)) {
      if (status.alertLevel === 'critical') {
        recommendations.push(`Critical memory issues in ${area} - immediate attention required`);
      } else if (status.trend === 'increasing' && status.memoryUsageMB > 10) {
        recommendations.push(`Monitor ${area} memory usage - showing increasing trend`);
      }
    }
    
    return recommendations;
  }

  /**
   * Get empty dashboard
   */
  private getEmptyDashboard(): MemoryDashboard {
    return {
      timestamp: Date.now(),
      status: 'healthy',
      summary: {
        totalMemoryMB: 0,
        heapUsedMB: 0,
        memoryBudgetUsage: 0,
        activeAlerts: 0,
        recentLeaks: 0
      },
      trends: {
        memoryGrowthRate: 0,
        eventFileGrowthRate: 0,
        gcFrequency: 0,
        gcEffectiveness: 0
      },
      areas: {} as any,
      recommendations: []
    };
  }

  /**
   * Get file size
   */
  private async getFileSize(filepath: string): Promise<number> {
    try {
      const stats = await fs.stat(filepath);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Analyze heap dump file
   */
  private async analyzeHeapDumpFile(filepath: string): Promise<void> {
    // This would integrate with heap analysis tools
    // For now, just log that analysis was requested
    secureLog('info', 'Heap dump analysis requested', { filepath });
  }
}

/**
 * Default memory leak detection configuration
 */
export const DEFAULT_MEMORY_LEAK_CONFIG: MemoryLeakConfig = {
  thresholds: {
    maxHeapUsageMB: 50,
    memoryGrowthRateMBPerMin: 2,
    heapGrowthPercentage: 10,
    eventFileAccumulationThreshold: 1000
  },
  monitoring: {
    snapshotIntervalMs: 30000, // 30 seconds
    heapDiffIntervalMs: 300000, // 5 minutes
    gcMonitoringEnabled: true,
    alertCooldownMs: 300000 // 5 minutes
  },
  heapDumps: {
    enabled: true,
    maxDumps: 5,
    dumpOnThreshold: true,
    dumpDirectory: '/tmp/heapdumps',
    autoAnalyze: false
  },
  integration: {
    enableEventFileTracking: true,
    enableRateLimiterTracking: true,
    enableCacheTracking: true,
    enableConnectionPoolTracking: true
  }
};
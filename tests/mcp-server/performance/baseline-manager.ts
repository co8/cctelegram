/**
 * Baseline Performance Measurement Framework
 * 
 * Records and manages baseline performance metrics for regression detection.
 * Establishes performance benchmarks for different system configurations.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BaselineMetrics {
  responseTime: {
    mean: number;
    median: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    stddev: number;
  };
  throughput: {
    requestsPerSecond: number;
    totalRequests: number;
    duration: number;
  };
  errorMetrics: {
    errorRate: number;
    errorCount: number;
    timeoutCount: number;
    successRate: number;
  };
  resourceUtilization: {
    avgCpuUsage: number;
    maxCpuUsage: number;
    avgMemoryUsage: number;
    maxMemoryUsage: number;
    avgDiskIo: number;
    avgNetworkIo: number;
  };
}

export interface SystemConfiguration {
  nodeVersion: string;
  platform: string;
  architecture: string;
  memoryMB: number;
  cpuCores: number;
  environment: 'development' | 'staging' | 'production' | 'test';
  environmentVariables: Record<string, string>;
  dependencies: Record<string, string>;
}

export interface BaselineRecord {
  id: string;
  timestamp: number;
  testType: 'load' | 'stress' | 'spike' | 'soak' | 'autocannon' | 'webhook';
  testConfiguration: {
    name: string;
    description: string;
    parameters: Record<string, any>;
    duration: number;
    concurrency: number;
  };
  systemConfiguration: SystemConfiguration;
  metrics: BaselineMetrics;
  version: string; // Application version
  gitCommit?: string;
  buildNumber?: string;
  tags: string[];
  notes?: string;
}

export interface BaselineComparison {
  current: BaselineRecord;
  baseline: BaselineRecord;
  differences: {
    responseTime: {
      meanChange: number;
      p95Change: number;
      p99Change: number;
      degradationDetected: boolean;
    };
    throughput: {
      rpsChange: number;
      degradationDetected: boolean;
    };
    errorRate: {
      errorRateChange: number;
      degradationDetected: boolean;
    };
    resourceUtilization: {
      cpuChange: number;
      memoryChange: number;
      degradationDetected: boolean;
    };
  };
  overallScore: number; // 0-100, higher is better
  regressionDetected: boolean;
  severity: 'none' | 'minor' | 'moderate' | 'major' | 'critical';
  recommendations: string[];
}

export interface BaselineConfig {
  dataDirectory: string;
  maxBaselineHistory: number;
  regressionThresholds: {
    responseTimeIncrease: number; // % increase threshold
    throughputDecrease: number; // % decrease threshold
    errorRateIncrease: number; // % increase threshold
    resourceUtilizationIncrease: number; // % increase threshold
  };
  autoCleanup: boolean;
  enableGitIntegration: boolean;
}

/**
 * Baseline Performance Manager
 */
export class BaselineManager extends EventEmitter {
  private config: BaselineConfig;
  private baselinesPath: string;
  private currentBaselines: Map<string, BaselineRecord> = new Map();

  constructor(config: Partial<BaselineConfig> = {}) {
    super();

    this.config = {
      dataDirectory: path.join(__dirname, '..', '..', 'baselines'),
      maxBaselineHistory: 50,
      regressionThresholds: {
        responseTimeIncrease: 10, // 10% increase triggers regression
        throughputDecrease: 10, // 10% decrease triggers regression
        errorRateIncrease: 5, // 5% increase triggers regression
        resourceUtilizationIncrease: 15 // 15% increase triggers regression
      },
      autoCleanup: true,
      enableGitIntegration: true,
      ...config
    };

    this.baselinesPath = this.config.dataDirectory;
  }

  /**
   * Initialize baseline manager
   */
  public async initialize(): Promise<void> {
    await fs.ensureDir(this.baselinesPath);
    await this.loadExistingBaselines();
    
    console.log(`Baseline Manager initialized with ${this.currentBaselines.size} existing baselines`);
  }

  /**
   * Record a new baseline measurement
   */
  public async recordBaseline(
    testType: BaselineRecord['testType'],
    testConfig: BaselineRecord['testConfiguration'],
    metrics: BaselineMetrics,
    options: {
      version?: string;
      tags?: string[];
      notes?: string;
      gitCommit?: string;
      buildNumber?: string;
    } = {}
  ): Promise<BaselineRecord> {
    const systemConfig = await this.getSystemConfiguration();
    
    const baseline: BaselineRecord = {
      id: this.generateBaselineId(testType, testConfig, systemConfig),
      timestamp: Date.now(),
      testType,
      testConfiguration: testConfig,
      systemConfiguration: systemConfig,
      metrics,
      version: options.version || 'unknown',
      gitCommit: options.gitCommit || await this.getGitCommit(),
      buildNumber: options.buildNumber,
      tags: options.tags || [],
      notes: options.notes
    };

    // Save baseline to file
    await this.saveBaseline(baseline);
    
    // Update in-memory cache
    this.currentBaselines.set(baseline.id, baseline);
    
    // Auto-cleanup if enabled
    if (this.config.autoCleanup) {
      await this.cleanupOldBaselines();
    }

    console.log(`Recorded new baseline: ${baseline.id}`);
    this.emit('baselineRecorded', baseline);

    return baseline;
  }

  /**
   * Compare current metrics against baseline
   */
  public async compareToBaseline(
    testType: BaselineRecord['testType'],
    testConfig: BaselineRecord['testConfiguration'],
    currentMetrics: BaselineMetrics,
    options: {
      baselineId?: string;
      version?: string;
      tags?: string[];
    } = {}
  ): Promise<BaselineComparison | null> {
    let baseline: BaselineRecord | undefined;

    if (options.baselineId) {
      baseline = this.currentBaselines.get(options.baselineId);
    } else {
      baseline = await this.findBestMatchingBaseline(testType, testConfig, options);
    }

    if (!baseline) {
      console.warn(`No matching baseline found for ${testType} test`);
      return null;
    }

    const systemConfig = await this.getSystemConfiguration();
    
    const current: BaselineRecord = {
      id: `current-${Date.now()}`,
      timestamp: Date.now(),
      testType,
      testConfiguration: testConfig,
      systemConfiguration: systemConfig,
      metrics: currentMetrics,
      version: options.version || 'unknown',
      tags: options.tags || []
    };

    const comparison = this.calculateComparison(current, baseline);
    
    this.emit('comparisonCompleted', comparison);
    
    if (comparison.regressionDetected) {
      this.emit('regressionDetected', comparison);
      console.warn(`Performance regression detected! Severity: ${comparison.severity}`);
    }

    return comparison;
  }

  /**
   * Get baseline history for a test type
   */
  public getBaselineHistory(
    testType: BaselineRecord['testType'],
    limit: number = 10
  ): BaselineRecord[] {
    return Array.from(this.currentBaselines.values())
      .filter(b => b.testType === testType)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get performance trends over time
   */
  public getPerformanceTrends(
    testType: BaselineRecord['testType'],
    timespan: number = 30 * 24 * 60 * 60 * 1000 // 30 days
  ): {
    testType: string;
    timespan: number;
    dataPoints: Array<{
      timestamp: number;
      responseTime: number;
      throughput: number;
      errorRate: number;
      cpuUsage: number;
      memoryUsage: number;
    }>;
    trends: {
      responseTime: 'improving' | 'stable' | 'degrading';
      throughput: 'improving' | 'stable' | 'degrading';
      errorRate: 'improving' | 'stable' | 'degrading';
      resourceUsage: 'improving' | 'stable' | 'degrading';
    };
  } {
    const cutoffTime = Date.now() - timespan;
    const relevantBaselines = Array.from(this.currentBaselines.values())
      .filter(b => b.testType === testType && b.timestamp >= cutoffTime)
      .sort((a, b) => a.timestamp - b.timestamp);

    const dataPoints = relevantBaselines.map(b => ({
      timestamp: b.timestamp,
      responseTime: b.metrics.responseTime.mean,
      throughput: b.metrics.throughput.requestsPerSecond,
      errorRate: b.metrics.errorMetrics.errorRate,
      cpuUsage: b.metrics.resourceUtilization.avgCpuUsage,
      memoryUsage: b.metrics.resourceUtilization.avgMemoryUsage
    }));

    const trends = this.calculateTrends(dataPoints);

    return {
      testType,
      timespan,
      dataPoints,
      trends
    };
  }

  /**
   * Export baselines for backup or sharing
   */
  public async exportBaselines(
    outputPath: string,
    options: {
      testTypes?: BaselineRecord['testType'][];
      dateRange?: { start: number; end: number };
      format?: 'json' | 'csv';
    } = {}
  ): Promise<void> {
    let baselines = Array.from(this.currentBaselines.values());

    // Apply filters
    if (options.testTypes) {
      baselines = baselines.filter(b => options.testTypes!.includes(b.testType));
    }

    if (options.dateRange) {
      baselines = baselines.filter(b => 
        b.timestamp >= options.dateRange!.start && 
        b.timestamp <= options.dateRange!.end
      );
    }

    const format = options.format || 'json';
    
    if (format === 'json') {
      await fs.writeJSON(outputPath, baselines, { spaces: 2 });
    } else if (format === 'csv') {
      const csv = this.convertBaselinesToCSV(baselines);
      await fs.writeFile(outputPath, csv);
    }

    console.log(`Exported ${baselines.length} baselines to ${outputPath}`);
  }

  /**
   * Import baselines from backup
   */
  public async importBaselines(inputPath: string): Promise<number> {
    const data = await fs.readJSON(inputPath);
    const baselines = Array.isArray(data) ? data : [data];
    
    let imported = 0;
    for (const baseline of baselines) {
      if (this.validateBaseline(baseline)) {
        await this.saveBaseline(baseline);
        this.currentBaselines.set(baseline.id, baseline);
        imported++;
      }
    }

    console.log(`Imported ${imported} baselines`);
    return imported;
  }

  /**
   * Generate baseline comparison report
   */
  public async generateComparisonReport(
    comparison: BaselineComparison,
    outputPath: string
  ): Promise<void> {
    const html = this.generateComparisonHTML(comparison);
    await fs.writeFile(outputPath, html);
    console.log(`Comparison report saved to: ${outputPath}`);
  }

  /**
   * Clean up old baselines based on retention policy
   */
  private async cleanupOldBaselines(): Promise<void> {
    const baselinesByType = new Map<string, BaselineRecord[]>();
    
    // Group baselines by test type
    for (const baseline of this.currentBaselines.values()) {
      const key = baseline.testType;
      if (!baselinesByType.has(key)) {
        baselinesByType.set(key, []);
      }
      baselinesByType.get(key)!.push(baseline);
    }

    // Keep only the most recent baselines for each type
    for (const [testType, baselines] of baselinesByType) {
      const sorted = baselines.sort((a, b) => b.timestamp - a.timestamp);
      const toKeep = sorted.slice(0, this.config.maxBaselineHistory);
      const toRemove = sorted.slice(this.config.maxBaselineHistory);

      for (const baseline of toRemove) {
        await this.removeBaseline(baseline.id);
      }

      if (toRemove.length > 0) {
        console.log(`Cleaned up ${toRemove.length} old baselines for ${testType}`);
      }
    }
  }

  /**
   * Load existing baselines from disk
   */
  private async loadExistingBaselines(): Promise<void> {
    try {
      const files = await fs.readdir(this.baselinesPath);
      const baselineFiles = files.filter(f => f.endsWith('.json'));

      for (const file of baselineFiles) {
        try {
          const filePath = path.join(this.baselinesPath, file);
          const baseline = await fs.readJSON(filePath);
          
          if (this.validateBaseline(baseline)) {
            this.currentBaselines.set(baseline.id, baseline);
          }
        } catch (error) {
          console.warn(`Failed to load baseline ${file}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to load existing baselines:', error);
    }
  }

  /**
   * Save baseline to disk
   */
  private async saveBaseline(baseline: BaselineRecord): Promise<void> {
    const fileName = `baseline-${baseline.id}.json`;
    const filePath = path.join(this.baselinesPath, fileName);
    await fs.writeJSON(filePath, baseline, { spaces: 2 });
  }

  /**
   * Remove baseline from disk and memory
   */
  private async removeBaseline(baselineId: string): Promise<void> {
    const fileName = `baseline-${baselineId}.json`;
    const filePath = path.join(this.baselinesPath, fileName);
    
    try {
      await fs.remove(filePath);
      this.currentBaselines.delete(baselineId);
    } catch (error) {
      console.warn(`Failed to remove baseline ${baselineId}:`, error);
    }
  }

  /**
   * Generate unique baseline ID
   */
  private generateBaselineId(
    testType: string,
    testConfig: BaselineRecord['testConfiguration'],
    systemConfig: SystemConfiguration
  ): string {
    const configHash = createHash('sha256')
      .update(JSON.stringify({ testType, testConfig, systemConfig }))
      .digest('hex')
      .substring(0, 8);
    
    return `${testType}-${configHash}-${Date.now()}`;
  }

  /**
   * Get current system configuration
   */
  private async getSystemConfiguration(): Promise<SystemConfiguration> {
    const os = await import('os');
    
    // Read package.json for dependencies
    let dependencies = {};
    try {
      const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
      const packageJson = await fs.readJSON(packageJsonPath);
      dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    } catch (error) {
      console.warn('Could not read package.json for dependencies');
    }

    return {
      nodeVersion: process.version,
      platform: os.platform(),
      architecture: os.arch(),
      memoryMB: Math.round(os.totalmem() / 1024 / 1024),
      cpuCores: os.cpus().length,
      environment: (process.env.NODE_ENV as any) || 'development',
      environmentVariables: {
        NODE_ENV: process.env.NODE_ENV || '',
        PORT: process.env.PORT || '',
        // Add other relevant environment variables
      },
      dependencies
    };
  }

  /**
   * Get current git commit hash if available
   */
  private async getGitCommit(): Promise<string | undefined> {
    if (!this.config.enableGitIntegration) return undefined;

    try {
      const { execSync } = await import('child_process');
      const commit = execSync('git rev-parse HEAD', { 
        encoding: 'utf8',
        cwd: path.join(__dirname, '..', '..', '..')
      }).trim();
      return commit;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Find best matching baseline for comparison
   */
  private async findBestMatchingBaseline(
    testType: BaselineRecord['testType'],
    testConfig: BaselineRecord['testConfiguration'],
    options: { version?: string; tags?: string[] }
  ): Promise<BaselineRecord | undefined> {
    const candidates = Array.from(this.currentBaselines.values())
      .filter(b => b.testType === testType)
      .filter(b => b.testConfiguration.name === testConfig.name);

    if (candidates.length === 0) return undefined;

    // Sort by relevance (prefer same version, recent timestamps)
    candidates.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      // Prefer same version
      if (options.version && a.version === options.version) scoreA += 100;
      if (options.version && b.version === options.version) scoreB += 100;

      // Prefer recent baselines
      scoreA += (a.timestamp / 1000000); // Convert to smaller number
      scoreB += (b.timestamp / 1000000);

      // Prefer matching tags
      if (options.tags) {
        const aTagMatches = a.tags.filter(tag => options.tags!.includes(tag)).length;
        const bTagMatches = b.tags.filter(tag => options.tags!.includes(tag)).length;
        scoreA += aTagMatches * 10;
        scoreB += bTagMatches * 10;
      }

      return scoreB - scoreA;
    });

    return candidates[0];
  }

  /**
   * Calculate performance comparison
   */
  private calculateComparison(
    current: BaselineRecord,
    baseline: BaselineRecord
  ): BaselineComparison {
    const thresholds = this.config.regressionThresholds;

    // Response time comparison
    const meanChange = ((current.metrics.responseTime.mean - baseline.metrics.responseTime.mean) / baseline.metrics.responseTime.mean) * 100;
    const p95Change = ((current.metrics.responseTime.p95 - baseline.metrics.responseTime.p95) / baseline.metrics.responseTime.p95) * 100;
    const p99Change = ((current.metrics.responseTime.p99 - baseline.metrics.responseTime.p99) / baseline.metrics.responseTime.p99) * 100;
    const responseTimeDegradation = meanChange > thresholds.responseTimeIncrease || p95Change > thresholds.responseTimeIncrease;

    // Throughput comparison
    const rpsChange = ((current.metrics.throughput.requestsPerSecond - baseline.metrics.throughput.requestsPerSecond) / baseline.metrics.throughput.requestsPerSecond) * 100;
    const throughputDegradation = rpsChange < -thresholds.throughputDecrease;

    // Error rate comparison
    const errorRateChange = ((current.metrics.errorMetrics.errorRate - baseline.metrics.errorMetrics.errorRate) / Math.max(baseline.metrics.errorMetrics.errorRate, 0.1)) * 100;
    const errorRateDegradation = errorRateChange > thresholds.errorRateIncrease;

    // Resource utilization comparison  
    const cpuChange = ((current.metrics.resourceUtilization.avgCpuUsage - baseline.metrics.resourceUtilization.avgCpuUsage) / baseline.metrics.resourceUtilization.avgCpuUsage) * 100;
    const memoryChange = ((current.metrics.resourceUtilization.avgMemoryUsage - baseline.metrics.resourceUtilization.avgMemoryUsage) / baseline.metrics.resourceUtilization.avgMemoryUsage) * 100;
    const resourceDegradation = cpuChange > thresholds.resourceUtilizationIncrease || memoryChange > thresholds.resourceUtilizationIncrease;

    const differences = {
      responseTime: {
        meanChange,
        p95Change,
        p99Change,
        degradationDetected: responseTimeDegradation
      },
      throughput: {
        rpsChange,
        degradationDetected: throughputDegradation
      },
      errorRate: {
        errorRateChange,
        degradationDetected: errorRateDegradation
      },
      resourceUtilization: {
        cpuChange,
        memoryChange,
        degradationDetected: resourceDegradation
      }
    };

    // Calculate overall score and regression severity
    const regressionDetected = responseTimeDegradation || throughputDegradation || errorRateDegradation || resourceDegradation;
    const { overallScore, severity } = this.calculateOverallScore(differences);
    const recommendations = this.generateRecommendations(differences);

    return {
      current,
      baseline,
      differences,
      overallScore,
      regressionDetected,
      severity,
      recommendations
    };
  }

  /**
   * Calculate overall performance score and severity
   */
  private calculateOverallScore(differences: BaselineComparison['differences']): { overallScore: number; severity: BaselineComparison['severity'] } {
    let score = 100;
    
    // Penalize based on different types of degradation
    if (differences.responseTime.degradationDetected) {
      score -= Math.min(Math.abs(differences.responseTime.meanChange), 50);
    }
    if (differences.throughput.degradationDetected) {
      score -= Math.min(Math.abs(differences.throughput.rpsChange), 30);
    }
    if (differences.errorRate.degradationDetected) {
      score -= Math.min(Math.abs(differences.errorRate.errorRateChange), 40);
    }
    if (differences.resourceUtilization.degradationDetected) {
      score -= Math.min(Math.max(Math.abs(differences.resourceUtilization.cpuChange), Math.abs(differences.resourceUtilization.memoryChange)), 20);
    }

    score = Math.max(0, Math.min(100, score));

    let severity: BaselineComparison['severity'];
    if (score >= 90) severity = 'none';
    else if (score >= 75) severity = 'minor';
    else if (score >= 60) severity = 'moderate';
    else if (score >= 40) severity = 'major';
    else severity = 'critical';

    return { overallScore: score, severity };
  }

  /**
   * Generate recommendations based on comparison
   */
  private generateRecommendations(differences: BaselineComparison['differences']): string[] {
    const recommendations: string[] = [];

    if (differences.responseTime.degradationDetected) {
      recommendations.push('Response time has increased significantly - investigate slow operations');
      if (differences.responseTime.p99Change > differences.responseTime.meanChange * 2) {
        recommendations.push('P99 latency is disproportionately high - check for outlier requests');
      }
    }

    if (differences.throughput.degradationDetected) {
      recommendations.push('Throughput has decreased - check for bottlenecks or resource constraints');
    }

    if (differences.errorRate.degradationDetected) {
      recommendations.push('Error rate has increased - investigate error patterns and causes');
    }

    if (differences.resourceUtilization.degradationDetected) {
      if (differences.resourceUtilization.cpuChange > 15) {
        recommendations.push('CPU usage has increased significantly - profile CPU-intensive operations');
      }
      if (differences.resourceUtilization.memoryChange > 15) {
        recommendations.push('Memory usage has increased - check for memory leaks or inefficient memory usage');
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance is within acceptable thresholds compared to baseline');
    }

    return recommendations;
  }

  /**
   * Calculate performance trends over time
   */
  private calculateTrends(dataPoints: Array<{ timestamp: number; responseTime: number; throughput: number; errorRate: number; cpuUsage: number; memoryUsage: number }>): {
    responseTime: 'improving' | 'stable' | 'degrading';
    throughput: 'improving' | 'stable' | 'degrading';
    errorRate: 'improving' | 'stable' | 'degrading';
    resourceUsage: 'improving' | 'stable' | 'degrading';
  } {
    if (dataPoints.length < 3) {
      return {
        responseTime: 'stable',
        throughput: 'stable',
        errorRate: 'stable',
        resourceUsage: 'stable'
      };
    }

    const calculateTrend = (values: number[]) => {
      const mid = Math.floor(values.length / 2);
      const firstHalf = values.slice(0, mid);
      const secondHalf = values.slice(-mid);
      
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      
      const change = ((secondAvg - firstAvg) / firstAvg) * 100;
      
      if (Math.abs(change) < 5) return 'stable';
      return change > 0 ? 'degrading' : 'improving';
    };

    return {
      responseTime: calculateTrend(dataPoints.map(d => d.responseTime)),
      throughput: calculateTrend(dataPoints.map(d => -d.throughput)), // Invert so higher is better
      errorRate: calculateTrend(dataPoints.map(d => d.errorRate)),
      resourceUsage: calculateTrend(dataPoints.map(d => (d.cpuUsage + d.memoryUsage) / 2))
    };
  }

  /**
   * Convert baselines to CSV format
   */
  private convertBaselinesToCSV(baselines: BaselineRecord[]): string {
    const headers = [
      'id', 'timestamp', 'testType', 'testName', 'version', 'meanResponseTime',
      'p95ResponseTime', 'throughput', 'errorRate', 'cpuUsage', 'memoryUsage'
    ];

    const rows = baselines.map(b => [
      b.id,
      new Date(b.timestamp).toISOString(),
      b.testType,
      b.testConfiguration.name,
      b.version,
      b.metrics.responseTime.mean.toFixed(2),
      b.metrics.responseTime.p95.toFixed(2),
      b.metrics.throughput.requestsPerSecond.toFixed(2),
      b.metrics.errorMetrics.errorRate.toFixed(2),
      b.metrics.resourceUtilization.avgCpuUsage.toFixed(2),
      b.metrics.resourceUtilization.avgMemoryUsage.toFixed(2)
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  /**
   * Validate baseline record structure
   */
  private validateBaseline(baseline: any): baseline is BaselineRecord {
    return (
      baseline &&
      typeof baseline.id === 'string' &&
      typeof baseline.timestamp === 'number' &&
      typeof baseline.testType === 'string' &&
      baseline.metrics &&
      baseline.metrics.responseTime &&
      baseline.metrics.throughput &&
      baseline.metrics.errorMetrics &&
      baseline.metrics.resourceUtilization
    );
  }

  /**
   * Generate HTML comparison report
   */
  private generateComparisonHTML(comparison: BaselineComparison): string {
    const current = comparison.current;
    const baseline = comparison.baseline;
    const diff = comparison.differences;

    return `<!DOCTYPE html>
<html>
<head>
    <title>Performance Baseline Comparison Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #e3f2fd; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .comparison { display: flex; gap: 20px; margin: 20px 0; }
        .baseline, .current { flex: 1; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .baseline { background: #f9f9f9; }
        .current { background: #e8f5e8; }
        .regression { background: #ffebee; }
        .improvement { background: #e8f5e8; }
        .stable { background: #f5f5f5; }
        .metric { margin: 10px 0; padding: 10px; border-radius: 3px; }
        .severity-${comparison.severity} { border-left: 4px solid ${comparison.severity === 'critical' ? '#f44336' : comparison.severity === 'major' ? '#ff9800' : comparison.severity === 'moderate' ? '#ffeb3b' : comparison.severity === 'minor' ? '#4caf50' : '#2196f3'}; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .change-positive { color: green; }
        .change-negative { color: red; }
        .change-neutral { color: #666; }
        .recommendations { background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Performance Baseline Comparison</h1>
        <p><strong>Test:</strong> ${current.testConfiguration.name}</p>
        <p><strong>Comparison Date:</strong> ${new Date().toISOString()}</p>
        <p><strong>Regression Detected:</strong> ${comparison.regressionDetected ? '⚠️ YES' : '✅ NO'}</p>
        <p><strong>Severity:</strong> <span class="severity-${comparison.severity}">${comparison.severity.toUpperCase()}</span></p>
        <p><strong>Overall Score:</strong> ${comparison.overallScore.toFixed(1)}/100</p>
    </div>

    <div class="comparison">
        <div class="baseline">
            <h3>Baseline (${new Date(baseline.timestamp).toLocaleDateString()})</h3>
            <p><strong>Version:</strong> ${baseline.version}</p>
            <p><strong>Response Time (mean):</strong> ${baseline.metrics.responseTime.mean.toFixed(2)}ms</p>
            <p><strong>Throughput:</strong> ${baseline.metrics.throughput.requestsPerSecond.toFixed(2)} req/s</p>
            <p><strong>Error Rate:</strong> ${baseline.metrics.errorMetrics.errorRate.toFixed(2)}%</p>
        </div>
        
        <div class="current">
            <h3>Current (${new Date(current.timestamp).toLocaleDateString()})</h3>
            <p><strong>Version:</strong> ${current.version}</p>
            <p><strong>Response Time (mean):</strong> ${current.metrics.responseTime.mean.toFixed(2)}ms</p>
            <p><strong>Throughput:</strong> ${current.metrics.throughput.requestsPerSecond.toFixed(2)} req/s</p>
            <p><strong>Error Rate:</strong> ${current.metrics.errorMetrics.errorRate.toFixed(2)}%</p>
        </div>
    </div>

    <h2>Detailed Comparison</h2>
    <table>
        <tr><th>Metric</th><th>Baseline</th><th>Current</th><th>Change</th><th>Status</th></tr>
        <tr>
            <td>Mean Response Time</td>
            <td>${baseline.metrics.responseTime.mean.toFixed(2)}ms</td>
            <td>${current.metrics.responseTime.mean.toFixed(2)}ms</td>
            <td class="${diff.responseTime.meanChange > 0 ? 'change-negative' : 'change-positive'}">${diff.responseTime.meanChange.toFixed(1)}%</td>
            <td>${diff.responseTime.degradationDetected ? '⚠️ Degraded' : '✅ OK'}</td>
        </tr>
        <tr>
            <td>P95 Response Time</td>
            <td>${baseline.metrics.responseTime.p95.toFixed(2)}ms</td>
            <td>${current.metrics.responseTime.p95.toFixed(2)}ms</td>
            <td class="${diff.responseTime.p95Change > 0 ? 'change-negative' : 'change-positive'}">${diff.responseTime.p95Change.toFixed(1)}%</td>
            <td>${diff.responseTime.degradationDetected ? '⚠️ Degraded' : '✅ OK'}</td>
        </tr>
        <tr>
            <td>Throughput</td>
            <td>${baseline.metrics.throughput.requestsPerSecond.toFixed(2)} req/s</td>
            <td>${current.metrics.throughput.requestsPerSecond.toFixed(2)} req/s</td>
            <td class="${diff.throughput.rpsChange < 0 ? 'change-negative' : 'change-positive'}">${diff.throughput.rpsChange.toFixed(1)}%</td>
            <td>${diff.throughput.degradationDetected ? '⚠️ Degraded' : '✅ OK'}</td>
        </tr>
        <tr>
            <td>Error Rate</td>
            <td>${baseline.metrics.errorMetrics.errorRate.toFixed(2)}%</td>
            <td>${current.metrics.errorMetrics.errorRate.toFixed(2)}%</td>
            <td class="${diff.errorRate.errorRateChange > 0 ? 'change-negative' : 'change-positive'}">${diff.errorRate.errorRateChange.toFixed(1)}%</td>
            <td>${diff.errorRate.degradationDetected ? '⚠️ Degraded' : '✅ OK'}</td>
        </tr>
        <tr>
            <td>CPU Usage</td>
            <td>${baseline.metrics.resourceUtilization.avgCpuUsage.toFixed(1)}%</td>
            <td>${current.metrics.resourceUtilization.avgCpuUsage.toFixed(1)}%</td>
            <td class="${diff.resourceUtilization.cpuChange > 0 ? 'change-negative' : 'change-positive'}">${diff.resourceUtilization.cpuChange.toFixed(1)}%</td>
            <td>${diff.resourceUtilization.degradationDetected ? '⚠️ Degraded' : '✅ OK'}</td>
        </tr>
        <tr>
            <td>Memory Usage</td>
            <td>${baseline.metrics.resourceUtilization.avgMemoryUsage.toFixed(1)}%</td>
            <td>${current.metrics.resourceUtilization.avgMemoryUsage.toFixed(1)}%</td>
            <td class="${diff.resourceUtilization.memoryChange > 0 ? 'change-negative' : 'change-positive'}">${diff.resourceUtilization.memoryChange.toFixed(1)}%</td>
            <td>${diff.resourceUtilization.degradationDetected ? '⚠️ Degraded' : '✅ OK'}</td>
        </tr>
    </table>

    <div class="recommendations">
        <h2>Recommendations</h2>
        <ul>
            ${comparison.recommendations.map(rec => `<li>${rec}</li>`).join('')}
        </ul>
    </div>

    <div class="metric">
        <h2>System Configuration Comparison</h2>
        <p><strong>Baseline System:</strong> ${baseline.systemConfiguration.platform} ${baseline.systemConfiguration.architecture}, Node ${baseline.systemConfiguration.nodeVersion}, ${baseline.systemConfiguration.cpuCores} cores, ${baseline.systemConfiguration.memoryMB}MB RAM</p>
        <p><strong>Current System:</strong> ${current.systemConfiguration.platform} ${current.systemConfiguration.architecture}, Node ${current.systemConfiguration.nodeVersion}, ${current.systemConfiguration.cpuCores} cores, ${current.systemConfiguration.memoryMB}MB RAM</p>
    </div>
</body>
</html>`;
  }
}

// Export helper functions for easy integration
export async function recordPerformanceBaseline(
  manager: BaselineManager,
  testType: BaselineRecord['testType'],
  testName: string,
  metrics: BaselineMetrics,
  options: {
    version?: string;
    tags?: string[];
    notes?: string;
  } = {}
): Promise<BaselineRecord> {
  const testConfig = {
    name: testName,
    description: `Performance baseline for ${testName}`,
    parameters: {},
    duration: 0,
    concurrency: 1
  };

  return await manager.recordBaseline(testType, testConfig, metrics, options);
}

export async function checkForRegression(
  manager: BaselineManager,
  testType: BaselineRecord['testType'],
  testName: string,
  currentMetrics: BaselineMetrics,
  options: {
    version?: string;
    tags?: string[];
    alertThreshold?: number;
  } = {}
): Promise<BaselineComparison | null> {
  const testConfig = {
    name: testName,
    description: `Performance check for ${testName}`,
    parameters: {},
    duration: 0,
    concurrency: 1
  };

  const comparison = await manager.compareToBaseline(testType, testConfig, currentMetrics, options);
  
  if (comparison && comparison.regressionDetected) {
    const alertThreshold = options.alertThreshold || 60;
    if (comparison.overallScore < alertThreshold) {
      console.error(`🚨 PERFORMANCE REGRESSION ALERT 🚨`);
      console.error(`Test: ${testName}`);
      console.error(`Severity: ${comparison.severity}`);
      console.error(`Score: ${comparison.overallScore.toFixed(1)}/100`);
      console.error(`Recommendations: ${comparison.recommendations.join(', ')}`);
    }
  }

  return comparison;
}
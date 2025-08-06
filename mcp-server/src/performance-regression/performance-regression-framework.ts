/**
 * Performance Regression Testing Framework
 * 
 * Comprehensive performance regression detection system with baseline management,
 * statistical analysis, automated alerting, and visual regression testing.
 * 
 * Features:
 * - Automated baseline establishment and maintenance
 * - Real-time regression detection with >10% degradation threshold
 * - Statistical trend analysis with anomaly detection
 * - Multi-channel alerting (console, file, webhook, Slack, email)
 * - Visual regression testing integration
 * - Performance dashboard and reporting
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaselineManager, BaselineMetrics, BaselineComparison, BaselineRecord } from '../../tests/performance/baseline-manager.js';
import { RegressionDetector, RegressionAlert, AlertChannel } from '../../tests/performance/regression-detector.js';
import { StatisticalAnalysisEngine } from './statistical-analysis-engine.js';
import { VisualRegressionService } from './visual-regression-service.js';
import { AlertingEngine } from './alerting-engine.js';
import { PerformanceDashboard } from './performance-dashboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PerformanceRegressionConfig {
  // Baseline Management
  baselineRetentionDays: number;
  baselineUpdateStrategy: 'automatic' | 'manual' | 'approval';
  baselineQualityThreshold: number; // Minimum score for accepting baselines
  
  // Regression Detection
  regressionThresholds: {
    responseTime: number; // % increase threshold (default: 10)
    throughput: number; // % decrease threshold (default: 10) 
    errorRate: number; // % increase threshold (default: 5)
    resourceUsage: number; // % increase threshold (default: 15)
    visualDifference: number; // % pixel difference threshold (default: 0.5)
  };
  
  // Statistical Analysis
  statisticalAnalysis: {
    enabled: boolean;
    trendWindow: number; // Days to analyze for trends
    anomalyDetectionSensitivity: 'low' | 'medium' | 'high';
    seasonalityDetection: boolean;
    predictionEnabled: boolean;
  };
  
  // Visual Regression
  visualRegression: {
    enabled: boolean;
    percyToken?: string;
    screenshotPath: string;
    thresholds: {
      mobile: number;
      tablet: number;
      desktop: number;
    };
  };
  
  // Alerting
  alerting: {
    channels: AlertChannel[];
    severityMapping: {
      minor: number; // Score threshold
      moderate: number;
      major: number;
      critical: number;
    };
    escalation: {
      enabled: boolean;
      timeToEscalate: number; // Minutes
      escalationChannels: string[];
    };
  };
  
  // Dashboard
  dashboard: {
    enabled: boolean;
    port: number;
    realTimeUpdates: boolean;
    metricsRetention: number; // Days
  };
  
  // Performance Testing
  automatedTesting: {
    enabled: boolean;
    schedule: string; // Cron expression
    testSuites: string[];
    parallelExecution: boolean;
  };
}

export interface PerformanceTestResult {
  testName: string;
  testType: 'load' | 'stress' | 'spike' | 'soak' | 'visual';
  timestamp: number;
  duration: number;
  metrics: BaselineMetrics;
  visualResults?: {
    screenshots: string[];
    comparisons: Array<{
      baseline: string;
      current: string;
      diff?: string;
      pixelDifference: number;
      percentageDifference: number;
    }>;
  };
  regressionDetected: boolean;
  alerts: RegressionAlert[];
  recommendations: string[];
}

export interface PerformanceReport {
  id: string;
  timestamp: number;
  timeRange: { start: number; end: number };
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    regressionsDetected: number;
    alertsTriggered: number;
    averageScore: number;
  };
  trendAnalysis: {
    performance: 'improving' | 'stable' | 'degrading';
    predictions: Array<{
      metric: string;
      prediction: number;
      confidence: number;
    }>;
    anomalies: Array<{
      metric: string;
      timestamp: number;
      value: number;
      expectedValue: number;
      severity: 'low' | 'medium' | 'high';
    }>;
  };
  recommendations: string[];
  actionItems: Array<{
    priority: 'low' | 'medium' | 'high' | 'critical';
    action: string;
    impact: string;
    effort: 'low' | 'medium' | 'high';
  }>;
}

/**
 * Main Performance Regression Testing Framework
 */
export class PerformanceRegressionFramework extends EventEmitter {
  private config: PerformanceRegressionConfig;
  private baselineManager: BaselineManager;
  private regressionDetector: RegressionDetector;
  private statisticalEngine: StatisticalAnalysisEngine;
  private visualService: VisualRegressionService;
  private alertingEngine: AlertingEngine;
  private dashboard: PerformanceDashboard;
  
  private dataPath: string;
  private isInitialized: boolean = false;
  private testResults: Map<string, PerformanceTestResult[]> = new Map();
  private backgroundJobs: NodeJS.Timeout[] = [];

  constructor(config: Partial<PerformanceRegressionConfig> = {}) {
    super();
    
    this.dataPath = path.join(__dirname, '..', '..', 'performance-data');
    
    this.config = {
      // Baseline Management
      baselineRetentionDays: 90,
      baselineUpdateStrategy: 'automatic',
      baselineQualityThreshold: 75,
      
      // Regression Detection  
      regressionThresholds: {
        responseTime: 10, // 10% increase triggers regression
        throughput: 10, // 10% decrease triggers regression
        errorRate: 5, // 5% increase triggers regression
        resourceUsage: 15, // 15% increase triggers regression
        visualDifference: 0.5 // 0.5% pixel difference triggers visual regression
      },
      
      // Statistical Analysis
      statisticalAnalysis: {
        enabled: true,
        trendWindow: 30, // 30 days
        anomalyDetectionSensitivity: 'medium',
        seasonalityDetection: true,
        predictionEnabled: true
      },
      
      // Visual Regression
      visualRegression: {
        enabled: true,
        screenshotPath: path.join(this.dataPath, 'screenshots'),
        thresholds: {
          mobile: 0.3,
          tablet: 0.4, 
          desktop: 0.5
        }
      },
      
      // Alerting
      alerting: {
        channels: [
          {
            name: 'console',
            type: 'console',
            config: {},
            enabled: true,
            severityFilter: ['minor', 'moderate', 'major', 'critical']
          },
          {
            name: 'file',
            type: 'file',
            config: {
              logFile: path.join(this.dataPath, 'alerts', 'performance-alerts.log')
            },
            enabled: true,
            severityFilter: ['moderate', 'major', 'critical']
          }
        ],
        severityMapping: {
          minor: 85,
          moderate: 70,
          major: 50,
          critical: 30
        },
        escalation: {
          enabled: true,
          timeToEscalate: 60, // 60 minutes
          escalationChannels: ['email', 'slack']
        }
      },
      
      // Dashboard
      dashboard: {
        enabled: true,
        port: 3001,
        realTimeUpdates: true,
        metricsRetention: 30 // 30 days
      },
      
      // Automated Testing
      automatedTesting: {
        enabled: true,
        schedule: '0 */4 * * *', // Every 4 hours
        testSuites: ['load', 'visual'],
        parallelExecution: true
      },
      
      ...config
    };

    this.initializeComponents();
  }

  /**
   * Initialize all framework components
   */
  private initializeComponents(): void {
    // Initialize baseline manager
    this.baselineManager = new BaselineManager({
      dataDirectory: path.join(this.dataPath, 'baselines'),
      maxBaselineHistory: 100,
      regressionThresholds: this.config.regressionThresholds,
      autoCleanup: true,
      enableGitIntegration: true
    });

    // Initialize regression detector  
    this.regressionDetector = new RegressionDetector(this.baselineManager, {
      enableAutoDetection: true,
      alertChannels: this.config.alerting.channels,
      alertThresholds: this.config.alerting.severityMapping,
      cooldownPeriod: 30,
      maxAlertsPerHour: 20,
      enableTrendAnalysis: true,
      trendAnalysisWindow: this.config.statisticalAnalysis.trendWindow,
      autoAcknowledgeAfter: 72
    });

    // Initialize statistical analysis engine
    this.statisticalEngine = new StatisticalAnalysisEngine({
      dataPath: path.join(this.dataPath, 'statistics'),
      trendWindow: this.config.statisticalAnalysis.trendWindow,
      anomalyDetectionSensitivity: this.config.statisticalAnalysis.anomalyDetectionSensitivity,
      seasonalityDetection: this.config.statisticalAnalysis.seasonalityDetection,
      predictionEnabled: this.config.statisticalAnalysis.predictionEnabled
    });

    // Initialize visual regression service
    this.visualService = new VisualRegressionService({
      screenshotPath: this.config.visualRegression.screenshotPath,
      thresholds: this.config.visualRegression.thresholds,
      percyToken: this.config.visualRegression.percyToken
    });

    // Initialize alerting engine
    this.alertingEngine = new AlertingEngine({
      channels: this.config.alerting.channels,
      escalation: this.config.alerting.escalation,
      dataPath: path.join(this.dataPath, 'alerts')
    });

    // Initialize dashboard
    this.dashboard = new PerformanceDashboard({
      port: this.config.dashboard.port,
      realTimeUpdates: this.config.dashboard.realTimeUpdates,
      metricsRetention: this.config.dashboard.metricsRetention,
      dataPath: path.join(this.dataPath, 'dashboard')
    });

    this.setupEventListeners();
  }

  /**
   * Setup event listeners for cross-component communication
   */
  private setupEventListeners(): void {
    // Baseline manager events
    this.baselineManager.on('baselineRecorded', (baseline) => {
      this.emit('baselineRecorded', baseline);
      this.dashboard.updateBaseline(baseline);
    });

    this.baselineManager.on('comparisonCompleted', (comparison) => {
      this.emit('comparisonCompleted', comparison);
      this.dashboard.updateComparison(comparison);
    });

    // Regression detector events
    this.regressionDetector.on('regressionDetected', (alert) => {
      this.emit('regressionDetected', alert);
      this.alertingEngine.processAlert(alert);
      this.dashboard.updateAlert(alert);
    });

    this.regressionDetector.on('alertTriggered', (alert) => {
      this.emit('alertTriggered', alert);
    });

    // Statistical analysis events
    this.statisticalEngine.on('anomalyDetected', (anomaly) => {
      this.emit('anomalyDetected', anomaly);
      this.dashboard.updateAnomaly(anomaly);
    });

    this.statisticalEngine.on('trendChange', (trend) => {
      this.emit('trendChange', trend);
      this.dashboard.updateTrend(trend);
    });

    // Visual regression events
    this.visualService.on('visualRegressionDetected', (regression) => {
      this.emit('visualRegressionDetected', regression);
      this.alertingEngine.processVisualRegression(regression);
      this.dashboard.updateVisualRegression(regression);
    });

    // Alerting engine events
    this.alertingEngine.on('alertEscalated', (alert) => {
      this.emit('alertEscalated', alert);
    });
  }

  /**
   * Initialize the framework
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log('🚀 Initializing Performance Regression Framework...');

    // Ensure data directories exist
    await fs.ensureDir(this.dataPath);
    await fs.ensureDir(path.join(this.dataPath, 'baselines'));
    await fs.ensureDir(path.join(this.dataPath, 'screenshots'));
    await fs.ensureDir(path.join(this.dataPath, 'alerts'));
    await fs.ensureDir(path.join(this.dataPath, 'statistics'));
    await fs.ensureDir(path.join(this.dataPath, 'dashboard'));
    await fs.ensureDir(path.join(this.dataPath, 'reports'));

    // Initialize all components
    await this.baselineManager.initialize();
    await this.regressionDetector.initialize();
    await this.statisticalEngine.initialize();
    await this.visualService.initialize();
    await this.alertingEngine.initialize();
    
    if (this.config.dashboard.enabled) {
      await this.dashboard.initialize();
    }

    // Load existing test results
    await this.loadTestResults();

    // Start background jobs
    this.startBackgroundJobs();

    this.isInitialized = true;
    console.log('✅ Performance Regression Framework initialized successfully');
    
    this.emit('initialized');
  }

  /**
   * Run performance test with regression detection
   */
  public async runPerformanceTest(
    testName: string,
    testType: 'load' | 'stress' | 'spike' | 'soak' | 'visual',
    testFunction: () => Promise<BaselineMetrics>,
    options: {
      visualTest?: boolean;
      skipBaseline?: boolean;
      tags?: string[];
      version?: string;
    } = {}
  ): Promise<PerformanceTestResult> {
    console.log(`🔬 Running performance test: ${testName} (${testType})`);
    
    const startTime = Date.now();
    
    try {
      // Execute the performance test
      const metrics = await testFunction();
      const duration = Date.now() - startTime;

      // Run visual regression test if enabled
      let visualResults;
      if (options.visualTest && this.config.visualRegression.enabled) {
        visualResults = await this.visualService.runVisualTest(testName, {
          testType,
          viewport: { width: 1920, height: 1080 }
        });
      }

      // Record baseline if not skipping
      let baseline: BaselineRecord | undefined;
      if (!options.skipBaseline) {
        baseline = await this.baselineManager.recordBaseline(
          testType,
          {
            name: testName,
            description: `Performance test: ${testName}`,
            parameters: {},
            duration,
            concurrency: 1
          },
          metrics,
          {
            version: options.version,
            tags: options.tags
          }
        );
      }

      // Check for regression
      const regressionAlert = await this.regressionDetector.checkRegression(
        testType,
        testName,
        metrics,
        {
          version: options.version,
          tags: options.tags
        }
      );

      // Perform statistical analysis
      await this.statisticalEngine.analyzeMetrics(testName, metrics, {
        timestamp: Date.now(),
        testType
      });

      // Generate recommendations
      const recommendations = await this.generateRecommendations(metrics, regressionAlert);

      const result: PerformanceTestResult = {
        testName,
        testType,
        timestamp: Date.now(),
        duration,
        metrics,
        visualResults,
        regressionDetected: regressionAlert !== null,
        alerts: regressionAlert ? [regressionAlert] : [],
        recommendations
      };

      // Store test result
      this.storeTestResult(result);

      console.log(`✅ Performance test completed: ${testName}`);
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Regression detected: ${result.regressionDetected ? 'YES' : 'NO'}`);
      
      this.emit('testCompleted', result);
      return result;

    } catch (error) {
      console.error(`❌ Performance test failed: ${testName}`, error);
      throw error;
    }
  }

  /**
   * Run comprehensive performance regression analysis
   */
  public async runRegressionAnalysis(
    timeRange?: { start: number; end: number }
  ): Promise<PerformanceReport> {
    console.log('📊 Running comprehensive regression analysis...');

    const reportId = `perf-report-${Date.now()}`;
    const now = Date.now();
    const defaultRange = {
      start: now - (7 * 24 * 60 * 60 * 1000), // Last 7 days
      end: now
    };
    const range = timeRange || defaultRange;

    // Get test results in time range
    const relevantResults = this.getTestResultsInRange(range);
    
    // Calculate summary statistics
    const summary = {
      totalTests: relevantResults.length,
      passedTests: relevantResults.filter(r => !r.regressionDetected).length,
      failedTests: relevantResults.filter(r => r.regressionDetected).length,
      regressionsDetected: relevantResults.filter(r => r.regressionDetected).length,
      alertsTriggered: relevantResults.reduce((sum, r) => sum + r.alerts.length, 0),
      averageScore: this.calculateAverageScore(relevantResults)
    };

    // Perform trend analysis
    const trendAnalysis = await this.statisticalEngine.analyzeTrends(range);
    
    // Generate recommendations and action items
    const recommendations = await this.generateAnalysisRecommendations(relevantResults, trendAnalysis);
    const actionItems = await this.generateActionItems(relevantResults, trendAnalysis);

    const report: PerformanceReport = {
      id: reportId,
      timestamp: now,
      timeRange: range,
      summary,
      trendAnalysis,
      recommendations,
      actionItems
    };

    // Save report
    await this.saveReport(report);

    console.log('✅ Regression analysis completed');
    this.emit('analysisCompleted', report);
    
    return report;
  }

  /**
   * Get active regressions
   */
  public getActiveRegressions(): RegressionAlert[] {
    return this.regressionDetector.getActiveAlerts();
  }

  /**
   * Get performance trends
   */
  public async getPerformanceTrends(
    testType?: string,
    timespan?: number
  ): Promise<any> {
    return this.statisticalEngine.getPerformanceTrends(testType, timespan);
  }

  /**
   * Export performance data
   */
  public async exportPerformanceData(
    outputPath: string,
    options: {
      format?: 'json' | 'csv' | 'excel';
      timeRange?: { start: number; end: number };
      includeBaselines?: boolean;
      includeAlerts?: boolean;
      includeVisualData?: boolean;
    } = {}
  ): Promise<void> {
    console.log(`📤 Exporting performance data to: ${outputPath}`);

    const data = {
      metadata: {
        exportTimestamp: Date.now(),
        config: this.config,
        timeRange: options.timeRange
      },
      testResults: options.timeRange 
        ? this.getTestResultsInRange(options.timeRange)
        : Array.from(this.testResults.values()).flat(),
      baselines: options.includeBaselines 
        ? await this.baselineManager.exportBaselines(
            path.join(this.dataPath, 'temp-baselines.json'), 
            { format: 'json', dateRange: options.timeRange }
          )
        : undefined,
      alerts: options.includeAlerts 
        ? this.regressionDetector.getActiveAlerts()
        : undefined,
      trends: await this.statisticalEngine.exportTrendData(options.timeRange)
    };

    const format = options.format || 'json';
    
    if (format === 'json') {
      await fs.writeJSON(outputPath, data, { spaces: 2 });
    } else if (format === 'csv') {
      const csv = this.convertToCSV(data);
      await fs.writeFile(outputPath, csv);
    }

    console.log('✅ Performance data exported successfully');
  }

  /**
   * Start background monitoring and maintenance jobs
   */
  private startBackgroundJobs(): void {
    // Cleanup old data
    const cleanupJob = setInterval(async () => {
      await this.performMaintenance();
    }, 6 * 60 * 60 * 1000); // Every 6 hours

    // Trend analysis
    const trendJob = setInterval(async () => {
      await this.statisticalEngine.performScheduledAnalysis();
    }, 2 * 60 * 60 * 1000); // Every 2 hours

    // Automated testing (if enabled)
    if (this.config.automatedTesting.enabled) {
      const testingJob = setInterval(async () => {
        await this.runAutomatedTests();
      }, 4 * 60 * 60 * 1000); // Every 4 hours (basic schedule)
    }

    this.backgroundJobs.push(cleanupJob, trendJob);
  }

  /**
   * Generate recommendations based on metrics and alerts
   */
  private async generateRecommendations(
    metrics: BaselineMetrics,
    alert?: RegressionAlert | null
  ): Promise<string[]> {
    const recommendations: string[] = [];

    // Performance-based recommendations
    if (metrics.responseTime.mean > 1000) {
      recommendations.push('Response time exceeds 1 second - consider optimizing critical paths');
    }

    if (metrics.errorMetrics.errorRate > 1) {
      recommendations.push('Error rate above 1% - investigate error patterns and root causes');
    }

    if (metrics.resourceUtilization.avgCpuUsage > 80) {
      recommendations.push('High CPU usage detected - profile and optimize CPU-intensive operations');
    }

    if (metrics.resourceUtilization.avgMemoryUsage > 80) {
      recommendations.push('High memory usage - check for memory leaks and optimize memory allocation');
    }

    // Alert-based recommendations
    if (alert) {
      recommendations.push(...alert.comparison.recommendations);
    }

    // Statistical analysis recommendations
    const anomalies = await this.statisticalEngine.getRecentAnomalies(24); // Last 24 hours
    if (anomalies.length > 0) {
      recommendations.push('Statistical anomalies detected - review recent changes and system behavior');
    }

    return recommendations;
  }

  /**
   * Store test result
   */
  private storeTestResult(result: PerformanceTestResult): void {
    if (!this.testResults.has(result.testName)) {
      this.testResults.set(result.testName, []);
    }
    
    this.testResults.get(result.testName)!.push(result);
    
    // Keep only recent results (last 100 per test)
    const results = this.testResults.get(result.testName)!;
    if (results.length > 100) {
      this.testResults.set(result.testName, results.slice(-100));
    }

    // Persist to disk
    this.saveTestResults();
  }

  /**
   * Get test results in time range
   */
  private getTestResultsInRange(range: { start: number; end: number }): PerformanceTestResult[] {
    const allResults = Array.from(this.testResults.values()).flat();
    return allResults.filter(r => r.timestamp >= range.start && r.timestamp <= range.end);
  }

  /**
   * Calculate average performance score
   */
  private calculateAverageScore(results: PerformanceTestResult[]): number {
    if (results.length === 0) return 0;
    
    // Simple scoring based on whether regressions were detected
    const scores = results.map(r => r.regressionDetected ? 50 : 100);
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  /**
   * Generate analysis recommendations
   */
  private async generateAnalysisRecommendations(
    results: PerformanceTestResult[],
    trendAnalysis: any
  ): Promise<string[]> {
    const recommendations: string[] = [];

    // High-level trend recommendations
    if (trendAnalysis.performance === 'degrading') {
      recommendations.push('Overall performance trend is degrading - conduct comprehensive performance review');
    }

    // Frequent regression recommendations
    const regressionRate = (results.filter(r => r.regressionDetected).length / results.length) * 100;
    if (regressionRate > 20) {
      recommendations.push('High regression rate detected - strengthen performance gates in CI/CD pipeline');
    }

    // Resource utilization recommendations
    const highResourceUsage = results.filter(r => 
      r.metrics.resourceUtilization.avgCpuUsage > 80 || 
      r.metrics.resourceUtilization.avgMemoryUsage > 80
    );
    
    if (highResourceUsage.length > results.length * 0.3) {
      recommendations.push('Frequent high resource usage - consider infrastructure scaling or optimization');
    }

    return recommendations;
  }

  /**
   * Generate action items
   */
  private async generateActionItems(
    results: PerformanceTestResult[],
    trendAnalysis: any
  ): Promise<Array<{
    priority: 'low' | 'medium' | 'high' | 'critical';
    action: string;
    impact: string;
    effort: 'low' | 'medium' | 'high';
  }>> {
    const actionItems = [];

    // Critical performance issues
    const criticalIssues = results.filter(r => 
      r.metrics.responseTime.p99 > 5000 || 
      r.metrics.errorMetrics.errorRate > 5
    );

    if (criticalIssues.length > 0) {
      actionItems.push({
        priority: 'critical' as const,
        action: 'Address critical performance issues (response time >5s or error rate >5%)',
        impact: 'User experience significantly impacted',
        effort: 'high' as const
      });
    }

    // Trending degradation
    if (trendAnalysis.performance === 'degrading') {
      actionItems.push({
        priority: 'high' as const,
        action: 'Investigate root cause of performance degradation trend',
        impact: 'Prevents further performance decline',
        effort: 'medium' as const
      });
    }

    // Baseline updates
    actionItems.push({
      priority: 'medium' as const,
      action: 'Review and update performance baselines quarterly',
      impact: 'Ensures accurate regression detection',
      effort: 'low' as const
    });

    // Monitoring improvements
    actionItems.push({
      priority: 'low' as const,
      action: 'Enhance performance monitoring coverage',
      impact: 'Better visibility into performance trends',
      effort: 'medium' as const
    });

    return actionItems;
  }

  /**
   * Save performance report
   */
  private async saveReport(report: PerformanceReport): Promise<void> {
    const reportPath = path.join(this.dataPath, 'reports', `${report.id}.json`);
    await fs.writeJSON(reportPath, report, { spaces: 2 });
  }

  /**
   * Load existing test results
   */
  private async loadTestResults(): Promise<void> {
    const resultsPath = path.join(this.dataPath, 'test-results.json');
    
    try {
      if (await fs.pathExists(resultsPath)) {
        const data = await fs.readJSON(resultsPath);
        this.testResults = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load test results:', error);
    }
  }

  /**
   * Save test results to disk
   */
  private async saveTestResults(): Promise<void> {
    const resultsPath = path.join(this.dataPath, 'test-results.json');
    const data = Object.fromEntries(this.testResults);
    await fs.writeJSON(resultsPath, data, { spaces: 2 });
  }

  /**
   * Perform maintenance tasks
   */
  private async performMaintenance(): Promise<void> {
    console.log('🧹 Performing maintenance tasks...');

    // Cleanup old test results
    const cutoffDate = Date.now() - (this.config.baselineRetentionDays * 24 * 60 * 60 * 1000);
    
    for (const [testName, results] of this.testResults) {
      const filteredResults = results.filter(r => r.timestamp > cutoffDate);
      this.testResults.set(testName, filteredResults);
    }

    await this.saveTestResults();

    // Cleanup visual regression files
    if (this.config.visualRegression.enabled) {
      await this.visualService.cleanupOldScreenshots(this.config.baselineRetentionDays);
    }

    console.log('✅ Maintenance completed');
  }

  /**
   * Run automated tests (placeholder for integration with existing test suites)
   */
  private async runAutomatedTests(): Promise<void> {
    console.log('🤖 Running automated performance tests...');
    
    // This would integrate with your existing test infrastructure
    // For now, it's a placeholder that could trigger test suites
    
    this.emit('automatedTestsCompleted');
  }

  /**
   * Convert data to CSV format
   */
  private convertToCSV(data: any): string {
    // Simplified CSV conversion
    const headers = ['timestamp', 'testName', 'testType', 'regressionDetected', 'responseTime', 'throughput', 'errorRate'];
    const rows = data.testResults.map((result: PerformanceTestResult) => [
      new Date(result.timestamp).toISOString(),
      result.testName,
      result.testType,
      result.regressionDetected,
      result.metrics.responseTime.mean,
      result.metrics.throughput.requestsPerSecond,
      result.metrics.errorMetrics.errorRate
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  /**
   * Shutdown the framework
   */
  public async shutdown(): Promise<void> {
    console.log('🔄 Shutting down Performance Regression Framework...');

    // Clear background jobs
    this.backgroundJobs.forEach(job => clearInterval(job));
    this.backgroundJobs = [];

    // Save final state
    await this.saveTestResults();

    // Shutdown components
    if (this.dashboard && this.config.dashboard.enabled) {
      await this.dashboard.shutdown();
    }

    this.isInitialized = false;
    console.log('✅ Performance Regression Framework shut down successfully');
  }
}

// Export helper functions
export async function createPerformanceRegressionFramework(
  config?: Partial<PerformanceRegressionConfig>
): Promise<PerformanceRegressionFramework> {
  const framework = new PerformanceRegressionFramework(config);
  await framework.initialize();
  return framework;
}

export async function runQuickRegressionCheck(
  framework: PerformanceRegressionFramework,
  testName: string,
  testFunction: () => Promise<BaselineMetrics>
): Promise<boolean> {
  const result = await framework.runPerformanceTest(testName, 'load', testFunction);
  return result.regressionDetected;
}
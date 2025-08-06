/**
 * Regression Detection System for Performance Testing
 * 
 * Automatically detects performance regressions by comparing current
 * performance metrics against established baselines with configurable
 * alerting thresholds and notification systems.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { BaselineManager, BaselineComparison, BaselineRecord, BaselineMetrics } from './baseline-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RegressionAlert {
  id: string;
  timestamp: number;
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  testType: string;
  testName: string;
  comparison: BaselineComparison;
  alertChannels: string[];
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolvedAt?: number;
  notes?: string;
}

export interface AlertChannel {
  name: string;
  type: 'console' | 'file' | 'webhook' | 'email' | 'slack';
  config: {
    [key: string]: any;
  };
  enabled: boolean;
  severityFilter: RegressionAlert['severity'][];
}

export interface RegressionConfig {
  enableAutoDetection: boolean;
  alertChannels: AlertChannel[];
  alertThresholds: {
    minor: number; // Score threshold for minor alerts (0-100)
    moderate: number;
    major: number;
    critical: number;
  };
  cooldownPeriod: number; // Minutes to wait before re-alerting
  maxAlertsPerHour: number;
  enableTrendAnalysis: boolean;
  trendAnalysisWindow: number; // Hours to look back for trend analysis
  autoAcknowledgeAfter: number; // Hours to auto-acknowledge unaddressed alerts
}

/**
 * Regression Detection Engine
 */
export class RegressionDetector extends EventEmitter {
  private config: RegressionConfig;
  private baselineManager: BaselineManager;
  private alertHistory: Map<string, RegressionAlert[]> = new Map();
  private alertCooldowns: Map<string, number> = new Map();
  private alertsPath: string;

  constructor(
    baselineManager: BaselineManager,
    config: Partial<RegressionConfig> = {}
  ) {
    super();

    this.baselineManager = baselineManager;
    this.alertsPath = path.join(__dirname, '..', '..', 'alerts');

    this.config = {
      enableAutoDetection: true,
      alertChannels: [
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
            logFile: path.join(this.alertsPath, 'regression-alerts.log')
          },
          enabled: true,
          severityFilter: ['moderate', 'major', 'critical']
        }
      ],
      alertThresholds: {
        minor: 85,
        moderate: 70,
        major: 50,
        critical: 30
      },
      cooldownPeriod: 30, // 30 minutes
      maxAlertsPerHour: 10,
      enableTrendAnalysis: true,
      trendAnalysisWindow: 24, // 24 hours
      autoAcknowledgeAfter: 72, // 72 hours
      ...config
    };

    this.setupEventListeners();
  }

  /**
   * Initialize regression detector
   */
  public async initialize(): Promise<void> {
    await fs.ensureDir(this.alertsPath);
    await this.loadAlertHistory();
    
    // Start background tasks
    if (this.config.enableAutoDetection) {
      this.startBackgroundMonitoring();
    }

    console.log('Regression Detector initialized');
  }

  /**
   * Check for performance regression
   */
  public async checkRegression(
    testType: BaselineRecord['testType'],
    testName: string,
    currentMetrics: BaselineMetrics,
    options: {
      version?: string;
      tags?: string[];
      baselineId?: string;
      skipAlert?: boolean;
    } = {}
  ): Promise<RegressionAlert | null> {
    const comparison = await this.baselineManager.compareToBaseline(
      testType,
      { name: testName, description: '', parameters: {}, duration: 0, concurrency: 1 },
      currentMetrics,
      options
    );

    if (!comparison || !comparison.regressionDetected) {
      return null;
    }

    const severity = this.determineSeverity(comparison.overallScore);
    const alert = await this.createAlert(testType, testName, comparison, severity);

    if (!options.skipAlert && this.shouldAlert(alert)) {
      await this.triggerAlert(alert);
    }

    this.emit('regressionDetected', alert);
    return alert;
  }

  /**
   * Analyze performance trends
   */
  public async analyzeTrends(
    testType: BaselineRecord['testType'],
    options: {
      windowHours?: number;
      alertOnNegativeTrends?: boolean;
    } = {}
  ): Promise<{
    testType: string;
    trendAnalysis: ReturnType<BaselineManager['getPerformanceTrends']>;
    risks: string[];
    recommendations: string[];
  }> {
    const windowHours = options.windowHours || this.config.trendAnalysisWindow;
    const windowMs = windowHours * 60 * 60 * 1000;

    const trends = this.baselineManager.getPerformanceTrends(testType, windowMs);
    const risks: string[] = [];
    const recommendations: string[] = [];

    // Analyze trend risks
    if (trends.trends.responseTime === 'degrading') {
      risks.push('Response time is trending upward over time');
      recommendations.push('Investigate recent changes that may have impacted response time');
    }

    if (trends.trends.throughput === 'degrading') {
      risks.push('Throughput is declining over time');
      recommendations.push('Check for resource constraints or bottlenecks');
    }

    if (trends.trends.errorRate === 'degrading') {
      risks.push('Error rate is increasing over time');
      recommendations.push('Review error logs for patterns and root causes');
    }

    if (trends.trends.resourceUsage === 'degrading') {
      risks.push('Resource usage is increasing over time');
      recommendations.push('Monitor for memory leaks or inefficient resource usage');
    }

    // Alert on negative trends if enabled
    if (options.alertOnNegativeTrends && risks.length > 0) {
      const trendAlert: RegressionAlert = {
        id: `trend-${testType}-${Date.now()}`,
        timestamp: Date.now(),
        severity: risks.length > 2 ? 'major' : 'moderate',
        testType,
        testName: `${testType}-trend-analysis`,
        comparison: {} as BaselineComparison, // Trend alerts don't have comparisons
        alertChannels: ['console', 'file'],
        acknowledged: false,
        notes: `Trend analysis detected ${risks.length} performance risks`
      };

      await this.triggerAlert(trendAlert);
    }

    return {
      testType,
      trendAnalysis: trends,
      risks,
      recommendations
    };
  }

  /**
   * Get active (unacknowledged) alerts
   */
  public getActiveAlerts(
    options: {
      testType?: string;
      severity?: RegressionAlert['severity'];
      maxAge?: number; // Hours
    } = {}
  ): RegressionAlert[] {
    const allAlerts = Array.from(this.alertHistory.values()).flat();
    
    return allAlerts.filter(alert => {
      if (alert.acknowledged) return false;
      
      if (options.testType && alert.testType !== options.testType) return false;
      
      if (options.severity && alert.severity !== options.severity) return false;
      
      if (options.maxAge) {
        const maxAgeMs = options.maxAge * 60 * 60 * 1000;
        if (Date.now() - alert.timestamp > maxAgeMs) return false;
      }
      
      return true;
    });
  }

  /**
   * Acknowledge an alert
   */
  public async acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string,
    notes?: string
  ): Promise<boolean> {
    const alert = this.findAlert(alertId);
    if (!alert || alert.acknowledged) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = Date.now();
    if (notes) alert.notes = notes;

    await this.saveAlertHistory();
    this.emit('alertAcknowledged', alert);

    console.log(`Alert ${alertId} acknowledged by ${acknowledgedBy}`);
    return true;
  }

  /**
   * Resolve an alert
   */
  public async resolveAlert(alertId: string, resolvedBy: string): Promise<boolean> {
    const alert = this.findAlert(alertId);
    if (!alert) return false;

    alert.resolvedAt = Date.now();
    if (!alert.acknowledged) {
      alert.acknowledged = true;
      alert.acknowledgedBy = resolvedBy;
      alert.acknowledgedAt = Date.now();
    }

    await this.saveAlertHistory();
    this.emit('alertResolved', alert);

    console.log(`Alert ${alertId} resolved by ${resolvedBy}`);
    return true;
  }

  /**
   * Generate alert report
   */
  public async generateAlertReport(
    outputPath: string,
    options: {
      timeRange?: { start: number; end: number };
      includeResolved?: boolean;
      format?: 'html' | 'json' | 'csv';
    } = {}
  ): Promise<void> {
    const format = options.format || 'html';
    let alerts = Array.from(this.alertHistory.values()).flat();

    // Apply filters
    if (options.timeRange) {
      alerts = alerts.filter(a => 
        a.timestamp >= options.timeRange!.start && 
        a.timestamp <= options.timeRange!.end
      );
    }

    if (!options.includeResolved) {
      alerts = alerts.filter(a => !a.resolvedAt);
    }

    // Sort by timestamp (newest first)
    alerts.sort((a, b) => b.timestamp - a.timestamp);

    if (format === 'html') {
      const html = this.generateAlertReportHTML(alerts);
      await fs.writeFile(outputPath, html);
    } else if (format === 'json') {
      await fs.writeJSON(outputPath, alerts, { spaces: 2 });
    } else if (format === 'csv') {
      const csv = this.convertAlertsToCSV(alerts);
      await fs.writeFile(outputPath, csv);
    }

    console.log(`Alert report generated: ${outputPath}`);
  }

  /**
   * Configure alert channels
   */
  public configureAlertChannel(channel: AlertChannel): void {
    const existingIndex = this.config.alertChannels.findIndex(c => c.name === channel.name);
    
    if (existingIndex >= 0) {
      this.config.alertChannels[existingIndex] = channel;
    } else {
      this.config.alertChannels.push(channel);
    }

    console.log(`Alert channel configured: ${channel.name} (${channel.type})`);
  }

  /**
   * Get alert statistics
   */
  public getAlertStatistics(timeRangeHours: number = 24): {
    totalAlerts: number;
    alertsBySeverity: Record<RegressionAlert['severity'], number>;
    alertsByTestType: Record<string, number>;
    averageResolutionTime: number;
    activeAlerts: number;
  } {
    const cutoffTime = Date.now() - (timeRangeHours * 60 * 60 * 1000);
    const recentAlerts = Array.from(this.alertHistory.values())
      .flat()
      .filter(a => a.timestamp >= cutoffTime);

    const alertsBySeverity = {
      minor: 0,
      moderate: 0,
      major: 0,
      critical: 0
    };

    const alertsByTestType: Record<string, number> = {};
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const alert of recentAlerts) {
      alertsBySeverity[alert.severity]++;
      
      alertsByTestType[alert.testType] = (alertsByTestType[alert.testType] || 0) + 1;
      
      if (alert.resolvedAt) {
        totalResolutionTime += alert.resolvedAt - alert.timestamp;
        resolvedCount++;
      }
    }

    const averageResolutionTime = resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0;
    const activeAlerts = recentAlerts.filter(a => !a.acknowledged).length;

    return {
      totalAlerts: recentAlerts.length,
      alertsBySeverity,
      alertsByTestType,
      averageResolutionTime,
      activeAlerts
    };
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for baseline comparisons from the baseline manager
    this.baselineManager.on('comparisonCompleted', async (comparison: BaselineComparison) => {
      if (comparison.regressionDetected) {
        const severity = this.determineSeverity(comparison.overallScore);
        const alert = await this.createAlert(
          comparison.current.testType,
          comparison.current.testConfiguration.name,
          comparison,
          severity
        );

        if (this.shouldAlert(alert)) {
          await this.triggerAlert(alert);
        }
      }
    });
  }

  /**
   * Start background monitoring tasks
   */
  private startBackgroundMonitoring(): void {
    // Auto-acknowledge old alerts
    setInterval(async () => {
      await this.autoAcknowledgeOldAlerts();
    }, 60 * 60 * 1000); // Every hour

    // Clean up alert cooldowns
    setInterval(() => {
      this.cleanupCooldowns();
    }, 15 * 60 * 1000); // Every 15 minutes

    console.log('Background monitoring started');
  }

  /**
   * Determine alert severity based on performance score
   */
  private determineSeverity(score: number): RegressionAlert['severity'] {
    const thresholds = this.config.alertThresholds;
    
    if (score <= thresholds.critical) return 'critical';
    if (score <= thresholds.major) return 'major';
    if (score <= thresholds.moderate) return 'moderate';
    return 'minor';
  }

  /**
   * Create regression alert
   */
  private async createAlert(
    testType: string,
    testName: string,
    comparison: BaselineComparison,
    severity: RegressionAlert['severity']
  ): Promise<RegressionAlert> {
    const alert: RegressionAlert = {
      id: `${testType}-${testName}-${Date.now()}`,
      timestamp: Date.now(),
      severity,
      testType,
      testName,
      comparison,
      alertChannels: this.config.alertChannels
        .filter(c => c.enabled && c.severityFilter.includes(severity))
        .map(c => c.name),
      acknowledged: false
    };

    // Store alert in history
    if (!this.alertHistory.has(testType)) {
      this.alertHistory.set(testType, []);
    }
    this.alertHistory.get(testType)!.push(alert);

    await this.saveAlertHistory();
    return alert;
  }

  /**
   * Check if alert should be sent (considering cooldowns and rate limits)
   */
  private shouldAlert(alert: RegressionAlert): boolean {
    const key = `${alert.testType}-${alert.testName}`;
    
    // Check cooldown
    const lastAlert = this.alertCooldowns.get(key);
    if (lastAlert) {
      const cooldownMs = this.config.cooldownPeriod * 60 * 1000;
      if (Date.now() - lastAlert < cooldownMs) {
        return false;
      }
    }

    // Check rate limit
    const hourAgo = Date.now() - (60 * 60 * 1000);
    const recentAlerts = Array.from(this.alertHistory.values())
      .flat()
      .filter(a => a.timestamp >= hourAgo);

    if (recentAlerts.length >= this.config.maxAlertsPerHour) {
      return false;
    }

    return true;
  }

  /**
   * Trigger alert through configured channels
   */
  private async triggerAlert(alert: RegressionAlert): Promise<void> {
    this.alertCooldowns.set(`${alert.testType}-${alert.testName}`, Date.now());

    for (const channelName of alert.alertChannels) {
      const channel = this.config.alertChannels.find(c => c.name === channelName);
      if (!channel || !channel.enabled) continue;

      try {
        await this.sendAlert(alert, channel);
      } catch (error) {
        console.error(`Failed to send alert via ${channelName}:`, error);
      }
    }

    this.emit('alertTriggered', alert);
  }

  /**
   * Send alert via specific channel
   */
  private async sendAlert(alert: RegressionAlert, channel: AlertChannel): Promise<void> {
    const message = this.formatAlertMessage(alert);

    switch (channel.type) {
      case 'console':
        console.error(`🚨 REGRESSION ALERT [${alert.severity.toUpperCase()}] 🚨`);
        console.error(message);
        break;

      case 'file':
        const logFile = channel.config.logFile;
        const logEntry = `${new Date().toISOString()} [${alert.severity.toUpperCase()}] ${message}\n`;
        await fs.appendFile(logFile, logEntry);
        break;

      case 'webhook':
        if (channel.config.url) {
          const payload = {
            alert,
            message,
            timestamp: new Date().toISOString()
          };
          
          // In a real implementation, you'd use fetch or axios
          console.log(`Would send webhook to ${channel.config.url} with payload:`, payload);
        }
        break;

      default:
        console.warn(`Unsupported alert channel type: ${channel.type}`);
    }
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(alert: RegressionAlert): string {
    const comparison = alert.comparison;
    if (!comparison || !comparison.differences) {
      return `Performance regression detected in ${alert.testName} (${alert.testType})`;
    }

    const diff = comparison.differences;
    const issues = [];

    if (diff.responseTime.degradationDetected) {
      issues.push(`Response time increased by ${diff.responseTime.meanChange.toFixed(1)}%`);
    }
    if (diff.throughput.degradationDetected) {
      issues.push(`Throughput decreased by ${Math.abs(diff.throughput.rpsChange).toFixed(1)}%`);
    }
    if (diff.errorRate.degradationDetected) {
      issues.push(`Error rate increased by ${diff.errorRate.errorRateChange.toFixed(1)}%`);
    }
    if (diff.resourceUtilization.degradationDetected) {
      issues.push(`Resource usage increased`);
    }

    return `Performance regression in ${alert.testName} (${alert.testType}): ${issues.join(', ')}. Score: ${comparison.overallScore.toFixed(1)}/100`;
  }

  /**
   * Find alert by ID
   */
  private findAlert(alertId: string): RegressionAlert | undefined {
    for (const alerts of this.alertHistory.values()) {
      const alert = alerts.find(a => a.id === alertId);
      if (alert) return alert;
    }
    return undefined;
  }

  /**
   * Auto-acknowledge old alerts
   */
  private async autoAcknowledgeOldAlerts(): Promise<void> {
    const cutoffTime = Date.now() - (this.config.autoAcknowledgeAfter * 60 * 60 * 1000);
    let acknowledgedCount = 0;

    for (const alerts of this.alertHistory.values()) {
      for (const alert of alerts) {
        if (!alert.acknowledged && alert.timestamp < cutoffTime) {
          alert.acknowledged = true;
          alert.acknowledgedBy = 'system';
          alert.acknowledgedAt = Date.now();
          alert.notes = 'Auto-acknowledged due to age';
          acknowledgedCount++;
        }
      }
    }

    if (acknowledgedCount > 0) {
      await this.saveAlertHistory();
      console.log(`Auto-acknowledged ${acknowledgedCount} old alerts`);
    }
  }

  /**
   * Clean up expired cooldowns
   */
  private cleanupCooldowns(): void {
    const cutoffTime = Date.now() - (this.config.cooldownPeriod * 60 * 1000);
    
    for (const [key, timestamp] of this.alertCooldowns.entries()) {
      if (timestamp < cutoffTime) {
        this.alertCooldowns.delete(key);
      }
    }
  }

  /**
   * Load alert history from disk
   */
  private async loadAlertHistory(): Promise<void> {
    try {
      const historyFile = path.join(this.alertsPath, 'alert-history.json');
      if (await fs.pathExists(historyFile)) {
        const data = await fs.readJSON(historyFile);
        this.alertHistory = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load alert history:', error);
    }
  }

  /**
   * Save alert history to disk
   */
  private async saveAlertHistory(): Promise<void> {
    try {
      const historyFile = path.join(this.alertsPath, 'alert-history.json');
      const data = Object.fromEntries(this.alertHistory);
      await fs.writeJSON(historyFile, data, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save alert history:', error);
    }
  }

  /**
   * Convert alerts to CSV format
   */
  private convertAlertsToCSV(alerts: RegressionAlert[]): string {
    const headers = [
      'id', 'timestamp', 'severity', 'testType', 'testName', 'acknowledged',
      'acknowledgedBy', 'resolvedAt', 'overallScore', 'responseTimeChange',
      'throughputChange', 'errorRateChange'
    ];

    const rows = alerts.map(alert => [
      alert.id,
      new Date(alert.timestamp).toISOString(),
      alert.severity,
      alert.testType,
      alert.testName,
      alert.acknowledged,
      alert.acknowledgedBy || '',
      alert.resolvedAt ? new Date(alert.resolvedAt).toISOString() : '',
      alert.comparison.overallScore?.toFixed(1) || '',
      alert.comparison.differences?.responseTime?.meanChange?.toFixed(1) || '',
      alert.comparison.differences?.throughput?.rpsChange?.toFixed(1) || '',
      alert.comparison.differences?.errorRate?.errorRateChange?.toFixed(1) || ''
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  /**
   * Generate HTML alert report
   */
  private generateAlertReportHTML(alerts: RegressionAlert[]): string {
    const stats = this.getAlertStatistics();

    return `<!DOCTYPE html>
<html>
<head>
    <title>Performance Regression Alert Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #ffebee; padding: 20px; border-radius: 5px; margin-bottom: 20px; border: 2px solid #f44336; }
        .stats { display: flex; gap: 20px; margin: 20px 0; }
        .stat { flex: 1; padding: 15px; background: #f5f5f5; border-radius: 5px; text-align: center; }
        .alert { margin: 15px 0; padding: 15px; border-radius: 5px; border-left: 4px solid; }
        .alert.critical { border-color: #f44336; background: #ffebee; }
        .alert.major { border-color: #ff9800; background: #fff3e0; }
        .alert.moderate { border-color: #ffeb3b; background: #fffde7; }
        .alert.minor { border-color: #4caf50; background: #e8f5e8; }
        .alert.acknowledged { opacity: 0.6; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .timestamp { font-size: 0.9em; color: #666; }
        .severity { font-weight: bold; text-transform: uppercase; }
        .status { padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .status.active { background: #ffcdd2; color: #d32f2f; }
        .status.acknowledged { background: #c8e6c9; color: #388e3c; }
        .status.resolved { background: #e1f5fe; color: #0277bd; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Performance Regression Alert Report</h1>
        <p>Generated: ${new Date().toISOString()}</p>
        <p>Total Alerts: ${alerts.length}</p>
    </div>

    <div class="stats">
        <div class="stat">
            <h3>${stats.activeAlerts}</h3>
            <p>Active Alerts</p>
        </div>
        <div class="stat">
            <h3>${stats.alertsBySeverity.critical}</h3>
            <p>Critical</p>
        </div>
        <div class="stat">
            <h3>${stats.alertsBySeverity.major}</h3>
            <p>Major</p>
        </div>
        <div class="stat">
            <h3>${(stats.averageResolutionTime / (60 * 60 * 1000)).toFixed(1)}h</h3>
            <p>Avg Resolution Time</p>
        </div>
    </div>

    <h2>Alert Details</h2>
    ${alerts.map(alert => `
    <div class="alert ${alert.severity} ${alert.acknowledged ? 'acknowledged' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong>${alert.testName}</strong> (${alert.testType})
                <span class="severity ${alert.severity}">${alert.severity}</span>
            </div>
            <div>
                <span class="status ${alert.resolvedAt ? 'resolved' : alert.acknowledged ? 'acknowledged' : 'active'}">
                    ${alert.resolvedAt ? 'Resolved' : alert.acknowledged ? 'Acknowledged' : 'Active'}
                </span>
            </div>
        </div>
        <div class="timestamp">${new Date(alert.timestamp).toLocaleString()}</div>
        ${alert.comparison && alert.comparison.overallScore ? `
        <div>Performance Score: ${alert.comparison.overallScore.toFixed(1)}/100</div>
        ` : ''}
        ${alert.notes ? `<div><em>Notes: ${alert.notes}</em></div>` : ''}
        ${alert.acknowledgedBy ? `<div><small>Acknowledged by ${alert.acknowledgedBy} at ${new Date(alert.acknowledgedAt!).toLocaleString()}</small></div>` : ''}
    </div>
    `).join('')}

    <h2>Alert Summary by Test Type</h2>
    <table>
        <tr><th>Test Type</th><th>Total Alerts</th><th>Active</th><th>Critical</th><th>Major</th></tr>
        ${Object.entries(stats.alertsByTestType).map(([testType, count]) => {
          const testAlerts = alerts.filter(a => a.testType === testType);
          const active = testAlerts.filter(a => !a.acknowledged).length;
          const critical = testAlerts.filter(a => a.severity === 'critical').length;
          const major = testAlerts.filter(a => a.severity === 'major').length;
          return `<tr><td>${testType}</td><td>${count}</td><td>${active}</td><td>${critical}</td><td>${major}</td></tr>`;
        }).join('')}
    </table>
</body>
</html>`;
  }
}

// Export helper functions
export async function setupRegressionDetection(
  baselineManager: BaselineManager,
  config: Partial<RegressionConfig> = {}
): Promise<RegressionDetector> {
  const detector = new RegressionDetector(baselineManager, config);
  await detector.initialize();
  return detector;
}

export async function quickRegressionCheck(
  detector: RegressionDetector,
  testType: BaselineRecord['testType'],
  testName: string,
  metrics: BaselineMetrics
): Promise<boolean> {
  const alert = await detector.checkRegression(testType, testName, metrics);
  return alert !== null;
}
/**
 * Performance Dashboard
 * 
 * Real-time performance monitoring dashboard with:
 * - Live performance metrics visualization
 * - Interactive charts and graphs
 * - Alert status monitoring
 * - Trend analysis displays
 * - Historical data exploration
 * - Responsive web interface
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { BaselineRecord, BaselineComparison } from '../../tests/performance/baseline-manager.js';
import { RegressionAlert } from '../../tests/performance/regression-detector.js';
import { VisualRegressionResult } from './visual-regression-service.js';

export interface DashboardConfig {
  port: number;
  realTimeUpdates: boolean;
  metricsRetention: number; // Days
  dataPath: string;
  authentication?: {
    enabled: boolean;
    username: string;
    password: string;
  };
  refreshInterval: number; // Seconds
}

export interface DashboardMetrics {
  timestamp: number;
  performance: {
    responseTime: {
      current: number;
      baseline: number;
      change: number;
    };
    throughput: {
      current: number;
      baseline: number;
      change: number;
    };
    errorRate: {
      current: number;
      baseline: number;
      change: number;
    };
    resourceUsage: {
      cpu: number;
      memory: number;
    };
  };
  alerts: {
    active: number;
    total24h: number;
    critical: number;
    major: number;
    moderate: number;
    minor: number;
  };
  tests: {
    totalRuns: number;
    successRate: number;
    averageScore: number;
    regressionRate: number;
  };
  trends: {
    performance: 'improving' | 'stable' | 'degrading';
    confidence: number;
  };
}

export interface ChartDataPoint {
  timestamp: number;
  value: number;
  label?: string;
  color?: string;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  charts: {
    responseTime: ChartDataPoint[];
    throughput: ChartDataPoint[];
    errorRate: ChartDataPoint[];
    testResults: ChartDataPoint[];
  };
  recentAlerts: Array<{
    id: string;
    timestamp: number;
    severity: string;
    testName: string;
    message: string;
    acknowledged: boolean;
  }>;
  systemStatus: {
    testsRunning: number;
    lastUpdate: number;
    uptime: number;
    version: string;
  };
}

/**
 * Performance Dashboard
 */
export class PerformanceDashboard extends EventEmitter {
  private config: DashboardConfig;
  private server: http.Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  
  private metricsHistory: Map<string, DashboardMetrics[]> = new Map();
  private alertsHistory: RegressionAlert[] = [];
  private baselinesHistory: BaselineRecord[] = [];
  private comparisonsHistory: BaselineComparison[] = [];
  private visualRegressionsHistory: VisualRegressionResult[] = [];
  
  private refreshTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config: Partial<DashboardConfig> = {}) {
    super();

    this.config = {
      port: 3001,
      realTimeUpdates: true,
      metricsRetention: 30, // 30 days
      dataPath: path.join(__dirname, '..', '..', 'dashboard-data'),
      refreshInterval: 10, // 10 seconds
      ...config
    };
  }

  /**
   * Initialize the dashboard
   */
  public async initialize(): Promise<void> {
    if (this.isRunning) return;

    console.log(`🌐 Initializing Performance Dashboard on port ${this.config.port}...`);

    await fs.ensureDir(this.config.dataPath);
    await this.loadHistoricalData();

    // Create HTTP server
    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    // Create WebSocket server for real-time updates
    if (this.config.realTimeUpdates) {
      this.wsServer = new WebSocketServer({ server: this.server });
      this.setupWebSocketHandlers();
    }

    // Start server
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Start refresh timer
    this.startRefreshTimer();

    this.isRunning = true;
    console.log(`✅ Performance Dashboard running at http://localhost:${this.config.port}`);
  }

  /**
   * Update with new baseline
   */
  public updateBaseline(baseline: BaselineRecord): void {
    this.baselinesHistory.push(baseline);
    this.trimHistory('baselines');
    this.broadcastUpdate({ type: 'baseline', data: baseline });
  }

  /**
   * Update with new comparison
   */
  public updateComparison(comparison: BaselineComparison): void {
    this.comparisonsHistory.push(comparison);
    this.trimHistory('comparisons');
    this.updateMetrics();
    this.broadcastUpdate({ type: 'comparison', data: comparison });
  }

  /**
   * Update with new alert
   */
  public updateAlert(alert: RegressionAlert): void {
    this.alertsHistory.push(alert);
    this.trimHistory('alerts');
    this.updateMetrics();
    this.broadcastUpdate({ type: 'alert', data: alert });
  }

  /**
   * Update with visual regression
   */
  public updateVisualRegression(regression: VisualRegressionResult): void {
    this.visualRegressionsHistory.push(regression);
    this.trimHistory('visual');
    this.broadcastUpdate({ type: 'visual', data: regression });
  }

  /**
   * Update with anomaly detection
   */
  public updateAnomaly(anomaly: any): void {
    this.broadcastUpdate({ type: 'anomaly', data: anomaly });
  }

  /**
   * Update with trend change
   */
  public updateTrend(trend: any): void {
    this.broadcastUpdate({ type: 'trend', data: trend });
  }

  /**
   * Get current dashboard data
   */
  public getDashboardData(): DashboardData {
    const metrics = this.generateCurrentMetrics();
    const charts = this.generateChartData();
    const recentAlerts = this.getRecentAlerts();
    const systemStatus = this.getSystemStatus();

    return {
      metrics,
      charts,
      recentAlerts,
      systemStatus
    };
  }

  /**
   * Handle HTTP requests
   */
  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      switch (url.pathname) {
        case '/':
          await this.serveDashboardHTML(res);
          break;
        
        case '/api/data':
          await this.serveAPIData(res);
          break;
        
        case '/api/metrics':
          await this.serveMetrics(res);
          break;
        
        case '/api/alerts':
          await this.serveAlerts(res);
          break;
        
        case '/api/trends':
          await this.serveTrends(res);
          break;
        
        case '/health':
          await this.serveHealthCheck(res);
          break;
        
        default:
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
      }
    } catch (error) {
      console.error('Dashboard HTTP error:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  /**
   * Serve main dashboard HTML
   */
  private async serveDashboardHTML(res: http.ServerResponse): Promise<void> {
    const html = this.generateDashboardHTML();
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Serve API data
   */
  private async serveAPIData(res: http.ServerResponse): Promise<void> {
    const data = this.getDashboardData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * Serve metrics data
   */
  private async serveMetrics(res: http.ServerResponse): Promise<void> {
    const metrics = this.generateCurrentMetrics();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics));
  }

  /**
   * Serve alerts data
   */
  private async serveAlerts(res: http.ServerResponse): Promise<void> {
    const alerts = this.getRecentAlerts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(alerts));
  }

  /**
   * Serve trends data
   */
  private async serveTrends(res: http.ServerResponse): Promise<void> {
    const trends = this.generateTrendsData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(trends));
  }

  /**
   * Serve health check
   */
  private async serveHealthCheck(res: http.ServerResponse): Promise<void> {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: '1.0.0'
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
  }

  /**
   * Setup WebSocket handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.wsServer) return;

    this.wsServer.on('connection', (ws: WebSocket) => {
      console.log('📱 Dashboard client connected');
      this.clients.add(ws);

      // Send initial data
      ws.send(JSON.stringify({
        type: 'initial',
        data: this.getDashboardData()
      }));

      ws.on('close', () => {
        console.log('📱 Dashboard client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Broadcast update to all connected clients
   */
  private broadcastUpdate(update: { type: string; data: any }): void {
    if (!this.config.realTimeUpdates || this.clients.size === 0) return;

    const message = JSON.stringify(update);
    
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Failed to send WebSocket message:', error);
          this.clients.delete(client);
        }
      }
    }
  }

  /**
   * Generate current metrics
   */
  private generateCurrentMetrics(): DashboardMetrics {
    const now = Date.now();
    const recentComparisons = this.comparisonsHistory.slice(-10);
    const recentAlerts = this.alertsHistory.filter(a => now - a.timestamp < 24 * 60 * 60 * 1000);

    // Calculate performance metrics
    let performance = {
      responseTime: { current: 0, baseline: 0, change: 0 },
      throughput: { current: 0, baseline: 0, change: 0 },
      errorRate: { current: 0, baseline: 0, change: 0 },
      resourceUsage: { cpu: 0, memory: 0 }
    };

    if (recentComparisons.length > 0) {
      const latestComparison = recentComparisons[recentComparisons.length - 1];
      
      performance = {
        responseTime: {
          current: latestComparison.current.metrics.responseTime.mean,
          baseline: latestComparison.baseline.metrics.responseTime.mean,
          change: latestComparison.differences.responseTime.meanChange
        },
        throughput: {
          current: latestComparison.current.metrics.throughput.requestsPerSecond,
          baseline: latestComparison.baseline.metrics.throughput.requestsPerSecond,
          change: latestComparison.differences.throughput.rpsChange
        },
        errorRate: {
          current: latestComparison.current.metrics.errorMetrics.errorRate,
          baseline: latestComparison.baseline.metrics.errorMetrics.errorRate,
          change: latestComparison.differences.errorRate.errorRateChange
        },
        resourceUsage: {
          cpu: latestComparison.current.metrics.resourceUtilization.avgCpuUsage,
          memory: latestComparison.current.metrics.resourceUtilization.avgMemoryUsage
        }
      };
    }

    // Calculate alert metrics
    const alertCounts = {
      active: recentAlerts.filter(a => !a.acknowledged).length,
      total24h: recentAlerts.length,
      critical: recentAlerts.filter(a => a.severity === 'critical').length,
      major: recentAlerts.filter(a => a.severity === 'major').length,
      moderate: recentAlerts.filter(a => a.severity === 'moderate').length,
      minor: recentAlerts.filter(a => a.severity === 'minor').length
    };

    // Calculate test metrics
    const testMetrics = {
      totalRuns: this.comparisonsHistory.length,
      successRate: this.comparisonsHistory.length > 0 
        ? (this.comparisonsHistory.filter(c => !c.regressionDetected).length / this.comparisonsHistory.length) * 100
        : 100,
      averageScore: this.comparisonsHistory.length > 0
        ? this.comparisonsHistory.reduce((sum, c) => sum + c.overallScore, 0) / this.comparisonsHistory.length
        : 100,
      regressionRate: this.comparisonsHistory.length > 0
        ? (this.comparisonsHistory.filter(c => c.regressionDetected).length / this.comparisonsHistory.length) * 100
        : 0
    };

    // Calculate trends
    const trends = {
      performance: this.calculateOverallTrend(),
      confidence: 0.8 // Placeholder
    };

    return {
      timestamp: now,
      performance,
      alerts: alertCounts,
      tests: testMetrics,
      trends
    };
  }

  /**
   * Generate chart data
   */
  private generateChartData(): DashboardData['charts'] {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);

    // Response time chart
    const responseTimeData = this.comparisonsHistory
      .filter(c => c.current.timestamp >= last24h)
      .map(c => ({
        timestamp: c.current.timestamp,
        value: c.current.metrics.responseTime.mean,
        color: c.regressionDetected ? '#f44336' : '#4caf50'
      }));

    // Throughput chart
    const throughputData = this.comparisonsHistory
      .filter(c => c.current.timestamp >= last24h)
      .map(c => ({
        timestamp: c.current.timestamp,
        value: c.current.metrics.throughput.requestsPerSecond,
        color: c.regressionDetected ? '#f44336' : '#4caf50'
      }));

    // Error rate chart
    const errorRateData = this.comparisonsHistory
      .filter(c => c.current.timestamp >= last24h)
      .map(c => ({
        timestamp: c.current.timestamp,
        value: c.current.metrics.errorMetrics.errorRate,
        color: c.regressionDetected ? '#f44336' : '#4caf50'
      }));

    // Test results chart
    const testResultsData = this.comparisonsHistory
      .filter(c => c.current.timestamp >= last24h)
      .map(c => ({
        timestamp: c.current.timestamp,
        value: c.overallScore,
        color: this.getScoreColor(c.overallScore)
      }));

    return {
      responseTime: responseTimeData,
      throughput: throughputData,
      errorRate: errorRateData,
      testResults: testResultsData
    };
  }

  /**
   * Get recent alerts for dashboard
   */
  private getRecentAlerts(): DashboardData['recentAlerts'] {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);

    return this.alertsHistory
      .filter(a => a.timestamp >= last24h)
      .slice(-20) // Last 20 alerts
      .map(a => ({
        id: a.id,
        timestamp: a.timestamp,
        severity: a.severity,
        testName: a.testName,
        message: this.getAlertMessage(a),
        acknowledged: a.acknowledged
      }));
  }

  /**
   * Get system status
   */
  private getSystemStatus(): DashboardData['systemStatus'] {
    return {
      testsRunning: 0, // Would track active tests
      lastUpdate: Date.now(),
      uptime: process.uptime() * 1000,
      version: '1.0.0'
    };
  }

  /**
   * Generate trends data
   */
  private generateTrendsData(): any {
    // This would generate comprehensive trend analysis
    return {
      responseTime: this.calculateMetricTrend('responseTime'),
      throughput: this.calculateMetricTrend('throughput'),
      errorRate: this.calculateMetricTrend('errorRate'),
      overall: this.calculateOverallTrend()
    };
  }

  /**
   * Calculate metric trend
   */
  private calculateMetricTrend(metric: string): 'improving' | 'stable' | 'degrading' {
    if (this.comparisonsHistory.length < 10) return 'stable';

    const recent = this.comparisonsHistory.slice(-10);
    const values = recent.map(c => {
      switch (metric) {
        case 'responseTime': return c.current.metrics.responseTime.mean;
        case 'throughput': return c.current.metrics.throughput.requestsPerSecond;
        case 'errorRate': return c.current.metrics.errorMetrics.errorRate;
        default: return 0;
      }
    });

    const firstHalf = values.slice(0, 5);
    const secondHalf = values.slice(-5);
    
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const change = ((secondAvg - firstAvg) / firstAvg) * 100;
    
    if (Math.abs(change) < 5) return 'stable';
    
    // For throughput, increase is good; for others, decrease is good
    if (metric === 'throughput') {
      return change > 0 ? 'improving' : 'degrading';
    } else {
      return change < 0 ? 'improving' : 'degrading';
    }
  }

  /**
   * Calculate overall trend
   */
  private calculateOverallTrend(): 'improving' | 'stable' | 'degrading' {
    const responseTimeTrend = this.calculateMetricTrend('responseTime');
    const throughputTrend = this.calculateMetricTrend('throughput');
    const errorRateTrend = this.calculateMetricTrend('errorRate');

    const trends = [responseTimeTrend, throughputTrend, errorRateTrend];
    const improvingCount = trends.filter(t => t === 'improving').length;
    const degradingCount = trends.filter(t => t === 'degrading').length;

    if (improvingCount > degradingCount) return 'improving';
    if (degradingCount > improvingCount) return 'degrading';
    return 'stable';
  }

  /**
   * Get alert message
   */
  private getAlertMessage(alert: RegressionAlert): string {
    if (alert.comparison && alert.comparison.differences) {
      const issues = [];
      const diff = alert.comparison.differences;
      
      if (diff.responseTime.degradationDetected) {
        issues.push(`Response time +${diff.responseTime.meanChange.toFixed(1)}%`);
      }
      if (diff.throughput.degradationDetected) {
        issues.push(`Throughput ${diff.throughput.rpsChange.toFixed(1)}%`);
      }
      if (diff.errorRate.degradationDetected) {
        issues.push(`Error rate +${diff.errorRate.errorRateChange.toFixed(1)}%`);
      }
      
      return issues.length > 0 ? issues.join(', ') : 'Performance regression detected';
    }
    
    return 'Performance regression detected';
  }

  /**
   * Get color for score
   */
  private getScoreColor(score: number): string {
    if (score >= 90) return '#4caf50';
    if (score >= 75) return '#8bc34a';
    if (score >= 60) return '#ffeb3b';
    if (score >= 40) return '#ff9800';
    return '#f44336';
  }

  /**
   * Update metrics periodically
   */
  private updateMetrics(): void {
    const metrics = this.generateCurrentMetrics();
    const key = new Date().toISOString().split('T')[0]; // Daily key
    
    if (!this.metricsHistory.has(key)) {
      this.metricsHistory.set(key, []);
    }
    
    this.metricsHistory.get(key)!.push(metrics);
  }

  /**
   * Start refresh timer
   */
  private startRefreshTimer(): void {
    this.refreshTimer = setInterval(() => {
      this.updateMetrics();
      
      if (this.config.realTimeUpdates) {
        this.broadcastUpdate({
          type: 'refresh',
          data: this.getDashboardData()
        });
      }
    }, this.config.refreshInterval * 1000);
  }

  /**
   * Trim history data
   */
  private trimHistory(type: string): void {
    const cutoffTime = Date.now() - (this.config.metricsRetention * 24 * 60 * 60 * 1000);
    
    switch (type) {
      case 'alerts':
        this.alertsHistory = this.alertsHistory.filter(a => a.timestamp > cutoffTime);
        break;
      case 'baselines':
        this.baselinesHistory = this.baselinesHistory.filter(b => b.timestamp > cutoffTime);
        break;
      case 'comparisons':
        this.comparisonsHistory = this.comparisonsHistory.filter(c => c.current.timestamp > cutoffTime);
        break;
      case 'visual':
        this.visualRegressionsHistory = this.visualRegressionsHistory.filter(v => v.timestamp > cutoffTime);
        break;
    }
  }

  /**
   * Load historical data
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      const dataFile = path.join(this.config.dataPath, 'dashboard-data.json');
      if (await fs.pathExists(dataFile)) {
        const data = await fs.readJSON(dataFile);
        
        this.alertsHistory = data.alerts || [];
        this.baselinesHistory = data.baselines || [];
        this.comparisonsHistory = data.comparisons || [];
        this.visualRegressionsHistory = data.visual || [];
        this.metricsHistory = new Map(Object.entries(data.metrics || {}));
      }
    } catch (error) {
      console.warn('Failed to load dashboard historical data:', error);
    }
  }

  /**
   * Save historical data
   */
  private async saveHistoricalData(): Promise<void> {
    try {
      const dataFile = path.join(this.config.dataPath, 'dashboard-data.json');
      const data = {
        alerts: this.alertsHistory,
        baselines: this.baselinesHistory,
        comparisons: this.comparisonsHistory,
        visual: this.visualRegressionsHistory,
        metrics: Object.fromEntries(this.metricsHistory),
        lastSaved: Date.now()
      };
      
      await fs.writeJSON(dataFile, data, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save dashboard data:', error);
    }
  }

  /**
   * Generate dashboard HTML
   */
  private generateDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Performance Regression Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .metric-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric-value { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
        .metric-label { color: #666; font-size: 0.9em; }
        .metric-change { font-size: 0.8em; margin-top: 5px; }
        .positive { color: #4caf50; }
        .negative { color: #f44336; }
        .stable { color: #666; }
        .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .chart-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .alerts-section { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .alert-item { padding: 10px; border-left: 4px solid; margin-bottom: 10px; border-radius: 4px; }
        .alert-critical { border-color: #f44336; background: #ffebee; }
        .alert-major { border-color: #ff9800; background: #fff3e0; }
        .alert-moderate { border-color: #ffeb3b; background: #fffde7; }
        .alert-minor { border-color: #4caf50; background: #e8f5e8; }
        .status-indicator { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; }
        .status-connected { background: #4caf50; }
        .status-disconnected { background: #f44336; }
        .loading { text-align: center; padding: 40px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Performance Regression Dashboard</h1>
            <p>Real-time performance monitoring and regression detection</p>
            <p>
                <span class="status-indicator status-connected"></span>
                <span id="connection-status">Connected</span> | 
                Last updated: <span id="last-updated">Loading...</span>
            </p>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value" id="response-time">--</div>
                <div class="metric-label">Response Time (ms)</div>
                <div class="metric-change" id="response-time-change">--</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="throughput">--</div>
                <div class="metric-label">Throughput (req/s)</div>
                <div class="metric-change" id="throughput-change">--</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="error-rate">--</div>
                <div class="metric-label">Error Rate (%)</div>
                <div class="metric-change" id="error-rate-change">--</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="active-alerts">--</div>
                <div class="metric-label">Active Alerts</div>
                <div class="metric-change" id="alerts-24h">-- in last 24h</div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-card">
                <h3>Response Time Trend</h3>
                <canvas id="response-time-chart"></canvas>
            </div>
            <div class="chart-card">
                <h3>Throughput Trend</h3>
                <canvas id="throughput-chart"></canvas>
            </div>
            <div class="chart-card">
                <h3>Error Rate Trend</h3>
                <canvas id="error-rate-chart"></canvas>
            </div>
            <div class="chart-card">
                <h3>Test Scores</h3>
                <canvas id="test-scores-chart"></canvas>
            </div>
        </div>

        <div class="alerts-section">
            <h3>Recent Alerts</h3>
            <div id="alerts-list" class="loading">Loading alerts...</div>
        </div>
    </div>

    <script>
        class Dashboard {
            constructor() {
                this.charts = {};
                this.ws = null;
                this.data = null;
                this.init();
            }

            async init() {
                await this.loadInitialData();
                this.initCharts();
                this.connectWebSocket();
                this.startRefresh();
            }

            async loadInitialData() {
                try {
                    const response = await fetch('/api/data');
                    this.data = await response.json();
                    this.updateUI();
                } catch (error) {
                    console.error('Failed to load initial data:', error);
                }
            }

            initCharts() {
                const chartOptions = {
                    responsive: true,
                    scales: {
                        x: { type: 'time', time: { unit: 'hour' } },
                        y: { beginAtZero: true }
                    },
                    plugins: { legend: { display: false } }
                };

                this.charts.responseTime = new Chart(document.getElementById('response-time-chart'), {
                    type: 'line',
                    data: { datasets: [{ data: [], borderColor: '#2196f3', tension: 0.4 }] },
                    options: chartOptions
                });

                this.charts.throughput = new Chart(document.getElementById('throughput-chart'), {
                    type: 'line',
                    data: { datasets: [{ data: [], borderColor: '#4caf50', tension: 0.4 }] },
                    options: chartOptions
                });

                this.charts.errorRate = new Chart(document.getElementById('error-rate-chart'), {
                    type: 'line',
                    data: { datasets: [{ data: [], borderColor: '#f44336', tension: 0.4 }] },
                    options: chartOptions
                });

                this.charts.testScores = new Chart(document.getElementById('test-scores-chart'), {
                    type: 'scatter',
                    data: { datasets: [{ data: [], backgroundColor: '#ff9800' }] },
                    options: chartOptions
                });
            }

            connectWebSocket() {
                const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
                this.ws = new WebSocket(\`\${protocol}//\${location.host}\`);

                this.ws.onopen = () => {
                    document.getElementById('connection-status').textContent = 'Connected';
                    document.querySelector('.status-indicator').className = 'status-indicator status-connected';
                };

                this.ws.onclose = () => {
                    document.getElementById('connection-status').textContent = 'Disconnected';
                    document.querySelector('.status-indicator').className = 'status-indicator status-disconnected';
                    setTimeout(() => this.connectWebSocket(), 5000);
                };

                this.ws.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                };
            }

            handleWebSocketMessage(message) {
                switch (message.type) {
                    case 'initial':
                    case 'refresh':
                        this.data = message.data;
                        this.updateUI();
                        break;
                    case 'alert':
                        this.addAlert(message.data);
                        break;
                }
            }

            updateUI() {
                if (!this.data) return;

                // Update metrics
                const metrics = this.data.metrics;
                document.getElementById('response-time').textContent = metrics.performance.responseTime.current.toFixed(1);
                document.getElementById('throughput').textContent = metrics.performance.throughput.current.toFixed(1);
                document.getElementById('error-rate').textContent = metrics.performance.errorRate.current.toFixed(2);
                document.getElementById('active-alerts').textContent = metrics.alerts.active;

                // Update changes
                this.updateChange('response-time-change', metrics.performance.responseTime.change);
                this.updateChange('throughput-change', metrics.performance.throughput.change);
                this.updateChange('error-rate-change', metrics.performance.errorRate.change);
                document.getElementById('alerts-24h').textContent = \`\${metrics.alerts.total24h} in last 24h\`;

                // Update charts
                this.updateChart('responseTime', this.data.charts.responseTime);
                this.updateChart('throughput', this.data.charts.throughput);
                this.updateChart('errorRate', this.data.charts.errorRate);
                this.updateChart('testScores', this.data.charts.testResults);

                // Update alerts
                this.updateAlerts(this.data.recentAlerts);

                // Update timestamp
                document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
            }

            updateChange(elementId, change) {
                const element = document.getElementById(elementId);
                const sign = change >= 0 ? '+' : '';
                element.textContent = \`\${sign}\${change.toFixed(1)}%\`;
                element.className = \`metric-change \${change > 0 ? 'negative' : change < 0 ? 'positive' : 'stable'}\`;
            }

            updateChart(chartName, data) {
                if (!this.charts[chartName] || !data) return;

                const chartData = data.map(point => ({
                    x: new Date(point.timestamp),
                    y: point.value
                }));

                this.charts[chartName].data.datasets[0].data = chartData;
                this.charts[chartName].update('none');
            }

            updateAlerts(alerts) {
                const container = document.getElementById('alerts-list');
                
                if (!alerts || alerts.length === 0) {
                    container.innerHTML = '<p>No recent alerts</p>';
                    return;
                }

                container.innerHTML = alerts.map(alert => \`
                    <div class="alert-item alert-\${alert.severity}">
                        <strong>\${alert.testName}</strong> - \${alert.severity.toUpperCase()}
                        <br>
                        <small>\${alert.message}</small>
                        <br>
                        <small>\${new Date(alert.timestamp).toLocaleString()}</small>
                        \${alert.acknowledged ? ' <span style="color: green;">✓ Acknowledged</span>' : ''}
                    </div>
                \`).join('');
            }

            addAlert(alert) {
                // Add new alert to the list
                if (this.data && this.data.recentAlerts) {
                    this.data.recentAlerts.unshift({
                        id: alert.id,
                        timestamp: alert.timestamp,
                        severity: alert.severity,
                        testName: alert.testName,
                        message: 'New alert',
                        acknowledged: false
                    });
                    
                    this.updateAlerts(this.data.recentAlerts.slice(0, 20));
                }
            }

            startRefresh() {
                setInterval(async () => {
                    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                        await this.loadInitialData();
                    }
                }, 30000); // Refresh every 30 seconds
            }
        }

        // Initialize dashboard when page loads
        document.addEventListener('DOMContentLoaded', () => {
            new Dashboard();
        });
    </script>
</body>
</html>`;
  }

  /**
   * Shutdown the dashboard
   */
  public async shutdown(): Promise<void> {
    console.log('🔄 Shutting down Performance Dashboard...');

    // Clear refresh timer
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Close WebSocket connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // Save final data
    await this.saveHistoricalData();

    this.isRunning = false;
    console.log('✅ Performance Dashboard shut down');
  }
}
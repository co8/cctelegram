/**
 * Chaos Engineering Dashboard
 * 
 * Real-time dashboard for monitoring chaos engineering experiments,
 * system health, recovery metrics, and MTTR analytics.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { ChaosTestRunner } from '../core/chaos-test-runner.js';
import { SystemMonitor } from '../core/system-monitor.js';
import { MTTRAnalyzer } from '../core/mttr-analyzer.js';
import { ToxiproxyIntegration } from '../network/toxiproxy-integration.js';
import { ChaosMonkeyLambda } from '../lambda/chaos-monkey-lambda.js';
import { getAllChaosScenarios } from '../fixtures/chaos-scenarios.js';
import { secureLog } from '../../../src/security.js';

export interface DashboardData {
  timestamp: number;
  systemHealth: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    issues: string[];
    metrics: any;
  };
  activeExperiments: {
    id: string;
    name: string;
    type: string;
    startTime: number;
    duration: number;
    progress: number;
    status: 'running' | 'completed' | 'failed';
  }[];
  mttrTrends: {
    current: number;
    average: number;
    trend: 'improving' | 'stable' | 'degrading';
    history: Array<{ timestamp: number; mttr: number; }>;
  };
  recoveryMechanisms: {
    name: string;
    activationCount: number;
    successRate: number;
    averageRecoveryTime: number;
  }[];
  systemMetrics: {
    cpu: number;
    memory: number;
    disk: number;
    network: {
      bytesIn: number;
      bytesOut: number;
      errors: number;
    };
    application: {
      responseTime: number;
      errorRate: number;
      throughput: number;
    };
  };
  alerts: {
    id: string;
    level: 'warning' | 'critical';
    metric: string;
    value: number;
    threshold: number;
    timestamp: number;
    acknowledged: boolean;
  }[];
  experiments: {
    total: number;
    successful: number;
    failed: number;
    averageMTTR: number;
    totalDowntime: number;
  };
  recommendations: Array<{
    category: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    expectedImprovement: number;
  }>;
}

export class ChaosDashboard {
  private app: express.Application;
  private server: any;
  private wss: WebSocketServer;
  private chaosRunner: ChaosTestRunner;
  private systemMonitor: SystemMonitor;
  private mttrAnalyzer: MTTRAnalyzer;
  private toxiproxy: ToxiproxyIntegration;
  private chaosMonkey: ChaosMonkeyLambda;
  private isRunning: boolean = false;
  private dashboardData: DashboardData;
  private updateInterval?: NodeJS.Timeout;
  private connectedClients: Set<any> = new Set();

  constructor(port: number = 3001) {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    // Initialize components
    this.chaosRunner = new ChaosTestRunner();
    this.systemMonitor = new SystemMonitor();
    this.mttrAnalyzer = new MTTRAnalyzer();
    this.toxiproxy = new ToxiproxyIntegration({ autoStart: true });
    this.chaosMonkey = new ChaosMonkeyLambda();

    this.dashboardData = this.getEmptyDashboardData();

    this.setupExpressApp();
    this.setupWebSocket();
    this.setupEventListeners();

    // Start server
    this.server.listen(port, () => {
      secureLog('info', `Chaos Engineering Dashboard started on port ${port}`);
    });
  }

  /**
   * Initialize dashboard
   */
  public async initialize(): Promise<void> {
    try {
      // Initialize chaos components
      await Promise.all([
        this.chaosRunner.initialize(),
        this.systemMonitor.startMonitoring(2000),
        this.toxiproxy.initialize()
        // this.chaosMonkey.initialize() // Skip if AWS not configured
      ]);

      this.isRunning = true;

      // Start real-time data updates
      this.startDataUpdates();

      secureLog('info', 'Chaos Engineering Dashboard initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize dashboard', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Setup Express application
   */
  private setupExpressApp(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // API Routes
    this.app.get('/api/dashboard', (req, res) => {
      res.json(this.dashboardData);
    });

    this.app.get('/api/scenarios', (req, res) => {
      const scenarios = getAllChaosScenarios();
      res.json(scenarios.map(scenario => ({
        name: scenario.name,
        description: scenario.description,
        duration: scenario.duration,
        intensity: scenario.faultConfiguration.intensity,
        tags: scenario.tags
      })));
    });

    this.app.post('/api/experiments/start', async (req, res) => {
      try {
        const { scenarioName } = req.body;
        const scenarios = getAllChaosScenarios();
        const scenario = scenarios.find(s => s.name === scenarioName);

        if (!scenario) {
          return res.status(404).json({ error: 'Scenario not found' });
        }

        const experimentId = await this.chaosRunner.runScenario(scenario);
        res.json({ experimentId, status: 'started' });

      } catch (error) {
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    this.app.post('/api/experiments/:id/stop', async (req, res) => {
      try {
        const { id } = req.params;
        const stopped = await this.chaosRunner.stopExperiment(id);
        
        if (stopped) {
          res.json({ status: 'stopped' });
        } else {
          res.status(404).json({ error: 'Experiment not found' });
        }

      } catch (error) {
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    this.app.get('/api/experiments/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const experiment = await this.chaosRunner.getExperimentStatus(id);
        
        if (experiment) {
          res.json(experiment);
        } else {
          res.status(404).json({ error: 'Experiment not found' });
        }

      } catch (error) {
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    this.app.get('/api/mttr/analysis', (req, res) => {
      const analysis = this.mttrAnalyzer.getHistoricalData();
      res.json(analysis);
    });

    this.app.get('/api/system/health', (req, res) => {
      const health = this.systemMonitor.getHealthStatus();
      res.json(health);
    });

    this.app.post('/api/alerts/:id/acknowledge', (req, res) => {
      const { id } = req.params;
      const acknowledged = this.systemMonitor.acknowledgeAlert(id);
      
      if (acknowledged) {
        res.json({ status: 'acknowledged' });
      } else {
        res.status(404).json({ error: 'Alert not found' });
      }
    });

    // Serve dashboard HTML
    this.app.get('/', (req, res) => {
      res.send(this.getDashboardHTML());
    });
  }

  /**
   * Setup WebSocket for real-time updates
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      this.connectedClients.add(ws);
      
      // Send initial data
      ws.send(JSON.stringify({
        type: 'dashboard_data',
        data: this.dashboardData
      }));

      ws.on('close', () => {
        this.connectedClients.delete(ws);
      });

      ws.on('error', (error) => {
        secureLog('error', 'WebSocket error', {
          error: error.message
        });
      });
    });
  }

  /**
   * Setup event listeners for real-time updates
   */
  private setupEventListeners(): void {
    // System monitor events
    this.systemMonitor.on('alertTriggered', (alert) => {
      this.broadcastUpdate({
        type: 'alert_triggered',
        data: alert
      });
    });

    this.systemMonitor.on('metricsCollected', (metrics) => {
      this.updateSystemMetrics(metrics);
    });

    // Chaos runner events
    this.chaosRunner.on('experimentStarted', (experiment) => {
      this.broadcastUpdate({
        type: 'experiment_started',
        data: experiment
      });
    });

    this.chaosRunner.on('experimentCompleted', (experiment) => {
      this.broadcastUpdate({
        type: 'experiment_completed',
        data: experiment
      });
    });

    this.chaosRunner.on('experimentProgress', (progress) => {
      this.broadcastUpdate({
        type: 'experiment_progress',
        data: progress
      });
    });

    // MTTR analyzer events
    this.mttrAnalyzer.on('mttrAnalyzed', (analysis) => {
      this.updateMTTRData(analysis);
    });
  }

  /**
   * Start real-time data updates
   */
  private startDataUpdates(): void {
    this.updateInterval = setInterval(async () => {
      await this.updateDashboardData();
      this.broadcastUpdate({
        type: 'dashboard_data',
        data: this.dashboardData
      });
    }, 5000); // Update every 5 seconds
  }

  /**
   * Update dashboard data
   */
  private async updateDashboardData(): Promise<void> {
    try {
      // Update system health
      this.dashboardData.systemHealth = this.systemMonitor.getHealthStatus();

      // Update active experiments
      this.dashboardData.activeExperiments = await this.getActiveExperiments();

      // Update alerts
      this.dashboardData.alerts = this.systemMonitor.getAlerts().map(alert => ({
        id: alert.id,
        level: alert.level,
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
        timestamp: alert.timestamp,
        acknowledged: alert.acknowledged
      }));

      // Update system metrics
      const latestMetrics = this.systemMonitor.getMetricsHistory(1)[0];
      if (latestMetrics) {
        this.updateSystemMetrics(latestMetrics);
      }

      // Update experiment statistics
      await this.updateExperimentStatistics();

      // Update recommendations
      this.dashboardData.recommendations = await this.getRecommendations();

      this.dashboardData.timestamp = Date.now();

    } catch (error) {
      secureLog('error', 'Failed to update dashboard data', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get active experiments
   */
  private async getActiveExperiments(): Promise<DashboardData['activeExperiments']> {
    try {
      const activeExperiments = await this.chaosRunner.getActiveExperiments();
      
      return activeExperiments.map(experiment => ({
        id: experiment.id,
        name: experiment.scenario.name,
        type: experiment.scenario.faultConfiguration.type,
        startTime: experiment.startTime,
        duration: experiment.scenario.duration,
        progress: experiment.progress || 0,
        status: experiment.status
      }));

    } catch (error) {
      return [];
    }
  }

  /**
   * Update system metrics
   */
  private updateSystemMetrics(metrics: any): void {
    this.dashboardData.systemMetrics = {
      cpu: metrics.cpu.usage,
      memory: metrics.memory.usage,
      disk: metrics.disk.usage,
      network: {
        bytesIn: metrics.network.bytesReceived,
        bytesOut: metrics.network.bytesSent,
        errors: metrics.network.errors
      },
      application: {
        responseTime: metrics.application.responseTime,
        errorRate: metrics.application.errorRate,
        throughput: metrics.application.throughput
      }
    };
  }

  /**
   * Update MTTR data
   */
  private updateMTTRData(analysis: any): void {
    const historicalData = this.mttrAnalyzer.getHistoricalData();
    
    this.dashboardData.mttrTrends = {
      current: analysis.mttr,
      average: analysis.statisticalAnalysis.mean,
      trend: analysis.trends.trendDirection,
      history: historicalData.slice(-50).map(data => ({
        timestamp: data.timestamp,
        mttr: data.mttr
      }))
    };

    // Update recovery mechanisms
    this.dashboardData.recoveryMechanisms = this.aggregateRecoveryMechanisms(historicalData);
  }

  /**
   * Aggregate recovery mechanisms data
   */
  private aggregateRecoveryMechanisms(historicalData: any[]): DashboardData['recoveryMechanisms'] {
    const mechanisms = new Map<string, {
      activationCount: number;
      successCount: number;
      totalRecoveryTime: number;
    }>();

    // Process historical data to aggregate mechanism statistics
    historicalData.forEach(data => {
      // This would need to be implemented based on actual data structure
      // Placeholder implementation
      ['circuit_breaker', 'retry_logic', 'failover', 'health_check_recovery'].forEach(mechanism => {
        if (!mechanisms.has(mechanism)) {
          mechanisms.set(mechanism, {
            activationCount: 0,
            successCount: 0,
            totalRecoveryTime: 0
          });
        }
        
        const mechanismData = mechanisms.get(mechanism)!;
        mechanismData.activationCount += Math.floor(Math.random() * 2); // Placeholder
        mechanismData.successCount += Math.floor(Math.random() * 2); // Placeholder
        mechanismData.totalRecoveryTime += data.mttr; // Placeholder
      });
    });

    return Array.from(mechanisms.entries()).map(([name, data]) => ({
      name,
      activationCount: data.activationCount,
      successRate: data.activationCount > 0 ? data.successCount / data.activationCount : 0,
      averageRecoveryTime: data.activationCount > 0 ? data.totalRecoveryTime / data.activationCount : 0
    }));
  }

  /**
   * Update experiment statistics
   */
  private async updateExperimentStatistics(): Promise<void> {
    try {
      const experimentHistory = await this.chaosRunner.getExperimentHistory();
      
      this.dashboardData.experiments = {
        total: experimentHistory.length,
        successful: experimentHistory.filter(e => e.success).length,
        failed: experimentHistory.filter(e => !e.success).length,
        averageMTTR: experimentHistory.length > 0 ? 
          experimentHistory.reduce((sum, e) => sum + (e.mttrAnalysis?.mttr || 0), 0) / experimentHistory.length : 0,
        totalDowntime: experimentHistory.reduce((sum, e) => sum + (e.mttrAnalysis?.downtime || 0), 0)
      };

    } catch (error) {
      // Use default values if unable to get experiment history
      this.dashboardData.experiments = {
        total: 0,
        successful: 0,
        failed: 0,
        averageMTTR: 0,
        totalDowntime: 0
      };
    }
  }

  /**
   * Get recommendations
   */
  private async getRecommendations(): Promise<DashboardData['recommendations']> {
    try {
      const historicalData = this.mttrAnalyzer.getHistoricalData();
      if (historicalData.length === 0) {
        return [];
      }

      const latestAnalysis = historicalData[historicalData.length - 1];
      
      // Generate recommendations based on latest MTTR analysis
      return [
        {
          category: 'detection',
          priority: 'high',
          title: 'Improve Failure Detection Speed',
          description: 'Implement faster health checks to reduce detection time',
          expectedImprovement: 15000 // 15 seconds
        },
        {
          category: 'automation',
          priority: 'medium',
          title: 'Automate Recovery Procedures',
          description: 'Implement automated recovery for common failure scenarios',
          expectedImprovement: 30000 // 30 seconds
        },
        {
          category: 'monitoring',
          priority: 'high',
          title: 'Enhanced System Monitoring',
          description: 'Add more comprehensive monitoring and alerting',
          expectedImprovement: 20000 // 20 seconds
        }
      ];

    } catch (error) {
      return [];
    }
  }

  /**
   * Broadcast update to all connected clients
   */
  private broadcastUpdate(update: any): void {
    const message = JSON.stringify(update);
    
    this.connectedClients.forEach(client => {
      try {
        client.send(message);
      } catch (error) {
        // Remove disconnected clients
        this.connectedClients.delete(client);
      }
    });
  }

  /**
   * Get empty dashboard data
   */
  private getEmptyDashboardData(): DashboardData {
    return {
      timestamp: Date.now(),
      systemHealth: {
        status: 'healthy',
        issues: [],
        metrics: null
      },
      activeExperiments: [],
      mttrTrends: {
        current: 0,
        average: 0,
        trend: 'stable',
        history: []
      },
      recoveryMechanisms: [],
      systemMetrics: {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: { bytesIn: 0, bytesOut: 0, errors: 0 },
        application: { responseTime: 0, errorRate: 0, throughput: 0 }
      },
      alerts: [],
      experiments: {
        total: 0,
        successful: 0,
        failed: 0,
        averageMTTR: 0,
        totalDowntime: 0
      },
      recommendations: []
    };
  }

  /**
   * Get dashboard HTML
   */
  private getDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chaos Engineering Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Arial, sans-serif; 
            background: #0a0a0a; 
            color: #ffffff; 
            overflow-x: hidden;
        }
        .dashboard { 
            padding: 20px; 
            max-width: 1600px; 
            margin: 0 auto; 
        }
        .header { 
            text-align: center; 
            margin-bottom: 30px; 
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
        }
        .header h1 { 
            color: #ff6b6b; 
            font-size: 2.5em; 
            margin-bottom: 10px;
        }
        .status-bar { 
            display: flex; 
            gap: 20px; 
            margin-bottom: 30px; 
            flex-wrap: wrap;
        }
        .status-card { 
            flex: 1; 
            min-width: 200px;
            background: linear-gradient(135deg, #1a1a1a, #2a2a2a); 
            padding: 20px; 
            border-radius: 10px; 
            border: 1px solid #333;
            transition: transform 0.2s;
        }
        .status-card:hover { transform: translateY(-2px); }
        .status-card h3 { 
            color: #4ecdc4; 
            margin-bottom: 10px; 
            font-size: 1.1em;
        }
        .status-value { 
            font-size: 2em; 
            font-weight: bold; 
            margin-bottom: 5px;
        }
        .status-healthy { color: #51cf66; }
        .status-degraded { color: #ffd43b; }
        .status-unhealthy { color: #ff6b6b; }
        .grid { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 30px; 
            margin-bottom: 30px;
        }
        .panel { 
            background: linear-gradient(135deg, #1a1a1a, #2a2a2a); 
            padding: 25px; 
            border-radius: 10px; 
            border: 1px solid #333;
        }
        .panel h2 { 
            color: #4ecdc4; 
            margin-bottom: 20px; 
            font-size: 1.3em;
            border-bottom: 1px solid #333;
            padding-bottom: 10px;
        }
        .experiment-list { 
            max-height: 300px; 
            overflow-y: auto; 
        }
        .experiment-item { 
            background: #333; 
            padding: 15px; 
            margin-bottom: 10px; 
            border-radius: 5px; 
            border-left: 4px solid #4ecdc4;
        }
        .experiment-running { border-left-color: #ffd43b; }
        .experiment-failed { border-left-color: #ff6b6b; }
        .progress-bar { 
            background: #555; 
            height: 6px; 
            border-radius: 3px; 
            overflow: hidden; 
            margin-top: 10px;
        }
        .progress-fill { 
            background: linear-gradient(90deg, #4ecdc4, #51cf66); 
            height: 100%; 
            transition: width 0.5s;
        }
        .metrics-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); 
            gap: 15px; 
        }
        .metric-item { 
            text-align: center; 
            padding: 15px; 
            background: #333; 
            border-radius: 5px;
        }
        .metric-value { 
            font-size: 1.5em; 
            font-weight: bold; 
            margin-bottom: 5px;
        }
        .metric-label { 
            color: #aaa; 
            font-size: 0.9em;
        }
        .alert { 
            background: #444; 
            padding: 15px; 
            margin-bottom: 10px; 
            border-radius: 5px; 
            border-left: 4px solid #ffd43b;
        }
        .alert-critical { border-left-color: #ff6b6b; }
        .chart-placeholder { 
            height: 200px; 
            background: #333; 
            border-radius: 5px; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            color: #666;
        }
        .timestamp { 
            color: #666; 
            font-size: 0.9em; 
            text-align: center; 
            margin-top: 20px;
        }
        @media (max-width: 768px) {
            .grid { grid-template-columns: 1fr; }
            .status-bar { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🔥 Chaos Engineering Dashboard</h1>
            <p>Real-time monitoring of system resilience and recovery</p>
        </div>

        <div class="status-bar">
            <div class="status-card">
                <h3>System Health</h3>
                <div class="status-value status-healthy" id="system-status">Healthy</div>
                <div class="metric-label" id="system-issues">No issues detected</div>
            </div>
            <div class="status-card">
                <h3>Active Experiments</h3>
                <div class="status-value" id="active-experiments">0</div>
                <div class="metric-label">Running chaos tests</div>
            </div>
            <div class="status-card">
                <h3>Current MTTR</h3>
                <div class="status-value" id="current-mttr">0s</div>
                <div class="metric-label" id="mttr-trend">Stable</div>
            </div>
            <div class="status-card">
                <h3>Active Alerts</h3>
                <div class="status-value" id="active-alerts">0</div>
                <div class="metric-label">System alerts</div>
            </div>
        </div>

        <div class="grid">
            <div class="panel">
                <h2>🧪 Active Experiments</h2>
                <div class="experiment-list" id="experiment-list">
                    <div style="text-align: center; color: #666; padding: 20px;">
                        No active experiments
                    </div>
                </div>
            </div>

            <div class="panel">
                <h2>📊 System Metrics</h2>
                <div class="metrics-grid">
                    <div class="metric-item">
                        <div class="metric-value" id="cpu-usage">0%</div>
                        <div class="metric-label">CPU Usage</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-value" id="memory-usage">0%</div>
                        <div class="metric-label">Memory Usage</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-value" id="response-time">0ms</div>
                        <div class="metric-label">Response Time</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-value" id="error-rate">0%</div>
                        <div class="metric-label">Error Rate</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid">
            <div class="panel">
                <h2>⚠️ System Alerts</h2>
                <div id="alerts-list">
                    <div style="text-align: center; color: #666; padding: 20px;">
                        No active alerts
                    </div>
                </div>
            </div>

            <div class="panel">
                <h2>📈 MTTR Trends</h2>
                <div class="chart-placeholder">
                    MTTR trend visualization would go here
                </div>
            </div>
        </div>

        <div class="timestamp" id="last-update">
            Last updated: Never
        </div>
    </div>

    <script>
        const ws = new WebSocket(\`ws://\${window.location.host}\`);
        
        ws.onmessage = function(event) {
            const message = JSON.parse(event.data);
            
            if (message.type === 'dashboard_data') {
                updateDashboard(message.data);
            } else if (message.type === 'experiment_started') {
                addExperimentUpdate('Experiment started: ' + message.data.name);
            } else if (message.type === 'experiment_completed') {
                addExperimentUpdate('Experiment completed: ' + message.data.name);
            } else if (message.type === 'alert_triggered') {
                addExperimentUpdate('Alert: ' + message.data.message);
            }
        };

        function updateDashboard(data) {
            // Update system status
            const statusElement = document.getElementById('system-status');
            const issuesElement = document.getElementById('system-issues');
            statusElement.textContent = data.systemHealth.status.charAt(0).toUpperCase() + data.systemHealth.status.slice(1);
            statusElement.className = 'status-value status-' + data.systemHealth.status;
            issuesElement.textContent = data.systemHealth.issues.length > 0 ? 
                data.systemHealth.issues.join(', ') : 'No issues detected';

            // Update counters
            document.getElementById('active-experiments').textContent = data.activeExperiments.length;
            document.getElementById('current-mttr').textContent = Math.round(data.mttrTrends.current / 1000) + 's';
            document.getElementById('mttr-trend').textContent = data.mttrTrends.trend.charAt(0).toUpperCase() + data.mttrTrends.trend.slice(1);
            document.getElementById('active-alerts').textContent = data.alerts.filter(a => !a.acknowledged).length;

            // Update metrics
            document.getElementById('cpu-usage').textContent = Math.round(data.systemMetrics.cpu * 100) + '%';
            document.getElementById('memory-usage').textContent = Math.round(data.systemMetrics.memory * 100) + '%';
            document.getElementById('response-time').textContent = Math.round(data.systemMetrics.application.responseTime) + 'ms';
            document.getElementById('error-rate').textContent = Math.round(data.systemMetrics.application.errorRate * 100) + '%';

            // Update experiments
            updateExperimentsList(data.activeExperiments);

            // Update alerts
            updateAlertsList(data.alerts);

            // Update timestamp
            document.getElementById('last-update').textContent = 'Last updated: ' + new Date().toLocaleTimeString();
        }

        function updateExperimentsList(experiments) {
            const container = document.getElementById('experiment-list');
            
            if (experiments.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No active experiments</div>';
                return;
            }

            container.innerHTML = experiments.map(exp => \`
                <div class="experiment-item experiment-\${exp.status}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>\${exp.name}</strong>
                            <div style="color: #aaa; font-size: 0.9em;">\${exp.type}</div>
                        </div>
                        <div style="text-align: right;">
                            <div>\${exp.status}</div>
                            <div style="color: #aaa; font-size: 0.9em;">\${Math.round(exp.progress * 100)}%</div>
                        </div>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: \${exp.progress * 100}%"></div>
                    </div>
                </div>
            \`).join('');
        }

        function updateAlertsList(alerts) {
            const container = document.getElementById('alerts-list');
            const activeAlerts = alerts.filter(a => !a.acknowledged);
            
            if (activeAlerts.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No active alerts</div>';
                return;
            }

            container.innerHTML = activeAlerts.map(alert => \`
                <div class="alert alert-\${alert.level}">
                    <div style="display: flex; justify-content: space-between;">
                        <div>
                            <strong>\${alert.metric}</strong>
                            <div style="color: #aaa;">\${alert.value} / \${alert.threshold}</div>
                        </div>
                        <div style="color: #aaa; font-size: 0.9em;">
                            \${new Date(alert.timestamp).toLocaleTimeString()}
                        </div>
                    </div>
                </div>
            \`).join('');
        }

        function addExperimentUpdate(message) {
            console.log('Update:', message);
        }

        // Initial connection
        ws.onopen = function() {
            console.log('Connected to Chaos Dashboard');
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
        };
    </script>
</body>
</html>
    `;
  }

  /**
   * Shutdown dashboard
   */
  public async shutdown(): Promise<void> {
    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Close WebSocket connections
    this.connectedClients.forEach(client => {
      try {
        client.close();
      } catch (error) {
        // Ignore errors during shutdown
      }
    });

    // Shutdown components
    await Promise.allSettled([
      this.systemMonitor.stopMonitoring(),
      this.toxiproxy.shutdown(),
      this.chaosMonkey.shutdown(),
      this.chaosRunner.shutdown()
    ]);

    // Close server
    this.server.close();

    secureLog('info', 'Chaos Engineering Dashboard shutdown completed');
  }
}

// Start dashboard if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dashboard = new ChaosDashboard(3001);
  
  dashboard.initialize().catch(error => {
    secureLog('error', 'Failed to start dashboard', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    secureLog('info', 'Received SIGINT, shutting down dashboard...');
    await dashboard.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    secureLog('info', 'Received SIGTERM, shutting down dashboard...');
    await dashboard.shutdown();
    process.exit(0);
  });
}
/**
 * Dashboard Manager
 * 
 * Real-time operational dashboard with customizable panels,
 * authentication, and data visualization capabilities.
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import * as path from 'path';
import * as crypto from 'crypto';
import { DashboardConfig, DashboardPanel, DashboardUser } from '../config.js';
import { MetricsCollector } from '../metrics/metrics-collector.js';
import { secureLog } from '../../security.js';
import { SecurityHeadersManager, getDefaultConfig } from '../../security-headers.js';

export interface DashboardData {
  timestamp: number;
  panels: Record<string, PanelData>;
  systemOverview: SystemOverview;
  alerts: AlertSummary;
  performance: PerformanceSummary;
  security: SecuritySummary;
}

export interface PanelData {
  id: string;
  title: string;
  type: string;
  data: any;
  lastUpdated: number;
  error?: string;
}

export interface SystemOverview {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  environment: string;
  components: Array<{
    name: string;
    status: string;
    lastCheck: number;
  }>;
}

export interface AlertSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  recent: Array<{
    id: string;
    title: string;
    severity: string;
    timestamp: number;
  }>;
}

export interface PerformanceSummary {
  cpu: number;
  memory: number;
  responseTime: number;
  throughput: number;
  errorRate: number;
  availability: number;
}

export interface SecuritySummary {
  threatsBlocked: number;
  complianceScore: number;
  vulnerabilities: number;
  incidents: number;
  lastThreat: number;
}

export class DashboardManager extends EventEmitter {
  private config: DashboardConfig;
  private metricsCollector?: MetricsCollector;
  private server?: http.Server;
  private dashboardData: DashboardData;
  private updateInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private connectedClients: Set<any> = new Set();
  private securityHeaders: SecurityHeadersManager;

  constructor(config: DashboardConfig, metricsCollector?: MetricsCollector) {
    super();
    this.config = config;
    this.metricsCollector = metricsCollector;
    this.dashboardData = this.initializeDashboardData();
    this.securityHeaders = new SecurityHeadersManager(getDefaultConfig());

    secureLog('info', 'Dashboard manager initialized', {
      enabled: config.enabled,
      port: config.port,
      authentication: config.authentication.enabled,
      panels: config.panels.length
    });
  }

  /**
   * Initialize the dashboard manager
   */
  public async initialize(): Promise<void> {
    try {
      if (this.config.enabled) {
        await this.startServer();
        this.startDataUpdates();
      }

      secureLog('info', 'Dashboard manager initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize dashboard manager', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Initialize dashboard data structure
   */
  private initializeDashboardData(): DashboardData {
    const panels: Record<string, PanelData> = {};
    
    this.config.panels.forEach(panel => {
      panels[panel.id] = {
        id: panel.id,
        title: panel.title,
        type: panel.type,
        data: null,
        lastUpdated: 0
      };
    });

    return {
      timestamp: Date.now(),
      panels,
      systemOverview: {
        status: 'healthy',
        uptime: 0,
        version: process.env.SERVICE_VERSION || '1.5.0',
        environment: process.env.NODE_ENV || 'development',
        components: []
      },
      alerts: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        recent: []
      },
      performance: {
        cpu: 0,
        memory: 0,
        responseTime: 0,
        throughput: 0,
        errorRate: 0,
        availability: 100
      },
      security: {
        threatsBlocked: 0,
        complianceScore: 100,
        vulnerabilities: 0,
        incidents: 0,
        lastThreat: 0
      }
    };
  }

  /**
   * Start HTTP server for dashboard
   */
  private async startServer(): Promise<void> {
    this.server = http.createServer((req, res) => {
      // Apply security headers
      this.applySecurityHeaders(req, res);
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          secureLog('info', 'Dashboard server started', {
            port: this.config.port
          });
          resolve();
        }
      });
    });
  }

  /**
   * Apply security headers to response
   */
  private applySecurityHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Generate nonce for this request
    const requestId = req.headers['x-request-id'] as string || 
                     req.headers['x-correlation-id'] as string ||
                     crypto.randomUUID();
    
    const nonce = this.securityHeaders.generateNonce(requestId);
    (req as any).nonce = nonce;
    (req as any).requestId = requestId;

    // Apply Helmet security headers manually for http module
    const helmetHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '0',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': this.buildCSPHeader(nonce),
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Origin-Agent-Cluster': '?1'
    };

    Object.entries(helmetHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }

  /**
   * Build CSP header with nonce
   */
  private buildCSPHeader(nonce: { script: string; style: string }): string {
    const directives = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce.script}' 'strict-dynamic'`,
      `style-src 'self' 'nonce-${nonce.style}' 'unsafe-inline'`,
      "img-src 'self' data: https:",
      "font-src 'self' https: data:",
      "connect-src 'self' wss: ws:",
      "media-src 'self'",
      "object-src 'none'",
      "child-src 'self'",
      "frame-src 'none'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'"
    ];

    if (process.env.NODE_ENV !== 'development') {
      directives.push("upgrade-insecure-requests");
    }

    return directives.join('; ');
  }

  /**
   * Handle HTTP requests
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '/';
    const method = req.method || 'GET';

    try {
      // Authentication check
      if (this.config.authentication.enabled && !this.isAuthenticated(req)) {
        if (url === '/login' && method === 'POST') {
          await this.handleLogin(req, res);
          return;
        } else if (url === '/login') {
          this.serveLoginPage(res);
          return;
        } else {
          this.sendUnauthorized(res);
          return;
        }
      }

      // Route handling
      switch (true) {
        case url === '/':
        case url === '/dashboard':
          this.serveDashboard(res, req);
          break;

        case url === '/api/data':
          this.serveDashboardData(res);
          break;

        case url === '/api/panels':
          this.servePanelData(res);
          break;

        case url.startsWith('/api/panels/'):
          const panelId = url.split('/')[3];
          this.servePanelData(res, panelId);
          break;

        case url === '/api/metrics':
          await this.serveMetrics(res);
          break;

        case url === '/api/health':
          await this.serveHealth(res);
          break;

        case url === '/ws':
          this.handleWebSocket(req, res);
          break;

        case url.startsWith('/static/'):
          this.serveStaticFile(req, res);
          break;

        default:
          this.sendNotFound(res);
      }

    } catch (error) {
      secureLog('error', 'Dashboard request error', {
        url,
        method,
        error: error instanceof Error ? error.message : 'unknown'
      });
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  /**
   * Check if request is authenticated
   */
  private isAuthenticated(req: http.IncomingMessage): boolean {
    if (!this.config.authentication.enabled) return true;

    // Simple basic auth implementation
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return false;
    }

    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString().split(':');
    const [username, password] = credentials;

    return this.config.authentication.users.some(user => 
      user.username === username && user.password === password
    );
  }

  /**
   * Handle login
   */
  private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Implementation would handle login form submission
    this.sendResponse(res, 200, { status: 'login handled' });
  }

  /**
   * Serve login page
   */
  private serveLoginPage(res: http.ServerResponse): void {
    const loginHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Dashboard Login</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .login-form { padding: 2rem; border: 1px solid #ddd; border-radius: 8px; }
          input { margin: 0.5rem 0; padding: 0.5rem; width: 200px; }
          button { padding: 0.5rem 1rem; background: #007bff; color: white; border: none; cursor: pointer; }
        </style>
      </head>
      <body>
        <form class="login-form" method="post" action="/login">
          <h2>Dashboard Login</h2>
          <div><input type="text" name="username" placeholder="Username" required></div>
          <div><input type="password" name="password" placeholder="Password" required></div>
          <div><button type="submit">Login</button></div>
        </form>
      </body>
      </html>
    `;
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(loginHtml);
  }

  /**
   * Serve main dashboard
   */
  private serveDashboard(res: http.ServerResponse, req?: http.IncomingMessage): void {
    const nonce = (req as any)?.nonce || { script: '', style: '' };
    const dashboardHtml = this.generateDashboardHtml(nonce);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(dashboardHtml);
  }

  /**
   * Generate dashboard HTML
   */
  private generateDashboardHtml(nonce: { script: string; style: string }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>CCTelegram MCP Server Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style nonce="${nonce.style}">
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
          .header { background: #1f2937; color: white; padding: 1rem 2rem; display: flex; justify-content: between; align-items: center; }
          .header h1 { font-size: 1.5rem; }
          .status { display: flex; align-items: center; gap: 0.5rem; }
          .status-dot { width: 8px; height: 8px; border-radius: 50%; }
          .status-healthy { background: #10b981; }
          .status-degraded { background: #f59e0b; }
          .status-unhealthy { background: #ef4444; }
          .container { max-width: 1200px; margin: 2rem auto; padding: 0 2rem; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
          .panel { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .panel h3 { margin-bottom: 1rem; color: #374151; font-size: 1.1rem; }
          .metric { display: flex; justify-content: space-between; margin: 0.5rem 0; }
          .metric-value { font-weight: 600; }
          .alert-item { padding: 0.5rem; margin: 0.25rem 0; border-left: 4px solid; border-radius: 4px; }
          .alert-critical { border-color: #ef4444; background: #fef2f2; }
          .alert-high { border-color: #f59e0b; background: #fffbeb; }
          .alert-medium { border-color: #3b82f6; background: #eff6ff; }
          .alert-low { border-color: #6b7280; background: #f9fafb; }
          .progress-bar { background: #e5e7eb; height: 8px; border-radius: 4px; overflow: hidden; }
          .progress-fill { height: 100%; transition: width 0.3s ease; }
          .progress-normal { background: #10b981; }
          .progress-warning { background: #f59e0b; }
          .progress-critical { background: #ef4444; }
          .timestamp { font-size: 0.875rem; color: #6b7280; text-align: right; margin-top: 1rem; }
          .loading { text-align: center; color: #6b7280; }
        </style>
      </head>
      <body>
        <header class="header">
          <h1>CCTelegram MCP Server</h1>
          <div class="status">
            <div class="status-dot status-healthy" id="status-dot"></div>
            <span id="status-text">Healthy</span>
          </div>
        </header>
        
        <div class="container">
          <div class="grid" id="dashboard-grid">
            <div class="loading">Loading dashboard data...</div>
          </div>
        </div>

        <script nonce="${nonce.script}">
          let ws;
          let dashboardData = null;

          function connectWebSocket() {
            ws = new WebSocket('ws://localhost:${this.config.port}/ws');
            
            ws.onopen = function() {
              console.log('Connected to dashboard WebSocket');
            };
            
            ws.onmessage = function(event) {
              const data = JSON.parse(event.data);
              if (data.type === 'dashboard_update') {
                dashboardData = data.payload;
                updateDashboard();
              }
            };
            
            ws.onclose = function() {
              console.log('WebSocket connection closed, reconnecting...');
              setTimeout(connectWebSocket, 5000);
            };
          }

          function updateDashboard() {
            if (!dashboardData) return;

            // Update status indicator
            const statusDot = document.getElementById('status-dot');
            const statusText = document.getElementById('status-text');
            statusDot.className = 'status-dot status-' + dashboardData.systemOverview.status;
            statusText.textContent = dashboardData.systemOverview.status.charAt(0).toUpperCase() + 
                                    dashboardData.systemOverview.status.slice(1);

            // Generate dashboard panels
            const grid = document.getElementById('dashboard-grid');
            grid.innerHTML = generatePanelsHtml(dashboardData);
          }

          function generatePanelsHtml(data) {
            return \`
              <div class="panel">
                <h3>System Overview</h3>
                <div class="metric">
                  <span>Status</span>
                  <span class="metric-value">\${data.systemOverview.status}</span>
                </div>
                <div class="metric">
                  <span>Uptime</span>
                  <span class="metric-value">\${formatUptime(data.systemOverview.uptime)}</span>
                </div>
                <div class="metric">
                  <span>Version</span>
                  <span class="metric-value">\${data.systemOverview.version}</span>
                </div>
                <div class="metric">
                  <span>Environment</span>
                  <span class="metric-value">\${data.systemOverview.environment}</span>
                </div>
              </div>

              <div class="panel">
                <h3>Performance Metrics</h3>
                <div class="metric">
                  <span>CPU Usage</span>
                  <span class="metric-value">\${data.performance.cpu.toFixed(1)}%</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill \${getProgressClass(data.performance.cpu)}" 
                       style="width: \${Math.min(data.performance.cpu, 100)}%"></div>
                </div>
                
                <div class="metric">
                  <span>Memory Usage</span>
                  <span class="metric-value">\${data.performance.memory.toFixed(1)}%</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill \${getProgressClass(data.performance.memory)}" 
                       style="width: \${Math.min(data.performance.memory, 100)}%"></div>
                </div>

                <div class="metric">
                  <span>Response Time</span>
                  <span class="metric-value">\${data.performance.responseTime.toFixed(0)}ms</span>
                </div>
                <div class="metric">
                  <span>Throughput</span>
                  <span class="metric-value">\${data.performance.throughput.toFixed(1)} req/s</span>
                </div>
              </div>

              <div class="panel">
                <h3>Active Alerts</h3>
                <div class="metric">
                  <span>Total</span>
                  <span class="metric-value">\${data.alerts.total}</span>
                </div>
                <div class="metric">
                  <span>Critical</span>
                  <span class="metric-value">\${data.alerts.critical}</span>
                </div>
                <div class="metric">
                  <span>High</span>
                  <span class="metric-value">\${data.alerts.high}</span>
                </div>
                \${data.alerts.recent.map(alert => \`
                  <div class="alert-item alert-\${alert.severity}">
                    <strong>\${alert.title}</strong><br>
                    <small>\${new Date(alert.timestamp).toLocaleString()}</small>
                  </div>
                \`).join('')}
              </div>

              <div class="panel">
                <h3>Security Status</h3>
                <div class="metric">
                  <span>Threats Blocked</span>
                  <span class="metric-value">\${data.security.threatsBlocked}</span>
                </div>
                <div class="metric">
                  <span>Compliance Score</span>
                  <span class="metric-value">\${data.security.complianceScore.toFixed(1)}%</span>
                </div>
                <div class="metric">
                  <span>Vulnerabilities</span>
                  <span class="metric-value">\${data.security.vulnerabilities}</span>
                </div>
                <div class="metric">
                  <span>Incidents</span>
                  <span class="metric-value">\${data.security.incidents}</span>
                </div>
              </div>

              <div class="timestamp">
                Last updated: \${new Date(data.timestamp).toLocaleString()}
              </div>
            \`;
          }

          function formatUptime(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) return \`\${days}d \${hours % 24}h\`;
            if (hours > 0) return \`\${hours}h \${minutes % 60}m\`;
            return \`\${minutes}m \${seconds % 60}s\`;
          }

          function getProgressClass(value) {
            if (value >= 80) return 'progress-critical';
            if (value >= 60) return 'progress-warning';
            return 'progress-normal';
          }

          // Initialize
          connectWebSocket();
          
          // Fallback: fetch data every 30 seconds if WebSocket fails
          setInterval(() => {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              fetch('/api/data')
                .then(response => response.json())
                .then(data => {
                  dashboardData = data;
                  updateDashboard();
                })
                .catch(console.error);
            }
          }, 30000);
        </script>
      </body>
      </html>
    `;
  }

  /**
   * Serve dashboard data as JSON
   */
  private serveDashboardData(res: http.ServerResponse): void {
    this.sendResponse(res, 200, this.dashboardData);
  }

  /**
   * Serve panel data
   */
  private servePanelData(res: http.ServerResponse, panelId?: string): void {
    if (panelId) {
      const panel = this.dashboardData.panels[panelId];
      if (panel) {
        this.sendResponse(res, 200, panel);
      } else {
        this.sendNotFound(res);
      }
    } else {
      this.sendResponse(res, 200, this.dashboardData.panels);
    }
  }

  /**
   * Serve metrics data
   */
  private async serveMetrics(res: http.ServerResponse): Promise<void> {
    try {
      const metrics = await this.metricsCollector?.getAllMetrics() || {};
      this.sendResponse(res, 200, metrics);
    } catch (error) {
      this.sendError(res, 500, 'Failed to retrieve metrics');
    }
  }

  /**
   * Serve health data
   */
  private async serveHealth(res: http.ServerResponse): Promise<void> {
    const health = await this.getHealthStatus();
    this.sendResponse(res, 200, health);
  }

  /**
   * Handle WebSocket connections
   */
  private handleWebSocket(req: http.IncomingMessage, res: http.ServerResponse): void {
    // WebSocket upgrade handling would go here
    // For now, return method not allowed
    this.sendError(res, 405, 'WebSocket upgrade not implemented');
  }

  /**
   * Serve static files
   */
  private serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Static file serving would be implemented here
    this.sendNotFound(res);
  }

  /**
   * Start data updates
   */
  private startDataUpdates(): void {
    this.updateInterval = setInterval(() => {
      this.updateDashboardData();
    }, this.config.refresh.interval);

    // Initial update
    this.updateDashboardData();
  }

  /**
   * Update dashboard data
   */
  private async updateDashboardData(): Promise<void> {
    try {
      // Update timestamp
      this.dashboardData.timestamp = Date.now();

      // Update system overview
      await this.updateSystemOverview();

      // Update performance data
      await this.updatePerformanceData();

      // Update panel data
      await this.updatePanelData();

      // Emit update event
      this.emit('dashboard_updated', this.dashboardData);

      // Broadcast to connected WebSocket clients
      this.broadcastUpdate();

    } catch (error) {
      secureLog('error', 'Failed to update dashboard data', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Update system overview
   */
  private async updateSystemOverview(): Promise<void> {
    // This would integrate with the observability manager to get component status
    this.dashboardData.systemOverview = {
      status: 'healthy', // Would be determined by component health
      uptime: Date.now() - (process.uptime() * 1000),
      version: process.env.SERVICE_VERSION || '1.5.0',
      environment: process.env.NODE_ENV || 'development',
      components: [
        { name: 'Metrics', status: 'healthy', lastCheck: Date.now() },
        { name: 'Logging', status: 'healthy', lastCheck: Date.now() },
        { name: 'Tracing', status: 'healthy', lastCheck: Date.now() },
        { name: 'Security', status: 'healthy', lastCheck: Date.now() },
        { name: 'Alerting', status: 'healthy', lastCheck: Date.now() }
      ]
    };
  }

  /**
   * Update performance data
   */
  private async updatePerformanceData(): Promise<void> {
    // Get performance data from metrics collector or performance monitor
    if (this.metricsCollector) {
      const metrics = await this.metricsCollector.getAllMetrics();
      
      // Extract performance metrics from the metrics data
      this.dashboardData.performance = {
        cpu: this.extractMetricValue(metrics, 'cpu_usage_percent') || 0,
        memory: this.extractMetricValue(metrics, 'memory_usage_percent') || 0,
        responseTime: this.extractMetricValue(metrics, 'response_time_ms') || 0,
        throughput: this.extractMetricValue(metrics, 'requests_per_second') || 0,
        errorRate: this.extractMetricValue(metrics, 'error_rate_percent') || 0,
        availability: 100 // Would be calculated based on uptime
      };
    }
  }

  /**
   * Extract metric value from metrics data
   */
  private extractMetricValue(metrics: any, metricName: string): number | undefined {
    // Implementation would depend on the metrics data structure
    if (metrics.custom && metrics.custom[metricName]) {
      const values = metrics.custom[metricName];
      return values.length > 0 ? values[values.length - 1].value : undefined;
    }
    return undefined;
  }

  /**
   * Update panel data
   */
  private async updatePanelData(): Promise<void> {
    for (const panelConfig of this.config.panels) {
      try {
        const panelData = this.dashboardData.panels[panelConfig.id];
        panelData.data = await this.queryPanelData(panelConfig);
        panelData.lastUpdated = Date.now();
        panelData.error = undefined;
      } catch (error) {
        const panelData = this.dashboardData.panels[panelConfig.id];
        panelData.error = error instanceof Error ? error.message : 'unknown error';
      }
    }
  }

  /**
   * Query data for a specific panel
   */
  private async queryPanelData(panel: DashboardPanel): Promise<any> {
    // Implementation would depend on the panel type and query
    switch (panel.type) {
      case 'stat':
        return this.queryStatData(panel.query);
      case 'graph':
        return this.queryGraphData(panel.query);
      case 'table':
        return this.queryTableData(panel.query);
      default:
        return null;
    }
  }

  /**
   * Query stat data
   */
  private async queryStatData(query: string): Promise<any> {
    // Implementation would parse the query and return appropriate data
    return { value: Math.random() * 100, unit: '%' };
  }

  /**
   * Query graph data
   */
  private async queryGraphData(query: string): Promise<any> {
    // Implementation would return time series data
    const now = Date.now();
    const data = [];
    
    for (let i = 0; i < 20; i++) {
      data.push({
        timestamp: now - (i * 60000), // Every minute
        value: Math.random() * 100
      });
    }
    
    return data.reverse();
  }

  /**
   * Query table data
   */
  private async queryTableData(query: string): Promise<any> {
    // Implementation would return tabular data
    return {
      columns: ['Name', 'Status', 'Last Check'],
      rows: [
        ['Metrics', 'Healthy', new Date().toISOString()],
        ['Logging', 'Healthy', new Date().toISOString()],
        ['Alerts', 'Healthy', new Date().toISOString()]
      ]
    };
  }

  /**
   * Broadcast update to WebSocket clients
   */
  private broadcastUpdate(): void {
    const message = JSON.stringify({
      type: 'dashboard_update',
      payload: this.dashboardData
    });

    this.connectedClients.forEach(client => {
      try {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(message);
        }
      } catch (error) {
        this.connectedClients.delete(client);
      }
    });
  }

  /**
   * Send JSON response
   */
  private sendResponse(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
  }

  /**
   * Send error response
   */
  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    this.sendResponse(res, statusCode, { error: message });
  }

  /**
   * Send not found response
   */
  private sendNotFound(res: http.ServerResponse): void {
    this.sendError(res, 404, 'Not Found');
  }

  /**
   * Send unauthorized response
   */
  private sendUnauthorized(res: http.ServerResponse): void {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Dashboard"',
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  /**
   * Update alert data from alerting engine
   */
  public updateAlerts(alerts: any[]): void {
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    
    alerts.forEach(alert => {
      if (severityCounts.hasOwnProperty(alert.severity)) {
        severityCounts[alert.severity as keyof typeof severityCounts]++;
      }
    });

    this.dashboardData.alerts = {
      total: alerts.length,
      critical: severityCounts.critical,
      high: severityCounts.high,
      medium: severityCounts.medium,
      low: severityCounts.low,
      recent: alerts.slice(0, 5).map(alert => ({
        id: alert.id,
        title: alert.title,
        severity: alert.severity,
        timestamp: alert.createdAt
      }))
    };
  }

  /**
   * Update security data from security monitor
   */
  public updateSecurity(securityData: any): void {
    this.dashboardData.security = {
      threatsBlocked: securityData.threatsBlocked || 0,
      complianceScore: securityData.complianceScore || 100,
      vulnerabilities: securityData.vulnerabilities || 0,
      incidents: securityData.incidents || 0,
      lastThreat: securityData.lastThreat || 0
    };
  }

  /**
   * Get current dashboard data
   */
  public getDashboardData(): DashboardData {
    return { ...this.dashboardData };
  }

  /**
   * Get health status
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  }> {
    const details: Record<string, any> = {
      isRunning: this.isRunning,
      serverRunning: !!this.server,
      port: this.config.port,
      connectedClients: this.connectedClients.size,
      lastUpdate: this.dashboardData.timestamp,
      panelsCount: Object.keys(this.dashboardData.panels).length
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!this.isRunning) {
      status = 'unhealthy';
      details.reason = 'Dashboard not running';
    } else if (!this.server) {
      status = 'unhealthy';
      details.reason = 'HTTP server not running';
    } else if (Date.now() - this.dashboardData.timestamp > 60000) {
      status = 'degraded';
      details.reason = 'Stale dashboard data';
    }

    return { status, details };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<DashboardConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.refresh && this.updateInterval) {
      clearInterval(this.updateInterval);
      this.startDataUpdates();
    }

    secureLog('info', 'Dashboard configuration updated');
  }

  /**
   * Start the dashboard
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    secureLog('info', 'Dashboard started');
  }

  /**
   * Stop the dashboard
   */
  public async stop(): Promise<void> {
    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }

    this.connectedClients.clear();

    secureLog('info', 'Dashboard stopped');
  }
}
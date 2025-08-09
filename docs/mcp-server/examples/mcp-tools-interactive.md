# Interactive MCP Tools Examples

This page demonstrates the CCTelegram MCP Server tools with live, interactive examples that you can run and modify.

## Event Notification Tools

### Basic Event Notification

Send structured events to Telegram with customizable formatting and metadata.

<CodeSandboxEmbed
  sandbox-id="cctelegram-event-basic-example"
  title="Basic Event Notification"
  description="Send a simple notification event to Telegram"
  height="400px"
  :files="{
    'index.js': `// Basic Event Notification Example
import { CCTelegramClient } from '@cctelegram/mcp-client';

const client = new CCTelegramClient({
  serverUrl: 'http://localhost:3000',
  apiKey: 'your-api-key'
});

async function sendBasicNotification() {
  try {
    const result = await client.sendTelegramEvent({
      type: 'info_notification',
      title: 'System Update',
      description: 'Application has been successfully updated to v2.1.0',
      data: {
        version: '2.1.0',
        timestamp: new Date().toISOString(),
        changes: [
          'Improved performance',
          'Bug fixes',
          'New features'
        ]
      }
    });
    
    console.log('✅ Event sent:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to send event:', error);
    throw error;
  }
}

// Usage
sendBasicNotification()
  .then(result => {
    document.getElementById('output').innerHTML = 
      \`<pre>\${JSON.stringify(result, null, 2)}</pre>\`;
  })
  .catch(error => {
    document.getElementById('output').innerHTML = 
      \`<div class=\"error\">Error: \${error.message}</div>\`;
  });`,
    'package.json': `{
  \"name\": \"cctelegram-basic-example\",
  \"version\": \"1.0.0\",
  \"type\": \"module\",
  \"dependencies\": {
    \"@cctelegram/mcp-client\": \"^1.8.5\",
    \"axios\": \"^1.6.0\"
  }
}`,
    'index.html': `<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
  <title>CCTelegram Basic Example</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    .output { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-top: 20px; }
    .error { color: #e74c3c; background: #fdf2f2; padding: 15px; border-radius: 8px; }
    button { background: #3498db; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
    button:hover { background: #2980b9; }
  </style>
</head>
<body>
  <div class=\"container\">
    <h1>CCTelegram Basic Event Example</h1>
    <p>This example demonstrates sending a basic info notification to Telegram.</p>
    <button onclick=\"sendBasicNotification()\">Send Notification</button>
    <div id=\"output\" class=\"output\">Click the button to send a notification...</div>
  </div>
  <script type=\"module\" src=\"./index.js\"></script>
</body>
</html>`
  }"
/>

### Task Completion Notification

Track and notify about task completion with detailed progress information.

<CodeSandboxEmbed
  sandbox-id="cctelegram-task-completion-example"
  title="Task Completion Notification"
  description="Send detailed task completion events with metrics"
  height="500px"
  :files="{
    'index.js': `// Task Completion Notification Example
import { CCTelegramClient } from '@cctelegram/mcp-client';

const client = new CCTelegramClient({
  serverUrl: 'http://localhost:3000',
  apiKey: 'your-api-key'
});

async function sendTaskCompletion() {
  try {
    const result = await client.sendTaskCompletion({
      task_id: 'TASK-' + Math.random().toString(36).substr(2, 9),
      title: 'Database Migration Complete',
      results: 'Successfully migrated 15,432 records to new schema',
      duration_ms: 45000,
      files_affected: [
        'src/models/user.js',
        'src/models/product.js',
        'migrations/2024_user_schema.sql'
      ]
    });
    
    console.log('✅ Task completion sent:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to send task completion:', error);
    throw error;
  }
}

async function sendTaskProgress() {
  const taskId = 'TASK-' + Math.random().toString(36).substr(2, 9);
  
  // Simulate progress updates
  for (let i = 0; i <= 100; i += 20) {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await client.sendTelegramEvent({
      type: 'task_progress',
      title: \`Processing Data: \${i}%\`,
      description: \`Processed \${i * 10} out of 1000 records\`,
      data: {
        taskId,
        progress: i,
        currentRecord: i * 10,
        totalRecords: 1000,
        estimatedTimeRemaining: (100 - i) * 100 // ms
      }
    });
  }
  
  return taskId;
}

// Demo functions
window.sendTaskCompletion = sendTaskCompletion;
window.sendTaskProgress = sendTaskProgress;`,
    'package.json': `{
  \"name\": \"cctelegram-task-example\",
  \"version\": \"1.0.0\",
  \"type\": \"module\",
  \"dependencies\": {
    \"@cctelegram/mcp-client\": \"^1.8.5\"
  }
}`
  }"
/>

## Bridge Management Tools

### Bridge Status Monitoring

Monitor and control the CCTelegram bridge connection status.

<CodeSandboxEmbed
  sandbox-id="cctelegram-bridge-status-example"
  title="Bridge Status Monitoring"
  description="Check bridge health and connection status"
  height="450px"
  :files="{
    'index.js': `// Bridge Status Monitoring Example
import { CCTelegramClient } from '@cctelegram/mcp-client';

const client = new CCTelegramClient({
  serverUrl: 'http://localhost:3000',
  apiKey: 'your-api-key'
});

async function checkBridgeStatus() {
  try {
    const status = await client.getBridgeStatus();
    
    // Display status with visual indicators
    const statusElement = document.getElementById('status');
    statusElement.innerHTML = \`
      <div class=\"status-card \${status.healthy ? 'healthy' : 'unhealthy'}\">
        <h3>Bridge Status</h3>
        <div class=\"status-indicator\">
          <span class=\"dot \${status.healthy ? 'green' : 'red'}\"></span>
          \${status.healthy ? 'Healthy' : 'Unhealthy'}
        </div>
        <div class=\"metrics\">
          <div class=\"metric\">
            <span class=\"label\">Uptime:</span>
            <span class=\"value\">\${formatUptime(status.uptime)}</span>
          </div>
          <div class=\"metric\">
            <span class=\"label\">Messages Processed:</span>
            <span class=\"value\">\${status.messagesProcessed?.toLocaleString() || 'N/A'}</span>
          </div>
          <div class=\"metric\">
            <span class=\"label\">Last Activity:</span>
            <span class=\"value\">\${status.lastActivity ? new Date(status.lastActivity).toLocaleString() : 'Never'}</span>
          </div>
        </div>
        <div class=\"connections\">
          <h4>Connections</h4>
          <div class=\"connection-list\">
            \${Object.entries(status.connections || {}).map(([name, connected]) => \`
              <div class=\"connection\">
                <span class=\"dot \${connected ? 'green' : 'red'}\"></span>
                \${name}: \${connected ? 'Connected' : 'Disconnected'}
              </div>
            \`).join('')}
          </div>
        </div>
      </div>
    \`;
    
    return status;
  } catch (error) {
    document.getElementById('status').innerHTML = \`
      <div class=\"error-card\">
        <h3>Connection Error</h3>
        <p>Failed to connect to bridge: \${error.message}</p>
      </div>
    \`;
    throw error;
  }
}

function formatUptime(seconds) {
  if (!seconds) return 'Unknown';
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(\`\${days}d\`);
  if (hours > 0) parts.push(\`\${hours}h\`);
  if (minutes > 0) parts.push(\`\${minutes}m\`);
  
  return parts.join(' ') || '< 1m';
}

// Auto-refresh status every 5 seconds
let refreshInterval;

function startStatusMonitoring() {
  checkBridgeStatus();
  refreshInterval = setInterval(checkBridgeStatus, 5000);
}

function stopStatusMonitoring() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

window.startStatusMonitoring = startStatusMonitoring;
window.stopStatusMonitoring = stopStatusMonitoring;
window.checkBridgeStatus = checkBridgeStatus;`,
    'index.html': `<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
  <title>Bridge Status Monitor</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; background: #f5f5f7; }
    .container { max-width: 600px; margin: 0 auto; }
    .controls { margin-bottom: 20px; }
    button { margin-right: 10px; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; }
    .primary { background: #007AFF; color: white; }
    .secondary { background: #8E8E93; color: white; }
    .status-card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .status-card.healthy { border-left: 4px solid #34C759; }
    .status-card.unhealthy { border-left: 4px solid #FF3B30; }
    .error-card { background: #FFEBEE; border-left: 4px solid #FF3B30; border-radius: 12px; padding: 20px; }
    .status-indicator { display: flex; align-items: center; gap: 8px; margin: 10px 0; font-size: 18px; font-weight: 600; }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot.green { background: #34C759; }
    .dot.red { background: #FF3B30; }
    .metrics { margin: 15px 0; }
    .metric { display: flex; justify-content: space-between; padding: 5px 0; }
    .label { color: #8E8E93; }
    .value { font-weight: 600; }
    .connections h4 { margin: 15px 0 10px 0; color: #1C1C1E; }
    .connection { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
  </style>
</head>
<body>
  <div class=\"container\">
    <h1>Bridge Status Monitor</h1>
    <div class=\"controls\">
      <button class=\"primary\" onclick=\"startStatusMonitoring()\">Start Monitoring</button>
      <button class=\"secondary\" onclick=\"stopStatusMonitoring()\">Stop Monitoring</button>
      <button onclick=\"checkBridgeStatus()\">Refresh Now</button>
    </div>
    <div id=\"status\">Click \"Start Monitoring\" to begin...</div>
  </div>
  <script type=\"module\" src=\"./index.js\"></script>
</body>
</html>`
  }"
/>

## Performance Alert Tools

### System Performance Monitoring

Monitor system performance and send alerts when thresholds are exceeded.

<CodeSandboxEmbed
  sandbox-id="cctelegram-performance-alert-example"
  title="Performance Alert System"
  description="Monitor system metrics and send performance alerts"
  height="600px"
  :files="{
    'index.js': `// Performance Alert System Example
import { CCTelegramClient } from '@cctelegram/mcp-client';

const client = new CCTelegramClient({
  serverUrl: 'http://localhost:3000',
  apiKey: 'your-api-key'
});

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      cpuUsage: 0,
      memoryUsage: 0,
      responseTime: 0,
      errorRate: 0
    };
    this.thresholds = {
      cpuUsage: 80,
      memoryUsage: 85,
      responseTime: 1000,
      errorRate: 5
    };
    this.alertsSent = new Set();
  }

  // Simulate getting system metrics
  async getSystemMetrics() {
    // In real implementation, these would come from actual system monitoring
    return {
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 100,
      responseTime: Math.random() * 2000,
      errorRate: Math.random() * 10,
      timestamp: Date.now()
    };
  }

  async checkThresholds(metrics) {
    for (const [metric, value] of Object.entries(metrics)) {
      if (this.thresholds[metric] && value > this.thresholds[metric]) {
        const alertKey = \`\${metric}-\${Math.floor(Date.now() / 60000)}\`; // One alert per minute
        
        if (!this.alertsSent.has(alertKey)) {
          await this.sendPerformanceAlert(metric, value, this.thresholds[metric]);
          this.alertsSent.add(alertKey);
        }
      }
    }

    // Clean old alert keys (older than 5 minutes)
    const fiveMinutesAgo = Math.floor((Date.now() - 300000) / 60000);
    for (const alertKey of this.alertsSent) {
      const [, timestamp] = alertKey.split('-');
      if (parseInt(timestamp) < fiveMinutesAgo) {
        this.alertsSent.delete(alertKey);
      }
    }
  }

  async sendPerformanceAlert(metric, currentValue, threshold) {
    const severity = this.calculateSeverity(currentValue, threshold);
    const metricNames = {
      cpuUsage: 'CPU Usage',
      memoryUsage: 'Memory Usage',
      responseTime: 'Response Time',
      errorRate: 'Error Rate'
    };

    try {
      const result = await client.sendPerformanceAlert({
        title: \`\${metricNames[metric]} High\`,
        current_value: Math.round(currentValue * 100) / 100,
        threshold: threshold,
        severity: severity
      });

      console.log(\`🚨 Performance alert sent for \${metric}:\`, result);
      return result;
    } catch (error) {
      console.error(\`❌ Failed to send performance alert for \${metric}:\`, error);
      throw error;
    }
  }

  calculateSeverity(current, threshold) {
    const ratio = current / threshold;
    if (ratio > 2) return 'critical';
    if (ratio > 1.5) return 'high';
    if (ratio > 1.2) return 'medium';
    return 'low';
  }

  async startMonitoring() {
    console.log('🔍 Starting performance monitoring...');
    
    const monitor = async () => {
      try {
        const metrics = await this.getSystemMetrics();
        this.metrics = metrics;
        
        // Update UI
        this.updateMetricsDisplay(metrics);
        
        // Check thresholds
        await this.checkThresholds(metrics);
        
      } catch (error) {
        console.error('Monitoring error:', error);
      }
    };

    // Initial check
    await monitor();
    
    // Set up interval
    return setInterval(monitor, 2000); // Check every 2 seconds
  }

  updateMetricsDisplay(metrics) {
    const container = document.getElementById('metrics');
    if (!container) return;

    container.innerHTML = \`
      <div class=\"metrics-grid\">
        \${Object.entries(metrics).filter(([key]) => key !== 'timestamp').map(([key, value]) => {
          const threshold = this.thresholds[key];
          const isAlert = threshold && value > threshold;
          const percentage = key === 'responseTime' ? null : Math.round(value);
          
          return \`
            <div class=\"metric-card \${isAlert ? 'alert' : ''}\">
              <div class=\"metric-header\">
                <span class=\"metric-name\">\${this.formatMetricName(key)}</span>
                \${isAlert ? '<span class=\"alert-indicator\">🚨</span>' : ''}
              </div>
              <div class=\"metric-value\">\${this.formatMetricValue(key, value)}</div>
              <div class=\"metric-threshold\">Threshold: \${this.formatMetricValue(key, threshold || 'N/A')}</div>
              <div class=\"metric-bar\">
                <div class=\"bar-fill\" style=\"width: \${Math.min((value / (threshold || 100)) * 100, 100)}%\"></div>
              </div>
            </div>
          \`;
        }).join('')}
      </div>
      <div class=\"last-updated\">Last updated: \${new Date().toLocaleTimeString()}</div>
    \`;
  }

  formatMetricName(key) {
    const names = {
      cpuUsage: 'CPU Usage',
      memoryUsage: 'Memory Usage',
      responseTime: 'Response Time',
      errorRate: 'Error Rate'
    };
    return names[key] || key;
  }

  formatMetricValue(key, value) {
    if (value === 'N/A') return 'N/A';
    
    switch (key) {
      case 'responseTime':
        return \`\${Math.round(value)}ms\`;
      case 'cpuUsage':
      case 'memoryUsage':
      case 'errorRate':
        return \`\${Math.round(value)}%\`;
      default:
        return Math.round(value * 100) / 100;
    }
  }
}

// Global instance
const performanceMonitor = new PerformanceMonitor();
let monitoringInterval;

window.startMonitoring = () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  performanceMonitor.startMonitoring().then(interval => {
    monitoringInterval = interval;
  });
};

window.stopMonitoring = () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log('🛑 Stopped performance monitoring');
  }
};`
  }"
/>

## User Approval Workflows

### Interactive Approval Requests

Send approval requests to Telegram and handle user responses.

<CodeSandboxEmbed
  sandbox-id="cctelegram-approval-workflow-example"
  title="Approval Workflow System"
  description="Send approval requests and handle user responses"
  height="500px"
  :files="{
    'index.js': `// Approval Workflow System Example
import { CCTelegramClient } from '@cctelegram/mcp-client';

const client = new CCTelegramClient({
  serverUrl: 'http://localhost:3000',
  apiKey: 'your-api-key'
});

class ApprovalWorkflow {
  constructor() {
    this.pendingApprovals = new Map();
  }

  async sendApprovalRequest(title, description, options = ['Approve', 'Deny']) {
    try {
      const result = await client.sendApprovalRequest({
        title,
        description,
        options
      });

      // Store pending approval
      this.pendingApprovals.set(result.requestId, {
        title,
        description,
        options,
        timestamp: Date.now(),
        status: 'pending'
      });

      console.log('📝 Approval request sent:', result);
      this.updatePendingApprovalsList();
      
      return result;
    } catch (error) {
      console.error('❌ Failed to send approval request:', error);
      throw error;
    }
  }

  async checkApprovalResponses() {
    try {
      const responses = await client.getTelegramResponses();
      
      for (const response of responses) {
        if (this.pendingApprovals.has(response.requestId)) {
          const approval = this.pendingApprovals.get(response.requestId);
          approval.status = 'responded';
          approval.response = response.response;
          approval.respondedAt = response.timestamp;
          approval.respondedBy = response.userId;
          
          console.log(\`✅ Received response for \${approval.title}: \${response.response}\`);
        }
      }
      
      this.updatePendingApprovalsList();
      return responses;
    } catch (error) {
      console.error('❌ Failed to check responses:', error);
      throw error;
    }
  }

  updatePendingApprovalsList() {
    const container = document.getElementById('approvals-list');
    if (!container) return;

    const approvals = Array.from(this.pendingApprovals.entries());
    
    if (approvals.length === 0) {
      container.innerHTML = '<p>No pending approvals</p>';
      return;
    }

    container.innerHTML = \`
      <div class=\"approvals-container\">
        \${approvals.map(([requestId, approval]) => \`
          <div class=\"approval-card \${approval.status}\">
            <div class=\"approval-header\">
              <h4>\${approval.title}</h4>
              <span class=\"status-badge \${approval.status}\">\${approval.status.toUpperCase()}</span>
            </div>
            <p class=\"approval-description\">\${approval.description}</p>
            <div class=\"approval-meta\">
              <span>Sent: \${new Date(approval.timestamp).toLocaleString()}</span>
              \${approval.respondedAt ? \`<span>Responded: \${new Date(approval.respondedAt).toLocaleString()}</span>\` : ''}
            </div>
            \${approval.response ? \`
              <div class=\"approval-response\">
                <strong>Response:</strong> \${approval.response}
                \${approval.respondedBy ? \`<br><small>By User ID: \${approval.respondedBy}</small>\` : ''}
              </div>
            \` : ''}
            <div class=\"approval-options\">
              <strong>Options:</strong> \${approval.options.join(', ')}
            </div>
          </div>
        \`).join('')}
      </div>
    \`;
  }

  // Predefined approval scenarios
  async sendDeploymentApproval() {
    return this.sendApprovalRequest(
      'Production Deployment',
      'Deploy version 2.1.0 to production environment? This will include database migrations and may cause 2-3 minutes of downtime.',
      ['Deploy Now', 'Schedule Later', 'Cancel']
    );
  }

  async sendSecurityUpdateApproval() {
    return this.sendApprovalRequest(
      'Security Update Required',
      'Critical security vulnerability detected in authentication module. Immediate update recommended.',
      ['Update Immediately', 'Schedule Maintenance Window', 'Review First']
    );
  }

  async sendUserAccessApproval() {
    return this.sendApprovalRequest(
      'User Access Request',
      'John Doe (john.doe@company.com) is requesting admin access to the production database.',
      ['Grant Access', 'Grant Limited Access', 'Deny']
    );
  }

  async sendBudgetApproval() {
    return this.sendApprovalRequest(
      'Budget Approval',
      'Team requesting $5,000 budget increase for cloud infrastructure to handle increased traffic.',
      ['Approve Full Amount', 'Approve Partial', 'Request More Details', 'Deny']
    );
  }
}

// Global instance
const approvalWorkflow = new ApprovalWorkflow();

// Auto-check for responses
let responseCheckInterval;

window.startResponseChecking = () => {
  responseCheckInterval = setInterval(() => {
    approvalWorkflow.checkApprovalResponses();
  }, 3000); // Check every 3 seconds
};

window.stopResponseChecking = () => {
  if (responseCheckInterval) {
    clearInterval(responseCheckInterval);
    responseCheckInterval = null;
  }
};

// Export functions for buttons
window.sendDeploymentApproval = () => approvalWorkflow.sendDeploymentApproval();
window.sendSecurityUpdateApproval = () => approvalWorkflow.sendSecurityUpdateApproval();
window.sendUserAccessApproval = () => approvalWorkflow.sendUserAccessApproval();
window.sendBudgetApproval = () => approvalWorkflow.sendBudgetApproval();
window.checkResponses = () => approvalWorkflow.checkApprovalResponses();`
  }"
/>

## Configuration Examples

### MCP Server Configuration

Complete configuration examples for different environments and use cases.

<CodeSandboxEmbed
  sandbox-id="cctelegram-config-examples"
  title="MCP Server Configuration"
  description="Production-ready configuration examples"
  height="400px"
  :files="{
    '.mcp.json': `{
  \"mcpServers\": {
    \"cctelegram\": {
      \"command\": \"node\",
      \"args\": [\"./mcp-server/dist/index.js\"],
      \"env\": {
        \"TELEGRAM_BOT_TOKEN\": \"your-telegram-bot-token\",
        \"WEBHOOK_SECRET\": \"your-webhook-secret\",
        \"API_PORT\": \"3000\",
        \"LOG_LEVEL\": \"info\",
        \"RATE_LIMIT_MAX_REQUESTS\": \"100\",
        \"RATE_LIMIT_WINDOW_MS\": \"60000\"
      }
    }
  }
}`,
    'config.production.json': `{
  \"server\": {
    \"port\": 3000,
    \"host\": \"0.0.0.0\",
    \"cors\": {
      \"origin\": [\"https://app.example.com\"],
      \"credentials\": true
    }
  },
  \"telegram\": {
    \"botToken\": \"\${TELEGRAM_BOT_TOKEN}\",
    \"webhookUrl\": \"https://api.example.com/telegram/webhook\",
    \"webhookSecret\": \"\${WEBHOOK_SECRET}\"
  },
  \"security\": {
    \"apiKeys\": {
      \"production\": \"\${API_KEY_PRODUCTION}\",
      \"staging\": \"\${API_KEY_STAGING}\"
    },
    \"rateLimiting\": {
      \"maxRequests\": 1000,
      \"windowMs\": 60000,
      \"message\": \"Too many requests\"
    },
    \"helmet\": {
      \"contentSecurityPolicy\": {
        \"directives\": {
          \"defaultSrc\": [\"'self'\"],
          \"scriptSrc\": [\"'self'\", \"'unsafe-inline'\"],
          \"styleSrc\": [\"'self'\", \"'unsafe-inline'\"]
        }
      }
    }
  },
  \"monitoring\": {
    \"enabled\": true,
    \"prometheus\": {
      \"enabled\": true,
      \"port\": 9090
    },
    \"logging\": {
      \"level\": \"info\",
      \"format\": \"json\",
      \"destination\": \"console\"
    }
  },
  \"features\": {
    \"approvalWorkflows\": true,
    \"performanceAlerts\": true,
    \"taskTracking\": true,
    \"customEvents\": true
  }
}`,
    'docker-compose.yml': `version: '3.8'
services:
  cctelegram-mcp:
    image: cctelegram/mcp-server:latest
    ports:
      - \"3000:3000\"
      - \"9090:9090\"
    environment:
      - NODE_ENV=production
      - TELEGRAM_BOT_TOKEN=\${TELEGRAM_BOT_TOKEN}
      - WEBHOOK_SECRET=\${WEBHOOK_SECRET}
      - API_KEY_PRODUCTION=\${API_KEY_PRODUCTION}
    volumes:
      - ./config.production.json:/app/config.json:ro
      - ./logs:/app/logs
    healthcheck:
      test: [\"CMD\", \"curl\", \"-f\", \"http://localhost:3000/health\"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    
  prometheus:
    image: prom/prometheus:latest
    ports:
      - \"9091:9090\"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
    
  grafana:
    image: grafana/grafana:latest
    ports:
      - \"3001:3000\"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin123
    volumes:
      - grafana-storage:/var/lib/grafana

volumes:
  grafana-storage:`
  }"
/>

These interactive examples demonstrate the key functionality of the CCTelegram MCP Server. Each example is fully functional and can be modified to test different scenarios. The examples include:

- **Event notifications** with different types and data structures
- **Task completion tracking** with progress updates
- **Bridge status monitoring** with real-time health checks
- **Performance alerts** with configurable thresholds
- **Approval workflows** with interactive user responses
- **Configuration examples** for production deployments

## Next Steps

1. **Try the examples** - Click on any example to open it in CodeSandbox
2. **Modify the code** - Experiment with different parameters and configurations
3. **Integrate with your project** - Use these examples as templates for your implementation
4. **Read the documentation** - Check out the [API Reference](../api/) for complete details

For more complex scenarios and advanced usage patterns, see the [Advanced Examples](./advanced-examples.md) page.
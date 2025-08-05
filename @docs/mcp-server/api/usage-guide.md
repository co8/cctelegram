# API Usage Guide

## 🚀 Overview

This guide provides comprehensive examples and best practices for integrating with the CCTelegram MCP Server API. The server exposes 16 MCP tools via Model Context Protocol for seamless integration with Claude Code and other MCP clients.

## 🔐 Authentication

### API Key Setup

All API requests require authentication via the `X-API-Key` header:

```bash
# Environment setup
export MCP_API_KEY="your-api-key-here"
export MCP_BASE_URL="https://mcp.company.com"
```

### Security Best Practices

```typescript
// ✅ Good: Use environment variables
const apiKey = process.env.MCP_API_KEY;

// ❌ Bad: Hardcode API keys
const apiKey = "abc123def456"; // Never do this!

// ✅ Good: Validate API key exists
if (!apiKey) {
  throw new Error('MCP_API_KEY environment variable is required');
}
```

## 📡 MCP Protocol Integration

### JavaScript/TypeScript Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class CCTelegramMCPClient {
  private client: Client;
  private transport: StdioClientTransport;

  constructor() {
    this.transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', 'cctelegram-mcp-server']
    });
    this.client = new Client({
      name: 'cctelegram-client',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async sendTelegramEvent(event: {
    type: string;
    title: string;
    description: string;
    task_id?: string;
    source?: string;
    data?: Record<string, any>;
  }): Promise<any> {
    return await this.client.request(
      { method: 'tools/call', params: { name: 'send_telegram_event', arguments: event } },
      'ToolCallResultSchema'
    );
  }

  async getBridgeStatus(): Promise<any> {
    return await this.client.request(
      { method: 'tools/call', params: { name: 'get_bridge_status', arguments: {} } },
      'ToolCallResultSchema'
    );
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}

// Usage example
async function example() {
  const client = new CCTelegramMCPClient();
  
  try {
    await client.connect();
    
    // Send a task completion notification
    const result = await client.sendTelegramEvent({
      type: 'task_completion',
      title: 'Build Process Completed',
      description: 'Successfully built and deployed version 1.5.0',
      task_id: 'build_001',
      source: 'ci-cd-pipeline',
      data: {
        version: '1.5.0',
        duration_ms: 120000,
        artifacts: ['dist/app.js', 'dist/styles.css']
      }
    });
    
    console.log('Event sent:', result);
    
  } finally {
    await client.disconnect();
  }
}
```

### Python Client

```python
import asyncio
import json
from typing import Dict, Any, Optional
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class CCTelegramMCPClient:
    def __init__(self):
        self.session: Optional[ClientSession] = None
    
    async def connect(self):
        server_params = StdioServerParameters(
            command="npx",
            args=["-y", "cctelegram-mcp-server"]
        )
        
        self.session = await stdio_client(server_params)
        await self.session.initialize()
    
    async def send_telegram_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        if not self.session:
            raise RuntimeError("Client not connected")
        
        result = await self.session.call_tool(
            "send_telegram_event",
            arguments=event
        )
        return result.content[0].text if result.content else {}
    
    async def get_bridge_status(self) -> Dict[str, Any]:
        if not self.session:
            raise RuntimeError("Client not connected")
        
        result = await self.session.call_tool(
            "get_bridge_status",
            arguments={}
        )
        return json.loads(result.content[0].text) if result.content else {}
    
    async def disconnect(self):
        if self.session:
            await self.session.close()

# Usage example
async def example():
    client = CCTelegramMCPClient()
    
    try:
        await client.connect()
        
        # Send performance alert
        result = await client.send_telegram_event({
            "type": "performance_alert",
            "title": "High CPU Usage Detected",
            "description": "CPU usage has exceeded 80% threshold",
            "source": "monitoring-system",
            "data": {
                "current_value": 85.7,
                "threshold": 80.0,
                "duration_ms": 300000,
                "severity": "high"
            }
        })
        
        print(f"Alert sent: {result}")
        
    finally:
        await client.disconnect()

# Run the example
asyncio.run(example())
```

### Go Client

```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    
    "github.com/modelcontextprotocol/go-sdk/mcp"
)

type CCTelegramMCPClient struct {
    client *mcp.Client
}

func NewCCTelegramMCPClient() *CCTelegramMCPClient {
    transport := mcp.NewStdioTransport(mcp.StdioTransportOptions{
        Command: "npx",
        Args:    []string{"-y", "cctelegram-mcp-server"},
    })
    
    client := mcp.NewClient(mcp.ClientOptions{
        Name:    "cctelegram-go-client",
        Version: "1.0.0",
    })
    
    client.Connect(transport)
    
    return &CCTelegramMCPClient{client: client}
}

func (c *CCTelegramMCPClient) SendTelegramEvent(event map[string]interface{}) (map[string]interface{}, error) {
    result, err := c.client.CallTool(context.Background(), "send_telegram_event", event)
    if err != nil {
        return nil, err
    }
    
    var response map[string]interface{}
    if len(result.Content) > 0 {
        json.Unmarshal([]byte(result.Content[0].Text), &response)
    }
    
    return response, nil
}

func (c *CCTelegramMCPClient) GetBridgeStatus() (map[string]interface{}, error) {
    result, err := c.client.CallTool(context.Background(), "get_bridge_status", map[string]interface{}{})
    if err != nil {
        return nil, err
    }
    
    var response map[string]interface{}
    if len(result.Content) > 0 {
        json.Unmarshal([]byte(result.Content[0].Text), &response)
    }
    
    return response, nil
}

func (c *CCTelegramMCPClient) Close() error {
    return c.client.Close()
}

func main() {
    client := NewCCTelegramMCPClient()
    defer client.Close()
    
    // Send task completion
    event := map[string]interface{}{
        "type":        "task_completion",
        "title":       "Deployment Successful",
        "description": "Application deployed to production",
        "task_id":     "deploy_001",
        "source":      "deployment-pipeline",
        "data": map[string]interface{}{
            "environment": "production",
            "version":     "1.5.0",
            "duration_ms": 180000,
        },
    }
    
    result, err := client.SendTelegramEvent(event)
    if err != nil {
        log.Fatal(err)
    }
    
    fmt.Printf("Event sent: %+v\n", result)
    
    // Check bridge status
    status, err := client.GetBridgeStatus()
    if err != nil {
        log.Fatal(err)
    }
    
    fmt.Printf("Bridge status: %+v\n", status)
}
```

## 🛠️ Tool Usage Examples

### 1. Event Notifications

#### Task Completion Events

```typescript
// Successful task completion  
await client.sendTelegramEvent({
  type: 'task_completion',
  title: 'Code Review Complete',
  description: 'Pull request #123 has been reviewed and approved',
  task_id: 'pr_123',
  source: 'github-webhook',
  data: {
    status: 'approved',
    reviewer: 'senior-dev',
    files_changed: 12,
    lines_added: 245,
    lines_removed: 89
  }
});

// Failed task notification
await client.sendTelegramEvent({
  type: 'task_failed', 
  title: 'Build Failed',
  description: 'Unit tests failed in CI pipeline',
  task_id: 'build_456',
  source: 'ci-pipeline',
  data: {
    exit_code: 1,
    failed_tests: ['test_auth.py', 'test_api.py'],
    log_url: 'https://ci.company.com/builds/456/logs'
  }
});
```

#### Performance Alerts

```typescript
// CPU threshold alert
await client.sendTelegramEvent({
  type: 'performance_alert',
  title: 'High CPU Usage',
  description: 'Server CPU usage exceeded 85% for 5 minutes',
  source: 'prometheus',
  data: {
    metric: 'cpu_usage_percent',
    current_value: 87.3,
    threshold: 85.0,
    duration_ms: 300000,
    severity: 'high',
    server: 'web-01.prod'
  }
});

// Memory alert
await client.sendTelegramEvent({
  type: 'performance_alert',
  title: 'Memory Usage Critical',
  description: 'Available memory below 100MB',
  source: 'system-monitor',
  data: {
    metric: 'memory_available_bytes',
    current_value: 83886080, // 80MB
    threshold: 104857600,    // 100MB
    severity: 'critical'
  }
});
```

#### Security Alerts

```typescript
// Authentication failure alert
await client.sendTelegramEvent({
  type: 'error_occurred',
  title: 'Multiple Authentication Failures',
  description: 'Detected 10 failed login attempts from same IP',
  source: 'security-monitor',
  data: {
    event_type: 'authentication_failure',
    source_ip: '192.168.1.100',
    failure_count: 10,
    time_window: '5 minutes',
    severity: 'high',
    action_taken: 'IP temporarily blocked'
  }
});

// Suspicious activity
await client.sendTelegramEvent({
  type: 'alert_notification',
  title: 'Suspicious API Activity',
  description: 'Unusual API call patterns detected',
  source: 'api-gateway',
  data: {
    client_ip: '203.0.113.45',
    unusual_patterns: ['high_frequency_calls', 'off_hours_access'],
    requests_per_minute: 150,
    normal_baseline: 20
  }
});
```

### 2. Interactive Approvals

#### Deployment Approvals

```typescript
// Deployment approval request
const approvalResult = await client.sendTelegramEvent({
  type: 'approval_request',
  title: 'Production Deployment Approval',
  description: 'Ready to deploy version 2.1.0 to production. All tests passed.',
  task_id: 'deploy_prod_2.1.0',
  source: 'deployment-system',
  data: {
    version: '2.1.0',
    environment: 'production',
    changes: [
      'Added new user authentication flow',
      'Fixed critical security vulnerability',
      'Improved database query performance'
    ],
    test_results: {
      unit_tests: 'passed',
      integration_tests: 'passed',
      security_scan: 'passed'
    },
    requires_response: true,
    response_options: ['Deploy', 'Hold', 'Cancel'],
    timeout_minutes: 30
  }
});

// Process the approval responses
setTimeout(async () => {
  const responses = await client.processPendingResponses({ since_minutes: 30 });
  
  responses.responses.forEach(response => {
    if (response.event_id === approvalResult.event_id) {
      switch (response.user_response) {
        case 'Deploy':
          console.log('Deployment approved, proceeding...');
          // Trigger deployment
          break;
        case 'Hold':
          console.log('Deployment on hold, awaiting further instructions');
          break;
        case 'Cancel':
          console.log('Deployment cancelled');
          break;
      }
    }
  });
}, 30 * 60 * 1000); // Check after 30 minutes
```

#### Code Review Approvals

```typescript
// Code review approval
await client.sendTelegramEvent({
  type: 'approval_request',
  title: 'Urgent Hotfix Review',
  description: 'Critical security patch needs immediate review',
  task_id: 'hotfix_security_001',
  source: 'github-webhook',
  data: {
    pull_request: '#789',
    priority: 'critical',
    changes_summary: 'Fixes SQL injection vulnerability in user query endpoint',
    affected_endpoints: ['/api/users/search'],
    response_options: ['Approve & Merge', 'Request Changes', 'Escalate'],
    timeout_minutes: 15
  }
});
```

### 3. System Management

#### Bridge Management

```typescript
// Check bridge health
const status = await client.getBridgeStatus();
console.log('Bridge status:', status);

if (status.status !== 'running') {
  // Attempt to start bridge
  const startResult = await client.startBridge();
  console.log('Bridge start result:', startResult);
  
  if (!startResult.success) {
    // Send alert if start failed
    await client.sendTelegramEvent({
      type: 'error_occurred',
      title: 'Bridge Start Failed',
      description: `Failed to start CCTelegram Bridge: ${startResult.message}`,
      source: 'system-management',
      data: {
        error_type: 'bridge_start_failure',
        error_message: startResult.message,
        severity: 'high'
      }
    });
  }
}

// Restart bridge if needed
if (status.health?.overall === 'unhealthy') {
  await client.restartBridge();
}
```

#### Health Monitoring

```typescript
// Comprehensive health check
const healthCheck = async () => {
  try {
    const bridgeStatus = await client.getBridgeStatus();
    const responses = await client.getTelegramResponses({ limit: 1 });
    
    const healthReport = {
      timestamp: new Date().toISOString(),
      bridge_status: bridgeStatus.status,
      bridge_health: bridgeStatus.health?.overall,
      recent_responses: responses.count,
      overall_health: 'healthy'
    };
    
    // Determine overall health
    if (bridgeStatus.status !== 'running' || 
        bridgeStatus.health?.overall === 'unhealthy') {
      healthReport.overall_health = 'unhealthy';
    } else if (bridgeStatus.health?.overall === 'degraded') {
      healthReport.overall_health = 'degraded';
    }
    
    // Send health report if issues detected
    if (healthReport.overall_health !== 'healthy') {
      await client.sendTelegramEvent({
        type: 'system_health',
        title: `System Health: ${healthReport.overall_health.toUpperCase()}`,
        description: 'Health check detected issues requiring attention',
        source: 'health-monitor',
        data: healthReport
      });
    }
    
    return healthReport;
    
  } catch (error) {
    // Send error notification
    await client.sendTelegramEvent({
      type: 'error_occurred',
      title: 'Health Check Failed',
      description: `Unable to perform health check: ${error.message}`,
      source: 'health-monitor',
      data: {
        error_type: 'health_check_failure',
        error_message: error.message,
        severity: 'high'
      }
    });
    
    throw error;
  }
};

// Run health check periodically
setInterval(healthCheck, 5 * 60 * 1000); // Every 5 minutes
```

### 4. Task Management Integration

#### TaskMaster Integration

```typescript
// Get task status from TaskMaster
const taskStatus = await client.getTaskStatus({
  project_root: '/path/to/project',
  task_system: 'taskmaster',
  status_filter: 'in_progress'
});

// Send progress updates for active tasks
for (const task of taskStatus.taskmaster.tasks) {
  if (task.status === 'in_progress') {
    await client.sendTelegramEvent({
      type: 'task_progress',
      title: `Task Progress: ${task.title}`,
      description: `Task ${task.id} is currently in progress`,
      task_id: task.id,
      source: 'taskmaster-integration',
      data: {
        task_system: 'taskmaster',
        priority: task.priority,
        created_at: task.created_at,
        updated_at: task.updated_at
      }
    });
  }
}

// Send completion notification
const completeTask = async (taskId: string, results: string) => {
  await client.sendTaskCompletion({
    task_id: taskId,
    title: 'TaskMaster Task Completed',
    results: results,
    files_affected: ['src/components/Header.tsx', 'src/styles/main.css'],
    duration_ms: 1800000 // 30 minutes
  });
};
```

## 🔄 Error Handling & Retry Logic

### Robust Error Handling

```typescript
class RobustMCPClient {
  private client: CCTelegramMCPClient;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second
  
  constructor() {
    this.client = new CCTelegramMCPClient();
  }
  
  async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        console.warn(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelay * attempt);
        }
      }
    }
    
    throw new Error(`Operation failed after ${this.maxRetries} attempts: ${lastError!.message}`);
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async sendEventWithRetry(event: any): Promise<any> {
    return this.withRetry(async () => {
      return await this.client.sendTelegramEvent(event);
    });
  }
  
  async getBridgeStatusWithRetry(): Promise<any> {
    return this.withRetry(async () => {
      return await this.client.getBridgeStatus();
    });
  }
}

// Usage
const robustClient = new RobustMCPClient();

try {
  const result = await robustClient.sendEventWithRetry({
    type: 'task_completion',
    title: 'Test Event',
    description: 'Testing retry logic'
  });
  console.log('Event sent successfully:', result);
} catch (error) {
  console.error('All retry attempts failed:', error.message);
}
```

### Circuit Breaker Pattern

```typescript
class CircuitBreaker {
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private failureThreshold: number = 5,
    private recoveryTimeout: number = 60000 // 1 minute
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime < this.recoveryTimeout) {
        throw new Error('Circuit breaker is OPEN');
      } else {
        this.state = 'HALF_OPEN';
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}

// Usage
const circuitBreaker = new CircuitBreaker();
const client = new CCTelegramMCPClient();

const sendEventSafely = async (event: any) => {
  try {
    return await circuitBreaker.execute(async () => {
      return await client.sendTelegramEvent(event);
    });
  } catch (error) {
    console.error('Circuit breaker prevented call or operation failed:', error.message);
    // Implement fallback logic here
    return null;
  }
};
```

## 📊 Rate Limiting & Best Practices

### Rate Limiting Strategies

```typescript
class RateLimitedClient {
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessing: boolean = false;
  private requestsPerMinute: number = 60;
  private requestInterval: number = 60000 / this.requestsPerMinute;
  
  async queueRequest<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }
  
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift()!;
      await request();
      await this.delay(this.requestInterval);
    }
    
    this.isProcessing = false;
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage
const rateLimitedClient = new RateLimitedClient();
const mcpClient = new CCTelegramMCPClient();

// All requests are automatically rate-limited
const results = await Promise.all([
  rateLimitedClient.queueRequest(() => mcpClient.sendTelegramEvent(event1)),
  rateLimitedClient.queueRequest(() => mcpClient.sendTelegramEvent(event2)),
  rateLimitedClient.queueRequest(() => mcpClient.sendTelegramEvent(event3))
]);
```

### Performance Optimization

```typescript
// Batch multiple events for efficiency
class BatchedMCPClient {
  private eventBatch: any[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchSize: number = 10;
  private batchDelay: number = 5000; // 5 seconds
  
  constructor(private client: CCTelegramMCPClient) {}
  
  addEvent(event: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.eventBatch.push({ event, resolve, reject });
      
      if (this.eventBatch.length >= this.batchSize) {
        this.processBatch();
      } else if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(() => this.processBatch(), this.batchDelay);
      }
    });
  }
  
  private async processBatch(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    
    const batch = this.eventBatch.splice(0);
    
    // Process events in parallel
    const promises = batch.map(async ({ event, resolve, reject }) => {
      try {
        const result = await this.client.sendTelegramEvent(event);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    
    await Promise.allSettled(promises);
  }
}
```

## 🧪 Testing & Validation

### Unit Tests

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { CCTelegramMCPClient } from './mcp-client';

describe('CCTelegramMCPClient', () => {
  let client: CCTelegramMCPClient;
  
  beforeEach(() => {
    client = new CCTelegramMCPClient();
  });
  
  describe('sendTelegramEvent', () => {
    it('should send event successfully', async () => {
      const event = {
        type: 'task_completion',
        title: 'Test Task',
        description: 'Test description'
      };
      
      const result = await client.sendTelegramEvent(event);
      
      expect(result.success).toBe(true);
      expect(result.event_id).toBeDefined();
    });
    
    it('should handle validation errors', async () => {
      const invalidEvent = {
        type: 'invalid_type',
        title: '', // Empty title should fail validation
        description: 'Test'
      };
      
      await expect(client.sendTelegramEvent(invalidEvent))
        .rejects.toThrow('Input validation failed');
    });
  });
  
  describe('getBridgeStatus', () => {
    it('should return bridge status', async () => {
      const status = await client.getBridgeStatus();
      
      expect(status).toHaveProperty('status');
      expect(['running', 'stopped', 'error', 'unknown'])
        .toContain(status.status);
    });
  });
});
```

### Integration Tests

```typescript
describe('Integration Tests', () => {
  let client: CCTelegramMCPClient;
  
  beforeAll(async () => {
    client = new CCTelegramMCPClient();
    await client.connect();
  });
  
  afterAll(async () => {
    await client.disconnect();
  });
  
  it('should complete full workflow', async () => {
    // 1. Send approval request
    const approvalResult = await client.sendTelegramEvent({
      type: 'approval_request',
      title: 'Test Approval',
      description: 'Integration test approval',
      data: { response_options: ['Yes', 'No'] }
    });
    
    expect(approvalResult.success).toBe(true);
    
    // 2. Check bridge status
    const status = await client.getBridgeStatus();
    expect(status.status).toBe('running');
    
    // 3. Verify event was processed
    const responses = await client.getTelegramResponses({ limit: 5 });
    expect(responses.count).toBeGreaterThan(0);
  });
});
```

## 🐛 Debugging & Troubleshooting

### Debug Mode

```typescript
class DebugMCPClient extends CCTelegramMCPClient {
  private debug: boolean = process.env.MCP_DEBUG === 'true';
  
  async sendTelegramEvent(event: any): Promise<any> {
    if (this.debug) {
      console.log('🔍 Debug: Sending event:', JSON.stringify(event, null, 2));
      console.time('Event processing time');
    }
    
    try {
      const result = await super.sendTelegramEvent(event);
      
      if (this.debug) {
        console.log('✅ Debug: Event sent successfully:', result.event_id);
        console.timeEnd('Event processing time');
      }
      
      return result;
    } catch (error) {
      if (this.debug) {
        console.error('❌ Debug: Event failed:', error.message);
        console.timeEnd('Event processing time');
      }
      throw error;
    }
  }
}
```

### Health Check Utilities

```typescript
const healthCheck = async (client: CCTelegramMCPClient) => {
  const checks = {
    mcp_connection: false,
    bridge_status: false,
    telegram_api: false,
    recent_activity: false
  };
  
  try {
    // Test MCP connection with simple call
    await client.getBridgeStatus();
    checks.mcp_connection = true;
  } catch (error) {
    console.error('MCP connection failed:', error.message);
  }
  
  try {
    // Check bridge status
    const status = await client.getBridgeStatus();
    checks.bridge_status = status.status === 'running';
  } catch (error) {
    console.error('Bridge status check failed:', error.message);
  }
  
  try {
    // Test Telegram connectivity with a simple message
    await client.sendTelegramEvent({
      type: 'info_notification',
      title: 'Health Check',
      description: 'System health verification',
      source: 'health-check'
    });
    checks.telegram_api = true;
  } catch (error) {
    console.error('Telegram API test failed:', error.message);
  }
  
  try {
    // Check for recent activity
    const responses = await client.getTelegramResponses({ limit: 1 });
    checks.recent_activity = responses.count > 0;
  } catch (error) {
    console.error('Recent activity check failed:', error.message);
  }
  
  const overallHealth = Object.values(checks).every(check => check);
  
  return {
    overall_health: overallHealth ? 'healthy' : 'unhealthy',
    checks,
    timestamp: new Date().toISOString()
  };
};
```

## 📚 Advanced Usage Patterns

### Event Aggregation

```typescript
class EventAggregator {
  private events: Map<string, any[]> = new Map();
  private aggregationWindow: number = 60000; // 1 minute
  
  addEvent(type: string, event: any): void {
    if (!this.events.has(type)) {
      this.events.set(type, []);
    }
    
    this.events.get(type)!.push({
      ...event,
      timestamp: Date.now()
    });
    
    // Clean old events
    this.cleanOldEvents(type);
  }
  
  private cleanOldEvents(type: string): void {
    const events = this.events.get(type)!;
    const cutoff = Date.now() - this.aggregationWindow;
    
    this.events.set(type, events.filter(event => event.timestamp > cutoff));
  }
  
  getAggregatedSummary(type: string): any {
    const events = this.events.get(type) || [];
    
    return {
      type,
      count: events.length,
      first_event: events[0]?.timestamp,
      last_event: events[events.length - 1]?.timestamp,
      window_ms: this.aggregationWindow,
      events: events.slice(-5) // Last 5 events
    };
  }
}

// Usage for error aggregation
const errorAggregator = new EventAggregator();

const reportError = async (error: Error, context: any) => {
  errorAggregator.addEvent('error', { error: error.message, context });
  
  const summary = errorAggregator.getAggregatedSummary('error');
  
  // Only send alert if we have multiple errors in the window
  if (summary.count >= 5) {
    await client.sendTelegramEvent({
      type: 'error_occurred',
      title: `Multiple Errors Detected (${summary.count})`,
      description: `${summary.count} errors occurred in the last minute`,
      source: 'error-aggregator',
      data: summary
    });
  }
};
```

### Smart Notification Filtering

```typescript
class SmartNotificationFilter {
  private sentNotifications: Map<string, number> = new Map();
  private suppressionWindow: number = 300000; // 5 minutes
  
  shouldSendNotification(event: any): boolean {
    const key = this.getNotificationKey(event);
    const lastSent = this.sentNotifications.get(key) || 0;
    const now = Date.now();
    
    if (now - lastSent < this.suppressionWindow) {
      return false; // Suppress duplicate
    }
    
    this.sentNotifications.set(key, now);
    this.cleanOldEntries();
    
    return true;
  }
  
  private getNotificationKey(event: any): string {
    // Create a key based on event type and critical attributes
    return `${event.type}:${event.title}:${event.source}`;
  }
  
  private cleanOldEntries(): void {
    const cutoff = Date.now() - this.suppressionWindow;
    
    for (const [key, timestamp] of this.sentNotifications.entries()) {
      if (timestamp < cutoff) {
        this.sentNotifications.delete(key);
      }
    }
  }
}

// Usage
const filter = new SmartNotificationFilter();

const sendSmartNotification = async (event: any) => {
  if (filter.shouldSendNotification(event)) {
    await client.sendTelegramEvent(event);
  } else {
    console.log('Notification suppressed to avoid spam:', event.title);
  }
};
```

## 📖 Best Practices Summary

### ✅ Do's

1. **Always use environment variables** for API keys and sensitive configuration
2. **Implement proper error handling** with retries and circuit breakers
3. **Validate input data** before sending to prevent validation errors
4. **Use meaningful event titles and descriptions** for better notifications
5. **Include relevant context data** in events for debugging
6. **Implement rate limiting** to avoid overwhelming the service
7. **Monitor and log** API interactions for troubleshooting
8. **Use structured data** in event payloads for consistency
9. **Implement health checks** to verify system connectivity
10. **Test integrations** thoroughly with unit and integration tests

### ❌ Don'ts

1. **Don't hardcode API keys** or sensitive information in code
2. **Don't ignore error responses** - always handle failures gracefully
3. **Don't send excessive notifications** - implement smart filtering
4. **Don't use overly generic event types** - be specific about intent
5. **Don't skip input validation** - malformed requests will be rejected
6. **Don't exceed rate limits** - implement proper throttling
7. **Don't send sensitive data** in event payloads or logs
8. **Don't assume the bridge is always running** - check status first
9. **Don't use blocking operations** without proper timeout handling
10. **Don't skip proper connection cleanup** in client code

---

For more detailed information, refer to the [OpenAPI Specification](./openapi.yaml) and [Developer Onboarding Guide](../developers/onboarding.md).
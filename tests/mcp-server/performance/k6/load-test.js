/**
 * K6 Load Testing Script for CCTelegram MCP Server
 * 
 * Tests normal expected load with ramping up to target VUs
 * Configurable from 10 to 1000 concurrent users
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// Custom metrics
const errorRate = new Rate('error_rate');
const responseTimeP95 = new Trend('response_time_p95');
const resourceUtilization = new Counter('resource_utilization_events');

// Test data
const testEvents = new SharedArray('test_events', function () {
  return [
    {
      type: 'task_completion',
      title: 'Load Test Task Complete',
      description: 'Load testing task completed successfully',
      source: 'k6-load-test'
    },
    {
      type: 'code_generation', 
      title: 'Load Test Code Gen',
      description: 'Code generation completed for load testing',
      source: 'k6-load-test'
    },
    {
      type: 'performance_alert',
      title: 'Load Test Performance Alert',
      current_value: 85,
      threshold: 80,
      severity: 'medium'
    },
    {
      type: 'task_started',
      title: 'Load Test Task Started',
      description: 'Starting new load test task',
      source: 'k6-load-test'
    }
  ];
});

// Configuration - override with environment variables
const TARGET_VUS = parseInt(__ENV.TARGET_VUS) || 50;
const DURATION = __ENV.DURATION || '5m';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const RAMP_UP_TIME = __ENV.RAMP_UP_TIME || '30s';
const RAMP_DOWN_TIME = __ENV.RAMP_DOWN_TIME || '30s';

// Test options
export const options = {
  stages: [
    { duration: RAMP_UP_TIME, target: Math.floor(TARGET_VUS * 0.1) }, // Ramp up to 10%
    { duration: '30s', target: Math.floor(TARGET_VUS * 0.3) }, // Ramp to 30%
    { duration: '30s', target: Math.floor(TARGET_VUS * 0.6) }, // Ramp to 60%
    { duration: '30s', target: TARGET_VUS }, // Ramp to target
    { duration: DURATION, target: TARGET_VUS }, // Stay at target
    { duration: RAMP_DOWN_TIME, target: 0 }, // Ramp down
  ],
  
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
    http_req_failed: ['rate<0.01'], // Error rate under 1%
    error_rate: ['rate<0.01'],
    response_time_p95: ['p(95)<2000'],
  },
  
  // Resource monitoring
  setupTimeout: '60s',
  teardownTimeout: '60s',
};

// Setup function - runs once before the test
export function setup() {
  console.log(`Starting load test with ${TARGET_VUS} VUs for ${DURATION} against ${BASE_URL}`);
  
  // Check if server is responding
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status === 200) {
    console.log('✓ Server health check passed');
    return { serverReady: true };
  } else {
    console.error('✗ Server health check failed');
    return { serverReady: false };
  }
}

// Main test function
export default function (data) {
  if (!data.serverReady) {
    console.error('Server not ready, skipping test');
    return;
  }

  // Test MCP tool: send_telegram_event
  group('MCP Tool Tests', function () {
    group('send_telegram_event', function () {
      const eventData = testEvents[Math.floor(Math.random() * testEvents.length)];
      
      const payload = JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'send_telegram_event',
          arguments: eventData
        }
      });
      
      const params = {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: '30s'
      };
      
      const response = http.post(`${BASE_URL}/mcp`, payload, params);
      
      const success = check(response, {
        'status is 200': (r) => r.status === 200,
        'response time < 2000ms': (r) => r.timings.duration < 2000,
        'has success response': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.result && body.result.success;
          } catch (e) {
            return false;
          }
        }
      });
      
      errorRate.add(!success);
      responseTimeP95.add(response.timings.duration);
      
      if (!success) {
        console.error(`Request failed: ${response.status} - ${response.body}`);
      }
    });
    
    // Test other MCP tools with reduced frequency
    if (Math.random() < 0.3) { // 30% chance
      group('get_bridge_status', function () {
        const payload = JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'get_bridge_status',
            arguments: {}
          }
        });
        
        const response = http.post(`${BASE_URL}/mcp`, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: '10s'
        });
        
        check(response, {
          'status check passed': (r) => r.status === 200,
          'response time reasonable': (r) => r.timings.duration < 1000
        });
      });
    }
    
    if (Math.random() < 0.2) { // 20% chance
      group('get_telegram_responses', function () {
        const payload = JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'get_telegram_responses',
            arguments: { limit: 10 }
          }
        });
        
        const response = http.post(`${BASE_URL}/mcp`, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: '10s'
        });
        
        check(response, {
          'status check passed': (r) => r.status === 200,
          'response time reasonable': (r) => r.timings.duration < 1000
        });
      });
    }
  });
  
  // Test health endpoints
  if (Math.random() < 0.1) { // 10% chance
    group('Health Checks', function () {
      const healthResponse = http.get(`${BASE_URL}/health`, { timeout: '5s' });
      check(healthResponse, {
        'health check status 200': (r) => r.status === 200,
        'health check fast': (r) => r.timings.duration < 500
      });
    });
  }
  
  // Resource utilization tracking
  resourceUtilization.add(1);
  
  // Think time between requests (realistic user behavior)
  sleep(Math.random() * 2 + 0.5); // 0.5-2.5 seconds
}

// Teardown function - runs once after the test
export function teardown(data) {
  if (data.serverReady) {
    console.log('Load test completed successfully');
    
    // Optional: trigger cleanup
    const cleanupPayload = JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'clear_old_responses',
        arguments: { older_than_hours: 0 }
      }
    });
    
    try {
      http.post(`${BASE_URL}/mcp`, cleanupPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: '30s'
      });
      console.log('✓ Cleanup completed');
    } catch (e) {
      console.log('⚠ Cleanup failed (non-critical)');
    }
  }
}

// Handle summary for custom reporting
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'load-test-results.json': JSON.stringify(data, null, 2),
    'load-test-summary.html': htmlReport(data)
  };
}

// Text summary helper
function textSummary(data, options = {}) {
  const indent = options.indent || '';
  const colors = options.enableColors !== false;
  
  let output = `${indent}Load Test Results Summary\n`;
  output += `${indent}========================\n\n`;
  
  // VU and iteration info
  output += `${indent}Virtual Users: ${data.metrics.vus_max.values.max}\n`;
  output += `${indent}Iterations: ${data.metrics.iterations.values.count}\n`;
  output += `${indent}Test Duration: ${(data.state.testRunDurationMs / 1000).toFixed(1)}s\n\n`;
  
  // HTTP metrics
  const httpReqs = data.metrics.http_reqs;
  const httpDuration = data.metrics.http_req_duration;
  const httpFailed = data.metrics.http_req_failed;
  
  if (httpReqs) {
    output += `${indent}HTTP Requests: ${httpReqs.values.count} (${httpReqs.values.rate.toFixed(2)}/s)\n`;
  }
  
  if (httpDuration) {
    output += `${indent}Response Time:\n`;
    output += `${indent}  Average: ${httpDuration.values.avg.toFixed(2)}ms\n`;
    output += `${indent}  P50: ${httpDuration.values['p(50)'].toFixed(2)}ms\n`;
    output += `${indent}  P95: ${httpDuration.values['p(95)'].toFixed(2)}ms\n`;
    output += `${indent}  P99: ${httpDuration.values['p(99)'].toFixed(2)}ms\n`;
  }
  
  if (httpFailed) {
    const errorRatePercent = (httpFailed.values.rate * 100).toFixed(2);
    const errorColor = colors && httpFailed.values.rate > 0.01 ? '\x1b[31m' : '';
    const resetColor = colors ? '\x1b[0m' : '';
    output += `${indent}Error Rate: ${errorColor}${errorRatePercent}%${resetColor}\n`;
  }
  
  // Threshold results
  if (data.thresholds) {
    output += `\n${indent}Thresholds:\n`;
    Object.entries(data.thresholds).forEach(([name, threshold]) => {
      const passed = !threshold.delayAborted && !threshold.aborted;
      const status = passed ? (colors ? '\x1b[32m✓\x1b[0m' : '✓') : (colors ? '\x1b[31m✗\x1b[0m' : '✗');
      output += `${indent}  ${status} ${name}\n`;
    });
  }
  
  return output;
}

// HTML report helper
function htmlReport(data) {
  const title = 'K6 Load Test Report';
  const timestamp = new Date().toISOString();
  
  return `<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .metric { margin: 10px 0; }
        .success { color: green; }
        .warning { color: orange; }
        .error { color: red; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${title}</h1>
        <p>Generated: ${timestamp}</p>
        <p>Target VUs: ${TARGET_VUS} | Duration: ${DURATION}</p>
    </div>
    
    <h2>Test Results</h2>
    <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Virtual Users (Max)</td><td>${data.metrics.vus_max?.values.max || 'N/A'}</td></tr>
        <tr><td>Iterations</td><td>${data.metrics.iterations?.values.count || 'N/A'}</td></tr>
        <tr><td>HTTP Requests</td><td>${data.metrics.http_reqs?.values.count || 'N/A'}</td></tr>
        <tr><td>Request Rate</td><td>${data.metrics.http_reqs?.values.rate.toFixed(2) || 'N/A'}/s</td></tr>
        <tr><td>Avg Response Time</td><td>${data.metrics.http_req_duration?.values.avg.toFixed(2) || 'N/A'}ms</td></tr>
        <tr><td>P95 Response Time</td><td>${data.metrics.http_req_duration?.values['p(95)'].toFixed(2) || 'N/A'}ms</td></tr>
        <tr><td>Error Rate</td><td class="${(data.metrics.http_req_failed?.values.rate || 0) > 0.01 ? 'error' : 'success'}">${((data.metrics.http_req_failed?.values.rate || 0) * 100).toFixed(2)}%</td></tr>
    </table>
    
    <h2>Threshold Results</h2>
    <ul>
        ${Object.entries(data.thresholds || {}).map(([name, threshold]) => {
          const passed = !threshold.delayAborted && !threshold.aborted;
          const className = passed ? 'success' : 'error';
          const symbol = passed ? '✓' : '✗';
          return `<li class="${className}">${symbol} ${name}</li>`;
        }).join('')}
    </ul>
</body>
</html>`;
}
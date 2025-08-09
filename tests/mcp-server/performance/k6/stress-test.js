/**
 * K6 Stress Testing Script for CCTelegram MCP Server
 * 
 * Tests system limits by gradually increasing load beyond normal capacity
 * Helps identify breaking points and system behavior under extreme load
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// Custom metrics
const errorRate = new Rate('stress_error_rate');
const degradationPoint = new Counter('degradation_detection');
const systemFailures = new Counter('system_failures');

// Test data
const stressEvents = new SharedArray('stress_events', function () {
  return Array.from({ length: 100 }, (_, i) => ({
    type: 'stress_test_event',
    title: `Stress Test Event ${i + 1}`,
    description: `High-load stress testing event ${i + 1} with extended payload data to simulate real-world complexity`,
    source: 'k6-stress-test',
    task_id: `stress-task-${i + 1}-${Date.now()}`,
    metadata: {
      stress_level: 'high',
      iteration: i + 1,
      timestamp: new Date().toISOString(),
      payload_size: 'large',
      test_data: Array.from({ length: 50 }, (_, j) => `data-item-${j}`)
    }
  }));
});

// Configuration
const MAX_VUS = parseInt(__ENV.MAX_VUS) || 200;
const STRESS_DURATION = __ENV.STRESS_DURATION || '10m';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    // Gradually increase load to find breaking point
    { duration: '2m', target: Math.floor(MAX_VUS * 0.1) }, // 10% - baseline
    { duration: '2m', target: Math.floor(MAX_VUS * 0.2) }, // 20% - light stress
    { duration: '2m', target: Math.floor(MAX_VUS * 0.4) }, // 40% - moderate stress
    { duration: '2m', target: Math.floor(MAX_VUS * 0.6) }, // 60% - heavy stress
    { duration: '2m', target: Math.floor(MAX_VUS * 0.8) }, // 80% - extreme stress
    { duration: '3m', target: MAX_VUS }, // 100% - maximum stress
    { duration: '2m', target: Math.floor(MAX_VUS * 0.8) }, // Scale back
    { duration: '2m', target: Math.floor(MAX_VUS * 0.4) }, // Further scale back
    { duration: '1m', target: 0 }, // Cool down
  ],
  
  // More lenient thresholds for stress testing
  thresholds: {
    http_req_duration: ['p(90)<5000'], // 90% under 5s (lenient for stress)
    http_req_failed: ['rate<0.1'], // 10% error rate acceptable under stress
    stress_error_rate: ['rate<0.15'], // 15% stress-specific error rate
    http_reqs: ['rate>10'], // Minimum throughput
  },
  
  // Extended timeouts for stress conditions
  setupTimeout: '120s',
  teardownTimeout: '120s',
};

export function setup() {
  console.log(`Starting stress test with up to ${MAX_VUS} VUs against ${BASE_URL}`);
  console.log('Warning: This test will push the system to its limits');
  
  // Pre-stress health check
  const healthCheck = http.get(`${BASE_URL}/health`, { timeout: '30s' });
  if (healthCheck.status === 200) {
    console.log('✓ Pre-stress health check passed');
    
    // Get baseline performance
    const baselineStart = Date.now();
    const baselineResponse = http.post(`${BASE_URL}/mcp`, JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'get_bridge_status',
        arguments: {}
      }
    }), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s'
    });
    
    const baselineTime = Date.now() - baselineStart;
    console.log(`✓ Baseline response time: ${baselineTime}ms`);
    
    return { 
      serverReady: true,
      baselineResponseTime: baselineTime
    };
  } else {
    console.error('✗ Pre-stress health check failed');
    return { serverReady: false };
  }
}

export default function (data) {
  if (!data.serverReady) {
    console.error('Server not ready, skipping stress test');
    return;
  }

  const currentVU = __VU;
  const currentIteration = __ITER;
  
  group('High-Load Stress Tests', function () {
    // Primary stress test - send complex events
    group('stress_event_sending', function () {
      const eventData = stressEvents[currentIteration % stressEvents.length];
      
      const payload = JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'send_telegram_event',
          arguments: {
            ...eventData,
            vu_id: currentVU,
            iteration: currentIteration
          }
        }
      });
      
      const requestStart = Date.now();
      const response = http.post(`${BASE_URL}/mcp`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `k6-stress-test-vu${currentVU}`,
          'X-Stress-Level': 'high',
          'X-Test-Type': 'stress'
        },
        timeout: '60s' // Extended timeout for stress conditions
      });
      
      const responseTime = Date.now() - requestStart;
      
      // More detailed checks for stress testing
      const success = check(response, {
        'stress: status is not 500': (r) => r.status !== 500,
        'stress: response received': (r) => r.body && r.body.length > 0,
        'stress: response time reasonable': (r) => r.timings.duration < 10000,
        'stress: server still responding': (r) => r.status !== 0
      });
      
      // Track degradation
      if (responseTime > (data.baselineResponseTime * 3)) {
        degradationPoint.add(1);
      }
      
      // Track system failures
      if (response.status >= 500 || response.status === 0) {
        systemFailures.add(1);
      }
      
      errorRate.add(!success);
      
      // Log concerning responses
      if (!success || responseTime > 5000) {
        console.warn(`Stress issue - VU:${currentVU} Status:${response.status} Time:${responseTime}ms`);
      }
    });
    
    // Secondary stress operations
    if (currentIteration % 3 === 0) { // Every 3rd iteration
      group('concurrent_status_checks', function () {
        const statusRequests = [
          { name: 'get_bridge_status', args: {} },
          { name: 'get_telegram_responses', args: { limit: 5 } },
          { name: 'check_bridge_process', args: {} }
        ];
        
        // Send multiple concurrent requests to stress the system
        const promises = statusRequests.map(req => {
          const payload = JSON.stringify({
            method: 'tools/call',
            params: {
              name: req.name,
              arguments: req.args
            }
          });
          
          return http.asyncRequest('POST', `${BASE_URL}/mcp`, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: '30s'
          });
        });
        
        // Don't wait for all to complete - this is stress testing
        // Just check one response
        const firstResponse = http.post(`${BASE_URL}/mcp`, JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'get_bridge_status',
            arguments: {}
          }
        }), {
          headers: { 'Content-Type': 'application/json' },
          timeout: '15s'
        });
        
        check(firstResponse, {
          'concurrent: status check survived': (r) => r.status < 500
        });
      });
    }
    
    // Memory pressure simulation
    if (currentIteration % 5 === 0) { // Every 5th iteration
      group('memory_pressure_test', function () {
        // Create large payload to put memory pressure
        const largePayload = {
          type: 'memory_stress_test',
          title: 'Memory Pressure Test',
          description: 'Large payload to test memory handling under stress',
          source: 'k6-stress-memory',
          large_data: Array.from({ length: 1000 }, (_, i) => ({
            id: i,
            data: `memory-stress-data-${i}`.repeat(100),
            timestamp: new Date().toISOString(),
            nested: {
              level1: `nested-data-${i}`,
              level2: Array.from({ length: 50 }, (_, j) => `nested-item-${j}`)
            }
          }))
        };
        
        const response = http.post(`${BASE_URL}/mcp`, JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'send_telegram_event',
            arguments: largePayload
          }
        }), {
          headers: { 'Content-Type': 'application/json' },
          timeout: '120s' // Extra time for large payload
        });
        
        check(response, {
          'memory: large payload handled': (r) => r.status < 500,
          'memory: response within timeout': (r) => r.timings.duration < 60000
        });
      });
    }
  });
  
  // Aggressive think time for stress testing
  sleep(Math.random() * 0.5 + 0.1); // 0.1-0.6 seconds (faster than normal)
}

export function teardown(data) {
  if (data.serverReady) {
    console.log('Stress test completed');
    
    // Post-stress health check
    console.log('Performing post-stress health verification...');
    
    // Wait a moment for system to stabilize
    sleep(5);
    
    const postStressCheck = http.get(`${BASE_URL}/health`, { timeout: '60s' });
    if (postStressCheck.status === 200) {
      console.log('✓ Post-stress health check passed - system recovered');
    } else {
      console.error('✗ Post-stress health check failed - system may need attention');
    }
    
    // Optional: Trigger system cleanup
    try {
      const cleanupResponse = http.post(`${BASE_URL}/mcp`, JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'clear_old_responses',
          arguments: { older_than_hours: 0 }
        }
      }), {
        headers: { 'Content-Type': 'application/json' },
        timeout: '60s'
      });
      
      if (cleanupResponse.status === 200) {
        console.log('✓ Post-stress cleanup completed');
      }
    } catch (e) {
      console.log('⚠ Post-stress cleanup failed (may indicate system stress)');
    }
  }
}

export function handleSummary(data) {
  const stressMetrics = {
    max_vus: MAX_VUS,
    degradation_events: data.metrics.degradation_detection?.values.count || 0,
    system_failures: data.metrics.system_failures?.values.count || 0,
    peak_error_rate: Math.max(
      data.metrics.http_req_failed?.values.rate || 0,
      data.metrics.stress_error_rate?.values.rate || 0
    ),
    peak_response_time: data.metrics.http_req_duration?.values.max || 0,
    total_requests: data.metrics.http_reqs?.values.count || 0
  };
  
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'stress-test-results.json': JSON.stringify({
      ...data,
      stress_analysis: stressMetrics
    }, null, 2),
    'stress-test-report.html': htmlReport(data, stressMetrics)
  };
}

function textSummary(data, options = {}) {
  const indent = options.indent || '';
  
  let output = `${indent}Stress Test Results\n`;
  output += `${indent}==================\n\n`;
  
  output += `${indent}Max VUs Tested: ${MAX_VUS}\n`;
  output += `${indent}Total Requests: ${data.metrics.http_reqs?.values.count || 0}\n`;
  output += `${indent}Peak Response Time: ${data.metrics.http_req_duration?.values.max?.toFixed(2) || 0}ms\n`;
  
  const errorRate = (data.metrics.http_req_failed?.values.rate || 0) * 100;
  output += `${indent}Final Error Rate: ${errorRate.toFixed(2)}%\n`;
  
  const degradationEvents = data.metrics.degradation_detection?.values.count || 0;
  const systemFailures = data.metrics.system_failures?.values.count || 0;
  
  output += `${indent}Degradation Events: ${degradationEvents}\n`;
  output += `${indent}System Failures: ${systemFailures}\n\n`;
  
  if (errorRate < 10) {
    output += `${indent}✓ System handled stress well (error rate < 10%)\n`;
  } else {
    output += `${indent}⚠ System showed stress (error rate >= 10%)\n`;
  }
  
  return output;
}

function htmlReport(data, stressMetrics) {
  return `<!DOCTYPE html>
<html>
<head>
    <title>K6 Stress Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #ffe6e6; padding: 20px; border-radius: 5px; border: 2px solid #ff9999; }
        .stress-warning { color: #d32f2f; font-weight: bold; }
        .metric { margin: 10px 0; }
        .success { color: green; }
        .warning { color: orange; }
        .error { color: red; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .stress-metric { background-color: #fff3e0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>K6 Stress Test Report</h1>
        <p class="stress-warning">⚠ This was a stress test designed to push system limits</p>
        <p>Generated: ${new Date().toISOString()}</p>
        <p>Max VUs: ${MAX_VUS} | Duration: ${STRESS_DURATION}</p>
    </div>
    
    <h2>Stress Test Results</h2>
    <table>
        <tr><th>Metric</th><th>Value</th><th>Status</th></tr>
        <tr class="stress-metric">
            <td>Max Virtual Users</td>
            <td>${stressMetrics.max_vus}</td>
            <td>-</td>
        </tr>
        <tr class="stress-metric">
            <td>Degradation Events</td>
            <td>${stressMetrics.degradation_events}</td>
            <td class="${stressMetrics.degradation_events > 100 ? 'error' : 'warning'}">${stressMetrics.degradation_events > 100 ? 'High' : 'Acceptable'}</td>
        </tr>
        <tr class="stress-metric">
            <td>System Failures</td>
            <td>${stressMetrics.system_failures}</td>
            <td class="${stressMetrics.system_failures > 50 ? 'error' : 'success'}">${stressMetrics.system_failures > 50 ? 'Concerning' : 'Good'}</td>
        </tr>
        <tr>
            <td>Peak Error Rate</td>
            <td>${(stressMetrics.peak_error_rate * 100).toFixed(2)}%</td>
            <td class="${stressMetrics.peak_error_rate > 0.1 ? 'error' : 'success'}">${stressMetrics.peak_error_rate > 0.1 ? 'High' : 'Acceptable'}</td>
        </tr>
        <tr>
            <td>Peak Response Time</td>
            <td>${stressMetrics.peak_response_time.toFixed(2)}ms</td>
            <td class="${stressMetrics.peak_response_time > 5000 ? 'error' : 'warning'}">${stressMetrics.peak_response_time > 5000 ? 'Slow' : 'Acceptable'}</td>
        </tr>
        <tr>
            <td>Total Requests</td>
            <td>${stressMetrics.total_requests}</td>
            <td>-</td>
        </tr>
    </table>
    
    <h2>Performance Analysis</h2>
    <div class="metric">
        <strong>System Resilience:</strong> 
        ${stressMetrics.peak_error_rate < 0.1 ? 
          '<span class="success">Excellent - System maintained low error rates under extreme load</span>' : 
          stressMetrics.peak_error_rate < 0.2 ? 
          '<span class="warning">Good - System showed some stress but remained functional</span>' :
          '<span class="error">Concerning - System struggled under extreme load</span>'
        }
    </div>
    
    <div class="metric">
        <strong>Recommendations:</strong>
        <ul>
            ${stressMetrics.peak_error_rate > 0.15 ? '<li>Consider implementing circuit breakers</li>' : ''}
            ${stressMetrics.peak_response_time > 5000 ? '<li>Optimize slow operations identified during stress</li>' : ''}
            ${stressMetrics.degradation_events > 100 ? '<li>Review performance degradation patterns</li>' : ''}
            ${stressMetrics.system_failures > 50 ? '<li>Investigate system failure causes</li>' : ''}
            <li>Monitor system recovery time after stress events</li>
        </ul>
    </div>
</body>
</html>`;
}
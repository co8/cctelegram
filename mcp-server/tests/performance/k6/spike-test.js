/**
 * K6 Spike Testing Script for CCTelegram MCP Server
 * 
 * Tests system behavior during sudden traffic spikes
 * Simulates scenarios like viral social media mentions or system alerts
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// Custom metrics for spike testing
const spikeResponseTime = new Trend('spike_response_time');
const spikeErrorRate = new Rate('spike_error_rate');
const recoveryTime = new Trend('recovery_time');
const preSpikeThroughput = new Counter('pre_spike_throughput');
const spikePerformance = new Counter('spike_performance_events');

// Test data for spike scenarios
const spikeEvents = new SharedArray('spike_events', function () {
  const eventTypes = [
    'viral_mention',
    'system_alert_cascade', 
    'user_registration_wave',
    'security_incident',
    'performance_spike',
    'api_flood'
  ];
  
  return Array.from({ length: 200 }, (_, i) => ({
    type: eventTypes[i % eventTypes.length],
    title: `Spike Event ${i + 1}: ${eventTypes[i % eventTypes.length]}`,
    description: `Traffic spike simulation event ${i + 1}`,
    source: 'k6-spike-test',
    task_id: `spike-${i + 1}-${Date.now()}`,
    priority: Math.random() > 0.7 ? 'high' : 'medium', // 30% high priority
    spike_metadata: {
      spike_intensity: Math.random() > 0.5 ? 'high' : 'extreme',
      expected_duration: '2-5 minutes',
      traffic_multiplier: Math.floor(Math.random() * 10) + 5 // 5-15x normal
    }
  }));
});

// Configuration
const BASELINE_VUS = parseInt(__ENV.BASELINE_VUS) || 10;
const SPIKE_VUS = parseInt(__ENV.SPIKE_VUS) || 100;
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    // Baseline period
    { duration: '2m', target: BASELINE_VUS }, // Normal load
    { duration: '2m', target: BASELINE_VUS }, // Stable baseline
    
    // Spike 1: Quick spike
    { duration: '10s', target: SPIKE_VUS * 0.7 }, // Rapid increase
    { duration: '1m', target: SPIKE_VUS * 0.7 }, // Hold spike
    { duration: '30s', target: BASELINE_VUS }, // Quick recovery
    { duration: '1m', target: BASELINE_VUS }, // Recovery period
    
    // Spike 2: Extreme spike
    { duration: '5s', target: SPIKE_VUS }, // Extreme rapid spike
    { duration: '2m', target: SPIKE_VUS }, // Extended extreme load
    { duration: '1m', target: BASELINE_VUS * 2 }, // Gradual recovery
    { duration: '1m', target: BASELINE_VUS }, // Back to baseline
    
    // Spike 3: Multiple smaller spikes
    { duration: '20s', target: SPIKE_VUS * 0.5 }, // Medium spike
    { duration: '20s', target: BASELINE_VUS }, // Drop
    { duration: '20s', target: SPIKE_VUS * 0.6 }, // Another spike
    { duration: '20s', target: BASELINE_VUS }, // Drop
    { duration: '20s', target: SPIKE_VUS * 0.4 }, // Final spike
    { duration: '30s', target: 0 }, // Complete shutdown
  ],
  
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% under 3s during spikes
    http_req_failed: ['rate<0.05'], // 5% error rate acceptable during spikes
    spike_error_rate: ['rate<0.1'], // 10% spike-specific error rate
    spike_response_time: ['p(90)<5000'], // 90% under 5s during spikes
  },
  
  setupTimeout: '60s',
  teardownTimeout: '60s',
};

export function setup() {
  console.log(`Starting spike test: ${BASELINE_VUS} baseline → ${SPIKE_VUS} spike VUs`);
  
  // Health check
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    console.error('Pre-spike health check failed');
    return { serverReady: false };
  }
  
  // Establish baseline performance
  console.log('Establishing baseline performance metrics...');
  const baselineRequests = [];
  
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const response = http.post(`${BASE_URL}/mcp`, JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'get_bridge_status',
        arguments: {}
      }
    }), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s'
    });
    
    baselineRequests.push({
      status: response.status,
      duration: Date.now() - start
    });
    
    sleep(0.5);
  }
  
  const avgBaseline = baselineRequests.reduce((sum, req) => sum + req.duration, 0) / baselineRequests.length;
  console.log(`✓ Baseline average response time: ${avgBaseline.toFixed(2)}ms`);
  
  return {
    serverReady: true,
    baselineResponseTime: avgBaseline
  };
}

export default function (data) {
  if (!data.serverReady) {
    return;
  }
  
  const currentVU = __VU;
  const currentIteration = __ITER;
  const currentStage = getCurrentStageInfo();
  
  group('Spike Load Tests', function () {
    group('primary_spike_operations', function () {
      const eventData = spikeEvents[currentIteration % spikeEvents.length];
      const isSpikePeriod = currentStage.target > BASELINE_VUS * 2;
      
      const payload = JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'send_telegram_event',
          arguments: {
            ...eventData,
            spike_context: {
              vu_id: currentVU,
              iteration: currentIteration,
              stage: currentStage.name,
              is_spike_period: isSpikePeriod,
              target_vus: currentStage.target
            }
          }
        }
      });
      
      const requestStart = Date.now();
      const response = http.post(`${BASE_URL}/mcp`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Type': 'spike',
          'X-Spike-Stage': currentStage.name,
          'X-VU-Count': currentStage.target.toString()
        },
        timeout: isSpikePeriod ? '45s' : '15s' // Longer timeout during spikes
      });
      
      const responseTime = Date.now() - requestStart;
      
      // Enhanced checks for spike testing
      const success = check(response, {
        'spike: request completed': (r) => r.status > 0,
        'spike: no server errors': (r) => r.status < 500,
        'spike: reasonable response time': (r) => r.timings.duration < (isSpikePeriod ? 10000 : 5000),
        'spike: response has content': (r) => r.body && r.body.length > 0
      });
      
      // Track spike-specific metrics
      spikeResponseTime.add(responseTime);
      spikeErrorRate.add(!success);
      
      if (isSpikePeriod) {
        spikePerformance.add(1);
        
        // Log performance degradation during spikes
        if (responseTime > data.baselineResponseTime * 5) {
          console.warn(`Significant spike degradation: ${responseTime}ms (${(responseTime / data.baselineResponseTime).toFixed(1)}x baseline)`);
        }
      } else {
        preSpikeThroughput.add(1);
      }
    });
    
    // Concurrent operations during spikes to stress the system further
    if (currentStage.target > BASELINE_VUS && Math.random() < 0.3) {
      group('concurrent_spike_operations', function () {
        // Fire multiple requests simultaneously during spike periods
        const concurrentRequests = [
          {
            name: 'get_bridge_status',
            args: {},
            priority: 'high'
          },
          {
            name: 'get_telegram_responses', 
            args: { limit: 1 },
            priority: 'medium'
          }
        ];
        
        concurrentRequests.forEach(req => {
          const payload = JSON.stringify({
            method: 'tools/call',
            params: {
              name: req.name,
              arguments: req.args
            }
          });
          
          // Use async requests to create more realistic concurrent load
          http.asyncRequest('POST', `${BASE_URL}/mcp`, payload, {
            headers: { 
              'Content-Type': 'application/json',
              'X-Priority': req.priority
            },
            timeout: '20s'
          });
        });
      });
    }
    
    // Simulate realistic user behavior during spikes
    if (currentStage.target > BASELINE_VUS * 1.5) {
      // During spikes, reduce think time (users are more active)
      sleep(Math.random() * 0.3 + 0.1); // 0.1-0.4 seconds
    } else {
      // Normal think time during baseline
      sleep(Math.random() * 2 + 0.5); // 0.5-2.5 seconds
    }
  });
}

export function teardown(data) {
  if (!data.serverReady) return;
  
  console.log('Spike test completed. Analyzing recovery...');
  
  // Post-spike recovery analysis
  const recoveryStart = Date.now();
  
  // Wait for system to potentially recover
  sleep(10);
  
  console.log('Testing post-spike system recovery...');
  const recoveryRequests = [];
  
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/health`, { timeout: '30s' });
    const duration = Date.now() - start;
    
    recoveryRequests.push({
      status: response.status,
      duration: duration,
      success: response.status === 200
    });
    
    sleep(0.5);
  }
  
  const recoverySuccessRate = recoveryRequests.filter(r => r.success).length / recoveryRequests.length;
  const avgRecoveryTime = recoveryRequests.reduce((sum, r) => sum + r.duration, 0) / recoveryRequests.length;
  
  console.log(`Recovery analysis:`);
  console.log(`- Success rate: ${(recoverySuccessRate * 100).toFixed(1)}%`);
  console.log(`- Average response time: ${avgRecoveryTime.toFixed(2)}ms`);
  console.log(`- vs Baseline: ${(avgRecoveryTime / data.baselineResponseTime).toFixed(1)}x`);
  
  if (recoverySuccessRate > 0.9 && avgRecoveryTime < data.baselineResponseTime * 2) {
    console.log('✓ System recovered well from spike load');
  } else {
    console.log('⚠ System may need more time to fully recover from spike load');
  }
  
  // Optional cleanup
  try {
    http.post(`${BASE_URL}/mcp`, JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'clear_old_responses',
        arguments: { older_than_hours: 0 }
      }
    }), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '30s'
    });
  } catch (e) {
    console.log('⚠ Post-spike cleanup skipped');
  }
}

// Helper function to determine current test stage
function getCurrentStageInfo() {
  const elapsed = new Date() - new Date(__ENV.K6_SCRIPT_START_TIME || Date.now());
  const elapsedMinutes = elapsed / 60000;
  
  // Rough stage detection based on elapsed time
  if (elapsedMinutes < 4) {
    return { name: 'baseline', target: BASELINE_VUS };
  } else if (elapsedMinutes < 7) {
    return { name: 'spike-1', target: SPIKE_VUS * 0.7 };
  } else if (elapsedMinutes < 10) {
    return { name: 'extreme-spike', target: SPIKE_VUS };
  } else {
    return { name: 'multi-spike', target: SPIKE_VUS * 0.5 };
  }
}

export function handleSummary(data) {
  const spikeAnalysis = {
    baseline_vus: BASELINE_VUS,
    spike_vus: SPIKE_VUS,
    spike_multiplier: Math.round(SPIKE_VUS / BASELINE_VUS),
    total_requests: data.metrics.http_reqs?.values.count || 0,
    spike_events: data.metrics.spike_performance_events?.values.count || 0,
    max_response_time: data.metrics.http_req_duration?.values.max || 0,
    spike_error_rate: (data.metrics.spike_error_rate?.values.rate || 0) * 100,
    recovery_metrics: {
      // Would be populated from teardown results in a real implementation
      estimated_recovery_time: '< 30 seconds'
    }
  };
  
  return {
    'stdout': textSummary(data, spikeAnalysis),
    'spike-test-results.json': JSON.stringify({
      ...data,
      spike_analysis: spikeAnalysis
    }, null, 2),
    'spike-test-report.html': htmlReport(data, spikeAnalysis)
  };
}

function textSummary(data, analysis) {
  let output = `Spike Test Results Summary\n`;
  output += `=========================\n\n`;
  
  output += `Baseline VUs: ${analysis.baseline_vus}\n`;
  output += `Spike VUs: ${analysis.spike_vus} (${analysis.spike_multiplier}x increase)\n`;
  output += `Total Requests: ${analysis.total_requests}\n`;
  output += `Spike Events: ${analysis.spike_events}\n\n`;
  
  output += `Performance During Spikes:\n`;
  output += `- Max Response Time: ${analysis.max_response_time.toFixed(2)}ms\n`;
  output += `- Spike Error Rate: ${analysis.spike_error_rate.toFixed(2)}%\n\n`;
  
  if (analysis.spike_error_rate < 5) {
    output += `✓ System handled traffic spikes well\n`;
  } else if (analysis.spike_error_rate < 10) {
    output += `⚠ System showed stress during spikes but remained functional\n`;
  } else {
    output += `✗ System struggled with traffic spikes\n`;
  }
  
  return output;
}

function htmlReport(data, analysis) {
  return `<!DOCTYPE html>
<html>
<head>
    <title>K6 Spike Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #e8f5e8; padding: 20px; border-radius: 5px; border: 2px solid #4caf50; }
        .spike-info { background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .metric { margin: 10px 0; }
        .success { color: green; }
        .warning { color: orange; }
        .error { color: red; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .spike-metric { background-color: #f3e5f5; }
    </style>
</head>
<body>
    <div class="header">
        <h1>K6 Spike Test Report</h1>
        <p>Traffic Spike Resilience Testing</p>
        <p>Generated: ${new Date().toISOString()}</p>
    </div>
    
    <div class="spike-info">
        <h3>Spike Test Configuration</h3>
        <p><strong>Baseline Load:</strong> ${analysis.baseline_vus} VUs</p>
        <p><strong>Spike Load:</strong> ${analysis.spike_vus} VUs (${analysis.spike_multiplier}x increase)</p>
        <p><strong>Test Pattern:</strong> Multiple spikes of varying intensity and duration</p>
    </div>
    
    <h2>Spike Performance Results</h2>
    <table>
        <tr><th>Metric</th><th>Value</th><th>Assessment</th></tr>
        <tr class="spike-metric">
            <td>Total Requests</td>
            <td>${analysis.total_requests}</td>
            <td>-</td>
        </tr>
        <tr class="spike-metric">
            <td>Spike Events Processed</td>
            <td>${analysis.spike_events}</td>
            <td>-</td>
        </tr>
        <tr>
            <td>Max Response Time</td>
            <td>${analysis.max_response_time.toFixed(2)}ms</td>
            <td class="${analysis.max_response_time > 10000 ? 'error' : analysis.max_response_time > 5000 ? 'warning' : 'success'}">
                ${analysis.max_response_time > 10000 ? 'Slow' : analysis.max_response_time > 5000 ? 'Acceptable' : 'Good'}
            </td>
        </tr>
        <tr>
            <td>Spike Error Rate</td>
            <td>${analysis.spike_error_rate.toFixed(2)}%</td>
            <td class="${analysis.spike_error_rate > 10 ? 'error' : analysis.spike_error_rate > 5 ? 'warning' : 'success'}">
                ${analysis.spike_error_rate > 10 ? 'High' : analysis.spike_error_rate > 5 ? 'Moderate' : 'Low'}
            </td>
        </tr>
    </table>
    
    <h2>Spike Resilience Analysis</h2>
    <div class="metric">
        <strong>System Behavior:</strong>
        ${analysis.spike_error_rate < 5 ?
          '<span class="success">Excellent - System maintained stability during traffic spikes</span>' :
          analysis.spike_error_rate < 10 ?
          '<span class="warning">Good - System handled spikes with minor degradation</span>' :
          '<span class="error">Needs Improvement - System struggled with sudden traffic bursts</span>'
        }
    </div>
    
    <div class="metric">
        <strong>Recommendations:</strong>
        <ul>
            ${analysis.spike_error_rate > 5 ? '<li>Implement auto-scaling for traffic spikes</li>' : ''}
            ${analysis.max_response_time > 5000 ? '<li>Add request queuing and rate limiting</li>' : ''}
            <li>Monitor real-world traffic patterns for spike prediction</li>
            <li>Consider implementing circuit breakers for spike protection</li>
            ${analysis.spike_error_rate < 5 ? '<li>Current configuration handles spikes well</li>' : ''}
        </ul>
    </div>
</body>
</html>`;
}
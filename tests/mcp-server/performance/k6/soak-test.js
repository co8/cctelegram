/**
 * K6 Soak Testing Script for CCTelegram MCP Server
 * 
 * Long-running test to identify memory leaks, resource degradation,
 * and system stability over extended periods
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// Custom metrics for soak testing
const memoryLeakIndicator = new Trend('memory_leak_indicator');
const responseTimeDrift = new Trend('response_time_drift');
const resourceExhaustionEvents = new Counter('resource_exhaustion_events');
const connectionLeaks = new Counter('connection_leaks');
const systemStabilityScore = new Gauge('system_stability_score');

// Test data for long-running scenarios
const soakEvents = new SharedArray('soak_events', function () {
  const scenarios = [
    'long_running_task',
    'periodic_cleanup',
    'continuous_monitoring',
    'background_processing',
    'maintenance_operation',
    'health_check_cycle'
  ];
  
  return Array.from({ length: 500 }, (_, i) => ({
    type: scenarios[i % scenarios.length],
    title: `Soak Test Event ${i + 1}`,
    description: `Long-running soak test event ${i + 1} for stability testing`,
    source: 'k6-soak-test',
    task_id: `soak-${i + 1}-${Date.now()}`,
    cycle_id: Math.floor(i / 50), // Group events into cycles
    soak_metadata: {
      hour: Math.floor(i / 60), // Simulate hourly cycles
      batch: Math.floor(i / 100), // Batch processing simulation
      persistence_test: true,
      memory_pressure: i % 10 === 0 // Every 10th event adds memory pressure
    }
  }));
});

// Configuration - Soak tests run for extended periods
const SOAK_VUS = parseInt(__ENV.SOAK_VUS) || 20;
const SOAK_DURATION = __ENV.SOAK_DURATION || '30m'; // Default 30 minutes (can be hours)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const STABILITY_CHECK_INTERVAL = parseInt(__ENV.STABILITY_CHECK_INTERVAL) || 300; // 5 minutes

export const options = {
  stages: [
    { duration: '5m', target: SOAK_VUS }, // Ramp up gradually
    { duration: SOAK_DURATION, target: SOAK_VUS }, // Sustained load
    { duration: '2m', target: 0 }, // Ramp down
  ],
  
  // Soak test thresholds focus on stability over time
  thresholds: {
    http_req_duration: [
      'p(50)<1000', // Median response time
      'p(95)<3000', // 95th percentile
      'p(99)<5000'  // 99th percentile
    ],
    http_req_failed: ['rate<0.02'], // 2% error rate over long period
    response_time_drift: ['p(95)<2000'], // Response time shouldn't drift too much
    system_stability_score: ['value>0.8'], // 80% stability score minimum
  },
  
  // Extended timeouts for soak testing
  setupTimeout: '120s',
  teardownTimeout: '180s',
};

export function setup() {
  console.log(`Starting soak test: ${SOAK_VUS} VUs for ${SOAK_DURATION}`);
  console.log('⚠ This is a long-running test designed to detect memory leaks and stability issues');
  
  // Pre-soak system check
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    console.error('Pre-soak health check failed');
    return { serverReady: false };
  }
  
  // Establish baseline performance metrics
  console.log('Establishing baseline performance for soak test...');
  const baselineMetrics = {
    responseTimes: [],
    memoryIndicators: [],
    timestamp: Date.now()
  };
  
  // Take multiple baseline measurements
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    const response = http.post(`${BASE_URL}/mcp`, JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'get_bridge_status',
        arguments: {}
      }
    }), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '15s'
    });
    
    const duration = Date.now() - start;
    baselineMetrics.responseTimes.push(duration);
    
    // Try to get memory info if available
    try {
      const body = JSON.parse(response.body);
      if (body.result && body.result.memory_usage) {
        baselineMetrics.memoryIndicators.push(body.result.memory_usage);
      }
    } catch (e) {
      // Memory info not available, that's ok
    }
    
    sleep(1);
  }
  
  const avgBaseline = baselineMetrics.responseTimes.reduce((a, b) => a + b, 0) / baselineMetrics.responseTimes.length;
  console.log(`✓ Baseline response time: ${avgBaseline.toFixed(2)}ms`);
  
  return {
    serverReady: true,
    baseline: {
      avgResponseTime: avgBaseline,
      maxResponseTime: Math.max(...baselineMetrics.responseTimes),
      minResponseTime: Math.min(...baselineMetrics.responseTimes),
      startTime: Date.now()
    }
  };
}

export default function (data) {
  if (!data.serverReady) {
    return;
  }
  
  const currentVU = __VU;
  const currentIteration = __ITER;
  const testStartTime = data.baseline.startTime;
  const elapsedTime = Date.now() - testStartTime;
  const elapsedMinutes = Math.floor(elapsedTime / 60000);
  
  group('Soak Test Operations', function () {
    group('primary_soak_operations', function () {
      const eventData = soakEvents[currentIteration % soakEvents.length];
      
      const payload = JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'send_telegram_event',
          arguments: {
            ...eventData,
            soak_context: {
              vu_id: currentVU,
              iteration: currentIteration,
              elapsed_minutes: elapsedMinutes,
              test_phase: getTestPhase(elapsedMinutes)
            }
          }
        }
      });
      
      const requestStart = Date.now();
      const response = http.post(`${BASE_URL}/mcp`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Type': 'soak',
          'X-Elapsed-Minutes': elapsedMinutes.toString(),
          'X-VU-ID': currentVU.toString()
        },
        timeout: '60s' // Generous timeout for soak testing
      });
      
      const responseTime = Date.now() - requestStart;
      
      // Soak-specific checks
      const success = check(response, {
        'soak: request completed': (r) => r.status > 0,
        'soak: no server crash': (r) => r.status !== 0,
        'soak: response received': (r) => r.body && r.body.length > 0,
        'soak: reasonable response time': (r) => r.timings.duration < 30000, // 30s max
        'soak: no memory errors': (r) => !r.body.includes('OutOfMemory') && !r.body.includes('memory')
      });
      
      // Track response time drift over the test duration
      const driftRatio = responseTime / data.baseline.avgResponseTime;
      responseTimeDrift.add(responseTime);
      
      // Detect potential memory leaks (response time increasing over time)
      if (driftRatio > 3.0) {
        memoryLeakIndicator.add(responseTime);
        resourceExhaustionEvents.add(1);
      }
      
      // Log concerning trends
      if (elapsedMinutes > 10 && driftRatio > 2.0) {
        console.warn(`Potential performance drift: ${responseTime}ms (${driftRatio.toFixed(1)}x baseline) at ${elapsedMinutes}min`);
      }
      
      // System stability score calculation
      const stabilityScore = calculateStabilityScore(success, responseTime, data.baseline.avgResponseTime, elapsedMinutes);
      systemStabilityScore.set(stabilityScore);
    });
    
    // Periodic system health checks
    if (currentIteration % STABILITY_CHECK_INTERVAL === 0 && currentIteration > 0) {
      group('stability_health_check', function () {
        console.log(`Performing stability check at iteration ${currentIteration} (${elapsedMinutes}min)`);
        
        const healthResponse = http.get(`${BASE_URL}/health`, { timeout: '30s' });
        const statusResponse = http.post(`${BASE_URL}/mcp`, JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'get_bridge_status',
            arguments: {}
          }
        }), {
          headers: { 'Content-Type': 'application/json' },
          timeout: '30s'
        });
        
        check(healthResponse, {
          'stability: health endpoint responsive': (r) => r.status === 200
        });
        
        check(statusResponse, {
          'stability: status endpoint functional': (r) => r.status === 200,
          'stability: status response valid': (r) => {
            try {
              JSON.parse(r.body);
              return true;
            } catch (e) {
              return false;
            }
          }
        });
      });
    }
    
    // Memory pressure operations (periodic)
    if (eventData.soak_metadata.memory_pressure) {
      group('memory_pressure_operations', function () {
        // Create larger payloads periodically to test memory handling
        const largeBatch = Array.from({ length: 10 }, (_, i) => ({
          type: 'batch_memory_test',
          title: `Memory Test Batch Item ${i}`,
          description: 'Large payload item for memory stability testing'.repeat(20),
          data: Array.from({ length: 100 }, (_, j) => `memory-test-data-${i}-${j}`)
        }));
        
        const batchPayload = JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'send_telegram_event',
            arguments: {
              type: 'memory_pressure_batch',
              title: 'Memory Pressure Test',
              batch_data: largeBatch
            }
          }
        });
        
        const batchResponse = http.post(`${BASE_URL}/mcp`, batchPayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: '120s'
        });
        
        check(batchResponse, {
          'memory: batch processed': (r) => r.status < 500,
          'memory: no timeout': (r) => r.timings.duration < 60000
        });
      });
    }
    
    // Cleanup operations (periodic)
    if (currentIteration % 1000 === 0 && currentIteration > 0) {
      group('periodic_cleanup', function () {
        console.log(`Performing cleanup at iteration ${currentIteration}`);
        
        const cleanupResponse = http.post(`${BASE_URL}/mcp`, JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'clear_old_responses',
            arguments: { older_than_hours: 1 }
          }
        }), {
          headers: { 'Content-Type': 'application/json' },
          timeout: '60s'
        });
        
        check(cleanupResponse, {
          'cleanup: operation successful': (r) => r.status === 200
        });
      });
    }
  });
  
  // Soak test think time - simulate realistic long-term usage
  const thinkTime = Math.random() * 5 + 2; // 2-7 seconds
  sleep(thinkTime);
}

function getTestPhase(elapsedMinutes) {
  if (elapsedMinutes < 5) return 'warmup';
  if (elapsedMinutes < 15) return 'early_soak';
  if (elapsedMinutes < 30) return 'mid_soak';
  return 'late_soak';
}

function calculateStabilityScore(success, responseTime, baselineTime, elapsedMinutes) {
  let score = 1.0;
  
  // Penalty for failures
  if (!success) score -= 0.3;
  
  // Penalty for response time degradation
  const timeRatio = responseTime / baselineTime;
  if (timeRatio > 2.0) score -= 0.2;
  if (timeRatio > 3.0) score -= 0.2;
  
  // Bonus for long-term stability
  if (elapsedMinutes > 20 && timeRatio < 1.5) score += 0.1;
  
  return Math.max(0, Math.min(1, score));
}

export function teardown(data) {
  if (!data.serverReady) return;
  
  const testDuration = Date.now() - data.baseline.startTime;
  const testDurationMinutes = Math.floor(testDuration / 60000);
  
  console.log(`Soak test completed after ${testDurationMinutes} minutes`);
  console.log('Performing post-soak analysis...');
  
  // Post-soak stability check
  const postSoakChecks = [];
  
  for (let i = 0; i < 20; i++) {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/health`, { timeout: '30s' });
    const duration = Date.now() - start;
    
    postSoakChecks.push({
      status: response.status,
      duration: duration,
      success: response.status === 200
    });
    
    sleep(2); // 2 second intervals
  }
  
  const postSoakSuccessRate = postSoakChecks.filter(c => c.success).length / postSoakChecks.length;
  const postSoakAvgTime = postSoakChecks.reduce((sum, c) => sum + c.duration, 0) / postSoakChecks.length;
  
  console.log('Post-soak analysis results:');
  console.log(`- Success rate: ${(postSoakSuccessRate * 100).toFixed(1)}%`);
  console.log(`- Average response time: ${postSoakAvgTime.toFixed(2)}ms`);
  console.log(`- Baseline comparison: ${(postSoakAvgTime / data.baseline.avgResponseTime).toFixed(1)}x`);
  
  if (postSoakSuccessRate > 0.95 && postSoakAvgTime < data.baseline.avgResponseTime * 2) {
    console.log('✓ System maintained good stability throughout soak test');
  } else if (postSoakSuccessRate > 0.8) {
    console.log('⚠ System showed some degradation but remained functional');
  } else {
    console.log('✗ System showed significant stability issues during soak test');
  }
  
  // Final cleanup
  try {
    console.log('Performing final cleanup...');
    http.post(`${BASE_URL}/mcp`, JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'clear_old_responses',
        arguments: { older_than_hours: 0 }
      }
    }), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '60s'
    });
    console.log('✓ Final cleanup completed');
  } catch (e) {
    console.log('⚠ Final cleanup had issues (may indicate system stress)');
  }
}

export function handleSummary(data) {
  const soakAnalysis = {
    target_vus: SOAK_VUS,
    duration: SOAK_DURATION,
    total_requests: data.metrics.http_reqs?.values.count || 0,
    avg_response_time: data.metrics.http_req_duration?.values.avg || 0,
    p95_response_time: data.metrics.http_req_duration?.values['p(95)'] || 0,
    p99_response_time: data.metrics.http_req_duration?.values['p(99)'] || 0,
    error_rate: (data.metrics.http_req_failed?.values.rate || 0) * 100,
    memory_leak_events: data.metrics.memory_leak_indicator?.values.count || 0,
    resource_exhaustion_events: data.metrics.resource_exhaustion_events?.values.count || 0,
    final_stability_score: data.metrics.system_stability_score?.values.value || 0
  };
  
  return {
    'stdout': soakSummary(data, soakAnalysis),
    'soak-test-results.json': JSON.stringify({
      ...data,
      soak_analysis: soakAnalysis
    }, null, 2),
    'soak-test-report.html': soakHtmlReport(data, soakAnalysis)
  };
}

function soakSummary(data, analysis) {
  let output = `Soak Test Results Summary\n`;
  output += `========================\n\n`;
  
  output += `Test Configuration:\n`;
  output += `- VUs: ${analysis.target_vus}\n`;
  output += `- Duration: ${analysis.duration}\n`;
  output += `- Total Requests: ${analysis.total_requests}\n\n`;
  
  output += `Performance Stability:\n`;
  output += `- Average Response Time: ${analysis.avg_response_time.toFixed(2)}ms\n`;
  output += `- P95 Response Time: ${analysis.p95_response_time.toFixed(2)}ms\n`;
  output += `- P99 Response Time: ${analysis.p99_response_time.toFixed(2)}ms\n`;
  output += `- Error Rate: ${analysis.error_rate.toFixed(2)}%\n\n`;
  
  output += `Stability Indicators:\n`;
  output += `- Memory Leak Events: ${analysis.memory_leak_events}\n`;
  output += `- Resource Exhaustion Events: ${analysis.resource_exhaustion_events}\n`;
  output += `- Final Stability Score: ${analysis.final_stability_score.toFixed(2)}\n\n`;
  
  if (analysis.error_rate < 2 && analysis.final_stability_score > 0.8) {
    output += `✓ System demonstrated excellent long-term stability\n`;
  } else if (analysis.error_rate < 5 && analysis.final_stability_score > 0.6) {
    output += `⚠ System showed acceptable stability with minor degradation\n`;
  } else {
    output += `✗ System showed stability concerns that need investigation\n`;
  }
  
  return output;
}

function soakHtmlReport(data, analysis) {
  return `<!DOCTYPE html>
<html>
<head>
    <title>K6 Soak Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #e1f5fe; padding: 20px; border-radius: 5px; border: 2px solid #29b6f6; }
        .soak-info { background: #f1f8e9; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .metric { margin: 10px 0; }
        .success { color: green; }
        .warning { color: orange; }
        .error { color: red; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .stability-metric { background-color: #e8f5e8; }
        .chart-placeholder { background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>K6 Soak Test Report</h1>
        <p>Long-Term System Stability Analysis</p>
        <p>Generated: ${new Date().toISOString()}</p>
    </div>
    
    <div class="soak-info">
        <h3>Soak Test Configuration</h3>
        <p><strong>Virtual Users:</strong> ${analysis.target_vus}</p>
        <p><strong>Test Duration:</strong> ${analysis.duration}</p>
        <p><strong>Total Requests:</strong> ${analysis.total_requests.toLocaleString()}</p>
    </div>
    
    <h2>Long-Term Performance Results</h2>
    <table>
        <tr><th>Metric</th><th>Value</th><th>Assessment</th></tr>
        <tr>
            <td>Average Response Time</td>
            <td>${analysis.avg_response_time.toFixed(2)}ms</td>
            <td class="${analysis.avg_response_time > 2000 ? 'warning' : 'success'}">
                ${analysis.avg_response_time > 2000 ? 'Acceptable' : 'Good'}
            </td>
        </tr>
        <tr>
            <td>P95 Response Time</td>
            <td>${analysis.p95_response_time.toFixed(2)}ms</td>
            <td class="${analysis.p95_response_time > 5000 ? 'error' : analysis.p95_response_time > 3000 ? 'warning' : 'success'}">
                ${analysis.p95_response_time > 5000 ? 'Slow' : analysis.p95_response_time > 3000 ? 'Acceptable' : 'Good'}
            </td>
        </tr>
        <tr>
            <td>Error Rate</td>
            <td>${analysis.error_rate.toFixed(2)}%</td>
            <td class="${analysis.error_rate > 5 ? 'error' : analysis.error_rate > 2 ? 'warning' : 'success'}">
                ${analysis.error_rate > 5 ? 'High' : analysis.error_rate > 2 ? 'Moderate' : 'Low'}
            </td>
        </tr>
        <tr class="stability-metric">
            <td>Memory Leak Indicators</td>
            <td>${analysis.memory_leak_events}</td>
            <td class="${analysis.memory_leak_events > 100 ? 'error' : analysis.memory_leak_events > 20 ? 'warning' : 'success'}">
                ${analysis.memory_leak_events > 100 ? 'Concerning' : analysis.memory_leak_events > 20 ? 'Monitor' : 'Good'}
            </td>
        </tr>
        <tr class="stability-metric">
            <td>Resource Exhaustion Events</td>
            <td>${analysis.resource_exhaustion_events}</td>
            <td class="${analysis.resource_exhaustion_events > 50 ? 'error' : analysis.resource_exhaustion_events > 10 ? 'warning' : 'success'}">
                ${analysis.resource_exhaustion_events > 50 ? 'High' : analysis.resource_exhaustion_events > 10 ? 'Moderate' : 'Low'}
            </td>
        </tr>
        <tr class="stability-metric">
            <td>Final Stability Score</td>
            <td>${analysis.final_stability_score.toFixed(2)}</td>
            <td class="${analysis.final_stability_score < 0.6 ? 'error' : analysis.final_stability_score < 0.8 ? 'warning' : 'success'}">
                ${analysis.final_stability_score < 0.6 ? 'Poor' : analysis.final_stability_score < 0.8 ? 'Fair' : 'Excellent'}
            </td>
        </tr>
    </table>
    
    <h2>Stability Analysis</h2>
    <div class="metric">
        <strong>Long-term Stability:</strong>
        ${analysis.error_rate < 2 && analysis.final_stability_score > 0.8 ?
          '<span class="success">Excellent - System maintained stability over extended period</span>' :
          analysis.error_rate < 5 && analysis.final_stability_score > 0.6 ?
          '<span class="warning">Good - System showed acceptable long-term performance</span>' :
          '<span class="error">Needs Investigation - System showed stability concerns</span>'
        }
    </div>
    
    <div class="metric">
        <strong>Recommendations:</strong>
        <ul>
            ${analysis.memory_leak_events > 20 ? '<li>Investigate potential memory leaks</li>' : ''}
            ${analysis.resource_exhaustion_events > 10 ? '<li>Review resource management and cleanup procedures</li>' : ''}
            ${analysis.error_rate > 2 ? '<li>Analyze error patterns over time</li>' : ''}
            ${analysis.p95_response_time > 3000 ? '<li>Optimize slow operations for long-term performance</li>' : ''}
            <li>Monitor system metrics in production for similar patterns</li>
            ${analysis.final_stability_score > 0.8 ? '<li>Current system shows good long-term stability</li>' : ''}
        </ul>
    </div>
    
    <div class="chart-placeholder">
        <h3>Response Time Trend Over Test Duration</h3>
        <p>Chart would show response time progression over the soak test duration</p>
        <p>Look for: Consistent performance, no upward trends, stable error rates</p>
    </div>
</body>
</html>`;
}
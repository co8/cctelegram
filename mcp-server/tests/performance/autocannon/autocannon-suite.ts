/**
 * Autocannon HTTP Benchmarking Suite for CCTelegram MCP Server
 * 
 * Comprehensive HTTP load testing focused on webhook endpoints
 * and MCP server HTTP performance with configurable concurrency
 */

import autocannon from 'autocannon';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AutocannonConfig {
  url: string;
  connections: number;
  duration: number;
  pipelining?: number;
  timeout?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  setupClient?: (client: any) => void;
  excludeErrorStats?: boolean;
  expectBody?: string;
  bailout?: number;
  debug?: boolean;
}

export interface AutocannonResult {
  title: string;
  url: string;
  socketPath: string | null;
  requests: {
    average: number;
    mean: number;
    stddev: number;
    min: number;
    max: number;
    total: number;
    p0_001: number;
    p0_01: number;
    p0_1: number;
    p1: number;
    p2_5: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p97_5: number;
    p99: number;
    p99_9: number;
    p99_99: number;
    p99_999: number;
  };
  latency: {
    average: number;
    mean: number;
    stddev: number;
    min: number;
    max: number;
    p0_001: number;
    p0_01: number;
    p0_1: number;
    p1: number;
    p2_5: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p97_5: number;
    p99: number;
    p99_9: number;
    p99_99: number;
    p99_999: number;
  };
  throughput: {
    average: number;
    mean: number;
    stddev: number;
    min: number;
    max: number;
    total: number;
    p0_001: number;
    p0_01: number;
    p0_1: number;
    p1: number;
    p2_5: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p97_5: number;
    p99: number;
    p99_9: number;
    p99_99: number;
    p99_999: number;
  };
  errors: number;
  timeouts: number;
  mismatches: number;
  duration: number;
  start: Date;
  finish: Date;
  connections: number;
  pipelining: number;
  non2xx: number;
  1xx: number;
  2xx: number;
  3xx: number;
  4xx: number;
  5xx: number;
}

export interface BenchmarkSuite {
  name: string;
  description: string;
  tests: BenchmarkTest[];
}

export interface BenchmarkTest {
  name: string;
  description: string;
  config: AutocannonConfig;
  expectedThresholds: {
    maxLatencyP95?: number;
    minThroughput?: number;
    maxErrorRate?: number;
    minSuccessRate?: number;
  };
}

export interface SuiteResults {
  suiteName: string;
  description: string;
  timestamp: Date;
  duration: number;
  results: Array<{
    test: BenchmarkTest;
    result: AutocannonResult;
    passed: boolean;
    thresholdResults: Record<string, { passed: boolean; actual: number; expected: number }>;
  }>;
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    avgLatency: number;
    avgThroughput: number;
    totalRequests: number;
    totalErrors: number;
  };
}

/**
 * Autocannon HTTP Benchmarking Suite
 */
export class AutocannonBenchmarkSuite extends EventEmitter {
  private baseUrl: string;
  private outputDir: string;
  
  constructor(baseUrl: string = 'http://localhost:3000', outputDir?: string) {
    super();
    this.baseUrl = baseUrl;
    this.outputDir = outputDir || path.join(__dirname, '..', '..', '..', 'reports', 'autocannon');
  }

  /**
   * Get comprehensive benchmark suite for CCTelegram MCP Server
   */
  public getBenchmarkSuites(): BenchmarkSuite[] {
    return [
      this.getMCPEndpointSuite(),
      this.getWebhookEndpointSuite(),
      this.getHealthEndpointSuite(),
      this.getConcurrencyScalingSuite(),
      this.getPayloadSizeSuite()
    ];
  }

  /**
   * MCP Protocol Endpoint Benchmarks
   */
  private getMCPEndpointSuite(): BenchmarkSuite {
    const mcpPayloads = {
      sendEvent: JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'send_telegram_event',
          arguments: {
            type: 'task_completion',
            title: 'Autocannon Load Test Event',
            description: 'High-throughput load testing event',
            source: 'autocannon-benchmark'
          }
        }
      }),
      
      getBridgeStatus: JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'get_bridge_status',
          arguments: {}
        }
      }),
      
      getResponses: JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'get_telegram_responses',
          arguments: { limit: 10 }
        }
      })
    };

    return {
      name: 'MCP Protocol Endpoints',
      description: 'HTTP load testing of MCP protocol endpoints',
      tests: [
        {
          name: 'send_telegram_event_light_load',
          description: 'Light load test for send_telegram_event',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 10,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: mcpPayloads.sendEvent,
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 1000,
            minThroughput: 50,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        },
        
        {
          name: 'send_telegram_event_medium_load',
          description: 'Medium load test for send_telegram_event',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 50,
            duration: 60,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: mcpPayloads.sendEvent,
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 2000,
            minThroughput: 200,
            maxErrorRate: 2,
            minSuccessRate: 98
          }
        },
        
        {
          name: 'send_telegram_event_high_load',
          description: 'High load test for send_telegram_event',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 100,
            duration: 90,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: mcpPayloads.sendEvent,
            timeout: 45000
          },
          expectedThresholds: {
            maxLatencyP95: 5000,
            minThroughput: 300,
            maxErrorRate: 5,
            minSuccessRate: 95
          }
        },
        
        {
          name: 'get_bridge_status_high_frequency',
          description: 'High frequency status checks',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 20,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: mcpPayloads.getBridgeStatus,
            timeout: 10000
          },
          expectedThresholds: {
            maxLatencyP95: 500,
            minThroughput: 100,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        },
        
        {
          name: 'get_telegram_responses_burst',
          description: 'Burst testing of get_telegram_responses',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 30,
            duration: 20,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: mcpPayloads.getResponses,
            timeout: 15000
          },
          expectedThresholds: {
            maxLatencyP95: 800,
            minThroughput: 80,
            maxErrorRate: 2,
            minSuccessRate: 98
          }
        }
      ]
    };
  }

  /**
   * Webhook Endpoint Benchmarks
   */
  private getWebhookEndpointSuite(): BenchmarkSuite {
    const webhookPayload = JSON.stringify({
      type: 'webhook_test',
      data: {
        source: 'autocannon',
        timestamp: new Date().toISOString(),
        test_data: Array.from({ length: 10 }, (_, i) => `webhook-item-${i}`)
      }
    });

    return {
      name: 'Webhook Endpoints',
      description: 'HTTP load testing of webhook endpoints',
      tests: [
        {
          name: 'webhook_light_load',
          description: 'Light load webhook processing',
          config: {
            url: `${this.baseUrl}/webhook`,
            connections: 15,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'autocannon-webhook-test'
            },
            body: webhookPayload,
            timeout: 20000
          },
          expectedThresholds: {
            maxLatencyP95: 800,
            minThroughput: 60,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        },
        
        {
          name: 'webhook_high_throughput',
          description: 'High throughput webhook processing',
          config: {
            url: `${this.baseUrl}/webhook`,
            connections: 75,
            duration: 45,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'autocannon-webhook-test'
            },
            body: webhookPayload,
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 3000,
            minThroughput: 200,
            maxErrorRate: 3,
            minSuccessRate: 97
          }
        }
      ]
    };
  }

  /**
   * Health Endpoint Benchmarks
   */
  private getHealthEndpointSuite(): BenchmarkSuite {
    return {
      name: 'Health & Monitoring Endpoints',
      description: 'HTTP load testing of health and monitoring endpoints',
      tests: [
        {
          name: 'health_check_rapid_polling',
          description: 'Rapid health check polling',
          config: {
            url: `${this.baseUrl}/health`,
            connections: 5,
            duration: 15,
            method: 'GET',
            timeout: 5000
          },
          expectedThresholds: {
            maxLatencyP95: 200,
            minThroughput: 200,
            maxErrorRate: 0,
            minSuccessRate: 100
          }
        },
        
        {
          name: 'metrics_endpoint_load',
          description: 'Metrics endpoint under load',
          config: {
            url: `${this.baseUrl}/metrics`,
            connections: 10,
            duration: 20,
            method: 'GET',
            timeout: 10000
          },
          expectedThresholds: {
            maxLatencyP95: 500,
            minThroughput: 100,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        },
        
        {
          name: 'status_endpoint_concurrent',
          description: 'Status endpoint concurrent access',
          config: {
            url: `${this.baseUrl}/status`,
            connections: 20,
            duration: 25,
            method: 'GET',
            timeout: 10000
          },
          expectedThresholds: {
            maxLatencyP95: 800,
            minThroughput: 80,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        }
      ]
    };
  }

  /**
   * Concurrency Scaling Benchmarks
   */
  private getConcurrencyScalingSuite(): BenchmarkSuite {
    const testPayload = JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'send_telegram_event',
        arguments: {
          type: 'concurrency_test',
          title: 'Concurrency Scale Test',
          description: 'Testing system behavior under varying concurrency levels'
        }
      }
    });

    return {
      name: 'Concurrency Scaling',
      description: 'Testing system behavior under different concurrency levels',
      tests: [
        {
          name: 'concurrency_10',
          description: '10 concurrent connections baseline',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 10,
            duration: 30,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: testPayload
          },
          expectedThresholds: {
            maxLatencyP95: 1000,
            minThroughput: 40,
            maxErrorRate: 1
          }
        },
        
        {
          name: 'concurrency_50',
          description: '50 concurrent connections',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 50,
            duration: 30,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: testPayload
          },
          expectedThresholds: {
            maxLatencyP95: 2000,
            minThroughput: 150,
            maxErrorRate: 2
          }
        },
        
        {
          name: 'concurrency_100',
          description: '100 concurrent connections',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 100,
            duration: 30,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: testPayload
          },
          expectedThresholds: {
            maxLatencyP95: 4000,
            minThroughput: 250,
            maxErrorRate: 5
          }
        },
        
        {
          name: 'concurrency_200',
          description: '200 concurrent connections (stress)',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 200,
            duration: 30,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: testPayload,
            timeout: 60000
          },
          expectedThresholds: {
            maxLatencyP95: 8000,
            minThroughput: 300,
            maxErrorRate: 10
          }
        }
      ]
    };
  }

  /**
   * Payload Size Benchmarks
   */
  private getPayloadSizeSuite(): BenchmarkSuite {
    const createPayload = (size: 'small' | 'medium' | 'large' | 'xlarge') => {
      const baseSizes = {
        small: 10,
        medium: 100,
        large: 1000,
        xlarge: 5000
      };
      
      return JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'send_telegram_event',
          arguments: {
            type: 'payload_size_test',
            title: `Payload Size Test - ${size}`,
            description: `Testing ${size} payload handling`,
            data: Array.from({ length: baseSizes[size] }, (_, i) => ({
              id: i,
              content: `payload-data-item-${i}`.repeat(size === 'xlarge' ? 10 : 1),
              metadata: {
                size: size,
                index: i,
                timestamp: new Date().toISOString()
              }
            }))
          }
        }
      });
    };

    return {
      name: 'Payload Size Impact',
      description: 'Testing performance impact of different payload sizes',
      tests: [
        {
          name: 'small_payload',
          description: 'Small payload performance baseline',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 20,
            duration: 30,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: createPayload('small')
          },
          expectedThresholds: {
            maxLatencyP95: 1000,
            minThroughput: 80
          }
        },
        
        {
          name: 'medium_payload',
          description: 'Medium payload performance',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 20,
            duration: 30,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: createPayload('medium')
          },
          expectedThresholds: {
            maxLatencyP95: 2000,
            minThroughput: 60
          }
        },
        
        {
          name: 'large_payload',
          description: 'Large payload performance',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 15,
            duration: 45,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: createPayload('large'),
            timeout: 45000
          },
          expectedThresholds: {
            maxLatencyP95: 5000,
            minThroughput: 30
          }
        },
        
        {
          name: 'xlarge_payload',
          description: 'Extra large payload stress test',
          config: {
            url: `${this.baseUrl}/mcp`,
            connections: 10,
            duration: 60,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: createPayload('xlarge'),
            timeout: 90000
          },
          expectedThresholds: {
            maxLatencyP95: 15000,
            minThroughput: 10,
            maxErrorRate: 5
          }
        }
      ]
    };
  }

  /**
   * Run a single benchmark test
   */
  public async runTest(test: BenchmarkTest): Promise<{ result: AutocannonResult; passed: boolean; thresholdResults: any }> {
    console.log(`Running test: ${test.name}`);
    
    try {
      const result = await autocannon(test.config);
      const thresholdResults = this.checkThresholds(result, test.expectedThresholds);
      const passed = Object.values(thresholdResults).every((t: any) => t.passed);
      
      this.emit('testCompleted', { test, result, passed, thresholdResults });
      
      return { result, passed, thresholdResults };
    } catch (error) {
      console.error(`Test ${test.name} failed:`, error);
      throw error;
    }
  }

  /**
   * Run complete benchmark suite
   */
  public async runSuite(suite: BenchmarkSuite): Promise<SuiteResults> {
    console.log(`\nRunning benchmark suite: ${suite.name}`);
    console.log(`Description: ${suite.description}`);
    console.log(`Tests: ${suite.tests.length}\n`);
    
    const startTime = Date.now();
    const results: SuiteResults['results'] = [];
    
    this.emit('suiteStarted', suite);
    
    for (const test of suite.tests) {
      try {
        const testResult = await this.runTest(test);
        results.push({
          test,
          ...testResult
        });
        
        // Brief pause between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to run test ${test.name}:`, error);
        results.push({
          test,
          result: {} as AutocannonResult,
          passed: false,
          thresholdResults: {}
        });
      }
    }
    
    const duration = Date.now() - startTime;
    const summary = this.generateSummary(results);
    
    const suiteResults: SuiteResults = {
      suiteName: suite.name,
      description: suite.description,
      timestamp: new Date(),
      duration,
      results,
      summary
    };
    
    this.emit('suiteCompleted', suiteResults);
    
    return suiteResults;
  }

  /**
   * Run all benchmark suites
   */
  public async runAllSuites(): Promise<SuiteResults[]> {
    const suites = this.getBenchmarkSuites();
    const allResults: SuiteResults[] = [];
    
    console.log(`Starting Autocannon Benchmark Suite`);
    console.log(`Base URL: ${this.baseUrl}`);
    console.log(`Total Suites: ${suites.length}\n`);
    
    for (const suite of suites) {
      try {
        const suiteResult = await this.runSuite(suite);
        allResults.push(suiteResult);
        
        // Save individual suite results
        await this.saveSuiteResults(suiteResult);
        
        // Pause between suites
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (error) {
        console.error(`Failed to run suite ${suite.name}:`, error);
      }
    }
    
    // Generate comprehensive report
    await this.generateComprehensiveReport(allResults);
    
    return allResults;
  }

  /**
   * Check test thresholds
   */
  private checkThresholds(result: AutocannonResult, thresholds: BenchmarkTest['expectedThresholds']) {
    const thresholdResults: Record<string, { passed: boolean; actual: number; expected: number }> = {};
    
    if (thresholds.maxLatencyP95) {
      thresholdResults.latencyP95 = {
        passed: result.latency.p99 <= thresholds.maxLatencyP95,
        actual: result.latency.p99,
        expected: thresholds.maxLatencyP95
      };
    }
    
    if (thresholds.minThroughput) {
      thresholdResults.throughput = {
        passed: result.requests.average >= thresholds.minThroughput,
        actual: result.requests.average,
        expected: thresholds.minThroughput
      };
    }
    
    if (thresholds.maxErrorRate) {
      const errorRate = ((result.errors + result.timeouts + result.non2xx) / (result.requests.total || 1)) * 100;
      thresholdResults.errorRate = {
        passed: errorRate <= thresholds.maxErrorRate,
        actual: errorRate,
        expected: thresholds.maxErrorRate
      };
    }
    
    if (thresholds.minSuccessRate) {
      const successRate = (result['2xx'] / (result.requests.total || 1)) * 100;
      thresholdResults.successRate = {
        passed: successRate >= thresholds.minSuccessRate,
        actual: successRate,
        expected: thresholds.minSuccessRate
      };
    }
    
    return thresholdResults;
  }

  /**
   * Generate suite summary
   */
  private generateSummary(results: SuiteResults['results']) {
    const totalTests = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = totalTests - passed;
    
    const validResults = results.filter(r => r.result.latency);
    const avgLatency = validResults.reduce((sum, r) => sum + r.result.latency.average, 0) / validResults.length || 0;
    const avgThroughput = validResults.reduce((sum, r) => sum + r.result.requests.average, 0) / validResults.length || 0;
    const totalRequests = validResults.reduce((sum, r) => sum + r.result.requests.total, 0);
    const totalErrors = validResults.reduce((sum, r) => sum + (r.result.errors || 0) + (r.result.timeouts || 0), 0);
    
    return {
      totalTests,
      passed,
      failed,
      avgLatency,
      avgThroughput,
      totalRequests,
      totalErrors
    };
  }

  /**
   * Save suite results to file
   */
  private async saveSuiteResults(suiteResults: SuiteResults): Promise<void> {
    await fs.ensureDir(this.outputDir);
    
    const fileName = `${suiteResults.suiteName.toLowerCase().replace(/\s+/g, '-')}-results.json`;
    const filePath = path.join(this.outputDir, fileName);
    
    await fs.writeJSON(filePath, suiteResults, { spaces: 2 });
    console.log(`Suite results saved to: ${filePath}`);
  }

  /**
   * Generate comprehensive HTML report
   */
  private async generateComprehensiveReport(allResults: SuiteResults[]): Promise<void> {
    const reportPath = path.join(this.outputDir, 'autocannon-comprehensive-report.html');
    
    const html = this.generateReportHTML(allResults);
    await fs.writeFile(reportPath, html);
    
    console.log(`Comprehensive report generated: ${reportPath}`);
  }

  /**
   * Generate HTML report
   */
  private generateReportHTML(allResults: SuiteResults[]): string {
    const timestamp = new Date().toISOString();
    
    return `<!DOCTYPE html>
<html>
<head>
    <title>Autocannon Benchmark Report - CCTelegram MCP Server</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #e3f2fd; padding: 20px; border-radius: 5px; }
        .suite { margin: 20px 0; border: 1px solid #ddd; border-radius: 5px; }
        .suite-header { background: #f5f5f5; padding: 15px; border-bottom: 1px solid #ddd; }
        .test-results { padding: 15px; }
        .test { margin: 10px 0; padding: 10px; border: 1px solid #eee; border-radius: 3px; }
        .passed { border-left: 4px solid #4caf50; }
        .failed { border-left: 4px solid #f44336; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .metric { display: inline-block; margin: 5px 10px; }
        .summary { background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Autocannon HTTP Benchmark Report</h1>
        <p><strong>CCTelegram MCP Server Performance Testing</strong></p>
        <p>Generated: ${timestamp}</p>
        <p>Base URL: ${this.baseUrl}</p>
        <p>Total Suites: ${allResults.length}</p>
    </div>
    
    <div class="summary">
        <h2>Overall Summary</h2>
        <div class="metric"><strong>Total Tests:</strong> ${allResults.reduce((sum, s) => sum + s.summary.totalTests, 0)}</div>
        <div class="metric"><strong>Passed:</strong> ${allResults.reduce((sum, s) => sum + s.summary.passed, 0)}</div>
        <div class="metric"><strong>Failed:</strong> ${allResults.reduce((sum, s) => sum + s.summary.failed, 0)}</div>
        <div class="metric"><strong>Total Requests:</strong> ${allResults.reduce((sum, s) => sum + s.summary.totalRequests, 0).toLocaleString()}</div>
        <div class="metric"><strong>Total Errors:</strong> ${allResults.reduce((sum, s) => sum + s.summary.totalErrors, 0)}</div>
    </div>
    
    ${allResults.map(suite => `
    <div class="suite">
        <div class="suite-header">
            <h2>${suite.suiteName}</h2>
            <p>${suite.description}</p>
            <div class="metric"><strong>Duration:</strong> ${(suite.duration / 1000).toFixed(1)}s</div>
            <div class="metric"><strong>Tests:</strong> ${suite.summary.totalTests}</div>
            <div class="metric"><strong>Passed:</strong> ${suite.summary.passed}</div>
            <div class="metric"><strong>Failed:</strong> ${suite.summary.failed}</div>
        </div>
        
        <div class="test-results">
            ${suite.results.map(testResult => `
            <div class="test ${testResult.passed ? 'passed' : 'failed'}">
                <h3>${testResult.test.name} ${testResult.passed ? '✓' : '✗'}</h3>
                <p>${testResult.test.description}</p>
                
                ${testResult.result.latency ? `
                <table>
                    <tr><th>Metric</th><th>Value</th></tr>
                    <tr><td>Avg Latency</td><td>${testResult.result.latency.average.toFixed(2)}ms</td></tr>
                    <tr><td>P95 Latency</td><td>${testResult.result.latency.p99.toFixed(2)}ms</td></tr>
                    <tr><td>Avg Throughput</td><td>${testResult.result.requests.average.toFixed(2)} req/s</td></tr>
                    <tr><td>Total Requests</td><td>${testResult.result.requests.total.toLocaleString()}</td></tr>
                    <tr><td>Errors</td><td>${testResult.result.errors + testResult.result.timeouts}</td></tr>
                    <tr><td>2xx Responses</td><td>${testResult.result['2xx']}</td></tr>
                    <tr><td>Non-2xx Responses</td><td>${testResult.result.non2xx}</td></tr>
                </table>
                ` : '<p>No detailed results available</p>'}
                
                ${Object.keys(testResult.thresholdResults).length > 0 ? `
                <h4>Threshold Results:</h4>
                <ul>
                    ${Object.entries(testResult.thresholdResults).map(([name, result]: [string, any]) => `
                    <li>${name}: ${result.passed ? '✓' : '✗'} (${result.actual.toFixed(2)}/${result.expected})</li>
                    `).join('')}
                </ul>
                ` : ''}
            </div>
            `).join('')}
        </div>
    </div>
    `).join('')}
    
    <div class="summary">
        <h2>Performance Analysis</h2>
        <p><strong>Key Findings:</strong></p>
        <ul>
            <li>Average latency across all tests: ${(allResults.reduce((sum, s) => sum + s.summary.avgLatency, 0) / allResults.length).toFixed(2)}ms</li>
            <li>Average throughput across all tests: ${(allResults.reduce((sum, s) => sum + s.summary.avgThroughput, 0) / allResults.length).toFixed(2)} req/s</li>
            <li>Overall success rate: ${(((allResults.reduce((sum, s) => sum + s.summary.passed, 0)) / (allResults.reduce((sum, s) => sum + s.summary.totalTests, 0))) * 100).toFixed(1)}%</li>
        </ul>
        
        <p><strong>Recommendations:</strong></p>
        <ul>
            <li>Monitor response times under different load patterns</li>
            <li>Consider implementing connection pooling for high-concurrency scenarios</li>
            <li>Review error patterns and implement appropriate retry mechanisms</li>
            <li>Establish baseline performance metrics for continuous monitoring</li>
        </ul>
    </div>
</body>
</html>`;
  }
}
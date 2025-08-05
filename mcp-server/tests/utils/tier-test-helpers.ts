/**
 * Tier Testing Helper Utilities
 * Shared utilities for 3-tier cascading system integration tests
 */

import { promises as fs } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface TierTestConfig {
  tier1: {
    url: string;
    port: number;
    slaLimit: number;
    defaultLatency: number;
  };
  tier2: {
    url: string;
    port: number;
    slaMin: number;
    slaMax: number;
    defaultLatency: number;
  };
  tier3: {
    baseDir: string;
    slaMin: number;
    slaMax: number;
    defaultLatency: number;
  };
}

export interface LatencyMeasurement {
  tier: string;
  start_time: number;
  end_time: number;
  duration_ms: number;
  within_sla: boolean;
  sla_limit_ms: number;
}

export interface TierResponse {
  success: boolean;
  tier: string;
  processing_time_ms: number;
  correlation_id: string;
  timestamp: string;
  sla_compliant?: boolean;
  error?: string;
}

export interface CascadingTestResult {
  correlation_id: string;
  attempted_tiers: string[];
  successful_tier?: string;
  total_time_ms: number;
  tier_measurements: LatencyMeasurement[];
  fallback_triggered: boolean;
  error?: string;
}

export class TierTestMetrics {
  private measurements: Map<string, LatencyMeasurement[]> = new Map();
  private slaViolations: Map<string, number> = new Map();
  private successRates: Map<string, { successes: number; total: number }> = new Map();

  recordMeasurement(measurement: LatencyMeasurement): void {
    const tierMeasurements = this.measurements.get(measurement.tier) || [];
    tierMeasurements.push(measurement);
    this.measurements.set(measurement.tier, tierMeasurements);

    // Track SLA violations
    if (!measurement.within_sla) {
      const violations = this.slaViolations.get(measurement.tier) || 0;
      this.slaViolations.set(measurement.tier, violations + 1);
    }
  }

  recordResult(tier: string, success: boolean): void {
    const rates = this.successRates.get(tier) || { successes: 0, total: 0 };
    rates.total++;
    if (success) rates.successes++;
    this.successRates.set(tier, rates);
  }

  getTierStatistics(tier: string) {
    const measurements = this.measurements.get(tier) || [];
    const violations = this.slaViolations.get(tier) || 0;
    const rates = this.successRates.get(tier) || { successes: 0, total: 0 };

    if (measurements.length === 0) {
      return {
        tier,
        count: 0,
        averageLatency: 0,
        minLatency: 0,
        maxLatency: 0,
        slaCompliance: 0,
        successRate: 0
      };
    }

    const latencies = measurements.map(m => m.duration_ms);
    const averageLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);
    const slaCompliance = ((measurements.length - violations) / measurements.length) * 100;
    const successRate = rates.total > 0 ? (rates.successes / rates.total) * 100 : 0;

    return {
      tier,
      count: measurements.length,
      averageLatency: Math.round(averageLatency),
      minLatency,
      maxLatency,
      slaCompliance: Math.round(slaCompliance),
      successRate: Math.round(successRate)
    };
  }

  getAllStatistics() {
    const tiers = ['mcp_webhook', 'bridge_internal', 'file_watcher'];
    return tiers.map(tier => this.getTierStatistics(tier));
  }

  reset(): void {
    this.measurements.clear();
    this.slaViolations.clear();
    this.successRates.clear();
  }

  exportReport(): string {
    const stats = this.getAllStatistics();
    const report = ['# 3-Tier Cascading System Test Report\n'];
    
    report.push('## Summary Statistics\n');
    report.push('| Tier | Requests | Avg Latency (ms) | Min/Max (ms) | SLA Compliance | Success Rate |');
    report.push('|------|----------|------------------|--------------|----------------|--------------|');
    
    stats.forEach(stat => {
      report.push(
        `| ${stat.tier} | ${stat.count} | ${stat.averageLatency} | ${stat.minLatency}/${stat.maxLatency} | ${stat.slaCompliance}% | ${stat.successRate}% |`
      );
    });
    
    report.push('\n## SLA Thresholds\n');
    report.push('- **Tier 1 (MCP Webhook)**: 0-100ms');
    report.push('- **Tier 2 (Bridge Internal)**: 100-500ms');
    report.push('- **Tier 3 (File Watcher)**: 1000-5000ms');
    
    report.push('\n## Test Configuration\n');
    report.push('- Test Environment: Docker Compose');
    report.push('- Test Framework: Jest + supertest');
    report.push('- Mock Services: All tiers mocked with configurable latency/failure rates');
    
    return report.join('\n');
  }
}

export class TierTestScheduler extends EventEmitter {
  private testQueue: Array<() => Promise<void>> = [];
  private running = false;
  private concurrency = 1;
  private activeTests = 0;

  constructor(concurrency: number = 1) {
    super();
    this.concurrency = concurrency;
  }

  async scheduleTest(testFn: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.testQueue.push(async () => {
        try {
          await testFn();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      if (!this.running) {
        this.start();
      }
    });
  }

  private async start(): void {
    if (this.running) return;
    this.running = true;

    while (this.testQueue.length > 0 || this.activeTests > 0) {
      while (this.activeTests < this.concurrency && this.testQueue.length > 0) {
        const test = this.testQueue.shift()!;
        this.activeTests++;
        
        test().finally(() => {
          this.activeTests--;
        });
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.running = false;
    this.emit('completed');
  }

  async waitForCompletion(): Promise<void> {
    if (!this.running && this.testQueue.length === 0 && this.activeTests === 0) {
      return;
    }

    return new Promise(resolve => {
      this.once('completed', resolve);
    });
  }
}

export class TierConfigurationManager {
  private config: TierTestConfig;

  constructor(config: TierTestConfig) {
    this.config = config;
  }

  async setTier1Configuration(latency: number, failureRate: number, healthy: boolean = true): Promise<void> {
    const response = await fetch(`${this.config.tier1.url}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latency, failureRate, healthy })
    });

    if (!response.ok) {
      throw new Error(`Failed to configure Tier 1: ${response.statusText}`);
    }
  }

  async setTier2Configuration(latency: number, failureRate: number, healthy: boolean = true): Promise<void> {
    const response = await fetch(`${this.config.tier2.url}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latency, failureRate, healthy })
    });

    if (!response.ok) {
      throw new Error(`Failed to configure Tier 2: ${response.statusText}`);
    }
  }

  async resetAllTiers(): Promise<void> {
    await Promise.all([
      this.setTier1Configuration(this.config.tier1.defaultLatency, 0, true),
      this.setTier2Configuration(this.config.tier2.defaultLatency, 0, true),
      // Tier 3 configuration would be set via environment variables in container
    ]);
  }

  async getTierHealth(tier: 1 | 2): Promise<any> {
    const url = tier === 1 ? this.config.tier1.url : this.config.tier2.url;
    const response = await fetch(`${url}/health`);
    
    if (!response.ok) {
      throw new Error(`Failed to get tier ${tier} health: ${response.statusText}`);
    }

    return response.json();
  }
}

export class LoadTestRunner {
  private metrics: TierTestMetrics;
  private scheduler: TierTestScheduler;

  constructor(concurrency: number = 10) {
    this.metrics = new TierTestMetrics();
    this.scheduler = new TierTestScheduler(concurrency);
  }

  async runLoadTest(
    testFunction: () => Promise<CascadingTestResult>,
    options: {
      duration: number; // seconds
      requestsPerSecond?: number;
      concurrency?: number;
    }
  ): Promise<{
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    statistics: ReturnType<TierTestMetrics['getAllStatistics']>;
  }> {
    const startTime = Date.now();
    const endTime = startTime + (options.duration * 1000);
    
    const results: CascadingTestResult[] = [];
    let requestCount = 0;
    
    const requestInterval = options.requestsPerSecond 
      ? 1000 / options.requestsPerSecond 
      : 100; // Default to 10 RPS

    // Schedule requests
    const requestScheduler = setInterval(async () => {
      if (Date.now() >= endTime) {
        clearInterval(requestScheduler);
        return;
      }

      requestCount++;
      
      this.scheduler.scheduleTest(async () => {
        try {
          const result = await testFunction();
          results.push(result);
          
          // Record metrics
          result.tier_measurements.forEach(measurement => {
            this.metrics.recordMeasurement(measurement);
          });
          
          if (result.successful_tier) {
            this.metrics.recordResult(result.successful_tier, true);
          } else {
            result.attempted_tiers.forEach(tier => {
              this.metrics.recordResult(tier, false);
            });
          }
        } catch (error) {
          console.error('Load test request failed:', error);
        }
      });
    }, requestInterval);

    // Wait for test duration and all requests to complete
    return new Promise((resolve) => {
      setTimeout(async () => {
        clearInterval(requestScheduler);
        await this.scheduler.waitForCompletion();
        
        const successfulRequests = results.filter(r => r.successful_tier).length;
        const failedRequests = results.length - successfulRequests;
        const averageResponseTime = results.length > 0 
          ? results.reduce((sum, r) => sum + r.total_time_ms, 0) / results.length
          : 0;

        resolve({
          totalRequests: results.length,
          successfulRequests,
          failedRequests,
          averageResponseTime: Math.round(averageResponseTime),
          statistics: this.metrics.getAllStatistics()
        });
      }, options.duration * 1000);
    });
  }
}

export function createTestPayload(overrides: Partial<any> = {}): any {
  return {
    type: 'test_event',
    title: 'Integration Test Event',
    description: 'Test event for tier validation',
    task_id: `test-${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...overrides
  };
}

export function validateSLA(measurement: LatencyMeasurement): boolean {
  switch (measurement.tier) {
    case 'mcp_webhook':
      return measurement.duration_ms <= 100;
    case 'bridge_internal':
      return measurement.duration_ms >= 100 && measurement.duration_ms <= 500;
    case 'file_watcher':
      return measurement.duration_ms >= 1000 && measurement.duration_ms <= 5000;
    default:
      return false;
  }
}

export function generateCorrelationId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

export async function cleanupTestFiles(baseDir: string): Promise<void> {
  try {
    const eventsDir = path.join(baseDir, 'events');
    const responsesDir = path.join(baseDir, 'responses');
    
    // Clean up event files
    try {
      const eventFiles = await fs.readdir(eventsDir);
      await Promise.all(
        eventFiles.map(file => fs.unlink(path.join(eventsDir, file)))
      );
    } catch (error) {
      // Directory might not exist
    }
    
    // Clean up response files
    try {
      const responseFiles = await fs.readdir(responsesDir);
      await Promise.all(
        responseFiles.map(file => fs.unlink(path.join(responsesDir, file)))
      );
    } catch (error) {
      // Directory might not exist
    }
  } catch (error) {
    console.warn('Error cleaning up test files:', error);
  }
}

export const DEFAULT_TIER_CONFIG: TierTestConfig = {
  tier1: {
    url: 'http://localhost:3001',
    port: 3001,
    slaLimit: 100,
    defaultLatency: 50
  },
  tier2: {
    url: 'http://localhost:3002',
    port: 3002,
    slaMin: 100,
    slaMax: 500,
    defaultLatency: 200
  },
  tier3: {
    baseDir: '/tmp/tier3-test',
    slaMin: 1000,
    slaMax: 5000,
    defaultLatency: 2000
  }
};
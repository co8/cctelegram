/**
 * Network Chaos Engineering Tests
 * 
 * Comprehensive network fault injection tests using Toxiproxy
 * to simulate various network failure conditions.
 */

import { jest } from '@jest/globals';
import { ChaosTestRunner, ChaosScenario } from '../core/chaos-test-runner.js';
import { ToxiproxyIntegration } from './toxiproxy-integration.js';
import { NetworkChaosScenarios } from '../fixtures/chaos-scenarios.js';
import { secureLog } from '../../../src/security.js';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('axios');
jest.mock('child_process');

import { mockFS } from '../../mocks/fs.mock.js';
import { mockAxios } from '../../mocks/axios.mock.js';
import { mockChildProcess } from '../../mocks/child_process.mock.js';

describe('Network Chaos Engineering Tests', () => {
  let chaosRunner: ChaosTestRunner;
  let toxiproxy: ToxiproxyIntegration;

  beforeAll(async () => {
    // Extend Jest timeout for chaos tests
    jest.setTimeout(300000); // 5 minutes

    // Initialize chaos test runner
    chaosRunner = new ChaosTestRunner();
    toxiproxy = new ToxiproxyIntegration();

    // Initialize Toxiproxy
    try {
      await toxiproxy.initialize();
    } catch (error) {
      console.warn('Toxiproxy not available, using mock implementations');
    }
  });

  beforeEach(() => {
    // Reset all mocks
    mockFS.reset();
    mockAxios.reset();
    mockChildProcess.reset();

    // Configure default mock responses
    mockAxios.mockHealthEndpoint(true);
    mockAxios.mockMetricsEndpoint();
    mockChildProcess.setBridgeProcessRunning(true);
  });

  afterEach(async () => {
    // Clean up any running chaos experiments
    await chaosRunner.cleanup?.();
    await toxiproxy.cleanup();
  });

  afterAll(async () => {
    await toxiproxy.shutdown();
  });

  describe('Network Partition Tests', () => {
    it('should handle complete network partition gracefully', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.NETWORK_PARTITION_5_MINUTES,
        duration: 30000, // Reduce duration for testing
        faultConfiguration: {
          ...NetworkChaosScenarios.NETWORK_PARTITION_5_MINUTES.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            intensity: 1.0 // Complete partition
          }
        }
      };

      secureLog('info', 'Testing complete network partition scenario');

      const result = await chaosRunner.executeScenario(scenario);

      // Validate test results
      expect(result.success).toBe(true);
      expect(result.faultInjectionResult.success).toBe(true);
      expect(result.recoveryValidationResult.success).toBe(true);
      expect(result.mttrAnalysisResult.mttr).toBeLessThan(60000); // Recovery within 1 minute

      // Validate that network partition was detected
      const detectionObservations = result.observations.filter(
        obs => obs.type === 'fault_detected'
      );
      expect(detectionObservations.length).toBeGreaterThan(0);

      // Validate that recovery mechanisms were activated
      expect(result.recoveryValidationResult.mechanismsActivated).toContain('circuit_breaker');

      // Validate system metrics during partition
      const systemMetrics = result.systemMetrics;
      expect(systemMetrics.length).toBeGreaterThan(0);

      const highErrorRateMetrics = systemMetrics.filter(
        metric => metric.application.errorRate > 0.5
      );
      expect(highErrorRateMetrics.length).toBeGreaterThan(0);

      secureLog('info', 'Network partition test completed successfully', {
        mttr: result.mttrAnalysisResult.mttr,
        success_rate: result.recoveryValidationResult.successRate,
        mechanisms_activated: result.recoveryValidationResult.mechanismsActivated.length
      });
    });

    it('should recover from partial network partition', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.PARTIAL_NETWORK_PARTITION,
        duration: 20000,
        faultConfiguration: {
          ...NetworkChaosScenarios.PARTIAL_NETWORK_PARTITION.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            intensity: 0.5 // 50% packet loss
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      expect(result.recoveryValidationResult.successRate).toBeGreaterThan(0.5);
      expect(result.mttrAnalysisResult.mttr).toBeLessThan(45000); // Recovery within 45 seconds

      // Should have some successful requests even during partition
      expect(result.recoveryValidationResult.successRate).toBeGreaterThan(0.3);

      // Circuit breaker should handle partial failures
      const cbObservations = result.observations.filter(
        obs => obs.description.includes('circuit breaker')
      );
      expect(cbObservations.length).toBeGreaterThan(0);
    });

    it('should handle network partition with gradual recovery', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.NETWORK_PARTITION_WITH_RECOVERY,
        duration: 40000,
        faultConfiguration: {
          ...NetworkChaosScenarios.NETWORK_PARTITION_WITH_RECOVERY.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            gradualRecovery: true,
            recoverySteps: [
              { time: 10000, intensity: 1.0 }, // Complete partition
              { time: 20000, intensity: 0.7 }, // 70% loss
              { time: 30000, intensity: 0.3 }, // 30% loss
              { time: 40000, intensity: 0.0 }  // Full recovery
            ]
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Should show gradual improvement in success rate
      const successRateHistory = result.systemMetrics.map(m => 
        m.application.errorRate > 0 ? 1.0 - m.application.errorRate : 1.0
      );
      
      const earlySuccessRate = successRateHistory.slice(0, 10).reduce((a, b) => a + b) / 10;
      const lateSuccessRate = successRateHistory.slice(-10).reduce((a, b) => a + b) / 10;
      
      expect(lateSuccessRate).toBeGreaterThan(earlySuccessRate);
    });
  });

  describe('High Latency Tests', () => {
    it('should handle high latency with circuit breaker activation', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.HIGH_LATENCY_5_SECONDS,
        duration: 25000,
        faultConfiguration: {
          ...NetworkChaosScenarios.HIGH_LATENCY_5_SECONDS.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            maxLatency: 3000, // 3 second max latency
            intensity: 0.8 // 80% intensity = 2.4 second latency
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Response times should be high during fault injection
      const highLatencyMetrics = result.systemMetrics.filter(
        metric => metric.application.responseTime > 2000
      );
      expect(highLatencyMetrics.length).toBeGreaterThan(0);

      // Circuit breaker should activate due to high latency
      expect(result.recoveryValidationResult.mechanismsActivated).toContain('circuit_breaker');

      // MTTR should be reasonable despite high latency
      expect(result.mttrAnalysisResult.mttr).toBeLessThan(30000);
    });

    it('should handle variable latency injection', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.VARIABLE_LATENCY,
        duration: 30000,
        faultConfiguration: {
          ...NetworkChaosScenarios.VARIABLE_LATENCY.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            minLatency: 100,
            maxLatency: 2000,
            variabilityPattern: 'random' // or 'sine', 'sawtooth'
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Should have variable response times
      const responseTimes = result.systemMetrics.map(m => m.application.responseTime);
      const responseTimeVariance = this.calculateVariance(responseTimes);
      
      expect(responseTimeVariance).toBeGreaterThan(100000); // Significant variance
      
      // System should adapt to variable conditions
      expect(result.recoveryValidationResult.mechanismsActivated).toContain('retry_logic');
    });

    it('should recover from latency spikes', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.LATENCY_SPIKES,
        duration: 35000,
        faultConfiguration: {
          ...NetworkChaosScenarios.LATENCY_SPIKES.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            spikeLatency: 5000, // 5 second spikes
            spikeDuration: 3000, // 3 second spike duration
            spikeInterval: 10000 // Every 10 seconds
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Should have periodic spikes in response time
      const maxResponseTime = Math.max(...result.systemMetrics.map(m => m.application.responseTime));
      expect(maxResponseTime).toBeGreaterThan(4000);

      // System should recover between spikes
      const avgResponseTime = result.systemMetrics
        .map(m => m.application.responseTime)
        .reduce((a, b) => a + b) / result.systemMetrics.length;
      expect(avgResponseTime).toBeLessThan(2000); // Average should be reasonable
    });
  });

  describe('Bandwidth Limitation Tests', () => {
    it('should handle severe bandwidth constraints', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.BANDWIDTH_LIMIT_1MBPS,
        duration: 20000,
        faultConfiguration: {
          ...NetworkChaosScenarios.BANDWIDTH_LIMIT_1MBPS.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            maxBandwidth: 1000000, // 1 MB/s
            intensity: 0.9 // Limit to 100KB/s
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Response times should increase due to bandwidth limits
      const avgResponseTime = result.systemMetrics
        .map(m => m.application.responseTime)
        .reduce((a, b) => a + b) / result.systemMetrics.length;
      expect(avgResponseTime).toBeGreaterThan(500); // Slower due to bandwidth limit

      // Throughput should be reduced
      const avgThroughput = result.systemMetrics
        .map(m => m.application.throughput)
        .reduce((a, b) => a + b) / result.systemMetrics.length;
      expect(avgThroughput).toBeLessThan(10); // Reduced throughput

      // System should adapt with graceful degradation
      expect(result.recoveryValidationResult.mechanismsActivated)
        .toContain('graceful_degradation');
    });

    it('should handle bandwidth fluctuations', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.FLUCTUATING_BANDWIDTH,
        duration: 40000,
        faultConfiguration: {
          ...NetworkChaosScenarios.FLUCTUATING_BANDWIDTH.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            minBandwidth: 100000, // 100 KB/s
            maxBandwidth: 10000000, // 10 MB/s
            fluctuationInterval: 5000 // Change every 5 seconds
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Should show adaptation to changing conditions
      const responseTimes = result.systemMetrics.map(m => m.application.responseTime);
      const responseTimeVariance = this.calculateVariance(responseTimes);
      
      expect(responseTimeVariance).toBeGreaterThan(50000); // High variance due to fluctuations
      
      // Retry logic should help with varying conditions
      expect(result.recoveryValidationResult.mechanismsActivated).toContain('retry_logic');
    });
  });

  describe('Complex Network Scenarios', () => {
    it('should handle cascading network failures', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.CASCADING_NETWORK_FAILURE,
        duration: 60000,
        faultConfiguration: {
          ...NetworkChaosScenarios.CASCADING_NETWORK_FAILURE.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            failureSequence: [
              { type: 'high_latency', delay: 0, duration: 15000 },
              { type: 'bandwidth_limit', delay: 10000, duration: 20000 },
              { type: 'network_partition', delay: 25000, duration: 15000 }
            ]
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Multiple recovery mechanisms should activate
      expect(result.recoveryValidationResult.mechanismsActivated.length).toBeGreaterThan(2);
      expect(result.recoveryValidationResult.mechanismsActivated).toContain('circuit_breaker');
      expect(result.recoveryValidationResult.mechanismsActivated).toContain('retry_logic');

      // MTTR should be reasonable despite multiple failures
      expect(result.mttrAnalysisResult.mttr).toBeLessThan(90000); // Within 1.5 minutes

      // Should have multiple phases of degradation and recovery
      const errorRates = result.systemMetrics.map(m => m.application.errorRate);
      const peakErrorRate = Math.max(...errorRates);
      expect(peakErrorRate).toBeGreaterThan(0.5); // Significant impact during cascading failure
    });

    it('should handle network jitter and packet loss combination', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.NETWORK_JITTER_WITH_LOSS,
        duration: 30000,
        faultConfiguration: {
          ...NetworkChaosScenarios.NETWORK_JITTER_WITH_LOSS.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            baseLatency: 100,
            jitterRange: 500, // ±500ms jitter
            packetLossRate: 0.1 // 10% packet loss
          }
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Response times should be highly variable
      const responseTimes = result.systemMetrics.map(m => m.application.responseTime);
      const responseTimeVariance = this.calculateVariance(responseTimes);
      expect(responseTimeVariance).toBeGreaterThan(10000);

      // Error rate should be elevated due to packet loss
      const avgErrorRate = result.systemMetrics
        .map(m => m.application.errorRate)
        .reduce((a, b) => a + b) / result.systemMetrics.length;
      expect(avgErrorRate).toBeGreaterThan(0.05); // 5% or higher

      // Retry mechanism should be active
      expect(result.recoveryValidationResult.mechanismsActivated).toContain('retry_logic');
    });

    it('should validate network chaos with real traffic patterns', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.REALISTIC_NETWORK_DEGRADATION,
        duration: 45000,
        faultConfiguration: {
          ...NetworkChaosScenarios.REALISTIC_NETWORK_DEGRADATION.faultConfiguration,
          parameters: {
            targetPort: 8080,
            proxyPort: 9080,
            trafficPattern: 'bursty', // or 'steady', 'peak_hours'
            degradationLevel: 'moderate',
            affectedServices: ['health', 'metrics', 'webhook']
          }
        }
      };

      // Simulate realistic traffic during test
      const trafficSimulation = this.simulateRealisticTraffic(scenario.duration);

      const result = await chaosRunner.executeScenario(scenario);
      
      // Stop traffic simulation
      trafficSimulation.stop();

      expect(result.success).toBe(true);
      
      // Should handle realistic traffic patterns
      expect(result.recoveryValidationResult.successRate).toBeGreaterThan(0.7);
      
      // System should maintain core functionality
      const healthCheckResults = result.recoveryValidationResult.healthCheckResults;
      const criticalHealthChecksSuccess = healthCheckResults
        .filter(hc => hc.endpoint.includes('health'))
        .every(hc => hc.success);
      expect(criticalHealthChecksSuccess).toBe(true);

      // MTTR should be within SLA targets
      expect(result.mttrAnalysisResult.mttr).toBeLessThan(60000);
    });
  });

  describe('Recovery Validation', () => {
    it('should validate complete recovery after network chaos', async () => {
      const scenario: ChaosScenario = {
        ...NetworkChaosScenarios.NETWORK_PARTITION_5_MINUTES,
        duration: 15000, // Short duration for faster test
        recoveryExpectations: {
          maxRecoveryTime: 30000,
          expectedRecoveryMechanisms: ['circuit_breaker', 'retry_logic', 'health_check_recovery'],
          successCriteria: {
            minimumSuccessRate: 0.95,
            maxResponseTime: 2000,
            requiredHealthChecks: ['http://localhost:8080/health'],
            dataConsistencyChecks: ['event_queue_integrity', 'message_ordering']
          },
          healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
        }
      };

      const result = await chaosRunner.executeScenario(scenario);

      expect(result.success).toBe(true);
      
      // Validate all expected mechanisms activated
      scenario.recoveryExpectations.expectedRecoveryMechanisms.forEach(mechanism => {
        expect(result.recoveryValidationResult.mechanismsActivated).toContain(mechanism);
      });

      // Validate recovery time
      expect(result.recoveryValidationResult.recoveryTime)
        .toBeLessThan(scenario.recoveryExpectations.maxRecoveryTime);

      // Validate success criteria
      expect(result.recoveryValidationResult.successRate)
        .toBeGreaterThanOrEqual(scenario.recoveryExpectations.successCriteria.minimumSuccessRate);

      // Validate health checks
      const healthCheckSuccess = result.recoveryValidationResult.healthCheckResults
        .every(hc => hc.success);
      expect(healthCheckSuccess).toBe(true);

      // Validate data consistency
      const dataConsistencySuccess = result.recoveryValidationResult.dataConsistencyResults
        .every(dc => dc.consistent);
      expect(dataConsistencySuccess).toBe(true);
    });
  });

  // Helper functions
  function calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    return squaredDifferences.reduce((sum, val) => sum + val) / values.length;
  }

  function simulateRealisticTraffic(duration: number): { stop: () => void } {
    // Simulate realistic traffic patterns during chaos test
    const intervals: NodeJS.Timeout[] = [];
    
    // Burst traffic every 10 seconds
    const burstInterval = setInterval(() => {
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          // Simulate API call
          mockAxios.get('http://localhost:8080/health').catch(() => {});
        }, i * 100);
      }
    }, 10000);
    
    intervals.push(burstInterval);

    // Background steady traffic
    const steadyInterval = setInterval(() => {
      mockAxios.get('http://localhost:8080/metrics').catch(() => {});
    }, 2000);
    
    intervals.push(steadyInterval);

    // Stop after duration
    setTimeout(() => {
      intervals.forEach(interval => clearInterval(interval));
    }, duration);

    return {
      stop: () => {
        intervals.forEach(interval => clearInterval(interval));
      }
    };
  }
});
/**
 * Chaos Engineering Tests
 * 
 * Comprehensive chaos engineering test suite for CCTelegram bridge system.
 * Tests network failures, service outages, resource constraints, and validates
 * automatic recovery mechanisms and system resilience.
 */

import { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect, jest } from '@jest/globals';
import { ChaosTestRunner, ChaosScenario } from './core/chaos-test-runner.js';
import { FaultInjector } from './core/fault-injector.js';
import { RecoveryValidator } from './core/recovery-validator.js';
import { MTTRAnalyzer } from './core/mttr-analyzer.js';
import { SystemMonitor } from './core/system-monitor.js';
import { ToxiproxyIntegration } from './network/toxiproxy-integration.js';
import { ChaosMonkeyLambda } from './lambda/chaos-monkey-lambda.js';
import { 
  NetworkChaosScenarios, 
  ServiceChaosScenarios, 
  LambdaChaosScenarios,
  getAllChaosScenarios,
  getScenariosByTag
} from './fixtures/chaos-scenarios.js';
import axios from 'axios';
import { secureLog } from '../../src/security.js';

describe('Chaos Engineering Tests', () => {
  let chaosRunner: ChaosTestRunner;
  let faultInjector: FaultInjector;
  let recoveryValidator: RecoveryValidator;
  let mttrAnalyzer: MTTRAnalyzer;
  let systemMonitor: SystemMonitor;
  let toxiproxy: ToxiproxyIntegration;
  let chaosMonkey: ChaosMonkeyLambda;

  const TEST_SERVICE_URL = process.env.TEST_SERVICE_URL || 'http://localhost:8080';
  const TOXIPROXY_HOST = process.env.TOXIPROXY_HOST || 'localhost';
  const TOXIPROXY_PORT = parseInt(process.env.TOXIPROXY_PORT || '8474');

  beforeAll(async () => {
    // Initialize chaos engineering components
    chaosRunner = new ChaosTestRunner();
    faultInjector = new FaultInjector();
    recoveryValidator = new RecoveryValidator();
    mttrAnalyzer = new MTTRAnalyzer();
    systemMonitor = new SystemMonitor();
    
    toxiproxy = new ToxiproxyIntegration({
      host: TOXIPROXY_HOST,
      port: TOXIPROXY_PORT,
      autoStart: true
    });

    chaosMonkey = new ChaosMonkeyLambda({
      region: process.env.AWS_REGION || 'us-east-1',
      enabledFunctions: ['cctelegram-bridge-handler'],
      chaosPercent: 100, // 100% for testing
      enableCloudWatchIntegration: false // Disable for tests
    });

    // Initialize components
    await Promise.all([
      chaosRunner.initialize(),
      faultInjector.initialize(),
      toxiproxy.initialize(),
      // chaosMonkey.initialize() // Comment out if AWS not available
    ]);

    // Start system monitoring
    await systemMonitor.startMonitoring(2000); // Monitor every 2 seconds

    secureLog('info', 'Chaos engineering test suite initialized');
  }, 60000);

  afterAll(async () => {
    // Cleanup and shutdown
    await systemMonitor.stopMonitoring();
    await toxiproxy.shutdown();
    await chaosMonkey.shutdown();
    await chaosRunner.shutdown();

    secureLog('info', 'Chaos engineering test suite cleanup completed');
  }, 30000);

  beforeEach(() => {
    // Reset any test-specific state
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any active chaos experiments
    await toxiproxy.cleanup();
  });

  describe('Network Chaos Tests', () => {
    test('should handle complete network partition gracefully', async () => {
      const scenario = NetworkChaosScenarios.NETWORK_PARTITION_5_MINUTES;
      
      // Run chaos test
      const result = await chaosRunner.runScenario(scenario);
      
      // Validate results
      expect(result.success).toBe(true);
      expect(result.recoveryTime).toBeLessThan(scenario.recoveryExpectations.maxRecoveryTime);
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(
        scenario.recoveryExpectations.successCriteria.minimumSuccessRate
      );
      
      // Verify recovery mechanisms were activated
      expect(result.activatedMechanisms).toContain('circuit_breaker');
      expect(result.activatedMechanisms).toContain('failover');
      
      // Check MTTR analysis
      expect(result.mttrAnalysis).toBeDefined();
      expect(result.mttrAnalysis.mttr).toBeLessThan(60000); // Less than 1 minute
      expect(result.mttrAnalysis.availability).toBeGreaterThan(0.8); // 80%+ availability
    }, 480000); // 8 minutes timeout

    test('should handle partial network partition with packet loss', async () => {
      const scenario = NetworkChaosScenarios.PARTIAL_NETWORK_PARTITION;
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.recoveryTime).toBeLessThan(scenario.recoveryExpectations.maxRecoveryTime);
      expect(result.activatedMechanisms).toContain('retry_logic');
      
      // Should handle packet loss gracefully
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.6);
    }, 240000);

    test('should adapt to high latency conditions', async () => {
      const scenario = NetworkChaosScenarios.HIGH_LATENCY_5_SECONDS;
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.activatedMechanisms).toContain('circuit_breaker');
      expect(result.activatedMechanisms).toContain('timeout_handling');
      
      // Should maintain service despite high latency
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.5);
    }, 240000);

    test('should handle variable latency patterns', async () => {
      const scenario = NetworkChaosScenarios.VARIABLE_LATENCY;
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.activatedMechanisms).toContain('adaptive_timeout');
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.8);
    }, 300000);

    test('should survive bandwidth limitations', async () => {
      const scenario = NetworkChaosScenarios.BANDWIDTH_LIMIT_1MBPS;
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.activatedMechanisms).toContain('graceful_degradation');
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.8);
    }, 300000);

    test('should handle cascading network failures', async () => {
      const scenario = NetworkChaosScenarios.CASCADING_NETWORK_FAILURE;
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.recoveryTime).toBeLessThan(120000); // 2 minutes
      
      // Should activate multiple recovery mechanisms
      expect(result.activatedMechanisms.length).toBeGreaterThanOrEqual(4);
      expect(result.activatedMechanisms).toContain('circuit_breaker');
      expect(result.activatedMechanisms).toContain('emergency_mode');
      
      // Should maintain minimum service level
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.6);
    }, 720000); // 12 minutes timeout
  });

  describe('Service Chaos Tests', () => {
    test('should recover from complete service outage', async () => {
      const scenario = ServiceChaosScenarios.COMPLETE_SERVICE_OUTAGE;
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.recoveryTime).toBeLessThan(60000); // 1 minute
      expect(result.activatedMechanisms).toContain('service_restart');
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.9);
      
      // Data consistency should be maintained
      expect(result.dataConsistencyResults).toBeDefined();
      expect(result.dataConsistencyResults.every(dc => dc.consistent)).toBe(true);
    }, 360000);

    test('should handle memory exhaustion gracefully', async () => {
      const scenario = ServiceChaosScenarios.MEMORY_EXHAUSTION;
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.activatedMechanisms).toContain('memory_cleanup');
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.7);
    }, 240000);

    test('should manage CPU exhaustion', async () => {
      const scenario = ServiceChaosScenarios.CPU_EXHAUSTION;
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.activatedMechanisms).toContain('request_throttling');
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.6);
    }, 300000);
  });

  describe('Lambda Chaos Tests', () => {
    test('should handle Lambda function timeouts', async () => {
      const scenario = LambdaChaosScenarios.LAMBDA_TIMEOUT;
      
      // Skip if AWS not configured
      if (!process.env.AWS_REGION) {
        console.log('Skipping Lambda chaos tests - AWS not configured');
        return;
      }
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.activatedMechanisms).toContain('retry_logic');
      expect(result.activatedMechanisms).toContain('dead_letter_queue');
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.8);
    }, 240000);

    test('should handle Lambda cold starts', async () => {
      const scenario = LambdaChaosScenarios.LAMBDA_COLD_START;
      
      if (!process.env.AWS_REGION) {
        console.log('Skipping Lambda chaos tests - AWS not configured');
        return;
      }
      
      const result = await chaosRunner.runScenario(scenario);
      
      expect(result.success).toBe(true);
      expect(result.activatedMechanisms).toContain('warm_pool');
      expect(result.finalSuccessRate).toBeGreaterThanOrEqual(0.85);
    }, 300000);
  });

  describe('Recovery Validation Tests', () => {
    test('should validate circuit breaker functionality', async () => {
      // Create network partition to trigger circuit breaker
      const proxyName = await toxiproxy.createNetworkFault(
        {
          type: 'partition',
          intensity: 1.0,
          parameters: { targetPort: 8080, proxyPort: 9080 }
        },
        { host: 'localhost', port: 8080 },
        9080
      );

      try {
        // Wait for circuit breaker to activate
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Validate recovery mechanisms
        const result = await recoveryValidator.validateRecovery(
          {
            maxRecoveryTime: 60000,
            expectedRecoveryMechanisms: ['circuit_breaker'],
            successCriteria: {
              minimumSuccessRate: 0.8,
              maxResponseTime: 3000,
              requiredHealthChecks: [`${TEST_SERVICE_URL}/health`],
              dataConsistencyChecks: ['event_queue_integrity']
            },
            healthCheckEndpoints: [`${TEST_SERVICE_URL}/health`]
          },
          { type: 'network_partition', intensity: 1.0 }
        );

        expect(result.success).toBe(true);
        expect(result.mechanismsActivated).toContain('circuit_breaker');
        expect(result.recoveryTime).toBeLessThan(60000);

      } finally {
        await toxiproxy.removeNetworkFault(proxyName);
      }
    }, 180000);

    test('should validate automatic service restart', async () => {
      // Simulate service crash
      const faultResult = await faultInjector.injectFault({
        type: 'service_crash',
        target: 'cctelegram-bridge',
        intensity: 1.0,
        duration: 30000,
        parameters: {
          crashMethod: 'graceful_shutdown',
          autoRestart: true
        }
      });

      expect(faultResult.success).toBe(true);

      // Validate recovery
      const recoveryResult = await recoveryValidator.validateRecovery(
        {
          maxRecoveryTime: 45000,
          expectedRecoveryMechanisms: ['service_restart', 'health_monitoring'],
          successCriteria: {
            minimumSuccessRate: 0.9,
            maxResponseTime: 3000,
            requiredHealthChecks: [`${TEST_SERVICE_URL}/health`],
            dataConsistencyChecks: ['file_system_consistency']
          },
          healthCheckEndpoints: [`${TEST_SERVICE_URL}/health`]
        },
        faultResult
      );

      expect(recoveryResult.success).toBe(true);
      expect(recoveryResult.mechanismsActivated).toContain('service_restart');
    }, 120000);
  });

  describe('MTTR Analysis Tests', () => {
    test('should analyze recovery performance and provide recommendations', async () => {
      const scenario = NetworkChaosScenarios.PARTIAL_NETWORK_PARTITION;
      const chaosResult = await chaosRunner.runScenario(scenario);
      
      expect(chaosResult.mttrAnalysis).toBeDefined();
      
      const mttrAnalysis = chaosResult.mttrAnalysis;
      
      // MTTR should be reasonable
      expect(mttrAnalysis.mttr).toBeLessThan(60000); // Less than 1 minute
      expect(mttrAnalysis.availability).toBeGreaterThan(0.7); // 70%+ availability
      
      // Should have recovery phases
      expect(mttrAnalysis.recoveryPhases).toBeDefined();
      expect(mttrAnalysis.recoveryPhases.length).toBeGreaterThan(0);
      
      // Should provide recommendations
      expect(mttrAnalysis.recommendations).toBeDefined();
      expect(mttrAnalysis.recommendations.length).toBeGreaterThan(0);
      
      // Recommendations should be actionable
      const criticalRecommendations = mttrAnalysis.recommendations.filter(r => r.priority === 'critical');
      if (criticalRecommendations.length > 0) {
        expect(criticalRecommendations[0].expectedImprovement).toBeGreaterThan(0);
        expect(criticalRecommendations[0].timeToImplement).toBeDefined();
      }
    }, 300000);

    test('should track MTTR trends over multiple experiments', async () => {
      const scenarios = [
        NetworkChaosScenarios.PARTIAL_NETWORK_PARTITION,
        NetworkChaosScenarios.HIGH_LATENCY_5_SECONDS,
        NetworkChaosScenarios.BANDWIDTH_LIMIT_1MBPS
      ];

      const results = [];
      
      for (const scenario of scenarios) {
        const result = await chaosRunner.runScenario(scenario);
        results.push(result);
        
        // Small delay between experiments
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // Analyze trends
      const lastResult = results[results.length - 1];
      expect(lastResult.mttrAnalysis.trends).toBeDefined();
      
      // Should have statistical analysis with multiple data points
      expect(lastResult.mttrAnalysis.statisticalAnalysis.samples).toBeGreaterThan(1);
    }, 600000);
  });

  describe('System State Monitoring Tests', () => {
    test('should monitor system health during chaos experiments', async () => {
      const healthStatusBefore = systemMonitor.getHealthStatus();
      expect(healthStatusBefore.status).toBe('healthy');

      // Run a chaos scenario that stresses the system
      const scenario = ServiceChaosScenarios.CPU_EXHAUSTION;
      
      let healthDuringChaos: any;
      const healthCheckPromise = new Promise(resolve => {
        setTimeout(() => {
          healthDuringChaos = systemMonitor.getHealthStatus();
          resolve(healthDuringChaos);
        }, scenario.duration / 2); // Check halfway through
      });

      const [chaosResult] = await Promise.all([
        chaosRunner.runScenario(scenario),
        healthCheckPromise
      ]);

      // System should detect degradation during chaos
      expect(healthDuringChaos.status).toMatch(/degraded|unhealthy/);

      // System should recover after chaos
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for recovery
      const healthStatusAfter = systemMonitor.getHealthStatus();
      expect(healthStatusAfter.status).toBe('healthy');

      expect(chaosResult.success).toBe(true);
    }, 300000);

    test('should collect and analyze system metrics', async () => {
      const metricsBefore = systemMonitor.getMetricsHistory(1)[0];
      expect(metricsBefore).toBeDefined();

      // Run chaos experiment
      const scenario = ServiceChaosScenarios.MEMORY_EXHAUSTION;
      await chaosRunner.runScenario(scenario);

      const metricsAfter = systemMonitor.getMetricsHistory(10);
      expect(metricsAfter.length).toBeGreaterThan(5);

      // Should have captured metrics during chaos
      const maxMemoryUsage = Math.max(...metricsAfter.map(m => m.memory.usage));
      expect(maxMemoryUsage).toBeGreaterThan(metricsBefore.memory.usage);
    }, 240000);

    test('should generate alerts for critical conditions', async () => {
      const alertsBefore = systemMonitor.getAlerts().length;

      // Configure aggressive alerting thresholds for testing
      systemMonitor.updateAlertConfiguration({
        thresholds: {
          cpu: { warning: 0.5, critical: 0.7 },
          memory: { warning: 0.6, critical: 0.8 },
          disk: { warning: 0.8, critical: 0.9 },
          responseTime: { warning: 2000, critical: 5000 },
          errorRate: { warning: 0.05, critical: 0.1 },
          customMetrics: {}
        }
      });

      // Run high-intensity chaos
      const scenario = ServiceChaosScenarios.CPU_EXHAUSTION;
      await chaosRunner.runScenario(scenario);

      const alertsAfter = systemMonitor.getAlerts();
      expect(alertsAfter.length).toBeGreaterThan(alertsBefore);

      // Should have CPU-related alerts
      const cpuAlerts = alertsAfter.filter(alert => alert.metric === 'cpu');
      expect(cpuAlerts.length).toBeGreaterThan(0);
    }, 300000);
  });

  describe('Chaos Dashboard Integration Tests', () => {
    test('should provide real-time chaos experiment data', async () => {
      const dashboardData = await chaosRunner.getDashboardData();
      
      expect(dashboardData).toBeDefined();
      expect(dashboardData.activeExperiments).toBeDefined();
      expect(dashboardData.systemHealth).toBeDefined();
      expect(dashboardData.mttrTrends).toBeDefined();
      expect(dashboardData.recoveryMechanisms).toBeDefined();

      // Run an experiment and check dashboard updates
      const scenario = NetworkChaosScenarios.PARTIAL_NETWORK_PARTITION;
      const experimentPromise = chaosRunner.runScenario(scenario);

      // Check dashboard during experiment
      await new Promise(resolve => setTimeout(resolve, 10000));
      const dashboardDuringExperiment = await chaosRunner.getDashboardData();
      
      expect(dashboardDuringExperiment.activeExperiments.length).toBeGreaterThan(0);
      expect(dashboardDuringExperiment.systemHealth.status).toMatch(/degraded|unhealthy/);

      await experimentPromise;

      // Check dashboard after experiment
      const dashboardAfterExperiment = await chaosRunner.getDashboardData();
      expect(dashboardAfterExperiment.systemHealth.status).toBe('healthy');
    }, 300000);
  });

  describe('Comprehensive Resilience Tests', () => {
    test('should survive multiple concurrent chaos experiments', async () => {
      const scenarios = [
        NetworkChaosScenarios.PARTIAL_NETWORK_PARTITION,
        ServiceChaosScenarios.MEMORY_EXHAUSTION
      ];

      // Run scenarios concurrently
      const experimentPromises = scenarios.map(scenario => 
        chaosRunner.runScenario(scenario)
      );

      const results = await Promise.all(experimentPromises);

      // All experiments should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // System should maintain basic functionality
      const finalSuccessRates = results.map(r => r.finalSuccessRate);
      expect(Math.min(...finalSuccessRates)).toBeGreaterThan(0.5);
    }, 480000);

    test('should validate end-to-end system resilience', async () => {
      // Comprehensive test covering all chaos types
      const comprehensiveScenarios = [
        NetworkChaosScenarios.NETWORK_PARTITION_WITH_RECOVERY,
        ServiceChaosScenarios.COMPLETE_SERVICE_OUTAGE,
        NetworkChaosScenarios.HIGH_LATENCY_5_SECONDS
      ];

      const results = [];
      
      for (const scenario of comprehensiveScenarios) {
        secureLog('info', `Running comprehensive resilience test: ${scenario.name}`);
        
        const result = await chaosRunner.runScenario(scenario);
        results.push(result);
        
        expect(result.success).toBe(true);
        expect(result.recoveryTime).toBeLessThan(scenario.recoveryExpectations.maxRecoveryTime);
        
        // Allow system to stabilize between tests
        await new Promise(resolve => setTimeout(resolve, 10000));
      }

      // Analyze overall resilience
      const averageMTTR = results.reduce((sum, r) => sum + r.mttrAnalysis.mttr, 0) / results.length;
      const averageAvailability = results.reduce((sum, r) => sum + r.mttrAnalysis.availability, 0) / results.length;
      
      expect(averageMTTR).toBeLessThan(90000); // Average MTTR less than 1.5 minutes
      expect(averageAvailability).toBeGreaterThan(0.8); // Average 80%+ availability
      
      secureLog('info', 'Comprehensive resilience test completed', {
        scenarios_tested: results.length,
        average_mttr: averageMTTR,
        average_availability: averageAvailability
      });
    }, 900000); // 15 minutes timeout
  });

  describe('Integration with Existing Test Infrastructure', () => {
    test('should integrate with performance tests', async () => {
      // Run a lightweight chaos scenario during performance testing
      const scenario = NetworkChaosScenarios.VARIABLE_LATENCY;
      
      // Mock performance test execution
      const performanceTestPromise = new Promise(resolve => {
        setTimeout(() => resolve({ 
          averageResponseTime: 2500, 
          throughput: 100, 
          errorRate: 0.02 
        }), scenario.duration / 2);
      });

      const [chaosResult, performanceResult] = await Promise.all([
        chaosRunner.runScenario(scenario),
        performanceTestPromise
      ]);

      expect(chaosResult.success).toBe(true);
      expect(performanceResult).toBeDefined();
      
      // Performance should degrade but remain functional
      // expect(performanceResult.errorRate).toBeLessThan(0.1);
    }, 300000);

    test('should provide data for monitoring dashboards', async () => {
      const scenario = NetworkChaosScenarios.PARTIAL_NETWORK_PARTITION;
      const result = await chaosRunner.runScenario(scenario);

      // Export data for external monitoring systems
      const monitoringData = {
        timestamp: Date.now(),
        experiment: scenario.name,
        mttr: result.mttrAnalysis.mttr,
        availability: result.mttrAnalysis.availability,
        recoveryMechanisms: result.activatedMechanisms,
        alerts: systemMonitor.getAlerts(),
        metrics: systemMonitor.getMetricsHistory(10)
      };

      expect(monitoringData.mttr).toBeDefined();
      expect(monitoringData.availability).toBeDefined();
      expect(monitoringData.recoveryMechanisms.length).toBeGreaterThan(0);

      // Data should be suitable for time-series databases
      expect(typeof monitoringData.timestamp).toBe('number');
      expect(typeof monitoringData.mttr).toBe('number');
      expect(typeof monitoringData.availability).toBe('number');
    }, 240000);
  });
});
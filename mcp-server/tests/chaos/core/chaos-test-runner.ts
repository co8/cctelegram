/**
 * Chaos Test Runner
 * 
 * Main orchestrator for chaos engineering experiments.
 * Coordinates fault injection, monitoring, and recovery validation.
 */

import { EventEmitter } from 'events';
import { FaultInjector, FaultInjectionResult } from './fault-injector.js';
import { RecoveryValidator, RecoveryValidationResult } from './recovery-validator.js';
import { MTTRAnalyzer, MTTRAnalysisResult } from './mttr-analyzer.js';
import { SystemMonitor, SystemMetrics } from './system-monitor.js';
import { secureLog } from '../../../src/security.js';

export interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  category: 'network' | 'service' | 'resource' | 'data';
  severity: 'low' | 'medium' | 'high' | 'critical';
  duration: number; // Duration in milliseconds
  faultConfiguration: FaultConfiguration;
  recoveryExpectations: RecoveryExpectations;
  safetyChecks: string[];
  rollbackPlan: string[];
}

export interface FaultConfiguration {
  type: 'network_partition' | 'high_latency' | 'bandwidth_limit' | 'service_crash' | 
        'resource_exhaustion' | 'data_corruption' | 'cascading_failure';
  intensity: number; // 0.0 to 1.0
  target: string; // Component or service to target
  parameters: Record<string, any>;
  gradualRampUp?: boolean;
  rampUpDuration?: number;
}

export interface RecoveryExpectations {
  maxRecoveryTime: number; // Maximum acceptable recovery time in ms
  expectedRecoveryMechanisms: string[];
  successCriteria: SuccessCriteria;
  healthCheckEndpoints: string[];
}

export interface SuccessCriteria {
  minimumSuccessRate: number; // 0.0 to 1.0
  maxResponseTime: number; // Maximum acceptable response time in ms
  requiredHealthChecks: string[];
  dataConsistencyChecks: string[];
}

export interface ChaosTestResult {
  scenarioId: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  faultInjectionResult: FaultInjectionResult;
  recoveryValidationResult: RecoveryValidationResult;
  mttrAnalysisResult: MTTRAnalysisResult;
  systemMetrics: SystemMetrics[];
  observations: ChaosObservation[];
  summary: ChaosTestSummary;
}

export interface ChaosObservation {
  timestamp: number;
  type: 'fault_injected' | 'fault_detected' | 'recovery_started' | 'recovery_completed' | 
        'system_degraded' | 'system_recovered' | 'alert_triggered' | 'manual_intervention';
  description: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  metrics?: Record<string, number>;
  context?: Record<string, any>;
}

export interface ChaosTestSummary {
  scenarioName: string;
  faultDuration: number;
  detectionTime: number;
  recoveryTime: number;
  totalDowntime: number;
  mttr: number;
  successRate: number;
  impactAssessment: string;
  lessonsLearned: string[];
  recommendedActions: string[];
}

export class ChaosTestRunner extends EventEmitter {
  private faultInjector: FaultInjector;
  private recoveryValidator: RecoveryValidator;
  private mttrAnalyzer: MTTRAnalyzer;
  private systemMonitor: SystemMonitor;
  private runningScenarios: Map<string, ChaosTestResult> = new Map();
  private safetyMode: boolean = true;

  constructor() {
    super();
    this.faultInjector = new FaultInjector();
    this.recoveryValidator = new RecoveryValidator();
    this.mttrAnalyzer = new MTTRAnalyzer();
    this.systemMonitor = new SystemMonitor();

    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Execute a chaos engineering scenario
   */
  public async executeScenario(scenario: ChaosScenario): Promise<ChaosTestResult> {
    // Validate scenario safety
    if (!this.validateScenarioSafety(scenario)) {
      throw new Error(`Scenario ${scenario.id} failed safety validation`);
    }

    const result: ChaosTestResult = {
      scenarioId: scenario.id,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      success: false,
      faultInjectionResult: {} as FaultInjectionResult,
      recoveryValidationResult: {} as RecoveryValidationResult,
      mttrAnalysisResult: {} as MTTRAnalysisResult,
      systemMetrics: [],
      observations: [],
      summary: {} as ChaosTestSummary
    };

    this.runningScenarios.set(scenario.id, result);

    secureLog('info', 'Starting chaos engineering scenario', {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      category: scenario.category,
      severity: scenario.severity,
      duration: scenario.duration
    });

    this.addObservation(result, 'fault_injected', 
      `Starting chaos scenario: ${scenario.name}`, 'info');

    try {
      // Phase 1: Start system monitoring
      await this.systemMonitor.startMonitoring();
      this.addObservation(result, 'system_degraded', 
        'System monitoring started', 'info');

      // Phase 2: Establish baseline metrics
      const baselineMetrics = await this.collectBaselineMetrics();
      result.systemMetrics.push(baselineMetrics);

      // Phase 3: Execute fault injection
      this.addObservation(result, 'fault_injected', 
        `Injecting fault: ${scenario.faultConfiguration.type}`, 'warning');
      
      result.faultInjectionResult = await this.faultInjector.injectFault(
        scenario.faultConfiguration
      );

      // Phase 4: Monitor system behavior during fault
      const monitoringTask = this.startContinuousMonitoring(result, scenario.duration);

      // Phase 5: Wait for recovery or timeout
      const recoveryStartTime = Date.now();
      this.addObservation(result, 'recovery_started', 
        'Monitoring for automatic recovery', 'info');

      // Phase 6: Validate recovery mechanisms
      result.recoveryValidationResult = await this.recoveryValidator.validateRecovery(
        scenario.recoveryExpectations,
        result.faultInjectionResult
      );

      // Phase 7: Analyze MTTR and performance
      const recoveryEndTime = Date.now();
      result.mttrAnalysisResult = await this.mttrAnalyzer.analyzeRecovery(
        recoveryStartTime,
        recoveryEndTime,
        result.faultInjectionResult,
        result.recoveryValidationResult
      );

      // Phase 8: Stop monitoring
      await monitoringTask;
      await this.systemMonitor.stopMonitoring();

      // Phase 9: Generate summary
      result.summary = this.generateTestSummary(scenario, result);
      result.success = this.evaluateTestSuccess(scenario, result);

      this.addObservation(result, 'recovery_completed', 
        `Chaos scenario completed. Success: ${result.success}`, 
        result.success ? 'info' : 'error');

    } catch (error) {
      this.addObservation(result, 'recovery_completed', 
        `Chaos scenario failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        'critical');

      // Execute emergency rollback
      await this.executeEmergencyRollback(scenario, result);
      
      result.success = false;
      
    } finally {
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      
      this.runningScenarios.delete(scenario.id);
      
      // Clean up any remaining fault injection
      await this.faultInjector.cleanup();
      await this.systemMonitor.stopMonitoring();

      secureLog('info', 'Chaos engineering scenario completed', {
        scenario_id: scenario.id,
        success: result.success,
        duration: result.duration,
        mttr: result.mttrAnalysisResult.mttr || 0,
        observations: result.observations.length
      });

      this.emit('scenarioCompleted', result);
    }

    return result;
  }

  /**
   * Execute multiple scenarios in sequence
   */
  public async executeScenarioSuite(scenarios: ChaosScenario[]): Promise<ChaosTestResult[]> {
    const results: ChaosTestResult[] = [];
    
    secureLog('info', 'Starting chaos scenario suite', {
      total_scenarios: scenarios.length,
      scenario_ids: scenarios.map(s => s.id)
    });

    for (const scenario of scenarios) {
      try {
        // Allow system to stabilize between scenarios
        if (results.length > 0) {
          secureLog('info', 'Waiting for system stabilization between scenarios');
          await this.waitForSystemStabilization();
        }

        const result = await this.executeScenario(scenario);
        results.push(result);

        this.emit('scenarioSuiteProgress', {
          completed: results.length,
          total: scenarios.length,
          currentScenario: scenario.id,
          success: result.success
        });

      } catch (error) {
        secureLog('error', 'Scenario suite execution failed', {
          scenario_id: scenario.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // Continue with remaining scenarios unless critical failure
        if (scenario.severity === 'critical') {
          secureLog('error', 'Critical scenario failed, stopping suite execution');
          break;
        }
      }
    }

    this.emit('scenarioSuiteCompleted', {
      total: scenarios.length,
      completed: results.length,
      successful: results.filter(r => r.success).length,
      results
    });

    return results;
  }

  /**
   * Get status of running scenarios
   */
  public getRunningScenarios(): Map<string, ChaosTestResult> {
    return new Map(this.runningScenarios);
  }

  /**
   * Abort a running scenario
   */
  public async abortScenario(scenarioId: string): Promise<boolean> {
    const result = this.runningScenarios.get(scenarioId);
    
    if (!result) {
      return false;
    }

    secureLog('warn', 'Aborting chaos scenario', { scenario_id: scenarioId });

    this.addObservation(result, 'manual_intervention', 
      'Scenario aborted by user', 'warning');

    // Stop fault injection
    await this.faultInjector.cleanup();
    
    // Stop monitoring
    await this.systemMonitor.stopMonitoring();

    result.success = false;
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;

    this.runningScenarios.delete(scenarioId);
    
    this.emit('scenarioAborted', result);

    return true;
  }

  /**
   * Set safety mode
   */
  public setSafetyMode(enabled: boolean): void {
    this.safetyMode = enabled;
    secureLog('info', 'Chaos test runner safety mode changed', {
      safety_mode: enabled
    });
  }

  /**
   * Validate scenario safety
   */
  private validateScenarioSafety(scenario: ChaosScenario): boolean {
    // Check environment safety
    if (this.safetyMode && process.env.NODE_ENV === 'production') {
      secureLog('error', 'Chaos tests not allowed in production with safety mode enabled');
      return false;
    }

    // Validate safety checks
    for (const safetyCheck of scenario.safetyChecks) {
      if (!this.evaluateSafetyCheck(safetyCheck)) {
        secureLog('warn', 'Safety check failed', {
          scenario_id: scenario.id,
          safety_check: safetyCheck
        });
        return false;
      }
    }

    // Check scenario duration limits
    const maxDuration = parseInt(process.env.CHAOS_MAX_DURATION || '300000'); // 5 minutes default
    if (scenario.duration > maxDuration) {
      secureLog('error', 'Scenario duration exceeds safety limit', {
        scenario_id: scenario.id,
        duration: scenario.duration,
        max_duration: maxDuration
      });
      return false;
    }

    return true;
  }

  /**
   * Evaluate safety check
   */
  private evaluateSafetyCheck(check: string): boolean {
    switch (check) {
      case 'non_production_environment':
        return process.env.NODE_ENV !== 'production';
      
      case 'bridge_process_healthy':
        // Check if bridge process is responding
        return true; // Implement actual health check
      
      case 'no_critical_operations':
        // Check if any critical operations are in progress
        return true; // Implement actual check
      
      case 'monitoring_systems_active':
        // Verify monitoring systems are operational
        return true; // Implement actual check
      
      default:
        secureLog('warn', 'Unknown safety check', { check });
        return false;
    }
  }

  /**
   * Collect baseline metrics
   */
  private async collectBaselineMetrics(): Promise<SystemMetrics> {
    return await this.systemMonitor.collectMetrics();
  }

  /**
   * Start continuous monitoring during scenario
   */
  private async startContinuousMonitoring(
    result: ChaosTestResult, 
    duration: number
  ): Promise<void> {
    const interval = 1000; // 1 second intervals
    const endTime = Date.now() + duration;

    return new Promise((resolve) => {
      const monitoringInterval = setInterval(async () => {
        try {
          const metrics = await this.systemMonitor.collectMetrics();
          result.systemMetrics.push(metrics);

          // Check for critical conditions
          this.evaluateSystemHealth(result, metrics);

          if (Date.now() >= endTime) {
            clearInterval(monitoringInterval);
            resolve();
          }
        } catch (error) {
          secureLog('error', 'Monitoring error during chaos test', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }, interval);
    });
  }

  /**
   * Evaluate system health during testing
   */
  private evaluateSystemHealth(result: ChaosTestResult, metrics: SystemMetrics): void {
    // Check memory usage
    if (metrics.memoryUsage > 0.9) { // 90% memory usage
      this.addObservation(result, 'alert_triggered', 
        `High memory usage: ${(metrics.memoryUsage * 100).toFixed(1)}%`, 'warning');
    }

    // Check CPU usage
    if (metrics.cpuUsage > 0.85) { // 85% CPU usage
      this.addObservation(result, 'alert_triggered', 
        `High CPU usage: ${(metrics.cpuUsage * 100).toFixed(1)}%`, 'warning');
    }

    // Check response time
    if (metrics.responseTime > 10000) { // 10 second response time
      this.addObservation(result, 'system_degraded', 
        `High response time: ${metrics.responseTime}ms`, 'error');
    }

    // Check error rate
    if (metrics.errorRate > 0.5) { // 50% error rate
      this.addObservation(result, 'system_degraded', 
        `High error rate: ${(metrics.errorRate * 100).toFixed(1)}%`, 'error');
    }
  }

  /**
   * Wait for system stabilization
   */
  private async waitForSystemStabilization(): Promise<void> {
    const stabilizationTime = 30000; // 30 seconds
    const checkInterval = 5000; // 5 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < stabilizationTime) {
      const metrics = await this.systemMonitor.collectMetrics();
      
      // Check if system is stable
      if (this.isSystemStable(metrics)) {
        secureLog('info', 'System stabilized, ready for next scenario');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    secureLog('warn', 'System stabilization timeout reached');
  }

  /**
   * Check if system is stable
   */
  private isSystemStable(metrics: SystemMetrics): boolean {
    return metrics.memoryUsage < 0.7 && // Less than 70% memory
           metrics.cpuUsage < 0.5 && // Less than 50% CPU
           metrics.responseTime < 1000 && // Less than 1 second response
           metrics.errorRate < 0.01; // Less than 1% error rate
  }

  /**
   * Generate test summary
   */
  private generateTestSummary(
    scenario: ChaosScenario, 
    result: ChaosTestResult
  ): ChaosTestSummary {
    const faultStart = result.faultInjectionResult.startTime || result.startTime;
    const recoveryComplete = result.recoveryValidationResult.recoveryTime || result.endTime;
    
    return {
      scenarioName: scenario.name,
      faultDuration: result.faultInjectionResult.duration || 0,
      detectionTime: result.recoveryValidationResult.detectionTime || 0,
      recoveryTime: result.recoveryValidationResult.recoveryTime || 0,
      totalDowntime: recoveryComplete - faultStart,
      mttr: result.mttrAnalysisResult.mttr || 0,
      successRate: result.recoveryValidationResult.successRate || 0,
      impactAssessment: this.generateImpactAssessment(result),
      lessonsLearned: this.extractLessonsLearned(result),
      recommendedActions: this.generateRecommendedActions(scenario, result)
    };
  }

  /**
   * Generate impact assessment
   */
  private generateImpactAssessment(result: ChaosTestResult): string {
    const criticalObservations = result.observations.filter(o => o.severity === 'critical');
    const errorObservations = result.observations.filter(o => o.severity === 'error');
    
    if (criticalObservations.length > 0) {
      return 'CRITICAL: System experienced severe degradation with potential data loss';
    } else if (errorObservations.length > 3) {
      return 'HIGH: System experienced significant degradation affecting user experience';
    } else if (errorObservations.length > 0) {
      return 'MEDIUM: System experienced some degradation but maintained core functionality';
    } else {
      return 'LOW: System maintained normal operation with minimal impact';
    }
  }

  /**
   * Extract lessons learned
   */
  private extractLessonsLearned(result: ChaosTestResult): string[] {
    const lessons: string[] = [];
    
    // Analyze recovery performance
    if (result.mttrAnalysisResult.mttr > 60000) { // More than 1 minute
      lessons.push('Recovery time exceeds target - investigate faster detection mechanisms');
    }

    // Analyze error patterns
    const errorObservations = result.observations.filter(o => o.severity === 'error');
    if (errorObservations.length > 2) {
      lessons.push('Multiple error conditions observed - review error handling robustness');
    }

    // Analyze resource usage
    const highMemoryEvents = result.observations.filter(o => 
      o.description.includes('memory usage'));
    if (highMemoryEvents.length > 0) {
      lessons.push('Memory pressure detected during failure - optimize memory management');
    }

    return lessons;
  }

  /**
   * Generate recommended actions
   */
  private generateRecommendedActions(
    scenario: ChaosScenario, 
    result: ChaosTestResult
  ): string[] {
    const actions: string[] = [];

    if (!result.success) {
      actions.push('Investigate root cause of scenario failure');
      actions.push('Review and improve recovery mechanisms');
    }

    if (result.mttrAnalysisResult.mttr > scenario.recoveryExpectations.maxRecoveryTime) {
      actions.push('Optimize recovery time to meet SLA targets');
      actions.push('Implement faster failure detection mechanisms');
    }

    if (result.recoveryValidationResult.successRate < 
        scenario.recoveryExpectations.successCriteria.minimumSuccessRate) {
      actions.push('Improve system resilience and retry mechanisms');
    }

    return actions;
  }

  /**
   * Evaluate test success
   */
  private evaluateTestSuccess(scenario: ChaosScenario, result: ChaosTestResult): boolean {
    // Check if recovery was successful
    if (!result.recoveryValidationResult.success) {
      return false;
    }

    // Check if MTTR is within acceptable limits
    if (result.mttrAnalysisResult.mttr > scenario.recoveryExpectations.maxRecoveryTime) {
      return false;
    }

    // Check if success rate meets criteria
    if (result.recoveryValidationResult.successRate < 
        scenario.recoveryExpectations.successCriteria.minimumSuccessRate) {
      return false;
    }

    // Check for critical observations
    const criticalObservations = result.observations.filter(o => o.severity === 'critical');
    if (criticalObservations.length > 0) {
      return false;
    }

    return true;
  }

  /**
   * Execute emergency rollback
   */
  private async executeEmergencyRollback(
    scenario: ChaosScenario, 
    result: ChaosTestResult
  ): Promise<void> {
    secureLog('warn', 'Executing emergency rollback', {
      scenario_id: scenario.id
    });

    this.addObservation(result, 'manual_intervention', 
      'Emergency rollback initiated', 'critical');

    try {
      // Execute rollback plan
      for (const step of scenario.rollbackPlan) {
        await this.executeRollbackStep(step);
      }

      this.addObservation(result, 'recovery_completed', 
        'Emergency rollback completed', 'info');

    } catch (error) {
      this.addObservation(result, 'manual_intervention', 
        `Emergency rollback failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        'critical');
    }
  }

  /**
   * Execute rollback step
   */
  private async executeRollbackStep(step: string): Promise<void> {
    secureLog('info', 'Executing rollback step', { step });
    
    // Implementation would depend on specific rollback requirements
    // For now, just log the step
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Add observation to test result
   */
  private addObservation(
    result: ChaosTestResult,
    type: ChaosObservation['type'],
    description: string,
    severity: ChaosObservation['severity'],
    metrics?: Record<string, number>,
    context?: Record<string, any>
  ): void {
    result.observations.push({
      timestamp: Date.now(),
      type,
      description,
      severity,
      metrics,
      context
    });

    // Emit real-time observation for dashboard
    this.emit('observation', {
      scenarioId: result.scenarioId,
      observation: result.observations[result.observations.length - 1]
    });
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // Listen to fault injector events
    this.faultInjector.on('faultInjected', (data) => {
      this.emit('faultInjected', data);
    });

    this.faultInjector.on('faultRemoved', (data) => {
      this.emit('faultRemoved', data);
    });

    // Listen to recovery validator events
    this.recoveryValidator.on('recoveryDetected', (data) => {
      this.emit('recoveryDetected', data);
    });

    // Listen to system monitor events
    this.systemMonitor.on('alertTriggered', (data) => {
      this.emit('alertTriggered', data);
    });
  }
}
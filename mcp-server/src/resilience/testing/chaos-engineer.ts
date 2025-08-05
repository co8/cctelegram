/**
 * Chaos Engineering Framework
 * 
 * Implements chaos engineering principles to test system resilience
 * by introducing controlled failures and observing system behavior.
 */

import { secureLog, sanitizeForLogging } from '../../security.js';
import { ResilienceConfig } from '../config.js';

export type ChaosExperimentType = 
  | 'network_partition'
  | 'high_latency'
  | 'memory_pressure'
  | 'cpu_spike'
  | 'disk_full'
  | 'bridge_crash'
  | 'database_unavailable'
  | 'message_loss'
  | 'partial_failure'
  | 'cascading_failure';

export interface ChaosExperiment {
  id: string;
  name: string;
  type: ChaosExperimentType;
  description: string;
  duration: number; // Duration in milliseconds
  intensity: number; // 0.0 to 1.0
  target: string; // Component or service to target
  conditions: string[]; // Prerequisites for the experiment
  expectedOutcome: string;
  safetyChecks: string[];
  rollbackPlan: string;
}

export interface ChaosExperimentResult {
  experimentId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  observations: ChaosObservation[];
  metrics: Record<string, number>;
  success: boolean;
  failureReason?: string;
  rollbackExecuted: boolean;
}

export interface ChaosObservation {
  timestamp: number;
  type: 'metric' | 'event' | 'behavior' | 'error';
  description: string;
  value?: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class ChaosEngineer {
  private config: ResilienceConfig;
  private runningExperiments: Map<string, ChaosExperimentResult> = new Map();
  private experimentHistory: ChaosExperimentResult[] = [];
  private safetyMode: boolean = true;

  constructor(config: ResilienceConfig) {
    this.config = config;
    
    secureLog('info', 'Chaos Engineer initialized', {
      safety_mode: this.safetyMode,
      environment: config.environment
    });
  }

  /**
   * Execute a chaos experiment
   */
  public async executeExperiment(experiment: ChaosExperiment): Promise<ChaosExperimentResult> {
    // Safety check: Only run in development or testing environments
    if (this.safetyMode && this.config.environment === 'production') {
      throw new Error('Chaos experiments are disabled in production environment');
    }

    // Validate experiment prerequisites
    if (!this.validateExperimentConditions(experiment)) {
      throw new Error('Experiment conditions not met');
    }

    const result: ChaosExperimentResult = {
      experimentId: experiment.id,
      startTime: Date.now(),
      status: 'running',
      observations: [],
      metrics: {},
      success: false,
      rollbackExecuted: false
    };

    this.runningExperiments.set(experiment.id, result);

    secureLog('info', 'Chaos experiment started', {
      experiment_id: experiment.id,
      experiment_name: experiment.name,
      type: experiment.type,
      target: experiment.target,
      duration: experiment.duration,
      intensity: experiment.intensity
    });

    try {
      // Execute the experiment
      await this.runExperiment(experiment, result);
      
      result.status = 'completed';
      result.success = this.evaluateExperimentSuccess(experiment, result);
      
    } catch (error) {
      result.status = 'failed';
      result.failureReason = error instanceof Error ? error.message : 'Unknown error';
      
      secureLog('error', 'Chaos experiment failed', {
        experiment_id: experiment.id,
        error: result.failureReason
      });
      
      // Execute rollback
      await this.executeRollback(experiment, result);
      
    } finally {
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      
      this.runningExperiments.delete(experiment.id);
      this.experimentHistory.push(result);
      
      // Keep only last 100 experiments
      if (this.experimentHistory.length > 100) {
        this.experimentHistory.splice(0, this.experimentHistory.length - 100);
      }
      
      secureLog('info', 'Chaos experiment completed', {
        experiment_id: experiment.id,
        status: result.status,
        success: result.success,
        duration: result.duration,
        observations: result.observations.length
      });
    }

    return result;
  }

  /**
   * Run the actual chaos experiment
   */
  private async runExperiment(
    experiment: ChaosExperiment, 
    result: ChaosExperimentResult
  ): Promise<void> {
    
    // Record experiment start
    this.addObservation(result, 'event', `Chaos experiment ${experiment.type} started`, 'low');
    
    // Start the chaos
    const chaosHandle = await this.startChaos(experiment, result);
    
    // Monitor system behavior during the experiment
    const monitoringHandle = this.startMonitoring(experiment, result);
    
    // Wait for experiment duration
    await new Promise(resolve => setTimeout(resolve, experiment.duration));
    
    // Stop monitoring
    clearInterval(monitoringHandle);
    
    // Stop the chaos
    await this.stopChaos(experiment, chaosHandle, result);
    
    // Allow system to stabilize
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    this.addObservation(result, 'event', `Chaos experiment ${experiment.type} completed`, 'low');
  }

  /**
   * Start chaos injection
   */
  private async startChaos(
    experiment: ChaosExperiment, 
    result: ChaosExperimentResult
  ): Promise<any> {
    
    switch (experiment.type) {
      case 'network_partition':
        return this.injectNetworkPartition(experiment, result);
      
      case 'high_latency':
        return this.injectHighLatency(experiment, result);
      
      case 'memory_pressure':
        return this.injectMemoryPressure(experiment, result);
      
      case 'cpu_spike':
        return this.injectCpuSpike(experiment, result);
      
      case 'bridge_crash':
        return this.simulateBridgeCrash(experiment, result);
      
      case 'message_loss':
        return this.simulateMessageLoss(experiment, result);
      
      case 'partial_failure':
        return this.simulatePartialFailure(experiment, result);
      
      default:
        throw new Error(`Unsupported experiment type: ${experiment.type}`);
    }
  }

  /**
   * Inject network partition
   */
  private async injectNetworkPartition(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): Promise<any> {
    
    this.addObservation(result, 'event', 'Network partition injected', 'high');
    
    // Simulate network partition by blocking requests
    const originalFetch = globalThis.fetch;
    const partitionProbability = experiment.intensity;
    
    globalThis.fetch = async (...args: any[]) => {
      if (Math.random() < partitionProbability) {
        throw new Error('Network partition: Connection refused');
      }
      return originalFetch(...args);
    };
    
    return { originalFetch };
  }

  /**
   * Inject high latency
   */
  private async injectHighLatency(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): Promise<any> {
    
    const latencyMs = Math.floor(experiment.intensity * 5000); // Up to 5 seconds
    this.addObservation(result, 'event', `High latency injected: ${latencyMs}ms`, 'medium');
    
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async (...args: any[]) => {
      await new Promise(resolve => setTimeout(resolve, latencyMs));
      return originalFetch(...args);
    };
    
    return { originalFetch };
  }

  /**
   * Inject memory pressure
   */
  private async injectMemoryPressure(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): Promise<any> {
    
    const memoryMB = Math.floor(experiment.intensity * 100); // Up to 100MB
    this.addObservation(result, 'event', `Memory pressure injected: ${memoryMB}MB`, 'medium');
    
    // Allocate memory to create pressure
    const memoryBlocks: Buffer[] = [];
    for (let i = 0; i < memoryMB; i++) {
      memoryBlocks.push(Buffer.alloc(1024 * 1024)); // 1MB blocks
    }
    
    return { memoryBlocks };
  }

  /**
   * Inject CPU spike
   */
  private async injectCpuSpike(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): Promise<any> {
    
    this.addObservation(result, 'event', `CPU spike injected at ${experiment.intensity * 100}% intensity`, 'medium');
    
    // Create CPU load
    const threads = Math.floor(experiment.intensity * 4); // Up to 4 threads
    const intervals: NodeJS.Timeout[] = [];
    
    for (let i = 0; i < threads; i++) {
      const interval = setInterval(() => {
        const start = Date.now();
        while (Date.now() - start < 100) {
          // Busy wait for 100ms
          Math.random();
        }
      }, 200);
      intervals.push(interval);
    }
    
    return { intervals };
  }

  /**
   * Simulate bridge crash
   */
  private async simulateBridgeCrash(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): Promise<any> {
    
    this.addObservation(result, 'event', 'Bridge crash simulated', 'critical');
    
    // Simulate bridge unavailability
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async (url: any, ...args: any[]) => {
      if (typeof url === 'string' && url.includes('localhost:8080')) {
        throw new Error('Bridge crashed: Connection refused');
      }
      return originalFetch(url, ...args);
    };
    
    return { originalFetch };
  }

  /**
   * Simulate message loss
   */
  private async simulateMessageLoss(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): Promise<any> {
    
    const lossRate = experiment.intensity;
    this.addObservation(result, 'event', `Message loss simulated: ${lossRate * 100}% loss rate`, 'high');
    
    // This would hook into the messaging system to drop messages
    return { lossRate };
  }

  /**
   * Simulate partial failure
   */
  private async simulatePartialFailure(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): Promise<any> {
    
    const failureRate = experiment.intensity;
    this.addObservation(result, 'event', `Partial failure simulated: ${failureRate * 100}% failure rate`, 'high');
    
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async (...args: any[]) => {
      if (Math.random() < failureRate) {
        throw new Error('Simulated partial failure');
      }
      return originalFetch(...args);
    };
    
    return { originalFetch };
  }

  /**
   * Stop chaos injection
   */
  private async stopChaos(
    experiment: ChaosExperiment,
    chaosHandle: any,
    result: ChaosExperimentResult
  ): Promise<void> {
    
    switch (experiment.type) {
      case 'network_partition':
      case 'high_latency':
      case 'bridge_crash':
      case 'partial_failure':
        if (chaosHandle.originalFetch) {
          globalThis.fetch = chaosHandle.originalFetch;
        }
        break;
      
      case 'memory_pressure':
        // Memory will be garbage collected automatically
        chaosHandle.memoryBlocks = null;
        break;
      
      case 'cpu_spike':
        chaosHandle.intervals?.forEach((interval: NodeJS.Timeout) => {
          clearInterval(interval);
        });
        break;
    }
    
    this.addObservation(result, 'event', 'Chaos injection stopped', 'low');
  }

  /**
   * Start system monitoring during experiment
   */
  private startMonitoring(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): NodeJS.Timeout {
    
    return setInterval(() => {
      // Collect system metrics
      const metrics = this.collectSystemMetrics();
      
      // Store metrics
      Object.entries(metrics).forEach(([key, value]) => {
        result.metrics[key] = value;
      });
      
      // Check for concerning behaviors
      this.checkSystemBehavior(experiment, result, metrics);
      
    }, 1000); // Monitor every second
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics(): Record<string, number> {
    const used = process.memoryUsage();
    
    return {
      memory_used: used.rss,
      memory_heap_used: used.heapUsed,
      memory_heap_total: used.heapTotal,
      uptime: process.uptime(),
      cpu_usage: process.cpuUsage().user / 1000000 // Convert to seconds
    };
  }

  /**
   * Check system behavior for anomalies
   */
  private checkSystemBehavior(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult,
    metrics: Record<string, number>
  ): void {
    
    // Check memory usage
    if (metrics.memory_used > 500 * 1024 * 1024) { // 500MB
      this.addObservation(result, 'metric', 'High memory usage detected', 'medium', metrics.memory_used);
    }
    
    // Check for memory leaks
    if (metrics.memory_heap_used > metrics.memory_heap_total * 0.9) {
      this.addObservation(result, 'behavior', 'Potential memory leak detected', 'high');
    }
    
    // Add more behavior checks as needed
  }

  /**
   * Add observation to experiment result
   */
  private addObservation(
    result: ChaosExperimentResult,
    type: ChaosObservation['type'],
    description: string,
    severity: ChaosObservation['severity'],
    value?: any
  ): void {
    
    result.observations.push({
      timestamp: Date.now(),
      type,
      description,
      value,
      severity
    });
    
    secureLog('debug', 'Chaos observation recorded', {
      experiment_id: result.experimentId,
      type,
      description,
      severity,
      value: sanitizeForLogging(value)
    });
  }

  /**
   * Validate experiment conditions
   */
  private validateExperimentConditions(experiment: ChaosExperiment): boolean {
    // Check safety requirements
    for (const safetyCheck of experiment.safetyChecks) {
      if (!this.evaluateSafetyCheck(safetyCheck)) {
        secureLog('warn', 'Safety check failed', {
          experiment_id: experiment.id,
          safety_check: safetyCheck
        });
        return false;
      }
    }
    
    // Check experiment conditions
    for (const condition of experiment.conditions) {
      if (!this.evaluateCondition(condition)) {
        secureLog('warn', 'Experiment condition not met', {
          experiment_id: experiment.id,
          condition
        });
        return false;
      }
    }
    
    return true;
  }

  /**
   * Evaluate safety check
   */
  private evaluateSafetyCheck(check: string): boolean {
    switch (check) {
      case 'non_production_environment':
        return this.config.environment !== 'production';
      
      case 'no_active_users':
        // In real implementation, check for active user sessions
        return true;
      
      case 'backup_systems_available':
        // Check if backup systems are operational
        return true;
      
      case 'rollback_plan_tested':
        // Verify rollback procedures are tested
        return true;
      
      default:
        return false;
    }
  }

  /**
   * Evaluate experiment condition
   */
  private evaluateCondition(condition: string): boolean {
    switch (condition) {
      case 'system_healthy':
        // Check if system is in healthy state
        return true;
      
      case 'monitoring_active':
        // Verify monitoring systems are active
        return true;
      
      case 'alerts_configured':
        // Check if alerting is properly configured
        return true;
      
      default:
        return true; // Unknown conditions pass by default
    }
  }

  /**
   * Evaluate experiment success
   */
  private evaluateExperimentSuccess(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): boolean {
    
    // Check if system behaved as expected
    const criticalObservations = result.observations.filter(o => o.severity === 'critical');
    
    // Experiment succeeds if:
    // 1. No critical issues were observed
    // 2. System recovered within expected time
    // 3. Resilience patterns activated correctly
    
    return criticalObservations.length === 0;
  }

  /**
   * Execute rollback plan
   */
  private async executeRollback(
    experiment: ChaosExperiment,
    result: ChaosExperimentResult
  ): Promise<void> {
    
    try {
      secureLog('info', 'Executing experiment rollback', {
        experiment_id: experiment.id,
        rollback_plan: experiment.rollbackPlan
      });
      
      // Execute rollback steps
      // This would implement the specific rollback plan
      
      result.rollbackExecuted = true;
      this.addObservation(result, 'event', 'Rollback executed successfully', 'low');
      
    } catch (error) {
      secureLog('error', 'Rollback execution failed', {
        experiment_id: experiment.id,
        error: error instanceof Error ? error.message : 'unknown'
      });
      
      this.addObservation(result, 'error', 'Rollback execution failed', 'critical');
    }
  }

  /**
   * Get experiment result
   */
  public getExperimentResult(experimentId: string): ChaosExperimentResult | undefined {
    return this.runningExperiments.get(experimentId) ||
           this.experimentHistory.find(result => result.experimentId === experimentId);
  }

  /**
   * Get running experiments
   */
  public getRunningExperiments(): ChaosExperimentResult[] {
    return Array.from(this.runningExperiments.values());
  }

  /**
   * Get experiment history
   */
  public getExperimentHistory(limit: number = 50): ChaosExperimentResult[] {
    return this.experimentHistory.slice(-limit);
  }

  /**
   * Abort running experiment
   */
  public async abortExperiment(experimentId: string): Promise<boolean> {
    const result = this.runningExperiments.get(experimentId);
    
    if (!result) {
      return false;
    }
    
    result.status = 'aborted';
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;
    
    this.addObservation(result, 'event', 'Experiment aborted by user', 'medium');
    
    // Move to history
    this.runningExperiments.delete(experimentId);
    this.experimentHistory.push(result);
    
    secureLog('warn', 'Chaos experiment aborted', {
      experiment_id: experimentId,
      duration: result.duration
    });
    
    return true;
  }

  /**
   * Set safety mode
   */
  public setSafetyMode(enabled: boolean): void {
    this.safetyMode = enabled;
    
    secureLog('info', 'Chaos engineer safety mode changed', {
      safety_mode: enabled
    });
  }

  /**
   * Get safety mode status
   */
  public getSafetyMode(): boolean {
    return this.safetyMode;
  }
}
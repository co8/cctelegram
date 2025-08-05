/**
 * Chaos Monkey Lambda Integration
 * 
 * Implementation for AWS Lambda function chaos engineering.
 * Provides fault injection for serverless functions including timeouts,
 * memory exhaustion, cold starts, and error injection.
 */

import { EventEmitter } from 'events';
import AWS from 'aws-sdk';
import { secureLog } from '../../../src/security.js';

export interface LambdaChaosConfig {
  region: string;
  profile?: string;
  enabledFunctions: string[];
  chaosPercent: number; // Percentage of invocations to inject chaos
  defaultTimeoutMs: number;
  enableCloudWatchIntegration: boolean;
}

export interface LambdaFaultConfig {
  type: 'timeout' | 'memory_exhaustion' | 'cold_start' | 'error_injection' | 'throttling';
  intensity: number; // 0.0 to 1.0
  duration?: number; // Duration in milliseconds
  targetFunction?: string;
  parameters: Record<string, any>;
}

export interface LambdaChaosResult {
  chaosId: string;
  functionName: string;
  faultType: string;
  startTime: number;
  endTime: number;
  duration: number;
  invocationsAffected: number;
  errorsInjected: number;
  success: boolean;
  metrics: LambdaChaosMetrics;
  observations: LambdaChaosObservation[];
}

export interface LambdaChaosMetrics {
  totalInvocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  averageExecutionTime: number;
  coldStarts: number;
  timeouts: number;
  memoryExhaustion: number;
  throttling: number;
  costImpact: number; // Estimated cost impact in USD
}

export interface LambdaChaosObservation {
  timestamp: number;
  type: 'fault_injected' | 'timeout_triggered' | 'cold_start_detected' | 'error_thrown' | 'recovery_detected';
  functionName: string;
  invocationId: string;
  details: string;
  severity: 'info' | 'warning' | 'error';
  metrics?: Record<string, number>;
}

export class ChaosMonkeyLambda extends EventEmitter {
  private config: LambdaChaosConfig;
  private lambda: AWS.Lambda;
  private cloudWatch: AWS.CloudWatch;
  private activeChaos: Map<string, LambdaChaosResult> = new Map();
  private isInitialized: boolean = false;

  constructor(config?: Partial<LambdaChaosConfig>) {
    super();
    
    this.config = {
      region: process.env.AWS_REGION || 'us-east-1',
      profile: process.env.AWS_PROFILE,
      enabledFunctions: [],
      chaosPercent: 10, // 10% of invocations
      defaultTimeoutMs: 30000,
      enableCloudWatchIntegration: true,
      ...config
    };

    // Initialize AWS SDK
    AWS.config.update({ 
      region: this.config.region,
      profile: this.config.profile 
    });

    this.lambda = new AWS.Lambda();
    this.cloudWatch = new AWS.CloudWatch();
  }

  /**
   * Initialize chaos monkey
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    secureLog('info', 'Initializing Chaos Monkey Lambda', {
      region: this.config.region,
      enabled_functions: this.config.enabledFunctions.length,
      chaos_percent: this.config.chaosPercent
    });

    try {
      // Validate AWS credentials and permissions
      await this.validatePermissions();
      
      // Discover Lambda functions if none specified
      if (this.config.enabledFunctions.length === 0) {
        await this.discoverFunctions();
      }

      // Validate target functions exist
      await this.validateFunctions();

      this.isInitialized = true;
      this.emit('initialized');

      secureLog('info', 'Chaos Monkey Lambda initialized successfully', {
        functions_discovered: this.config.enabledFunctions.length
      });

    } catch (error) {
      throw new Error(`Failed to initialize Chaos Monkey Lambda: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject fault into Lambda functions
   */
  public async injectFault(faultConfig: LambdaFaultConfig): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Chaos Monkey Lambda not initialized');
    }

    const chaosId = `chaos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const targetFunction = faultConfig.targetFunction || this.selectRandomFunction();

    const result: LambdaChaosResult = {
      chaosId,
      functionName: targetFunction,
      faultType: faultConfig.type,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      invocationsAffected: 0,
      errorsInjected: 0,
      success: false,
      metrics: {
        totalInvocations: 0,
        successfulInvocations: 0,
        failedInvocations: 0,
        averageExecutionTime: 0,
        coldStarts: 0,
        timeouts: 0,
        memoryExhaustion: 0,
        throttling: 0,
        costImpact: 0
      },
      observations: []
    };

    this.activeChaos.set(chaosId, result);

    secureLog('info', 'Injecting Lambda fault', {
      chaos_id: chaosId,
      function_name: targetFunction,
      fault_type: faultConfig.type,
      intensity: faultConfig.intensity
    });

    try {
      await this.performFaultInjection(faultConfig, result);
      
      // Monitor for specified duration
      if (faultConfig.duration) {
        await this.monitorChaosExecution(chaosId, faultConfig.duration);
      }

      result.success = true;
      this.addObservation(result, 'recovery_detected', targetFunction, '', 
        'Fault injection completed successfully', 'info');

    } catch (error) {
      this.addObservation(result, 'error_thrown', targetFunction, '', 
        `Fault injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      
      result.success = false;
    } finally {
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      
      this.emit('chaosCompleted', result);
    }

    return chaosId;
  }

  /**
   * Perform specific fault injection
   */
  private async performFaultInjection(
    faultConfig: LambdaFaultConfig, 
    result: LambdaChaosResult
  ): Promise<void> {
    
    switch (faultConfig.type) {
      case 'timeout':
        await this.injectTimeouts(faultConfig, result);
        break;
        
      case 'memory_exhaustion':
        await this.injectMemoryExhaustion(faultConfig, result);
        break;
        
      case 'cold_start':
        await this.injectColdStarts(faultConfig, result);
        break;
        
      case 'error_injection':
        await this.injectErrors(faultConfig, result);
        break;
        
      case 'throttling':
        await this.injectThrottling(faultConfig, result);
        break;
        
      default:
        throw new Error(`Unsupported fault type: ${faultConfig.type}`);
    }
  }

  /**
   * Inject timeout faults
   */
  private async injectTimeouts(
    faultConfig: LambdaFaultConfig, 
    result: LambdaChaosResult
  ): Promise<void> {
    
    const timeoutDuration = Math.floor(faultConfig.intensity * (faultConfig.parameters.maxTimeout || 30000));
    
    this.addObservation(result, 'fault_injected', result.functionName, '', 
      `Injecting ${timeoutDuration}ms timeouts`, 'warning');

    // Update function configuration to set lower timeout
    try {
      const currentConfig = await this.lambda.getFunctionConfiguration({
        FunctionName: result.functionName
      }).promise();

      const originalTimeout = currentConfig.Timeout || 30;
      const newTimeout = Math.min(originalTimeout, Math.floor(timeoutDuration / 1000));

      await this.lambda.updateFunctionConfiguration({
        FunctionName: result.functionName,
        Timeout: newTimeout
      }).promise();

      this.addObservation(result, 'timeout_triggered', result.functionName, '', 
        `Function timeout reduced from ${originalTimeout}s to ${newTimeout}s`, 'warning');

      result.metrics.timeouts++;

      // Restore original timeout after duration
      if (faultConfig.duration) {
        setTimeout(async () => {
          try {
            await this.lambda.updateFunctionConfiguration({
              FunctionName: result.functionName,
              Timeout: originalTimeout
            }).promise();

            this.addObservation(result, 'recovery_detected', result.functionName, '', 
              `Function timeout restored to ${originalTimeout}s`, 'info');

          } catch (error) {
            secureLog('error', 'Failed to restore function timeout', {
              function_name: result.functionName,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }, faultConfig.duration);
      }

    } catch (error) {
      throw new Error(`Failed to inject timeouts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject memory exhaustion faults
   */
  private async injectMemoryExhaustion(
    faultConfig: LambdaFaultConfig, 
    result: LambdaChaosResult
  ): Promise<void> {
    
    this.addObservation(result, 'fault_injected', result.functionName, '', 
      'Injecting memory exhaustion via payload', 'warning');

    try {
      const currentConfig = await this.lambda.getFunctionConfiguration({
        FunctionName: result.functionName
      }).promise();

      const memorySize = currentConfig.MemorySize || 128;
      const exhaustionIntensity = faultConfig.intensity;

      // Create memory-intensive payload
      const memoryPayload = {
        chaosType: 'memory_exhaustion',
        intensity: exhaustionIntensity,
        allocateMemoryMB: Math.floor(memorySize * exhaustionIntensity),
        pattern: 'gradual_increase',
        metadata: {
          originalMemorySize: memorySize,
          chaosId: result.chaosId
        }
      };

      // Invoke function with memory-intensive payload
      const invocationResult = await this.lambda.invoke({
        FunctionName: result.functionName,
        InvocationType: 'Event', // Async to avoid blocking
        Payload: JSON.stringify(memoryPayload)
      }).promise();

      this.addObservation(result, 'fault_injected', result.functionName, 
        invocationResult.Payload?.toString() || '', 
        'Memory exhaustion payload sent', 'warning');

      result.metrics.memoryExhaustion++;
      result.invocationsAffected++;

    } catch (error) {
      throw new Error(`Failed to inject memory exhaustion: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject cold start faults
   */
  private async injectColdStarts(
    faultConfig: LambdaFaultConfig, 
    result: LambdaChaosResult
  ): Promise<void> {
    
    this.addObservation(result, 'fault_injected', result.functionName, '', 
      'Injecting cold starts by updating function', 'warning');

    try {
      // Force cold starts by updating function configuration
      const currentConfig = await this.lambda.getFunctionConfiguration({
        FunctionName: result.functionName
      }).promise();

      const originalDescription = currentConfig.Description || '';
      const coldStartDescription = `${originalDescription} [CHAOS: Cold Start ${Date.now()}]`;

      // Update description to force cold start
      await this.lambda.updateFunctionConfiguration({
        FunctionName: result.functionName,
        Description: coldStartDescription
      }).promise();

      this.addObservation(result, 'cold_start_detected', result.functionName, '', 
        'Function configuration updated to force cold start', 'warning');

      result.metrics.coldStarts++;

      // Trigger multiple invocations to measure cold start impact
      const invocationPromises = [];
      const invocationCount = Math.ceil(faultConfig.intensity * 10); // Up to 10 invocations

      for (let i = 0; i < invocationCount; i++) {
        invocationPromises.push(
          this.lambda.invoke({
            FunctionName: result.functionName,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({
              chaosType: 'cold_start_measurement',
              invocationNumber: i + 1,
              chaosId: result.chaosId
            })
          }).promise()
        );
      }

      const invocationResults = await Promise.allSettled(invocationPromises);
      
      result.invocationsAffected += invocationResults.length;
      result.metrics.totalInvocations += invocationResults.length;

      invocationResults.forEach((invocationResult, index) => {
        if (invocationResult.status === 'fulfilled') {
          result.metrics.successfulInvocations++;
        } else {
          result.metrics.failedInvocations++;
          this.addObservation(result, 'error_thrown', result.functionName, '', 
            `Cold start invocation ${index + 1} failed: ${invocationResult.reason}`, 'error');
        }
      });

      // Restore original description
      setTimeout(async () => {
        try {
          await this.lambda.updateFunctionConfiguration({
            FunctionName: result.functionName,
            Description: originalDescription
          }).promise();

          this.addObservation(result, 'recovery_detected', result.functionName, '', 
            'Function description restored', 'info');

        } catch (error) {
          secureLog('error', 'Failed to restore function description', {
            function_name: result.functionName,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }, faultConfig.duration || 60000);

    } catch (error) {
      throw new Error(`Failed to inject cold starts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject error faults
   */
  private async injectErrors(
    faultConfig: LambdaFaultConfig, 
    result: LambdaChaosResult
  ): Promise<void> {
    
    const errorRate = faultConfig.intensity;
    const invocationCount = faultConfig.parameters.invocations || 10;
    const errorType = faultConfig.parameters.errorType || 'runtime_error';

    this.addObservation(result, 'fault_injected', result.functionName, '', 
      `Injecting ${errorRate * 100}% error rate over ${invocationCount} invocations`, 'warning');

    try {
      const invocationPromises = [];

      for (let i = 0; i < invocationCount; i++) {
        const shouldInjectError = Math.random() < errorRate;
        
        const payload = {
          chaosType: 'error_injection',
          injectError: shouldInjectError,
          errorType: errorType,
          invocationNumber: i + 1,
          chaosId: result.chaosId,
          errorDetails: {
            message: faultConfig.parameters.errorMessage || 'Chaos Monkey injected error',
            code: faultConfig.parameters.errorCode || 'CHAOS_ERROR',
            retryable: faultConfig.parameters.retryable || false
          }
        };

        invocationPromises.push(
          this.lambda.invoke({
            FunctionName: result.functionName,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify(payload)
          }).promise()
        );

        if (shouldInjectError) {
          result.errorsInjected++;
        }
      }

      const invocationResults = await Promise.allSettled(invocationPromises);
      
      result.invocationsAffected += invocationResults.length;
      result.metrics.totalInvocations += invocationResults.length;

      invocationResults.forEach((invocationResult, index) => {
        if (invocationResult.status === 'fulfilled') {
          result.metrics.successfulInvocations++;
        } else {
          result.metrics.failedInvocations++;
          this.addObservation(result, 'error_thrown', result.functionName, '', 
            `Error injection invocation ${index + 1} failed: ${invocationResult.reason}`, 'error');
        }
      });

    } catch (error) {
      throw new Error(`Failed to inject errors: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject throttling faults
   */
  private async injectThrottling(
    faultConfig: LambdaFaultConfig, 
    result: LambdaChaosResult
  ): Promise<void> {
    
    const concurrentInvocations = Math.ceil(faultConfig.intensity * 100); // Up to 100 concurrent invocations
    
    this.addObservation(result, 'fault_injected', result.functionName, '', 
      `Injecting throttling with ${concurrentInvocations} concurrent invocations`, 'warning');

    try {
      // Launch many concurrent invocations to trigger throttling
      const invocationPromises = [];

      for (let i = 0; i < concurrentInvocations; i++) {
        invocationPromises.push(
          this.lambda.invoke({
            FunctionName: result.functionName,
            InvocationType: 'Event', // Async to maximize concurrency
            Payload: JSON.stringify({
              chaosType: 'throttling_test',
              invocationNumber: i + 1,
              chaosId: result.chaosId
            })
          }).promise()
        );
      }

      const invocationResults = await Promise.allSettled(invocationPromises);
      
      result.invocationsAffected += invocationResults.length;
      result.metrics.totalInvocations += invocationResults.length;

      let throttlingDetected = 0;

      invocationResults.forEach((invocationResult, index) => {
        if (invocationResult.status === 'fulfilled') {
          result.metrics.successfulInvocations++;
        } else {
          result.metrics.failedInvocations++;
          
          // Check if error is due to throttling
          const error = invocationResult.reason;
          if (error && error.code === 'TooManyRequestsException') {
            throttlingDetected++;
            result.metrics.throttling++;
          }

          this.addObservation(result, 'error_thrown', result.functionName, '', 
            `Throttling invocation ${index + 1} failed: ${error}`, 'warning');
        }
      });

      if (throttlingDetected > 0) {
        this.addObservation(result, 'fault_injected', result.functionName, '', 
          `Throttling detected in ${throttlingDetected} invocations`, 'warning');
      }

    } catch (error) {
      throw new Error(`Failed to inject throttling: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Monitor chaos execution
   */
  private async monitorChaosExecution(chaosId: string, duration: number): Promise<void> {
    const result = this.activeChaos.get(chaosId);
    if (!result) {
      return;
    }

    const monitoringInterval = Math.min(5000, duration / 10); // Monitor every 5s or 1/10th of duration
    const endTime = Date.now() + duration;

    while (Date.now() < endTime) {
      try {
        // Collect CloudWatch metrics if enabled
        if (this.config.enableCloudWatchIntegration) {
          await this.collectCloudWatchMetrics(result);
        }

        // Emit monitoring event
        this.emit('chaosMonitoring', {
          chaosId,
          progress: (Date.now() - result.startTime) / duration,
          metrics: result.metrics
        });

      } catch (error) {
        secureLog('error', 'Error during chaos monitoring', {
          chaos_id: chaosId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      await new Promise(resolve => setTimeout(resolve, monitoringInterval));
    }
  }

  /**
   * Collect CloudWatch metrics
   */
  private async collectCloudWatchMetrics(result: LambdaChaosResult): Promise<void> {
    try {
      const endTime = new Date();
      const startTime = new Date(result.startTime);

      const metricsPromises = [
        this.cloudWatch.getMetricStatistics({
          Namespace: 'AWS/Lambda',
          MetricName: 'Invocations',
          Dimensions: [{ Name: 'FunctionName', Value: result.functionName }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 300,
          Statistics: ['Sum']
        }).promise(),

        this.cloudWatch.getMetricStatistics({
          Namespace: 'AWS/Lambda',
          MetricName: 'Errors',
          Dimensions: [{ Name: 'FunctionName', Value: result.functionName }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 300,
          Statistics: ['Sum']
        }).promise(),

        this.cloudWatch.getMetricStatistics({
          Namespace: 'AWS/Lambda',
          MetricName: 'Duration',
          Dimensions: [{ Name: 'FunctionName', Value: result.functionName }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 300,
          Statistics: ['Average']
        }).promise()
      ];

      const [invocations, errors, duration] = await Promise.all(metricsPromises);

      // Update metrics with CloudWatch data
      if (invocations.Datapoints && invocations.Datapoints.length > 0) {
        const totalInvocations = invocations.Datapoints.reduce((sum, dp) => sum + (dp.Sum || 0), 0);
        result.metrics.totalInvocations = Math.max(result.metrics.totalInvocations, totalInvocations);
      }

      if (errors.Datapoints && errors.Datapoints.length > 0) {
        const totalErrors = errors.Datapoints.reduce((sum, dp) => sum + (dp.Sum || 0), 0);
        result.metrics.failedInvocations = Math.max(result.metrics.failedInvocations, totalErrors);
      }

      if (duration.Datapoints && duration.Datapoints.length > 0) {
        const avgDuration = duration.Datapoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) / duration.Datapoints.length;
        result.metrics.averageExecutionTime = avgDuration;
      }

      // Calculate cost impact (simplified estimate)
      const executionCost = result.metrics.totalInvocations * 0.0000002; // $0.20 per 1M requests
      const durationCost = (result.metrics.averageExecutionTime * result.metrics.totalInvocations / 1000) * 0.0000166667; // GB-second pricing
      result.metrics.costImpact = executionCost + durationCost;

    } catch (error) {
      secureLog('warn', 'Failed to collect CloudWatch metrics', {
        function_name: result.functionName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Stop chaos injection
   */
  public async stopChaos(chaosId: string): Promise<boolean> {
    const result = this.activeChaos.get(chaosId);
    if (!result) {
      return false;
    }

    this.addObservation(result, 'recovery_detected', result.functionName, '', 
      'Chaos injection stopped manually', 'info');

    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;

    this.activeChaos.delete(chaosId);
    this.emit('chaosStopped', result);

    return true;
  }

  /**
   * Get chaos results
   */
  public getChaosResults(chaosId: string): LambdaChaosResult | null {
    return this.activeChaos.get(chaosId) || null;
  }

  /**
   * List active chaos experiments
   */
  public getActiveChaos(): Map<string, LambdaChaosResult> {
    return new Map(this.activeChaos);
  }

  /**
   * Validate AWS permissions
   */
  private async validatePermissions(): Promise<void> {
    try {
      await this.lambda.listFunctions({ MaxItems: 1 }).promise();
      
      if (this.config.enableCloudWatchIntegration) {
        await this.cloudWatch.listMetrics({ MaxRecords: 1 }).promise();
      }
      
    } catch (error) {
      throw new Error(`AWS permissions validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Discover Lambda functions
   */
  private async discoverFunctions(): Promise<void> {
    try {
      const response = await this.lambda.listFunctions().promise();
      
      this.config.enabledFunctions = response.Functions?.map(func => func.FunctionName || '') || [];
      
      secureLog('info', 'Discovered Lambda functions', {
        function_count: this.config.enabledFunctions.length,
        functions: this.config.enabledFunctions.slice(0, 5) // Log first 5 for brevity
      });
      
    } catch (error) {
      throw new Error(`Function discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate target functions exist
   */
  private async validateFunctions(): Promise<void> {
    const validationPromises = this.config.enabledFunctions.map(async functionName => {
      try {
        await this.lambda.getFunctionConfiguration({ FunctionName: functionName }).promise();
        return { functionName, valid: true };
      } catch (error) {
        return { functionName, valid: false, error };
      }
    });

    const validationResults = await Promise.all(validationPromises);
    const invalidFunctions = validationResults.filter(result => !result.valid);

    if (invalidFunctions.length > 0) {
      secureLog('warn', 'Some target functions are invalid', {
        invalid_functions: invalidFunctions.map(f => f.functionName)
      });
      
      // Remove invalid functions from enabled list
      this.config.enabledFunctions = validationResults
        .filter(result => result.valid)
        .map(result => result.functionName);
    }

    if (this.config.enabledFunctions.length === 0) {
      throw new Error('No valid Lambda functions found for chaos testing');
    }
  }

  /**
   * Select random function for chaos
   */
  private selectRandomFunction(): string {
    if (this.config.enabledFunctions.length === 0) {
      throw new Error('No enabled functions available for chaos');
    }

    const randomIndex = Math.floor(Math.random() * this.config.enabledFunctions.length);
    return this.config.enabledFunctions[randomIndex];
  }

  /**
   * Add observation to chaos result
   */
  private addObservation(
    result: LambdaChaosResult,
    type: LambdaChaosObservation['type'],
    functionName: string,
    invocationId: string,
    details: string,
    severity: LambdaChaosObservation['severity'],
    metrics?: Record<string, number>
  ): void {
    
    result.observations.push({
      timestamp: Date.now(),
      type,
      functionName,
      invocationId,
      details,
      severity,
      metrics
    });

    // Emit real-time observation
    this.emit('chaosObservation', {
      chaosId: result.chaosId,
      observation: result.observations[result.observations.length - 1]
    });
  }

  /**
   * Get health status
   */
  public async getHealthStatus(): Promise<{
    healthy: boolean;
    functionsEnabled: number;
    activeChaos: number;
    error?: string;
  }> {
    try {
      if (!this.isInitialized) {
        return {
          healthy: false,
          functionsEnabled: 0,
          activeChaos: 0,
          error: 'Chaos Monkey Lambda not initialized'
        };
      }

      return {
        healthy: true,
        functionsEnabled: this.config.enabledFunctions.length,
        activeChaos: this.activeChaos.size
      };

    } catch (error) {
      return {
        healthy: false,
        functionsEnabled: this.config.enabledFunctions.length,
        activeChaos: this.activeChaos.size,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Cleanup and shutdown
   */
  public async shutdown(): Promise<void> {
    secureLog('info', 'Shutting down Chaos Monkey Lambda', {
      active_chaos: this.activeChaos.size
    });

    // Stop all active chaos experiments
    const stopPromises = Array.from(this.activeChaos.keys()).map(chaosId =>
      this.stopChaos(chaosId)
    );

    await Promise.allSettled(stopPromises);

    this.activeChaos.clear();
    this.isInitialized = false;

    this.emit('shutdown');
    secureLog('info', 'Chaos Monkey Lambda shutdown completed');
  }

  /**
   * Get configuration
   */
  public getConfig(): LambdaChaosConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<LambdaChaosConfig>): void {
    this.config = { ...this.config, ...newConfig };
    secureLog('info', 'Chaos Monkey Lambda configuration updated', newConfig);
  }
}
/**
 * Fault Injector
 * 
 * Core fault injection engine supporting multiple fault types
 * including network failures, service crashes, and resource constraints.
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import { spawn, ChildProcess } from 'child_process';
import Dockerode from 'dockerode';
import { ToxiproxyClient } from 'toxiproxy-node';
import { secureLog } from '../../../src/security.js';

export interface FaultConfiguration {
  type: 'network_partition' | 'high_latency' | 'bandwidth_limit' | 'service_crash' | 
        'resource_exhaustion' | 'data_corruption' | 'cascading_failure' | 'lambda_chaos';
  intensity: number; // 0.0 to 1.0
  target: string; // Component or service to target
  parameters: Record<string, any>;
  gradualRampUp?: boolean;
  rampUpDuration?: number;
}

export interface FaultInjectionResult {
  faultId: string;
  type: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  target: string;
  intensity: number;
  injectionMethod: string;
  rollbackExecuted: boolean;
  artifacts: FaultArtifact[];
  metrics: Record<string, number>;
}

export interface FaultArtifact {
  type: 'proxy' | 'process' | 'container' | 'file' | 'network_rule';
  identifier: string;
  configuration: Record<string, any>;
  cleanupRequired: boolean;
}

export class FaultInjector extends EventEmitter {
  private docker: Dockerode;
  private toxiproxyClient: ToxiproxyClient;
  private activeFaults: Map<string, FaultInjectionResult> = new Map();
  private cleanupTasks: Array<() => Promise<void>> = [];

  constructor() {
    super();
    this.docker = new Dockerode();
    this.initializeToxiproxy();
  }

  /**
   * Initialize Toxiproxy client
   */
  private async initializeToxiproxy(): Promise<void> {
    try {
      const toxiproxyHost = process.env.TOXIPROXY_HOST || 'localhost';
      const toxiproxyPort = parseInt(process.env.TOXIPROXY_PORT || '8474');
      
      this.toxiproxyClient = new ToxiproxyClient(`http://${toxiproxyHost}:${toxiproxyPort}`);
      
      // Test connection
      await this.toxiproxyClient.getVersion();
      secureLog('info', 'Toxiproxy client initialized successfully');
      
    } catch (error) {
      secureLog('warn', 'Toxiproxy initialization failed, some fault types will be unavailable', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Inject fault based on configuration
   */
  public async injectFault(config: FaultConfiguration): Promise<FaultInjectionResult> {
    const faultId = `fault_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const result: FaultInjectionResult = {
      faultId,
      type: config.type,
      startTime: Date.now(),
      success: false,
      target: config.target,
      intensity: config.intensity,
      injectionMethod: '',
      rollbackExecuted: false,
      artifacts: [],
      metrics: {}
    };

    this.activeFaults.set(faultId, result);

    secureLog('info', 'Starting fault injection', {
      fault_id: faultId,
      type: config.type,
      target: config.target,
      intensity: config.intensity
    });

    try {
      switch (config.type) {
        case 'network_partition':
          await this.injectNetworkPartition(config, result);
          break;
          
        case 'high_latency':
          await this.injectHighLatency(config, result);
          break;
          
        case 'bandwidth_limit':
          await this.injectBandwidthLimit(config, result);
          break;
          
        case 'service_crash':
          await this.injectServiceCrash(config, result);
          break;
          
        case 'resource_exhaustion':
          await this.injectResourceExhaustion(config, result);
          break;
          
        case 'lambda_chaos':
          await this.injectLambdaChaos(config, result);
          break;
          
        case 'cascading_failure':
          await this.injectCascadingFailure(config, result);
          break;
          
        default:
          throw new Error(`Unsupported fault type: ${config.type}`);
      }

      result.success = true;
      this.emit('faultInjected', { faultId, config, result });

    } catch (error) {
      result.success = false;
      secureLog('error', 'Fault injection failed', {
        fault_id: faultId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Attempt cleanup on failure
      await this.removeFault(faultId);
      throw error;
    }

    return result;
  }

  /**
   * Remove fault injection
   */
  public async removeFault(faultId: string): Promise<boolean> {
    const result = this.activeFaults.get(faultId);
    
    if (!result) {
      return false;
    }

    secureLog('info', 'Removing fault injection', { fault_id: faultId });

    try {
      // Execute cleanup based on fault type
      await this.executeFaultCleanup(result);
      
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      result.rollbackExecuted = true;

      this.activeFaults.delete(faultId);
      this.emit('faultRemoved', { faultId, result });

      return true;

    } catch (error) {
      secureLog('error', 'Fault removal failed', {
        fault_id: faultId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Clean up all active faults
   */
  public async cleanup(): Promise<void> {
    secureLog('info', 'Cleaning up all fault injections');

    const cleanupPromises = Array.from(this.activeFaults.keys()).map(faultId => 
      this.removeFault(faultId)
    );

    await Promise.allSettled(cleanupPromises);

    // Execute any additional cleanup tasks
    for (const cleanupTask of this.cleanupTasks) {
      try {
        await cleanupTask();
      } catch (error) {
        secureLog('error', 'Cleanup task failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    this.cleanupTasks = [];
    secureLog('info', 'Fault injection cleanup completed');
  }

  /**
   * Inject network partition
   */
  private async injectNetworkPartition(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    result.injectionMethod = 'toxiproxy';

    if (!this.toxiproxyClient) {
      throw new Error('Toxiproxy not available for network partition injection');
    }

    // Create proxy for the target service
    const proxyName = `partition_${config.target}_${Date.now()}`;
    const targetPort = config.parameters.targetPort || 8080;
    const proxyPort = config.parameters.proxyPort || (targetPort + 1000);

    try {
      // Create proxy
      const proxy = await this.toxiproxyClient.createProxy({
        name: proxyName,
        listen: `0.0.0.0:${proxyPort}`,
        upstream: `localhost:${targetPort}`,
        enabled: true
      });

      // Add network partition toxic (100% packet loss)
      await proxy.addToxic({
        name: 'network_partition',
        type: 'bandwidth',
        stream: 'downstream',
        toxicity: config.intensity, // 0.0 to 1.0
        attributes: {
          rate: 0 // 0 bytes per second = complete partition
        }
      });

      result.artifacts.push({
        type: 'proxy',
        identifier: proxyName,
        configuration: { proxyPort, targetPort, intensity: config.intensity },
        cleanupRequired: true
      });

      secureLog('info', 'Network partition injected via Toxiproxy', {
        proxy_name: proxyName,
        proxy_port: proxyPort,
        target_port: targetPort,
        intensity: config.intensity
      });

    } catch (error) {
      throw new Error(`Network partition injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject high latency
   */
  private async injectHighLatency(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    result.injectionMethod = 'toxiproxy';

    if (!this.toxiproxyClient) {
      throw new Error('Toxiproxy not available for latency injection');
    }

    const proxyName = `latency_${config.target}_${Date.now()}`;
    const targetPort = config.parameters.targetPort || 8080;
    const proxyPort = config.parameters.proxyPort || (targetPort + 1000);
    const latencyMs = Math.floor(config.intensity * (config.parameters.maxLatency || 5000));

    try {
      // Create proxy
      const proxy = await this.toxiproxyClient.createProxy({
        name: proxyName,
        listen: `0.0.0.0:${proxyPort}`,
        upstream: `localhost:${targetPort}`,
        enabled: true
      });

      // Add latency toxic
      await proxy.addToxic({
        name: 'high_latency',
        type: 'latency',
        stream: 'downstream',
        toxicity: 1.0, // Apply to all requests
        attributes: {
          latency: latencyMs,
          jitter: Math.floor(latencyMs * 0.1) // 10% jitter
        }
      });

      result.artifacts.push({
        type: 'proxy',
        identifier: proxyName,
        configuration: { proxyPort, targetPort, latencyMs },
        cleanupRequired: true
      });

      result.metrics.injected_latency_ms = latencyMs;

      secureLog('info', 'High latency injected via Toxiproxy', {
        proxy_name: proxyName,
        latency_ms: latencyMs,
        intensity: config.intensity
      });

    } catch (error) {
      throw new Error(`High latency injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject bandwidth limit
   */
  private async injectBandwidthLimit(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    result.injectionMethod = 'toxiproxy';

    if (!this.toxiproxyClient) {
      throw new Error('Toxiproxy not available for bandwidth limiting');
    }

    const proxyName = `bandwidth_${config.target}_${Date.now()}`;
    const targetPort = config.parameters.targetPort || 8080;
    const proxyPort = config.parameters.proxyPort || (targetPort + 1000);
    const maxBandwidth = config.parameters.maxBandwidth || 1000000; // 1MB/s default
    const limitedBandwidth = Math.floor(maxBandwidth * (1 - config.intensity));

    try {
      // Create proxy
      const proxy = await this.toxiproxyClient.createProxy({
        name: proxyName,
        listen: `0.0.0.0:${proxyPort}`,
        upstream: `localhost:${targetPort}`,
        enabled: true
      });

      // Add bandwidth toxic
      await proxy.addToxic({
        name: 'bandwidth_limit',
        type: 'bandwidth',
        stream: 'downstream',
        toxicity: 1.0,
        attributes: {
          rate: limitedBandwidth // bytes per second
        }
      });

      result.artifacts.push({
        type: 'proxy',
        identifier: proxyName,
        configuration: { proxyPort, targetPort, limitedBandwidth },
        cleanupRequired: true
      });

      result.metrics.bandwidth_limit_bps = limitedBandwidth;

      secureLog('info', 'Bandwidth limit injected via Toxiproxy', {
        proxy_name: proxyName,
        bandwidth_bps: limitedBandwidth,
        intensity: config.intensity
      });

    } catch (error) {
      throw new Error(`Bandwidth limit injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject service crash
   */
  private async injectServiceCrash(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    result.injectionMethod = 'process_termination';

    const processName = config.parameters.processName || 'cctelegram';
    const graceful = config.parameters.graceful || false;

    try {
      // Find process by name
      const processes = await this.findProcessesByName(processName);
      
      if (processes.length === 0) {
        throw new Error(`No processes found with name: ${processName}`);
      }

      // Terminate processes based on intensity
      const processesToKill = Math.ceil(processes.length * config.intensity);
      const killedProcesses: number[] = [];

      for (let i = 0; i < processesToKill; i++) {
        const pid = processes[i];
        const signal = graceful ? 'SIGTERM' : 'SIGKILL';
        
        try {
          process.kill(pid, signal);
          killedProcesses.push(pid);
          
          secureLog('info', 'Process terminated for chaos test', {
            pid,
            signal,
            process_name: processName
          });
          
        } catch (error) {
          secureLog('warn', 'Failed to terminate process', {
            pid,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      result.artifacts.push({
        type: 'process',
        identifier: `killed_processes_${killedProcesses.join('_')}`,
        configuration: { processName, killedProcesses, graceful },
        cleanupRequired: false // Processes can't be restored
      });

      result.metrics.processes_killed = killedProcesses.length;

      secureLog('info', 'Service crash injected', {
        process_name: processName,
        processes_killed: killedProcesses.length,
        intensity: config.intensity
      });

    } catch (error) {
      throw new Error(`Service crash injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject resource exhaustion
   */
  private async injectResourceExhaustion(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    result.injectionMethod = 'resource_consumption';

    const resourceType = config.parameters.resourceType || 'memory';
    const targetMB = Math.floor(config.intensity * (config.parameters.maxMB || 100));

    try {
      if (resourceType === 'memory') {
        // Allocate memory blocks
        const memoryBlocks: Buffer[] = [];
        for (let i = 0; i < targetMB; i++) {
          memoryBlocks.push(Buffer.alloc(1024 * 1024)); // 1MB blocks
        }

        // Store reference to prevent garbage collection
        this.cleanupTasks.push(async () => {
          memoryBlocks.splice(0, memoryBlocks.length);
        });

        result.artifacts.push({
          type: 'file',
          identifier: `memory_exhaustion_${targetMB}MB`,
          configuration: { targetMB, resourceType },
          cleanupRequired: true
        });

        result.metrics.memory_allocated_mb = targetMB;

      } else if (resourceType === 'cpu') {
        // Create CPU load
        const threads = Math.floor(config.intensity * 4); // Up to 4 threads
        const intervals: NodeJS.Timeout[] = [];

        for (let i = 0; i < threads; i++) {
          const interval = setInterval(() => {
            const start = Date.now();
            while (Date.now() - start < 100) {
              Math.random(); // Busy wait
            }
          }, 200);
          intervals.push(interval);
        }

        this.cleanupTasks.push(async () => {
          intervals.forEach(interval => clearInterval(interval));
        });

        result.artifacts.push({
          type: 'process',
          identifier: `cpu_exhaustion_${threads}_threads`,
          configuration: { threads, resourceType },
          cleanupRequired: true
        });

        result.metrics.cpu_threads_created = threads;
      }

      secureLog('info', 'Resource exhaustion injected', {
        resource_type: resourceType,
        intensity: config.intensity,
        target_mb: targetMB
      });

    } catch (error) {
      throw new Error(`Resource exhaustion injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject Lambda chaos patterns
   */
  private async injectLambdaChaos(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    result.injectionMethod = 'lambda_chaos_monkey';

    const chaosType = config.parameters.chaosType || 'exception';
    const targetFunction = config.parameters.targetFunction || 'default';

    try {
      // Simulate lambda chaos monkey patterns
      switch (chaosType) {
        case 'exception':
          await this.injectLambdaException(config, result);
          break;
          
        case 'timeout':
          await this.injectLambdaTimeout(config, result);
          break;
          
        case 'cold_start':
          await this.injectLambdaColdStart(config, result);
          break;
          
        case 'memory_limit':
          await this.injectLambdaMemoryLimit(config, result);
          break;
          
        default:
          throw new Error(`Unsupported lambda chaos type: ${chaosType}`);
      }

      secureLog('info', 'Lambda chaos injected', {
        chaos_type: chaosType,
        target_function: targetFunction,
        intensity: config.intensity
      });

    } catch (error) {
      throw new Error(`Lambda chaos injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject cascading failure
   */
  private async injectCascadingFailure(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    result.injectionMethod = 'cascading_failure';

    const failureSequence = config.parameters.failureSequence || [
      { type: 'high_latency', delay: 0 },
      { type: 'service_crash', delay: 30000 },
      { type: 'network_partition', delay: 60000 }
    ];

    try {
      const cascadePromises: Promise<void>[] = [];

      for (const [index, failure] of failureSequence.entries()) {
        const cascadePromise = new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              const subConfig: FaultConfiguration = {
                ...config,
                type: failure.type as any,
                target: `${config.target}_cascade_${index}`,
                parameters: { ...config.parameters, ...failure.parameters }
              };

              const subResult = await this.injectFault(subConfig);
              
              result.artifacts.push({
                type: 'proxy',
                identifier: `cascade_${index}_${failure.type}`,
                configuration: { originalFaultId: subResult.faultId, failure },
                cleanupRequired: true
              });

              resolve();
              
            } catch (error) {
              secureLog('error', 'Cascading failure step failed', {
                step: index,
                failure_type: failure.type,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
              resolve();
            }
          }, failure.delay);
        });

        cascadePromises.push(cascadePromise);
      }

      // Don't wait for all cascades to complete, let them run independently
      Promise.allSettled(cascadePromises);

      result.metrics.cascade_steps = failureSequence.length;

      secureLog('info', 'Cascading failure sequence initiated', {
        steps: failureSequence.length,
        intensity: config.intensity
      });

    } catch (error) {
      throw new Error(`Cascading failure injection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Inject Lambda exception
   */
  private async injectLambdaException(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    // Simulate lambda function exceptions by intercepting HTTP requests
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async (url: any, options?: any) => {
      if (Math.random() < config.intensity) {
        throw new Error('Lambda function exception injected by chaos monkey');
      }
      return originalFetch(url, options);
    };

    this.cleanupTasks.push(async () => {
      globalThis.fetch = originalFetch;
    });

    result.artifacts.push({
      type: 'network_rule',
      identifier: 'lambda_exception_injection',
      configuration: { intensity: config.intensity },
      cleanupRequired: true
    });
  }

  /**
   * Inject Lambda timeout
   */
  private async injectLambdaTimeout(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    const timeoutMs = Math.floor(config.intensity * (config.parameters.maxTimeout || 30000));
    
    // Simulate lambda timeouts
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async (url: any, options?: any) => {
      if (Math.random() < config.intensity) {
        await new Promise(resolve => setTimeout(resolve, timeoutMs));
        throw new Error('Lambda function timeout');
      }
      return originalFetch(url, options);
    };

    this.cleanupTasks.push(async () => {
      globalThis.fetch = originalFetch;
    });

    result.metrics.timeout_ms = timeoutMs;
  }

  /**
   * Inject Lambda cold start
   */
  private async injectLambdaColdStart(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    const coldStartDelay = Math.floor(config.intensity * (config.parameters.maxColdStart || 5000));
    
    // Simulate cold start delays
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async (url: any, options?: any) => {
      if (Math.random() < config.intensity * 0.3) { // 30% of intensity for cold starts
        await new Promise(resolve => setTimeout(resolve, coldStartDelay));
      }
      return originalFetch(url, options);
    };

    this.cleanupTasks.push(async () => {
      globalThis.fetch = originalFetch;
    });

    result.metrics.cold_start_delay_ms = coldStartDelay;
  }

  /**
   * Inject Lambda memory limit
   */
  private async injectLambdaMemoryLimit(
    config: FaultConfiguration, 
    result: FaultInjectionResult
  ): Promise<void> {
    // Simulate memory pressure
    const memoryMB = Math.floor(config.intensity * 50); // Up to 50MB
    const memoryBlocks: Buffer[] = [];
    
    for (let i = 0; i < memoryMB; i++) {
      memoryBlocks.push(Buffer.alloc(1024 * 1024));
    }

    this.cleanupTasks.push(async () => {
      memoryBlocks.splice(0, memoryBlocks.length);
    });

    result.metrics.memory_pressure_mb = memoryMB;
  }

  /**
   * Execute fault cleanup
   */
  private async executeFaultCleanup(result: FaultInjectionResult): Promise<void> {
    for (const artifact of result.artifacts) {
      if (!artifact.cleanupRequired) {
        continue;
      }

      try {
        switch (artifact.type) {
          case 'proxy':
            if (this.toxiproxyClient) {
              await this.toxiproxyClient.deleteProxy(artifact.identifier);
            }
            break;
            
          case 'container':
            const container = this.docker.getContainer(artifact.identifier);
            await container.stop();
            await container.remove();
            break;
            
          // Other cleanup types handled by cleanup tasks
        }
        
      } catch (error) {
        secureLog('warn', 'Artifact cleanup failed', {
          artifact_type: artifact.type,
          artifact_id: artifact.identifier,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * Find processes by name
   */
  private async findProcessesByName(processName: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const ps = spawn('pgrep', ['-f', processName]);
      let output = '';

      ps.stdout.on('data', (data) => {
        output += data.toString();
      });

      ps.on('close', (code) => {
        if (code === 0) {
          const pids = output.trim().split('\n')
            .filter(line => line.length > 0)
            .map(line => parseInt(line))
            .filter(pid => !isNaN(pid));
          resolve(pids);
        } else {
          resolve([]); // No processes found
        }
      });

      ps.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get active faults
   */
  public getActiveFaults(): Map<string, FaultInjectionResult> {
    return new Map(this.activeFaults);
  }
}
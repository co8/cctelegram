/**
 * Chaos Engineering Scenarios
 * 
 * Predefined chaos scenarios for various failure conditions.
 * These scenarios define fault configurations, recovery expectations,
 * and success criteria for comprehensive chaos testing.
 */

import { ChaosScenario } from '../core/chaos-test-runner.js';

export class NetworkChaosScenarios {
  /**
   * Complete network partition for 5 minutes
   */
  static readonly NETWORK_PARTITION_5_MINUTES: ChaosScenario = {
    name: 'Network Partition - 5 Minutes',
    description: 'Complete network partition to test circuit breaker and failover mechanisms',
    duration: 300000, // 5 minutes
    faultConfiguration: {
      type: 'network_partition',
      intensity: 1.0, // Complete partition
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        partitionType: 'complete'
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 60000, // 1 minute
      expectedRecoveryMechanisms: ['circuit_breaker', 'failover', 'health_check_recovery'],
      successCriteria: {
        minimumSuccessRate: 0.8,
        maxResponseTime: 3000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['network', 'partition', 'circuit-breaker', 'critical']
  };

  /**
   * Partial network partition with 50% packet loss
   */
  static readonly PARTIAL_NETWORK_PARTITION: ChaosScenario = {
    name: 'Partial Network Partition',
    description: 'Partial network partition with 50% packet loss to test retry logic',
    duration: 120000, // 2 minutes
    faultConfiguration: {
      type: 'packet_loss',
      intensity: 0.5, // 50% packet loss
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        lossPattern: 'random'
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 30000, // 30 seconds
      expectedRecoveryMechanisms: ['retry_logic', 'circuit_breaker'],
      successCriteria: {
        minimumSuccessRate: 0.6,
        maxResponseTime: 5000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['message_ordering']
      },
      healthCheckEndpoints: ['http://localhost:8080/health']
    },
    tags: ['network', 'packet-loss', 'retry', 'moderate']
  };

  /**
   * Network partition with gradual recovery
   */
  static readonly NETWORK_PARTITION_WITH_RECOVERY: ChaosScenario = {
    name: 'Network Partition with Gradual Recovery',
    description: 'Network partition followed by gradual recovery to test adaptive mechanisms',
    duration: 180000, // 3 minutes
    faultConfiguration: {
      type: 'network_partition',
      intensity: 1.0,
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        gradualRecovery: true,
        recoverySteps: [
          { time: 0, intensity: 1.0 },     // Complete partition
          { time: 60000, intensity: 0.7 }, // 70% loss
          { time: 120000, intensity: 0.3 }, // 30% loss
          { time: 180000, intensity: 0.0 }  // Full recovery
        ]
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 45000,
      expectedRecoveryMechanisms: ['circuit_breaker', 'retry_logic', 'graceful_degradation'],
      successCriteria: {
        minimumSuccessRate: 0.7,
        maxResponseTime: 4000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity', 'message_ordering']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['network', 'partition', 'gradual-recovery', 'adaptive']
  };

  /**
   * High latency injection (5 seconds)
   */
  static readonly HIGH_LATENCY_5_SECONDS: ChaosScenario = {
    name: 'High Latency - 5 Seconds',
    description: 'Inject 5 second latency to test timeout handling and circuit breakers',
    duration: 120000, // 2 minutes
    faultConfiguration: {
      type: 'high_latency',
      intensity: 1.0, // Maximum intensity
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        latencyMs: 5000,
        jitterMs: 500
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 30000,
      expectedRecoveryMechanisms: ['circuit_breaker', 'timeout_handling'],
      successCriteria: {
        minimumSuccessRate: 0.5,
        maxResponseTime: 8000, // Allow for high latency + processing
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity']
      },
      healthCheckEndpoints: ['http://localhost:8080/health']
    },
    tags: ['network', 'latency', 'timeout', 'circuit-breaker']
  };

  /**
   * Variable latency injection
   */
  static readonly VARIABLE_LATENCY: ChaosScenario = {
    name: 'Variable Latency',
    description: 'Variable latency injection to test adaptive timeout mechanisms',
    duration: 180000, // 3 minutes
    faultConfiguration: {
      type: 'variable_latency',
      intensity: 0.8,
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        minLatency: 100,
        maxLatency: 3000,
        variabilityPattern: 'sine_wave'
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 45000,
      expectedRecoveryMechanisms: ['adaptive_timeout', 'retry_logic'],
      successCriteria: {
        minimumSuccessRate: 0.8,
        maxResponseTime: 4000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['message_ordering']
      },
      healthCheckEndpoints: ['http://localhost:8080/health']
    },
    tags: ['network', 'latency', 'variable', 'adaptive']
  };

  /**
   * Latency spikes at regular intervals
   */
  static readonly LATENCY_SPIKES: ChaosScenario = {
    name: 'Latency Spikes',
    description: 'Regular latency spikes to test burst handling capabilities',
    duration: 240000, // 4 minutes
    faultConfiguration: {
      type: 'latency_spikes',
      intensity: 0.9,
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        spikeLatency: 8000,
        spikeDuration: 5000,
        spikeInterval: 30000,
        baseLatency: 200
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 60000,
      expectedRecoveryMechanisms: ['circuit_breaker', 'retry_logic', 'burst_handling'],
      successCriteria: {
        minimumSuccessRate: 0.7,
        maxResponseTime: 10000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['network', 'latency', 'spikes', 'burst']
  };

  /**
   * Bandwidth limitation to 1 Mbps
   */
  static readonly BANDWIDTH_LIMIT_1MBPS: ChaosScenario = {
    name: 'Bandwidth Limit - 1 Mbps',
    description: 'Limit bandwidth to 1 Mbps to test graceful degradation',
    duration: 180000, // 3 minutes
    faultConfiguration: {
      type: 'bandwidth_limit',
      intensity: 0.9, // Severe limitation
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        maxBandwidth: 1000000, // 1 MB/s
        burstAllowance: 2000000 // 2 MB burst
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 45000,
      expectedRecoveryMechanisms: ['graceful_degradation', 'compression', 'caching'],
      successCriteria: {
        minimumSuccessRate: 0.8,
        maxResponseTime: 10000, // Allow for slower responses
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['message_ordering']
      },
      healthCheckEndpoints: ['http://localhost:8080/health']
    },
    tags: ['network', 'bandwidth', 'degradation', 'performance']
  };

  /**
   * Fluctuating bandwidth conditions
   */
  static readonly FLUCTUATING_BANDWIDTH: ChaosScenario = {
    name: 'Fluctuating Bandwidth',
    description: 'Fluctuating bandwidth conditions to test adaptive behavior',
    duration: 300000, // 5 minutes
    faultConfiguration: {
      type: 'fluctuating_bandwidth',
      intensity: 0.7,
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        minBandwidth: 100000,   // 100 KB/s
        maxBandwidth: 10000000, // 10 MB/s
        fluctuationInterval: 10000, // Change every 10 seconds
        pattern: 'random_walk'
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 60000,
      expectedRecoveryMechanisms: ['adaptive_compression', 'dynamic_caching', 'graceful_degradation'],
      successCriteria: {
        minimumSuccessRate: 0.75,
        maxResponseTime: 8000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['message_ordering', 'event_queue_integrity']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['network', 'bandwidth', 'fluctuating', 'adaptive']
  };

  /**
   * Cascading network failures
   */
  static readonly CASCADING_NETWORK_FAILURE: ChaosScenario = {
    name: 'Cascading Network Failure',
    description: 'Multiple network failures in sequence to test comprehensive resilience',
    duration: 480000, // 8 minutes
    faultConfiguration: {
      type: 'cascading_failure',
      intensity: 0.8,
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        failureSequence: [
          { type: 'high_latency', delay: 0, duration: 60000, intensity: 0.8 },
          { type: 'bandwidth_limit', delay: 45000, duration: 120000, intensity: 0.9 },
          { type: 'packet_loss', delay: 120000, duration: 90000, intensity: 0.3 },
          { type: 'network_partition', delay: 240000, duration: 60000, intensity: 1.0 },
          { type: 'recovery_phase', delay: 360000, duration: 120000, intensity: 0.0 }
        ]
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 120000, // 2 minutes for full recovery
      expectedRecoveryMechanisms: [
        'circuit_breaker', 'retry_logic', 'graceful_degradation', 
        'failover', 'adaptive_timeout', 'emergency_mode'
      ],
      successCriteria: {
        minimumSuccessRate: 0.6,
        maxResponseTime: 15000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity', 'message_ordering', 'file_system_consistency']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['network', 'cascading', 'comprehensive', 'resilience', 'critical']
  };

  /**
   * Network jitter with packet loss
   */
  static readonly NETWORK_JITTER_WITH_LOSS: ChaosScenario = {
    name: 'Network Jitter with Packet Loss',
    description: 'Combination of network jitter and packet loss to test robustness',
    duration: 180000, // 3 minutes
    faultConfiguration: {
      type: 'combined_network_fault',
      intensity: 0.6,
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        baseLatency: 100,
        jitterRange: 1000, // ±1000ms jitter
        packetLossRate: 0.15, // 15% packet loss
        correlatedFaults: true
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 45000,
      expectedRecoveryMechanisms: ['retry_logic', 'jitter_handling', 'packet_loss_recovery'],
      successCriteria: {
        minimumSuccessRate: 0.7,
        maxResponseTime: 5000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['message_ordering']
      },
      healthCheckEndpoints: ['http://localhost:8080/health']
    },
    tags: ['network', 'jitter', 'packet-loss', 'combined']
  };

  /**
   * Realistic network degradation scenario
   */
  static readonly REALISTIC_NETWORK_DEGRADATION: ChaosScenario = {
    name: 'Realistic Network Degradation',
    description: 'Realistic network degradation based on real-world patterns',
    duration: 360000, // 6 minutes
    faultConfiguration: {
      type: 'realistic_degradation',
      intensity: 0.5,
      parameters: {
        targetPort: 8080,
        proxyPort: 9080,
        degradationProfile: 'mobile_network',
        timeOfDay: 'peak_hours',
        networkType: '4g_congested',
        geographicRegion: 'urban_dense'
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 90000,
      expectedRecoveryMechanisms: [
        'adaptive_quality', 'progressive_degradation', 
        'intelligent_retry', 'user_experience_optimization'
      ],
      successCriteria: {
        minimumSuccessRate: 0.85,
        maxResponseTime: 6000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['message_ordering', 'event_queue_integrity']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['network', 'realistic', 'mobile', 'user-experience']
  };
}

export class ServiceChaosScenarios {
  /**
   * Complete service outage
   */
  static readonly COMPLETE_SERVICE_OUTAGE: ChaosScenario = {
    name: 'Complete Service Outage',
    description: 'Complete service shutdown to test failover and recovery',
    duration: 180000, // 3 minutes
    faultConfiguration: {
      type: 'service_shutdown',
      intensity: 1.0,
      parameters: {
        targetService: 'cctelegram-bridge',
        shutdownMethod: 'graceful',
        shutdownDelay: 5000
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 60000,
      expectedRecoveryMechanisms: ['service_restart', 'failover', 'health_monitoring'],
      successCriteria: {
        minimumSuccessRate: 0.9,
        maxResponseTime: 3000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity', 'file_system_consistency']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['service', 'outage', 'failover', 'critical']
  };

  /**
   * Memory exhaustion
   */
  static readonly MEMORY_EXHAUSTION: ChaosScenario = {
    name: 'Memory Exhaustion',
    description: 'Memory exhaustion to test resource management and recovery',
    duration: 120000, // 2 minutes
    faultConfiguration: {
      type: 'memory_exhaustion',
      intensity: 0.9,
      parameters: {
        targetProcess: 'cctelegram-bridge',
        memoryPressure: '90%',
        allocationPattern: 'gradual_increase'
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 45000,
      expectedRecoveryMechanisms: ['memory_cleanup', 'garbage_collection', 'process_restart'],
      successCriteria: {
        minimumSuccessRate: 0.7,
        maxResponseTime: 5000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['service', 'memory', 'resource', 'performance']
  };

  /**
   * CPU exhaustion
   */
  static readonly CPU_EXHAUSTION: ChaosScenario = {
    name: 'CPU Exhaustion',
    description: 'CPU exhaustion to test performance degradation and recovery',
    duration: 150000, // 2.5 minutes
    faultConfiguration: {
      type: 'cpu_exhaustion',
      intensity: 0.95,
      parameters: {
        targetProcess: 'cctelegram-bridge',
        cpuUsage: '95%',
        loadPattern: 'sustained_high'
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 30000,
      expectedRecoveryMechanisms: ['load_balancing', 'request_throttling', 'graceful_degradation'],
      successCriteria: {
        minimumSuccessRate: 0.6,
        maxResponseTime: 8000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['message_ordering']
      },
      healthCheckEndpoints: ['http://localhost:8080/health']
    },
    tags: ['service', 'cpu', 'performance', 'throttling']
  };
}

export class LambdaChaosScenarios {
  /**
   * Lambda function timeout
   */
  static readonly LAMBDA_TIMEOUT: ChaosScenario = {
    name: 'Lambda Function Timeout',
    description: 'Lambda function timeout to test async processing and retry logic',
    duration: 120000, // 2 minutes
    faultConfiguration: {
      type: 'lambda_timeout',
      intensity: 0.8,
      parameters: {
        functionName: 'cctelegram-processor',
        timeoutDuration: 30000, // 30 seconds
        timeoutPattern: 'random'
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 45000,
      expectedRecoveryMechanisms: ['retry_logic', 'dead_letter_queue', 'async_processing'],
      successCriteria: {
        minimumSuccessRate: 0.8,
        maxResponseTime: 35000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity', 'message_ordering']
      },
      healthCheckEndpoints: ['http://localhost:8080/health', 'http://localhost:8080/metrics']
    },
    tags: ['lambda', 'timeout', 'async', 'retry']
  };

  /**
   * Lambda cold start delays
   */
  static readonly LAMBDA_COLD_START: ChaosScenario = {
    name: 'Lambda Cold Start',
    description: 'Lambda cold start delays to test initialization handling',
    duration: 180000, // 3 minutes
    faultConfiguration: {
      type: 'lambda_cold_start',
      intensity: 0.7,
      parameters: {
        functionName: 'cctelegram-processor',
        coldStartFrequency: 0.5, // 50% of invocations
        initializationDelay: 15000 // 15 seconds
      }
    },
    recoveryExpectations: {
      maxRecoveryTime: 20000,
      expectedRecoveryMechanisms: ['warm_pool', 'initialization_optimization', 'async_processing'],
      successCriteria: {
        minimumSuccessRate: 0.85,
        maxResponseTime: 20000,
        requiredHealthChecks: ['http://localhost:8080/health'],
        dataConsistencyChecks: ['event_queue_integrity']
      },
      healthCheckEndpoints: ['http://localhost:8080/health']
    },
    tags: ['lambda', 'cold-start', 'initialization', 'performance']
  };
}

/**
 * Get all available chaos scenarios
 */
export function getAllChaosScenarios(): ChaosScenario[] {
  const scenarios: ChaosScenario[] = [];
  
  // Add network scenarios
  Object.values(NetworkChaosScenarios).forEach(scenario => {
    if (typeof scenario === 'object' && scenario.name) {
      scenarios.push(scenario);
    }
  });
  
  // Add service scenarios
  Object.values(ServiceChaosScenarios).forEach(scenario => {
    if (typeof scenario === 'object' && scenario.name) {
      scenarios.push(scenario);
    }
  });
  
  // Add Lambda scenarios
  Object.values(LambdaChaosScenarios).forEach(scenario => {
    if (typeof scenario === 'object' && scenario.name) {
      scenarios.push(scenario);
    }
  });
  
  return scenarios;
}

/**
 * Get scenarios by tag
 */
export function getScenariosByTag(tag: string): ChaosScenario[] {
  return getAllChaosScenarios().filter(scenario => 
    scenario.tags.includes(tag)
  );
}

/**
 * Get scenarios by intensity level
 */
export function getScenariosByIntensity(minIntensity: number, maxIntensity: number = 1.0): ChaosScenario[] {
  return getAllChaosScenarios().filter(scenario => 
    scenario.faultConfiguration.intensity >= minIntensity && 
    scenario.faultConfiguration.intensity <= maxIntensity
  );
}

/**
 * Get scenarios by duration
 */
export function getScenariosByDuration(minDuration: number, maxDuration: number = Infinity): ChaosScenario[] {
  return getAllChaosScenarios().filter(scenario => 
    scenario.duration >= minDuration && scenario.duration <= maxDuration
  );
}
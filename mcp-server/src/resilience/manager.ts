/**
 * Resilience Manager
 * 
 * Main orchestrator for the resilience framework, coordinating all
 * resilience components and providing unified management interface.
 */

import { ResilienceConfig, createDefaultResilienceConfig } from './config.js';
import { ResilienceMiddleware } from './middleware/resilience-middleware.js';
import { HealthChecker, SystemHealthResult } from './health/health-checker.js';
import { RecoveryManager } from './recovery/recovery-manager.js';
import { MetricsCollector } from './monitoring/metrics-collector.js';
import { ChaosEngineer } from './testing/chaos-engineer.js';
import { BaseResilienceError } from './errors/base-error.js';
import { secureLog, sanitizeForLogging } from '../security.js';

export interface ResilienceSystemStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    health: 'healthy' | 'degraded' | 'unhealthy';
    middleware: 'healthy' | 'degraded' | 'unhealthy';
    recovery: 'healthy' | 'degraded' | 'unhealthy';
    monitoring: 'healthy' | 'degraded' | 'unhealthy';
  };
  metrics: {
    uptime: number;
    totalOperations: number;
    successRate: number;
    averageResponseTime: number;
    circuitBreakerTrips: number;
    recoveryAttempts: number;
  };
  activeIssues: string[];
}

export class ResilienceManager {
  private config: ResilienceConfig;
  private middleware: ResilienceMiddleware;
  private healthChecker: HealthChecker;
  private recoveryManager: RecoveryManager;
  private metricsCollector: MetricsCollector;
  private chaosEngineer?: ChaosEngineer;
  private isInitialized: boolean = false;
  private startTime: number = Date.now();

  constructor(config?: Partial<ResilienceConfig>) {
    this.config = config ? { ...createDefaultResilienceConfig(), ...config } : createDefaultResilienceConfig();
    
    // Initialize core components
    this.metricsCollector = new MetricsCollector(this.config.monitoring);
    this.middleware = new ResilienceMiddleware(this.config, this.metricsCollector);
    this.healthChecker = new HealthChecker(this.config.health);
    this.recoveryManager = new RecoveryManager(this.config.recovery);

    // Initialize chaos engineer for non-production environments
    if (this.config.environment !== 'production') {
      this.chaosEngineer = new ChaosEngineer(this.config);
    }

    secureLog('info', 'Resilience manager created', {
      environment: this.config.environment,
      enabled: this.config.enabled,
      chaos_engineering: !!this.chaosEngineer
    });
  }

  /**
   * Initialize the resilience system
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (!this.config.enabled) {
      secureLog('info', 'Resilience system disabled by configuration');
      return;
    }

    try {
      secureLog('info', 'Initializing resilience system');

      // Start metrics collection
      if (this.config.monitoring.enabled) {
        this.metricsCollector.startCollection();
      }

      // Wait for grace period before starting health checks
      if (this.config.health.enabled && this.config.health.gracePeriod > 0) {
        secureLog('info', 'Waiting for health check grace period', {
          grace_period: this.config.health.gracePeriod
        });
        
        await new Promise(resolve => setTimeout(resolve, this.config.health.gracePeriod));
      }

      // Perform initial health check
      if (this.config.health.enabled) {
        const initialHealth = await this.healthChecker.checkHealth();
        
        secureLog('info', 'Initial system health check completed', {
          overall_status: initialHealth.overall,
          healthy_components: initialHealth.summary.healthy,
          total_components: initialHealth.summary.total
        });

        // Start periodic health checks
        this.startPeriodicHealthChecks();
      }

      this.isInitialized = true;

      secureLog('info', 'Resilience system initialized successfully', {
        components: {
          middleware: true,
          health_checker: this.config.health.enabled,
          recovery_manager: this.config.recovery.enabled,
          monitoring: this.config.monitoring.enabled,
          chaos_engineer: !!this.chaosEngineer
        }
      });

    } catch (error) {
      secureLog('error', 'Failed to initialize resilience system', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Execute operation with resilience patterns
   */
  public async execute<T>(
    operation: () => Promise<T>,
    context: {
      operation: string;
      component: string;
      correlationId?: string;
      timeout?: number;
      priority?: 'low' | 'normal' | 'high' | 'critical';
    }
  ): Promise<T> {
    
    if (!this.config.enabled) {
      // Execute directly without resilience patterns
      return await operation();
    }

    const result = await this.middleware.execute(operation, context);

    if (!result.success) {
      // Handle error with recovery if it's a resilience error
      if (result.error instanceof BaseResilienceError) {
        if (this.config.recovery.enabled && this.config.recovery.autoRecoveryEnabled) {
          await this.recoveryManager.initiateRecovery(result.error);
        }
      }

      throw result.error!;
    }

    return result.result!;
  }

  /**
   * Start periodic health checks
   */
  private startPeriodicHealthChecks(): void {
    if (!this.config.health.enabled) {
      return;
    }

    setInterval(async () => {
      try {
        const health = await this.healthChecker.checkHealth();
        
        // Log health status changes
        if (health.overall !== 'healthy') {
          secureLog('warn', 'System health degraded', {
            overall_status: health.overall,
            unhealthy_components: health.summary.unhealthy,
            degraded_components: health.summary.degraded
          });
        }

        // Trigger recovery for critical health issues
        if (health.overall === 'unhealthy' && this.config.recovery.enabled) {
          const criticalComponents = Object.entries(health.components)
            .filter(([_, result]) => result.status === 'unhealthy')
            .map(([name, _]) => name);

          for (const component of criticalComponents) {
            secureLog('error', 'Critical component unhealthy - initiating recovery', {
              component
            });
            
            // Create a health check error for recovery
            const healthError = new BaseResilienceError(
              `Component ${component} is unhealthy`,
              'HEALTH_CHECK_FAILED',
              'system',
              'critical',
              true,
              {
                operation: 'health_check',
                component: component,
                correlationId: `health-${Date.now()}`
              }
            );

            await this.recoveryManager.initiateRecovery(healthError);
          }
        }

      } catch (error) {
        secureLog('error', 'Periodic health check failed', {
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }, this.config.health.interval);
  }

  /**
   * Get system status
   */
  public async getSystemStatus(): Promise<ResilienceSystemStatus> {
    let healthStatus: SystemHealthResult | undefined;
    
    try {
      healthStatus = await this.healthChecker.checkHealth();
    } catch (error) {
      secureLog('warn', 'Failed to get health status', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    }

    const middlewareHealth = this.middleware.getHealthStatus();
    const monitoringHealth = this.metricsCollector.getHealthStatus();
    const recoveryStats = this.recoveryManager.getStatistics();

    // Calculate overall status
    const componentStatuses = [
      healthStatus?.overall || 'unknown',
      middlewareHealth.status,
      monitoringHealth.status
    ];

    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (componentStatuses.includes('unhealthy')) {
      overall = 'unhealthy';
    } else if (componentStatuses.includes('degraded')) {
      overall = 'degraded';
    }

    // Collect active issues
    const activeIssues: string[] = [];
    
    if (healthStatus && healthStatus.overall !== 'healthy') {
      activeIssues.push(`System health: ${healthStatus.overall}`);
    }
    
    if (middlewareHealth.status !== 'healthy') {
      activeIssues.push(`Resilience middleware: ${middlewareHealth.status}`);
    }
    
    if (monitoringHealth.status !== 'healthy') {
      activeIssues.push(`Monitoring system: ${monitoringHealth.status}`);
    }

    // Get metrics summary
    const metricsSummary = this.metricsCollector.getMetricsSummary();
    
    return {
      overall,
      components: {
        health: healthStatus?.overall || 'unknown',
        middleware: middlewareHealth.status,
        recovery: recoveryStats.active_sessions > 0 ? 'degraded' : 'healthy',
        monitoring: monitoringHealth.status
      },
      metrics: {
        uptime: Date.now() - this.startTime,
        totalOperations: metricsSummary['resilience.operation_started']?.sum || 0,
        successRate: this.calculateSuccessRate(metricsSummary),
        averageResponseTime: metricsSummary['resilience.operation_duration']?.avg || 0,
        circuitBreakerTrips: metricsSummary['resilience.circuit_breaker_state_change']?.sum || 0,
        recoveryAttempts: recoveryStats.total_sessions || 0
      },
      activeIssues
    };
  }

  /**
   * Calculate success rate from metrics
   */
  private calculateSuccessRate(metricsSummary: Record<string, any>): number {
    const successes = metricsSummary['resilience.operation_success']?.sum || 0;
    const failures = metricsSummary['resilience.operation_failure']?.sum || 0;
    const total = successes + failures;
    
    return total > 0 ? successes / total : 1.0;
  }

  /**
   * Get detailed health report
   */
  public async getHealthReport(): Promise<{
    system: SystemHealthResult;
    middleware: any;
    monitoring: any;
    recovery: any;
  }> {
    
    const [systemHealth, middlewareHealth, monitoringHealth, recoveryStats] = await Promise.all([
      this.healthChecker.checkHealth().catch(() => null),
      Promise.resolve(this.middleware.getHealthStatus()),
      Promise.resolve(this.metricsCollector.getHealthStatus()),
      Promise.resolve(this.recoveryManager.getStatistics())
    ]);

    return {
      system: systemHealth || {
        overall: 'unknown',
        components: {},
        timestamp: Date.now(),
        summary: { healthy: 0, unhealthy: 0, degraded: 0, unknown: 0, total: 0 }
      },
      middleware: middlewareHealth,
      monitoring: monitoringHealth,
      recovery: recoveryStats
    };
  }

  /**
   * Get metrics summary
   */
  public getMetrics(): Record<string, any> {
    return this.metricsCollector.getMetricsSummary();
  }

  /**
   * Get circuit breaker statistics
   */
  public getCircuitBreakerStats(): Record<string, any> {
    return this.middleware.getCircuitBreakerStats();
  }

  /**
   * Get retry statistics
   */
  public getRetryStats(): Record<string, any> {
    return this.middleware.getRetryStats();
  }

  /**
   * Get recovery history
   */
  public getRecoveryHistory(limit?: number): any[] {
    return this.recoveryManager.getRecoveryHistory(limit);
  }

  /**
   * Update configuration
   */
  public async updateConfig(updates: Partial<ResilienceConfig>): Promise<void> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...updates };

    // Update component configurations
    this.middleware.updateConfig(this.config);
    this.healthChecker.updateConfig(this.config.health);
    this.recoveryManager.updateConfig(this.config.recovery);
    this.metricsCollector.updateConfig(this.config.monitoring);

    secureLog('info', 'Resilience configuration updated', {
      changes: sanitizeForLogging(updates),
      requires_restart: this.requiresRestart(oldConfig, this.config)
    });
  }

  /**
   * Check if configuration changes require restart
   */
  private requiresRestart(oldConfig: ResilienceConfig, newConfig: ResilienceConfig): boolean {
    // Check if fundamental settings changed
    return (
      oldConfig.enabled !== newConfig.enabled ||
      oldConfig.environment !== newConfig.environment ||
      oldConfig.monitoring.enabled !== newConfig.monitoring.enabled
    );
  }

  /**
   * Reset resilience state
   */
  public reset(): void {
    this.middleware.reset();
    this.healthChecker.reset();
    this.metricsCollector.reset();
    
    secureLog('info', 'Resilience system state reset');
  }

  /**
   * Shutdown resilience system gracefully
   */
  public async shutdown(): Promise<void> {
    secureLog('info', 'Shutting down resilience system');

    try {
      // Stop metrics collection
      this.metricsCollector.stopCollection();

      // Initiate graceful shutdown of recovery manager
      await this.recoveryManager.initiateGracefulShutdown();

      this.isInitialized = false;

      secureLog('info', 'Resilience system shutdown completed');

    } catch (error) {
      secureLog('error', 'Error during resilience system shutdown', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Get chaos engineer (if available)
   */
  public getChaosEngineer(): ChaosEngineer | undefined {
    return this.chaosEngineer;
  }

  /**
   * Check if system is initialized
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get current configuration
   */
  public getConfig(): ResilienceConfig {
    return { ...this.config };
  }

  /**
   * Force circuit breaker state (for testing/manual intervention)
   */
  public forceCircuitBreakerState(
    component: string, 
    state: 'open' | 'closed' | 'half-open', 
    reason?: string
  ): void {
    const circuitBreakers = this.middleware.getCircuitBreakerStats();
    
    secureLog('warn', 'Circuit breaker state forced', {
      component,
      state,
      reason: reason || 'manual_override'
    });

    // This would need to be implemented in the middleware
    // For now, just log the action
  }

  /**
   * Trigger manual recovery
   */
  public async triggerRecovery(
    component: string,
    errorCode: string,
    description: string
  ): Promise<void> {
    
    const manualError = new BaseResilienceError(
      description,
      errorCode,
      'system',
      'high',
      true,
      {
        operation: 'manual_recovery',
        component,
        correlationId: `manual-${Date.now()}`
      }
    );

    await this.recoveryManager.initiateRecovery(manualError);
    
    secureLog('info', 'Manual recovery triggered', {
      component,
      error_code: errorCode,
      description
    });
  }
}
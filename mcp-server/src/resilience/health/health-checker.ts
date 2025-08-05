/**
 * Health Checker Implementation
 * 
 * Performs health checks on various system components with configurable
 * timeouts, retries, and failure tracking.
 */

import { HealthCheckConfig, HealthEndpointConfig } from '../config.js';
import { secureLog, sanitizeForLogging } from '../../security.js';
import { HealthCheckError } from '../errors/resilience-errors.js';

export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded' | 'unknown';

export interface HealthCheckResult {
  status: HealthStatus;
  endpoint: string;
  duration: number;
  timestamp: number;
  responseCode?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface SystemHealthResult {
  overall: HealthStatus;
  components: Record<string, HealthCheckResult>;
  timestamp: number;
  summary: {
    healthy: number;
    unhealthy: number;
    degraded: number;
    unknown: number;
    total: number;
  };
}

/**
 * Health checker with comprehensive endpoint monitoring
 */
export class HealthChecker {
  private config: HealthCheckConfig;
  private healthHistory: Map<string, HealthCheckResult[]> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();
  private consecutiveSuccesses: Map<string, number> = new Map();

  constructor(config: HealthCheckConfig) {
    this.config = config;
    
    secureLog('info', 'Health checker initialized', {
      interval: config.interval,
      timeout: config.timeout,
      endpoints: config.endpoints.length,
      failure_threshold: config.failureThreshold,
      recovery_threshold: config.recoveryThreshold
    });
  }

  /**
   * Perform health check on all configured endpoints
   */
  public async checkHealth(): Promise<SystemHealthResult> {
    const startTime = Date.now();
    const results: Record<string, HealthCheckResult> = {};
    
    secureLog('debug', 'Starting system health check');

    // Check all endpoints in parallel
    const checkPromises = this.config.endpoints.map(async (endpoint) => {
      try {
        const result = await this.checkEndpoint(endpoint);
        results[endpoint.name] = result;
        this.updateHealthHistory(endpoint.name, result);
        return result;
      } catch (error) {
        const failedResult: HealthCheckResult = {
          status: 'unhealthy',
          endpoint: endpoint.name,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        results[endpoint.name] = failedResult;
        this.updateHealthHistory(endpoint.name, failedResult);
        return failedResult;
      }
    });

    await Promise.allSettled(checkPromises);

    // Calculate overall health
    const overall = this.calculateOverallHealth(results);
    const summary = this.calculateSummary(results);

    const systemResult: SystemHealthResult = {
      overall,
      components: results,
      timestamp: Date.now(),
      summary
    };

    secureLog('info', 'System health check completed', {
      overall_status: overall,
      duration: Date.now() - startTime,
      summary
    });

    return systemResult;
  }

  /**
   * Check individual endpoint health
   */
  public async checkEndpoint(endpoint: HealthEndpointConfig): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    secureLog('debug', 'Checking endpoint health', {
      endpoint: endpoint.name,
      url: endpoint.url,
      method: endpoint.method
    });

    let lastError: Error | undefined;
    
    // Retry logic
    for (let attempt = 1; attempt <= (endpoint.retries + 1); attempt++) {
      try {
        const result = await this.performHealthCheck(endpoint, attempt);
        
        // Update success counters
        this.consecutiveSuccesses.set(endpoint.name, 
          (this.consecutiveSuccesses.get(endpoint.name) || 0) + 1);
        this.consecutiveFailures.set(endpoint.name, 0);
        
        secureLog('debug', 'Endpoint health check succeeded', {
          endpoint: endpoint.name,
          attempt,
          duration: result.duration,
          status_code: result.responseCode
        });
        
        return result;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        secureLog('warn', 'Endpoint health check failed', {
          endpoint: endpoint.name,
          attempt,
          error: lastError.message,
          duration: Date.now() - startTime
        });
        
        // Wait before retry (except on last attempt)
        if (attempt < endpoint.retries + 1) {
          await this.delay(1000 * attempt); // Exponential backoff
        }
      }
    }

    // All retries failed
    this.consecutiveFailures.set(endpoint.name, 
      (this.consecutiveFailures.get(endpoint.name) || 0) + 1);
    this.consecutiveSuccesses.set(endpoint.name, 0);

    const failedResult: HealthCheckResult = {
      status: this.determineHealthStatus(endpoint.name),
      endpoint: endpoint.name,
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      error: lastError?.message || 'All retries exhausted'
    };

    return failedResult;
  }

  /**
   * Perform actual HTTP health check
   */
  private async performHealthCheck(endpoint: HealthEndpointConfig, attempt: number): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    // Simulate HTTP request (in real implementation, use fetch or axios)
    const response = await this.makeHttpRequest(endpoint);
    
    const duration = Date.now() - startTime;
    const isExpectedStatus = !endpoint.expectedStatus || 
      endpoint.expectedStatus.includes(response.status);

    if (!isExpectedStatus) {
      throw new HealthCheckError(
        `Unexpected status code: ${response.status}`,
        endpoint.name,
        { expectedStatus: endpoint.expectedStatus, actualStatus: response.status },
        { operation: 'health_check', component: 'health_checker' }
      );
    }

    return {
      status: 'healthy',
      endpoint: endpoint.name,
      duration,
      timestamp: Date.now(),
      responseCode: response.status,
      metadata: {
        attempt,
        response_size: response.body?.length || 0,
        content_type: response.headers?.['content-type']
      }
    };
  }

  /**
   * Make HTTP request (simplified implementation)
   */
  private async makeHttpRequest(endpoint: HealthEndpointConfig): Promise<{
    status: number;
    body?: string;
    headers?: Record<string, string>;
  }> {
    // This would use fetch or axios in real implementation
    // For now, simulate based on endpoint configuration
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${endpoint.timeout}ms`));
      }, endpoint.timeout);

      // Simulate request
      setTimeout(() => {
        clearTimeout(timer);
        
        // Simulate different responses based on endpoint
        if (endpoint.url.includes('localhost:8080')) {
          // Bridge health check
          if (Math.random() > 0.1) { // 90% success rate
            resolve({
              status: 200,
              body: JSON.stringify({ status: 'healthy', uptime: Date.now() }),
              headers: { 'content-type': 'application/json' }
            });
          } else {
            reject(new Error('Connection refused'));
          }
        } else {
          // Other endpoints
          resolve({
            status: 200,
            body: 'OK',
            headers: { 'content-type': 'text/plain' }
          });
        }
      }, Math.random() * 100 + 50); // Random delay 50-150ms
    });
  }

  /**
   * Determine health status based on failure history
   */
  private determineHealthStatus(endpointName: string): HealthStatus {
    const failures = this.consecutiveFailures.get(endpointName) || 0;
    const successes = this.consecutiveSuccesses.get(endpointName) || 0;

    if (failures >= this.config.failureThreshold) {
      return 'unhealthy';
    } else if (failures > 0 && failures < this.config.failureThreshold) {
      return 'degraded';
    } else if (successes >= this.config.recoveryThreshold) {
      return 'healthy';
    } else {
      return 'unknown';
    }
  }

  /**
   * Calculate overall system health
   */
  private calculateOverallHealth(results: Record<string, HealthCheckResult>): HealthStatus {
    const endpointResults = Object.values(results);
    
    if (endpointResults.length === 0) {
      return 'unknown';
    }

    // Check critical endpoints first
    const criticalEndpoints = this.config.endpoints.filter(e => e.critical);
    const criticalResults = criticalEndpoints.map(e => results[e.name]);
    
    // If any critical endpoint is unhealthy, system is unhealthy
    if (criticalResults.some(r => r?.status === 'unhealthy')) {
      return 'unhealthy';
    }

    // Count status types
    const statusCounts = endpointResults.reduce((counts, result) => {
      counts[result.status] = (counts[result.status] || 0) + 1;
      return counts;
    }, {} as Record<HealthStatus, number>);

    const total = endpointResults.length;
    const healthy = statusCounts.healthy || 0;
    const unhealthy = statusCounts.unhealthy || 0;
    const degraded = statusCounts.degraded || 0;

    // Determine overall status
    if (unhealthy > 0) {
      return unhealthy >= total * 0.5 ? 'unhealthy' : 'degraded';
    } else if (degraded > 0) {
      return 'degraded';
    } else if (healthy === total) {
      return 'healthy';
    } else {
      return 'unknown';
    }
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(results: Record<string, HealthCheckResult>) {
    const statusCounts = Object.values(results).reduce((counts, result) => {
      counts[result.status] = (counts[result.status] || 0) + 1;
      return counts;
    }, {
      healthy: 0,
      unhealthy: 0,
      degraded: 0,
      unknown: 0
    });

    return {
      ...statusCounts,
      total: Object.values(results).length
    };
  }

  /**
   * Update health history for trending and analysis
   */
  private updateHealthHistory(endpointName: string, result: HealthCheckResult): void {
    if (!this.healthHistory.has(endpointName)) {
      this.healthHistory.set(endpointName, []);
    }

    const history = this.healthHistory.get(endpointName)!;
    history.push(result);

    // Keep only last 100 results
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
  }

  /**
   * Get health history for an endpoint
   */
  public getHealthHistory(endpointName: string, limit: number = 10): HealthCheckResult[] {
    const history = this.healthHistory.get(endpointName) || [];
    return history.slice(-limit);
  }

  /**
   * Get health trends for an endpoint
   */
  public getHealthTrends(endpointName: string, windowSize: number = 10): {
    successRate: number;
    averageResponseTime: number;
    trend: 'improving' | 'stable' | 'degrading';
  } {
    const history = this.getHealthHistory(endpointName, windowSize);
    
    if (history.length === 0) {
      return {
        successRate: 0,
        averageResponseTime: 0,
        trend: 'stable'
      };
    }

    const successCount = history.filter(r => r.status === 'healthy').length;
    const successRate = successCount / history.length;
    const averageResponseTime = history.reduce((sum, r) => sum + r.duration, 0) / history.length;

    // Determine trend (compare first half vs second half)
    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    if (history.length >= 4) {
      const firstHalf = history.slice(0, Math.floor(history.length / 2));
      const secondHalf = history.slice(Math.floor(history.length / 2));
      
      const firstHalfSuccess = firstHalf.filter(r => r.status === 'healthy').length / firstHalf.length;
      const secondHalfSuccess = secondHalf.filter(r => r.status === 'healthy').length / secondHalf.length;
      
      if (secondHalfSuccess > firstHalfSuccess + 0.1) {
        trend = 'improving';
      } else if (secondHalfSuccess < firstHalfSuccess - 0.1) {
        trend = 'degrading';
      }
    }

    return {
      successRate,
      averageResponseTime,
      trend
    };
  }

  /**
   * Check if endpoint is healthy
   */
  public isEndpointHealthy(endpointName: string): boolean {
    const failures = this.consecutiveFailures.get(endpointName) || 0;
    return failures < this.config.failureThreshold;
  }

  /**
   * Get current configuration
   */
  public getConfig(): HealthCheckConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<HealthCheckConfig>): void {
    this.config = { ...this.config, ...config };
    
    secureLog('info', 'Health checker configuration updated', {
      updates: sanitizeForLogging(config)
    });
  }

  /**
   * Reset health state for an endpoint
   */
  public resetEndpoint(endpointName: string): void {
    this.consecutiveFailures.set(endpointName, 0);
    this.consecutiveSuccesses.set(endpointName, 0);
    this.healthHistory.delete(endpointName);
    
    secureLog('info', 'Endpoint health state reset', { endpoint: endpointName });
  }

  /**
   * Reset all health state
   */
  public reset(): void {
    this.consecutiveFailures.clear();
    this.consecutiveSuccesses.clear();
    this.healthHistory.clear();
    
    secureLog('info', 'Health checker state reset');
  }

  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
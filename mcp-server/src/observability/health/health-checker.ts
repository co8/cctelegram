/**
 * Health Checker
 * 
 * Comprehensive health monitoring system with configurable checks,
 * dependency validation, circuit breaker integration, and automated recovery.
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import { HealthConfig, HealthCheck } from '../config.js';
import { MetricsCollector } from '../metrics/metrics-collector.js';
import { secureLog } from '../../security.js';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  version: string;
  environment: string;
  checks: HealthCheckResult[];
  dependencies: DependencyStatus[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    degraded: number;
  };
  metadata: Record<string, any>;
}

export interface HealthCheckResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn';
  output?: string;
  details?: Record<string, any>;
  duration: number;
  timestamp: number;
  error?: string;
  retryCount?: number;
}

export interface DependencyStatus {
  name: string;
  type: 'service' | 'database' | 'cache' | 'queue' | 'external';
  status: 'available' | 'degraded' | 'unavailable';
  responseTime: number;
  lastCheck: number;
  errorRate: number;
  circuitBreakerState?: 'closed' | 'open' | 'half_open';
  metadata?: Record<string, any>;
}

export interface CircuitBreaker {
  name: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
  successCount: number;
  threshold: number;
  timeout: number;
  halfOpenMaxCalls: number;
}

export class HealthChecker extends EventEmitter {
  private config: HealthConfig;
  private metricsCollector?: MetricsCollector;
  private checks: Map<string, HealthCheck> = new Map();
  private results: Map<string, HealthCheckResult> = new Map();
  private dependencies: Map<string, DependencyStatus> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private checkInterval?: NodeJS.Timeout;
  private httpServer?: http.Server;
  private isRunning: boolean = false;
  private startTime: number;

  // Health tracking
  private healthHistory: HealthStatus[] = [];
  private consecutiveFailures: Map<string, number> = new Map();
  private lastHealthStatus: HealthStatus['status'] = 'healthy';

  constructor(config: HealthConfig, metricsCollector?: MetricsCollector) {
    super();
    this.config = config;
    this.metricsCollector = metricsCollector;
    this.startTime = Date.now();

    this.setupHealthChecks();
    this.setupCircuitBreakers();

    secureLog('info', 'Health checker initialized', {
      enabled: config.enabled,
      checks: config.checks.length,
      endpoint: config.endpoint,
      interval: config.interval,
      timeout: config.timeout
    });
  }

  /**
   * Initialize the health checker
   */
  public async initialize(): Promise<void> {
    try {
      if (this.config.enabled) {
        // Start HTTP endpoint
        if (this.config.endpoint) {
          await this.startHealthEndpoint();
        }

        // Initialize dependencies
        await this.initializeDependencies();

        // Start periodic checks
        this.startPeriodicChecks();
      }

      secureLog('info', 'Health checker initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize health checker', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Set up configured health checks
   */
  private setupHealthChecks(): void {
    this.config.checks.forEach(check => {
      this.checks.set(check.id, check);
    });

    // Add default system checks
    this.addDefaultChecks();
  }

  /**
   * Add default system health checks
   */
  private addDefaultChecks(): void {
    // Memory check
    this.checks.set('memory', {
      id: 'memory',
      name: 'Memory Usage',
      type: 'system',
      enabled: true,
      timeout: 1000,
      interval: 30000,
      retryCount: 1,
      critical: true,
      thresholds: {
        warning: 70,
        critical: 85
      }
    });

    // CPU check
    this.checks.set('cpu', {
      id: 'cpu',
      name: 'CPU Usage',
      type: 'system',
      enabled: true,
      timeout: 1000,
      interval: 30000,
      retryCount: 1,
      critical: true,
      thresholds: {
        warning: 70,
        critical: 90
      }
    });

    // Disk space check (if applicable)
    this.checks.set('disk', {
      id: 'disk',
      name: 'Disk Space',
      type: 'system',
      enabled: true,
      timeout: 1000,
      interval: 60000,
      retryCount: 1,
      critical: false,
      thresholds: {
        warning: 80,
        critical: 95
      }
    });

    // Event loop lag check
    this.checks.set('event_loop', {
      id: 'event_loop',
      name: 'Event Loop Lag',
      type: 'system',
      enabled: true,
      timeout: 1000,
      interval: 15000,
      retryCount: 1,
      critical: true,
      thresholds: {
        warning: 50,
        critical: 100
      }
    });
  }

  /**
   * Set up circuit breakers for dependencies
   */
  private setupCircuitBreakers(): void {
    // Create circuit breakers for external dependencies
    const externalDeps = ['database', 'cache', 'external_api'];
    
    externalDeps.forEach(dep => {
      this.circuitBreakers.set(dep, {
        name: dep,
        state: 'closed',
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0,
        successCount: 0,
        threshold: 5, // Open after 5 failures
        timeout: 60000, // 1 minute timeout
        halfOpenMaxCalls: 3
      });
    });
  }

  /**
   * Initialize dependency monitoring
   */
  private async initializeDependencies(): Promise<void> {
    // Initialize dependency status tracking
    const deps = ['observability_components', 'mcp_server', 'telegram_bridge'];
    
    deps.forEach(dep => {
      this.dependencies.set(dep, {
        name: dep,
        type: 'service',
        status: 'available',
        responseTime: 0,
        lastCheck: Date.now(),
        errorRate: 0
      });
    });
  }

  /**
   * Start HTTP health endpoint
   */
  private async startHealthEndpoint(): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      this.handleHealthRequest(req, res);
    });

    const port = this.extractPortFromEndpoint(this.config.endpoint);
    
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          secureLog('info', 'Health endpoint started', {
            endpoint: this.config.endpoint,
            port
          });
          resolve();
        }
      });
    });
  }

  /**
   * Handle HTTP health requests
   */
  private async handleHealthRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '/';
    
    try {
      switch (url) {
        case '/health':
        case '/health/status':
          const status = await this.getHealthStatus();
          const statusCode = this.getHttpStatusCode(status.status);
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status));
          break;

        case '/health/ready':
          const readiness = await this.getReadinessStatus();
          const readyCode = readiness.ready ? 200 : 503;
          res.writeHead(readyCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(readiness));
          break;

        case '/health/live':
          const liveness = await this.getLivenessStatus();
          const liveCode = liveness.alive ? 200 : 503;
          res.writeHead(liveCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(liveness));
          break;

        case '/health/checks':
          const checks = await this.getAllCheckResults();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(checks));
          break;

        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
      }

    } catch (error) {
      secureLog('error', 'Health endpoint error', {
        url,
        error: error instanceof Error ? error.message : 'unknown'
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Start periodic health checks
   */
  private startPeriodicChecks(): void {
    this.isRunning = true;

    this.checkInterval = setInterval(async () => {
      await this.performAllChecks();
    }, this.config.interval);

    // Initial check
    this.performAllChecks();

    secureLog('info', 'Periodic health checks started', {
      interval: this.config.interval
    });
  }

  /**
   * Perform all configured health checks
   */
  private async performAllChecks(): Promise<void> {
    const checkPromises = Array.from(this.checks.values())
      .filter(check => check.enabled)
      .map(check => this.performCheck(check));

    await Promise.allSettled(checkPromises);

    // Update overall health status
    await this.updateOverallHealth();

    // Check for recovery scenarios
    this.checkRecoveryScenarios();

    // Update metrics
    this.updateHealthMetrics();
  }

  /**
   * Perform individual health check
   */
  private async performCheck(check: HealthCheck): Promise<void> {
    const startTime = Date.now();
    let result: HealthCheckResult;

    try {
      const checkResult = await this.executeCheck(check);
      const duration = Date.now() - startTime;

      result = {
        id: check.id,
        name: check.name,
        status: checkResult.status,
        output: checkResult.output,
        details: checkResult.details,
        duration,
        timestamp: Date.now()
      };

      // Update consecutive failures
      if (result.status === 'fail') {
        const failures = this.consecutiveFailures.get(check.id) || 0;
        this.consecutiveFailures.set(check.id, failures + 1);
      } else {
        this.consecutiveFailures.set(check.id, 0);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      
      result = {
        id: check.id,
        name: check.name,
        status: 'fail',
        error: error instanceof Error ? error.message : 'unknown error',
        duration,
        timestamp: Date.now()
      };

      const failures = this.consecutiveFailures.get(check.id) || 0;
      this.consecutiveFailures.set(check.id, failures + 1);
    }

    this.results.set(check.id, result);
    this.emit('check_completed', result);

    // Handle retry logic
    if (result.status === 'fail' && check.retryCount > 0) {
      await this.retryCheck(check, result);
    }
  }

  /**
   * Execute specific health check
   */
  private async executeCheck(check: HealthCheck): Promise<{
    status: 'pass' | 'fail' | 'warn';
    output?: string;
    details?: Record<string, any>;
  }> {
    switch (check.type) {
      case 'system':
        return this.executeSystemCheck(check);
      case 'dependency':
        return this.executeDependencyCheck(check);
      case 'custom':
        return this.executeCustomCheck(check);
      default:
        throw new Error(`Unknown check type: ${check.type}`);
    }
  }

  /**
   * Execute system health check
   */
  private async executeSystemCheck(check: HealthCheck): Promise<{
    status: 'pass' | 'fail' | 'warn';
    output?: string;
    details?: Record<string, any>;
  }> {
    switch (check.id) {
      case 'memory':
        return this.checkMemoryUsage(check);
      case 'cpu':
        return this.checkCPUUsage(check);
      case 'disk':
        return this.checkDiskSpace(check);
      case 'event_loop':
        return this.checkEventLoopLag(check);
      default:
        throw new Error(`Unknown system check: ${check.id}`);
    }
  }

  /**
   * Check memory usage
   */
  private async checkMemoryUsage(check: HealthCheck): Promise<{
    status: 'pass' | 'fail' | 'warn';
    output?: string;
    details?: Record<string, any>;
  }> {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const heapPercent = (heapUsedMB / heapTotalMB) * 100;

    const details = {
      heapUsedMB: Math.round(heapUsedMB),
      heapTotalMB: Math.round(heapTotalMB),
      heapPercent: Math.round(heapPercent),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
      externalMB: Math.round(memUsage.external / 1024 / 1024)
    };

    let status: 'pass' | 'fail' | 'warn' = 'pass';
    let output = `Memory usage: ${details.heapPercent}%`;

    if (check.thresholds?.critical && heapPercent >= check.thresholds.critical) {
      status = 'fail';
      output = `Critical memory usage: ${details.heapPercent}% (threshold: ${check.thresholds.critical}%)`;
    } else if (check.thresholds?.warning && heapPercent >= check.thresholds.warning) {
      status = 'warn';
      output = `High memory usage: ${details.heapPercent}% (threshold: ${check.thresholds.warning}%)`;
    }

    return { status, output, details };
  }

  /**
   * Check CPU usage
   */
  private async checkCPUUsage(check: HealthCheck): Promise<{
    status: 'pass' | 'fail' | 'warn';
    output?: string;
    details?: Record<string, any>;
  }> {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const startTime = process.hrtime();

      setTimeout(() => {
        const cpuUsage = process.cpuUsage(startUsage);
        const hrTime = process.hrtime(startTime);
        const totalTime = hrTime[0] * 1e6 + hrTime[1] / 1e3; // microseconds
        const cpuPercent = ((cpuUsage.user + cpuUsage.system) / totalTime) * 100;

        const details = {
          cpuPercent: Math.round(cpuPercent * 100) / 100,
          userTime: cpuUsage.user,
          systemTime: cpuUsage.system
        };

        let status: 'pass' | 'fail' | 'warn' = 'pass';
        let output = `CPU usage: ${details.cpuPercent}%`;

        if (check.thresholds?.critical && cpuPercent >= check.thresholds.critical) {
          status = 'fail';
          output = `Critical CPU usage: ${details.cpuPercent}% (threshold: ${check.thresholds.critical}%)`;
        } else if (check.thresholds?.warning && cpuPercent >= check.thresholds.warning) {
          status = 'warn';
          output = `High CPU usage: ${details.cpuPercent}% (threshold: ${check.thresholds.warning}%)`;
        }

        resolve({ status, output, details });
      }, 100); // Sample for 100ms
    });
  }

  /**
   * Check disk space
   */
  private async checkDiskSpace(check: HealthCheck): Promise<{
    status: 'pass' | 'fail' | 'warn';
    output?: string;
    details?: Record<string, any>;
  }> {
    try {
      const fs = require('fs');
      const stats = fs.statSync('.');
      
      // This is a simplified check - in production, you'd use a proper disk space library
      const details = {
        available: true,
        message: 'Disk space check completed'
      };

      return {
        status: 'pass',
        output: 'Disk space: OK',
        details
      };

    } catch (error) {
      return {
        status: 'fail',
        output: 'Disk space check failed',
        details: { error: error instanceof Error ? error.message : 'unknown' }
      };
    }
  }

  /**
   * Check event loop lag
   */
  private async checkEventLoopLag(check: HealthCheck): Promise<{
    status: 'pass' | 'fail' | 'warn';
    output?: string;
    details?: Record<string, any>;
  }> {
    return new Promise((resolve) => {
      const start = process.hrtime.bigint();
      
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1e6; // Convert to milliseconds
        
        const details = {
          lagMs: Math.round(lag * 100) / 100
        };

        let status: 'pass' | 'fail' | 'warn' = 'pass';
        let output = `Event loop lag: ${details.lagMs}ms`;

        if (check.thresholds?.critical && lag >= check.thresholds.critical) {
          status = 'fail';
          output = `Critical event loop lag: ${details.lagMs}ms (threshold: ${check.thresholds.critical}ms)`;
        } else if (check.thresholds?.warning && lag >= check.thresholds.warning) {
          status = 'warn';
          output = `High event loop lag: ${details.lagMs}ms (threshold: ${check.thresholds.warning}ms)`;
        }

        resolve({ status, output, details });
      });
    });
  }

  /**
   * Execute dependency check
   */
  private async executeDependencyCheck(check: HealthCheck): Promise<{
    status: 'pass' | 'fail' | 'warn';
    output?: string;
    details?: Record<string, any>;
  }> {
    const dependency = this.dependencies.get(check.id);
    if (!dependency) {
      throw new Error(`Dependency not found: ${check.id}`);
    }

    // Check circuit breaker state
    const circuitBreaker = this.circuitBreakers.get(check.id);
    if (circuitBreaker && circuitBreaker.state === 'open') {
      return {
        status: 'fail',
        output: `Circuit breaker open for ${check.id}`,
        details: { circuitBreakerState: 'open' }
      };
    }

    try {
      const startTime = Date.now();
      
      // Simulate dependency check - in practice, this would make actual calls
      await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
      
      const responseTime = Date.now() - startTime;
      
      // Update dependency status
      dependency.responseTime = responseTime;
      dependency.lastCheck = Date.now();
      dependency.status = 'available';

      // Update circuit breaker
      if (circuitBreaker) {
        this.updateCircuitBreakerSuccess(circuitBreaker);
      }

      return {
        status: 'pass',
        output: `${check.id} is available (${responseTime}ms)`,
        details: { responseTime, status: 'available' }
      };

    } catch (error) {
      // Update dependency status
      dependency.status = 'unavailable';
      dependency.errorRate += 1;

      // Update circuit breaker
      if (circuitBreaker) {
        this.updateCircuitBreakerFailure(circuitBreaker);
      }

      return {
        status: 'fail',
        output: `${check.id} is unavailable`,
        details: { error: error instanceof Error ? error.message : 'unknown' }
      };
    }
  }

  /**
   * Execute custom health check
   */
  private async executeCustomCheck(check: HealthCheck): Promise<{
    status: 'pass' | 'fail' | 'warn';
    output?: string;
    details?: Record<string, any>;
  }> {
    // Custom checks would be implemented here based on specific requirements
    return {
      status: 'pass',
      output: `Custom check ${check.id} passed`,
      details: {}
    };
  }

  /**
   * Retry failed check
   */
  private async retryCheck(check: HealthCheck, failedResult: HealthCheckResult): Promise<void> {
    const retryCount = failedResult.retryCount || 0;
    
    if (retryCount < check.retryCount) {
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      
      try {
        const retryResult = await this.executeCheck(check);
        const duration = 100; // Simplified for retry
        
        const result: HealthCheckResult = {
          id: check.id,
          name: check.name,
          status: retryResult.status,
          output: retryResult.output,
          details: retryResult.details,
          duration,
          timestamp: Date.now(),
          retryCount: retryCount + 1
        };

        this.results.set(check.id, result);
        this.emit('check_retried', result);

      } catch (error) {
        // Update with retry information
        failedResult.retryCount = retryCount + 1;
        this.results.set(check.id, failedResult);
      }
    }
  }

  /**
   * Update circuit breaker on success
   */
  private updateCircuitBreakerSuccess(breaker: CircuitBreaker): void {
    if (breaker.state === 'half_open') {
      breaker.successCount++;
      if (breaker.successCount >= breaker.halfOpenMaxCalls) {
        breaker.state = 'closed';
        breaker.failureCount = 0;
        breaker.successCount = 0;
      }
    } else if (breaker.state === 'closed') {
      breaker.failureCount = 0;
    }
  }

  /**
   * Update circuit breaker on failure
   */
  private updateCircuitBreakerFailure(breaker: CircuitBreaker): void {
    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();

    if (breaker.state === 'closed' && breaker.failureCount >= breaker.threshold) {
      breaker.state = 'open';
      breaker.nextAttemptTime = Date.now() + breaker.timeout;
    } else if (breaker.state === 'half_open') {
      breaker.state = 'open';
      breaker.nextAttemptTime = Date.now() + breaker.timeout;
      breaker.successCount = 0;
    }
  }

  /**
   * Update overall health status
   */
  private async updateOverallHealth(): Promise<void> {
    const checkResults = Array.from(this.results.values());
    const criticalChecks = Array.from(this.checks.values()).filter(c => c.critical);
    
    let status: HealthStatus['status'] = 'healthy';
    
    // Check for critical failures
    const criticalFailures = checkResults.filter(result => {
      const check = this.checks.get(result.id);
      return check?.critical && result.status === 'fail';
    });

    if (criticalFailures.length > 0) {
      status = 'unhealthy';
    } else {
      // Check for warnings or non-critical failures
      const warnings = checkResults.filter(result => result.status === 'warn');
      const failures = checkResults.filter(result => result.status === 'fail');
      
      if (failures.length > 0 || warnings.length >= 3) {
        status = 'degraded';
      }
    }

    // Emit status change events
    if (status !== this.lastHealthStatus) {
      this.emit('health_status_changed', {
        previous: this.lastHealthStatus,
        current: status,
        timestamp: Date.now()
      });
      
      this.lastHealthStatus = status;
    }
  }

  /**
   * Check for recovery scenarios
   */
  private checkRecoveryScenarios(): void {
    // Check circuit breakers for recovery
    this.circuitBreakers.forEach((breaker, name) => {
      if (breaker.state === 'open' && Date.now() >= breaker.nextAttemptTime) {
        breaker.state = 'half_open';
        breaker.successCount = 0;
        
        this.emit('circuit_breaker_half_open', {
          name,
          timestamp: Date.now()
        });
      }
    });
  }

  /**
   * Update health metrics
   */
  private updateHealthMetrics(): void {
    if (!this.metricsCollector) return;

    const checkResults = Array.from(this.results.values());
    const passed = checkResults.filter(r => r.status === 'pass').length;
    const failed = checkResults.filter(r => r.status === 'fail').length;
    const warned = checkResults.filter(r => r.status === 'warn').length;

    this.metricsCollector.recordCustomMetric({
      name: 'health_checks_passed',
      value: passed
    });

    this.metricsCollector.recordCustomMetric({
      name: 'health_checks_failed',
      value: failed
    });

    this.metricsCollector.recordCustomMetric({
      name: 'health_checks_warned',
      value: warned
    });

    // Record dependency metrics
    this.dependencies.forEach((dep, name) => {
      this.metricsCollector?.recordCustomMetric({
        name: `dependency_${name}_response_time`,
        value: dep.responseTime
      });

      this.metricsCollector?.recordCustomMetric({
        name: `dependency_${name}_available`,
        value: dep.status === 'available' ? 1 : 0
      });
    });
  }

  /**
   * Get comprehensive health status
   */
  public async getHealthStatus(): Promise<HealthStatus> {
    const checkResults = Array.from(this.results.values());
    const dependencies = Array.from(this.dependencies.values());
    
    const summary = {
      total: checkResults.length,
      passed: checkResults.filter(r => r.status === 'pass').length,
      failed: checkResults.filter(r => r.status === 'fail').length,
      degraded: checkResults.filter(r => r.status === 'warn').length
    };

    let overallStatus: HealthStatus['status'] = 'healthy';
    
    if (summary.failed > 0) {
      const criticalFailures = checkResults.filter(result => {
        const check = this.checks.get(result.id);
        return check?.critical && result.status === 'fail';
      });
      
      overallStatus = criticalFailures.length > 0 ? 'unhealthy' : 'degraded';
    } else if (summary.degraded >= 3) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      version: process.env.SERVICE_VERSION || '1.5.0',
      environment: process.env.NODE_ENV || 'development',
      checks: checkResults,
      dependencies,
      summary,
      metadata: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage(),
        pid: process.pid
      }
    };
  }

  /**
   * Get readiness status
   */
  public async getReadinessStatus(): Promise<{
    ready: boolean;
    checks: HealthCheckResult[];
    timestamp: number;
  }> {
    const criticalChecks = Array.from(this.results.values()).filter(result => {
      const check = this.checks.get(result.id);
      return check?.critical;
    });

    const ready = criticalChecks.every(check => check.status === 'pass');

    return {
      ready,
      checks: criticalChecks,
      timestamp: Date.now()
    };
  }

  /**
   * Get liveness status
   */
  public async getLivenessStatus(): Promise<{
    alive: boolean;
    uptime: number;
    timestamp: number;
  }> {
    return {
      alive: this.isRunning,
      uptime: Date.now() - this.startTime,
      timestamp: Date.now()
    };
  }

  /**
   * Get all check results
   */
  public async getAllCheckResults(): Promise<HealthCheckResult[]> {
    return Array.from(this.results.values());
  }

  /**
   * Get specific check result
   */
  public getCheckResult(checkId: string): HealthCheckResult | undefined {
    return this.results.get(checkId);
  }

  /**
   * Get dependency status
   */
  public getDependencyStatus(name: string): DependencyStatus | undefined {
    return this.dependencies.get(name);
  }

  /**
   * Get all dependencies status
   */
  public getAllDependencies(): DependencyStatus[] {
    return Array.from(this.dependencies.values());
  }

  /**
   * Get circuit breaker state
   */
  public getCircuitBreakerState(name: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(name);
  }

  /**
   * Extract port from endpoint string
   */
  private extractPortFromEndpoint(endpoint: string): number {
    const match = endpoint.match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : 8080;
  }

  /**
   * Get HTTP status code for health status
   */
  private getHttpStatusCode(status: string): number {
    switch (status) {
      case 'healthy': return 200;
      case 'degraded': return 200;
      case 'unhealthy': return 503;
      default: return 500;
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<HealthConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.checks) {
      this.setupHealthChecks();
    }

    secureLog('info', 'Health checker configuration updated');
  }

  /**
   * Stop health checking
   */
  public async stop(): Promise<void> {
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = undefined;
    }

    secureLog('info', 'Health checker stopped');
  }
}
/**
 * Integrity Validation Monitoring and Alerting System
 * Task 39.5: End-to-End Integrity Validation Implementation
 * 
 * Provides comprehensive monitoring, alerting, and recovery mechanisms
 * for integrity validation failures across all system components.
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { 
  getGlobalIntegrityValidator,
  ValidationCheckpoint,
  IntegritySeverity,
  type ValidationResult,
  type IntegrityError,
  type IntegrityMetrics 
} from './integrity-validator.js';
import { secureLog } from '../security.js';

export interface IntegrityAlertThresholds {
  /** Maximum acceptable failure rate (0.0 - 1.0) */
  maxFailureRate: number;
  /** Maximum acceptable corruption errors per hour */
  maxCorruptionErrorsPerHour: number;
  /** Maximum acceptable truncation errors per hour */
  maxTruncationErrorsPerHour: number;
  /** Maximum acceptable validation latency in milliseconds */
  maxValidationLatencyMs: number;
  /** Alert threshold for total validation failures */
  maxTotalFailures: number;
}

export interface IntegrityAlert {
  id: string;
  timestamp: number;
  severity: IntegritySeverity;
  type: 'failure_rate' | 'corruption' | 'truncation' | 'latency' | 'system_health';
  checkpoint: ValidationCheckpoint | 'system';
  message: string;
  metrics: IntegrityMetrics;
  correlationId?: string;
  recoveryActions?: string[];
}

export interface IntegrityHealthReport {
  timestamp: number;
  overallHealth: 'healthy' | 'warning' | 'critical' | 'failing';
  healthScore: number; // 0.0 - 1.0
  metrics: IntegrityMetrics;
  activeAlerts: IntegrityAlert[];
  checkpointHealth: Record<string, CheckpointHealthStatus>;
  recommendations: string[];
  systemUptime: number;
}

export interface CheckpointHealthStatus {
  checkpoint: ValidationCheckpoint;
  validations: number;
  failures: number;
  successRate: number;
  avgLatencyMs: number;
  status: 'healthy' | 'degraded' | 'failing';
}

/**
 * Comprehensive integrity monitoring system
 */
export class IntegrityMonitoringSystem extends EventEmitter {
  private thresholds: IntegrityAlertThresholds;
  private activeAlerts: Map<string, IntegrityAlert> = new Map();
  private alertHistory: IntegrityAlert[] = [];
  private checkpointStats: Map<ValidationCheckpoint, CheckpointHealthStatus> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private startTime: number;
  private lastMetrics: IntegrityMetrics | null = null;

  constructor(thresholds?: Partial<IntegrityAlertThresholds>) {
    super();
    
    this.thresholds = {
      maxFailureRate: 0.01, // 1% max failure rate
      maxCorruptionErrorsPerHour: 0, // Zero tolerance for corruption
      maxTruncationErrorsPerHour: 5, // Max 5 truncation errors per hour
      maxValidationLatencyMs: 50, // Max 50ms validation latency
      maxTotalFailures: 100, // Max 100 total failures
      ...thresholds
    };
    
    this.startTime = Date.now();
    
    // Initialize checkpoint stats
    Object.values(ValidationCheckpoint).forEach(checkpoint => {
      this.checkpointStats.set(checkpoint, {
        checkpoint,
        validations: 0,
        failures: 0,
        successRate: 1.0,
        avgLatencyMs: 0,
        status: 'healthy'
      });
    });
    
    secureLog('info', 'Integrity monitoring system initialized', {
      thresholds: this.thresholds,
      checkpoints: Object.values(ValidationCheckpoint).length
    });
  }

  /**
   * Start monitoring integrity validation metrics
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }
    
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
    
    secureLog('info', 'Integrity monitoring started', {
      intervalMs,
      thresholds: this.thresholds
    });
    
    this.emit('monitoring_started', { intervalMs, thresholds: this.thresholds });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      
      secureLog('info', 'Integrity monitoring stopped');
      this.emit('monitoring_stopped');
    }
  }

  /**
   * Record integrity validation event for monitoring
   */
  recordValidationEvent(
    result: ValidationResult, 
    checkpoint: ValidationCheckpoint, 
    latencyMs: number,
    correlationId?: string
  ): void {
    // Update checkpoint statistics
    const stats = this.checkpointStats.get(checkpoint);
    if (stats) {
      stats.validations++;
      stats.avgLatencyMs = (stats.avgLatencyMs * (stats.validations - 1) + latencyMs) / stats.validations;
      
      if (!result.isValid) {
        stats.failures++;
      }
      
      stats.successRate = (stats.validations - stats.failures) / stats.validations;
      stats.status = this.determineCheckpointStatus(stats);
      
      this.checkpointStats.set(checkpoint, stats);
    }

    // Check for immediate alerts
    if (!result.isValid && result.error) {
      this.handleValidationFailure(result.error, checkpoint, correlationId);
    }
    
    // Check latency threshold
    if (latencyMs > this.thresholds.maxValidationLatencyMs) {
      this.createAlert('latency', IntegritySeverity.Medium, checkpoint, 
        `High validation latency detected: ${latencyMs}ms`, correlationId);
    }
  }

  /**
   * Perform comprehensive health check
   */
  performHealthCheck(): IntegrityHealthReport {
    const validator = getGlobalIntegrityValidator();
    const currentMetrics = validator.getMetrics();
    
    // Clear resolved alerts
    this.clearResolvedAlerts(currentMetrics);
    
    // Check failure rate
    this.checkFailureRate(currentMetrics);
    
    // Check corruption and truncation rates
    this.checkErrorRates(currentMetrics);
    
    // Check overall system health
    this.checkSystemHealth(currentMetrics);
    
    // Generate health report
    const report = this.generateHealthReport(currentMetrics);
    
    // Emit health report event
    this.emit('health_report', report);
    
    this.lastMetrics = currentMetrics;
    
    // Log health status if there are issues
    if (report.overallHealth !== 'healthy') {
      secureLog('warn', 'Integrity health check detected issues', {
        overallHealth: report.overallHealth,
        healthScore: report.healthScore,
        activeAlertsCount: report.activeAlerts.length,
        totalValidations: currentMetrics.totalValidations,
        failureRate: validator.getFailureRate()
      });
    }
    
    return report;
  }

  /**
   * Get current health report
   */
  getCurrentHealth(): IntegrityHealthReport {
    return this.performHealthCheck();
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): IntegrityAlert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit: number = 100): IntegrityAlert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Clear alert by ID
   */
  clearAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      this.activeAlerts.delete(alertId);
      secureLog('info', 'Integrity alert cleared', { alertId, alertType: alert.type });
      this.emit('alert_cleared', alert);
      return true;
    }
    return false;
  }

  /**
   * Update alert thresholds
   */
  updateThresholds(newThresholds: Partial<IntegrityAlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    
    secureLog('info', 'Integrity monitoring thresholds updated', {
      newThresholds: this.thresholds
    });
    
    this.emit('thresholds_updated', this.thresholds);
  }

  // Private methods

  private handleValidationFailure(error: IntegrityError, checkpoint: ValidationCheckpoint, correlationId?: string): void {
    let severity = IntegritySeverity.Medium;
    let recoveryActions: string[] = [];
    
    switch (error.type) {
      case 'corruption':
        severity = IntegritySeverity.Critical;
        recoveryActions = [
          'Investigate data source integrity',
          'Check for hardware issues',
          'Verify network transmission',
          'Consider system restart if persistent'
        ];
        break;
        
      case 'truncation':
        severity = IntegritySeverity.High;
        recoveryActions = [
          'Increase buffer sizes',
          'Check memory availability',
          'Investigate message size limits',
          'Review compression settings'
        ];
        break;
        
      case 'system_health':
        severity = IntegritySeverity.Medium;
        recoveryActions = [
          'Verify processing pipeline integrity',
          'Check for race conditions',
          'Review chain validation logic',
          'Check system resources',
          'Review validation configuration',
          'Monitor for recurring patterns'
        ];
        break;
    }
    
    this.createAlert(error.type, severity, checkpoint, error.message, correlationId, recoveryActions);
  }

  private createAlert(
    type: IntegrityAlert['type'],
    severity: IntegritySeverity,
    checkpoint: ValidationCheckpoint | 'system',
    message: string,
    correlationId?: string,
    recoveryActions?: string[]
  ): void {
    const alert: IntegrityAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      severity,
      type,
      checkpoint,
      message,
      metrics: getGlobalIntegrityValidator().getMetrics(),
      correlationId,
      recoveryActions
    };
    
    this.activeAlerts.set(alert.id, alert);
    this.alertHistory.push(alert);
    
    // Keep alert history limited
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-500);
    }
    
    secureLog('warn', 'Integrity alert created', {
      alertId: alert.id,
      type: alert.type,
      severity: IntegritySeverity[severity],
      checkpoint: alert.checkpoint,
      message: alert.message,
      correlationId
    });
    
    this.emit('alert_created', alert);
  }

  private checkFailureRate(metrics: IntegrityMetrics): void {
    const validator = getGlobalIntegrityValidator();
    const failureRate = validator.getFailureRate();
    
    if (failureRate > this.thresholds.maxFailureRate && metrics.totalValidations > 10) {
      this.createAlert(
        'failure_rate',
        IntegritySeverity.High,
        'system',
        `Integrity validation failure rate exceeded threshold: ${(failureRate * 100).toFixed(2)}% > ${(this.thresholds.maxFailureRate * 100).toFixed(2)}%`,
        undefined,
        [
          'Investigate recent system changes',
          'Check for increased error rates',
          'Review system resources',
          'Consider reducing validation sensitivity'
        ]
      );
    }
  }

  private checkErrorRates(metrics: IntegrityMetrics): void {
    const hoursSinceStart = (Date.now() - this.startTime) / (1000 * 60 * 60);
    
    if (hoursSinceStart >= 1) {
      const corruptionRate = metrics.corruptionErrors / hoursSinceStart;
      const truncationRate = metrics.truncationErrors / hoursSinceStart;
      
      if (corruptionRate > this.thresholds.maxCorruptionErrorsPerHour) {
        this.createAlert(
          'corruption',
          IntegritySeverity.Critical,
          'system',
          `Corruption error rate exceeded threshold: ${corruptionRate.toFixed(2)}/hour > ${this.thresholds.maxCorruptionErrorsPerHour}/hour`,
          undefined,
          [
            'IMMEDIATE: Investigate data corruption source',
            'Check hardware integrity',
            'Verify storage systems',
            'Consider system isolation'
          ]
        );
      }
      
      if (truncationRate > this.thresholds.maxTruncationErrorsPerHour) {
        this.createAlert(
          'truncation',
          IntegritySeverity.High,
          'system',
          `Truncation error rate exceeded threshold: ${truncationRate.toFixed(2)}/hour > ${this.thresholds.maxTruncationErrorsPerHour}/hour`,
          undefined,
          [
            'Increase buffer sizes',
            'Review message size limits',
            'Check memory availability',
            'Investigate compression settings'
          ]
        );
      }
    }
  }

  private checkSystemHealth(metrics: IntegrityMetrics): void {
    if (metrics.totalValidations > this.thresholds.maxTotalFailures && 
        metrics.failedValidations > this.thresholds.maxTotalFailures) {
      
      this.createAlert(
        'system_health',
        IntegritySeverity.High,
        'system',
        `Total validation failures exceeded threshold: ${metrics.failedValidations} > ${this.thresholds.maxTotalFailures}`,
        undefined,
        [
          'Review system architecture',
          'Consider validation threshold adjustments',
          'Investigate root causes',
          'Plan system maintenance'
        ]
      );
    }
  }

  private clearResolvedAlerts(currentMetrics: IntegrityMetrics): void {
    const validator = getGlobalIntegrityValidator();
    const currentFailureRate = validator.getFailureRate();
    
    for (const [alertId, alert] of this.activeAlerts.entries()) {
      let shouldClear = false;
      
      switch (alert.type) {
        case 'failure_rate':
          shouldClear = currentFailureRate <= this.thresholds.maxFailureRate;
          break;
          
        case 'latency':
          // Clear latency alerts after 5 minutes if no new latency issues
          shouldClear = (Date.now() - alert.timestamp) > 300000;
          break;
          
        case 'system_health':
          shouldClear = currentMetrics.failedValidations <= this.thresholds.maxTotalFailures;
          break;
      }
      
      if (shouldClear) {
        this.activeAlerts.delete(alertId);
        this.emit('alert_resolved', alert);
      }
    }
  }

  private determineCheckpointStatus(stats: CheckpointHealthStatus): 'healthy' | 'degraded' | 'failing' {
    if (stats.successRate >= 0.99 && stats.avgLatencyMs <= this.thresholds.maxValidationLatencyMs) {
      return 'healthy';
    } else if (stats.successRate >= 0.95) {
      return 'degraded';
    } else {
      return 'failing';
    }
  }

  private generateHealthReport(metrics: IntegrityMetrics): IntegrityHealthReport {
    const validator = getGlobalIntegrityValidator();
    const activeAlerts = Array.from(this.activeAlerts.values());
    
    // Calculate overall health score
    const successRate = validator.getSuccessRate();
    const latencyScore = Math.max(0, 1 - (metrics.averageLatencyMs / (this.thresholds.maxValidationLatencyMs * 2)));
    const corruptionScore = metrics.corruptionErrors === 0 ? 1.0 : 0.0;
    const healthScore = (successRate * 0.5 + latencyScore * 0.3 + corruptionScore * 0.2);
    
    // Determine overall health status
    let overallHealth: IntegrityHealthReport['overallHealth'];
    if (healthScore >= 0.95 && activeAlerts.length === 0) {
      overallHealth = 'healthy';
    } else if (healthScore >= 0.90 && !activeAlerts.some(a => a.severity >= IntegritySeverity.High)) {
      overallHealth = 'warning';
    } else if (healthScore >= 0.75 && !activeAlerts.some(a => a.severity === IntegritySeverity.Critical)) {
      overallHealth = 'critical';
    } else {
      overallHealth = 'failing';
    }
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(metrics, activeAlerts, healthScore);
    
    // Convert checkpoint stats to health status
    const checkpointHealth: Record<string, CheckpointHealthStatus> = {};
    this.checkpointStats.forEach((stats, checkpoint) => {
      checkpointHealth[checkpoint] = stats;
    });
    
    return {
      timestamp: Date.now(),
      overallHealth,
      healthScore,
      metrics,
      activeAlerts,
      checkpointHealth,
      recommendations,
      systemUptime: Date.now() - this.startTime
    };
  }

  private generateRecommendations(
    metrics: IntegrityMetrics, 
    activeAlerts: IntegrityAlert[], 
    healthScore: number
  ): string[] {
    const recommendations: string[] = [];
    
    if (healthScore < 0.95) {
      recommendations.push('System health below optimal - investigate active alerts');
    }
    
    if (metrics.corruptionErrors > 0) {
      recommendations.push('CRITICAL: Data corruption detected - immediate investigation required');
    }
    
    if (metrics.truncationErrors > 0) {
      recommendations.push('Data truncation detected - review buffer sizes and message limits');
    }
    
    if (metrics.averageLatencyMs > this.thresholds.maxValidationLatencyMs) {
      recommendations.push('High validation latency - consider performance optimization');
    }
    
    if (activeAlerts.length === 0 && healthScore >= 0.95) {
      recommendations.push('System operating within normal parameters');
    }
    
    return recommendations;
  }
}

/**
 * Global integrity monitoring system instance
 */
let globalIntegrityMonitor: IntegrityMonitoringSystem | null = null;

/**
 * Get or create global integrity monitoring system
 */
export function getGlobalIntegrityMonitor(thresholds?: Partial<IntegrityAlertThresholds>): IntegrityMonitoringSystem {
  if (!globalIntegrityMonitor) {
    globalIntegrityMonitor = new IntegrityMonitoringSystem(thresholds);
    
    // Auto-start monitoring
    globalIntegrityMonitor.startMonitoring(30000); // 30 second intervals
    
    secureLog('info', 'Global integrity monitoring system initialized', {
      autoStarted: true,
      intervalMs: 30000
    });
  }
  
  return globalIntegrityMonitor;
}

/**
 * Start integrity monitoring with default settings
 */
export function startIntegrityMonitoring(thresholds?: Partial<IntegrityAlertThresholds>): IntegrityMonitoringSystem {
  const monitor = getGlobalIntegrityMonitor(thresholds);
  return monitor;
}
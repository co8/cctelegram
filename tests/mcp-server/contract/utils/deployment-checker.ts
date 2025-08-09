/**
 * Contract Deployment Compatibility Checker
 * Validates contract compatibility before deployment and manages deployment gates
 */

import axios from 'axios';
import { brokerConfig, evolutionConfig, ciConfig } from '../config/pact.config.js';
import { ContractVersionManager, ContractVersion, BreakingChange } from './version-manager.js';
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

export interface DeploymentCompatibility {
  can_deploy: boolean;
  compatibility_score: number;
  blocking_issues: string[];
  warnings: string[];
  recommendations: string[];
  verified_consumers: string[];
  pending_consumers: string[];
  environment_readiness: EnvironmentReadiness;
  rollback_plan?: RollbackPlan;
}

export interface EnvironmentReadiness {
  environment: string;
  requirements_met: boolean;
  infrastructure_ready: boolean;
  monitoring_configured: boolean;
  alerting_configured: boolean;
  rollback_configured: boolean;
  consumer_readiness: ConsumerReadiness[];
}

export interface ConsumerReadiness {
  consumer_name: string;
  version: string;
  compatible: boolean;
  verification_status: 'passed' | 'failed' | 'pending' | 'not_run';
  last_verification: string;
  issues: string[];
}

export interface RollbackPlan {
  previous_version: string;
  rollback_steps: string[];
  estimated_time_minutes: number;
  verification_steps: string[];
  communication_plan: string[];
}

export class DeploymentCompatibilityChecker {
  private versionManager: ContractVersionManager;
  private brokerBaseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    this.versionManager = new ContractVersionManager();
    this.brokerBaseUrl = brokerConfig.brokerUrl;
    this.headers = this.buildAuthHeaders();
  }

  /**
   * Main deployment compatibility check
   */
  async checkDeploymentCompatibility(
    environment: string = 'production',
    options: {
      skipConsumerVerification?: boolean;
      forceDeployment?: boolean;
      dryRun?: boolean;
    } = {}
  ): Promise<DeploymentCompatibility> {
    console.log(`Checking deployment compatibility for ${environment}...`);

    // Get current and previous contract versions
    const compatibilityReport = await this.versionManager.generateCompatibilityReport();
    
    // Check consumer verification status
    const consumerStatus = await this.checkConsumerVerificationStatus();
    
    // Check environment readiness
    const envReadiness = await this.checkEnvironmentReadiness(environment);
    
    // Generate rollback plan
    const rollbackPlan = await this.generateRollbackPlan(compatibilityReport.previous_version);

    const result: DeploymentCompatibility = {
      can_deploy: this.determineDeploymentEligibility(
        compatibilityReport,
        consumerStatus,
        envReadiness,
        options
      ),
      compatibility_score: compatibilityReport.compatibility_score,
      blocking_issues: this.identifyBlockingIssues(
        compatibilityReport.breaking_changes,
        consumerStatus,
        envReadiness
      ),
      warnings: this.collectWarnings(compatibilityReport, consumerStatus),
      recommendations: this.generateRecommendations(compatibilityReport, envReadiness),
      verified_consumers: consumerStatus.filter(c => c.verification_status === 'passed').map(c => c.consumer_name),
      pending_consumers: consumerStatus.filter(c => c.verification_status === 'pending').map(c => c.consumer_name),
      environment_readiness: envReadiness,
      rollback_plan: rollbackPlan
    };

    // Log deployment decision
    await this.logDeploymentDecision(result, environment);

    return result;
  }

  /**
   * Check consumer verification status from Pact Broker
   */
  private async checkConsumerVerificationStatus(): Promise<ConsumerReadiness[]> {
    const consumers: ConsumerReadiness[] = [];

    try {
      // Get list of consumers from Pact Broker
      const response = await axios.get(
        `${this.brokerBaseUrl}/pacticipants`,
        { headers: this.headers }
      );

      const pacticipants = response.data._embedded?.pacticipants || [];
      
      for (const pacticipant of pacticipants) {
        if (pacticipant.name !== brokerConfig.pacticipant) {
          const consumerReadiness = await this.checkConsumerReadiness(pacticipant.name);
          consumers.push(consumerReadiness);
        }
      }
    } catch (error) {
      console.warn('Unable to fetch consumer verification status:', error);
    }

    return consumers;
  }

  /**
   * Check individual consumer readiness
   */
  private async checkConsumerReadiness(consumerName: string): Promise<ConsumerReadiness> {
    try {
      // Check latest verification results for this consumer
      const response = await axios.get(
        `${this.brokerBaseUrl}/verification-results/provider/${brokerConfig.pacticipant}/consumer/${consumerName}/latest`,
        { headers: this.headers }
      );

      const verification = response.data;
      
      return {
        consumer_name: consumerName,
        version: verification.providerVersion || 'unknown',
        compatible: verification.success || false,
        verification_status: verification.success ? 'passed' : 'failed',
        last_verification: verification.verifiedAt || new Date().toISOString(),
        issues: verification.success ? [] : [verification.resultDescription || 'Verification failed']
      };
    } catch (error) {
      return {
        consumer_name: consumerName,
        version: 'unknown',
        compatible: false,
        verification_status: 'not_run',
        last_verification: new Date().toISOString(),
        issues: ['No verification results found']
      };
    }
  }

  /**
   * Check environment readiness
   */
  private async checkEnvironmentReadiness(environment: string): Promise<EnvironmentReadiness> {
    const infraReady = await this.checkInfrastructureReadiness(environment);
    const monitoringReady = await this.checkMonitoringConfiguration(environment);
    const alertingReady = await this.checkAlertingConfiguration(environment);
    const rollbackReady = await this.checkRollbackConfiguration(environment);

    return {
      environment,
      requirements_met: infraReady && monitoringReady && alertingReady,
      infrastructure_ready: infraReady,
      monitoring_configured: monitoringReady,
      alerting_configured: alertingReady,
      rollback_configured: rollbackReady,
      consumer_readiness: await this.checkConsumerVerificationStatus()
    };
  }

  /**
   * Check infrastructure readiness
   */
  private async checkInfrastructureReadiness(environment: string): Promise<boolean> {
    // Simplified check - in practice this would verify:
    // - Kubernetes clusters are healthy
    // - Database connections are available  
    // - External services are reachable
    // - Resource quotas are available
    
    console.log(`Checking infrastructure readiness for ${environment}...`);
    
    // Mock implementation
    if (environment === 'production') {
      // More stringent checks for production
      return true; // Assume infrastructure is ready
    }
    
    return true;
  }

  /**
   * Check monitoring configuration
   */
  private async checkMonitoringConfiguration(environment: string): Promise<boolean> {
    // Check if monitoring is properly configured:
    // - Metrics collection is enabled
    // - Dashboards are configured
    // - Log aggregation is working
    // - Health checks are in place
    
    console.log(`Checking monitoring configuration for ${environment}...`);
    
    // Mock implementation
    return true;
  }

  /**
   * Check alerting configuration  
   */
  private async checkAlertingConfiguration(environment: string): Promise<boolean> {
    // Check if alerting is properly configured:
    // - Alert rules are defined
    // - Notification channels are configured
    // - Escalation policies are in place
    // - On-call schedules are current
    
    console.log(`Checking alerting configuration for ${environment}...`);
    
    // Mock implementation
    return true;
  }

  /**
   * Check rollback configuration
   */
  private async checkRollbackConfiguration(environment: string): Promise<boolean> {
    // Check if rollback mechanisms are ready:
    // - Previous version is available
    // - Rollback procedures are documented
    // - Automated rollback is configured
    // - Database migrations are reversible
    
    console.log(`Checking rollback configuration for ${environment}...`);
    
    // Mock implementation
    return true;
  }

  /**
   * Determine if deployment should be allowed
   */
  private determineDeploymentEligibility(
    compatibilityReport: any,
    consumerStatus: ConsumerReadiness[],
    envReadiness: EnvironmentReadiness,
    options: any
  ): boolean {
    // Force deployment option
    if (options.forceDeployment) {
      console.warn('Deployment forced - bypassing compatibility checks');
      return true;
    }

    // Check compatibility score
    const minCompatibilityScore = evolutionConfig.deploymentGates.requireConsumerVerification ? 0.8 : 0.6;
    if (compatibilityReport.compatibility_score < minCompatibilityScore) {
      return false;
    }

    // Check for critical breaking changes
    const criticalChanges = compatibilityReport.breaking_changes.filter(
      (c: BreakingChange) => c.severity === 'critical'
    );
    if (criticalChanges.length > 0) {
      return false;
    }

    // Check consumer verification requirements
    if (evolutionConfig.deploymentGates.requireConsumerVerification) {
      const verifiedConsumers = consumerStatus.filter(c => c.verification_status === 'passed');
      const totalConsumers = consumerStatus.length;
      
      if (!evolutionConfig.deploymentGates.allowPartialVerification && verifiedConsumers.length < totalConsumers) {
        return false;
      }
    }

    // Check environment readiness
    if (!envReadiness.requirements_met) {
      return false;
    }

    return true;
  }

  /**
   * Identify blocking issues
   */
  private identifyBlockingIssues(
    breakingChanges: BreakingChange[],
    consumerStatus: ConsumerReadiness[],
    envReadiness: EnvironmentReadiness
  ): string[] {
    const issues: string[] = [];

    // Critical breaking changes
    const criticalChanges = breakingChanges.filter(c => c.severity === 'critical');
    issues.push(...criticalChanges.map(c => `Critical breaking change: ${c.description}`));

    // Failed consumer verifications
    const failedConsumers = consumerStatus.filter(c => c.verification_status === 'failed');
    issues.push(...failedConsumers.map(c => `Consumer ${c.consumer_name} verification failed`));

    // Environment readiness issues
    if (!envReadiness.requirements_met) {
      if (!envReadiness.infrastructure_ready) {
        issues.push('Infrastructure is not ready');
      }
      if (!envReadiness.monitoring_configured) {
        issues.push('Monitoring is not properly configured');
      }
      if (!envReadiness.alerting_configured) {
        issues.push('Alerting is not properly configured');
      }
    }

    return issues;
  }

  /**
   * Collect warnings
   */
  private collectWarnings(
    compatibilityReport: any,
    consumerStatus: ConsumerReadiness[]
  ): string[] {
    const warnings: string[] = [];

    // Medium/high severity breaking changes
    const nonCriticalChanges = compatibilityReport.breaking_changes.filter(
      (c: BreakingChange) => c.severity === 'high' || c.severity === 'medium'
    );
    warnings.push(...nonCriticalChanges.map((c: BreakingChange) => c.description));

    // Pending consumer verifications
    const pendingConsumers = consumerStatus.filter(c => c.verification_status === 'pending');
    if (pendingConsumers.length > 0) {
      warnings.push(`${pendingConsumers.length} consumers have pending verification`);
    }

    // Deprecation warnings
    warnings.push(...compatibilityReport.evolution_summary.deprecation_warnings.map(
      (d: any) => `Deprecated feature: ${d.feature} (removal planned: ${d.removal_planned})`
    ));

    return warnings;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    compatibilityReport: any,
    envReadiness: EnvironmentReadiness
  ): string[] {
    const recommendations: string[] = [];

    // Based on compatibility score
    if (compatibilityReport.compatibility_score < 0.9) {
      recommendations.push('Consider additional testing due to compatibility concerns');
    }

    // Based on breaking changes
    if (compatibilityReport.breaking_changes.length > 0) {
      recommendations.push('Prepare consumer migration guides');
      recommendations.push('Schedule consumer update deployments');
      recommendations.push('Monitor error rates closely after deployment');
    }

    // Based on new features
    if (compatibilityReport.evolution_summary.new_features.length > 0) {
      recommendations.push('Update API documentation');
      recommendations.push('Notify consumer teams of new features');
    }

    // Based on performance impact
    if (compatibilityReport.evolution_summary.performance_impact !== 'none') {
      recommendations.push('Monitor performance metrics closely');
      if (compatibilityReport.evolution_summary.performance_impact === 'significant') {
        recommendations.push('Consider gradual rollout strategy');
      }
    }

    // Environment-specific recommendations
    if (envReadiness.environment === 'production') {
      recommendations.push('Deploy during low-traffic hours');
      recommendations.push('Have rollback plan ready');
      recommendations.push('Coordinate with on-call team');
    }

    return recommendations;
  }

  /**
   * Generate rollback plan
   */
  private async generateRollbackPlan(previousVersion?: string): Promise<RollbackPlan | undefined> {
    if (!previousVersion) {
      return undefined;
    }

    return {
      previous_version: previousVersion,
      rollback_steps: [
        'Stop current deployment',
        `Redeploy previous version ${previousVersion}`,
        'Verify service health',
        'Check consumer compatibility',
        'Monitor error rates',
        'Notify stakeholders of rollback'
      ],
      estimated_time_minutes: 15,
      verification_steps: [
        'Health check endpoints return OK',
        'Consumer applications can connect',
        'No increase in error rates',
        'Key metrics within normal ranges'
      ],
      communication_plan: [
        'Notify development team',
        'Update status page',
        'Inform consumer teams',
        'Document rollback reasons'
      ]
    };
  }

  /**
   * Log deployment decision
   */
  private async logDeploymentDecision(
    result: DeploymentCompatibility,
    environment: string
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      environment,
      decision: result.can_deploy ? 'APPROVED' : 'REJECTED',
      compatibility_score: result.compatibility_score,
      blocking_issues_count: result.blocking_issues.length,
      warnings_count: result.warnings.length,
      verified_consumers_count: result.verified_consumers.length,
      git_hash: this.getGitHash(),
      deployment_id: this.generateDeploymentId()
    };

    // Log to file
    const logsDir = path.resolve(process.cwd(), 'logs', 'deployment-decisions');
    await fs.ensureDir(logsDir);
    
    const logFile = path.join(logsDir, `${environment}-deployment-decisions.json`);
    let logs: any[] = [];
    
    try {
      logs = await fs.readJson(logFile);
    } catch {
      // File doesn't exist, start with empty array
    }
    
    logs.push(logEntry);
    
    // Keep only last 100 entries
    if (logs.length > 100) {
      logs = logs.slice(-100);
    }
    
    await fs.writeJson(logFile, logs, { spaces: 2 });

    console.log(`Deployment decision logged: ${result.can_deploy ? 'APPROVED' : 'REJECTED'} for ${environment}`);
  }

  /**
   * Publish deployment gates status to Pact Broker
   */
  async publishDeploymentGatesStatus(
    result: DeploymentCompatibility,
    environment: string
  ): Promise<void> {
    try {
      const payload = {
        pacticipant: brokerConfig.pacticipant,
        version: this.getGitHash(),
        environment: environment,
        deployment_status: result.can_deploy ? 'passed' : 'failed',
        compatibility_score: result.compatibility_score,
        blocking_issues: result.blocking_issues,
        warnings: result.warnings,
        timestamp: new Date().toISOString()
      };

      await axios.post(
        `${this.brokerBaseUrl}/deployment-status`,
        payload,
        { headers: this.headers }
      );

      console.log('Deployment gates status published to Pact Broker');
    } catch (error) {
      console.warn('Failed to publish deployment gates status:', error);
    }
  }

  /**
   * Utility functions
   */
  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (brokerConfig.token) {
      headers.Authorization = `Bearer ${brokerConfig.token}`;
    } else if (brokerConfig.username && brokerConfig.password) {
      const auth = Buffer.from(`${brokerConfig.username}:${brokerConfig.password}`).toString('base64');
      headers.Authorization = `Basic ${auth}`;
    }

    return headers;
  }

  private getGitHash(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private generateDeploymentId(): string {
    return `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  }
}
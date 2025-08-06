/**
 * Contract Version Management and Evolution Tracking
 * Handles contract versioning, compatibility checking, and breaking change detection
 */

import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import semver from 'semver';
import { brokerConfig, evolutionConfig } from '../config/pact.config.js';

export interface ContractVersion {
  version: string;
  git_hash: string;
  timestamp: string;
  consumer_version: string;
  provider_version: string;
  contracts: ContractFile[];
  breaking_changes: BreakingChange[];
  compatibility_score: number;
  evolution_metadata: EvolutionMetadata;
}

export interface ContractFile {
  path: string;
  checksum: string;
  size: number;
  interactions_count: number;
  last_modified: string;
}

export interface BreakingChange {
  type: 'field_removed' | 'field_type_changed' | 'endpoint_removed' | 'status_code_changed' | 'schema_incompatible';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affected_interactions: string[];
  migration_notes?: string;
  automatic_fix?: string;
}

export interface EvolutionMetadata {
  version_type: 'major' | 'minor' | 'patch';
  backward_compatible: boolean;
  forward_compatible: boolean;
  deprecation_warnings: DeprecationWarning[];
  new_features: string[];
  removed_features: string[];
  performance_impact: 'none' | 'minor' | 'significant';
}

export interface DeprecationWarning {
  feature: string;
  deprecated_in: string;
  removal_planned: string;
  replacement?: string;
  migration_guide?: string;
}

export class ContractVersionManager {
  private versionsDir: string;
  private contractsDir: string;
  private currentVersion: string;

  constructor() {
    this.versionsDir = path.resolve(process.cwd(), 'contract-versions');
    this.contractsDir = path.resolve(process.cwd(), 'pacts');
    this.currentVersion = this.getCurrentVersion();
  }

  /**
   * Get current version from git
   */
  private getCurrentVersion(): string {
    try {
      const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      const gitTag = execSync('git describe --tags --exact-match HEAD 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
      return gitTag || gitHash;
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Record contract version
   */
  async recordContractVersion(
    consumerVersion: string,
    providerVersion: string,
    additionalMetadata: Partial<EvolutionMetadata> = {}
  ): Promise<ContractVersion> {
    await fs.ensureDir(this.versionsDir);

    const contracts = await this.scanContractFiles();
    const previousVersion = await this.getLatestVersion();
    const breakingChanges = await this.detectBreakingChanges(previousVersion);
    
    const version: ContractVersion = {
      version: this.currentVersion,
      git_hash: this.getGitHash(),
      timestamp: new Date().toISOString(),
      consumer_version: consumerVersion,
      provider_version: providerVersion,
      contracts,
      breaking_changes: breakingChanges,
      compatibility_score: this.calculateCompatibilityScore(breakingChanges),
      evolution_metadata: {
        version_type: this.determineVersionType(breakingChanges),
        backward_compatible: breakingChanges.length === 0,
        forward_compatible: this.checkForwardCompatibility(contracts),
        deprecation_warnings: await this.scanDeprecationWarnings(),
        new_features: await this.detectNewFeatures(previousVersion),
        removed_features: await this.detectRemovedFeatures(previousVersion),
        performance_impact: this.assessPerformanceImpact(contracts),
        ...additionalMetadata
      }
    };

    await this.saveVersionRecord(version);
    return version;
  }

  /**
   * Scan contract files for metadata
   */
  private async scanContractFiles(): Promise<ContractFile[]> {
    const contractFiles: ContractFile[] = [];
    
    try {
      const files = await fs.readdir(this.contractsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.contractsDir, file);
          const stats = await fs.stat(filePath);
          const content = await fs.readJson(filePath);
          
          contractFiles.push({
            path: file,
            checksum: this.calculateChecksum(JSON.stringify(content)),
            size: stats.size,
            interactions_count: content.interactions?.length || 0,
            last_modified: stats.mtime.toISOString()
          });
        }
      }
    } catch (error) {
      console.warn('Error scanning contract files:', error);
    }

    return contractFiles;
  }

  /**
   * Detect breaking changes between versions
   */
  async detectBreakingChanges(previousVersion?: ContractVersion): Promise<BreakingChange[]> {
    if (!previousVersion) {
      return []; // No previous version to compare
    }

    const breakingChanges: BreakingChange[] = [];
    const currentContracts = await this.scanContractFiles();

    // Check for removed contract files
    for (const prevContract of previousVersion.contracts) {
      const currentContract = currentContracts.find(c => c.path === prevContract.path);
      if (!currentContract) {
        breakingChanges.push({
          type: 'endpoint_removed',
          description: `Contract file ${prevContract.path} was removed`,
          severity: 'critical',
          affected_interactions: [`all interactions in ${prevContract.path}`],
          migration_notes: 'API endpoints may no longer be available'
        });
      }
    }

    // Check for contract content changes
    for (const currentContract of currentContracts) {
      const prevContract = previousVersion.contracts.find(c => c.path === currentContract.path);
      if (prevContract && prevContract.checksum !== currentContract.checksum) {
        const contractChanges = await this.analyzeContractChanges(
          prevContract.path,
          previousVersion,
          currentContract
        );
        breakingChanges.push(...contractChanges);
      }
    }

    return breakingChanges;
  }

  /**
   * Analyze specific contract changes
   */
  private async analyzeContractChanges(
    contractPath: string,
    previousVersion: ContractVersion,
    currentContract: ContractFile
  ): Promise<BreakingChange[]> {
    const breakingChanges: BreakingChange[] = [];

    try {
      // Load current and previous contract content
      const currentContent = await fs.readJson(path.join(this.contractsDir, contractPath));
      
      // Simplified analysis - in practice this would be more sophisticated
      if (currentContract.interactions_count < (previousVersion.contracts.find(c => c.path === contractPath)?.interactions_count || 0)) {
        breakingChanges.push({
          type: 'endpoint_removed',
          description: `Interactions removed from ${contractPath}`,
          severity: 'high',
          affected_interactions: ['removed interactions'],
          migration_notes: 'Some API endpoints may have been removed'
        });
      }

      // Check for schema changes (simplified)
      const hasSchemaChanges = await this.detectSchemaChanges(currentContent);
      if (hasSchemaChanges) {
        breakingChanges.push({
          type: 'schema_incompatible',
          description: `Schema changes detected in ${contractPath}`,
          severity: 'medium',
          affected_interactions: ['schema-dependent interactions'],
          migration_notes: 'Request/response schemas may have changed'
        });
      }

    } catch (error) {
      console.warn(`Error analyzing contract changes for ${contractPath}:`, error);
    }

    return breakingChanges;
  }

  /**
   * Detect schema changes (simplified implementation)
   */
  private async detectSchemaChanges(contractContent: any): Promise<boolean> {
    // This is a simplified implementation
    // In practice, you'd compare schemas more thoroughly
    return contractContent.interactions?.some((interaction: any) => 
      interaction.request?.body || interaction.response?.body
    ) || false;
  }

  /**
   * Calculate compatibility score (0-1, where 1 is fully compatible)
   */
  private calculateCompatibilityScore(breakingChanges: BreakingChange[]): number {
    if (breakingChanges.length === 0) return 1.0;

    const severityWeights = {
      low: 0.05,
      medium: 0.15,
      high: 0.3,
      critical: 0.5
    };

    const totalImpact = breakingChanges.reduce((sum, change) => 
      sum + severityWeights[change.severity], 0
    );

    return Math.max(0, 1 - totalImpact);
  }

  /**
   * Determine semantic version type based on breaking changes
   */
  private determineVersionType(breakingChanges: BreakingChange[]): 'major' | 'minor' | 'patch' {
    if (breakingChanges.some(c => c.severity === 'critical' || c.severity === 'high')) {
      return 'major';
    }
    if (breakingChanges.some(c => c.severity === 'medium')) {
      return 'minor';
    }
    return 'patch';
  }

  /**
   * Check forward compatibility
   */
  private checkForwardCompatibility(contracts: ContractFile[]): boolean {
    // Simplified check - contracts with optional fields are more forward compatible
    return contracts.length > 0; // Placeholder implementation
  }

  /**
   * Scan for deprecation warnings
   */
  private async scanDeprecationWarnings(): Promise<DeprecationWarning[]> {
    const warnings: DeprecationWarning[] = [];
    
    try {
      const files = await fs.readdir(this.contractsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readJson(path.join(this.contractsDir, file));
          
          // Look for deprecation markers in contract metadata
          if (content.metadata?.deprecations) {
            warnings.push(...content.metadata.deprecations);
          }
        }
      }
    } catch (error) {
      console.warn('Error scanning deprecation warnings:', error);
    }

    return warnings;
  }

  /**
   * Detect new features
   */
  private async detectNewFeatures(previousVersion?: ContractVersion): Promise<string[]> {
    if (!previousVersion) return [];

    const currentContracts = await this.scanContractFiles();
    const newFeatures: string[] = [];

    // Check for new contract files
    for (const contract of currentContracts) {
      if (!previousVersion.contracts.find(c => c.path === contract.path)) {
        newFeatures.push(`New API contract: ${contract.path}`);
      }
    }

    // Check for increased interaction counts (new endpoints)
    for (const contract of currentContracts) {
      const prevContract = previousVersion.contracts.find(c => c.path === contract.path);
      if (prevContract && contract.interactions_count > prevContract.interactions_count) {
        newFeatures.push(`New interactions in ${contract.path}`);
      }
    }

    return newFeatures;
  }

  /**
   * Detect removed features
   */
  private async detectRemovedFeatures(previousVersion?: ContractVersion): Promise<string[]> {
    if (!previousVersion) return [];

    const currentContracts = await this.scanContractFiles();
    const removedFeatures: string[] = [];

    // Check for removed contract files
    for (const prevContract of previousVersion.contracts) {
      if (!currentContracts.find(c => c.path === prevContract.path)) {
        removedFeatures.push(`Removed API contract: ${prevContract.path}`);
      }
    }

    return removedFeatures;
  }

  /**
   * Assess performance impact
   */
  private assessPerformanceImpact(contracts: ContractFile[]): 'none' | 'minor' | 'significant' {
    const totalSize = contracts.reduce((sum, c) => sum + c.size, 0);
    const totalInteractions = contracts.reduce((sum, c) => sum + c.interactions_count, 0);

    if (totalSize > 100000 || totalInteractions > 100) {
      return 'significant';
    }
    if (totalSize > 50000 || totalInteractions > 50) {
      return 'minor';
    }
    return 'none';
  }

  /**
   * Get latest version record
   */
  private async getLatestVersion(): Promise<ContractVersion | undefined> {
    try {
      const versions = await fs.readdir(this.versionsDir);
      if (versions.length === 0) return undefined;

      const latestVersionFile = versions
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a))[0];

      return await fs.readJson(path.join(this.versionsDir, latestVersionFile));
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Save version record
   */
  private async saveVersionRecord(version: ContractVersion): Promise<void> {
    const filename = `version-${version.version}-${Date.now()}.json`;
    await fs.writeJson(
      path.join(this.versionsDir, filename),
      version,
      { spaces: 2 }
    );

    // Also save as latest
    await fs.writeJson(
      path.join(this.versionsDir, 'latest.json'),
      version,
      { spaces: 2 }
    );
  }

  /**
   * Check deployment compatibility
   */
  async checkDeploymentCompatibility(
    targetEnvironment: string = 'production'
  ): Promise<{
    canDeploy: boolean;
    reason?: string;
    warnings: string[];
    requiredActions: string[];
  }> {
    const currentVersion = await this.scanContractFiles();
    const latestVersion = await this.getLatestVersion();

    if (!latestVersion) {
      return {
        canDeploy: true,
        warnings: [],
        requiredActions: []
      };
    }

    const breakingChanges = await this.detectBreakingChanges(latestVersion);
    const compatibilityScore = this.calculateCompatibilityScore(breakingChanges);

    const warnings: string[] = [];
    const requiredActions: string[] = [];

    // Check compatibility thresholds
    if (compatibilityScore < evolutionConfig.deploymentGates.requireConsumerVerification ? 0.8 : 0.6) {
      return {
        canDeploy: false,
        reason: `Compatibility score ${compatibilityScore} below threshold`,
        warnings,
        requiredActions: ['Resolve breaking changes', 'Update consumer applications']
      };
    }

    // Check for critical breaking changes
    const criticalChanges = breakingChanges.filter(c => c.severity === 'critical');
    if (criticalChanges.length > 0 && targetEnvironment === 'production') {
      return {
        canDeploy: false,
        reason: 'Critical breaking changes detected',
        warnings: criticalChanges.map(c => c.description),
        requiredActions: criticalChanges.map(c => c.migration_notes || 'Manual migration required')
      };
    }

    // Add warnings for medium/high severity changes
    const majorChanges = breakingChanges.filter(c => c.severity === 'high' || c.severity === 'medium');
    if (majorChanges.length > 0) {
      warnings.push(...majorChanges.map(c => c.description));
      requiredActions.push('Monitor deployment for issues', 'Prepare rollback plan');
    }

    return {
      canDeploy: true,
      warnings,
      requiredActions
    };
  }

  /**
   * Generate compatibility report
   */
  async generateCompatibilityReport(): Promise<{
    current_version: string;
    previous_version?: string;
    compatibility_score: number;
    breaking_changes: BreakingChange[];
    evolution_summary: EvolutionMetadata;
    deployment_readiness: any;
  }> {
    const latestVersion = await this.getLatestVersion();
    const breakingChanges = await this.detectBreakingChanges(latestVersion);
    const compatibilityScore = this.calculateCompatibilityScore(breakingChanges);
    const deploymentReadiness = await this.checkDeploymentCompatibility();

    return {
      current_version: this.currentVersion,
      previous_version: latestVersion?.version,
      compatibility_score: compatibilityScore,
      breaking_changes: breakingChanges,
      evolution_summary: {
        version_type: this.determineVersionType(breakingChanges),
        backward_compatible: breakingChanges.length === 0,
        forward_compatible: true,
        deprecation_warnings: await this.scanDeprecationWarnings(),
        new_features: await this.detectNewFeatures(latestVersion),
        removed_features: await this.detectRemovedFeatures(latestVersion),
        performance_impact: this.assessPerformanceImpact(await this.scanContractFiles())
      },
      deployment_readiness: deploymentReadiness
    };
  }

  /**
   * Utility functions
   */
  private getGitHash(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private calculateChecksum(content: string): string {
    // Simple checksum calculation
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}
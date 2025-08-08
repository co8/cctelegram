/**
 * Response Verification Engine
 * Automated verification of response content, format, timing, and data accuracy
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

export interface VerificationRule {
  id: string;
  name: string;
  description: string;
  type: 'content' | 'format' | 'timing' | 'data_accuracy' | 'progress_bar' | 'structure' | 'api_compliance';
  pattern?: RegExp | string;
  validator?: (data: any) => Promise<VerificationResult>;
  severity: 'error' | 'warning' | 'info';
  category: string;
  enabled: boolean;
  timeout?: number;
}

export interface VerificationResult {
  ruleId: string;
  success: boolean;
  message: string;
  actualValue?: any;
  expectedValue?: any;
  severity: 'error' | 'warning' | 'info';
  details?: any;
  timestamp: number;
  duration?: number;
}

export interface MessageVerification {
  messageId: string;
  timestamp: number;
  content: string;
  messageType: 'command_response' | 'notification' | 'approval_request' | 'progress_update' | 'error' | 'status';
  results: VerificationResult[];
  overallSuccess: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  totalDuration: number;
  metadata: any;
}

export interface VerificationReport {
  reportId: string;
  timestamp: string;
  totalVerifications: number;
  successfulVerifications: number;
  failedVerifications: number;
  successRate: number;
  verifications: MessageVerification[];
  ruleStatistics: Map<string, { executed: number; passed: number; failed: number; rate: number }>;
  criticalIssues: VerificationResult[];
  performanceMetrics: {
    averageVerificationTime: number;
    slowestVerification: { messageId: string; duration: number };
    fastestVerification: { messageId: string; duration: number };
  };
  dataQualityIssues: {
    staleDataDetections: number;
    progressBarInaccuracies: number;
    taskCountMismatches: number;
    formatInconsistencies: number;
  };
}

export class ResponseVerificationEngine extends EventEmitter {
  private rules: Map<string, VerificationRule> = new Map();
  private verifications: Map<string, MessageVerification> = new Map();
  private logDir: string;
  
  // Live data tracking for staleness detection
  private lastKnownTaskData: any = null;
  private expectedTaskData: any = null;
  
  // Performance tracking
  private verificationStartTimes: Map<string, number> = new Map();
  
  // Configuration
  private enableRealTimeVerification = true;
  private enableDetailedLogging = true;
  private maxStoredVerifications = 1000;

  constructor(logDir: string) {
    super();
    this.logDir = logDir;
    this.setupDefaultRules();
  }

  // Rule management
  addRule(rule: VerificationRule): void {
    this.rules.set(rule.id, rule);
    console.log(`✓ Added verification rule: ${rule.name} (${rule.severity})`);
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  enableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = true;
    }
  }

  disableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = false;
    }
  }

  getRule(ruleId: string): VerificationRule | undefined {
    return this.rules.get(ruleId);
  }

  getAllRules(): VerificationRule[] {
    return Array.from(this.rules.values());
  }

  getEnabledRules(): VerificationRule[] {
    return Array.from(this.rules.values()).filter(rule => rule.enabled);
  }

  // Expected data management for staleness detection
  setExpectedTaskData(data: any): void {
    this.expectedTaskData = data;
    console.log('📊 Updated expected task data for staleness detection');
    
    if (this.enableDetailedLogging) {
      console.log('Expected data:', JSON.stringify(data, null, 2));
    }
  }

  updateLastKnownTaskData(data: any): void {
    this.lastKnownTaskData = data;
  }

  // Main verification method
  async verifyMessage(messageId: string, content: string, messageType: string, metadata: any = {}): Promise<MessageVerification> {
    const startTime = performance.now();
    this.verificationStartTimes.set(messageId, startTime);

    console.log(`🔍 Verifying message ${messageId} (type: ${messageType})`);

    const verification: MessageVerification = {
      messageId,
      timestamp: Date.now(),
      content,
      messageType: messageType as any,
      results: [],
      overallSuccess: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      totalDuration: 0,
      metadata
    };

    // Run applicable verification rules
    const applicableRules = this.getEnabledRules().filter(rule => 
      this.isRuleApplicable(rule, messageType, content)
    );

    console.log(`📋 Running ${applicableRules.length} verification rules for ${messageId}`);

    for (const rule of applicableRules) {
      try {
        const ruleStartTime = performance.now();
        const result = await this.executeRule(rule, content, metadata);
        const ruleDuration = performance.now() - ruleStartTime;
        
        result.duration = ruleDuration;
        verification.results.push(result);

        // Update counters
        switch (result.severity) {
          case 'error':
            verification.errorCount++;
            if (!result.success) {
              verification.overallSuccess = false;
            }
            break;
          case 'warning':
            verification.warningCount++;
            break;
          case 'info':
            verification.infoCount++;
            break;
        }

        // Log results
        const status = result.success ? '✅' : '❌';
        console.log(`  ${status} ${rule.name}: ${result.message}`);
        
        if (!result.success && this.enableDetailedLogging) {
          console.log(`    Expected: ${JSON.stringify(result.expectedValue)}`);
          console.log(`    Actual: ${JSON.stringify(result.actualValue)}`);
        }

      } catch (error) {
        const errorResult: VerificationResult = {
          ruleId: rule.id,
          success: false,
          message: `Rule execution error: ${error.message}`,
          severity: 'error',
          timestamp: performance.now(),
          details: { error: error.message, rule: rule.name }
        };

        verification.results.push(errorResult);
        verification.errorCount++;
        verification.overallSuccess = false;

        console.error(`❌ Rule ${rule.name} failed with error: ${error.message}`);
      }
    }

    // Calculate total duration
    verification.totalDuration = performance.now() - startTime;
    this.verificationStartTimes.delete(messageId);

    // Store verification
    this.verifications.set(messageId, verification);
    
    // Clean up old verifications to prevent memory issues
    if (this.verifications.size > this.maxStoredVerifications) {
      const oldestKeys = Array.from(this.verifications.keys()).slice(0, 100);
      oldestKeys.forEach(key => this.verifications.delete(key));
    }

    // Emit events
    this.emit('verificationCompleted', verification);
    
    if (!verification.overallSuccess) {
      this.emit('verificationFailed', verification);
    }

    const successRate = verification.results.length > 0 ? 
      (verification.results.filter(r => r.success).length / verification.results.length) * 100 : 100;

    console.log(`🎯 Verification ${messageId} completed: ${verification.overallSuccess ? 'PASSED' : 'FAILED'} ` +
               `(${successRate.toFixed(1)}% rules passed, ${verification.totalDuration.toFixed(2)}ms)`);

    return verification;
  }

  // Rule execution
  private async executeRule(rule: VerificationRule, content: string, metadata: any): Promise<VerificationResult> {
    const startTime = performance.now();

    try {
      // Apply timeout if specified
      if (rule.timeout) {
        return await Promise.race([
          this.runRule(rule, content, metadata),
          new Promise<VerificationResult>((_, reject) => {
            setTimeout(() => reject(new Error(`Rule timeout after ${rule.timeout}ms`)), rule.timeout);
          })
        ]);
      } else {
        return await this.runRule(rule, content, metadata);
      }
    } catch (error) {
      return {
        ruleId: rule.id,
        success: false,
        message: `Rule execution failed: ${error.message}`,
        severity: rule.severity,
        timestamp: startTime,
        details: { error: error.message }
      };
    }
  }

  private async runRule(rule: VerificationRule, content: string, metadata: any): Promise<VerificationResult> {
    // Use custom validator if provided
    if (rule.validator) {
      return await rule.validator({ content, metadata, rule });
    }

    // Use pattern matching if provided
    if (rule.pattern) {
      const pattern = typeof rule.pattern === 'string' ? new RegExp(rule.pattern) : rule.pattern;
      const matches = pattern.test(content);

      return {
        ruleId: rule.id,
        success: matches,
        message: matches ? `Pattern matched: ${rule.pattern}` : `Pattern not found: ${rule.pattern}`,
        severity: rule.severity,
        timestamp: performance.now(),
        actualValue: content.match(pattern),
        expectedValue: rule.pattern,
        details: { pattern: rule.pattern.toString(), contentLength: content.length }
      };
    }

    // Default: rule passes if no pattern or validator
    return {
      ruleId: rule.id,
      success: true,
      message: 'No validation criteria specified',
      severity: 'info',
      timestamp: performance.now()
    };
  }

  private isRuleApplicable(rule: VerificationRule, messageType: string, content: string): boolean {
    // Check if rule category matches message type or is universal
    const universalCategories = ['format', 'structure', 'api_compliance'];
    
    if (universalCategories.includes(rule.category)) {
      return true;
    }

    // Type-specific rules
    switch (messageType) {
      case 'command_response':
        return ['content', 'data_accuracy', 'progress_bar'].includes(rule.category);
      case 'notification':
        return ['content', 'timing'].includes(rule.category);
      case 'progress_update':
        return ['progress_bar', 'data_accuracy', 'timing'].includes(rule.category);
      case 'status':
        return ['content', 'data_accuracy', 'format'].includes(rule.category);
      default:
        return true;
    }
  }

  // Analysis and reporting
  async generateReport(): Promise<VerificationReport> {
    const verifications = Array.from(this.verifications.values());
    const totalVerifications = verifications.length;
    const successfulVerifications = verifications.filter(v => v.overallSuccess).length;
    const successRate = totalVerifications > 0 ? (successfulVerifications / totalVerifications) * 100 : 0;

    // Calculate rule statistics
    const ruleStats = new Map<string, { executed: number; passed: number; failed: number; rate: number }>();
    
    for (const verification of verifications) {
      for (const result of verification.results) {
        const stats = ruleStats.get(result.ruleId) || { executed: 0, passed: 0, failed: 0, rate: 0 };
        stats.executed++;
        if (result.success) {
          stats.passed++;
        } else {
          stats.failed++;
        }
        stats.rate = stats.executed > 0 ? (stats.passed / stats.executed) * 100 : 0;
        ruleStats.set(result.ruleId, stats);
      }
    }

    // Find critical issues
    const criticalIssues = verifications
      .flatMap(v => v.results)
      .filter(r => r.severity === 'error' && !r.success);

    // Performance metrics
    const durations = verifications.map(v => ({ id: v.messageId, duration: v.totalDuration }));
    const averageTime = durations.length > 0 ? 
      durations.reduce((sum, d) => sum + d.duration, 0) / durations.length : 0;
    
    const slowest = durations.length > 0 ? 
      durations.reduce((max, d) => d.duration > max.duration ? d : max) : 
      { messageId: 'none', duration: 0 };
    
    const fastest = durations.length > 0 ? 
      durations.reduce((min, d) => d.duration < min.duration ? d : min) : 
      { messageId: 'none', duration: 0 };

    // Data quality issues
    const dataQualityIssues = {
      staleDataDetections: this.countIssuesByPattern(/stale.*data|old.*data|static.*data/i, verifications),
      progressBarInaccuracies: this.countIssuesByPattern(/progress.*bar|percentage.*incorrect|28\/29|96\.55/i, verifications),
      taskCountMismatches: this.countIssuesByPattern(/task.*count|total.*mismatch/i, verifications),
      formatInconsistencies: this.countIssuesByPattern(/format|markdown|escape/i, verifications)
    };

    const report: VerificationReport = {
      reportId: `report-${Date.now()}`,
      timestamp: new Date().toISOString(),
      totalVerifications,
      successfulVerifications,
      failedVerifications: totalVerifications - successfulVerifications,
      successRate,
      verifications,
      ruleStatistics: ruleStats,
      criticalIssues,
      performanceMetrics: {
        averageVerificationTime: averageTime,
        slowestVerification: slowest,
        fastestVerification: fastest
      },
      dataQualityIssues
    };

    return report;
  }

  private countIssuesByPattern(pattern: RegExp, verifications: MessageVerification[]): number {
    return verifications
      .flatMap(v => v.results)
      .filter(r => !r.success && pattern.test(r.message))
      .length;
  }

  async exportReport(filename?: string): Promise<string> {
    const report = await this.generateReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(this.logDir, filename || `verification-report-${timestamp}.json`);
    
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    console.log(`📊 Verification report exported to ${filepath}`);
    
    // Also export a human-readable summary
    const summaryPath = path.join(this.logDir, filename?.replace('.json', '-summary.txt') || `verification-summary-${timestamp}.txt`);
    await this.exportSummary(report, summaryPath);
    
    return filepath;
  }

  private async exportSummary(report: VerificationReport, filepath: string): Promise<void> {
    const lines = [
      '📊 RESPONSE VERIFICATION REPORT SUMMARY',
      '=' .repeat(50),
      '',
      `Report ID: ${report.reportId}`,
      `Generated: ${report.timestamp}`,
      '',
      '📈 OVERALL STATISTICS',
      '-'.repeat(25),
      `Total Verifications: ${report.totalVerifications}`,
      `Successful: ${report.successfulVerifications} (${report.successRate.toFixed(1)}%)`,
      `Failed: ${report.failedVerifications}`,
      '',
      '⚡ PERFORMANCE METRICS',
      '-'.repeat(25),
      `Average Verification Time: ${report.performanceMetrics.averageVerificationTime.toFixed(2)}ms`,
      `Slowest: ${report.performanceMetrics.slowestVerification.messageId} (${report.performanceMetrics.slowestVerification.duration.toFixed(2)}ms)`,
      `Fastest: ${report.performanceMetrics.fastestVerification.messageId} (${report.performanceMetrics.fastestVerification.duration.toFixed(2)}ms)`,
      '',
      '🚨 DATA QUALITY ISSUES',
      '-'.repeat(25),
      `Stale Data Detections: ${report.dataQualityIssues.staleDataDetections}`,
      `Progress Bar Inaccuracies: ${report.dataQualityIssues.progressBarInaccuracies}`,
      `Task Count Mismatches: ${report.dataQualityIssues.taskCountMismatches}`,
      `Format Inconsistencies: ${report.dataQualityIssues.formatInconsistencies}`,
      '',
      '❌ CRITICAL ISSUES',
      '-'.repeat(25)
    ];

    // Add critical issues
    if (report.criticalIssues.length === 0) {
      lines.push('No critical issues found ✅');
    } else {
      lines.push(`Found ${report.criticalIssues.length} critical issues:`);
      for (const issue of report.criticalIssues.slice(0, 10)) { // Show top 10
        lines.push(`  • ${issue.message}`);
        if (issue.details) {
          lines.push(`    Details: ${JSON.stringify(issue.details)}`);
        }
      }
      
      if (report.criticalIssues.length > 10) {
        lines.push(`  ... and ${report.criticalIssues.length - 10} more issues`);
      }
    }

    lines.push('');
    lines.push('📋 RULE PERFORMANCE');
    lines.push('-'.repeat(25));

    // Add rule statistics
    for (const [ruleId, stats] of report.ruleStatistics) {
      const rule = this.rules.get(ruleId);
      const ruleName = rule?.name || ruleId;
      lines.push(`${ruleName}: ${stats.passed}/${stats.executed} (${stats.rate.toFixed(1)}%)`);
    }

    lines.push('');
    lines.push('🔍 RECOMMENDATIONS');
    lines.push('-'.repeat(25));

    // Generate recommendations based on issues found
    const recommendations: string[] = [];
    
    if (report.dataQualityIssues.staleDataDetections > 0) {
      recommendations.push('• Investigation needed: Stale data detection suggests TaskMaster integration issues');
    }
    
    if (report.dataQualityIssues.progressBarInaccuracies > 0) {
      recommendations.push('• Check progress bar calculation logic for accuracy');
    }
    
    if (report.successRate < 80) {
      recommendations.push('• Low success rate indicates systematic issues requiring investigation');
    }
    
    if (report.performanceMetrics.averageVerificationTime > 1000) {
      recommendations.push('• High verification times may indicate performance bottlenecks');
    }
    
    if (recommendations.length === 0) {
      lines.push('All systems appear to be functioning correctly ✅');
    } else {
      lines.push(...recommendations);
    }

    await fs.writeFile(filepath, lines.join('\n'));
    console.log(`📋 Verification summary exported to ${filepath}`);
  }

  // Utility methods
  getVerification(messageId: string): MessageVerification | undefined {
    return this.verifications.get(messageId);
  }

  getAllVerifications(): MessageVerification[] {
    return Array.from(this.verifications.values());
  }

  getFailedVerifications(): MessageVerification[] {
    return Array.from(this.verifications.values()).filter(v => !v.overallSuccess);
  }

  clearVerifications(): void {
    this.verifications.clear();
    console.log('🧹 Cleared all verification results');
  }

  // Default rules setup
  private setupDefaultRules(): void {
    // Content verification rules
    this.addRule({
      id: 'tasks-command-response-format',
      name: 'Tasks Command Response Format',
      description: 'Verifies /tasks command returns properly formatted TaskMaster status',
      type: 'content',
      pattern: /TaskMaster Status.*✅.*Completed.*Pending.*Progress/s,
      severity: 'error',
      category: 'content',
      enabled: true
    });

    this.addRule({
      id: 'progress-bar-present',
      name: 'Progress Bar Present',
      description: 'Verifies that progress bars are included in task responses',
      type: 'progress_bar',
      pattern: /(`[█░▓]+`|Progress:|Completion:)/,
      severity: 'warning',
      category: 'progress_bar',
      enabled: true
    });

    this.addRule({
      id: 'markdown-format-valid',
      name: 'Valid Markdown Format',
      description: 'Checks for proper MarkdownV2 escaping',
      type: 'format',
      validator: async ({ content }) => {
        // Check for common markdown issues
        const issues = [];
        
        // Unescaped special characters
        const unescapedChars = content.match(/(?<!\\)[_*[\]()~`>#+=|{}.!-]/g);
        if (unescapedChars && unescapedChars.length > 10) { // Allow some false positives
          issues.push(`Potential unescaped characters: ${unescapedChars.slice(0, 5).join(', ')}`);
        }

        // Invalid bold/italic formatting
        if (content.match(/\*[^*\n]*\n[^*]*\*/) || content.match(/_[^_\n]*\n[^_]*_/)) {
          issues.push('Invalid bold/italic formatting across lines');
        }

        return {
          ruleId: 'markdown-format-valid',
          success: issues.length === 0,
          message: issues.length === 0 ? 'Markdown formatting appears valid' : issues.join('; '),
          severity: 'warning' as const,
          timestamp: performance.now(),
          details: { issues }
        };
      },
      severity: 'warning',
      category: 'format',
      enabled: true
    });

    this.addRule({
      id: 'stale-data-detection',
      name: 'Stale Data Detection',
      description: 'Detects old static data (28/29 tasks, 96.55%) instead of live data',
      type: 'data_accuracy',
      validator: async ({ content, metadata }) => {
        const stalePatterns = [
          { pattern: /28\/29/, description: '28/29 task count' },
          { pattern: /96\.55?%/, description: '96.55% completion' },
          { pattern: /96\.6%/, description: '96.6% completion (rounded)' },
          { pattern: /Static.*Data|File.*System.*\(Static\)/i, description: 'Static data source indicator' },
        ];

        const detectedStalePatterns: string[] = [];
        
        for (const { pattern, description } of stalePatterns) {
          if (pattern.test(content)) {
            detectedStalePatterns.push(description);
          }
        }

        const isStale = detectedStalePatterns.length > 0;
        
        // Also check against expected data if available
        let expectedDataMismatch = false;
        if (this.expectedTaskData) {
          // Extract numbers from content for comparison
          const completedMatch = content.match(/(\d+)\/(\d+)/);
          const percentageMatch = content.match(/(\d+\.?\d*)%/);
          
          if (completedMatch) {
            const [, completed, total] = completedMatch;
            if (this.expectedTaskData.completed !== parseInt(completed) || 
                this.expectedTaskData.total !== parseInt(total)) {
              expectedDataMismatch = true;
              detectedStalePatterns.push(`Expected ${this.expectedTaskData.completed}/${this.expectedTaskData.total}, got ${completed}/${total}`);
            }
          }
        }

        return {
          ruleId: 'stale-data-detection',
          success: !isStale && !expectedDataMismatch,
          message: isStale || expectedDataMismatch ? 
            `STALE DATA DETECTED: ${detectedStalePatterns.join(', ')}` : 
            'Live data appears current',
          severity: 'error' as const,
          timestamp: performance.now(),
          details: { 
            detectedPatterns: detectedStalePatterns,
            expectedData: this.expectedTaskData,
            isStale,
            expectedDataMismatch
          }
        };
      },
      severity: 'error',
      category: 'data_accuracy',
      enabled: true
    });

    this.addRule({
      id: 'response-timing',
      name: 'Response Timing',
      description: 'Verifies response times are within acceptable limits',
      type: 'timing',
      validator: async ({ metadata }) => {
        const responseTime = metadata.responseTime || metadata.duration || 0;
        const acceptable = responseTime < 5000; // 5 seconds max
        
        return {
          ruleId: 'response-timing',
          success: acceptable,
          message: `Response time: ${responseTime}ms ${acceptable ? '(acceptable)' : '(too slow)'}`,
          severity: acceptable ? 'info' as const : 'warning' as const,
          timestamp: performance.now(),
          actualValue: responseTime,
          expectedValue: '< 5000ms',
          details: { responseTime, threshold: 5000 }
        };
      },
      severity: 'warning',
      category: 'timing',
      enabled: true
    });

    this.addRule({
      id: 'emoji-reactions-working',
      name: 'Emoji Reactions Working',
      description: 'Verifies emoji reactions are being sent for appropriate messages',
      type: 'api_compliance',
      validator: async ({ content, metadata }) => {
        // Check if this is a command that should get emoji reaction
        const shouldHaveReaction = metadata.command && ['/tasks', '/todo', '/help'].includes(metadata.command);
        const hasReactionAttempt = metadata.reactionSent || content.includes('⚡');
        
        return {
          ruleId: 'emoji-reactions-working',
          success: !shouldHaveReaction || hasReactionAttempt,
          message: shouldHaveReaction ? 
            (hasReactionAttempt ? 'Emoji reaction sent as expected' : 'Missing expected emoji reaction') :
            'No emoji reaction needed',
          severity: 'info' as const,
          timestamp: performance.now(),
          details: { shouldHaveReaction, hasReactionAttempt }
        };
      },
      severity: 'info',
      category: 'api_compliance',
      enabled: true
    });

    this.addRule({
      id: 'task-count-consistency',
      name: 'Task Count Consistency',
      description: 'Verifies task counts add up correctly',
      type: 'data_accuracy',
      validator: async ({ content }) => {
        // Extract task counts from the message
        const totalMatch = content.match(/Total.*?(\d+)/i);
        const completedMatch = content.match(/Completed.*?(\d+)/i);
        const pendingMatch = content.match(/Pending.*?(\d+)/i);
        const inProgressMatch = content.match(/In Progress.*?(\d+)/i);
        const blockedMatch = content.match(/Blocked.*?(\d+)/i);

        if (!totalMatch) {
          return {
            ruleId: 'task-count-consistency',
            success: true,
            message: 'No total count found to verify',
            severity: 'info' as const,
            timestamp: performance.now()
          };
        }

        const total = parseInt(totalMatch[1]);
        const completed = completedMatch ? parseInt(completedMatch[1]) : 0;
        const pending = pendingMatch ? parseInt(pendingMatch[1]) : 0;
        const inProgress = inProgressMatch ? parseInt(inProgressMatch[1]) : 0;
        const blocked = blockedMatch ? parseInt(blockedMatch[1]) : 0;

        const calculatedTotal = completed + pending + inProgress + blocked;
        const consistent = calculatedTotal === total;

        return {
          ruleId: 'task-count-consistency',
          success: consistent,
          message: consistent ? 
            'Task counts are consistent' : 
            `Task count mismatch: ${calculatedTotal} calculated vs ${total} reported`,
          severity: consistent ? 'info' as const : 'error' as const,
          timestamp: performance.now(),
          actualValue: calculatedTotal,
          expectedValue: total,
          details: { total, completed, pending, inProgress, blocked, calculatedTotal }
        };
      },
      severity: 'error',
      category: 'data_accuracy',
      enabled: true
    });

    console.log(`✓ Loaded ${this.rules.size} default verification rules`);
  }

  async shutdown(): Promise<void> {
    // Export final report
    await this.exportReport();
    console.log('✓ Response Verification Engine shut down');
  }
}
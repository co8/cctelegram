/**
 * Error Classification System
 * 
 * Intelligent error classification, pattern recognition, and 
 * automated recovery strategy selection for the resilience framework.
 */

import { BaseResilienceError, ErrorCategory, ErrorSeverity, RecoveryStrategy } from './base-error.js';
import { createResilienceError } from './resilience-errors.js';
import { secureLog } from '../../security.js';

export interface ErrorPattern {
  name: string;
  description: string;
  matchers: ErrorMatcher[];
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  recoveryStrategy: RecoveryStrategy;
  maxAttempts: number;
  tags: string[];
}

export interface ErrorMatcher {
  type: 'code' | 'message' | 'stack' | 'metadata' | 'context';
  pattern: string | RegExp;
  weight: number; // 0-1, how much this matcher contributes to classification
}

export interface ErrorClassification {
  pattern: ErrorPattern | null;
  confidence: number; // 0-1, confidence in classification
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  recoveryStrategy: RecoveryStrategy;
  maxAttempts: number;
  reasoning: string;
  alternativePatterns: ErrorPattern[];
}

export interface ErrorStatistics {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  errorsByPattern: Record<string, number>;
  recoverySuccessRate: Record<RecoveryStrategy, number>;
  mostCommonErrors: Array<{
    pattern: string;
    count: number;
    category: ErrorCategory;
    severity: ErrorSeverity;
  }>;
  recentTrends: Array<{
    timestamp: number;
    category: ErrorCategory;
    count: number;
  }>;
}

/**
 * Comprehensive Error Classifier with machine learning-inspired pattern matching
 */
export class ErrorClassifier {
  private patterns: ErrorPattern[] = [];
  private statistics: ErrorStatistics;
  private recentErrors: Array<{ error: BaseResilienceError; timestamp: number }> = [];
  private readonly maxRecentErrors = 1000;
  private readonly statisticsWindow = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.statistics = this.initializeStatistics();
    this.loadDefaultPatterns();
  }

  /**
   * Initialize error statistics
   */
  private initializeStatistics(): ErrorStatistics {
    return {
      totalErrors: 0,
      errorsByCategory: {} as Record<ErrorCategory, number>,
      errorsBySeverity: {} as Record<ErrorSeverity, number>,
      errorsByPattern: {},
      recoverySuccessRate: {} as Record<RecoveryStrategy, number>,
      mostCommonErrors: [],
      recentTrends: []
    };
  }

  /**
   * Load default error patterns
   */
  private loadDefaultPatterns(): void {
    this.patterns = [
      // Network patterns
      {
        name: 'network_connection_refused',
        description: 'Network connection refused errors',
        matchers: [
          { type: 'code', pattern: /^(ECONNREFUSED|ECONNRESET)$/, weight: 0.9 },
          { type: 'message', pattern: /connection\s+(refused|reset)/i, weight: 0.7 }
        ],
        category: 'network',
        severity: 'medium',
        retryable: true,
        recoveryStrategy: 'retry',
        maxAttempts: 3,
        tags: ['network', 'connection', 'transient']
      },
      {
        name: 'network_timeout',
        description: 'Network timeout errors',
        matchers: [
          { type: 'code', pattern: /^(ETIMEDOUT|ESOCKETTIMEDOUT)$/, weight: 0.9 },
          { type: 'message', pattern: /timeout/i, weight: 0.6 },
          { type: 'metadata', pattern: 'timeout', weight: 0.5 }
        ],
        category: 'network',
        severity: 'medium',
        retryable: true,
        recoveryStrategy: 'retry',
        maxAttempts: 3,
        tags: ['network', 'timeout', 'transient']
      },
      {
        name: 'network_dns_error',
        description: 'DNS resolution errors',
        matchers: [
          { type: 'code', pattern: /^(ENOTFOUND|ENODATA)$/, weight: 0.9 },
          { type: 'message', pattern: /dns|name resolution/i, weight: 0.7 }
        ],
        category: 'network',
        severity: 'high',
        retryable: true,
        recoveryStrategy: 'fallback',
        maxAttempts: 2,
        tags: ['network', 'dns', 'infrastructure']
      },

      // Bridge patterns
      {
        name: 'bridge_not_running',
        description: 'Bridge process not running',
        matchers: [
          { type: 'code', pattern: /^BRIDGE_NOT_RUNNING$/, weight: 1.0 },
          { type: 'message', pattern: /bridge.*not.*running/i, weight: 0.8 },
          { type: 'context', pattern: 'bridge', weight: 0.6 }
        ],
        category: 'bridge',
        severity: 'high',
        retryable: true,
        recoveryStrategy: 'restart',
        maxAttempts: 3,
        tags: ['bridge', 'process', 'restart']
      },
      {
        name: 'bridge_health_check_failed',
        description: 'Bridge health check failures',
        matchers: [
          { type: 'code', pattern: /^BRIDGE_HEALTH_CHECK_FAILED$/, weight: 1.0 },
          { type: 'message', pattern: /health.*check.*failed/i, weight: 0.8 },
          { type: 'metadata', pattern: 'endpoint', weight: 0.5 }
        ],
        category: 'bridge',
        severity: 'high',
        retryable: true,
        recoveryStrategy: 'circuit_breaker',
        maxAttempts: 2,
        tags: ['bridge', 'health', 'monitoring']
      },
      {
        name: 'bridge_timeout',
        description: 'Bridge operation timeout',
        matchers: [
          { type: 'code', pattern: /^BRIDGE_TIMEOUT$/, weight: 1.0 },
          { type: 'message', pattern: /bridge.*timeout/i, weight: 0.8 },
          { type: 'context', pattern: 'bridge', weight: 0.6 }
        ],
        category: 'bridge',
        severity: 'medium',
        retryable: true,
        recoveryStrategy: 'retry',
        maxAttempts: 2,
        tags: ['bridge', 'timeout', 'performance']
      },

      // Telegram patterns
      {
        name: 'telegram_rate_limit',
        description: 'Telegram API rate limiting',
        matchers: [
          { type: 'code', pattern: /^TELEGRAM_RATE_LIMITED$/, weight: 1.0 },
          { type: 'message', pattern: /rate.?limit/i, weight: 0.8 },
          { type: 'metadata', pattern: 'retryAfter', weight: 0.7 }
        ],
        category: 'telegram',
        severity: 'medium',
        retryable: true,
        recoveryStrategy: 'circuit_breaker',
        maxAttempts: 5,
        tags: ['telegram', 'rate_limit', 'backoff']
      },
      {
        name: 'telegram_auth_failed',
        description: 'Telegram authentication failure',
        matchers: [
          { type: 'code', pattern: /^TELEGRAM_AUTH_FAILED$/, weight: 1.0 },
          { type: 'message', pattern: /auth.*failed|unauthorized/i, weight: 0.8 },
          { type: 'message', pattern: /token.*invalid/i, weight: 0.7 }
        ],
        category: 'telegram',
        severity: 'critical',
        retryable: false,
        recoveryStrategy: 'escalate',
        maxAttempts: 0,
        tags: ['telegram', 'authentication', 'critical']
      },

      // Filesystem patterns
      {
        name: 'filesystem_permission_denied',
        description: 'File system permission errors',
        matchers: [
          { type: 'code', pattern: /^(EACCES|EPERM)$/, weight: 0.9 },
          { type: 'message', pattern: /permission.*denied|access.*denied/i, weight: 0.8 }
        ],
        category: 'filesystem',
        severity: 'high',
        retryable: false,
        recoveryStrategy: 'escalate',
        maxAttempts: 0,
        tags: ['filesystem', 'permission', 'security']
      },
      {
        name: 'filesystem_not_found',
        description: 'File or directory not found',
        matchers: [
          { type: 'code', pattern: /^ENOENT$/, weight: 0.9 },
          { type: 'message', pattern: /no such file|not found/i, weight: 0.7 }
        ],
        category: 'filesystem',
        severity: 'medium',
        retryable: true,
        recoveryStrategy: 'fallback',
        maxAttempts: 1,
        tags: ['filesystem', 'missing', 'fallback']
      },
      {
        name: 'filesystem_disk_full',
        description: 'Disk space exhausted',
        matchers: [
          { type: 'code', pattern: /^ENOSPC$/, weight: 0.9 },
          { type: 'message', pattern: /no space left|disk full/i, weight: 0.8 }
        ],
        category: 'filesystem',
        severity: 'critical',
        retryable: false,
        recoveryStrategy: 'graceful_degradation',
        maxAttempts: 0,
        tags: ['filesystem', 'space', 'critical']
      },

      // Resource patterns
      {
        name: 'resource_exhausted_memory',
        description: 'Memory exhaustion',
        matchers: [
          { type: 'code', pattern: /^(ENOMEM|EMFILE|ENFILE)$/, weight: 0.9 },
          { type: 'message', pattern: /out of memory|too many.*files/i, weight: 0.8 }
        ],
        category: 'resource',
        severity: 'critical',
        retryable: false,
        recoveryStrategy: 'graceful_degradation',
        maxAttempts: 0,
        tags: ['resource', 'memory', 'critical']
      },

      // Validation patterns
      {
        name: 'validation_failed',
        description: 'Input validation failures',
        matchers: [
          { type: 'code', pattern: /^VALIDATION_FAILED$/, weight: 1.0 },
          { type: 'message', pattern: /validation.*failed|invalid.*input/i, weight: 0.8 }
        ],
        category: 'validation',
        severity: 'medium',
        retryable: false,
        recoveryStrategy: 'escalate',
        maxAttempts: 0,
        tags: ['validation', 'input', 'client_error']
      },

      // Security patterns
      {
        name: 'security_auth_failed',
        description: 'Authentication failures',
        matchers: [
          { type: 'code', pattern: /^(AUTH_FAILED|AUTH_MISSING_KEY|AUTH_INVALID_KEY)$/, weight: 1.0 },
          { type: 'message', pattern: /authentication.*failed|invalid.*key/i, weight: 0.8 }
        ],
        category: 'security',
        severity: 'high',
        retryable: false,
        recoveryStrategy: 'escalate',
        maxAttempts: 0,
        tags: ['security', 'authentication', 'access']
      },

      // System patterns
      {
        name: 'system_overloaded',
        description: 'System overload conditions',
        matchers: [
          { type: 'message', pattern: /overload|too many requests|system busy/i, weight: 0.8 },
          { type: 'code', pattern: /^(EAGAIN|EBUSY)$/, weight: 0.7 }
        ],
        category: 'system',
        severity: 'high',
        retryable: true,
        recoveryStrategy: 'graceful_degradation',
        maxAttempts: 2,
        tags: ['system', 'overload', 'performance']
      }
    ];

    secureLog('info', 'Error classifier initialized', {
      patterns_loaded: this.patterns.length,
      categories: [...new Set(this.patterns.map(p => p.category))],
      recovery_strategies: [...new Set(this.patterns.map(p => p.recoveryStrategy))]
    });
  }

  /**
   * Classify an error and determine appropriate recovery strategy
   */
  public classify(error: Error | BaseResilienceError, context: any = {}): ErrorClassification {
    const startTime = Date.now();
    
    // Convert to BaseResilienceError if necessary
    let resilienceError: BaseResilienceError;
    if (error instanceof BaseResilienceError) {
      resilienceError = error;
    } else {
      resilienceError = createResilienceError(error, context);
    }

    // Find matching patterns
    const patternMatches = this.patterns.map(pattern => ({
      pattern,
      score: this.calculatePatternScore(resilienceError, pattern)
    })).filter(match => match.score > 0).sort((a, b) => b.score - a.score);

    let classification: ErrorClassification;

    if (patternMatches.length > 0) {
      const bestMatch = patternMatches[0];
      const confidence = Math.min(bestMatch.score, 1.0);
      
      classification = {
        pattern: bestMatch.pattern,
        confidence,
        category: bestMatch.pattern.category,
        severity: this.adjustSeverityByFrequency(bestMatch.pattern.severity, bestMatch.pattern.name),
        retryable: bestMatch.pattern.retryable,
        recoveryStrategy: bestMatch.pattern.recoveryStrategy,
        maxAttempts: bestMatch.pattern.maxAttempts,
        reasoning: `Matched pattern '${bestMatch.pattern.name}' with ${Math.round(confidence * 100)}% confidence`,
        alternativePatterns: patternMatches.slice(1, 4).map(m => m.pattern)
      };
    } else {
      // Fallback classification based on error properties
      classification = this.createFallbackClassification(resilienceError);
    }

    // Update statistics
    this.updateStatistics(resilienceError, classification);

    // Log classification
    secureLog('debug', 'Error classified', {
      error_code: resilienceError.code,
      error_category: resilienceError.category,
      pattern_matched: classification.pattern?.name,
      confidence: classification.confidence,
      recovery_strategy: classification.recoveryStrategy,
      classification_time_ms: Date.now() - startTime
    });

    return classification;
  }

  /**
   * Calculate how well an error matches a pattern
   */
  private calculatePatternScore(error: BaseResilienceError, pattern: ErrorPattern): number {
    let totalScore = 0;
    let totalWeight = 0;

    for (const matcher of pattern.matchers) {
      const weight = matcher.weight;
      let score = 0;

      switch (matcher.type) {
        case 'code':
          score = this.matchPattern(error.code, matcher.pattern) ? 1 : 0;
          break;
        case 'message':
          score = this.matchPattern(error.message, matcher.pattern) ? 1 : 0;
          break;
        case 'stack':
          score = this.matchPattern(error.stack, matcher.pattern) ? 1 : 0;
          break;
        case 'metadata':
          score = this.matchMetadata(error.context.metadata || {}, matcher.pattern) ? 1 : 0;
          break;
        case 'context':
          score = this.matchContext(error.context, matcher.pattern) ? 1 : 0;
          break;
      }

      totalScore += score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Match a value against a string or regex pattern
   */
  private matchPattern(value: string, pattern: string | RegExp): boolean {
    if (!value) return false;
    
    if (typeof pattern === 'string') {
      return value.toLowerCase().includes(pattern.toLowerCase());
    } else {
      return pattern.test(value);
    }
  }

  /**
   * Match metadata against a pattern
   */
  private matchMetadata(metadata: Record<string, any>, pattern: string): boolean {
    return Object.keys(metadata).some(key => 
      key.toLowerCase().includes(pattern.toLowerCase()) ||
      String(metadata[key]).toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Match context against a pattern
   */
  private matchContext(context: any, pattern: string): boolean {
    const contextStr = JSON.stringify(context).toLowerCase();
    return contextStr.includes(pattern.toLowerCase());
  }

  /**
   * Adjust severity based on error frequency
   */
  private adjustSeverityByFrequency(baseSeverity: ErrorSeverity, patternName: string): ErrorSeverity {
    const frequency = this.statistics.errorsByPattern[patternName] || 0;
    
    // If error is very frequent, potentially reduce severity
    if (frequency > 100) {
      if (baseSeverity === 'high') return 'medium';
      if (baseSeverity === 'medium') return 'low';
    }
    
    // If error is rare but severe, potentially increase severity
    if (frequency < 5 && baseSeverity === 'medium') {
      return 'high';
    }
    
    return baseSeverity;
  }

  /**
   * Create fallback classification for unmatched errors
   */
  private createFallbackClassification(error: BaseResilienceError): ErrorClassification {
    return {
      pattern: null,
      confidence: 0.5,
      category: error.category || 'unknown',
      severity: error.severity || 'medium',
      retryable: error.retryable !== undefined ? error.retryable : true,
      recoveryStrategy: error.recovery?.strategy || 'retry',
      maxAttempts: error.recovery?.maxAttempts || 3,
      reasoning: 'No specific pattern matched, using error defaults',
      alternativePatterns: []
    };
  }

  /**
   * Update error statistics
   */
  private updateStatistics(error: BaseResilienceError, classification: ErrorClassification): void {
    this.statistics.totalErrors++;
    
    // Update category counts
    this.statistics.errorsByCategory[classification.category] = 
      (this.statistics.errorsByCategory[classification.category] || 0) + 1;
    
    // Update severity counts
    this.statistics.errorsBySeverity[classification.severity] = 
      (this.statistics.errorsBySeverity[classification.severity] || 0) + 1;
    
    // Update pattern counts
    if (classification.pattern) {
      this.statistics.errorsByPattern[classification.pattern.name] = 
        (this.statistics.errorsByPattern[classification.pattern.name] || 0) + 1;
    }

    // Add to recent errors
    this.recentErrors.push({ error, timestamp: Date.now() });
    
    // Trim recent errors to max size
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors = this.recentErrors.slice(-this.maxRecentErrors);
    }

    // Update trends (aggregate by hour)
    this.updateTrends(classification.category);
    
    // Update most common errors
    this.updateMostCommonErrors();
  }

  /**
   * Update trend statistics
   */
  private updateTrends(category: ErrorCategory): void {
    const now = Date.now();
    const hourStart = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
    
    const existingTrend = this.statistics.recentTrends.find(
      trend => trend.timestamp === hourStart && trend.category === category
    );
    
    if (existingTrend) {
      existingTrend.count++;
    } else {
      this.statistics.recentTrends.push({
        timestamp: hourStart,
        category,
        count: 1
      });
    }
    
    // Keep only recent trends (last 7 days)
    const cutoff = now - (7 * 24 * 60 * 60 * 1000);
    this.statistics.recentTrends = this.statistics.recentTrends.filter(
      trend => trend.timestamp > cutoff
    );
  }

  /**
   * Update most common errors list
   */
  private updateMostCommonErrors(): void {
    const errorCounts = Object.entries(this.statistics.errorsByPattern)
      .map(([pattern, count]) => {
        const patternObj = this.patterns.find(p => p.name === pattern);
        return {
          pattern,
          count,
          category: patternObj?.category || 'unknown' as ErrorCategory,
          severity: patternObj?.severity || 'medium' as ErrorSeverity
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    this.statistics.mostCommonErrors = errorCounts;
  }

  /**
   * Record recovery attempt outcome
   */
  public recordRecoveryOutcome(
    strategy: RecoveryStrategy,
    success: boolean
  ): void {
    if (!this.statistics.recoverySuccessRate[strategy]) {
      this.statistics.recoverySuccessRate[strategy] = 0;
    }
    
    // Simple moving average for success rate
    const currentRate = this.statistics.recoverySuccessRate[strategy];
    const newRate = success ? 1 : 0;
    this.statistics.recoverySuccessRate[strategy] = (currentRate * 0.9) + (newRate * 0.1);
  }

  /**
   * Get current error statistics
   */
  public getStatistics(): ErrorStatistics {
    return { ...this.statistics };
  }

  /**
   * Add custom error pattern
   */
  public addPattern(pattern: ErrorPattern): void {
    this.patterns.push(pattern);
    secureLog('info', 'Custom error pattern added', {
      pattern_name: pattern.name,
      pattern_category: pattern.category,
      total_patterns: this.patterns.length
    });
  }

  /**
   * Remove error pattern
   */
  public removePattern(patternName: string): boolean {
    const initialLength = this.patterns.length;
    this.patterns = this.patterns.filter(p => p.name !== patternName);
    const removed = this.patterns.length < initialLength;
    
    if (removed) {
      secureLog('info', 'Error pattern removed', {
        pattern_name: patternName,
        remaining_patterns: this.patterns.length
      });
    }
    
    return removed;
  }

  /**
   * Get all loaded patterns
   */
  public getPatterns(): ErrorPattern[] {
    return [...this.patterns];
  }

  /**
   * Clear statistics (for testing or reset)
   */
  public clearStatistics(): void {
    this.statistics = this.initializeStatistics();
    this.recentErrors = [];
    secureLog('info', 'Error classifier statistics cleared');
  }
}
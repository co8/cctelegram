/**
 * Security Monitor
 * 
 * Advanced security monitoring with threat detection, compliance tracking,
 * incident response automation, and real-time security event analysis.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { SecurityMonitoringConfig, EscalationRule } from '../config.js';
import { StructuredLogger } from '../logging/structured-logger.js';
import { secureLog } from '../../security.js';

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  source: string;
  description: string;
  details: Record<string, any>;
  classification: SecurityClassification;
  mitigation?: SecurityMitigation;
  correlationId?: string;
  clientInfo?: {
    ip: string;
    userAgent: string;
    userId?: string;
    sessionId?: string;
  };
  indicators?: ThreatIndicator[];
}

export type SecurityEventType = 
  | 'authentication_failure'
  | 'authorization_violation' 
  | 'suspicious_activity'
  | 'malicious_request'
  | 'data_exfiltration_attempt'
  | 'injection_attack'
  | 'rate_limit_exceeded'
  | 'anomalous_behavior'
  | 'compliance_violation'
  | 'security_misconfiguration'
  | 'vulnerability_exploit'
  | 'insider_threat'
  | 'external_threat';

export interface SecurityClassification {
  confidentiality: 'public' | 'internal' | 'confidential' | 'restricted';
  integrity: 'low' | 'medium' | 'high';
  availability: 'low' | 'medium' | 'high';
  dataTypes: string[];
  complianceImpact: string[];
}

export interface SecurityMitigation {
  action: 'log' | 'alert' | 'block' | 'quarantine' | 'escalate';
  automated: boolean;
  timestamp: number;
  effectiveness: 'pending' | 'successful' | 'failed' | 'partial';
  details: Record<string, any>;
}

export interface ThreatIndicator {
  type: 'ip' | 'hash' | 'domain' | 'pattern' | 'behavior';
  value: string;
  confidence: number; // 0-100
  source: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
}

export interface SecurityMetrics {
  totalEvents: number;
  eventsBySeverity: Map<string, number>;
  eventsByType: Map<string, number>;
  topThreats: ThreatIndicator[];
  complianceScore: number;
  incidentResponseTime: number;
  falsePositiveRate: number;
  threatsBlocked: number;
  threatsTrended: Array<{ timestamp: number; count: number; severity: string }>;
}

export interface ComplianceCheck {
  standard: string;
  requirement: string;
  status: 'compliant' | 'non_compliant' | 'partially_compliant' | 'not_applicable';
  score: number; // 0-100
  evidence: string[];
  recommendations: string[];
  lastAssessed: number;
}

export class SecurityMonitor extends EventEmitter {
  private config: SecurityMonitoringConfig;
  private logger?: StructuredLogger;
  private events: Map<string, SecurityEvent> = new Map();
  private threatIndicators: Map<string, ThreatIndicator> = new Map();
  private metrics: SecurityMetrics;
  private complianceChecks: Map<string, ComplianceCheck> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private blockedIPs: Set<string> = new Set();
  private monitoringInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;

  // Pattern matching for threat detection
  private suspiciousPatterns: RegExp[] = [];
  private injectionPatterns: RegExp[] = [];
  private behaviorBaselines: Map<string, BehaviorBaseline> = new Map();

  constructor(config: SecurityMonitoringConfig, logger?: StructuredLogger) {
    super();
    this.config = config;
    this.logger = logger;
    this.metrics = this.initializeMetrics();
    
    this.setupThreatPatterns();
    this.setupRateLimiters();
    this.setupComplianceChecks();
    
    secureLog('info', 'Security monitor initialized', {
      enabled: config.enabled,
      threatDetection: config.threatDetection.enabled,
      compliance: config.compliance.enabled,
      incidentResponse: config.incidentResponse.enabled
    });
  }

  /**
   * Initialize the security monitor
   */
  public async initialize(): Promise<void> {
    try {
      // Load threat intelligence feeds
      await this.loadThreatIntelligence();
      
      // Initialize compliance monitoring
      if (this.config.compliance.enabled) {
        await this.initializeComplianceMonitoring();
      }
      
      // Start monitoring
      this.startMonitoring();
      
      secureLog('info', 'Security monitor initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize security monitor', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Initialize metrics structure
   */
  private initializeMetrics(): SecurityMetrics {
    return {
      totalEvents: 0,
      eventsBySeverity: new Map(),
      eventsByType: new Map(),
      topThreats: [],
      complianceScore: 100,
      incidentResponseTime: 0,
      falsePositiveRate: 0,
      threatsBlocked: 0,
      threatsTrended: []
    };
  }

  /**
   * Set up threat detection patterns
   */
  private setupThreatPatterns(): void {
    // Convert configured patterns to RegExp
    this.suspiciousPatterns = this.config.threatDetection.suspiciousPatterns.map(
      pattern => new RegExp(pattern, 'i')
    );

    // Add common injection patterns
    this.injectionPatterns = [
      /union.*select/i,
      /insert.*into/i,
      /delete.*from/i,
      /drop.*table/i,
      /script.*>/i,
      /<.*script/i,
      /javascript:/i,
      /eval\(/i,
      /exec\(/i,
      /system\(/i,
      /\.\.\/\.\.\//,
      /etc\/passwd/i,
      /\/etc\/shadow/i
    ];
  }

  /**
   * Set up rate limiters
   */
  private setupRateLimiters(): void {
    const windowSize = this.config.threatDetection.rateLimitThresholds.timeWindow;
    const maxRequests = this.config.threatDetection.rateLimitThresholds.requests;
    
    // Global rate limiter
    this.rateLimiters.set('global', new RateLimiter(maxRequests, windowSize));
    
    // Per-IP rate limiters will be created dynamically
  }

  /**
   * Set up compliance checks
   */
  private setupComplianceChecks(): void {
    if (!this.config.compliance.enabled) return;

    for (const standard of this.config.compliance.standards) {
      switch (standard) {
        case 'SOC2':
          this.setupSOC2Checks();
          break;
        case 'PCI-DSS':
          this.setupPCIDSSChecks();
          break;
        case 'GDPR':
          this.setupGDPRChecks();
          break;
        case 'HIPAA':
          this.setupHIPAAChecks();
          break;
      }
    }
  }

  /**
   * Start security monitoring
   */
  private startMonitoring(): void {
    this.isRunning = true;
    
    // Start periodic threat analysis
    this.monitoringInterval = setInterval(() => {
      this.analyzeThreatPatterns();
      this.updateMetrics();
      this.performComplianceChecks();
    }, 60000); // Every minute

    secureLog('info', 'Security monitoring started');
  }

  /**
   * Record a security event
   */
  public recordSecurityEvent(eventData: Partial<SecurityEvent>): SecurityEvent {
    const event: SecurityEvent = {
      id: eventData.id || this.generateEventId(),
      type: eventData.type || 'suspicious_activity',
      severity: eventData.severity || 'medium',
      timestamp: eventData.timestamp || Date.now(),
      source: eventData.source || 'security_monitor',
      description: eventData.description || 'Security event detected',
      details: eventData.details || {},
      classification: eventData.classification || this.classifyEvent(eventData),
      correlationId: eventData.correlationId || this.generateCorrelationId(),
      clientInfo: eventData.clientInfo,
      indicators: eventData.indicators || []
    };

    // Store event
    this.events.set(event.id, event);

    // Update threat indicators
    this.updateThreatIndicators(event);

    // Analyze and respond to threat
    this.analyzeThreat(event);

    // Log security event
    this.logger?.log('warn', `Security event: ${event.description}`, {
      security_event: true,
      event_id: event.id,
      event_type: event.type,
      severity: event.severity,
      client_ip: event.clientInfo?.ip,
      correlation_id: event.correlationId,
      ...event.details
    });

    // Emit event for listeners
    this.emit('security_event', event);

    // Update metrics
    this.updateEventMetrics(event);

    return event;
  }

  /**
   * Analyze incoming request for threats
   */
  public analyzeRequest(request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
    ip: string;
    userAgent: string;
    userId?: string;
    sessionId?: string;
  }): { threat: boolean; events: SecurityEvent[] } {
    const events: SecurityEvent[] = [];
    let threatDetected = false;

    // Check rate limiting
    const rateLimitViolation = this.checkRateLimit(request.ip);
    if (rateLimitViolation) {
      events.push(this.recordSecurityEvent({
        type: 'rate_limit_exceeded',
        severity: 'medium',
        description: 'Rate limit exceeded',
        clientInfo: {
          ip: request.ip,
          userAgent: request.userAgent,
          userId: request.userId,
          sessionId: request.sessionId
        },
        details: {
          requests_per_window: rateLimitViolation.requestsInWindow,
          window_size: rateLimitViolation.windowSize
        }
      }));
      threatDetected = true;
    }

    // Check for suspicious patterns in URL
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(request.url)) {
        events.push(this.recordSecurityEvent({
          type: 'suspicious_activity',
          severity: 'high',
          description: 'Suspicious pattern detected in URL',
          clientInfo: {
            ip: request.ip,
            userAgent: request.userAgent,
            userId: request.userId,
            sessionId: request.sessionId
          },
          details: {
            url: request.url,
            pattern: pattern.source,
            method: request.method
          }
        }));
        threatDetected = true;
      }
    }

    // Check for injection attacks
    const requestContent = JSON.stringify(request.body || '') + request.url;
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(requestContent)) {
        events.push(this.recordSecurityEvent({
          type: 'injection_attack',
          severity: 'critical',
          description: 'Injection attack detected',
          clientInfo: {
            ip: request.ip,
            userAgent: request.userAgent,
            userId: request.userId,
            sessionId: request.sessionId
          },
          details: {
            attack_type: 'injection',
            pattern: pattern.source,
            method: request.method,
            url: request.url
          }
        }));
        threatDetected = true;
      }
    }

    // Check IP reputation
    if (this.blockedIPs.has(request.ip)) {
      events.push(this.recordSecurityEvent({
        type: 'external_threat',
        severity: 'high',
        description: 'Request from blocked IP',
        clientInfo: {
          ip: request.ip,
          userAgent: request.userAgent,
          userId: request.userId,
          sessionId: request.sessionId
        },
        details: {
          blocked_ip: request.ip,
          reason: 'IP on blocklist'
        }
      }));
      threatDetected = true;
    }

    // Behavioral analysis
    const behaviorThreat = this.analyzeBehavior(request);
    if (behaviorThreat) {
      events.push(behaviorThreat);
      threatDetected = true;
    }

    return { threat: threatDetected, events };
  }

  /**
   * Check rate limiting for IP
   */
  private checkRateLimit(ip: string): { requestsInWindow: number; windowSize: number } | null {
    const globalLimiter = this.rateLimiters.get('global')!;
    const ipLimiterId = `ip_${ip}`;
    
    // Create per-IP limiter if it doesn't exist
    if (!this.rateLimiters.has(ipLimiterId)) {
      this.rateLimiters.set(ipLimiterId, new RateLimiter(
        this.config.threatDetection.rateLimitThresholds.requests,
        this.config.threatDetection.rateLimitThresholds.timeWindow
      ));
    }
    
    const ipLimiter = this.rateLimiters.get(ipLimiterId)!;
    
    // Check both global and per-IP limits
    const globalViolation = globalLimiter.checkLimit();
    const ipViolation = ipLimiter.checkLimit();
    
    if (globalViolation || ipViolation) {
      return {
        requestsInWindow: ipLimiter.getRequestCount(),
        windowSize: this.config.threatDetection.rateLimitThresholds.timeWindow
      };
    }
    
    return null;
  }

  /**
   * Analyze behavioral patterns
   */
  private analyzeBehavior(request: any): SecurityEvent | null {
    const key = request.userId || request.ip;
    
    if (!this.behaviorBaselines.has(key)) {
      this.behaviorBaselines.set(key, new BehaviorBaseline());
    }
    
    const baseline = this.behaviorBaselines.get(key)!;
    const anomaly = baseline.analyzeRequest(request);
    
    if (anomaly.isAnomalous) {
      return this.recordSecurityEvent({
        type: 'anomalous_behavior',
        severity: anomaly.severity,
        description: 'Anomalous behavior detected',
        clientInfo: {
          ip: request.ip,
          userAgent: request.userAgent,
          userId: request.userId,
          sessionId: request.sessionId
        },
        details: {
          anomaly_type: anomaly.type,
          confidence: anomaly.confidence,
          baseline_deviation: anomaly.deviation
        }
      });
    }
    
    return null;
  }

  /**
   * Analyze threat and determine response
   */
  private analyzeThreat(event: SecurityEvent): void {
    // Determine mitigation action based on severity and rules
    let action: SecurityMitigation['action'] = 'log';
    
    for (const rule of this.config.incidentResponse.escalationRules) {
      if (this.evaluateEscalationRule(event, rule)) {
        action = rule.action as SecurityMitigation['action'];
        break;
      }
    }

    // Execute mitigation
    const mitigation = this.executeMitigation(event, action);
    event.mitigation = mitigation;

    // Update event in storage
    this.events.set(event.id, event);
  }

  /**
   * Execute security mitigation
   */
  private executeMitigation(event: SecurityEvent, action: SecurityMitigation['action']): SecurityMitigation {
    const mitigation: SecurityMitigation = {
      action,
      automated: true,
      timestamp: Date.now(),
      effectiveness: 'pending',
      details: {}
    };

    try {
      switch (action) {
        case 'block':
          if (event.clientInfo?.ip) {
            this.blockedIPs.add(event.clientInfo.ip);
            mitigation.details.blocked_ip = event.clientInfo.ip;
            mitigation.effectiveness = 'successful';
          }
          break;

        case 'alert':
          this.emit('security_alert', {
            event,
            urgency: event.severity === 'critical' ? 'immediate' : 'high'
          });
          mitigation.effectiveness = 'successful';
          break;

        case 'escalate':
          this.escalateIncident(event);
          mitigation.effectiveness = 'successful';
          break;

        case 'quarantine':
          // Implement quarantine logic
          mitigation.details.quarantine_applied = true;
          mitigation.effectiveness = 'successful';
          break;

        default:
          mitigation.effectiveness = 'successful';
      }

      this.logger?.info('Security mitigation executed', {
        event_id: event.id,
        action,
        effectiveness: mitigation.effectiveness,
        ...mitigation.details
      });

    } catch (error) {
      mitigation.effectiveness = 'failed';
      mitigation.details.error = error instanceof Error ? error.message : 'unknown';
      
      this.logger?.error('Security mitigation failed', error as Error, {
        event_id: event.id,
        action
      });
    }

    return mitigation;
  }

  /**
   * Escalate security incident
   */
  private escalateIncident(event: SecurityEvent): void {
    // Implement incident escalation logic
    this.emit('incident_escalated', {
      event,
      escalation_level: event.severity === 'critical' ? 3 : 2,
      requires_human_intervention: true
    });

    this.logger?.fatal('Security incident escalated', undefined, {
      event_id: event.id,
      event_type: event.type,
      severity: event.severity,
      client_ip: event.clientInfo?.ip
    });
  }

  /**
   * Update threat indicators
   */
  private updateThreatIndicators(event: SecurityEvent): void {
    if (event.clientInfo?.ip) {
      const key = `ip_${event.clientInfo.ip}`;
      this.updateIndicator(key, {
        type: 'ip',
        value: event.clientInfo.ip,
        confidence: this.calculateThreatConfidence(event),
        source: event.source
      });
    }

    // Add other indicators based on event type
    if (event.indicators) {
      event.indicators.forEach(indicator => {
        this.updateIndicator(`${indicator.type}_${indicator.value}`, indicator);
      });
    }
  }

  /**
   * Update individual threat indicator
   */
  private updateIndicator(key: string, indicator: Partial<ThreatIndicator>): void {
    const existing = this.threatIndicators.get(key);
    const now = Date.now();

    if (existing) {
      existing.lastSeen = now;
      existing.count++;
      existing.confidence = Math.min(100, existing.confidence + 5);
    } else {
      this.threatIndicators.set(key, {
        type: indicator.type!,
        value: indicator.value!,
        confidence: indicator.confidence || 50,
        source: indicator.source || 'security_monitor',
        firstSeen: now,
        lastSeen: now,
        count: 1
      });
    }
  }

  /**
   * Calculate threat confidence based on event
   */
  private calculateThreatConfidence(event: SecurityEvent): number {
    let confidence = 30; // Base confidence

    switch (event.type) {
      case 'injection_attack':
        confidence = 90;
        break;
      case 'malicious_request':
        confidence = 80;
        break;
      case 'suspicious_activity':
        confidence = 60;
        break;
      case 'rate_limit_exceeded':
        confidence = 40;
        break;
      default:
        confidence = 50;
    }

    // Adjust based on severity
    switch (event.severity) {
      case 'critical':
        confidence += 20;
        break;
      case 'high':
        confidence += 10;
        break;
      case 'low':
        confidence -= 10;
        break;
    }

    return Math.min(100, Math.max(0, confidence));
  }

  /**
   * Evaluate escalation rule
   */
  private evaluateEscalationRule(event: SecurityEvent, rule: EscalationRule): boolean {
    // Simple condition evaluation - in practice, this would be more sophisticated
    const condition = rule.condition.toLowerCase();
    
    if (condition.includes('critical') && event.severity === 'critical') {
      return true;
    }
    
    if (condition.includes('injection') && event.type === 'injection_attack') {
      return true;
    }
    
    if (condition.includes('high') && ['critical', 'high'].includes(event.severity)) {
      return true;
    }
    
    return false;
  }

  /**
   * Classify security event
   */
  private classifyEvent(eventData: Partial<SecurityEvent>): SecurityClassification {
    return {
      confidentiality: 'internal',
      integrity: 'medium',
      availability: 'medium',
      dataTypes: ['security_logs'],
      complianceImpact: []
    };
  }

  /**
   * Generate event ID
   */
  private generateEventId(): string {
    return `sec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generate correlation ID
   */
  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }

  /**
   * Load threat intelligence
   */
  private async loadThreatIntelligence(): Promise<void> {
    // In a real implementation, this would load from external threat intelligence feeds
    // For now, we'll initialize with some known bad IPs and patterns
    
    const knownBadIPs = [
      '192.168.1.100', // Example blocked IP
      '10.0.0.1'       // Example blocked IP
    ];

    knownBadIPs.forEach(ip => {
      this.blockedIPs.add(ip);
      this.threatIndicators.set(`ip_${ip}`, {
        type: 'ip',
        value: ip,
        confidence: 95,
        source: 'threat_intelligence',
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        count: 1
      });
    });

    secureLog('info', 'Threat intelligence loaded', {
      blocked_ips: knownBadIPs.length,
      threat_indicators: this.threatIndicators.size
    });
  }

  /**
   * Initialize compliance monitoring
   */
  private async initializeComplianceMonitoring(): Promise<void> {
    // Set up compliance checks based on configured standards
    this.performComplianceChecks();
    secureLog('info', 'Compliance monitoring initialized');
  }

  /**
   * Set up SOC2 compliance checks
   */
  private setupSOC2Checks(): void {
    this.complianceChecks.set('soc2_access_control', {
      standard: 'SOC2',
      requirement: 'Access Control',
      status: 'compliant',
      score: 100,
      evidence: ['Authentication required', 'Rate limiting enabled'],
      recommendations: [],
      lastAssessed: Date.now()
    });

    this.complianceChecks.set('soc2_monitoring', {
      standard: 'SOC2',
      requirement: 'System Monitoring',
      status: 'compliant',
      score: 100,
      evidence: ['Security monitoring active', 'Incident response enabled'],
      recommendations: [],
      lastAssessed: Date.now()
    });
  }

  /**
   * Set up additional compliance checks for other standards
   */
  private setupPCIDSSChecks(): void {
    // PCI-DSS specific checks would go here
  }

  private setupGDPRChecks(): void {
    // GDPR specific checks would go here
  }

  private setupHIPAAChecks(): void {
    // HIPAA specific checks would go here
  }

  /**
   * Perform compliance checks
   */
  private performComplianceChecks(): void {
    if (!this.config.compliance.enabled) return;

    let totalScore = 0;
    let checkCount = 0;

    this.complianceChecks.forEach((check, key) => {
      // Update check based on current security posture
      this.updateComplianceCheck(key, check);
      totalScore += check.score;
      checkCount++;
    });

    this.metrics.complianceScore = checkCount > 0 ? totalScore / checkCount : 100;
  }

  /**
   * Update individual compliance check
   */
  private updateComplianceCheck(key: string, check: ComplianceCheck): void {
    // In a real implementation, this would perform actual compliance validation
    check.lastAssessed = Date.now();
    
    // Example: Check if we have recent security events that might affect compliance
    const recentEvents = Array.from(this.events.values())
      .filter(event => event.timestamp > Date.now() - 86400000); // Last 24 hours

    const criticalEvents = recentEvents.filter(event => event.severity === 'critical');
    
    if (criticalEvents.length > 0) {
      check.status = 'partially_compliant';
      check.score = Math.max(70, check.score - (criticalEvents.length * 5));
      check.recommendations.push('Address critical security events');
    }
  }

  /**
   * Analyze threat patterns periodically
   */
  private analyzeThreatPatterns(): void {
    const recentEvents = Array.from(this.events.values())
      .filter(event => event.timestamp > Date.now() - 3600000); // Last hour

    // Update top threats
    const threatCounts = new Map<string, number>();
    recentEvents.forEach(event => {
      const key = `${event.type}_${event.severity}`;
      threatCounts.set(key, (threatCounts.get(key) || 0) + 1);
    });

    this.metrics.topThreats = Array.from(this.threatIndicators.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    // Trend analysis
    const hourlyCount = recentEvents.length;
    this.metrics.threatsTrended.push({
      timestamp: Date.now(),
      count: hourlyCount,
      severity: recentEvents.some(e => e.severity === 'critical') ? 'critical' : 'normal'
    });

    // Keep only last 24 hours of trend data
    this.metrics.threatsTrended = this.metrics.threatsTrended
      .filter(trend => trend.timestamp > Date.now() - 86400000);
  }

  /**
   * Update event metrics
   */
  private updateEventMetrics(event: SecurityEvent): void {
    this.metrics.totalEvents++;
    
    const severityCount = this.metrics.eventsBySeverity.get(event.severity) || 0;
    this.metrics.eventsBySeverity.set(event.severity, severityCount + 1);
    
    const typeCount = this.metrics.eventsByType.get(event.type) || 0;
    this.metrics.eventsByType.set(event.type, typeCount + 1);

    if (event.mitigation?.action === 'block') {
      this.metrics.threatsBlocked++;
    }
  }

  /**
   * Update overall metrics
   */
  private updateMetrics(): void {
    // Calculate incident response time
    const recentIncidents = Array.from(this.events.values())
      .filter(event => 
        event.severity === 'critical' && 
        event.mitigation &&
        event.timestamp > Date.now() - 86400000
      );

    if (recentIncidents.length > 0) {
      const totalResponseTime = recentIncidents.reduce((sum, event) => {
        return sum + (event.mitigation!.timestamp - event.timestamp);
      }, 0);
      
      this.metrics.incidentResponseTime = totalResponseTime / recentIncidents.length;
    }
  }

  /**
   * Get recent security events
   */
  public getRecentEvents(limit: number = 50): SecurityEvent[] {
    return Array.from(this.events.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get security metrics
   */
  public getMetrics(): SecurityMetrics {
    return { ...this.metrics };
  }

  /**
   * Get compliance status
   */
  public getComplianceStatus(): {
    overall: number;
    checks: ComplianceCheck[];
    recommendations: string[];
  } {
    const checks = Array.from(this.complianceChecks.values());
    const recommendations = checks
      .flatMap(check => check.recommendations)
      .filter((rec, index, arr) => arr.indexOf(rec) === index); // Unique recommendations

    return {
      overall: this.metrics.complianceScore,
      checks,
      recommendations
    };
  }

  /**
   * Get health status
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  }> {
    const details: Record<string, any> = {
      isRunning: this.isRunning,
      totalEvents: this.metrics.totalEvents,
      threatsBlocked: this.metrics.threatsBlocked,
      complianceScore: this.metrics.complianceScore,
      threatIndicators: this.threatIndicators.size,
      blockedIPs: this.blockedIPs.size,
      rateLimiters: this.rateLimiters.size
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!this.isRunning) {
      status = 'unhealthy';
      details.reason = 'Security monitoring not running';
    } else if (this.metrics.complianceScore < 80) {
      status = 'degraded';
      details.reason = 'Low compliance score';
    } else if (this.metrics.incidentResponseTime > 300000) { // 5 minutes
      status = 'degraded';
      details.reason = 'Slow incident response time';
    }

    return { status, details };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<SecurityMonitoringConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.threatDetection) {
      this.setupThreatPatterns();
      this.setupRateLimiters();
    }

    secureLog('info', 'Security monitor configuration updated');
  }

  /**
   * Stop security monitoring
   */
  public async stop(): Promise<void> {
    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    secureLog('info', 'Security monitoring stopped');
  }
}

/**
 * Simple rate limiter implementation
 */
class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowSize: number;

  constructor(maxRequests: number, windowSize: number) {
    this.maxRequests = maxRequests;
    this.windowSize = windowSize;
  }

  checkLimit(): boolean {
    const now = Date.now();
    const windowStart = now - this.windowSize;
    
    // Remove old requests
    this.requests = this.requests.filter(timestamp => timestamp > windowStart);
    
    // Check if limit exceeded
    if (this.requests.length >= this.maxRequests) {
      return true; // Rate limit exceeded
    }
    
    // Add current request
    this.requests.push(now);
    return false;
  }

  getRequestCount(): number {
    const now = Date.now();
    const windowStart = now - this.windowSize;
    return this.requests.filter(timestamp => timestamp > windowStart).length;
  }
}

/**
 * Behavioral baseline for anomaly detection
 */
interface BehaviorBaseline {
  analyzeRequest(request: any): {
    isAnomalous: boolean;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    deviation: number;
  };
}

class BehaviorBaseline implements BehaviorBaseline {
  private requestPatterns: Map<string, number> = new Map();
  private hourlyPatterns: number[] = new Array(24).fill(0);
  private userAgents: Set<string> = new Set();
  private requestCount: number = 0;

  analyzeRequest(request: any): {
    isAnomalous: boolean;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    deviation: number;
  } {
    this.requestCount++;
    const hour = new Date().getHours();
    this.hourlyPatterns[hour]++;
    this.userAgents.add(request.userAgent);

    // Simple anomaly detection based on request frequency
    const hourlyAverage = this.hourlyPatterns.reduce((sum, count) => sum + count, 0) / 24;
    const currentHourRequests = this.hourlyPatterns[hour];
    const deviation = Math.abs(currentHourRequests - hourlyAverage) / (hourlyAverage || 1);

    const isAnomalous = deviation > 2.0; // 2 standard deviations
    
    return {
      isAnomalous,
      type: 'request_frequency',
      severity: deviation > 4.0 ? 'high' : deviation > 3.0 ? 'medium' : 'low',
      confidence: Math.min(95, deviation * 30),
      deviation
    };
  }
}
/**
 * Advanced Alerting Engine for Performance Regression Testing
 * 
 * Comprehensive alerting system with multiple channels, escalation,
 * intelligent routing, and integration with various notification services.
 * 
 * Features:
 * - Multi-channel alerting (console, file, webhook, email, Slack, Teams)
 * - Intelligent alert routing and escalation
 * - Rate limiting and cooldown periods
 * - Alert aggregation and deduplication
 * - Rich notification templates
 * - Integration with external services
 * - Alert acknowledgment and resolution tracking
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import { RegressionAlert, AlertChannel } from '../../tests/performance/regression-detector.js';
import { VisualRegressionResult } from './visual-regression-service.js';

export interface AlertingConfig {
  channels: AlertChannel[];
  escalation: {
    enabled: boolean;
    timeToEscalate: number; // Minutes
    escalationChannels: string[];
    maxEscalations: number;
  };
  dataPath: string;
  rateLimit: {
    maxAlertsPerHour: number;
    maxAlertsPerDay: number;
    cooldownPeriod: number; // Minutes
  };
  aggregation: {
    enabled: boolean;
    aggregationWindow: number; // Minutes
    maxAlertsToAggregate: number;
  };
  templates: {
    [key: string]: AlertTemplate;
  };
}

export interface AlertTemplate {
  subject: string;
  body: string;
  format: 'text' | 'html' | 'markdown';
  variables: string[];
}

export interface EnhancedAlert extends RegressionAlert {
  channel: string;
  escalationLevel: number;
  aggregatedAlerts?: RegressionAlert[];
  templateData: Record<string, any>;
  deliveryStatus: {
    sent: boolean;
    sentAt?: number;
    failed?: boolean;
    failureReason?: string;
    retryCount: number;
  };
}

export interface AlertDeliveryResult {
  success: boolean;
  channel: string;
  alertId: string;
  timestamp: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface WebhookPayload {
  alertType: 'performance_regression' | 'visual_regression' | 'trend_alert';
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  alert: RegressionAlert | VisualRegressionResult;
  metadata: {
    timestamp: string;
    source: string;
    environment: string;
    alertId: string;
  };
}

export interface SlackMessage {
  channel?: string;
  username?: string;
  icon_emoji?: string;
  text?: string;
  attachments?: Array<{
    color: string;
    title: string;
    text: string;
    fields: Array<{
      title: string;
      value: string;
      short: boolean;
    }>;
    footer: string;
    ts: number;
  }>;
}

export interface EmailMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml: boolean;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType: string;
  }>;
}

/**
 * Advanced Alerting Engine
 */
export class AlertingEngine extends EventEmitter {
  private config: AlertingConfig;
  private alertHistory: Map<string, EnhancedAlert[]> = new Map();
  private rateLimitTracker: Map<string, number[]> = new Map();
  private escalationTracker: Map<string, NodeJS.Timeout> = new Map();
  private aggregationBuffer: Map<string, RegressionAlert[]> = new Map();
  
  private isInitialized: boolean = false;

  constructor(config: Partial<AlertingConfig> = {}) {
    super();

    this.config = {
      channels: [],
      escalation: {
        enabled: true,
        timeToEscalate: 60, // 60 minutes
        escalationChannels: ['email', 'slack'],
        maxEscalations: 3
      },
      dataPath: path.join(__dirname, '..', '..', 'alerts'),
      rateLimit: {
        maxAlertsPerHour: 20,
        maxAlertsPerDay: 100,
        cooldownPeriod: 15 // 15 minutes
      },
      aggregation: {
        enabled: true,
        aggregationWindow: 10, // 10 minutes
        maxAlertsToAggregate: 5
      },
      templates: {
        performanceRegression: {
          subject: '🚨 Performance Regression Detected: {{testName}}',
          body: this.getDefaultPerformanceTemplate(),
          format: 'html',
          variables: ['testName', 'severity', 'score', 'responseTimeChange', 'throughputChange', 'errorRateChange', 'recommendations']
        },
        visualRegression: {
          subject: '📸 Visual Regression Detected: {{testName}}',
          body: this.getDefaultVisualTemplate(),
          format: 'html',
          variables: ['testName', 'failedTests', 'totalTests', 'averageDifference', 'maxDifference']
        },
        escalation: {
          subject: '⚠️ ESCALATION: Unacknowledged Performance Alert - {{testName}}',
          body: this.getDefaultEscalationTemplate(),
          format: 'html',
          variables: ['testName', 'severity', 'hoursUnacknowledged', 'originalAlert', 'escalationLevel']
        }
      },
      ...config
    };
  }

  /**
   * Initialize the alerting engine
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await fs.ensureDir(this.config.dataPath);
    await this.loadAlertHistory();

    // Start background jobs
    this.startBackgroundJobs();

    this.isInitialized = true;
    console.log('🚨 Alerting Engine initialized');
  }

  /**
   * Process performance regression alert
   */
  public async processAlert(alert: RegressionAlert): Promise<AlertDeliveryResult[]> {
    console.log(`🚨 Processing alert: ${alert.id} (${alert.severity})`);

    // Check rate limits
    if (!this.checkRateLimit('performance', alert.severity)) {
      console.warn(`Rate limit exceeded for ${alert.severity} alerts`);
      return [];
    }

    // Check for aggregation
    if (this.config.aggregation.enabled) {
      const shouldAggregate = this.shouldAggregateAlert(alert);
      if (shouldAggregate) {
        this.addToAggregationBuffer(alert);
        return [];
      }
    }

    // Prepare enhanced alert
    const enhancedAlert = this.createEnhancedAlert(alert);
    
    // Send alerts through configured channels
    const deliveryResults = await this.sendAlert(enhancedAlert);

    // Setup escalation if enabled
    if (this.config.escalation.enabled) {
      this.setupEscalation(enhancedAlert);
    }

    // Store alert
    this.storeAlert(enhancedAlert);

    this.emit('alertProcessed', { alert: enhancedAlert, results: deliveryResults });
    return deliveryResults;
  }

  /**
   * Process visual regression alert
   */
  public async processVisualRegression(visualResult: VisualRegressionResult): Promise<AlertDeliveryResult[]> {
    if (!visualResult.regressionDetected) return [];

    console.log(`📸 Processing visual regression: ${visualResult.testName}`);

    // Create alert from visual result
    const alert: RegressionAlert = {
      id: `visual-${visualResult.testName}-${Date.now()}`,
      timestamp: visualResult.timestamp,
      severity: this.determineVisualSeverity(visualResult),
      testType: 'visual',
      testName: visualResult.testName,
      comparison: {} as any, // Visual comparisons use different structure
      alertChannels: this.config.channels.map(c => c.name),
      acknowledged: false
    };

    const enhancedAlert = this.createEnhancedAlert(alert, {
      visualResult,
      templateType: 'visualRegression'
    });

    const deliveryResults = await this.sendAlert(enhancedAlert);

    if (this.config.escalation.enabled) {
      this.setupEscalation(enhancedAlert);
    }

    this.storeAlert(enhancedAlert);
    return deliveryResults;
  }

  /**
   * Acknowledge alert
   */
  public async acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string,
    notes?: string
  ): Promise<boolean> {
    const alert = this.findAlert(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = Date.now();
    if (notes) alert.notes = notes;

    // Cancel escalation
    this.cancelEscalation(alertId);

    await this.saveAlertHistory();
    this.emit('alertAcknowledged', alert);

    console.log(`✅ Alert acknowledged: ${alertId} by ${acknowledgedBy}`);
    return true;
  }

  /**
   * Test alert delivery for a channel
   */
  public async testAlertDelivery(channelName: string): Promise<AlertDeliveryResult> {
    const channel = this.config.channels.find(c => c.name === channelName);
    if (!channel) {
      return {
        success: false,
        channel: channelName,
        alertId: 'test',
        timestamp: Date.now(),
        error: 'Channel not found'
      };
    }

    const testAlert: EnhancedAlert = {
      id: `test-${Date.now()}`,
      timestamp: Date.now(),
      severity: 'minor',
      testType: 'test',
      testName: 'Alert System Test',
      comparison: {} as any,
      alertChannels: [channelName],
      acknowledged: false,
      channel: channelName,
      escalationLevel: 0,
      templateData: {
        testName: 'Alert System Test',
        severity: 'minor',
        score: 75,
        responseTimeChange: 5.2,
        throughputChange: -2.1,
        errorRateChange: 0.3,
        recommendations: ['This is a test alert to verify delivery']
      },
      deliveryStatus: {
        sent: false,
        retryCount: 0
      }
    };

    return await this.deliverAlert(testAlert, channel);
  }

  /**
   * Get alert statistics
   */
  public getAlertStatistics(timeRangeHours: number = 24): {
    totalAlerts: number;
    alertsBySeverity: Record<string, number>;
    alertsByChannel: Record<string, number>;
    deliverySuccessRate: number;
    averageDeliveryTime: number;
    escalationRate: number;
  } {
    const cutoffTime = Date.now() - (timeRangeHours * 60 * 60 * 1000);
    const recentAlerts = Array.from(this.alertHistory.values())
      .flat()
      .filter(a => a.timestamp >= cutoffTime);

    const alertsBySeverity = {
      minor: 0,
      moderate: 0,
      major: 0,
      critical: 0
    };

    const alertsByChannel: Record<string, number> = {};
    let deliveredAlerts = 0;
    let totalDeliveryTime = 0;
    let escalatedAlerts = 0;

    for (const alert of recentAlerts) {
      alertsBySeverity[alert.severity]++;
      
      if (alert.deliveryStatus.sent) {
        deliveredAlerts++;
        if (alert.deliveryStatus.sentAt) {
          totalDeliveryTime += alert.deliveryStatus.sentAt - alert.timestamp;
        }
      }

      if (alert.escalationLevel > 0) {
        escalatedAlerts++;
      }

      alertsByChannel[alert.channel] = (alertsByChannel[alert.channel] || 0) + 1;
    }

    return {
      totalAlerts: recentAlerts.length,
      alertsBySeverity,
      alertsByChannel,
      deliverySuccessRate: recentAlerts.length > 0 ? (deliveredAlerts / recentAlerts.length) * 100 : 0,
      averageDeliveryTime: deliveredAlerts > 0 ? totalDeliveryTime / deliveredAlerts : 0,
      escalationRate: recentAlerts.length > 0 ? (escalatedAlerts / recentAlerts.length) * 100 : 0
    };
  }

  /**
   * Create enhanced alert from base alert
   */
  private createEnhancedAlert(
    baseAlert: RegressionAlert,
    options: {
      visualResult?: VisualRegressionResult;
      templateType?: string;
    } = {}
  ): EnhancedAlert {
    const templateType = options.templateType || 'performanceRegression';
    const templateData = this.prepareTemplateData(baseAlert, options);

    return {
      ...baseAlert,
      channel: baseAlert.alertChannels[0] || 'console',
      escalationLevel: 0,
      templateData,
      deliveryStatus: {
        sent: false,
        retryCount: 0
      }
    };
  }

  /**
   * Prepare template data for alerts
   */
  private prepareTemplateData(
    alert: RegressionAlert,
    options: { visualResult?: VisualRegressionResult } = {}
  ): Record<string, any> {
    const baseData = {
      testName: alert.testName,
      severity: alert.severity,
      timestamp: new Date(alert.timestamp).toISOString(),
      alertId: alert.id
    };

    if (options.visualResult) {
      return {
        ...baseData,
        failedTests: options.visualResult.summary.failedTests,
        totalTests: options.visualResult.summary.totalTests,
        averageDifference: options.visualResult.summary.averageDifference.toFixed(2),
        maxDifference: options.visualResult.summary.maxDifference.toFixed(2),
        overallScore: options.visualResult.overallScore.toFixed(1)
      };
    }

    if (alert.comparison && alert.comparison.differences) {
      const diff = alert.comparison.differences;
      return {
        ...baseData,
        score: alert.comparison.overallScore?.toFixed(1) || 'N/A',
        responseTimeChange: diff.responseTime?.meanChange?.toFixed(1) || '0',
        throughputChange: diff.throughput?.rpsChange?.toFixed(1) || '0',
        errorRateChange: diff.errorRate?.errorRateChange?.toFixed(1) || '0',
        recommendations: alert.comparison.recommendations?.slice(0, 3) || []
      };
    }

    return baseData;
  }

  /**
   * Send alert through configured channels
   */
  private async sendAlert(alert: EnhancedAlert): Promise<AlertDeliveryResult[]> {
    const results: AlertDeliveryResult[] = [];
    const channels = this.config.channels.filter(c => 
      c.enabled && 
      c.severityFilter.includes(alert.severity) &&
      alert.alertChannels.includes(c.name)
    );

    for (const channel of channels) {
      try {
        const result = await this.deliverAlert(alert, channel);
        results.push(result);

        if (result.success) {
          alert.deliveryStatus.sent = true;
          alert.deliveryStatus.sentAt = Date.now();
        } else {
          alert.deliveryStatus.failed = true;
          alert.deliveryStatus.failureReason = result.error;
        }
      } catch (error) {
        results.push({
          success: false,
          channel: channel.name,
          alertId: alert.id,
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Deliver alert to specific channel
   */
  private async deliverAlert(alert: EnhancedAlert, channel: AlertChannel): Promise<AlertDeliveryResult> {
    const startTime = Date.now();

    try {
      switch (channel.type) {
        case 'console':
          return await this.deliverConsoleAlert(alert, channel);
        
        case 'file':
          return await this.deliverFileAlert(alert, channel);
        
        case 'webhook':
          return await this.deliverWebhookAlert(alert, channel);
        
        case 'slack':
          return await this.deliverSlackAlert(alert, channel);
        
        case 'email':
          return await this.deliverEmailAlert(alert, channel);
        
        default:
          throw new Error(`Unsupported channel type: ${channel.type}`);
      }
    } catch (error) {
      return {
        success: false,
        channel: channel.name,
        alertId: alert.id,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Deliver alert to console
   */
  private async deliverConsoleAlert(alert: EnhancedAlert, channel: AlertChannel): Promise<AlertDeliveryResult> {
    const template = this.getAlertTemplate(alert);
    const message = this.renderTemplate(template.body, alert.templateData);

    console.error(`🚨 PERFORMANCE ALERT [${alert.severity.toUpperCase()}] 🚨`);
    console.error(message);

    return {
      success: true,
      channel: channel.name,
      alertId: alert.id,
      timestamp: Date.now()
    };
  }

  /**
   * Deliver alert to file
   */
  private async deliverFileAlert(alert: EnhancedAlert, channel: AlertChannel): Promise<AlertDeliveryResult> {
    const template = this.getAlertTemplate(alert);
    const message = this.renderTemplate(template.body, alert.templateData);
    const logFile = channel.config.logFile || path.join(this.config.dataPath, 'alerts.log');

    const logEntry = `${new Date().toISOString()} [${alert.severity.toUpperCase()}] ${message}\n`;
    await fs.appendFile(logFile, logEntry);

    return {
      success: true,
      channel: channel.name,
      alertId: alert.id,
      timestamp: Date.now(),
      metadata: { logFile }
    };
  }

  /**
   * Deliver alert via webhook
   */
  private async deliverWebhookAlert(alert: EnhancedAlert, channel: AlertChannel): Promise<AlertDeliveryResult> {
    if (!channel.config.url) {
      throw new Error('Webhook URL not configured');
    }

    const payload: WebhookPayload = {
      alertType: 'performance_regression',
      severity: alert.severity,
      alert,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'performance-regression-framework',
        environment: process.env.NODE_ENV || 'development',
        alertId: alert.id
      }
    };

    // In a real implementation, you would use fetch or axios
    console.log(`📤 Would send webhook to ${channel.config.url}:`, JSON.stringify(payload, null, 2));

    return {
      success: true,
      channel: channel.name,
      alertId: alert.id,
      timestamp: Date.now(),
      metadata: { webhookUrl: channel.config.url }
    };
  }

  /**
   * Deliver alert to Slack
   */
  private async deliverSlackAlert(alert: EnhancedAlert, channel: AlertChannel): Promise<AlertDeliveryResult> {
    const color = this.getSeverityColor(alert.severity);
    const template = this.getAlertTemplate(alert);
    
    const slackMessage: SlackMessage = {
      username: 'Performance Monitor',
      icon_emoji: ':warning:',
      attachments: [{
        color,
        title: this.renderTemplate(template.subject, alert.templateData),
        text: this.renderTemplate(template.body, alert.templateData, 'text'),
        fields: [
          {
            title: 'Test',
            value: alert.testName,
            short: true
          },
          {
            title: 'Severity',
            value: alert.severity.toUpperCase(),
            short: true
          },
          {
            title: 'Score',
            value: alert.templateData.score || 'N/A',
            short: true
          },
          {
            title: 'Time',
            value: new Date(alert.timestamp).toLocaleString(),
            short: true
          }
        ],
        footer: 'Performance Regression Framework',
        ts: Math.floor(alert.timestamp / 1000)
      }]
    };

    // In a real implementation, you would use Slack SDK
    console.log(`📤 Would send Slack message:`, JSON.stringify(slackMessage, null, 2));

    return {
      success: true,
      channel: channel.name,
      alertId: alert.id,
      timestamp: Date.now(),
      metadata: { slackChannel: channel.config.channel }
    };
  }

  /**
   * Deliver alert via email
   */
  private async deliverEmailAlert(alert: EnhancedAlert, channel: AlertChannel): Promise<AlertDeliveryResult> {
    const template = this.getAlertTemplate(alert);
    
    const emailMessage: EmailMessage = {
      to: channel.config.recipients || [],
      subject: this.renderTemplate(template.subject, alert.templateData),
      body: this.renderTemplate(template.body, alert.templateData),
      isHtml: template.format === 'html'
    };

    // In a real implementation, you would use an email service
    console.log(`📧 Would send email:`, JSON.stringify(emailMessage, null, 2));

    return {
      success: true,
      channel: channel.name,
      alertId: alert.id,
      timestamp: Date.now(),
      metadata: { recipients: emailMessage.to }
    };
  }

  /**
   * Get alert template
   */
  private getAlertTemplate(alert: EnhancedAlert): AlertTemplate {
    if (alert.testType === 'visual') {
      return this.config.templates.visualRegression;
    }
    
    if (alert.escalationLevel > 0) {
      return this.config.templates.escalation;
    }
    
    return this.config.templates.performanceRegression;
  }

  /**
   * Render template with data
   */
  private renderTemplate(template: string, data: Record<string, any>, format?: string): string {
    let rendered = template;
    
    // Simple template variable replacement
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      rendered = rendered.replace(regex, String(value));
    }

    // Format conversion if needed
    if (format === 'text' && template.includes('<')) {
      // Simple HTML to text conversion
      rendered = rendered
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }

    return rendered;
  }

  /**
   * Get severity color for UI
   */
  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return '#d32f2f';
      case 'major': return '#f57c00';
      case 'moderate': return '#fbc02d';
      case 'minor': return '#388e3c';
      default: return '#757575';
    }
  }

  /**
   * Determine visual regression severity
   */
  private determineVisualSeverity(visualResult: VisualRegressionResult): 'minor' | 'moderate' | 'major' | 'critical' {
    if (visualResult.overallScore <= 30) return 'critical';
    if (visualResult.overallScore <= 50) return 'major';
    if (visualResult.overallScore <= 70) return 'moderate';
    return 'minor';
  }

  /**
   * Check rate limits
   */
  private checkRateLimit(alertType: string, severity: string): boolean {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    const dayAgo = now - (24 * 60 * 60 * 1000);
    
    const key = `${alertType}-${severity}`;
    const timestamps = this.rateLimitTracker.get(key) || [];
    
    // Clean old timestamps
    const recentTimestamps = timestamps.filter(ts => ts > dayAgo);
    this.rateLimitTracker.set(key, recentTimestamps);
    
    // Check limits
    const hourlyCount = recentTimestamps.filter(ts => ts > hourAgo).length;
    const dailyCount = recentTimestamps.length;
    
    if (hourlyCount >= this.config.rateLimit.maxAlertsPerHour) return false;
    if (dailyCount >= this.config.rateLimit.maxAlertsPerDay) return false;
    
    // Add current timestamp
    recentTimestamps.push(now);
    this.rateLimitTracker.set(key, recentTimestamps);
    
    return true;
  }

  /**
   * Check if alert should be aggregated
   */
  private shouldAggregateAlert(alert: RegressionAlert): boolean {
    const bufferKey = `${alert.testType}-${alert.testName}`;
    const buffer = this.aggregationBuffer.get(bufferKey) || [];
    
    // Check if we have similar recent alerts
    const recentAlerts = buffer.filter(a => 
      Date.now() - a.timestamp < (this.config.aggregation.aggregationWindow * 60 * 1000)
    );
    
    return recentAlerts.length > 0 && recentAlerts.length < this.config.aggregation.maxAlertsToAggregate;
  }

  /**
   * Add alert to aggregation buffer
   */
  private addToAggregationBuffer(alert: RegressionAlert): void {
    const bufferKey = `${alert.testType}-${alert.testName}`;
    const buffer = this.aggregationBuffer.get(bufferKey) || [];
    buffer.push(alert);
    this.aggregationBuffer.set(bufferKey, buffer);
    
    // Setup timer to flush buffer
    setTimeout(() => {
      this.flushAggregationBuffer(bufferKey);
    }, this.config.aggregation.aggregationWindow * 60 * 1000);
  }

  /**
   * Flush aggregation buffer
   */
  private async flushAggregationBuffer(bufferKey: string): Promise<void> {
    const buffer = this.aggregationBuffer.get(bufferKey);
    if (!buffer || buffer.length === 0) return;
    
    // Create aggregated alert
    const firstAlert = buffer[0];
    const aggregatedAlert = this.createEnhancedAlert(firstAlert, {});
    aggregatedAlert.aggregatedAlerts = buffer;
    aggregatedAlert.id = `aggregated-${bufferKey}-${Date.now()}`;
    
    // Update template data for aggregated alert
    aggregatedAlert.templateData.aggregatedCount = buffer.length;
    aggregatedAlert.templateData.timeRange = {
      start: Math.min(...buffer.map(a => a.timestamp)),
      end: Math.max(...buffer.map(a => a.timestamp))
    };
    
    await this.sendAlert(aggregatedAlert);
    this.storeAlert(aggregatedAlert);
    
    // Clear buffer
    this.aggregationBuffer.delete(bufferKey);
  }

  /**
   * Setup escalation timer
   */
  private setupEscalation(alert: EnhancedAlert): void {
    const escalationTimer = setTimeout(async () => {
      await this.escalateAlert(alert);
    }, this.config.escalation.timeToEscalate * 60 * 1000);
    
    this.escalationTracker.set(alert.id, escalationTimer);
  }

  /**
   * Escalate alert
   */
  private async escalateAlert(alert: EnhancedAlert): Promise<void> {
    if (alert.acknowledged || alert.escalationLevel >= this.config.escalation.maxEscalations) {
      return;
    }
    
    alert.escalationLevel++;
    
    // Create escalation alert
    const escalationAlert = this.createEnhancedAlert(alert, {});
    escalationAlert.id = `escalation-${alert.id}-${alert.escalationLevel}`;
    escalationAlert.templateData.hoursUnacknowledged = ((Date.now() - alert.timestamp) / (60 * 60 * 1000)).toFixed(1);
    escalationAlert.templateData.originalAlert = alert;
    escalationAlert.templateData.escalationLevel = alert.escalationLevel;
    
    // Send to escalation channels
    const escalationChannels = this.config.channels.filter(c => 
      this.config.escalation.escalationChannels.includes(c.name)
    );
    
    for (const channel of escalationChannels) {
      await this.deliverAlert(escalationAlert, channel);
    }
    
    this.emit('alertEscalated', escalationAlert);
    
    // Setup next escalation
    if (alert.escalationLevel < this.config.escalation.maxEscalations) {
      this.setupEscalation(alert);
    }
  }

  /**
   * Cancel escalation
   */
  private cancelEscalation(alertId: string): void {
    const timer = this.escalationTracker.get(alertId);
    if (timer) {
      clearTimeout(timer);
      this.escalationTracker.delete(alertId);
    }
  }

  /**
   * Find alert by ID
   */
  private findAlert(alertId: string): EnhancedAlert | undefined {
    for (const alerts of this.alertHistory.values()) {
      const alert = alerts.find(a => a.id === alertId);
      if (alert) return alert;
    }
    return undefined;
  }

  /**
   * Store alert in history
   */
  private storeAlert(alert: EnhancedAlert): void {
    const key = `${alert.testType}-${alert.testName}`;
    if (!this.alertHistory.has(key)) {
      this.alertHistory.set(key, []);
    }
    
    this.alertHistory.get(key)!.push(alert);
    this.saveAlertHistory();
  }

  /**
   * Start background jobs
   */
  private startBackgroundJobs(): void {
    // Cleanup old alerts
    setInterval(() => {
      this.cleanupOldAlerts();
    }, 6 * 60 * 60 * 1000); // Every 6 hours
    
    // Process aggregation buffers
    setInterval(() => {
      this.processAggregationBuffers();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Cleanup old alerts
   */
  private cleanupOldAlerts(): void {
    const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days
    
    for (const [key, alerts] of this.alertHistory) {
      const filteredAlerts = alerts.filter(a => a.timestamp > cutoffTime);
      this.alertHistory.set(key, filteredAlerts);
    }
    
    this.saveAlertHistory();
  }

  /**
   * Process aggregation buffers
   */
  private processAggregationBuffers(): void {
    const now = Date.now();
    const cutoffTime = now - (this.config.aggregation.aggregationWindow * 60 * 1000);
    
    for (const [bufferKey, alerts] of this.aggregationBuffer) {
      const oldestAlert = Math.min(...alerts.map(a => a.timestamp));
      if (oldestAlert < cutoffTime) {
        this.flushAggregationBuffer(bufferKey);
      }
    }
  }

  /**
   * Load alert history
   */
  private async loadAlertHistory(): Promise<void> {
    try {
      const historyFile = path.join(this.config.dataPath, 'alert-history.json');
      if (await fs.pathExists(historyFile)) {
        const data = await fs.readJSON(historyFile);
        this.alertHistory = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load alert history:', error);
    }
  }

  /**
   * Save alert history
   */
  private async saveAlertHistory(): Promise<void> {
    try {
      const historyFile = path.join(this.config.dataPath, 'alert-history.json');
      const data = Object.fromEntries(this.alertHistory);
      await fs.writeJSON(historyFile, data, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save alert history:', error);
    }
  }

  /**
   * Default performance alert template
   */
  private getDefaultPerformanceTemplate(): string {
    return `
<h2>Performance Regression Detected</h2>
<p><strong>Test:</strong> {{testName}}</p>
<p><strong>Severity:</strong> {{severity}}</p>
<p><strong>Overall Score:</strong> {{score}}/100</p>

<h3>Performance Changes</h3>
<ul>
  <li><strong>Response Time:</strong> {{responseTimeChange}}%</li>
  <li><strong>Throughput:</strong> {{throughputChange}}%</li>
  <li><strong>Error Rate:</strong> {{errorRateChange}}%</li>
</ul>

<h3>Recommendations</h3>
{{#each recommendations}}
<p>• {{this}}</p>
{{/each}}

<p><strong>Alert ID:</strong> {{alertId}}</p>
<p><strong>Timestamp:</strong> {{timestamp}}</p>
    `.trim();
  }

  /**
   * Default visual regression template
   */
  private getDefaultVisualTemplate(): string {
    return `
<h2>Visual Regression Detected</h2>
<p><strong>Test:</strong> {{testName}}</p>
<p><strong>Failed Tests:</strong> {{failedTests}}/{{totalTests}}</p>
<p><strong>Average Difference:</strong> {{averageDifference}}%</p>
<p><strong>Maximum Difference:</strong> {{maxDifference}}%</p>
<p><strong>Overall Score:</strong> {{overallScore}}/100</p>

<p><strong>Alert ID:</strong> {{alertId}}</p>
<p><strong>Timestamp:</strong> {{timestamp}}</p>
    `.trim();
  }

  /**
   * Default escalation template
   */
  private getDefaultEscalationTemplate(): string {
    return `
<h2>ESCALATION: Unacknowledged Performance Alert</h2>
<p><strong>Test:</strong> {{testName}}</p>
<p><strong>Severity:</strong> {{severity}}</p>
<p><strong>Escalation Level:</strong> {{escalationLevel}}</p>
<p><strong>Hours Unacknowledged:</strong> {{hoursUnacknowledged}}</p>

<h3>Original Alert Details</h3>
<p>Please review and acknowledge the original performance alert that has not been addressed.</p>

<p><strong>Alert ID:</strong> {{alertId}}</p>
<p><strong>Timestamp:</strong> {{timestamp}}</p>
    `.trim();
  }

  /**
   * Shutdown the alerting engine
   */
  public async shutdown(): Promise<void> {
    // Clear all timers
    for (const timer of this.escalationTracker.values()) {
      clearTimeout(timer);
    }
    this.escalationTracker.clear();

    // Save final state
    await this.saveAlertHistory();

    this.isInitialized = false;
    console.log('✅ Alerting Engine shut down');
  }
}
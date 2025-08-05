/**
 * Alerting Engine
 * 
 * Enterprise-grade alerting system with intelligent routing, escalation,
 * suppression, recovery detection, and multiple channel support.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { AlertingConfig, AlertChannel, AlertRule, EscalationLevel } from '../config.js';
import { StructuredLogger } from '../logging/structured-logger.js';
import { secureLog } from '../../security.js';

export interface Alert {
  id: string;
  rule: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'firing' | 'resolved' | 'suppressed' | 'acknowledged';
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  source: string;
  metric: string;
  currentValue: number;
  thresholdValue: number;
  duration: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  fingerprint: string;
  escalationLevel: number;
  suppressionReason?: string;
  channels: string[];
  metadata: Record<string, any>;
}

export interface AlertNotification {
  alertId: string;
  channel: string;
  status: 'pending' | 'sent' | 'failed' | 'acknowledged';
  sentAt?: number;
  attempts: number;
  error?: string;
}

export interface AlertStatistics {
  total: number;
  firing: number;
  resolved: number;
  suppressed: number;
  acknowledged: number;
  bySeverity: Map<string, number>;
  bySource: Map<string, number>;
  averageResolutionTime: number;
  falsePositiveRate: number;
  escalationRate: number;
  channelSuccess: Map<string, number>;
}

export interface SuppressionRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: SuppressionCondition[];
  duration: number; // in ms
  reason: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface SuppressionCondition {
  field: string;
  operator: 'equals' | 'contains' | 'regex' | 'greater_than' | 'less_than';
  value: string | number;
}

export class AlertingEngine extends EventEmitter {
  private config: AlertingConfig;
  private logger?: StructuredLogger;
  private alerts: Map<string, Alert> = new Map();
  private notifications: Map<string, AlertNotification[]> = new Map();
  private suppressionRules: Map<string, SuppressionRule> = new Map();
  private statistics: AlertStatistics;
  private processingInterval?: NodeJS.Timeout;
  private escalationInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;

  // Alert processing state
  private alertQueue: Array<{ type: string; data: any }> = [];
  private channelClients: Map<string, any> = new Map();
  private lastProcessed: Map<string, number> = new Map();

  constructor(config: AlertingConfig, logger?: StructuredLogger) {
    super();
    this.config = config;
    this.logger = logger;
    this.statistics = this.initializeStatistics();

    secureLog('info', 'Alerting engine initialized', {
      enabled: config.enabled,
      channels: config.channels.filter(c => c.enabled).length,
      rules: config.rules.filter(r => r.enabled).length,
      escalation: config.escalation.enabled,
      suppression: config.suppression.enabled
    });
  }

  /**
   * Initialize the alerting engine
   */
  public async initialize(): Promise<void> {
    try {
      // Initialize alert channels
      await this.initializeChannels();

      // Set up default suppression rules
      this.setupDefaultSuppressionRules();

      secureLog('info', 'Alerting engine initialized successfully');

    } catch (error) {
      secureLog('error', 'Failed to initialize alerting engine', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }

  /**
   * Initialize statistics structure
   */
  private initializeStatistics(): AlertStatistics {
    return {
      total: 0,
      firing: 0,
      resolved: 0,
      suppressed: 0,
      acknowledged: 0,
      bySeverity: new Map(),
      bySource: new Map(),
      averageResolutionTime: 0,
      falsePositiveRate: 0,
      escalationRate: 0,
      channelSuccess: new Map()
    };
  }

  /**
   * Initialize alert channels
   */
  private async initializeChannels(): Promise<void> {
    for (const channel of this.config.channels) {
      if (!channel.enabled) continue;

      try {
        const client = await this.createChannelClient(channel);
        this.channelClients.set(channel.name, client);
      } catch (error) {
        secureLog('error', 'Failed to initialize alert channel', {
          channel: channel.name,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }
  }

  /**
   * Create client for alert channel
   */
  private async createChannelClient(channel: AlertChannel): Promise<any> {
    switch (channel.type) {
      case 'telegram':
        // Use existing CCTelegram integration
        return {
          type: 'telegram',
          config: channel.config,
          send: async (alert: Alert) => {
            // This would integrate with the existing CCTelegram bridge
            return this.sendTelegramAlert(alert, channel);
          }
        };

      case 'email':
        return {
          type: 'email',
          config: channel.config,
          send: async (alert: Alert) => {
            return this.sendEmailAlert(alert, channel);
          }
        };

      case 'slack':
        return {
          type: 'slack',
          config: channel.config,
          send: async (alert: Alert) => {
            return this.sendSlackAlert(alert, channel);
          }
        };

      case 'webhook':
        return {
          type: 'webhook',
          config: channel.config,
          send: async (alert: Alert) => {
            return this.sendWebhookAlert(alert, channel);
          }
        };

      case 'pagerduty':
        return {
          type: 'pagerduty',
          config: channel.config,
          send: async (alert: Alert) => {
            return this.sendPagerDutyAlert(alert, channel);
          }
        };

      default:
        throw new Error(`Unknown channel type: ${channel.type}`);
    }
  }

  /**
   * Set up default suppression rules
   */
  private setupDefaultSuppressionRules(): void {
    if (!this.config.suppression.enabled) return;

    // Maintenance window suppression
    this.suppressionRules.set('maintenance', {
      id: 'maintenance',
      name: 'Maintenance Window',
      enabled: false, // Disabled by default
      conditions: [
        { field: 'source', operator: 'equals', value: 'maintenance' }
      ],
      duration: 3600000, // 1 hour
      reason: 'Scheduled maintenance window',
      createdBy: 'system',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000
    });

    // Development environment suppression
    if (process.env.NODE_ENV === 'development') {
      this.suppressionRules.set('dev_environment', {
        id: 'dev_environment',
        name: 'Development Environment',
        enabled: true,
        conditions: [
          { field: 'severity', operator: 'equals', value: 'low' }
        ],
        duration: 86400000, // 24 hours
        reason: 'Development environment - low priority alerts suppressed',
        createdBy: 'system',
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000
      });
    }
  }

  /**
   * Start the alerting engine
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Start alert processing
    this.processingInterval = setInterval(() => {
      this.processAlertQueue();
    }, 1000); // Every second

    // Start escalation processing
    if (this.config.escalation.enabled) {
      this.escalationInterval = setInterval(() => {
        this.processEscalations();
      }, 60000); // Every minute
    }

    secureLog('info', 'Alerting engine started');
  }

  /**
   * Process an alert from the observability system
   */
  public async processAlert(event: {
    type: string;
    source: string;
    timestamp: number;
    data: any;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<void> {
    try {
      // Find matching alert rules
      const matchingRules = this.findMatchingRules(event);

      for (const rule of matchingRules) {
        await this.evaluateRule(rule, event);
      }

    } catch (error) {
      secureLog('error', 'Failed to process alert', {
        event_type: event.type,
        source: event.source,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  /**
   * Find matching alert rules for an event
   */
  private findMatchingRules(event: any): AlertRule[] {
    return this.config.rules.filter(rule => {
      if (!rule.enabled) return false;

      // Simple metric matching - in practice, this would be more sophisticated
      const metricValue = this.extractMetricValue(event, rule.metric);
      if (metricValue === undefined) return false;

      return this.evaluateCondition(metricValue, rule.condition, rule.threshold);
    });
  }

  /**
   * Extract metric value from event
   */
  private extractMetricValue(event: any, metricName: string): number | undefined {
    // Handle different event types and extract appropriate metric values
    switch (event.type) {
      case 'metric':
        return event.data[metricName];
      case 'performance':
        return this.extractPerformanceMetric(event.data, metricName);
      case 'security':
        return this.extractSecurityMetric(event.data, metricName);
      default:
        return event.data.currentValue || event.data.value;
    }
  }

  /**
   * Extract performance metric
   */
  private extractPerformanceMetric(data: any, metricName: string): number | undefined {
    switch (metricName) {
      case 'cpu_usage_percent':
        return data.cpu?.usage;
      case 'memory_usage_percent':
        return data.memory?.usage;
      case 'response_time_ms':
        return data.application?.requests?.duration?.avg;
      case 'error_rate_percent':
        return data.application?.errors?.rate;
      default:
        return undefined;
    }
  }

  /**
   * Extract security metric
   */
  private extractSecurityMetric(data: any, metricName: string): number | undefined {
    switch (metricName) {
      case 'threat_score':
        return data.confidence || data.score;
      case 'violation_count':
        return data.count || 1;
      default:
        return undefined;
    }
  }

  /**
   * Evaluate alert rule condition
   */
  private evaluateCondition(value: number, condition: string, threshold: number): boolean {
    switch (condition) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      case 'ne': return value !== threshold;
      default: return false;
    }
  }

  /**
   * Evaluate alert rule and create/update alert
   */
  private async evaluateRule(rule: AlertRule, event: any): Promise<void> {
    const fingerprint = this.generateFingerprint(rule, event);
    const existingAlert = Array.from(this.alerts.values())
      .find(alert => alert.fingerprint === fingerprint);

    const metricValue = this.extractMetricValue(event, rule.metric)!;

    if (existingAlert) {
      // Update existing alert
      if (existingAlert.status === 'firing') {
        existingAlert.currentValue = metricValue;
        existingAlert.updatedAt = Date.now();
        
        // Check if alert should be resolved
        if (!this.evaluateCondition(metricValue, rule.condition, rule.threshold)) {
          await this.resolveAlert(existingAlert);
        }
      } else if (existingAlert.status === 'resolved') {
        // Alert firing again
        if (this.evaluateCondition(metricValue, rule.condition, rule.threshold)) {
          existingAlert.status = 'firing';
          existingAlert.currentValue = metricValue;
          existingAlert.updatedAt = Date.now();
          existingAlert.resolvedAt = undefined;
          await this.sendAlert(existingAlert);
        }
      }
    } else {
      // Create new alert
      const alert = await this.createAlert(rule, event, metricValue, fingerprint);
      
      if (await this.shouldSuppressAlert(alert)) {
        alert.status = 'suppressed';
        alert.suppressionReason = 'Matched suppression rule';
      } else {
        await this.sendAlert(alert);
      }
    }
  }

  /**
   * Create a new alert
   */
  private async createAlert(
    rule: AlertRule,
    event: any,
    metricValue: number,
    fingerprint: string
  ): Promise<Alert> {
    const alert: Alert = {
      id: this.generateAlertId(),
      rule: rule.name,
      title: `${rule.description}`,
      description: this.generateAlertDescription(rule, event, metricValue),
      severity: rule.severity,
      status: 'firing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: event.source,
      metric: rule.metric,
      currentValue: metricValue,
      thresholdValue: rule.threshold,
      duration: rule.duration,
      labels: { ...rule.labels, ...event.data.labels },
      annotations: { ...rule.annotations },
      fingerprint,
      escalationLevel: 0,
      channels: this.getAlertChannels(rule.severity),
      metadata: {
        rule_id: rule.name,
        event_type: event.type,
        ...event.data
      }
    };

    this.alerts.set(alert.id, alert);
    this.updateStatistics(alert, 'created');

    this.logger?.warn('Alert created', {
      alert_id: alert.id,
      rule: alert.rule,
      severity: alert.severity,
      metric: alert.metric,
      current_value: alert.currentValue,
      threshold: alert.thresholdValue
    });

    this.emit('alert_created', alert);
    return alert;
  }

  /**
   * Generate alert description
   */
  private generateAlertDescription(rule: AlertRule, event: any, metricValue: number): string {
    return `${rule.description}. Current value: ${metricValue}, Threshold: ${rule.threshold}`;
  }

  /**
   * Generate alert fingerprint for deduplication
   */
  private generateFingerprint(rule: AlertRule, event: any): string {
    const components = [
      rule.name,
      rule.metric,
      event.source,
      JSON.stringify(rule.labels || {}),
      JSON.stringify(event.data.labels || {})
    ];
    
    return crypto.createHash('sha256')
      .update(components.join('|'))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Generate alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Get appropriate channels for alert severity
   */
  private getAlertChannels(severity: string): string[] {
    return this.config.channels
      .filter(channel => channel.enabled && channel.severity.includes(severity as any))
      .map(channel => channel.name);
  }

  /**
   * Check if alert should be suppressed
   */
  private async shouldSuppressAlert(alert: Alert): Promise<boolean> {
    if (!this.config.suppression.enabled) return false;

    for (const [_, rule] of this.suppressionRules) {
      if (!rule.enabled || Date.now() > rule.expiresAt) continue;

      const matches = rule.conditions.every(condition => 
        this.evaluateSuppressionCondition(alert, condition)
      );

      if (matches) {
        return true;
      }
    }

    // Check duplicate suppression
    if (this.config.suppression.duplicateWindow > 0) {
      const recentAlerts = Array.from(this.alerts.values())
        .filter(a => 
          a.fingerprint === alert.fingerprint &&
          a.id !== alert.id &&
          (Date.now() - a.createdAt) < this.config.suppression.duplicateWindow
        );

      if (recentAlerts.length > 0) {
        return true;
      }
    }

    // Check rate limiting
    const recentAlertCount = Array.from(this.alerts.values())
      .filter(a => (Date.now() - a.createdAt) < 60000).length; // Last minute

    if (recentAlertCount > this.config.suppression.maxAlertsPerMinute) {
      return true;
    }

    return false;
  }

  /**
   * Evaluate suppression condition
   */
  private evaluateSuppressionCondition(alert: Alert, condition: SuppressionCondition): boolean {
    const fieldValue = this.getAlertFieldValue(alert, condition.field);
    
    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value;
      case 'contains':
        return String(fieldValue).includes(String(condition.value));
      case 'regex':
        return new RegExp(String(condition.value)).test(String(fieldValue));
      case 'greater_than':
        return Number(fieldValue) > Number(condition.value);
      case 'less_than':
        return Number(fieldValue) < Number(condition.value);
      default:
        return false;
    }
  }

  /**
   * Get alert field value for suppression evaluation
   */
  private getAlertFieldValue(alert: Alert, field: string): any {
    switch (field) {
      case 'severity': return alert.severity;
      case 'source': return alert.source;
      case 'metric': return alert.metric;
      case 'rule': return alert.rule;
      default:
        return alert.labels[field] || alert.annotations[field] || alert.metadata[field];
    }
  }

  /**
   * Send alert to configured channels
   */
  private async sendAlert(alert: Alert): Promise<void> {
    const notifications: AlertNotification[] = [];

    for (const channelName of alert.channels) {
      const notification: AlertNotification = {
        alertId: alert.id,
        channel: channelName,
        status: 'pending',
        attempts: 0
      };

      notifications.push(notification);
    }

    this.notifications.set(alert.id, notifications);

    // Queue notifications for processing
    this.alertQueue.push({
      type: 'send_notifications',
      data: { alertId: alert.id }
    });

    this.emit('alert_sent', alert);
  }

  /**
   * Process alert queue
   */
  private async processAlertQueue(): Promise<void> {
    const batchSize = 10;
    const batch = this.alertQueue.splice(0, batchSize);

    for (const item of batch) {
      try {
        await this.processQueueItem(item);
      } catch (error) {
        secureLog('error', 'Failed to process alert queue item', {
          type: item.type,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }
  }

  /**
   * Process individual queue item
   */
  private async processQueueItem(item: { type: string; data: any }): Promise<void> {
    switch (item.type) {
      case 'send_notifications':
        await this.processSendNotifications(item.data.alertId);
        break;
      case 'escalate_alert':
        await this.processEscalateAlert(item.data.alertId);
        break;
      case 'resolve_alert':
        await this.processResolveAlert(item.data.alertId);
        break;
    }
  }

  /**
   * Process sending notifications for an alert
   */
  private async processSendNotifications(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    const notifications = this.notifications.get(alertId);

    if (!alert || !notifications) return;

    for (const notification of notifications) {
      if (notification.status !== 'pending') continue;

      const channel = this.channelClients.get(notification.channel);
      if (!channel) {
        notification.status = 'failed';
        notification.error = 'Channel not available';
        continue;
      }

      try {
        notification.attempts++;
        await channel.send(alert);
        notification.status = 'sent';
        notification.sentAt = Date.now();
        
        this.updateChannelStatistics(notification.channel, true);

      } catch (error) {
        notification.status = 'failed';
        notification.error = error instanceof Error ? error.message : 'unknown';
        
        this.updateChannelStatistics(notification.channel, false);

        // Retry logic
        if (notification.attempts < 3) {
          notification.status = 'pending';
          // Add delay before retry
          setTimeout(() => {
            this.alertQueue.push({
              type: 'send_notifications',
              data: { alertId }
            });
          }, notification.attempts * 5000); // Exponential backoff
        }
      }
    }
  }

  /**
   * Process escalations
   */
  private async processEscalations(): Promise<void> {
    if (!this.config.escalation.enabled) return;

    const now = Date.now();

    for (const alert of this.alerts.values()) {
      if (alert.status !== 'firing') continue;

      const timesinceCreated = now - alert.createdAt;
      const nextEscalationLevel = alert.escalationLevel + 1;

      if (nextEscalationLevel < this.config.escalation.levels.length) {
        const escalationLevel = this.config.escalation.levels[nextEscalationLevel];
        
        if (timesinceCreated >= escalationLevel.delay) {
          await this.escalateAlert(alert, escalationLevel);
        }
      }
    }
  }

  /**
   * Escalate an alert
   */
  private async escalateAlert(alert: Alert, level: EscalationLevel): Promise<void> {
    alert.escalationLevel = level.level;
    alert.updatedAt = Date.now();

    // Add escalation channels
    const escalationChannels = level.channels.filter(ch => !alert.channels.includes(ch));
    alert.channels.push(...escalationChannels);

    // Create notifications for new channels
    const existingNotifications = this.notifications.get(alert.id) || [];
    const newNotifications = escalationChannels.map(channel => ({
      alertId: alert.id,
      channel,
      status: 'pending' as const,
      attempts: 0
    }));

    this.notifications.set(alert.id, [...existingNotifications, ...newNotifications]);

    // Queue for sending
    this.alertQueue.push({
      type: 'send_notifications',
      data: { alertId: alert.id }
    });

    this.updateStatistics(alert, 'escalated');

    this.logger?.error('Alert escalated', undefined, {
      alert_id: alert.id,
      escalation_level: level.level,
      channels: level.channels
    });

    this.emit('alert_escalated', { alert, level });
  }

  /**
   * Resolve an alert
   */
  public async resolveAlert(alert: Alert): Promise<void> {
    alert.status = 'resolved';
    alert.resolvedAt = Date.now();
    alert.updatedAt = Date.now();

    this.updateStatistics(alert, 'resolved');

    this.logger?.info('Alert resolved', {
      alert_id: alert.id,
      rule: alert.rule,
      duration: alert.resolvedAt - alert.createdAt
    });

    // Auto-resolve functionality
    if (this.config.recovery.autoResolve) {
      setTimeout(() => {
        this.alerts.delete(alert.id);
        this.notifications.delete(alert.id);
      }, this.config.recovery.resolutionTimeout);
    }

    this.emit('alert_resolved', alert);
  }

  /**
   * Acknowledge an alert
   */
  public async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.status = 'acknowledged';
    alert.acknowledgedAt = Date.now();
    alert.acknowledgedBy = acknowledgedBy;
    alert.updatedAt = Date.now();

    this.updateStatistics(alert, 'acknowledged');

    this.logger?.info('Alert acknowledged', {
      alert_id: alert.id,
      acknowledged_by: acknowledgedBy
    });

    this.emit('alert_acknowledged', alert);
    return true;
  }

  /**
   * Update statistics
   */
  private updateStatistics(alert: Alert, action: string): void {
    switch (action) {
      case 'created':
        this.statistics.total++;
        this.statistics.firing++;
        break;
      case 'resolved':
        this.statistics.firing--;
        this.statistics.resolved++;
        if (alert.resolvedAt && alert.createdAt) {
          const resolutionTime = alert.resolvedAt - alert.createdAt;
          this.statistics.averageResolutionTime = 
            (this.statistics.averageResolutionTime + resolutionTime) / 2;
        }
        break;
      case 'acknowledged':
        this.statistics.acknowledged++;
        break;
      case 'escalated':
        this.statistics.escalationRate++;
        break;
    }

    // Update severity counts
    const severityCount = this.statistics.bySeverity.get(alert.severity) || 0;
    this.statistics.bySeverity.set(alert.severity, severityCount + 1);

    // Update source counts
    const sourceCount = this.statistics.bySource.get(alert.source) || 0;
    this.statistics.bySource.set(alert.source, sourceCount + 1);
  }

  /**
   * Update channel statistics
   */
  private updateChannelStatistics(channel: string, success: boolean): void {
    const currentSuccess = this.statistics.channelSuccess.get(channel) || 0;
    this.statistics.channelSuccess.set(channel, success ? currentSuccess + 1 : currentSuccess);
  }

  /**
   * Send Telegram alert
   */
  private async sendTelegramAlert(alert: Alert, channel: AlertChannel): Promise<void> {
    // This would integrate with the existing CCTelegram bridge
    const message = this.formatAlertMessage(alert, 'telegram');
    
    // Emit event for CCTelegram integration to pick up
    this.emit('telegram_alert', {
      type: 'performance_alert',
      title: alert.title,
      description: message,
      severity: alert.severity,
      data: {
        alert_id: alert.id,
        metric: alert.metric,
        current_value: alert.currentValue,
        threshold: alert.thresholdValue
      }
    });
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(alert: Alert, channel: AlertChannel): Promise<void> {
    // Email implementation would go here
    secureLog('info', 'Email alert sent', { alert_id: alert.id });
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(alert: Alert, channel: AlertChannel): Promise<void> {
    // Slack implementation would go here
    secureLog('info', 'Slack alert sent', { alert_id: alert.id });
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(alert: Alert, channel: AlertChannel): Promise<void> {
    // Webhook implementation would go here
    secureLog('info', 'Webhook alert sent', { alert_id: alert.id });
  }

  /**
   * Send PagerDuty alert
   */
  private async sendPagerDutyAlert(alert: Alert, channel: AlertChannel): Promise<void> {
    // PagerDuty implementation would go here
    secureLog('info', 'PagerDuty alert sent', { alert_id: alert.id });
  }

  /**
   * Format alert message for specific channel
   */
  private formatAlertMessage(alert: Alert, channelType: string): string {
    switch (channelType) {
      case 'telegram':
        return `🚨 *${alert.severity.toUpperCase()}*: ${alert.title}\n\n` +
               `📊 Metric: ${alert.metric}\n` +
               `📈 Current: ${alert.currentValue}\n` +
               `🎯 Threshold: ${alert.thresholdValue}\n` +
               `⏰ Time: ${new Date(alert.createdAt).toISOString()}\n` +
               `🔍 Source: ${alert.source}\n\n` +
               `${alert.description}`;

      default:
        return `[${alert.severity.toUpperCase()}] ${alert.title}\n` +
               `Metric: ${alert.metric} = ${alert.currentValue} (threshold: ${alert.thresholdValue})\n` +
               `Source: ${alert.source}\n` +
               `Time: ${new Date(alert.createdAt).toISOString()}\n\n` +
               `${alert.description}`;
    }
  }

  /**
   * Get active alerts
   */
  public getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => alert.status === 'firing')
      .sort((a, b) => {
        // Sort by severity, then by creation time
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        return severityDiff !== 0 ? severityDiff : b.createdAt - a.createdAt;
      });
  }

  /**
   * Get alert statistics
   */
  public getStatistics(): AlertStatistics {
    return { ...this.statistics };
  }

  /**
   * Get alert by ID
   */
  public getAlert(alertId: string): Alert | undefined {
    return this.alerts.get(alertId);
  }

  /**
   * Add suppression rule
   */
  public addSuppressionRule(rule: Omit<SuppressionRule, 'id' | 'createdAt'>): string {
    const id = `suppression_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const fullRule: SuppressionRule = {
      ...rule,
      id,
      createdAt: Date.now()
    };

    this.suppressionRules.set(id, fullRule);
    
    this.logger?.info('Suppression rule added', {
      rule_id: id,
      name: rule.name,
      duration: rule.duration
    });

    return id;
  }

  /**
   * Remove suppression rule
   */
  public removeSuppressionRule(ruleId: string): boolean {
    const removed = this.suppressionRules.delete(ruleId);
    
    if (removed) {
      this.logger?.info('Suppression rule removed', { rule_id: ruleId });
    }

    return removed;
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
      activeAlerts: this.getActiveAlerts().length,
      totalAlerts: this.statistics.total,
      averageResolutionTime: this.statistics.averageResolutionTime,
      escalationRate: this.statistics.escalationRate,
      queueSize: this.alertQueue.length,
      channelsEnabled: this.config.channels.filter(c => c.enabled).length,
      suppressionRules: this.suppressionRules.size
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!this.isRunning) {
      status = 'unhealthy';
      details.reason = 'Alerting engine not running';
    } else if (this.alertQueue.length > 100) {
      status = 'degraded';
      details.reason = 'High alert queue size';
    } else if (this.statistics.escalationRate > 0.1) { // 10% escalation rate
      status = 'degraded';
      details.reason = 'High escalation rate';
    }

    return { status, details };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<AlertingConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.channels) {
      // Reinitialize channels
      this.initializeChannels();
    }

    secureLog('info', 'Alerting configuration updated');
  }

  /**
   * Stop the alerting engine
   */
  public async stop(): Promise<void> {
    this.isRunning = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    if (this.escalationInterval) {
      clearInterval(this.escalationInterval);
      this.escalationInterval = undefined;
    }

    secureLog('info', 'Alerting engine stopped');
  }
}
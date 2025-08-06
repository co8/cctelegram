/**
 * Regression Detection System for Performance Testing
 *
 * Automatically detects performance regressions by comparing current
 * performance metrics against established baselines with configurable
 * alerting thresholds and notification systems.
 */
import { EventEmitter } from 'events';
import { BaselineManager, BaselineComparison, BaselineRecord, BaselineMetrics } from './baseline-manager.js';
export interface RegressionAlert {
    id: string;
    timestamp: number;
    severity: 'minor' | 'moderate' | 'major' | 'critical';
    testType: string;
    testName: string;
    comparison: BaselineComparison;
    alertChannels: string[];
    acknowledged: boolean;
    acknowledgedBy?: string;
    acknowledgedAt?: number;
    resolvedAt?: number;
    notes?: string;
}
export interface AlertChannel {
    name: string;
    type: 'console' | 'file' | 'webhook' | 'email' | 'slack';
    config: {
        [key: string]: any;
    };
    enabled: boolean;
    severityFilter: RegressionAlert['severity'][];
}
export interface RegressionConfig {
    enableAutoDetection: boolean;
    alertChannels: AlertChannel[];
    alertThresholds: {
        minor: number;
        moderate: number;
        major: number;
        critical: number;
    };
    cooldownPeriod: number;
    maxAlertsPerHour: number;
    enableTrendAnalysis: boolean;
    trendAnalysisWindow: number;
    autoAcknowledgeAfter: number;
}
/**
 * Regression Detection Engine
 */
export declare class RegressionDetector extends EventEmitter {
    private config;
    private baselineManager;
    private alertHistory;
    private alertCooldowns;
    private alertsPath;
    constructor(baselineManager: BaselineManager, config?: Partial<RegressionConfig>);
    /**
     * Initialize regression detector
     */
    initialize(): Promise<void>;
    /**
     * Check for performance regression
     */
    checkRegression(testType: BaselineRecord['testType'], testName: string, currentMetrics: BaselineMetrics, options?: {
        version?: string;
        tags?: string[];
        baselineId?: string;
        skipAlert?: boolean;
    }): Promise<RegressionAlert | null>;
    /**
     * Analyze performance trends
     */
    analyzeTrends(testType: BaselineRecord['testType'], options?: {
        windowHours?: number;
        alertOnNegativeTrends?: boolean;
    }): Promise<{
        testType: string;
        trendAnalysis: ReturnType<BaselineManager['getPerformanceTrends']>;
        risks: string[];
        recommendations: string[];
    }>;
    /**
     * Get active (unacknowledged) alerts
     */
    getActiveAlerts(options?: {
        testType?: string;
        severity?: RegressionAlert['severity'];
        maxAge?: number;
    }): RegressionAlert[];
    /**
     * Acknowledge an alert
     */
    acknowledgeAlert(alertId: string, acknowledgedBy: string, notes?: string): Promise<boolean>;
    /**
     * Resolve an alert
     */
    resolveAlert(alertId: string, resolvedBy: string): Promise<boolean>;
    /**
     * Generate alert report
     */
    generateAlertReport(outputPath: string, options?: {
        timeRange?: {
            start: number;
            end: number;
        };
        includeResolved?: boolean;
        format?: 'html' | 'json' | 'csv';
    }): Promise<void>;
    /**
     * Configure alert channels
     */
    configureAlertChannel(channel: AlertChannel): void;
    /**
     * Get alert statistics
     */
    getAlertStatistics(timeRangeHours?: number): {
        totalAlerts: number;
        alertsBySeverity: Record<RegressionAlert['severity'], number>;
        alertsByTestType: Record<string, number>;
        averageResolutionTime: number;
        activeAlerts: number;
    };
    /**
     * Setup event listeners
     */
    private setupEventListeners;
    /**
     * Start background monitoring tasks
     */
    private startBackgroundMonitoring;
    /**
     * Determine alert severity based on performance score
     */
    private determineSeverity;
    /**
     * Create regression alert
     */
    private createAlert;
    /**
     * Check if alert should be sent (considering cooldowns and rate limits)
     */
    private shouldAlert;
    /**
     * Trigger alert through configured channels
     */
    private triggerAlert;
    /**
     * Send alert via specific channel
     */
    private sendAlert;
    /**
     * Format alert message
     */
    private formatAlertMessage;
    /**
     * Find alert by ID
     */
    private findAlert;
    /**
     * Auto-acknowledge old alerts
     */
    private autoAcknowledgeOldAlerts;
    /**
     * Clean up expired cooldowns
     */
    private cleanupCooldowns;
    /**
     * Load alert history from disk
     */
    private loadAlertHistory;
    /**
     * Save alert history to disk
     */
    private saveAlertHistory;
    /**
     * Convert alerts to CSV format
     */
    private convertAlertsToCSV;
    /**
     * Generate HTML alert report
     */
    private generateAlertReportHTML;
}
export declare function setupRegressionDetection(baselineManager: BaselineManager, config?: Partial<RegressionConfig>): Promise<RegressionDetector>;
export declare function quickRegressionCheck(detector: RegressionDetector, testType: BaselineRecord['testType'], testName: string, metrics: BaselineMetrics): Promise<boolean>;

/**
 * Baseline Performance Measurement Framework
 *
 * Records and manages baseline performance metrics for regression detection.
 * Establishes performance benchmarks for different system configurations.
 */
import { EventEmitter } from 'events';
export interface BaselineMetrics {
    responseTime: {
        mean: number;
        median: number;
        p95: number;
        p99: number;
        min: number;
        max: number;
        stddev: number;
    };
    throughput: {
        requestsPerSecond: number;
        totalRequests: number;
        duration: number;
    };
    errorMetrics: {
        errorRate: number;
        errorCount: number;
        timeoutCount: number;
        successRate: number;
    };
    resourceUtilization: {
        avgCpuUsage: number;
        maxCpuUsage: number;
        avgMemoryUsage: number;
        maxMemoryUsage: number;
        avgDiskIo: number;
        avgNetworkIo: number;
    };
}
export interface SystemConfiguration {
    nodeVersion: string;
    platform: string;
    architecture: string;
    memoryMB: number;
    cpuCores: number;
    environment: 'development' | 'staging' | 'production' | 'test';
    environmentVariables: Record<string, string>;
    dependencies: Record<string, string>;
}
export interface BaselineRecord {
    id: string;
    timestamp: number;
    testType: 'load' | 'stress' | 'spike' | 'soak' | 'autocannon' | 'webhook';
    testConfiguration: {
        name: string;
        description: string;
        parameters: Record<string, any>;
        duration: number;
        concurrency: number;
    };
    systemConfiguration: SystemConfiguration;
    metrics: BaselineMetrics;
    version: string;
    gitCommit?: string;
    buildNumber?: string;
    tags: string[];
    notes?: string;
}
export interface BaselineComparison {
    current: BaselineRecord;
    baseline: BaselineRecord;
    differences: {
        responseTime: {
            meanChange: number;
            p95Change: number;
            p99Change: number;
            degradationDetected: boolean;
        };
        throughput: {
            rpsChange: number;
            degradationDetected: boolean;
        };
        errorRate: {
            errorRateChange: number;
            degradationDetected: boolean;
        };
        resourceUtilization: {
            cpuChange: number;
            memoryChange: number;
            degradationDetected: boolean;
        };
    };
    overallScore: number;
    regressionDetected: boolean;
    severity: 'none' | 'minor' | 'moderate' | 'major' | 'critical';
    recommendations: string[];
}
export interface BaselineConfig {
    dataDirectory: string;
    maxBaselineHistory: number;
    regressionThresholds: {
        responseTimeIncrease: number;
        throughputDecrease: number;
        errorRateIncrease: number;
        resourceUtilizationIncrease: number;
    };
    autoCleanup: boolean;
    enableGitIntegration: boolean;
}
/**
 * Baseline Performance Manager
 */
export declare class BaselineManager extends EventEmitter {
    private config;
    private baselinesPath;
    private currentBaselines;
    constructor(config?: Partial<BaselineConfig>);
    /**
     * Initialize baseline manager
     */
    initialize(): Promise<void>;
    /**
     * Record a new baseline measurement
     */
    recordBaseline(testType: BaselineRecord['testType'], testConfig: BaselineRecord['testConfiguration'], metrics: BaselineMetrics, options?: {
        version?: string;
        tags?: string[];
        notes?: string;
        gitCommit?: string;
        buildNumber?: string;
    }): Promise<BaselineRecord>;
    /**
     * Compare current metrics against baseline
     */
    compareToBaseline(testType: BaselineRecord['testType'], testConfig: BaselineRecord['testConfiguration'], currentMetrics: BaselineMetrics, options?: {
        baselineId?: string;
        version?: string;
        tags?: string[];
    }): Promise<BaselineComparison | null>;
    /**
     * Get baseline history for a test type
     */
    getBaselineHistory(testType: BaselineRecord['testType'], limit?: number): BaselineRecord[];
    /**
     * Get performance trends over time
     */
    getPerformanceTrends(testType: BaselineRecord['testType'], timespan?: number): {
        testType: string;
        timespan: number;
        dataPoints: Array<{
            timestamp: number;
            responseTime: number;
            throughput: number;
            errorRate: number;
            cpuUsage: number;
            memoryUsage: number;
        }>;
        trends: {
            responseTime: 'improving' | 'stable' | 'degrading';
            throughput: 'improving' | 'stable' | 'degrading';
            errorRate: 'improving' | 'stable' | 'degrading';
            resourceUsage: 'improving' | 'stable' | 'degrading';
        };
    };
    /**
     * Export baselines for backup or sharing
     */
    exportBaselines(outputPath: string, options?: {
        testTypes?: BaselineRecord['testType'][];
        dateRange?: {
            start: number;
            end: number;
        };
        format?: 'json' | 'csv';
    }): Promise<void>;
    /**
     * Import baselines from backup
     */
    importBaselines(inputPath: string): Promise<number>;
    /**
     * Generate baseline comparison report
     */
    generateComparisonReport(comparison: BaselineComparison, outputPath: string): Promise<void>;
    /**
     * Clean up old baselines based on retention policy
     */
    private cleanupOldBaselines;
    /**
     * Load existing baselines from disk
     */
    private loadExistingBaselines;
    /**
     * Save baseline to disk
     */
    private saveBaseline;
    /**
     * Remove baseline from disk and memory
     */
    private removeBaseline;
    /**
     * Generate unique baseline ID
     */
    private generateBaselineId;
    /**
     * Get current system configuration
     */
    private getSystemConfiguration;
    /**
     * Get current git commit hash if available
     */
    private getGitCommit;
    /**
     * Find best matching baseline for comparison
     */
    private findBestMatchingBaseline;
    /**
     * Calculate performance comparison
     */
    private calculateComparison;
    /**
     * Calculate overall performance score and severity
     */
    private calculateOverallScore;
    /**
     * Generate recommendations based on comparison
     */
    private generateRecommendations;
    /**
     * Calculate performance trends over time
     */
    private calculateTrends;
    /**
     * Convert baselines to CSV format
     */
    private convertBaselinesToCSV;
    /**
     * Validate baseline record structure
     */
    private validateBaseline;
    /**
     * Generate HTML comparison report
     */
    private generateComparisonHTML;
}
export declare function recordPerformanceBaseline(manager: BaselineManager, testType: BaselineRecord['testType'], testName: string, metrics: BaselineMetrics, options?: {
    version?: string;
    tags?: string[];
    notes?: string;
}): Promise<BaselineRecord>;
export declare function checkForRegression(manager: BaselineManager, testType: BaselineRecord['testType'], testName: string, currentMetrics: BaselineMetrics, options?: {
    version?: string;
    tags?: string[];
    alertThreshold?: number;
}): Promise<BaselineComparison | null>;

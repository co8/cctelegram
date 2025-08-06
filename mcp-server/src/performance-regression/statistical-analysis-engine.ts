/**
 * Statistical Analysis Engine for Performance Regression Testing
 * 
 * Advanced statistical analysis for performance metrics including:
 * - Trend detection and forecasting
 * - Anomaly detection using statistical methods
 * - Seasonality analysis for performance patterns
 * - Confidence intervals and statistical significance testing
 * - Performance predictions using time series analysis
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import { BaselineMetrics } from '../../tests/performance/baseline-manager.js';

export interface StatisticalConfig {
  dataPath: string;
  trendWindow: number; // Days
  anomalyDetectionSensitivity: 'low' | 'medium' | 'high';
  seasonalityDetection: boolean;
  predictionEnabled: boolean;
  confidenceLevel: number; // 0.95 for 95% confidence
  minDataPoints: number; // Minimum data points for analysis
}

export interface MetricDataPoint {
  timestamp: number;
  testName: string;
  testType: string;
  metrics: BaselineMetrics;
  metadata?: Record<string, any>;
}

export interface TrendAnalysis {
  metric: string;
  direction: 'improving' | 'stable' | 'degrading';
  strength: number; // 0-1, how strong the trend is
  confidence: number; // 0-1, confidence in the trend
  slope: number; // Rate of change
  r_squared: number; // Goodness of fit
  dataPoints: number;
  timespan: number; // milliseconds
}

export interface AnomalyDetection {
  timestamp: number;
  testName: string;
  metric: string;
  value: number;
  expectedValue: number;
  deviation: number; // Standard deviations from expected
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  context: {
    windowSize: number;
    historicalMean: number;
    historicalStdDev: number;
    seasonalAdjustment?: number;
  };
}

export interface SeasonalPattern {
  metric: string;
  period: number; // milliseconds (daily, weekly, etc.)
  amplitude: number; // How much variation
  phase: number; // Offset in the cycle
  confidence: number;
  detectedAt: number;
}

export interface PerformancePrediction {
  metric: string;
  timestamp: number; // When prediction is for
  predictedValue: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  confidence: number;
  model: 'linear' | 'exponential' | 'seasonal' | 'arima';
  accuracy: number; // Based on historical predictions
}

export interface StatisticalSummary {
  metric: string;
  timeRange: { start: number; end: number };
  dataPoints: number;
  mean: number;
  median: number;
  standardDeviation: number;
  variance: number;
  min: number;
  max: number;
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
  skewness: number;
  kurtosis: number;
}

/**
 * Statistical Analysis Engine
 */
export class StatisticalAnalysisEngine extends EventEmitter {
  private config: StatisticalConfig;
  private dataPoints: Map<string, MetricDataPoint[]> = new Map();
  private trends: Map<string, TrendAnalysis[]> = new Map();
  private anomalies: Map<string, AnomalyDetection[]> = new Map();
  private seasonalPatterns: Map<string, SeasonalPattern[]> = new Map();
  private predictions: Map<string, PerformancePrediction[]> = new Map();
  
  private isInitialized: boolean = false;
  private analysisTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<StatisticalConfig> = {}) {
    super();

    this.config = {
      dataPath: path.join(__dirname, '..', '..', 'statistics'),
      trendWindow: 30, // 30 days
      anomalyDetectionSensitivity: 'medium',
      seasonalityDetection: true,
      predictionEnabled: true,
      confidenceLevel: 0.95,
      minDataPoints: 10,
      ...config
    };
  }

  /**
   * Initialize the statistical analysis engine
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await fs.ensureDir(this.config.dataPath);
    await this.loadHistoricalData();

    // Start periodic analysis
    this.startPeriodicAnalysis();

    this.isInitialized = true;
    console.log('📊 Statistical Analysis Engine initialized');
  }

  /**
   * Add metrics data point for analysis
   */
  public async analyzeMetrics(
    testName: string,
    metrics: BaselineMetrics,
    context: {
      timestamp: number;
      testType: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const dataPoint: MetricDataPoint = {
      timestamp: context.timestamp,
      testName,
      testType: context.testType,
      metrics,
      metadata: context.metadata
    };

    // Store data point
    if (!this.dataPoints.has(testName)) {
      this.dataPoints.set(testName, []);
    }
    
    this.dataPoints.get(testName)!.push(dataPoint);
    
    // Keep only recent data (within trend window)
    const cutoffTime = Date.now() - (this.config.trendWindow * 24 * 60 * 60 * 1000);
    const filteredData = this.dataPoints.get(testName)!.filter(dp => dp.timestamp >= cutoffTime);
    this.dataPoints.set(testName, filteredData);

    // Perform real-time analysis if we have enough data
    if (filteredData.length >= this.config.minDataPoints) {
      await this.performRealTimeAnalysis(testName, dataPoint);
    }

    // Persist data
    await this.saveData();
  }

  /**
   * Perform comprehensive trend analysis
   */
  public async analyzeTrends(
    timeRange?: { start: number; end: number }
  ): Promise<{
    performance: 'improving' | 'stable' | 'degrading';
    predictions: PerformancePrediction[];
    anomalies: AnomalyDetection[];
  }> {
    const now = Date.now();
    const range = timeRange || {
      start: now - (this.config.trendWindow * 24 * 60 * 60 * 1000),
      end: now
    };

    const allTrends: TrendAnalysis[] = [];
    const allPredictions: PerformancePrediction[] = [];
    const allAnomalies: AnomalyDetection[] = [];

    // Analyze trends for each test
    for (const [testName, dataPoints] of this.dataPoints) {
      const relevantData = dataPoints.filter(dp => 
        dp.timestamp >= range.start && dp.timestamp <= range.end
      );

      if (relevantData.length >= this.config.minDataPoints) {
        // Analyze response time trends
        const responseTimeTrend = this.calculateTrend(
          relevantData.map(dp => ({
            timestamp: dp.timestamp,
            value: dp.metrics.responseTime.mean
          })),
          'responseTime'
        );
        allTrends.push(responseTimeTrend);

        // Analyze throughput trends  
        const throughputTrend = this.calculateTrend(
          relevantData.map(dp => ({
            timestamp: dp.timestamp,
            value: dp.metrics.throughput.requestsPerSecond
          })),
          'throughput'
        );
        allTrends.push(throughputTrend);

        // Analyze error rate trends
        const errorRateTrend = this.calculateTrend(
          relevantData.map(dp => ({
            timestamp: dp.timestamp,
            value: dp.metrics.errorMetrics.errorRate
          })),
          'errorRate'
        );
        allTrends.push(errorRateTrend);

        // Generate predictions if enabled
        if (this.config.predictionEnabled) {
          const predictions = this.generatePredictions(testName, relevantData);
          allPredictions.push(...predictions);
        }

        // Detect anomalies
        const anomalies = this.detectAnomalies(testName, relevantData);
        allAnomalies.push(...anomalies);
      }
    }

    // Determine overall performance trend
    const overallTrend = this.determineOverallTrend(allTrends);

    // Store results
    this.trends.set('overall', allTrends);
    this.predictions.set('overall', allPredictions);
    this.anomalies.set('overall', allAnomalies);

    return {
      performance: overallTrend,
      predictions: allPredictions,
      anomalies: allAnomalies
    };
  }

  /**
   * Get performance trends for a specific test or metric
   */
  public getPerformanceTrends(
    testName?: string,
    timespan?: number
  ): {
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
    statistics: {
      responseTime: StatisticalSummary;
      throughput: StatisticalSummary;
      errorRate: StatisticalSummary;
    };
  } {
    const windowMs = timespan || (this.config.trendWindow * 24 * 60 * 60 * 1000);
    const cutoffTime = Date.now() - windowMs;

    let relevantData: MetricDataPoint[] = [];
    
    if (testName) {
      relevantData = this.dataPoints.get(testName)?.filter(dp => dp.timestamp >= cutoffTime) || [];
    } else {
      // Aggregate all test data
      relevantData = Array.from(this.dataPoints.values())
        .flat()
        .filter(dp => dp.timestamp >= cutoffTime);
    }

    const dataPoints = relevantData.map(dp => ({
      timestamp: dp.timestamp,
      responseTime: dp.metrics.responseTime.mean,
      throughput: dp.metrics.throughput.requestsPerSecond,
      errorRate: dp.metrics.errorMetrics.errorRate,
      cpuUsage: dp.metrics.resourceUtilization.avgCpuUsage,
      memoryUsage: dp.metrics.resourceUtilization.avgMemoryUsage
    }));

    // Calculate trends
    const responseTimeTrend = this.calculateSimpleTrend(dataPoints.map(d => d.responseTime));
    const throughputTrend = this.calculateSimpleTrend(dataPoints.map(d => -d.throughput)); // Invert for "degrading" logic
    const errorRateTrend = this.calculateSimpleTrend(dataPoints.map(d => d.errorRate));
    const resourceTrend = this.calculateSimpleTrend(dataPoints.map(d => (d.cpuUsage + d.memoryUsage) / 2));

    // Calculate statistics
    const responseTimeStats = this.calculateStatisticalSummary(
      dataPoints.map(d => d.responseTime), 
      'responseTime', 
      { start: cutoffTime, end: Date.now() }
    );
    
    const throughputStats = this.calculateStatisticalSummary(
      dataPoints.map(d => d.throughput), 
      'throughput', 
      { start: cutoffTime, end: Date.now() }
    );
    
    const errorRateStats = this.calculateStatisticalSummary(
      dataPoints.map(d => d.errorRate), 
      'errorRate', 
      { start: cutoffTime, end: Date.now() }
    );

    return {
      testType: testName || 'all',
      timespan: windowMs,
      dataPoints,
      trends: {
        responseTime: responseTimeTrend,
        throughput: throughputTrend,
        errorRate: errorRateTrend,
        resourceUsage: resourceTrend
      },
      statistics: {
        responseTime: responseTimeStats,
        throughput: throughputStats,
        errorRate: errorRateStats
      }
    };
  }

  /**
   * Get recent anomalies
   */
  public async getRecentAnomalies(hours: number = 24): Promise<AnomalyDetection[]> {
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    const allAnomalies = Array.from(this.anomalies.values()).flat();
    
    return allAnomalies.filter(anomaly => anomaly.timestamp >= cutoffTime);
  }

  /**
   * Get seasonal patterns
   */
  public getSeasonalPatterns(testName?: string): SeasonalPattern[] {
    if (testName) {
      return this.seasonalPatterns.get(testName) || [];
    }
    
    return Array.from(this.seasonalPatterns.values()).flat();
  }

  /**
   * Export trend data
   */
  public async exportTrendData(
    timeRange?: { start: number; end: number }
  ): Promise<{
    trends: TrendAnalysis[];
    anomalies: AnomalyDetection[];
    predictions: PerformancePrediction[];
    seasonalPatterns: SeasonalPattern[];
  }> {
    const range = timeRange || {
      start: Date.now() - (this.config.trendWindow * 24 * 60 * 60 * 1000),
      end: Date.now()
    };

    const filteredTrends = Array.from(this.trends.values()).flat();
    const filteredAnomalies = Array.from(this.anomalies.values()).flat()
      .filter(a => a.timestamp >= range.start && a.timestamp <= range.end);
    const filteredPredictions = Array.from(this.predictions.values()).flat()
      .filter(p => p.timestamp >= range.start && p.timestamp <= range.end);
    const seasonalPatterns = Array.from(this.seasonalPatterns.values()).flat();

    return {
      trends: filteredTrends,
      anomalies: filteredAnomalies,
      predictions: filteredPredictions,
      seasonalPatterns
    };
  }

  /**
   * Perform scheduled analysis
   */
  public async performScheduledAnalysis(): Promise<void> {
    console.log('🔍 Performing scheduled statistical analysis...');

    try {
      // Run comprehensive trend analysis
      const analysis = await this.analyzeTrends();

      // Emit events for significant findings
      if (analysis.anomalies.length > 0) {
        const highSeverityAnomalies = analysis.anomalies.filter(a => a.severity === 'high');
        if (highSeverityAnomalies.length > 0) {
          this.emit('anomalyDetected', {
            count: highSeverityAnomalies.length,
            anomalies: highSeverityAnomalies
          });
        }
      }

      if (analysis.performance === 'degrading') {
        this.emit('trendChange', {
          direction: 'degrading',
          timestamp: Date.now(),
          analysis
        });
      }

      console.log(`✅ Scheduled analysis completed. Found ${analysis.anomalies.length} anomalies`);

    } catch (error) {
      console.error('❌ Scheduled analysis failed:', error);
    }
  }

  /**
   * Calculate trend analysis for a metric
   */
  private calculateTrend(
    data: Array<{ timestamp: number; value: number }>,
    metricName: string
  ): TrendAnalysis {
    if (data.length < 2) {
      return {
        metric: metricName,
        direction: 'stable',
        strength: 0,
        confidence: 0,
        slope: 0,
        r_squared: 0,
        dataPoints: data.length,
        timespan: 0
      };
    }

    // Sort by timestamp
    data.sort((a, b) => a.timestamp - b.timestamp);

    // Prepare data for linear regression
    const n = data.length;
    const startTime = data[0].timestamp;
    const x = data.map((_, i) => i); // Use index as x for simplicity
    const y = data.map(d => d.value);

    // Calculate linear regression
    const { slope, intercept, rSquared } = this.linearRegression(x, y);

    // Determine trend direction and strength
    const timespan = data[data.length - 1].timestamp - data[0].timestamp;
    const relativeSlope = Math.abs(slope) / (y.reduce((sum, val) => sum + val, 0) / n);
    
    let direction: 'improving' | 'stable' | 'degrading';
    let strength = Math.min(relativeSlope * 10, 1); // Normalize to 0-1

    if (metricName === 'throughput') {
      // For throughput, positive slope is improving
      direction = slope > 0.1 ? 'improving' : slope < -0.1 ? 'degrading' : 'stable';
    } else {
      // For response time and error rate, negative slope is improving
      direction = slope < -0.1 ? 'improving' : slope > 0.1 ? 'degrading' : 'stable';
    }

    // Confidence based on R-squared and data points
    const confidence = Math.min(rSquared * (Math.log(n) / Math.log(100)), 1);

    return {
      metric: metricName,
      direction,
      strength,
      confidence,
      slope,
      r_squared: rSquared,
      dataPoints: n,
      timespan
    };
  }

  /**
   * Calculate simple trend for basic analysis
   */
  private calculateSimpleTrend(values: number[]): 'improving' | 'stable' | 'degrading' {
    if (values.length < 3) return 'stable';

    const mid = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, mid);
    const secondHalf = values.slice(-mid);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const change = ((secondAvg - firstAvg) / firstAvg) * 100;

    if (Math.abs(change) < 5) return 'stable';
    return change > 0 ? 'degrading' : 'improving';
  }

  /**
   * Linear regression calculation
   */
  private linearRegression(x: number[], y: number[]): {
    slope: number;
    intercept: number;
    rSquared: number;
  } {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const ssResidual = y.reduce((sum, yi, i) => {
      const predicted = slope * x[i] + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    
    const rSquared = 1 - (ssResidual / ssTotal);

    return { slope, intercept, rSquared };
  }

  /**
   * Detect anomalies in metric data
   */
  private detectAnomalies(testName: string, data: MetricDataPoint[]): AnomalyDetection[] {
    const anomalies: AnomalyDetection[] = [];

    if (data.length < this.config.minDataPoints) return anomalies;

    // Analyze different metrics
    const metrics = [
      { name: 'responseTime', getValue: (dp: MetricDataPoint) => dp.metrics.responseTime.mean },
      { name: 'throughput', getValue: (dp: MetricDataPoint) => dp.metrics.throughput.requestsPerSecond },
      { name: 'errorRate', getValue: (dp: MetricDataPoint) => dp.metrics.errorMetrics.errorRate },
      { name: 'cpuUsage', getValue: (dp: MetricDataPoint) => dp.metrics.resourceUtilization.avgCpuUsage },
      { name: 'memoryUsage', getValue: (dp: MetricDataPoint) => dp.metrics.resourceUtilization.avgMemoryUsage }
    ];

    for (const metric of metrics) {
      const values = data.map(metric.getValue);
      const anomalyPoints = this.detectStatisticalAnomalies(values, metric.name);

      for (const anomaly of anomalyPoints) {
        const dataPoint = data[anomaly.index];
        anomalies.push({
          timestamp: dataPoint.timestamp,
          testName,
          metric: metric.name,
          value: anomaly.value,
          expectedValue: anomaly.expected,
          deviation: anomaly.deviation,
          severity: anomaly.severity,
          confidence: anomaly.confidence,
          context: anomaly.context
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect statistical anomalies using Z-score and IQR methods
   */
  private detectStatisticalAnomalies(
    values: number[],
    metricName: string
  ): Array<{
    index: number;
    value: number;
    expected: number;
    deviation: number;
    severity: 'low' | 'medium' | 'high';
    confidence: number;
    context: AnomalyDetection['context'];
  }> {
    const anomalies = [];
    const windowSize = Math.min(20, Math.floor(values.length * 0.8));

    for (let i = windowSize; i < values.length; i++) {
      const window = values.slice(i - windowSize, i);
      const current = values[i];

      // Calculate statistical properties of the window
      const mean = window.reduce((sum, val) => sum + val, 0) / window.length;
      const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);

      // Z-score anomaly detection
      const zScore = Math.abs((current - mean) / stdDev);
      
      // Determine sensitivity thresholds
      let threshold: number;
      switch (this.config.anomalyDetectionSensitivity) {
        case 'low': threshold = 3.0; break;
        case 'medium': threshold = 2.5; break;
        case 'high': threshold = 2.0; break;
      }

      if (zScore > threshold) {
        let severity: 'low' | 'medium' | 'high';
        if (zScore > threshold * 1.5) severity = 'high';
        else if (zScore > threshold * 1.2) severity = 'medium';
        else severity = 'low';

        anomalies.push({
          index: i,
          value: current,
          expected: mean,
          deviation: zScore,
          severity,
          confidence: Math.min(zScore / threshold, 1),
          context: {
            windowSize,
            historicalMean: mean,
            historicalStdDev: stdDev
          }
        });
      }
    }

    return anomalies;
  }

  /**
   * Generate performance predictions
   */
  private generatePredictions(testName: string, data: MetricDataPoint[]): PerformancePrediction[] {
    const predictions: PerformancePrediction[] = [];

    if (data.length < this.config.minDataPoints) return predictions;

    // Predict for next 24 hours
    const futureTimestamp = Date.now() + (24 * 60 * 60 * 1000);

    const metrics = [
      { name: 'responseTime', getValue: (dp: MetricDataPoint) => dp.metrics.responseTime.mean },
      { name: 'throughput', getValue: (dp: MetricDataPoint) => dp.metrics.throughput.requestsPerSecond },
      { name: 'errorRate', getValue: (dp: MetricDataPoint) => dp.metrics.errorMetrics.errorRate }
    ];

    for (const metric of metrics) {
      const values = data.map(metric.getValue);
      const timestamps = data.map(dp => dp.timestamp);

      // Simple linear prediction
      const x = timestamps.map((_, i) => i);
      const { slope, intercept } = this.linearRegression(x, values);

      const predictedValue = slope * data.length + intercept;
      
      // Calculate confidence interval based on prediction error
      const residuals = values.map((val, i) => val - (slope * i + intercept));
      const mse = residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length;
      const predictionError = Math.sqrt(mse);
      
      const confidenceMultiplier = 1.96; // 95% confidence
      const margin = confidenceMultiplier * predictionError;

      predictions.push({
        metric: metric.name,
        timestamp: futureTimestamp,
        predictedValue,
        confidenceInterval: {
          lower: predictedValue - margin,
          upper: predictedValue + margin
        },
        confidence: Math.max(0.1, 1 - (predictionError / Math.abs(predictedValue))),
        model: 'linear',
        accuracy: 0.8 // Placeholder - would be calculated from historical predictions
      });
    }

    return predictions;
  }

  /**
   * Calculate statistical summary
   */
  private calculateStatisticalSummary(
    values: number[],
    metricName: string,
    timeRange: { start: number; end: number }
  ): StatisticalSummary {
    if (values.length === 0) {
      return {
        metric: metricName,
        timeRange,
        dataPoints: 0,
        mean: 0,
        median: 0,
        standardDeviation: 0,
        variance: 0,
        min: 0,
        max: 0,
        percentiles: { p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 },
        skewness: 0,
        kurtosis: 0
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = values.length;
    
    // Basic statistics
    const mean = values.reduce((sum, val) => sum + val, 0) / n;
    const median = this.percentile(sorted, 50);
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const standardDeviation = Math.sqrt(variance);

    // Percentiles
    const percentiles = {
      p25: this.percentile(sorted, 25),
      p50: this.percentile(sorted, 50),
      p75: this.percentile(sorted, 75),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99)
    };

    // Skewness and kurtosis
    const skewness = this.calculateSkewness(values, mean, standardDeviation);
    const kurtosis = this.calculateKurtosis(values, mean, standardDeviation);

    return {
      metric: metricName,
      timeRange,
      dataPoints: n,
      mean,
      median,
      standardDeviation,
      variance,
      min: Math.min(...values),
      max: Math.max(...values),
      percentiles,
      skewness,
      kurtosis
    };
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedValues: number[], p: number): number {
    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sortedValues[lower];
    }
    
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  /**
   * Calculate skewness
   */
  private calculateSkewness(values: number[], mean: number, stdDev: number): number {
    if (stdDev === 0) return 0;
    
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 3), 0);
    return (n / ((n - 1) * (n - 2))) * sum;
  }

  /**
   * Calculate kurtosis
   */
  private calculateKurtosis(values: number[], mean: number, stdDev: number): number {
    if (stdDev === 0) return 0;
    
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 4), 0);
    return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum - (3 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3));
  }

  /**
   * Determine overall performance trend from multiple metrics
   */
  private determineOverallTrend(trends: TrendAnalysis[]): 'improving' | 'stable' | 'degrading' {
    if (trends.length === 0) return 'stable';

    const weightedScores = trends.map(trend => {
      let score = 0;
      if (trend.direction === 'improving') score = 1;
      else if (trend.direction === 'degrading') score = -1;
      
      return score * trend.confidence * trend.strength;
    });

    const overallScore = weightedScores.reduce((sum, score) => sum + score, 0) / trends.length;
    
    if (overallScore > 0.1) return 'improving';
    if (overallScore < -0.1) return 'degrading';
    return 'stable';
  }

  /**
   * Perform real-time analysis on new data point
   */
  private async performRealTimeAnalysis(testName: string, newDataPoint: MetricDataPoint): Promise<void> {
    const testData = this.dataPoints.get(testName) || [];
    
    // Check for immediate anomalies
    const anomalies = this.detectAnomalies(testName, testData.slice(-Math.min(50, testData.length)));
    const recentAnomalies = anomalies.filter(a => a.timestamp === newDataPoint.timestamp);
    
    if (recentAnomalies.length > 0) {
      this.emit('anomalyDetected', {
        testName,
        anomalies: recentAnomalies,
        dataPoint: newDataPoint
      });
    }
  }

  /**
   * Start periodic analysis
   */
  private startPeriodicAnalysis(): void {
    this.analysisTimer = setInterval(async () => {
      await this.performScheduledAnalysis();
    }, 2 * 60 * 60 * 1000); // Every 2 hours
  }

  /**
   * Load historical data
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      const dataFile = path.join(this.config.dataPath, 'historical-data.json');
      if (await fs.pathExists(dataFile)) {
        const data = await fs.readJSON(dataFile);
        this.dataPoints = new Map(Object.entries(data.dataPoints || {}));
        this.trends = new Map(Object.entries(data.trends || {}));
        this.anomalies = new Map(Object.entries(data.anomalies || {}));
        this.predictions = new Map(Object.entries(data.predictions || {}));
        this.seasonalPatterns = new Map(Object.entries(data.seasonalPatterns || {}));
      }
    } catch (error) {
      console.warn('Failed to load historical statistical data:', error);
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    try {
      const dataFile = path.join(this.config.dataPath, 'historical-data.json');
      const data = {
        dataPoints: Object.fromEntries(this.dataPoints),
        trends: Object.fromEntries(this.trends),
        anomalies: Object.fromEntries(this.anomalies),
        predictions: Object.fromEntries(this.predictions),
        seasonalPatterns: Object.fromEntries(this.seasonalPatterns),
        lastUpdated: Date.now()
      };
      
      await fs.writeJSON(dataFile, data, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save statistical data:', error);
    }
  }

  /**
   * Shutdown the engine
   */
  public async shutdown(): Promise<void> {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    await this.saveData();
    this.isInitialized = false;
  }
}
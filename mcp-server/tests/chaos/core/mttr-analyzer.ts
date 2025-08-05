/**
 * MTTR Analyzer
 * 
 * Measures and analyzes Mean Time To Recovery (MTTR) and other 
 * reliability metrics during chaos engineering experiments.
 */

import { EventEmitter } from 'events';
import { secureLog } from '../../../src/security.js';

export interface MTTRAnalysisResult {
  analysisId: string;
  startTime: number;
  endTime: number;
  mttr: number; // Mean Time To Recovery in milliseconds
  mttf: number; // Mean Time To Failure in milliseconds
  mtta: number; // Mean Time To Acknowledge in milliseconds
  availability: number; // System availability percentage (0-1)
  reliability: number; // System reliability percentage (0-1)
  downtime: number; // Total downtime in milliseconds
  recoveryPhases: RecoveryPhase[];
  statisticalAnalysis: StatisticalAnalysis;
  benchmarkComparison: BenchmarkComparison;
  trends: RecoveryTrends;
  recommendations: MTTRRecommendation[];
}

export interface RecoveryPhase {
  phase: 'detection' | 'diagnosis' | 'response' | 'recovery' | 'verification';
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  activities: PhaseActivity[];
  bottlenecks: string[];
  improvements: string[];
}

export interface PhaseActivity {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  automated: boolean;
  success: boolean;
  impact: 'low' | 'medium' | 'high' | 'critical';
}

export interface StatisticalAnalysis {
  samples: number;
  mean: number;
  median: number;
  mode: number;
  standardDeviation: number;
  variance: number;
  percentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  confidenceInterval: {
    lower: number;
    upper: number;
    confidence: number; // e.g., 0.95 for 95%
  };
}

export interface BenchmarkComparison {
  industryStandard: number; // Industry MTTR benchmark
  organizationTarget: number; // Organization's MTTR target
  previousResults: number[]; // Historical MTTR values
  improvement: number; // Improvement percentage vs baseline
  ranking: 'excellent' | 'good' | 'average' | 'poor' | 'critical';
  gap: number; // Gap to target in milliseconds
}

export interface RecoveryTrends {
  trendDirection: 'improving' | 'stable' | 'degrading';
  changeRate: number; // Rate of change per time period
  seasonality: SeasonalPattern[];
  predictions: TrendPrediction[];
}

export interface SeasonalPattern {
  period: 'daily' | 'weekly' | 'monthly';
  pattern: number[]; // MTTR values for each period unit
  confidence: number;
}

export interface TrendPrediction {
  timeHorizon: string; // e.g., '1 week', '1 month'
  predictedMTTR: number;
  confidence: number;
  factors: string[];
}

export interface MTTRRecommendation {
  category: 'detection' | 'automation' | 'monitoring' | 'process' | 'training';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  expectedImprovement: number; // Expected MTTR reduction in milliseconds
  implementationCost: 'low' | 'medium' | 'high';
  timeToImplement: string;
}

export class MTTRAnalyzer extends EventEmitter {
  private historicalData: MTTRDataPoint[] = [];
  private benchmarks: MTTRBenchmarks;

  constructor() {
    super();
    this.initializeBenchmarks();
  }

  /**
   * Analyze recovery performance and calculate MTTR
   */
  public async analyzeRecovery(
    recoveryStartTime: number,
    recoveryEndTime: number,
    faultInjectionResult: any,
    recoveryValidationResult: any
  ): Promise<MTTRAnalysisResult> {

    const analysisId = `mttr_analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    secureLog('info', 'Starting MTTR analysis', {
      analysis_id: analysisId,
      recovery_duration: recoveryEndTime - recoveryStartTime
    });

    // Calculate basic metrics
    const mttr = recoveryEndTime - recoveryStartTime;
    const mtta = recoveryValidationResult.detectionTime || 0;
    const downtime = mttr;
    
    // Analyze recovery phases
    const recoveryPhases = this.analyzeRecoveryPhases(
      recoveryStartTime, 
      recoveryEndTime, 
      faultInjectionResult, 
      recoveryValidationResult
    );

    // Calculate availability and reliability
    const availability = this.calculateAvailability(downtime, recoveryEndTime - recoveryStartTime);
    const reliability = this.calculateReliability(faultInjectionResult, recoveryValidationResult);

    // Add to historical data
    const dataPoint: MTTRDataPoint = {
      timestamp: Date.now(),
      mttr,
      mtta,
      downtime,
      availability,
      reliability,
      faultType: faultInjectionResult.type,
      recoverySuccessful: recoveryValidationResult.success
    };
    
    this.historicalData.push(dataPoint);
    
    // Keep only last 100 data points
    if (this.historicalData.length > 100) {
      this.historicalData.splice(0, this.historicalData.length - 100);
    }

    // Perform statistical analysis
    const statisticalAnalysis = this.performStatisticalAnalysis();

    // Compare against benchmarks
    const benchmarkComparison = this.performBenchmarkComparison(mttr);

    // Analyze trends
    const trends = this.analyzeTrends();

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      mttr, 
      recoveryPhases, 
      benchmarkComparison
    );

    const result: MTTRAnalysisResult = {
      analysisId,
      startTime: recoveryStartTime,
      endTime: recoveryEndTime,
      mttr,
      mttf: this.calculateMTTF(),
      mtta,
      availability,
      reliability,
      downtime,
      recoveryPhases,
      statisticalAnalysis,
      benchmarkComparison,
      trends,
      recommendations
    };

    secureLog('info', 'MTTR analysis completed', {
      analysis_id: analysisId,
      mttr,
      availability,
      reliability,
      recommendations: recommendations.length
    });

    this.emit('mttrAnalyzed', result);

    return result;
  }

  /**
   * Analyze recovery phases in detail
   */
  private analyzeRecoveryPhases(
    recoveryStartTime: number,
    recoveryEndTime: number,
    faultInjectionResult: any,
    recoveryValidationResult: any
  ): RecoveryPhase[] {

    const phases: RecoveryPhase[] = [];
    const totalDuration = recoveryEndTime - recoveryStartTime;

    // Detection Phase
    const detectionPhase: RecoveryPhase = {
      phase: 'detection',
      startTime: recoveryStartTime,
      endTime: recoveryStartTime + (recoveryValidationResult.detectionTime || 0),
      duration: recoveryValidationResult.detectionTime || 0,
      success: recoveryValidationResult.detectionTime > 0,
      activities: [
        {
          name: 'Failure Detection',
          startTime: recoveryStartTime,
          endTime: recoveryStartTime + (recoveryValidationResult.detectionTime || 0),
          duration: recoveryValidationResult.detectionTime || 0,
          automated: true,
          success: recoveryValidationResult.detectionTime > 0,
          impact: 'high'
        }
      ],
      bottlenecks: this.identifyDetectionBottlenecks(recoveryValidationResult),
      improvements: this.suggestDetectionImprovements(recoveryValidationResult)
    };
    phases.push(detectionPhase);

    // Diagnosis Phase (estimated as 10% of total recovery time)
    const diagnosisStart = detectionPhase.endTime;
    const diagnosisDuration = Math.max(1000, totalDuration * 0.1); // At least 1 second
    const diagnosisPhase: RecoveryPhase = {
      phase: 'diagnosis',
      startTime: diagnosisStart,
      endTime: diagnosisStart + diagnosisDuration,
      duration: diagnosisDuration,
      success: true, // Assume successful if recovery completed
      activities: [
        {
          name: 'Root Cause Analysis',
          startTime: diagnosisStart,
          endTime: diagnosisStart + diagnosisDuration * 0.6,
          duration: diagnosisDuration * 0.6,
          automated: false,
          success: true,
          impact: 'medium'
        },
        {
          name: 'Impact Assessment',
          startTime: diagnosisStart + diagnosisDuration * 0.6,
          endTime: diagnosisStart + diagnosisDuration,
          duration: diagnosisDuration * 0.4,
          automated: true,
          success: true,
          impact: 'medium'
        }
      ],
      bottlenecks: ['Manual diagnosis required', 'Limited telemetry data'],
      improvements: ['Automated diagnosis', 'Enhanced monitoring']
    };
    phases.push(diagnosisPhase);

    // Response Phase (estimated as 20% of total recovery time)
    const responseStart = diagnosisPhase.endTime;
    const responseDuration = Math.max(2000, totalDuration * 0.2);
    const responsePhase: RecoveryPhase = {
      phase: 'response',
      startTime: responseStart,
      endTime: responseStart + responseDuration,
      duration: responseDuration,
      success: recoveryValidationResult.success,
      activities: this.analyzeResponseActivities(
        responseStart, 
        responseDuration, 
        recoveryValidationResult
      ),
      bottlenecks: this.identifyResponseBottlenecks(recoveryValidationResult),
      improvements: this.suggestResponseImprovements(recoveryValidationResult)
    };
    phases.push(responsePhase);

    // Recovery Phase (remaining time)
    const recoveryStart = responsePhase.endTime;
    const recoveryDuration = recoveryEndTime - recoveryStart;
    const recoveryPhase: RecoveryPhase = {
      phase: 'recovery',
      startTime: recoveryStart,
      endTime: recoveryEndTime,
      duration: recoveryDuration,
      success: recoveryValidationResult.success,
      activities: this.analyzeRecoveryActivities(
        recoveryStart, 
        recoveryDuration, 
        recoveryValidationResult
      ),
      bottlenecks: this.identifyRecoveryBottlenecks(recoveryValidationResult),
      improvements: this.suggestRecoveryImprovements(recoveryValidationResult)
    };
    phases.push(recoveryPhase);

    // Verification Phase (overlapping with recovery)
    const verificationPhase: RecoveryPhase = {
      phase: 'verification',
      startTime: recoveryStart + recoveryDuration * 0.5,
      endTime: recoveryEndTime,
      duration: recoveryDuration * 0.5,
      success: recoveryValidationResult.success,
      activities: [
        {
          name: 'Health Check Validation',
          startTime: recoveryStart + recoveryDuration * 0.5,
          endTime: recoveryEndTime,
          duration: recoveryDuration * 0.5,
          automated: true,
          success: recoveryValidationResult.healthCheckResults?.every(hc => hc.success) || false,
          impact: 'high'
        }
      ],
      bottlenecks: ['Slow health check responses'],
      improvements: ['Faster health checks', 'Parallel validation']
    };
    phases.push(verificationPhase);

    return phases;
  }

  /**
   * Perform statistical analysis on historical MTTR data
   */
  private performStatisticalAnalysis(): StatisticalAnalysis {
    if (this.historicalData.length === 0) {
      return this.getEmptyStatisticalAnalysis();
    }

    const mttrValues = this.historicalData.map(d => d.mttr).sort((a, b) => a - b);
    const n = mttrValues.length;

    // Calculate basic statistics
    const mean = mttrValues.reduce((sum, val) => sum + val, 0) / n;
    const median = n % 2 === 0 ? 
      (mttrValues[n / 2 - 1] + mttrValues[n / 2]) / 2 : 
      mttrValues[Math.floor(n / 2)];

    // Mode (most frequent value - simplified)
    const frequencyMap = new Map<number, number>();
    mttrValues.forEach(val => {
      const rounded = Math.round(val / 1000) * 1000; // Round to nearest second
      frequencyMap.set(rounded, (frequencyMap.get(rounded) || 0) + 1);
    });
    const mode = Array.from(frequencyMap.entries())
      .reduce((a, b) => a[1] > b[1] ? a : b)[0];

    // Standard deviation and variance
    const variance = mttrValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const standardDeviation = Math.sqrt(variance);

    // Percentiles
    const percentiles = {
      p50: this.calculatePercentile(mttrValues, 50),
      p90: this.calculatePercentile(mttrValues, 90),
      p95: this.calculatePercentile(mttrValues, 95),
      p99: this.calculatePercentile(mttrValues, 99)
    };

    // Confidence interval (95%)
    const standardError = standardDeviation / Math.sqrt(n);
    const marginOfError = 1.96 * standardError; // 95% confidence
    const confidenceInterval = {
      lower: mean - marginOfError,
      upper: mean + marginOfError,
      confidence: 0.95
    };

    return {
      samples: n,
      mean,
      median,
      mode,
      standardDeviation,
      variance,
      percentiles,
      confidenceInterval
    };
  }

  /**
   * Compare current MTTR against benchmarks
   */
  private performBenchmarkComparison(currentMTTR: number): BenchmarkComparison {
    const previousResults = this.historicalData.slice(-10).map(d => d.mttr);
    const baseline = previousResults.length > 0 ? 
      previousResults.reduce((sum, val) => sum + val, 0) / previousResults.length :
      currentMTTR;

    const improvement = baseline > 0 ? ((baseline - currentMTTR) / baseline) * 100 : 0;
    const gap = Math.max(0, currentMTTR - this.benchmarks.organizationTarget);

    let ranking: BenchmarkComparison['ranking'];
    if (currentMTTR <= this.benchmarks.excellent) {
      ranking = 'excellent';
    } else if (currentMTTR <= this.benchmarks.good) {
      ranking = 'good';
    } else if (currentMTTR <= this.benchmarks.average) {
      ranking = 'average';
    } else if (currentMTTR <= this.benchmarks.poor) {
      ranking = 'poor';
    } else {
      ranking = 'critical';
    }

    return {
      industryStandard: this.benchmarks.industryStandard,
      organizationTarget: this.benchmarks.organizationTarget,
      previousResults,
      improvement,
      ranking,
      gap
    };
  }

  /**
   * Analyze trends in MTTR data
   */
  private analyzeTrends(): RecoveryTrends {
    if (this.historicalData.length < 3) {
      return {
        trendDirection: 'stable',
        changeRate: 0,
        seasonality: [],
        predictions: []
      };
    }

    // Simple trend analysis using linear regression
    const recentData = this.historicalData.slice(-20); // Last 20 data points
    const { slope } = this.calculateLinearRegression(
      recentData.map((d, i) => i),
      recentData.map(d => d.mttr)
    );

    let trendDirection: RecoveryTrends['trendDirection'];
    if (slope < -1000) { // Improving by more than 1 second per measurement
      trendDirection = 'improving';
    } else if (slope > 1000) { // Degrading by more than 1 second per measurement
      trendDirection = 'degrading';
    } else {
      trendDirection = 'stable';
    }

    // Generate predictions
    const predictions: TrendPrediction[] = [
      {
        timeHorizon: '1 week',
        predictedMTTR: Math.max(0, recentData[recentData.length - 1].mttr + slope * 7),
        confidence: 0.7,
        factors: ['Historical trend', 'System improvements']
      },
      {
        timeHorizon: '1 month',
        predictedMTTR: Math.max(0, recentData[recentData.length - 1].mttr + slope * 30),
        confidence: 0.5,
        factors: ['Long-term trend', 'Seasonal variations']
      }
    ];

    return {
      trendDirection,
      changeRate: slope,
      seasonality: [], // Would require more complex analysis
      predictions
    };
  }

  /**
   * Generate MTTR improvement recommendations
   */
  private generateRecommendations(
    currentMTTR: number,
    recoveryPhases: RecoveryPhase[],
    benchmarkComparison: BenchmarkComparison
  ): MTTRRecommendation[] {

    const recommendations: MTTRRecommendation[] = [];

    // Detection improvements
    const detectionPhase = recoveryPhases.find(p => p.phase === 'detection');
    if (detectionPhase && detectionPhase.duration > 10000) { // More than 10 seconds
      recommendations.push({
        category: 'detection',
        priority: 'high',
        title: 'Improve Failure Detection Speed',
        description: 'Implement faster health checks and proactive monitoring to reduce detection time',
        expectedImprovement: detectionPhase.duration * 0.5,
        implementationCost: 'medium',
        timeToImplement: '2-4 weeks'
      });
    }

    // Automation improvements
    const manualActivities = recoveryPhases.reduce((count, phase) => 
      count + phase.activities.filter(a => !a.automated).length, 0
    );
    
    if (manualActivities > 2) {
      recommendations.push({
        category: 'automation',
        priority: 'high',
        title: 'Automate Manual Recovery Steps',
        description: `Automate ${manualActivities} manual recovery activities to reduce human intervention time`,
        expectedImprovement: currentMTTR * 0.3,
        implementationCost: 'high',
        timeToImplement: '6-12 weeks'
      });
    }

    // Monitoring improvements
    if (benchmarkComparison.ranking === 'poor' || benchmarkComparison.ranking === 'critical') {
      recommendations.push({
        category: 'monitoring',
        priority: 'critical',
        title: 'Enhance System Monitoring',
        description: 'Implement comprehensive monitoring and alerting to improve visibility',
        expectedImprovement: currentMTTR * 0.4,
        implementationCost: 'medium',
        timeToImplement: '4-8 weeks'
      });
    }

    // Process improvements
    const diagnosisPhase = recoveryPhases.find(p => p.phase === 'diagnosis');
    if (diagnosisPhase && diagnosisPhase.duration > currentMTTR * 0.2) {
      recommendations.push({
        category: 'process',
        priority: 'medium',
        title: 'Streamline Diagnosis Process',
        description: 'Create runbooks and decision trees to speed up root cause analysis',
        expectedImprovement: diagnosisPhase.duration * 0.4,
        implementationCost: 'low',
        timeToImplement: '2-3 weeks'
      });
    }

    // Training improvements
    if (recoveryPhases.some(p => !p.success)) {
      recommendations.push({
        category: 'training',
        priority: 'medium',
        title: 'Improve Team Training',
        description: 'Conduct regular incident response training and chaos engineering exercises',
        expectedImprovement: currentMTTR * 0.2,
        implementationCost: 'low',
        timeToImplement: '1-2 weeks'
      });
    }

    // Sort by priority and expected improvement
    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      
      return b.expectedImprovement - a.expectedImprovement;
    });
  }

  /**
   * Calculate system availability
   */
  private calculateAvailability(downtime: number, totalTime: number): number {
    if (totalTime === 0) return 1.0;
    return Math.max(0, (totalTime - downtime) / totalTime);
  }

  /**
   * Calculate system reliability
   */
  private calculateReliability(faultInjectionResult: any, recoveryValidationResult: any): number {
    // Simplified reliability calculation based on recovery success
    let reliability = recoveryValidationResult.success ? 0.9 : 0.5;
    
    // Adjust based on fault intensity
    if (faultInjectionResult.intensity) {
      reliability = reliability * (1 - faultInjectionResult.intensity * 0.2);
    }
    
    return Math.max(0, Math.min(1, reliability));
  }

  /**
   * Calculate Mean Time To Failure from historical data
   */
  private calculateMTTF(): number {
    if (this.historicalData.length < 2) {
      return 0;
    }

    // Calculate time between failures
    const timeBetweenFailures: number[] = [];
    for (let i = 1; i < this.historicalData.length; i++) {
      const timeDiff = this.historicalData[i].timestamp - this.historicalData[i - 1].timestamp;
      timeBetweenFailures.push(timeDiff);
    }

    // Return average time between failures
    return timeBetweenFailures.reduce((sum, time) => sum + time, 0) / timeBetweenFailures.length;
  }

  /**
   * Initialize MTTR benchmarks
   */
  private initializeBenchmarks(): void {
    this.benchmarks = {
      excellent: 5000, // 5 seconds
      good: 30000, // 30 seconds
      average: 120000, // 2 minutes
      poor: 300000, // 5 minutes
      industryStandard: 60000, // 1 minute (industry average)
      organizationTarget: 30000 // 30 seconds (organization target)
    };
  }

  /**
   * Helper methods for phase analysis
   */
  private identifyDetectionBottlenecks(recoveryValidationResult: any): string[] {
    const bottlenecks: string[] = [];
    
    if (recoveryValidationResult.detectionTime > 30000) {
      bottlenecks.push('Slow health check response');
    }
    
    if (!recoveryValidationResult.mechanismsActivated.includes('circuit_breaker')) {
      bottlenecks.push('Circuit breaker not activated');
    }
    
    return bottlenecks;
  }

  private suggestDetectionImprovements(recoveryValidationResult: any): string[] {
    const improvements: string[] = [];
    
    if (recoveryValidationResult.detectionTime > 10000) {
      improvements.push('Implement proactive health monitoring');
      improvements.push('Reduce health check intervals');
    }
    
    return improvements;
  }

  private identifyResponseBottlenecks(recoveryValidationResult: any): string[] {
    return ['Manual intervention required', 'Slow alerting system'];
  }

  private suggestResponseImprovements(recoveryValidationResult: any): string[] {
    return ['Automate response procedures', 'Improve alert routing'];
  }

  private identifyRecoveryBottlenecks(recoveryValidationResult: any): string[] {
    const bottlenecks: string[] = [];
    
    if (recoveryValidationResult.averageResponseTime > 5000) {
      bottlenecks.push('Slow system recovery');
    }
    
    return bottlenecks;
  }

  private suggestRecoveryImprovements(recoveryValidationResult: any): string[] {
    return ['Optimize recovery procedures', 'Implement faster failover'];
  }

  private analyzeResponseActivities(
    startTime: number, 
    duration: number, 
    recoveryValidationResult: any
  ): PhaseActivity[] {
    return [
      {
        name: 'Alert Processing',
        startTime,
        endTime: startTime + duration * 0.3,
        duration: duration * 0.3,
        automated: true,
        success: true,
        impact: 'medium'
      },
      {
        name: 'Response Coordination',
        startTime: startTime + duration * 0.3,
        endTime: startTime + duration,
        duration: duration * 0.7,
        automated: false,
        success: recoveryValidationResult.success,
        impact: 'high'
      }
    ];
  }

  private analyzeRecoveryActivities(
    startTime: number, 
    duration: number, 
    recoveryValidationResult: any
  ): PhaseActivity[] {
    return [
      {
        name: 'System Restart',
        startTime,
        endTime: startTime + duration * 0.6,
        duration: duration * 0.6,
        automated: true,
        success: recoveryValidationResult.success,
        impact: 'critical'
      },
      {
        name: 'Service Validation',
        startTime: startTime + duration * 0.6,
        endTime: startTime + duration,
        duration: duration * 0.4,
        automated: true,
        success: recoveryValidationResult.success,
        impact: 'high'
      }
    ];
  }

  /**
   * Helper methods for statistical calculations
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    const index = Math.ceil(sortedValues.length * (percentile / 100)) - 1;
    return sortedValues[Math.max(0, index)] || 0;
  }

  private calculateLinearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  private getEmptyStatisticalAnalysis(): StatisticalAnalysis {
    return {
      samples: 0,
      mean: 0,
      median: 0,
      mode: 0,
      standardDeviation: 0,
      variance: 0,
      percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      confidenceInterval: { lower: 0, upper: 0, confidence: 0.95 }
    };
  }

  /**
   * Get historical MTTR data
   */
  public getHistoricalData(): MTTRDataPoint[] {
    return [...this.historicalData];
  }

  /**
   * Get current benchmarks
   */
  public getBenchmarks(): MTTRBenchmarks {
    return { ...this.benchmarks };
  }

  /**
   * Update benchmarks
   */
  public updateBenchmarks(newBenchmarks: Partial<MTTRBenchmarks>): void {
    this.benchmarks = { ...this.benchmarks, ...newBenchmarks };
    secureLog('info', 'MTTR benchmarks updated', newBenchmarks);
  }
}

// Supporting interfaces
interface MTTRDataPoint {
  timestamp: number;
  mttr: number;
  mtta: number;
  downtime: number;
  availability: number;
  reliability: number;
  faultType: string;
  recoverySuccessful: boolean;
}

interface MTTRBenchmarks {
  excellent: number;
  good: number;
  average: number;
  poor: number;
  industryStandard: number;
  organizationTarget: number;
}
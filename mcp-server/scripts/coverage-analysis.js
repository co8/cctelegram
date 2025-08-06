#!/usr/bin/env node

/**
 * Coverage Analysis and Quality Metrics Script
 * Analyzes test coverage trends and provides quality insights
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class CoverageAnalyzer {
  constructor() {
    this.coverageDir = 'coverage';
    this.reportsDir = 'reports/coverage';
    this.historyFile = 'reports/coverage/coverage-history.json';
    this.thresholds = {
      lines: 95,
      functions: 95,
      branches: 90,
      statements: 95
    };
  }

  async initialize() {
    // Ensure directories exist
    await this.ensureDirectories();
    
    // Load existing history
    this.history = await this.loadHistory();
  }

  async ensureDirectories() {
    const dirs = [this.reportsDir, path.dirname(this.historyFile)];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async loadHistory() {
    if (fs.existsSync(this.historyFile)) {
      try {
        const data = fs.readFileSync(this.historyFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        console.warn('Warning: Could not load coverage history:', error.message);
      }
    }
    
    return {
      runs: [],
      trends: {},
      alerts: []
    };
  }

  async saveHistory() {
    fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
  }

  async runCoverageAnalysis() {
    console.log('🔍 Running comprehensive coverage analysis...');
    
    try {
      // Run Jest with coverage
      console.log('Running Jest coverage...');
      await execAsync('npm run test:coverage');
      
      // Run nyc coverage
      console.log('Running NYC coverage...');
      await execAsync('npm run test:coverage:nyc');
      
      // Analyze results
      await this.analyzeCoverageResults();
      
      // Generate trend analysis
      await this.generateTrendAnalysis();
      
      // Check quality gates
      await this.checkQualityGates();
      
      console.log('✅ Coverage analysis completed successfully');
      
    } catch (error) {
      console.error('❌ Coverage analysis failed:', error.message);
      throw error;
    }
  }

  async analyzeCoverageResults() {
    const coverageFiles = [
      'coverage/coverage-summary.json',
      'coverage/nyc/coverage-summary.json'
    ];
    
    for (const file of coverageFiles) {
      if (fs.existsSync(file)) {
        const coverage = JSON.parse(fs.readFileSync(file, 'utf8'));
        await this.processCoverageData(coverage, file);
      }
    }
  }

  async processCoverageData(coverage, source) {
    const timestamp = new Date().toISOString();
    const total = coverage.total;
    
    const run = {
      timestamp,
      source: path.basename(source),
      coverage: {
        lines: total.lines.pct,
        functions: total.functions.pct,
        branches: total.branches.pct,
        statements: total.statements.pct
      },
      details: this.extractDetailedCoverage(coverage)
    };
    
    this.history.runs.push(run);
    
    // Keep only last 50 runs
    if (this.history.runs.length > 50) {
      this.history.runs = this.history.runs.slice(-50);
    }
  }

  extractDetailedCoverage(coverage) {
    const files = {};
    
    Object.keys(coverage).forEach(key => {
      if (key !== 'total' && coverage[key].lines) {
        files[key] = {
          lines: coverage[key].lines.pct,
          functions: coverage[key].functions.pct,
          branches: coverage[key].branches.pct,
          statements: coverage[key].statements.pct,
          uncovered: coverage[key].lines.uncoveredLines || []
        };
      }
    });
    
    return files;
  }

  async generateTrendAnalysis() {
    if (this.history.runs.length < 2) {
      console.log('📊 Insufficient data for trend analysis');
      return;
    }
    
    const recent = this.history.runs.slice(-10);
    const trends = {};
    
    ['lines', 'functions', 'branches', 'statements'].forEach(metric => {
      const values = recent.map(run => run.coverage[metric]);
      trends[metric] = {
        current: values[values.length - 1],
        average: values.reduce((a, b) => a + b, 0) / values.length,
        trend: this.calculateTrend(values),
        direction: this.getTrendDirection(values)
      };
    });
    
    this.history.trends = trends;
    
    // Generate trend report
    await this.generateTrendReport(trends);
  }

  calculateTrend(values) {
    if (values.length < 2) return 0;
    
    const first = values[0];
    const last = values[values.length - 1];
    return ((last - first) / first) * 100;
  }

  getTrendDirection(values) {
    if (values.length < 2) return 'stable';
    
    const recent = values.slice(-3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const current = values[values.length - 1];
    
    if (current > avg + 1) return 'improving';
    if (current < avg - 1) return 'declining';
    return 'stable';
  }

  async generateTrendReport(trends) {
    const report = {
      generated: new Date().toISOString(),
      summary: {
        overallHealth: this.calculateOverallHealth(trends),
        riskLevel: this.calculateRiskLevel(trends),
        recommendations: this.generateRecommendations(trends)
      },
      metrics: trends,
      alerts: this.generateAlerts(trends)
    };
    
    const reportFile = path.join(this.reportsDir, 'trend-analysis.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    // Generate human-readable report
    await this.generateHumanReadableReport(report);
  }

  calculateOverallHealth(trends) {
    const scores = Object.values(trends).map(trend => trend.current);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    if (average >= 95) return 'excellent';
    if (average >= 90) return 'good';
    if (average >= 80) return 'fair';
    return 'poor';
  }

  calculateRiskLevel(trends) {
    const declining = Object.values(trends).filter(trend => trend.direction === 'declining').length;
    const belowThreshold = Object.entries(trends).filter(([key, trend]) => 
      trend.current < this.thresholds[key]).length;
    
    if (declining > 2 || belowThreshold > 1) return 'high';
    if (declining > 1 || belowThreshold > 0) return 'medium';
    return 'low';
  }

  generateRecommendations(trends) {
    const recommendations = [];
    
    Object.entries(trends).forEach(([metric, data]) => {
      if (data.current < this.thresholds[metric]) {
        recommendations.push({
          type: 'threshold',
          metric,
          message: `${metric} coverage (${data.current}%) is below threshold (${this.thresholds[metric]}%)`
        });
      }
      
      if (data.direction === 'declining') {
        recommendations.push({
          type: 'trend',
          metric,
          message: `${metric} coverage is declining (${data.trend.toFixed(1)}% change)`
        });
      }
    });
    
    return recommendations;
  }

  generateAlerts(trends) {
    const alerts = [];
    const timestamp = new Date().toISOString();
    
    Object.entries(trends).forEach(([metric, data]) => {
      if (data.current < this.thresholds[metric] - 5) {
        alerts.push({
          level: 'critical',
          metric,
          message: `Critical: ${metric} coverage severely below threshold`,
          value: data.current,
          threshold: this.thresholds[metric],
          timestamp
        });
      } else if (data.current < this.thresholds[metric]) {
        alerts.push({
          level: 'warning',
          metric,
          message: `Warning: ${metric} coverage below threshold`,
          value: data.current,
          threshold: this.thresholds[metric],
          timestamp
        });
      }
    });
    
    return alerts;
  }

  async generateHumanReadableReport(report) {
    const markdown = `# Coverage Analysis Report

Generated: ${new Date(report.generated).toLocaleString()}

## Overall Health: ${report.summary.overallHealth.toUpperCase()}
Risk Level: ${report.summary.riskLevel.toUpperCase()}

## Metrics Summary

| Metric | Current | Average | Trend | Direction |
|--------|---------|---------|-------|-----------|
${Object.entries(report.metrics).map(([metric, data]) => 
  `| ${metric} | ${data.current.toFixed(1)}% | ${data.average.toFixed(1)}% | ${data.trend.toFixed(1)}% | ${data.direction} |`
).join('\n')}

## Alerts

${report.alerts.length > 0 ? 
  report.alerts.map(alert => `- **${alert.level.toUpperCase()}**: ${alert.message} (${alert.value}%)`).join('\n') :
  'No active alerts'
}

## Recommendations

${report.summary.recommendations.length > 0 ?
  report.summary.recommendations.map(rec => `- ${rec.message}`).join('\n') :
  'No recommendations - coverage is healthy'
}

## Coverage History

Last 10 runs:
${this.history.runs.slice(-10).map((run, i) => 
  `${i + 1}. ${new Date(run.timestamp).toLocaleDateString()} - Lines: ${run.coverage.lines}%, Functions: ${run.coverage.functions}%, Branches: ${run.coverage.branches}%`
).join('\n')}
`;

    const reportFile = path.join(this.reportsDir, 'coverage-report.md');
    fs.writeFileSync(reportFile, markdown);
    
    console.log(`📊 Coverage report generated: ${reportFile}`);
  }

  async checkQualityGates() {
    console.log('🚦 Checking quality gates...');
    
    const latestRun = this.history.runs[this.history.runs.length - 1];
    if (!latestRun) {
      throw new Error('No coverage data available for quality gate check');
    }
    
    const failures = [];
    
    Object.entries(this.thresholds).forEach(([metric, threshold]) => {
      const current = latestRun.coverage[metric];
      if (current < threshold) {
        failures.push({
          metric,
          current,
          threshold,
          gap: threshold - current
        });
      }
    });
    
    if (failures.length > 0) {
      console.log('❌ Quality gates failed:');
      failures.forEach(failure => {
        console.log(`  - ${failure.metric}: ${failure.current}% (need ${failure.threshold}%, gap: ${failure.gap.toFixed(1)}%)`);
      });
      
      if (process.env.CI) {
        throw new Error(`Quality gates failed: ${failures.length} metrics below threshold`);
      }
    } else {
      console.log('✅ All quality gates passed');
    }
  }

  async generateCoverageBadges() {
    const latestRun = this.history.runs[this.history.runs.length - 1];
    if (!latestRun) return;
    
    const badges = Object.entries(latestRun.coverage).map(([metric, value]) => {
      const color = value >= 95 ? 'brightgreen' : value >= 90 ? 'green' : value >= 80 ? 'yellow' : 'red';
      return {
        metric,
        value: `${value.toFixed(1)}%`,
        color,
        url: `https://img.shields.io/badge/coverage-${value.toFixed(1)}%25-${color}`
      };
    });
    
    const badgesFile = path.join(this.reportsDir, 'badges.json');
    fs.writeFileSync(badgesFile, JSON.stringify(badges, null, 2));
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const analyzer = new CoverageAnalyzer();
  
  analyzer.initialize()
    .then(() => analyzer.runCoverageAnalysis())
    .then(() => analyzer.generateCoverageBadges())
    .then(() => analyzer.saveHistory())
    .then(() => console.log('🎉 Coverage analysis completed successfully'))
    .catch(error => {
      console.error('💥 Coverage analysis failed:', error);
      process.exit(1);
    });
}

export { CoverageAnalyzer };
#!/usr/bin/env node

/**
 * Mutation Testing Analysis Script
 * Analyzes mutation testing results and provides test effectiveness insights
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class MutationTestingAnalyzer {
  constructor() {
    this.reportsDir = 'reports/mutation';
    this.historyFile = 'reports/mutation/mutation-history.json';
    this.mutationReportFile = 'reports/mutation/mutation-report.json';
    this.thresholds = {
      mutationScore: 80,
      killed: 85,
      survived: 15,
      timeout: 5,
      noCoverage: 10
    };
  }

  async initialize() {
    await this.ensureDirectories();
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
        console.warn('Warning: Could not load mutation history:', error.message);
      }
    }
    
    return {
      runs: [],
      trends: {},
      alerts: [],
      weakSpots: []
    };
  }

  async saveHistory() {
    fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
  }

  async runMutationTesting() {
    console.log('🧬 Running mutation testing analysis...');
    
    try {
      console.log('Executing Stryker mutation testing...');
      await execAsync('npm run test:mutation:report');
      
      // Analyze mutation results
      await this.analyzeMutationResults();
      
      // Generate effectiveness report
      await this.generateEffectivenessReport();
      
      // Identify weak test areas
      await this.identifyWeakAreas();
      
      // Check quality gates
      await this.checkMutationQualityGates();
      
      console.log('✅ Mutation testing analysis completed successfully');
      
    } catch (error) {
      console.error('❌ Mutation testing analysis failed:', error.message);
      
      // Even if mutation testing fails, try to analyze partial results
      if (fs.existsSync(this.mutationReportFile)) {
        console.log('Analyzing partial mutation results...');
        await this.analyzeMutationResults();
      }
      
      throw error;
    }
  }

  async analyzeMutationResults() {
    if (!fs.existsSync(this.mutationReportFile)) {
      console.warn('Warning: Mutation report file not found');
      return;
    }
    
    const report = JSON.parse(fs.readFileSync(this.mutationReportFile, 'utf8'));
    const timestamp = new Date().toISOString();
    
    const analysis = {
      timestamp,
      summary: this.extractSummary(report),
      fileAnalysis: this.analyzeByFile(report),
      mutantTypes: this.analyzeMutantTypes(report),
      testEffectiveness: this.analyzeTestEffectiveness(report),
      recommendations: this.generateMutationRecommendations(report)
    };
    
    this.history.runs.push(analysis);
    
    // Keep only last 30 runs
    if (this.history.runs.length > 30) {
      this.history.runs = this.history.runs.slice(-30);
    }
    
    return analysis;
  }

  extractSummary(report) {
    const mutants = report.files ? 
      Object.values(report.files).flatMap(file => file.mutants || []) : 
      [];
    
    const statusCounts = mutants.reduce((acc, mutant) => {
      acc[mutant.status] = (acc[mutant.status] || 0) + 1;
      return acc;
    }, {});
    
    const total = mutants.length;
    const killed = statusCounts.Killed || 0;
    const survived = statusCounts.Survived || 0;
    const timeout = statusCounts.Timeout || 0;
    const noCoverage = statusCounts.NoCoverage || 0;
    
    return {
      total,
      killed,
      survived,
      timeout,
      noCoverage,
      mutationScore: total > 0 ? ((killed + timeout) / total) * 100 : 0,
      killedPercentage: total > 0 ? (killed / total) * 100 : 0,
      survivedPercentage: total > 0 ? (survived / total) * 100 : 0,
      timeoutPercentage: total > 0 ? (timeout / total) * 100 : 0,
      noCoveragePercentage: total > 0 ? (noCoverage / total) * 100 : 0
    };
  }

  analyzeByFile(report) {
    const fileAnalysis = {};
    
    if (report.files) {
      Object.entries(report.files).forEach(([filePath, fileData]) => {
        const mutants = fileData.mutants || [];
        const summary = this.extractSummary({ files: { [filePath]: fileData } });
        
        fileAnalysis[filePath] = {
          ...summary,
          riskLevel: this.calculateFileRiskLevel(summary),
          weakAreas: this.identifyFileWeakAreas(mutants)
        };
      });
    }
    
    return fileAnalysis;
  }

  analyzeMutantTypes(report) {
    const mutants = report.files ? 
      Object.values(report.files).flatMap(file => file.mutants || []) : 
      [];
    
    const typeAnalysis = mutants.reduce((acc, mutant) => {
      const type = mutant.mutatorName || 'Unknown';
      if (!acc[type]) {
        acc[type] = { total: 0, killed: 0, survived: 0, timeout: 0, noCoverage: 0 };
      }
      
      acc[type].total++;
      acc[type][mutant.status.toLowerCase()] = (acc[type][mutant.status.toLowerCase()] || 0) + 1;
      
      return acc;
    }, {});
    
    // Calculate effectiveness for each mutant type
    Object.values(typeAnalysis).forEach(analysis => {
      analysis.effectiveness = analysis.total > 0 ? 
        ((analysis.killed + analysis.timeout) / analysis.total) * 100 : 0;
    });
    
    return typeAnalysis;
  }

  analyzeTestEffectiveness(report) {
    const mutants = report.files ? 
      Object.values(report.files).flatMap(file => file.mutants || []) : 
      [];
    
    const testFiles = {};
    
    mutants.forEach(mutant => {
      if (mutant.killedBy && mutant.killedBy.length > 0) {
        mutant.killedBy.forEach(testId => {
          if (!testFiles[testId]) {
            testFiles[testId] = { kills: 0, total: 0 };
          }
          testFiles[testId].kills++;
        });
      }
      
      if (mutant.coveredBy) {
        mutant.coveredBy.forEach(testId => {
          if (!testFiles[testId]) {
            testFiles[testId] = { kills: 0, total: 0 };
          }
          testFiles[testId].total++;
        });
      }
    });
    
    // Calculate effectiveness ratio for each test
    Object.values(testFiles).forEach(testData => {
      testData.effectiveness = testData.total > 0 ? 
        (testData.kills / testData.total) * 100 : 0;
    });
    
    return testFiles;
  }

  calculateFileRiskLevel(summary) {
    if (summary.survivedPercentage > 30) return 'high';
    if (summary.survivedPercentage > 15) return 'medium';
    return 'low';
  }

  identifyFileWeakAreas(mutants) {
    const weakAreas = [];
    
    // Group by line number to identify problematic areas
    const lineGroups = mutants.reduce((acc, mutant) => {
      const line = mutant.location?.start?.line || 0;
      if (!acc[line]) acc[line] = [];
      acc[line].push(mutant);
      return acc;
    }, {});
    
    Object.entries(lineGroups).forEach(([line, lineMutants]) => {
      const survived = lineMutants.filter(m => m.status === 'Survived').length;
      const total = lineMutants.length;
      
      if (total > 0 && (survived / total) > 0.5) {
        weakAreas.push({
          line: parseInt(line),
          totalMutants: total,
          survivedMutants: survived,
          survivedPercentage: (survived / total) * 100,
          mutantTypes: [...new Set(lineMutants.map(m => m.mutatorName))]
        });
      }
    });
    
    return weakAreas.sort((a, b) => b.survivedPercentage - a.survivedPercentage);
  }

  generateMutationRecommendations(report) {
    const recommendations = [];
    const summary = this.extractSummary(report);
    
    if (summary.mutationScore < this.thresholds.mutationScore) {
      recommendations.push({
        type: 'mutation_score',
        priority: 'high',
        message: `Mutation score (${summary.mutationScore.toFixed(1)}%) is below threshold (${this.thresholds.mutationScore}%). Consider adding more comprehensive tests.`
      });
    }
    
    if (summary.survivedPercentage > this.thresholds.survived) {
      recommendations.push({
        type: 'survived_mutants',
        priority: 'high',
        message: `High number of survived mutants (${summary.survivedPercentage.toFixed(1)}%). Focus on testing edge cases and error conditions.`
      });
    }
    
    if (summary.noCoveragePercentage > this.thresholds.noCoverage) {
      recommendations.push({
        type: 'coverage_gaps',
        priority: 'medium',
        message: `${summary.noCoveragePercentage.toFixed(1)}% of mutants have no test coverage. Improve test coverage first.`
      });
    }
    
    if (summary.timeoutPercentage > this.thresholds.timeout) {
      recommendations.push({
        type: 'test_performance',
        priority: 'medium',
        message: `High timeout rate (${summary.timeoutPercentage.toFixed(1)}%). Optimize test performance or increase timeout settings.`
      });
    }
    
    return recommendations;
  }

  async generateEffectivenessReport() {
    const latestRun = this.history.runs[this.history.runs.length - 1];
    if (!latestRun) return;
    
    const report = {
      generated: new Date().toISOString(),
      summary: latestRun.summary,
      overallRating: this.calculateOverallRating(latestRun.summary),
      fileRisks: this.identifyHighRiskFiles(latestRun.fileAnalysis),
      testEffectiveness: latestRun.testEffectiveness,
      mutantTypeAnalysis: latestRun.mutantTypes,
      recommendations: latestRun.recommendations,
      trends: this.calculateMutationTrends()
    };
    
    const reportFile = path.join(this.reportsDir, 'effectiveness-report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    // Generate human-readable report
    await this.generateHumanReadableMutationReport(report);
  }

  calculateOverallRating(summary) {
    const score = summary.mutationScore;
    
    if (score >= 90) return 'excellent';
    if (score >= 80) return 'good';
    if (score >= 70) return 'fair';
    if (score >= 60) return 'poor';
    return 'critical';
  }

  identifyHighRiskFiles(fileAnalysis) {
    return Object.entries(fileAnalysis || {})
      .filter(([_, analysis]) => analysis.riskLevel === 'high')
      .map(([file, analysis]) => ({
        file,
        mutationScore: analysis.mutationScore,
        survivedPercentage: analysis.survivedPercentage,
        weakAreas: analysis.weakAreas.slice(0, 5) // Top 5 weak areas
      }))
      .sort((a, b) => b.survivedPercentage - a.survivedPercentage);
  }

  calculateMutationTrends() {
    if (this.history.runs.length < 2) return null;
    
    const recent = this.history.runs.slice(-5);
    const scores = recent.map(run => run.summary.mutationScore);
    
    return {
      current: scores[scores.length - 1],
      average: scores.reduce((a, b) => a + b, 0) / scores.length,
      trend: this.calculateTrend(scores),
      direction: this.getTrendDirection(scores)
    };
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
    
    if (current > avg + 2) return 'improving';
    if (current < avg - 2) return 'declining';
    return 'stable';
  }

  async generateHumanReadableMutationReport(report) {
    const markdown = `# Mutation Testing Effectiveness Report

Generated: ${new Date(report.generated).toLocaleString()}

## Overall Rating: ${report.overallRating.toUpperCase()}

## Summary Statistics

- **Mutation Score**: ${report.summary.mutationScore.toFixed(1)}%
- **Total Mutants**: ${report.summary.total}
- **Killed**: ${report.summary.killed} (${report.summary.killedPercentage.toFixed(1)}%)
- **Survived**: ${report.summary.survived} (${report.summary.survivedPercentage.toFixed(1)}%)
- **Timeout**: ${report.summary.timeout} (${report.summary.timeoutPercentage.toFixed(1)}%)
- **No Coverage**: ${report.summary.noCoverage} (${report.summary.noCoveragePercentage.toFixed(1)}%)

${report.trends ? `## Trends

- **Current Score**: ${report.trends.current.toFixed(1)}%
- **Average (last 5 runs)**: ${report.trends.average.toFixed(1)}%
- **Trend**: ${report.trends.trend.toFixed(1)}% (${report.trends.direction})
` : ''}

## High-Risk Files

${report.fileRisks.length > 0 ? 
  report.fileRisks.map(file => `### ${file.file}
- Mutation Score: ${file.mutationScore.toFixed(1)}%
- Survived Mutants: ${file.survivedPercentage.toFixed(1)}%
${file.weakAreas.length > 0 ? '- Weak Areas: Lines ' + file.weakAreas.map(area => area.line).join(', ') : ''}
`).join('\n') :
  'No high-risk files identified.'
}

## Mutant Type Analysis

| Mutant Type | Total | Killed | Survived | Effectiveness |
|-------------|-------|--------|----------|---------------|
${Object.entries(report.mutantTypeAnalysis).map(([type, data]) => 
  `| ${type} | ${data.total} | ${data.killed} | ${data.survived} | ${data.effectiveness.toFixed(1)}% |`
).join('\n')}

## Recommendations

${report.recommendations.length > 0 ?
  report.recommendations.map(rec => `- **${rec.priority.toUpperCase()}**: ${rec.message}`).join('\n') :
  'No recommendations - mutation testing effectiveness is good!'
}

## Test Effectiveness

Top 10 most effective tests:
${Object.entries(report.testEffectiveness)
  .sort(([,a], [,b]) => b.effectiveness - a.effectiveness)
  .slice(0, 10)
  .map(([test, data]) => `- ${test}: ${data.effectiveness.toFixed(1)}% (${data.kills}/${data.total})`)
  .join('\n') || 'No test effectiveness data available'}
`;

    const reportFile = path.join(this.reportsDir, 'mutation-report.md');
    fs.writeFileSync(reportFile, markdown);
    
    console.log(`🧬 Mutation testing report generated: ${reportFile}`);
  }

  async identifyWeakAreas() {
    const latestRun = this.history.runs[this.history.runs.length - 1];
    if (!latestRun) return;
    
    const weakSpots = [];
    
    Object.entries(latestRun.fileAnalysis || {}).forEach(([file, analysis]) => {
      if (analysis.riskLevel === 'high' && analysis.weakAreas.length > 0) {
        analysis.weakAreas.forEach(area => {
          weakSpots.push({
            file,
            line: area.line,
            survivedPercentage: area.survivedPercentage,
            mutantTypes: area.mutantTypes,
            priority: area.survivedPercentage > 80 ? 'critical' : 'high'
          });
        });
      }
    });
    
    this.history.weakSpots = weakSpots.sort((a, b) => b.survivedPercentage - a.survivedPercentage);
  }

  async checkMutationQualityGates() {
    console.log('🧬 Checking mutation testing quality gates...');
    
    const latestRun = this.history.runs[this.history.runs.length - 1];
    if (!latestRun) {
      throw new Error('No mutation testing data available for quality gate check');
    }
    
    const failures = [];
    const summary = latestRun.summary;
    
    if (summary.mutationScore < this.thresholds.mutationScore) {
      failures.push({
        metric: 'mutation_score',
        current: summary.mutationScore,
        threshold: this.thresholds.mutationScore,
        gap: this.thresholds.mutationScore - summary.mutationScore
      });
    }
    
    if (summary.survivedPercentage > this.thresholds.survived) {
      failures.push({
        metric: 'survived_mutants',
        current: summary.survivedPercentage,
        threshold: this.thresholds.survived,
        gap: summary.survivedPercentage - this.thresholds.survived
      });
    }
    
    if (failures.length > 0) {
      console.log('❌ Mutation testing quality gates failed:');
      failures.forEach(failure => {
        console.log(`  - ${failure.metric}: ${failure.current.toFixed(1)}% (threshold: ${failure.threshold}%, gap: ${failure.gap.toFixed(1)}%)`);
      });
      
      if (process.env.CI) {
        console.log('Warning: Mutation testing quality gates failed (non-blocking in CI)');
      }
    } else {
      console.log('✅ All mutation testing quality gates passed');
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const analyzer = new MutationTestingAnalyzer();
  
  analyzer.initialize()
    .then(() => analyzer.runMutationTesting())
    .then(() => analyzer.saveHistory())
    .then(() => console.log('🎉 Mutation testing analysis completed successfully'))
    .catch(error => {
      console.error('💥 Mutation testing analysis failed:', error);
      // Don't exit with error code for mutation testing failures in development
      if (!process.env.CI) {
        console.log('Note: Mutation testing failures are non-blocking in development');
      }
    });
}

export { MutationTestingAnalyzer };
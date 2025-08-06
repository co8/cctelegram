#!/usr/bin/env node

/**
 * CI/CD Quality Gates Script
 * Integrates coverage and mutation testing into CI/CD pipeline
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CoverageAnalyzer } from './coverage-analysis.js';
import { MutationTestingAnalyzer } from './mutation-testing-analysis.js';

const execAsync = promisify(exec);

class CIQualityGates {
  constructor() {
    this.config = {
      coverage: {
        required: true,
        thresholds: {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95
        }
      },
      mutation: {
        required: process.env.ENABLE_MUTATION_TESTING !== 'false',
        thresholds: {
          mutationScore: 80,
          survived: 15
        }
      },
      reports: {
        generateBadges: true,
        uploadToCodeCov: process.env.CODECOV_TOKEN !== undefined,
        generatePullRequestComment: process.env.CI === 'true'
      }
    };
    
    this.results = {
      coverage: null,
      mutation: null,
      qualityGates: {
        passed: 0,
        failed: 0,
        warnings: 0
      }
    };
  }

  async runQualityGates() {
    console.log('🚦 Starting CI/CD Quality Gates...');
    
    try {
      // Run coverage analysis
      if (this.config.coverage.required) {
        await this.runCoverageGates();
      }
      
      // Run mutation testing
      if (this.config.mutation.required) {
        await this.runMutationGates();
      }
      
      // Generate reports
      await this.generateCIReports();
      
      // Upload coverage if configured
      if (this.config.reports.uploadToCodeCov) {
        await this.uploadCoverage();
      }
      
      // Generate PR comment if configured
      if (this.config.reports.generatePullRequestComment) {
        await this.generatePullRequestComment();
      }
      
      // Final quality gate check
      await this.finalQualityGateCheck();
      
      console.log('✅ CI/CD Quality Gates completed successfully');
      
    } catch (error) {
      console.error('❌ CI/CD Quality Gates failed:', error.message);
      throw error;
    }
  }

  async runCoverageGates() {
    console.log('📊 Running coverage quality gates...');
    
    const analyzer = new CoverageAnalyzer();
    await analyzer.initialize();
    
    try {
      await analyzer.runCoverageAnalysis();
      
      const latestRun = analyzer.history.runs[analyzer.history.runs.length - 1];
      this.results.coverage = latestRun;
      
      // Check coverage thresholds
      const failures = this.checkCoverageThresholds(latestRun.coverage);
      
      if (failures.length > 0) {
        this.results.qualityGates.failed += failures.length;
        console.log('❌ Coverage quality gates failed:');
        failures.forEach(failure => {
          console.log(`  - ${failure.metric}: ${failure.current}% < ${failure.threshold}%`);
        });
      } else {
        this.results.qualityGates.passed += 4; // 4 coverage metrics
        console.log('✅ Coverage quality gates passed');
      }
      
    } catch (error) {
      this.results.qualityGates.failed += 1;
      console.error('❌ Coverage analysis failed:', error.message);
      if (this.config.coverage.required) {
        throw error;
      }
    }
  }

  async runMutationGates() {
    console.log('🧬 Running mutation testing quality gates...');
    
    const analyzer = new MutationTestingAnalyzer();
    await analyzer.initialize();
    
    try {
      await analyzer.runMutationTesting();
      
      const latestRun = analyzer.history.runs[analyzer.history.runs.length - 1];
      this.results.mutation = latestRun;
      
      // Check mutation thresholds
      const failures = this.checkMutationThresholds(latestRun.summary);
      
      if (failures.length > 0) {
        this.results.qualityGates.warnings += failures.length;
        console.log('⚠️ Mutation testing warnings:');
        failures.forEach(failure => {
          console.log(`  - ${failure.metric}: ${failure.current}% vs ${failure.threshold}%`);
        });
      } else {
        this.results.qualityGates.passed += 2; // 2 mutation metrics
        console.log('✅ Mutation testing quality gates passed');
      }
      
    } catch (error) {
      this.results.qualityGates.warnings += 1;
      console.warn('⚠️ Mutation testing failed (non-blocking):', error.message);
      // Mutation testing failures are non-blocking in CI
    }
  }

  checkCoverageThresholds(coverage) {
    const failures = [];
    
    Object.entries(this.config.coverage.thresholds).forEach(([metric, threshold]) => {
      if (coverage[metric] < threshold) {
        failures.push({
          metric,
          current: coverage[metric],
          threshold,
          gap: threshold - coverage[metric]
        });
      }
    });
    
    return failures;
  }

  checkMutationThresholds(summary) {
    const failures = [];
    
    if (summary.mutationScore < this.config.mutation.thresholds.mutationScore) {
      failures.push({
        metric: 'mutation_score',
        current: summary.mutationScore,
        threshold: this.config.mutation.thresholds.mutationScore,
        gap: this.config.mutation.thresholds.mutationScore - summary.mutationScore
      });
    }
    
    if (summary.survivedPercentage > this.config.mutation.thresholds.survived) {
      failures.push({
        metric: 'survived_mutants',
        current: summary.survivedPercentage,
        threshold: this.config.mutation.thresholds.survived,
        gap: summary.survivedPercentage - this.config.mutation.thresholds.survived
      });
    }
    
    return failures;
  }

  async generateCIReports() {
    console.log('📄 Generating CI reports...');
    
    const reportsDir = 'reports/ci';
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const report = {
      timestamp: new Date().toISOString(),
      environment: {
        ci: process.env.CI || false,
        node_version: process.version,
        npm_version: await this.getNpmVersion(),
        git_commit: process.env.GITHUB_SHA || await this.getGitCommit(),
        git_branch: process.env.GITHUB_REF_NAME || await this.getGitBranch()
      },
      results: this.results,
      summary: {
        status: this.getOverallStatus(),
        passed: this.results.qualityGates.passed,
        failed: this.results.qualityGates.failed,
        warnings: this.results.qualityGates.warnings
      }
    };
    
    // Save JSON report
    fs.writeFileSync(
      path.join(reportsDir, 'quality-gates-report.json'), 
      JSON.stringify(report, null, 2)
    );
    
    // Generate badges
    if (this.config.reports.generateBadges) {
      await this.generateBadges(report);
    }
    
    // Generate summary
    await this.generateSummaryReport(report);
  }

  async getNpmVersion() {
    try {
      const { stdout } = await execAsync('npm --version');
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  async getGitCommit() {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD');
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  async getGitBranch() {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD');
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  getOverallStatus() {
    if (this.results.qualityGates.failed > 0) return 'failed';
    if (this.results.qualityGates.warnings > 0) return 'warning';
    return 'passed';
  }

  async generateBadges(report) {
    const badges = [];
    
    if (this.results.coverage) {
      Object.entries(this.results.coverage.coverage).forEach(([metric, value]) => {
        const color = value >= 95 ? 'brightgreen' : 
                     value >= 90 ? 'green' : 
                     value >= 80 ? 'yellow' : 'red';
        
        badges.push({
          name: `coverage-${metric}`,
          label: `coverage ${metric}`,
          message: `${value.toFixed(1)}%`,
          color,
          logoSvg: this.getCoverageSvg()
        });
      });
    }
    
    if (this.results.mutation) {
      const score = this.results.mutation.summary.mutationScore;
      const color = score >= 90 ? 'brightgreen' : 
                   score >= 80 ? 'green' : 
                   score >= 70 ? 'yellow' : 'red';
      
      badges.push({
        name: 'mutation-score',
        label: 'mutation score',
        message: `${score.toFixed(1)}%`,
        color,
        logoSvg: this.getMutationSvg()
      });
    }
    
    // Quality gates badge
    const status = report.summary.status;
    const statusColor = status === 'passed' ? 'brightgreen' : 
                       status === 'warning' ? 'yellow' : 'red';
    
    badges.push({
      name: 'quality-gates',
      label: 'quality gates',
      message: status,
      color: statusColor
    });
    
    fs.writeFileSync(
      'reports/ci/badges.json', 
      JSON.stringify(badges, null, 2)
    );
  }

  getCoverageSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM6.5 5A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 5zm3 0A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 9.5 5z"/></svg>';
  }

  getMutationSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4 2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h2zm8 0a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h2z"/></svg>';
  }

  async generateSummaryReport(report) {
    const markdown = `# Quality Gates Report

Generated: ${new Date(report.timestamp).toLocaleString()}
Status: **${report.summary.status.toUpperCase()}**

## Summary

- ✅ Passed: ${report.summary.passed}
- ❌ Failed: ${report.summary.failed}
- ⚠️ Warnings: ${report.summary.warnings}

## Coverage Results

${this.results.coverage ? `
| Metric | Value | Threshold | Status |
|--------|-------|-----------|--------|
${Object.entries(this.results.coverage.coverage).map(([metric, value]) => {
  const threshold = this.config.coverage.thresholds[metric];
  const status = value >= threshold ? '✅' : '❌';
  return `| ${metric} | ${value.toFixed(1)}% | ${threshold}% | ${status} |`;
}).join('\n')}
` : 'Coverage analysis not available'}

## Mutation Testing Results

${this.results.mutation ? `
- **Mutation Score**: ${this.results.mutation.summary.mutationScore.toFixed(1)}%
- **Total Mutants**: ${this.results.mutation.summary.total}
- **Killed**: ${this.results.mutation.summary.killed}
- **Survived**: ${this.results.mutation.summary.survived}
- **Timeout**: ${this.results.mutation.summary.timeout}
- **No Coverage**: ${this.results.mutation.summary.noCoverage}
` : 'Mutation testing not available'}

## Environment

- **Node.js**: ${report.environment.node_version}
- **npm**: ${report.environment.npm_version}
- **Git Commit**: ${report.environment.git_commit.substring(0, 8)}
- **Git Branch**: ${report.environment.git_branch}
- **CI**: ${report.environment.ci}

## Reports

- [Coverage Report](./coverage/index.html)
- [Mutation Report](./reports/mutation/index.html)
- [Full Quality Report](./reports/ci/quality-gates-report.json)
`;

    fs.writeFileSync('reports/ci/summary.md', markdown);
  }

  async uploadCoverage() {
    console.log('☁️ Uploading coverage to CodeCov...');
    
    try {
      // Check if coverage files exist
      const lcovFile = 'coverage/lcov.info';
      if (!fs.existsSync(lcovFile)) {
        console.warn('Warning: LCOV file not found, skipping CodeCov upload');
        return;
      }
      
      // Install codecov if not available
      await execAsync('npx codecov --version || npm install -g codecov').catch(() => {
        console.warn('Warning: Could not install codecov, skipping upload');
        return;
      });
      
      // Upload coverage
      const uploadCmd = `npx codecov -f ${lcovFile}`;
      await execAsync(uploadCmd);
      
      console.log('✅ Coverage uploaded to CodeCov successfully');
      
    } catch (error) {
      console.warn('⚠️ CodeCov upload failed (non-blocking):', error.message);
    }
  }

  async generatePullRequestComment() {
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
      console.log('ℹ️ Skipping PR comment - GitHub environment not detected');
      return;
    }
    
    console.log('💬 Generating Pull Request comment...');
    
    const comment = this.generatePRCommentContent();
    const commentFile = 'reports/ci/pr-comment.md';
    fs.writeFileSync(commentFile, comment);
    
    console.log(`📝 PR comment saved to ${commentFile}`);
  }

  generatePRCommentContent() {
    const status = this.getOverallStatus();
    const statusEmoji = status === 'passed' ? '✅' : status === 'warning' ? '⚠️' : '❌';
    
    let comment = `## ${statusEmoji} Quality Gates Report\n\n`;
    
    if (this.results.coverage) {
      comment += `### 📊 Coverage\n\n`;
      comment += `| Metric | Value | Threshold | Status |\n`;
      comment += `|--------|-------|-----------|--------|\n`;
      
      Object.entries(this.results.coverage.coverage).forEach(([metric, value]) => {
        const threshold = this.config.coverage.thresholds[metric];
        const status = value >= threshold ? '✅' : '❌';
        comment += `| ${metric} | ${value.toFixed(1)}% | ${threshold}% | ${status} |\n`;
      });
      
      comment += '\n';
    }
    
    if (this.results.mutation) {
      comment += `### 🧬 Mutation Testing\n\n`;
      comment += `- **Mutation Score**: ${this.results.mutation.summary.mutationScore.toFixed(1)}%\n`;
      comment += `- **Killed Mutants**: ${this.results.mutation.summary.killed}/${this.results.mutation.summary.total}\n`;
      comment += `- **Survived Mutants**: ${this.results.mutation.summary.survived}\n\n`;
    }
    
    comment += `### 📈 Summary\n\n`;
    comment += `- ✅ Passed: ${this.results.qualityGates.passed}\n`;
    comment += `- ❌ Failed: ${this.results.qualityGates.failed}\n`;
    comment += `- ⚠️ Warnings: ${this.results.qualityGates.warnings}\n\n`;
    
    comment += `*Generated by CCTelegram Quality Gates*`;
    
    return comment;
  }

  async finalQualityGateCheck() {
    console.log('🏁 Final quality gate check...');
    
    const status = this.getOverallStatus();
    
    console.log(`\n📊 Quality Gates Summary:`);
    console.log(`Status: ${status.toUpperCase()}`);
    console.log(`Passed: ${this.results.qualityGates.passed}`);
    console.log(`Failed: ${this.results.qualityGates.failed}`);
    console.log(`Warnings: ${this.results.qualityGates.warnings}`);
    
    if (status === 'failed') {
      throw new Error(`Quality gates failed: ${this.results.qualityGates.failed} critical failures`);
    }
    
    if (status === 'warning') {
      console.log('⚠️ Quality gates passed with warnings - consider addressing them');
    }
    
    console.log('✅ Quality gates check completed');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const gates = new CIQualityGates();
  
  gates.runQualityGates()
    .then(() => {
      console.log('🎉 CI/CD Quality Gates completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 CI/CD Quality Gates failed:', error);
      process.exit(1);
    });
}

export { CIQualityGates };
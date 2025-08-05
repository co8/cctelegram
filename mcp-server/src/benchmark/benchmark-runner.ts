#!/usr/bin/env node

/**
 * Benchmark Runner CLI
 * 
 * Command-line interface for running performance benchmarks on the CCTelegram MCP Server.
 * Supports CI/CD integration, regression testing, and performance monitoring.
 */

import fs from 'fs-extra';
import path from 'path';
import { performance } from 'perf_hooks';
import { BenchmarkSuite, BenchmarkSuiteResults, getBenchmarkSuite } from './benchmark-suite.js';
import { secureLog } from '../security.js';

/**
 * CLI configuration options
 */
interface BenchmarkCliOptions {
  baseline?: string;       // Path to baseline results file
  output?: string;         // Output path for results
  categories?: string[];   // Filter by categories
  threshold?: number;      // Performance threshold for CI/CD (percentage)
  format?: 'json' | 'html' | 'csv' | 'markdown';
  quiet?: boolean;         // Suppress console output
  saveBaseline?: boolean;  // Save results as new baseline
  tempDir?: string;        // Temporary directory for test files
  timeout?: number;        // Global timeout in milliseconds
}

/**
 * Benchmark Runner class
 */
export class BenchmarkRunner {
  private options: BenchmarkCliOptions;
  private suite: BenchmarkSuite;
  
  constructor(options: BenchmarkCliOptions = {}) {
    this.options = {
      format: 'json',
      threshold: 10, // 10% regression threshold
      timeout: 300000, // 5 minutes default timeout
      ...options
    };
    
    this.suite = getBenchmarkSuite(this.options.tempDir);
    this.setupEventHandlers();
  }
  
  /**
   * Run benchmarks with CLI options
   */
  public async run(): Promise<BenchmarkSuiteResults> {
    const startTime = performance.now();
    
    if (!this.options.quiet) {
      console.log('🚀 Starting CCTelegram MCP Server Benchmark Suite\n');
    }
    
    try {
      // Load baseline results if provided
      if (this.options.baseline) {
        await this.suite.loadBaselines(this.options.baseline);
        if (!this.options.quiet) {
          console.log(`📊 Loaded baseline results from: ${this.options.baseline}\n`);
        }
      }
      
      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Benchmark suite timed out after ${this.options.timeout}ms`));
        }, this.options.timeout);
      });
      
      // Run benchmarks
      const resultsPromise = this.suite.runAll();
      const results = await Promise.race([resultsPromise, timeoutPromise]);
      
      // Save results
      if (this.options.output) {
        await this.saveResults(results, this.options.output, this.options.format!);
        if (!this.options.quiet) {
          console.log(`💾 Results saved to: ${this.options.output}\n`);
        }
      }
      
      // Save as baseline if requested
      if (this.options.saveBaseline && this.options.output) {
        const baselinePath = this.options.output.replace(/\.[^.]+$/, '.baseline.json');
        await this.suite.saveBaselines(baselinePath);
        if (!this.options.quiet) {
          console.log(`📈 Baseline saved to: ${baselinePath}\n`);
        }
      }
      
      // Display summary
      if (!this.options.quiet) {
        this.displaySummary(results);
      }
      
      // Check regression threshold for CI/CD
      const hasRegression = this.checkRegressionThreshold(results);
      if (hasRegression && !this.options.quiet) {
        console.log('❌ Performance regression detected above threshold!');
        process.exit(1);
      }
      
      const totalTime = performance.now() - startTime;
      if (!this.options.quiet) {
        console.log(`✅ Benchmark suite completed in ${(totalTime / 1000).toFixed(2)}s`);
      }
      
      return results;
      
    } catch (error) {
      secureLog('error', 'Benchmark runner failed', {
        error: error instanceof Error ? error.message : 'unknown',
        options: this.options
      });
      
      if (!this.options.quiet) {
        console.error('❌ Benchmark suite failed:', error instanceof Error ? error.message : error);
      }
      
      process.exit(1);
    }
  }
  
  /**
   * Setup event handlers for progress reporting
   */
  private setupEventHandlers(): void {
    this.suite.on('suite_started', (data) => {
      if (!this.options.quiet) {
        console.log(`🧪 Running ${data.total_tests} benchmark tests...\n`);
      }
    });
    
    this.suite.on('test_completed', (data) => {
      if (!this.options.quiet) {
        const { test, result } = data;
        const status = result.performance.meets_budget ? '✅' : '⚠️';
        const ops = result.hz.toFixed(0);
        const duration = result.performance.duration_ms.toFixed(2);
        
        console.log(`  ${status} ${test}: ${ops} ops/sec (${duration}ms avg)`);
      }
    });
    
    this.suite.on('test_failed', (data) => {
      if (!this.options.quiet) {
        console.log(`  ❌ ${data.test}: FAILED`);
      }
    });
    
    this.suite.on('suite_completed', () => {
      if (!this.options.quiet) {
        console.log('\n📋 Benchmark Results Summary:\n');
      }
    });
  }
  
  /**
   * Display results summary
   */
  private displaySummary(results: BenchmarkSuiteResults): void {
    console.log(`Total Tests: ${results.total_tests}`);
    console.log(`Passed: ${results.passed} | Failed: ${results.failed}`);
    console.log(`Duration: ${(results.duration_ms / 1000).toFixed(2)}s\n`);
    
    // Performance analysis
    console.log('🏆 Performance Analysis:');
    console.log(`  Fastest: ${results.analysis.fastest_operation.name} (${results.analysis.fastest_operation.hz.toFixed(0)} ops/sec)`);
    console.log(`  Slowest: ${results.analysis.slowest_operation.name} (${results.analysis.slowest_operation.hz.toFixed(0)} ops/sec)`);
    
    if (results.analysis.biggest_improvement) {
      console.log(`  Biggest Improvement: ${results.analysis.biggest_improvement.name} (+${results.analysis.biggest_improvement.comparison?.improvement_percent?.toFixed(1)}%)`);
    }
    
    if (results.analysis.biggest_regression) {
      console.log(`  Biggest Regression: ${results.analysis.biggest_regression.name} (-${results.analysis.biggest_regression.comparison?.regression_percent?.toFixed(1)}%)`);
    }
    
    if (results.analysis.budget_violations.length > 0) {
      console.log(`  Budget Violations: ${results.analysis.budget_violations.length}`);
      results.analysis.budget_violations.forEach(violation => {
        console.log(`    - ${violation.name}: ${violation.performance.duration_ms.toFixed(2)}ms`);
      });
    }
    
    console.log('\n💡 Recommendations:');
    results.recommendations.forEach(rec => {
      console.log(`  • ${rec}`);
    });
    
    console.log('\n📊 Category Performance:');
    Object.entries(results.results).forEach(([category, categoryResults]) => {
      if (categoryResults.length > 0) {
        const avgOps = categoryResults.reduce((sum, r) => sum + r.hz, 0) / categoryResults.length;
        const avgDuration = categoryResults.reduce((sum, r) => sum + r.performance.duration_ms, 0) / categoryResults.length;
        console.log(`  ${category}: ${avgOps.toFixed(0)} avg ops/sec (${avgDuration.toFixed(2)}ms avg)`);
      }
    });
    
    console.log('');
  }
  
  /**
   * Check if performance regression exceeds threshold
   */
  private checkRegressionThreshold(results: BenchmarkSuiteResults): boolean {
    const threshold = this.options.threshold || 10;
    
    // Check overall regressions
    if (results.analysis.biggest_regression) {
      const regressionPercent = results.analysis.biggest_regression.comparison?.regression_percent || 0;
      if (regressionPercent > threshold) {
        return true;
      }
    }
    
    // Check budget violations
    if (results.analysis.budget_violations.length > 0) {
      const violationRatio = results.analysis.budget_violations.length / results.total_tests;
      if (violationRatio > 0.2) { // More than 20% of tests violate budgets
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Save results in different formats
   */
  private async saveResults(
    results: BenchmarkSuiteResults, 
    outputPath: string, 
    format: string
  ): Promise<void> {
    await fs.ensureDir(path.dirname(outputPath));
    
    switch (format) {
      case 'json':
        await fs.writeJSON(outputPath, results, { spaces: 2 });
        break;
        
      case 'html':
        const html = this.generateHtmlReport(results);
        await fs.writeFile(outputPath, html);
        break;
        
      case 'csv':
        const csv = this.generateCsvReport(results);
        await fs.writeFile(outputPath, csv);
        break;
        
      case 'markdown':
        const markdown = this.generateMarkdownReport(results);
        await fs.writeFile(outputPath, markdown);
        break;
        
      default:
        throw new Error(`Unsupported output format: ${format}`);
    }
  }
  
  /**
   * Generate HTML report
   */
  private generateHtmlReport(results: BenchmarkSuiteResults): string {
    const timestamp = new Date(results.timestamp).toLocaleString();
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CCTelegram MCP Server Benchmark Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f4f4f4; padding: 20px; border-radius: 5px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .card { background: white; border: 1px solid #ddd; padding: 15px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .success { color: #28a745; }
        .warning { color: #ffc107; }
        .danger { color: #dc3545; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; }
        .chart { width: 100%; height: 200px; background: #f9f9f9; border: 1px solid #ddd; margin: 10px 0; display: flex; align-items: center; justify-content: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 CCTelegram MCP Server Benchmark Report</h1>
        <p><strong>Generated:</strong> ${timestamp}</p>
        <p><strong>Duration:</strong> ${(results.duration_ms / 1000).toFixed(2)} seconds</p>
    </div>
    
    <div class="summary">
        <div class="card">
            <h3>Test Results</h3>
            <p><strong>Total:</strong> ${results.total_tests}</p>
            <p class="success"><strong>Passed:</strong> ${results.passed}</p>
            <p class="danger"><strong>Failed:</strong> ${results.failed}</p>
        </div>
        
        <div class="card">
            <h3>Performance</h3>
            <p><strong>Fastest:</strong> ${results.analysis.fastest_operation.name}</p>
            <p><strong>Slowest:</strong> ${results.analysis.slowest_operation.name}</p>
            <p class="warning"><strong>Budget Violations:</strong> ${results.analysis.budget_violations.length}</p>
        </div>
        
        <div class="card">
            <h3>System Info</h3>
            <p><strong>Node:</strong> ${results.results.security[0]?.system.node_version || 'N/A'}</p>
            <p><strong>Platform:</strong> ${results.results.security[0]?.system.platform || 'N/A'}</p>
            <p><strong>CPUs:</strong> ${results.results.security[0]?.system.cpu_count || 'N/A'}</p>
        </div>
    </div>
    
    <h2>📈 Performance by Category</h2>
    ${Object.entries(results.results).map(([category, categoryResults]) => {
      if (categoryResults.length === 0) return '';
      
      return `
        <h3>${category.toUpperCase()}</h3>
        <table>
            <thead>
                <tr>
                    <th>Test Name</th>
                    <th>Operations/sec</th>
                    <th>Average (ms)</th>
                    <th>Memory (MB)</th>
                    <th>Budget Status</th>
                    <th>Comparison</th>
                </tr>
            </thead>
            <tbody>
                ${categoryResults.map(result => `
                    <tr>
                        <td>${result.name}</td>
                        <td>${result.hz.toFixed(0)}</td>
                        <td>${result.performance.duration_ms.toFixed(2)}</td>
                        <td>${result.performance.memory_used_mb.toFixed(1)}</td>
                        <td class="${result.performance.meets_budget ? 'success' : 'danger'}">
                            ${result.performance.meets_budget ? '✅ Pass' : '❌ Violation'}
                        </td>
                        <td>
                            ${result.comparison ? 
                              ((result.comparison.improvement_percent || 0) > 0 ? 
                                `<span class="success">+${(result.comparison.improvement_percent || 0).toFixed(1)}%</span>` :
                                `<span class="danger">-${(result.comparison.regression_percent || 0).toFixed(1)}%</span>`
                              ) : 'No baseline'
                            }
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
      `;
    }).join('')}
    
    <h2>💡 Recommendations</h2>
    <ul>
        ${results.recommendations.map(rec => `<li>${rec}</li>`).join('')}
    </ul>
    
    <div class="chart">
        📊 Charts would be rendered here with a charting library like Chart.js
    </div>
</body>
</html>`;
  }
  
  /**
   * Generate CSV report
   */
  private generateCsvReport(results: BenchmarkSuiteResults): string {
    const headers = [
      'name', 'category', 'ops_per_sec', 'duration_ms', 'memory_mb', 
      'meets_budget', 'improvement_percent', 'regression_percent'
    ];
    
    const rows = Object.values(results.results).flat().map(result => [
      result.name,
      result.category,
      result.hz.toFixed(2),
      result.performance.duration_ms.toFixed(2),
      result.performance.memory_used_mb.toFixed(2),
      result.performance.meets_budget,
      result.comparison?.improvement_percent?.toFixed(2) || '',
      result.comparison?.regression_percent?.toFixed(2) || ''
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
  
  /**
   * Generate Markdown report
   */
  private generateMarkdownReport(results: BenchmarkSuiteResults): string {
    const timestamp = new Date(results.timestamp).toLocaleString();
    
    return `# 📊 CCTelegram MCP Server Benchmark Report

**Generated:** ${timestamp}  
**Duration:** ${(results.duration_ms / 1000).toFixed(2)} seconds

## Summary

- **Total Tests:** ${results.total_tests}
- **Passed:** ${results.passed} ✅
- **Failed:** ${results.failed} ❌
- **Budget Violations:** ${results.analysis.budget_violations.length} ⚠️

## Performance Analysis

- **Fastest Operation:** ${results.analysis.fastest_operation.name} (${results.analysis.fastest_operation.hz.toFixed(0)} ops/sec)
- **Slowest Operation:** ${results.analysis.slowest_operation.name} (${results.analysis.slowest_operation.hz.toFixed(0)} ops/sec)

${results.analysis.biggest_improvement ? `- **Biggest Improvement:** ${results.analysis.biggest_improvement.name} (+${results.analysis.biggest_improvement.comparison?.improvement_percent?.toFixed(1)}%)` : ''}

${results.analysis.biggest_regression ? `- **Biggest Regression:** ${results.analysis.biggest_regression.name} (-${results.analysis.biggest_regression.comparison?.regression_percent?.toFixed(1)}%)` : ''}

## Results by Category

${Object.entries(results.results).map(([category, categoryResults]) => {
  if (categoryResults.length === 0) return '';
  
  return `### ${category.toUpperCase()}

| Test Name | Ops/sec | Avg (ms) | Memory (MB) | Budget | Comparison |
|-----------|---------|----------|-------------|--------|------------|
${categoryResults.map(result => 
  `| ${result.name} | ${result.hz.toFixed(0)} | ${result.performance.duration_ms.toFixed(2)} | ${result.performance.memory_used_mb.toFixed(1)} | ${result.performance.meets_budget ? '✅' : '❌'} | ${result.comparison ? ((result.comparison.improvement_percent || 0) > 0 ? `+${(result.comparison.improvement_percent || 0).toFixed(1)}%` : `-${(result.comparison.regression_percent || 0).toFixed(1)}%`) : 'No baseline'} |`
).join('\n')}
`;
}).join('\n')}

## Recommendations

${results.recommendations.map(rec => `- ${rec}`).join('\n')}

## System Information

- **Node.js:** ${results.results.security[0]?.system.node_version || 'N/A'}
- **Platform:** ${results.results.security[0]?.system.platform || 'N/A'}
- **Architecture:** ${results.results.security[0]?.system.arch || 'N/A'}
- **CPUs:** ${results.results.security[0]?.system.cpu_count || 'N/A'}
- **Memory:** ${results.results.security[0]?.system.memory_total_gb || 'N/A'} GB
`;
  }
}

/**
 * CLI argument parsing and execution
 */
export async function runBenchmarkCli(): Promise<void> {
  const args = process.argv.slice(2);
  const options: BenchmarkCliOptions = {};
  
  // Parse CLI arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--baseline':
        options.baseline = nextArg;
        i++;
        break;
      case '--output':
        options.output = nextArg;
        i++;
        break;
      case '--format':
        options.format = nextArg as any;
        i++;
        break;
      case '--threshold':
        options.threshold = parseInt(nextArg);
        i++;
        break;
      case '--timeout':
        options.timeout = parseInt(nextArg);
        i++;
        break;
      case '--temp-dir':
        options.tempDir = nextArg;
        i++;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--save-baseline':
        options.saveBaseline = true;
        break;
      case '--help':
        console.log(`
CCTelegram MCP Server Benchmark Suite

Usage: npm run benchmark [options]

Options:
  --baseline <path>      Path to baseline results file for comparison
  --output <path>        Output path for results
  --format <format>      Output format: json, html, csv, markdown (default: json)
  --threshold <percent>  Performance regression threshold for CI/CD (default: 10)
  --timeout <ms>         Global timeout in milliseconds (default: 300000)
  --temp-dir <path>      Temporary directory for test files
  --quiet               Suppress console output
  --save-baseline       Save results as new baseline
  --help                Show this help message

Examples:
  npm run benchmark                                    # Run all benchmarks
  npm run benchmark --output results.json             # Save results to file
  npm run benchmark --baseline old.json --threshold 5 # Compare against baseline
  npm run benchmark --format html --output report.html # Generate HTML report
        `);
        process.exit(0);
        break;
    }
  }
  
  // Set default output path if not provided
  if (!options.output) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    options.output = `benchmark-results-${timestamp}.json`;
  }
  
  const runner = new BenchmarkRunner(options);
  await runner.run();
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmarkCli().catch(error => {
    console.error('❌ Benchmark CLI failed:', error);
    process.exit(1);
  });
}
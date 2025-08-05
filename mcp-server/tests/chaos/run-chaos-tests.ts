#!/usr/bin/env tsx
/**
 * Chaos Engineering Test Execution Script
 * 
 * Comprehensive script to run chaos engineering tests with various configurations.
 * Supports network failures, service outages, Lambda failures, and provides
 * detailed reporting on system resilience and recovery capabilities.
 */

import { Command } from 'commander';
import { ChaosTestRunner } from './core/chaos-test-runner.js';
import { SystemMonitor } from './core/system-monitor.js';
import { MTTRAnalyzer } from './core/mttr-analyzer.js';
import { ToxiproxyIntegration } from './network/toxiproxy-integration.js';
import { ChaosMonkeyLambda } from './lambda/chaos-monkey-lambda.js';
import { ChaosDashboard } from './dashboard/chaos-dashboard.js';
import {
  NetworkChaosScenarios,
  ServiceChaosScenarios,
  LambdaChaosScenarios,
  getAllChaosScenarios,
  getScenariosByTag,
  getScenariosByIntensity
} from './fixtures/chaos-scenarios.js';
import { secureLog } from '../../src/security.js';
import fs from 'fs-extra';
import path from 'path';

const program = new Command();

interface TestRunConfiguration {
  scenarios: string[];
  tags: string[];
  intensity: { min: number; max: number; };
  duration: { min: number; max: number; };
  parallel: boolean;
  maxConcurrent: number;
  reportPath: string;
  dashboard: boolean;
  dashboardPort: number;
  includeNetworkTests: boolean;
  includeServiceTests: boolean;
  includeLambdaTests: boolean;
  verbose: boolean;
  dryRun: boolean;
  skipToxiproxy: boolean;
  skipAWS: boolean;
}

class ChaosTestExecutor {
  private chaosRunner: ChaosTestRunner;
  private systemMonitor: SystemMonitor;
  private mttrAnalyzer: MTTRAnalyzer;
  private toxiproxy?: ToxiproxyIntegration;
  private chaosMonkey?: ChaosMonkeyLambda;
  private dashboard?: ChaosDashboard;
  private isInitialized: boolean = false;

  constructor() {
    this.chaosRunner = new ChaosTestRunner();
    this.systemMonitor = new SystemMonitor();
    this.mttrAnalyzer = new MTTRAnalyzer();
  }

  /**
   * Initialize chaos testing infrastructure
   */
  public async initialize(config: TestRunConfiguration): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    secureLog('info', 'Initializing chaos testing infrastructure', {
      include_network: config.includeNetworkTests,
      include_service: config.includeServiceTests,
      include_lambda: config.includeLambdaTests,
      dashboard_enabled: config.dashboard
    });

    try {
      // Initialize core components
      await Promise.all([
        this.chaosRunner.initialize(),
        this.systemMonitor.startMonitoring(2000)
      ]);

      // Initialize optional components
      if (config.includeNetworkTests && !config.skipToxiproxy) {
        this.toxiproxy = new ToxiproxyIntegration({
          autoStart: true,
          host: process.env.TOXIPROXY_HOST || 'localhost',
          port: parseInt(process.env.TOXIPROXY_PORT || '8474')
        });
        
        try {
          await this.toxiproxy.initialize();
          secureLog('info', 'Toxiproxy initialized successfully');
        } catch (error) {
          secureLog('warn', 'Failed to initialize Toxiproxy', {
            error: error instanceof Error ? error.message : 'Unknown error',
            skip_network_tests: true
          });
          config.includeNetworkTests = false;
        }
      }

      if (config.includeLambdaTests && !config.skipAWS) {
        this.chaosMonkey = new ChaosMonkeyLambda({
          region: process.env.AWS_REGION || 'us-east-1',
          enabledFunctions: process.env.LAMBDA_FUNCTIONS?.split(',') || [],
          chaosPercent: 100,
          enableCloudWatchIntegration: true
        });

        try {
          await this.chaosMonkey.initialize();
          secureLog('info', 'Chaos Monkey Lambda initialized successfully');
        } catch (error) {
          secureLog('warn', 'Failed to initialize Chaos Monkey Lambda', {
            error: error instanceof Error ? error.message : 'Unknown error',
            skip_lambda_tests: true
          });
          config.includeLambdaTests = false;
        }
      }

      // Initialize dashboard if requested
      if (config.dashboard) {
        this.dashboard = new ChaosDashboard(config.dashboardPort);
        await this.dashboard.initialize();
        secureLog('info', `Chaos dashboard started on port ${config.dashboardPort}`);
      }

      this.isInitialized = true;
      secureLog('info', 'Chaos testing infrastructure initialized successfully');

    } catch (error) {
      throw new Error(`Failed to initialize chaos testing infrastructure: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Run chaos tests based on configuration
   */
  public async runTests(config: TestRunConfiguration): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Chaos testing infrastructure not initialized');
    }

    const scenarios = this.selectScenarios(config);
    
    if (scenarios.length === 0) {
      throw new Error('No scenarios selected for testing');
    }

    secureLog('info', 'Starting chaos engineering tests', {
      scenario_count: scenarios.length,
      parallel: config.parallel,
      max_concurrent: config.maxConcurrent,
      dry_run: config.dryRun
    });

    if (config.dryRun) {
      return this.dryRunTests(scenarios, config);
    }

    const results = config.parallel ? 
      await this.runParallelTests(scenarios, config) :
      await this.runSequentialTests(scenarios, config);

    // Generate comprehensive report
    const report = await this.generateReport(results, config);

    // Save report
    await this.saveReport(report, config.reportPath);

    return report;
  }

  /**
   * Select scenarios based on configuration
   */
  private selectScenarios(config: TestRunConfiguration): any[] {
    let scenarios: any[] = [];

    // Add specific scenarios if specified
    if (config.scenarios.length > 0) {
      const allScenarios = getAllChaosScenarios();
      scenarios = allScenarios.filter(scenario => 
        config.scenarios.includes(scenario.name)
      );
    } else {
      // Add scenarios by category
      if (config.includeNetworkTests) {
        scenarios.push(...Object.values(NetworkChaosScenarios));
      }
      
      if (config.includeServiceTests) {
        scenarios.push(...Object.values(ServiceChaosScenarios));
      }
      
      if (config.includeLambdaTests) {
        scenarios.push(...Object.values(LambdaChaosScenarios));
      }
    }

    // Filter by tags
    if (config.tags.length > 0) {
      scenarios = scenarios.filter(scenario =>
        config.tags.some(tag => scenario.tags.includes(tag))
      );
    }

    // Filter by intensity
    scenarios = scenarios.filter(scenario =>
      scenario.faultConfiguration.intensity >= config.intensity.min &&
      scenario.faultConfiguration.intensity <= config.intensity.max
    );

    // Filter by duration
    scenarios = scenarios.filter(scenario =>
      scenario.duration >= config.duration.min &&
      scenario.duration <= config.duration.max
    );

    return scenarios;
  }

  /**
   * Run tests in dry-run mode
   */
  private async dryRunTests(scenarios: any[], config: TestRunConfiguration): Promise<any> {
    secureLog('info', 'Running in dry-run mode - no actual chaos will be injected');

    const dryRunResults = scenarios.map(scenario => ({
      scenario: scenario.name,
      type: scenario.faultConfiguration.type,
      duration: scenario.duration,
      intensity: scenario.faultConfiguration.intensity,
      tags: scenario.tags,
      estimatedDuration: scenario.duration + 30000, // Add setup/cleanup time
      wouldRun: true
    }));

    const totalEstimatedTime = dryRunResults.reduce((sum, result) => 
      sum + result.estimatedDuration, 0
    );

    return {
      dryRun: true,
      scenarios: dryRunResults,
      totalScenarios: scenarios.length,
      estimatedTotalTime: totalEstimatedTime,
      estimatedTimeFormatted: this.formatDuration(totalEstimatedTime)
    };
  }

  /**
   * Run tests sequentially
   */
  private async runSequentialTests(scenarios: any[], config: TestRunConfiguration): Promise<any[]> {
    const results: any[] = [];
    
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      
      secureLog('info', `Running scenario ${i + 1}/${scenarios.length}: ${scenario.name}`, {
        type: scenario.faultConfiguration.type,
        intensity: scenario.faultConfiguration.intensity,
        duration: scenario.duration
      });

      try {
        const startTime = Date.now();
        const result = await this.chaosRunner.runScenario(scenario);
        const endTime = Date.now();

        const enhancedResult = {
          ...result,
          scenario: scenario.name,
          sequenceNumber: i + 1,
          totalDuration: endTime - startTime,
          systemHealthBefore: this.systemMonitor.getHealthStatus(),
          systemHealthAfter: this.systemMonitor.getHealthStatus()
        };

        results.push(enhancedResult);

        secureLog('info', `Scenario completed: ${scenario.name}`, {
          success: result.success,
          recovery_time: result.recoveryTime,
          final_success_rate: result.finalSuccessRate
        });

        // Allow system to stabilize between tests
        if (i < scenarios.length - 1) {
          const stabilizationTime = 10000; // 10 seconds
          secureLog('info', `Waiting ${stabilizationTime}ms for system stabilization`);
          await new Promise(resolve => setTimeout(resolve, stabilizationTime));
        }

      } catch (error) {
        secureLog('error', `Scenario failed: ${scenario.name}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        results.push({
          scenario: scenario.name,
          sequenceNumber: i + 1,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          totalDuration: 0
        });
      }
    }

    return results;
  }

  /**
   * Run tests in parallel
   */
  private async runParallelTests(scenarios: any[], config: TestRunConfiguration): Promise<any[]> {
    const maxConcurrent = Math.min(config.maxConcurrent, scenarios.length);
    const results: any[] = [];
    
    secureLog('info', `Running ${scenarios.length} scenarios with max concurrency of ${maxConcurrent}`);

    // Split scenarios into batches
    const batches: any[][] = [];
    for (let i = 0; i < scenarios.length; i += maxConcurrent) {
      batches.push(scenarios.slice(i, i + maxConcurrent));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      secureLog('info', `Running batch ${batchIndex + 1}/${batches.length} with ${batch.length} scenarios`);

      const batchPromises = batch.map(async (scenario, index) => {
        try {
          const startTime = Date.now();
          const result = await this.chaosRunner.runScenario(scenario);
          const endTime = Date.now();

          return {
            ...result,
            scenario: scenario.name,
            batchNumber: batchIndex + 1,
            batchIndex: index,
            totalDuration: endTime - startTime
          };

        } catch (error) {
          return {
            scenario: scenario.name,
            batchNumber: batchIndex + 1,
            batchIndex: index,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            totalDuration: 0
          };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          secureLog('info', `Batch scenario completed: ${batch[index].name}`, {
            success: result.value.success
          });
        } else {
          results.push({
            scenario: batch[index].name,
            batchNumber: batchIndex + 1,
            batchIndex: index,
            success: false,
            error: result.reason,
            totalDuration: 0
          });
          secureLog('error', `Batch scenario failed: ${batch[index].name}`, {
            error: result.reason
          });
        }
      });

      // Allow system to stabilize between batches
      if (batchIndex < batches.length - 1) {
        const stabilizationTime = 15000; // 15 seconds between batches
        secureLog('info', `Waiting ${stabilizationTime}ms for system stabilization between batches`);
        await new Promise(resolve => setTimeout(resolve, stabilizationTime));
      }
    }

    return results;
  }

  /**
   * Generate comprehensive report
   */
  private async generateReport(results: any[], config: TestRunConfiguration): Promise<any> {
    const successfulTests = results.filter(r => r.success);
    const failedTests = results.filter(r => !r.success);
    
    const mttrData = successfulTests
      .map(r => r.mttrAnalysis?.mttr)
      .filter(mttr => mttr !== undefined);

    const availabilityData = successfulTests
      .map(r => r.mttrAnalysis?.availability)
      .filter(availability => availability !== undefined);

    const recoveryMechanisms = successfulTests
      .flatMap(r => r.activatedMechanisms || [])
      .reduce((acc, mechanism) => {
        acc[mechanism] = (acc[mechanism] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    const systemHealthData = {
      finalHealth: this.systemMonitor.getHealthStatus(),
      alertsSummary: this.systemMonitor.getAlerts().reduce((acc, alert) => {
        acc[alert.level] = (acc[alert.level] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      metricsHistory: this.systemMonitor.getMetricsHistory(100)
    };

    const report = {
      metadata: {
        timestamp: new Date().toISOString(),
        configuration: config,
        totalDuration: results.reduce((sum, r) => sum + (r.totalDuration || 0), 0),
        totalDurationFormatted: this.formatDuration(
          results.reduce((sum, r) => sum + (r.totalDuration || 0), 0)
        )
      },
      summary: {
        totalTests: results.length,
        successful: successfulTests.length,
        failed: failedTests.length,
        successRate: results.length > 0 ? successfulTests.length / results.length : 0
      },
      resilience: {
        averageMTTR: mttrData.length > 0 ? mttrData.reduce((a, b) => a + b, 0) / mttrData.length : 0,
        averageAvailability: availabilityData.length > 0 ? 
          availabilityData.reduce((a, b) => a + b, 0) / availabilityData.length : 0,
        recoveryMechanisms,
        mostEffectiveMechanism: Object.entries(recoveryMechanisms)
          .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none'
      },
      systemHealth: systemHealthData,
      detailedResults: results,
      recommendations: this.generateRecommendations(results),
      benchmarks: {
        industryMTTR: 60000, // 1 minute
        targetMTTR: 30000,   // 30 seconds
        minimumAvailability: 0.99, // 99%
        passedBenchmarks: this.evaluateBenchmarks(mttrData, availabilityData)
      }
    };

    return report;
  }

  /**
   * Generate recommendations based on test results
   */
  private generateRecommendations(results: any[]): any[] {
    const recommendations: any[] = [];
    const successfulTests = results.filter(r => r.success);

    // MTTR recommendations
    const avgMTTR = successfulTests.length > 0 ? 
      successfulTests.reduce((sum, r) => sum + (r.mttrAnalysis?.mttr || 0), 0) / successfulTests.length : 0;

    if (avgMTTR > 60000) { // More than 1 minute
      recommendations.push({
        category: 'recovery_time',
        priority: 'high',
        title: 'Improve Mean Time To Recovery (MTTR)',
        description: `Average MTTR of ${Math.round(avgMTTR/1000)}s exceeds target of 60s`,
        actions: [
          'Implement faster health checks',
          'Automate recovery procedures',
          'Improve monitoring and alerting',
          'Optimize circuit breaker thresholds'
        ]
      });
    }

    // Availability recommendations
    const avgAvailability = successfulTests.length > 0 ?
      successfulTests.reduce((sum, r) => sum + (r.mttrAnalysis?.availability || 0), 0) / successfulTests.length : 0;

    if (avgAvailability < 0.95) { // Less than 95%
      recommendations.push({
        category: 'availability',
        priority: 'critical',
        title: 'Improve System Availability',
        description: `Average availability of ${Math.round(avgAvailability*100)}% is below target`,
        actions: [
          'Implement redundancy and failover',
          'Improve error handling',
          'Add graceful degradation',
          'Enhance load balancing'
        ]
      });
    }

    // Failed test analysis
    const failedTests = results.filter(r => !r.success);
    if (failedTests.length > 0) {
      recommendations.push({
        category: 'reliability',
        priority: 'high',
        title: 'Address Test Failures',
        description: `${failedTests.length} out of ${results.length} tests failed`,
        actions: [
          'Investigate root causes of failures',
          'Strengthen error handling',
          'Improve system robustness',
          'Add missing recovery mechanisms'
        ]
      });
    }

    return recommendations;
  }

  /**
   * Evaluate benchmarks
   */
  private evaluateBenchmarks(mttrData: number[], availabilityData: number[]): any {
    const avgMTTR = mttrData.length > 0 ? mttrData.reduce((a, b) => a + b, 0) / mttrData.length : 0;
    const avgAvailability = availabilityData.length > 0 ? 
      availabilityData.reduce((a, b) => a + b, 0) / availabilityData.length : 0;

    return {
      mttrBenchmark: {
        target: 30000,
        actual: avgMTTR,
        passed: avgMTTR <= 30000
      },
      availabilityBenchmark: {
        target: 0.99,
        actual: avgAvailability,
        passed: avgAvailability >= 0.99
      }
    };
  }

  /**
   * Save report to file
   */
  private async saveReport(report: any, reportPath: string): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(reportPath));
      
      // Save JSON report
      await fs.writeJSON(reportPath, report, { spaces: 2 });
      
      // Save human-readable summary
      const summaryPath = reportPath.replace('.json', '-summary.txt');
      const summary = this.generateTextSummary(report);
      await fs.writeFile(summaryPath, summary);

      secureLog('info', 'Chaos engineering test report saved', {
        json_report: reportPath,
        summary_report: summaryPath
      });

    } catch (error) {
      secureLog('error', 'Failed to save report', {
        path: reportPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Generate text summary
   */
  private generateTextSummary(report: any): string {
    const lines = [
      '='.repeat(80),
      'CHAOS ENGINEERING TEST REPORT',
      '='.repeat(80),
      '',
      `Generated: ${report.metadata.timestamp}`,
      `Total Duration: ${report.metadata.totalDurationFormatted}`,
      '',
      'SUMMARY',
      '-'.repeat(40),
      `Total Tests: ${report.summary.totalTests}`,
      `Successful: ${report.summary.successful}`,
      `Failed: ${report.summary.failed}`,
      `Success Rate: ${Math.round(report.summary.successRate * 100)}%`,
      '',
      'RESILIENCE METRICS',
      '-'.repeat(40),
      `Average MTTR: ${Math.round(report.resilience.averageMTTR / 1000)}s`,
      `Average Availability: ${Math.round(report.resilience.averageAvailability * 100)}%`,
      `Most Effective Recovery Mechanism: ${report.resilience.mostEffectiveMechanism}`,
      '',
      'RECOVERY MECHANISMS',
      '-'.repeat(40)
    ];

    Object.entries(report.resilience.recoveryMechanisms).forEach(([mechanism, count]) => {
      lines.push(`${mechanism}: ${count} activations`);
    });

    lines.push('', 'RECOMMENDATIONS', '-'.repeat(40));
    
    report.recommendations.forEach((rec: any, index: number) => {
      lines.push(`${index + 1}. [${rec.priority.toUpperCase()}] ${rec.title}`);
      lines.push(`   ${rec.description}`);
      rec.actions.forEach((action: string) => {
        lines.push(`   - ${action}`);
      });
      lines.push('');
    });

    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Cleanup and shutdown
   */
  public async shutdown(): Promise<void> {
    secureLog('info', 'Shutting down chaos testing infrastructure');

    await Promise.allSettled([
      this.systemMonitor.stopMonitoring(),
      this.toxiproxy?.shutdown(),
      this.chaosMonkey?.shutdown(),
      this.dashboard?.shutdown(),
      this.chaosRunner.shutdown()
    ]);

    secureLog('info', 'Chaos testing infrastructure shutdown completed');
  }
}

// CLI Implementation
program
  .name('run-chaos-tests')
  .description('Run chaos engineering tests for the CCTelegram bridge system')
  .version('1.0.0');

program
  .option('-s, --scenarios <scenarios...>', 'Specific scenarios to run')
  .option('-t, --tags <tags...>', 'Filter scenarios by tags', [])
  .option('--min-intensity <intensity>', 'Minimum fault intensity (0-1)', '0')
  .option('--max-intensity <intensity>', 'Maximum fault intensity (0-1)', '1')
  .option('--min-duration <duration>', 'Minimum scenario duration (ms)', '0')
  .option('--max-duration <duration>', 'Maximum scenario duration (ms)', '3600000')
  .option('-p, --parallel', 'Run tests in parallel', false)
  .option('--max-concurrent <count>', 'Maximum concurrent tests', '3')
  .option('-r, --report <path>', 'Report output path', './reports/chaos-test-report.json')
  .option('--dashboard', 'Start chaos dashboard', false)
  .option('--dashboard-port <port>', 'Dashboard port', '3001')
  .option('--no-network', 'Skip network chaos tests', false)
  .option('--no-service', 'Skip service chaos tests', false)
  .option('--no-lambda', 'Skip Lambda chaos tests', false)
  .option('--skip-toxiproxy', 'Skip Toxiproxy initialization', false)
  .option('--skip-aws', 'Skip AWS/Lambda initialization', false)
  .option('-v, --verbose', 'Verbose logging', false)
  .option('--dry-run', 'Show what would be run without executing', false);

program.parse();

const options = program.opts();

const config: TestRunConfiguration = {
  scenarios: options.scenarios || [],
  tags: options.tags,
  intensity: {
    min: parseFloat(options.minIntensity),
    max: parseFloat(options.maxIntensity)
  },
  duration: {
    min: parseInt(options.minDuration),
    max: parseInt(options.maxDuration)
  },
  parallel: options.parallel,
  maxConcurrent: parseInt(options.maxConcurrent),
  reportPath: options.report,
  dashboard: options.dashboard,
  dashboardPort: parseInt(options.dashboardPort),
  includeNetworkTests: !options.noNetwork,
  includeServiceTests: !options.noService,
  includeLambdaTests: !options.noLambda,
  verbose: options.verbose,
  dryRun: options.dryRun,
  skipToxiproxy: options.skipToxiproxy,
  skipAWS: options.skipAws
};

// Main execution
async function main() {
  const executor = new ChaosTestExecutor();
  
  try {
    secureLog('info', 'Starting chaos engineering test execution', config);

    await executor.initialize(config);
    const report = await executor.runTests(config);

    if (config.dryRun) {
      console.log('\n🔍 DRY RUN RESULTS:');
      console.log(`Would run ${report.totalScenarios} scenarios`);
      console.log(`Estimated total time: ${report.estimatedTimeFormatted}`);
      console.log('\nScenarios that would be executed:');
      report.scenarios.forEach((scenario: any, index: number) => {
        console.log(`  ${index + 1}. ${scenario.scenario} (${scenario.type}, ${scenario.intensity * 100}% intensity)`);
      });
    } else {
      console.log('\n✅ CHAOS ENGINEERING TESTS COMPLETED');
      console.log(`Total Tests: ${report.summary.totalTests}`);
      console.log(`Successful: ${report.summary.successful}`);
      console.log(`Failed: ${report.summary.failed}`);
      console.log(`Success Rate: ${Math.round(report.summary.successRate * 100)}%`);
      console.log(`Average MTTR: ${Math.round(report.resilience.averageMTTR / 1000)}s`);
      console.log(`Average Availability: ${Math.round(report.resilience.averageAvailability * 100)}%`);
      console.log(`\nDetailed report saved to: ${config.reportPath}`);
      
      if (config.dashboard) {
        console.log(`Dashboard available at: http://localhost:${config.dashboardPort}`);
      }
    }

  } catch (error) {
    secureLog('error', 'Chaos engineering test execution failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  } finally {
    if (!config.dashboard) {
      await executor.shutdown();
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  secureLog('info', 'Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  secureLog('info', 'Received SIGTERM, shutting down...');
  process.exit(0);
});

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
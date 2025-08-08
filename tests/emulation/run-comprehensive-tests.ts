#!/usr/bin/env tsx
/**
 * Comprehensive Test Runner
 * Main entry point for running the complete emulation and verification system
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TestAutomationOrchestrator, defaultTestConfigurations, TestConfiguration } from './test-automation-orchestrator.js';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RunnerConfig {
  testDir: string;
  logDir: string;
  configurations: string[]; // Names of configurations to run
  parallel: boolean;
  generateReport: boolean;
  cleanup: boolean;
  verbose: boolean;
}

class ComprehensiveTestRunner {
  private orchestrator: TestAutomationOrchestrator;
  private config: RunnerConfig;
  private startTime: number = 0;

  constructor(config: RunnerConfig) {
    this.config = config;
    this.orchestrator = new TestAutomationOrchestrator(config.testDir, config.logDir);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.orchestrator.on('testStarted', (test) => {
      console.log(`🚀 Test started: ${test.configurationName}`);
    });

    this.orchestrator.on('testCompleted', (test) => {
      const status = test.status === 'passed' ? '✅' : '❌';
      const duration = (test.duration / 1000).toFixed(2);
      console.log(`${status} Test completed: ${test.configurationName} (${duration}s, ${test.successfulFlows}/${test.totalFlows} flows passed)`);
      
      if (test.recommendations.length > 0) {
        console.log('💡 Recommendations:');
        test.recommendations.forEach(rec => console.log(`  • ${rec}`));
      }
    });

    this.orchestrator.on('flowCompleted', (flow) => {
      if (this.config.verbose) {
        console.log(`  ✅ Flow: ${flow.name} (${flow.totalDuration?.toFixed(2)}ms)`);
      }
    });

    this.orchestrator.on('flowFailed', ({ flow, error }) => {
      console.log(`  ❌ Flow failed: ${flow.name} - ${error?.message || 'Unknown error'}`);
    });

    this.orchestrator.on('verificationFailed', (verification) => {
      const errorResults = verification.results.filter(r => r.severity === 'error' && !r.success);
      if (errorResults.length > 0) {
        console.log(`  🚨 Verification issues in ${verification.messageId}:`);
        errorResults.forEach(result => {
          console.log(`    • ${result.message}`);
        });
      }
    });

    this.orchestrator.on('interaction', (interaction) => {
      if (this.config.verbose && interaction.type === 'error') {
        console.log(`  ⚠️ ${interaction.component}: ${interaction.error}`);
      }
    });
  }

  async run(): Promise<void> {
    this.startTime = Date.now();
    
    console.log('🧪 CCTelegram Bridge Comprehensive Test Suite');
    console.log('=' .repeat(60));
    console.log(`Test Directory: ${this.config.testDir}`);
    console.log(`Log Directory: ${this.config.logDir}`);
    console.log(`Configurations: ${this.config.configurations.join(', ')}`);
    console.log(`Parallel: ${this.config.parallel}`);
    console.log('');

    try {
      // Ensure directories exist
      await fs.mkdir(this.config.logDir, { recursive: true });
      
      // Filter configurations to run
      const configurationsToRun = defaultTestConfigurations.filter(config => 
        this.config.configurations.length === 0 || 
        this.config.configurations.includes(config.name)
      );

      if (configurationsToRun.length === 0) {
        throw new Error(`No matching configurations found. Available: ${defaultTestConfigurations.map(c => c.name).join(', ')}`);
      }

      console.log(`📋 Running ${configurationsToRun.length} test configuration(s):`);
      configurationsToRun.forEach((config, index) => {
        console.log(`  ${index + 1}. ${config.name} - ${config.description}`);
      });
      console.log('');

      // Create and register test suite
      const testSuite = {
        id: 'comprehensive-test-suite',
        name: 'CCTelegram Comprehensive Test Suite',
        description: 'Complete automated testing of CCTelegram bridge functionality and data accuracy',
        configurations: configurationsToRun,
        
        globalSetup: async () => {
          console.log('🛠️ Global Setup: Preparing test environment...');
          
          // Verify bridge executable exists
          const bridgeExists = await this.verifyBridgeExecutable();
          if (!bridgeExists) {
            throw new Error('Bridge executable not found. Run "cargo build --release" first.');
          }
          
          // Verify MCP server exists
          const mcpExists = await this.verifyMcpServer();
          if (!mcpExists) {
            console.warn('⚠️ MCP server not found. Some tests may fail.');
          }
          
          // Create TaskMaster test data if needed
          await this.setupTaskMasterTestData();
          
          console.log('✅ Global setup completed');
        },
        
        globalTeardown: async () => {
          console.log('🧹 Global Teardown: Cleaning up...');
          
          // Clean up any remaining processes
          await this.killStrayProcesses();
          
          console.log('✅ Global teardown completed');
        }
      };

      this.orchestrator.registerTestSuite(testSuite);

      // Run the test suite
      const results = await this.orchestrator.runTestSuite(testSuite.id);

      // Generate final report
      if (this.config.generateReport) {
        await this.generateFinalReport(results);
      }

      // Print summary
      await this.printSummary(results);

    } catch (error) {
      console.error('❌ Test runner failed:', error.message);
      if (this.config.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    } finally {
      // Always cleanup
      if (this.config.cleanup) {
        await this.orchestrator.shutdown();
      }
    }
  }

  private async verifyBridgeExecutable(): Promise<boolean> {
    try {
      // Check if target/release directory exists
      const releaseDir = path.join(this.config.testDir, 'target', 'release');
      const stats = await fs.stat(releaseDir);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  private async verifyMcpServer(): Promise<boolean> {
    try {
      const mcpDir = path.join(this.config.testDir, 'mcp-server');
      const packageJson = path.join(mcpDir, 'package.json');
      await fs.access(packageJson);
      return true;
    } catch (error) {
      return false;
    }
  }

  private async setupTaskMasterTestData(): Promise<void> {
    // Check if TaskMaster is initialized
    const taskMasterPath = path.join(this.config.testDir, '.taskmaster');
    
    try {
      await fs.access(taskMasterPath);
      console.log('✅ TaskMaster found - using existing data for tests');
    } catch (error) {
      console.log('⚠️ TaskMaster not found - tests will use fallback data');
    }
  }

  private async killStrayProcesses(): Promise<void> {
    // Kill any processes that might be using our test ports
    const testPorts = [8080, 8081, 8082, 8083, 3000];
    
    for (const port of testPorts) {
      try {
        const { spawn } = await import('child_process');
        spawn('pkill', ['-f', `.*:${port}`], { stdio: 'ignore' });
      } catch (error) {
        // Ignore errors - processes might not exist
      }
    }
  }

  private async generateFinalReport(results: any[]): Promise<void> {
    const reportPath = path.join(this.config.logDir, `final-test-report-${Date.now()}.json`);
    
    const report = {
      timestamp: new Date().toISOString(),
      testDuration: Date.now() - this.startTime,
      configuration: this.config,
      results,
      summary: {
        totalTests: results.length,
        passedTests: results.filter(r => r.status === 'passed').length,
        failedTests: results.filter(r => r.status === 'failed').length,
        errorTests: results.filter(r => r.status === 'error').length,
        overallSuccess: results.every(r => r.status === 'passed'),
        criticalDataIssues: results.some(r => r.dataQualityIssues.staleDataDetections > 0),
        performanceIssues: results.some(r => r.averageResponseTime > 5000)
      }
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`📊 Final report generated: ${reportPath}`);
  }

  private async printSummary(results: any[]): Promise<void> {
    const totalDuration = (Date.now() - this.startTime) / 1000;
    
    console.log('');
    console.log('🎯 TEST EXECUTION SUMMARY');
    console.log('=' .repeat(40));
    console.log(`Total Duration: ${totalDuration.toFixed(2)}s`);
    console.log(`Configurations Run: ${results.length}`);
    
    const passedTests = results.filter(r => r.status === 'passed').length;
    const failedTests = results.filter(r => r.status === 'failed').length;
    const errorTests = results.filter(r => r.status === 'error').length;
    
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log(`💥 Errors: ${errorTests}`);
    
    const successRate = results.length > 0 ? (passedTests / results.length) * 100 : 0;
    console.log(`📊 Success Rate: ${successRate.toFixed(1)}%`);
    
    // Critical issues summary
    const criticalIssues = results.reduce((sum, r) => sum + r.criticalIssues.length, 0);
    const staleDataDetections = results.reduce((sum, r) => sum + (r.dataQualityIssues.staleDataDetections || 0), 0);
    
    console.log('');
    console.log('🚨 CRITICAL FINDINGS');
    console.log('-' .repeat(25));
    
    if (staleDataDetections > 0) {
      console.log(`❌ STALE DATA DETECTED: ${staleDataDetections} instances`);
      console.log('   🔧 ACTION REQUIRED: TaskMaster integration is returning old data');
      console.log('   📋 RECOMMENDATION: Check MCP server connection and TaskMaster file access');
    } else {
      console.log('✅ No stale data issues detected');
    }
    
    if (criticalIssues > 0) {
      console.log(`⚠️ OTHER CRITICAL ISSUES: ${criticalIssues} found`);
      console.log('   📋 RECOMMENDATION: Review verification reports for details');
    } else {
      console.log('✅ No other critical issues found');
    }
    
    // Performance summary
    const avgResponseTimes = results.map(r => r.averageResponseTime).filter(t => t > 0);
    if (avgResponseTimes.length > 0) {
      const overallAvgResponse = avgResponseTimes.reduce((a, b) => a + b, 0) / avgResponseTimes.length;
      console.log('');
      console.log('⚡ PERFORMANCE SUMMARY');
      console.log('-' .repeat(25));
      console.log(`Average Response Time: ${overallAvgResponse.toFixed(2)}ms`);
      
      if (overallAvgResponse > 3000) {
        console.log('⚠️ Performance issues detected - responses taking >3s');
      } else {
        console.log('✅ Response times within acceptable limits');
      }
    }
    
    // Final verdict
    console.log('');
    if (successRate >= 80 && staleDataDetections === 0) {
      console.log('🎉 OVERALL VERDICT: SYSTEM HEALTHY ✅');
    } else if (staleDataDetections > 0) {
      console.log('🚨 OVERALL VERDICT: CRITICAL ISSUES DETECTED ❌');
      console.log('   🔧 Immediate action required to resolve data staleness');
    } else {
      console.log('⚠️ OVERALL VERDICT: ISSUES DETECTED ⚠️');
      console.log('   📋 Review recommendations and address failing tests');
    }
    
    console.log('');
    console.log(`📂 Detailed logs and reports available in: ${this.config.logDir}`);
  }
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  const config: RunnerConfig = {
    testDir: process.cwd(),
    logDir: path.join(process.cwd(), 'tests', 'emulation', 'logs'),
    configurations: [],
    parallel: false,
    generateReport: true,
    cleanup: true,
    verbose: false
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        printUsage();
        return;
        
      case '--config':
      case '-c':
        if (args[i + 1]) {
          config.configurations = args[i + 1].split(',').map(s => s.trim());
          i++;
        }
        break;
        
      case '--test-dir':
        if (args[i + 1]) {
          config.testDir = path.resolve(args[i + 1]);
          i++;
        }
        break;
        
      case '--log-dir':
        if (args[i + 1]) {
          config.logDir = path.resolve(args[i + 1]);
          i++;
        }
        break;
        
      case '--parallel':
        config.parallel = true;
        break;
        
      case '--no-report':
        config.generateReport = false;
        break;
        
      case '--no-cleanup':
        config.cleanup = false;
        break;
        
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
        
      case '--list-configs':
        console.log('Available test configurations:');
        defaultTestConfigurations.forEach((config, index) => {
          console.log(`  ${index + 1}. ${config.name} - ${config.description}`);
        });
        return;
        
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  // Run tests
  const runner = new ComprehensiveTestRunner(config);
  await runner.run();
}

function printUsage(): void {
  console.log(`
🧪 CCTelegram Comprehensive Test Runner

Usage: tsx run-comprehensive-tests.ts [options]

Options:
  -h, --help                 Show this help message
  -c, --config <names>       Comma-separated list of configuration names to run
  --test-dir <path>          Test directory (default: current directory)
  --log-dir <path>           Log output directory (default: ./tests/emulation/logs)
  --parallel                 Run configurations in parallel
  --no-report                Skip generating final report
  --no-cleanup               Skip cleanup after tests
  -v, --verbose              Verbose output
  --list-configs             List available test configurations

Examples:
  tsx run-comprehensive-tests.ts
  tsx run-comprehensive-tests.ts --config "Data Staleness Detection"
  tsx run-comprehensive-tests.ts --verbose --no-cleanup
  tsx run-comprehensive-tests.ts --parallel --config "Basic Functionality Test,Performance Stress Test"

Available Configurations:
  • Basic Functionality Test - Tests basic command responses and data accuracy
  • Data Staleness Detection - Focused test for detecting stale data issues
  • Performance Stress Test - Tests system performance under load
`);
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n🛑 Test execution interrupted');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Test execution terminated');
  process.exit(143);
});

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}
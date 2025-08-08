/**
 * Test Automation Orchestrator
 * Coordinates all testing components and provides unified test execution
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { performance } from 'perf_hooks';

import { TelegramBotApiEmulator } from './telegram-bot-api-emulator.js';
import { MessageFlowSimulator } from './message-flow-simulator.js';
import { ResponseVerificationEngine } from './response-verification-engine.js';

export interface TestConfiguration {
  name: string;
  description: string;
  
  // Component configuration
  telegramEmulator: {
    port: number;
    rateLimitConfig?: any;
    responseDelay?: number;
    simulateFailures?: boolean;
    failureRate?: number;
  };
  
  bridge: {
    executable: string;
    configFile?: string;
    env?: Record<string, string>;
    webhookUrl?: string;
    startupTimeout: number;
    healthCheckInterval: number;
  };
  
  mcp: {
    serverPath: string;
    port?: number;
    startupTimeout: number;
  };
  
  // Test execution configuration
  scenarios: string[];
  verificationRules?: string[];
  expectedData?: any;
  
  // Execution options
  parallel: boolean;
  repeatCount: number;
  loadTest?: {
    concurrentUsers: number;
    duration: number;
    rampUpTime: number;
  };
  
  timeoutMs: number;
  cleanup: boolean;
}

export interface TestResult {
  testId: string;
  configurationName: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: 'passed' | 'failed' | 'timeout' | 'error';
  
  // Component results
  flowResults: any[];
  verificationResults: any;
  emulatorLogs: any[];
  
  // Summary
  totalFlows: number;
  successfulFlows: number;
  failedFlows: number;
  criticalIssues: any[];
  dataQualityIssues: any;
  
  // Performance
  averageResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  throughput: number;
  
  error?: string;
  recommendations: string[];
}

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  configurations: TestConfiguration[];
  globalSetup?: () => Promise<void>;
  globalTeardown?: () => Promise<void>;
}

export class TestAutomationOrchestrator extends EventEmitter {
  private testDir: string;
  private logDir: string;
  
  // Components
  private telegramEmulator: TelegramBotApiEmulator | null = null;
  private flowSimulator: MessageFlowSimulator | null = null;
  private verificationEngine: ResponseVerificationEngine | null = null;
  
  // Process management
  private bridgeProcess: ChildProcess | null = null;
  private mcpProcess: ChildProcess | null = null;
  
  // State tracking
  private currentTest: TestResult | null = null;
  private activeComponents: Set<string> = new Set();
  private shutdownInProgress = false;
  
  // Test suites
  private testSuites: Map<string, TestSuite> = new Map();
  
  constructor(testDir: string, logDir: string) {
    super();
    this.testDir = testDir;
    this.logDir = logDir;
  }

  // Test suite management
  registerTestSuite(suite: TestSuite): void {
    this.testSuites.set(suite.id, suite);
    console.log(`✓ Registered test suite: ${suite.name} (${suite.configurations.length} configurations)`);
  }

  getTestSuite(suiteId: string): TestSuite | undefined {
    return this.testSuites.get(suiteId);
  }

  getAllTestSuites(): TestSuite[] {
    return Array.from(this.testSuites.values());
  }

  // Component initialization
  private async initializeComponents(config: TestConfiguration): Promise<void> {
    console.log('🚀 Initializing test components...');
    
    // Ensure directories exist
    await fs.mkdir(this.logDir, { recursive: true });
    await fs.mkdir(path.join(this.logDir, 'emulator'), { recursive: true });
    await fs.mkdir(path.join(this.logDir, 'flows'), { recursive: true });
    await fs.mkdir(path.join(this.logDir, 'verification'), { recursive: true });

    // Initialize Telegram Bot API Emulator
    console.log('📱 Starting Telegram Bot API Emulator...');
    this.telegramEmulator = new TelegramBotApiEmulator(
      config.telegramEmulator.port,
      path.join(this.logDir, 'emulator')
    );
    
    if (config.telegramEmulator.rateLimitConfig) {
      this.telegramEmulator.setRateLimitConfig(config.telegramEmulator.rateLimitConfig);
    }
    
    if (config.telegramEmulator.responseDelay) {
      this.telegramEmulator.setResponseDelay(config.telegramEmulator.responseDelay);
    }
    
    if (config.telegramEmulator.simulateFailures) {
      this.telegramEmulator.enableFailureSimulation(
        true, 
        config.telegramEmulator.failureRate || 0.1
      );
    }
    
    await this.telegramEmulator.start();
    this.activeComponents.add('telegram-emulator');

    // Initialize Message Flow Simulator
    console.log('🌊 Starting Message Flow Simulator...');
    this.flowSimulator = new MessageFlowSimulator(path.join(this.logDir, 'flows'));
    this.flowSimulator.setTelegramEmulator(this.telegramEmulator);
    this.activeComponents.add('flow-simulator');

    // Initialize Response Verification Engine
    console.log('🔍 Starting Response Verification Engine...');
    this.verificationEngine = new ResponseVerificationEngine(path.join(this.logDir, 'verification'));
    
    if (config.expectedData) {
      this.verificationEngine.setExpectedTaskData(config.expectedData);
    }
    
    if (config.verificationRules) {
      // Enable only specified rules
      for (const rule of this.verificationEngine.getAllRules()) {
        if (config.verificationRules.includes(rule.id)) {
          this.verificationEngine.enableRule(rule.id);
        } else {
          this.verificationEngine.disableRule(rule.id);
        }
      }
    }
    
    this.activeComponents.add('verification-engine');

    // Set up component interactions
    this.setupComponentIntegration();

    console.log('✅ All test components initialized');
  }

  private setupComponentIntegration(): void {
    if (!this.telegramEmulator || !this.flowSimulator || !this.verificationEngine) {
      return;
    }

    // Connect emulator to verification engine
    this.telegramEmulator.on('messageSent', async (message) => {
      if (message.text) {
        await this.verificationEngine!.verifyMessage(
          message.message_id.toString(),
          message.text,
          'command_response',
          { messageId: message.message_id, chatId: message.chat.id }
        );
      }
    });

    // Forward events for monitoring
    this.telegramEmulator.on('interaction', (log) => {
      this.emit('interaction', { component: 'telegram-emulator', ...log });
    });

    this.flowSimulator.on('flowCompleted', (flow) => {
      this.emit('flowCompleted', flow);
    });

    this.flowSimulator.on('flowFailed', (data) => {
      this.emit('flowFailed', data);
    });

    this.verificationEngine.on('verificationFailed', (verification) => {
      this.emit('verificationFailed', verification);
    });
  }

  // Process management
  private async startBridgeProcess(config: TestConfiguration): Promise<void> {
    console.log('🌉 Starting CCTelegram Bridge...');

    // Set up environment
    const env = {
      ...process.env,
      ...(config.bridge.env || {}),
      RUST_LOG: 'debug',
      CC_TELEGRAM_EVENTS_DIR: path.join(this.logDir, 'events'),
      CC_TELEGRAM_RESPONSES_DIR: path.join(this.logDir, 'responses'),
      CC_TELEGRAM_BOT_API_URL: `http://localhost:${config.telegramEmulator.port}/bot`,
      CC_TELEGRAM_HEALTH_PORT: '8080'
    };

    // Ensure event and response directories exist
    await fs.mkdir(env.CC_TELEGRAM_EVENTS_DIR, { recursive: true });
    await fs.mkdir(env.CC_TELEGRAM_RESPONSES_DIR, { recursive: true });

    return new Promise((resolve, reject) => {
      const args = config.bridge.configFile ? [config.bridge.configFile] : [];
      
      this.bridgeProcess = spawn(config.bridge.executable, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.testDir
      });

      let startupTimeout: NodeJS.Timeout;
      let healthCheckInterval: NodeJS.Timeout;
      let bridgeReady = false;

      // Handle process output
      this.bridgeProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log(`[BRIDGE] ${output.trim()}`);
        
        // Check for startup indicators
        if (output.includes('Starting Telegram bot dispatcher') || 
            output.includes('Bridge operational')) {
          bridgeReady = true;
          clearTimeout(startupTimeout);
          clearInterval(healthCheckInterval);
          resolve();
        }
      });

      this.bridgeProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        console.error(`[BRIDGE ERROR] ${output.trim()}`);
      });

      this.bridgeProcess.on('error', (error) => {
        console.error('Bridge process error:', error);
        clearTimeout(startupTimeout);
        clearInterval(healthCheckInterval);
        reject(new Error(`Bridge process failed to start: ${error.message}`));
      });

      this.bridgeProcess.on('exit', (code, signal) => {
        console.log(`Bridge process exited with code ${code}, signal ${signal}`);
        this.bridgeProcess = null;
        
        if (!bridgeReady) {
          clearTimeout(startupTimeout);
          clearInterval(healthCheckInterval);
          reject(new Error(`Bridge process exited unexpectedly (code: ${code})`));
        }
      });

      // Set up webhook if configured
      if (config.bridge.webhookUrl) {
        setTimeout(async () => {
          try {
            await this.telegramEmulator!.setWebhook(config.bridge.webhookUrl!);
            console.log(`✓ Webhook configured: ${config.bridge.webhookUrl}`);
          } catch (error) {
            console.warn(`Failed to configure webhook: ${error}`);
          }
        }, 2000);
      }

      // Startup timeout
      startupTimeout = setTimeout(() => {
        if (!bridgeReady) {
          reject(new Error(`Bridge startup timeout after ${config.bridge.startupTimeout}ms`));
        }
      }, config.bridge.startupTimeout);

      // Health check interval
      let healthCheckCount = 0;
      healthCheckInterval = setInterval(async () => {
        healthCheckCount++;
        
        try {
          const response = await fetch('http://localhost:8080/health');
          if (response.ok && !bridgeReady) {
            bridgeReady = true;
            clearTimeout(startupTimeout);
            clearInterval(healthCheckInterval);
            resolve();
          }
        } catch (error) {
          // Health check failed, continue waiting
          if (healthCheckCount > 20) { // 20 * 500ms = 10 seconds
            clearTimeout(startupTimeout);
            clearInterval(healthCheckInterval);
            reject(new Error('Bridge health check timeout'));
          }
        }
      }, config.bridge.healthCheckInterval);
    });
  }

  private async startMcpProcess(config: TestConfiguration): Promise<void> {
    console.log('🔗 Starting MCP Server...');

    const env = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: config.mcp.port?.toString() || '3000'
    };

    return new Promise((resolve, reject) => {
      this.mcpProcess = spawn('npm', ['start'], {
        cwd: config.mcp.serverPath,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let mcpReady = false;
      const startupTimeout = setTimeout(() => {
        if (!mcpReady) {
          reject(new Error(`MCP startup timeout after ${config.mcp.startupTimeout}ms`));
        }
      }, config.mcp.startupTimeout);

      this.mcpProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log(`[MCP] ${output.trim()}`);
        
        if (output.includes('Server listening') || output.includes('MCP server started')) {
          mcpReady = true;
          clearTimeout(startupTimeout);
          resolve();
        }
      });

      this.mcpProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        console.error(`[MCP ERROR] ${output.trim()}`);
      });

      this.mcpProcess.on('error', (error) => {
        clearTimeout(startupTimeout);
        reject(new Error(`MCP process failed to start: ${error.message}`));
      });

      this.mcpProcess.on('exit', (code, signal) => {
        console.log(`MCP process exited with code ${code}, signal ${signal}`);
        this.mcpProcess = null;
        
        if (!mcpReady) {
          clearTimeout(startupTimeout);
          reject(new Error(`MCP process exited unexpectedly (code: ${code})`));
        }
      });
    });
  }

  // Test execution
  async runTestConfiguration(config: TestConfiguration): Promise<TestResult> {
    const testId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = performance.now();

    this.currentTest = {
      testId,
      configurationName: config.name,
      startTime,
      endTime: 0,
      duration: 0,
      status: 'failed',
      flowResults: [],
      verificationResults: null,
      emulatorLogs: [],
      totalFlows: 0,
      successfulFlows: 0,
      failedFlows: 0,
      criticalIssues: [],
      dataQualityIssues: {},
      averageResponseTime: 0,
      maxResponseTime: 0,
      minResponseTime: 0,
      throughput: 0,
      recommendations: []
    };

    console.log(`🚀 Starting test: ${config.name} (${testId})`);
    this.emit('testStarted', this.currentTest);

    try {
      // Initialize all components
      await this.initializeComponents(config);

      // Start external processes
      await this.startBridgeProcess(config);
      this.activeComponents.add('bridge-process');

      if (config.mcp.serverPath) {
        await this.startMcpProcess(config);
        this.activeComponents.add('mcp-process');
      }

      // Wait for system to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Execute test scenarios
      if (config.loadTest) {
        console.log(`📊 Running load test: ${config.loadTest.concurrentUsers} users for ${config.loadTest.duration}s`);
        
        if (config.scenarios.length === 0) {
          throw new Error('Load test requires at least one scenario');
        }
        
        this.currentTest.flowResults = await this.flowSimulator!.executeLoadTest(
          config.scenarios[0], // Use first scenario for load test
          config.loadTest
        );
      } else {
        console.log(`🎯 Running ${config.scenarios.length} scenarios (${config.parallel ? 'parallel' : 'sequential'})`);
        
        this.currentTest.flowResults = await this.flowSimulator!.executeMultipleScenarios(
          config.scenarios,
          {
            parallel: config.parallel,
            repeatCount: config.repeatCount,
            delayBetweenRuns: 1000
          }
        );
      }

      // Generate verification report
      this.currentTest.verificationResults = await this.verificationEngine!.generateReport();

      // Get emulator logs
      this.currentTest.emulatorLogs = this.telegramEmulator!.getInteractionLogs();

      // Calculate metrics
      this.calculateTestMetrics(this.currentTest);

      // Generate recommendations
      this.generateRecommendations(this.currentTest);

      // Determine overall status
      this.currentTest.status = this.determineTestStatus(this.currentTest);

      console.log(`✅ Test completed: ${config.name} (${this.currentTest.status})`);

    } catch (error) {
      this.currentTest.error = error.message;
      this.currentTest.status = 'error';
      console.error(`❌ Test failed: ${config.name} - ${error.message}`);
      
    } finally {
      // Cleanup if requested
      if (config.cleanup) {
        await this.cleanup();
      }

      this.currentTest.endTime = performance.now();
      this.currentTest.duration = this.currentTest.endTime - this.currentTest.startTime;

      this.emit('testCompleted', this.currentTest);
    }

    return this.currentTest;
  }

  async runTestSuite(suiteId: string): Promise<TestResult[]> {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    console.log(`🧪 Running test suite: ${suite.name} (${suite.configurations.length} configurations)`);

    const results: TestResult[] = [];

    try {
      // Run global setup if defined
      if (suite.globalSetup) {
        console.log('🛠️ Running global setup...');
        await suite.globalSetup();
      }

      // Run each configuration
      for (let i = 0; i < suite.configurations.length; i++) {
        const config = suite.configurations[i];
        console.log(`📋 Running configuration ${i + 1}/${suite.configurations.length}: ${config.name}`);
        
        try {
          const result = await this.runTestConfiguration(config);
          results.push(result);
          
          // Brief pause between configurations
          if (i < suite.configurations.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error(`Configuration ${config.name} failed:`, error.message);
        }
      }

      // Run global teardown if defined
      if (suite.globalTeardown) {
        console.log('🧹 Running global teardown...');
        await suite.globalTeardown();
      }

    } catch (error) {
      console.error(`Test suite ${suite.name} failed:`, error.message);
    }

    // Generate suite summary
    await this.generateSuiteSummary(suite, results);

    console.log(`🎯 Test suite completed: ${suite.name} (${results.length} results)`);
    return results;
  }

  // Metrics and analysis
  private calculateTestMetrics(result: TestResult): void {
    const flows = result.flowResults;
    
    result.totalFlows = flows.length;
    result.successfulFlows = flows.filter(f => f.status === 'completed').length;
    result.failedFlows = flows.filter(f => f.status === 'failed' || f.status === 'timeout').length;

    if (flows.length > 0) {
      const durations = flows.map(f => f.totalDuration || 0);
      result.averageResponseTime = durations.reduce((a, b) => a + b, 0) / durations.length;
      result.maxResponseTime = Math.max(...durations);
      result.minResponseTime = Math.min(...durations);
      result.throughput = (flows.length / (result.duration / 1000)); // flows per second
    }

    // Extract critical issues from verification results
    if (result.verificationResults) {
      result.criticalIssues = result.verificationResults.criticalIssues || [];
      result.dataQualityIssues = result.verificationResults.dataQualityIssues || {};
    }
  }

  private generateRecommendations(result: TestResult): void {
    const recommendations: string[] = [];

    // Performance recommendations
    if (result.averageResponseTime > 3000) {
      recommendations.push('High response times detected - investigate bridge and MCP performance');
    }

    // Success rate recommendations
    const successRate = result.totalFlows > 0 ? (result.successfulFlows / result.totalFlows) * 100 : 0;
    if (successRate < 80) {
      recommendations.push('Low flow success rate - investigate system stability and error handling');
    }

    // Data quality recommendations
    if (result.dataQualityIssues.staleDataDetections > 0) {
      recommendations.push('CRITICAL: Stale data detected - TaskMaster integration requires immediate investigation');
    }

    if (result.dataQualityIssues.progressBarInaccuracies > 0) {
      recommendations.push('Progress bar calculation issues detected - verify task counting logic');
    }

    // Critical issue recommendations
    if (result.criticalIssues.length > 0) {
      recommendations.push(`${result.criticalIssues.length} critical issues found - review verification report for details`);
    }

    // General recommendations
    if (result.status === 'failed') {
      recommendations.push('Test execution failed - check logs and component startup sequences');
    }

    if (recommendations.length === 0) {
      recommendations.push('All systems functioning within expected parameters');
    }

    result.recommendations = recommendations;
  }

  private determineTestStatus(result: TestResult): 'passed' | 'failed' | 'timeout' | 'error' {
    if (result.error) {
      return 'error';
    }

    const successRate = result.totalFlows > 0 ? (result.successfulFlows / result.totalFlows) * 100 : 0;
    const hasCriticalDataIssues = result.dataQualityIssues.staleDataDetections > 0;
    const hasCriticalErrors = result.criticalIssues.length > 0;

    if (successRate >= 80 && !hasCriticalDataIssues && !hasCriticalErrors) {
      return 'passed';
    } else {
      return 'failed';
    }
  }

  // Reporting
  async generateSuiteSummary(suite: TestSuite, results: TestResult[]): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const summaryPath = path.join(this.logDir, `test-suite-summary-${suite.id}-${timestamp}.json`);

    const totalTests = results.length;
    const passedTests = results.filter(r => r.status === 'passed').length;
    const failedTests = results.filter(r => r.status === 'failed').length;
    const errorTests = results.filter(r => r.status === 'error').length;

    const summary = {
      suiteId: suite.id,
      suiteName: suite.name,
      timestamp: new Date().toISOString(),
      totalTests,
      passedTests,
      failedTests,
      errorTests,
      successRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      results,
      overallRecommendations: this.generateSuiteRecommendations(results)
    };

    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`📊 Suite summary exported to ${summaryPath}`);
  }

  private generateSuiteRecommendations(results: TestResult[]): string[] {
    const recommendations: string[] = [];
    
    const passedTests = results.filter(r => r.status === 'passed').length;
    const totalTests = results.length;
    const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

    if (successRate < 50) {
      recommendations.push('CRITICAL: Less than 50% of tests passed - system requires immediate attention');
    } else if (successRate < 80) {
      recommendations.push('WARNING: Test success rate below 80% - investigate failing scenarios');
    }

    const hasStaleDataIssues = results.some(r => r.dataQualityIssues.staleDataDetections > 0);
    if (hasStaleDataIssues) {
      recommendations.push('URGENT: Stale data issues detected across multiple tests - TaskMaster integration broken');
    }

    const avgResponseTime = results.reduce((sum, r) => sum + r.averageResponseTime, 0) / results.length;
    if (avgResponseTime > 5000) {
      recommendations.push('Performance degradation detected - investigate system bottlenecks');
    }

    return recommendations;
  }

  // Cleanup and shutdown
  async cleanup(): Promise<void> {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;

    console.log('🧹 Cleaning up test environment...');

    // Stop components in reverse order
    const stopPromises: Promise<void>[] = [];

    if (this.activeComponents.has('bridge-process') && this.bridgeProcess) {
      stopPromises.push(this.stopBridgeProcess());
    }

    if (this.activeComponents.has('mcp-process') && this.mcpProcess) {
      stopPromises.push(this.stopMcpProcess());
    }

    if (this.activeComponents.has('verification-engine') && this.verificationEngine) {
      stopPromises.push(this.verificationEngine.shutdown());
    }

    if (this.activeComponents.has('flow-simulator') && this.flowSimulator) {
      stopPromises.push(this.flowSimulator.shutdown());
    }

    if (this.activeComponents.has('telegram-emulator') && this.telegramEmulator) {
      stopPromises.push(this.telegramEmulator.stop());
    }

    await Promise.allSettled(stopPromises);

    this.activeComponents.clear();
    this.shutdownInProgress = false;

    console.log('✅ Test environment cleanup completed');
  }

  private async stopBridgeProcess(): Promise<void> {
    if (!this.bridgeProcess) return;

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        this.bridgeProcess = null;
        resolve();
      };

      this.bridgeProcess!.on('exit', cleanup);
      
      // Try graceful shutdown first
      this.bridgeProcess!.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.bridgeProcess && !this.bridgeProcess.killed) {
          this.bridgeProcess.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  private async stopMcpProcess(): Promise<void> {
    if (!this.mcpProcess) return;

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        this.mcpProcess = null;
        resolve();
      };

      this.mcpProcess!.on('exit', cleanup);
      
      this.mcpProcess!.kill('SIGTERM');
      
      setTimeout(() => {
        if (this.mcpProcess && !this.mcpProcess.killed) {
          this.mcpProcess.kill('SIGKILL');
        }
      }, 3000);
    });
  }

  async shutdown(): Promise<void> {
    await this.cleanup();
    console.log('✓ Test Automation Orchestrator shut down');
  }
}

// Export default test configurations
export const defaultTestConfigurations: TestConfiguration[] = [
  {
    name: 'Basic Functionality Test',
    description: 'Tests basic command responses and data accuracy',
    
    telegramEmulator: {
      port: 8081,
      responseDelay: 100
    },
    
    bridge: {
      executable: 'cargo run --release',
      startupTimeout: 30000,
      healthCheckInterval: 500,
      webhookUrl: 'http://localhost:8081/webhook'
    },
    
    mcp: {
      serverPath: './mcp-server',
      startupTimeout: 20000
    },
    
    scenarios: [
      'tasks-command-basic',
      'todo-command-basic',
      'bridge-status-basic',
      'start-command-basic',
      'data-staleness-detection'
    ],
    
    parallel: false,
    repeatCount: 1,
    timeoutMs: 60000,
    cleanup: true
  },
  
  {
    name: 'Data Staleness Detection',
    description: 'Focused test for detecting stale data issues',
    
    telegramEmulator: {
      port: 8082,
      responseDelay: 50
    },
    
    bridge: {
      executable: 'cargo run --release',
      startupTimeout: 30000,
      healthCheckInterval: 500,
      webhookUrl: 'http://localhost:8082/webhook'
    },
    
    mcp: {
      serverPath: './mcp-server',
      startupTimeout: 20000
    },
    
    scenarios: ['data-staleness-detection'],
    verificationRules: ['stale-data-detection', 'task-count-consistency', 'progress-bar-present'],
    
    expectedData: {
      // This should be updated with current live data
      completed: 25, // Replace with actual current completed count
      total: 30,     // Replace with actual current total count
      pending: 3,    // Replace with actual current pending count
      inProgress: 2  // Replace with actual current in-progress count
    },
    
    parallel: false,
    repeatCount: 3,
    timeoutMs: 30000,
    cleanup: true
  },
  
  {
    name: 'Performance Stress Test',
    description: 'Tests system performance under load',
    
    telegramEmulator: {
      port: 8083,
      responseDelay: 0,
      simulateFailures: true,
      failureRate: 0.05 // 5% failure rate
    },
    
    bridge: {
      executable: 'cargo run --release',
      startupTimeout: 30000,
      healthCheckInterval: 1000,
      webhookUrl: 'http://localhost:8083/webhook'
    },
    
    mcp: {
      serverPath: './mcp-server',
      startupTimeout: 20000
    },
    
    scenarios: ['tasks-command-basic', 'todo-command-basic'],
    
    loadTest: {
      concurrentUsers: 5,
      duration: 30, // 30 seconds
      rampUpTime: 10 // 10 seconds ramp up
    },
    
    parallel: true,
    repeatCount: 1,
    timeoutMs: 120000,
    cleanup: true
  }
];
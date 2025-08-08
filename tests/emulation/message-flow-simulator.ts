/**
 * Message Flow Simulation Engine
 * Simulates complete message flows and analyzes timing and performance
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { promises as fs } from 'fs';
import path from 'path';

export interface FlowStep {
  id: string;
  name: string;
  type: 'user_action' | 'webhook_call' | 'mcp_query' | 'bridge_response' | 'telegram_response' | 'validation';
  timestamp: number;
  duration?: number;
  data?: any;
  error?: string;
  success?: boolean;
}

export interface MessageFlow {
  id: string;
  name: string;
  description: string;
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  steps: FlowStep[];
  status: 'running' | 'completed' | 'failed' | 'timeout';
  expectedSteps: number;
  actualSteps: number;
  errors: string[];
  metadata?: any;
}

export interface FlowScenario {
  id: string;
  name: string;
  description: string;
  command: string;
  expectedResponsePattern: RegExp | string;
  expectedSteps: number;
  timeoutMs: number;
  setupActions?: (() => Promise<void>)[];
  validationChecks?: ((flow: MessageFlow) => Promise<boolean>)[];
  parallel?: boolean;
  repeatCount?: number;
}

export interface FlowMetrics {
  totalFlows: number;
  completedFlows: number;
  failedFlows: number;
  timeoutFlows: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  successRate: number;
  stepSuccessRates: Map<string, number>;
  errorDistribution: Map<string, number>;
}

export class MessageFlowSimulator extends EventEmitter {
  private flows: Map<string, MessageFlow> = new Map();
  private activeFlows: Set<string> = new Set();
  private scenarios: Map<string, FlowScenario> = new Map();
  private logDir: string;
  
  // External components
  private telegramEmulator: any;
  private bridgeProcess: any;
  private mcpClient: any;
  
  // Configuration
  private defaultTimeout = 30000; // 30 seconds
  private maxConcurrentFlows = 10;
  private metricCollectionInterval = 1000; // 1 second
  private metricsTimer: NodeJS.Timeout | null = null;

  constructor(logDir: string) {
    super();
    this.logDir = logDir;
    this.setupDefaultScenarios();
    this.startMetricsCollection();
  }

  // Component registration
  setTelegramEmulator(emulator: any): void {
    this.telegramEmulator = emulator;
    
    // Listen for relevant events
    emulator.on('messageSent', (message: any) => this.handleTelegramMessage(message));
    emulator.on('webhookSent', (data: any) => this.handleWebhookSent(data));
    emulator.on('webhookError', (data: any) => this.handleWebhookError(data));
  }

  setBridgeProcess(bridge: any): void {
    this.bridgeProcess = bridge;
    // Set up bridge event monitoring if available
  }

  setMcpClient(client: any): void {
    this.mcpClient = client;
    // Set up MCP event monitoring if available
  }

  // Scenario management
  addScenario(scenario: FlowScenario): void {
    this.scenarios.set(scenario.id, scenario);
    console.log(`✓ Added flow scenario: ${scenario.name}`);
  }

  removeScenario(scenarioId: string): void {
    this.scenarios.delete(scenarioId);
  }

  getScenario(scenarioId: string): FlowScenario | undefined {
    return this.scenarios.get(scenarioId);
  }

  getAllScenarios(): FlowScenario[] {
    return Array.from(this.scenarios.values());
  }

  // Flow execution
  async executeScenario(scenarioId: string, metadata?: any): Promise<MessageFlow> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }

    // Check concurrency limits
    if (this.activeFlows.size >= this.maxConcurrentFlows) {
      throw new Error(`Maximum concurrent flows reached: ${this.maxConcurrentFlows}`);
    }

    const flowId = `${scenarioId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const flow: MessageFlow = {
      id: flowId,
      name: scenario.name,
      description: scenario.description,
      startTime: performance.now(),
      steps: [],
      status: 'running',
      expectedSteps: scenario.expectedSteps,
      actualSteps: 0,
      errors: [],
      metadata: metadata || {}
    };

    this.flows.set(flowId, flow);
    this.activeFlows.add(flowId);

    console.log(`🚀 Starting flow: ${flow.name} (${flowId})`);
    this.emit('flowStarted', flow);

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      this.handleFlowTimeout(flowId);
    }, scenario.timeoutMs || this.defaultTimeout);

    try {
      // Run setup actions if defined
      if (scenario.setupActions) {
        for (const setupAction of scenario.setupActions) {
          await setupAction();
        }
      }

      // Start the flow by simulating user action
      await this.initiateUserAction(flowId, scenario.command);

      // Wait for flow completion
      const result = await this.waitForFlowCompletion(flowId, scenario.timeoutMs || this.defaultTimeout);
      
      clearTimeout(timeoutHandle);
      
      // Run validation checks
      if (scenario.validationChecks) {
        for (const validationCheck of scenario.validationChecks) {
          const isValid = await validationCheck(result);
          this.addFlowStep(flowId, {
            id: `validation-${Date.now()}`,
            name: 'Validation Check',
            type: 'validation',
            timestamp: performance.now(),
            success: isValid,
            data: { validationResult: isValid }
          });
        }
      }

      return result;

    } catch (error) {
      clearTimeout(timeoutHandle);
      this.handleFlowError(flowId, error);
      throw error;
    }
  }

  async executeMultipleScenarios(scenarioIds: string[], options: {
    parallel?: boolean;
    repeatCount?: number;
    delayBetweenRuns?: number;
  } = {}): Promise<MessageFlow[]> {
    const results: MessageFlow[] = [];
    const { parallel = false, repeatCount = 1, delayBetweenRuns = 0 } = options;

    for (let run = 0; run < repeatCount; run++) {
      console.log(`📊 Running scenario batch ${run + 1}/${repeatCount}`);

      if (parallel) {
        // Execute all scenarios in parallel
        const promises = scenarioIds.map(id => 
          this.executeScenario(id, { run: run + 1, batchId: Date.now() })
        );
        
        const batchResults = await Promise.allSettled(promises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            console.error('Scenario execution failed:', result.reason);
          }
        }
      } else {
        // Execute scenarios sequentially
        for (const scenarioId of scenarioIds) {
          try {
            const result = await this.executeScenario(scenarioId, { run: run + 1 });
            results.push(result);
            
            if (delayBetweenRuns > 0 && scenarioId !== scenarioIds[scenarioIds.length - 1]) {
              await new Promise(resolve => setTimeout(resolve, delayBetweenRuns));
            }
          } catch (error) {
            console.error(`Scenario ${scenarioId} failed:`, error.message);
          }
        }
      }

      if (delayBetweenRuns > 0 && run < repeatCount - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenRuns));
      }
    }

    return results;
  }

  async executeLoadTest(scenarioId: string, options: {
    concurrentUsers: number;
    duration: number; // seconds
    rampUpTime: number; // seconds
  }): Promise<MessageFlow[]> {
    const { concurrentUsers, duration, rampUpTime } = options;
    const results: MessageFlow[] = [];
    const startTime = Date.now();
    const endTime = startTime + (duration * 1000);
    
    console.log(`🔄 Starting load test: ${concurrentUsers} concurrent users for ${duration}s`);

    // Ramp up users gradually
    const rampUpInterval = (rampUpTime * 1000) / concurrentUsers;
    const activePromises: Set<Promise<MessageFlow>> = new Set();

    const executeUser = async (userId: number): Promise<void> => {
      while (Date.now() < endTime) {
        try {
          const flowPromise = this.executeScenario(scenarioId, { 
            loadTest: true, 
            userId, 
            startTime: Date.now() 
          });
          
          activePromises.add(flowPromise);
          
          const result = await flowPromise;
          results.push(result);
          activePromises.delete(flowPromise);
          
          // Small delay between requests from same user
          await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        } catch (error) {
          console.error(`Load test user ${userId} error:`, error.message);
        }
      }
    };

    // Start users with ramp-up
    const userPromises: Promise<void>[] = [];
    for (let i = 0; i < concurrentUsers; i++) {
      setTimeout(() => {
        userPromises.push(executeUser(i + 1));
      }, i * rampUpInterval);
    }

    // Wait for all users to complete
    await Promise.allSettled(userPromises);
    
    // Wait for any remaining flows to complete
    if (activePromises.size > 0) {
      await Promise.allSettled(Array.from(activePromises));
    }

    console.log(`✅ Load test completed: ${results.length} flows executed`);
    return results;
  }

  // Flow management
  private async initiateUserAction(flowId: string, command: string): Promise<void> {
    if (!this.telegramEmulator) {
      throw new Error('Telegram emulator not configured');
    }

    const stepId = `user-action-${Date.now()}`;
    const startTime = performance.now();

    try {
      // Simulate user sending command
      await this.telegramEmulator.simulateUserMessage(123456789, command);
      
      this.addFlowStep(flowId, {
        id: stepId,
        name: 'User Action',
        type: 'user_action',
        timestamp: startTime,
        duration: performance.now() - startTime,
        success: true,
        data: { command }
      });

    } catch (error) {
      this.addFlowStep(flowId, {
        id: stepId,
        name: 'User Action',
        type: 'user_action',
        timestamp: startTime,
        duration: performance.now() - startTime,
        success: false,
        error: error.message,
        data: { command }
      });
      
      throw error;
    }
  }

  private async waitForFlowCompletion(flowId: string, timeoutMs: number): Promise<MessageFlow> {
    return new Promise((resolve, reject) => {
      const checkInterval = 100; // Check every 100ms
      const startTime = Date.now();

      const checkCompletion = () => {
        const flow = this.flows.get(flowId);
        if (!flow) {
          reject(new Error(`Flow not found: ${flowId}`));
          return;
        }

        if (flow.status === 'completed') {
          resolve(flow);
          return;
        }

        if (flow.status === 'failed') {
          reject(new Error(`Flow failed: ${flow.errors.join(', ')}`));
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          this.handleFlowTimeout(flowId);
          reject(new Error(`Flow timeout after ${timeoutMs}ms`));
          return;
        }

        // Check if we have expected number of steps (with some tolerance)
        if (flow.actualSteps >= flow.expectedSteps) {
          this.completeFlow(flowId);
          resolve(flow);
          return;
        }

        setTimeout(checkCompletion, checkInterval);
      };

      checkCompletion();
    });
  }

  private addFlowStep(flowId: string, step: FlowStep): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    flow.steps.push(step);
    flow.actualSteps = flow.steps.length;

    if (step.error) {
      flow.errors.push(step.error);
    }

    console.log(`📊 Flow ${flowId} step: ${step.name} (${step.success ? '✅' : '❌'})`);
    this.emit('flowStep', { flowId, step });
  }

  private completeFlow(flowId: string): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    flow.endTime = performance.now();
    flow.totalDuration = flow.endTime - flow.startTime;
    flow.status = flow.errors.length > 0 ? 'failed' : 'completed';
    
    this.activeFlows.delete(flowId);

    console.log(`🎯 Flow completed: ${flow.name} (${flow.totalDuration?.toFixed(2)}ms, ${flow.actualSteps} steps)`);
    this.emit('flowCompleted', flow);
  }

  private handleFlowTimeout(flowId: string): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    flow.endTime = performance.now();
    flow.totalDuration = flow.endTime - flow.startTime;
    flow.status = 'timeout';
    flow.errors.push('Flow timeout');
    
    this.activeFlows.delete(flowId);

    console.log(`⏰ Flow timeout: ${flow.name} (${flow.totalDuration?.toFixed(2)}ms)`);
    this.emit('flowTimeout', flow);
  }

  private handleFlowError(flowId: string, error: Error): void {
    const flow = this.flows.get(flowId);
    if (!flow) return;

    flow.endTime = performance.now();
    flow.totalDuration = flow.endTime - flow.startTime;
    flow.status = 'failed';
    flow.errors.push(error.message);
    
    this.activeFlows.delete(flowId);

    console.log(`❌ Flow failed: ${flow.name} - ${error.message}`);
    this.emit('flowFailed', { flow, error });
  }

  // Event handlers
  private handleTelegramMessage(message: any): void {
    // Find flows waiting for Telegram responses
    for (const [flowId, flow] of this.flows.entries()) {
      if (flow.status === 'running') {
        this.addFlowStep(flowId, {
          id: `telegram-message-${Date.now()}`,
          name: 'Telegram Message',
          type: 'telegram_response',
          timestamp: performance.now(),
          success: true,
          data: {
            messageId: message.message_id,
            text: message.text?.substring(0, 100),
            chatId: message.chat.id
          }
        });
      }
    }
  }

  private handleWebhookSent(data: any): void {
    // Find flows waiting for webhook calls
    for (const [flowId, flow] of this.flows.entries()) {
      if (flow.status === 'running') {
        this.addFlowStep(flowId, {
          id: `webhook-${Date.now()}`,
          name: 'Webhook Call',
          type: 'webhook_call',
          timestamp: performance.now(),
          duration: data.duration,
          success: data.response?.ok || false,
          data: {
            updateId: data.update?.update_id,
            responseStatus: data.response?.status,
            webhookUrl: data.update ? 'configured' : 'none'
          }
        });
      }
    }
  }

  private handleWebhookError(data: any): void {
    // Find flows that might be affected by webhook errors
    for (const [flowId, flow] of this.flows.entries()) {
      if (flow.status === 'running') {
        this.addFlowStep(flowId, {
          id: `webhook-error-${Date.now()}`,
          name: 'Webhook Error',
          type: 'webhook_call',
          timestamp: performance.now(),
          success: false,
          error: data.error?.message || 'Unknown webhook error',
          data: {
            updateId: data.update?.update_id
          }
        });
      }
    }
  }

  // Metrics and analysis
  calculateMetrics(): FlowMetrics {
    const completedFlows = Array.from(this.flows.values()).filter(f => f.endTime);
    const durations = completedFlows.map(f => f.totalDuration!);
    
    const stepSuccessRates = new Map<string, number>();
    const errorDistribution = new Map<string, number>();

    // Analyze step success rates
    for (const flow of completedFlows) {
      for (const step of flow.steps) {
        const current = stepSuccessRates.get(step.type) || { success: 0, total: 0 };
        current.total++;
        if (step.success !== false) current.success++;
        stepSuccessRates.set(step.type, current);
      }

      // Count errors
      for (const error of flow.errors) {
        const count = errorDistribution.get(error) || 0;
        errorDistribution.set(error, count + 1);
      }
    }

    // Convert to percentages
    const stepRates = new Map<string, number>();
    for (const [type, data] of stepSuccessRates) {
      stepRates.set(type, (data.success / data.total) * 100);
    }

    return {
      totalFlows: this.flows.size,
      completedFlows: completedFlows.filter(f => f.status === 'completed').length,
      failedFlows: completedFlows.filter(f => f.status === 'failed').length,
      timeoutFlows: completedFlows.filter(f => f.status === 'timeout').length,
      averageDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      minDuration: durations.length > 0 ? Math.min(...durations) : 0,
      maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
      successRate: completedFlows.length > 0 ? 
        (completedFlows.filter(f => f.status === 'completed').length / completedFlows.length) * 100 : 0,
      stepSuccessRates: stepRates,
      errorDistribution
    };
  }

  getFlow(flowId: string): MessageFlow | undefined {
    return this.flows.get(flowId);
  }

  getAllFlows(): MessageFlow[] {
    return Array.from(this.flows.values());
  }

  getActiveFlows(): MessageFlow[] {
    return Array.from(this.flows.values()).filter(f => this.activeFlows.has(f.id));
  }

  async exportResults(filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(this.logDir, filename || `flow-results-${timestamp}.json`);
    
    const data = {
      timestamp: new Date().toISOString(),
      metrics: this.calculateMetrics(),
      flows: this.getAllFlows(),
      scenarios: Array.from(this.scenarios.values())
    };

    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    console.log(`📊 Flow results exported to ${filepath}`);
    
    return filepath;
  }

  // Default scenarios setup
  private setupDefaultScenarios(): void {
    // Basic /tasks command scenario
    this.addScenario({
      id: 'tasks-command-basic',
      name: 'Basic Tasks Command',
      description: 'User sends /tasks command and receives response with live data',
      command: '/tasks',
      expectedResponsePattern: /TaskMaster Status/,
      expectedSteps: 4, // user_action -> webhook_call -> bridge_response -> telegram_response
      timeoutMs: 10000
    });

    // Todo command scenario
    this.addScenario({
      id: 'todo-command-basic',
      name: 'Basic Todo Command',
      description: 'User sends /todo command and receives current todo status',
      command: '/todo',
      expectedResponsePattern: /Todo Status/,
      expectedSteps: 4,
      timeoutMs: 10000
    });

    // Bridge status command
    this.addScenario({
      id: 'bridge-status-basic',
      name: 'Bridge Status Command',
      description: 'User sends /bridge command and receives bridge status',
      command: '/bridge',
      expectedResponsePattern: /CCTelegram Bridge Status/,
      expectedSteps: 3, // user_action -> bridge_response -> telegram_response
      timeoutMs: 5000
    });

    // Start command
    this.addScenario({
      id: 'start-command-basic',
      name: 'Start Command',
      description: 'User sends /start command and receives welcome message',
      command: '/start',
      expectedResponsePattern: /CC Telegram Bridge is running/,
      expectedSteps: 3,
      timeoutMs: 5000
    });

    // Data staleness detection scenario
    this.addScenario({
      id: 'data-staleness-detection',
      name: 'Data Staleness Detection',
      description: 'Detects if old static data (28/29, 96.55%) is returned instead of live data',
      command: '/tasks',
      expectedResponsePattern: /TaskMaster Status/,
      expectedSteps: 4,
      timeoutMs: 15000,
      validationChecks: [
        async (flow: MessageFlow) => {
          // Check if any step contains the old static data patterns
          for (const step of flow.steps) {
            if (step.type === 'telegram_response' && step.data?.text) {
              const text = step.data.text;
              
              // Look for static data patterns that indicate stale data
              const stalePatterns = [
                /28\/29/,  // Old task count
                /96\.55%/, // Old percentage
                /96\.6%/,  // Rounded old percentage
                /28 tasks/, // Old task reference
                /Static/i,  // Static data indicator
              ];

              const hasStalePattern = stalePatterns.some(pattern => pattern.test(text));
              if (hasStalePattern) {
                console.warn(`🚨 STALE DATA DETECTED in flow ${flow.id}: ${text.substring(0, 200)}`);
                return false;
              }
            }
          }
          return true;
        }
      ]
    });

    // Performance stress test scenario
    this.addScenario({
      id: 'performance-stress',
      name: 'Performance Stress Test',
      description: 'Multiple rapid commands to test system performance',
      command: '/tasks',
      expectedResponsePattern: /TaskMaster Status/,
      expectedSteps: 4,
      timeoutMs: 20000,
      repeatCount: 5
    });

    console.log(`✓ Loaded ${this.scenarios.size} default flow scenarios`);
  }

  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(() => {
      const metrics = this.calculateMetrics();
      this.emit('metricsUpdate', metrics);
    }, this.metricCollectionInterval);
  }

  async shutdown(): Promise<void> {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    // Wait for active flows to complete or timeout
    if (this.activeFlows.size > 0) {
      console.log(`⏳ Waiting for ${this.activeFlows.size} active flows to complete...`);
      
      // Give flows 10 seconds to complete naturally
      const timeout = setTimeout(() => {
        for (const flowId of this.activeFlows) {
          this.handleFlowTimeout(flowId);
        }
      }, 10000);

      // Wait for all flows to complete
      while (this.activeFlows.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      clearTimeout(timeout);
    }

    // Export final results
    await this.exportResults();
    console.log('✓ Message Flow Simulator shut down');
  }
}
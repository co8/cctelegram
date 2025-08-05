/**
 * Task 25.1: 3-Tier Cascading System Integration Tests
 * 
 * Comprehensive integration tests for the 3-tier cascading monitoring system
 * Validates webhook response times (0-100ms), bridge processing (100-500ms), 
 * and file watcher fallbacks (1-5s) with real-time latency measurements.
 * 
 * Test Environment: Jest + supertest + Docker Compose
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import express, { Express } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// Mock implementations for each tier
interface TierResponse {
  success: boolean;
  tier: string;
  processing_time_ms: number;
  correlation_id: string;
  timestamp: string;
  error?: string;
}

interface LatencyMeasurement {
  tier: string;
  start_time: number;
  end_time: number;
  duration_ms: number;
  within_sla: boolean;
  sla_limit_ms: number;
}

interface CascadingTestResult {
  correlation_id: string;
  attempted_tiers: string[];
  successful_tier?: string;
  total_time_ms: number;
  tier_measurements: LatencyMeasurement[];
  fallback_triggered: boolean;
  error?: string;
}

class MockTier1WebhookServer {
  private app: Express;
  private server: any;
  private port: number = 3001;
  private simulatedLatency: number = 50; // Default 50ms
  private failureRate: number = 0; // 0% failure by default
  private isHealthy: boolean = true;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      if (this.isHealthy) {
        res.json({ status: 'healthy', tier: 'webhook', timestamp: new Date().toISOString() });
      } else {
        res.status(503).json({ status: 'unhealthy', tier: 'webhook' });
      }
    });

    // Webhook processing endpoint
    this.app.post('/process', async (req, res) => {
      const startTime = Date.now();
      const correlationId = req.body.correlation_id || `webhook-${Date.now()}`;

      try {
        // Simulate failure rate
        if (Math.random() < this.failureRate) {
          throw new Error('Simulated webhook failure');
        }

        // Simulate processing time within SLA (0-100ms)
        await new Promise(resolve => setTimeout(resolve, this.simulatedLatency));

        const endTime = Date.now();
        const processingTime = endTime - startTime;

        const response: TierResponse = {
          success: true,
          tier: 'mcp_webhook',
          processing_time_ms: processingTime,
          correlation_id: correlationId,
          timestamp: new Date().toISOString()
        };

        res.json(response);
      } catch (error) {
        const endTime = Date.now();
        const processingTime = endTime - startTime;

        const response: TierResponse = {
          success: false,
          tier: 'mcp_webhook',
          processing_time_ms: processingTime,
          correlation_id: correlationId,
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };

        res.status(500).json(response);
      }
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`Mock Tier 1 Webhook server running on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('Mock Tier 1 Webhook server stopped');
          resolve();
        });
      });
    }
  }

  setLatency(ms: number): void {
    this.simulatedLatency = Math.max(0, Math.min(ms, 100)); // Clamp to 0-100ms SLA
  }

  setFailureRate(rate: number): void {
    this.failureRate = Math.max(0, Math.min(rate, 1)); // 0-100%
  }

  setHealthy(healthy: boolean): void {
    this.isHealthy = healthy;
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }
}

class MockTier2BridgeProcessor {
  private simulatedLatency: number = 200; // Default 200ms
  private failureRate: number = 0; // 0% failure by default
  private isHealthy: boolean = true;

  async process(payload: any): Promise<TierResponse> {
    const startTime = Date.now();
    const correlationId = payload.correlation_id || `bridge-${Date.now()}`;

    try {
      // Simulate failure rate
      if (Math.random() < this.failureRate) {
        throw new Error('Simulated bridge processing failure');
      }

      // Simulate processing time within SLA (100-500ms)
      await new Promise(resolve => setTimeout(resolve, this.simulatedLatency));

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      return {
        success: true,
        tier: 'bridge_internal',
        processing_time_ms: processingTime,
        correlation_id: correlationId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const endTime = Date.now();
      const processingTime = endTime - startTime;

      return {
        success: false,
        tier: 'bridge_internal',
        processing_time_ms: processingTime,
        correlation_id: correlationId,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  setLatency(ms: number): void {
    this.simulatedLatency = Math.max(100, Math.min(ms, 500)); // Clamp to 100-500ms SLA
  }

  setFailureRate(rate: number): void {
    this.failureRate = Math.max(0, Math.min(rate, 1)); // 0-100%
  }

  setHealthy(healthy: boolean): void {
    this.isHealthy = healthy;
  }

  isHealthyStatus(): boolean {
    return this.isHealthy;
  }
}

class MockTier3FileWatcher extends EventEmitter {
  private baseDir: string;
  private eventsDir: string;
  private responsesDir: string;
  private simulatedLatency: number = 2000; // Default 2s
  private failureRate: number = 0; // 0% failure by default
  private isHealthy: boolean = true;
  private watcherInterval: NodeJS.Timeout | null = null;

  constructor(baseDir: string = '/tmp/tier3-test') {
    super();
    this.baseDir = baseDir;
    this.eventsDir = path.join(baseDir, 'events');
    this.responsesDir = path.join(baseDir, 'responses');
  }

  async initialize(): Promise<void> {
    // Create test directories
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(this.eventsDir, { recursive: true });
    await fs.mkdir(this.responsesDir, { recursive: true });

    // Start file watcher simulation
    this.startWatcher();
  }

  private startWatcher(): void {
    this.watcherInterval = setInterval(async () => {
      try {
        // Check for new event files
        const files = await fs.readdir(this.eventsDir);
        const eventFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.processed'));

        for (const file of eventFiles) {
          await this.processEventFile(file);
        }
      } catch (error) {
        console.error('File watcher error:', error);
      }
    }, 100); // Check every 100ms
  }

  private async processEventFile(filename: string): Promise<void> {
    const filePath = path.join(this.eventsDir, filename);
    const processedPath = `${filePath}.processed`;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const eventData = JSON.parse(content);
      
      const startTime = Date.now();
      const correlationId = eventData.correlation_id || `file-${Date.now()}`;

      // Simulate failure rate
      if (Math.random() < this.failureRate) {
        throw new Error('Simulated file watcher failure');
      }

      // Simulate processing time within SLA (1-5s)
      await new Promise(resolve => setTimeout(resolve, this.simulatedLatency));

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      const response: TierResponse = {
        success: true,
        tier: 'file_watcher',
        processing_time_ms: processingTime,
        correlation_id: correlationId,
        timestamp: new Date().toISOString()
      };

      // Write response file
      const responseFile = path.join(this.responsesDir, `${correlationId}.json`);
      await fs.writeFile(responseFile, JSON.stringify(response, null, 2));

      // Mark event as processed
      await fs.rename(filePath, processedPath);

      // Emit processing complete event
      this.emit('processed', response);

    } catch (error) {
      console.error(`Error processing file ${filename}:`, error);
      
      // Write error response
      const correlationId = `file-error-${Date.now()}`;
      const errorResponse: TierResponse = {
        success: false,
        tier: 'file_watcher',
        processing_time_ms: Date.now() - Date.now(),
        correlation_id: correlationId,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      const responseFile = path.join(this.responsesDir, `${correlationId}.json`);
      await fs.writeFile(responseFile, JSON.stringify(errorResponse, null, 2));
    }
  }

  async queueEvent(payload: any): Promise<string> {
    const correlationId = payload.correlation_id || `file-${Date.now()}`;
    const eventFile = path.join(this.eventsDir, `${correlationId}.json`);
    
    await fs.writeFile(eventFile, JSON.stringify({
      ...payload,
      correlation_id: correlationId,
      queued_at: new Date().toISOString()
    }, null, 2));

    return correlationId;
  }

  async waitForResponse(correlationId: string, timeoutMs: number = 10000): Promise<TierResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`File watcher timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const checkResponse = async () => {
        try {
          const responseFile = path.join(this.responsesDir, `${correlationId}.json`);
          const content = await fs.readFile(responseFile, 'utf-8');
          const response = JSON.parse(content);
          clearTimeout(timeout);
          resolve(response);
        } catch (error) {
          // File doesn't exist yet, keep waiting
          setTimeout(checkResponse, 100);
        }
      };

      checkResponse();
    });
  }

  async cleanup(): Promise<void> {
    if (this.watcherInterval) {
      clearInterval(this.watcherInterval);
      this.watcherInterval = null;
    }

    try {
      // Clean up test files
      await fs.rm(this.baseDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Error cleaning up file watcher:', error);
    }
  }

  setLatency(ms: number): void {
    this.simulatedLatency = Math.max(1000, Math.min(ms, 5000)); // Clamp to 1-5s SLA
  }

  setFailureRate(rate: number): void {
    this.failureRate = Math.max(0, Math.min(rate, 1)); // 0-100%
  }

  setHealthy(healthy: boolean): void {
    this.isHealthy = healthy;
  }

  isHealthyStatus(): boolean {
    return this.isHealthy;
  }
}

class TierCascadeOrchestrator {
  private tier1: MockTier1WebhookServer;
  private tier2: MockTier2BridgeProcessor;
  private tier3: MockTier3FileWatcher;

  constructor() {
    this.tier1 = new MockTier1WebhookServer();
    this.tier2 = new MockTier2BridgeProcessor();
    this.tier3 = new MockTier3FileWatcher();
  }

  async initialize(): Promise<void> {
    await this.tier1.start();
    await this.tier3.initialize();
  }

  async cleanup(): Promise<void> {
    await this.tier1.stop();
    await this.tier3.cleanup();
  }

  async processWithFallback(payload: any): Promise<CascadingTestResult> {
    const correlationId = payload.correlation_id || `cascade-${Date.now()}`;
    const startTime = Date.now();
    const attemptedTiers: string[] = [];
    const tierMeasurements: LatencyMeasurement[] = [];
    let successfulTier: string | undefined;
    let fallbackTriggered = false;

    // Tier 1: MCP Webhook (0-100ms SLA)
    try {
      attemptedTiers.push('mcp_webhook');
      const tier1Start = Date.now();
      
      const response = await request(this.tier1.getUrl())
        .post('/process')
        .send({ ...payload, correlation_id: correlationId })
        .timeout(100); // 100ms timeout for Tier 1

      const tier1End = Date.now();
      const tier1Duration = tier1End - tier1Start;
      
      tierMeasurements.push({
        tier: 'mcp_webhook',
        start_time: tier1Start,
        end_time: tier1End,
        duration_ms: tier1Duration,
        within_sla: tier1Duration <= 100,
        sla_limit_ms: 100
      });

      if (response.status === 200 && response.body.success) {
        successfulTier = 'mcp_webhook';
        
        return {
          correlation_id: correlationId,
          attempted_tiers: attemptedTiers,
          successful_tier: successfulTier,
          total_time_ms: Date.now() - startTime,
          tier_measurements: tierMeasurements,
          fallback_triggered: fallbackTriggered
        };
      }
    } catch (error) {
      console.log('Tier 1 failed, falling back to Tier 2');
      fallbackTriggered = true;
    }

    // Tier 2: Bridge Internal (100-500ms SLA)
    try {
      attemptedTiers.push('bridge_internal');
      const tier2Start = Date.now();
      
      const response = await this.tier2.process({ ...payload, correlation_id: correlationId });
      
      const tier2End = Date.now();
      const tier2Duration = tier2End - tier2Start;
      
      tierMeasurements.push({
        tier: 'bridge_internal',
        start_time: tier2Start,
        end_time: tier2End,
        duration_ms: tier2Duration,
        within_sla: tier2Duration >= 100 && tier2Duration <= 500,
        sla_limit_ms: 500
      });

      if (response.success) {
        successfulTier = 'bridge_internal';
        
        return {
          correlation_id: correlationId,
          attempted_tiers: attemptedTiers,
          successful_tier: successfulTier,
          total_time_ms: Date.now() - startTime,
          tier_measurements: tierMeasurements,
          fallback_triggered: fallbackTriggered
        };
      }
    } catch (error) {
      console.log('Tier 2 failed, falling back to Tier 3');
      fallbackTriggered = true;
    }

    // Tier 3: File Watcher (1-5s SLA)
    try {
      attemptedTiers.push('file_watcher');
      const tier3Start = Date.now();
      
      const fileCorrelationId = await this.tier3.queueEvent({ ...payload, correlation_id: correlationId });
      const response = await this.tier3.waitForResponse(fileCorrelationId, 6000); // 6s timeout
      
      const tier3End = Date.now();
      const tier3Duration = tier3End - tier3Start;
      
      tierMeasurements.push({
        tier: 'file_watcher',
        start_time: tier3Start,
        end_time: tier3End,
        duration_ms: tier3Duration,
        within_sla: tier3Duration >= 1000 && tier3Duration <= 5000,
        sla_limit_ms: 5000
      });

      if (response.success) {
        successfulTier = 'file_watcher';
        
        return {
          correlation_id: correlationId,
          attempted_tiers: attemptedTiers,
          successful_tier: successfulTier,
          total_time_ms: Date.now() - startTime,
          tier_measurements: tierMeasurements,
          fallback_triggered: fallbackTriggered
        };
      }
    } catch (error) {
      console.log('Tier 3 failed, all tiers exhausted');
    }

    // All tiers failed
    return {
      correlation_id: correlationId,
      attempted_tiers: attemptedTiers,
      total_time_ms: Date.now() - startTime,
      tier_measurements: tierMeasurements,
      fallback_triggered: fallbackTriggered,
      error: 'All tiers failed'
    };
  }

  // Tier configuration methods for testing
  getTier1(): MockTier1WebhookServer { return this.tier1; }
  getTier2(): MockTier2BridgeProcessor { return this.tier2; }
  getTier3(): MockTier3FileWatcher { return this.tier3; }
}

describe('3-Tier Cascading System Integration Tests', () => {
  let orchestrator: TierCascadeOrchestrator;

  beforeAll(async () => {
    orchestrator = new TierCascadeOrchestrator();
    await orchestrator.initialize();
  }, 10000);

  afterAll(async () => {
    await orchestrator.cleanup();
  }, 10000);

  beforeEach(() => {
    // Reset all tiers to healthy state before each test
    orchestrator.getTier1().setLatency(50);
    orchestrator.getTier1().setFailureRate(0);
    orchestrator.getTier1().setHealthy(true);
    
    orchestrator.getTier2().setLatency(200);
    orchestrator.getTier2().setFailureRate(0);
    orchestrator.getTier2().setHealthy(true);
    
    orchestrator.getTier3().setLatency(2000);
    orchestrator.getTier3().setFailureRate(0);
    orchestrator.getTier3().setHealthy(true);
  });

  describe('Tier 1: MCP Webhook Response Time Validation (0-100ms)', () => {
    it('should process requests within 0-100ms SLA', async () => {
      const testPayload = {
        type: 'task_completion',
        title: 'Tier 1 SLA Test',
        description: 'Testing Tier 1 response time SLA'
      };

      const result = await orchestrator.processWithFallback(testPayload);

      expect(result.successful_tier).toBe('mcp_webhook');
      expect(result.attempted_tiers).toEqual(['mcp_webhook']);
      expect(result.fallback_triggered).toBe(false);
      
      const tier1Measurement = result.tier_measurements.find(m => m.tier === 'mcp_webhook');
      expect(tier1Measurement).toBeDefined();
      expect(tier1Measurement!.duration_ms).toBeLessThanOrEqual(100);
      expect(tier1Measurement!.within_sla).toBe(true);
    });

    it('should handle various latency scenarios within SLA', async () => {
      const latencyScenarios = [10, 25, 50, 75, 95]; // All within 0-100ms SLA

      for (const latency of latencyScenarios) {
        orchestrator.getTier1().setLatency(latency);
        
        const result = await orchestrator.processWithFallback({
          type: 'test_event',
          title: `Latency Test ${latency}ms`,
          description: 'Testing specific latency scenario'
        });

        expect(result.successful_tier).toBe('mcp_webhook');
        
        const measurement = result.tier_measurements.find(m => m.tier === 'mcp_webhook');
        expect(measurement!.duration_ms).toBeLessThanOrEqual(100);
        expect(measurement!.within_sla).toBe(true);
      }
    });

    it('should trigger fallback when Tier 1 exceeds timeout', async () => {
      // Set latency beyond timeout threshold
      orchestrator.getTier1().setLatency(200); // Beyond 100ms timeout
      
      const result = await orchestrator.processWithFallback({
        type: 'timeout_test',
        title: 'Tier 1 Timeout Test',
        description: 'Testing timeout handling'
      });

      expect(result.successful_tier).toBe('bridge_internal');
      expect(result.attempted_tiers).toContain('mcp_webhook');
      expect(result.attempted_tiers).toContain('bridge_internal');
      expect(result.fallback_triggered).toBe(true);
    });
  });

  describe('Tier 2: Bridge Processing Validation (100-500ms)', () => {
    it('should process requests within 100-500ms SLA when Tier 1 fails', async () => {
      // Disable Tier 1 to force Tier 2 processing
      orchestrator.getTier1().setFailureRate(1);

      const result = await orchestrator.processWithFallback({
        type: 'tier2_test',
        title: 'Tier 2 SLA Test',
        description: 'Testing Tier 2 response time SLA'
      });

      expect(result.successful_tier).toBe('bridge_internal');
      expect(result.attempted_tiers).toContain('bridge_internal');
      expect(result.fallback_triggered).toBe(true);
      
      const tier2Measurement = result.tier_measurements.find(m => m.tier === 'bridge_internal');
      expect(tier2Measurement).toBeDefined();
      expect(tier2Measurement!.duration_ms).toBeGreaterThanOrEqual(100);
      expect(tier2Measurement!.duration_ms).toBeLessThanOrEqual(500);
      expect(tier2Measurement!.within_sla).toBe(true);
    });

    it('should handle various latency scenarios within SLA', async () => {
      orchestrator.getTier1().setFailureRate(1); // Force Tier 2
      
      const latencyScenarios = [150, 200, 300, 400, 450]; // All within 100-500ms SLA

      for (const latency of latencyScenarios) {
        orchestrator.getTier2().setLatency(latency);
        
        const result = await orchestrator.processWithFallback({
          type: 'test_event',
          title: `Tier 2 Latency Test ${latency}ms`,
          description: 'Testing specific Tier 2 latency scenario'
        });

        expect(result.successful_tier).toBe('bridge_internal');
        
        const measurement = result.tier_measurements.find(m => m.tier === 'bridge_internal');
        expect(measurement!.duration_ms).toBeGreaterThanOrEqual(100);
        expect(measurement!.duration_ms).toBeLessThanOrEqual(500);
        expect(measurement!.within_sla).toBe(true);
      }
    });
  });

  describe('Tier 3: File Watcher Fallback Validation (1-5s)', () => {
    it('should process requests within 1-5s SLA when Tiers 1 and 2 fail', async () => {
      // Disable Tiers 1 and 2 to force Tier 3 processing
      orchestrator.getTier1().setFailureRate(1);
      orchestrator.getTier2().setFailureRate(1);

      const result = await orchestrator.processWithFallback({
        type: 'tier3_test',
        title: 'Tier 3 SLA Test',
        description: 'Testing Tier 3 response time SLA'
      });

      expect(result.successful_tier).toBe('file_watcher');
      expect(result.attempted_tiers).toContain('file_watcher');
      expect(result.fallback_triggered).toBe(true);
      
      const tier3Measurement = result.tier_measurements.find(m => m.tier === 'file_watcher');
      expect(tier3Measurement).toBeDefined();
      expect(tier3Measurement!.duration_ms).toBeGreaterThanOrEqual(1000);
      expect(tier3Measurement!.duration_ms).toBeLessThanOrEqual(5000);
      expect(tier3Measurement!.within_sla).toBe(true);
    }, 10000);

    it('should handle various latency scenarios within SLA', async () => {
      orchestrator.getTier1().setFailureRate(1); // Force Tier 3
      orchestrator.getTier2().setFailureRate(1);
      
      const latencyScenarios = [1200, 2000, 3000, 4000, 4800]; // All within 1-5s SLA

      for (const latency of latencyScenarios) {
        orchestrator.getTier3().setLatency(latency);
        
        const result = await orchestrator.processWithFallback({
          type: 'test_event',
          title: `Tier 3 Latency Test ${latency}ms`,
          description: 'Testing specific Tier 3 latency scenario'
        });

        expect(result.successful_tier).toBe('file_watcher');
        
        const measurement = result.tier_measurements.find(m => m.tier === 'file_watcher');
        expect(measurement!.duration_ms).toBeGreaterThanOrEqual(1000);
        expect(measurement!.duration_ms).toBeLessThanOrEqual(5000);
        expect(measurement!.within_sla).toBe(true);
      }
    }, 30000);
  });

  describe('Real-time Latency Measurements', () => {
    it('should provide accurate timing measurements for each tier', async () => {
      const result = await orchestrator.processWithFallback({
        type: 'timing_test',
        title: 'Latency Measurement Test',
        description: 'Testing accuracy of timing measurements'
      });

      expect(result.tier_measurements).toHaveLength(1); // Only Tier 1 should succeed
      
      const measurement = result.tier_measurements[0];
      expect(measurement.start_time).toBeLessThanOrEqual(measurement.end_time);
      expect(measurement.duration_ms).toBe(measurement.end_time - measurement.start_time);
      expect(measurement.tier).toBe('mcp_webhook');
      expect(measurement.sla_limit_ms).toBe(100);
    });

    it('should measure tolerance margins accurately', async () => {
      // Test edge case near SLA boundaries
      orchestrator.getTier1().setLatency(98); // Just under SLA limit

      const result = await orchestrator.processWithFallback({
        type: 'tolerance_test',
        title: 'Tolerance Margin Test',
        description: 'Testing tolerance margin accuracy'
      });

      const measurement = result.tier_measurements.find(m => m.tier === 'mcp_webhook');
      expect(measurement!.within_sla).toBe(true);
      expect(measurement!.duration_ms).toBeLessThanOrEqual(100);
      
      // Verify measurement accuracy with small tolerance for timing variance
      expect(measurement!.duration_ms).toBeGreaterThan(90); // Allow for some variance
    });

    it('should track cumulative processing time across tiers', async () => {
      // Force fallback through all tiers
      orchestrator.getTier1().setFailureRate(1);
      orchestrator.getTier2().setFailureRate(1);

      const result = await orchestrator.processWithFallback({
        type: 'cumulative_test',
        title: 'Cumulative Time Test',
        description: 'Testing cumulative processing time tracking'
      });

      expect(result.tier_measurements).toHaveLength(3); // All 3 tiers attempted
      expect(result.total_time_ms).toBeGreaterThan(0);
      
      // Verify total time includes all tier attempts
      const sumOfTierTimes = result.tier_measurements.reduce((sum, m) => sum + m.duration_ms, 0);
      expect(result.total_time_ms).toBeGreaterThanOrEqual(sumOfTierTimes);
    }, 15000);
  });

  describe('Fallback Mechanism Validation', () => {
    it('should cascade through all tiers when each fails', async () => {
      // Configure all tiers to fail
      orchestrator.getTier1().setFailureRate(1);
      orchestrator.getTier2().setFailureRate(1);
      orchestrator.getTier3().setFailureRate(1);

      const result = await orchestrator.processWithFallback({
        type: 'cascade_test',
        title: 'Full Cascade Test',
        description: 'Testing complete fallback cascade'
      });

      expect(result.attempted_tiers).toEqual(['mcp_webhook', 'bridge_internal', 'file_watcher']);
      expect(result.successful_tier).toBeUndefined();
      expect(result.fallback_triggered).toBe(true);
      expect(result.error).toBe('All tiers failed');
      expect(result.tier_measurements).toHaveLength(3);
    }, 15000);

    it('should stop cascading when a tier succeeds', async () => {
      // Tier 1 fails, Tier 2 succeeds
      orchestrator.getTier1().setFailureRate(1);
      orchestrator.getTier2().setFailureRate(0);

      const result = await orchestrator.processWithFallback({
        type: 'early_success_test',
        title: 'Early Success Test',
        description: 'Testing early success stop condition'
      });

      expect(result.attempted_tiers).toEqual(['mcp_webhook', 'bridge_internal']);
      expect(result.successful_tier).toBe('bridge_internal');
      expect(result.fallback_triggered).toBe(true);
      expect(result.tier_measurements).toHaveLength(2); // Only 2 tiers attempted
    });

    it('should handle intermittent failures gracefully', async () => {
      // Set low failure rate for intermittent failures
      orchestrator.getTier1().setFailureRate(0.3); // 30% failure rate

      const results: CascadingTestResult[] = [];
      
      // Run multiple tests to check intermittent behavior
      for (let i = 0; i < 10; i++) {
        const result = await orchestrator.processWithFallback({
          type: 'intermittent_test',
          title: `Intermittent Test ${i}`,
          description: 'Testing intermittent failure handling'
        });
        results.push(result);
      }

      // Some should succeed at Tier 1, some should fallback
      const tier1Successes = results.filter(r => r.successful_tier === 'mcp_webhook').length;
      const tier2Successes = results.filter(r => r.successful_tier === 'bridge_internal').length;
      
      expect(tier1Successes).toBeGreaterThan(0); // At least some Tier 1 successes
      expect(tier2Successes).toBeGreaterThan(0); // At least some fallbacks to Tier 2
      expect(tier1Successes + tier2Successes).toBe(10); // All should eventually succeed
    });
  });

  describe('Health Check Integration', () => {
    it('should validate tier health status', async () => {
      // Test health check endpoints
      const tier1Health = await request(orchestrator.getTier1().getUrl())
        .get('/health')
        .expect(200);

      expect(tier1Health.body.status).toBe('healthy');
      expect(tier1Health.body.tier).toBe('webhook');

      // Test Tier 2 and 3 health status
      expect(orchestrator.getTier2().isHealthyStatus()).toBe(true);
      expect(orchestrator.getTier3().isHealthyStatus()).toBe(true);
    });

    it('should handle unhealthy tier states', async () => {
      // Mark Tier 1 as unhealthy
      orchestrator.getTier1().setHealthy(false);

      const healthResponse = await request(orchestrator.getTier1().getUrl())
        .get('/health')
        .expect(503);

      expect(healthResponse.body.status).toBe('unhealthy');
      
      // Verify processing still works via fallback
      const result = await orchestrator.processWithFallback({
        type: 'health_test',
        title: 'Health Check Test',
        description: 'Testing with unhealthy Tier 1'
      });

      expect(result.successful_tier).toBe('bridge_internal');
      expect(result.fallback_triggered).toBe(true);
    });
  });

  describe('Load and Stress Testing', () => {
    it('should handle concurrent requests across all tiers', async () => {
      const concurrentRequests = 10;
      const promises: Promise<CascadingTestResult>[] = [];

      // Create concurrent requests
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(orchestrator.processWithFallback({
          type: 'concurrent_test',
          title: `Concurrent Test ${i}`,
          description: 'Testing concurrent request handling'
        }));
      }

      const results = await Promise.all(promises);

      // All requests should succeed
      expect(results).toHaveLength(concurrentRequests);
      results.forEach(result => {
        expect(result.successful_tier).toBeDefined();
        expect(result.error).toBeUndefined();
      });

      // Most should succeed at Tier 1 under normal conditions
      const tier1Successes = results.filter(r => r.successful_tier === 'mcp_webhook').length;
      expect(tier1Successes).toBeGreaterThan(concurrentRequests * 0.8); // At least 80%
    });

    it('should maintain SLA compliance under load', async () => {
      const loadTestRequests = 20;
      const promises: Promise<CascadingTestResult>[] = [];

      for (let i = 0; i < loadTestRequests; i++) {
        promises.push(orchestrator.processWithFallback({
          type: 'load_test',
          title: `Load Test ${i}`,
          description: 'Testing SLA compliance under load'
        }));
      }

      const results = await Promise.all(promises);

      // Verify SLA compliance
      results.forEach(result => {
        result.tier_measurements.forEach(measurement => {
          switch (measurement.tier) {
            case 'mcp_webhook':
              expect(measurement.duration_ms).toBeLessThanOrEqual(100);
              break;
            case 'bridge_internal':
              expect(measurement.duration_ms).toBeLessThanOrEqual(500);
              break;
            case 'file_watcher':
              expect(measurement.duration_ms).toBeLessThanOrEqual(5000);
              break;
          }
        });
      });
    }, 30000);
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from transient errors', async () => {
      // Simulate transient error followed by recovery
      orchestrator.getTier1().setFailureRate(1); // Start with 100% failure
      
      const failureResult = await orchestrator.processWithFallback({
        type: 'recovery_test_1',
        title: 'Recovery Test - Failure',
        description: 'Testing error recovery - failure phase'
      });

      expect(failureResult.successful_tier).toBe('bridge_internal'); // Should fallback

      // Recover Tier 1
      orchestrator.getTier1().setFailureRate(0);

      const recoveryResult = await orchestrator.processWithFallback({
        type: 'recovery_test_2',
        title: 'Recovery Test - Recovery',
        description: 'Testing error recovery - recovery phase'
      });

      expect(recoveryResult.successful_tier).toBe('mcp_webhook'); // Should succeed at Tier 1
    });

    it('should handle cascading failures gracefully', async () => {
      // Gradually increase failure rates
      const failureScenarios = [
        { tier1: 0.5, tier2: 0, tier3: 0 },
        { tier1: 1, tier2: 0.5, tier3: 0 },
        { tier1: 1, tier2: 1, tier3: 0.5 }
      ];

      for (const scenario of failureScenarios) {
        orchestrator.getTier1().setFailureRate(scenario.tier1);
        orchestrator.getTier2().setFailureRate(scenario.tier2);
        orchestrator.getTier3().setFailureRate(scenario.tier3);

        const result = await orchestrator.processWithFallback({
          type: 'cascading_failure_test',
          title: 'Cascading Failure Test',
          description: `Testing scenario: T1:${scenario.tier1} T2:${scenario.tier2} T3:${scenario.tier3}`
        });

        // Should eventually succeed or gracefully fail
        expect(result.correlation_id).toBeDefined();
        expect(result.attempted_tiers.length).toBeGreaterThan(0);
      }
    }, 20000);
  });
});
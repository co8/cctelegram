/**
 * Resilient Bridge Client
 * 
 * Enhanced version of CCTelegramBridgeClient with integrated resilience patterns
 * including circuit breakers, retries, health monitoring, and automatic recovery.
 */

import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { CCTelegramEvent, BridgeStatus, TelegramResponse, EventType } from './types.js';
import { secureLog, sanitizeForLogging, sanitizePath } from './security.js';
import { ResilienceManager } from './resilience/manager.js';
import { ResilienceConfig, createDefaultResilienceConfig } from './resilience/config.js';
import { 
  BridgeError, 
  BridgeConnectionError, 
  BridgeTimeoutError, 
  NetworkError,
  FilesystemError,
  createResilienceError 
} from './resilience/errors/resilience-errors.js';

const execAsync = promisify(exec);

export class ResilientBridgeClient {
  private eventsDir: string;
  private responsesDir: string;
  private healthEndpoint: string;
  private metricsEndpoint: string;
  private resilienceManager: ResilienceManager;
  
  // Bridge status caching
  private bridgeStatusCache: { running: boolean; timestamp: number } | null = null;
  private readonly CACHE_DURATION_MS = 30000; // 30 seconds
  private isStartingBridge = false; // Prevent concurrent starts

  constructor(resilienceConfig?: Partial<ResilienceConfig>) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
    // Force absolute path resolution to prevent ~ expansion issues
    const ccTelegramDir = path.resolve(homeDir, '.cc_telegram');
    
    // Properly expand ~ in environment variables if present
    const expandPath = (pathStr: string): string => {
      if (pathStr.startsWith('~/')) {
        return path.join(homeDir, pathStr.slice(2));
      }
      return path.resolve(pathStr);
    };
    
    this.eventsDir = process.env.CC_TELEGRAM_EVENTS_DIR 
      ? sanitizePath(expandPath(process.env.CC_TELEGRAM_EVENTS_DIR))
      : path.join(ccTelegramDir, 'events');
    this.responsesDir = process.env.CC_TELEGRAM_RESPONSES_DIR 
      ? sanitizePath(expandPath(process.env.CC_TELEGRAM_RESPONSES_DIR))
      : path.join(ccTelegramDir, 'responses');
    
    const healthPort = process.env.CC_TELEGRAM_HEALTH_PORT || '8080';
    this.healthEndpoint = `http://localhost:${healthPort}/health`;
    this.metricsEndpoint = `http://localhost:${healthPort}/metrics`;

    // Initialize resilience manager with bridge-specific configuration
    const bridgeConfig = this.createBridgeResilienceConfig(resilienceConfig);
    this.resilienceManager = new ResilienceManager(bridgeConfig);

    // Initialize in background
    this.initialize();
  }

  /**
   * Create bridge-specific resilience configuration
   */
  private createBridgeResilienceConfig(userConfig?: Partial<ResilienceConfig>): ResilienceConfig {
    const baseConfig = createDefaultResilienceConfig();
    
    // Bridge-specific overrides
    const bridgeConfig: Partial<ResilienceConfig> = {
      // Enhanced health checks for bridge components
      health: {
        ...baseConfig.health,
        endpoints: [
          {
            name: 'bridge-health',
            url: this.healthEndpoint,
            method: 'GET',
            timeout: 5000,
            retries: 2,
            expectedStatus: [200],
            critical: true
          },
          {
            name: 'bridge-metrics',
            url: this.metricsEndpoint,
            method: 'GET',
            timeout: 3000,
            retries: 1,
            expectedStatus: [200],
            critical: false
          }
        ]
      },
      
      // Bridge-specific circuit breaker tuning
      circuitBreaker: {
        ...baseConfig.circuitBreaker,
        bridge: {
          enabled: true,
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 30000, // 30 seconds
          monitoringWindow: 60000, // 1 minute
          maxConcurrentRequests: 5,
          volumeThreshold: 3
        }
      },
      
      // Bridge-specific retry policies
      retry: {
        ...baseConfig.retry,
        bridge: {
          enabled: true,
          maxAttempts: 3,
          baseDelay: 2000,
          maxDelay: 15000,
          exponentialBase: 2.0,
          jitterEnabled: true,
          jitterMax: 1000,
          retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'BRIDGE_NOT_READY', 'BRIDGE_TIMEOUT'],
          nonRetryableErrors: ['BRIDGE_AUTH_FAILED', 'BRIDGE_INVALID_CONFIG', 'BRIDGE_CRASHED']
        }
      },
      
      // Enhanced operations configuration
      operations: {
        ...baseConfig.operations,
        'sendEvent': {
          priority: 'high',
          timeout: 15000,
          circuitBreaker: {
            failureThreshold: 2,
            timeout: 20000
          }
        },
        'getBridgeStatus': {
          priority: 'normal',
          timeout: 5000,
          retry: {
            maxAttempts: 2,
            baseDelay: 1000
          }
        },
        'startBridge': {
          priority: 'critical',
          timeout: 45000,
          retry: {
            maxAttempts: 3,
            baseDelay: 5000
          }
        },
        'ensureBridgeReady': {
          priority: 'critical',
          timeout: 60000,
          retry: {
            maxAttempts: 5,
            baseDelay: 3000
          }
        }
      }
    };

    return { ...baseConfig, ...bridgeConfig, ...userConfig };
  }

  /**
   * Initialize the resilient bridge client
   */
  private async initialize(): Promise<void> {
    try {
      // Initialize resilience system
      await this.resilienceManager.initialize();
      
      // Ensure directories exist with resilience
      await this.resilienceManager.execute(
        () => this.ensureDirectories(),
        {
          operation: 'ensureDirectories',
          component: 'filesystem',
          priority: 'high'
        }
      );
      
      // Initialize bridge in background (non-blocking)
      this.initializeBridge();
      
      secureLog('info', 'Resilient bridge client initialized successfully');
      
    } catch (error) {
      secureLog('error', 'Failed to initialize resilient bridge client', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw createResilienceError(error, {
        operation: 'initialize',
        component: 'bridge_client'
      });
    }
  }

  private async ensureDirectories(): Promise<void> {
    await fs.ensureDir(this.eventsDir);
    await fs.ensureDir(this.responsesDir);
  }

  /**
   * Initialize bridge at startup (non-blocking background check)
   */
  private initializeBridge(): void {
    // Run in background without blocking constructor
    setTimeout(async () => {
      try {
        secureLog('info', 'Background bridge initialization check started');
        
        const isRunning = await this.resilienceManager.execute(
          () => this.isBridgeRunning(),
          {
            operation: 'isBridgeRunning',
            component: 'bridge',
            priority: 'normal'
          }
        );
        
        if (!isRunning) {
          secureLog('info', 'Bridge not running at startup, attempting to start');
          await this.ensureBridgeReady();
          secureLog('info', 'Bridge initialization completed');
        } else {
          secureLog('info', 'Bridge already running at startup');
        }
      } catch (error) {
        secureLog('error', 'Bridge initialization failed', {
          error_message: error instanceof Error ? error.message : 'Unknown error'
        });
        // Don't throw here as this is background initialization
      }
    }, 100); // Small delay to avoid blocking constructor
  }

  /**
   * Send a structured event to the CC Telegram Bridge with resilience
   */
  async sendEvent(event: CCTelegramEvent): Promise<{ success: boolean; event_id: string; file_path: string }> {
    secureLog('info', 'Event send request received', {
      event_type: event.type,
      has_task_id: !!event.task_id
    });
    
    return await this.resilienceManager.execute(
      async () => {
        // CRITICAL: Ensure bridge is running before sending event
        secureLog('debug', 'Ensuring bridge is ready');
        await this.ensureBridgeReady();
        secureLog('debug', 'Bridge confirmed ready');
        
        // Generate unique event ID and filename
        const eventId = event.task_id || uuidv4();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${event.type}_${timestamp}_${eventId}.json`;
        const filePath = path.join(this.eventsDir, filename);
        
        // Prepare event data with metadata
        const eventData = {
          ...event,
          event_id: eventId,
          timestamp: new Date().toISOString(),
          source: event.source || 'claude-code',
          metadata: {
            ...event.data,
            client_version: '1.5.0',
            resilience_enabled: true
          }
        };
        
        secureLog('debug', 'Writing event to file', {
          event_id: eventId,
          file_path: sanitizeForLogging(filePath),
          event_type: event.type
        });
        
        // Write event file with error handling
        try {
          await fs.writeJSON(filePath, eventData, { spaces: 2 });
        } catch (writeError) {
          throw new FilesystemError(
            'Failed to write event file',
            'FILESYSTEM_WRITE_FAILED',
            'high',
            {
              operation: 'sendEvent',
              component: 'filesystem',
              metadata: { filePath, eventId }
            },
            writeError instanceof Error ? writeError : undefined
          );
        }
        
        secureLog('info', 'Event successfully written', {
          event_id: eventId,
          event_type: event.type,
          file_size: (await fs.stat(filePath)).size
        });
        
        return {
          success: true,
          event_id: eventId,
          file_path: filePath
        };
      },
      {
        operation: 'sendEvent',
        component: 'bridge',
        correlationId: event.task_id,
        priority: 'high',
        metadata: { eventType: event.type }
      }
    );
  }

  /**
   * Get bridge status with resilience
   */
  async getBridgeStatus(): Promise<BridgeStatus> {
    return await this.resilienceManager.execute(
      async () => {
        // Check cache first
        if (this.bridgeStatusCache && 
            (Date.now() - this.bridgeStatusCache.timestamp) < this.CACHE_DURATION_MS) {
          secureLog('debug', 'Returning cached bridge status');
          
          return {
            running: this.bridgeStatusCache.running,
            health_endpoint: this.healthEndpoint,
            metrics_endpoint: this.metricsEndpoint,
            last_check: new Date(this.bridgeStatusCache.timestamp).toISOString(),
            cached: true,
            resilience_status: await this.resilienceManager.getSystemStatus()
          };
        }
        
        const isRunning = await this.isBridgeRunning();
        
        // Update cache
        this.bridgeStatusCache = {
          running: isRunning,
          timestamp: Date.now()
        };
        
        return {
          running: isRunning,
          health_endpoint: this.healthEndpoint,
          metrics_endpoint: this.metricsEndpoint,
          last_check: new Date().toISOString(),
          cached: false,
          resilience_status: await this.resilienceManager.getSystemStatus()
        };
      },
      {
        operation: 'getBridgeStatus',
        component: 'bridge',
        priority: 'normal'
      }
    );
  }

  /**
   * Check if bridge is running with resilience
   */
  private async isBridgeRunning(): Promise<boolean> {
    return await this.resilienceManager.execute(
      async () => {
        try {
          const response = await axios.get(this.healthEndpoint, {
            timeout: 5000,
            validateStatus: (status) => status === 200
          });
          
          secureLog('debug', 'Bridge health check successful', {
            status: response.status,
            response_time: response.headers['x-response-time'] || 'unknown'
          });
          
          return true;
        } catch (error) {
          secureLog('debug', 'Bridge health check failed', {
            error_message: error instanceof Error ? error.message : 'unknown'
          });
          
          if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNREFUSED') {
              throw new BridgeConnectionError(
                'Bridge connection refused',
                { operation: 'isBridgeRunning', component: 'bridge', metadata: { endpoint: this.healthEndpoint } },
                error
              );
            } else if (error.code === 'ETIMEDOUT') {
              throw new BridgeTimeoutError(
                'Bridge health check timeout',
                5000,
                { operation: 'isBridgeRunning', component: 'bridge', metadata: { endpoint: this.healthEndpoint } },
                error
              );
            }
          }
          
          throw createResilienceError(error, {
            operation: 'isBridgeRunning',
            component: 'bridge',
            metadata: { endpoint: this.healthEndpoint }
          });
        }
      },
      {
        operation: 'isBridgeRunning',
        component: 'bridge',
        priority: 'normal',
        timeout: 5000
      }
    );
  }

  /**
   * Ensure bridge is ready with resilience
   */
  async ensureBridgeReady(): Promise<void> {
    return await this.resilienceManager.execute(
      async () => {
        // Prevent concurrent bridge starts
        if (this.isStartingBridge) {
          secureLog('debug', 'Bridge start already in progress, waiting');
          
          // Wait for current start to complete
          while (this.isStartingBridge) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          // Check if bridge is now running
          if (await this.isBridgeRunning()) {
            return;
          }
        }
        
        // Check if bridge is already running
        if (await this.isBridgeRunning()) {
          secureLog('debug', 'Bridge already running');
          return;
        }
        
        this.isStartingBridge = true;
        
        try {
          secureLog('info', 'Starting CC Telegram Bridge');
          
          // Clear any stale cache
          this.bridgeStatusCache = null;
          
          // Start the bridge process
          await this.startBridgeProcess();
          
          // Wait for bridge to be ready
          await this.waitForBridgeReady();
          
          secureLog('info', 'Bridge successfully started and ready');
          
        } finally {
          this.isStartingBridge = false;
        }
      },
      {
        operation: 'ensureBridgeReady',
        component: 'bridge',
        priority: 'critical',
        timeout: 60000
      }
    );
  }

  /**
   * Start bridge process with resilience
   */
  private async startBridgeProcess(): Promise<void> {
    return await this.resilienceManager.execute(
      async () => {
        try {
          // Load environment variables
          dotenv.config();
          
          // Get bridge executable path
          const bridgePath = this.getBridgeExecutablePath();
          
          secureLog('info', 'Starting bridge process', {
            bridge_path: sanitizeForLogging(bridgePath),
            health_endpoint: this.healthEndpoint
          });
          
          // Start bridge process
          const bridgeProcess = spawn(bridgePath, {
            detached: true,
            stdio: 'ignore',
            env: {
              ...process.env,
              CC_TELEGRAM_HEALTH_PORT: process.env.CC_TELEGRAM_HEALTH_PORT || '8080'
            }
          });
          
          // Don't wait for the process, let it run detached
          bridgeProcess.unref();
          
          secureLog('info', 'Bridge process started', {
            pid: bridgeProcess.pid
          });
          
        } catch (error) {
          throw new BridgeError(
            'Failed to start bridge process',
            'BRIDGE_START_FAILED',
            'critical',
            { operation: 'startBridgeProcess', component: 'bridge' },
            error instanceof Error ? error : undefined
          );
        }
      },
      {
        operation: 'startBridgeProcess',
        component: 'bridge',
        priority: 'critical'
      }
    );
  }

  /**
   * Wait for bridge to be ready
   */
  private async waitForBridgeReady(): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 2000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        secureLog('debug', 'Checking bridge readiness', {
          attempt,
          max_attempts: maxAttempts
        });
        
        const isRunning = await this.isBridgeRunning();
        if (isRunning) {
          secureLog('info', 'Bridge is ready', {
            attempts_taken: attempt,
            total_wait_time: attempt * delayMs
          });
          return;
        }
        
      } catch (error) {
        secureLog('debug', 'Bridge not ready yet', {
          attempt,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    throw new BridgeError(
      `Bridge failed to become ready after ${maxAttempts} attempts`,
      'BRIDGE_NOT_READY',
      'critical',
      {
        operation: 'waitForBridgeReady',
        component: 'bridge',
        metadata: { maxAttempts, delayMs }
      }
    );
  }

  /**
   * Get bridge executable path
   */
  private getBridgeExecutablePath(): string {
    // Try different possible locations
    const possiblePaths = [
      process.env.CC_TELEGRAM_BRIDGE_PATH,
      'cctelegram-bridge',
      './cctelegram-bridge',
      path.join(process.cwd(), 'cctelegram-bridge'),
      'which cctelegram-bridge'
    ].filter(Boolean) as string[];
    
    for (const bridgePath of possiblePaths) {
      if (bridgePath === 'which cctelegram-bridge') {
        // Try to find bridge in PATH
        try {
          const result = execAsync('which cctelegram-bridge');
          if (result) {
            return 'cctelegram-bridge';
          }
        } catch {
          // Continue to next option
        }
      } else {
        // Check if file exists
        try {
          if (fs.existsSync(bridgePath)) {
            return sanitizePath(bridgePath);
          }
        } catch {
          // Continue to next option
        }
      }
    }
    
    // Default fallback
    return 'cctelegram-bridge';
  }

  /**
   * Get responses with resilience
   */
  async getResponses(limit: number = 10): Promise<TelegramResponse[]> {
    return await this.resilienceManager.execute(
      async () => {
        try {
          const files = await fs.readdir(this.responsesDir);
          const responseFiles = files
            .filter(file => file.endsWith('.json'))
            .sort((a, b) => b.localeCompare(a)) // Newest first
            .slice(0, limit);
          
          const responses: TelegramResponse[] = [];
          
          for (const file of responseFiles) {
            try {
              const filePath = path.join(this.responsesDir, file);
              const response = await fs.readJSON(filePath);
              responses.push(response);
            } catch (error) {
              secureLog('warn', 'Failed to read response file', {
                file,
                error: error instanceof Error ? error.message : 'unknown'
              });
            }
          }
          
          return responses;
          
        } catch (error) {
          throw new FilesystemError(
            'Failed to read responses directory',
            'FILESYSTEM_READ_FAILED',
            'medium',
            {
              operation: 'getResponses',
              component: 'filesystem',
              metadata: { responsesDir: this.responsesDir }
            },
            error instanceof Error ? error : undefined
          );
        }
      },
      {
        operation: 'getResponses',
        component: 'filesystem',
        priority: 'normal'
      }
    );
  }

  /**
   * Clear old responses with resilience
   */
  async clearOldResponses(olderThanHours: number = 24): Promise<number> {
    return await this.resilienceManager.execute(
      async () => {
        try {
          const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
          const files = await fs.readdir(this.responsesDir);
          let deletedCount = 0;
          
          for (const file of files) {
            if (!file.endsWith('.json')) continue;
            
            try {
              const filePath = path.join(this.responsesDir, file);
              const stats = await fs.stat(filePath);
              
              if (stats.mtime.getTime() < cutoffTime) {
                await fs.unlink(filePath);
                deletedCount++;
              }
            } catch (error) {
              secureLog('warn', 'Failed to process response file for cleanup', {
                file,
                error: error instanceof Error ? error.message : 'unknown'
              });
            }
          }
          
          secureLog('info', 'Old responses cleaned up', {
            deleted_count: deletedCount,
            cutoff_hours: olderThanHours
          });
          
          return deletedCount;
          
        } catch (error) {
          throw new FilesystemError(
            'Failed to clear old responses',
            'FILESYSTEM_CLEANUP_FAILED',
            'medium',
            {
              operation: 'clearOldResponses',
              component: 'filesystem',
              metadata: { responsesDir: this.responsesDir, olderThanHours }
            },
            error instanceof Error ? error : undefined
          );
        }
      },
      {
        operation: 'clearOldResponses',
        component: 'filesystem',
        priority: 'low'
      }
    );
  }

  /**
   * Get resilience system status
   */
  async getResilienceStatus() {
    return await this.resilienceManager.getSystemStatus();
  }

  /**
   * Get detailed resilience health report
   */
  async getResilienceHealthReport() {
    return await this.resilienceManager.getHealthReport();
  }

  /**
   * Get resilience metrics
   */
  getResilienceMetrics() {
    return this.resilienceManager.getMetrics();
  }

  /**
   * Shutdown the resilient bridge client
   */
  async shutdown(): Promise<void> {
    try {
      await this.resilienceManager.shutdown();
      secureLog('info', 'Resilient bridge client shutdown completed');
    } catch (error) {
      secureLog('error', 'Error during bridge client shutdown', {
        error: error instanceof Error ? error.message : 'unknown'
      });
      throw error;
    }
  }
}
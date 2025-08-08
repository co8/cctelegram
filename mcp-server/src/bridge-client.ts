import fs from 'fs-extra';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { CCTelegramEvent, BridgeStatus, TelegramResponse, EventType } from './types.js';
import { secureLog, sanitizeForLogging, sanitizePath } from './security.js';
import { getBridgeAxiosConfig, getHttpPool } from './http-pool.js';
import { getFsOptimizer } from './utils/fs-optimizer.js';
import { 
  getGlobalBufferPool, 
  DynamicBufferPool, 
  createMessageProcessor,
  safeBufferConcat,
  type BufferPoolConfig,
  type StreamProcessorOptions
} from './utils/dynamic-buffer-manager.js';

const execAsync = promisify(exec);

export class CCTelegramBridgeClient {
  private eventsDir: string;
  private responsesDir: string;
  private healthEndpoint: string;
  private metricsEndpoint: string;
  
  // Bridge status caching
  private bridgeStatusCache: { running: boolean; timestamp: number } | null = null;
  private readonly CACHE_DURATION_MS = 30000; // 30 seconds
  private isStartingBridge = false; // Prevent concurrent starts
  
  // Dynamic buffer management
  private bufferPool: DynamicBufferPool;

  constructor() {
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

    // Initialize dynamic buffer pool for message handling
    this.bufferPool = getGlobalBufferPool({
      initialPoolSize: 20,
      maxPoolSize: 200,
      bufferSize: 32768, // 32KB buffers for larger messages
      enableMonitoring: true,
      memoryPressureThreshold: 150, // 150MB threshold
      gcInterval: 30000
    });

    // Monitor buffer pool statistics
    this.bufferPool.on('memoryPressure', (data) => {
      secureLog('warn', 'Buffer pool memory pressure detected', {
        heap_used_mb: data.heapUsedMB,
        threshold_mb: data.threshold,
        pool_stats: this.bufferPool.getStats()
      });
    });

    this.bufferPool.on('stats', (stats) => {
      secureLog('debug', 'Buffer pool statistics', stats);
    });
    
    // Ensure directories exist
    this.ensureDirectories();
    
    // Initialize HTTP connection pool
    this.initializeHttpPool();
    
    // Initialize bridge in background (non-blocking)
    this.initializeBridge();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.ensureDir(this.eventsDir);
    await fs.ensureDir(this.responsesDir);
  }

  /**
   * Initialize HTTP connection pool with optimal settings
   */
  private initializeHttpPool(): void {
    try {
      // Initialize the global HTTP pool with default settings
      const pool = getHttpPool();
      secureLog('info', 'HTTP connection pool initialized for bridge communications', {
        pool_types: ['health', 'status', 'polling', 'default'],
        health_endpoint: this.healthEndpoint,
        metrics_endpoint: this.metricsEndpoint
      });
    } catch (error) {
      secureLog('error', 'Failed to initialize HTTP connection pool', {
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      // Continue without connection pooling if initialization fails
    }
  }

  /**
   * Initialize bridge at startup (non-blocking background check)
   */
  private initializeBridge(): void {
    // Run in background without blocking constructor
    setTimeout(async () => {
      try {
        secureLog('info', 'Background bridge initialization check started');
        const isRunning = await this.isBridgeRunning();
        if (!isRunning) {
          secureLog('info', 'Bridge not running at startup, attempting to start');
          await this.ensureBridgeReady();
          secureLog('info', 'Bridge initialization completed');
        } else {
          secureLog('info', 'Bridge already running at startup');
          // Check for source-binary synchronization
          await this.checkBridgeVersionSync();
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
   * Send a structured event to the CC Telegram Bridge
   */
  async sendEvent(event: CCTelegramEvent): Promise<{ success: boolean; event_id: string; file_path: string }> {
    secureLog('info', 'Event send request received', {
      event_type: event.type,
      has_task_id: !!event.task_id
    });
    
    try {
      // CRITICAL: Ensure bridge is running before sending event
      secureLog('debug', 'Ensuring bridge is ready');
      await this.ensureBridgeReady();
      secureLog('debug', 'Bridge confirmed ready');
      
      secureLog('debug', 'Ensuring directories exist');
      await this.ensureDirectories();
      secureLog('debug', 'Directories ensured');
      
      // Generate unique event ID if not provided
      if (!event.task_id) {
        event.task_id = uuidv4();
        secureLog('debug', 'Generated new task_id');
      } else {
        secureLog('debug', 'Using provided task_id');
      }

      // Set timestamp if not provided
      if (!event.timestamp) {
        event.timestamp = new Date().toISOString();
        secureLog('debug', 'Generated timestamp');
      }

      // Create event file with both event_id and task_id for bridge compatibility
      const eventData = {
        ...event,
        event_id: event.task_id // Bridge expects both fields
      };
      
      const fileName = `${event.task_id}_${Date.now()}.json`;
      const filePath = path.join(this.eventsDir, fileName);
      secureLog('debug', 'Writing event to file', {
        file_name: fileName,
        event_type: event.type,
        has_event_id: true
      });
      
      // Use dynamic buffer for efficient JSON serialization
      const jsonString = JSON.stringify(eventData, null, 2);
      const messageSize = Buffer.byteLength(jsonString, 'utf8');
      
      secureLog('debug', 'Message size calculated', {
        size_bytes: messageSize,
        size_kb: Math.round(messageSize / 1024 * 100) / 100
      });
      
      // Use buffer pool for large messages
      if (messageSize > 1024) {
        const buffer = this.bufferPool.acquire(messageSize);
        buffer.write(jsonString, 'utf8');
        await fs.writeFile(filePath, buffer.subarray(0, messageSize));
        this.bufferPool.release(buffer);
        
        secureLog('debug', 'Large message written using dynamic buffer', {
          buffer_pool_stats: this.bufferPool.getStats()
        });
      } else {
        // Use standard method for small messages
        await fs.writeJSON(filePath, eventData, { spaces: 2 });
      }
      
      secureLog('debug', 'File written successfully');
      
      // Verify the file was created
      const exists = await fs.pathExists(filePath);
      secureLog('debug', 'File existence verified', { exists });
      
      if (exists) {
        const stats = await fs.stat(filePath);
        secureLog('debug', 'File stats retrieved', { size_bytes: stats.size });
      }
      
      const result = {
        success: true,
        event_id: event.task_id,
        file_path: filePath
      };
      secureLog('info', 'Event sent successfully', {
        event_id: result.event_id,
        file_created: exists
      });
      return result;
    } catch (error) {
      secureLog('error', 'Failed to send event', {
        event_type: event.type,
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Failed to send event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process large message streams with dynamic buffers and backpressure handling
   */
  async processLargeMessageStream(
    messages: AsyncIterable<CCTelegramEvent>,
    options: StreamProcessorOptions = {}
  ): Promise<{ processed: number; errors: number; totalSize: number }> {
    let processed = 0;
    let errors = 0;
    let totalSize = 0;
    
    const processor = createMessageProcessor({
      maxMessageSize: 10 * 1024 * 1024, // 10MB max per message
      enableBackpressure: true,
      ...options
    }, this.bufferPool);
    
    secureLog('info', 'Starting large message stream processing', {
      max_message_size: 10 * 1024 * 1024,
      buffer_pool_stats: this.bufferPool.getStats()
    });
    
    try {
      for await (const event of messages) {
        try {
          const result = await this.sendEvent(event);
          if (result.success) {
            processed++;
            const eventSize = Buffer.byteLength(JSON.stringify(event), 'utf8');
            totalSize += eventSize;
            
            secureLog('debug', 'Stream event processed', {
              event_id: result.event_id,
              size_bytes: eventSize
            });
          } else {
            errors++;
          }
        } catch (error) {
          errors++;
          secureLog('error', 'Failed to process stream event', {
            error_message: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        
        // Check memory pressure and pause if needed
        const memoryUsage = process.memoryUsage();
        if (memoryUsage.heapUsed > this.bufferPool['config'].memoryPressureThreshold * 1024 * 1024) {
          secureLog('warn', 'Memory pressure during stream processing, pausing', {
            heap_used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024)
          });
          
          // Wait for memory pressure to reduce
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      const result = { processed, errors, totalSize };
      secureLog('info', 'Large message stream processing completed', result);
      return result;
      
    } catch (error) {
      secureLog('error', 'Stream processing failed', {
        processed,
        errors,
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
  
  /**
   * Get buffer pool statistics for monitoring
   */
  getBufferPoolStats() {
    return {
      ...this.bufferPool.getStats(),
      memory_usage: process.memoryUsage()
    };
  }

  /**
   * Send a simple text message as an info notification
   */
  async sendMessage(message: string, source = 'claude-code'): Promise<{ success: boolean; event_id: string }> {
    const event: CCTelegramEvent = {
      type: 'info_notification',
      source,
      timestamp: new Date().toISOString(),
      task_id: uuidv4(),
      title: 'Claude Code Message',
      description: message,
      data: {
        message,
        severity: 'low'
      }
    };

    const result = await this.sendEvent(event);
    return {
      success: result.success,
      event_id: result.event_id
    };
  }

  /**
   * Create a task completion event
   */
  async sendTaskCompletion(
    taskId: string,
    title: string,
    results?: string,
    filesAffected?: string[],
    durationMs?: number
  ): Promise<{ success: boolean; event_id: string }> {
    const event: CCTelegramEvent = {
      type: 'task_completion',
      source: 'claude-code',
      timestamp: new Date().toISOString(),
      task_id: taskId,
      title,
      description: `Task "${title}" completed successfully`,
      data: {
        status: 'completed',
        results,
        files_affected: filesAffected,
        duration_ms: durationMs
      }
    };

    const result = await this.sendEvent(event);
    return {
      success: result.success,
      event_id: result.event_id
    };
  }

  /**
   * Create a performance alert
   */
  async sendPerformanceAlert(
    title: string,
    currentValue: number,
    threshold: number,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): Promise<{ success: boolean; event_id: string }> {
    const event: CCTelegramEvent = {
      type: 'performance_alert',
      source: 'claude-code',
      timestamp: new Date().toISOString(),
      task_id: uuidv4(),
      title,
      description: `Performance threshold exceeded: ${title}`,
      data: {
        current_value: currentValue,
        threshold,
        severity,
        error_message: `${title} is ${currentValue}, which exceeds threshold of ${threshold}`
      }
    };

    const result = await this.sendEvent(event);
    return {
      success: result.success,
      event_id: result.event_id
    };
  }

  /**
   * Send approval request with interactive buttons
   */
  async sendApprovalRequest(
    title: string,
    description: string,
    options: string[] = ['Approve', 'Deny']
  ): Promise<{ success: boolean; event_id: string }> {
    const event: CCTelegramEvent = {
      type: 'approval_request',
      source: 'claude-code',
      timestamp: new Date().toISOString(),
      task_id: uuidv4(),
      title,
      description,
      data: {
        approval_prompt: description,
        options: options,
        requires_response: true,
        response_options: options,
        timeout_minutes: 30
      }
    };

    const result = await this.sendEvent(event);
    return {
      success: result.success,
      event_id: result.event_id
    };
  }

  /**
   * Get bridge status and health
   */
  async getBridgeStatus(): Promise<BridgeStatus> {
    try {
      const healthConfig = getBridgeAxiosConfig('health', this.healthEndpoint);
      const metricsConfig = getBridgeAxiosConfig('health', this.metricsEndpoint);
      
      const healthResponse = await axios.get(this.healthEndpoint, healthConfig);
      const metricsResponse = await axios.get(this.metricsEndpoint, metricsConfig);
      
      const healthData = healthResponse.data;
      const metricsText = metricsResponse.data;
      
      // Parse basic metrics from Prometheus format
      const parseMetric = (name: string): number => {
        const regex = new RegExp(`${name}\\s+(\\d+(?:\\.\\d+)?)`);
        const match = metricsText.match(regex);
        return match ? parseFloat(match[1]) : 0;
      };

      return {
        running: healthResponse.status === 200,
        health: healthData.status || 'healthy',
        metrics: {
          uptime_seconds: parseMetric('process_uptime_seconds') || 0,
          events_processed: parseMetric('events_processed_total') || 0,
          telegram_messages_sent: parseMetric('telegram_messages_sent_total') || 0,
          error_count: parseMetric('errors_total') || 0,
          memory_usage_mb: parseMetric('memory_usage_bytes') / 1024 / 1024 || 0,
          cpu_usage_percent: parseMetric('cpu_usage_percent') || 0
        },
        last_event_time: healthData.last_event_time
      };
    } catch (error) {
      // Record error in connection pool for metrics
      const pool = getHttpPool();
      pool.recordError('health');
      
      return {
        running: false,
        health: 'unhealthy',
        metrics: {
          uptime_seconds: 0,
          events_processed: 0,
          telegram_messages_sent: 0,
          error_count: 0,
          memory_usage_mb: 0,
          cpu_usage_percent: 0
        }
      };
    }
  }

  /**
   * Get user responses from Telegram (optimized with batched file operations)
   */
  async getTelegramResponses(): Promise<TelegramResponse[]> {
    try {
      await this.ensureDirectories();
      
      // DEBUG: Log the directory being accessed
      console.log('DEBUG: Reading responses from:', this.responsesDir);
      
      // Direct file reading using Node.js built-in fs/promises
      const files = await readdir(this.responsesDir);
      console.log('DEBUG: Found files:', files.length);
      
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      console.log('DEBUG: JSON files:', jsonFiles.length);
      
      const responses: TelegramResponse[] = [];
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.responsesDir, file);
          const content = await readFile(filePath, 'utf8');
          const data = JSON.parse(content);
          responses.push(data);
          console.log('DEBUG: Loaded response from:', file);
        } catch (error) {
          console.log('DEBUG: Skip invalid file:', file, error);
          continue;
        }
      }
      
      // Sort by timestamp (newest first)
      responses.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      console.log('DEBUG: Returning', responses.length, 'responses');
      return responses;
    } catch (error) {
      console.warn('Failed to read responses:', error);
      return [];
    }
  }

  /**
   * Clear old response files (optimized with batched file operations)
   */
  async clearOldResponses(olderThanHours = 24): Promise<number> {
    try {
      const fsOptimizer = getFsOptimizer();
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
      
      const { deleted, errors } = await fsOptimizer.batchFileCleanup(
        this.responsesDir,
        (file, stats) => stats.mtime.getTime() < cutoffTime
      );

      // Log any errors but don't fail the operation
      if (errors.length > 0) {
        console.warn(`Failed to delete ${errors.length} files during cleanup:`, 
          errors.map(e => e.file));
      }

      return deleted.length;
    } catch (error) {
      console.warn('Failed to clear old responses:', error);
      return 0;
    }
  }

  /**
   * Process pending approval responses and extract actionable information
   */
  async processPendingResponses(sinceMinutes = 10) {
    try {
      await this.ensureDirectories();
      
      const fsOptimizer = getFsOptimizer();
      const { responses, fileStats } = await fsOptimizer.getResponseFiles(this.responsesDir, {
        sinceMinutes
      });
      
      const actionableResponses = [];
      
      for (const response of responses) {
        // Check if it's an actionable approval/denial response
        if (response.response_type === 'callback_query' && response.callback_data) {
          const callbackData = response.callback_data;
          
          if (callbackData.startsWith('approve_') || callbackData.startsWith('deny_')) {
            const action = callbackData.startsWith('approve_') ? 'approve' : 'deny';
            const taskId = callbackData.replace(/^(approve_|deny_)/, '');
            
            actionableResponses.push({
              action,
              task_id: taskId,
              user_id: response.user_id,
              username: response.username,
              timestamp: response.timestamp,
              response_data: response
            });
          }
        }
      }
      
      return {
        summary: {
          total_recent_responses: responses.length,
          actionable_responses: actionableResponses.length,
          pending_approvals: actionableResponses.filter(r => r.action === 'approve').length,
          pending_denials: actionableResponses.filter(r => r.action === 'deny').length,
          time_window_minutes: sinceMinutes
        },
        actionable_responses: actionableResponses,
        recommendations: actionableResponses.length > 0 ? [
          `Found ${actionableResponses.length} pending approval responses`,
          'Consider implementing automated response handling for these approvals',
          'You may want to process these responses and take appropriate actions'
        ] : [
          'No pending approval responses found in the specified time window',
          'This could mean either no approvals were submitted or they were already processed'
        ]
      };
    } catch (error) {
      console.warn('Failed to process pending responses:', error);
      return {
        summary: {
          total_recent_responses: 0,
          actionable_responses: 0,
          pending_approvals: 0,
          pending_denials: 0,
          time_window_minutes: sinceMinutes
        },
        actionable_responses: [],
        recommendations: ['Error occurred while processing responses'],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check if the bridge process is running
   */
  async isBridgeRunning(): Promise<boolean> {
    try {
      // First try health endpoint
      const statusConfig = getBridgeAxiosConfig('status', this.healthEndpoint);
      const healthResponse = await axios.get(this.healthEndpoint, statusConfig);
      return healthResponse.status === 200;
    } catch (error) {
      // Record error in connection pool for metrics
      const pool = getHttpPool();
      pool.recordError('status');
      
      // If health endpoint fails, check for process
      try {
        const { stdout } = await execAsync('pgrep -f cctelegram-bridge');
        return stdout.trim().length > 0;
      } catch (procError) {
        return false;
      }
    }
  }

  /**
   * Check bridge status with caching to avoid excessive health checks
   */
  private async isBridgeRunningCached(): Promise<boolean> {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.bridgeStatusCache && (now - this.bridgeStatusCache.timestamp) < this.CACHE_DURATION_MS) {
      secureLog('debug', 'Using cached bridge status', { running: this.bridgeStatusCache.running });
      return this.bridgeStatusCache.running;
    }
    
    // Check actual bridge status
    secureLog('debug', 'Cache expired or missing, checking bridge status');
    const isRunning = await this.isBridgeRunning();
    
    // Update cache
    this.bridgeStatusCache = {
      running: isRunning,
      timestamp: now
    };
    
    secureLog('debug', 'Bridge status updated', { running: isRunning });
    return isRunning;
  }

  /**
   * Wait for bridge to be ready by polling health endpoint
   */
  private async waitForBridgeReady(maxWaitMs = 10000): Promise<boolean> {
    const startTime = Date.now();
    const delays = [100, 200, 500, 1000, 2000, 4000]; // Exponential backoff
    let delayIndex = 0;
    
    secureLog('debug', 'Waiting for bridge to be ready');
    
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const pollingConfig = getBridgeAxiosConfig('polling', this.healthEndpoint);
        const healthResponse = await axios.get(this.healthEndpoint, pollingConfig);
        if (healthResponse.status === 200) {
          secureLog('info', 'Bridge is ready');
          return true;
        }
      } catch (error) {
        // Record error in connection pool for metrics
        const pool = getHttpPool();
        pool.recordError('polling');
        
        // Bridge not ready yet, continue waiting
      }
      
      // Wait with exponential backoff
      const delay = delays[Math.min(delayIndex, delays.length - 1)];
      secureLog('debug', 'Bridge not ready, waiting', { delay_ms: delay });
      await new Promise(resolve => setTimeout(resolve, delay));
      delayIndex++;
    }
    
    secureLog('warn', 'Timeout waiting for bridge to be ready', { max_wait_ms: maxWaitMs });
    return false;
  }

  /**
   * Ensure bridge is running, start it if necessary
   */
  private async ensureBridgeReady(): Promise<void> {
    // Prevent concurrent bridge start attempts
    if (this.isStartingBridge) {
      secureLog('info', 'Bridge start already in progress, waiting');
      // Wait for concurrent start to complete
      let attempts = 0;
      while (this.isStartingBridge && attempts < 50) { // Max 5 seconds
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      // Check if bridge is now running
      const isRunning = await this.isBridgeRunningCached();
      if (!isRunning) {
        throw new Error('Bridge failed to start in concurrent operation');
      }
      return;
    }
    
    try {
      // Check if bridge is already running (with cache)
      const isRunning = await this.isBridgeRunningCached();
      if (isRunning) {
        secureLog('info', 'Bridge is already running');
        return;
      }
      
      secureLog('info', 'Bridge not running, attempting to start');
      this.isStartingBridge = true;
      
      // Invalidate cache since we're starting the bridge
      this.bridgeStatusCache = null;
      
      // Attempt to start bridge with retry logic
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        secureLog('info', 'Bridge start attempt', {
          attempt,
          max_attempts: maxAttempts
        });
        
        const startResult = await this.startBridge();
        if (startResult.success) {
          // Wait for bridge to be fully ready
          const isReady = await this.waitForBridgeReady();
          if (isReady) {
            secureLog('info', 'Bridge started and ready');
            return;
          } else {
            secureLog('warn', 'Bridge started but not responding to health checks');
          }
        } else {
          secureLog('warn', 'Bridge start attempt failed', {
            attempt,
            error_message: startResult.message
          });
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          secureLog('info', 'Waiting before retry', { delay_ms: delay });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      throw new Error(`Failed to start bridge after ${maxAttempts} attempts. Check that TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USERS environment variables are set correctly.`);
      
    } finally {
      this.isStartingBridge = false;
    }
  }

  /**
   * Load environment variables from .env files if not already present
   */
  private loadEnvironmentVariables(): { [key: string]: string | undefined } {
    const env = { ...process.env };
    
    secureLog('debug', 'Loading environment variables', {
      telegram_bot_token_present: !!env.TELEGRAM_BOT_TOKEN,
      telegram_allowed_users_present: !!env.TELEGRAM_ALLOWED_USERS
    });
    
    // Always try to load from .env files to ensure we have the latest values
    // (MCP server may not inherit shell environment variables)
    secureLog('debug', 'Checking .env files for environment variables');
    
    // List of .env file paths to check (in order of priority)
    const envFilePaths = [
      // Project directory (where the bridge is built)
      path.join(process.cwd(), '..', '.env'),
      path.join(process.cwd(), '.env'),
      // User's .cc_telegram directory
      path.join(this.eventsDir, '..', '.env'),
      // Home directory
      path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.cc_telegram', '.env')
    ];

    for (const envPath of envFilePaths) {
      try {
        if (fs.existsSync(envPath)) {
          secureLog('debug', 'Found .env file', { path: envPath });
          const result = dotenv.config({ path: envPath });
          
          if (result.parsed) {
            // Merge with existing env, giving priority to .env file values
            Object.assign(env, result.parsed);
            secureLog('debug', 'Loaded variables from .env file', {
              variable_count: Object.keys(result.parsed).length,
              telegram_bot_token_present: !!env.TELEGRAM_BOT_TOKEN,
              telegram_allowed_users_present: !!env.TELEGRAM_ALLOWED_USERS
            });
            
            // Check if we now have the required variables
            if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ALLOWED_USERS) {
              secureLog('info', 'Successfully loaded required environment variables');
              break;
            }
          }
        }
      } catch (error) {
        secureLog('warn', 'Failed to load .env file', {
          path: envPath,
          error_message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Final check
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALLOWED_USERS) {
      secureLog('warn', 'Required environment variables still missing after checking .env files', {
        telegram_bot_token_present: !!env.TELEGRAM_BOT_TOKEN,
        telegram_allowed_users_present: !!env.TELEGRAM_ALLOWED_USERS
      });
    }

    return env;
  }

  /**
   * Find the bridge executable path
   */
  private async findBridgeExecutable(): Promise<string> {
    const possiblePaths = [
      // Built executable in project
      path.join(process.cwd(), 'target', 'release', 'cctelegram-bridge'),
      path.join(process.cwd(), 'target', 'debug', 'cctelegram-bridge'),
      // If running from MCP server directory
      path.join(process.cwd(), '..', 'target', 'release', 'cctelegram-bridge'),
      path.join(process.cwd(), '..', 'target', 'debug', 'cctelegram-bridge'),
      // System-wide installation
      'cctelegram-bridge'
    ];

    for (const bridgePath of possiblePaths) {
      try {
        if (bridgePath === 'cctelegram-bridge') {
          // Check if it's in PATH
          await execAsync('which cctelegram-bridge');
          return bridgePath;
        } else {
          // Check if file exists
          const exists = await fs.pathExists(bridgePath);
          if (exists) {
            return bridgePath;
          }
        }
      } catch (error) {
        // Continue to next path
      }
    }

    throw new Error('CCTelegram Bridge executable not found. Please build the project first.');
  }

  /**
   * Start the bridge process
   */
  async startBridge(): Promise<{ success: boolean; message: string; pid?: number }> {
    try {
      const isRunning = await this.isBridgeRunning();
      if (isRunning) {
        return {
          success: true,
          message: 'Bridge is already running'
        };
      }

      const bridgePath = await this.findBridgeExecutable();
      
      secureLog('info', 'Starting bridge process', { bridge_path: bridgePath });
      
      // Load environment variables from .env files if needed
      const env = this.loadEnvironmentVariables();
      
      // Validate required environment variables
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALLOWED_USERS) {
        return {
          success: false,
          message: 'Bridge failed to start. Check that TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USERS environment variables are set.'
        };
      }
      
      secureLog('info', 'Environment variables loaded for bridge start', {
        bot_token_configured: !!env.TELEGRAM_BOT_TOKEN,
        allowed_users_configured: !!env.TELEGRAM_ALLOWED_USERS
      });
      
      // Start the bridge process in background
      const bridge = spawn(bridgePath, [], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...env,
          // Explicitly set the required variables
          TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
          TELEGRAM_ALLOWED_USERS: env.TELEGRAM_ALLOWED_USERS,
          CC_TELEGRAM_EVENTS_DIR: this.eventsDir,
          CC_TELEGRAM_RESPONSES_DIR: this.responsesDir
        }
      });

      bridge.unref();
      
      // Wait a moment and check if it started successfully
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const nowRunning = await this.isBridgeRunning();
      if (nowRunning) {
        return {
          success: true,
          message: 'Bridge started successfully',
          pid: bridge.pid
        };
      } else {
        return {
          success: false,
          message: 'Bridge failed to start. Check that TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USERS environment variables are set.'
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to start bridge: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Stop the bridge process
   */
  async stopBridge(): Promise<{ success: boolean; message: string }> {
    try {
      const { stdout } = await execAsync('pgrep -f cctelegram-bridge');
      const pids = stdout.trim().split('\n').filter(pid => pid.length > 0);
      
      if (pids.length === 0) {
        return {
          success: true,
          message: 'Bridge is not running'
        };
      }

      // Kill all bridge processes
      for (const pid of pids) {
        try {
          await execAsync(`kill ${pid}`);
        } catch (error) {
          // Process might have already stopped
        }
      }

      // Wait a moment and verify
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const stillRunning = await this.isBridgeRunning();
      if (!stillRunning) {
        return {
          success: true,
          message: `Stopped ${pids.length} bridge process(es)`
        };
      } else {
        // Force kill if graceful stop failed
        for (const pid of pids) {
          try {
            await execAsync(`kill -9 ${pid}`);
          } catch (error) {
            // Process might have already stopped
          }
        }
        
        return {
          success: true,
          message: 'Bridge processes forcefully terminated'
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to stop bridge: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Restart the bridge process
   */
  async restartBridge(): Promise<{ success: boolean; message: string; pid?: number }> {
    try {
      secureLog('info', 'Restarting bridge process');
      
      // Stop the bridge first
      const stopResult = await this.stopBridge();
      if (!stopResult.success) {
        return {
          success: false,
          message: `Failed to stop bridge during restart: ${stopResult.message}`
        };
      }

      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Start the bridge
      const startResult = await this.startBridge();
      return {
        success: startResult.success,
        message: `Restart ${startResult.success ? 'successful' : 'failed'}: ${startResult.message}`,
        pid: startResult.pid
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to restart bridge: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Check if bridge binary is synchronized with source code
   */
  private async checkBridgeVersionSync(): Promise<void> {
    try {
      // Get current git commit
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: path.dirname(process.cwd()) });
      const currentCommit = stdout.trim();
      
      // Try to get bridge version info from health endpoint
      const healthConfig = getBridgeAxiosConfig('health', this.healthEndpoint);
      const response = await axios.get(this.healthEndpoint, healthConfig);
      
      // Look for build info in response (if bridge provides it)
      if (response.data && response.data.build_info) {
        const buildCommit = response.data.build_info.git_hash;
        if (buildCommit && buildCommit !== currentCommit) {
          secureLog('warn', 'Bridge binary may be outdated', {
            binary_commit: buildCommit.substring(0, 8),
            source_commit: currentCommit.substring(0, 8),
            recommendation: 'Consider rebuilding with: cargo build --release'
          });
        }
      }
    } catch (error) {
      // Silent fail - this is just a helpful check
      secureLog('debug', 'Could not check bridge version sync', {
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Ensure bridge is running, start if needed
   */
  async ensureBridgeRunning(): Promise<{ success: boolean; message: string; action: 'already_running' | 'started' | 'failed' }> {
    try {
      const isRunning = await this.isBridgeRunning();
      
      if (isRunning) {
        return {
          success: true,
          message: 'Bridge is already running',
          action: 'already_running'
        };
      }

      const startResult = await this.startBridge();
      return {
        success: startResult.success,
        message: startResult.message,
        action: startResult.success ? 'started' : 'failed'
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to ensure bridge is running: ${error instanceof Error ? error.message : String(error)}`,
        action: 'failed'
      };
    }
  }

  /**
   * List all available event types
   */
  getAvailableEventTypes(): { type: EventType; category: string; description: string }[] {
    return [
      // Task Management
      { type: 'task_completion', category: 'Task Management', description: 'Task completed successfully' },
      { type: 'task_started', category: 'Task Management', description: 'Task started' },
      { type: 'task_failed', category: 'Task Management', description: 'Task failed with error' },
      { type: 'task_progress', category: 'Task Management', description: 'Task progress update' },
      { type: 'task_cancelled', category: 'Task Management', description: 'Task was cancelled' },
      
      // Code Operations
      { type: 'code_generation', category: 'Code Operations', description: 'Code generated or created' },
      { type: 'code_analysis', category: 'Code Operations', description: 'Code analysis completed' },
      { type: 'code_refactoring', category: 'Code Operations', description: 'Code refactoring performed' },
      { type: 'code_review', category: 'Code Operations', description: 'Code review completed' },
      { type: 'code_testing', category: 'Code Operations', description: 'Code testing results' },
      { type: 'code_deployment', category: 'Code Operations', description: 'Code deployment status' },
      
      // Build & Development
      { type: 'build_completed', category: 'Build & Development', description: 'Build process completed' },
      { type: 'build_failed', category: 'Build & Development', description: 'Build process failed' },
      { type: 'test_suite_run', category: 'Build & Development', description: 'Test suite execution' },
      { type: 'lint_check', category: 'Build & Development', description: 'Linting check results' },
      { type: 'type_check', category: 'Build & Development', description: 'Type checking results' },
      
      // System Monitoring
      { type: 'performance_alert', category: 'System Monitoring', description: 'Performance threshold exceeded' },
      { type: 'error_occurred', category: 'System Monitoring', description: 'Error or exception occurred' },
      { type: 'system_health', category: 'System Monitoring', description: 'System health status' },
      
      // User Interaction
      { type: 'approval_request', category: 'User Interaction', description: 'Request user approval' },
      { type: 'user_response', category: 'User Interaction', description: 'User response received' },
      
      // Notifications
      { type: 'info_notification', category: 'Notifications', description: 'General information message' },
      { type: 'alert_notification', category: 'Notifications', description: 'Alert or warning message' },
      { type: 'progress_update', category: 'Notifications', description: 'Progress status update' },
    ];
  }

  /**
   * Get HTTP connection pool statistics
   */
  getHttpPoolStats() {
    try {
      const pool = getHttpPool();
      return pool.getStats();
    } catch (error) {
      secureLog('error', 'Failed to get HTTP pool statistics', {
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Call TaskMaster MCP server directly for live task data (currently disabled due to timeout issues)
   * Falls back to file reading which is faster and more reliable
   */
  private async callTaskMasterMCP(projectPath: string, statusFilter?: string, summaryOnly = false): Promise<any> {
    // For now, skip the MCP call due to timeout issues and go directly to file reading
    // This provides the same live data but much faster
    secureLog('info', 'Using direct file reading for TaskMaster data (faster than MCP call)');
    return null; // Trigger fallback to file reading
  }

  /**
   * Fallback method to read TaskMaster data from files (now the primary method)
   */
  private async getTaskMasterTasksFromFile(projectPath: string, statusFilter?: string, summaryOnly = false): Promise<any> {
    try {
      const taskmasterFile = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
      
      if (!await fs.pathExists(taskmasterFile)) {
        return {
          available: false,
          error: 'TaskMaster file not found. Run task-master init to set up TaskMaster.'
        };
      }

      const taskmasterData = await fs.readJSON(taskmasterFile);
      
      // DEBUG: Log first few characters of the file to verify we're reading the right data
      secureLog('info', 'DEBUG: TaskMaster file content preview', {
        first_100_chars: JSON.stringify(taskmasterData).substring(0, 100),
        has_data_key: !!taskmasterData.data,
        has_tasks_key: !!taskmasterData.tasks,
        has_tags_key: !!taskmasterData.tags
      });
      
      // Handle current TaskMaster format directly
      let tasks = [];
      let stats = { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0, deferred: 0, cancelled: 0, review: 0 };
      let subtasks = { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0, deferred: 0, cancelled: 0 };
      
      if (taskmasterData.tags?.master?.tasks) {
        // Old format
        tasks = taskmasterData.tags.master.tasks;
        stats = this.calculateTaskStats(tasks);
      } else if (Array.isArray(taskmasterData)) {
        // Direct array format
        tasks = taskmasterData;
        stats = this.calculateTaskStats(tasks);
      } else if (taskmasterData.data?.tasks) {
        // Current TaskMaster AI format - extract tasks from data structure
        tasks = taskmasterData.data.tasks || [];
        
        // Use direct stats if available, otherwise calculate
        if (taskmasterData.data.stats) {
          stats = {
            total: taskmasterData.data.stats.total || 0,
            completed: taskmasterData.data.stats.completed || 0,
            inProgress: taskmasterData.data.stats.inProgress || 0,
            pending: taskmasterData.data.stats.pending || 0,
            blocked: taskmasterData.data.stats.blocked || 0,
            deferred: taskmasterData.data.stats.deferred || 0,
            cancelled: taskmasterData.data.stats.cancelled || 0,
            review: taskmasterData.data.stats.review || 0
          };
          
          if (taskmasterData.data.stats.subtasks) {
            subtasks = {
              total: taskmasterData.data.stats.subtasks.total || 0,
              completed: taskmasterData.data.stats.subtasks.completed || 0,
              inProgress: taskmasterData.data.stats.subtasks.inProgress || 0,
              pending: taskmasterData.data.stats.subtasks.pending || 0,
              blocked: taskmasterData.data.stats.subtasks.blocked || 0,
              deferred: taskmasterData.data.stats.subtasks.deferred || 0,
              cancelled: taskmasterData.data.stats.subtasks.cancelled || 0
            };
          }
        } else {
          stats = this.calculateTaskStats(tasks);
        }
      } else {
        // Fallback - calculate stats from whatever tasks we have
        tasks = taskmasterData.tasks || [];
        stats = this.calculateTaskStats(tasks);
      }
      
      secureLog('info', 'TaskMaster data loaded from file', {
        tasks_count: tasks.length,
        main_stats: stats,
        subtask_stats: subtasks,
        project_path: sanitizeForLogging(projectPath)
      });
      
      return {
        tasks,
        stats: {
          ...stats,
          completionPercentage: stats.total > 0 ? (stats.completed / stats.total * 100) : 0,
          subtasks: {
            ...subtasks,
            completionPercentage: subtasks.total > 0 ? (subtasks.completed / subtasks.total * 100) : 0
          }
        }
      };
    } catch (error) {
      secureLog('error', 'Failed to read TaskMaster file', { error: error instanceof Error ? error.message : 'Unknown error', project_path: sanitizeForLogging(projectPath) });
      return {
        available: false,
        error: `Failed to read TaskMaster file: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Calculate task statistics from task array
   */
  private calculateTaskStats(tasks: any[]): { total: number; completed: number; inProgress: number; pending: number; blocked: number; deferred: number; cancelled: number; review: number } {
    const stats = { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0, deferred: 0, cancelled: 0, review: 0 };
    
    const countTask = (task: any) => {
      stats.total++;
      switch (task.status) {
        case 'done':
        case 'completed':
          stats.completed++;
          break;
        case 'in-progress':
        case 'in_progress':
          stats.inProgress++;
          break;
        case 'pending':
          stats.pending++;
          break;
        case 'blocked':
          stats.blocked++;
          break;
        case 'deferred':
          stats.deferred++;
          break;
        case 'cancelled':
          stats.cancelled++;
          break;
        case 'review':
          stats.review++;
          break;
      }
      
      // Count subtasks
      if (task.subtasks && Array.isArray(task.subtasks)) {
        task.subtasks.forEach(countTask);
      }
    };
    
    tasks.forEach(countTask);
    return stats;
  }

  /**
   * Get TaskMaster tasks via MCP tool (for real task count with subtasks)
   */
  private async getTaskMasterTasks(projectPath: string, statusFilter?: string, summaryOnly = false): Promise<any> {
    try {
      // Call TaskMaster MCP tool directly for live data
      const mcpTaskData = await this.callTaskMasterMCP(projectPath, statusFilter, summaryOnly);
      
      // If TaskMaster MCP call failed, use fallback to file reading
      if (!mcpTaskData) {
        return await this.getTaskMasterTasksFromFile(projectPath, statusFilter, summaryOnly);
      }

      // Handle case where TaskMaster returned error
      if (mcpTaskData.available === false) {
        return mcpTaskData;
      }
      
      // Flatten all tasks including subtasks for accurate count
      const allTasks = this.flattenTasksWithSubtasks(mcpTaskData.tasks || []);
      
      let filteredTasks = allTasks;
      if (statusFilter) {
        filteredTasks = allTasks.filter((task: any) => task.status === statusFilter);
      }

      // Generate summary from actual flattened task data
      const taskSummary = {
        pending: mcpTaskData.stats.pending + (mcpTaskData.stats.subtasks?.pending || 0),
        in_progress: mcpTaskData.stats.inProgress + (mcpTaskData.stats.subtasks?.inProgress || 0),
        completed: mcpTaskData.stats.completed + (mcpTaskData.stats.subtasks?.completed || 0),
        blocked: mcpTaskData.stats.blocked + (mcpTaskData.stats.subtasks?.blocked || 0)
      };
      
      const result: any = {
        available: true,
        source: 'TaskMaster Live MCP Call',
        current_tag: 'master',
        project_name: 'CCTelegram Project',
        total_count: mcpTaskData.stats.total + (mcpTaskData.stats.subtasks?.total || 0),
        filtered_count: filteredTasks.length,
        main_tasks_count: mcpTaskData.stats.total,
        subtasks_count: mcpTaskData.stats.subtasks?.total || 0,
        summary: taskSummary
      };

      if (!summaryOnly) {
        result.tasks = filteredTasks.map((task: any) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          estimated_hours: task.estimatedHours,
          tags: task.tags,
          dependencies: task.dependencies,
          parent_id: task.parent_id || null,
          is_subtask: !!task.parent_id
        }));
      }

      return result;
    } catch (error) {
      secureLog('error', 'Failed to get TaskMaster tasks', { error: error instanceof Error ? error.message : 'Unknown error' });
      // Return fallback instead of throwing
      return await this.getTaskMasterTasksFromFile(projectPath, statusFilter, summaryOnly);
    }
  }

  /**
   * Flatten tasks including all subtasks for accurate counting
   */
  private flattenTasksWithSubtasks(tasks: any[]): any[] {
    const flattened: any[] = [];
    
    for (const task of tasks) {
      // Add the main task
      flattened.push(task);
      
      // Add all subtasks recursively
      if (task.subtasks && Array.isArray(task.subtasks)) {
        for (const subtask of task.subtasks) {
          flattened.push({
            ...subtask,
            id: `${task.id}.${subtask.id}`, // Create proper subtask ID
            parent_id: task.id
          });
        }
      }
    }
    
    return flattened;
  }

  // Storage for registered Claude Code todos
  private claudeTodosStorage: Map<string, { todos: any[], timestamp: number }> = new Map();

  /**
   * Register Claude Code todos for the current session
   */
  async registerClaudeTodos(todos: any[], sessionId: string = 'default'): Promise<{
    success: boolean;
    message: string;
    registered_count: number;
    session_id: string;
  }> {
    try {
      // Validate todos array
      if (!Array.isArray(todos)) {
        return {
          success: false,
          message: 'Todos must be an array',
          registered_count: 0,
          session_id: sessionId
        };
      }

      // Validate each todo item
      for (const todo of todos) {
        if (!todo.id || !todo.content || !todo.status) {
          return {
            success: false,
            message: 'Each todo must have id, content, and status fields',
            registered_count: 0,
            session_id: sessionId
          };
        }
      }

      // Store todos in memory
      this.claudeTodosStorage.set(sessionId, {
        todos: todos,
        timestamp: Date.now()
      });

      // Also try to write to temporary file as backup
      try {
        const tempTodoPath = path.join(process.env.TMPDIR || '/tmp', 'claude_current_session_todos.json');
        await fs.writeJSON(tempTodoPath, {
          session_id: sessionId,
          todos: todos,
          timestamp: new Date().toISOString()
        });
      } catch (fileError) {
        secureLog('debug', 'Failed to write todos to temporary file', { error: fileError instanceof Error ? fileError.message : 'Unknown error' });
      }

      secureLog('info', 'Successfully registered Claude Code todos', { 
        sessionId, 
        todoCount: todos.length,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        message: `Successfully registered ${todos.length} todos for session ${sessionId}`,
        registered_count: todos.length,
        session_id: sessionId
      };

    } catch (error) {
      secureLog('error', 'Failed to register Claude Code todos', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId 
      });
      
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        registered_count: 0,
        session_id: sessionId
      };
    }
  }

  /**
   * Get in-memory Claude Code todos by accessing MCP session state
   */
  private async getInMemoryClaudeTodos(): Promise<{ tasks: any[] }> {
    try {
      // First, try to get from registered todos storage (highest priority)
      const defaultSession = this.claudeTodosStorage.get('default');
      if (defaultSession && defaultSession.todos.length > 0) {
        // Check if data is not too old (within 1 hour)
        const oneHour = 60 * 60 * 1000;
        if (Date.now() - defaultSession.timestamp < oneHour) {
          return { tasks: defaultSession.todos };
        }
      }

      // Try to access global MCP session state if available
      if (typeof global !== 'undefined' && global.__claude_mcp_session) {
        const session = global.__claude_mcp_session;
        if (session.todos && Array.isArray(session.todos)) {
          return { tasks: session.todos };
        }
      }
      
      // Try environment variable approach for passing todos
      const todosEnv = process.env.CLAUDE_CURRENT_TODOS;
      if (todosEnv) {
        try {
          const todos = JSON.parse(todosEnv);
          if (Array.isArray(todos)) {
            return { tasks: todos };
          }
        } catch (e) {
          secureLog('debug', 'Failed to parse CLAUDE_CURRENT_TODOS environment variable', { error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
      
      // Try reading from a temporary bridge file
      const tempTodoPath = path.join(process.env.TMPDIR || '/tmp', 'claude_current_session_todos.json');
      if (await fs.pathExists(tempTodoPath)) {
        try {
          const todoData = await fs.readJSON(tempTodoPath);
          if (this.isValidTodoData(todoData)) {
            const todos = Array.isArray(todoData) ? todoData : todoData.tasks || [];
            return { tasks: todos };
          }
        } catch (e) {
          secureLog('debug', 'Failed to read temporary todo bridge file', { path: tempTodoPath, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
      
      return { tasks: [] };
    } catch (error) {
      secureLog('debug', 'Error accessing in-memory todos', { error: error instanceof Error ? error.message : 'Unknown error' });
      return { tasks: [] };
    }
  }

  /**
   * Get live Claude Code session tasks with enhanced detection mechanisms
   * Now supports both file-based and in-memory todo access
   */
  private async getLiveClaudeCodeTasks(projectPath: string): Promise<any> {
    const attempted_sources: string[] = [];
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';

    // First, try to access in-memory todos through MCP bridge mechanism
    try {
      const inMemoryTodos = await this.getInMemoryClaudeTodos();
      if (inMemoryTodos.tasks.length > 0) {
        return {
          tasks: inMemoryTodos.tasks,
          source: 'in-memory-session',
          session_active: true,
          last_updated: new Date().toISOString(),
          attempted_sources: ['in-memory-claude-session']
        };
      }
    } catch (error) {
      // Fall back to file-based detection if in-memory access fails
      secureLog('debug', 'In-memory todo access failed, falling back to file search', { error: error instanceof Error ? error.message : 'Unknown error' });
    }

    // Fallback to file-based detection
    // Enhanced search for Claude Code session data
    const todoSearchPaths = [
      // Project-specific locations
      path.join(projectPath, '.claude', 'session', 'todos.json'),
      path.join(projectPath, '.claude', 'todos.json'),
      path.join(projectPath, '.cc_todos.json'),
      path.join(projectPath, '.claude_session.json'),
      
      // User global locations
      path.join(homeDir, '.claude', 'session', 'current_todos.json'),
      path.join(homeDir, '.claude', 'todos.json'),
      path.join(homeDir, '.cc_telegram', 'session_todos.json'),
      
      // Temporary session locations
      '/tmp/claude_code_session.json',
      path.join(process.env.TMPDIR || '/tmp', 'claude_todos.json')
    ];

    const fsOptimizer = getFsOptimizer();
    const pathExistsMap = await fsOptimizer.batchPathExists(todoSearchPaths);
    
    let mostRecentTodos: any = null;
    let mostRecentTime = 0;
    let bestSource = 'unknown';

    // Check all possible todo locations and find the most recent one
    for (const todoPath of todoSearchPaths) {
      attempted_sources.push(todoPath);
      
      if (pathExistsMap.get(todoPath)) {
        try {
          const stats = await fs.stat(todoPath);
          const mtime = stats.mtime.getTime();
          
          if (mtime > mostRecentTime) {
            const todoData = await fs.readJSON(todoPath);
            
            // Validate that this looks like todo data
            if (this.isValidTodoData(todoData)) {
              mostRecentTodos = todoData;
              mostRecentTime = mtime;
              bestSource = todoPath;
            }
          }
        } catch (error) {
          // Continue to next path on error
          secureLog('debug', 'Failed to read todo file', {
            path: sanitizePath(todoPath),
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    // Try to detect active Claude Code process and extract todos
    if (!mostRecentTodos) {
      try {
        const activeTodos = await this.detectActiveClaudeCodeTodos();
        if (activeTodos) {
          mostRecentTodos = activeTodos;
          bestSource = 'active_process';
          mostRecentTime = Date.now();
        }
      } catch (error) {
        secureLog('debug', 'Failed to detect active Claude Code todos', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    if (mostRecentTodos) {
      return {
        tasks: Array.isArray(mostRecentTodos) ? mostRecentTodos : mostRecentTodos.tasks || [],
        source: bestSource,
        session_active: mostRecentTime > (Date.now() - 300000), // Active if updated within 5 minutes
        last_updated: new Date(mostRecentTime).toISOString(),
        attempted_sources: attempted_sources.slice(0, 5) // Limit logged paths
      };
    }

    return {
      tasks: [],
      source: 'none',
      session_active: false,
      last_updated: null,
      attempted_sources: attempted_sources.slice(0, 5)
    };
  }

  /**
   * Validate that data structure looks like valid todo data
   */
  private isValidTodoData(data: any): boolean {
    if (!data) return false;
    
    // Handle both array format and object with tasks property
    const tasks = Array.isArray(data) ? data : data.tasks;
    if (!Array.isArray(tasks)) return false;
    
    // Check if tasks have expected properties
    return tasks.length === 0 || (
      tasks.some((task: any) => 
        task && 
        typeof task === 'object' && 
        (task.content || task.title || task.description)
      )
    );
  }

  /**
   * Try to detect active Claude Code session todos from process information
   */
  private async detectActiveClaudeCodeTodos(): Promise<any> {
    try {
      // Look for Claude Code process environment or temp files
      const { stdout } = await execAsync('pgrep -f "claude" || true').catch(() => ({ stdout: '' }));
      
      if (stdout.trim()) {
        // Try to find recently modified files that might contain session state
        const tempDir = process.env.TMPDIR || '/tmp';
        const recentFiles = await fs.readdir(tempDir).catch(() => []);
        
        for (const file of recentFiles) {
          if (file.includes('claude') && file.includes('todo')) {
            try {
              const filePath = path.join(tempDir, file);
              const stats = await fs.stat(filePath);
              
              // If modified within last 10 minutes
              if (Date.now() - stats.mtime.getTime() < 600000) {
                const data = await fs.readJSON(filePath);
                if (this.isValidTodoData(data)) {
                  return data;
                }
              }
            } catch (error) {
              // Continue checking other files
            }
          }
        }
      }
    } catch (error) {
      // Process detection failed, return null
    }
    
    return null;
  }

  /**
   * Generate task summary from task array
   */
  private generateTaskSummary(tasks: any[]): { pending: number; in_progress: number; completed: number; blocked: number } {
    const statusCounts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      blocked: 0
    };

    for (const task of tasks) {
      if (task.status && statusCounts.hasOwnProperty(task.status)) {
        statusCounts[task.status as keyof typeof statusCounts]++;
      }
    }

    return statusCounts;
  }

  /**
   * Generate combined task summary from multiple task systems
   */
  private generateCombinedTaskSummary(
    claudeSummary?: { pending: number; in_progress: number; completed: number; blocked: number },
    taskmasterSummary?: { pending: number; in_progress: number; completed: number; blocked: number }
  ): any {
    const defaultSummary = { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
    const claude = claudeSummary || defaultSummary;
    const taskmaster = taskmasterSummary || defaultSummary;
    
    const combined = {
      total_pending: claude.pending + taskmaster.pending,
      total_in_progress: claude.in_progress + taskmaster.in_progress,
      total_completed: claude.completed + taskmaster.completed,
      total_blocked: claude.blocked + taskmaster.blocked
    };

    // Calculate totals dynamically
    const claudeTotal = Object.values(claude).reduce((sum, count) => sum + count, 0);
    const taskmasterTotal = Object.values(taskmaster).reduce((sum, count) => sum + count, 0);
    
    return {
      ...combined,
      grand_total: claudeTotal + taskmasterTotal,
      breakdown: {
        claude_code: {
          ...claude,
          total: claudeTotal
        },
        taskmaster: {
          ...taskmaster,
          total: taskmasterTotal
        }
      }
    };
  }

  /**
   * Get task status from Claude Code session tasks and/or TaskMaster project tasks
   */
  async getTaskStatus(
    projectRoot?: string, 
    taskSystem: 'claude-code' | 'taskmaster' | 'both' = 'both',
    statusFilter?: string,
    summaryOnly: boolean = false
  ): Promise<any> {
    try {
      const result: any = {
        timestamp: new Date().toISOString(),
        task_system: taskSystem,
        status_filter: statusFilter || 'all',
        summary_only: summaryOnly
      };

      // Determine project root
      const projectPath = projectRoot || process.cwd();
      
      // Get Claude Code session tasks (enhanced live session detection)
      if (taskSystem === 'claude-code' || taskSystem === 'both') {
        try {
          const claudeTasks = await this.getLiveClaudeCodeTasks(projectPath);
          
          if (claudeTasks && claudeTasks.tasks && claudeTasks.tasks.length > 0) {
            let filteredTasks = claudeTasks.tasks;
            if (statusFilter) {
              filteredTasks = claudeTasks.tasks.filter((task: any) => task.status === statusFilter);
            }

            result.claude_code_tasks = {
              available: true,
              source: claudeTasks.source || 'live_session',
              session_active: claudeTasks.session_active || false,
              last_updated: claudeTasks.last_updated,
              total_count: claudeTasks.tasks.length,
              filtered_count: filteredTasks.length,
              summary: this.generateTaskSummary(claudeTasks.tasks)
            };

            if (!summaryOnly) {
              result.claude_code_tasks.tasks = filteredTasks;
            }
          } else {
            result.claude_code_tasks = {
              available: false,
              session_active: false,
              message: 'No Claude Code session tasks found. Tasks may be managed in-memory or session may be inactive.',
              attempted_sources: claudeTasks?.attempted_sources || []
            };
          }
        } catch (error) {
          result.claude_code_tasks = {
            available: false,
            session_active: false,
            error: error instanceof Error ? error.message : 'Unknown error accessing Claude Code tasks'
          };
        }
      }

      // Get TaskMaster project tasks via MCP tool
      if (taskSystem === 'taskmaster' || taskSystem === 'both') {
        try {
          const taskmasterData = await this.getTaskMasterTasks(projectPath, statusFilter, summaryOnly);
          result.taskmaster_tasks = taskmasterData;
        } catch (error) {
          result.taskmaster_tasks = {
            available: false,
            error: error instanceof Error ? error.message : 'Unknown error accessing TaskMaster tasks via MCP'
          };
        }
      }

      // Generate combined summary if both systems are queried
      if (taskSystem === 'both') {
        result.combined_summary = this.generateCombinedTaskSummary(
          result.claude_code_tasks?.summary,
          result.taskmaster_tasks?.summary
        );
      }

      secureLog('info', 'Task status retrieved', {
        task_system: taskSystem,
        project_path: sanitizeForLogging(projectPath),
        has_claude_tasks: result.claude_code_tasks?.available || false,
        has_taskmaster_tasks: result.taskmaster_tasks?.available || false
      });

      return result;
    } catch (error) {
      secureLog('error', 'Failed to get task status', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        task_system: taskSystem,
        project_root: sanitizeForLogging(projectRoot || process.cwd())
      });
      
      throw error;
    }
  }

  /**
   * Generate formatted todo display with live Claude Code session integration
   */
  async getTodoDisplay(
    projectRoot?: string,
    taskSystem: 'claude-code' | 'taskmaster' | 'both' = 'both', // Changed default to 'both'
    sections: string[] = ['current', 'upcoming', 'completed'],
    limitCompleted: number = 5,
    showSubtasks: boolean = true
  ): Promise<string> {
    try {
      // Get all tasks from both systems
      const taskData = await this.getTaskStatus(projectRoot, taskSystem, undefined, false);
      
      const lines: string[] = [];
      const timestamp = new Date().toLocaleTimeString();
      
      // Header with live session status
      lines.push('# 📋 Live Todo Dashboard');
      lines.push(`*Last updated: ${timestamp}*`);
      
      // Show session status if available
      if (taskData.claude_code_tasks?.available) {
        const sessionIcon = taskData.claude_code_tasks.session_active ? '🟢 LIVE' : '🟡 CACHED';
        const lastUpdate = taskData.claude_code_tasks.last_updated 
          ? new Date(taskData.claude_code_tasks.last_updated).toLocaleTimeString()
          : 'unknown';
        lines.push(`*${sessionIcon} Claude Code Session (${lastUpdate})*`);
      }
      
      lines.push('');

      // Helper function to format task with system badge and status
      const formatTask = (task: any, indent: string = '', system: string = '') => {
        const statusIcon = this.getStatusIcon(task.status);
        const systemBadge = system ? ` \`${system}\`` : '';
        const priorityBadge = task.priority ? ` [${task.priority.toUpperCase()}]` : '';
        const title = task.title || task.content || task.description || 'Untitled Task';
        return `${indent}${statusIcon} **${title}**${systemBadge}${priorityBadge}`;
      };

      // Process each section with data from both systems
      for (const section of sections) {
        const allSectionTasks = this.getCombinedSectionTasks(taskData, section, limitCompleted);
        
        if (allSectionTasks.length === 0) continue;

        lines.push(`## ${this.getSectionTitle(section)} (${allSectionTasks.length})`);
        lines.push('');

        for (const taskGroup of allSectionTasks) {
          lines.push(formatTask(taskGroup.task, '', taskGroup.system));
          
          // Show subtasks for TaskMaster tasks
          if (showSubtasks && taskGroup.task.subtasks && taskGroup.task.subtasks.length > 0) {
            for (const subtask of taskGroup.task.subtasks) {
              lines.push(formatTask(subtask, '  → ', taskGroup.system));
            }
          }
          
          // Show task details if from Claude Code session
          if (taskGroup.system === 'Claude' && taskGroup.task.details) {
            lines.push(`  *${taskGroup.task.details.substring(0, 100)}...*`);
          }
          
          lines.push('');
        }
      }

      // Enhanced summary with both systems
      lines.push('---');
      lines.push('## 📊 Live Summary');
      
      // Claude Code session summary
      if (taskData.claude_code_tasks?.available && taskData.claude_code_tasks.summary) {
        const ccSummary = taskData.claude_code_tasks.summary;
        lines.push('### 🎯 Claude Code Session');
        lines.push(`• **Active:** ${ccSummary.in_progress || 0} | **Pending:** ${ccSummary.pending || 0} | **Done:** ${ccSummary.completed || 0}`);
      }
      
      // TaskMaster summary
      if (taskData.taskmaster_tasks?.summary) {
        const tmSummary = taskData.taskmaster_tasks.summary;
        lines.push('### 📋 TaskMaster Project');
        lines.push(`• **Active:** ${tmSummary.in_progress || 0} | **Pending:** ${tmSummary.pending || 0} | **Done:** ${tmSummary.completed || 0}`);
        if (tmSummary.blocked > 0) {
          lines.push(`• **Blocked:** ${tmSummary.blocked}`);
        }
      }
      
      // Combined totals
      if (taskData.combined_summary) {
        const combined = taskData.combined_summary;
        lines.push('### 🔄 Combined Total');
        lines.push(`• **All Active:** ${combined.in_progress || 0} | **All Pending:** ${combined.pending || 0} | **All Done:** ${combined.completed || 0}`);
      }

      // Add quick commands reminder
      lines.push('');
      lines.push('---');
      lines.push('**Quick Commands:** `/tasks` • `/bridge` • `/todo`');

      return lines.join('\n');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return `❌ **Todo Dashboard Error**\n\n${errorMsg}\n\n💡 Try \`/bridge\` to check system status`;
    }
  }

  /**
   * Combine tasks from both Claude Code session and TaskMaster for a specific section
   */
  private getCombinedSectionTasks(taskData: any, section: string, limitCompleted: number): Array<{task: any, system: string}> {
    const combinedTasks: Array<{task: any, system: string}> = [];
    
    // Get Claude Code session tasks
    if (taskData.claude_code_tasks?.available && taskData.claude_code_tasks.tasks) {
      const claudeTasks = this.filterTasksBySection(taskData.claude_code_tasks.tasks, section, limitCompleted);
      for (const task of claudeTasks) {
        combinedTasks.push({ task, system: 'Claude' });
      }
    }
    
    // Get TaskMaster tasks
    if (taskData.taskmaster_tasks?.tasks) {
      const taskmasterTasks = this.filterTasksBySection(taskData.taskmaster_tasks.tasks, section, limitCompleted);
      for (const task of taskmasterTasks) {
        combinedTasks.push({ task, system: 'TaskMaster' });
      }
    }
    
    // Sort by priority and status for better display
    return combinedTasks.sort((a, b) => {
      // Prioritize in_progress tasks
      if (a.task.status === 'in_progress' && b.task.status !== 'in_progress') return -1;
      if (b.task.status === 'in_progress' && a.task.status !== 'in_progress') return 1;
      
      // Then by priority if available
      const aPriority = this.getPriorityValue(a.task.priority);
      const bPriority = this.getPriorityValue(b.task.priority);
      if (aPriority !== bPriority) return bPriority - aPriority; // Higher priority first
      
      // Finally by system (Claude Code session first for current work)
      if (section === 'current' && a.system === 'Claude' && b.system !== 'Claude') return -1;
      if (section === 'current' && b.system === 'Claude' && a.system !== 'Claude') return 1;
      
      return 0;
    });
  }

  /**
   * Filter tasks by section type
   */
  private filterTasksBySection(tasks: any[], section: string, limitCompleted: number): any[] {
    let filtered: any[] = [];
    
    switch (section) {
      case 'completed':
        filtered = tasks.filter((task: any) => 
          task.status === 'completed' || task.status === 'done'
        ).slice(-limitCompleted); // Most recent completed
        break;
      case 'current':
        filtered = tasks.filter((task: any) => 
          task.status === 'in_progress' || task.status === 'in-progress'
        );
        break;
      case 'upcoming':
        filtered = tasks.filter((task: any) => 
          task.status === 'pending'
        );
        break;
      case 'blocked':
        filtered = tasks.filter((task: any) => 
          task.status === 'blocked'
        );
        break;
      default:
        filtered = tasks.filter((task: any) => task.status === section);
    }
    
    return filtered;
  }

  /**
   * Convert priority string to numeric value for sorting
   */
  private getPriorityValue(priority?: string): number {
    switch (priority?.toLowerCase()) {
      case 'high': case 'urgent': return 3;
      case 'medium': case 'normal': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }

  /**
   * Get status icon for task status
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'completed': 
      case 'done':
        return '✅';
      case 'in_progress':
      case 'in-progress':
        return '🔄';
      case 'pending':
        return '📋';
      case 'blocked':
        return '🚧';
      default:
        return '❓';
    }
  }

  /**
   * Get section title with emoji
   */
  private getSectionTitle(section: string): string {
    switch (section) {
      case 'completed':
        return '✅ Completed Tasks';
      case 'current':
        return '🔄 Current Work';
      case 'upcoming':
        return '📋 Upcoming Tasks';
      case 'blocked':
        return '🚧 Blocked Tasks';
      default:
        return `📄 ${section.charAt(0).toUpperCase()}${section.slice(1)} Tasks`;
    }
  }


  /**
   * Switch bridge to nomad mode (remote mode)
   */
  async switchToNomadMode(): Promise<{ success: boolean; message: string; mode: string }> {
    try {
      const event: CCTelegramEvent = {
        type: 'info_notification',
        source: 'claude-code',
        timestamp: new Date().toISOString(),
        task_id: uuidv4(),
        title: 'Mode Switch Request',
        description: '/cct:nomad',
        data: { 
          command: '/cct:nomad',
          requested_mode: 'nomad'
        }
      };

      const result = await this.sendEvent(event);
      
      if (result.success) {
        secureLog('info', 'Nomad mode switch requested via bridge', {
          event_id: result.event_id
        });
        
        return {
          success: true,
          message: '📱 Switched to nomad mode! CCTelegram will now provide full bidirectional communication via Telegram.',
          mode: 'nomad'
        };
      } else {
        throw new Error('Failed to send nomad mode switch command to bridge');
      }
    } catch (error) {
      secureLog('error', 'Failed to switch to nomad mode', {
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        success: false,
        message: `Failed to switch to nomad mode: ${error instanceof Error ? error.message : 'Unknown error'}`,
        mode: 'unknown'
      };
    }
  }

  /**
   * Switch bridge to local mode
   */
  async switchToLocalMode(): Promise<{ success: boolean; message: string; mode: string }> {
    try {
      const event: CCTelegramEvent = {
        type: 'info_notification',
        source: 'claude-code',
        timestamp: new Date().toISOString(),
        task_id: uuidv4(),
        title: 'Mode Switch Request',
        description: '/cct:local',
        data: { 
          command: '/cct:local',
          requested_mode: 'local'
        }
      };

      const result = await this.sendEvent(event);
      
      if (result.success) {
        secureLog('info', 'Local mode switch requested via bridge', {
          event_id: result.event_id
        });
        
        return {
          success: true,
          message: '🏠 Switched to local mode! CCTelegram will now use minimal Telegram responses for local development.',
          mode: 'local'
        };
      } else {
        throw new Error('Failed to send local mode switch command to bridge');
      }
    } catch (error) {
      secureLog('error', 'Failed to switch to local mode', {
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        success: false,
        message: `Failed to switch to local mode: ${error instanceof Error ? error.message : 'Unknown error'}`,
        mode: 'unknown'
      };
    }
  }

  async switchToMuteMode(): Promise<{ success: boolean; message: string; mode: string }> {
    try {
      const event: CCTelegramEvent = {
        type: 'info_notification',
        source: 'claude-code',
        timestamp: new Date().toISOString(),
        task_id: uuidv4(),
        title: 'Mode Switch Request',
        description: '/cct:mute',
        data: { 
          command: '/cct:mute',
          requested_mode: 'muted'
        }
      };

      const result = await this.sendEvent(event);
      
      if (result.success) {
        secureLog('info', 'Mute mode switch requested via bridge', {
          event_id: result.event_id
        });
        
        return {
          success: true,
          message: '🔇 Switched to mute mode! All Telegram messaging has been disabled.',
          mode: 'muted'
        };
      } else {
        throw new Error('Failed to send mute mode switch command to bridge');
      }
    } catch (error) {
      secureLog('error', 'Failed to switch to mute mode', {
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        success: false,
        message: `Failed to switch to mute mode: ${error instanceof Error ? error.message : 'Unknown error'}`,
        mode: 'unknown'
      };
    }
  }
}
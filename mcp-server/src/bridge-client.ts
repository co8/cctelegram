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
      
      await fs.writeJSON(filePath, eventData, { spaces: 2 });
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
      
      // Get Claude Code session tasks (if available through environment or files)
      if (taskSystem === 'claude-code' || taskSystem === 'both') {
        try {
          // Check for Claude Code todo files in common locations (optimized batch check)
          const possibleTodoPaths = [
            path.join(projectPath, '.claude', 'todos.json'),
            path.join(process.env.HOME || '/tmp', '.claude', 'todos.json'),
            path.join(projectPath, '.cc_todos.json')
          ];

          const fsOptimizer = getFsOptimizer();
          const pathExistsMap = await fsOptimizer.batchPathExists(possibleTodoPaths);
          
          let claudeTasks = null;
          for (const todoPath of possibleTodoPaths) {
            if (pathExistsMap.get(todoPath)) {
              try {
                claudeTasks = await fs.readJSON(todoPath);
                break;
              } catch (error) {
                // Continue to next path
              }
            }
          }

          if (claudeTasks) {
            let filteredTasks = claudeTasks;
            if (statusFilter) {
              filteredTasks = claudeTasks.filter((task: any) => task.status === statusFilter);
            }

            result.claude_code_tasks = {
              available: true,
              source: 'session_todos',
              total_count: claudeTasks.length,
              filtered_count: filteredTasks.length,
              summary: this.generateTaskSummary(claudeTasks)
            };

            if (!summaryOnly) {
              result.claude_code_tasks.tasks = filteredTasks;
            }
          } else {
            result.claude_code_tasks = {
              available: false,
              message: 'No Claude Code session tasks found. Tasks may be managed in-memory or not yet persisted.'
            };
          }
        } catch (error) {
          result.claude_code_tasks = {
            available: false,
            error: error instanceof Error ? error.message : 'Unknown error accessing Claude Code tasks'
          };
        }
      }

      // Get TaskMaster project tasks
      if (taskSystem === 'taskmaster' || taskSystem === 'both') {
        try {
          const tasksJsonPath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
          
          if (await fs.pathExists(tasksJsonPath)) {
            const tasksData = await fs.readJSON(tasksJsonPath);
            
            // Extract tasks from the current tag (usually 'master')
            const currentTag = Object.keys(tasksData.tags)[0] || 'master';
            const allTasks = tasksData.tags[currentTag]?.tasks || [];
            
            let filteredTasks = allTasks;
            if (statusFilter) {
              filteredTasks = allTasks.filter((task: any) => task.status === statusFilter);
            }

            result.taskmaster_tasks = {
              available: true,
              source: tasksJsonPath,
              current_tag: currentTag,
              project_name: tasksData.metadata?.projectName || 'Unknown',
              total_count: allTasks.length,
              filtered_count: filteredTasks.length,
              summary: this.generateTaskSummary(allTasks)
            };

            if (!summaryOnly) {
              result.taskmaster_tasks.tasks = filteredTasks.map((task: any) => ({
                id: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                estimated_hours: task.estimatedHours,
                tags: task.tags,
                dependencies: task.dependencies
              }));
            }
          } else {
            result.taskmaster_tasks = {
              available: false,
              message: 'No TaskMaster tasks found. Project may not be initialized with TaskMaster.',
              expected_path: tasksJsonPath
            };
          }
        } catch (error) {
          result.taskmaster_tasks = {
            available: false,
            error: error instanceof Error ? error.message : 'Unknown error accessing TaskMaster tasks'
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
}
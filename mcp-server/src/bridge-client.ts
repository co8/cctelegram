import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { CCTelegramEvent, BridgeStatus, TelegramResponse, EventType } from './types.js';

const execAsync = promisify(exec);

export class CCTelegramBridgeClient {
  private eventsDir: string;
  private responsesDir: string;
  private healthEndpoint: string;
  private metricsEndpoint: string;

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
    this.eventsDir = process.env.CC_TELEGRAM_EVENTS_DIR || path.join(homeDir, '.cc_telegram', 'events');
    this.responsesDir = process.env.CC_TELEGRAM_RESPONSES_DIR || path.join(homeDir, '.cc_telegram', 'responses');
    
    const healthPort = process.env.CC_TELEGRAM_HEALTH_PORT || '8080';
    this.healthEndpoint = `http://localhost:${healthPort}/health`;
    this.metricsEndpoint = `http://localhost:${healthPort}/metrics`;

    // Ensure directories exist
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.ensureDir(this.eventsDir);
    await fs.ensureDir(this.responsesDir);
  }

  /**
   * Send a structured event to the CC Telegram Bridge
   */
  async sendEvent(event: CCTelegramEvent): Promise<{ success: boolean; event_id: string; file_path: string }> {
    console.error(`[DEBUG] sendEvent called with event type: ${event.type}`);
    console.error(`[DEBUG] eventsDir: ${this.eventsDir}`);
    console.error(`[DEBUG] Working directory: ${process.cwd()}`);
    
    try {
      console.error(`[DEBUG] Ensuring directories exist...`);
      await this.ensureDirectories();
      console.error(`[DEBUG] Directories ensured`);
      
      // Generate unique event ID if not provided
      if (!event.task_id) {
        event.task_id = uuidv4();
        console.error(`[DEBUG] Generated task_id: ${event.task_id}`);
      } else {
        console.error(`[DEBUG] Using provided task_id: ${event.task_id}`);
      }

      // Set timestamp if not provided
      if (!event.timestamp) {
        event.timestamp = new Date().toISOString();
        console.error(`[DEBUG] Generated timestamp: ${event.timestamp}`);
      }

      // Create event file
      const fileName = `${event.task_id}_${Date.now()}.json`;
      const filePath = path.join(this.eventsDir, fileName);
      console.error(`[DEBUG] Writing to file: ${filePath}`);
      console.error(`[DEBUG] Event data:`, JSON.stringify(event, null, 2));
      
      await fs.writeJSON(filePath, event, { spaces: 2 });
      console.error(`[DEBUG] File written successfully`);
      
      // Verify the file was created
      const exists = await fs.pathExists(filePath);
      console.error(`[DEBUG] File exists after write: ${exists}`);
      
      if (exists) {
        const stats = await fs.stat(filePath);
        console.error(`[DEBUG] File size: ${stats.size} bytes`);
      }
      
      const result = {
        success: true,
        event_id: event.task_id,
        file_path: filePath
      };
      console.error(`[DEBUG] Returning result:`, JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error(`[DEBUG] Error in sendEvent:`, error);
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
      const healthResponse = await axios.get(this.healthEndpoint, { timeout: 5000 });
      const metricsResponse = await axios.get(this.metricsEndpoint, { timeout: 5000 });
      
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
   * Get user responses from Telegram
   */
  async getTelegramResponses(): Promise<TelegramResponse[]> {
    try {
      await this.ensureDirectories();
      
      const files = await fs.readdir(this.responsesDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      const responses: TelegramResponse[] = [];
      
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.responsesDir, file);
          const response = await fs.readJSON(filePath);
          responses.push(response);
        } catch (error: any) {
          console.warn(`Failed to read response file ${file}:`, error);
        }
      }
      
      // Sort by timestamp (most recent first)
      return responses.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      console.warn('Failed to read responses:', error);
      return [];
    }
  }

  /**
   * Clear old response files
   */
  async clearOldResponses(olderThanHours = 24): Promise<number> {
    try {
      const files = await fs.readdir(this.responsesDir);
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.responsesDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.remove(filePath);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      console.warn('Failed to clear old responses:', error);
      return 0;
    }
  }

  /**
   * Check if the bridge process is running
   */
  async isBridgeRunning(): Promise<boolean> {
    try {
      // First try health endpoint
      const healthResponse = await axios.get(this.healthEndpoint, { timeout: 2000 });
      return healthResponse.status === 200;
    } catch (error) {
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
      
      console.error(`[DEBUG] Starting bridge at: ${bridgePath}`);
      
      // Start the bridge process in background
      const bridge = spawn(bridgePath, [], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          // Ensure environment variables are passed
          TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
          TELEGRAM_ALLOWED_USERS: process.env.TELEGRAM_ALLOWED_USERS,
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
      console.error('[DEBUG] Restarting bridge...');
      
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
}
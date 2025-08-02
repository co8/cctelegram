import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { CCTelegramEvent, BridgeStatus, TelegramResponse, EventType } from './types.js';

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
    try {
      await this.ensureDirectories();
      
      // Generate unique event ID if not provided
      if (!event.task_id) {
        event.task_id = uuidv4();
      }

      // Set timestamp if not provided
      if (!event.timestamp) {
        event.timestamp = new Date().toISOString();
      }

      // Create event file
      const fileName = `${event.task_id}_${Date.now()}.json`;
      const filePath = path.join(this.eventsDir, fileName);
      
      await fs.writeJSON(filePath, event, { spaces: 2 });
      
      return {
        success: true,
        event_id: event.task_id,
        file_path: filePath
      };
    } catch (error) {
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
        } catch (error) {
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
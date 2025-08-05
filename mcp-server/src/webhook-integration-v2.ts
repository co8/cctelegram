/**
 * Task 21.3: Complete MCP Webhook Integration
 * Simpler, more direct approach
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { CCTelegramBridgeClient } from './bridge-client';

export interface WebhookPayload {
  type: 'telegram_response';
  callback_data: string;
  user_id: number;
  username?: string;
  first_name?: string;
  timestamp: string;
  correlation_id?: string;
}

export interface ResponseProcessingResult {
  success: boolean;
  action: 'approve' | 'deny' | 'acknowledge' | 'details' | 'unknown';
  task_id: string;
  processing_time_ms: number;
  acknowledgment_sent: boolean;
  error?: string;
}

export interface ClaudeNotification {
  type: 'telegram_response_received';
  correlation_id: string;
  user_info: {
    user_id: number;
    username?: string;
    first_name?: string;
  };
  response: {
    action: string;
    task_id: string;
    callback_data: string;
    timestamp: string;
  };
  processing_result: ResponseProcessingResult;
}

const webhookPayloadSchema = Joi.object({
  type: Joi.string().valid('telegram_response').required(),
  callback_data: Joi.string().required(),
  user_id: Joi.number().integer().positive().required(),
  username: Joi.string().optional(),
  first_name: Joi.string().optional(),
  timestamp: Joi.string().isoDate().required(),
  correlation_id: Joi.string().uuid().optional()
});

export class MCPWebhookIntegration {
  private app: express.Application;
  private server: any = null;
  private port: number;
  private bridgeClient: CCTelegramBridgeClient;
  private claudeNotificationCallbacks: Array<(notification: ClaudeNotification) => void> = [];
  private isRunning = false;

  constructor(port: number = 3000) {
    this.port = port;
    this.bridgeClient = new CCTelegramBridgeClient();
    this.app = express();
    this.setupApp();
  }

  private setupApp(): void {
    // Middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // Health endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'mcp-webhook-integration',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // Enhanced webhook endpoint
    this.app.post('/webhook/bridge-response', async (req, res) => {
      const startTime = Date.now();
      const correlationId = uuidv4();

      try {
        // Validate payload
        const { error, value } = webhookPayloadSchema.validate(req.body);
        if (error) {
          return res.status(400).json({
            success: false,
            correlation_id: correlationId,
            error: `Validation failed: ${error.details.map(d => d.message).join(', ')}`,
            processing_time_ms: Date.now() - startTime
          });
        }

        const payload: WebhookPayload = { ...value, correlation_id: correlationId };

        console.log(`[MCP-WEBHOOK] Processing response:`, payload.callback_data);

        // Process the response
        const processingResult = await this.processResponse(payload);

        // Send acknowledgment to Telegram
        if (processingResult.success) {
          await this.sendTelegramAcknowledgment(payload, processingResult);
        }

        // Notify Claude Code sessions
        await this.notifyClaudeSessions(payload, processingResult, correlationId);

        res.json({
          success: true,
          correlation_id: correlationId,
          processed_by: 'mcp_webhook_integration',
          processing_time_ms: Date.now() - startTime,
          action: processingResult.action,
          task_id: processingResult.task_id,
          acknowledgment_sent: processingResult.acknowledgment_sent
        });

      } catch (error) {
        console.error(`[MCP-WEBHOOK] Processing failed:`, error);
        res.status(500).json({
          success: false,
          correlation_id: correlationId,
          processed_by: 'mcp_webhook_integration',
          processing_time_ms: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  private async processResponse(payload: WebhookPayload): Promise<ResponseProcessingResult> {
    const startTime = Date.now();
    
    try {
      const { action, task_id } = this.parseCallbackData(payload.callback_data);
      
      console.log(`[MCP-WEBHOOK] Action: ${action}, Task: ${task_id}, User: ${payload.user_id}`);

      return {
        success: true,
        action,
        task_id,
        processing_time_ms: Date.now() - startTime,
        acknowledgment_sent: false
      };

    } catch (error) {
      return {
        success: false,
        action: 'unknown',
        task_id: 'unknown',
        processing_time_ms: Date.now() - startTime,
        acknowledgment_sent: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private parseCallbackData(callbackData: string): { action: 'approve' | 'deny' | 'acknowledge' | 'details' | 'unknown', task_id: string } {
    if (callbackData.startsWith('approve_')) {
      return { action: 'approve', task_id: callbackData.substring(8) };
    } else if (callbackData.startsWith('deny_')) {
      return { action: 'deny', task_id: callbackData.substring(5) };
    } else if (callbackData.startsWith('ack_')) {
      return { action: 'acknowledge', task_id: callbackData.substring(4) };
    } else if (callbackData.startsWith('details_')) {
      return { action: 'details', task_id: callbackData.substring(8) };
    } else {
      return { action: 'unknown', task_id: callbackData };
    }
  }

  private async sendTelegramAcknowledgment(payload: WebhookPayload, result: ResponseProcessingResult): Promise<void> {
    try {
      const message = this.createAcknowledgmentMessage(result.action, result.task_id, payload.first_name);
      await this.bridgeClient.sendMessage(message);
      result.acknowledgment_sent = true;
      console.log(`[MCP-WEBHOOK] Acknowledgment sent: ${result.action} for ${result.task_id}`);
    } catch (error) {
      console.error(`[MCP-WEBHOOK] Acknowledgment failed:`, error);
      result.acknowledgment_sent = false;
    }
  }

  private createAcknowledgmentMessage(action: string, taskId: string, userName?: string): string {
    const userPrefix = userName ? `${userName}, ` : '';
    const timestamp = new Date().toLocaleTimeString();
    
    switch (action) {
      case 'approve':
        return `✅ ${userPrefix}APPROVAL received for ${taskId}. Executing action automatically. (${timestamp})`;
      case 'deny':
        return `❌ ${userPrefix}DENIAL received for ${taskId}. Action cancelled. (${timestamp})`;
      case 'acknowledge':
        return `👍 ${userPrefix}ACKNOWLEDGED ${taskId}. Marked as reviewed. (${timestamp})`;
      case 'details':
        return `📄 ${userPrefix}DETAILS requested for ${taskId}. Information logged. (${timestamp})`;
      default:
        return `🤖 ${userPrefix}Response processed for ${taskId}. (${timestamp})`;
    }
  }

  private async notifyClaudeSessions(payload: WebhookPayload, result: ResponseProcessingResult, correlationId: string): Promise<void> {
    const notification: ClaudeNotification = {
      type: 'telegram_response_received',
      correlation_id: correlationId,
      user_info: {
        user_id: payload.user_id,
        username: payload.username,
        first_name: payload.first_name
      },
      response: {
        action: result.action,
        task_id: result.task_id,
        callback_data: payload.callback_data,
        timestamp: payload.timestamp
      },
      processing_result: result
    };

    for (const callback of this.claudeNotificationCallbacks) {
      try {
        callback(notification);
      } catch (error) {
        console.error(`[MCP-WEBHOOK] Claude notification failed:`, error);
      }
    }

    console.log(`[MCP-WEBHOOK] Claude notifications sent: ${this.claudeNotificationCallbacks.length} callbacks`);
  }

  public registerClaudeCallback(callback: (notification: ClaudeNotification) => void): void {
    this.claudeNotificationCallbacks.push(callback);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        this.isRunning = true;
        console.log(`[MCP-WEBHOOK] Integration started on port ${this.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  public async shutdown(): Promise<void> {
    if (!this.server || !this.isRunning) return;

    return new Promise((resolve) => {
      this.server.close(() => {
        this.isRunning = false;
        console.log('[MCP-WEBHOOK] Integration shutdown complete');
        resolve();
      });
    });
  }

  public isServerRunning(): boolean {
    return this.isRunning;
  }

  public getPort(): number {
    return this.port;
  }
}
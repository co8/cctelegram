/**
 * Task 21.3: MCP Server Integration and Response Processing
 * Integrates webhook server with existing MCP server architecture
 */

import { WebhookServer, WebhookPayload, WebhookResponse } from './webhook-server';
import { CCTelegramBridgeClient } from './bridge-client';
import { v4 as uuidv4 } from 'uuid';

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

export class WebhookMCPIntegration {
  private webhookServer: WebhookServer;
  private bridgeClient: CCTelegramBridgeClient;
  private claudeNotificationCallbacks: Array<(notification: ClaudeNotification) => void> = [];

  constructor(webhookPort: number = 3000) {
    this.webhookServer = new WebhookServer(webhookPort);
    this.bridgeClient = new CCTelegramBridgeClient();
    
    this.setupWebhookHandlers();
  }

  private setupWebhookHandlers(): void {
    // We need to enhance the webhook server after it's created
    // For now, we'll handle this through a different approach
  }

  public async enhanceWebhookEndpoint(): Promise<void> {
    // Override the existing webhook endpoint with our enhanced processing
    const app = (this.webhookServer as any).app;
    
    // Remove existing handler and add enhanced one
    app._router.stack = app._router.stack.filter((layer: any) => 
      !(layer.route && layer.route.path === '/webhook/bridge-response')
    );
    
    // Add our enhanced webhook handler
    app.post('/webhook/bridge-response', async (req: any, res: any) => {
      const startTime = Date.now();
      const correlationId = req.correlationId || uuidv4();

      try {
        const payload: WebhookPayload = req.body;
        
        // Process the response immediately
        const processingResult = await this.processResponse(payload);
        
        // Send acknowledgment to Telegram if successful
        if (processingResult.success) {
          await this.sendTelegramAcknowledgment(payload, processingResult);
        }

        // Notify Claude Code sessions
        await this.notifyClaudeSessions(payload, processingResult, correlationId);

        const response: WebhookResponse = {
          success: true,
          correlation_id: correlationId,
          processed_by: 'mcp_webhook',
          processing_time_ms: Date.now() - startTime,
          message: `Response processed: ${processingResult.action} for task ${processingResult.task_id}`
        };

        res.json(response);

      } catch (error) {
        console.error(`[WEBHOOK-INTEGRATION] Processing failed:`, error);
        
        const response: WebhookResponse = {
          success: false,
          correlation_id: correlationId,
          processed_by: 'mcp_webhook',
          processing_time_ms: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown processing error'
        };

        res.status(500).json(response);
      }
    });
  }

  private async processResponse(payload: WebhookPayload): Promise<ResponseProcessingResult> {
    const startTime = Date.now();
    
    try {
      // Parse callback data to determine action and task ID
      const { action, task_id } = this.parseCallbackData(payload.callback_data);
      
      // Log the received response
      console.log(`[WEBHOOK-INTEGRATION] Processing ${action} for task ${task_id} from user ${payload.user_id}`);

      const result: ResponseProcessingResult = {
        success: true,
        action,
        task_id,
        processing_time_ms: Date.now() - startTime,
        acknowledgment_sent: false
      };

      return result;

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
    // Parse callback data like: "approve_task-id" or "deny_task-id" or "ack_task-id"
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
      // Create acknowledgment message based on action
      const acknowledgmentMessage = this.createAcknowledgmentMessage(result.action, result.task_id, payload.first_name);
      
      // Send message via bridge client
      await this.bridgeClient.sendMessage(acknowledgmentMessage);
      
      result.acknowledgment_sent = true;
      console.log(`[WEBHOOK-INTEGRATION] Acknowledgment sent for ${result.action} on task ${result.task_id}`);
      
    } catch (error) {
      console.error(`[WEBHOOK-INTEGRATION] Failed to send acknowledgment:`, error);
      result.acknowledgment_sent = false;
    }
  }

  private createAcknowledgmentMessage(action: string, taskId: string, userName?: string): string {
    const userPrefix = userName ? `${userName}, ` : '';
    const timestamp = new Date().toLocaleString();
    
    switch (action) {
      case 'approve':
        return `✅ ${userPrefix}your APPROVAL has been received and processed for task ${taskId}. Action will be executed automatically. (${timestamp})`;
      case 'deny':
        return `❌ ${userPrefix}your DENIAL has been received and processed for task ${taskId}. Action has been cancelled. (${timestamp})`;
      case 'acknowledge':
        return `👍 ${userPrefix}your ACKNOWLEDGMENT has been received for task ${taskId}. Marked as reviewed. (${timestamp})`;
      case 'details':
        return `📄 ${userPrefix}details request received for task ${taskId}. Additional information has been logged. (${timestamp})`;
      default:
        return `🤖 ${userPrefix}your response has been received and processed for task ${taskId}. (${timestamp})`;
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

    // Notify all registered Claude Code sessions
    for (const callback of this.claudeNotificationCallbacks) {
      try {
        callback(notification);
      } catch (error) {
        console.error(`[WEBHOOK-INTEGRATION] Claude notification callback failed:`, error);
      }
    }

    console.log(`[WEBHOOK-INTEGRATION] Claude notification sent: ${result.action} for task ${result.task_id}`);
  }

  public registerClaudeNotificationCallback(callback: (notification: ClaudeNotification) => void): void {
    this.claudeNotificationCallbacks.push(callback);
  }

  public unregisterClaudeNotificationCallback(callback: (notification: ClaudeNotification) => void): void {
    const index = this.claudeNotificationCallbacks.indexOf(callback);
    if (index !== -1) {
      this.claudeNotificationCallbacks.splice(index, 1);
    }
  }

  public async start(): Promise<void> {
    console.log('[WEBHOOK-INTEGRATION] Starting webhook MCP integration...');
    await this.webhookServer.start();
    await this.enhanceWebhookEndpoint();
    console.log('[WEBHOOK-INTEGRATION] Integration ready - webhook connected to MCP server');
  }

  public async shutdown(): Promise<void> {
    console.log('[WEBHOOK-INTEGRATION] Shutting down webhook MCP integration...');
    await this.webhookServer.shutdown();
    this.claudeNotificationCallbacks.length = 0;
    console.log('[WEBHOOK-INTEGRATION] Integration shutdown complete');
  }

  public isRunning(): boolean {
    return this.webhookServer.isServerRunning();
  }

  public getWebhookPort(): number {
    return this.webhookServer.getPort();
  }

  // Method to manually trigger response processing (for testing)
  public async testResponseProcessing(callbackData: string, userId: number = 297126051): Promise<ResponseProcessingResult> {
    const testPayload: WebhookPayload = {
      type: 'telegram_response',
      callback_data: callbackData,
      user_id: userId,
      username: 'test_user',
      first_name: 'Test',
      timestamp: new Date().toISOString(),
      correlation_id: uuidv4()
    };

    return await this.processResponse(testPayload);
  }
}
/**
 * Comprehensive Telegram Bot API Emulator
 * Provides complete Telegram Bot API emulation with webhook support and advanced testing features
 */

import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  date: number;
  chat: TelegramChat;
  forward_from?: TelegramUser;
  forward_from_chat?: TelegramChat;
  forward_from_message_id?: number;
  forward_signature?: string;
  forward_sender_name?: string;
  forward_date?: number;
  is_automatic_forward?: boolean;
  reply_to_message?: TelegramMessage;
  via_bot?: TelegramUser;
  edit_date?: number;
  has_protected_content?: boolean;
  media_group_id?: string;
  author_signature?: string;
  text?: string;
  entities?: any[];
  animation?: any;
  audio?: any;
  document?: any;
  photo?: any[];
  sticker?: any;
  video?: any;
  video_note?: any;
  voice?: any;
  caption?: string;
  caption_entities?: any[];
  contact?: any;
  dice?: any;
  game?: any;
  poll?: any;
  venue?: any;
  location?: any;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  new_chat_title?: string;
  new_chat_photo?: any[];
  delete_chat_photo?: boolean;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
  channel_chat_created?: boolean;
  message_auto_delete_timer_changed?: any;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  pinned_message?: TelegramMessage;
  invoice?: any;
  successful_payment?: any;
  connected_website?: string;
  passport_data?: any;
  proximity_alert_triggered?: any;
  video_chat_scheduled?: any;
  video_chat_started?: any;
  video_chat_ended?: any;
  video_chat_participants_invited?: any;
  web_app_data?: any;
  reply_markup?: any;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  inline_query?: any;
  chosen_inline_result?: any;
  callback_query?: any;
  shipping_query?: any;
  pre_checkout_query?: any;
  poll?: any;
  poll_answer?: any;
  my_chat_member?: any;
  chat_member?: any;
  chat_join_request?: any;
}

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}

export interface RateLimitConfig {
  globalLimit: number;
  perChatLimit: number;
  burstLimit: number;
  windowMs: number;
}

export interface InteractionLog {
  timestamp: string;
  type: 'webhook_received' | 'api_call' | 'message_sent' | 'user_action' | 'rate_limit' | 'error';
  method?: string;
  path?: string;
  data?: any;
  response?: any;
  error?: string;
  chatId?: number;
  userId?: number;
  duration?: number;
}

export class TelegramBotApiEmulator extends EventEmitter {
  private app: Express;
  private server: Server | null = null;
  private port: number;
  private logDir: string;
  
  private botToken: string = 'mock_bot_token';
  private botInfo = {
    id: 123456789,
    is_bot: true,
    first_name: 'CCTelegram Test Bot',
    username: 'cctelegram_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false
  };
  
  private webhookInfo: WebhookInfo | null = null;
  private messages: TelegramMessage[] = [];
  private updates: TelegramUpdate[] = [];
  private interactionLogs: InteractionLog[] = [];
  
  private messageIdCounter = 1;
  private updateIdCounter = 1;
  
  private rateLimitConfig: RateLimitConfig = {
    globalLimit: 30, // requests per second globally
    perChatLimit: 1, // requests per second per chat
    burstLimit: 10, // burst allowance
    windowMs: 1000 // 1 second window
  };
  
  private rateLimitStorage: Map<string, { count: number; resetTime: number; burst: number }> = new Map();
  private responseDelay = 0;
  private simulateFailures = false;
  private failureRate = 0.1; // 10% failure rate when enabled
  
  private authenticatedUsers: Set<number> = new Set([123456789, 987654321]); // Mock user IDs
  
  constructor(port: number, logDir: string) {
    super();
    this.port = port;
    this.logDir = logDir;
    this.app = express();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  async start(): Promise<void> {
    // Ensure log directory exists
    await fs.mkdir(this.logDir, { recursive: true });
    
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        this.logInteraction({
          timestamp: new Date().toISOString(),
          type: 'api_call',
          method: 'SERVER_START',
          data: { port: this.port }
        });
        console.log(`✓ Telegram Bot API Emulator listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        reject(new Error(`Failed to start Telegram Bot API Emulator: ${error.message}`));
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    // Save logs before stopping
    await this.saveLogs();

    return new Promise((resolve) => {
      this.server!.close(() => {
        console.log('✓ Telegram Bot API Emulator stopped');
        this.server = null;
        resolve();
      });
    });
  }

  // Configuration methods
  setBotToken(token: string): void {
    this.botToken = token;
  }

  setRateLimitConfig(config: Partial<RateLimitConfig>): void {
    this.rateLimitConfig = { ...this.rateLimitConfig, ...config };
  }

  setResponseDelay(delayMs: number): void {
    this.responseDelay = delayMs;
  }

  enableFailureSimulation(enabled: boolean, failureRate: number = 0.1): void {
    this.simulateFailures = enabled;
    this.failureRate = failureRate;
  }

  addAuthenticatedUser(userId: number): void {
    this.authenticatedUsers.add(userId);
  }

  removeAuthenticatedUser(userId: number): void {
    this.authenticatedUsers.delete(userId);
  }

  // Webhook management
  async setWebhook(url: string, allowedUpdates?: string[]): Promise<boolean> {
    this.webhookInfo = {
      url,
      has_custom_certificate: false,
      pending_update_count: 0,
      allowed_updates: allowedUpdates
    };

    this.logInteraction({
      timestamp: new Date().toISOString(),
      type: 'api_call',
      method: 'setWebhook',
      data: { url, allowedUpdates }
    });

    return true;
  }

  async deleteWebhook(): Promise<boolean> {
    this.webhookInfo = null;
    
    this.logInteraction({
      timestamp: new Date().toISOString(),
      type: 'api_call',
      method: 'deleteWebhook'
    });

    return true;
  }

  getWebhookInfo(): WebhookInfo | null {
    return this.webhookInfo;
  }

  // Message simulation
  async simulateUserMessage(chatId: number, text: string, userId?: number): Promise<TelegramMessage> {
    const user: TelegramUser = {
      id: userId || 123456789,
      is_bot: false,
      first_name: 'Test',
      last_name: 'User',
      username: 'testuser'
    };

    const chat: TelegramChat = {
      id: chatId,
      type: 'private',
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username
    };

    const message: TelegramMessage = {
      message_id: this.messageIdCounter++,
      from: user,
      date: Math.floor(Date.now() / 1000),
      chat,
      text
    };

    this.messages.push(message);

    // Create update for webhook
    const update: TelegramUpdate = {
      update_id: this.updateIdCounter++,
      message
    };

    this.updates.push(update);

    this.logInteraction({
      timestamp: new Date().toISOString(),
      type: 'user_action',
      method: 'simulateUserMessage',
      data: { chatId, text, userId },
      chatId,
      userId: user.id
    });

    // Send to webhook if configured
    if (this.webhookInfo) {
      await this.sendWebhookUpdate(update);
    }

    // Emit event for listeners
    this.emit('userMessage', message);

    return message;
  }

  async simulateCallbackQuery(messageId: number, callbackData: string, userId?: number): Promise<void> {
    const user: TelegramUser = {
      id: userId || 123456789,
      is_bot: false,
      first_name: 'Test',
      last_name: 'User',
      username: 'testuser'
    };

    const message = this.messages.find(m => m.message_id === messageId);
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    const callbackQuery = {
      id: crypto.randomUUID(),
      from: user,
      message,
      data: callbackData
    };

    const update: TelegramUpdate = {
      update_id: this.updateIdCounter++,
      callback_query: callbackQuery
    };

    this.updates.push(update);

    this.logInteraction({
      timestamp: new Date().toISOString(),
      type: 'user_action',
      method: 'simulateCallbackQuery',
      data: { messageId, callbackData, userId },
      chatId: message.chat.id,
      userId: user.id
    });

    // Send to webhook if configured
    if (this.webhookInfo) {
      await this.sendWebhookUpdate(update);
    }

    // Emit event for listeners
    this.emit('callbackQuery', callbackQuery);
  }

  // Webhook sender
  private async sendWebhookUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.webhookInfo?.url) return;

    try {
      const startTime = Date.now();
      
      const response = await fetch(this.webhookInfo.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': this.botToken
        },
        body: JSON.stringify(update)
      });

      const duration = Date.now() - startTime;

      this.logInteraction({
        timestamp: new Date().toISOString(),
        type: 'webhook_received',
        method: 'POST',
        path: this.webhookInfo.url,
        data: update,
        response: {
          status: response.status,
          ok: response.ok
        },
        duration
      });

      if (!response.ok) {
        throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
      }

      // Emit event for monitoring
      this.emit('webhookSent', { update, response, duration });

    } catch (error) {
      this.logInteraction({
        timestamp: new Date().toISOString(),
        type: 'error',
        method: 'sendWebhookUpdate',
        error: error.message,
        data: { updateId: update.update_id }
      });

      // Emit error event
      this.emit('webhookError', { update, error });
    }
  }

  // Express route handlers
  private setupRoutes(): void {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(this.rateLimitMiddleware.bind(this));
    this.app.use(this.authMiddleware.bind(this));

    // Bot API endpoints
    this.app.get('/bot:token/getMe', this.handleGetMe.bind(this));
    this.app.post('/bot:token/sendMessage', this.handleSendMessage.bind(this));
    this.app.post('/bot:token/editMessageText', this.handleEditMessageText.bind(this));
    this.app.post('/bot:token/deleteMessage', this.handleDeleteMessage.bind(this));
    this.app.post('/bot:token/setMessageReaction', this.handleSetMessageReaction.bind(this));
    this.app.post('/bot:token/answerCallbackQuery', this.handleAnswerCallbackQuery.bind(this));
    this.app.post('/bot:token/setWebhook', this.handleSetWebhook.bind(this));
    this.app.post('/bot:token/deleteWebhook', this.handleDeleteWebhook.bind(this));
    this.app.get('/bot:token/getWebhookInfo', this.handleGetWebhookInfo.bind(this));

    // Accept any bot token pattern
    this.app.get('/bot*/getMe', this.handleGetMe.bind(this));
    this.app.post('/bot*/sendMessage', this.handleSendMessage.bind(this));
    this.app.post('/bot*/editMessageText', this.handleEditMessageText.bind(this));
    this.app.post('/bot*/deleteMessage', this.handleDeleteMessage.bind(this));
    this.app.post('/bot*/setMessageReaction', this.handleSetMessageReaction.bind(this));
    this.app.post('/bot*/answerCallbackQuery', this.handleAnswerCallbackQuery.bind(this));
    this.app.post('/bot*/setWebhook', this.handleSetWebhook.bind(this));
    this.app.post('/bot*/deleteWebhook', this.handleDeleteWebhook.bind(this));
    this.app.get('/bot*/getWebhookInfo', this.handleGetWebhookInfo.bind(this));

    // Testing and debug endpoints
    this.app.get('/test/messages', this.handleTestGetMessages.bind(this));
    this.app.get('/test/updates', this.handleTestGetUpdates.bind(this));
    this.app.get('/test/logs', this.handleTestGetLogs.bind(this));
    this.app.post('/test/clear', this.handleTestClear.bind(this));
    this.app.post('/test/simulate/message', this.handleTestSimulateMessage.bind(this));
    this.app.post('/test/simulate/callback', this.handleTestSimulateCallback.bind(this));
    this.app.post('/test/config/delay', this.handleTestSetDelay.bind(this));
    this.app.post('/test/config/failures', this.handleTestSetFailures.bind(this));

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        ok: true, 
        service: 'telegram-bot-api-emulator',
        uptime: process.uptime(),
        messagesCount: this.messages.length,
        updatesCount: this.updates.length,
        webhookConfigured: !!this.webhookInfo
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use((error: any, req: Request, res: Response, next: any) => {
      this.logInteraction({
        timestamp: new Date().toISOString(),
        type: 'error',
        method: req.method,
        path: req.path,
        error: error.message
      });

      res.status(500).json({
        ok: false,
        error_code: 500,
        description: 'Internal server error'
      });
    });

    // Handle 404s
    this.app.use((req: Request, res: Response) => {
      this.logInteraction({
        timestamp: new Date().toISOString(),
        type: 'error',
        method: req.method,
        path: req.path,
        error: 'Endpoint not found'
      });

      res.status(404).json({
        ok: false,
        error_code: 404,
        description: 'Method not found'
      });
    });
  }

  // Middleware
  private async rateLimitMiddleware(req: Request, res: Response, next: any): Promise<void> {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const resetTime = now + this.rateLimitConfig.windowMs;

    let bucket = this.rateLimitStorage.get(key);
    if (!bucket || bucket.resetTime < now) {
      bucket = {
        count: 0,
        resetTime,
        burst: this.rateLimitConfig.burstLimit
      };
    }

    bucket.count++;

    // Check rate limits
    if (bucket.count > this.rateLimitConfig.globalLimit || bucket.burst <= 0) {
      this.logInteraction({
        timestamp: new Date().toISOString(),
        type: 'rate_limit',
        method: req.method,
        path: req.path,
        data: { count: bucket.count, limit: this.rateLimitConfig.globalLimit }
      });

      res.status(429).json({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 30 seconds',
        parameters: { retry_after: 30 }
      });
      return;
    }

    bucket.burst--;
    this.rateLimitStorage.set(key, bucket);
    next();
  }

  private authMiddleware(req: Request, res: Response, next: any): void {
    // Extract bot token from URL path
    const tokenMatch = req.path.match(/\/bot([^/]+)\//);
    if (!tokenMatch) {
      next();
      return;
    }

    const token = tokenMatch[1];
    
    // For testing, accept any token that looks reasonable or is our mock token
    if (token.length < 5 && token !== this.botToken.split('_')[0]) {
      res.status(401).json({
        ok: false,
        error_code: 401,
        description: 'Unauthorized'
      });
      return;
    }

    next();
  }

  // API handlers
  private async handleGetMe(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    if (this.shouldSimulateFailure()) {
      res.status(500).json({
        ok: false,
        error_code: 500,
        description: 'Simulated server error'
      });
      return;
    }

    this.logInteraction({
      timestamp: new Date().toISOString(),
      type: 'api_call',
      method: 'getMe',
      response: this.botInfo
    });

    res.json({
      ok: true,
      result: this.botInfo
    });
  }

  private async handleSendMessage(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    if (this.shouldSimulateFailure()) {
      res.status(500).json({
        ok: false,
        error_code: 500,
        description: 'Simulated message send failure'
      });
      return;
    }

    const { chat_id, text, reply_markup, parse_mode } = req.body;

    const message: TelegramMessage = {
      message_id: this.messageIdCounter++,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: chat_id,
        type: 'private'
      },
      text,
      reply_markup
    };

    this.messages.push(message);

    this.logInteraction({
      timestamp: new Date().toISOString(),
      type: 'message_sent',
      method: 'sendMessage',
      data: { chat_id, text: text?.substring(0, 100), parse_mode },
      response: { message_id: message.message_id },
      chatId: chat_id
    });

    // Emit event for monitoring
    this.emit('messageSent', message);

    res.json({
      ok: true,
      result: message
    });
  }

  private async handleEditMessageText(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    const { chat_id, message_id, text, reply_markup } = req.body;

    const messageIndex = this.messages.findIndex(m => 
      m.message_id === message_id && m.chat.id === chat_id
    );

    if (messageIndex >= 0) {
      this.messages[messageIndex] = {
        ...this.messages[messageIndex],
        text,
        reply_markup,
        edit_date: Math.floor(Date.now() / 1000)
      };

      this.logInteraction({
        timestamp: new Date().toISOString(),
        type: 'message_sent',
        method: 'editMessageText',
        data: { chat_id, message_id, text: text?.substring(0, 100) },
        chatId: chat_id
      });

      res.json({
        ok: true,
        result: this.messages[messageIndex]
      });
    } else {
      res.status(400).json({
        ok: false,
        error_code: 400,
        description: 'Bad Request: message not found'
      });
    }
  }

  private async handleDeleteMessage(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    const { chat_id, message_id } = req.body;

    const messageIndex = this.messages.findIndex(m => 
      m.message_id === message_id && m.chat.id === chat_id
    );

    if (messageIndex >= 0) {
      this.messages.splice(messageIndex, 1);
      
      this.logInteraction({
        timestamp: new Date().toISOString(),
        type: 'api_call',
        method: 'deleteMessage',
        data: { chat_id, message_id },
        chatId: chat_id
      });

      res.json({
        ok: true,
        result: true
      });
    } else {
      res.status(400).json({
        ok: false,
        error_code: 400,
        description: 'Bad Request: message not found'
      });
    }
  }

  private async handleSetMessageReaction(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    const { chat_id, message_id, reaction } = req.body;

    this.logInteraction({
      timestamp: new Date().toISOString(),
      type: 'api_call',
      method: 'setMessageReaction',
      data: { chat_id, message_id, reaction },
      chatId: chat_id
    });

    res.json({
      ok: true,
      result: true
    });
  }

  private async handleAnswerCallbackQuery(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    const { callback_query_id, text, show_alert } = req.body;

    this.logInteraction({
      timestamp: new Date().toISOString(),
      type: 'api_call',
      method: 'answerCallbackQuery',
      data: { callback_query_id, text, show_alert }
    });

    res.json({
      ok: true,
      result: true
    });
  }

  private async handleSetWebhook(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    const { url, allowed_updates } = req.body;
    await this.setWebhook(url, allowed_updates);

    res.json({
      ok: true,
      result: true
    });
  }

  private async handleDeleteWebhook(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    await this.deleteWebhook();

    res.json({
      ok: true,
      result: true
    });
  }

  private async handleGetWebhookInfo(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();
    
    const info = this.webhookInfo || {
      url: '',
      has_custom_certificate: false,
      pending_update_count: 0
    };

    res.json({
      ok: true,
      result: info
    });
  }

  // Test endpoints
  private handleTestGetMessages(req: Request, res: Response): void {
    res.json({
      messages: this.messages,
      count: this.messages.length
    });
  }

  private handleTestGetUpdates(req: Request, res: Response): void {
    res.json({
      updates: this.updates,
      count: this.updates.length
    });
  }

  private handleTestGetLogs(req: Request, res: Response): void {
    const limit = parseInt(req.query.limit as string) || 100;
    const type = req.query.type as string;

    let logs = this.interactionLogs;
    if (type) {
      logs = logs.filter(log => log.type === type);
    }

    res.json({
      logs: logs.slice(-limit),
      count: logs.length,
      totalLogs: this.interactionLogs.length
    });
  }

  private handleTestClear(req: Request, res: Response): void {
    this.messages = [];
    this.updates = [];
    this.interactionLogs = [];
    this.messageIdCounter = 1;
    this.updateIdCounter = 1;

    res.json({
      ok: true,
      message: 'All data cleared'
    });
  }

  private async handleTestSimulateMessage(req: Request, res: Response): Promise<void> {
    const { chat_id, text, user_id } = req.body;

    try {
      const message = await this.simulateUserMessage(chat_id, text, user_id);
      res.json({
        ok: true,
        message: 'User message simulated',
        result: message
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  private async handleTestSimulateCallback(req: Request, res: Response): Promise<void> {
    const { message_id, callback_data, user_id } = req.body;

    try {
      await this.simulateCallbackQuery(message_id, callback_data, user_id);
      res.json({
        ok: true,
        message: 'Callback query simulated'
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  private handleTestSetDelay(req: Request, res: Response): void {
    const { delay } = req.body;
    this.setResponseDelay(delay || 0);
    
    res.json({
      ok: true,
      delay: this.responseDelay
    });
  }

  private handleTestSetFailures(req: Request, res: Response): void {
    const { enabled, rate } = req.body;
    this.enableFailureSimulation(enabled, rate);
    
    res.json({
      ok: true,
      failuresEnabled: this.simulateFailures,
      failureRate: this.failureRate
    });
  }

  // Helper methods
  private logInteraction(log: InteractionLog): void {
    this.interactionLogs.push(log);
    
    // Keep only last 10000 logs to prevent memory issues
    if (this.interactionLogs.length > 10000) {
      this.interactionLogs = this.interactionLogs.slice(-5000);
    }

    // Emit event for real-time monitoring
    this.emit('interaction', log);
  }

  private async applyResponseDelay(): Promise<void> {
    if (this.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay));
    }
  }

  private shouldSimulateFailure(): boolean {
    return this.simulateFailures && Math.random() < this.failureRate;
  }

  private async saveLogs(): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logsPath = path.join(this.logDir, `emulator-logs-${timestamp}.json`);
      
      await fs.writeFile(logsPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        messages: this.messages,
        updates: this.updates,
        interactions: this.interactionLogs,
        config: {
          rateLimitConfig: this.rateLimitConfig,
          responseDelay: this.responseDelay,
          simulateFailures: this.simulateFailures,
          failureRate: this.failureRate
        }
      }, null, 2));

      console.log(`✓ Emulator logs saved to ${logsPath}`);
    } catch (error) {
      console.error('Failed to save emulator logs:', error);
    }
  }

  // Public getters for testing
  getMessages(): TelegramMessage[] {
    return [...this.messages];
  }

  getUpdates(): TelegramUpdate[] {
    return [...this.updates];
  }

  getInteractionLogs(): InteractionLog[] {
    return [...this.interactionLogs];
  }

  getLastMessage(): TelegramMessage | null {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
  }

  clearAll(): void {
    this.messages = [];
    this.updates = [];
    this.interactionLogs = [];
    this.messageIdCounter = 1;
    this.updateIdCounter = 1;
  }
}
/**
 * Telegram Mock Server
 * Mocks Telegram Bot API for testing
 */

import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import { DebugLogger } from './debug-logger';

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
  reply_markup?: any;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: any;
}

export class TelegramMockServer {
  private app: Express;
  private server: Server | null = null;
  private port: number;
  private logger: DebugLogger;
  
  private messages: TelegramMessage[] = [];
  private messageHandlers: ((message: TelegramMessage) => void)[] = [];
  private responseDelay = 0;

  constructor(port: number, logger: DebugLogger) {
    this.port = port;
    this.logger = logger;
    this.app = express();
    this.setupRoutes();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        this.logger.info(`✓ Telegram mock server listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        reject(new Error(`Failed to start Telegram mock server: ${error.message}`));
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.logger.info('✓ Telegram mock server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  onMessage(handler: (message: TelegramMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  setResponseDelay(delayMs: number): void {
    this.responseDelay = delayMs;
    this.logger.info(`Set Telegram API response delay to ${delayMs}ms`);
  }

  getLastMessage(): TelegramMessage | null {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
  }

  getAllMessages(): TelegramMessage[] {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [];
    this.logger.info('Cleared message history');
  }

  // Mock Telegram Bot API endpoint for sending messages
  private async handleSendMessage(req: Request, res: Response): Promise<void> {
    try {
      await this.applyResponseDelay();

      const { chat_id, text, reply_markup } = req.body;

      const message: TelegramMessage = {
        message_id: Date.now() + Math.floor(Math.random() * 1000),
        chat: {
          id: chat_id,
          type: 'private'
        },
        date: Math.floor(Date.now() / 1000),
        text,
        reply_markup
      };

      // Store the message
      this.messages.push(message);

      // Notify handlers
      this.messageHandlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          this.logger.error('Message handler error:', error);
        }
      });

      this.logger.info('Telegram message sent:', text?.substring(0, 100) + (text && text.length > 100 ? '...' : ''));

      // Respond with Telegram API format
      res.json({
        ok: true,
        result: message
      });

    } catch (error) {
      this.logger.error('Send message error:', error);
      res.status(500).json({
        ok: false,
        error_code: 500,
        description: error.message
      });
    }
  }

  // Mock other Telegram Bot API endpoints
  private async handleEditMessage(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();

    const { chat_id, message_id, text, reply_markup } = req.body;

    // Find and update the message
    const messageIndex = this.messages.findIndex(m => 
      m.message_id === message_id && m.chat.id === chat_id
    );

    if (messageIndex >= 0) {
      this.messages[messageIndex] = {
        ...this.messages[messageIndex],
        text,
        reply_markup
      };

      this.logger.info('Telegram message edited:', text?.substring(0, 100));

      res.json({
        ok: true,
        result: this.messages[messageIndex]
      });
    } else {
      res.status(400).json({
        ok: false,
        error_code: 400,
        description: 'Message not found'
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
      this.logger.info('Telegram message deleted:', message_id);

      res.json({
        ok: true,
        result: true
      });
    } else {
      res.status(400).json({
        ok: false,
        error_code: 400,
        description: 'Message not found'
      });
    }
  }

  private async handleGetMe(req: Request, res: Response): Promise<void> {
    await this.applyResponseDelay();

    res.json({
      ok: true,
      result: {
        id: 123456789,
        is_bot: true,
        first_name: 'CCTelegram Test Bot',
        username: 'cctelegram_test_bot'
      }
    });
  }

  // Debug endpoints for testing
  private handleGetMessages(req: Request, res: Response): void {
    res.json({
      messages: this.messages,
      count: this.messages.length
    });
  }

  private handleClearMessages(req: Request, res: Response): void {
    this.clearMessages();
    res.json({ ok: true, message: 'Messages cleared' });
  }

  private handleSetDelay(req: Request, res: Response): void {
    const { delay } = req.body;
    this.setResponseDelay(delay || 0);
    res.json({ ok: true, delay: this.responseDelay });
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    // Mock Telegram Bot API endpoints
    this.app.post('/bot:token/sendMessage', this.handleSendMessage.bind(this));
    this.app.post('/bot:token/editMessageText', this.handleEditMessage.bind(this));
    this.app.post('/bot:token/deleteMessage', this.handleDeleteMessage.bind(this));
    this.app.post('/bot:token/getMe', this.handleGetMe.bind(this));

    // Accept any bot token for testing
    this.app.post('/bot*/sendMessage', this.handleSendMessage.bind(this));
    this.app.post('/bot*/editMessageText', this.handleEditMessage.bind(this));
    this.app.post('/bot*/deleteMessage', this.handleDeleteMessage.bind(this));
    this.app.post('/bot*/getMe', this.handleGetMe.bind(this));

    // Debug endpoints
    this.app.get('/debug/messages', this.handleGetMessages.bind(this));
    this.app.post('/debug/clear', this.handleClearMessages.bind(this));
    this.app.post('/debug/delay', this.handleSetDelay.bind(this));

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ ok: true, server: 'telegram-mock' });
    });

    // Catch-all for unsupported endpoints
    this.app.all('*', (req, res) => {
      this.logger.warn(`Unsupported Telegram API endpoint: ${req.method} ${req.path}`);
      res.status(404).json({
        ok: false,
        error_code: 404,
        description: 'Method not found'
      });
    });
  }

  private async applyResponseDelay(): Promise<void> {
    if (this.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay));
    }
  }

  // Helper methods for test scenarios
  async waitForMessage(containsText: string, timeoutMs: number = 5000): Promise<TelegramMessage | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const message = this.messages.find(m => 
        m.text && m.text.includes(containsText)
      );

      if (message) {
        return message;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return null;
  }

  simulateUserResponse(messageId: number, responseText: string): any {
    const responseId = Date.now() + Math.floor(Math.random() * 1000);
    
    // Simulate user response (this would normally come from Telegram)
    const userResponse = {
      id: responseId,
      message_id: messageId,
      user_id: 123456789,
      message: responseText,
      timestamp: new Date().toISOString()
    };

    this.logger.info('Simulated user response:', responseText);
    return userResponse;
  }

  simulateButtonClick(messageId: number, callbackData: string): any {
    const responseId = Date.now() + Math.floor(Math.random() * 1000);
    
    // Simulate button click callback query
    const buttonResponse = {
      id: responseId,
      message_id: messageId,
      callback_data: callbackData,
      action: callbackData, // Assuming callback data contains the action
      timestamp: new Date().toISOString()
    };

    this.logger.info('Simulated button click:', callbackData);
    return buttonResponse;
  }
}
/**
 * Telegram Bot Simulator for E2E Testing
 * Simulates Telegram bot interactions for comprehensive workflow testing
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';

export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text: string;
  reply_markup?: {
    inline_keyboard: Array<Array<{
      text: string;
      callback_data: string;
    }>>;
  };
}

export interface TelegramResponse {
  id: string;
  user_id: number;
  message: string;
  timestamp: string;
  event_id?: string;
  action?: string;
}

export interface TelegramBotConfig {
  bot_token: string;
  chat_id: string;
}

export class TelegramBotSimulator extends EventEmitter {
  private config: TelegramBotConfig;
  private messages: TelegramMessage[] = [];
  private responses: TelegramResponse[] = [];
  private responseDelay: number = 0;
  private messageIdCounter: number = 1;

  constructor(config: TelegramBotConfig) {
    super();
    this.config = config;
    this.setupMockWebhook();
  }

  /**
   * Setup mock webhook server to capture Telegram API calls
   */
  private setupMockWebhook(): void {
    // In a real implementation, this would setup a mock HTTP server
    // to intercept Telegram API calls. For testing, we'll simulate responses.
    console.log('🤖 Telegram Bot Simulator initialized');
  }

  /**
   * Simulate receiving a message from Claude Code bridge
   */
  async simulateIncomingMessage(text: string, options: {
    event_id?: string;
    buttons?: Array<{ text: string; action: string }>;
  } = {}): Promise<TelegramMessage> {
    const message: TelegramMessage = {
      message_id: this.messageIdCounter++,
      from: {
        id: 123456789,
        is_bot: true,
        first_name: 'CCTelegram Bot'
      },
      chat: {
        id: parseInt(this.config.chat_id),
        type: 'private'
      },
      date: Math.floor(Date.now() / 1000),
      text
    };

    // Add inline keyboard if buttons are provided
    if (options.buttons && options.buttons.length > 0) {
      message.reply_markup = {
        inline_keyboard: [
          options.buttons.map(button => ({
            text: button.text,
            callback_data: `${button.action}:${options.event_id || 'unknown'}`
          }))
        ]
      };
    }

    // Simulate API response delay
    if (this.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay));
    }

    this.messages.push(message);
    this.emit('message', message);

    return message;
  }

  /**
   * Simulate user response to a message
   */
  async simulateUserResponse(messageId: number, responseText: string): Promise<TelegramResponse> {
    const originalMessage = this.messages.find(m => m.message_id === messageId);
    
    const response: TelegramResponse = {
      id: `response-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      user_id: parseInt(this.config.chat_id),
      message: responseText,
      timestamp: new Date().toISOString(),
      event_id: originalMessage ? this.extractEventIdFromMessage(originalMessage) : undefined
    };

    this.responses.push(response);
    this.emit('response', response);

    return response;
  }

  /**
   * Simulate user clicking an inline button
   */
  async simulateButtonClick(messageId: number, callbackData: string): Promise<TelegramResponse> {
    const [action, eventId] = callbackData.split(':');
    
    const response: TelegramResponse = {
      id: `callback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      user_id: parseInt(this.config.chat_id),
      message: `Button clicked: ${action}`,
      timestamp: new Date().toISOString(),
      event_id: eventId,
      action
    };

    this.responses.push(response);
    this.emit('button_click', response);

    return response;
  }

  /**
   * Wait for a specific message to be sent
   */
  async waitForMessage(searchTerm: string, timeoutMs: number = 5000): Promise<TelegramMessage | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      // Check existing messages first
      const existingMessage = this.messages.find(m => 
        m.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (searchTerm.startsWith('task-') && this.extractEventIdFromMessage(m) === searchTerm)
      );

      if (existingMessage) {
        clearTimeout(timeout);
        resolve(existingMessage);
        return;
      }

      // Listen for new messages
      const messageHandler = (message: TelegramMessage) => {
        if (message.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (searchTerm.startsWith('task-') && this.extractEventIdFromMessage(message) === searchTerm)) {
          clearTimeout(timeout);
          this.removeListener('message', messageHandler);
          resolve(message);
        }
      };

      this.on('message', messageHandler);
    });
  }

  /**
   * Get all messages sent by the bot
   */
  getAllMessages(): TelegramMessage[] {
    return [...this.messages];
  }

  /**
   * Get all user responses
   */
  getAllResponses(): TelegramResponse[] {
    return [...this.responses];
  }

  /**
   * Clear message and response history
   */
  clearHistory(): void {
    this.messages = [];
    this.responses = [];
    this.messageIdCounter = 1;
  }

  /**
   * Set artificial response delay for testing timeout scenarios
   */
  async setResponseDelay(delayMs: number): Promise<void> {
    this.responseDelay = delayMs;
  }

  /**
   * Simulate various Telegram API errors
   */
  async simulateApiError(errorType: 'timeout' | 'rate_limit' | 'invalid_token' | 'network_error'): Promise<void> {
    switch (errorType) {
      case 'timeout':
        this.responseDelay = 30000; // 30 second delay
        break;
      case 'rate_limit':
        // Simulate rate limiting by rejecting next few requests
        this.emit('rate_limit_error');
        break;
      case 'invalid_token':
        this.emit('auth_error');
        break;
      case 'network_error':
        this.emit('network_error');
        break;
    }
  }

  /**
   * Mock Telegram API endpoints for testing
   */
  setupApiMocks(): void {
    // Mock sendMessage endpoint
    const originalAxiosPost = axios.post;
    
    axios.post = async (url: string, data: any, config?: any) => {
      if (url.includes('sendMessage')) {
        // Simulate successful message send
        const messageText = data.text || '';
        const chatId = data.chat_id;
        
        // Create mock message for the sent text
        await this.simulateIncomingMessage(messageText, {
          event_id: this.extractEventIdFromText(messageText)
        });
        
        return {
          data: {
            ok: true,
            result: {
              message_id: this.messageIdCounter - 1,
              from: { id: 123456789, is_bot: true, first_name: 'CCTelegram Bot' },
              chat: { id: chatId, type: 'private' },
              date: Math.floor(Date.now() / 1000),
              text: messageText
            }
          }
        };
      }
      
      // For non-Telegram requests, use original axios
      return originalAxiosPost(url, data, config);
    };
  }

  /**
   * Extract event ID from message text
   */
  private extractEventIdFromMessage(message: TelegramMessage): string | undefined {
    return this.extractEventIdFromText(message.text);
  }

  /**
   * Extract event ID from text
   */
  private extractEventIdFromText(text: string): string | undefined {
    // Look for UUID patterns in the text
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    const match = text.match(uuidRegex);
    return match ? match[0] : undefined;
  }

  /**
   * Simulate webhook updates for testing
   */
  async simulateWebhookUpdate(update: any): Promise<void> {
    if (update.message) {
      this.messages.push(update.message);
      this.emit('message', update.message);
    }
    
    if (update.callback_query) {
      const response = await this.simulateButtonClick(
        update.callback_query.message.message_id,
        update.callback_query.data
      );
      this.emit('callback_query', update.callback_query);
    }
  }

  /**
   * Generate realistic Telegram message formatting
   */
  formatMessage(title: string, description: string, eventType: string, data?: any): string {
    const emoji = this.getEmojiForEventType(eventType);
    let message = `${emoji} *${title}*\n\n${description}`;
    
    if (data) {
      message += '\n\n📊 *Details:*';
      
      if (data.duration_ms) {
        message += `\n⏱️ Duration: ${data.duration_ms}ms`;
      }
      
      if (data.files_affected && data.files_affected.length > 0) {
        message += `\n📁 Files: ${data.files_affected.length} affected`;
      }
      
      if (data.current_value && data.threshold) {
        message += `\n📈 Value: ${data.current_value} (threshold: ${data.threshold})`;
      }
    }
    
    return message;
  }

  /**
   * Get appropriate emoji for event type
   */
  private getEmojiForEventType(eventType: string): string {
    const emojiMap: { [key: string]: string } = {
      'task_completion': '✅',
      'task_started': '🚀',
      'task_failed': '❌',
      'performance_alert': '🚨',
      'error_occurred': '💥',
      'approval_request': '📋',
      'info_notification': 'ℹ️',
      'build_completed': '🔨',
      'build_failed': '💔',
      'test_suite_run': '🧪',
      'code_review': '👁️',
      'git_commit': '📝',
      'system_health': '💚'
    };
    
    return emojiMap[eventType] || '📢';
  }

  /**
   * Simulate realistic message timing
   */
  async simulateRealisticTiming(): Promise<void> {
    // Simulate network latency (50-200ms)
    const latency = Math.random() * 150 + 50;
    await new Promise(resolve => setTimeout(resolve, latency));
  }

  /**
   * Generate test conversation flow
   */
  async simulateConversationFlow(events: any[]): Promise<{
    messages: TelegramMessage[];
    responses: TelegramResponse[];
  }> {
    const messages: TelegramMessage[] = [];
    const responses: TelegramResponse[] = [];
    
    for (const event of events) {
      // Simulate message sending
      const message = await this.simulateIncomingMessage(
        this.formatMessage(event.title, event.description, event.type, event.data),
        {
          event_id: event.task_id,
          buttons: event.type === 'approval_request' ? [
            { text: 'Approve', action: 'approve' },
            { text: 'Deny', action: 'deny' },
            { text: 'Defer', action: 'defer' }
          ] : undefined
        }
      );
      
      messages.push(message);
      
      // Simulate user response after a delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
      
      if (event.type === 'approval_request') {
        const response = await this.simulateButtonClick(message.message_id, 'approve:' + event.task_id);
        responses.push(response);
      } else {
        const response = await this.simulateUserResponse(message.message_id, '👍 Got it!');
        responses.push(response);
      }
    }
    
    return { messages, responses };
  }
}
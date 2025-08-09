/**
 * Webhook-Specific Autocannon Benchmarking for CCTelegram
 * 
 * Focused benchmarking of webhook endpoints with realistic payloads
 * and scenarios specific to Telegram bot webhook handling
 */

import autocannon from 'autocannon';
import { AutocannonBenchmarkSuite, AutocannonResult, BenchmarkSuite, BenchmarkTest } from './autocannon-suite.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WebhookBenchmarkConfig {
  baseUrl: string;
  webhookSecret?: string;
  simulateTyping?: boolean;
  includeMediaWebhooks?: boolean;
  testTelegramFormats?: boolean;
}

/**
 * Webhook-specific benchmark runner
 */
export class WebhookBenchmarkRunner extends AutocannonBenchmarkSuite {
  private config: WebhookBenchmarkConfig;
  
  constructor(config: WebhookBenchmarkConfig) {
    super(config.baseUrl);
    this.config = config;
  }

  /**
   * Get webhook-specific benchmark suites
   */
  public getWebhookBenchmarkSuites(): BenchmarkSuite[] {
    return [
      this.getTelegramWebhookSuite(),
      this.getWebhookSecuritySuite(),
      this.getWebhookPayloadVariationSuite(),
      this.getWebhookConcurrencyScenarios(),
      this.getWebhookRealtimeSimulation()
    ];
  }

  /**
   * Telegram Webhook Message Types
   */
  private getTelegramWebhookSuite(): BenchmarkSuite {
    const telegramPayloads = {
      textMessage: this.createTelegramPayload('message', {
        message_id: 1,
        from: { id: 123456789, first_name: 'TestUser', username: 'testuser' },
        chat: { id: 123456789, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'Hello from load test!'
      }),
      
      commandMessage: this.createTelegramPayload('message', {
        message_id: 2,
        from: { id: 123456789, first_name: 'TestUser', username: 'testuser' },
        chat: { id: 123456789, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }]
      }),
      
      callbackQuery: this.createTelegramPayload('callback_query', {
        id: 'callback123',
        from: { id: 123456789, first_name: 'TestUser', username: 'testuser' },
        message: {
          message_id: 3,
          from: { id: 987654321, first_name: 'Bot', username: 'testbot' },
          chat: { id: 123456789, type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: 'Choose an option:'
        },
        data: 'callback_data_test'
      }),
      
      inlineQuery: this.createTelegramPayload('inline_query', {
        id: 'inline123',
        from: { id: 123456789, first_name: 'TestUser', username: 'testuser' },
        query: 'test query',
        offset: ''
      }),
      
      photoMessage: this.createTelegramPayload('message', {
        message_id: 4,
        from: { id: 123456789, first_name: 'TestUser', username: 'testuser' },
        chat: { id: 123456789, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        photo: [
          {
            file_id: 'photo_file_id_test',
            file_unique_id: 'photo_unique_id',
            width: 1280,
            height: 720,
            file_size: 65536
          }
        ],
        caption: 'Test photo caption'
      }),
      
      groupMessage: this.createTelegramPayload('message', {
        message_id: 5,
        from: { id: 123456789, first_name: 'TestUser', username: 'testuser' },
        chat: { 
          id: -1001234567890, 
          title: 'Test Group', 
          type: 'supergroup'
        },
        date: Math.floor(Date.now() / 1000),
        text: 'Group message test',
        reply_to_message: {
          message_id: 4,
          from: { id: 987654321, first_name: 'OtherUser' },
          chat: { id: -1001234567890, title: 'Test Group', type: 'supergroup' },
          date: Math.floor(Date.now() / 1000) - 300,
          text: 'Previous message'
        }
      })
    };

    return {
      name: 'Telegram Webhook Message Types',
      description: 'Performance testing of different Telegram webhook message types',
      tests: [
        {
          name: 'text_messages_high_volume',
          description: 'High volume text message processing',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 50,
            duration: 60,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0',
              ...(this.config.webhookSecret && {
                'X-Telegram-Bot-Api-Secret-Token': this.config.webhookSecret
              })
            },
            body: telegramPayloads.textMessage,
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 1500,
            minThroughput: 200,
            maxErrorRate: 2,
            minSuccessRate: 98
          }
        },
        
        {
          name: 'command_processing_burst',
          description: 'Bot command processing under burst load',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 30,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: telegramPayloads.commandMessage,
            timeout: 20000
          },
          expectedThresholds: {
            maxLatencyP95: 2000,
            minThroughput: 100,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        },
        
        {
          name: 'callback_query_handling',
          description: 'Callback query processing performance',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 25,
            duration: 45,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: telegramPayloads.callbackQuery,
            timeout: 25000
          },
          expectedThresholds: {
            maxLatencyP95: 1000,
            minThroughput: 80,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        },
        
        {
          name: 'inline_query_performance',
          description: 'Inline query processing under load',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 20,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: telegramPayloads.inlineQuery,
            timeout: 15000
          },
          expectedThresholds: {
            maxLatencyP95: 800,
            minThroughput: 60,
            maxErrorRate: 2,
            minSuccessRate: 98
          }
        },
        
        {
          name: 'media_messages_processing',
          description: 'Photo/media message processing',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 15,
            duration: 45,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: telegramPayloads.photoMessage,
            timeout: 45000
          },
          expectedThresholds: {
            maxLatencyP95: 3000,
            minThroughput: 40,
            maxErrorRate: 3,
            minSuccessRate: 97
          }
        },
        
        {
          name: 'group_messages_complex',
          description: 'Complex group message processing with replies',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 20,
            duration: 40,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: telegramPayloads.groupMessage,
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 2000,
            minThroughput: 60,
            maxErrorRate: 2,
            minSuccessRate: 98
          }
        }
      ]
    };
  }

  /**
   * Webhook Security Testing
   */
  private getWebhookSecuritySuite(): BenchmarkSuite {
    const securityPayloads = {
      validWebhook: this.createTelegramPayload('message', {
        message_id: 100,
        from: { id: 123456789, first_name: 'ValidUser' },
        chat: { id: 123456789, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'Valid webhook test'
      }),
      
      malformedPayload: '{"invalid": "json", "missing_required_fields": true}',
      
      oversizedPayload: JSON.stringify({
        update_id: 1000,
        message: {
          message_id: 1000,
          from: { id: 123456789, first_name: 'TestUser' },
          chat: { id: 123456789, type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: 'Large payload test',
          // Simulate very large text
          large_data: Array.from({ length: 10000 }, (_, i) => `large-data-item-${i}`).join(' ')
        }
      })
    };

    return {
      name: 'Webhook Security & Validation',
      description: 'Testing webhook security, validation, and malformed request handling',
      tests: [
        {
          name: 'valid_webhook_baseline',
          description: 'Baseline performance with valid webhook payloads',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 20,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: securityPayloads.validWebhook,
            timeout: 20000
          },
          expectedThresholds: {
            maxLatencyP95: 1000,
            minThroughput: 80,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        },
        
        {
          name: 'malformed_payload_handling',
          description: 'Handling of malformed webhook payloads',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 15,
            duration: 20,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: securityPayloads.malformedPayload,
            timeout: 10000
          },
          expectedThresholds: {
            maxLatencyP95: 500,
            minThroughput: 100,
            maxErrorRate: 100, // We expect these to fail validation
            minSuccessRate: 0 // Malformed requests should be rejected
          }
        },
        
        {
          name: 'oversized_payload_protection',
          description: 'Protection against oversized payloads',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 10,
            duration: 20,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: securityPayloads.oversizedPayload,
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 2000,
            minThroughput: 30,
            maxErrorRate: 20, // Some may be rejected due to size
            minSuccessRate: 80
          }
        },
        
        {
          name: 'rate_limiting_behavior',
          description: 'Rate limiting behavior under rapid requests',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 100, // High connection count to trigger rate limiting
            duration: 15,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: securityPayloads.validWebhook,
            timeout: 10000
          },
          expectedThresholds: {
            maxLatencyP95: 5000,
            minThroughput: 50,
            maxErrorRate: 30, // Expect rate limiting
            minSuccessRate: 70
          }
        }
      ]
    };
  }

  /**
   * Webhook Payload Variation Testing
   */
  private getWebhookPayloadVariationSuite(): BenchmarkSuite {
    return {
      name: 'Webhook Payload Variations',
      description: 'Testing different webhook payload sizes and structures',
      tests: [
        {
          name: 'minimal_payload',
          description: 'Minimal valid Telegram webhook payload',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 30,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: JSON.stringify({
              update_id: 1,
              message: {
                message_id: 1,
                from: { id: 1, first_name: 'U' },
                chat: { id: 1, type: 'private' },
                date: Math.floor(Date.now() / 1000),
                text: 'Hi'
              }
            }),
            timeout: 10000
          },
          expectedThresholds: {
            maxLatencyP95: 500,
            minThroughput: 150,
            maxErrorRate: 1,
            minSuccessRate: 99
          }
        },
        
        {
          name: 'complex_rich_payload',
          description: 'Complex webhook with rich content and metadata',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 20,
            duration: 45,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: this.createComplexTelegramPayload(),
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 2000,
            minThroughput: 60,
            maxErrorRate: 2,
            minSuccessRate: 98
          }
        },
        
        {
          name: 'unicode_heavy_payload',
          description: 'Payloads with heavy Unicode content',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 15,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: this.createUnicodeHeavyPayload(),
            timeout: 20000
          },
          expectedThresholds: {
            maxLatencyP95: 1500,
            minThroughput: 50,
            maxErrorRate: 3,
            minSuccessRate: 97
          }
        }
      ]
    };
  }

  /**
   * Concurrency Scenarios Specific to Webhooks
   */
  private getWebhookConcurrencyScenarios(): BenchmarkSuite {
    return {
      name: 'Webhook Concurrency Scenarios',
      description: 'Real-world webhook concurrency patterns',
      tests: [
        {
          name: 'burst_conversation',
          description: 'Simulating burst conversation from multiple users',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 40,
            duration: 20, // Short burst
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: this.createRandomUserMessage(),
            timeout: 15000
          },
          expectedThresholds: {
            maxLatencyP95: 2000,
            minThroughput: 150,
            maxErrorRate: 3,
            minSuccessRate: 97
          }
        },
        
        {
          name: 'sustained_mixed_load',
          description: 'Sustained mixed message types from various sources',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 25,
            duration: 120, // 2 minutes sustained
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: this.createMixedMessageTypes(),
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 3000,
            minThroughput: 80,
            maxErrorRate: 5,
            minSuccessRate: 95
          }
        },
        
        {
          name: 'group_activity_spike',
          description: 'High activity in group chats',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 60,
            duration: 30,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: this.createGroupActivityPayload(),
            timeout: 25000
          },
          expectedThresholds: {
            maxLatencyP95: 4000,
            minThroughput: 200,
            maxErrorRate: 8,
            minSuccessRate: 92
          }
        }
      ]
    };
  }

  /**
   * Real-time Webhook Simulation
   */
  private getWebhookRealtimeSimulation(): BenchmarkSuite {
    return {
      name: 'Real-time Webhook Simulation',
      description: 'Simulating real-world webhook patterns with timing',
      tests: [
        {
          name: 'typing_simulation',
          description: 'Simulating users typing with realistic delays',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 10,
            duration: 60,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: this.createTypingSimulationPayload(),
            timeout: 20000
          },
          expectedThresholds: {
            maxLatencyP95: 1000,
            minThroughput: 30,
            maxErrorRate: 2,
            minSuccessRate: 98
          }
        },
        
        {
          name: 'notification_cascade',
          description: 'Cascading notifications and responses',
          config: {
            url: `${this.config.baseUrl}/webhook/telegram`,
            connections: 35,
            duration: 45,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Telegram-Bot-API/1.0'
            },
            body: this.createNotificationCascadePayload(),
            timeout: 30000
          },
          expectedThresholds: {
            maxLatencyP95: 2500,
            minThroughput: 100,
            maxErrorRate: 4,
            minSuccessRate: 96
          }
        }
      ]
    };
  }

  /**
   * Helper methods for creating specific payloads
   */
  
  private createTelegramPayload(updateType: string, content: any): string {
    return JSON.stringify({
      update_id: Math.floor(Math.random() * 1000000),
      [updateType]: content
    });
  }

  private createComplexTelegramPayload(): string {
    return this.createTelegramPayload('message', {
      message_id: 999,
      from: {
        id: 123456789,
        is_bot: false,
        first_name: 'ComplexUser',
        last_name: 'TestSuite',
        username: 'complex_test_user',
        language_code: 'en'
      },
      chat: {
        id: 123456789,
        first_name: 'ComplexUser',
        last_name: 'TestSuite',
        username: 'complex_test_user',
        type: 'private'
      },
      date: Math.floor(Date.now() / 1000),
      text: 'This is a complex message with many entities and formatting.',
      entities: [
        { offset: 10, length: 7, type: 'bold' },
        { offset: 25, length: 7, type: 'italic' },
        { offset: 40, length: 15, type: 'code' },
        { offset: 60, length: 20, type: 'url', url: 'https://example.com' }
      ],
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Button 1', callback_data: 'btn1' },
            { text: 'Button 2', callback_data: 'btn2' }
          ],
          [
            { text: 'URL Button', url: 'https://example.com' }
          ]
        ]
      }
    });
  }

  private createUnicodeHeavyPayload(): string {
    const unicodeText = '🚀 Testing Unicode: 你好世界 🌟 مرحبا بالعالم 🎉 Здравствуй мир 🌈 नमस्ते दुनिया 🎭';
    return this.createTelegramPayload('message', {
      message_id: 888,
      from: { id: 123456789, first_name: '测试用户', username: 'unicode_test' },
      chat: { id: 123456789, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: unicodeText.repeat(10) // Repeat for larger payload
    });
  }

  private createRandomUserMessage(): string {
    const userIds = [111, 222, 333, 444, 555];
    const messages = [
      'Hello!', 'How are you?', 'Thanks!', 'Great work!', 'Looking forward to it!',
      'Can you help me?', 'That sounds good.', 'I agree.', 'Interesting point.',
      'Let me know when ready.'
    ];
    
    const userId = userIds[Math.floor(Math.random() * userIds.length)];
    const message = messages[Math.floor(Math.random() * messages.length)];
    
    return this.createTelegramPayload('message', {
      message_id: Math.floor(Math.random() * 10000),
      from: { id: userId, first_name: `User${userId}` },
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: message
    });
  }

  private createMixedMessageTypes(): string {
    const messageTypes = [
      () => this.createTelegramPayload('message', {
        message_id: Math.floor(Math.random() * 10000),
        from: { id: 123, first_name: 'MixedUser' },
        chat: { id: 123, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'Mixed message type test'
      }),
      
      () => this.createTelegramPayload('callback_query', {
        id: `callback_${Math.random()}`,
        from: { id: 456, first_name: 'CallbackUser' },
        data: 'mixed_test_callback'
      }),
      
      () => this.createTelegramPayload('inline_query', {
        id: `inline_${Math.random()}`,
        from: { id: 789, first_name: 'InlineUser' },
        query: 'mixed test query',
        offset: ''
      })
    ];
    
    const randomType = messageTypes[Math.floor(Math.random() * messageTypes.length)];
    return randomType();
  }

  private createGroupActivityPayload(): string {
    const groupId = -1001234567890;
    const users = [
      { id: 111, first_name: 'Alice' },
      { id: 222, first_name: 'Bob' },
      { id: 333, first_name: 'Charlie' },
      { id: 444, first_name: 'Diana' }
    ];
    
    const user = users[Math.floor(Math.random() * users.length)];
    const messages = [
      'Group message test',
      '@everyone check this out!',
      'Reply to previous message',
      'Forwarded important info',
      'Group activity spike simulation'
    ];
    
    return this.createTelegramPayload('message', {
      message_id: Math.floor(Math.random() * 10000),
      from: user,
      chat: {
        id: groupId,
        title: 'Load Test Group',
        type: 'supergroup'
      },
      date: Math.floor(Date.now() / 1000),
      text: messages[Math.floor(Math.random() * messages.length)]
    });
  }

  private createTypingSimulationPayload(): string {
    return this.createTelegramPayload('message', {
      message_id: Math.floor(Math.random() * 10000),
      from: { id: 555, first_name: 'TypingUser' },
      chat: { id: 555, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: 'User is typing simulation...'
    });
  }

  private createNotificationCascadePayload(): string {
    return this.createTelegramPayload('message', {
      message_id: Math.floor(Math.random() * 10000),
      from: { id: 666, first_name: 'NotificationUser' },
      chat: { id: 666, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: 'Notification cascade simulation - high priority alert!'
    });
  }

  /**
   * Run webhook-specific benchmarks
   */
  public async runWebhookBenchmarks(): Promise<void> {
    console.log('Starting Webhook-Specific Autocannon Benchmarks');
    console.log(`Target: ${this.config.baseUrl}`);
    console.log(`Webhook Secret: ${this.config.webhookSecret ? 'Configured' : 'Not configured'}`);
    
    const suites = this.getWebhookBenchmarkSuites();
    
    for (const suite of suites) {
      console.log(`\n--- Running Suite: ${suite.name} ---`);
      try {
        const results = await this.runSuite(suite);
        
        // Save webhook-specific results
        const outputPath = path.join(__dirname, '..', '..', '..', 'reports', 'webhook-benchmarks');
        await fs.ensureDir(outputPath);
        
        const fileName = `webhook-${suite.name.toLowerCase().replace(/\s+/g, '-')}-results.json`;
        await fs.writeJSON(path.join(outputPath, fileName), results, { spaces: 2 });
        
        console.log(`Suite completed: ${results.summary.passed}/${results.summary.totalTests} tests passed`);
      } catch (error) {
        console.error(`Suite failed: ${suite.name}`, error);
      }
    }
    
    console.log('\nWebhook benchmarks completed!');
  }
}

// Export runner for use in other scripts
export async function runWebhookBenchmarks(config: WebhookBenchmarkConfig): Promise<void> {
  const runner = new WebhookBenchmarkRunner(config);
  await runner.runWebhookBenchmarks();
}
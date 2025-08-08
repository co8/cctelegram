/**
 * Start Mock Services for CCTelegram Bridge Testing
 * Launches Telegram mock server and other supporting services
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const PORTS = {
  TELEGRAM_MOCK: 3002,
  HEALTH_CHECK: 3003
};

class MockServiceManager {
  constructor() {
    this.services = new Map();
    this.isShuttingDown = false;
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async start() {
    console.log('🚀 Starting mock services for CCTelegram bridge testing...');
    
    try {
      // Start Telegram mock server
      await this.startTelegramMock();
      
      // Start health check service
      await this.startHealthCheck();
      
      console.log('✅ All mock services started successfully');
      console.log(`📱 Telegram Mock: http://localhost:${PORTS.TELEGRAM_MOCK}`);
      console.log(`🔍 Health Check: http://localhost:${PORTS.HEALTH_CHECK}`);
      console.log('\n🎯 Ready for CCTelegram bridge testing!');
      console.log('Press Ctrl+C to stop all services\n');
      
      // Keep the process alive
      this.keepAlive();
      
    } catch (error) {
      console.error('❌ Failed to start mock services:', error);
      process.exit(1);
    }
  }

  async startTelegramMock() {
    return new Promise((resolve, reject) => {
      const app = express();
      app.use(express.json());
      
      const messages = [];
      
      // Mock Telegram Bot API endpoints
      app.post('/bot*/sendMessage', (req, res) => {
        const { chat_id, text, reply_markup } = req.body;
        
        const message = {
          message_id: Date.now() + Math.floor(Math.random() * 1000),
          chat: { id: chat_id, type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text,
          reply_markup
        };
        
        messages.push(message);
        console.log(`📤 Telegram message: ${text?.substring(0, 100)}${text?.length > 100 ? '...' : ''}`);
        
        res.json({ ok: true, result: message });
      });
      
      app.get('/bot*/getMe', (req, res) => {
        res.json({
          ok: true,
          result: {
            id: 123456789,
            is_bot: true,
            first_name: 'CCTelegram Test Bot',
            username: 'cctelegram_test_bot'
          }
        });
      });
      
      // Debug endpoints
      app.get('/debug/messages', (req, res) => {
        res.json({ messages, count: messages.length });
      });
      
      app.post('/debug/clear', (req, res) => {
        messages.length = 0;
        res.json({ ok: true, message: 'Messages cleared' });
      });
      
      app.get('/health', (req, res) => {
        res.json({ ok: true, service: 'telegram-mock', messages: messages.length });
      });
      
      const server = app.listen(PORTS.TELEGRAM_MOCK, () => {
        console.log(`✅ Telegram mock server started on port ${PORTS.TELEGRAM_MOCK}`);
        this.services.set('telegram-mock', server);
        resolve();
      });
      
      server.on('error', reject);
    });
  }

  async startHealthCheck() {
    return new Promise((resolve, reject) => {
      const app = express();
      
      app.get('/health', (req, res) => {
        const services = {
          'telegram-mock': this.services.has('telegram-mock'),
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        };
        
        res.json({ ok: true, services });
      });
      
      app.get('/status', (req, res) => {
        res.json({
          mock_services_running: true,
          services: Array.from(this.services.keys()),
          ports: PORTS
        });
      });
      
      const server = app.listen(PORTS.HEALTH_CHECK, () => {
        console.log(`✅ Health check server started on port ${PORTS.HEALTH_CHECK}`);
        this.services.set('health-check', server);
        resolve();
      });
      
      server.on('error', reject);
    });
  }

  keepAlive() {
    setInterval(() => {
      if (!this.isShuttingDown) {
        console.log(`⚡ Mock services running (${this.services.size} services active)`);
      }
    }, 30000); // Status update every 30 seconds
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    console.log('\n🛑 Shutting down mock services...');
    
    const shutdownPromises = Array.from(this.services.entries()).map(([name, server]) => {
      return new Promise((resolve) => {
        console.log(`   Stopping ${name}...`);
        server.close(() => {
          console.log(`   ✅ ${name} stopped`);
          resolve();
        });
      });
    });
    
    await Promise.all(shutdownPromises);
    console.log('✅ All mock services stopped');
    process.exit(0);
  }
}

// Start the services if this script is run directly
if (require.main === module) {
  const manager = new MockServiceManager();
  manager.start().catch(console.error);
}

module.exports = MockServiceManager;
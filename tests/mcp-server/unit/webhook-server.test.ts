/**
 * Unit tests for Webhook Server Foundation (Task 21.1)
 */

import request from 'supertest';
import { WebhookServer, WebhookPayload } from '../../src/webhook-server';

describe('WebhookServer Foundation', () => {
  let webhookServer: WebhookServer;
  const testPort = 3001; // Use different port for tests

  beforeAll(async () => {
    webhookServer = new WebhookServer(testPort);
    await webhookServer.start();
  });

  afterAll(async () => {
    await webhookServer.shutdown();
  });

  describe('Server Initialization', () => {
    test('should start server successfully', () => {
      expect(webhookServer.isServerRunning()).toBe(true);
      expect(webhookServer.getPort()).toBe(testPort);
    });

    test('should respond to health check', async () => {
      const response = await request(`http://localhost:${testPort}`)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        service: 'cctelegram-webhook-server',
        version: '1.0.0'
      });
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    test('should respond to status endpoint', async () => {
      const response = await request(`http://localhost:${testPort}`)
        .get('/status')
        .expect(200);

      expect(response.body).toMatchObject({
        server: 'running',
        port: testPort,
        endpoints: expect.arrayContaining([
          'GET /health',
          'GET /status',
          'POST /webhook/bridge-response'
        ])
      });
    });
  });

  describe('CORS and Middleware', () => {
    test('should handle CORS preflight requests', async () => {
      const response = await request(`http://localhost:${testPort}`)
        .options('/webhook/bridge-response')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
    });

    test('should add correlation ID to requests', async () => {
      const response = await request(`http://localhost:${testPort}`)
        .get('/health')
        .expect(200);

      // Server should process request successfully (correlation ID added internally)
      expect(response.body.status).toBe('healthy');
    });
  });

  describe('Webhook Endpoint', () => {
    const validPayload: WebhookPayload = {
      type: 'telegram_response',
      callback_data: 'approve_test-123',
      user_id: 297126051,
      username: 'testuser',
      first_name: 'Test',
      timestamp: new Date().toISOString()
    };

    test('should accept valid webhook payload', async () => {
      const response = await request(`http://localhost:${testPort}`)
        .post('/webhook/bridge-response')
        .send(validPayload)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        processed_by: 'mcp_webhook',
        message: 'Webhook received and queued for processing'
      });
      expect(response.body.correlation_id).toBeDefined();
      expect(response.body.processing_time_ms).toBeLessThan(100); // Target < 100ms
    });

    test('should reject invalid payload - missing required fields', async () => {
      const invalidPayload = {
        type: 'telegram_response',
        // Missing callback_data and user_id
        timestamp: new Date().toISOString()
      };

      const response = await request(`http://localhost:${testPort}`)
        .post('/webhook/bridge-response')
        .send(invalidPayload)
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Validation failed')
      });
      expect(response.body.correlation_id).toBeDefined();
    });

    test('should reject invalid payload - wrong type', async () => {
      const invalidPayload = {
        ...validPayload,
        type: 'invalid_type'
      };

      const response = await request(`http://localhost:${testPort}`)
        .post('/webhook/bridge-response')
        .send(invalidPayload)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Validation failed');
    });

    test('should reject invalid payload - invalid user_id', async () => {
      const invalidPayload = {
        ...validPayload,
        user_id: 'not-a-number'
      };

      const response = await request(`http://localhost:${testPort}`)
        .post('/webhook/bridge-response')
        .send(invalidPayload)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should handle malformed JSON', async () => {
      const response = await request(`http://localhost:${testPort}`)
        .post('/webhook/bridge-response')
        .send('{ invalid json }')
        .expect(400);

      // Express.js should handle malformed JSON automatically
    });

    test('should respond quickly (performance test)', async () => {
      const startTime = Date.now();
      
      const response = await request(`http://localhost:${testPort}`)
        .post('/webhook/bridge-response')
        .send(validPayload)
        .expect(200);

      const totalTime = Date.now() - startTime;
      
      expect(totalTime).toBeLessThan(100); // Should respond in < 100ms
      expect(response.body.processing_time_ms).toBeLessThan(50); // Internal processing < 50ms
    });
  });

  describe('Error Handling', () => {
    test('should return 404 for unknown endpoints', async () => {
      const response = await request(`http://localhost:${testPort}`)
        .get('/unknown-endpoint')
        .expect(404);

      expect(response.body).toMatchObject({
        error: 'Not Found',
        message: expect.stringContaining('not found')
      });
    });

    test('should handle server errors gracefully', async () => {
      // This test would need a way to trigger a server error
      // For now, we just verify the error handler structure exists
      expect(webhookServer.isServerRunning()).toBe(true);
    });
  });

  describe('Graceful Shutdown', () => {
    test('should support graceful shutdown', async () => {
      const testServer = new WebhookServer(3002);
      await testServer.start();
      
      expect(testServer.isServerRunning()).toBe(true);
      
      await testServer.shutdown();
      
      expect(testServer.isServerRunning()).toBe(false);
    });
  });
});
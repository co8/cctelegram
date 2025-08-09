/**
 * Webhook Server Security Headers Integration Tests
 * 
 * Test security headers implementation in the webhook server
 * Validates CSP, HSTS, frame options, and other security headers
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { WebhookServer } from '../../src/webhook-server.js';

describe('Webhook Server Security Headers Integration', () => {
  let server: WebhookServer;
  let app: any;

  beforeAll(async () => {
    server = new WebhookServer(0); // Use random port
    await server.start();
    // Get the Express app for testing
    app = (server as any).app;
  });

  afterAll(async () => {
    if (server) {
      await server.shutdown();
    }
  });

  describe('Security Headers Compliance', () => {
    test('should apply all required security headers', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      
      // Check critical security headers
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(response.headers['strict-transport-security']).toBeDefined();
    });

    test('should set proper Content Security Policy', async () => {
      const response = await request(app).get('/health');
      const csp = response.headers['content-security-policy'];
      
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("'strict-dynamic'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('nonce-'); // Should contain nonce
    });

    test('should set HSTS header with proper configuration', async () => {
      const response = await request(app).get('/health');
      const hsts = response.headers['strict-transport-security'];
      
      expect(hsts).toBeDefined();
      expect(hsts).toContain('max-age=');
      expect(hsts).toContain('includeSubDomains');
    });

    test('should set frame options to DENY', async () => {
      const response = await request(app).get('/health');
      
      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    test('should set content type options to nosniff', async () => {
      const response = await request(app).get('/health');
      
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    test('should set referrer policy', async () => {
      const response = await request(app).get('/health');
      
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    test('should set permissions policy', async () => {
      const response = await request(app).get('/health');
      
      expect(response.headers['permissions-policy']).toBeDefined();
      const permissionsPolicy = response.headers['permissions-policy'];
      expect(permissionsPolicy).toContain('camera=()');
      expect(permissionsPolicy).toContain('geolocation=()');
      expect(permissionsPolicy).toContain('microphone=()');
    });

    test('should set CORS headers alongside security headers', async () => {
      const response = await request(app).get('/health');
      
      // Security headers should not interfere with CORS
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
      expect(response.headers['access-control-allow-headers']).toBeDefined();
    });
  });

  describe('CSP Nonce Implementation', () => {
    test('should generate unique nonces for each request', async () => {
      const response1 = await request(app).get('/health');
      const response2 = await request(app).get('/health');
      
      const csp1 = response1.headers['content-security-policy'] as string;
      const csp2 = response2.headers['content-security-policy'] as string;
      
      // Extract nonces from CSP headers
      const nonce1Match = csp1?.match(/nonce-([A-Za-z0-9+/=]+)/);
      const nonce2Match = csp2?.match(/nonce-([A-Za-z0-9+/=]+)/);
      
      expect(nonce1Match).toBeTruthy();
      expect(nonce2Match).toBeTruthy();
      expect(nonce1Match![1]).not.toBe(nonce2Match![1]);
    });

    test('should include nonces in both script-src and style-src', async () => {
      const response = await request(app).get('/health');
      const csp = response.headers['content-security-policy'] as string;
      
      // Should have nonces in both script-src and style-src
      const scriptNonceMatch = csp?.match(/script-src[^;]*nonce-([A-Za-z0-9+/=]+)/);
      const styleNonceMatch = csp?.match(/style-src[^;]*nonce-([A-Za-z0-9+/=]+)/);
      
      expect(scriptNonceMatch).toBeTruthy();
      expect(styleNonceMatch).toBeTruthy();
    });

    test('should use correlation ID for nonce tracking', async () => {
      const correlationId = 'test-correlation-123';
      
      const response = await request(app)
        .get('/health')
        .set('X-Correlation-ID', correlationId);
      
      expect(response.status).toBe(200);
      
      // The security headers manager should have stored the nonce for this correlation ID
      const securityManager = server.getSecurityHeadersManager();
      const storedNonce = securityManager.getNonce(correlationId);
      expect(storedNonce).toBeDefined();
    });
  });

  describe('Security Headers Status Endpoint', () => {
    test('should provide security headers status', async () => {
      const response = await request(app).get('/security-headers');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('validation');
      expect(response.body).toHaveProperty('headers_status');
      expect(response.body).toHaveProperty('nonce_example');
    });

    test('should show compliant status when properly configured', async () => {
      const response = await request(app).get('/security-headers');
      
      expect(response.body.status).toBe('compliant');
      expect(response.body.validation.valid).toBe(true);
    });

    test('should list enabled and disabled headers', async () => {
      const response = await request(app).get('/security-headers');
      const headersStatus = response.body.headers_status;
      
      expect(Array.isArray(headersStatus.enabled_headers)).toBe(true);
      expect(Array.isArray(headersStatus.disabled_headers)).toBe(true);
      expect(headersStatus.enabled_headers.length).toBeGreaterThan(0);
    });

    test('should provide nonce examples', async () => {
      const response = await request(app).get('/security-headers');
      const nonceExample = response.body.nonce_example;
      
      expect(nonceExample).toHaveProperty('script');
      expect(nonceExample).toHaveProperty('style');
      expect(nonceExample.script).toContain('<script nonce="');
      expect(nonceExample.style).toContain('<style nonce="');
    });

    test('should include configuration details', async () => {
      const response = await request(app).get('/security-headers');
      const config = response.body.headers_status.configuration;
      
      expect(config).toHaveProperty('enableCSP');
      expect(config).toHaveProperty('enableHSTS');
      expect(config).toHaveProperty('enableFrameOptions');
      expect(config).toHaveProperty('enableContentTypeOptions');
      expect(config).toHaveProperty('enableReferrerPolicy');
    });
  });

  describe('Server Status with Security Info', () => {
    test('should include security headers info in status endpoint', async () => {
      const response = await request(app).get('/status');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('security_headers');
      
      const securityHeaders = response.body.security_headers;
      expect(securityHeaders).toHaveProperty('enabled_headers');
      expect(securityHeaders).toHaveProperty('disabled_headers');
      expect(securityHeaders).toHaveProperty('nonce_store_size');
    });

    test('should list security headers endpoint in available endpoints', async () => {
      const response = await request(app).get('/status');
      
      expect(response.body.endpoints).toContain('GET /security-headers');
    });
  });

  describe('Webhook Endpoint Security', () => {
    test('should apply security headers to webhook endpoint', async () => {
      const payload = {
        type: 'telegram_response',
        callback_data: 'test_callback',
        user_id: 123456,
        timestamp: new Date().toISOString()
      };

      const response = await request(app)
        .post('/webhook/bridge-response')
        .send(payload);
      
      // Should have security headers even on webhook endpoint
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    test('should handle OPTIONS requests with security headers', async () => {
      const response = await request(app)
        .options('/webhook/bridge-response');
      
      expect(response.status).toBe(200);
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
    });
  });

  describe('Security Headers Audit Logging', () => {
    test('should log security headers for audit', async () => {
      // Note: This test would be more effective with proper logging setup
      // For now, we just verify the endpoint works with audit middleware
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      // The audit middleware should have logged the security headers
      // In a real test environment, we would capture and verify log output
    });
  });

  describe('Error Handling with Security Headers', () => {
    test('should apply security headers to 404 responses', async () => {
      const response = await request(app).get('/non-existent-endpoint');
      
      expect(response.status).toBe(404);
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    test('should apply security headers to error responses', async () => {
      // Send invalid JSON to trigger 400 error
      const response = await request(app)
        .post('/webhook/bridge-response')
        .send('invalid json')
        .set('Content-Type', 'application/json');
      
      expect(response.status).toBe(400);
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
    });
  });

  describe('Environment-Specific Behavior', () => {
    test('should handle development vs production configurations', async () => {
      const response = await request(app).get('/health');
      const csp = response.headers['content-security-policy'];
      
      // In test environment, should behave like development
      // (no upgrade-insecure-requests directive)
      expect(csp).not.toContain('upgrade-insecure-requests');
    });
  });

  describe('Cross-Origin Headers Compatibility', () => {
    test('should not conflict with CORS headers', async () => {
      const response = await request(app).get('/health');
      
      // Both security and CORS headers should be present
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
      expect(response.headers['access-control-allow-headers']).toBeDefined();
    });

    test('should handle preflight requests properly', async () => {
      const response = await request(app)
        .options('/webhook/bridge-response')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');
      
      expect(response.status).toBe(200);
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});

describe('Security Headers Performance', () => {
  let server: WebhookServer;
  let app: any;

  beforeAll(async () => {
    server = new WebhookServer(0);
    await server.start();
    app = (server as any).app;
  });

  afterAll(async () => {
    if (server) {
      await server.shutdown();
    }
  });

  test('should not significantly impact response time', async () => {
    const startTime = Date.now();
    
    const response = await request(app).get('/health');
    
    const responseTime = Date.now() - startTime;
    
    expect(response.status).toBe(200);
    expect(responseTime).toBeLessThan(100); // Should respond within 100ms
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  test('should handle concurrent requests efficiently', async () => {
    const promises = [];
    
    // Make 10 concurrent requests
    for (let i = 0; i < 10; i++) {
      promises.push(request(app).get('/health'));
    }
    
    const responses = await Promise.all(promises);
    
    // All requests should succeed with security headers
    responses.forEach(response => {
      expect(response.status).toBe(200);
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
    });
    
    // Each should have unique nonces
    const nonces = responses.map(response => {
      const csp = response.headers['content-security-policy'] as string;
      const match = csp?.match(/nonce-([A-Za-z0-9+/=]+)/);
      return match ? match[1] : null;
    });
    
    const uniqueNonces = new Set(nonces.filter(Boolean));
    expect(uniqueNonces.size).toBe(10); // All nonces should be unique
  });
});
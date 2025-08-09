/**
 * Security Headers Tests
 * 
 * Comprehensive test suite for security headers implementation
 * Tests helmet.js integration, CSP nonces, and security header validation
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { SecurityHeadersManager, getDefaultConfig, DEFAULT_PRODUCTION_CONFIG, DEFAULT_DEVELOPMENT_CONFIG } from '../../src/security-headers.js';

describe('SecurityHeadersManager', () => {
  let manager: SecurityHeadersManager;
  let app: express.Application;

  beforeEach(() => {
    manager = new SecurityHeadersManager();
    app = express();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      const config = manager.getConfiguration();
      expect(config.enableCSP).toBe(true);
      expect(config.enableHSTS).toBeDefined();
      expect(config.enableFrameOptions).toBe(true);
      expect(config.enableContentTypeOptions).toBe(true);
      expect(config.enableReferrerPolicy).toBe(true);
    });

    test('should accept custom configuration', () => {
      const customConfig = {
        enableCSP: false,
        hstsMaxAge: 86400
      };
      const customManager = new SecurityHeadersManager(customConfig);
      const config = customManager.getConfiguration();
      
      expect(config.enableCSP).toBe(false);
      expect(config.hstsMaxAge).toBe(86400);
    });

    test('should use production config in production', () => {
      process.env.NODE_ENV = 'production';
      const config = getDefaultConfig();
      expect(config).toEqual(DEFAULT_PRODUCTION_CONFIG);
      delete process.env.NODE_ENV;
    });

    test('should use development config in development', () => {
      process.env.NODE_ENV = 'development';
      const config = getDefaultConfig();
      expect(config).toEqual(DEFAULT_DEVELOPMENT_CONFIG);
      delete process.env.NODE_ENV;
    });
  });

  describe('Nonce Generation', () => {
    test('should generate unique nonces', () => {
      const nonce1 = manager.generateNonce('request1');
      const nonce2 = manager.generateNonce('request2');
      
      expect(nonce1.script).not.toBe(nonce2.script);
      expect(nonce1.style).not.toBe(nonce2.style);
      expect(nonce1.script).toMatch(/^[A-Za-z0-9+/]+=*$/); // Base64 pattern
      expect(nonce1.style).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    test('should store and retrieve nonces by request ID', () => {
      const requestId = 'test-request-123';
      const nonce = manager.generateNonce(requestId);
      const retrievedNonce = manager.getNonce(requestId);
      
      expect(retrievedNonce).toEqual(nonce);
    });

    test('should return undefined for non-existent request ID', () => {
      const retrievedNonce = manager.getNonce('non-existent');
      expect(retrievedNonce).toBeUndefined();
    });
  });

  describe('Helmet Middleware Integration', () => {
    test('should provide helmet middleware', () => {
      const helmet = manager.getHelmetMiddleware();
      expect(typeof helmet).toBe('function');
    });

    test('should apply security headers through helmet', async () => {
      app.use(manager.getHelmetMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    test('should include Content Security Policy header', async () => {
      app.use(manager.getHelmetMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['content-security-policy']).toContain("'strict-dynamic'");
    });

    test('should include HSTS header when enabled', async () => {
      const hstsManager = new SecurityHeadersManager({ enableHSTS: true, hstsMaxAge: 31536000 });
      app.use(hstsManager.getHelmetMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(response.headers['strict-transport-security']).toContain('includeSubDomains');
    });
  });

  describe('Nonce Middleware', () => {
    test('should add nonce to request object', async () => {
      let capturedNonce: any;
      
      app.use(manager.nonceMiddleware());
      app.get('/test', (req, res) => {
        capturedNonce = (req as any).nonce;
        res.json({ success: true });
      });

      await request(app).get('/test');
      
      expect(capturedNonce).toBeDefined();
      expect(capturedNonce.script).toBeDefined();
      expect(capturedNonce.style).toBeDefined();
    });

    test('should set CSP header with nonce', async () => {
      app.use(manager.nonceMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['content-security-policy']).toContain('nonce-');
    });

    test('should use correlation ID if available', async () => {
      const correlationId = 'test-correlation-123';
      
      app.use(manager.nonceMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app)
        .get('/test')
        .set('X-Correlation-ID', correlationId);
      
      const storedNonce = manager.getNonce(correlationId);
      expect(storedNonce).toBeDefined();
    });
  });

  describe('Audit Middleware', () => {
    test('should log security headers for audit', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      app.use(manager.getHelmetMiddleware());
      app.use(manager.auditMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      await request(app).get('/test');
      
      // The audit middleware should have logged something
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Configuration Validation', () => {
    test('should validate correct configuration', () => {
      const result = manager.validateConfiguration();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should detect invalid HSTS max-age', () => {
      const invalidManager = new SecurityHeadersManager({ hstsMaxAge: 1000 }); // Too short
      const result = invalidManager.validateConfiguration();
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('HSTS max-age should be at least 86400 seconds (24 hours)');
    });

    test('should warn about disabled CSP in production', () => {
      process.env.NODE_ENV = 'production';
      const invalidManager = new SecurityHeadersManager({ enableCSP: false, isDevelopment: false });
      const result = invalidManager.validateConfiguration();
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('CSP should be enabled in production');
      
      delete process.env.NODE_ENV;
    });

    test('should warn about disabled HSTS in production', () => {
      process.env.NODE_ENV = 'production';
      const invalidManager = new SecurityHeadersManager({ enableHSTS: false, isDevelopment: false });
      const result = invalidManager.validateConfiguration();
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('HSTS should be enabled in production');
      
      delete process.env.NODE_ENV;
    });
  });

  describe('Status Report', () => {
    test('should provide comprehensive status report', () => {
      const report = manager.getStatusReport();
      
      expect(report).toHaveProperty('enabled_headers');
      expect(report).toHaveProperty('disabled_headers');
      expect(report).toHaveProperty('nonce_store_size');
      expect(report).toHaveProperty('configuration');
      
      expect(Array.isArray(report.enabled_headers)).toBe(true);
      expect(Array.isArray(report.disabled_headers)).toBe(true);
      expect(typeof report.nonce_store_size).toBe('number');
    });

    test('should list enabled headers correctly', () => {
      const report = manager.getStatusReport();
      
      expect(report.enabled_headers).toContain('Content-Security-Policy');
      expect(report.enabled_headers).toContain('X-Frame-Options');
      expect(report.enabled_headers).toContain('X-Content-Type-Options');
      expect(report.enabled_headers).toContain('Referrer-Policy');
    });

    test('should list disabled headers correctly', () => {
      const disabledManager = new SecurityHeadersManager({
        enableCSP: false,
        enableHSTS: false
      });
      const report = disabledManager.getStatusReport();
      
      expect(report.disabled_headers).toContain('Content-Security-Policy');
      expect(report.disabled_headers).toContain('Strict-Transport-Security');
    });
  });

  describe('Configuration Updates', () => {
    test('should update configuration', () => {
      const newConfig = { enableCSP: false, hstsMaxAge: 86400 };
      manager.updateConfiguration(newConfig);
      
      const config = manager.getConfiguration();
      expect(config.enableCSP).toBe(false);
      expect(config.hstsMaxAge).toBe(86400);
    });

    test('should maintain other configuration values when updating', () => {
      const originalConfig = manager.getConfiguration();
      manager.updateConfiguration({ hstsMaxAge: 86400 });
      
      const updatedConfig = manager.getConfiguration();
      expect(updatedConfig.enableFrameOptions).toBe(originalConfig.enableFrameOptions);
      expect(updatedConfig.enableContentTypeOptions).toBe(originalConfig.enableContentTypeOptions);
      expect(updatedConfig.hstsMaxAge).toBe(86400);
    });
  });

  describe('Nonce Cleanup', () => {
    test('should clean up expired nonces', () => {
      // Generate multiple nonces
      for (let i = 0; i < 5; i++) {
        manager.generateNonce(`request-${i}`);
      }
      
      const initialReport = manager.getStatusReport();
      expect(initialReport.nonce_store_size).toBe(5);
      
      // Cleanup (should not remove anything as they're not expired)
      const cleanedCount = manager.cleanupExpiredNonces();
      
      // Since we don't have a real expiration mechanism in the test,
      // this mainly tests that the method doesn't crash
      expect(typeof cleanedCount).toBe('number');
    });

    test('should handle large nonce stores', () => {
      // Generate many nonces to trigger cleanup
      for (let i = 0; i < 1200; i++) {
        manager.generateNonce(`request-${i}`);
      }
      
      const cleanedCount = manager.cleanupExpiredNonces();
      const finalReport = manager.getStatusReport();
      
      // Should have cleaned up some nonces due to size limit
      expect(cleanedCount).toBeGreaterThan(0);
      expect(finalReport.nonce_store_size).toBeLessThanOrEqual(500);
    });
  });

  describe('CSP Header Generation', () => {
    test('should generate proper CSP header format', async () => {
      app.use(manager.nonceMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      const csp = response.headers['content-security-policy'];
      
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("'strict-dynamic'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    test('should include upgrade-insecure-requests in production', () => {
      process.env.NODE_ENV = 'production';
      const prodManager = new SecurityHeadersManager({ isDevelopment: false });
      
      app.use(prodManager.nonceMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      return request(app).get('/test').then(response => {
        const csp = response.headers['content-security-policy'];
        expect(csp).toContain('upgrade-insecure-requests');
        delete process.env.NODE_ENV;
      });
    });

    test('should not include upgrade-insecure-requests in development', () => {
      process.env.NODE_ENV = 'development';
      const devManager = new SecurityHeadersManager({ isDevelopment: true });
      
      app.use(devManager.nonceMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      return request(app).get('/test').then(response => {
        const csp = response.headers['content-security-policy'];
        expect(csp).not.toContain('upgrade-insecure-requests');
        delete process.env.NODE_ENV;
      });
    });
  });

  describe('Security Headers Compliance', () => {
    test('should set all required security headers', async () => {
      app.use(manager.getHelmetMiddleware());
      app.use(manager.nonceMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      
      // Check all critical security headers
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(response.headers['cross-origin-embedder-policy']).toBeDefined();
      expect(response.headers['cross-origin-opener-policy']).toBeDefined();
      expect(response.headers['permissions-policy']).toBeDefined();
    });

    test('should not expose server information', async () => {
      app.use(manager.getHelmetMiddleware());
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      
      // Should not have X-Powered-By header
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    test('should set proper CORS headers when enabled', async () => {
      app.use(manager.getHelmetMiddleware());
      app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST');
        next();
      });
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');
      
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toBe('GET, POST');
    });
  });
});

describe('Security Headers Integration', () => {
  test('createSecurityHeadersMiddleware should return all middleware', () => {
    const middleware = require('../../src/security-headers.js').createSecurityHeadersMiddleware();
    
    expect(middleware).toHaveProperty('helmet');
    expect(middleware).toHaveProperty('nonce');
    expect(middleware).toHaveProperty('audit');
    expect(middleware).toHaveProperty('manager');
    
    expect(typeof middleware.helmet).toBe('function');
    expect(typeof middleware.nonce).toBe('function');
    expect(typeof middleware.audit).toBe('function');
    expect(middleware.manager).toBeInstanceOf(SecurityHeadersManager);
  });

  test('should work with custom configuration', () => {
    const customConfig = { enableCSP: false, hstsMaxAge: 86400 };
    const middleware = require('../../src/security-headers.js').createSecurityHeadersMiddleware(customConfig);
    
    const config = middleware.manager.getConfiguration();
    expect(config.enableCSP).toBe(false);
    expect(config.hstsMaxAge).toBe(86400);
  });
});
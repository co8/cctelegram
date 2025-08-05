/**
 * Security Headers Manager
 * 
 * Comprehensive security headers implementation using Helmet.js
 * Implements strict Content Security Policy, HSTS, and other security headers
 * for protection against XSS, clickjacking, MIME sniffing, and other attacks.
 */

import helmet, { HelmetOptions } from 'helmet';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { secureLog } from './security.js';

export interface SecurityHeadersConfig {
  enableCSP: boolean;
  enableHSTS: boolean;
  enableFrameOptions: boolean;
  enableContentTypeOptions: boolean;
  enableReferrerPolicy: boolean;
  enablePermissionsPolicy: boolean;
  hstsMaxAge: number;
  isDevelopment: boolean;
  allowUnsafeInlineDev: boolean;
}

export interface CSPNonce {
  script: string;
  style: string;
}

export class SecurityHeadersManager {
  private config: SecurityHeadersConfig;
  private nonceStore: Map<string, CSPNonce> = new Map();
  private helmetOptions: HelmetOptions;

  constructor(config: Partial<SecurityHeadersConfig> = {}) {
    this.config = {
      enableCSP: true,
      enableHSTS: true,
      enableFrameOptions: true,
      enableContentTypeOptions: true,
      enableReferrerPolicy: true,
      enablePermissionsPolicy: true,
      hstsMaxAge: 31536000, // 1 year
      isDevelopment: process.env.NODE_ENV === 'development',
      allowUnsafeInlineDev: false,
      ...config
    };

    this.helmetOptions = this.buildHelmetOptions();

    secureLog('info', 'Security headers manager initialized', {
      csp_enabled: this.config.enableCSP,
      hsts_enabled: this.config.enableHSTS,
      frame_options_enabled: this.config.enableFrameOptions,
      content_type_options_enabled: this.config.enableContentTypeOptions,
      referrer_policy_enabled: this.config.enableReferrerPolicy,
      permissions_policy_enabled: this.config.enablePermissionsPolicy,
      development_mode: this.config.isDevelopment
    });
  }

  /**
   * Build Helmet.js configuration options
   */
  private buildHelmetOptions(): HelmetOptions {
    const options: HelmetOptions = {
      // Content Security Policy with strict-dynamic and nonce-based CSP
      contentSecurityPolicy: this.config.enableCSP ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: this.buildScriptSrcDirectives(),
          styleSrc: this.buildStyleSrcDirectives(),
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "https:", "data:"],
          connectSrc: ["'self'", "wss:", "ws:"],
          mediaSrc: ["'self'"],
          objectSrc: ["'none'"],
          childSrc: ["'self'"],
          frameSrc: ["'none'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: !this.config.isDevelopment ? [] : undefined
        },
        reportOnly: this.config.isDevelopment
      } : false,

      // Strict Transport Security (HSTS)
      hsts: this.config.enableHSTS ? {
        maxAge: this.config.hstsMaxAge,
        includeSubDomains: true,
        preload: true
      } : false,

      // X-Frame-Options: DENY (prevent clickjacking)
      frameguard: this.config.enableFrameOptions ? {
        action: 'deny'
      } : false,

      // X-Content-Type-Options: nosniff (prevent MIME sniffing)
      noSniff: this.config.enableContentTypeOptions,

      // Referrer-Policy: strict-origin-when-cross-origin
      referrerPolicy: this.config.enableReferrerPolicy ? {
        policy: "strict-origin-when-cross-origin"
      } : false,

      // X-DNS-Prefetch-Control: off
      dnsPrefetchControl: { allow: false },

      // X-Download-Options: noopen
      ieNoOpen: true,

      // X-Permitted-Cross-Domain-Policies: none
      permittedCrossDomainPolicies: false,

      // Hide X-Powered-By header
      hidePoweredBy: true,

      // X-XSS-Protection: 0 (disabled as CSP is more effective)
      xssFilter: false,

      // Cross-Origin-Embedder-Policy and Cross-Origin-Opener-Policy
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },

      // Origin-Agent-Cluster
      originAgentCluster: true
    };

    return options;
  }

  /**
   * Build script-src directives for CSP
   */
  private buildScriptSrcDirectives(): string[] {
    const directives = ["'self'"];

    if (this.config.isDevelopment && this.config.allowUnsafeInlineDev) {
      directives.push("'unsafe-inline'");
    }

    // Add strict-dynamic for nonce-based CSP
    directives.push("'strict-dynamic'");

    return directives;
  }

  /**
   * Build style-src directives for CSP
   */
  private buildStyleSrcDirectives(): string[] {
    const directives = ["'self'"];

    if (this.config.isDevelopment && this.config.allowUnsafeInlineDev) {
      directives.push("'unsafe-inline'");
    }

    return directives;
  }

  /**
   * Generate CSP nonce for script/style execution
   */
  public generateNonce(requestId?: string): CSPNonce {
    const scriptNonce = crypto.randomBytes(16).toString('base64');
    const styleNonce = crypto.randomBytes(16).toString('base64');
    
    const nonce: CSPNonce = {
      script: scriptNonce,
      style: styleNonce
    };

    // Store nonce for the request (with TTL cleanup)
    if (requestId) {
      this.nonceStore.set(requestId, nonce);
      
      // Cleanup after 5 minutes
      setTimeout(() => {
        this.nonceStore.delete(requestId);
      }, 300000);
    }

    secureLog('debug', 'CSP nonce generated', {
      request_id: requestId,
      script_nonce_length: scriptNonce.length,
      style_nonce_length: styleNonce.length
    });

    return nonce;
  }

  /**
   * Get stored nonce for a request
   */
  public getNonce(requestId: string): CSPNonce | undefined {
    return this.nonceStore.get(requestId);
  }

  /**
   * Middleware to add CSP nonces to requests
   */
  public nonceMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const requestId = req.headers['x-request-id'] as string || 
                       req.headers['x-correlation-id'] as string ||
                       crypto.randomUUID();

      const nonce = this.generateNonce(requestId);
      
      // Add nonce to request object
      (req as any).nonce = nonce;
      (req as any).requestId = requestId;

      // Set CSP header with nonces
      if (this.config.enableCSP) {
        res.setHeader('Content-Security-Policy', this.buildCSPHeaderWithNonce(nonce));
      }

      next();
    };
  }

  /**
   * Build CSP header string with nonces
   */
  private buildCSPHeaderWithNonce(nonce: CSPNonce): string {
    const directives = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce.script}' 'strict-dynamic'`,
      `style-src 'self' 'nonce-${nonce.style}'`,
      "img-src 'self' data: https:",
      "font-src 'self' https: data:",
      "connect-src 'self' wss: ws:",
      "media-src 'self'",
      "object-src 'none'",
      "child-src 'self'",
      "frame-src 'none'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'"
    ];

    if (!this.config.isDevelopment) {
      directives.push("upgrade-insecure-requests");
    }

    return directives.join('; ');
  }

  /**
   * Get Helmet middleware with current configuration
   */
  public getHelmetMiddleware(): ReturnType<typeof helmet> {
    return helmet(this.helmetOptions);
  }

  /**
   * Security headers audit middleware
   */
  public auditMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Log security headers for audit
      const originalSend = res.send;
      res.send = function(data) {
        secureLog('info', 'Security headers audit', {
          url: req.url,
          method: req.method,
          headers: {
            'content-security-policy': res.getHeader('content-security-policy'),
            'strict-transport-security': res.getHeader('strict-transport-security'),
            'x-frame-options': res.getHeader('x-frame-options'),
            'x-content-type-options': res.getHeader('x-content-type-options'),
            'referrer-policy': res.getHeader('referrer-policy'),
            'permissions-policy': res.getHeader('permissions-policy')
          },
          request_id: (req as any).requestId
        });
        
        return originalSend.call(this, data);
      };

      next();
    };
  }

  /**
   * Validate security headers configuration
   */
  public validateConfiguration(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.config.hstsMaxAge < 86400) {
      errors.push('HSTS max-age should be at least 86400 seconds (24 hours)');
    }

    if (this.config.isDevelopment && !this.config.allowUnsafeInlineDev) {
      // This is fine, just noting for development
    }

    if (!this.config.enableCSP && !this.config.isDevelopment) {
      errors.push('CSP should be enabled in production');
    }

    if (!this.config.enableHSTS && !this.config.isDevelopment) {
      errors.push('HSTS should be enabled in production');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get current configuration
   */
  public getConfiguration(): SecurityHeadersConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfiguration(newConfig: Partial<SecurityHeadersConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.helmetOptions = this.buildHelmetOptions();

    secureLog('info', 'Security headers configuration updated', {
      new_config: newConfig
    });
  }

  /**
   * Get security headers status report
   */
  public getStatusReport(): {
    enabled_headers: string[];
    disabled_headers: string[];
    nonce_store_size: number;
    configuration: SecurityHeadersConfig;
  } {
    const enabledHeaders: string[] = [];
    const disabledHeaders: string[] = [];

    if (this.config.enableCSP) {
      enabledHeaders.push('Content-Security-Policy');
    } else {
      disabledHeaders.push('Content-Security-Policy');
    }

    if (this.config.enableHSTS) {
      enabledHeaders.push('Strict-Transport-Security');
    } else {
      disabledHeaders.push('Strict-Transport-Security');
    }

    if (this.config.enableFrameOptions) {
      enabledHeaders.push('X-Frame-Options');
    } else {
      disabledHeaders.push('X-Frame-Options');
    }

    if (this.config.enableContentTypeOptions) {
      enabledHeaders.push('X-Content-Type-Options');
    } else {
      disabledHeaders.push('X-Content-Type-Options');
    }

    if (this.config.enableReferrerPolicy) {
      enabledHeaders.push('Referrer-Policy');
    } else {
      disabledHeaders.push('Referrer-Policy');
    }

    if (this.config.enablePermissionsPolicy) {
      enabledHeaders.push('Permissions-Policy');
    } else {
      disabledHeaders.push('Permissions-Policy');
    }

    return {
      enabled_headers: enabledHeaders,
      disabled_headers: disabledHeaders,
      nonce_store_size: this.nonceStore.size,
      configuration: this.config
    };
  }

  /**
   * Clean up expired nonces
   */
  public cleanupExpiredNonces(): number {
    const initialSize = this.nonceStore.size;
    
    // In a real implementation, we'd track expiration times
    // For now, we'll implement a simple LRU-style cleanup
    if (this.nonceStore.size > 1000) {
      const entries = Array.from(this.nonceStore.entries());
      const toDelete = entries.slice(0, entries.length - 500);
      
      toDelete.forEach(([key]) => {
        this.nonceStore.delete(key);
      });
    }

    const cleanedCount = initialSize - this.nonceStore.size;
    
    if (cleanedCount > 0) {
      secureLog('info', 'Cleaned up expired CSP nonces', {
        cleaned_count: cleanedCount,
        remaining_count: this.nonceStore.size
      });
    }

    return cleanedCount;
  }
}

// Default security headers configuration for production
export const DEFAULT_PRODUCTION_CONFIG: SecurityHeadersConfig = {
  enableCSP: true,
  enableHSTS: true,
  enableFrameOptions: true,
  enableContentTypeOptions: true,
  enableReferrerPolicy: true,
  enablePermissionsPolicy: true,
  hstsMaxAge: 31536000, // 1 year
  isDevelopment: false,
  allowUnsafeInlineDev: false
};

// Development-friendly configuration
export const DEFAULT_DEVELOPMENT_CONFIG: SecurityHeadersConfig = {
  enableCSP: true,
  enableHSTS: false, // Don't enforce HSTS in development
  enableFrameOptions: true,
  enableContentTypeOptions: true,
  enableReferrerPolicy: true,
  enablePermissionsPolicy: false, // More permissive in development
  hstsMaxAge: 86400, // 1 day
  isDevelopment: true,
  allowUnsafeInlineDev: true // Allow inline scripts/styles in development
};

// Helper function to get appropriate config for environment
export function getDefaultConfig(): SecurityHeadersConfig {
  return process.env.NODE_ENV === 'production' 
    ? DEFAULT_PRODUCTION_CONFIG 
    : DEFAULT_DEVELOPMENT_CONFIG;
}

// Express middleware helper
export function createSecurityHeadersMiddleware(config?: Partial<SecurityHeadersConfig>) {
  const manager = new SecurityHeadersManager(config);
  return {
    helmet: manager.getHelmetMiddleware(),
    nonce: manager.nonceMiddleware(),
    audit: manager.auditMiddleware(),
    manager
  };
}
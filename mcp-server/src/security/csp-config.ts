/**
 * Content Security Policy (CSP) Configuration Module
 * 
 * Provides strongly-typed CSP directive configuration with validation
 * and helper utilities for secure CSP policy generation.
 */

import { z } from 'zod';

/**
 * CSP Source values that can be used in directives
 */
export const CSPSourceSchema = z.union([
  z.literal("'self'"),
  z.literal("'unsafe-inline'"),
  z.literal("'unsafe-eval'"),
  z.literal("'strict-dynamic'"),
  z.literal("'none'"),
  z.string().regex(/^'nonce-[A-Za-z0-9+/]+=*'$/, 'Invalid nonce format'),
  z.string().regex(/^'sha256-[A-Za-z0-9+/]+=*'$/, 'Invalid SHA256 hash format'),
  z.string().regex(/^'sha384-[A-Za-z0-9+/]+=*'$/, 'Invalid SHA384 hash format'),
  z.string().regex(/^'sha512-[A-Za-z0-9+/]+=*'$/, 'Invalid SHA512 hash format'),
  z.string().url(),
  z.string().regex(/^https?:\/\//, 'Must be a valid scheme'),
  z.string().regex(/^\*\./, 'Wildcard subdomain must start with *.'),
  z.literal('data:'),
  z.literal('blob:'),
  z.literal('filesystem:'),
  z.literal('mediastream:'),
  z.literal('about:'),
  z.literal('ws:'),
  z.literal('wss:')
]);

export type CSPSource = z.infer<typeof CSPSourceSchema>;

/**
 * CSP Directive configuration schema
 */
export const CSPDirectivesSchema = z.object({
  'default-src': z.array(CSPSourceSchema).optional(),
  'script-src': z.array(CSPSourceSchema).optional(),
  'script-src-elem': z.array(CSPSourceSchema).optional(),
  'script-src-attr': z.array(CSPSourceSchema).optional(),
  'style-src': z.array(CSPSourceSchema).optional(),
  'style-src-elem': z.array(CSPSourceSchema).optional(),
  'style-src-attr': z.array(CSPSourceSchema).optional(),
  'img-src': z.array(CSPSourceSchema).optional(),
  'font-src': z.array(CSPSourceSchema).optional(),
  'connect-src': z.array(CSPSourceSchema).optional(),
  'media-src': z.array(CSPSourceSchema).optional(),
  'object-src': z.array(CSPSourceSchema).optional(),
  'child-src': z.array(CSPSourceSchema).optional(),
  'frame-src': z.array(CSPSourceSchema).optional(),
  'worker-src': z.array(CSPSourceSchema).optional(),
  'manifest-src': z.array(CSPSourceSchema).optional(),
  'prefetch-src': z.array(CSPSourceSchema).optional(),
  'form-action': z.array(CSPSourceSchema).optional(),
  'frame-ancestors': z.array(CSPSourceSchema).optional(),
  'base-uri': z.array(CSPSourceSchema).optional(),
  'plugin-types': z.array(z.string()).optional(),
  'sandbox': z.array(z.enum([
    'allow-downloads',
    'allow-forms',
    'allow-modals',
    'allow-orientation-lock',
    'allow-pointer-lock',
    'allow-popups',
    'allow-popups-to-escape-sandbox',
    'allow-presentation',
    'allow-same-origin',
    'allow-scripts',
    'allow-storage-access-by-user-activation',
    'allow-top-navigation',
    'allow-top-navigation-by-user-activation',
    'allow-top-navigation-to-custom-protocols'
  ])).optional(),
  'navigate-to': z.array(CSPSourceSchema).optional(),
  'trusted-types': z.array(z.string()).optional(),
  'require-trusted-types-for': z.array(z.literal("'script'")).optional(),
  'upgrade-insecure-requests': z.array(z.never()).optional(),
  'block-all-mixed-content': z.array(z.never()).optional(),
  'require-sri-for': z.array(z.enum(['script', 'style', 'script style'])).optional(),
  'referrer': z.array(z.enum([
    'no-referrer',
    'no-referrer-when-downgrade',
    'origin',
    'origin-when-cross-origin',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url'
  ])).optional()
});

export type CSPDirectives = z.infer<typeof CSPDirectivesSchema>;

/**
 * Complete CSP Policy configuration
 */
export const CSPPolicySchema = z.object({
  directives: CSPDirectivesSchema,
  reportOnly: z.boolean().default(false),
  reportUri: z.string().url().optional(),
  reportTo: z.string().optional(),
  disableAndroid: z.boolean().default(false),
  browserSniff: z.boolean().default(true),
  setAllHeaders: z.boolean().default(false)
});

export type CSPPolicy = z.infer<typeof CSPPolicySchema>;

/**
 * Environment-specific CSP configurations
 */
export const CSPEnvironmentConfigSchema = z.object({
  development: CSPPolicySchema,
  staging: CSPPolicySchema,
  production: CSPPolicySchema
});

export type CSPEnvironmentConfig = z.infer<typeof CSPEnvironmentConfigSchema>;

/**
 * CSP Configuration Manager
 */
export class CSPConfigManager {
  private config: CSPEnvironmentConfig;
  private currentEnvironment: 'development' | 'staging' | 'production';

  constructor(config: CSPEnvironmentConfig, environment: 'development' | 'staging' | 'production' = 'development') {
    this.config = CSPEnvironmentConfigSchema.parse(config);
    this.currentEnvironment = environment;
  }

  /**
   * Get CSP policy for current environment
   */
  getCurrentPolicy(): CSPPolicy {
    return this.config[this.currentEnvironment];
  }

  /**
   * Get CSP policy for specific environment
   */
  getPolicyForEnvironment(environment: 'development' | 'staging' | 'production'): CSPPolicy {
    return this.config[environment];
  }

  /**
   * Convert CSP directives to header string
   */
  buildCSPHeader(policy?: CSPPolicy): string {
    const currentPolicy = policy || this.getCurrentPolicy();
    const directives: string[] = [];

    Object.entries(currentPolicy.directives).forEach(([directive, sources]) => {
      if (sources && sources.length > 0) {
        // Handle directives with no sources (like upgrade-insecure-requests)
        if (sources.length === 0 || (sources.length === 1 && sources[0] === undefined)) {
          directives.push(directive);
        } else {
          directives.push(`${directive} ${sources.join(' ')}`);
        }
      }
    });

    return directives.join('; ');
  }

  /**
   * Add nonce to script-src directive
   */
  addScriptNonce(nonce: string, policy?: CSPPolicy): CSPPolicy {
    const currentPolicy = policy || this.getCurrentPolicy();
    const nonceSource = `'nonce-${nonce}'`;
    
    return {
      ...currentPolicy,
      directives: {
        ...currentPolicy.directives,
        'script-src': [
          ...(currentPolicy.directives['script-src'] || []),
          nonceSource
        ]
      }
    };
  }

  /**
   * Add nonce to style-src directive
   */
  addStyleNonce(nonce: string, policy?: CSPPolicy): CSPPolicy {
    const currentPolicy = policy || this.getCurrentPolicy();
    const nonceSource = `'nonce-${nonce}'`;
    
    return {
      ...currentPolicy,
      directives: {
        ...currentPolicy.directives,
        'style-src': [
          ...(currentPolicy.directives['style-src'] || []),
          nonceSource
        ]
      }
    };
  }

  /**
   * Add hash to script-src directive
   */
  addScriptHash(hash: string, algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha384', policy?: CSPPolicy): CSPPolicy {
    const currentPolicy = policy || this.getCurrentPolicy();
    const hashSource = `'${algorithm}-${hash}'`;
    
    return {
      ...currentPolicy,
      directives: {
        ...currentPolicy.directives,
        'script-src': [
          ...(currentPolicy.directives['script-src'] || []),
          hashSource
        ]
      }
    };
  }

  /**
   * Add hash to style-src directive
   */
  addStyleHash(hash: string, algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha384', policy?: CSPPolicy): CSPPolicy {
    const currentPolicy = policy || this.getCurrentPolicy();
    const hashSource = `'${algorithm}-${hash}'`;
    
    return {
      ...currentPolicy,
      directives: {
        ...currentPolicy.directives,
        'style-src': [
          ...(currentPolicy.directives['style-src'] || []),
          hashSource
        ]
      }
    };
  }

  /**
   * Validate CSP configuration
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      CSPEnvironmentConfigSchema.parse(this.config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        errors.push(...error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
      } else {
        errors.push(error instanceof Error ? error.message : 'Unknown validation error');
      }
    }

    // Additional logical validation
    Object.entries(this.config).forEach(([env, policy]) => {
      // Check for conflicting directives
      if (policy.directives['script-src']?.includes("'unsafe-inline'") && 
          policy.directives['script-src']?.includes("'strict-dynamic'")) {
        errors.push(`${env}: 'unsafe-inline' and 'strict-dynamic' should not be used together`);
      }

      // Check for missing default-src when other directives are present
      if (!policy.directives['default-src'] && 
          Object.keys(policy.directives).length > 0) {
        errors.push(`${env}: Consider setting 'default-src' as a fallback`);
      }

      // Check for overly permissive policies in production
      if (env === 'production') {
        if (policy.directives['script-src']?.includes("'unsafe-inline'")) {
          errors.push(`${env}: 'unsafe-inline' should be avoided in production`);
        }
        if (policy.directives['script-src']?.includes("'unsafe-eval'")) {
          errors.push(`${env}: 'unsafe-eval' should be avoided in production`);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Update environment configuration
   */
  updateEnvironment(environment: 'development' | 'staging' | 'production'): void {
    this.currentEnvironment = environment;
  }

  /**
   * Get configuration summary
   */
  getConfigSummary(): {
    environment: string;
    directiveCount: number;
    reportOnly: boolean;
    hasReporting: boolean;
  } {
    const policy = this.getCurrentPolicy();
    return {
      environment: this.currentEnvironment,
      directiveCount: Object.keys(policy.directives).length,
      reportOnly: policy.reportOnly,
      hasReporting: !!(policy.reportUri || policy.reportTo)
    };
  }
}

/**
 * Default CSP configurations for different environments
 */
export const DEFAULT_CSP_CONFIG: CSPEnvironmentConfig = {
  development: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", "data:", "https:"],
      'font-src': ["'self'", "data:", "https:"],
      'connect-src': ["'self'", "ws:", "wss:"],
      'media-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"]
    },
    reportOnly: true,
    browserSniff: true,
    setAllHeaders: false,
    disableAndroid: false
  },
  staging: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'strict-dynamic'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", "data:", "https:"],
      'font-src': ["'self'", "data:", "https:"],
      'connect-src': ["'self'", "wss:", "ws:"],
      'media-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': []
    },
    reportOnly: false,
    browserSniff: true,
    setAllHeaders: false,
    disableAndroid: false
  },
  production: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'strict-dynamic'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", "data:", "https:"],
      'font-src': ["'self'", "data:", "https:"],
      'connect-src': ["'self'", "wss:", "ws:"],
      'media-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': [],
      'block-all-mixed-content': []
    },
    reportOnly: false,
    browserSniff: true,
    setAllHeaders: true,
    disableAndroid: false
  }
};

/**
 * Create CSP manager with default configuration
 */
export function createDefaultCSPManager(environment: 'development' | 'staging' | 'production' = 'development'): CSPConfigManager {
  return new CSPConfigManager(DEFAULT_CSP_CONFIG, environment);
}

/**
 * Helmet.js compatible CSP options type
 */
export interface HelmetCSPOptions {
  directives?: Record<string, string[]>;
  reportOnly?: boolean;
  reportUri?: string;
  setAllHeaders?: boolean;
  disableAndroid?: boolean;
  browserSniff?: boolean;
}

/**
 * Convert CSP policy to Helmet.js format
 */
export function convertToHelmetCSP(policy: CSPPolicy): HelmetCSPOptions {
  const helmetDirectives: Record<string, string[]> = {};
  
  Object.entries(policy.directives).forEach(([key, value]) => {
    if (value && value.length > 0) {
      // Convert kebab-case to camelCase for Helmet.js
      const helmetKey = key.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
      helmetDirectives[helmetKey] = value as string[];
    }
  });

  return {
    directives: helmetDirectives,
    reportOnly: policy.reportOnly,
    reportUri: policy.reportUri,
    setAllHeaders: policy.setAllHeaders,
    disableAndroid: policy.disableAndroid,
    browserSniff: policy.browserSniff
  };
}
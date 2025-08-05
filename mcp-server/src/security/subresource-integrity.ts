/**
 * Subresource Integrity (SRI) Validation Module
 * Provides utilities for validating and generating SRI hashes for CDN resources
 */

import crypto from 'crypto';
import axios from 'axios';
import { logger } from '../utils/logger';

export interface SRIValidationResult {
  url: string;
  algorithm: string;
  expectedHash: string;
  actualHash: string;
  isValid: boolean;
  error?: string;
}

export interface CDNResource {
  url: string;
  integrity?: string;
  crossorigin?: string;
  type: 'script' | 'stylesheet' | 'font' | 'image';
}

/**
 * Common CDN resources with their SRI hashes
 * These should be updated regularly as CDN resources change
 */
export const KNOWN_CDN_RESOURCES: Record<string, CDNResource> = {
  'bootstrap-5.3.0-css': {
    url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    integrity: 'sha384-9ndCyUa1mlDOz8LwqBnEgkO9jZmzwTEZGnP3tI3nHT7zUoQh0YqY0f5qMgKrPkK4',
    crossorigin: 'anonymous',
    type: 'stylesheet'
  },
  'bootstrap-5.3.0-js': {
    url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
    integrity: 'sha384-C6RzsynM9kWDrMNeT87bh95OGNyZPhcTNXj1NW7RuBCsyN/o0jlpcV8Qyq46cDfL',
    crossorigin: 'anonymous',
    type: 'script'
  },
  'jquery-3.6.0': {
    url: 'https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js',
    integrity: 'sha384-vtXRMe3mGCbOeY7l30aIg8H9p3GdeSe4IFlP6G8JMa7o7lXvnz3GFKzPxzJdPfGK',
    crossorigin: 'anonymous',
    type: 'script'
  },
  'fontawesome-6.0.0': {
    url: 'https://use.fontawesome.com/releases/v6.0.0/css/all.css',
    integrity: 'sha384-3B6NwesSXE7YJlcLI9RpRqGf2p/EgVH8BgoKTaUrmKNDkHPStTQ3EyoYjCGXaOTS',
    crossorigin: 'anonymous',
    type: 'stylesheet'
  }
};

/**
 * Supported SRI algorithms
 */
export const SRI_ALGORITHMS = ['sha256', 'sha384', 'sha512'] as const;
export type SRIAlgorithm = typeof SRI_ALGORITHMS[number];

/**
 * Generate SRI hash for a given content
 */
export function generateSRIHash(content: string | Buffer, algorithm: SRIAlgorithm = 'sha384'): string {
  if (!SRI_ALGORITHMS.includes(algorithm)) {
    throw new Error(`Unsupported SRI algorithm: ${algorithm}`);
  }

  const hash = crypto
    .createHash(algorithm)
    .update(content, typeof content === 'string' ? 'utf8' : undefined)
    .digest('base64');

  return `${algorithm}-${hash}`;
}

/**
 * Fetch content from URL and generate SRI hash
 */
export async function generateSRIHashFromURL(
  url: string, 
  algorithm: SRIAlgorithm = 'sha384',
  timeout: number = 10000
): Promise<string> {
  try {
    logger.info(`Generating SRI hash for: ${url}`);
    
    const response = await axios.get(url, {
      timeout,
      responseType: 'text',
      headers: {
        'User-Agent': 'CCTelegram-SRI-Generator/1.0'
      }
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const hash = generateSRIHash(response.data, algorithm);
    logger.info(`Generated SRI hash for ${url}: ${hash}`);
    
    return hash;
  } catch (error) {
    logger.error(`Failed to generate SRI hash for ${url}:`, error);
    throw error;
  }
}

/**
 * Validate SRI hash against actual content
 */
export async function validateSRIHash(
  url: string,
  expectedIntegrity: string,
  timeout: number = 10000
): Promise<SRIValidationResult> {
  try {
    logger.info(`Validating SRI for: ${url}`);
    
    // Parse expected integrity
    const integrityMatch = expectedIntegrity.match(/^(sha256|sha384|sha512)-(.+)$/);
    if (!integrityMatch) {
      return {
        url,
        algorithm: 'unknown',
        expectedHash: expectedIntegrity,
        actualHash: '',
        isValid: false,
        error: 'Invalid integrity format'
      };
    }

    const [, algorithm, expectedHash] = integrityMatch;
    
    // Fetch content and generate actual hash
    const actualIntegrity = await generateSRIHashFromURL(url, algorithm as SRIAlgorithm, timeout);
    const actualHash = actualIntegrity.split('-')[1];
    
    const isValid = actualIntegrity === expectedIntegrity;
    
    const result: SRIValidationResult = {
      url,
      algorithm,
      expectedHash,
      actualHash,
      isValid
    };

    if (isValid) {
      logger.info(`SRI validation passed for ${url}`);
    } else {
      logger.warn(`SRI validation failed for ${url}: expected ${expectedHash}, got ${actualHash}`);
    }

    return result;
  } catch (error) {
    logger.error(`SRI validation error for ${url}:`, error);
    
    return {
      url,
      algorithm: 'unknown',
      expectedHash: expectedIntegrity,
      actualHash: '',
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Validate multiple CDN resources
 */
export async function validateMultipleSRIHashes(
  resources: CDNResource[],
  timeout: number = 10000
): Promise<SRIValidationResult[]> {
  logger.info(`Validating SRI for ${resources.length} resources`);
  
  const promises = resources
    .filter(resource => resource.integrity)
    .map(resource => validateSRIHash(resource.url, resource.integrity!, timeout));
  
  const results = await Promise.allSettled(promises);
  
  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      const resource = resources.filter(r => r.integrity)[index];
      return {
        url: resource.url,
        algorithm: 'unknown',
        expectedHash: resource.integrity || '',
        actualHash: '',
        isValid: false,
        error: result.reason instanceof Error ? result.reason.message : 'Promise rejected'
      };
    }
  });
}

/**
 * Generate SRI configuration for known CDN resources
 */
export async function generateSRIConfiguration(
  customResources: string[] = [],
  algorithm: SRIAlgorithm = 'sha384'
): Promise<Record<string, CDNResource>> {
  logger.info('Generating SRI configuration for CDN resources');
  
  const config: Record<string, CDNResource> = { ...KNOWN_CDN_RESOURCES };
  
  // Generate SRI for custom resources
  for (const url of customResources) {
    try {
      const integrity = await generateSRIHashFromURL(url, algorithm);
      const key = url.replace(/[^a-zA-Z0-9]/g, '_');
      
      config[key] = {
        url,
        integrity,
        crossorigin: 'anonymous',
        type: url.includes('.css') ? 'stylesheet' : 'script'
      };
      
      logger.info(`Added SRI configuration for ${url}`);
    } catch (error) {
      logger.error(`Failed to generate SRI for ${url}:`, error);
    }
  }
  
  return config;
}

/**
 * Generate HTML attributes for SRI-enabled resource
 */
export function generateSRIAttributes(resource: CDNResource): string {
  const attributes: string[] = [];
  
  if (resource.integrity) {
    attributes.push(`integrity="${resource.integrity}"`);
  }
  
  if (resource.crossorigin) {
    attributes.push(`crossorigin="${resource.crossorigin}"`);
  }
  
  return attributes.join(' ');
}

/**
 * Scan HTML content for CDN resources and validate SRI
 */
export async function scanHTMLForCDNResources(htmlContent: string): Promise<{
  resources: CDNResource[];
  missingIntegrity: string[];
  validationResults: SRIValidationResult[];
}> {
  logger.info('Scanning HTML content for CDN resources');
  
  const resources: CDNResource[] = [];
  const missingIntegrity: string[] = [];
  
  // Common CDN patterns
  const cdnPatterns = [
    /cdn\.jsdelivr\.net/,
    /unpkg\.com/,
    /cdnjs\.cloudflare\.com/,
    /ajax\.googleapis\.com/,
    /maxcdn\.bootstrapcdn\.com/,
    /stackpath\.bootstrapcdn\.com/,
    /use\.fontawesome\.com/
  ];
  
  // Extract script tags
  const scriptRegex = /<script[^>]*src=["']([^"']*cdn[^"']*)["'][^>]*>/gi;
  let match;
  
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const url = match[1];
    const fullTag = match[0];
    
    if (cdnPatterns.some(pattern => pattern.test(url))) {
      const integrityMatch = fullTag.match(/integrity=["']([^"']*)["']/);
      const crossoriginMatch = fullTag.match(/crossorigin=["']([^"']*)["']/);
      
      const resource: CDNResource = {
        url,
        type: 'script',
        integrity: integrityMatch ? integrityMatch[1] : undefined,
        crossorigin: crossoriginMatch ? crossoriginMatch[1] : undefined
      };
      
      resources.push(resource);
      
      if (!resource.integrity) {
        missingIntegrity.push(url);
      }
    }
  }
  
  // Extract link tags (stylesheets)
  const linkRegex = /<link[^>]*href=["']([^"']*cdn[^"']*)["'][^>]*>/gi;
  
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const url = match[1];
    const fullTag = match[0];
    
    if (cdnPatterns.some(pattern => pattern.test(url))) {
      const integrityMatch = fullTag.match(/integrity=["']([^"']*)["']/);
      const crossoriginMatch = fullTag.match(/crossorigin=["']([^"']*)["']/);
      
      const resource: CDNResource = {
        url,
        type: 'stylesheet',
        integrity: integrityMatch ? integrityMatch[1] : undefined,
        crossorigin: crossoriginMatch ? crossoriginMatch[1] : undefined
      };
      
      resources.push(resource);
      
      if (!resource.integrity) {
        missingIntegrity.push(url);
      }
    }
  }
  
  // Validate existing SRI hashes
  const validationResults = await validateMultipleSRIHashes(
    resources.filter(r => r.integrity)
  );
  
  logger.info(`Found ${resources.length} CDN resources, ${missingIntegrity.length} missing SRI`);
  
  return {
    resources,
    missingIntegrity,
    validationResults
  };
}

/**
 * Security recommendations for SRI implementation
 */
export const SRI_SECURITY_RECOMMENDATIONS = {
  algorithm: 'Use SHA-384 or SHA-512 for better security',
  crossorigin: 'Always use crossorigin="anonymous" for CDN resources',
  fallback: 'Implement fallback mechanisms for CDN failures',
  monitoring: 'Monitor SRI validation failures in production',
  updates: 'Regularly update SRI hashes when CDN resources change',
  automation: 'Automate SRI hash generation in CI/CD pipeline'
};

export default {
  generateSRIHash,
  generateSRIHashFromURL,
  validateSRIHash,
  validateMultipleSRIHashes,
  generateSRIConfiguration,
  generateSRIAttributes,
  scanHTMLForCDNResources,
  KNOWN_CDN_RESOURCES,
  SRI_ALGORITHMS,
  SRI_SECURITY_RECOMMENDATIONS
};
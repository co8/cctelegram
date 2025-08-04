/**
 * Enhanced Error Handling System
 * 
 * Comprehensive error taxonomy, classification, and handling patterns
 * for the CCTelegram MCP Server with resilience engineering focus.
 */

export * from './base-error.js';
export * from './resilience-errors.js';
export * from './error-classifier.js';
export * from './error-handler.js';
export * from './error-recovery.js';

// Re-export SecurityError for compatibility
export { SecurityError } from '../../security.js';
/**
 * Enhanced Webhook Server with Integrity Validation
 * Task 39.5: End-to-End Integrity Validation Implementation
 * 
 * Extends the base webhook server with SHA-256 integrity validation
 * at ingress and egress points for complete message integrity assurance.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { Server } from 'http';
import { SecurityHeadersManager, getDefaultConfig } from './security-headers.js';
import { 
  integrityValidationMiddleware,
  responseIntegrityValidationMiddleware,
  ValidationCheckpoint,
  getGlobalIntegrityValidator,
  type ValidationMetadata,
  type IntegrityMetrics 
} from './utils/integrity-validator.js';
import { secureLog } from './security.js';

export interface WebhookPayloadWithIntegrity {
  type: 'telegram_response';
  callback_data: string;
  user_id: number;
  username?: string;
  first_name?: string;
  timestamp: string;
  correlation_id?: string;
  // Enhanced with integrity validation
  content_hash?: string;
  content_size?: number;
  validation_checkpoint?: string;
}

export interface WebhookResponseWithIntegrity {
  success: boolean;
  correlation_id: string;
  processed_by: 'mcp_webhook_integrity';
  processing_time_ms: number;
  message?: string;
  error?: string;
  // Enhanced with integrity metadata
  response_hash?: string;
  response_size?: number;
  validation_status?: 'validated' | 'failed' | 'skipped';
}

// Enhanced Joi schema with integrity validation
const webhookPayloadSchema = Joi.object({
  type: Joi.string().valid('telegram_response').required(),
  callback_data: Joi.string().required(),
  user_id: Joi.number().integer().positive().required(),
  username: Joi.string().optional(),
  first_name: Joi.string().optional(),
  timestamp: Joi.string().isoDate().required(),
  correlation_id: Joi.string().uuid().optional(),
  // Optional integrity fields
  content_hash: Joi.string().hex().length(64).optional(),
  content_size: Joi.number().integer().positive().optional(),
  validation_checkpoint: Joi.string().optional()
});

/**
 * Enhanced webhook server with comprehensive integrity validation
 */
export class IntegrityAwareWebhookServer {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;
  private isRunning = false;
  private securityHeaders: SecurityHeadersManager;
  private integrityMetricsInterval: NodeJS.Timeout | null = null;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.securityHeaders = new SecurityHeadersManager(getDefaultConfig());
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security headers middleware (must be first)
    this.app.use(this.securityHeaders.getHelmetMiddleware());
    this.app.use(this.securityHeaders.nonceMiddleware());
    this.app.use(this.securityHeaders.auditMiddleware());

    // JSON parsing middleware with size limits
    this.app.use(express.json({ 
      limit: '10mb',
      verify: (req, res, buf) => {
        // Store raw body for integrity validation
        (req as any).rawBody = buf;
      }
    }));
    
    // CORS middleware (updated to work with security headers)
    this.app.use((req, res, next) => {
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.header('Access-Control-Allow-Origin', '*');
      }
      if (!res.getHeader('Access-Control-Allow-Methods')) {
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      }
      if (!res.getHeader('Access-Control-Allow-Headers')) {
        res.header('Access-Control-Allow-Headers', 
          'Content-Type, Authorization, X-Correlation-ID, X-Request-ID, X-Content-Hash, X-Content-Size');
      }
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // Request correlation ID middleware
    this.app.use((req, res, next) => {
      const correlationId = req.headers['x-correlation-id'] || uuidv4();
      req.correlationId = correlationId as string;
      
      secureLog('debug', 'Request received', {
        method: req.method,
        path: req.path,
        correlationId,
        timestamp: new Date().toISOString()
      });
      
      next();
    });

    // Integrity validation middleware for POST requests
    this.app.use('/webhook', integrityValidationMiddleware(ValidationCheckpoint.Ingress));
    
    // Response integrity validation middleware
    this.app.use(responseIntegrityValidationMiddleware());
  }

  private setupRoutes(): void {
    // Health check endpoint with integrity metrics
    this.app.get('/health', (req, res) => {
      const validator = getGlobalIntegrityValidator();
      const integrityMetrics = validator.getMetrics();
      
      res.json({
        status: 'healthy',
        service: 'cctelegram-webhook-server-integrity',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.1.0-integrity',
        integrity_validation: {
          enabled: true,
          success_rate: validator.getSuccessRate(),
          total_validations: integrityMetrics.totalValidations,
          failed_validations: integrityMetrics.failedValidations
        }
      });
    });

    // Enhanced webhook endpoint with integrity validation
    this.app.post('/webhook/bridge-response', async (req, res) => {
      const startTime = Date.now();
      const correlationId = req.correlationId || uuidv4();

      try {
        // Validate payload schema
        const { error, value } = webhookPayloadSchema.validate(req.body);
        if (error) {
          return res.status(400).json({
            success: false,
            correlation_id: correlationId,
            processed_by: 'mcp_webhook_integrity',
            error: `Validation failed: ${error.details.map(d => d.message).join(', ')}`,
            processing_time_ms: Date.now() - startTime,
            validation_status: 'failed'
          } as WebhookResponseWithIntegrity);
        }

        const payload: WebhookPayloadWithIntegrity = {
          ...value,
          correlation_id: correlationId
        };

        // Additional integrity validation if client provided hash
        if (payload.content_hash && payload.content_size) {
          const validator = getGlobalIntegrityValidator();
          const content = Buffer.from(JSON.stringify(req.body));
          
          const clientMetadata = {
            correlationId,
            contentHash: payload.content_hash,
            contentSize: payload.content_size,
            checkpoint: ValidationCheckpoint.Ingress,
            validatedAt: Date.now(),
            chainDepth: 0
          };
          
          const verificationResult = await validator.verify(content, clientMetadata);
          
          if (!verificationResult.isValid) {
            secureLog('warn', 'Client-provided integrity validation failed', {
              correlationId,
              error: verificationResult.error,
              expected_hash: payload.content_hash,
              expected_size: payload.content_size
            });
            
            return res.status(400).json({
              success: false,
              correlation_id: correlationId,
              processed_by: 'mcp_webhook_integrity',
              error: 'Client integrity validation failed',
              processing_time_ms: Date.now() - startTime,
              validation_status: 'failed'
            } as WebhookResponseWithIntegrity);
          }
        }

        // Process the webhook payload
        secureLog('info', 'Webhook payload received and validated', {
          correlationId,
          payload_type: payload.type,
          user_id: payload.user_id,
          integrity_validated: req.integrityMetadata ? true : false
        });

        // TODO: Integrate with bridge processing (Task 21.3)
        // For now, simulate processing
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate processing

        const processingTime = Date.now() - startTime;
        
        // Prepare response with integrity metadata
        const response: WebhookResponseWithIntegrity = {
          success: true,
          correlation_id: correlationId,
          processed_by: 'mcp_webhook_integrity',
          processing_time_ms: processingTime,
          message: 'Webhook received, validated, and queued for processing',
          validation_status: req.integrityMetadata ? 'validated' : 'skipped'
        };

        res.json(response);

      } catch (error) {
        secureLog('error', 'Webhook processing error', {
          correlationId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        const response: WebhookResponseWithIntegrity = {
          success: false,
          correlation_id: correlationId,
          processed_by: 'mcp_webhook_integrity',
          processing_time_ms: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error',
          validation_status: 'failed'
        };

        res.status(500).json(response);
      }
    });

    // Integrity metrics endpoint
    this.app.get('/integrity/metrics', (req, res) => {
      const validator = getGlobalIntegrityValidator();
      const metrics = validator.getMetrics();
      
      res.json({
        integrity_validation: {
          total_validations: metrics.totalValidations,
          successful_validations: metrics.successfulValidations,
          failed_validations: metrics.failedValidations,
          success_rate: validator.getSuccessRate(),
          failure_rate: validator.getFailureRate(),
          average_latency_ms: metrics.averageLatencyMs,
          error_breakdown: {
            corruption_errors: metrics.corruptionErrors,
            truncation_errors: metrics.truncationErrors,
            chain_validation_errors: metrics.chainValidationErrors,
            processing_errors: metrics.processingErrors
          }
        },
        system_health: {
          is_healthy: validator.getSuccessRate() > 0.99,
          uptime_seconds: process.uptime(),
          memory_usage: process.memoryUsage()
        },
        timestamp: new Date().toISOString()
      });
    });

    // Reset integrity metrics endpoint (for testing/admin)
    this.app.post('/integrity/reset-metrics', (req, res) => {
      const validator = getGlobalIntegrityValidator();
      validator.resetMetrics();
      
      secureLog('info', 'Integrity metrics reset', {
        correlationId: req.correlationId,
        timestamp: new Date().toISOString()
      });
      
      res.json({
        success: true,
        message: 'Integrity metrics reset successfully',
        timestamp: new Date().toISOString()
      });
    });

    // Status endpoint with enhanced integrity information
    this.app.get('/status', (req, res) => {
      const validator = getGlobalIntegrityValidator();
      const integrityMetrics = validator.getMetrics();
      
      res.json({
        server: 'running',
        port: this.port,
        endpoints: [
          'GET /health',
          'GET /status',
          'GET /security-headers',
          'GET /integrity/metrics',
          'POST /integrity/reset-metrics',
          'POST /webhook/bridge-response'
        ],
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage(),
        security_headers: this.securityHeaders.getStatusReport(),
        integrity_validation: {
          enabled: true,
          total_validations: integrityMetrics.totalValidations,
          success_rate: validator.getSuccessRate(),
          is_healthy: validator.getSuccessRate() > 0.99
        },
        timestamp: new Date().toISOString()
      });
    });

    // Security headers status endpoint (unchanged)
    this.app.get('/security-headers', (req, res) => {
      const statusReport = this.securityHeaders.getStatusReport();
      const validationResult = this.securityHeaders.validateConfiguration();
      
      res.json({
        status: validationResult.valid ? 'compliant' : 'needs_attention',
        validation: validationResult,
        headers_status: statusReport,
        nonce_example: {
          script: `<script nonce="${(req as any).nonce?.script || 'GENERATED_NONCE'}">`,
          style: `<style nonce="${(req as any).nonce?.style || 'GENERATED_NONCE'}">`
        },
        timestamp: new Date().toISOString()
      });
    });
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Endpoint ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString(),
        correlation_id: req.correlationId
      });
    });

    // Global error handler with integrity context
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      secureLog('error', 'Webhook server error', {
        error: error.message,
        stack: error.stack,
        correlationId: req.correlationId,
        path: req.path,
        method: req.method
      });
      
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        correlation_id: req.correlationId,
        validation_status: 'error',
        timestamp: new Date().toISOString()
      });
    });
  }

  private startIntegrityMetricsLogging(): void {
    // Log integrity metrics every 60 seconds
    this.integrityMetricsInterval = setInterval(() => {
      const validator = getGlobalIntegrityValidator();
      const metrics = validator.getMetrics();
      
      if (metrics.totalValidations > 0) {
        secureLog('info', 'Integrity validation metrics', {
          total_validations: metrics.totalValidations,
          success_rate: validator.getSuccessRate(),
          average_latency_ms: Math.round(metrics.averageLatencyMs * 100) / 100,
          errors: {
            corruption: metrics.corruptionErrors,
            truncation: metrics.truncationErrors,
            chain_validation: metrics.chainValidationErrors,
            processing: metrics.processingErrors
          }
        });
      }
    }, 60000); // 60 seconds
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Integrity-aware webhook server is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        this.isRunning = true;
        this.startNonceCleanup();
        this.startIntegrityMetricsLogging();
        
        secureLog('info', 'Integrity-aware webhook server started', {
          port: this.port,
          integrity_validation: 'enabled',
          endpoints: {
            health: `http://localhost:${this.port}/health`,
            webhook: `http://localhost:${this.port}/webhook/bridge-response`,
            integrity_metrics: `http://localhost:${this.port}/integrity/metrics`,
            security_headers: `http://localhost:${this.port}/security-headers`
          }
        });
        
        resolve();
      });

      this.server.on('error', (error) => {
        secureLog('error', 'Webhook server startup failed', {
          error: error.message
        });
        reject(error);
      });

      // Graceful shutdown handling
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
    });
  }

  public async shutdown(): Promise<void> {
    if (!this.server || !this.isRunning) {
      return;
    }

    if (this.integrityMetricsInterval) {
      clearInterval(this.integrityMetricsInterval);
      this.integrityMetricsInterval = null;
    }

    return new Promise((resolve) => {
      secureLog('info', 'Integrity-aware webhook server shutting down gracefully...');
      
      this.server!.close(() => {
        this.isRunning = false;
        
        // Log final integrity metrics
        const validator = getGlobalIntegrityValidator();
        const finalMetrics = validator.getMetrics();
        
        secureLog('info', 'Webhook server shutdown complete', {
          final_integrity_metrics: {
            total_validations: finalMetrics.totalValidations,
            final_success_rate: validator.getSuccessRate(),
            total_errors: finalMetrics.failedValidations
          }
        });
        
        resolve();
      });

      // Force shutdown after 5 seconds
      setTimeout(() => {
        secureLog('warn', 'Force shutdown - integrity-aware webhook server');
        process.exit(0);
      }, 5000);
    });
  }

  public isServerRunning(): boolean {
    return this.isRunning;
  }

  public getPort(): number {
    return this.port;
  }

  public getSecurityHeadersManager(): SecurityHeadersManager {
    return this.securityHeaders;
  }

  public getIntegrityMetrics(): IntegrityMetrics {
    const validator = getGlobalIntegrityValidator();
    return validator.getMetrics();
  }

  private startNonceCleanup(): void {
    // Clean up expired nonces every 5 minutes
    setInterval(() => {
      this.securityHeaders.cleanupExpiredNonces();
    }, 300000);
  }
}

// Extend Express Request interface for integrity validation
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      integrityMetadata?: ValidationMetadata;
      rawBody?: Buffer;
    }
  }
}
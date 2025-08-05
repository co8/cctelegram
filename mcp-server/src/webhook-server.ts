/**
 * Tier 1: MCP Real-Time Webhook Foundation
 * Express.js HTTP server for instant Bridge notifications (0-100ms response time)
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { Server } from 'http';

export interface WebhookPayload {
  type: 'telegram_response';
  callback_data: string;
  user_id: number;
  username?: string;
  first_name?: string;
  timestamp: string;
  correlation_id?: string;
}

export interface WebhookResponse {
  success: boolean;
  correlation_id: string;
  processed_by: 'mcp_webhook';
  processing_time_ms: number;
  message?: string;
  error?: string;
}

// Joi schema for payload validation
const webhookPayloadSchema = Joi.object({
  type: Joi.string().valid('telegram_response').required(),
  callback_data: Joi.string().required(),
  user_id: Joi.number().integer().positive().required(),
  username: Joi.string().optional(),
  first_name: Joi.string().optional(),
  timestamp: Joi.string().isoDate().required(),
  correlation_id: Joi.string().uuid().optional()
});

export class WebhookServer {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;
  private isRunning = false;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // JSON parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    
    // CORS middleware
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-ID');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // Request logging middleware
    this.app.use((req, res, next) => {
      const correlationId = req.headers['x-correlation-id'] || uuidv4();
      req.correlationId = correlationId as string;
      
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Correlation: ${correlationId}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'cctelegram-webhook-server',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0'
      });
    });

    // Main webhook endpoint (placeholder for now)
    this.app.post('/webhook/bridge-response', async (req, res) => {
      const startTime = Date.now();
      const correlationId = req.correlationId || uuidv4();

      try {
        // Validate payload
        const { error, value } = webhookPayloadSchema.validate(req.body);
        if (error) {
          return res.status(400).json({
            success: false,
            correlation_id: correlationId,
            error: `Validation failed: ${error.details.map(d => d.message).join(', ')}`,
            processing_time_ms: Date.now() - startTime
          } as WebhookResponse);
        }

        const payload: WebhookPayload = {
          ...value,
          correlation_id: correlationId
        };

        // TODO: Process the webhook payload (Task 21.3)
        console.log(`[WEBHOOK] Received payload:`, payload);

        // Respond quickly (target < 100ms)
        const response: WebhookResponse = {
          success: true,
          correlation_id: correlationId,
          processed_by: 'mcp_webhook',
          processing_time_ms: Date.now() - startTime,
          message: 'Webhook received and queued for processing'
        };

        res.json(response);

      } catch (error) {
        const response: WebhookResponse = {
          success: false,
          correlation_id: correlationId,
          processed_by: 'mcp_webhook',
          processing_time_ms: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error'
        };

        res.status(500).json(response);
      }
    });

    // Status endpoint
    this.app.get('/status', (req, res) => {
      res.json({
        server: 'running',
        port: this.port,
        endpoints: [
          'GET /health',
          'GET /status', 
          'POST /webhook/bridge-response'
        ],
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage(),
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
        timestamp: new Date().toISOString()
      });
    });

    // Global error handler
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error(`[ERROR] ${error.message}`, error.stack);
      
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString()
      });
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Webhook server is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        this.isRunning = true;
        console.log(`[WEBHOOK-SERVER] Started on port ${this.port}`);
        console.log(`[WEBHOOK-SERVER] Health check: http://localhost:${this.port}/health`);
        console.log(`[WEBHOOK-SERVER] Webhook endpoint: http://localhost:${this.port}/webhook/bridge-response`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error(`[WEBHOOK-SERVER] Failed to start:`, error);
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

    return new Promise((resolve) => {
      console.log('[WEBHOOK-SERVER] Shutting down gracefully...');
      
      this.server!.close(() => {
        this.isRunning = false;
        console.log('[WEBHOOK-SERVER] Shutdown complete');
        resolve();
      });

      // Force shutdown after 5 seconds
      setTimeout(() => {
        console.log('[WEBHOOK-SERVER] Force shutdown');
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
}

// Extend Express Request interface for correlation ID
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}
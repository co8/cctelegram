/**
 * HTTP Connection Pool Configuration
 * Provides optimized HTTP agents for different types of bridge communications
 */

import http from 'http';
import https from 'https';
import { AxiosRequestConfig } from 'axios';
import { secureLog } from './security.js';

/**
 * HTTP connection pool configuration
 */
export interface HttpPoolConfig {
  maxSockets: number;
  maxFreeSockets: number;
  timeout: number;
  keepAlive: boolean;
  keepAliveMsecs: number;
  maxRedirects: number;
}

/**
 * Pool types with different performance characteristics
 */
export type PoolType = 'health' | 'status' | 'polling' | 'default';

/**
 * Default configurations for different pool types
 */
const DEFAULT_POOL_CONFIGS: Record<PoolType, HttpPoolConfig> = {
  // Health checks - less frequent, longer timeout, fewer connections
  health: {
    maxSockets: 2,
    maxFreeSockets: 1,
    timeout: 5000,
    keepAlive: true,
    keepAliveMsecs: 30000, // 30 seconds
    maxRedirects: 3
  },
  
  // Status checks - moderate frequency, medium timeout
  status: {
    maxSockets: 3,
    maxFreeSockets: 2,
    timeout: 2000,
    keepAlive: true,
    keepAliveMsecs: 15000, // 15 seconds
    maxRedirects: 2
  },
  
  // Polling - frequent, short timeout, optimized for speed
  polling: {
    maxSockets: 5,
    maxFreeSockets: 3,
    timeout: 1000,
    keepAlive: true,
    keepAliveMsecs: 10000, // 10 seconds
    maxRedirects: 1
  },
  
  // Default configuration
  default: {
    maxSockets: 10,
    maxFreeSockets: 5,
    timeout: 5000,
    keepAlive: true,
    keepAliveMsecs: 60000, // 60 seconds
    maxRedirects: 3
  }
};

/**
 * HTTP Connection Pool Manager
 */
export class HttpConnectionPool {
  private httpAgents: Map<PoolType, http.Agent> = new Map();
  private httpsAgents: Map<PoolType, https.Agent> = new Map();
  private config: Record<PoolType, HttpPoolConfig>;
  private stats: Map<PoolType, { requests: number; connections: number; errors: number }> = new Map();

  constructor(customConfig?: Partial<Record<PoolType, Partial<HttpPoolConfig>>>) {
    // Merge custom config with defaults
    this.config = { ...DEFAULT_POOL_CONFIGS };
    
    if (customConfig) {
      for (const [poolType, config] of Object.entries(customConfig)) {
        this.config[poolType as PoolType] = {
          ...this.config[poolType as PoolType],
          ...config
        };
      }
    }
    
    // Initialize agents
    this.initializeAgents();
    
    // Initialize stats
    for (const poolType of Object.keys(this.config) as PoolType[]) {
      this.stats.set(poolType, { requests: 0, connections: 0, errors: 0 });
    }
    
    secureLog('info', 'HTTP Connection Pool initialized', {
      pool_types: Object.keys(this.config),
      total_agents: this.httpAgents.size + this.httpsAgents.size
    });
  }

  /**
   * Initialize HTTP and HTTPS agents for each pool type
   */
  private initializeAgents(): void {
    for (const [poolType, config] of Object.entries(this.config) as [PoolType, HttpPoolConfig][]) {
      // HTTP Agent
      const httpAgent = new http.Agent({
        keepAlive: config.keepAlive,
        keepAliveMsecs: config.keepAliveMsecs,
        maxSockets: config.maxSockets,
        maxFreeSockets: config.maxFreeSockets,
        timeout: config.timeout
      });
      
      // HTTPS Agent
      const httpsAgent = new https.Agent({
        keepAlive: config.keepAlive,
        keepAliveMsecs: config.keepAliveMsecs,
        maxSockets: config.maxSockets,
        maxFreeSockets: config.maxFreeSockets,
        timeout: config.timeout,
        rejectUnauthorized: true // Ensure SSL verification
      });
      
      this.httpAgents.set(poolType, httpAgent);
      this.httpsAgents.set(poolType, httpsAgent);
      
      secureLog('debug', 'HTTP agents created for pool type', {
        pool_type: poolType,
        max_sockets: config.maxSockets,
        keep_alive: config.keepAlive,
        timeout: config.timeout
      });
    }
  }

  /**
   * Get axios configuration with appropriate HTTP agent for pool type
   */
  getAxiosConfig(poolType: PoolType = 'default', url?: string): AxiosRequestConfig {
    const config = this.config[poolType];
    const isHttps = url?.startsWith('https://') ?? false;
    
    const agent = isHttps 
      ? this.httpsAgents.get(poolType)
      : this.httpAgents.get(poolType);
    
    if (!agent) {
      secureLog('error', 'HTTP agent not found for pool type', { pool_type: poolType });
      throw new Error(`HTTP agent not found for pool type: ${poolType}`);
    }
    
    // Increment request counter
    const stats = this.stats.get(poolType);
    if (stats) {
      stats.requests++;
    }
    
    const axiosConfig: AxiosRequestConfig = {
      timeout: config.timeout,
      maxRedirects: config.maxRedirects,
      httpAgent: isHttps ? undefined : agent,
      httpsAgent: isHttps ? agent : undefined,
      
      // Additional performance optimizations
      headers: {
        'Connection': config.keepAlive ? 'keep-alive' : 'close',
        'Keep-Alive': config.keepAlive ? `timeout=${Math.floor(config.keepAliveMsecs / 1000)}` : undefined
      },
      
      // Validate status codes
      validateStatus: (status: number) => status >= 200 && status < 300,
      
      // Response handling
      responseType: 'json',
      transformResponse: [(data) => {
        try {
          return typeof data === 'string' ? JSON.parse(data) : data;
        } catch {
          return data; // Return as-is if not JSON
        }
      }]
    };
    
    // Remove undefined headers
    if (axiosConfig.headers) {
      Object.keys(axiosConfig.headers).forEach(key => {
        if (axiosConfig.headers![key] === undefined) {
          delete axiosConfig.headers![key];
        }
      });
    }
    
    secureLog('debug', 'Axios config generated for pool type', {
      pool_type: poolType,
      timeout: config.timeout,
      is_https: isHttps,
      keep_alive: config.keepAlive
    });
    
    return axiosConfig;
  }

  /**
   * Get connection pool statistics
   */
  getStats(): Record<PoolType, { 
    requests: number; 
    connections: number; 
    errors: number;
    config: HttpPoolConfig;
    agent_stats?: {
      http?: { sockets: number; requests: number; freeSockets: number };
      https?: { sockets: number; requests: number; freeSockets: number };
    };
  }> {
    const result = {} as any;
    
    for (const [poolType, stats] of this.stats.entries()) {
      const httpAgent = this.httpAgents.get(poolType);
      const httpsAgent = this.httpsAgents.get(poolType);
      
      result[poolType] = {
        ...stats,
        config: this.config[poolType],
        agent_stats: {
          http: httpAgent ? {
            sockets: Object.keys(httpAgent.sockets).length,
            requests: Object.keys(httpAgent.requests).length,
            freeSockets: Object.keys(httpAgent.freeSockets).length
          } : undefined,
          https: httpsAgent ? {
            sockets: Object.keys(httpsAgent.sockets).length,
            requests: Object.keys(httpsAgent.requests).length,
            freeSockets: Object.keys(httpsAgent.freeSockets).length
          } : undefined
        }
      };
    }
    
    return result;
  }

  /**
   * Record an error for statistics
   */
  recordError(poolType: PoolType): void {
    const stats = this.stats.get(poolType);
    if (stats) {
      stats.errors++;
    }
  }

  /**
   * Get pool configuration for a specific type
   */
  getPoolConfig(poolType: PoolType): HttpPoolConfig {
    return { ...this.config[poolType] };
  }

  /**
   * Update pool configuration (creates new agents)
   */
  updatePoolConfig(poolType: PoolType, newConfig: Partial<HttpPoolConfig>): void {
    // Update configuration
    this.config[poolType] = {
      ...this.config[poolType],
      ...newConfig
    };
    
    // Destroy old agents
    const oldHttpAgent = this.httpAgents.get(poolType);
    const oldHttpsAgent = this.httpsAgents.get(poolType);
    
    if (oldHttpAgent) {
      oldHttpAgent.destroy();
    }
    if (oldHttpsAgent) {
      oldHttpsAgent.destroy();
    }
    
    // Create new agents with updated config
    const config = this.config[poolType];
    
    const httpAgent = new http.Agent({
      keepAlive: config.keepAlive,
      keepAliveMsecs: config.keepAliveMsecs,
      maxSockets: config.maxSockets,
      maxFreeSockets: config.maxFreeSockets,
      timeout: config.timeout
    });
    
    const httpsAgent = new https.Agent({
      keepAlive: config.keepAlive,
      keepAliveMsecs: config.keepAliveMsecs,
      maxSockets: config.maxSockets,
      maxFreeSockets: config.maxFreeSockets,
      timeout: config.timeout,
      rejectUnauthorized: true
    });
    
    this.httpAgents.set(poolType, httpAgent);
    this.httpsAgents.set(poolType, httpsAgent);
    
    secureLog('info', 'HTTP pool configuration updated', {
      pool_type: poolType,
      new_config: newConfig
    });
  }

  /**
   * Cleanup all agents and connections
   */
  destroy(): void {
    secureLog('info', 'Destroying HTTP connection pools');
    
    // Destroy all HTTP agents
    for (const agent of this.httpAgents.values()) {
      agent.destroy();
    }
    
    // Destroy all HTTPS agents
    for (const agent of this.httpsAgents.values()) {
      agent.destroy();
    }
    
    // Clear collections
    this.httpAgents.clear();
    this.httpsAgents.clear();
    this.stats.clear();
  }
}

/**
 * Global HTTP connection pool instance
 */
let globalHttpPool: HttpConnectionPool | null = null;

/**
 * Get or create global HTTP connection pool
 */
export function getHttpPool(customConfig?: Partial<Record<PoolType, Partial<HttpPoolConfig>>>): HttpConnectionPool {
  if (!globalHttpPool) {
    globalHttpPool = new HttpConnectionPool(customConfig);
    
    // Cleanup on process exit
    process.on('exit', () => {
      if (globalHttpPool) {
        globalHttpPool.destroy();
      }
    });
    
    process.on('SIGINT', () => {
      if (globalHttpPool) {
        globalHttpPool.destroy();
      }
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      if (globalHttpPool) {
        globalHttpPool.destroy();
      }
      process.exit(0);
    });
  }
  
  return globalHttpPool;
}

/**
 * Helper function to get axios config for bridge communications
 */
export function getBridgeAxiosConfig(operationType: 'health' | 'status' | 'polling', url?: string): AxiosRequestConfig {
  const pool = getHttpPool();
  return pool.getAxiosConfig(operationType, url);
}
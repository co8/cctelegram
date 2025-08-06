/**
 * Configuration Caching System
 * 
 * Implements configuration caching with TTL expiration, change detection using file checksums,
 * and optimized filesystem operations to minimize performance overhead.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import * as path from 'path';
import { LRUCache } from 'lru-cache';
import { ApplicationConfig } from './config-schema.js';
import { secureLog } from '../security.js';

export interface CacheEntry {
  config: ApplicationConfig;
  checksum: string;
  timestamp: Date;
  ttl: number;
  accessCount: number;
  lastAccessed: Date;
  source: string;
}

export interface CacheOptions {
  defaultTTL?: number; // milliseconds
  maxEntries?: number;
  enableChecksumValidation?: boolean;
  enableFileWatching?: boolean;
  enableMetrics?: boolean;
  cacheDirectory?: string;
  enablePersistence?: boolean;
  persistenceInterval?: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
  checksumMismatches: number;
  totalRequests: number;
  averageResponseTime: number;
  cacheSize: number;
  hitRate: number;
}

export interface CacheInvalidationStrategy {
  type: 'ttl' | 'checksum' | 'manual' | 'external';
  reason: string;
  affectedKeys: string[];
  timestamp: Date;
}

export class ConfigurationCache extends EventEmitter {
  private cache: LRUCache<string, CacheEntry>;
  private checksumCache: Map<string, string> = new Map();
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();
  private options: Required<CacheOptions>;
  private metrics: CacheMetrics;
  private persistenceTimer?: NodeJS.Timeout;
  private lastPersistenceTime: Date | null = null;

  constructor(options: CacheOptions = {}) {
    super();

    this.options = {
      defaultTTL: options.defaultTTL ?? 300000, // 5 minutes
      maxEntries: options.maxEntries ?? 100,
      enableChecksumValidation: options.enableChecksumValidation ?? true,
      enableFileWatching: options.enableFileWatching ?? true,
      enableMetrics: options.enableMetrics ?? true,
      cacheDirectory: options.cacheDirectory ?? './cache/config',
      enablePersistence: options.enablePersistence ?? false,
      persistenceInterval: options.persistenceInterval ?? 60000 // 1 minute
    };

    // Initialize LRU cache
    this.cache = new LRUCache({
      max: this.options.maxEntries,
      ttl: this.options.defaultTTL,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
      dispose: (value, key) => this.handleCacheEviction(key, value)
    });

    // Initialize metrics
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0,
      checksumMismatches: 0,
      totalRequests: 0,
      averageResponseTime: 0,
      cacheSize: 0,
      hitRate: 0
    };

    this.initialize();
  }

  /**
   * Initialize cache system
   */
  private async initialize(): Promise<void> {
    try {
      // Ensure cache directory exists
      if (this.options.enablePersistence) {
        await fs.ensureDir(this.options.cacheDirectory);
        await this.loadPersistedCache();
      }

      // Setup persistence timer
      if (this.options.enablePersistence) {
        this.setupPersistenceTimer();
      }

      secureLog('info', 'Configuration cache initialized', {
        max_entries: this.options.maxEntries,
        default_ttl: this.options.defaultTTL,
        checksum_validation: this.options.enableChecksumValidation,
        file_watching: this.options.enableFileWatching,
        persistence: this.options.enablePersistence
      });

      this.emit('initialized');

    } catch (error) {
      secureLog('error', 'Failed to initialize configuration cache', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get configuration from cache
   */
  public async get(key: string, filePath?: string): Promise<ApplicationConfig | null> {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      const entry = this.cache.get(key);

      if (!entry) {
        this.metrics.misses++;
        this.updateMetrics();
        secureLog('debug', 'Cache miss', { key });
        return null;
      }

      // Validate checksum if file path provided and checksum validation enabled
      if (filePath && this.options.enableChecksumValidation) {
        const currentChecksum = await this.calculateFileChecksum(filePath);
        
        if (currentChecksum !== entry.checksum) {
          this.metrics.checksumMismatches++;
          this.invalidate(key, {
            type: 'checksum',
            reason: 'File checksum mismatch',
            affectedKeys: [key],
            timestamp: new Date()
          });
          
          secureLog('debug', 'Cache invalidated due to checksum mismatch', {
            key,
            file: filePath
          });
          
          this.updateMetrics();
          return null;
        }
      }

      // Update access statistics
      entry.accessCount++;
      entry.lastAccessed = new Date();

      this.metrics.hits++;
      this.updateMetrics();

      const responseTime = Date.now() - startTime;
      this.updateAverageResponseTime(responseTime);

      secureLog('debug', 'Cache hit', {
        key,
        access_count: entry.accessCount,
        age: Date.now() - entry.timestamp.getTime()
      });

      return entry.config;

    } catch (error) {
      secureLog('error', 'Error retrieving from cache', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      this.metrics.misses++;
      this.updateMetrics();
      return null;
    }
  }

  /**
   * Set configuration in cache
   */
  public async set(
    key: string, 
    config: ApplicationConfig, 
    filePath?: string,
    ttl?: number
  ): Promise<void> {
    try {
      let checksum = '';
      
      // Calculate file checksum if path provided
      if (filePath && this.options.enableChecksumValidation) {
        checksum = await this.calculateFileChecksum(filePath);
        this.checksumCache.set(filePath, checksum);
        
        // Setup file watcher if enabled
        if (this.options.enableFileWatching) {
          await this.setupFileWatcher(filePath, key);
        }
      }

      const entry: CacheEntry = {
        config,
        checksum,
        timestamp: new Date(),
        ttl: ttl ?? this.options.defaultTTL,
        accessCount: 0,
        lastAccessed: new Date(),
        source: filePath || 'unknown'
      };

      this.cache.set(key, entry, { ttl: entry.ttl });

      secureLog('debug', 'Configuration cached', {
        key,
        ttl: entry.ttl,
        has_checksum: checksum.length > 0,
        file_watching: this.options.enableFileWatching && !!filePath
      });

      this.emit('cached', { key, config, entry });

    } catch (error) {
      secureLog('error', 'Error caching configuration', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Invalidate cache entry
   */
  public invalidate(key: string, strategy?: CacheInvalidationStrategy): void {
    const deleted = this.cache.delete(key);
    
    if (deleted) {
      this.metrics.invalidations++;
      this.updateMetrics();

      secureLog('debug', 'Cache entry invalidated', {
        key,
        strategy: strategy?.type || 'manual',
        reason: strategy?.reason || 'Manual invalidation'
      });

      this.emit('invalidated', { key, strategy });
    }
  }

  /**
   * Invalidate multiple cache entries
   */
  public invalidateMultiple(keys: string[], strategy?: CacheInvalidationStrategy): void {
    keys.forEach(key => this.invalidate(key, strategy));
  }

  /**
   * Invalidate all cache entries
   */
  public invalidateAll(strategy?: CacheInvalidationStrategy): void {
    const keys = Array.from(this.cache.keys());
    this.cache.clear();
    
    this.metrics.invalidations += keys.length;
    this.updateMetrics();

    secureLog('info', 'All cache entries invalidated', {
      count: keys.length,
      strategy: strategy?.type || 'manual'
    });

    this.emit('allInvalidated', { keys, strategy });
  }

  /**
   * Check if key exists in cache
   */
  public has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Get cache size
   */
  public size(): number {
    return this.cache.size;
  }

  /**
   * Get cache keys
   */
  public keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache entries
   */
  public entries(): Array<{ key: string; entry: CacheEntry }> {
    const entries: Array<{ key: string; entry: CacheEntry }> = [];
    
    for (const [key, value] of this.cache.entries()) {
      entries.push({ key, entry: value });
    }
    
    return entries;
  }

  /**
   * Calculate file checksum
   */
  private async calculateFileChecksum(filePath: string): Promise<string> {
    try {
      if (!await fs.pathExists(filePath)) {
        return '';
      }

      const content = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
      
    } catch (error) {
      secureLog('warn', 'Failed to calculate file checksum', {
        file: filePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return '';
    }
  }

  /**
   * Setup file watcher for automatic invalidation
   */
  private async setupFileWatcher(filePath: string, cacheKey: string): Promise<void> {
    if (this.fileWatchers.has(filePath)) {
      return; // Already watching this file
    }

    try {
      if (!await fs.pathExists(filePath)) {
        return;
      }

      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          secureLog('debug', 'File changed, invalidating cache', {
            file: filePath,
            cache_key: cacheKey
          });

          this.invalidate(cacheKey, {
            type: 'external',
            reason: 'File system change detected',
            affectedKeys: [cacheKey],
            timestamp: new Date()
          });
        }
      });

      this.fileWatchers.set(filePath, watcher);

      secureLog('debug', 'File watcher setup', {
        file: filePath,
        cache_key: cacheKey
      });

    } catch (error) {
      secureLog('warn', 'Failed to setup file watcher', {
        file: filePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Handle cache eviction
   */
  private handleCacheEviction(key: string, entry: CacheEntry): void {
    this.metrics.evictions++;
    
    secureLog('debug', 'Cache entry evicted', {
      key,
      age: Date.now() - entry.timestamp.getTime(),
      access_count: entry.accessCount
    });

    this.emit('evicted', { key, entry });
  }

  /**
   * Update cache metrics
   */
  private updateMetrics(): void {
    if (!this.options.enableMetrics) {
      return;
    }

    this.metrics.cacheSize = this.cache.size;
    this.metrics.hitRate = this.metrics.totalRequests > 0 ? 
      this.metrics.hits / this.metrics.totalRequests : 0;
  }

  /**
   * Update average response time
   */
  private updateAverageResponseTime(responseTime: number): void {
    if (!this.options.enableMetrics) {
      return;
    }

    // Simple moving average
    const alpha = 0.1; // Smoothing factor
    this.metrics.averageResponseTime = 
      (alpha * responseTime) + ((1 - alpha) * this.metrics.averageResponseTime);
  }

  /**
   * Get cache metrics
   */
  public getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset cache metrics
   */
  public resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0,
      checksumMismatches: 0,
      totalRequests: 0,
      averageResponseTime: 0,
      cacheSize: this.cache.size,
      hitRate: 0
    };

    secureLog('debug', 'Cache metrics reset');
  }

  /**
   * Setup persistence timer
   */
  private setupPersistenceTimer(): void {
    this.persistenceTimer = setInterval(async () => {
      try {
        await this.persistCache();
      } catch (error) {
        secureLog('error', 'Failed to persist cache', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.options.persistenceInterval);
  }

  /**
   * Persist cache to disk
   */
  public async persistCache(): Promise<void> {
    if (!this.options.enablePersistence) {
      return;
    }

    try {
      const cacheData = {
        entries: this.entries(),
        metrics: this.metrics,
        timestamp: new Date().toISOString()
      };

      const persistencePath = path.join(this.options.cacheDirectory, 'cache-state.json');
      await fs.writeJson(persistencePath, cacheData, { spaces: 2 });

      this.lastPersistenceTime = new Date();

      secureLog('debug', 'Cache persisted to disk', {
        entries: cacheData.entries.length,
        path: persistencePath
      });

    } catch (error) {
      secureLog('error', 'Failed to persist cache to disk', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Load persisted cache from disk
   */
  private async loadPersistedCache(): Promise<void> {
    try {
      const persistencePath = path.join(this.options.cacheDirectory, 'cache-state.json');
      
      if (!await fs.pathExists(persistencePath)) {
        return;
      }

      const cacheData = await fs.readJson(persistencePath);
      
      // Restore cache entries
      for (const { key, entry } of cacheData.entries) {
        // Check if entry is still valid (not expired)
        const age = Date.now() - new Date(entry.timestamp).getTime();
        if (age < entry.ttl) {
          this.cache.set(key, entry, { ttl: entry.ttl - age });
        }
      }

      secureLog('info', 'Cache loaded from disk', {
        loaded_entries: cacheData.entries.length,
        active_entries: this.cache.size
      });

    } catch (error) {
      secureLog('warn', 'Failed to load persisted cache', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get cache statistics
   */
  public getCacheStatistics(): {
    size: number;
    maxSize: number;
    utilization: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
    averageAge: number;
    filesWatched: number;
    lastPersistence: Date | null;
  } {
    const entries = this.entries();
    
    let oldestEntry: Date | null = null;
    let newestEntry: Date | null = null;
    let totalAge = 0;

    if (entries.length > 0) {
      const firstEntry = entries[0];
      if (firstEntry) {
        oldestEntry = firstEntry.entry.timestamp;
        newestEntry = firstEntry.entry.timestamp;
      }

      for (const { entry } of entries) {
        if (oldestEntry && entry.timestamp < oldestEntry) {
          oldestEntry = entry.timestamp;
        }
        if (newestEntry && entry.timestamp > newestEntry) {
          newestEntry = entry.timestamp;
        }
        totalAge += Date.now() - entry.timestamp.getTime();
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.options.maxEntries,
      utilization: this.cache.size / this.options.maxEntries,
      oldestEntry,
      newestEntry,
      averageAge: entries.length > 0 ? totalAge / entries.length : 0,
      filesWatched: this.fileWatchers.size,
      lastPersistence: this.lastPersistenceTime
    };
  }

  /**
   * Cleanup expired entries manually
   */
  public cleanup(): number {
    const sizeBefore = this.cache.size;
    
    // The LRU cache handles TTL automatically, but we can force a cleanup
    // by calling purgeStale()
    this.cache.purgeStale();
    
    const cleaned = sizeBefore - this.cache.size;
    
    if (cleaned > 0) {
      secureLog('debug', 'Cache cleanup completed', {
        cleaned_entries: cleaned,
        remaining_entries: this.cache.size
      });
    }

    return cleaned;
  }

  /**
   * Shutdown cache system
   */
  public async shutdown(): Promise<void> {
    secureLog('info', 'Shutting down configuration cache');

    // Clear persistence timer
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = undefined;
    }

    // Persist final state
    if (this.options.enablePersistence) {
      await this.persistCache();
    }

    // Close file watchers
    for (const [filePath, watcher] of this.fileWatchers) {
      try {
        watcher.close();
      } catch (error) {
        secureLog('warn', 'Error closing file watcher', {
          file: filePath,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    this.fileWatchers.clear();

    // Clear cache
    this.cache.clear();
    this.checksumCache.clear();

    this.emit('shutdown');
  }
}
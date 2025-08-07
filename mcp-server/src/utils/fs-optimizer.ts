/**
 * File System Operation Optimizer
 * Provides batched and cached file system operations to reduce I/O overhead
 * Enhanced with dynamic buffer management for Task 39.3
 */

import * as fs from 'fs/promises';
import { Stats } from 'fs';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { getGlobalBufferPool, DynamicBufferPool } from './dynamic-buffer-manager.js';

/**
 * Directory listing cache entry
 */
interface DirectoryCache {
  files: string[];
  stats: Map<string, Stats>;
  timestamp: number;
  ttl: number;
}

/**
 * Batch file read result
 */
interface BatchReadResult<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
  filePath: string;
}

/**
 * File system optimizer with caching, batching, and dynamic buffer management
 */
export class FileSystemOptimizer {
  private directoryCache = new Map<string, DirectoryCache>();
  private readonly defaultCacheTtl = 30000; // 30 seconds
  private readonly maxCacheSize = 100;
  private bufferPool: DynamicBufferPool;
  
  constructor(bufferPool?: DynamicBufferPool) {
    this.bufferPool = bufferPool || getGlobalBufferPool({
      bufferSize: 16384, // 16KB for file operations
      initialPoolSize: 10,
      maxPoolSize: 50
    });
  }

  /**
   * Get directory listing with caching
   */
  async getCachedDirectoryListing(
    directory: string,
    ttl: number = this.defaultCacheTtl
  ): Promise<{ files: string[]; stats: Map<string, Stats> }> {
    const cacheKey = path.resolve(directory);
    const now = Date.now();
    
    // Check cache
    const cached = this.directoryCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < cached.ttl) {
      return { files: cached.files, stats: cached.stats };
    }

    try {
      // Read directory and get stats for all files
      const files = await fs.readdir(directory);
      const stats = new Map<string, Stats>();
      
      // Batch stat operations
      const statPromises = files.map(async (file): Promise<{ file: string; stat: Stats | null; error?: unknown }> => {
        try {
          const filePath = path.join(directory, file);
          const stat = await fsExtra.stat(filePath);
          return { file, stat };
        } catch (error) {
          return { file, stat: null, error };
        }
      });

      const statResults = await Promise.allSettled(statPromises);
      
      statResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.stat) {
          stats.set(files[index], result.value.stat);
        }
      });

      // Update cache
      this.directoryCache.set(cacheKey, {
        files,
        stats,
        timestamp: now,
        ttl
      });

      // Cleanup old cache entries
      this.cleanupCache();

      return { files, stats };
    } catch (error) {
      throw new Error(`Failed to read directory ${directory}: ${error}`);
    }
  }

  /**
   * Batch read JSON files with dynamic buffer management
   */
  async batchReadJSON<T = any>(filePaths: string[]): Promise<BatchReadResult<T>[]> {
    const readPromises = filePaths.map(async (filePath): Promise<BatchReadResult<T>> => {
      try {
        // Check file size first to determine buffer strategy
        const stat = await fsExtra.stat(filePath);
        const fileSize = stat.size;
        
        if (fileSize > 64 * 1024) { // 64KB threshold for large files
          // Use dynamic buffer for large files
          const buffer = this.bufferPool.acquire(fileSize);
          const fileHandle = await fs.open(filePath, 'r');
          
          try {
            const { bytesRead } = await fileHandle.read(buffer, 0, fileSize, 0);
            const jsonString = buffer.toString('utf8', 0, bytesRead);
            const data = JSON.parse(jsonString);
            
            return { success: true, data, filePath };
          } finally {
            await fileHandle.close();
            this.bufferPool.release(buffer);
          }
        } else {
          // Use standard method for small files
          const data = await fsExtra.readJSON(filePath);
          return { success: true, data, filePath };
        }
      } catch (error) {
        return { 
          success: false, 
          error: error instanceof Error ? error : new Error(String(error)), 
          filePath 
        };
      }
    });

    return Promise.all(readPromises);
  }
  
  /**
   * Write large JSON files using dynamic buffers
   */
  async writeJSONWithBuffer(filePath: string, data: any, options: { spaces?: number } = {}): Promise<void> {
    const jsonString = JSON.stringify(data, null, options.spaces || 2);
    const dataSize = Buffer.byteLength(jsonString, 'utf8');
    
    if (dataSize > 1024) { // Use buffer pool for files > 1KB
      const buffer = this.bufferPool.acquire(dataSize);
      buffer.write(jsonString, 'utf8');
      
      try {
        await fs.writeFile(filePath, buffer.subarray(0, dataSize));
      } finally {
        this.bufferPool.release(buffer);
      }
    } else {
      await fsExtra.writeJSON(filePath, data, options);
    }
  }

  /**
   * Batch check file existence
   */
  async batchPathExists(filePaths: string[]): Promise<Map<string, boolean>> {
    const existsPromises = filePaths.map(async (filePath) => {
      try {
        const exists = await fsExtra.pathExists(filePath);
        return { filePath, exists };
      } catch (error) {
        return { filePath, exists: false };
      }
    });

    const results = await Promise.all(existsPromises);
    const existsMap = new Map<string, boolean>();
    
    results.forEach(({ filePath, exists }) => {
      existsMap.set(filePath, exists);
    });

    return existsMap;
  }

  /**
   * Get filtered files from directory with single directory scan
   */
  async getFilteredFiles(
    directory: string,
    filter: {
      extensions?: string[];
      maxAge?: number; // milliseconds
      minAge?: number; // milliseconds
      maxSize?: number; // bytes
    } = {},
    cacheTtl?: number
  ): Promise<{ files: string[]; fileStats: Map<string, Stats> }> {
    const { files, stats } = await this.getCachedDirectoryListing(directory, cacheTtl);
    const now = Date.now();
    
    const filteredFiles: string[] = [];
    const fileStats = new Map<string, Stats>();

    for (const file of files) {
      const stat = stats.get(file);
      if (!stat || !stat.isFile()) continue;

      // Extension filter
      if (filter.extensions && !filter.extensions.some(ext => file.endsWith(ext))) {
        continue;
      }

      // Age filters
      const fileAge = now - stat.mtime.getTime();
      if (filter.maxAge && fileAge > filter.maxAge) continue;
      if (filter.minAge && fileAge < filter.minAge) continue;

      // Size filter
      if (filter.maxSize && stat.size > filter.maxSize) continue;

      filteredFiles.push(file);
      fileStats.set(file, stat);
    }

    return { files: filteredFiles, fileStats };
  }

  /**
   * Get responses with optimized file operations
   */
  async getResponseFiles(
    responsesDir: string,
    options: {
      limit?: number;
      sinceMinutes?: number;
      sortByTime?: boolean;
    } = {}
  ): Promise<{ responses: any[]; fileStats: Map<string, Stats> }> {
    const filter: any = { extensions: ['.json'] };
    
    if (options.sinceMinutes) {
      filter.maxAge = options.sinceMinutes * 60 * 1000;
    }

    const { files, fileStats } = await this.getFilteredFiles(responsesDir, filter);
    
    if (files.length === 0) {
      return { responses: [], fileStats: new Map() };
    }

    // Read all JSON files in batch
    const filePaths = files.map(file => path.join(responsesDir, file));
    const readResults = await this.batchReadJSON(filePaths);

    const responses = readResults
      .filter(result => result.success)
      .map(result => result.data);

    // Sort by timestamp if requested
    if (options.sortByTime) {
      responses.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    }

    // Apply limit
    const limitedResponses = options.limit ? responses.slice(0, options.limit) : responses;

    return { responses: limitedResponses, fileStats };
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    if (this.directoryCache.size <= this.maxCacheSize) return;

    const now = Date.now();
    const entries = Array.from(this.directoryCache.entries());
    
    // Remove expired entries first
    entries.forEach(([key, cache]) => {
      if (now - cache.timestamp > cache.ttl) {
        this.directoryCache.delete(key);
      }
    });

    // If still over limit, remove oldest entries
    if (this.directoryCache.size > this.maxCacheSize) {
      const sortedEntries = entries
        .filter(([key]) => this.directoryCache.has(key))
        .sort(([, a], [, b]) => a.timestamp - b.timestamp);
      
      const toRemove = sortedEntries.slice(0, this.directoryCache.size - this.maxCacheSize);
      toRemove.forEach(([key]) => this.directoryCache.delete(key));
    }
  }

  /**
   * Clear cache for specific directory
   */
  clearCache(directory?: string): void {
    if (directory) {
      const cacheKey = path.resolve(directory);
      this.directoryCache.delete(cacheKey);
    } else {
      this.directoryCache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    entries: number;
    maxSize: number;
    hitRate?: number;
  } {
    return {
      entries: this.directoryCache.size,
      maxSize: this.maxCacheSize
    };
  }

  /**
   * Batch file operations for cleanup
   */
  async batchFileCleanup(
    directory: string,
    predicate: (file: string, stats: Stats) => boolean,
    maxConcurrent: number = 10
  ): Promise<{ deleted: string[]; errors: Array<{ file: string; error: Error }> }> {
    const { files, stats } = await this.getCachedDirectoryListing(directory);
    
    const filesToDelete: string[] = [];
    for (const file of files) {
      const stat = stats.get(file);
      if (stat && predicate(file, stat)) {
        filesToDelete.push(file);
      }
    }

    const deleted: string[] = [];
    const errors: Array<{ file: string; error: Error }> = [];

    // Process deletions in batches
    for (let i = 0; i < filesToDelete.length; i += maxConcurrent) {
      const batch = filesToDelete.slice(i, i + maxConcurrent);
      
      const deletePromises = batch.map(async (file) => {
        const filePath = path.join(directory, file);
        try {
          await fsExtra.remove(filePath);
          return { success: true, file };
        } catch (error) {
          return { 
            success: false, 
            file, 
            error: error instanceof Error ? error : new Error(String(error)) 
          };
        }
      });

      const results = await Promise.all(deletePromises);
      
      results.forEach(result => {
        if (result.success) {
          deleted.push(result.file);
        } else {
          errors.push({ file: result.file, error: result.error! });
        }
      });
    }

    // Clear cache for this directory after cleanup
    this.clearCache(directory);

    return { deleted, errors };
  }

  /**
   * Destroy optimizer and clear all caches
   */
  destroy(): void {
    this.directoryCache.clear();
  }
}

// Singleton instance for global use
let globalOptimizer: FileSystemOptimizer | null = null;

/**
 * Get the global file system optimizer instance
 */
export function getFsOptimizer(): FileSystemOptimizer {
  if (!globalOptimizer) {
    globalOptimizer = new FileSystemOptimizer();
  }
  return globalOptimizer;
}

/**
 * Destroy the global optimizer (useful for testing)
 */
export function destroyFsOptimizer(): void {
  if (globalOptimizer) {
    globalOptimizer.destroy();
    globalOptimizer = null;
  }
}
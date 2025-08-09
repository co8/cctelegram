/**
 * Unit tests for File System Optimizer
 * Tests batched file operations, caching, and performance improvements
 */

import { FileSystemOptimizer, getFsOptimizer, destroyFsOptimizer } from '../../src/utils/fs-optimizer.js';
import fs from 'fs-extra';
import path from 'path';
import { jest } from '@jest/globals';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  readdir: jest.fn(),
  stat: jest.fn(),
  readJSON: jest.fn(),
  pathExists: jest.fn(),
  remove: jest.fn()
}));
const mockFs = jest.mocked(fs);

describe('FileSystemOptimizer', () => {
  let optimizer: FileSystemOptimizer;

  beforeEach(() => {
    jest.clearAllMocks();
    optimizer = new FileSystemOptimizer();
  });

  afterEach(() => {
    optimizer.destroy();
  });

  describe('Directory Listing and Caching', () => {
    it('should cache directory listings with TTL', async () => {
      const testDir = '/test/directory';
      const mockFiles = ['file1.json', 'file2.json', 'file3.txt'];
      const mockStats = new Map([
        ['file1.json', { isFile: () => true, mtime: new Date('2023-01-01'), size: 100 } as any],
        ['file2.json', { isFile: () => true, mtime: new Date('2023-01-02'), size: 200 } as any],
        ['file3.txt', { isFile: () => true, mtime: new Date('2023-01-03'), size: 300 } as any]
      ]);

      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('file1.json'))
        .mockResolvedValueOnce(mockStats.get('file2.json'))
        .mockResolvedValueOnce(mockStats.get('file3.txt'));

      // First call should hit the file system
      const result1 = await optimizer.getCachedDirectoryListing(testDir);
      expect(result1.files).toEqual(mockFiles);
      expect(result1.stats.size).toBe(3);
      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
      expect(mockFs.stat).toHaveBeenCalledTimes(3);

      // Second call should use cache
      const result2 = await optimizer.getCachedDirectoryListing(testDir);
      expect(result2.files).toEqual(mockFiles);
      expect(mockFs.readdir).toHaveBeenCalledTimes(1); // No additional calls
      expect(mockFs.stat).toHaveBeenCalledTimes(3); // No additional calls
    });

    it('should respect cache TTL and refresh expired entries', async () => {
      const testDir = '/test/directory';
      const mockFiles = ['file1.json'];
      
      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.stat.mockResolvedValue({ isFile: () => true, mtime: new Date(), size: 100 } as any);

      // First call with short TTL
      await optimizer.getCachedDirectoryListing(testDir, 100); // 100ms TTL
      expect(mockFs.readdir).toHaveBeenCalledTimes(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Second call should refresh cache
      await optimizer.getCachedDirectoryListing(testDir, 100);
      expect(mockFs.readdir).toHaveBeenCalledTimes(2);
    });

    it('should handle file system errors gracefully', async () => {
      const testDir = '/nonexistent/directory';
      const error = new Error('ENOENT: no such file or directory');
      
      mockFs.readdir.mockRejectedValueOnce(error);

      await expect(optimizer.getCachedDirectoryListing(testDir))
        .rejects.toThrow('Failed to read directory /nonexistent/directory');
    });
  });

  describe('Batch File Operations', () => {
    it('should batch read JSON files efficiently', async () => {
      const filePaths = ['/path/file1.json', '/path/file2.json', '/path/file3.json'];
      const mockData = [
        { id: 1, name: 'file1' },
        { id: 2, name: 'file2' },
        { id: 3, name: 'file3' }
      ];

      mockFs.readJSON
        .mockResolvedValueOnce(mockData[0])
        .mockResolvedValueOnce(mockData[1])
        .mockResolvedValueOnce(mockData[2]);

      const results = await optimizer.batchReadJSON(filePaths);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockData[index]);
        expect(result.filePath).toBe(filePaths[index]);
      });

      expect(mockFs.readJSON).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success/failure in batch read', async () => {
      const filePaths = ['/path/valid.json', '/path/invalid.json', '/path/missing.json'];
      
      mockFs.readJSON
        .mockResolvedValueOnce({ valid: true })
        .mockRejectedValueOnce(new Error('Invalid JSON'))
        .mockRejectedValueOnce(new Error('File not found'));

      const results = await optimizer.batchReadJSON(filePaths);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[0].data).toEqual({ valid: true });
      
      expect(results[1].success).toBe(false);
      expect(results[1].error?.message).toBe('Invalid JSON');
      
      expect(results[2].success).toBe(false);
      expect(results[2].error?.message).toBe('File not found');
    });

    it('should batch check file existence', async () => {
      const filePaths = ['/path/exists.json', '/path/missing.json', '/path/also-exists.txt'];
      
      mockFs.pathExists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const existsMap = await optimizer.batchPathExists(filePaths);

      expect(existsMap.get('/path/exists.json')).toBe(true);
      expect(existsMap.get('/path/missing.json')).toBe(false);
      expect(existsMap.get('/path/also-exists.txt')).toBe(true);
      expect(mockFs.pathExists).toHaveBeenCalledTimes(3);
    });
  });

  describe('Filtered File Operations', () => {
    it('should filter files by extension and age', async () => {
      const testDir = '/test/responses';
      const mockFiles = ['response1.json', 'response2.json', 'readme.txt', 'old.json'];
      const now = Date.now();
      const mockStats = new Map([
        ['response1.json', { isFile: () => true, mtime: new Date(now - 1000), size: 100 } as any],
        ['response2.json', { isFile: () => true, mtime: new Date(now - 2000), size: 200 } as any],
        ['readme.txt', { isFile: () => true, mtime: new Date(now - 500), size: 50 } as any],
        ['old.json', { isFile: () => true, mtime: new Date(now - 10000), size: 150 } as any]
      ]);

      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('response1.json'))
        .mockResolvedValueOnce(mockStats.get('response2.json'))
        .mockResolvedValueOnce(mockStats.get('readme.txt'))
        .mockResolvedValueOnce(mockStats.get('old.json'));

      const { files, fileStats } = await optimizer.getFilteredFiles(testDir, {
        extensions: ['.json'],
        maxAge: 5000 // 5 seconds
      });

      // Should include only JSON files newer than 5 seconds
      expect(files).toEqual(['response1.json', 'response2.json']);
      expect(fileStats.size).toBe(2);
      expect(fileStats.has('response1.json')).toBe(true);
      expect(fileStats.has('response2.json')).toBe(true);
    });

    it('should filter files by size', async () => {
      const testDir = '/test/files';
      const mockFiles = ['small.json', 'large.json'];
      const mockStats = new Map([
        ['small.json', { isFile: () => true, mtime: new Date(), size: 50 } as any],
        ['large.json', { isFile: () => true, mtime: new Date(), size: 1000 } as any]
      ]);

      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('small.json'))
        .mockResolvedValueOnce(mockStats.get('large.json'));

      const { files } = await optimizer.getFilteredFiles(testDir, {
        maxSize: 100 // 100 bytes
      });

      expect(files).toEqual(['small.json']);
    });
  });

  describe('Response File Optimization', () => {
    it('should optimize response file retrieval with sorting and limiting', async () => {
      const responsesDir = '/test/responses';
      const mockFiles = ['response1.json', 'response2.json', 'response3.json'];
      const mockResponses = [
        { id: 1, timestamp: '2023-01-01T10:00:00Z' },
        { id: 2, timestamp: '2023-01-02T10:00:00Z' },
        { id: 3, timestamp: '2023-01-03T10:00:00Z' }
      ];

      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat
        .mockResolvedValue({ isFile: () => true, mtime: new Date(), size: 100 } as any);
      
      mockFs.readJSON
        .mockResolvedValueOnce(mockResponses[0])
        .mockResolvedValueOnce(mockResponses[1])
        .mockResolvedValueOnce(mockResponses[2]);

      const { responses } = await optimizer.getResponseFiles(responsesDir, {
        sortByTime: true,
        limit: 2
      });

      expect(responses).toHaveLength(2);
      // Should be sorted by timestamp (most recent first)
      expect(responses[0].id).toBe(3);
      expect(responses[1].id).toBe(2);
    });

    it('should filter responses by time window', async () => {
      const responsesDir = '/test/responses';
      const now = Date.now();
      const mockFiles = ['recent.json', 'old.json'];
      const mockStats = new Map([
        ['recent.json', { isFile: () => true, mtime: new Date(now - 30000), size: 100 } as any], // 30 seconds ago
        ['old.json', { isFile: () => true, mtime: new Date(now - 120000), size: 100 } as any] // 2 minutes ago
      ]);

      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('recent.json'))
        .mockResolvedValueOnce(mockStats.get('old.json'));

      mockFs.readJSON.mockResolvedValueOnce({ id: 1, recent: true });

      const { responses } = await optimizer.getResponseFiles(responsesDir, {
        sinceMinutes: 1 // 1 minute window
      });

      // Should only include the recent file
      expect(responses).toHaveLength(1);
      expect(responses[0].recent).toBe(true);
    });
  });

  describe('Batch File Cleanup', () => {
    it('should batch delete files based on predicate', async () => {
      const testDir = '/test/cleanup';
      const mockFiles = ['keep.json', 'delete1.json', 'delete2.json'];
      const mockStats = new Map([
        ['keep.json', { isFile: () => true, mtime: new Date(), size: 100 } as any],
        ['delete1.json', { isFile: () => true, mtime: new Date(Date.now() - 100000), size: 50 } as any],
        ['delete2.json', { isFile: () => true, mtime: new Date(Date.now() - 200000), size: 75 } as any]
      ]);

      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('keep.json'))
        .mockResolvedValueOnce(mockStats.get('delete1.json'))
        .mockResolvedValueOnce(mockStats.get('delete2.json'));

      mockFs.remove
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const cutoffTime = Date.now() - 50000; // 50 seconds ago
      const { deleted, errors } = await optimizer.batchFileCleanup(
        testDir,
        (file, stats) => stats.mtime.getTime() < cutoffTime
      );

      expect(deleted).toEqual(['delete1.json', 'delete2.json']);
      expect(errors).toHaveLength(0);
      expect(mockFs.remove).toHaveBeenCalledTimes(2);
      expect(mockFs.remove).toHaveBeenCalledWith(path.join(testDir, 'delete1.json'));
      expect(mockFs.remove).toHaveBeenCalledWith(path.join(testDir, 'delete2.json'));
    });

    it('should handle deletion errors gracefully', async () => {
      const testDir = '/test/cleanup';
      const mockFiles = ['delete-fail.json'];
      const mockStats = new Map([
        ['delete-fail.json', { isFile: () => true, mtime: new Date(0), size: 100 } as any]
      ]);

      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat.mockResolvedValueOnce(mockStats.get('delete-fail.json'));
      mockFs.remove.mockRejectedValueOnce(new Error('Permission denied'));

      const { deleted, errors } = await optimizer.batchFileCleanup(
        testDir,
        () => true
      );

      expect(deleted).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].file).toBe('delete-fail.json');
      expect(errors[0].error.message).toBe('Permission denied');
    });
  });

  describe('Cache Management', () => {
    it('should provide cache statistics', () => {
      const stats = optimizer.getCacheStats();
      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('maxSize');
      expect(typeof stats.entries).toBe('number');
      expect(typeof stats.maxSize).toBe('number');
    });

    it('should clear cache for specific directory', async () => {
      const testDir = '/test/cache';
      
      mockFs.readdir.mockResolvedValueOnce(['file1.json'] as any);
      mockFs.stat.mockResolvedValueOnce({ isFile: () => true, mtime: new Date(), size: 100 } as any);

      // Populate cache
      await optimizer.getCachedDirectoryListing(testDir);
      expect(optimizer.getCacheStats().entries).toBe(1);

      // Clear specific directory cache
      optimizer.clearCache(testDir);
      expect(optimizer.getCacheStats().entries).toBe(0);
    });

    it('should clear all cache', async () => {
      const testDir1 = '/test/cache1';
      const testDir2 = '/test/cache2';
      
      mockFs.readdir.mockResolvedValue(['file1.json'] as any);
      mockFs.stat.mockResolvedValue({ isFile: () => true, mtime: new Date(), size: 100 } as any);

      // Populate cache with multiple directories
      await optimizer.getCachedDirectoryListing(testDir1);
      await optimizer.getCachedDirectoryListing(testDir2);
      expect(optimizer.getCacheStats().entries).toBe(2);

      // Clear all cache
      optimizer.clearCache();
      expect(optimizer.getCacheStats().entries).toBe(0);
    });
  });

  describe('Global Optimizer', () => {
    afterEach(() => {
      destroyFsOptimizer();
    });

    it('should provide singleton instance', () => {
      const optimizer1 = getFsOptimizer();
      const optimizer2 = getFsOptimizer();
      expect(optimizer1).toBe(optimizer2);
    });

    it('should destroy global instance', () => {
      const optimizer1 = getFsOptimizer();
      destroyFsOptimizer();
      const optimizer2 = getFsOptimizer();
      expect(optimizer1).not.toBe(optimizer2);
    });
  });
});
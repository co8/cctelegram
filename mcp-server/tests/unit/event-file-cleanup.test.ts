/**
 * Event File Cleanup Automator Tests
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { EventFileCleanupAutomator, CleanupPolicy, CleanupSchedule, DEFAULT_CLEANUP_POLICIES } from '../../src/utils/event-file-cleanup.js';
import { FileSystemOptimizer } from '../../src/utils/fs-optimizer.js';

// Mock dependencies
jest.mock('../../src/security.js', () => ({
  secureLog: jest.fn()
}));

describe('EventFileCleanupAutomator', () => {
  let automator: EventFileCleanupAutomator;
  let mockFsOptimizer: jest.Mocked<FileSystemOptimizer>;
  let testDir: string;
  
  beforeEach(async () => {
    // Create mock file system optimizer
    mockFsOptimizer = {
      getFilteredFiles: jest.fn(),
      batchFileCleanup: jest.fn(),
      getCachedDirectoryListing: jest.fn(),
      clearCache: jest.fn(),
      destroy: jest.fn(),
      getCacheStats: jest.fn(),
      batchReadJSON: jest.fn(),
      batchPathExists: jest.fn(),
      getResponseFiles: jest.fn()
    } as any;
    
    automator = new EventFileCleanupAutomator(mockFsOptimizer);
    testDir = path.join(__dirname, 'test-cleanup');
    
    // Setup mock responses
    mockFsOptimizer.getFilteredFiles.mockResolvedValue({
      files: [],
      fileStats: new Map()
    });
    
    mockFsOptimizer.batchFileCleanup.mockResolvedValue({
      deleted: [],
      errors: []
    });
  });
  
  afterEach(async () => {
    await automator.stop();
    jest.clearAllMocks();
  });

  describe('Policy Management', () => {
    it('should add cleanup policy successfully', () => {
      const policy: CleanupPolicy = {
        filePatterns: ['*.json'],
        maxAge: {
          enabled: true,
          thresholdMs: 24 * 60 * 60 * 1000,
          deleteOlderThan: 1
        },
        batchSize: 50,
        dryRun: false,
        preserveMostRecent: 5
      };
      
      expect(() => {
        automator.addCleanupPolicy(testDir, policy);
      }).not.toThrow();
      
      const status = automator.getStatus();
      expect(status.policies).toBe(1);
    });
    
    it('should validate cleanup policy requirements', () => {
      const invalidPolicy: CleanupPolicy = {
        filePatterns: [], // Empty patterns should fail
        batchSize: 50,
        dryRun: false,
        preserveMostRecent: 5
      };
      
      expect(() => {
        automator.addCleanupPolicy(testDir, invalidPolicy);
      }).toThrow('Cleanup policy must specify file patterns');
    });
    
    it('should validate age policy thresholds', () => {
      const invalidPolicy: CleanupPolicy = {
        filePatterns: ['*.json'],
        maxAge: {
          enabled: true,
          thresholdMs: -1000, // Negative threshold
          deleteOlderThan: 1
        },
        batchSize: 50,
        dryRun: false,
        preserveMostRecent: 5
      };
      
      expect(() => {
        automator.addCleanupPolicy(testDir, invalidPolicy);
      }).toThrow('Age policy thresholds must be positive');
    });
    
    it('should remove cleanup policy successfully', () => {
      const policy = DEFAULT_CLEANUP_POLICIES.eventFiles;
      
      automator.addCleanupPolicy(testDir, policy);
      expect(automator.getStatus().policies).toBe(1);
      
      automator.removeCleanupPolicy(testDir);
      expect(automator.getStatus().policies).toBe(0);
    });
  });

  describe('Cleanup Execution', () => {
    beforeEach(() => {
      const policy = {
        ...DEFAULT_CLEANUP_POLICIES.eventFiles,
        preserveMostRecent: 0  // Don't preserve any files for testing
      };
      automator.addCleanupPolicy(testDir, policy);
    });
    
    it('should execute age-based cleanup', async () => {
      const now = Date.now();
      const oldTime = now - (25 * 60 * 60 * 1000); // 25 hours ago
      const recentTime = now - (1 * 60 * 60 * 1000); // 1 hour ago
      
      const mockFiles = ['old-file.json', 'recent-file.json'];
      const mockStats = new Map([
        ['old-file.json', { 
          size: 1000, 
          mtime: new Date(oldTime),
          isFile: () => true 
        } as any],
        ['recent-file.json', { 
          size: 2000, 
          mtime: new Date(recentTime),
          isFile: () => true 
        } as any]
      ]);
      
      // Initial call should return both files
      mockFsOptimizer.getFilteredFiles.mockResolvedValueOnce({
        files: mockFiles,
        fileStats: mockStats
      });
      
      // Second call (after cleanup) should return only remaining files
      mockFsOptimizer.getFilteredFiles.mockResolvedValueOnce({
        files: ['recent-file.json'],
        fileStats: new Map([
          ['recent-file.json', { 
            size: 2000, 
            mtime: new Date(recentTime),
            isFile: () => true 
          } as any]
        ])
      });
      
      // Mock batchFileCleanup to simulate actual deletion based on filter
      mockFsOptimizer.batchFileCleanup.mockImplementation(async (directory, filter, batchSize) => {
        const filesToDelete = mockFiles.filter((file) => {
          const stats = mockStats.get(file);
          return stats ? filter(file, stats) : false;
        });
        
        // Simulate file deletion by removing from mock stats
        filesToDelete.forEach(file => {
          mockFiles.splice(mockFiles.indexOf(file), 1);
          mockStats.delete(file);
        });
        
        return {
          deleted: filesToDelete,
          errors: []
        };
      });
      
      const result = await automator.runCleanup(testDir);
      
      expect(result.processed.deleted).toBe(1);
      expect(result.spaceSaved).toBeGreaterThan(0);
      expect(mockFsOptimizer.batchFileCleanup).toHaveBeenCalledWith(
        testDir,
        expect.any(Function),
        50 // batch size
      );
    });
    
    it('should execute size-based cleanup', async () => {
      const policy: CleanupPolicy = {
        filePatterns: ['*.json'],
        maxSize: {
          enabled: true,
          thresholdBytes: 5000, // 5KB threshold
          targetSizeBytes: 2000  // 2KB target
        },
        batchSize: 50,
        dryRun: false,
        preserveMostRecent: 2
      };
      
      automator.addCleanupPolicy(testDir + '-size', policy);
      
      const mockFiles = ['large1.json', 'large2.json', 'small.json'];
      const mockStats = new Map([
        ['large1.json', { 
          size: 3000, 
          mtime: new Date(Date.now() - 3000),
          isFile: () => true 
        } as any],
        ['large2.json', { 
          size: 2500, 
          mtime: new Date(Date.now() - 2000),
          isFile: () => true 
        } as any],
        ['small.json', { 
          size: 500, 
          mtime: new Date(Date.now() - 1000),
          isFile: () => true 
        } as any]
      ]);
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: mockFiles,
        fileStats: mockStats
      });
      
      mockFsOptimizer.batchFileCleanup.mockResolvedValue({
        deleted: ['large1.json'],
        errors: []
      });
      
      const result = await automator.runCleanup(testDir + '-size');
      
      expect(result.processed.deleted).toBe(1);
      expect(mockFsOptimizer.batchFileCleanup).toHaveBeenCalled();
    });
    
    it('should execute count-based cleanup', async () => {
      const policy: CleanupPolicy = {
        filePatterns: ['*.json'],
        maxCount: {
          enabled: true,
          maxFiles: 3,
          targetCount: 2
        },
        batchSize: 50,
        dryRun: false,
        preserveMostRecent: 1
      };
      
      automator.addCleanupPolicy(testDir + '-count', policy);
      
      const mockFiles = ['file1.json', 'file2.json', 'file3.json', 'file4.json'];
      const mockStats = new Map([
        ['file1.json', { 
          size: 1000, 
          mtime: new Date(Date.now() - 4000),
          isFile: () => true 
        } as any],
        ['file2.json', { 
          size: 1000, 
          mtime: new Date(Date.now() - 3000),
          isFile: () => true 
        } as any],
        ['file3.json', { 
          size: 1000, 
          mtime: new Date(Date.now() - 2000),
          isFile: () => true 
        } as any],
        ['file4.json', { 
          size: 1000, 
          mtime: new Date(Date.now() - 1000),
          isFile: () => true 
        } as any]
      ]);
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: mockFiles,
        fileStats: mockStats
      });
      
      mockFsOptimizer.batchFileCleanup.mockResolvedValue({
        deleted: ['file1.json', 'file2.json'],
        errors: []
      });
      
      const result = await automator.runCleanup(testDir + '-count');
      
      expect(result.processed.deleted).toBe(2);
    });
    
    it('should preserve most recent files', async () => {
      const policy: CleanupPolicy = {
        filePatterns: ['*.json'],
        maxAge: {
          enabled: true,
          thresholdMs: 1000, // Very short threshold
          deleteOlderThan: 0.001
        },
        batchSize: 50,
        dryRun: false,
        preserveMostRecent: 2 // Keep 2 most recent
      };
      
      automator.addCleanupPolicy(testDir + '-preserve', policy);
      
      const now = Date.now();
      const mockFiles = ['old1.json', 'old2.json', 'recent1.json', 'recent2.json'];
      const mockStats = new Map([
        ['old1.json', { 
          size: 1000, 
          mtime: new Date(now - 10000),
          isFile: () => true 
        } as any],
        ['old2.json', { 
          size: 1000, 
          mtime: new Date(now - 8000),
          isFile: () => true 
        } as any],
        ['recent1.json', { 
          size: 1000, 
          mtime: new Date(now - 2000),
          isFile: () => true 
        } as any],
        ['recent2.json', { 
          size: 1000, 
          mtime: new Date(now - 1000),
          isFile: () => true 
        } as any]
      ]);
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: mockFiles,
        fileStats: mockStats
      });
      
      mockFsOptimizer.batchFileCleanup.mockResolvedValue({
        deleted: ['old1.json', 'old2.json'],
        errors: []
      });
      
      const result = await automator.runCleanup(testDir + '-preserve');
      
      expect(result.processed.deleted).toBe(2);
      // Verify the predicate function preserves recent files
      const cleanupCall = mockFsOptimizer.batchFileCleanup.mock.calls[0];
      const predicate = cleanupCall[1] as Function;
      
      expect(predicate('old1.json')).toBe(true);
      expect(predicate('old2.json')).toBe(true);
      expect(predicate('recent1.json')).toBe(false);
      expect(predicate('recent2.json')).toBe(false);
    });
    
    it('should handle dry run mode', async () => {
      const policy: CleanupPolicy = {
        filePatterns: ['*.json'],
        maxAge: {
          enabled: true,
          thresholdMs: 1000,
          deleteOlderThan: 0.001
        },
        batchSize: 50,
        dryRun: true, // Dry run mode
        preserveMostRecent: 0
      };
      
      automator.addCleanupPolicy(testDir + '-dryrun', policy);
      
      const mockFiles = ['old-file.json'];
      const mockStats = new Map([
        ['old-file.json', { 
          size: 1000, 
          mtime: new Date(Date.now() - 10000),
          isFile: () => true 
        } as any]
      ]);
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: mockFiles,
        fileStats: mockStats
      });
      
      const result = await automator.runCleanup(testDir + '-dryrun');
      
      expect(result.dryRun).toBe(true);
      expect(result.processed.deleted).toBe(0); // No files actually deleted
      expect(result.processed.eligible).toBe(1); // But files were eligible
      expect(mockFsOptimizer.batchFileCleanup).not.toHaveBeenCalled();
    });
    
    it('should handle cleanup errors gracefully', async () => {
      mockFsOptimizer.batchFileCleanup.mockResolvedValue({
        deleted: ['file1.json'],
        errors: [
          { file: 'file2.json', error: new Error('Permission denied') }
        ]
      });
      
      const mockFiles = ['file1.json', 'file2.json'];
      const mockStats = new Map([
        ['file1.json', { 
          size: 1000, 
          mtime: new Date(Date.now() - 25 * 60 * 60 * 1000),
          isFile: () => true 
        } as any],
        ['file2.json', { 
          size: 1000, 
          mtime: new Date(Date.now() - 25 * 60 * 60 * 1000),
          isFile: () => true 
        } as any]
      ]);
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: mockFiles,
        fileStats: mockStats
      });
      
      const result = await automator.runCleanup(testDir);
      
      expect(result.processed.deleted).toBe(1);
      expect(result.processed.errors).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].file).toBe('file2.json');
      expect(result.errors[0].error).toBe('Permission denied');
    });
    
    it('should prevent concurrent runs for same directory', async () => {
      const policy = DEFAULT_CLEANUP_POLICIES.eventFiles;
      const schedule: CleanupSchedule = {
        enabled: true,
        intervalMs: 60000,
        runOnStart: false,
        maxConcurrentRuns: 1
      };
      
      automator.addCleanupPolicy(testDir + '-concurrent', policy, schedule);
      
      // Mock a slow cleanup
      mockFsOptimizer.getFilteredFiles.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ files: [], fileStats: new Map() }), 1000))
      );
      
      // Start first cleanup
      const firstCleanup = automator.runCleanup(testDir + '-concurrent');
      
      // Try to start second cleanup immediately
      await expect(automator.runCleanup(testDir + '-concurrent'))
        .rejects.toThrow('Cleanup already running');
      
      // Wait for first cleanup to finish
      await firstCleanup;
    });
  });

  describe('Scheduling', () => {
    it('should start and stop automator', async () => {
      expect(automator.getStatus().isStarted).toBe(false);
      
      await automator.start();
      expect(automator.getStatus().isStarted).toBe(true);
      
      await automator.stop();
      expect(automator.getStatus().isStarted).toBe(false);
    });
    
    it('should schedule cleanup with proper intervals', (done) => {
      const policy = DEFAULT_CLEANUP_POLICIES.eventFiles;
      const schedule: CleanupSchedule = {
        enabled: true,
        intervalMs: 100, // Very short interval for testing
        runOnStart: false,
        maxConcurrentRuns: 1
      };
      
      automator.addCleanupPolicy(testDir + '-schedule', policy, schedule);
      
      let cleanupCount = 0;
      automator.on('cleanup_completed', () => {
        cleanupCount++;
        if (cleanupCount >= 2) {
          automator.stop().then(() => done());
        }
      });
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: [],
        fileStats: new Map()
      });
      
      automator.start();
    });
    
    it('should run cleanup on start if configured', async () => {
      const policy = DEFAULT_CLEANUP_POLICIES.eventFiles;
      const schedule: CleanupSchedule = {
        enabled: true,
        intervalMs: 60000,
        runOnStart: true,
        maxConcurrentRuns: 1
      };
      
      automator.addCleanupPolicy(testDir + '-onstart', policy, schedule);
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: [],
        fileStats: new Map()
      });
      
      const cleanupPromise = new Promise<void>((resolve) => {
        automator.once('cleanup_completed', () => resolve());
      });
      
      await automator.start();
      await cleanupPromise;
      
      expect(mockFsOptimizer.getFilteredFiles).toHaveBeenCalled();
    });
  });

  describe('Directory Statistics', () => {
    beforeEach(() => {
      const policy = DEFAULT_CLEANUP_POLICIES.eventFiles;
      automator.addCleanupPolicy(testDir, policy);
    });
    
    it('should calculate directory statistics', async () => {
      const now = Date.now();
      const mockFiles = ['file1.json', 'file2.json', 'file3.json'];
      const mockStats = new Map([
        ['file1.json', { 
          size: 1000, 
          mtime: new Date(now - 3000),
          isFile: () => true 
        } as any],
        ['file2.json', { 
          size: 2000, 
          mtime: new Date(now - 2000),
          isFile: () => true 
        } as any],
        ['file3.json', { 
          size: 500, 
          mtime: new Date(now - 1000),
          isFile: () => true 
        } as any]
      ]);
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: mockFiles,
        fileStats: mockStats
      });
      
      const stats = await automator.getDirectoryStats(testDir);
      
      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSize).toBe(3500);
      expect(stats.oldestFile).toBe('file1.json');
      expect(stats.newestFile).toBe('file3.json');
      expect(stats.largestFile.name).toBe('file2.json');
      expect(stats.largestFile.size).toBe(2000);
    });
    
    it('should handle empty directory', async () => {
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: [],
        fileStats: new Map()
      });
      
      const stats = await automator.getDirectoryStats(testDir);
      
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.oldestFile).toBeNull();
      expect(stats.newestFile).toBeNull();
      expect(stats.largestFile.name).toBe('');
      expect(stats.largestFile.size).toBe(0);
    });
  });

  describe('History Management', () => {
    beforeEach(() => {
      const policy = DEFAULT_CLEANUP_POLICIES.eventFiles;
      automator.addCleanupPolicy(testDir, policy);
    });
    
    it('should maintain cleanup history', async () => {
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: [],
        fileStats: new Map()
      });
      
      await automator.runCleanup(testDir);
      await automator.runCleanup(testDir);
      
      const history = automator.getCleanupHistory();
      expect(history).toHaveLength(2);
      
      expect(history[0].timestamp).toBeLessThanOrEqual(history[1].timestamp);
    });
    
    it('should limit history entries', async () => {
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: [],
        fileStats: new Map()
      });
      
      // Run many cleanups to test history limit
      for (let i = 0; i < 105; i++) {
        await automator.runCleanup(testDir);
      }
      
      const history = automator.getCleanupHistory();
      expect(history.length).toBeLessThanOrEqual(100); // Max history entries
    });
  });

  describe('Event Emission', () => {
    it('should emit events for lifecycle operations', async () => {
      const events: string[] = [];
      
      automator.on('started', () => events.push('started'));
      automator.on('stopped', () => events.push('stopped'));
      automator.on('cleanup_completed', () => events.push('cleanup_completed'));
      
      await automator.start();
      await automator.stop();
      
      expect(events).toContain('started');
      expect(events).toContain('stopped');
    });
    
    it('should emit cleanup completion events', async () => {
      const policy = DEFAULT_CLEANUP_POLICIES.eventFiles;
      automator.addCleanupPolicy(testDir, policy);
      
      mockFsOptimizer.getFilteredFiles.mockResolvedValue({
        files: [],
        fileStats: new Map()
      });
      
      const completionEvents: any[] = [];
      automator.on('cleanup_completed', (result) => completionEvents.push(result));
      
      await automator.runCleanup(testDir);
      
      expect(completionEvents).toHaveLength(1);
      expect(completionEvents[0]).toHaveProperty('timestamp');
      expect(completionEvents[0]).toHaveProperty('duration');
      expect(completionEvents[0]).toHaveProperty('processed');
    });
  });

  describe('Default Policies', () => {
    it('should provide valid default event file policy', () => {
      const policy = DEFAULT_CLEANUP_POLICIES.eventFiles;
      
      expect(() => {
        automator.addCleanupPolicy(testDir, policy);
      }).not.toThrow();
      
      expect(policy.filePatterns).toContain('*.json');
      expect(policy.maxAge?.enabled).toBe(true);
      expect(policy.maxSize?.enabled).toBe(true);
      expect(policy.maxCount?.enabled).toBe(true);
    });
    
    it('should provide valid default log file policy', () => {
      const policy = DEFAULT_CLEANUP_POLICIES.logFiles;
      
      expect(() => {
        automator.addCleanupPolicy(testDir, policy);
      }).not.toThrow();
      
      expect(policy.filePatterns).toContain('*.log');
      expect(policy.maxAge?.enabled).toBe(true);
      expect(policy.maxSize?.enabled).toBe(true);
    });
    
    it('should provide valid default temp file policy', () => {
      const policy = DEFAULT_CLEANUP_POLICIES.tempFiles;
      
      expect(() => {
        automator.addCleanupPolicy(testDir, policy);
      }).not.toThrow();
      
      expect(policy.filePatterns).toContain('*.tmp');
      expect(policy.maxAge?.enabled).toBe(true);
      expect(policy.preserveMostRecent).toBe(0);
    });
  });
});
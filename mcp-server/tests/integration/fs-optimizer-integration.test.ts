/**
 * Integration tests for File System Optimizer with Bridge Client
 * Validates that optimized file operations work correctly in real scenarios
 */

import { CCTelegramBridgeClient } from '../../src/bridge-client.js';
import { getFsOptimizer, destroyFsOptimizer } from '../../src/utils/fs-optimizer.js';
import fs from 'fs-extra';
import path from 'path';
import { jest } from '@jest/globals';

// Mock fs-extra
jest.mock('fs-extra');
const mockFs = jest.mocked(fs);

// Mock axios
jest.mock('axios');

describe('File System Optimizer Integration with Bridge Client', () => {
  let bridgeClient: CCTelegramBridgeClient;
  let testResponsesDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    bridgeClient = new CCTelegramBridgeClient();
    testResponsesDir = '/tmp/test-responses';
    
    // Set up test environment
    Object.defineProperty(bridgeClient, 'responsesDir', {
      value: testResponsesDir,
      writable: false
    });
  });

  afterEach(() => {
    destroyFsOptimizer();
  });

  describe('Optimized Response File Operations', () => {
    it('should use batched operations in getTelegramResponses()', async () => {
      const mockFiles = [
        'response-1.json',
        'response-2.json', 
        'response-3.json',
        'readme.txt' // Should be filtered out
      ];

      const mockResponses = [
        { 
          id: 'response-1', 
          timestamp: '2023-01-03T10:00:00Z',
          user_id: 123,
          message: 'Response 1'
        },
        { 
          id: 'response-2', 
          timestamp: '2023-01-02T10:00:00Z',
          user_id: 124,
          message: 'Response 2'
        },
        { 
          id: 'response-3', 
          timestamp: '2023-01-01T10:00:00Z',
          user_id: 125,
          message: 'Response 3'
        }
      ];

      const mockStats = new Map([
        ['response-1.json', { isFile: () => true, mtime: new Date('2023-01-03'), size: 100 } as any],
        ['response-2.json', { isFile: () => true, mtime: new Date('2023-01-02'), size: 150 } as any],
        ['response-3.json', { isFile: () => true, mtime: new Date('2023-01-01'), size: 120 } as any],
        ['readme.txt', { isFile: () => true, mtime: new Date('2023-01-01'), size: 50 } as any]
      ]);

      // Mock directory operations
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      
      // Mock stat calls for all files
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('response-1.json'))
        .mockResolvedValueOnce(mockStats.get('response-2.json'))
        .mockResolvedValueOnce(mockStats.get('response-3.json'))
        .mockResolvedValueOnce(mockStats.get('readme.txt'));

      // Mock JSON reads for only .json files
      mockFs.readJSON
        .mockResolvedValueOnce(mockResponses[0])
        .mockResolvedValueOnce(mockResponses[1])
        .mockResolvedValueOnce(mockResponses[2]);

      const responses = await bridgeClient.getTelegramResponses();

      // Verify optimized behavior
      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
      expect(mockFs.stat).toHaveBeenCalledTimes(4);
      expect(mockFs.readJSON).toHaveBeenCalledTimes(3);

      // Verify results are sorted by timestamp (most recent first)
      expect(responses).toHaveLength(3);
      expect(responses[0].id).toBe('response-1');
      expect(responses[1].id).toBe('response-2');
      expect(responses[2].id).toBe('response-3');
    });

    it('should use batched cleanup in clearOldResponses()', async () => {
      const now = Date.now();
      const oldCutoff = now - (25 * 60 * 60 * 1000); // 25 hours ago
      
      const mockFiles = [
        'recent-response.json',
        'old-response-1.json',
        'old-response-2.json',
        'very-old-response.json'
      ];

      const mockStats = new Map([
        ['recent-response.json', { isFile: () => true, mtime: new Date(now - 1000), size: 100 } as any],
        ['old-response-1.json', { isFile: () => true, mtime: new Date(oldCutoff - 1000), size: 150 } as any],
        ['old-response-2.json', { isFile: () => true, mtime: new Date(oldCutoff - 2000), size: 120 } as any],
        ['very-old-response.json', { isFile: () => true, mtime: new Date(oldCutoff - 10000), size: 80 } as any]
      ]);

      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('recent-response.json'))
        .mockResolvedValueOnce(mockStats.get('old-response-1.json'))
        .mockResolvedValueOnce(mockStats.get('old-response-2.json'))
        .mockResolvedValueOnce(mockStats.get('very-old-response.json'));

      // Mock successful deletions
      mockFs.remove
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const deletedCount = await bridgeClient.clearOldResponses(24); // 24 hours

      // Should delete 3 old files (all except recent-response.json)
      expect(deletedCount).toBe(3);
      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
      expect(mockFs.stat).toHaveBeenCalledTimes(4);
      expect(mockFs.remove).toHaveBeenCalledTimes(3);
    });

    it('should use optimized file operations in processPendingResponses()', async () => {
      const now = Date.now();
      const recentTime = now - (5 * 60 * 1000); // 5 minutes ago
      
      const mockFiles = [
        'approval-response.json',
        'denial-response.json',
        'old-response.json',
        'regular-response.json'
      ];

      const mockResponses = [
        {
          response_type: 'callback_query',
          callback_data: 'approve_task_123',
          user_id: 456,
          username: 'approver',
          timestamp: new Date(recentTime).toISOString()
        },
        {
          response_type: 'callback_query',
          callback_data: 'deny_task_456',
          user_id: 789,
          username: 'denier',
          timestamp: new Date(recentTime + 1000).toISOString()
        },
        {
          response_type: 'message',
          user_id: 999,
          message: 'Old response',
          timestamp: new Date(now - (20 * 60 * 1000)).toISOString() // 20 minutes ago
        },
        {
          response_type: 'message',
          user_id: 111,
          message: 'Regular response',
          timestamp: new Date(recentTime + 2000).toISOString()
        }
      ];

      const mockStats = new Map([
        ['approval-response.json', { isFile: () => true, mtime: new Date(recentTime), size: 200 } as any],
        ['denial-response.json', { isFile: () => true, mtime: new Date(recentTime + 1000), size: 180 } as any],
        ['old-response.json', { isFile: () => true, mtime: new Date(now - (20 * 60 * 1000)), size: 100 } as any],
        ['regular-response.json', { isFile: () => true, mtime: new Date(recentTime + 2000), size: 120 } as any]
      ]);

      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('approval-response.json'))
        .mockResolvedValueOnce(mockStats.get('denial-response.json'))
        .mockResolvedValueOnce(mockStats.get('old-response.json'))
        .mockResolvedValueOnce(mockStats.get('regular-response.json'));

      mockFs.readJSON
        .mockResolvedValueOnce(mockResponses[0])
        .mockResolvedValueOnce(mockResponses[1])
        .mockResolvedValueOnce(mockResponses[3]); // Skip old response due to time filter

      const result = await bridgeClient.processPendingResponses(10); // 10 minutes window

      // Verify optimized file operations
      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
      expect(mockFs.stat).toHaveBeenCalledTimes(4);
      expect(mockFs.readJSON).toHaveBeenCalledTimes(3); // Only recent files

      // Verify results
      expect(result.summary.total_recent_responses).toBe(3);
      expect(result.summary.actionable_responses).toBe(2);
      expect(result.summary.pending_approvals).toBe(1);
      expect(result.summary.pending_denials).toBe(1);
      
      expect(result.actionable_responses).toHaveLength(2);
      expect(result.actionable_responses[0].action).toBe('approve');
      expect(result.actionable_responses[0].task_id).toBe('task_123');
      expect(result.actionable_responses[1].action).toBe('deny');
      expect(result.actionable_responses[1].task_id).toBe('task_456');
    });
  });

  describe('Cache Performance Benefits', () => {
    it('should reuse cached directory listings for multiple operations', async () => {
      const mockFiles = ['response1.json', 'response2.json'];
      const mockStats = new Map([
        ['response1.json', { isFile: () => true, mtime: new Date(), size: 100 } as any],
        ['response2.json', { isFile: () => true, mtime: new Date(), size: 150 } as any]
      ]);

      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce(mockStats.get('response1.json'))
        .mockResolvedValueOnce(mockStats.get('response2.json'));

      mockFs.readJSON
        .mockResolvedValue({ id: 1, test: true });

      // First operation
      await bridgeClient.getTelegramResponses();
      
      // Second operation should use cached directory listing
      await bridgeClient.clearOldResponses(24);

      // Directory should only be read once due to caching
      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
      expect(mockFs.stat).toHaveBeenCalledTimes(2); // Initial stats for cache population
    });

    it('should handle file system errors gracefully in optimized operations', async () => {
      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.readdir.mockRejectedValueOnce(new Error('Permission denied'));

      // Should not throw but return empty results
      const responses = await bridgeClient.getTelegramResponses();
      expect(responses).toEqual([]);

      const deletedCount = await bridgeClient.clearOldResponses(24);
      expect(deletedCount).toBe(0);
    });
  });

  describe('Batch Path Existence Optimization', () => {
    it('should optimize task status checks with batched path existence', async () => {
      const projectPath = '/test/project';
      const possibleTodoPaths = [
        path.join(projectPath, '.claude', 'todos.json'),
        path.join('/tmp', '.claude', 'todos.json'),
        path.join(projectPath, '.cc_todos.json')
      ];

      // Mock batch path existence check
      mockFs.pathExists
        .mockResolvedValueOnce(false) // First path doesn't exist
        .mockResolvedValueOnce(true)  // Second path exists
        .mockResolvedValueOnce(false); // Third path doesn't exist

      // Mock successful JSON read for the existing path
      mockFs.readJSON.mockResolvedValueOnce([
        { id: 1, status: 'pending', content: 'Test task 1' },
        { id: 2, status: 'completed', content: 'Test task 2' }
      ]);

      const taskStatus = await bridgeClient.getTaskStatus(projectPath, 'claude-code');

      // Verify batch path existence was used
      expect(mockFs.pathExists).toHaveBeenCalledTimes(3);
      expect(mockFs.readJSON).toHaveBeenCalledTimes(1);
      expect(mockFs.readJSON).toHaveBeenCalledWith(possibleTodoPaths[1]);

      // Verify task status results
      expect(taskStatus.claude_code_tasks.available).toBe(true);
      expect(taskStatus.claude_code_tasks.total_count).toBe(2);
      expect(taskStatus.claude_code_tasks.summary.pending).toBe(1);
      expect(taskStatus.claude_code_tasks.summary.completed).toBe(1);
    });
  });

  describe('Performance Comparison', () => {
    it('should demonstrate performance improvements with large file sets', async () => {
      const fileCount = 100;
      const mockFiles = Array.from({ length: fileCount }, (_, i) => `response-${i}.json`);
      const mockStats = new Map();
      const mockResponses = [];

      // Generate mock data
      for (let i = 0; i < fileCount; i++) {
        const fileName = `response-${i}.json`;
        mockStats.set(fileName, {
          isFile: () => true,
          mtime: new Date(Date.now() - (i * 1000)),
          size: 100 + i
        } as any);
        mockResponses.push({
          id: i,
          timestamp: new Date(Date.now() - (i * 1000)).toISOString(),
          message: `Response ${i}`
        });
      }

      mockFs.ensureDir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      
      // Mock all stat calls
      for (const [fileName, stat] of mockStats) {
        mockFs.stat.mockResolvedValueOnce(stat);
      }

      // Mock all JSON reads
      mockResponses.forEach(response => {
        mockFs.readJSON.mockResolvedValueOnce(response);
      });

      const startTime = Date.now();
      const responses = await bridgeClient.getTelegramResponses();
      const endTime = Date.now();

      // Verify all files were processed
      expect(responses).toHaveLength(fileCount);
      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
      expect(mockFs.stat).toHaveBeenCalledTimes(fileCount);
      expect(mockFs.readJSON).toHaveBeenCalledTimes(fileCount);

      // Should complete quickly due to batching (in test environment)
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second

      // Verify responses are sorted correctly
      expect(responses[0].id).toBe(0); // Most recent
      expect(responses[fileCount - 1].id).toBe(fileCount - 1); // Oldest
    });
  });
});
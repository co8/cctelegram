/**
 * File System Mock Utilities
 * Provides comprehensive mocking for fs-extra operations
 */

import { jest } from '@jest/globals';

/**
 * Mock file system state
 */
export interface MockFileSystem {
  files: Map<string, any>;
  directories: Set<string>;
  stats: Map<string, { mtime: Date; size: number; isDirectory: boolean }>;
}

/**
 * Create a new mock file system
 */
export function createMockFileSystem(): MockFileSystem {
  return {
    files: new Map(),
    directories: new Set(),
    stats: new Map()
  };
}

/**
 * Setup fs-extra mocks with comprehensive functionality
 */
export function setupFsMocks(mockFs: MockFileSystem = createMockFileSystem()) {
  const fsMocks = {
    // Directory operations
    ensureDir: jest.fn().mockImplementation(async (dirPath: string) => {
      mockFs.directories.add(dirPath);
      mockFs.stats.set(dirPath, {
        mtime: new Date(),
        size: 0,
        isDirectory: true
      });
    }),
    
    // File reading operations
    readJson: jest.fn().mockImplementation(async (filePath: string) => {
      if (!mockFs.files.has(filePath)) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      }
      return mockFs.files.get(filePath);
    }),
    
    readFile: jest.fn().mockImplementation(async (filePath: string) => {
      if (!mockFs.files.has(filePath)) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      }
      const data = mockFs.files.get(filePath);
      return typeof data === 'string' ? data : JSON.stringify(data);
    }),
    
    // File writing operations
    writeJson: jest.fn().mockImplementation(async (filePath: string, data: any, options?: any) => {
      mockFs.files.set(filePath, data);
      mockFs.stats.set(filePath, {
        mtime: new Date(),
        size: JSON.stringify(data).length,
        isDirectory: false
      });
    }),
    
    writeFile: jest.fn().mockImplementation(async (filePath: string, data: string) => {
      mockFs.files.set(filePath, data);
      mockFs.stats.set(filePath, {
        mtime: new Date(),
        size: data.length,
        isDirectory: false
      });
    }),
    
    // Directory listing
    readdir: jest.fn().mockImplementation(async (dirPath: string) => {
      const files: string[] = [];
      
      for (const [filePath] of mockFs.files) {
        const fileName = filePath.split('/').pop();
        const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
        
        if (fileDir === dirPath && fileName) {
          files.push(fileName);
        }
      }
      
      for (const dir of mockFs.directories) {
        const dirName = dir.split('/').pop();
        const parentDir = dir.substring(0, dir.lastIndexOf('/'));
        
        if (parentDir === dirPath && dirName) {
          files.push(dirName);
        }
      }
      
      return files.sort();
    }),
    
    // File/directory existence
    pathExists: jest.fn().mockImplementation(async (path: string) => {
      return mockFs.files.has(path) || mockFs.directories.has(path);
    }),
    
    existsSync: jest.fn().mockImplementation((path: string) => {
      return mockFs.files.has(path) || mockFs.directories.has(path);
    }),
    
    // File stats
    stat: jest.fn().mockImplementation(async (path: string) => {
      if (!mockFs.stats.has(path)) {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      }
      
      const stats = mockFs.stats.get(path)!;
      return {
        ...stats,
        isFile: () => !stats.isDirectory,
        isDirectory: () => stats.isDirectory
      };
    }),
    
    // File removal
    remove: jest.fn().mockImplementation(async (path: string) => {
      mockFs.files.delete(path);
      mockFs.directories.delete(path);
      mockFs.stats.delete(path);
    }),
    
    unlink: jest.fn().mockImplementation(async (path: string) => {
      if (!mockFs.files.has(path)) {
        throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      }
      mockFs.files.delete(path);
      mockFs.stats.delete(path);
    }),
    
    // File copying and moving
    copy: jest.fn().mockImplementation(async (src: string, dest: string) => {
      if (!mockFs.files.has(src)) {
        throw new Error(`ENOENT: no such file or directory, open '${src}'`);
      }
      const data = mockFs.files.get(src);
      mockFs.files.set(dest, data);
      mockFs.stats.set(dest, { ...mockFs.stats.get(src)! });
    }),
    
    move: jest.fn().mockImplementation(async (src: string, dest: string) => {
      if (!mockFs.files.has(src)) {
        throw new Error(`ENOENT: no such file or directory, open '${src}'`);
      }
      const data = mockFs.files.get(src);
      const stats = mockFs.stats.get(src);
      
      mockFs.files.set(dest, data);
      if (stats) {
        mockFs.stats.set(dest, stats);
      }
      
      mockFs.files.delete(src);
      mockFs.stats.delete(src);
    })
  };
  
  return { fsMocks, mockFs };
}

/**
 * Add file to mock file system
 */
export function addMockFile(mockFs: MockFileSystem, filePath: string, data: any) {
  mockFs.files.set(filePath, data);
  mockFs.stats.set(filePath, {
    mtime: new Date(),
    size: typeof data === 'string' ? data.length : JSON.stringify(data).length,
    isDirectory: false
  });
}

/**
 * Add directory to mock file system  
 */
export function addMockDirectory(mockFs: MockFileSystem, dirPath: string) {
  mockFs.directories.add(dirPath);
  mockFs.stats.set(dirPath, {
    mtime: new Date(),
    size: 0,
    isDirectory: true
  });
}

/**
 * Set file modification time for testing
 */
export function setMockFileTime(mockFs: MockFileSystem, filePath: string, mtime: Date) {
  const stats = mockFs.stats.get(filePath);
  if (stats) {
    stats.mtime = mtime;
  }
}

/**
 * Simulate file system errors
 */
export function setupFsErrors(fsMocks: any) {
  return {
    makeReadJsonFail: (filePath: string, error: Error) => {
      fsMocks.readJson.mockImplementation(async (path: string) => {
        if (path === filePath) {
          throw error;
        }
        return {};
      });
    },
    
    makeWriteJsonFail: (filePath: string, error: Error) => {
      fsMocks.writeJson.mockImplementation(async (path: string, data: any) => {
        if (path === filePath) {
          throw error;
        }
      });
    },
    
    makeReaddirFail: (dirPath: string, error: Error) => {
      fsMocks.readdir.mockImplementation(async (path: string) => {
        if (path === dirPath) {
          throw error;
        }
        return [];
      });
    },
    
    makeEnsureDirFail: (dirPath: string, error: Error) => {
      fsMocks.ensureDir.mockImplementation(async (path: string) => {
        if (path === dirPath) {
          throw error;
        }
      });
    },
    
    makeRemoveFail: (filePath: string, error: Error) => {
      fsMocks.remove.mockImplementation(async (path: string) => {
        if (path === filePath) {
          throw error;
        }
      });
    }
  };
}

/**
 * Create file system scenario for testing
 */
export function createFsScenario(scenario: 'empty' | 'with_files' | 'permission_error' | 'disk_full') {
  const mockFs = createMockFileSystem();
  const { fsMocks } = setupFsMocks(mockFs);
  
  switch (scenario) {
    case 'empty':
      // Already empty by default
      break;
      
    case 'with_files':
      addMockDirectory(mockFs, '/tmp/test-events');
      addMockDirectory(mockFs, '/tmp/test-responses');
      addMockFile(mockFs, '/tmp/test-events/event-001.json', {
        type: 'task_completion',
        title: 'Test Event',
        description: 'Test event description'
      });
      addMockFile(mockFs, '/tmp/test-responses/response-001.json', {
        id: 'response-001',
        user_id: 123456789,
        message: 'Test response',
        timestamp: '2025-08-05T10:00:00.000Z'
      });
      break;
      
    case 'permission_error':
      const permissionError = new Error('EACCES: permission denied');
      setupFsErrors(fsMocks).makeWriteJsonFail('/tmp/test-events', permissionError);
      setupFsErrors(fsMocks).makeEnsureDirFail('/tmp/test-events', permissionError);
      break;
      
    case 'disk_full':
      const diskFullError = new Error('ENOSPC: no space left on device');
      setupFsErrors(fsMocks).makeWriteJsonFail('/tmp/test-events', diskFullError);
      break;
  }
  
  return { fsMocks, mockFs };
}
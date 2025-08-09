/**
 * File System Mock Implementation
 * Mock for fs-extra operations used in bridge client and security modules
 */

import { jest } from '@jest/globals';
import path from 'path';

export interface MockFileSystem {
  [path: string]: string | Buffer | MockFileSystem;
}

export class MockFS {
  private static instance: MockFS;
  private fileSystem: MockFileSystem = {};
  private shouldFail = false;
  private failureReason = 'ENOENT: no such file or directory';

  static getInstance(): MockFS {
    if (!MockFS.instance) {
      MockFS.instance = new MockFS();
    }
    return MockFS.instance;
  }

  // Configuration methods
  setShouldFail(fail: boolean, reason = 'ENOENT: no such file or directory'): void {
    this.shouldFail = fail;
    this.failureReason = reason;
  }

  // Mock file system setup
  setFile(filePath: string, content: string | Buffer): void {
    const normalizedPath = path.normalize(filePath);
    this.fileSystem[normalizedPath] = content;
  }

  setJSON(filePath: string, data: any): void {
    this.setFile(filePath, JSON.stringify(data, null, 2));
  }

  createDirectory(dirPath: string): void {
    const normalizedPath = path.normalize(dirPath);
    this.fileSystem[normalizedPath] = {};
  }

  removeFile(filePath: string): void {
    const normalizedPath = path.normalize(filePath);
    delete this.fileSystem[normalizedPath];
  }

  // Reset mock
  reset(): void {
    this.fileSystem = {};
    this.shouldFail = false;
    this.failureReason = 'ENOENT: no such file or directory';
  }

  // Get current file system state
  getFileSystem(): MockFileSystem {
    return { ...this.fileSystem };
  }

  // Mock implementations
  async pathExists(filePath: string): Promise<boolean> {
    if (this.shouldFail) return false;
    const normalizedPath = path.normalize(filePath);
    return normalizedPath in this.fileSystem;
  }

  existsSync(filePath: string): boolean {
    if (this.shouldFail) return false;
    const normalizedPath = path.normalize(filePath);
    return normalizedPath in this.fileSystem;
  }

  async readJSON(filePath: string): Promise<any> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    const content = await this.readFile(filePath, 'utf8');
    return JSON.parse(content as string);
  }

  async writeJSON(filePath: string, data: any, options?: any): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    const spaces = options?.spaces || 2;
    const content = JSON.stringify(data, null, spaces);
    await this.writeFile(filePath, content);
  }

  async readFile(filePath: string, encoding?: string): Promise<string | Buffer> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    const normalizedPath = path.normalize(filePath);
    const content = this.fileSystem[normalizedPath];

    if (content === undefined || typeof content === 'object') {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }

    if (encoding === 'utf8' && Buffer.isBuffer(content)) {
      return content.toString('utf8');
    }

    return content;
  }

  async writeFile(filePath: string, data: string | Buffer): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    const normalizedPath = path.normalize(filePath);
    this.fileSystem[normalizedPath] = data;
  }

  async ensureDir(dirPath: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    this.createDirectory(dirPath);
  }

  async emptyDir(dirPath: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    const normalizedPath = path.normalize(dirPath);
    // Remove all files in directory
    Object.keys(this.fileSystem).forEach(filePath => {
      if (filePath.startsWith(normalizedPath + path.sep)) {
        delete this.fileSystem[filePath];
      }
    });
  }

  async remove(filePath: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    this.removeFile(filePath);
  }

  async readdir(dirPath: string): Promise<string[]> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    const normalizedPath = path.normalize(dirPath);
    const files: string[] = [];

    Object.keys(this.fileSystem).forEach(filePath => {
      if (filePath.startsWith(normalizedPath + path.sep)) {
        const relativePath = path.relative(normalizedPath, filePath);
        const pathParts = relativePath.split(path.sep);
        if (pathParts.length === 1) {
          files.push(pathParts[0]);
        }
      }
    });

    return files;
  }

  async stat(filePath: string): Promise<any> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    const normalizedPath = path.normalize(filePath);
    if (!(normalizedPath in this.fileSystem)) {
      throw new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
    }

    const content = this.fileSystem[normalizedPath];
    const isDirectory = typeof content === 'object';
    const size = isDirectory ? 0 : (typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.length);

    return {
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
      size,
      mtime: new Date(),
      ctime: new Date(),
      atime: new Date()
    };
  }
}

// Create and configure the mock
export const mockFS = MockFS.getInstance();

// Jest mock setup
const fsMock = {
  pathExists: jest.fn().mockImplementation((filePath: string) => mockFS.pathExists(filePath)),
  existsSync: jest.fn().mockImplementation((filePath: string) => mockFS.existsSync(filePath)),
  readJSON: jest.fn().mockImplementation((filePath: string) => mockFS.readJSON(filePath)),
  writeJSON: jest.fn().mockImplementation((filePath: string, data: any, options?: any) => mockFS.writeJSON(filePath, data, options)),
  readFile: jest.fn().mockImplementation((filePath: string, encoding?: string) => mockFS.readFile(filePath, encoding)),
  writeFile: jest.fn().mockImplementation((filePath: string, data: string | Buffer) => mockFS.writeFile(filePath, data)),
  ensureDir: jest.fn().mockImplementation((dirPath: string) => mockFS.ensureDir(dirPath)),
  emptyDir: jest.fn().mockImplementation((dirPath: string) => mockFS.emptyDir(dirPath)),
  remove: jest.fn().mockImplementation((filePath: string) => mockFS.remove(filePath)),
  readdir: jest.fn().mockImplementation((dirPath: string) => mockFS.readdir(dirPath)),
  stat: jest.fn().mockImplementation((filePath: string) => mockFS.stat(filePath))
};

export default fsMock;
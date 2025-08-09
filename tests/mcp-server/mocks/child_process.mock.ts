/**
 * Child Process Mock Implementation
 * Mock for spawn, exec, and other child process operations used in bridge management
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

export interface MockProcessResult {
  stdout: string;
  stderr: string;
  code: number;
  signal?: string;
}

export class MockChildProcess extends EventEmitter {
  public pid: number;
  public killed = false;
  public exitCode: number | null = null;
  public signalCode: string | null = null;

  constructor(public command: string, public args: string[] = []) {
    super();
    this.pid = Math.floor(Math.random() * 10000) + 1000;
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.signalCode = signal || 'SIGTERM';
    this.exitCode = null;
    
    // Simulate async process termination
    setTimeout(() => {
      this.emit('exit', null, this.signalCode);
    }, 10);
    
    return true;
  }

  unref(): void {
    // Mock implementation
  }

  disconnect(): void {
    // Mock implementation
  }
}

export class MockChildProcessManager {
  private static instance: MockChildProcessManager;
  private processes = new Map<number, MockChildProcess>();
  private execResults = new Map<string, MockProcessResult>();
  private shouldFail = false;
  private failureReason = 'Command failed';
  private bridgeProcessRunning = false;

  static getInstance(): MockChildProcessManager {
    if (!MockChildProcessManager.instance) {
      MockChildProcessManager.instance = new MockChildProcessManager();
    }
    return MockChildProcessManager.instance;
  }

  // Configuration methods
  setShouldFail(fail: boolean, reason = 'Command failed'): void {
    this.shouldFail = fail;
    this.failureReason = reason;
  }

  setBridgeProcessRunning(running: boolean): void {
    this.bridgeProcessRunning = running;
  }

  // Mock command results
  setExecResult(command: string, result: Partial<MockProcessResult>): void {
    this.execResults.set(command, {
      stdout: '',
      stderr: '',
      code: 0,
      ...result
    });
  }

  // Pre-configure common commands
  setupCommonCommands(): void {
    // Bridge process check commands
    this.setExecResult('pgrep -f cctelegram-bridge', {
      stdout: this.bridgeProcessRunning ? '1234\n' : '',
      stderr: '',
      code: this.bridgeProcessRunning ? 0 : 1
    });

    this.setExecResult('which cctelegram-bridge', {
      stdout: this.bridgeProcessRunning ? '/usr/local/bin/cctelegram-bridge\n' : '',
      stderr: this.bridgeProcessRunning ? '' : 'cctelegram-bridge: not found',
      code: this.bridgeProcessRunning ? 0 : 1
    });

    // Kill commands
    this.setExecResult(/^kill \d+$/, {
      stdout: '',
      stderr: '',
      code: 0
    });

    this.setExecResult(/^kill -9 \d+$/, {
      stdout: '',
      stderr: '',
      code: 0
    });
  }

  // Get running processes
  getRunningProcesses(): MockChildProcess[] {
    return Array.from(this.processes.values()).filter(p => !p.killed);
  }

  // Reset all mocks
  reset(): void {
    this.processes.clear();
    this.execResults.clear();
    this.shouldFail = false;
    this.failureReason = 'Command failed';
    this.bridgeProcessRunning = false;
    this.setupCommonCommands();
  }

  // Mock spawn implementation
  spawn(command: string, args: string[] = [], options: any = {}): MockChildProcess {
    if (this.shouldFail) {
      const proc = new MockChildProcess(command, args);
      setTimeout(() => {
        proc.emit('error', new Error(this.failureReason));
      }, 10);
      return proc;
    }

    const proc = new MockChildProcess(command, args);
    this.processes.set(proc.pid, proc);

    // Handle special commands
    if (command.includes('cctelegram-bridge')) {
      // Simulate bridge startup
      setTimeout(() => {
        this.bridgeProcessRunning = true;
        this.setupCommonCommands();
        proc.emit('spawn');
      }, 100);
    }

    // Handle detached processes
    if (options.detached) {
      setTimeout(() => {
        proc.emit('spawn');
        // Don't emit exit for detached processes
      }, 10);
    } else {
      setTimeout(() => {
        proc.exitCode = 0;
        proc.emit('exit', 0, null);
      }, 100);
    }

    return proc;
  }

  // Mock exec implementation
  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    // Find matching result (support regex patterns)
    let result: MockProcessResult | undefined;
    
    for (const [pattern, mockResult] of this.execResults.entries()) {
      if (typeof pattern === 'string' && pattern === command) {
        result = mockResult;
        break;
      } else if (pattern instanceof RegExp && pattern.test(command)) {
        result = mockResult;
        break;
      }
    }

    if (!result) {
      result = {
        stdout: '',
        stderr: `Command not found: ${command}`,
        code: 127
      };
    }

    if (result.code !== 0) {
      const error = new Error(`Command failed: ${command}`) as any;
      error.code = result.code;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      throw error;
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
}

// Create and configure the mock
export const mockChildProcess = MockChildProcessManager.getInstance();

// Set up common commands by default
mockChildProcess.setupCommonCommands();

// Jest mock setup
const childProcessMock = {
  spawn: jest.fn().mockImplementation((command: string, args: string[], options: any) => 
    mockChildProcess.spawn(command, args, options)
  ),
  exec: jest.fn().mockImplementation((command: string, callback: Function) => {
    mockChildProcess.exec(command)
      .then(result => callback(null, result.stdout, result.stderr))
      .catch(error => callback(error));
  }),
  execSync: jest.fn(),
  fork: jest.fn(),
  spawnSync: jest.fn()
};

// Promisified exec mock
export const execAsyncMock = jest.fn().mockImplementation((command: string) => 
  mockChildProcess.exec(command)
);

export default childProcessMock;
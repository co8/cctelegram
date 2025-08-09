/**
 * Process Mock Utilities
 * Provides comprehensive mocking for child_process operations
 */

import { jest } from '@jest/globals';

/**
 * Mock child process structure
 */
export interface MockChildProcess {
  pid?: number;
  kill: jest.MockedFunction<any>;
  on: jest.MockedFunction<any>;
  stdout: {
    on: jest.MockedFunction<any>;
    pipe?: jest.MockedFunction<any>;
  };
  stderr: {
    on: jest.MockedFunction<any>;
    pipe?: jest.MockedFunction<any>;
  };
  unref?: jest.MockedFunction<any>;
  disconnect?: jest.MockedFunction<any>;
}

/**
 * Create a mock child process
 */
export function createMockChildProcess(options: {
  pid?: number;
  exitCode?: number;
  signal?: string;
  error?: Error;
  stdout?: string;
  stderr?: string;
} = {}): MockChildProcess {
  const mockProcess: MockChildProcess = {
    pid: options.pid ?? 12345,
    kill: jest.fn().mockReturnValue(true),
    on: jest.fn(),
    stdout: {
      on: jest.fn(),
      pipe: jest.fn()
    },
    stderr: {
      on: jest.fn(),
      pipe: jest.fn()
    },
    unref: jest.fn(),
    disconnect: jest.fn()
  };
  
  // Setup event handlers
  mockProcess.on.mockImplementation((event: string, callback: Function) => {
    switch (event) {
      case 'exit':
        if (options.exitCode !== undefined || options.signal) {
          setTimeout(() => callback(options.exitCode ?? null, options.signal ?? null), 100);
        }
        break;
        
      case 'error':
        if (options.error) {
          setTimeout(() => callback(options.error), 50);
        }
        break;
        
      case 'spawn':
        if (!options.error) {
          setTimeout(() => callback(), 10);
        }
        break;
    }
    
    return mockProcess;
  });
  
  // Setup stdout handlers
  if (options.stdout) {
    mockProcess.stdout.on.mockImplementation((event: string, callback: Function) => {
      if (event === 'data') {
        setTimeout(() => callback(Buffer.from(options.stdout!)), 50);
      }
      return mockProcess.stdout;
    });
  }
  
  // Setup stderr handlers
  if (options.stderr) {
    mockProcess.stderr.on.mockImplementation((event: string, callback: Function) => {
      if (event === 'data') {
        setTimeout(() => callback(Buffer.from(options.stderr!)), 50);
      }
      return mockProcess.stderr;
    });
  }
  
  return mockProcess;
}

/**
 * Setup child_process mocks
 */
export function setupProcessMocks() {
  const processMocks = {
    spawn: jest.fn(),
    exec: jest.fn(),
    execSync: jest.fn(),
    fork: jest.fn()
  };
  
  return processMocks;
}

/**
 * Setup spawn mock scenarios
 */
export function setupSpawnScenarios(processMocks: any) {
  return {
    // Successful process start
    mockSuccessfulSpawn: (options: { pid?: number; stdout?: string; stderr?: string } = {}) => {
      const mockProcess = createMockChildProcess({
        pid: options.pid ?? 12345,
        exitCode: 0,
        stdout: options.stdout,
        stderr: options.stderr
      });
      
      processMocks.spawn.mockReturnValue(mockProcess);
      return mockProcess;
    },
    
    // Failed process start (ENOENT)
    mockFailedSpawn: (error: Error = new Error('spawn ENOENT')) => {
      const mockProcess = createMockChildProcess({
        error,
        exitCode: 1
      });
      
      processMocks.spawn.mockReturnValue(mockProcess);
      return mockProcess;
    },
    
    // Process that exits with error code
    mockExitWithError: (exitCode: number = 1, stderr?: string) => {
      const mockProcess = createMockChildProcess({
        pid: 12345,
        exitCode,
        stderr: stderr ?? `Process exited with code ${exitCode}`
      });
      
      processMocks.spawn.mockReturnValue(mockProcess);
      return mockProcess;
    },
    
    // Process that is killed by signal
    mockKilledProcess: (signal: string = 'SIGTERM') => {
      const mockProcess = createMockChildProcess({
        pid: 12345,
        signal
      });
      
      processMocks.spawn.mockReturnValue(mockProcess);
      return mockProcess;
    },
    
    // Long-running process for timeout testing
    mockLongRunningProcess: () => {
      const mockProcess = createMockChildProcess({
        pid: 12345
        // Don't emit exit event to simulate long-running process
      });
      
      // Override on to not emit exit automatically
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        // Only emit spawn event, not exit
        if (event === 'spawn') {
          setTimeout(() => callback(), 10);
        }
        return mockProcess;
      });
      
      processMocks.spawn.mockReturnValue(mockProcess);
      return mockProcess;
    }
  };
}

/**
 * Setup exec mock scenarios
 */
export function setupExecScenarios(processMocks: any) {
  return {
    // Successful exec
    mockSuccessfulExec: (stdout: string = '', stderr: string = '') => {
      processMocks.exec.mockImplementation((command: string, callback: Function) => {
        setTimeout(() => callback(null, stdout, stderr), 50);
      });
    },
    
    // Failed exec
    mockFailedExec: (error: Error) => {
      processMocks.exec.mockImplementation((command: string, callback: Function) => {
        setTimeout(() => callback(error, '', error.message), 50);
      });
    },
    
    // Exec with timeout
    mockExecTimeout: () => {
      processMocks.exec.mockImplementation((command: string, callback: Function) => {
        // Don't call callback to simulate timeout
      });
    },
    
    // Exec for process lookup (ps aux)
    mockProcessLookup: (processes: Array<{ pid: number; command: string }>) => {
      processMocks.exec.mockImplementation((command: string, callback: Function) => {
        if (command.includes('ps aux') || command.includes('pgrep')) {
          const output = processes
            .map(proc => `${proc.pid} ${proc.command}`)
            .join('\n');
          setTimeout(() => callback(null, output, ''), 50);
        } else {
          setTimeout(() => callback(new Error('Command not found'), '', 'Command not found'), 50);
        }
      });
    }
  };
}

/**
 * Create bridge process scenarios
 */
export function createBridgeProcessScenarios(processMocks: any) {
  const spawnScenarios = setupSpawnScenarios(processMocks);
  const execScenarios = setupExecScenarios(processMocks);
  
  return {
    // Bridge starts successfully
    bridgeStartSuccess: () => {
      return spawnScenarios.mockSuccessfulSpawn({
        pid: 12345,
        stdout: 'Bridge server started on port 3000'
      });
    },
    
    // Bridge fails to start (port in use)
    bridgeStartPortInUse: () => {
      return spawnScenarios.mockExitWithError(1, 'Error: Port 3000 is already in use');
    },
    
    // Bridge binary not found
    bridgeBinaryNotFound: () => {
      return spawnScenarios.mockFailedSpawn(new Error('spawn bridge ENOENT'));
    },
    
    // Bridge process lookup success
    bridgeProcessFound: (pid: number = 12345) => {
      execScenarios.mockProcessLookup([
        { pid, command: 'node bridge.js' }
      ]);
    },
    
    // Bridge process not found
    bridgeProcessNotFound: () => {
      execScenarios.mockProcessLookup([]);
    },
    
    // Multiple bridge processes found
    multipleBridgeProcesses: () => {
      execScenarios.mockProcessLookup([
        { pid: 12345, command: 'node bridge.js' },
        { pid: 12346, command: 'node bridge.js' }
      ]);
    },
    
    // Bridge stops successfully
    bridgeStopSuccess: () => {
      execScenarios.mockSuccessfulExec('Process 12345 terminated', '');
    },
    
    // Bridge stop fails (process not found)
    bridgeStopProcessNotFound: () => {
      execScenarios.mockFailedExec(new Error('No such process'));
    }
  };
}

/**
 * Setup environment variable mocks
 */
export function setupEnvironmentMocks(envVars: { [key: string]: string } = {}) {
  const originalEnv = process.env;
  
  beforeEach(() => {
    process.env = { ...originalEnv, ...envVars };
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  return {
    setEnvVar: (key: string, value: string) => {
      process.env[key] = value;
    },
    
    unsetEnvVar: (key: string) => {
      delete process.env[key];
    },
    
    getEnvVar: (key: string) => process.env[key],
    
    resetEnv: () => {
      process.env = { ...originalEnv, ...envVars };
    }
  };
}

/**
 * Create timeout helpers for testing
 */
export function createTimeoutHelpers() {
  return {
    // Wait for a specified time
    wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
    
    // Wait for a condition to be true
    waitFor: async (condition: () => boolean, timeoutMs: number = 5000, intervalMs: number = 100) => {
      const start = Date.now();
      
      while (Date.now() - start < timeoutMs) {
        if (condition()) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
      
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    },
    
    // Create a timeout promise that rejects
    timeout: (ms: number, message: string = 'Operation timed out') => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
      });
    }
  };
}
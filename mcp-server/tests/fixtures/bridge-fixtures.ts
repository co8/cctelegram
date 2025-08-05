/**
 * Bridge Status Test Fixtures
 * Provides pre-built bridge status objects for testing bridge management
 */

import { BridgeStatus } from '../../src/types.js';

/**
 * Healthy bridge status
 */
export const HEALTHY_BRIDGE_STATUS: BridgeStatus = {
  success: true,
  status: 'running',
  uptime: 3600, // 1 hour
  version: '0.6.0',
  last_activity: '2025-08-05T10:00:00.000Z',
  health_check: {
    telegram_connection: true,
    file_system_access: true,
    memory_usage: 45.2,
    cpu_usage: 12.8
  }
};

/**
 * Bridge status with warnings
 */
export const WARNING_BRIDGE_STATUS: BridgeStatus = {
  success: true,
  status: 'running',
  uptime: 86400, // 24 hours
  version: '0.6.0',
  last_activity: '2025-08-05T09:30:00.000Z',
  health_check: {
    telegram_connection: true,
    file_system_access: true,
    memory_usage: 78.5, // High memory usage
    cpu_usage: 45.2     // High CPU usage
  },
  warnings: [
    'High memory usage detected',
    'No activity in last 30 minutes'
  ]
};

/**
 * Bridge status with errors
 */
export const ERROR_BRIDGE_STATUS: BridgeStatus = {
  success: false,
  status: 'error',
  uptime: 120,
  version: '0.6.0',
  last_activity: '2025-08-05T08:00:00.000Z',
  error: 'Failed to connect to Telegram API',
  health_check: {
    telegram_connection: false,
    file_system_access: true,
    memory_usage: 32.1,
    cpu_usage: 8.5
  },
  errors: [
    'Telegram API authentication failed',
    'Rate limit exceeded'
  ]
};

/**
 * Bridge status when stopped
 */
export const STOPPED_BRIDGE_STATUS: BridgeStatus = {
  success: false,
  status: 'stopped',
  uptime: 0,
  version: '0.6.0',
  last_activity: '2025-08-05T09:45:00.000Z',
  error: 'Bridge process not running'
};

/**
 * Bridge status when starting
 */
export const STARTING_BRIDGE_STATUS: BridgeStatus = {
  success: true,
  status: 'starting',
  uptime: 15,
  version: '0.6.0',
  last_activity: '2025-08-05T10:00:00.000Z',
  health_check: {
    telegram_connection: false, // Still connecting
    file_system_access: true,
    memory_usage: 25.3,
    cpu_usage: 15.7
  }
};

/**
 * Bridge status with connection timeout
 */
export const TIMEOUT_BRIDGE_STATUS: BridgeStatus = {
  success: false,
  status: 'timeout',
  error: 'Connection timeout - bridge may be unresponsive',
  uptime: 0,
  version: 'unknown',
  last_activity: null
};

/**
 * Process management responses
 */
export const PROCESS_RESPONSES = {
  START_SUCCESS: {
    success: true,
    message: 'Bridge started successfully',
    pid: 12345,
    status: 'running'
  },
  
  START_FAILURE: {
    success: false,
    message: 'Failed to start bridge process',
    error: 'Port 3000 already in use'
  },
  
  STOP_SUCCESS: {
    success: true,
    message: 'Bridge stopped successfully',
    pid: null,
    status: 'stopped'
  },
  
  STOP_FAILURE: {
    success: false,
    message: 'Failed to stop bridge process',
    error: 'Process not found'
  },
  
  RESTART_SUCCESS: {
    success: true,
    message: 'Bridge restarted successfully',
    old_pid: 12345,
    new_pid: 12346,
    status: 'running'
  },
  
  ENSURE_RUNNING_STARTED: {
    success: true,
    message: 'Bridge was not running and has been started',
    action: 'started',
    pid: 12347,
    status: 'running'
  },
  
  ENSURE_RUNNING_ALREADY: {
    success: true,
    message: 'Bridge is already running',
    action: 'none',
    pid: 12345,
    status: 'running'
  }
};

/**
 * HTTP response mocks for bridge status endpoints
 */
export const HTTP_RESPONSES = {
  HEALTHY: {
    status: 200,
    data: {
      status: 'running',
      uptime: 3600,
      version: '0.6.0',
      last_activity: '2025-08-05T10:00:00.000Z',
      health: {
        telegram_connection: true,
        file_system_access: true,
        memory_usage: 45.2,
        cpu_usage: 12.8
      }
    }
  },
  
  ERROR: {
    status: 500,
    data: {
      status: 'error',
      error: 'Internal server error',
      uptime: 120,
      version: '0.6.0'
    }
  },
  
  TIMEOUT: new Error('Request timeout'),
  
  CONNECTION_REFUSED: new Error('Connection refused'),
  
  NOT_FOUND: {
    status: 404,
    data: {
      error: 'Bridge status endpoint not found'
    }
  }
};

/**
 * Child process mock objects
 */
export const CHILD_PROCESS_MOCKS = {
  SUCCESSFUL: {
    pid: 12345,
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
    unref: jest.fn()
  },
  
  FAILED: {
    pid: undefined,
    kill: jest.fn().mockReturnValue(false),
    on: jest.fn().mockImplementation((event, callback) => {
      if (event === 'error') {
        setTimeout(() => callback(new Error('spawn ENOENT')), 100);
      }
    }),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() }
  }
};
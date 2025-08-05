/**
 * HTTP Mock Utilities
 * Provides comprehensive mocking for axios HTTP operations
 */

import { jest } from '@jest/globals';

/**
 * HTTP response mock structure
 */
export interface HttpResponseMock {
  status: number;
  statusText?: string;
  data: any;
  headers?: { [key: string]: string };
}

/**
 * HTTP error mock structure
 */
export interface HttpErrorMock {
  code?: string;
  message: string;
  response?: {
    status: number;
    data: any;
  };
}

/**
 * Setup axios mocks with comprehensive functionality
 */
export function setupHttpMocks() {
  const axiosMocks = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    request: jest.fn(),
    create: jest.fn().mockReturnThis(),
    defaults: {
      timeout: 5000,
      headers: {}
    }
  };
  
  return axiosMocks;
}

/**
 * Create successful HTTP response
 */
export function createHttpResponse(data: any, status: number = 200): HttpResponseMock {
  return {
    status,
    statusText: getStatusText(status),
    data,
    headers: {
      'content-type': 'application/json',
      'date': new Date().toUTCString()
    }
  };
}

/**
 * Create HTTP error
 */
export function createHttpError(message: string, code?: string, status?: number): HttpErrorMock {
  const error: HttpErrorMock = {
    message,
    code
  };
  
  if (status) {
    error.response = {
      status,
      data: { error: message }
    };
  }
  
  return error;
}

/**
 * Get status text for HTTP status codes
 */
function getStatusText(status: number): string {
  const statusTexts: { [key: number]: string } = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };
  
  return statusTexts[status] || 'Unknown';
}

/**
 * Setup bridge status endpoint mocks
 */
export function setupBridgeMocks(axiosMocks: any) {
  return {
    // Healthy bridge response
    mockHealthyBridge: () => {
      axiosMocks.get.mockResolvedValue(createHttpResponse({
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
      }));
    },
    
    // Bridge with warnings
    mockWarningBridge: () => {
      axiosMocks.get.mockResolvedValue(createHttpResponse({
        status: 'running',
        uptime: 86400,
        version: '0.6.0',
        last_activity: '2025-08-05T09:30:00.000Z',
        health: {
          telegram_connection: true,
          file_system_access: true,
          memory_usage: 78.5,
          cpu_usage: 45.2
        },
        warnings: [
          'High memory usage detected',
          'No activity in last 30 minutes'
        ]
      }));
    },
    
    // Bridge error response
    mockErrorBridge: () => {
      axiosMocks.get.mockResolvedValue(createHttpResponse({
        status: 'error',
        uptime: 120,
        version: '0.6.0',
        last_activity: '2025-08-05T08:00:00.000Z',
        error: 'Failed to connect to Telegram API',
        health: {
          telegram_connection: false,
          file_system_access: true,
          memory_usage: 32.1,
          cpu_usage: 8.5
        },
        errors: [
          'Telegram API authentication failed',
          'Rate limit exceeded'
        ]
      }, 500));
    },
    
    // Connection timeout
    mockTimeoutError: () => {
      axiosMocks.get.mockRejectedValue(createHttpError('Request timeout', 'ECONNABORTED'));
    },
    
    // Connection refused
    mockConnectionRefused: () => {
      axiosMocks.get.mockRejectedValue(createHttpError('Connection refused', 'ECONNREFUSED'));
    },
    
    // Not found error
    mockNotFound: () => {
      axiosMocks.get.mockResolvedValue(createHttpResponse({
        error: 'Bridge status endpoint not found'
      }, 404));
    },
    
    // Network error
    mockNetworkError: () => {
      axiosMocks.get.mockRejectedValue(createHttpError('Network Error', 'ERR_NETWORK'));
    }
  };
}

/**
 * Setup sequential responses for testing retry logic
 */
export function setupSequentialResponses(axiosMocks: any, responses: (HttpResponseMock | HttpErrorMock)[]) {
  const mockImplementation = jest.fn();
  
  responses.forEach((response, index) => {
    if ('status' in response) {
      // It's a successful response
      mockImplementation.mockImplementationOnce(() => Promise.resolve(response));
    } else {
      // It's an error
      mockImplementation.mockImplementationOnce(() => Promise.reject(response));
    }
  });
  
  axiosMocks.get.mockImplementation(mockImplementation);
  return mockImplementation;
}

/**
 * Setup URL-based response mapping
 */
export function setupUrlBasedResponses(axiosMocks: any, urlMap: { [url: string]: HttpResponseMock | HttpErrorMock }) {
  axiosMocks.get.mockImplementation(async (url: string) => {
    const response = urlMap[url];
    
    if (!response) {
      throw createHttpError(`No mock response configured for URL: ${url}`, 'MOCK_CONFIG_ERROR');
    }
    
    if ('status' in response) {
      return response;
    } else {
      throw response;
    }
  });
}

/**
 * Create delay mock for testing timeouts
 */
export function createDelayedResponse(response: HttpResponseMock | HttpErrorMock, delayMs: number) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if ('status' in response) {
        resolve(response);
      } else {
        reject(response);
      }
    }, delayMs);
  });
}

/**
 * Setup request tracking for testing
 */
export function setupRequestTracking(axiosMocks: any) {
  const requestLog: Array<{
    method: string;
    url: string;
    data?: any;
    timestamp: Date;
  }> = [];
  
  const originalGet = axiosMocks.get;
  const originalPost = axiosMocks.post;
  const originalPut = axiosMocks.put;
  const originalDelete = axiosMocks.delete;
  
  axiosMocks.get.mockImplementation(async (url: string, config?: any) => {
    requestLog.push({ method: 'GET', url, timestamp: new Date() });
    return originalGet(url, config);
  });
  
  axiosMocks.post.mockImplementation(async (url: string, data?: any, config?: any) => {
    requestLog.push({ method: 'POST', url, data, timestamp: new Date() });
    return originalPost(url, data, config);
  });
  
  axiosMocks.put.mockImplementation(async (url: string, data?: any, config?: any) => {
    requestLog.push({ method: 'PUT', url, data, timestamp: new Date() });
    return originalPut(url, data, config);
  });
  
  axiosMocks.delete.mockImplementation(async (url: string, config?: any) => {
    requestLog.push({ method: 'DELETE', url, timestamp: new Date() });
    return originalDelete(url, config);
  });
  
  return {
    getRequestLog: () => [...requestLog],
    clearRequestLog: () => requestLog.length = 0,
    getRequestCount: () => requestLog.length,
    getLastRequest: () => requestLog[requestLog.length - 1] ?? null
  };
}
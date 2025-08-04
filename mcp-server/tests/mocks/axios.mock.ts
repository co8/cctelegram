/**
 * Axios Mock Implementation
 * Comprehensive mock for HTTP requests used in bridge communications
 */

import { jest } from '@jest/globals';
import { AxiosResponse } from 'axios';

export interface MockAxiosResponse {
  data: any;
  status: number;
  statusText: string;
  headers: any;
  config: any;
}

export class MockAxios {
  private static instance: MockAxios;
  private responses = new Map<string, MockAxiosResponse>();
  private networkDelay = 0;
  private shouldFail = false;
  private failureReason = 'Network Error';

  static getInstance(): MockAxios {
    if (!MockAxios.instance) {
      MockAxios.instance = new MockAxios();
    }
    return MockAxios.instance;
  }

  // Configuration methods
  setNetworkDelay(delay: number): void {
    this.networkDelay = delay;
  }

  setShouldFail(fail: boolean, reason = 'Network Error'): void {
    this.shouldFail = fail;
    this.failureReason = reason;
  }

  // Mock response setup
  mockGet(url: string, response: Partial<MockAxiosResponse>): void {
    this.responses.set(`GET:${url}`, {
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
      ...response
    });
  }

  mockPost(url: string, response: Partial<MockAxiosResponse>): void {
    this.responses.set(`POST:${url}`, {
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
      ...response
    });
  }

  // Health endpoint mock
  mockHealthEndpoint(healthy = true): void {
    const healthData = healthy ? {
      status: 'healthy',
      uptime: 3600,
      last_event_time: new Date().toISOString()
    } : {
      status: 'unhealthy',
      error: 'Service unavailable'
    };

    this.mockGet('http://localhost:8080/health', {
      data: healthData,
      status: healthy ? 200 : 503
    });
  }

  // Metrics endpoint mock
  mockMetricsEndpoint(metrics?: any): void {
    const defaultMetrics = `
# HELP process_uptime_seconds Process uptime in seconds
process_uptime_seconds 3600

# HELP events_processed_total Total events processed
events_processed_total 150

# HELP telegram_messages_sent_total Total Telegram messages sent
telegram_messages_sent_total 145

# HELP errors_total Total errors encountered
errors_total 2

# HELP memory_usage_bytes Memory usage in bytes
memory_usage_bytes 52428800

# HELP cpu_usage_percent CPU usage percentage
cpu_usage_percent 15.5
`;

    this.mockGet('http://localhost:8080/metrics', {
      data: metrics || defaultMetrics,
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  // Reset all mocks
  reset(): void {
    this.responses.clear();
    this.networkDelay = 0;
    this.shouldFail = false;
    this.failureReason = 'Network Error';
  }

  // Mock implementation
  async get(url: string, config?: any): Promise<AxiosResponse> {
    return this.makeRequest('GET', url, undefined, config);
  }

  async post(url: string, data?: any, config?: any): Promise<AxiosResponse> {
    return this.makeRequest('POST', url, data, config);
  }

  private async makeRequest(method: string, url: string, data?: any, config?: any): Promise<AxiosResponse> {
    // Simulate network delay
    if (this.networkDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.networkDelay));
    }

    // Simulate network failure
    if (this.shouldFail) {
      throw new Error(this.failureReason);
    }

    // Check for timeout
    if (config?.timeout && this.networkDelay > config.timeout) {
      throw new Error('ECONNABORTED');
    }

    // Get mocked response
    const key = `${method}:${url}`;
    const response = this.responses.get(key);

    if (!response) {
      throw new Error(`No mock response configured for ${key}`);
    }

    return {
      ...response,
      config: { ...config, method, url, data }
    } as AxiosResponse;
  }
}

// Create and configure the mock
export const mockAxios = MockAxios.getInstance();

// Jest mock setup
const axisMock = {
  get: jest.fn().mockImplementation((url: string, config: any) => mockAxios.get(url, config)),
  post: jest.fn().mockImplementation((url: string, data: any, config: any) => mockAxios.post(url, data, config)),
  put: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn(),
  head: jest.fn(),
  options: jest.fn(),
  request: jest.fn(),
  isAxiosError: jest.fn(),
  create: jest.fn(() => axisMock),
  defaults: {
    headers: {
      common: {},
      delete: {},
      get: {},
      head: {},
      patch: {},
      post: {},
      put: {}
    },
    timeout: 0,
    withCredentials: false
  }
};

export default axisMock;
/**
 * Bridge Client Unit Tests
 * Comprehensive tests for CCTelegramBridgeClient class
 */

import { jest } from '@jest/globals';
import path from 'path';
import { CCTelegramBridgeClient } from '../../src/bridge-client.js';
import { EventFixtures, EventDataBuilder } from '../fixtures/events.fixture.js';
import { ResponseFixtures } from '../fixtures/responses.fixture.js';
import { BridgeStatusFixtures } from '../fixtures/bridge-status.fixture.js';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('axios');
jest.mock('child_process');

import fsMock, { mockFS } from '../mocks/fs.mock.js';
import axisMock, { mockAxios } from '../mocks/axios.mock.js';
import childProcessMock, { mockChildProcess, execAsyncMock } from '../mocks/child_process.mock.js';

// Replace actual modules with mocks
jest.unstable_mockModule('fs-extra', () => ({ default: fsMock }));
jest.unstable_mockModule('axios', () => ({ default: axisMock }));
jest.unstable_mockModule('child_process', () => ({ 
  ...childProcessMock,
  promisify: () => execAsyncMock
}));

describe('CCTelegramBridgeClient', () => {
  let client: CCTelegramBridgeClient;
  let testEventsDir: string;
  let testResponsesDir: string;

  beforeEach(() => {
    // Reset all mocks
    mockFS.reset();
    mockAxios.reset();
    mockChildProcess.reset();

    // Set up test environment
    testEventsDir = '/test/events';
    testResponsesDir = '/test/responses';
    
    process.env.CC_TELEGRAM_EVENTS_DIR = testEventsDir;
    process.env.CC_TELEGRAM_RESPONSES_DIR = testResponsesDir;
    process.env.CC_TELEGRAM_HEALTH_PORT = '8080';

    // Mock directory creation
    mockFS.createDirectory(testEventsDir);
    mockFS.createDirectory(testResponsesDir);

    // Set up axios mocks for health and metrics
    mockAxios.mockHealthEndpoint(true);
    mockAxios.mockMetricsEndpoint();

    // Set up child process mocks
    mockChildProcess.setBridgeProcessRunning(false);

    client = new CCTelegramBridgeClient();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with correct directories', () => {
      expect(fsMock.ensureDir).toHaveBeenCalledWith(testEventsDir);
      expect(fsMock.ensureDir).toHaveBeenCalledWith(testResponsesDir);
    });

    it('should expand tilde paths correctly', () => {
      process.env.CC_TELEGRAM_EVENTS_DIR = '~/custom/events';
      process.env.HOME = '/Users/testuser';

      const customClient = new CCTelegramBridgeClient();
      
      expect(fsMock.ensureDir).toHaveBeenCalledWith('/Users/testuser/custom/events');
    });

    it('should use default directories when env vars not set', () => {
      delete process.env.CC_TELEGRAM_EVENTS_DIR;
      delete process.env.CC_TELEGRAM_RESPONSES_DIR;
      process.env.HOME = '/Users/testuser';

      const defaultClient = new CCTelegramBridgeClient();
      
      expect(fsMock.ensureDir).toHaveBeenCalledWith('/Users/testuser/.cc_telegram/events');
      expect(fsMock.ensureDir).toHaveBeenCalledWith('/Users/testuser/.cc_telegram/responses');
    });
  });

  describe('sendEvent', () => {
    it('should send event successfully', async () => {
      const event = EventFixtures.createBasicEvent();
      mockChildProcess.setBridgeProcessRunning(true);

      const result = await client.sendEvent(event);

      expect(result.success).toBe(true);
      expect(result.event_id).toBe(event.task_id);
      expect(result.file_path).toContain(event.task_id);
      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.stringContaining(event.task_id),
        event,
        { spaces: 2 }
      );
    });

    it('should generate task_id if not provided', async () => {
      const event = EventFixtures.createBasicEvent();
      delete event.task_id;
      mockChildProcess.setBridgeProcessRunning(true);

      const result = await client.sendEvent(event);

      expect(result.success).toBe(true);
      expect(result.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate timestamp if not provided', async () => {
      const event = EventFixtures.createBasicEvent();
      delete event.timestamp;
      mockChildProcess.setBridgeProcessRunning(true);

      await client.sendEvent(event);

      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
        }),
        expect.anything()
      );
    });

    it('should start bridge if not running', async () => {
      const event = EventFixtures.createBasicEvent();
      mockChildProcess.setBridgeProcessRunning(false);
      
      // Mock successful bridge start
      mockChildProcess.setExecResult('which cctelegram-bridge', {
        stdout: '/usr/local/bin/cctelegram-bridge\n',
        code: 0
      });

      await client.sendEvent(event);

      expect(childProcessMock.spawn).toHaveBeenCalledWith(
        expect.stringContaining('cctelegram-bridge'),
        [],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore'
        })
      );
    });

    it('should handle file write errors', async () => {
      const event = EventFixtures.createBasicEvent();
      mockChildProcess.setBridgeProcessRunning(true);
      mockFS.setShouldFail(true, 'Permission denied');

      await expect(client.sendEvent(event)).rejects.toThrow('Failed to send event');
    });

    it('should handle bridge start failures', async () => {
      const event = EventFixtures.createBasicEvent();
      mockChildProcess.setBridgeProcessRunning(false);
      mockChildProcess.setShouldFail(true, 'Bridge not found');

      await expect(client.sendEvent(event)).rejects.toThrow();
    });
  });

  describe('sendMessage', () => {
    it('should send simple message successfully', async () => {
      mockChildProcess.setBridgeProcessRunning(true);
      const message = 'Test message';

      const result = await client.sendMessage(message);

      expect(result.success).toBe(true);
      expect(result.event_id).toBeValidUUID();
      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'info_notification',
          title: 'Claude Code Message',
          description: message,
          data: expect.objectContaining({
            message,
            severity: 'low'
          })
        }),
        expect.anything()
      );
    });

    it('should use custom source', async () => {
      mockChildProcess.setBridgeProcessRunning(true);
      const message = 'Test message';
      const source = 'custom-source';

      await client.sendMessage(message, source);

      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          source: source
        }),
        expect.anything()
      );
    });
  });

  describe('sendTaskCompletion', () => {
    it('should send task completion successfully', async () => {
      mockChildProcess.setBridgeProcessRunning(true);
      const taskId = '123e4567-e89b-12d3-a456-426614174000';
      const title = 'Test Task';
      const results = 'Task completed successfully';
      const filesAffected = ['src/test.ts', 'src/utils.ts'];
      const durationMs = 5000;

      const result = await client.sendTaskCompletion(taskId, title, results, filesAffected, durationMs);

      expect(result.success).toBe(true);
      expect(result.event_id).toBe(taskId);
      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'task_completion',
          task_id: taskId,
          title: title,
          description: `Task "${title}" completed successfully`,
          data: expect.objectContaining({
            status: 'completed',
            results: results,
            files_affected: filesAffected,
            duration_ms: durationMs
          })
        }),
        expect.anything()
      );
    });

    it('should handle minimal task completion', async () => {
      mockChildProcess.setBridgeProcessRunning(true);
      const taskId = '123e4567-e89b-12d3-a456-426614174000';
      const title = 'Minimal Task';

      const result = await client.sendTaskCompletion(taskId, title);

      expect(result.success).toBe(true);
      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'completed',
            results: undefined,
            files_affected: undefined,
            duration_ms: undefined
          })
        }),
        expect.anything()
      );
    });
  });

  describe('sendPerformanceAlert', () => {
    it('should send performance alert successfully', async () => {
      mockChildProcess.setBridgeProcessRunning(true);
      const title = 'High Memory Usage';
      const currentValue = 512;
      const threshold = 400;
      const severity = 'high' as const;

      const result = await client.sendPerformanceAlert(title, currentValue, threshold, severity);

      expect(result.success).toBe(true);
      expect(result.event_id).toBeValidUUID();
      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'performance_alert',
          title: title,
          data: expect.objectContaining({
            current_value: currentValue,
            threshold: threshold,
            severity: severity,
            error_message: expect.stringContaining('512')
          })
        }),
        expect.anything()
      );
    });

    it('should use default severity', async () => {
      mockChildProcess.setBridgeProcessRunning(true);
      const title = 'CPU Usage Alert';
      const currentValue = 85;
      const threshold = 80;

      await client.sendPerformanceAlert(title, currentValue, threshold);

      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({
            severity: 'medium'
          })
        }),
        expect.anything()
      );
    });
  });

  describe('sendApprovalRequest', () => {
    it('should send approval request successfully', async () => {
      mockChildProcess.setBridgeProcessRunning(true);
      const title = 'Deploy to Production';
      const description = 'Approve deployment of version 1.2.0';
      const options = ['Approve', 'Deny', 'Ask Later'];

      const result = await client.sendApprovalRequest(title, description, options);

      expect(result.success).toBe(true);
      expect(result.event_id).toBeValidUUID();
      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'approval_request',
          title: title,
          description: description,
          data: expect.objectContaining({
            approval_prompt: description,
            options: options,
            requires_response: true,
            response_options: options,
            timeout_minutes: 30
          })
        }),
        expect.anything()
      );
    });

    it('should use default options', async () => {
      mockChildProcess.setBridgeProcessRunning(true);
      const title = 'Confirm Action';
      const description = 'Do you want to proceed?';

      await client.sendApprovalRequest(title, description);

      expect(fsMock.writeJSON).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({
            options: ['Approve', 'Deny'],
            response_options: ['Approve', 'Deny']
          })
        }),
        expect.anything()
      );
    });
  });

  describe('getBridgeStatus', () => {
    it('should get healthy bridge status', async () => {
      const healthData = BridgeStatusFixtures.createHealthData(true);
      const metricsString = BridgeStatusFixtures.createMetricsString();

      mockAxios.mockGet('http://localhost:8080/health', {
        data: healthData,
        status: 200
      });
      mockAxios.mockGet('http://localhost:8080/metrics', {
        data: metricsString,
        status: 200
      });

      const status = await client.getBridgeStatus();

      expect(status.running).toBe(true);
      expect(status.health).toBe('healthy');
      expect(status.metrics).toMatchObject({
        uptime_seconds: 3600,
        events_processed: 150,
        telegram_messages_sent: 145,
        error_count: 2,
        memory_usage_mb: 50,
        cpu_usage_percent: 15.5
      });
      expect(status.last_event_time).toBeTruthy();
    });

    it('should handle unhealthy bridge status', async () => {
      mockAxios.setShouldFail(true, 'Connection refused');

      const status = await client.getBridgeStatus();

      expect(status.running).toBe(false);
      expect(status.health).toBe('unhealthy');
      expect(status.metrics).toMatchObject({
        uptime_seconds: 0,
        events_processed: 0,
        telegram_messages_sent: 0,
        error_count: 0,
        memory_usage_mb: 0,
        cpu_usage_percent: 0
      });
    });

    it('should parse metrics correctly', async () => {
      const customMetrics = BridgeStatusFixtures.createMetricsString({
        process_uptime_seconds: 7200,
        events_processed_total: 500,
        memory_usage_bytes: 104857600 // 100MB
      });

      mockAxios.mockHealthEndpoint(true);
      mockAxios.mockGet('http://localhost:8080/metrics', {
        data: customMetrics,
        status: 200
      });

      const status = await client.getBridgeStatus();

      expect(status.metrics.uptime_seconds).toBe(7200);
      expect(status.metrics.events_processed).toBe(500);
      expect(status.metrics.memory_usage_mb).toBe(100);
    });

    it('should handle malformed metrics', async () => {
      const malformedMetrics = BridgeStatusFixtures.createMalformedMetricsString();

      mockAxios.mockHealthEndpoint(true);
      mockAxios.mockGet('http://localhost:8080/metrics', {
        data: malformedMetrics,
        status: 200
      });

      const status = await client.getBridgeStatus();

      expect(status.running).toBe(true);
      expect(status.metrics.uptime_seconds).toBe(0); // Should default to 0 for invalid values
    });
  });

  describe('getTelegramResponses', () => {
    it('should get responses successfully', async () => {
      const responses = ResponseFixtures.createResponseBatch(5);
      
      // Mock file system with response files
      mockFS.setFile(path.join(testResponsesDir, 'response1.json'), JSON.stringify(responses[0]));
      mockFS.setFile(path.join(testResponsesDir, 'response2.json'), JSON.stringify(responses[1]));
      mockFS.setFile(path.join(testResponsesDir, 'response3.json'), JSON.stringify(responses[2]));

      const result = await client.getTelegramResponses();

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        id: expect.any(String),
        user_id: expect.any(Number),
        message: expect.any(String),
        timestamp: expect.any(String)
      });
    });

    it('should sort responses by timestamp (newest first)', async () => {
      const oldResponse = ResponseFixtures.createOldResponse(2);
      const newResponse = ResponseFixtures.createRecentResponse(1);

      mockFS.setFile(path.join(testResponsesDir, 'old.json'), JSON.stringify(oldResponse));
      mockFS.setFile(path.join(testResponsesDir, 'new.json'), JSON.stringify(newResponse));

      const result = await client.getTelegramResponses();

      expect(result).toHaveLength(2);
      expect(new Date(result[0].timestamp).getTime()).toBeGreaterThan(
        new Date(result[1].timestamp).getTime()
      );
    });

    it('should handle empty responses directory', async () => {
      const result = await client.getTelegramResponses();
      expect(result).toEqual([]);
    });

    it('should handle malformed response files', async () => {
      const validResponse = ResponseFixtures.createBasicResponse();
      
      mockFS.setFile(path.join(testResponsesDir, 'valid.json'), JSON.stringify(validResponse));
      mockFS.setFile(path.join(testResponsesDir, 'invalid.json'), 'invalid json content');

      const result = await client.getTelegramResponses();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject(validResponse);
    });

    it('should handle file read errors gracefully', async () => {
      mockFS.setShouldFail(true, 'Permission denied');

      const result = await client.getTelegramResponses();
      expect(result).toEqual([]);
    });
  });

  describe('clearOldResponses', () => {
    it('should clear old response files', async () => {
      const oldResponse = ResponseFixtures.createOldResponse(25); // 25 hours old
      const newResponse = ResponseFixtures.createRecentResponse(1); // 1 minute ago

      const oldPath = path.join(testResponsesDir, 'old.json');
      const newPath = path.join(testResponsesDir, 'new.json');

      mockFS.setFile(oldPath, JSON.stringify(oldResponse));
      mockFS.setFile(newPath, JSON.stringify(newResponse));

      const deletedCount = await client.clearOldResponses(24);

      expect(deletedCount).toBe(1);
      expect(fsMock.remove).toHaveBeenCalledWith(oldPath);
      expect(fsMock.remove).not.toHaveBeenCalledWith(newPath);
    });

    it('should use default 24 hour threshold', async () => {
      const response23h = ResponseFixtures.createOldResponse(23);
      const response25h = ResponseFixtures.createOldResponse(25);

      mockFS.setFile(path.join(testResponsesDir, '23h.json'), JSON.stringify(response23h));
      mockFS.setFile(path.join(testResponsesDir, '25h.json'), JSON.stringify(response25h));

      const deletedCount = await client.clearOldResponses();

      expect(deletedCount).toBe(1); // Only the 25h old file should be deleted
    });

    it('should handle file deletion errors', async () => {
      const oldResponse = ResponseFixtures.createOldResponse(25);
      mockFS.setFile(path.join(testResponsesDir, 'old.json'), JSON.stringify(oldResponse));
      mockFS.setShouldFail(true, 'Permission denied');

      const deletedCount = await client.clearOldResponses(24);
      expect(deletedCount).toBe(0);
    });
  });

  describe('processPendingResponses', () => {
    it('should process approval responses', async () => {
      const taskId = '123e4567-e89b-12d3-a456-426614174000';
      const approvalResponse = ResponseFixtures.createApprovalCallbackResponse(taskId, true);
      const denialResponse = ResponseFixtures.createApprovalCallbackResponse(taskId, false);

      mockFS.setFile(path.join(testResponsesDir, 'approval.json'), JSON.stringify(approvalResponse));
      mockFS.setFile(path.join(testResponsesDir, 'denial.json'), JSON.stringify(denialResponse));

      const result = await client.processPendingResponses(60);

      expect(result.summary.actionable_responses).toBe(2);
      expect(result.summary.pending_approvals).toBe(1);
      expect(result.summary.pending_denials).toBe(1);
      expect(result.actionable_responses).toHaveLength(2);
      
      const approval = result.actionable_responses.find((r: any) => r.action === 'approve');
      const denial = result.actionable_responses.find((r: any) => r.action === 'deny');
      
      expect(approval).toBeTruthy();
      expect(denial).toBeTruthy();
      expect(approval.task_id).toBe(taskId);
      expect(denial.task_id).toBe(taskId);
    });

    it('should filter by time window', async () => {
      const taskId = '123e4567-e89b-12d3-a456-426614174000';
      const oldResponse = ResponseFixtures.createApprovalCallbackResponse(taskId, true);
      oldResponse.timestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 minutes ago

      const recentResponse = ResponseFixtures.createApprovalCallbackResponse(taskId, false);
      recentResponse.timestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago

      mockFS.setFile(path.join(testResponsesDir, 'old.json'), JSON.stringify(oldResponse));
      mockFS.setFile(path.join(testResponsesDir, 'recent.json'), JSON.stringify(recentResponse));

      const result = await client.processPendingResponses(10); // Last 10 minutes

      expect(result.summary.total_recent_responses).toBe(1);
      expect(result.summary.actionable_responses).toBe(1);
      expect(result.actionable_responses[0].action).toBe('deny');
    });

    it('should handle no pending responses', async () => {
      const result = await client.processPendingResponses(10);

      expect(result.summary.actionable_responses).toBe(0);
      expect(result.actionable_responses).toEqual([]);
      expect(result.recommendations).toContain('No pending approval responses found');
    });

    it('should handle processing errors', async () => {
      mockFS.setShouldFail(true, 'Permission denied');

      const result = await client.processPendingResponses(10);

      expect(result.summary.actionable_responses).toBe(0);
      expect(result.error).toBeTruthy();
      expect(result.recommendations).toContain('Error occurred while processing responses');
    });
  });

  describe('Bridge Process Management', () => {
    beforeEach(() => {
      // Reset bridge process state
      mockChildProcess.setBridgeProcessRunning(false);
    });

    describe('isBridgeRunning', () => {
      it('should check health endpoint first', async () => {
        mockAxios.mockHealthEndpoint(true);

        const isRunning = await client.isBridgeRunning();

        expect(isRunning).toBe(true);
        expect(axisMock.get).toHaveBeenCalledWith('http://localhost:8080/health', { timeout: 2000 });
      });

      it('should fallback to process check if health endpoint fails', async () => {
        mockAxios.setShouldFail(true, 'Connection refused');
        mockChildProcess.setBridgeProcessRunning(true);

        const isRunning = await client.isBridgeRunning();

        expect(isRunning).toBe(true);
        expect(execAsyncMock).toHaveBeenCalledWith('pgrep -f cctelegram-bridge');
      });

      it('should return false if both checks fail', async () => {
        mockAxios.setShouldFail(true, 'Connection refused');
        mockChildProcess.setBridgeProcessRunning(false);

        const isRunning = await client.isBridgeRunning();

        expect(isRunning).toBe(false);
      });
    });

    describe('startBridge', () => {
      beforeEach(() => {
        // Mock environment variables
        process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
        process.env.TELEGRAM_ALLOWED_USERS = '123456789,987654321';

        // Mock bridge executable path
        mockFS.setFile('/usr/local/bin/cctelegram-bridge', 'executable');
        mockChildProcess.setExecResult('which cctelegram-bridge', {
          stdout: '/usr/local/bin/cctelegram-bridge\n',
          code: 0
        });
      });

      it('should start bridge successfully', async () => {
        const result = await client.startBridge();

        expect(result.success).toBe(true);
        expect(result.message).toContain('successfully');
        expect(result.pid).toBeTruthy();
        expect(childProcessMock.spawn).toHaveBeenCalledWith(
          '/usr/local/bin/cctelegram-bridge',
          [],
          expect.objectContaining({
            detached: true,
            stdio: 'ignore',
            env: expect.objectContaining({
              TELEGRAM_BOT_TOKEN: 'test-bot-token',
              TELEGRAM_ALLOWED_USERS: '123456789,987654321'
            })
          })
        );
      });

      it('should return success if bridge already running', async () => {
        mockChildProcess.setBridgeProcessRunning(true);

        const result = await client.startBridge();

        expect(result.success).toBe(true);
        expect(result.message).toContain('already running');
      });

      it('should fail if environment variables missing', async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;

        const result = await client.startBridge();

        expect(result.success).toBe(false);
        expect(result.message).toContain('TELEGRAM_BOT_TOKEN');
      });

      it('should fail if bridge executable not found', async () => {
        mockChildProcess.setExecResult('which cctelegram-bridge', {
          stdout: '',
          stderr: 'cctelegram-bridge: not found',
          code: 1
        });

        await expect(client.startBridge()).rejects.toThrow('not found');
      });

      it('should load environment from .env files', async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_ALLOWED_USERS;

        // Mock .env file
        const envContent = 'TELEGRAM_BOT_TOKEN=env-bot-token\nTELEGRAM_ALLOWED_USERS=111111111';
        mockFS.setFile('/test/.env', envContent);

        const result = await client.startBridge();

        expect(result.success).toBe(true);
        expect(childProcessMock.spawn).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            env: expect.objectContaining({
              TELEGRAM_BOT_TOKEN: expect.any(String),
              TELEGRAM_ALLOWED_USERS: expect.any(String)
            })
          })
        );
      });
    });

    describe('stopBridge', () => {
      it('should stop bridge processes', async () => {
        mockChildProcess.setBridgeProcessRunning(true);
        mockChildProcess.setExecResult('pgrep -f cctelegram-bridge', {
          stdout: '1234\n5678\n',
          code: 0
        });

        const result = await client.stopBridge();

        expect(result.success).toBe(true);
        expect(result.message).toContain('2 bridge process');
        expect(execAsyncMock).toHaveBeenCalledWith('kill 1234');
        expect(execAsyncMock).toHaveBeenCalledWith('kill 5678');
      });

      it('should return success if no processes running', async () => {
        mockChildProcess.setBridgeProcessRunning(false);

        const result = await client.stopBridge();

        expect(result.success).toBe(true);
        expect(result.message).toContain('not running');
      });

      it('should force kill if graceful stop fails', async () => {
        mockChildProcess.setBridgeProcessRunning(true);
        mockChildProcess.setExecResult('pgrep -f cctelegram-bridge', {
          stdout: '1234\n',
          code: 0
        });

        // Simulate bridge still running after graceful kill
        let killAttempts = 0;
        mockChildProcess.setExecResult(/^kill \d+$/, {
          stdout: '',
          code: 0
        });

        const result = await client.stopBridge();

        expect(result.success).toBe(true);
      });
    });

    describe('restartBridge', () => {
      beforeEach(() => {
        process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
        process.env.TELEGRAM_ALLOWED_USERS = '123456789';
        mockFS.setFile('/usr/local/bin/cctelegram-bridge', 'executable');
        mockChildProcess.setExecResult('which cctelegram-bridge', {
          stdout: '/usr/local/bin/cctelegram-bridge\n',
          code: 0
        });
      });

      it('should restart bridge successfully', async () => {
        mockChildProcess.setBridgeProcessRunning(true);

        const result = await client.restartBridge();

        expect(result.success).toBe(true);
        expect(result.message).toContain('successful');
        expect(result.pid).toBeTruthy();
      });

      it('should handle restart failure', async () => {
        mockChildProcess.setBridgeProcessRunning(true);
        delete process.env.TELEGRAM_BOT_TOKEN;

        const result = await client.restartBridge();

        expect(result.success).toBe(false);
        expect(result.message).toContain('failed');
      });
    });

    describe('ensureBridgeRunning', () => {
      beforeEach(() => {
        process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
        process.env.TELEGRAM_ALLOWED_USERS = '123456789';
        mockFS.setFile('/usr/local/bin/cctelegram-bridge', 'executable');
        mockChildProcess.setExecResult('which cctelegram-bridge', {
          stdout: '/usr/local/bin/cctelegram-bridge\n',
          code: 0
        });
      });

      it('should return already_running if bridge is running', async () => {
        mockChildProcess.setBridgeProcessRunning(true);

        const result = await client.ensureBridgeRunning();

        expect(result.success).toBe(true);
        expect(result.action).toBe('already_running');
        expect(result.message).toContain('already running');
      });

      it('should start bridge if not running', async () => {
        mockChildProcess.setBridgeProcessRunning(false);

        const result = await client.ensureBridgeRunning();

        expect(result.success).toBe(true);
        expect(result.action).toBe('started');
      });

      it('should return failed action on start failure', async () => {
        mockChildProcess.setBridgeProcessRunning(false);
        delete process.env.TELEGRAM_BOT_TOKEN;

        const result = await client.ensureBridgeRunning();

        expect(result.success).toBe(false);
        expect(result.action).toBe('failed');
      });
    });
  });

  describe('getAvailableEventTypes', () => {
    it('should return all available event types', () => {
      const eventTypes = client.getAvailableEventTypes();

      expect(eventTypes).toHaveLength(25); // Based on the implementation
      expect(eventTypes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'task_completion',
            category: 'Task Management',
            description: expect.any(String)
          }),
          expect.objectContaining({
            type: 'performance_alert',
            category: 'System Monitoring',
            description: expect.any(String)
          }),
          expect.objectContaining({
            type: 'approval_request',
            category: 'User Interaction',
            description: expect.any(String)
          })
        ])
      );
    });

    it('should categorize event types correctly', () => {
      const eventTypes = client.getAvailableEventTypes();
      
      const taskTypes = eventTypes.filter(et => et.category === 'Task Management');
      const codeTypes = eventTypes.filter(et => et.category === 'Code Operations');
      const buildTypes = eventTypes.filter(et => et.category === 'Build & Development');
      const monitoringTypes = eventTypes.filter(et => et.category === 'System Monitoring');
      const userTypes = eventTypes.filter(et => et.category === 'User Interaction');
      const notificationTypes = eventTypes.filter(et => et.category === 'Notifications');

      expect(taskTypes.length).toBeGreaterThan(0);
      expect(codeTypes.length).toBeGreaterThan(0);
      expect(buildTypes.length).toBeGreaterThan(0);
      expect(monitoringTypes.length).toBeGreaterThan(0);
      expect(userTypes.length).toBeGreaterThan(0);
      expect(notificationTypes.length).toBeGreaterThan(0);
    });
  });

  describe('getTaskStatus', () => {
    it('should return task status successfully', async () => {
      // Mock Claude Code tasks
      const claudeTasks = [
        { id: '1', status: 'pending', content: 'Task 1' },
        { id: '2', status: 'completed', content: 'Task 2' }
      ];
      mockFS.setJSON('/test/.claude/todos.json', claudeTasks);

      // Mock TaskMaster tasks
      const taskmasterData = {
        tags: {
          master: {
            tasks: [
              { id: 1, title: 'TM Task 1', status: 'pending', priority: 'high' },
              { id: 2, title: 'TM Task 2', status: 'in_progress', priority: 'medium' }
            ]
          }
        },
        metadata: { projectName: 'Test Project' }
      };
      mockFS.setJSON('/test/.taskmaster/tasks/tasks.json', taskmasterData);

      const result = await client.getTaskStatus('/test', 'both', undefined, false);

      expect(result.claude_code_tasks.available).toBe(true);
      expect(result.claude_code_tasks.total_count).toBe(2);
      expect(result.taskmaster_tasks.available).toBe(true);
      expect(result.taskmaster_tasks.total_count).toBe(2);
      expect(result.combined_summary).toBeDefined();
    });

    it('should handle missing task files', async () => {
      const result = await client.getTaskStatus('/test', 'both', undefined, false);

      expect(result.claude_code_tasks.available).toBe(false);
      expect(result.taskmaster_tasks.available).toBe(false);
    });

    it('should filter by status', async () => {
      const claudeTasks = [
        { id: '1', status: 'pending', content: 'Task 1' },
        { id: '2', status: 'completed', content: 'Task 2' },
        { id: '3', status: 'pending', content: 'Task 3' }
      ];
      mockFS.setJSON('/test/.claude/todos.json', claudeTasks);

      const result = await client.getTaskStatus('/test', 'claude-code', 'pending', false);

      expect(result.claude_code_tasks.filtered_count).toBe(2);
      expect(result.claude_code_tasks.tasks).toHaveLength(2);
    });

    it('should return summary only when requested', async () => {
      const claudeTasks = [
        { id: '1', status: 'pending', content: 'Task 1' }
      ];
      mockFS.setJSON('/test/.claude/todos.json', claudeTasks);

      const result = await client.getTaskStatus('/test', 'claude-code', undefined, true);

      expect(result.claude_code_tasks.tasks).toBeUndefined();
      expect(result.claude_code_tasks.summary).toBeDefined();
    });
  });
});
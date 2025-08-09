/**
 * Shared Contract Definitions
 * Defines the API contracts between MCP Server and Bridge
 */

import { Matchers } from '@pact-foundation/pact';
import { CCTelegramEvent, TelegramResponse, BridgeStatus, EventType } from '../../../src/types.js';

const { like, string, integer, boolean, eachLike, regex, uuid, iso8601DateTime } = Matchers;

/**
 * Event API Contract Definitions
 */
export const EventContracts = {
  // Event submission request contract
  eventSubmissionRequest: {
    type: like('task_completion' as EventType),
    source: like('claude-code'),
    timestamp: iso8601DateTime(),
    task_id: uuid(),
    title: like('Task completed successfully'),
    description: like('The task has been completed successfully with all requirements met'),
    data: like({
      status: 'completed',
      duration_ms: 5000,
      files_affected: ['src/index.ts', 'tests/unit.test.ts'],
      results: 'All tests passed and code was deployed'
    })
  },

  // Event submission response contract
  eventSubmissionResponse: {
    success: boolean(),
    event_id: uuid(),
    file_path: like('/path/to/event/file.json'),
    message: like('Event sent successfully')
  },

  // Event validation error response
  eventValidationErrorResponse: {
    success: boolean(false),
    error: like('Invalid event data'),
    details: like({
      field: 'type',
      message: 'Event type is required',
      received: null
    })
  },

  // Batch event submission request
  batchEventSubmissionRequest: {
    events: eachLike({
      type: like('info_notification' as EventType),
      source: like('claude-code'),
      timestamp: iso8601DateTime(),
      task_id: uuid(),
      title: like('Batch event'),
      description: like('Event from batch submission'),
      data: like({})
    }, { min: 1 })
  },

  // Batch event submission response
  batchEventSubmissionResponse: {
    success: boolean(),
    total_events: integer(),
    successful_events: integer(),
    failed_events: integer(),
    event_ids: eachLike(uuid()),
    errors: eachLike({
      index: integer(),
      error: string(),
      event: like({})
    })
  }
};

/**
 * Health API Contract Definitions
 */
export const HealthContracts = {
  // Health check request (no body)
  healthCheckRequest: {},

  // Healthy response contract
  healthyResponse: {
    running: boolean(true),
    health: like('healthy'),
    metrics: like({
      uptime_seconds: integer(3600),
      events_processed: integer(150),
      telegram_messages_sent: integer(145),
      error_count: integer(2),
      memory_usage_mb: like(45.2),
      cpu_usage_percent: like(12.8)
    }),
    last_event_time: iso8601DateTime(),
    version: like('0.6.0'),
    build_info: like({
      git_hash: regex(/^[a-f0-9]{7,40}$/, 'abc1234'),
      build_date: iso8601DateTime(),
      build_environment: like('production')
    })
  },

  // Unhealthy response contract
  unhealthyResponse: {
    running: boolean(false),
    health: like('unhealthy'),
    metrics: like({
      uptime_seconds: integer(0),
      events_processed: integer(0),
      telegram_messages_sent: integer(0),
      error_count: integer(5),
      memory_usage_mb: like(0),
      cpu_usage_percent: like(0)
    }),
    error: like('Bridge service is not responding'),
    last_error_time: iso8601DateTime()
  },

  // Degraded response contract
  degradedResponse: {
    running: boolean(true),
    health: like('degraded'),
    metrics: like({
      uptime_seconds: integer(1800),
      events_processed: integer(75),
      telegram_messages_sent: integer(70),
      error_count: integer(15),
      memory_usage_mb: like(89.5),
      cpu_usage_percent: like(45.2)
    }),
    warnings: eachLike(like('High memory usage detected')),
    last_event_time: iso8601DateTime()
  }
};

/**
 * Response Management API Contract Definitions
 */
export const ResponseContracts = {
  // Get responses request
  getResponsesRequest: {
    limit: integer(10),
    since_minutes: integer(60),
    filter_type: like('approval')
  },

  // Responses list response contract
  responsesListResponse: {
    count: integer(),
    total: integer(),
    responses: eachLike({
      id: uuid(),
      user_id: integer(),
      message: like('User response message'),
      timestamp: iso8601DateTime(),
      event_id: uuid(),
      action: like('approve'),
      response_type: like('callback_query'),
      callback_data: like('approve_task_123'),
      username: like('user123'),
      data: like({})
    })
  },

  // Empty responses response contract
  emptyResponsesResponse: {
    count: integer(0),
    total: integer(0),
    responses: eachLike({}, { min: 0, max: 0 })
  },

  // Clear responses request
  clearResponsesRequest: {
    older_than_hours: integer(24)
  },

  // Clear responses response contract
  clearResponsesResponse: {
    deleted_count: integer(),
    message: like('Cleared 5 old response files'),
    summary: like({
      total_files_checked: integer(),
      files_deleted: integer(),
      files_skipped: integer(),
      errors: integer()
    })
  },

  // Process pending responses request
  processPendingRequest: {
    since_minutes: integer(10)
  },

  // Process pending responses response contract
  processPendingResponse: {
    summary: like({
      total_recent_responses: integer(3),
      actionable_responses: integer(2),
      pending_approvals: integer(1),
      pending_denials: integer(1),
      time_window_minutes: integer(10)
    }),
    actionable_responses: eachLike({
      action: like('approve'),
      task_id: uuid(),
      user_id: integer(),
      username: like('user123'),
      timestamp: iso8601DateTime(),
      response_data: like({})
    }),
    recommendations: eachLike(like('Process pending approvals'))
  }
};

/**
 * Bridge Management API Contract Definitions
 */
export const BridgeManagementContracts = {
  // Start bridge request (no body)
  startBridgeRequest: {},

  // Start bridge success response
  startBridgeSuccessResponse: {
    success: boolean(true),
    message: like('Bridge started successfully'),
    pid: integer(),
    startup_time_ms: integer(),
    configuration: like({
      events_dir: like('/path/to/events'),
      responses_dir: like('/path/to/responses'),
      health_port: integer(8080)
    })
  },

  // Start bridge failure response
  startBridgeFailureResponse: {
    success: boolean(false),
    message: like('Failed to start bridge: missing environment variables'),
    error_code: like('MISSING_CONFIG'),
    details: like({
      missing_variables: eachLike(like('TELEGRAM_BOT_TOKEN')),
      suggested_action: like('Set required environment variables')
    })
  },

  // Stop bridge request (no body)
  stopBridgeRequest: {},

  // Stop bridge response
  stopBridgeResponse: {
    success: boolean(),
    message: like('Bridge stopped successfully'),
    processes_terminated: integer(),
    cleanup_summary: like({
      files_cleaned: integer(),
      connections_closed: integer(),
      memory_freed_mb: like(45.2)
    })
  },

  // Bridge status check request (no body)
  bridgeStatusRequest: {},

  // Bridge process running response
  bridgeRunningResponse: {
    running: boolean(true),
    message: like('Bridge process is running'),
    process_info: like({
      pid: integer(),
      uptime_seconds: integer(),
      memory_usage_mb: like(45.2),
      cpu_usage_percent: like(12.8)
    })
  },

  // Bridge process stopped response
  bridgeStoppedResponse: {
    running: boolean(false),
    message: like('Bridge process is not running'),
    last_seen: iso8601DateTime(),
    reason: like('Process terminated normally')
  }
};

/**
 * Task Management API Contract Definitions
 */
export const TaskManagementContracts = {
  // Get task status request
  getTaskStatusRequest: {
    project_root: like('/path/to/project'),
    task_system: like('both'),
    status_filter: like('pending'),
    summary_only: boolean(false)
  },

  // Task status response contract
  taskStatusResponse: {
    timestamp: iso8601DateTime(),
    task_system: like('both'),
    status_filter: like('all'),
    summary_only: boolean(false),
    claude_code_tasks: like({
      available: boolean(true),
      source: like('session_todos'),
      total_count: integer(5),
      filtered_count: integer(3),
      summary: like({
        pending: integer(2),
        in_progress: integer(1),
        completed: integer(2),
        blocked: integer(0)
      }),
      tasks: eachLike({
        id: like('cc-1'),
        description: like('Fix TypeScript compilation errors'),
        status: like('pending'),
        priority: like('high'),
        created_at: iso8601DateTime()
      })
    }),
    taskmaster_tasks: like({
      available: boolean(true),
      source: like('/path/to/tasks.json'),
      current_tag: like('master'),
      project_name: like('CCTelegram'),
      total_count: integer(10),
      filtered_count: integer(7),
      summary: like({
        pending: integer(3),
        in_progress: integer(2),
        completed: integer(4),
        blocked: integer(1)
      }),
      tasks: eachLike({
        id: like('1'),
        title: like('Implement Authentication System'),
        description: like('Set up JWT-based authentication'),
        status: like('in_progress'),
        priority: like('high'),
        estimated_hours: integer(8),
        tags: eachLike(like('backend')),
        dependencies: eachLike(like('0'))
      })
    }),
    combined_summary: like({
      total_pending: integer(5),
      total_in_progress: integer(3),
      total_completed: integer(6),
      total_blocked: integer(1),
      grand_total: integer(15)
    })
  },

  // Task status unavailable response
  taskStatusUnavailableResponse: {
    timestamp: iso8601DateTime(),
    task_system: like('both'),
    status_filter: like('all'),
    summary_only: boolean(false),
    claude_code_tasks: like({
      available: boolean(false),
      message: like('No Claude Code session tasks found')
    }),
    taskmaster_tasks: like({
      available: boolean(false),
      message: like('No TaskMaster tasks found'),
      expected_path: like('/path/to/.taskmaster/tasks/tasks.json')
    })
  }
};

/**
 * Error Response Contract Definitions
 */
export const ErrorContracts = {
  // Generic error response
  genericError: {
    error: boolean(true),
    code: like('GENERIC_ERROR'),
    message: like('An error occurred'),
    timestamp: iso8601DateTime(),
    request_id: uuid()
  },

  // Validation error response
  validationError: {
    error: boolean(true),
    code: like('VALIDATION_ERROR'),
    message: like('Request validation failed'),
    details: eachLike({
      field: like('type'),
      message: like('Field is required'),
      received: like(null)
    }),
    timestamp: iso8601DateTime()
  },

  // Authentication error response
  authenticationError: {
    error: boolean(true),
    code: like('AUTHENTICATION_ERROR'),
    message: like('Authentication failed'),
    timestamp: iso8601DateTime()
  },

  // Authorization error response
  authorizationError: {
    error: boolean(true),
    code: like('AUTHORIZATION_ERROR'),
    message: like('Insufficient permissions'),
    required_permissions: eachLike(like('events:write')),
    timestamp: iso8601DateTime()
  },

  // Rate limit error response
  rateLimitError: {
    error: boolean(true),
    code: like('RATE_LIMIT_EXCEEDED'),
    message: like('Rate limit exceeded'),
    retry_after_seconds: integer(),
    limit: integer(),
    reset_time: iso8601DateTime(),
    timestamp: iso8601DateTime()
  },

  // Service unavailable error response
  serviceUnavailableError: {
    error: boolean(true),
    code: like('SERVICE_UNAVAILABLE'),
    message: like('Service temporarily unavailable'),
    estimated_recovery_time: iso8601DateTime(),
    maintenance_mode: boolean(false),
    timestamp: iso8601DateTime()
  }
};

/**
 * Complete contract specification combining all API contracts
 */
export const ContractSpecification = {
  events: EventContracts,
  health: HealthContracts,
  responses: ResponseContracts,
  bridge: BridgeManagementContracts,
  tasks: TaskManagementContracts,
  errors: ErrorContracts
};

export default ContractSpecification;
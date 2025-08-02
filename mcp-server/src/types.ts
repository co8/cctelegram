export interface CCTelegramEvent {
  type: EventType;
  source: string;
  timestamp: string;
  task_id: string;
  title: string;
  description: string;
  data: EventData;
}

export interface EventData {
  status?: string;
  results?: string;
  duration_ms?: number;
  files_affected?: string[];
  memory_usage_mb?: number;
  cpu_usage_percent?: number;
  error_message?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  build_target?: string;
  test_count?: number;
  tests_passed?: number;
  tests_failed?: number;
  coverage_percentage?: number;
  current_value?: number;
  threshold?: number;
  hash?: string;
  message?: string;
  author?: string;
  files?: string[];
  branch_name?: string;
  url?: string;
  endpoint?: string;
  response_code?: number;
  response_time_ms?: number;
  [key: string]: any;
}

export type EventType = 
  // Task Management
  | 'task_completion' | 'task_started' | 'task_failed' | 'task_progress' | 'task_cancelled'
  // Code Operations
  | 'code_generation' | 'code_analysis' | 'code_refactoring' | 'code_review' | 'code_testing' | 'code_deployment'
  // File System
  | 'file_created' | 'file_modified' | 'file_deleted' | 'directory_created' | 'directory_deleted'
  // Build & Development
  | 'build_started' | 'build_completed' | 'build_failed' | 'test_suite_run' | 'test_passed' | 'test_failed' | 'lint_check' | 'type_check'
  // Git Operations
  | 'git_commit' | 'git_push' | 'git_merge' | 'git_branch' | 'git_tag' | 'pull_request_created' | 'pull_request_merged'
  // System Monitoring
  | 'system_health' | 'performance_alert' | 'security_alert' | 'error_occurred' | 'resource_usage'
  // User Interaction
  | 'approval_request' | 'user_response' | 'command_executed'
  // Notifications
  | 'progress_update' | 'status_change' | 'alert_notification' | 'info_notification'
  // Integration
  | 'api_call' | 'webhook_received' | 'service_integration'
  // Custom
  | 'custom_event';

export interface BridgeStatus {
  running: boolean;
  health: 'healthy' | 'degraded' | 'unhealthy';
  metrics: {
    uptime_seconds: number;
    events_processed: number;
    telegram_messages_sent: number;
    error_count: number;
    memory_usage_mb: number;
    cpu_usage_percent: number;
  };
  last_event_time?: string;
}

export interface TelegramResponse {
  id: string;
  user_id: number;
  message: string;
  timestamp: string;
  event_id?: string;
  action?: string;
}

export interface EventTemplate {
  id: string;
  name: string;
  description: string;
  event_type: EventType;
  template: Partial<CCTelegramEvent>;
}
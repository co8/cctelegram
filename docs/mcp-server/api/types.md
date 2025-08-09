# Type Definitions

Core TypeScript interfaces and types for the CCTelegram MCP Server.

## Event Types

### BaseEvent

Base interface for all events sent through the bridge.

```typescript
interface BaseEvent {
  /** Event type identifier */
  type: string;
  
  /** Human-readable event title */
  title: string;
  
  /** Optional detailed description */
  description?: string;
  
  /** Optional task or operation ID */
  task_id?: string;
  
  /** Event source (defaults to "claude-code") */
  source?: string;
  
  /** Timestamp (auto-generated if not provided) */
  timestamp?: string;
  
  /** Additional event-specific data */
  data?: Record<string, unknown>;
}
```

### Task Events

#### TaskCompletionEvent

```typescript
interface TaskCompletionEvent extends BaseEvent {
  type: 'task_completion';
  
  /** Task execution duration in milliseconds */
  duration_ms?: number;
  
  /** List of files modified during task */
  files_affected?: string[];
  
  /** Task execution results or summary */
  results?: string;
}
```

**Example:**
```typescript
const event: TaskCompletionEvent = {
  type: 'task_completion',
  title: 'Database Migration Complete',
  description: 'Successfully migrated user schema to v2.1',
  duration_ms: 12500,
  files_affected: ['migrations/002_user_schema.sql'],
  results: 'Migrated 10,000 user records'
};
```

#### TaskStartedEvent

```typescript
interface TaskStartedEvent extends BaseEvent {
  type: 'task_started';
  
  /** Estimated duration in milliseconds */
  estimated_duration?: number;
  
  /** Task priority level */
  priority?: 'low' | 'medium' | 'high' | 'critical';
}
```

#### TaskFailedEvent

```typescript
interface TaskFailedEvent extends BaseEvent {
  type: 'task_failed';
  
  /** Error message or description */
  error?: string;
  
  /** Stack trace (for debugging) */
  stack_trace?: string;
  
  /** Recovery suggestions */
  recovery_suggestions?: string[];
}
```

### Code Events

#### CodeGenerationEvent

```typescript
interface CodeGenerationEvent extends BaseEvent {
  type: 'code_generation';
  
  /** Programming language */
  language?: string;
  
  /** Lines of code generated */
  lines_of_code?: number;
  
  /** Generated file paths */
  generated_files?: string[];
}
```

#### CodeAnalysisEvent

```typescript
interface CodeAnalysisEvent extends BaseEvent {
  type: 'code_analysis';
  
  /** Analysis type (lint, security, performance, etc.) */
  analysis_type?: string;
  
  /** Number of issues found */
  issues_found?: number;
  
  /** Analysis results summary */
  summary?: string;
}
```

### System Events

#### PerformanceAlertEvent

```typescript
interface PerformanceAlertEvent extends BaseEvent {
  type: 'performance_alert';
  
  /** Current metric value */
  current_value: number;
  
  /** Threshold that was exceeded */
  threshold: number;
  
  /** Alert severity */
  severity?: 'low' | 'medium' | 'high' | 'critical';
  
  /** Metric type (CPU, memory, response_time, etc.) */
  metric_type?: string;
}
```

**Example:**
```typescript
const alert: PerformanceAlertEvent = {
  type: 'performance_alert',
  title: 'High Memory Usage',
  description: 'Application memory usage exceeded threshold',
  current_value: 1.2,
  threshold: 1.0,
  severity: 'high',
  metric_type: 'memory_gb'
};
```

#### ErrorEvent

```typescript
interface ErrorEvent extends BaseEvent {
  type: 'error_occurred';
  
  /** Error code or type */
  error_code?: string;
  
  /** Error severity */
  severity?: 'low' | 'medium' | 'high' | 'critical';
  
  /** Component or service where error occurred */
  component?: string;
  
  /** Stack trace */
  stack_trace?: string;
}
```

## Response Types

### EventResponse

```typescript
interface EventResponse {
  /** Operation success status */
  success: boolean;
  
  /** Response message */
  message: string;
  
  /** Unique event ID assigned by server */
  event_id?: string;
  
  /** Telegram message ID (if sent) */
  telegram_message_id?: number;
  
  /** Response timestamp */
  timestamp: string;
  
  /** Additional response data */
  data?: Record<string, unknown>;
}
```

### BatchResponse

```typescript
interface BatchResponse {
  /** Batch operation success status */
  success: boolean;
  
  /** Number of events processed */
  processed: number;
  
  /** Number of events that failed */
  failed: number;
  
  /** Individual event responses */
  results: EventResponse[];
  
  /** Batch processing duration */
  duration_ms: number;
}
```

### HealthStatus

```typescript
interface HealthStatus {
  /** Overall health status */
  status: 'healthy' | 'unhealthy' | 'degraded';
  
  /** Health check timestamp */
  timestamp: string;
  
  /** Service uptime in seconds */
  uptime: number;
  
  /** Component health details */
  components: {
    database?: ComponentHealth;
    telegram?: ComponentHealth;
    cache?: ComponentHealth;
  };
  
  /** Performance metrics */
  metrics?: {
    requests_per_second: number;
    average_response_time: number;
    error_rate: number;
  };
}
```

### ComponentHealth

```typescript
interface ComponentHealth {
  /** Component status */
  status: 'healthy' | 'unhealthy' | 'unknown';
  
  /** Last check timestamp */
  last_check: string;
  
  /** Response time in milliseconds */
  response_time?: number;
  
  /** Error message if unhealthy */
  error?: string;
}
```

## Configuration Types

### BridgeClientOptions

```typescript
interface BridgeClientOptions {
  /** Base URL for the bridge server */
  baseURL?: string;
  
  /** Request timeout in milliseconds */
  timeout?: number;
  
  /** Number of retries on failure */
  retries?: number;
  
  /** Connection pool settings */
  pool?: PoolConfig;
  
  /** Default headers */
  headers?: Record<string, string>;
  
  /** Enable request/response logging */
  debug?: boolean;
}
```

### PoolConfig

```typescript
interface PoolConfig {
  /** Maximum concurrent connections */
  maxConnections?: number;
  
  /** Keep connections alive */
  keepAlive?: boolean;
  
  /** Connection timeout */
  timeout?: number;
  
  /** Maximum requests per connection */
  maxRequestsPerConnection?: number;
}
```

## Utility Types

### EventBatch

```typescript
class EventBatch {
  /** Add an event to the batch */
  add(event: BaseEvent): void;
  
  /** Remove an event from the batch */
  remove(index: number): void;
  
  /** Clear all events */
  clear(): void;
  
  /** Get batch size */
  get size(): number;
  
  /** Get all events */
  get events(): BaseEvent[];
  
  /** Check if batch is empty */
  get isEmpty(): boolean;
}
```

### ValidationError

```typescript
class ValidationError extends Error {
  /** Validation error details */
  details: string[];
  
  /** Field that failed validation */
  field?: string;
  
  constructor(message: string, details?: string[]);
}
```

### NetworkError

```typescript
class NetworkError extends Error {
  /** HTTP status code */
  status?: number;
  
  /** Response data */
  response?: unknown;
  
  /** Request that failed */
  request?: unknown;
  
  constructor(message: string, status?: number);
}
```

## Type Guards

Utility functions for type checking:

```typescript
/** Check if event is a task completion */
function isTaskCompletionEvent(event: BaseEvent): event is TaskCompletionEvent;

/** Check if event is a performance alert */
function isPerformanceAlertEvent(event: BaseEvent): event is PerformanceAlertEvent;

/** Check if event is an error event */
function isErrorEvent(event: BaseEvent): event is ErrorEvent;
```

## Generic Types

### EventHandler

```typescript
type EventHandler<T extends BaseEvent = BaseEvent> = (event: T) => void | Promise<void>;
```

### EventFilter

```typescript
type EventFilter<T extends BaseEvent = BaseEvent> = (event: T) => boolean;
```

### RetryPolicy

```typescript
interface RetryPolicy {
  /** Maximum number of retries */
  maxRetries: number;
  
  /** Initial delay in milliseconds */
  initialDelay: number;
  
  /** Backoff multiplier */
  backoffMultiplier: number;
  
  /** Maximum delay in milliseconds */
  maxDelay: number;
  
  /** Jitter for randomization */
  jitter: boolean;
}
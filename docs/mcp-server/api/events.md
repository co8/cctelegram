# Events & Notifications

The CCTelegram MCP Server provides 5 specialized tools for sending rich event notifications to Telegram.

## 🛠️ Available Tools

### send_telegram_event
Send structured events with rich metadata and custom data fields.

**Use Cases:**
- Build completions with artifact lists
- Deployment notifications with environment info
- Custom events with application-specific data

**Key Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | EventType | ✅ | Event type from [25+ available types](#event-types) |
| `title` | string | ✅ | Event title (max 200 chars) |
| `description` | string | ✅ | Event description (max 1000 chars) |
| `task_id` | string | ❌ | Optional task identifier |
| `source` | string | ❌ | Event source (default: "claude-code") |
| `data` | object | ❌ | Custom event data (max 20 properties) |

**Example:**
```json
{
  "type": "build_completed",
  "title": "Production Build Complete",
  "description": "Build finished successfully with all tests passing",
  "task_id": "build-prod-001",
  "source": "ci-pipeline",
  "data": {
    "duration_ms": 45000,
    "artifacts": ["dist/app.js", "dist/styles.css"],
    "exit_code": 0,
    "branch": "main",
    "commit": "a1b2c3d"
  }
}
```

### send_telegram_message
Send simple text messages for quick notifications.

**Use Cases:**
- Status updates
- Quick alerts
- Simple confirmations

**Key Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | ✅ | Message text (max 4000 chars) |
| `source` | string | ❌ | Message source (default: "claude-code") |

**Example:**
```json
{
  "message": "✅ Database migration completed successfully!",
  "source": "migration-tool"
}
```

### send_task_completion
Specialized notifications for task completion with metadata.

**Use Cases:**
- Task management integration
- Development workflow notifications
- Progress tracking

**Key Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | ✅ | Task identifier |
| `title` | string | ✅ | Task title |
| `results` | string | ❌ | Task results summary (max 2000 chars) |
| `files_affected` | string[] | ❌ | List of affected files (max 50) |
| `duration_ms` | number | ❌ | Task duration in milliseconds |

**Example:**
```json
{
  "task_id": "TASK-123",
  "title": "API Integration Complete", 
  "results": "Successfully integrated 15 REST endpoints with full test coverage",
  "files_affected": [
    "src/api/client.ts",
    "src/api/types.ts", 
    "tests/api.integration.test.ts"
  ],
  "duration_ms": 120000
}
```

### send_performance_alert
Critical performance threshold alerts with metrics.

**Use Cases:**
- System monitoring alerts
- Performance degradation warnings
- Resource usage notifications

**Key Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | ✅ | Alert title (max 200 chars) |
| `current_value` | number | ✅ | Current metric value |
| `threshold` | number | ✅ | Threshold that was exceeded |
| `severity` | string | ❌ | Alert severity: `low`, `medium`, `high`, `critical` |

**Example:**
```json
{
  "title": "High Memory Usage Detected",
  "current_value": 89.5,
  "threshold": 85.0,
  "severity": "high"
}
```

### send_approval_request
Interactive approval requests with custom response options.

**Use Cases:**
- Deployment approvals
- Configuration changes
- Critical action confirmations

**Key Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | ✅ | Request title (max 200 chars) |
| `description` | string | ✅ | Request description (max 1000 chars) |
| `options` | string[] | ❌ | Response options (2-5 options, default: ["Approve", "Deny"]) |

**Example:**
```json
{
  "title": "Production Deployment Ready",
  "description": "Version 2.1.0 is ready for production deployment. All tests passing and staging validation complete.",
  "options": ["Deploy Now", "Deploy Later", "Cancel", "Review Changes"]
}
```

## 📋 Event Types

The following 25+ event types are available for use with `send_telegram_event`:

### Task Management
- `task_completion` - Task finished successfully
- `task_started` - Task execution started
- `task_failed` - Task execution failed
- `task_progress` - Task progress update
- `task_cancelled` - Task was cancelled

### Code Operations  
- `code_generation` - Code generation complete
- `code_analysis` - Code analysis results
- `code_refactoring` - Refactoring operation complete
- `code_review` - Code review results
- `code_testing` - Testing results
- `code_deployment` - Deployment results

### Build & Development
- `build_completed` - Build finished successfully
- `build_failed` - Build failed
- `test_suite_run` - Test suite execution
- `lint_check` - Linting results
- `type_check` - Type checking results

### System Monitoring
- `performance_alert` - Performance threshold exceeded
- `error_occurred` - System error detected
- `system_health` - System health update
- `progress_update` - General progress notification
- `alert_notification` - Alert notification
- `info_notification` - Informational message

### User Interaction
- `approval_request` - User approval needed
- `user_response` - User response received

## 🔄 Response Format

All event tools return a consistent response format:

```json
{
  "success": true,
  "event_id": "evt_abc123def456",
  "message": "Event sent successfully. Event ID: evt_abc123def456",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

## ⚠️ Error Handling

Common error responses:

### Validation Error (400)
```json
{
  "error": true,
  "code": "VALIDATION_ERROR",
  "message": "Input validation failed",
  "details": {
    "field": "title",
    "reason": "exceeds maximum length"
  }
}
```

### Authentication Error (401)
```json
{
  "error": true,
  "code": "AUTHENTICATION_ERROR", 
  "message": "Invalid or missing API key"
}
```

### Rate Limit Error (429)
```json
{
  "error": true,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests",
  "details": {
    "limit": 100,
    "window": 60,
    "retry_after": 30
  }
}
```

## 🎯 Best Practices

### Event Design
- Use descriptive, action-oriented titles
- Include relevant context in descriptions
- Choose appropriate event types for categorization
- Include useful metadata in the `data` field

### Performance Optimization
- Batch similar events when possible
- Use appropriate event types to enable filtering
- Avoid sending duplicate events
- Monitor rate limits and implement backoff

### Error Handling
- Always handle validation errors gracefully
- Implement retry logic with exponential backoff
- Log events for debugging and audit trails
- Validate input data before sending

### Security
- Validate all input data
- Use appropriate API keys for different environments
- Avoid including sensitive data in event payloads
- Monitor for unusual event patterns
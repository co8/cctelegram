# Status & Monitoring

Monitor system health, bridge status, and task management integration with these 3 essential monitoring tools.

## 🛠️ Available Tools

### get_bridge_status
Get comprehensive bridge health and status information.

**Use Cases:**
- System health dashboards
- Monitoring and alerting systems
- Troubleshooting bridge issues
- Performance monitoring

**Parameters:** None required

**Response:**
```json
{
  "status": "running",
  "pid": 12345,
  "uptime": 7200,
  "last_activity": "2025-01-15T10:30:00.000Z",
  "health": {
    "overall": "healthy",
    "checks": [
      {
        "name": "telegram_api_connectivity",
        "status": "pass",
        "description": "Telegram Bot API connectivity",
        "observed_value": "200ms",
        "observed_unit": "response_time",
        "time": "2025-01-15T10:30:00.000Z"
      },
      {
        "name": "memory_usage",
        "status": "pass", 
        "description": "Process memory usage",
        "observed_value": "45.2",
        "observed_unit": "MB",
        "time": "2025-01-15T10:30:00.000Z"
      },
      {
        "name": "event_processing",
        "status": "pass",
        "description": "Event processing pipeline",
        "observed_value": "1250",
        "observed_unit": "events_processed",
        "time": "2025-01-15T10:30:00.000Z"
      }
    ],
    "last_updated": "2025-01-15T10:30:00.000Z"
  },
  "version": "1.4.0",
  "configuration": {
    "telegram_bot_configured": true,
    "chat_id_configured": true,
    "webhook_enabled": false,
    "rate_limiting_enabled": true
  }
}
```

**Status Values:**
- `running` - Bridge is running normally
- `stopped` - Bridge is not running
- `error` - Bridge is in error state
- `unknown` - Status cannot be determined

**Health Check Status:**
- `pass` - Check passed successfully
- `warn` - Check passed with warnings
- `fail` - Check failed

### list_event_types
List all available event types with descriptions and usage information.

**Use Cases:**
- API documentation generation
- Event type validation
- Integration planning
- Development reference

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `category` | string | ❌ | - | Filter by event category |

**Category Values:**
- `task` - Task management events
- `build` - Build and deployment events  
- `test` - Testing and validation events
- `deployment` - Deployment events
- `performance` - Performance monitoring events
- `security` - Security events
- `system` - System events

**Response:**
```json
{
  "count": 25,
  "event_types": [
    {
      "type": "task_completion",
      "category": "task",
      "description": "Task finished successfully",
      "schema": {
        "required": ["type", "title", "description"],
        "optional": ["task_id", "duration_ms", "files_affected"]
      },
      "examples": [
        "Build process completion",
        "Test suite execution",
        "Code review completion"
      ]
    },
    {
      "type": "performance_alert",
      "category": "performance", 
      "description": "Performance threshold exceeded",
      "schema": {
        "required": ["type", "title", "description"],
        "optional": ["current_value", "threshold", "severity"]
      },
      "examples": [
        "High CPU usage alert",
        "Memory usage warning",
        "Response time threshold exceeded"
      ]
    },
    {
      "type": "approval_request",
      "category": "system",
      "description": "User approval needed for action",
      "schema": {
        "required": ["type", "title", "description"],
        "optional": ["response_options", "timeout_minutes"]
      },
      "examples": [
        "Production deployment approval",
        "Configuration change approval", 
        "Database migration approval"
      ]
    }
  ]
}
```

**Example Usage:**
```bash
# Get all event types
curl -H "X-API-Key: your_key" \
     "http://localhost:8080/tools/list_event_types"

# Get only task-related events
curl -H "X-API-Key: your_key" \
     "http://localhost:8080/tools/list_event_types?category=task"

# Get performance monitoring events
curl -H "X-API-Key: your_key" \
     "http://localhost:8080/tools/list_event_types?category=performance"
```

### get_task_status
Get current task status and lists from both Claude Code session tasks and TaskMaster project tasks.

**Use Cases:**
- Task management dashboards
- Progress monitoring
- Integration with task management systems
- Development workflow tracking

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_root` | string | ❌ | current directory | Path to project root |
| `task_system` | string | ❌ | both | Which task system to query |
| `status_filter` | string | ❌ | - | Filter tasks by status |
| `summary_only` | boolean | ❌ | false | Return only summary statistics |

**Task System Values:**
- `claude-code` - Claude Code session tasks only
- `taskmaster` - TaskMaster project tasks only  
- `both` - Both systems (default)

**Status Filter Values:**
- `pending` - Tasks not yet started
- `in_progress` - Tasks currently being worked on
- `completed` - Finished tasks
- `blocked` - Tasks blocked by dependencies

**Response:**
```json
{
  "claude_code": {
    "available": true,
    "task_count": 5,
    "tasks": [
      {
        "id": "cc_task_001",
        "title": "Implement user authentication",
        "status": "in_progress",
        "priority": "high",
        "created_at": "2025-01-15T09:00:00.000Z",
        "updated_at": "2025-01-15T10:15:00.000Z"
      },
      {
        "id": "cc_task_002", 
        "title": "Write unit tests for API",
        "status": "pending",
        "priority": "medium",
        "created_at": "2025-01-15T09:30:00.000Z",
        "updated_at": "2025-01-15T09:30:00.000Z"
      }
    ]
  },
  "taskmaster": {
    "available": true,
    "task_count": 12,
    "tasks": [
      {
        "id": "TM-001",
        "title": "Database schema migration",
        "status": "completed", 
        "priority": "critical",
        "created_at": "2025-01-14T14:00:00.000Z",
        "updated_at": "2025-01-15T08:30:00.000Z"
      },
      {
        "id": "TM-002",
        "title": "Performance optimization review",
        "status": "blocked",
        "priority": "medium", 
        "created_at": "2025-01-15T10:00:00.000Z",
        "updated_at": "2025-01-15T10:00:00.000Z"
      }
    ]
  },
  "summary": {
    "total_tasks": 17,
    "by_status": {
      "pending": 8,
      "in_progress": 3, 
      "completed": 5,
      "blocked": 1
    },
    "by_system": {
      "claude_code": 5,
      "taskmaster": 12
    }
  }
}
```

**Summary Only Response:**
```json
{
  "summary": {
    "total_tasks": 17,
    "by_status": {
      "pending": 8,
      "in_progress": 3,
      "completed": 5, 
      "blocked": 1
    },
    "by_system": {
      "claude_code": 5,
      "taskmaster": 12
    }
  }
}
```

**Example Usage:**
```bash
# Get all tasks from both systems
curl -H "X-API-Key: your_key" \
     "http://localhost:8080/tools/get_task_status"

# Get only TaskMaster tasks
curl -H "X-API-Key: your_key" \
     "http://localhost:8080/tools/get_task_status?task_system=taskmaster"

# Get only pending tasks
curl -H "X-API-Key: your_key" \
     "http://localhost:8080/tools/get_task_status?status_filter=pending"

# Get summary statistics only  
curl -H "X-API-Key: your_key" \
     "http://localhost:8080/tools/get_task_status?summary_only=true"
```

## 📊 Monitoring Dashboard Integration

### Health Check Endpoint
Use `get_bridge_status` for comprehensive health monitoring:

```javascript
// Health monitoring function
async function monitorBridgeHealth() {
  try {
    const status = await mcpClient.getBridgeStatus();
    
    // Check overall health
    if (status.health.overall !== 'healthy') {
      console.warn('Bridge health degraded:', status.health);
    }
    
    // Check individual health checks
    const failedChecks = status.health.checks.filter(check => 
      check.status === 'fail'
    );
    
    if (failedChecks.length > 0) {
      console.error('Failed health checks:', failedChecks);
    }
    
    // Monitor uptime
    const uptimeHours = status.uptime / 3600;
    console.log(`Bridge uptime: ${uptimeHours.toFixed(1)} hours`);
    
    return status;
  } catch (error) {
    console.error('Health check failed:', error);
    return null;
  }
}

// Run health check every 5 minutes
setInterval(monitorBridgeHealth, 5 * 60 * 1000);
```

### Event Type Validation
Use `list_event_types` for dynamic event validation:

```javascript
// Event type validator
class EventValidator {
  constructor() {
    this.eventTypes = new Map();
    this.loadEventTypes();
  }
  
  async loadEventTypes() {
    const response = await mcpClient.listEventTypes();
    response.event_types.forEach(eventType => {
      this.eventTypes.set(eventType.type, eventType);
    });
  }
  
  validateEvent(event) {
    const eventType = this.eventTypes.get(event.type);
    if (!eventType) {
      throw new Error(`Unknown event type: ${event.type}`);
    }
    
    // Validate required fields
    const required = eventType.schema.required || [];
    for (const field of required) {
      if (!event[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return true;
  }
}
```

### Task Management Integration
Use `get_task_status` for task dashboard integration:

```javascript
// Task dashboard component
class TaskDashboard {
  async updateTaskStatus() {
    const taskStatus = await mcpClient.getTaskStatus({
      summary_only: false
    });
    
    // Update dashboard metrics
    this.updateMetrics(taskStatus.summary);
    
    // Update task lists
    this.updateTaskList('claude-code', taskStatus.claude_code.tasks);
    this.updateTaskList('taskmaster', taskStatus.taskmaster.tasks);
    
    // Highlight blocked tasks
    const blockedTasks = [
      ...taskStatus.claude_code.tasks,
      ...taskStatus.taskmaster.tasks
    ].filter(task => task.status === 'blocked');
    
    this.highlightBlockedTasks(blockedTasks);
  }
  
  updateMetrics(summary) {
    document.getElementById('total-tasks').textContent = summary.total_tasks;
    document.getElementById('pending-tasks').textContent = summary.by_status.pending;
    document.getElementById('in-progress-tasks').textContent = summary.by_status.in_progress;
    document.getElementById('completed-tasks').textContent = summary.by_status.completed;
  }
}
```

## 🚨 Error Handling & Troubleshooting

### Bridge Status Errors

**Bridge Not Running:**
```json
{
  "status": "stopped",
  "pid": null,
  "uptime": 0,
  "health": {
    "overall": "unhealthy",
    "checks": []
  },
  "message": "Bridge process is not running"
}
```

**Health Check Failed:**
```json
{
  "status": "error", 
  "health": {
    "overall": "unhealthy",
    "checks": [
      {
        "name": "telegram_api_connectivity",
        "status": "fail",
        "description": "Cannot connect to Telegram API",
        "observed_value": "timeout",
        "time": "2025-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

### Task Status Errors

**System Unavailable:**
```json
{
  "claude_code": {
    "available": false,
    "error": "Claude Code session not active"
  },
  "taskmaster": {
    "available": false, 
    "error": "TaskMaster not initialized in project"
  },
  "summary": {
    "total_tasks": 0,
    "by_status": {},
    "by_system": {}
  }
}
```

## 🎯 Best Practices

### Health Monitoring
- **Regular Checks** - Monitor bridge health every 1-5 minutes
- **Alert Thresholds** - Set up alerts for health check failures
- **Trend Analysis** - Track uptime and performance trends
- **Auto-Recovery** - Implement automatic restart on health failures

### Event Type Management
- **Cache Event Types** - Cache event type list to avoid repeated API calls
- **Validation** - Validate events against available types before sending
- **Documentation** - Use event type descriptions for API documentation
- **Categorization** - Use categories for filtering and organization

### Task Status Integration
- **Dashboard Updates** - Refresh task status every 30-60 seconds
- **Status Filtering** - Use status filters to focus on relevant tasks
- **Summary Views** - Use summary mode for high-level dashboards
- **Cross-System Integration** - Leverage both Claude Code and TaskMaster data

### Performance Optimization
- **Polling Intervals** - Use appropriate intervals based on use case
- **Data Caching** - Cache status data to reduce API calls
- **Error Handling** - Implement robust error handling and retries
- **Resource Monitoring** - Monitor API usage and response times

## 💡 Integration Examples

### Simple Health Check
```bash
#!/bin/bash
# Simple bridge health check script

response=$(curl -s -H "X-API-Key: $API_KEY" \
               http://localhost:8080/tools/get_bridge_status)

status=$(echo $response | jq -r '.status')
health=$(echo $response | jq -r '.health.overall')

if [ "$status" != "running" ] || [ "$health" != "healthy" ]; then
    echo "ALERT: Bridge not healthy - Status: $status, Health: $health"
    exit 1
else
    echo "OK: Bridge running and healthy"
    exit 0
fi
```

### Task Progress Monitor
```javascript
// Monitor task progress and send updates
async function monitorTaskProgress() {
  const taskStatus = await mcpClient.getTaskStatus({
    status_filter: 'in_progress'
  });
  
  const inProgressTasks = [
    ...taskStatus.claude_code.tasks,
    ...taskStatus.taskmaster.tasks
  ];
  
  if (inProgressTasks.length === 0) {
    console.log('No tasks in progress');
    return;
  }
  
  // Send progress update
  await mcpClient.sendTelegramEvent({
    type: 'progress_update',
    title: 'Task Progress Update',
    description: `${inProgressTasks.length} tasks currently in progress`,
    data: {
      in_progress_count: inProgressTasks.length,
      task_titles: inProgressTasks.map(t => t.title)
    }
  });
}
```

### Event Type Documentation Generator
```javascript
// Generate documentation from event types
async function generateEventDocs() {
  const eventTypes = await mcpClient.listEventTypes();
  
  const docsByCategory = eventTypes.event_types.reduce((acc, eventType) => {
    if (!acc[eventType.category]) {
      acc[eventType.category] = [];
    }
    acc[eventType.category].push(eventType);
    return acc;
  }, {});
  
  // Generate markdown documentation
  let markdown = '# Available Event Types\n\n';
  
  for (const [category, types] of Object.entries(docsByCategory)) {
    markdown += `## ${category.toUpperCase()} Events\n\n`;
    
    for (const type of types) {
      markdown += `### ${type.type}\n`;
      markdown += `${type.description}\n\n`;
      markdown += `**Required fields:** ${type.schema.required.join(', ')}\n`;
      if (type.schema.optional?.length > 0) {
        markdown += `**Optional fields:** ${type.schema.optional.join(', ')}\n`;
      }
      markdown += '\n';
    }
  }
  
  return markdown;
}
```
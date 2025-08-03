# CC Telegram MCP Server v1.1.1

Model Context Protocol (MCP) server for seamless integration between Claude Code and the CC Telegram Bridge. This server provides a comprehensive set of tools that allow Claude Code to send notifications, monitor responses, process approvals intelligently, and interact with Telegram users remotely for effective remote development workflows.

## Features

- **📤 Event Sending**: Send structured events for all development activities with rich formatting
- **💬 Simple Messaging**: Send quick text messages to Telegram with local timezone stamps
- **📋 Task Tracking**: Specialized task completion notifications with duration and file tracking
- **⚡ Performance Monitoring**: Send performance alerts and system status with thresholds
- **🔄 Interactive Messaging**: Request approvals and get user responses with clean formatting
- **🧠 Intelligent Response Processing**: **NEW** Automated processing of pending approvals/denials
- **📊 Bridge Monitoring**: Check bridge health and status with detailed metrics
- **🎯 Event Templates**: Pre-configured templates for common use cases
- **🌍 Local Timezone Support**: All timestamps display in Europe/Berlin timezone (UTC+2/CEST)
- **🛠️ Bridge Management**: Automated start/stop/restart bridge process management

## Quick Installation

```bash
# Navigate to the MCP server directory
cd mcp-server

# Run the installation script
./install.sh
```

The script will:
1. Install Node.js dependencies
2. Build the TypeScript code
3. Configure Claude Code to use the MCP server
4. Create necessary directories

## Manual Installation

### Prerequisites

- Node.js 18+
- CC Telegram Bridge running
- Claude Code installed

### Setup Steps

1. **Install dependencies:**
```bash
npm install
```

2. **Build the project:**
```bash
npm run build
```

3. **Configure Claude Code:**
Add to your `~/.claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "cctelegram": {
      "command": "node",
      "args": ["/path/to/cc-telegram/mcp-server/dist/index.js"],
      "env": {
        "CC_TELEGRAM_EVENTS_DIR": "~/.cc_telegram/events",
        "CC_TELEGRAM_RESPONSES_DIR": "~/.cc_telegram/responses",
        "CC_TELEGRAM_HEALTH_PORT": "8080"
      }
    }
  }
}
```

4. **Restart Claude Code**

## Usage Examples

### Send Simple Message
```
@cctelegram send_telegram_message "Build completed successfully! 🎉"
```

### Send Task Completion
```
@cctelegram send_task_completion {
  "task_id": "auth-implementation",
  "title": "OAuth2 Authentication Complete",
  "results": "Implemented OAuth2 with 100% test coverage",
  "files_affected": ["src/auth.rs", "tests/auth_test.rs"],
  "duration_ms": 45000
}
```

### Send Performance Alert
```
@cctelegram send_performance_alert {
  "title": "Memory Usage High",
  "current_value": 85.5,
  "threshold": 80.0,
  "severity": "high"
}
```

### Request User Approval
```
@cctelegram send_approval_request {
  "title": "Deploy to Production?",
  "description": "All tests passed. Ready to deploy v2.1.0 to production.",
  "options": ["Deploy", "Hold", "Cancel"]
}
```

### Check Bridge Status
```
@cctelegram get_bridge_status
```

### Get User Responses
```
@cctelegram get_telegram_responses {"limit": 5}
```

### Process Pending Responses (NEW)
```
@cctelegram process_pending_responses {"since_minutes": 10}
```

## Available Tools

| Tool | Description | Example Use Case |
|------|-------------|------------------|
| `send_telegram_event` | Send structured events | Code analysis complete |
| `send_telegram_message` | Send simple text messages | Quick status updates |
| `send_task_completion` | Task completion notifications | Feature implementation done |
| `send_performance_alert` | Performance threshold alerts | Memory/CPU warnings |
| `send_approval_request` | Request user approval | Deployment confirmations |
| `get_telegram_responses` | Get user responses | Check approval status |
| `process_pending_responses` | **NEW** Process and analyze pending approvals/denials | Automated approval handling |
| `get_bridge_status` | Bridge health check | Monitor system status |
| `list_event_types` | List available event types | Discover notification options |
| `clear_old_responses` | Clean up old responses | Maintenance operations |
| `start_bridge` | Start the bridge process | Ensure bridge is running |
| `stop_bridge` | Stop the bridge process | Maintenance operations |
| `restart_bridge` | Restart the bridge process | Recovery operations |
| `ensure_bridge_running` | Start bridge if not running | Automated management |
| `check_bridge_process` | Check if bridge process is running | Process monitoring |

## Event Types

The server supports 40+ event types across 10 categories:

### 📋 Task Management
- `task_completion`, `task_started`, `task_failed`, `task_progress`, `task_cancelled`

### 🔨 Code Operations  
- `code_generation`, `code_analysis`, `code_refactoring`, `code_review`, `code_testing`, `code_deployment`

### 📁 File System
- `file_created`, `file_modified`, `file_deleted`, `directory_created`, `directory_deleted`

### 🔨 Build & Development
- `build_completed`, `build_failed`, `test_suite_run`, `lint_check`, `type_check`

### 📝 Git Operations
- `git_commit`, `git_push`, `git_merge`, `git_branch`, `git_tag`, `pull_request_created`

### 💚 System Monitoring
- `performance_alert`, `error_occurred`, `system_health`, `resource_usage`

### 💬 User Interaction
- `approval_request`, `user_response`, `command_executed`

### 🔄 Notifications
- `info_notification`, `alert_notification`, `progress_update`, `status_change`

## Configuration

### Environment Variables

- `CC_TELEGRAM_EVENTS_DIR`: Directory for event files (default: `~/.cc_telegram/events`)
- `CC_TELEGRAM_RESPONSES_DIR`: Directory for response files (default: `~/.cc_telegram/responses`)
- `CC_TELEGRAM_HEALTH_PORT`: Bridge health endpoint port (default: `8080`)

### Resources

The MCP server provides these resources:

- `cctelegram://event-types`: List of available event types
- `cctelegram://bridge-status`: Current bridge status
- `cctelegram://responses`: Recent user responses
- `cctelegram://event-templates`: Pre-configured event templates

## Troubleshooting

### MCP Server Not Loading
1. Check Claude Code configuration in `~/.claude/claude_desktop_config.json`
2. Verify Node.js version (18+ required)
3. Ensure the build completed successfully: `npm run build`
4. Restart Claude Code after configuration changes

### Events Not Sending
1. Verify CC Telegram Bridge is running
2. Check events directory exists: `~/.cc_telegram/events`
3. Verify bridge health: `@cctelegram get_bridge_status`

### No Telegram Notifications
1. Check Telegram bot token and user ID configuration
2. Verify CC Telegram Bridge logs for errors
3. Test with a simple message: `@cctelegram send_telegram_message "test"`

### Permission Issues
1. Ensure directories are writable: `chmod 755 ~/.cc_telegram`
2. Check file permissions in events/responses directories

## Development

### Running in Development Mode
```bash
npm run dev
```

### Running Tests
```bash
npm test
```

### Building
```bash
npm run build
```

## Integration Examples

### Claude Code Workflow Integration

```typescript
// Example: Automatically notify on task completion
async function completeTask(taskId: string, results: string) {
  // ... task logic ...
  
  // Send notification
  await mcpClient.sendTaskCompletion(taskId, "Analysis Complete", results, ["src/main.rs"]);
}

// Example: Performance monitoring
async function checkPerformance() {
  const memoryUsage = getMemoryUsage();
  if (memoryUsage > 80) {
    await mcpClient.sendPerformanceAlert("Memory Usage High", memoryUsage, 80, "high");
  }
}

// Example: Request approval for critical operations
async function deployToProduction() {
  const approval = await mcpClient.sendApprovalRequest(
    "Deploy to Production?",
    "All tests passed. Deploy v2.1.0?",
    ["Deploy", "Cancel"]
  );
  
  // Process pending responses with intelligence
  const pendingResponses = await mcpClient.processPendingResponses({
    since_minutes: 10
  });
  
  // Handle approval logic based on processed responses
  if (pendingResponses.actionable_responses.length > 0) {
    const latestResponse = pendingResponses.actionable_responses[0];
    if (latestResponse.type === "approval" && latestResponse.action === "approved") {
      console.log("Deployment approved, proceeding...");
      // ... deploy logic ...
    }
  }
}
```

## License

MIT License - see the parent project's LICENSE file for details.

## Support

For issues and questions:
- Check the main CC Telegram Bridge documentation
- Review MCP server logs: check Claude Code's output
- Verify bridge status with health endpoints
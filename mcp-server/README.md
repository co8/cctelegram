# CCTelegram MCP Server v1.1.1

**Primary Interface for [Telegram](https://telegram.org/) Development Notifications**

Model Context Protocol (MCP) server that serves as the main interface for [Claude Code](https://github.com/anthropics/claude-code) users. Automatically manages the CCTelegram Bridge process in the background while providing a comprehensive set of tools for sending [Telegram](https://telegram.org/) notifications about development activities, processing approval workflows, and monitoring development status. This is a notification and monitoring system - users interact exclusively with MCP tools for sending notifications, not executing commands.

## Features

### 🎯 Primary Interface (MCP-First Architecture)
- **Zero Configuration Setup**: MCP server handles all bridge management automatically
- **Hands-Free Operation**: Users only interact with MCP tools - bridge runs transparently
- **Intelligent Bridge Management**: Automatic start, monitor, restart of CCTelegram Bridge process
- **Smart Discovery**: Automatically locates bridge executable across installation paths

### 📤 MCP Tools Available
- **Event Notifications** - 44+ event types with rich formatting
- **Task Completion** - Detailed task notifications with results
- **Performance Alerts** - Threshold-based monitoring alerts
- **Approval Workflows** - Interactive approval requests
- **Response Processing** - Automated approval/denial analysis
- **Bridge Management** - Health monitoring and auto-restart

→ **[See all features & capabilities](../docs/FEATURES.md)**

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
- CCTelegram Bridge installed (download from [releases](https://github.com/co8/cctelegram/releases/latest) or build from source - MCP manages it automatically)
- [Claude Code](https://github.com/anthropics/claude-code) installed

### Setup Steps

1. **Install dependencies:**
```bash
npm install
```

2. **Build the project:**
```bash
npm run build
```

3. **Configure [Claude Code](https://github.com/anthropics/claude-code):**
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
        "CC_TELEGRAM_HEALTH_PORT": "8080",
        "TELEGRAM_BOT_TOKEN": "your_bot_token",
        "TELEGRAM_ALLOWED_USERS": "your_user_id"
      }
    }
  }
}
```

4. **Restart [Claude Code](https://github.com/anthropics/claude-code)**

The MCP server will automatically manage the bridge process - no manual startup required!

## Usage Examples

All interactions happen through MCP tools. The bridge is managed automatically in the background.

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

## Event Types (Notification Support)

The server can send notifications for 40+ event types across 10 categories:

### 📋 Task Management Notifications
- `task_completion`, `task_started`, `task_failed`, `task_progress`, `task_cancelled`

### 🔨 Code Operations Notifications  
- `code_generation`, `code_analysis`, `code_refactoring`, `code_review`, `code_testing`, `code_deployment`

### 📁 File System Activity Notifications
- `file_created`, `file_modified`, `file_deleted`, `directory_created`, `directory_deleted`

### 🔨 Build & Development Result Notifications
- `build_completed`, `build_failed`, `test_suite_run`, `lint_check`, `type_check`

### 📝 Git Operations Activity Notifications
- `git_commit`, `git_push`, `git_merge`, `git_branch`, `git_tag`, `pull_request_created`

### 💚 System Monitoring & Status Notifications
- `performance_alert`, `error_occurred`, `system_health`, `resource_usage`

### 💬 User Interaction & Approval Notifications
- `approval_request`, `user_response`, `command_executed`

### 🔄 General Status Notifications
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
1. Check bridge health: `@cctelegram get_bridge_status`
2. Ensure bridge automatically starts: `@cctelegram ensure_bridge_running`
3. Check events directory exists: `~/.cc_telegram/events`

### No Telegram Notifications
1. Check Telegram bot token and user ID in MCP configuration
2. Test bridge connectivity: `@cctelegram send_telegram_message "test"`
3. Verify bridge auto-starts: `@cctelegram ensure_bridge_running`

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
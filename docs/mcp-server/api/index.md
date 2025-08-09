# CCTelegram MCP Server API

Fast, reliable Model Context Protocol server providing **16 specialized tools** for Telegram integration with Claude Code and other MCP clients.

## 🚀 Getting Started

Choose your preferred way to explore the API:

<div class="api-nav-cards">
  <a href="./quick-reference" class="nav-card">
    <h3>🔧 Quick Reference</h3>
    <p>Essential tool cards with examples and common patterns</p>
  </a>
  
  <a href="./swagger" class="nav-card">
    <h3>⚡ Interactive API</h3>
    <p>Try endpoints live with Swagger UI - test directly in browser</p>
  </a>
  
  <a href="./redoc" class="nav-card">
    <h3>📖 Full Documentation</h3>
    <p>Complete API reference with detailed schemas via ReDoc</p>
  </a>
</div>

## 🛠️ Core MCP Tools

### 📨 Events & Notifications (5 tools)
- **send_telegram_event** - Rich structured events with custom data
- **send_telegram_message** - Simple text notifications  
- **send_task_completion** - Task completion with metadata
- **send_performance_alert** - Performance threshold alerts
- **send_approval_request** - Interactive approval workflows

### ⚙️ Bridge Management (5 tools)
- **start_bridge** - Start bridge process
- **stop_bridge** - Stop bridge process  
- **restart_bridge** - Restart bridge process
- **ensure_bridge_running** - Auto-start if needed
- **check_bridge_process** - Process status check

### 💬 Response Processing (3 tools)
- **get_telegram_responses** - Retrieve user responses
- **process_pending_responses** - Handle approval responses
- **clear_old_responses** - Clean up old response files

### 📊 Status & Monitoring (3 tools)
- **get_bridge_status** - Bridge health and status
- **list_event_types** - Available event types catalog  
- **get_task_status** - Task management integration

## 🔐 Security Features

- **API Key Authentication** - Secure tool access
- **Input Validation** - Schema-based validation  
- **Rate Limiting** - Prevent abuse
- **Audit Logging** - Security monitoring
- **Error Sanitization** - Safe error responses

## 🏗️ Protocol Support

- **MCP over STDIO** - Standard MCP transport
- **WebSocket** - Real-time connections (dev)
- **TCP** - Enterprise deployments
- **Webhook Integration** - Event callbacks

## 📋 Quick Examples

### Send a Task Completion Event
```json
{
  "type": "task_completion",
  "title": "Build Complete",
  "description": "Production build finished successfully",
  "task_id": "build-001",
  "data": {
    "duration_ms": 45000,
    "artifacts": ["dist/app.js", "dist/styles.css"],
    "exit_code": 0
  }
}
```

### Request User Approval
```json
{
  "title": "Deploy to Production?", 
  "description": "Version 2.1.0 ready for production deployment",
  "options": ["Deploy", "Cancel", "Review Changes"]
}
```

### Check Bridge Health
```bash
# GET /tools/get_bridge_status
# Returns comprehensive bridge status and health metrics
```

## 🔗 Integration Patterns

### Task Completion Workflow
1. `send_task_completion` → Send completion event
2. `get_telegram_responses` → Check for user feedback  
3. `process_pending_responses` → Handle responses

### Approval Workflow
1. `send_approval_request` → Request user approval
2. `get_telegram_responses` → Poll for responses
3. `process_pending_responses` → Act on approval

### Bridge Health Check
1. `check_bridge_process` → Verify bridge status
2. `ensure_bridge_running` → Auto-start if needed
3. `get_bridge_status` → Get detailed health info

<style>
.api-nav-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
  margin: 2rem 0;
}

.nav-card {
  display: block;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 1.5rem;
  text-decoration: none;
  transition: all 0.2s ease;
}

.nav-card:hover {
  border-color: var(--vp-c-brand);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(100, 108, 255, 0.1);
}

.nav-card h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
  color: var(--vp-c-text-1);
}

.nav-card p {
  margin: 0;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}
</style>
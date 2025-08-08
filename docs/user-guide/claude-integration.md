# 🔌 Claude Code Integration Guide

> **Master CCTelegram's MCP tools and advanced workflows for maximum productivity**

## 🎯 What You'll Master

By the end of this guide, you'll be a CCTelegram power user with:
- ⚡ All 20+ MCP tools at your fingertips
- 🤝 Interactive approval workflows
- 📊 Advanced task and performance monitoring  
- 🔄 Automated development notifications
- 🛠️ Custom workflow integration patterns

**Prerequisites:** [Installation complete](installation.md) ✅

---

## 🚀 Quick Start: Your First MCP Command

Test your installation immediately:

```bash
# In Claude Code, try this:
send_telegram_message "Hello from Claude Code! MCP integration is working! 🎉"
```

**Expected result:** Telegram notification within 5 seconds ✨

---

## 📊 MCP Tools Overview

CCTelegram provides **20+ specialized MCP tools** organized into logical groups:

**Tool Categories:**

- **Event Tools**: send_telegram_event, send_telegram_message, send_task_completion, send_performance_alert, send_approval_request
- **Bridge Management**: start_bridge, stop_bridge, restart_bridge, ensure_bridge_running, check_bridge_process  
- **Information & Status**: get_bridge_status, list_event_types, get_telegram_responses
- **Workflow Integration**: get_task_status, todo, process_pending_responses
- **Maintenance**: clear_old_responses
- **Mode Control**: switch_to_nomad_mode, switch_to_local_mode, switch_to_mute_mode

---

## 🎪 Event Tools: Core Notification System

### 🔥 send_telegram_event

**Most versatile tool** - Send any of 44+ event types with full customization:

```javascript
send_telegram_event({
  type: "code_generation",
  title: "Authentication Module Generated",
  description: "Created OAuth2 authentication system with JWT tokens",
  task_id: "auth_task_001",
  source: "claude-code",
  data: {
    language: "typescript",
    files_affected: ["src/auth/oauth.ts", "src/auth/jwt.ts"],
    lines_of_code: 250,
    test_coverage: 95.5
  }
})
```

**Visual Result:**
```
*🔨 Code Generated Authentication Module Generated*
⏰ 7/Aug/24 15:30
📝 Created OAuth2 authentication system with JWT tokens
📊 250 lines • 95.5% coverage • TypeScript
```

### 💬 send_telegram_message

**Simplest tool** - Quick text notifications:

```javascript
send_telegram_message("Deployment to production completed successfully!")
```

### ✅ send_task_completion

**Task-focused** - Rich completion notifications:

```javascript
send_task_completion({
  task_id: "deploy_v1_8_5",
  title: "Production Deployment Complete",
  results: "• Zero downtime deployment\n• 45 tests passed\n• Performance improved 23%\n• Database migration successful",
  files_affected: ["package.json", "src/config/prod.ts", "migrations/001_users.sql"],
  duration_ms: 180000  // 3 minutes
})
```

**Visual Result:**
```
*✅ Task Completed Production Deployment Complete*
⏰ 7/Aug/24 15:35
📝 • Zero downtime deployment
• 45 tests passed  
• Performance improved 23%
• Database migration successful
⏱️ 3m 0s • 3 files affected
```

### ⚡ send_performance_alert

**Monitoring-focused** - Threshold-based alerts:

```javascript
send_performance_alert({
  title: "API Response Time High",
  current_value: 1200,
  threshold: 500,
  severity: "high"
})
```

**Visual Result:**
```
*⚡ Performance Alert API Response Time High*
⏰ 7/Aug/24 15:40
📝 Current: 1200ms (threshold: 500ms)
🔴 High severity - Immediate attention needed
```

### 🤝 send_approval_request

**Interactive** - Two-way communication:

```javascript
send_approval_request({
  title: "Database Migration Required",
  description: "Ready to run migration that will add new user preferences table. This will lock the users table for ~2 minutes.",
  options: ["Approve Migration", "Defer to Maintenance", "Cancel"]
})
```

**Visual Result with Interactive Buttons:**
```
*🔐 Approval Required Database Migration Required*
⏰ 7/Aug/24 15:45
📝 Ready to run migration that will add new user preferences table. 
This will lock the users table for ~2 minutes.

[Approve Migration] [Defer to Maintenance] [Cancel]
```

---

## 🎛️ Bridge Management Tools

### 🚀 Bridge Lifecycle Management

```javascript
// Check if bridge is running
check_bridge_process()

// Start bridge if not running  
start_bridge()

// Restart bridge (stop + start)
restart_bridge()

// Smart start: only start if needed
ensure_bridge_running()

// Stop bridge gracefully
stop_bridge()
```

### 📊 Bridge Health Monitoring

```javascript
get_bridge_status()
```

**Response:**
```json
{
  "running": true,
  "health": "healthy",
  "metrics": {
    "uptime_seconds": 3600,
    "events_processed": 127,
    "telegram_messages_sent": 89,
    "error_count": 0,
    "memory_usage_mb": 45.2,
    "cpu_usage_percent": 2.3
  },
  "last_event_time": "2024-08-07T15:30:00Z"
}
```

---

## 📚 Information & Discovery Tools

### 🎯 list_event_types

**Discover all capabilities** - Browse 44+ event types:

```javascript
// All event types
list_event_types()

// Filter by category
list_event_types({ category: "task" })
list_event_types({ category: "performance" })
list_event_types({ category: "git" })
```

**Response includes:**
- Event type identifier
- User-friendly description
- Category classification
- Usage examples

### 💬 get_telegram_responses

**Monitor interactions** - See user responses:

```javascript
get_telegram_responses({ limit: 5 })
```

**Response:**
```json
{
  "count": 3,
  "responses": [
    {
      "id": "resp_001",
      "user_id": 123456789,
      "message": "Approve Migration",
      "timestamp": "2024-08-07T15:46:00Z",
      "event_id": "migration_approval_001"
    }
  ]
}
```

---

## 🔄 Advanced Workflow Integration

### 📋 Task Management Integration

CCTelegram integrates with both **Claude Code session tasks** and **TaskMaster project tasks**:

#### get_task_status - Complete Task Overview

```javascript
// All task systems
get_task_status({
  task_system: "both",        // "claude-code" | "taskmaster" | "both" 
  status_filter: "pending",   // Optional: filter by status
  summary_only: false         // true for just statistics
})
```

**Response:**
```json
{
  "claude_code_tasks": {
    "pending": 3,
    "in_progress": 1,
    "completed": 8,
    "tasks": [...]
  },
  "taskmaster_tasks": {
    "pending": 12,
    "in_progress": 2,
    "done": 45,
    "tasks": [...]
  },
  "summary": {
    "total_active": 16,
    "completion_rate": "85%"
  }
}
```

#### todo - Beautiful Task Display

```javascript
todo({
  task_system: "taskmaster",                              // Focus on TaskMaster
  sections: ["completed", "current", "upcoming"],        // What to show
  limit_completed: 5,                                     // Recent completions
  show_subtasks: true                                     // Include subtask details
})
```

**Visual Output:**
```
📋 Current Tasks Status

✅ RECENTLY COMPLETED (5 most recent)
▸ 15.3 Authentication middleware tests → DONE ⏰ 2h ago
▸ 12.1 Database connection pooling → DONE ⏰ 4h ago
▸ 8.2 API error handling → DONE ⏰ 6h ago

🔄 CURRENTLY IN PROGRESS  
▸ 16.1 User preference system → IN-PROGRESS
  ▸ 16.1.1 Database schema → DONE
  ▸ 16.1.2 API endpoints → IN-PROGRESS ⏳
  ▸ 16.1.3 Frontend integration → PENDING

📅 UPCOMING TASKS (next 3)
▸ 17.1 Push notification system
▸ 18.1 Advanced search functionality  
▸ 19.1 Performance optimization
```

### 🔍 process_pending_responses

**Approval workflow automation:**

```javascript
process_pending_responses({ since_minutes: 10 })
```

**Response:**
```json
{
  "processed": 2,
  "approvals": [
    {
      "event_id": "migration_001",
      "response": "Approve Migration",
      "timestamp": "2024-08-07T15:46:00Z",
      "action_taken": "Migration approved - ready to execute"
    }
  ],
  "pending": 0
}
```

---

## 🎮 Mode Control: Adaptive Behavior

CCTelegram has **three operational modes** for different work contexts:

### 🏠 Local Mode (Default)
**Perfect for:** Local development, focused work

```javascript
switch_to_local_mode()
```

**Behavior:**
- ✅ Essential notifications only
- ✅ Task completions and errors
- ⚠️ Reduced approval requests  
- ⚠️ Minimal performance alerts

### 🌍 Nomad Mode  
**Perfect for:** Remote work, full communication needed

```javascript
switch_to_nomad_mode()
```

**Behavior:**
- ✅ All notifications enabled
- ✅ Full interactive approvals
- ✅ Detailed progress updates
- ✅ Performance monitoring alerts
- ✅ Rich formatting and context

### 🔇 Mute Mode
**Perfect for:** Deep focus, presentation mode

```javascript
switch_to_mute_mode()
```

**Behavior:**
- 🚫 No Telegram messages sent
- ✅ Events still processed and logged
- ✅ Bridge continues running
- ✅ Can be re-enabled anytime

**Mode Switching Visual:**
```
*⚙️ Mode Changed to Nomad Mode*
⏰ 7/Aug/24 16:00
📝 CCTelegram now in full communication mode
🌍 All notifications and approvals enabled
```

---

## 🎨 Advanced Usage Patterns

### 🔄 Development Workflow Automation

**Complete feature development cycle:**

```javascript
// 1. Start feature work
send_telegram_event({
  type: "task_started",
  title: "User Avatar Upload Feature",
  description: "Implementing drag-and-drop avatar upload with image processing",
  data: { estimated_hours: 4, priority: "high" }
})

// 2. During development - code generation
send_telegram_event({
  type: "code_generation", 
  title: "Image Processing Utils Generated",
  data: { 
    files_affected: ["src/utils/image.ts", "src/components/AvatarUpload.tsx"],
    language: "typescript"
  }
})

// 3. Testing phase
send_telegram_event({
  type: "test_suite_run",
  title: "Avatar Upload Tests",
  data: {
    tests_passed: 12,
    tests_failed: 0, 
    coverage_percentage: 94.2
  }
})

// 4. Ready for review
send_approval_request({
  title: "Avatar Upload Feature Ready",
  description: "Feature complete with 94.2% test coverage. Ready for code review and deployment?",
  options: ["Approve for Review", "Request Changes", "Deploy Directly"]
})

// 5. Completion
send_task_completion({
  title: "User Avatar Upload Complete",
  results: "✅ Feature deployed\n✅ 94.2% test coverage\n✅ Performance benchmarks met\n✅ User testing positive",
  duration_ms: 14400000  // 4 hours
})
```

### 📊 Performance Monitoring Automation

**Continuous monitoring setup:**

```javascript
// CPU monitoring
send_performance_alert({
  title: "CPU Usage Elevated",
  current_value: 75.2,
  threshold: 70.0,
  severity: "medium"
})

// Memory monitoring  
send_performance_alert({
  title: "Memory Usage Critical", 
  current_value: 92.1,
  threshold: 85.0,
  severity: "high"
})

// API response time
send_performance_alert({
  title: "API Response Slow",
  current_value: 1200,
  threshold: 500, 
  severity: "critical"
})
```

### 🤝 Approval Workflow Patterns

**Different approval scenarios:**

```javascript
// Deployment approval
send_approval_request({
  title: "Production Deployment v2.1.0",
  description: "Ready to deploy:\n• 23 new features\n• 45 bug fixes\n• Breaking: API v1 deprecated\n• Downtime: ~2 minutes",
  options: ["Deploy Now", "Schedule for Maintenance", "Cancel"]
})

// Security approval
send_approval_request({
  title: "Security Certificate Renewal",
  description: "SSL certificate expires in 3 days. Automatic renewal ready.",
  options: ["Auto-Renew", "Manual Review", "Extend Current"]
})

// Code review approval
send_approval_request({
  title: "Database Schema Change",
  description: "Adding user_preferences table with foreign key constraints. Requires migration.",
  options: ["Approve Schema", "Request Changes", "Review Offline"]
})
```

---

## 🔧 Maintenance & Optimization

### 🧹 Cleanup and Maintenance

```javascript
// Clean old response files (default: 24 hours)
clear_old_responses({ older_than_hours: 48 })

// Monitor bridge health
get_bridge_status()

// Process any pending approvals
process_pending_responses({ since_minutes: 30 })
```

### 📊 Performance Monitoring

**Track your CCTelegram usage:**

```javascript
// Get detailed status
get_bridge_status()

// Check recent responses
get_telegram_responses({ limit: 20 })

// Verify event processing
// (Check ~/.cc_telegram/events/ directory)
```

---

## 🎯 Best Practices

### ✨ Notification Design

**Good notification patterns:**

```javascript
// ✅ Clear, actionable title
send_telegram_event({
  type: "build_failed",
  title: "Build Failed: Authentication Module",  // Specific and clear
  description: "TypeScript compilation error in src/auth/oauth.ts line 42",
  data: { 
    error_code: "TS2345",
    file_path: "src/auth/oauth.ts",
    line_number: 42
  }
})

// ✅ Rich context in data
send_task_completion({
  title: "API Documentation Updated",
  results: "• 15 endpoints documented\n• Interactive examples added\n• OpenAPI spec updated",
  files_affected: ["docs/api.md", "openapi.yaml"],
  duration_ms: 1800000  // 30 minutes
})
```

### 🎨 Effective Approval Requests

```javascript
// ✅ Clear options and context
send_approval_request({
  title: "Database Backup Before Migration",
  description: "About to run migration affecting 50,000 user records. Backup will take ~5 minutes.",
  options: [
    "Backup Then Migrate",    // Clear action
    "Skip Backup (Risky)",    // Shows risk
    "Cancel Migration"        // Safe option
  ]
})
```

### ⚡ Performance Considerations

```javascript
// ✅ Batch related notifications
// Instead of 5 separate file_modified events:
send_telegram_event({
  type: "code_refactoring", 
  title: "Authentication Module Refactored",
  description: "Consolidated OAuth logic and improved error handling",
  data: {
    files_affected: [
      "src/auth/oauth.ts",
      "src/auth/jwt.ts", 
      "src/auth/middleware.ts",
      "src/auth/types.ts",
      "tests/auth.test.ts"
    ]
  }
})
```

### 🔄 Mode Management

```javascript
// Switch modes based on context
switch_to_nomad_mode()     // When working remotely
switch_to_local_mode()    // When focusing locally  
switch_to_mute_mode()      // During meetings/presentations

// Always verify mode changes
get_bridge_status()        // Check current mode
```

---

## 🚀 Advanced Integration Examples

### 🏗️ CI/CD Integration

```javascript
// Build started
send_telegram_event({
  type: "build_started",
  title: "Production Build Started",
  description: "Building v2.1.0 for production deployment",
  data: { 
    branch: "release/v2.1.0",
    commit_hash: "a1b2c3d4",
    build_target: "production"
  }
})

// Build completed with metrics
send_telegram_event({
  type: "build_completed", 
  title: "Production Build Complete",
  description: "Build successful with optimizations",
  data: {
    build_time_ms: 120000,
    bundle_size_mb: 2.3,
    tests_passed: 156,
    coverage_percentage: 89.5
  }
})
```

### 🎯 Error Tracking Integration

```javascript
// Application error
send_telegram_event({
  type: "error_occurred",
  title: "Database Connection Error",
  description: "Connection pool exhausted during high traffic",
  data: {
    severity: "critical",
    error_code: "CONN_POOL_EXHAUSTED", 
    stack_trace: "...",
    affected_users: 1500,
    recovery_action: "Scaling database connections"
  }
})
```

### 📊 Analytics Integration

```javascript
// Performance metrics
send_performance_alert({
  title: "API Response Time Degraded",
  current_value: 850,
  threshold: 500,
  severity: "medium"
})

// User activity milestone
send_telegram_event({
  type: "info_notification",
  title: "Daily Active Users Milestone",
  description: "Reached 10,000 daily active users! 🎉",
  data: {
    current_dau: 10000,
    growth_rate: 15.2,
    milestone: true
  }
})
```

---

## 🎉 You're Now a CCTelegram Expert!

Congratulations! You now have complete mastery over:

```ascii
┌─ Your New Capabilities ─────────────────────────┐
│                                                 │
│  🔧 All 20+ MCP tools                          │
│  🤝 Interactive approval workflows              │
│  📊 Advanced task and performance monitoring    │
│  🎮 Smart mode switching                       │
│  ⚡ Optimized notification patterns             │
│  🔄 Complete development workflow automation    │
│                                                 │
└─────────────────────────────────────────────────┘
```

## 🚀 Next Steps

<table>
<tr>
<td width="50%">

**📚 Explore All Event Types**  
[Complete Event Reference →](event-reference.md)

*Discover all 44+ event types*  
*Visual categorization*  
*Advanced usage patterns*

</td>
<td width="50%">

**🔧 Troubleshoot Issues**  
[Troubleshooting Guide →](troubleshooting.md)

*Common problems & solutions*  
*Performance optimization*  
*Debug techniques*

</td>
</tr>
</table>

---

## 🎯 Pro Tips Summary

1. **🎨 Use descriptive titles** - Make notifications scannable
2. **📊 Include rich context** - Use the `data` field effectively  
3. **🤝 Design clear approvals** - Provide obvious action choices
4. **⚡ Batch related events** - Avoid notification spam
5. **🎮 Switch modes appropriately** - Match your work context
6. **🧹 Regular maintenance** - Clean up old responses periodically
7. **📈 Monitor performance** - Use `get_bridge_status` regularly

*🎊 You're now ready to build incredible automated workflows with CCTelegram!*
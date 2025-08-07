# 📋 CC Telegram Bridge Event System - Quick Reference
*Developer's Essential Guide to 44+ Event Types & MCP Tools*

## 🎯 **Event Types at a Glance**

### 📊 **Event Category Overview**
| Category | Count | Primary Use | Performance | Priority |
|:---------|:------|:------------|:------------|:---------|
| 📋 Task Management | 5 types | Workflow tracking | <100ms | 🔴 Critical |
| 🔨 Code Operations | 6 types | Development cycle | <200ms | 🔴 Critical |
| 📁 File System | 5 types | File monitoring | <50ms | 🟡 Medium |
| 🔨 Build & Dev | 8 types | CI/CD pipeline | <300ms | 🔴 Critical |
| 📝 Git & VCS | 7 types | Version control | <150ms | 🟡 Medium |
| 💚 System Monitoring | 5 types | Health checks | <100ms | 🔴 Critical |
| 💬 User Interaction | 3 types | Approvals | <50ms | 🔴 Critical |
| 🔄 Notifications | 4 types | Info updates | <100ms | 🟢 Low |
| 🌐 Integration | 3 types | External APIs | <200ms | 🟡 Medium |
| 🎯 Custom Events | ∞ types | User-defined | <100ms | 🟢 Variable |

### 📋 Task Management (5)
```rust
EventType::TaskCompletion    // ✅ Task completed
EventType::TaskStarted       // 🚀 Task started  
EventType::TaskFailed        // ❌ Task failed
EventType::TaskProgress      // 📊 Task progress
EventType::TaskCancelled     // 🚫 Task cancelled
```

### 🔨 Code Operations (6)
```rust
EventType::CodeGeneration    // 🔨 Code generated
EventType::CodeAnalysis      // 🔍 Code analyzed
EventType::CodeRefactoring   // 🔧 Code refactored
EventType::CodeReview        // 👁️ Code reviewed
EventType::CodeTesting       // 🧪 Code tested
EventType::CodeDeployment    // 🚀 Code deployed
```

### 📁 File System (5)
```rust
EventType::FileCreated       // 📄 File created
EventType::FileModified      // 📝 File modified
EventType::FileDeleted       // 🗑️ File deleted
EventType::DirectoryCreated  // 📁 Directory created
EventType::DirectoryDeleted  // 🗑️ Directory deleted
```

### 🔨 Build & Development (8)
```rust
EventType::BuildStarted      // 🔨 Build started
EventType::BuildCompleted    // ✅ Build completed
EventType::BuildFailed       // ❌ Build failed
EventType::TestSuiteRun      // 🧪 Test suite run
EventType::TestPassed        // ✅ Test passed
EventType::TestFailed        // ❌ Test failed
EventType::LintCheck         // 📏 Lint check
EventType::TypeCheck         // 🔍 Type check
```

### 📝 Git & Version Control (7)
```rust
EventType::GitCommit         // 📝 Git commit
EventType::GitPush           // ⬆️ Git push
EventType::GitMerge          // 🔀 Git merge
EventType::GitBranch         // 🌿 Git branch
EventType::GitTag            // 🏷️ Git tag
EventType::PullRequestCreated // 📋 PR created
EventType::PullRequestMerged  // ✅ PR merged
```

### 💚 System & Monitoring (5)
```rust
EventType::SystemHealth      // 💚 System health
EventType::PerformanceAlert  // ⚡ Performance alert
EventType::SecurityAlert     // 🔒 Security alert
EventType::ErrorOccurred     // ❌ Error occurred
EventType::ResourceUsage     // 📊 Resource usage
```

### 💬 User Interaction (3)
```rust
EventType::ApprovalRequest   // 🔐 Approval request
EventType::UserResponse      // 💬 User response
EventType::CommandExecuted   // ⚡ Command executed
```

### 🔄 Notifications (4)
```rust
EventType::ProgressUpdate    // 🔄 Progress update
EventType::StatusChange      // 🔄 Status change
EventType::AlertNotification // 🚨 Alert notification  
EventType::InfoNotification  // ℹ️ Info notification
```

### 🌐 Integration (3)
```rust
EventType::ApiCall           // 🌐 API call
EventType::WebhookReceived   // 📡 Webhook received
EventType::ServiceIntegration // 🔗 Service integration
```

### 🎯 Custom (1)
```rust
EventType::CustomEvent       // 🎯 Custom event
```

## Common Builder Methods

### Task Events
```rust
// Task completion
Event::task_completed("source", "task-id", "title", Some("results"))

// Task failure  
Event::task_failed("source", "task-id", "title", "error_type", Some("details"))

// Task progress
Event::task_progress("source", "task-id", "title", 75, Some("Step 3 of 4"))
```

### Code Events
```rust
// Code generation
Event::code_generated("source", "gen-id", "file.rs", "rust")

// Code analysis
Event::code_analyzed("source", "analysis-id", "project", vec!["file1.rs"])
```

### Build Events
```rust
// Build completion
Event::build_completed("source", "build-id", "release", 45, 0, 95.5)

// Test results
Event::test_results("source", "test-id", 50, 48, 2, 92.0, 1200)
```

### Git Events
```rust
// Git commit
Event::git_commit("source", "commit-id", "abc123", "message", "author", files)

// Git push  
Event::git_push("source", "push-id", "main", "origin", 3, vec!["abc123"])
```

### System Events
```rust
// Performance alert
Event::performance_alert("source", "alert-id", "Memory Usage", 85.5, 80.0)

// Error occurred
Event::error_occurred("source", "error-id", "title", "error message", "high")
```

### User Events
```rust
// Approval request
Event::approval_request("source", "approval-id", "title", "prompt", vec!["Yes", "No"])

// File modification
Event::file_modified("source", "mod-id", "src/main.rs", "rust")
```

## Validation Rules

### Required Fields (All Events)
- `source` - Cannot be empty
- `task_id` - Cannot be empty  
- `title` - Cannot be empty

### Event-Specific Requirements
```rust
// Approval requests
ApprovalRequest => approval_prompt + options required

// Test events  
TestPassed|TestFailed|TestSuiteRun => test_count required

// Git commits
GitCommit => commit_hash + commit_message required

// Errors
ErrorOccurred => error_message required

// Alerts
PerformanceAlert|SecurityAlert => severity required
```

### Valid Values
```rust
// Severity levels
"low" | "medium" | "high" | "critical"

// Priority levels  
"low" | "normal" | "high" | "urgent"
```

## Utility Methods

### Event Analysis
```rust
let event = Event::performance_alert(/*...*/);

event.get_priority()        // -> "high" 
event.get_severity()        // -> "critical"
event.is_critical()         // -> true
event.requires_user_interaction() // -> false
event.get_category()        // -> "performance"
event.get_summary()         // -> "⚡ Performance Alert: Memory Usage..."
```

### Serialization
```rust
// To JSON
let json = event.to_json()?;

// From JSON
let event = Event::from_json(&json)?;
```

### EventType Utilities
```rust
// All event types
let all = EventType::all();

// Display name
EventType::CodeGeneration.display_name() // -> "Code Generated"
```

## Common Patterns

### Basic Event Creation
```rust
let event = Event::new(
    EventType::TaskCompletion,
    "claude-code",
    "task-001", 
    "Task Complete",
    "Successfully completed user authentication module"
);
```

### With Custom Data
```rust
let mut event = Event::task_completed(/*...*/);
event.data.duration_ms = Some(5000);
event.data.memory_usage_mb = Some(45.2);
```

### Error Handling
```rust
match event.validate() {
    Ok(()) => {
        // Process event
        processor.process_event(event).await?;
    }
    Err(msg) => {
        log::error!("Invalid event: {}", msg);
    }
}
```

## Telegram Message Formatting

### Professional Message Design

All messages use a modern, professional format with:
- **Bold headers** using markdown `*text*` formatting
- **Clean timestamps** in `2/Aug/25 23:42` format
- **Consistent layout** with structured three-line format

### Message Structure
```
*{emoji} {Event Name} {Title}*
⏰ {timestamp}
📝 {description/details}
```

### Format Examples

**Task Completion:**
```
*✅ Task Completed Deploy Authentication*
⏰ 2/Aug/25 23:42
📝 Authentication module deployed successfully
```

**Approval Request:**
```
*🔐 System Update Request*
⏰ 2/Aug/25 23:45
📝 Approval Required System Update Request

Please approve the maintenance window.
```

**Progress Update:**
```
*📊 Progress Update Data Migration*
⏰ 2/Aug/25 23:50
📝 Migration is 75% complete. Processing user data...
```

**Build Completion:**
```
*✅ Build Completed Release Build Complete*
⏰ 2/Aug/25 23:55
📝 Production build finished successfully
```

**Performance Alert:**
```
*⚡ Performance Alert Memory Usage Alert*
⏰ 2/Aug/25 23:58
📝 Memory usage exceeded 80MB threshold
```

### Timestamp Format
- **Format**: `%d/%b/%y %H:%M`
- **Example**: `2/Aug/25 23:42`
- **Timezone**: UTC (automatically converted)

## Configuration

### Performance Thresholds
```toml
[performance]
memory_threshold_mb = 100
cpu_threshold_percent = 80.0
event_processing_threshold_ms = 1000
```

### Monitoring  
```toml
[monitoring]
health_check_port = 8080
enable_metrics_server = true
```

## Testing

### Run Tests
```bash
cargo test                    # All tests
cargo test events::types      # Event system tests
cargo test integration_tests  # Integration tests
```

### Test Structure
- **32 unit tests** - Event creation, validation, utilities
- **6 integration tests** - End-to-end workflows

## Troubleshooting

### Common Issues
1. **Validation Error** - Check required fields for event type
2. **Pattern Match** - Add wildcard `_ =>` for exhaustive matching  
3. **Serialization** - Ensure all data is JSON-compatible

### Debug Commands
```bash
# Check compilation
cargo check

# Build with warnings
cargo build

# Run specific test
cargo test test_event_validation
```

---

*Quick reference for CC Telegram Bridge Event System v0.8.5*
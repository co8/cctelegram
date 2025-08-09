# CCTelegram - Complete System Architecture

## System Overview

CCTelegram is a comprehensive notification ecosystem that bridges Claude Code with Telegram through two complementary components: an MCP Server (TypeScript) for direct Claude Code integration, and a Bridge (Rust) for high-performance Telegram communication.

## Complete System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Claude Code   │    │   MCP Server    │    │   Bridge App    │    │  Telegram Bot   │
│                 │    │  (TypeScript)   │    │   (Rust Daemon) │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │MCP Tools    │◄┼────┼►│MCP Protocol │◄┼────┼►│File Watcher │ │    │ │Bot Client   │ │
│ │@cctelegram  │ │    │ │Handler      │ │    │ │             │ │    │ │             │ │
│ └─────────────┘ │    │ └─────┬───────┘ │    │ └─────┬───────┘ │    │ └─────▲───────┘ │
└─────────────────┘    │ ┌─────▼───────┐ │    │ ┌─────▼───────┐ │    └───────┼─────────┘
                       │ │Event File   │ │    │ │Event        │ │            │
                       │ │Generator    │ │    │ │Processor    │ │    ┌───────▼───────┐
                       │ └─────────────┘ │    │ └─────┬───────┘ │    │  Telegram API │
                       └─────────────────┘    │ ┌─────▼───────┐ │    └───────┬───────┘
                                              │ │Telegram Bot │ │            │
           ~/.cc_telegram/                    │ │Client       │ │    ┌───────▼───────┐
      ┌─────────────────────┐                │ └─────────────┘ │    │   User Device │
      │events/              │◄───────────────┤                 │    │               │
      │├─ task_123.json     │                │ ┌─────────────┐ │    │ ┌───────────┐ │
      │├─ approval_456.json │                │ │Response     │ │    │ │Telegram   │ │
      │└─ progress_789.json │                │ │Handler      │ │    │ │App        │ │
      │                     │                │ └─────▲───────┘ │    │ └───────────┘ │
      │responses/           │◄───────────────┤       │         │    └───────────────┘
      │├─ approval_456.json │                │       │         │
      │└─ command_890.json  │                └───────┼─────────┘
      └─────────────────────┘                        │
                                              ┌──────▼──────┐
                                              │  Response   │
                                              │   Files     │
                                              └─────────────┘
```

## Core Components

### 1. Bridge Application (Rust Daemon)

The central hub that orchestrates all communication between development tools and Telegram.

#### Modules Structure
```
src/
├── main.rs              # Application entry point and daemon setup
├── config.rs            # Configuration management and validation
├── events/
│   ├── mod.rs          # Event handling module exports
│   ├── watcher.rs      # File system monitoring
│   ├── processor.rs    # Event parsing and validation
│   └── types.rs        # Event type definitions
├── telegram/
│   ├── mod.rs          # Telegram integration exports
│   ├── bot.rs          # Bot API client and connection management
│   ├── messages.rs     # Message formatting and templates
│   └── handlers.rs     # Callback and response handlers
├── storage/
│   ├── mod.rs          # Storage abstraction
│   ├── file_store.rs   # File-based storage implementation
│   └── queue.rs        # Event queue management
└── utils/
    ├── mod.rs          # Utility exports
    ├── logger.rs       # Structured logging setup
    ├── security.rs     # Authentication and validation
    └── errors.rs       # Error types and handling
```

#### Key Responsibilities
- **File System Monitoring**: Watch `~/.cc_telegram/events/` for new event files
- **Event Processing**: Parse, validate, and queue events for processing
- **Telegram Communication**: Send formatted messages and handle user responses
- **Response Management**: Process user actions and write response files
- **Security Enforcement**: Authenticate users and validate all operations

### 2. Event Communication System

#### Event File Format
```json
{
  "type": "task_completion|approval_request|progress_update",
  "source": "claude_code|vscode",
  "timestamp": "2024-01-15T10:30:00Z",
  "task_id": "unique_identifier",
  "title": "Human readable task title",
  "description": "Detailed task description",
  "data": {
    "status": "completed|failed|requires_approval",
    "results": "Task execution results or summary",
    "approval_prompt": "What needs approval?",
    "options": ["approve", "deny", "details"],
    "metadata": {
      "duration": "2m34s",
      "files_affected": 15,
      "error_count": 3
    }
  }
}
```

#### Response File Format
```json
{
  "event_id": "task_123",
  "user_id": "telegram_user_id",
  "timestamp": "2024-01-15T10:35:00Z",
  "response": "approve|deny|details",
  "metadata": {
    "response_time": "4.2s",
    "user_agent": "Telegram iOS"
  }
}
```

### 3. Claude Code Integration

#### Hook System Design
```rust
// Event emission trait for Claude Code integration
pub trait EventEmitter {
    fn emit_task_completion(&self, task: &Task, result: &TaskResult);
    fn emit_approval_request(&self, request: &ApprovalRequest) -> ApprovalResponse;
    fn emit_progress_update(&self, task: &Task, progress: &Progress);
}

// File-based implementation
pub struct FileEventEmitter {
    events_dir: PathBuf,
}

impl FileEventEmitter {
    pub fn new(events_dir: PathBuf) -> Self {
        Self { events_dir }
    }
    
    fn write_event(&self, event: &Event) -> Result<(), EventError> {
        let file_path = self.events_dir.join(format!("{}_{}.json", 
            event.event_type, event.task_id));
        let json = serde_json::to_string_pretty(event)?;
        fs::write(file_path, json)?;
        Ok(())
    }
}
```

#### Integration Points
1. **Task Lifecycle Hooks**: Emit events at task start, completion, and failure
2. **Approval Integration**: Pause execution pending user response
3. **Progress Reporting**: Periodic updates for long-running tasks
4. **Error Handling**: Emit error events with context and recovery options

### 4. VSCode Extension

#### Extension Architecture
```typescript
// Main extension entry point
export function activate(context: vscode.ExtensionContext) {
    const bridge = new TelegramBridge();
    
    // File system watcher
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    watcher.onDidCreate(uri => bridge.emitFileEvent('created', uri));
    watcher.onDidChange(uri => bridge.emitFileEvent('modified', uri));
    
    // Terminal watcher for Claude Code detection
    vscode.window.onDidChangeActiveTerminal(terminal => {
        if (terminal && bridge.isClaudeCodeTerminal(terminal)) {
            bridge.startTerminalMonitoring(terminal);
        }
    });
    
    // Custom commands
    vscode.commands.registerCommand('telegram-bridge.sendNotification', 
        (message: string) => bridge.sendNotification(message));
}

class TelegramBridge {
    private eventsDir: string;
    
    constructor() {
        this.eventsDir = path.join(os.homedir(), '.cc_telegram', 'events');
    }
    
    emitFileEvent(type: string, uri: vscode.Uri) {
        const event = {
            type: 'file_change',
            source: 'vscode',
            timestamp: new Date().toISOString(),
            data: { type, path: uri.fsPath }
        };
        this.writeEvent(event);
    }
    
    private writeEvent(event: any) {
        const filename = `vscode_${Date.now()}.json`;
        const filepath = path.join(this.eventsDir, filename);
        fs.writeFileSync(filepath, JSON.stringify(event, null, 2));
    }
}
```

### 5. Telegram Bot Integration

#### Bot Client Implementation
```rust
use teloxide::{Bot, RequestError, types::{InlineKeyboardButton, InlineKeyboardMarkup}};

pub struct TelegramClient {
    bot: Bot,
    allowed_users: HashSet<i64>,
}

impl TelegramClient {
    pub fn new(token: String, allowed_users: Vec<i64>) -> Self {
        Self {
            bot: Bot::new(token),
            allowed_users: allowed_users.into_iter().collect(),
        }
    }
    
    pub async fn send_task_completion(&self, user_id: i64, event: &TaskCompletionEvent) 
        -> Result<(), RequestError> {
        
        let message = self.format_completion_message(event);
        let keyboard = self.create_completion_keyboard(event);
        
        self.bot
            .send_message(user_id, message)
            .reply_markup(keyboard)
            .await?;
            
        Ok(())
    }
    
    pub async fn send_approval_request(&self, user_id: i64, event: &ApprovalEvent)
        -> Result<(), RequestError> {
        
        let message = self.format_approval_message(event);
        let keyboard = self.create_approval_keyboard(event);
        
        self.bot
            .send_message(user_id, message)
            .reply_markup(keyboard)
            .await?;
            
        Ok(())
    }
    
    fn create_approval_keyboard(&self, event: &ApprovalEvent) -> InlineKeyboardMarkup {
        InlineKeyboardMarkup::new([
            [
                InlineKeyboardButton::callback("✅ Approve", format!("approve_{}", event.task_id)),
                InlineKeyboardButton::callback("❌ Deny", format!("deny_{}", event.task_id)),
            ],
            [
                InlineKeyboardButton::callback("📄 Details", format!("details_{}", event.task_id)),
            ]
        ])
    }
}
```

## Data Flow Architecture

### 1. Event Processing Pipeline

```
Event Detection → Validation → Processing → Notification → Response → Action
     ↓              ↓           ↓             ↓            ↓         ↓
File Watcher → JSON Parse → Event Queue → Telegram API → User → Claude Code
  (<100ms)     (<50ms)      (async)       (<5s)       (human)   (<2s)
```

### 2. Security Architecture

#### Authentication Flow
```
Telegram Message → User ID Check → Whitelist Validation → Rate Limiting → Processing
                      ↓                    ↓                    ↓
                 Block/Log         Allow/Continue         Throttle/Queue
```

#### Security Layers
1. **Network Security**: HTTPS for all Telegram API communication
2. **Authentication**: Telegram user ID whitelist validation
3. **Authorization**: Action-based permissions (view, approve, admin)
4. **Input Validation**: Sanitize all user inputs and file contents
5. **Audit Logging**: Comprehensive logging of all security events
6. **File System Security**: Restrictive permissions on event directories

### 3. Error Handling Strategy

#### Error Categories
```rust
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("Configuration error: {0}")]
    Config(String),
    
    #[error("File system error: {0}")]
    FileSystem(#[from] std::io::Error),
    
    #[error("Telegram API error: {0}")]
    Telegram(#[from] teloxide::RequestError),
    
    #[error("Event processing error: {0}")]
    EventProcessing(String),
    
    #[error("Authentication error: {0}")]
    Authentication(String),
}
```

#### Recovery Strategies
- **Network Failures**: Exponential backoff with jitter
- **File System Issues**: Retry with alternative paths
- **API Rate Limits**: Queue management with priority
- **Parse Errors**: Log and skip malformed events
- **Authentication Failures**: Block and audit log

## Performance Architecture

### Scalability Targets
- **Concurrent Events**: Handle 100+ simultaneous events
- **Response Time**: <100ms for file system events, <5s for notifications
- **Memory Usage**: <50MB baseline, <100MB under load
- **CPU Usage**: <5% idle, <20% under load
- **Throughput**: 1000+ events per hour

### Optimization Strategies
1. **Async Processing**: Tokio runtime for non-blocking I/O
2. **Event Batching**: Group similar events to reduce API calls
3. **Connection Pooling**: Reuse Telegram API connections
4. **Caching**: Cache user preferences and message templates
5. **Memory Management**: Zero-copy parsing where possible

## Deployment Architecture

### Service Management
```bash
# macOS (launchd)
~/Library/LaunchAgents/com.cctelegram.bridge.plist

# Linux (systemd)
~/.config/systemd/user/cc-telegram-bridge.service

# Manual (tmux)
tmux new-session -d -s cctelegram './cc-telegram-bridge'
```

### Configuration Management
**Environment Variables** (recommended for sensitive data):
```bash
# .env file
TELEGRAM_BOT_TOKEN="your_bot_token_here"
TELEGRAM_ALLOWED_USERS="123456789,987654321"
CC_TELEGRAM_EVENTS_DIR="/custom/events/path"
CC_TELEGRAM_RESPONSES_DIR="/custom/responses/path"
```

**Configuration File** (for non-sensitive settings):
```toml
# ~/.cc_telegram/config.toml
[telegram]
# Loaded from environment variables

[paths]
# Loaded from environment variables
responses_dir = "~/.cc_telegram/responses"

[notifications]
task_completion = true
approval_requests = true
progress_updates = false

[security]
rate_limit_requests = 30
rate_limit_window = 60
audit_log = true
```

## Testing Architecture

### Test Strategy
1. **Unit Tests**: Individual module functionality
2. **Integration Tests**: Cross-module interactions
3. **End-to-End Tests**: Full workflow simulation
4. **Performance Tests**: Load and stress testing
5. **Security Tests**: Authentication and authorization

### Test Environment
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio_test;
    
    #[tokio::test]
    async fn test_event_processing() {
        let temp_dir = TempDir::new().unwrap();
        let processor = EventProcessor::new(temp_dir.path());
        
        // Test event processing logic
        let event = create_test_event();
        let result = processor.process_event(event).await;
        
        assert!(result.is_ok());
    }
}
```

This architecture provides a robust, scalable, and secure foundation for the Claude Code Telegram Bridge, ensuring reliable remote development workflow integration.
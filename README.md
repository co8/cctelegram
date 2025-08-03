# CCTelegram MCP Server

[![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)](https://www.rust-lang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/co8/cc-telegram) [![Event System](https://img.shields.io/badge/events-44%2B%20types-blue.svg)](#-comprehensive-event-system) [![Tests](https://img.shields.io/badge/tests-38%20passing-green.svg)](#-testing) [![MCP](https://img.shields.io/badge/MCP-v1.1.1-purple.svg)](#-mcp-integration)

**Model Context Protocol (MCP) server for seamless Telegram integration with Claude Code.** The primary interface for developers - automatically manages the CCTelegram Bridge as a background process while providing comprehensive development monitoring, real-time notifications, and remote interaction capabilities through Telegram.

## 🚀 Features

### 🎯 Comprehensive Event System
- **44+ Event Types**: Complete coverage of development lifecycle including task management, code operations, file system changes, build processes, git operations, system monitoring, and user interactions
- **10 Event Categories**: Organized event types covering Task Management, Code Operations, File System, Build & Development, Git & Version Control, System & Monitoring, User Interaction, Notifications, Integration, and Custom events
- **Builder Pattern API**: 15+ specialized builder methods for easy event creation with type safety
- **Advanced Validation**: Event-type specific validation with severity levels and priority handling

### 🤖 Intelligent Telegram Integration
- **Real-time Notifications**: Instant notifications for all development events with rich formatting and emojis
- **Concise Message Format**: Optimized single-line format with 40% shorter messages while preserving essential information
- **Configurable Message Styles**: Choose between "concise" (default) or "detailed" formatting via configuration
- **Interactive Messaging**: Approve actions, respond to prompts, and get status updates through inline keyboards
- **Smart Response Processing**: Automated detection and handling of user approvals/denials with clean formatting
- **Configurable Timezone Support**: All timestamps display in your configured timezone (default: Europe/Berlin)
- **Professional Message Design**: Format: "*emoji title* ⏰ timestamp\ndescription" for maximum readability
- **Fallback Support**: Generic notification system handles unknown event types gracefully

### 🔒 Enterprise Security & Authentication
- **Multi-User Access Control**: User-based authentication with Telegram user ID validation
- **Advanced Rate Limiting**: Configurable request limits per user with intelligent throttling
- **Comprehensive Input Validation**: Security-first approach with input sanitization and validation
- **Audit Logging**: Complete security event tracking and monitoring for compliance

### 📊 Advanced Performance & Monitoring
- **Prometheus Integration**: Built-in metrics collection for monitoring and alerting
- **Multi-Endpoint Health Checks**: HTTP endpoints (`/health`, `/metrics`, `/report`, `/ready`, `/live`) for comprehensive monitoring
- **Real-time Performance Tracking**: CPU, memory, and processing time monitoring with intelligent alerting
- **Performance Optimization**: Automated performance analysis with actionable recommendations

### 🚀 Production-Ready Infrastructure
- **Robust Error Handling**: Comprehensive error handling with graceful degradation
- **Flexible Configuration**: TOML-based config with environment variable overrides and auto-creation
- **Deployment Tools**: Performance monitoring scripts, health checks, and deployment validation
- **Scalable Architecture**: Modular design supporting high-throughput event processing

### 🎛️ Model Context Protocol (MCP) Server (v1.1.1) - Primary Interface
- **Claude Code Native Integration**: Primary interface for developers - MCP server manages everything automatically
- **Automated Bridge Management**: Automatically starts, monitors, and manages the CCTelegram Bridge process
- **Hands-Free Operation**: Users interact only with MCP tools - bridge runs transparently in background
- **Intelligent Response Processing**: Process pending approvals/denials with actionable insights
- **Health Monitoring**: Continuous bridge health checks with automatic restart capabilities
- **Smart Discovery**: Automatically locates bridge executable across multiple installation paths
- **Zero Configuration**: MCP server handles all bridge configuration and lifecycle management

**Available MCP Tools:**
- `send_telegram_message` - Send simple notifications
- `send_telegram_event` - Send structured events with rich data
- `send_task_completion` - Send task completion notifications with results
- `send_approval_request` - Request approvals with interactive buttons
- `send_performance_alert` - Send performance alerts with thresholds
- `get_telegram_responses` - Retrieve user responses and interactions
- `process_pending_responses` - **NEW** Process and analyze pending approvals/denials
- `get_bridge_status` - Check bridge health and metrics
- `start_bridge/stop_bridge/restart_bridge` - Bridge process management
- `ensure_bridge_running` - Ensure bridge is running, start if needed
- `clear_old_responses` - Clean up old response files

**Benefits:** Complete remote development workflow with zero-configuration setup. MCP server handles all complexity - users simply call MCP tools and receive Telegram notifications. Perfect for remote work and development monitoring!

### 🆕 Latest Improvements (v0.4.4)
- **Concise Messaging System**: Configurable message styles with 40% reduction in message length
- **Smart Text Truncation**: Intelligent title (20-25 chars) and description (40-60 chars) limits
- **Optimized Message Format**: Single-line "*emoji title* ⏰ timestamp\ndescription" format
- **Configurable Timezone Support**: Set custom timezone via CC_TELEGRAM_TIMEZONE environment variable
- **Message Style Control**: Toggle between "concise" (default) and "detailed" via CC_TELEGRAM_MESSAGE_STYLE
- **Enhanced User Experience**: Shorter, more readable messages while preserving essential information
- **MCP-First Architecture**: Users interact with MCP server, bridge managed automatically in background

## 📋 Prerequisites

- **Rust 1.70+** - [Install Rust](https://rustup.rs/)
- **Telegram Bot Token** - Create via [@BotFather](https://t.me/botfather)
- **Your Telegram User ID** - Get from [@userinfobot](https://t.me/userinfobot)

### System Dependencies

```bash
# macOS
brew install curl jq bc

# Ubuntu/Debian
sudo apt-get install curl jq bc

# CentOS/RHEL
sudo yum install curl jq bc
```

## ⚡ Quick Start

**🚀 Get up and running in under 10 minutes!** See the complete [QUICKSTART.md](QUICKSTART.md) guide for detailed step-by-step instructions.

### 1. Setup Telegram Bot

1. Create bot with [@BotFather](https://t.me/botfather): `/newbot`
2. Get your user ID from [@userinfobot](https://t.me/userinfobot)
3. Save both tokens for the next step

### 2. Build and Configure

```bash
# Clone and build (takes ~2 minutes)
git clone https://github.com/co8/cc-telegram.git
cd cc-telegram
cargo build --release

# Configure credentials (replace with your actual values)
export TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
export TELEGRAM_ALLOWED_USERS="123456789"
```

### 3. Start and Test

```bash
# Start the bridge
./target/release/cctelegram-bridge

# In another terminal, send a test event
mkdir -p ~/.cc_telegram/events
cat > ~/.cc_telegram/events/test.json << 'EOF'
{
  "type": "task_completion",
  "source": "quickstart_test",
  "timestamp": "2024-07-31T20:30:00Z",
  "task_id": "test_123",
  "title": "🎉 CC Telegram Bridge Test",
  "description": "Your bridge is working perfectly!",
  "data": {
    "status": "completed",
    "results": "✅ Connection established\n✅ Bot responding\n✅ Events processing"
  }
}
EOF
```

**🎉 You should receive a Telegram notification within seconds!**

### 4. Monitor and Deploy

```bash
# Check system health
./performance_monitor.sh monitor

# Verify deployment readiness
./performance_monitor.sh deployment-check
```

For complete setup instructions, production deployment, troubleshooting, and advanced configuration, see **[QUICKSTART.md](QUICKSTART.md)**.

## 🎯 Comprehensive Event System

The CC Telegram Bridge features a **complete 44+ event type system** covering the entire development lifecycle:

### Event Categories
- **📋 Task Management** (5 events): Task lifecycle from start to completion/failure
- **🔨 Code Operations** (6 events): Generation, analysis, refactoring, review, testing, deployment
- **📁 File System** (5 events): File and directory create/modify/delete operations
- **🔨 Build & Development** (8 events): Build process, testing, linting, type checking
- **📝 Git & Version Control** (7 events): Commits, pushes, merges, branches, PRs
- **💚 System & Monitoring** (5 events): Health checks, performance alerts, resource usage
- **💬 User Interaction** (3 events): Approval requests, responses, command execution
- **🔄 Notifications** (4 events): Progress updates, status changes, alerts
- **🌐 Integration** (3 events): API calls, webhooks, service integrations
- **🎯 Custom Events** (1 event): User-defined custom events

### Quick Examples

```rust
// Task completion with results
let event = Event::task_completed(
    "claude-code", "task-001", "Authentication Module Complete",
    Some("Generated OAuth2 implementation with 100% test coverage")
);

// Performance alert with threshold
let event = Event::performance_alert(
    "monitoring", "alert-001", "Memory Usage", 85.5, 80.0
);

// Git commit with file changes
let event = Event::git_commit(
    "git", "commit-001", "abc123", "feat: add OAuth2 auth",
    "developer@example.com", vec!["src/auth.rs", "tests/auth_test.rs"]
);
```

**📚 Complete Documentation**: See [docs/EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) for comprehensive usage examples and [docs/QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md) for daily reference.

## 📁 Project Structure

```
cc-telegram/
├── src/
│   ├── config/          # Configuration management
│   ├── events/          # Comprehensive event system (44+ types)
│   │   ├── types.rs     # Event types, builders, validation (32 tests)
│   │   ├── processor.rs # Event processing and routing
│   │   └── watcher.rs   # File system monitoring
│   ├── telegram/        # Telegram bot integration
│   ├── storage/         # File operations & data persistence  
│   ├── utils/           # Security, logging, performance monitoring
│   ├── lib.rs           # Library interface
│   └── main.rs          # Application entry point
├── docs/                # Comprehensive documentation
│   ├── EVENT_SYSTEM.md  # Complete event system documentation
│   ├── QUICK_REFERENCE.md # Daily reference guide
│   └── IMPLEMENTATION_SUMMARY.md # Technical implementation details
├── tests/               # Integration tests (6 tests)
├── QUICKSTART.md        # 10-minute setup guide
├── CHANGELOG.md         # Version history and features
├── performance_monitor.sh # Monitoring & optimization script
├── config.example.toml  # Example configuration
└── example_event.json   # Sample event format
```

## ⚙️ Configuration

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN="your_bot_token"
TELEGRAM_ALLOWED_USERS="123456789,987654321"  # Comma-separated user IDs

# Optional customization
CC_TELEGRAM_TIMEZONE="America/New_York"        # Default: Europe/Berlin
CC_TELEGRAM_MESSAGE_STYLE="concise"            # Options: concise|detailed

# Optional paths
CC_TELEGRAM_EVENTS_DIR="/custom/events/path"
CC_TELEGRAM_RESPONSES_DIR="/custom/responses/path"
```

### Configuration File

The application creates `~/.cc_telegram/config.toml` on first run. **Note**: Sensitive configuration (bot token, user IDs, paths) should be set in the `.env` file for security.

```toml
[telegram]
# Configuration loaded from environment variables:
# TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS
timezone = "Europe/Berlin"           # Configurable timezone
message_style = "concise"            # Options: "concise" (default), "detailed"

[paths]
# Paths loaded from environment variables:
# CC_TELEGRAM_EVENTS_DIR, CC_TELEGRAM_RESPONSES_DIR

[notifications]
task_completion = true
approval_requests = true
progress_updates = false

[security]
rate_limit_requests = 30
rate_limit_window = 60
audit_log = true

[performance]
memory_threshold_mb = 100
cpu_threshold_percent = 80.0
event_processing_threshold_ms = 1000
telegram_response_threshold_ms = 5000
metrics_collection_interval_seconds = 30
enable_detailed_logging = false

[monitoring]
health_check_port = 8080
enable_metrics_server = true
metrics_endpoint = "/metrics"
health_endpoint = "/health"
```

## 🔧 Usage

### Starting the Bridge

```bash
# Production mode
./target/release/cctelegram-bridge

# Development mode with detailed logging
RUST_LOG=info cargo run

# Via MCP server (RECOMMENDED - primary interface)
# Bridge is managed automatically - use MCP tools for all interactions
```

### Event Processing

The system supports **44+ event types** across 10 categories. Place JSON event files in the events directory (`~/.cc_telegram/events/`):

#### Task Completion Example
```json
{
  "type": "task_completion",
  "source": "claude_code",
  "timestamp": "2024-07-31T20:30:00Z",
  "task_id": "task_123",
  "title": "Code Analysis Complete",
  "description": "Finished analyzing the codebase",
  "data": {
    "status": "completed",
    "results": "Found 5 optimization opportunities",
    "duration_ms": 154000,
    "files_affected": ["src/main.rs", "src/lib.rs"],
    "memory_usage_mb": 45.2
  }
}
```

#### Performance Alert Example
```json
{
  "type": "performance_alert",
  "source": "monitoring",
  "timestamp": "2024-07-31T20:35:00Z",
  "task_id": "alert_456",
  "title": "Memory Usage Alert",
  "description": "Memory usage exceeded threshold",
  "data": {
    "severity": "high",
    "memory_usage_mb": 85.5,
    "cpu_usage_percent": 75.2,
    "error_message": "Memory usage above 80MB threshold"
  }
}
```

#### Build Completion Example
```json
{
  "type": "build_completed",
  "source": "cargo",
  "timestamp": "2024-07-31T20:40:00Z",
  "task_id": "build_789",
  "title": "Release Build Complete",
  "description": "Production build finished successfully",
  "data": {
    "status": "completed",
    "build_target": "release",
    "duration_ms": 45000,
    "test_count": 38,
    "tests_passed": 38,
    "tests_failed": 0,
    "coverage_percentage": 95.5
  }
}
```

### Telegram Interactions

- **📱 Real-time Notifications**: Receive instant notifications with rich formatting and context-appropriate emojis
- **🎛️ Interactive Controls**: Approve/deny actions using inline keyboards with custom options
- **📊 Detailed Reports**: Get comprehensive event details including performance metrics and file changes
- **🔍 System Monitoring**: Monitor health, performance alerts, and resource usage in real-time
- **⚡ Quick Actions**: Execute commands and receive immediate feedback through the bot interface

### Event Categories Supported

| Category | Events | Example Use Cases |
|----------|--------|-------------------|
| 📋 **Task Management** | 5 types | Claude Code task lifecycle tracking |
| 🔨 **Code Operations** | 6 types | Code generation, analysis, refactoring |
| 📁 **File System** | 5 types | File/directory monitoring and changes |
| 🔨 **Build & Development** | 8 types | Build processes, testing, linting |
| 📝 **Git Operations** | 7 types | Version control activities and PR management |
| 💚 **System Monitoring** | 5 types | Health checks, performance, security alerts |
| 💬 **User Interaction** | 3 types | Approval workflows and command execution |
| 🔄 **Notifications** | 4 types | Progress updates and status changes |
| 🌐 **Integration** | 3 types | API calls, webhooks, service integrations |
| 🎯 **Custom Events** | 1 type | User-defined custom notifications |

**📖 For detailed event documentation and examples**, see [docs/EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) and [docs/QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md).

## 📊 Monitoring & Performance

### Health Check Endpoints

```bash
# Health status
curl http://localhost:8080/health

# Prometheus metrics
curl http://localhost:8080/metrics

# Performance report
curl http://localhost:8080/report
```

### Performance Monitoring Script

```bash
# One-time performance check
./performance_monitor.sh monitor

# Continuous monitoring (every 30 seconds)
./performance_monitor.sh continuous 30

# Performance optimization suggestions
./performance_monitor.sh optimize

# Deployment readiness check
./performance_monitor.sh deployment-check
```

### Metrics Available

- **Event Processing**: Total events, processing time, error rates
- **Telegram API**: Message counts, response times, API errors
- **System Resources**: CPU usage, memory consumption, uptime
- **Performance**: Throughput, latency percentiles, bottleneck detection

## 🔒 Security

### Authentication

- User-based access control via Telegram user IDs
- Rate limiting to prevent abuse
- Input sanitization and validation
- Audit logging for security events

### Best Practices

- Use environment variables for sensitive configuration
- Regularly rotate bot tokens
- Monitor access logs for suspicious activity
- Keep allowed user list minimal and up-to-date

## 🧪 Testing

The project features a comprehensive test suite with **38 passing tests** covering all major functionality:

```bash
# Run all tests
cargo test

# Run with verbose output and timing
cargo test -- --nocapture --test-threads=1

# Run specific test categories
cargo test events::types::tests      # Event system tests (32 tests)
cargo test integration_tests        # Integration tests (6 tests)
cargo test performance_monitor      # Performance monitoring tests
```

### Comprehensive Test Coverage

#### 📋 Unit Tests (32 tests)
- **Event Creation**: Builder patterns, validation, serialization
- **Event Types**: All 44+ event types with specific validation rules
- **Utility Methods**: Event analysis, categorization, priority handling
- **Action Buttons**: Interactive message components
- **Edge Cases**: Error conditions, invalid data, boundary conditions

#### 🔄 Integration Tests (6 tests)
- **End-to-End Workflows**: Complete event processing pipelines
- **File Storage Operations**: Event persistence and retrieval
- **Configuration Loading**: Config validation and environment variables
- **Telegram Bot Validation**: User authentication and message handling
- **Security Manager**: Rate limiting and input validation
- **Performance Monitoring**: Health checks and metrics collection

#### 📊 Test Results Summary
- **✅ Total Tests**: 38 tests passing
- **🎯 Event System**: 32 comprehensive unit tests
- **🔄 Integration**: 6 end-to-end workflow tests
- **📈 Coverage**: Core functionality, edge cases, error conditions
- **🚀 Performance**: All tests complete in <2 seconds

### Running Specific Tests

```bash
# Test event creation and validation
cargo test test_event_creation

# Test event builder patterns
cargo test test_event_builders

# Test performance monitoring
cargo test test_performance_monitor

# Test with detailed output
RUST_LOG=debug cargo test -- --nocapture
```

### Test Quality Metrics
- **🎯 Functionality Coverage**: All major features tested
- **🔍 Edge Case Testing**: Invalid inputs, boundary conditions
- **⚡ Performance Testing**: Resource usage and response times
- **🔒 Security Testing**: Input validation and rate limiting
- **🔄 Integration Testing**: End-to-end workflow validation

## 🐛 Troubleshooting

### Common Issues

**Bot not responding:**

```bash
# Check bot token
echo $TELEGRAM_BOT_TOKEN

# Verify bot permissions with @BotFather
# Ensure bot can send messages
```

**Events not processing:**

```bash
# Check events directory
ls -la ~/.cc_telegram/events/

# Verify file permissions
chmod 755 ~/.cc_telegram/events/

# Check application logs
tail -f ~/.cc_telegram/logs/application.log
```

**Performance issues:**

```bash
# Check system resources
./performance_monitor.sh monitor

# View detailed metrics
curl http://localhost:8080/report | jq
```

### Debug Mode

```bash
# Enable detailed logging
RUST_LOG=debug cargo run

# Enable performance detailed logging
# Edit config.toml: enable_detailed_logging = true
```

## 📚 API Reference & Documentation

### 📖 Complete Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - 10-minute setup guide with step-by-step instructions
- **[docs/EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md)** - Comprehensive event system documentation (5,000+ words)
- **[docs/QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md)** - Daily reference guide with examples (1,000+ words)
- **[docs/IMPLEMENTATION_SUMMARY.md](docs/IMPLEMENTATION_SUMMARY.md)** - Technical implementation details and metrics
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and feature updates

### 🎯 Event System API

#### Core Event Types (44+ total)
- **📋 Task Management**: `task_completion`, `task_started`, `task_failed`, `task_progress`, `task_cancelled`
- **🔨 Code Operations**: `code_generation`, `code_analysis`, `code_refactoring`, `code_review`, `code_testing`, `code_deployment`
- **📁 File System**: `file_created`, `file_modified`, `file_deleted`, `directory_created`, `directory_deleted`
- **🔨 Build & Development**: `build_started`, `build_completed`, `build_failed`, `test_suite_run`, `test_passed`, `test_failed`, `lint_check`, `type_check`
- **📝 Git Operations**: `git_commit`, `git_push`, `git_merge`, `git_branch`, `git_tag`, `pull_request_created`, `pull_request_merged`
- **💚 System Monitoring**: `system_health`, `performance_alert`, `security_alert`, `error_occurred`, `resource_usage`
- **💬 User Interaction**: `approval_request`, `user_response`, `command_executed`
- **🔄 Notifications**: `progress_update`, `status_change`, `alert_notification`, `info_notification`
- **🌐 Integration**: `api_call`, `webhook_received`, `service_integration`
- **🎯 Custom**: `custom_event` - User-defined events

#### Builder Pattern API
```rust
// Task events
Event::task_completed(source, task_id, title, results)
Event::task_failed(source, task_id, title, error_type, details)

// Performance events
Event::performance_alert(source, task_id, title, current_value, threshold)

// Git events  
Event::git_commit(source, task_id, hash, message, author, files)

// Build events
Event::build_completed(source, task_id, target, passed, failed, coverage)
```

#### Validation & Utilities
```rust
event.validate()                    // Comprehensive validation
event.get_priority()                // Get event priority level  
event.get_severity()                // Get severity level
event.is_critical()                 // Check if critical event
event.requires_user_interaction()   // Check if user input needed
event.to_json() / from_json()       // JSON serialization
```

### 🤖 Telegram Bot Interface

The bot provides intelligent, context-aware responses with:

- **📱 Rich Notifications**: Event-specific formatting with appropriate emojis
- **🎛️ Interactive Controls**: Inline keyboards for approvals and actions
- **📊 Detailed Context**: Performance metrics, file changes, error details
- **⚡ Quick Actions**: Command execution with immediate feedback

### 🌐 HTTP API Endpoints

- `GET /health` - Application health status with detailed metrics
- `GET /metrics` - Prometheus-compatible metrics export
- `GET /report` - Comprehensive performance report with recommendations
- `GET /ready` - Kubernetes-style readiness probe
- `GET /live` - Kubernetes-style liveness probe

### 🔧 Configuration API

- **Environment Variables**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`, custom paths
- **TOML Configuration**: `~/.cc_telegram/config.toml` with auto-creation
- **Runtime Settings**: Performance thresholds, monitoring intervals, security settings

**For detailed API documentation, examples, and best practices**, see the comprehensive documentation in the `docs/` directory.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
# Install development dependencies
rustup component add clippy rustfmt

# Run lints
cargo clippy

# Format code
cargo fmt

# Run tests before submitting
cargo test
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Teloxide](https://github.com/teloxide/teloxide) - Telegram bot framework
- [Tokio](https://tokio.rs/) - Async runtime
- [Serde](https://serde.rs/) - Serialization framework
- [Prometheus](https://prometheus.io/) - Monitoring and alerting

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/co8/cc-telegram/issues)
- **Discussions**: [GitHub Discussions](https://github.com/co8/cc-telegram/discussions)
- **Documentation**: [Wiki](https://github.com/co8/cc-telegram/wiki)

---

**Built with ❤️ in Rust** | **Production Ready** | **Enterprise Grade**

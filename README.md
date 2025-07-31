# CC Telegram Bridge

[![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)](https://www.rust-lang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/co8/cc-telegram)

A high-performance, secure Rust-based bridge between Claude Code/VSCode and Telegram for remote development monitoring and interaction.

## 🚀 Features

### Core Functionality

- **Real-time Event Monitoring**: Watch file system events and process Claude Code/VSCode interactions
- **Telegram Bot Integration**: Receive notifications and interact with your development environment via Telegram
- **Interactive Messaging**: Approve actions, respond to prompts, and get status updates through inline keyboards
- **Secure Authentication**: User-based access control with rate limiting and input sanitization

### Performance & Monitoring

- **Prometheus Metrics**: Built-in metrics collection for monitoring and alerting
- **Health Check Endpoints**: HTTP endpoints for external monitoring systems
- **Performance Optimization**: Real-time CPU, memory, and processing time tracking
- **Automated Alerting**: Configurable thresholds with intelligent recommendations

### Enterprise Features

- **Production Ready**: Comprehensive logging, error handling, and graceful shutdown
- **Configuration Management**: TOML-based config with environment variable overrides
- **Security Hardening**: Input validation, rate limiting, and audit logging
- **Deployment Tools**: Health checks, performance monitoring, and optimization scripts

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

### 1. Clone and Build

```bash
git clone https://github.com/co8/cc-telegram.git
cd cc-telegram

# Build optimized release binary
cargo build --release
```

### 2. Configure Environment

```bash
# Required: Set your Telegram bot token and user ID
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TELEGRAM_ALLOWED_USERS="your_telegram_user_id"

# Optional: Custom directories
export CC_TELEGRAM_EVENTS_DIR="/path/to/events"
export CC_TELEGRAM_RESPONSES_DIR="/path/to/responses"
```

### 3. Run Application

```bash
# Start the bridge
./target/release/cc-telegram-bridge

# Or use the development binary
cargo run
```

### 4. Test Configuration

```bash
# Check deployment readiness
./performance_monitor.sh deployment-check

# Monitor performance
./performance_monitor.sh monitor
```

## 📁 Project Structure

```
cc-telegram/
├── src/
│   ├── config/          # Configuration management
│   ├── events/          # File system monitoring & event processing
│   ├── telegram/        # Telegram bot integration
│   ├── storage/         # File operations & data persistence
│   ├── utils/           # Security, logging, performance monitoring
│   ├── lib.rs           # Library interface
│   └── main.rs          # Application entry point
├── tests/               # Integration tests
├── performance_monitor.sh  # Monitoring & optimization script
├── config.example.toml  # Example configuration
└── example_event.json   # Sample event format
```

## ⚙️ Configuration

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN="your_bot_token"
TELEGRAM_ALLOWED_USERS="123456789,987654321"  # Comma-separated user IDs

# Optional paths
CC_TELEGRAM_EVENTS_DIR="/custom/events/path"
CC_TELEGRAM_RESPONSES_DIR="/custom/responses/path"
```

### Configuration File

The application creates `~/.cc_telegram/config.toml` on first run:

```toml
[telegram]
bot_token = ""
allowed_users = []

[paths]
events_dir = "/Users/username/.cc_telegram/events"
responses_dir = "/Users/username/.cc_telegram/responses"

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
./target/release/cc-telegram-bridge

# Development mode with logging
RUST_LOG=info cargo run
```

### Event Processing

Place JSON event files in the events directory (`~/.cc_telegram/events/`):

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
    "metadata": {
      "duration": "2m34s",
      "files_affected": 15,
      "error_count": 0
    }
  }
}
```

### Telegram Interactions

- Receive real-time notifications for events
- Approve/deny actions using inline keyboards
- Get detailed reports via bot commands
- Monitor system health and performance

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

```bash
# Run all tests
cargo test

# Run with verbose output
cargo test -- --nocapture

# Run specific test suite
cargo test test_performance_monitor

# Check test coverage
cargo test --verbose
```

### Test Coverage

- **Unit Tests**: 15 tests covering core functionality
- **Integration Tests**: 6 tests for end-to-end workflows
- **Performance Tests**: 3 tests for monitoring components
- **Security Tests**: Validation and rate limiting tests

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

## 📚 API Reference

### Event Types

- `task_completion` - Task or operation completed
- `approval_request` - User approval needed
- `progress_update` - Status update notification
- `error_notification` - Error or warning occurred

### Telegram Commands

The bot responds to events automatically, but also supports:

- Interactive inline keyboards for approvals
- Status queries and health checks
- Error reporting and diagnostics

### HTTP Endpoints

- `GET /health` - Application health status
- `GET /metrics` - Prometheus metrics
- `GET /report` - Detailed performance report
- `GET /ready` - Readiness probe
- `GET /live` - Liveness probe

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

# CCTelegram Documentation

**Real-time Telegram notifications for Claude Code workflows**

![CCTelegram](assets/cctelegram-github-header-optimized.jpg)

[![MCP Server v1.9.0](https://img.shields.io/badge/MCP%20Server-v1.9.0-2da199?style=flat&logo=typescript)](mcp-server/api/) 
[![Bridge v0.9.0](https://img.shields.io/badge/Bridge-v0.9.0-FF6B6B?style=flat&logo=rust)](../README.md)
[![Documentation v0.9.0](https://img.shields.io/badge/Documentation-v0.9.0-FF8C42?style=flat)](reference/)

---

## Quick Start

### 1. Install MCP Server (5 minutes)
```bash
# Add to your Claude Code MCP configuration
{
  "mcpServers": {
    "cctelegram": {
      "command": "npx",
      "args": ["-y", "cctelegram-mcp-server"],
      "env": { "TELEGRAM_BOT_TOKEN": "your_token" }
    }
  }
}
```

### 2. Setup Bridge (2 minutes)
```bash
# Install and start bridge
cargo install cctelegram
cctelegram --start
```

### 3. Test Integration
```javascript
// In Claude Code
send_telegram_message("Hello from Claude Code! 🎉")
```

**Expected**: Telegram notification within 5 seconds ✨

---

## Components

### MCP Server (TypeScript)
**Claude Code integration** - Handles MCP tools and event processing
- 20+ MCP tools for notifications
- Event validation and formatting
- Task status integration

### Bridge (Rust)
**Telegram communication** - Processes events and sends messages
- High-performance file watching
- Message queue and retry logic
- Multiple operation modes

---

## Core Features

**Notification Types**
- Task completions and progress
- Build results and deployments  
- Performance alerts
- Interactive approvals
- Custom events (44+ types)

**Operation Modes**
- **Local**: Essential notifications only
- **Nomad**: Full remote communication
- **Mute**: Silent processing

**Integration**
- Claude Code workflows
- Task management systems
- CI/CD pipelines
- Performance monitoring

---

## Key Resources

| **Getting Started** | **Integration** | **Reference** |
|:-------------------|:---------------|:-------------|
| [Installation](user-guide/installation.md) | [Claude Code Integration](user-guide/claude-integration.md) | [Event Types](reference/EVENT_SYSTEM.md) |
| [Quick Setup](setup/QUICKSTART.md) | [Task Management](user-guide/claude-integration.md#task-management-integration) | [Configuration](reference/configuration.md) |
| [Troubleshooting](user-guide/troubleshooting.md) | [Workflows](user-guide/claude-integration.md#advanced-usage-patterns) | [API Reference](mcp-server/api/) |

---

## Support

**Issues**: [GitHub Issues](https://github.com/co8/cctelegram/issues)  
**Security**: [Security Policy](security/)  
**Contributing**: [Development Guide](development/)

---

*CCTelegram v0.9.0 - Built for Claude Code developers*
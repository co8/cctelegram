# CCTelegram MCP Server

[![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)](https://www.rust-lang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/co8/cctelegram) [![Event System](https://img.shields.io/badge/events-44%2B%20types-blue.svg)](docs/FEATURES.md) [![Tests](https://img.shields.io/badge/tests-38%20passing-green.svg)](docs/FEATURES.md#comprehensive-testing) [![MCP](https://img.shields.io/badge/MCP-v1.1.1-purple.svg)](mcp-server/README.md)

## TL;DR

CCTelegram sends your development activity to [Telegram](https://telegram.org/). Get real-time notifications about builds, tests, deployments, and code changes. Zero-config MCP integration with [Claude Code](https://github.com/anthropics/claude-code).

---

## ⚡ 30-Second Install

### 1. Get [Telegram](https://telegram.org/) Ready
- Create bot with [@BotFather](https://t.me/botfather): `/newbot`
- Get your user ID from [@userinfobot](https://t.me/userinfobot)

### 2. Install MCP Server
```bash
# Navigate to MCP server and install
cd mcp-server
./install.sh

# Configure your tokens in Claude Code config
# (installer guides you through this)
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TELEGRAM_ALLOWED_USERS="your_user_id_here"
```

### 3. Test with [Claude Code](https://github.com/anthropics/claude-code)
```bash
# Restart Claude Code, then test with MCP tools:
@cctelegram send_telegram_message "🎉 CCTelegram MCP Server Working!"
```

**🎉 You should get a [Telegram](https://telegram.org/) notification within seconds!**  
*The bridge runs automatically in the background - no manual management needed.*

---

## 🎯 Key Features

- **44+ Event Types** - Complete development lifecycle monitoring
- **MCP Server Integration** - Zero-config [Claude Code](https://github.com/anthropics/claude-code) integration  
- **Real-time [Telegram](https://telegram.org/) Notifications** - Instant alerts with rich formatting
- **Interactive Approvals** - Approve deployments, code reviews via [Telegram](https://telegram.org/)
- **Enterprise Security** - Multi-user auth, rate limiting, audit logging
- **Performance Monitoring** - Built-in metrics, health checks, Prometheus integration

→ **[See all features & capabilities](docs/FEATURES.md)**

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| 🚀 **[Complete Setup Guide](QUICKSTART.md)** | Detailed installation, configuration, and deployment |
| 🔧 **[Features & Capabilities](docs/FEATURES.md)** | All features, API reference, event types, monitoring |
| 🔒 **[Security & Compliance](docs/SECURITY.md)** | Enterprise security, audit logging, compliance standards |
| 🎛️ **[MCP Integration](mcp-server/README.md)** | [Claude Code](https://github.com/anthropics/claude-code) MCP server setup and usage |
| 📖 **[Technical Reference](docs/EVENT_SYSTEM.md)** | Event system architecture and implementation |

---

## 💡 Quick Example

**Task Completion Notification:**
```bash
# Your build system creates this file when a task completes:
echo '{
  "type": "task_completion", 
  "source": "ci_system",
  "title": "✅ Deploy Complete",
  "description": "Production deployment v2.1.0 successful"
}' > ~/.cc_telegram/events/deploy-complete.json

# CCTelegram instantly sends: "✅ Deploy Complete ⏰ 14:30 UTC
# Production deployment v2.1.0 successful"
```

**Performance Alert:**
```bash
# Monitoring system triggers alert:
echo '{
  "type": "performance_alert",
  "title": "⚠️ Memory High", 
  "description": "Server memory usage: 85% (threshold: 80%)"
}' > ~/.cc_telegram/events/memory-alert.json

# Get instant notification with threshold details
```

---

## ⚙️ Alternative Installation

**Manual Bridge Setup (Advanced Users):**
```bash
# Download and run bridge directly
curl -L https://github.com/co8/cctelegram/releases/download/v0.4.4/cctelegram-bridge -o cctelegram-bridge
chmod +x cctelegram-bridge

# Configure and run
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TELEGRAM_ALLOWED_USERS="your_user_id_here"
./cctelegram-bridge

# Test with file creation
mkdir -p ~/.cc_telegram/events
echo '{"type": "task_completion", "title": "Bridge Test", "description": "Manual setup working"}' > ~/.cc_telegram/events/test.json
```

**Build from Source:**
```bash
git clone https://github.com/co8/cctelegram.git
cd cctelegram  
cargo build --release
./target/release/cctelegram-bridge
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/co8/cctelegram/issues)
- **Discussions**: [GitHub Discussions](https://github.com/co8/cctelegram/discussions)

---

**Built with ❤️ in Rust** | **Production Ready** | **Enterprise Grade**
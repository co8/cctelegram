![CCTelegram GitHub Header](@docs/assets/cctelegram-github-header-optimized.jpg)

# CCTelegram MCP Server

[![Bridge Version](https://img.shields.io/badge/Bridge-v0.8.5-FF6B6B?style=for-the-badge&logo=rust&logoColor=white)](https://github.com/co8/cctelegram/releases/tag/v0.8.5) [![MCP Server](https://img.shields.io/badge/MCP%20Server-v1.8.5-2da199?style=for-the-badge&logo=typescript&logoColor=white)](mcp-server/README.md) [![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-FF8C42?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQ1IiBmaWxsPSIjRkY4QzQyIi8+Cjx0ZXh0IHg9IjUwIiB5PSI1OCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjQwIiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPg==&logoColor=white)](https://claude.ai/code)

[![Rust](https://img.shields.io/badge/Rust-1.70+-CE422B?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![License](https://img.shields.io/badge/License-MIT-97CA00?style=flat-square&logo=opensourceinitiative&logoColor=white)](https://opensource.org/licenses/MIT) [![Build](https://img.shields.io/badge/Build-Passing-00D26A?style=flat-square&logo=github&logoColor=white)](https://github.com/co8/cctelegram) [![Security](https://img.shields.io/badge/Security-8.5%2F10%20LOW%20RISK-cd4e97?style=flat-square&logo=shield&logoColor=white)](@docs/reference/SECURITY.md) [![OWASP](https://img.shields.io/badge/OWASP-10%2F10%20Compliant-7209B7?style=flat-square&logo=owasp&logoColor=white)](@docs/reference/SECURITY.md) [![Telegram](https://img.shields.io/badge/Telegram-Bot%20API-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://core.telegram.org/bots/api) [![Events](https://img.shields.io/badge/Events-44%2B%20Types-E63946?style=flat-square&logo=apache&logoColor=white)](@docs/reference/EVENT_SYSTEM.md) [![Tests](https://img.shields.io/badge/Tests-61%20Passing-00b976?style=flat-square&logo=jest&logoColor=white)](@test/) [![Monitoring](https://img.shields.io/badge/Monitoring-Prometheus-E6522C?style=flat-square&logo=prometheus&logoColor=white)](@docs/reference/FEATURES.md#performance-monitoring)

## TL;DR

**Complete Notification Ecosystem for [Claude Code](https://github.com/anthropics/claude-code) Developers**

CCTelegram consists of **two complementary components** that work together seamlessly:

🔌 **MCP Server** (TypeScript) - Integrates directly with Claude Code via MCP protocol  
🌉 **Bridge** (Rust) - High-performance background service for Telegram communication

**Get real-time notifications, interactive approvals, and comprehensive development workflow integration.**  
**Built specifically for the Claude Code + developer mindset.**

🛡️ **Security Score: 8.5/10 (LOW RISK)** | 🔒 **OWASP Top 10 2021: 100% Compliant** | ✅ **Zero Critical Vulnerabilities**

## ⚡ 30-Second Install

### 1. Get [Telegram](https://telegram.org/) Ready

- Create bot with [@BotFather](https://t.me/botfather): `/newbot`
- Get your user ID from [@userinfobot](https://t.me/userinfobot)

### 2. Install Complete System

```bash
# Download both MCP Server and Bridge
git clone https://github.com/co8/cctelegram.git
cd cctelegram

# Install MCP Server v1.8.5 (Claude Code integration)
cd mcp-server
./install.sh

# Configure your tokens (installer guides you)
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TELEGRAM_ALLOWED_USERS="your_user_id_here"

# Bridge v0.8.5 starts automatically in background
```

### 3. Test with [Claude Code](https://github.com/anthropics/claude-code)

```bash
# Restart Claude Code, then test with MCP tools:
@cctelegram send_telegram_message "🎉 CCTelegram MCP Server v1.8.5 Working!"
```

**🎉 You should get a [Telegram](https://telegram.org/) notification within seconds!**

**How it works**: MCP Server processes the command in Claude Code → Bridge detects the event file → Sends to Telegram  
_Both components work together automatically - no manual management needed._

---

## 📱 Live Notifications

<div align="center">

| Build Success | Security Audit | Code Review |
| :-: | :-: | :-: |
| ![Build Success](@docs/assets/screenshot-build-success.png) | ![Security Audit](@docs/assets/screenshot-security-audit.png) | ![Code Review](@docs/assets/screenshot-code-review.png) |
| **✅ Comprehensive build metrics** | **🛡️ Zero-vulnerability reports** | **👀 Detailed review summaries** |
| Real-time CI/CD pipeline results with test coverage, bundle optimization, and deployment readiness | OWASP-compliant security scans with vulnerability breakdown and compliance scoring | Pull request analysis with code quality metrics and approval workflows |

</div>

## 🔐 Interactive Approval Workflow

<div align="center">

| Initial Request and Response Options | Detailed Review | Final Confirmation |
| :-: | :-: | :-: |
| ![Approval Request](@docs/assets/cctelegram-screenshots-approval-1-optimized.png) | ![Request Approved](@docs/assets/cctelegram-screenshots-approval-4-optimized.png) | ![Approved Response Confirmation](@docs/assets/cctelegram-screenshots-approval-3-optimized.png)<br/>![Denied Response Confirmation](@docs/assets/cctelegram-screenshots-approval-2-optimized.png) |
| **🚀 Production Deployment** | **📋 Comprehensive Details** | **✅ Confirmed Response** |
| Critical changes with rating icons, pre-flight check status, and interactive approve/deny buttons | Enhanced authentication, performance improvements, security patches, and rollback planning | Real-time confirmation with timestamp and deployment tracking |

</div>

---

## 🎯 Key Features

- **🛡️ Zero Message Loss Architecture** - **NEW**: Enterprise-grade reliability with comprehensive validation and deduplication
- **🔔 [44+ Event Types](@docs/reference/EVENT_SYSTEM.md)** - Complete development lifecycle monitoring
- **🔌 MCP Server Integration** - Zero-config [Claude Code](https://github.com/anthropics/claude-code) integration
- **📱 Real-time [Telegram](https://telegram.org/) Notifications** - Instant alerts with rich formatting
- **✅ Interactive Approvals** - Approve deployments, code reviews via [Telegram](https://telegram.org/)
- **⚡ Performance Optimized** - **NEW**: 86.3% payload reduction, microsecond serialization benchmarks
- **🔍 Comprehensive Validation** - **NEW**: 14 ValidationError types, field constraints, business logic validation
- **🔐 Advanced Authentication** - **NEW**: API keys, HMAC integrity, rate limiting
- **📊 Performance Monitoring** - Built-in metrics, health checks, Prometheus integration
- **🔍 Comprehensive Audit Logging** - **NEW**: Secure event tracking, data sanitization

→ **[See all features & capabilities](@docs/reference/FEATURES.md)**

---

## 🛡️ Enterprise Reliability

**Zero Message Loss Achievement** - Comprehensive reliability improvements targeting 100% message delivery:

### 🎯 Validation & Integrity System

- **14 ValidationError Types** with user-friendly messages and severity classification
- **Field Constraint Validation** - Title (1-200 chars), description (1-2000 chars), UUID/timestamp validation
- **Business Logic Validation** - Event type-specific rules and required field checking
- **Data Consistency Validation** - Cross-field validation and logical consistency verification

### 🔄 Advanced Deduplication

- **Primary Deduplication** - Exact event_id matching for duplicate prevention
- **Secondary Deduplication** - Content-based matching within configurable time windows (5 seconds default)
- **Intelligent Detection** - Hash-based content comparison for efficient duplicate identification

### ⚡ Performance Optimization

- **86.3% Payload Reduction** - Intelligent null field omission and optimized JSON structure
- **Serialization Benchmarks** - Average 72.82μs serialization, 60.549μs deserialization
- **Forward Compatibility** - Custom deserializers with Unknown variant fallbacks
- **Snake_case Consistency** - Standardized JSON field naming across all structures

### 📊 Enhanced Testing

- **61 Tests** (+60% increase) with comprehensive validation and reliability testing
- **Validation Framework** - 6 new test functions covering all validation aspects
- **Performance Benchmarks** - Serialization/deserialization timing integrated into test suite

---

## 📁 Project Structure

```
cctelegram/
├── @docs/                     # 📚 All Documentation
│   ├── setup/                 # 🚀 Installation & Setup
│   ├── reference/             # 📖 Technical References
│   ├── security/              # 🛡️ Security Audits
│   └── development/           # 🔧 Contributing & Dev
├── @test/                     # 🧪 Testing Framework
│   └── unit/                  # Unit & Integration Tests
├── @scripts/                  # ⚙️ Utility Scripts
├── src/                       # 🦀 Rust Bridge Source
├── mcp-server/                # 🔌 MCP Server (TypeScript)
├── examples/                  # 💡 Usage Examples
└── target/                    # 🏗️ Build Artifacts
```

---

## 📚 Documentation

| Guide | Description |
| --- | --- |
| 🚀 **[Complete Setup Guide](@docs/setup/QUICKSTART.md)** | Detailed installation, configuration, and deployment |
| 🔧 **[Features & Capabilities](@docs/reference/FEATURES.md)** | All features, API reference, event types, monitoring |
| 🔒 **[Security & Compliance](SECURITY.md)** | **NEW**: Enterprise security, OWASP compliance, zero vulnerabilities |
| 🎛️ **[MCP Integration](mcp-server/README.md)** | [Claude Code](https://github.com/anthropics/claude-code) MCP server setup and usage |
| 📖 **[Technical Reference](@docs/reference/EVENT_SYSTEM.md)** | Event system architecture and implementation |
| 🛡️ **[Security Audits](@docs/security/)** | Complete security audit reports and remediation |
| 🧪 **[Testing Guide](@test/)** | Unit tests and testing framework documentation |
| 🔧 **[Development Guide](@docs/development/CONTRIBUTING.md)** | Contributing guidelines and development setup |

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
# Download and extract latest release
# Get the latest release URL automatically
LATEST_URL=$(curl -s https://api.github.com/repos/co8/cctelegram/releases/latest | grep "tarball_url" | cut -d '"' -f 4)
curl -L "$LATEST_URL" -o cctelegram-latest.tar.gz
tar -xzf cctelegram-latest.tar.gz
cd co8-cctelegram-*
cargo build --release

# Configure and run
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export TELEGRAM_ALLOWED_USERS="your_user_id_here"
./target/release/cctelegram-bridge

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

**Built with ❤️ in Rust** | **🔒 Enterprise Security** | **✅ OWASP Compliant** | **🛡️ Zero Critical Vulnerabilities**

# CCTelegram Bridge v0.8.5 & MCP Server v1.8.5 Release

## 🚀 What's New

This is a comprehensive release combining:
- **Bridge v0.8.5**: Rust-based Telegram bridge with enhanced integrity validation
- **MCP Server v1.8.5**: TypeScript-based Model Context Protocol server with full security framework

## 📦 Release Assets

- `cctelegram-source-v0.8.5.tar.gz` - Complete source code
- `cctelegram-mcp-server-v1.8.5.tar.gz` - MCP Server build
- `README.md` - Project documentation

## 🔧 Key Features

### Bridge v0.8.5
- Telegram Integration with real-time monitoring
- Large Message Protocol for messages >4KB
- SHA-256 integrity validation throughout
- Advanced queue management and debouncing
- Multi-tier architecture with Redis support
- Performance monitoring and health checks

### MCP Server v1.8.5
- Webhook Integration with security validation
- Comprehensive event handling and routing
- Security headers (CSP, HSTS, etc.)
- Rate limiting with Redis backend
- Resilience framework with circuit breakers
- TypeScript with comprehensive testing

## 🚀 Quick Start

### Bridge Setup
```bash
tar -xzf cctelegram-source-v0.8.5.tar.gz
cd cctelegram-*
cargo build --release
./target/release/cctelegram-bridge
```

### MCP Server Setup
```bash
tar -xzf cctelegram-mcp-server-v1.8.5.tar.gz
cd mcp-server/
npm install && npm start
```

## 📖 Documentation

Complete documentation available in the source package and GitHub repository.

For more information, visit [GitHub](https://github.com/co8/cctelegram).
EOF < /dev/null
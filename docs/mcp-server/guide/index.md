# Getting Started

CCTelegram MCP Server provides a high-performance, type-safe bridge between Claude Code and Telegram services.

## Installation

### NPM Package

```bash
npm install cctelegram-mcp-server
```

### Pre-built Binaries

Download from [releases](https://github.com/user/cctelegram/releases):

```bash
# macOS
curl -L https://github.com/user/cctelegram/releases/latest/download/cctelegram-mcp-server-darwin-arm64.tar.gz | tar -xz

# Linux  
curl -L https://github.com/user/cctelegram/releases/latest/download/cctelegram-mcp-server-linux-x64.tar.gz | tar -xz
```

## Quick Setup

### 1. Configuration

```bash
cp config.example.toml config.toml
```

Edit `config.toml`:

```toml
[server]
port = 3000
host = "127.0.0.1"

[telegram]
bot_token = "your_bot_token_here"

[security]
rate_limit_window = 900
rate_limit_max = 100
```

### 2. Environment Variables

```bash
# Required
export TELEGRAM_BOT_TOKEN="your_bot_token"

# Optional
export NODE_ENV="production"
export LOG_LEVEL="info"
```

### 3. Start Server

```bash
npm start
# or
node dist/index.js
```

## MCP Integration

Add to Claude Code's MCP configuration:

```json
{
  "mcpServers": {
    "cctelegram": {
      "command": "node",
      "args": ["path/to/cctelegram-mcp-server/dist/index.js"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your_bot_token"
      }
    }
  }
}
```

## First Steps

### Send a Test Event

```typescript
import { BridgeClient } from 'cctelegram-mcp-server';

const client = new BridgeClient({
  baseURL: 'http://localhost:3000'
});

await client.sendEvent({
  type: 'task_completion',
  title: 'Test Complete',
  description: 'First successful integration test'
});
```

### Check Health

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.45
}
```

## Next Steps

- [Configure security →](/guide/security)
- [Set up monitoring →](/guide/monitoring) 
- [Explore examples →](/examples/)
- [API reference →](/api/)

## Need Help?

- [Troubleshooting →](/guide/troubleshooting)
- [GitHub Issues](https://github.com/user/cctelegram/issues)
- [Security Reports](/guide/security#reporting)
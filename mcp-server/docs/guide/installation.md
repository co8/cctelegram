# Installation

## System Requirements

- **Node.js**: 18.x or 20.x
- **Memory**: 128MB minimum, 512MB recommended
- **Disk**: 50MB for installation, 100MB for operation

## Installation Methods

### NPM (Recommended)

```bash
npm install cctelegram-mcp-server
```

Global installation:
```bash
npm install -g cctelegram-mcp-server
```

### Pre-built Binaries

Download platform-specific binaries:

#### macOS
```bash
curl -L https://github.com/user/cctelegram/releases/latest/download/cctelegram-mcp-server-darwin-arm64.tar.gz | tar -xz
chmod +x cctelegram-mcp-server
```

#### Linux
```bash
curl -L https://github.com/user/cctelegram/releases/latest/download/cctelegram-mcp-server-linux-x64.tar.gz | tar -xz
chmod +x cctelegram-mcp-server
```

#### Windows
```powershell
Invoke-WebRequest -Uri "https://github.com/user/cctelegram/releases/latest/download/cctelegram-mcp-server-win-x64.zip" -OutFile "cctelegram.zip"
Expand-Archive cctelegram.zip
```

### Docker

```bash
docker pull ghcr.io/user/cctelegram-mcp-server:latest
```

Run container:
```bash
docker run -d \
  --name cctelegram \
  -p 3000:3000 \
  -e TELEGRAM_BOT_TOKEN="your_token" \
  ghcr.io/user/cctelegram-mcp-server:latest
```

### From Source

```bash
git clone https://github.com/user/cctelegram.git
cd cctelegram/mcp-server
npm install
npm run build
npm start
```

## Verification

Test installation:
```bash
# NPM
npx cctelegram-mcp-server --version

# Binary
./cctelegram-mcp-server --version

# Docker
docker run --rm ghcr.io/user/cctelegram-mcp-server:latest --version
```

Expected output:
```
cctelegram-mcp-server v1.7.0
Node.js v20.x.x
```

## Configuration Files

Create configuration directory:
```bash
mkdir -p ~/.config/cctelegram
cp config.example.toml ~/.config/cctelegram/config.toml
```

Edit configuration:
```toml
[server]
port = 3000
host = "127.0.0.1"

[telegram]
bot_token = "YOUR_BOT_TOKEN"

[logging]
level = "info"
```

## Environment Setup

### Required Variables
```bash
export TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
```

### Optional Variables
```bash
export NODE_ENV="production"
export LOG_LEVEL="info" 
export CONFIG_PATH="~/.config/cctelegram/config.toml"
export PORT="3000"
```

## Service Setup

### systemd (Linux)

Create `/etc/systemd/system/cctelegram.service`:
```ini
[Unit]
Description=CCTelegram MCP Server
After=network.target

[Service]
Type=simple
User=cctelegram
WorkingDirectory=/opt/cctelegram
ExecStart=/opt/cctelegram/cctelegram-mcp-server
Environment=TELEGRAM_BOT_TOKEN=your_token
Environment=NODE_ENV=production
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable cctelegram
sudo systemctl start cctelegram
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.cctelegram.mcp-server.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cctelegram.mcp-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/cctelegram-mcp-server</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>TELEGRAM_BOT_TOKEN</key>
        <string>your_token</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

Load service:
```bash
launchctl load ~/Library/LaunchAgents/com.cctelegram.mcp-server.plist
```

## Troubleshooting

### Permission Errors
```bash
# Linux/macOS
sudo chown -R $USER:$USER ~/.config/cctelegram
chmod 755 cctelegram-mcp-server
```

### Port Conflicts
```bash
# Check port usage
lsof -i :3000

# Use alternative port
export PORT=3001
```

### Missing Dependencies
```bash
# Clear npm cache
npm cache clean --force

# Reinstall
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

- [Configuration →](/guide/configuration)
- [Security setup →](/guide/security)
- [MCP integration →](/guide/#mcp-integration)
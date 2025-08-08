# CCTelegram Installation Guide

**Complete setup in <10 minutes with 95% success rate**

**Target**: From zero to first Telegram notification in under 10 minutes

---

## 📋 Prerequisites (2 minutes)

### **System Requirements**
- **Operating System**: macOS, Linux, Windows (WSL2 recommended)
- **Claude Code**: Latest version with MCP support
- **Node.js**: Version 20+ ([Download](https://nodejs.org/))  
- **Rust**: Version 1.70+ ([Install](https://rustup.rs/))
- **Telegram**: Personal account with access to @BotFather

### **Quick Compatibility Check**
```bash
# Verify prerequisites (30 seconds)
claude --version      # Should show Claude Code version
node --version        # Should show v20+
rustc --version       # Should show 1.70+
```

**All good?** → Continue to installation  
**Missing something?** → **[Troubleshooting](#troubleshooting)** section below

---

## 🤖 Step 1: Telegram Bot Setup (3 minutes)

### **Create Your Bot**
1. **Open Telegram** and message [@BotFather](https://t.me/BotFather)
2. **Send command**: `/newbot`
3. **Choose bot name**: `YourName CCTelegram Bot`
4. **Choose username**: `yourname_ccbridge_bot`  
5. **Save the token**: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

### **Configure Bot Settings**
```
Send to @BotFather:
/setcommands
@yourname_ccbridge_bot
```

**Add these commands:**
```
status - Check bridge status
health - System health check  
mode - Change operation mode
todo - Show task status
help - Available commands
```

### **Test Bot Access**
1. **Start conversation** with your bot
2. **Send**: `/status`
3. **Expected**: "Bot created successfully" (or similar response)

**✅ Bot ready!** Your token: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

---

## 🔌 Step 2: MCP Server Setup (2 minutes)

### **Add to Claude Code Configuration**

**Edit your Claude Code MCP settings** (`~/.claude/mcp_servers.json` or similar):

```json
{
  "mcpServers": {
    "cctelegram": {
      "command": "npx",
      "args": ["-y", "cctelegram-mcp-server"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
        "CLAUDE_CC_TELEGRAM_MODE": "local"
      }
    }
  }
}
```

**Environment Variables:**
- `TELEGRAM_BOT_TOKEN` - Your bot token from Step 1 (Required)
- `CLAUDE_CC_TELEGRAM_MODE` - Operation mode: `local`, `nomad`, or `mute` (Optional, defaults to `local`)

### **Restart Claude Code**
1. **Close Claude Code** completely
2. **Restart Claude Code**
3. **Verify MCP connection** in Claude Code logs/status

**✅ MCP Server configured!**

---

## ⚡ Step 3: Bridge Installation (2 minutes)

### **Install Rust Bridge**
```bash
# Install the high-performance Rust bridge
cargo install cctelegram

# Verify installation
cctelegram --version
# Expected: cctelegram 0.9.0 (or latest version)
```

### **Environment Configuration**
```bash
# Create configuration directory
mkdir -p ~/.cc_telegram

# Create environment file
cat > ~/.cc_telegram/.env << EOF
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
RUST_LOG=info
CC_TELEGRAM_MODE=local
EVENT_DIR=${HOME}/.cc_telegram/events
HEALTH_PORT=8080
EOF
```

### **Start the Bridge**
```bash
# Start bridge in background
cctelegram --daemon

# Or start in foreground (for debugging)
cctelegram --start

# Expected output:
# [2025-08-08T20:30:00Z INFO] Starting CCTelegram Bridge v0.9.0
# [2025-08-08T20:30:01Z INFO] Telegram bot connected: @yourname_ccbridge_bot  
# [2025-08-08T20:30:02Z INFO] Event watcher initialized: ~/.cc_telegram/events
# [2025-08-08T20:30:03Z INFO] ✅ Bridge ready - listening for events
```

**✅ Bridge running!**

---

## 🧪 Step 4: Integration Test (1 minute)

### **Test MCP → Bridge → Telegram Flow**

**In Claude Code, run this command:**
```javascript
send_telegram_message("🎉 CCTelegram installation complete! System is working perfectly.")
```

**Expected Results:**
1. **Claude Code**: Command executes successfully
2. **Bridge logs**: Shows event processing
3. **Telegram**: You receive the test message within 5 seconds

### **Test Interactive Features**
```javascript
// Test approval workflow
send_approval_request({
  title: "Installation Test", 
  description: "Is CCTelegram working correctly?",
  options: ["Yes, perfect!", "Need troubleshooting", "Not working"]
})
```

**Expected**: Interactive message with buttons in Telegram

### **Test System Status**
```javascript
// Check system health
get_bridge_status()
```

**Expected Response:**
```json
{
  "bridge_running": true,
  "bridge_health": "healthy", 
  "telegram_connected": true,
  "uptime_seconds": 45,
  "events_processed": 3,
  "success_rate": 100.0
}
```

**🎉 All tests pass?** → **Installation complete!**

---

## 🎛️ Step 5: Configure Operation Mode (Optional)

### **Choose Your Mode**

**🏠 Local Mode** (Default - Recommended for most users)
```javascript
switch_to_local_mode()
```
- Essential notifications only
- Optimized for focused development
- Reduced message frequency

**🌍 Nomad Mode** (For remote work)
```javascript
switch_to_nomad_mode()  
```
- Full bidirectional communication
- Rich formatting and context
- Interactive approvals enabled

**🔇 Mute Mode** (For meetings/focus sessions)
```javascript
switch_to_mute_mode()
```
- Silent operation - no messages sent
- Events logged for later review
- Easy to re-enable

### **Verify Mode Setting**
```javascript
get_bridge_status()
// Check "mode" field in response
```

---

## 🚀 Next Steps

### **New Users** 
**✅ You're ready!** Try these common workflows:
```javascript
// Task completion notification
send_task_completion({
  title: "Feature Implementation Complete",
  results: "✅ Authentication system\n✅ 94% test coverage\n✅ Documentation updated"
})

// Performance monitoring
send_performance_alert({
  title: "API Response Time Alert",
  current_value: 850,
  threshold: 500,
  severity: "medium"
})
```

### **Power Users**
**📖 Explore advanced features** → **[API Reference](API_REFERENCE.md)**
- 20+ MCP tools with examples
- 44+ event types with schemas
- Advanced configuration options

### **Contributors**
**🛠️ Development setup** → **[Contributing Guide](CONTRIBUTING.md)**
- Local development environment
- Testing procedures
- Pull request workflow

---

## 🆘 Troubleshooting

### **Common Issues & Quick Fixes**

#### **MCP Server not connecting**
```bash
# Check Claude Code logs for MCP errors
# Verify token format (no extra spaces/characters)
# Ensure Node.js 20+ is installed
node --version

# Test MCP server directly
npx cctelegram-mcp-server --test
```

#### **Bridge fails to start**  
```bash
# Check Rust installation
rustc --version  # Should be 1.70+

# Check permissions
ls -la ~/.cc_telegram/
mkdir -p ~/.cc_telegram/events

# Check token format
grep TELEGRAM_BOT_TOKEN ~/.cc_telegram/.env
```

#### **No Telegram messages received**
```bash
# Verify bot token
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"

# Check bridge logs
cctelegram --log-level debug

# Test bot directly
# Send a message to your bot in Telegram, check for response
```

#### **Performance Issues**
```bash
# Check system resources
htop  # CPU and memory usage

# Optimize bridge settings  
export RUST_LOG=warn  # Reduce log verbosity
export CC_TELEGRAM_WORKERS=4  # Adjust worker count
```

### **Advanced Troubleshooting**

#### **Enable Debug Logging**
```bash
# MCP Server debug
export DEBUG=cctelegram:*

# Bridge debug  
export RUST_LOG=debug
cctelegram --start

# Event file inspection
tail -f ~/.cc_telegram/events/*.json
```

#### **Health Check Endpoints**
```bash
# Bridge health
curl http://localhost:8080/health

# Expected response:
{"status":"healthy","uptime":3600,"events_processed":127}
```

#### **Event Processing Test**
```bash
# Create test event manually
echo '{"type":"test","title":"Manual Test"}' > ~/.cc_telegram/events/test_$(date +%s).json

# Watch bridge logs for processing
tail -f ~/.cc_telegram/bridge.log
```

### **Get Additional Help**

**🐛 Still having issues?**
1. **Check logs**: Bridge and MCP server logs for error details
2. **GitHub Issues**: [Report bugs](https://github.com/co8/cctelegram/issues) with log excerpts  
3. **Discussions**: [Ask questions](https://github.com/co8/cctelegram/discussions)

**🔧 Need advanced configuration?**
- **[API Reference](API_REFERENCE.md)** - Complete configuration options
- **[Troubleshooting](TROUBLESHOOTING.md)** - Comprehensive problem solving

---

## ✅ Installation Checklist

- [ ] **Prerequisites verified** (Claude Code, Node.js 20+, Rust 1.70+)
- [ ] **Telegram bot created** with valid token
- [ ] **MCP server configured** in Claude Code  
- [ ] **Bridge installed** and started successfully
- [ ] **Integration test passed** - received test notification
- [ ] **Operation mode configured** (local/nomad/mute)
- [ ] **Health check successful** - bridge status shows healthy

**All checked?** 🎉 **Welcome to CCTelegram!**

---

**Installation time**: ~8 minutes • **Success rate**: 95%+ • **Support**: Available via GitHub Issues

*Having trouble? Most issues resolve in <5 minutes with the troubleshooting guide above.*
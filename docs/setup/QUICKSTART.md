# 🚀 CC Telegram Bridge - Quickstart Guide

Get up and running with CC Telegram Bridge in under 10 minutes!

## 📋 Pre-flight Checklist

- [ ] **Telegram account** with mobile app
- [ ] **5-10 minutes** of your time
- [ ] **Terminal access** on macOS, Linux, or WSL
- [ ] **Optional**: Rust installed (1.70+) if building from source - [rustup.rs](https://rustup.rs/)

## 🎯 Step 1: Create Your Telegram Bot

### 1.1 Create the Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Start a chat and send `/newbot`
3. Choose a name: `My CC Bridge Bot`
4. Choose a username: `myccbridge_bot` (must end with `_bot`)
5. **Save the bot token** - you'll need it soon!

```
✅ Example token: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

### 1.2 Get Your User ID

1. Search for [@userinfobot](https://t.me/userinfobot)
2. Start a chat and send any message
3. **Save your user ID** - it's the number shown

```
✅ Example ID: 123456789
```

## 🛠️ Step 2: Install the Application

### Option A: Download Pre-built Binary (Recommended - 30 seconds)

```bash
# Download the latest release
curl -L https://github.com/co8/cctelegram/releases/latest/download/cctelegram-bridge -o cctelegram-bridge
chmod +x cctelegram-bridge

# Verify the download
ls -la cctelegram-bridge
```

### Option B: Build from Source (2 minutes)

```bash
# Clone the repository
git clone https://github.com/co8/cctelegram.git
cd cc-telegram

# Build the optimized version
cargo build --release
```

### 2.3 Quick Configuration

```bash
# Set your bot credentials (replace with your actual values)
export TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
export TELEGRAM_ALLOWED_USERS="123456789"

# Verify it's set correctly
echo "Bot Token: ${TELEGRAM_BOT_TOKEN:0:10}..."
echo "User ID: $TELEGRAM_ALLOWED_USERS"
```

## 🚦 Step 3: First Run

### 3.1 Start the Bridge

```bash
# Start the application (use appropriate path based on installation method)
./cctelegram-bridge                    # If downloaded pre-built binary
# OR
./target/release/cctelegram-bridge     # If built from source
```

You should see:

```
2024-07-31T20:30:00.000Z  INFO Starting CC Telegram Bridge v0.8.5
2024-07-31T20:30:00.001Z  INFO Configuration loaded successfully
2024-07-31T20:30:00.002Z  INFO Performance monitoring initialized
2024-07-31T20:30:00.003Z  INFO Health check server started on port 8080
2024-07-31T20:30:00.004Z  INFO File watcher initialized for: /Users/username/.cc_telegram/events
2024-07-31T20:30:00.005Z  INFO CC Telegram Bridge is running. Press Ctrl+C to stop.
```

### 3.2 Test the Connection

Open a new terminal and test:

```bash
# Check if it's healthy
curl http://localhost:8080/health

# Should return: {"status":"healthy",...}
```

## 🧪 Step 4: Test With Sample Event

### 4.1 Send a Test Event

```bash
# Create a test event file
mkdir -p ~/.cc_telegram/events
cat > ~/.cc_telegram/events/test_event.json << 'EOF'
{
  "type": "task_completion",
  "source": "quickstart_test",
  "timestamp": "2024-07-31T20:30:00Z",
  "task_id": "quickstart_123",
  "title": "🎉 Quickstart Test Complete",
  "description": "Your CC Telegram Bridge is working perfectly!",
  "data": {
    "status": "completed",
    "results": "✅ Connection established\n✅ Bot responding\n✅ Events processing\n✅ Ready for production!",
    "metadata": {
      "setup_time": "< 10 minutes",
      "status": "success"
    }
  }
}
EOF
```

### 4.2 Watch for the Notification

Within seconds, you should receive a Telegram message from your bot! 🎉

The message will include:

- ✅ Task completion notification
- 📋 Event details and results
- 🔧 Interactive buttons (if applicable)

## 📊 Step 5: Monitoring Dashboard

### 5.1 Check Performance

```bash
# Run the monitoring script
./performance_monitor.sh monitor
```

You'll see:

```
=== CC Telegram Bridge Performance Monitor ===
✓ Application is running
✓ Health endpoint is responding
Health Status: ✓ HEALTHY

=== System Metrics ===
CPU Usage:        2.3%
Memory Usage:     45 MB
Uptime:           120 seconds
Events Processed: 1
Error Rate:       0.0%

=== Alerts ===
✓ No alerts
```

### 5.2 View Detailed Metrics

```bash
# Get detailed performance report
curl http://localhost:8080/report | jq

# Get Prometheus metrics
curl http://localhost:8080/metrics
```

## 🎛️ Step 6: Customize Configuration

### 6.1 Edit Configuration File

The app created `~/.cc_telegram/config.toml` on first run:

```bash
# Open the config file
nano ~/.cc_telegram/config.toml
```

### 6.2 Key Settings to Adjust

```toml
[notifications]
task_completion = true      # ✅ Enable task notifications
approval_requests = true    # ✅ Enable approval prompts
progress_updates = false    # 🔧 Enable for detailed updates

[performance]
memory_threshold_mb = 100          # 🔧 Adjust for your system
cpu_threshold_percent = 80.0       # 🔧 CPU alert threshold
enable_detailed_logging = false    # 🔧 Enable for debugging

[monitoring]
health_check_port = 8080          # 🔧 Change if port conflicts
enable_metrics_server = true      # ✅ Keep enabled for monitoring
```

## 🚀 Step 7: Production Deployment

### 7.1 Deployment Readiness Check

```bash
# Verify everything is ready for production
./performance_monitor.sh deployment-check
```

Should show:

```
=== Deployment Health Check ===
✓ Release binary exists
✓ Configuration available
✓ Directory permissions OK
✓ Required tools available
✓ Ready for deployment
```

### 7.2 Create Systemd Service (Linux)

```bash
# Create service file
sudo tee /etc/systemd/system/cctelegram-bridge.service << EOF
[Unit]
Description=CC Telegram Bridge
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
Environment=TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
Environment=TELEGRAM_ALLOWED_USERS=$TELEGRAM_ALLOWED_USERS
ExecStart=$(pwd)/cctelegram-bridge
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable cctelegram-bridge
sudo systemctl start cctelegram-bridge
```

### 7.3 Background Mode (macOS/Manual)

```bash
# Run in background with logging (adjust path based on installation method)
nohup ./cctelegram-bridge > cc-bridge.log 2>&1 &                    # If downloaded pre-built binary
# OR
# nohup ./target/release/cctelegram-bridge > cc-bridge.log 2>&1 &   # If built from source

# Check it's running
ps aux | grep cctelegram-bridge
```

## 🔍 Step 8: Monitoring & Maintenance

### 8.1 Continuous Monitoring

```bash
# Monitor every 30 seconds
./performance_monitor.sh continuous 30

# Or check periodically
watch -n 10 './performance_monitor.sh monitor'
```

### 8.2 Log Monitoring

```bash
# View application logs
tail -f ~/.cc_telegram/logs/application.log

# Or system logs (if using systemd)
sudo journalctl -u cctelegram-bridge -f
```

### 8.3 Performance Optimization

```bash
# Get optimization suggestions
./performance_monitor.sh optimize
```

## ⚡ Common Next Steps

### Integrate with Your IDE

- **Claude Code**: Place event files in `~/.cc_telegram/events/`
- **VSCode**: Use file system watchers to generate events
- **Custom Integration**: Use the JSON event format to send notifications

### Advanced Configuration

- **Rate Limiting**: Adjust security settings for your usage
- **Multiple Users**: Add more Telegram user IDs
- **Custom Paths**: Set custom directories for events and responses
- **Monitoring Integration**: Connect Prometheus/Grafana for dashboards

### Automation Scripts

```bash
# Auto-restart if crashed
while true; do
  ./cctelegram-bridge     # Adjust path based on installation method
  echo "Bridge crashed, restarting in 5 seconds..."
  sleep 5
done
```

## 🆘 Troubleshooting

### Bot Not Responding

```bash
# Check bot token
echo "Token: ${TELEGRAM_BOT_TOKEN:0:10}..."

# Test bot manually
curl -X GET "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"
```

### Events Not Processing

```bash
# Check events directory
ls -la ~/.cc_telegram/events/

# Check permissions
chmod -R 755 ~/.cc_telegram/

# Verify JSON format
cat ~/.cc_telegram/events/test_event.json | jq
```

### Performance Issues

```bash
# Check system resources
./performance_monitor.sh monitor

# Enable debug logging
RUST_LOG=debug ./cctelegram-bridge     # Adjust path based on installation method
```

### Port Already in Use

```bash
# Find what's using port 8080
lsof -i :8080

# Change port in config
sed -i 's/health_check_port = 8080/health_check_port = 8081/' ~/.cc_telegram/config.toml
```

## 🎉 Success! You're Done!

Your CC Telegram Bridge is now:

- ✅ **Running** and processing events
- 📱 **Connected** to your Telegram account
- 📊 **Monitored** with health checks and metrics
- 🔒 **Secured** with authentication and rate limiting
- 🚀 **Ready** for production workloads

### What's Next?

- Integrate with your development workflow
- Set up automated monitoring alerts
- Explore advanced configuration options
- Check out the full documentation in `README.md`

---

**Need Help?**

- 📖 Read the full [README.md](README.md)
- 🐛 Report issues on [GitHub](https://github.com/co8/cc-telegram/issues)
- 💬 Join discussions in the project repository

**Built with ❤️ and ☕** - Happy coding! 🚀

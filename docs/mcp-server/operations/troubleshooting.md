# Troubleshooting Guide

**Comprehensive troubleshooting procedures for CCTelegram MCP Server issues**

[![Troubleshooting](https://img.shields.io/badge/Troubleshooting-Expert%20Level-E6522C?style=for-the-badge&logo=tools)](README.md) [![Support](https://img.shields.io/badge/Support-24%2F7-00D26A?style=for-the-badge&logo=support)](runbooks/README.md) [![Resolution](https://img.shields.io/badge/Resolution-Fast%20Track-FF8C42?style=for-the-badge&logo=speed)](README.md)

---

## 🔍 Quick Issue Diagnosis

### Diagnostic Command Suite

```bash
#!/bin/bash
# quick-diagnosis.sh - Run this first for any issue

echo "🔍 CCTelegram MCP Server Quick Diagnosis"
echo "======================================="

# 1. Check if MCP server is running
echo "1. MCP Server Status:"
npm run status:mcp 2>/dev/null || echo "❌ MCP server not responding"

# 2. Check bridge process
echo "2. Bridge Process Status:"
ps aux | grep -E "(cctelegram|bridge)" | grep -v grep || echo "❌ Bridge process not found"

# 3. Check system resources
echo "3. System Resources:"
echo "   Memory: $(free -h | awk '/^Mem:/ {print $3 "/" $2}')"
echo "   CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)% used"
echo "   Disk: $(df -h / | awk 'NR==2{print $3 "/" $2 " (" $5 " used)"}')"

# 4. Check recent errors
echo "4. Recent Errors (last 10):"
tail -10 /var/log/cctelegram/error.log 2>/dev/null || echo "No error log found"

# 5. Check Telegram connectivity
echo "5. Telegram API Test:"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" | grep -q '"ok":true' && echo "✅ Telegram API accessible" || echo "❌ Telegram API connection failed"

# 6. Check file system accessibility
echo "6. File System Check:"
ls -la ~/.cc_telegram/ 2>/dev/null | head -5 || echo "❌ CCTelegram directory inaccessible"

echo "======================================="
echo "💡 Run specific troubleshooting sections based on the issues found above"
```

---

## 🚨 Common Issues & Solutions

### 1. MCP Server Not Starting

#### **Symptoms:**
- MCP server fails to start
- Connection refused errors
- Process exits immediately

#### **Diagnosis Commands:**
```bash
# Check server logs
npm run logs:mcp --tail=50

# Check port availability
netstat -tuln | grep :8080

# Verify configuration
npm run config:validate

# Check Node.js version
node --version
npm --version
```

#### **Common Causes & Solutions:**

**Port Already in Use**
```bash
# Find process using port 8080
lsof -i :8080

# Kill the process if safe
kill -9 $(lsof -ti :8080)

# Or change MCP port
export MCP_PORT=8081
npm run start:mcp
```

**Configuration Errors**
```bash
# Validate configuration syntax
npm run config:check

# Reset to default configuration
cp config/cctelegram.example.toml config/cctelegram.toml

# Check environment variables
env | grep MCP_
env | grep TELEGRAM_
```

**Permission Issues**
```bash
# Check directory permissions
ls -la ~/.cc_telegram/
ls -la /var/log/cctelegram/

# Fix permissions
chmod 755 ~/.cc_telegram/
chmod 644 ~/.cc_telegram/events/
chmod 644 ~/.cc_telegram/responses/

# Create missing directories
mkdir -p ~/.cc_telegram/{events,responses,status}
```

**Node.js Version Compatibility**
```bash
# Check Node.js version (requires 18.x or 20.x)
node --version

# Install correct version using nvm
nvm install 20
nvm use 20

# Clear npm cache
npm cache clean --force
npm install
```

### 2. Bridge Process Issues

#### **Symptoms:**
- Bridge process not starting
- Events not being processed
- Telegram messages not delivered

#### **Diagnosis Commands:**
```bash
# Check bridge status
npm run bridge:status

# View bridge logs
npm run bridge:logs --tail=50

# Test bridge executable
npm run bridge:test

# Check bridge health
curl -f http://localhost:8080/health/bridge
```

#### **Solutions:**

**Bridge Executable Not Found**
```bash
# Download/install bridge
npm run bridge:install

# Verify bridge executable
which cctelegram-bridge
ls -la $(which cctelegram-bridge)

# Manual installation
curl -L https://github.com/cctelegram/releases/latest/download/cctelegram-bridge-linux -o ~/.local/bin/cctelegram-bridge
chmod +x ~/.local/bin/cctelegram-bridge
```

**Bridge Configuration Issues**
```bash
# Check bridge configuration
npm run bridge:config:show

# Reset bridge configuration
npm run bridge:config:reset

# Update bridge configuration
npm run bridge:config:update
```

**Bridge Process Crashes**
```bash
# Check crash logs
tail -50 /var/log/cctelegram/bridge-crash.log

# Check system resources
npm run system:resources

# Restart with debug mode
MCP_DEBUG_MODE=true npm run bridge:restart
```

### 3. Telegram Integration Problems

#### **Symptoms:**
- Messages not sent to Telegram
- Bot API errors
- Authentication failures

#### **Diagnosis Commands:**
```bash
# Test bot token
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"

# Test message sending
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"Test message\"}"

# Check rate limiting
npm run telegram:status

# View Telegram API logs
npm run logs:telegram --tail=20
```

#### **Solutions:**

**Invalid Bot Token**
```bash
# Verify token format (should be like: 123456789:ABCdefGHIjklMNOpqrSTUvwxyz)
echo $TELEGRAM_BOT_TOKEN | grep -E '^[0-9]+:[a-zA-Z0-9_-]{35}$'

# Test with Bot Father
# 1. Message @BotFather on Telegram
# 2. Use /mybots to list your bots
# 3. Regenerate token if needed

# Update token
export TELEGRAM_BOT_TOKEN="your-new-token-here"
```

**Invalid Chat ID**
```bash
# Get your chat ID
# 1. Send a message to your bot
# 2. Check updates
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"

# Verify chat ID format (should be a number, possibly negative for groups)
echo $TELEGRAM_CHAT_ID | grep -E '^-?[0-9]+$'
```

**Rate Limiting Issues**
```bash
# Check current rate limit status
npm run telegram:rate-limit:status

# Wait for rate limit reset (typically 1 minute)
sleep 60

# Implement exponential backoff
npm run telegram:send --with-backoff
```

**Network Connectivity**
```bash
# Test DNS resolution
nslookup api.telegram.org

# Test HTTPS connectivity
curl -v https://api.telegram.org/

# Check proxy settings
echo $HTTP_PROXY
echo $HTTPS_PROXY

# Test with different DNS
export DNS_SERVER=8.8.8.8
npm run telegram:test --dns=$DNS_SERVER
```

### 4. Performance Issues

#### **Symptoms:**
- Slow response times
- High memory usage
- CPU spikes
- Event processing delays

#### **Diagnosis Commands:**
```bash
# Monitor system resources
npm run monitor:resources

# Check event queue depth
npm run queue:status

# Profile memory usage
npm run profile:memory

# Analyze performance metrics
npm run metrics:performance
```

#### **Solutions:**

**High Memory Usage**
```bash
# Check memory usage breakdown
npm run memory:analyze

# Force garbage collection
npm run gc:force

# Restart with memory profiling
NODE_OPTIONS="--max-old-space-size=512" npm run start:mcp

# Enable memory monitoring
export MCP_MEMORY_MONITORING=true
npm run restart:all
```

**Event Queue Buildup**
```bash
# Check queue depth and processing rate
npm run queue:stats

# Clear stuck events
npm run queue:clear --force

# Increase concurrent processing
export MCP_MAX_CONCURRENT_EVENTS=100
npm run restart:mcp

# Scale bridge workers
npm run bridge:scale --workers=4
```

**CPU Performance Issues**
```bash
# Profile CPU usage
npm run profile:cpu --duration=60

# Check for CPU-intensive operations
npm run perf:analyze

# Optimize event processing
export MCP_ENABLE_CACHING=true
export MCP_BATCH_PROCESSING=true
npm run restart:all
```

**Network Performance**
```bash
# Test network latency to Telegram
ping -c 5 api.telegram.org

# Check connection pooling
npm run network:stats

# Enable connection optimization
export MCP_CONNECTION_POOLING=true
export MCP_KEEP_ALIVE=true
npm run restart:mcp
```

### 5. File System Issues

#### **Symptoms:**
- Events not saved to disk
- Permission denied errors
- Disk space warnings
- File corruption

#### **Diagnosis Commands:**
```bash
# Check disk space
df -h ~/.cc_telegram/

# Check file permissions
ls -la ~/.cc_telegram/

# Check for corrupted files
npm run files:validate

# Monitor file system activity
npm run fs:monitor
```

#### **Solutions:**

**Disk Space Issues**
```bash
# Clean old event files
npm run cleanup:events --older-than=24h

# Clean old response files
npm run cleanup:responses --older-than=1h

# Compress old logs
npm run logs:compress

# Set up log rotation
npm run logs:setup-rotation
```

**Permission Problems**
```bash
# Fix directory permissions
sudo chown -R $USER:$USER ~/.cc_telegram/
chmod 755 ~/.cc_telegram/
chmod 755 ~/.cc_telegram/{events,responses,status}/
chmod 644 ~/.cc_telegram/events/*.json
chmod 644 ~/.cc_telegram/responses/*.json

# Create missing directories with correct permissions
mkdir -p ~/.cc_telegram/{events,responses,status,logs}
chmod 755 ~/.cc_telegram/{events,responses,status,logs}
```

**File System Monitoring**
```bash
# Enable file system monitoring
export MCP_FS_MONITORING=true

# Set up automatic cleanup
echo "0 */6 * * * /usr/local/bin/cctelegram-cleanup" | crontab -

# Monitor file system health
npm run fs:health-check
```

---

## 🔧 Advanced Troubleshooting

### Debug Mode Operations

#### **Enable Comprehensive Debugging**
```bash
# Start with full debugging
export MCP_DEBUG_MODE=true
export MCP_LOG_LEVEL=debug
export MCP_VERBOSE_ERRORS=true
export NODE_ENV=development

npm run start:debug
```

#### **Component-Specific Debugging**
```bash
# Debug MCP server only
npm run debug:mcp

# Debug bridge only
npm run debug:bridge

# Debug Telegram integration
npm run debug:telegram

# Debug event processing
npm run debug:events
```

#### **Network Debugging**
```bash
# Capture network traffic
sudo tcpdump -i any -w cctelegram-traffic.pcap port 443

# Analyze HTTP requests
npm run debug:http-requests

# Test with mock services
npm run test:with-mocks
```

### Memory and Performance Profiling

#### **Memory Profiling**
```bash
# Generate heap dump
npm run heap-dump

# Analyze memory leaks
npm run memory:leak-detection

# Profile memory usage over time
npm run memory:profile --duration=300

# Generate memory report
npm run memory:report
```

#### **Performance Profiling**
```bash
# CPU profiling
npm run profile:cpu --output=cpu-profile.log

# Event loop monitoring
npm run profile:event-loop

# Generate performance flame graph
npm run profile:flame-graph

# Benchmark specific operations
npm run benchmark:event-processing
npm run benchmark:telegram-api
```

### Log Analysis Tools

#### **Structured Log Analysis**
```bash
# Search for specific errors
npm run logs:search --pattern="ERROR|FATAL" --since="1h"

# Analyze error patterns
npm run logs:analyze-errors

# Generate log summary
npm run logs:summary --timeframe="24h"

# Export logs for analysis
npm run logs:export --format=json --since="24h" --output=analysis.json
```

#### **Performance Log Analysis**
```bash
# Analyze response times
npm run logs:performance-analysis

# Track resource usage over time
npm run logs:resource-usage --chart

# Identify slow operations
npm run logs:slow-operations --threshold=1000ms
```

---

## 🆘 Emergency Procedures

### System Recovery

#### **Complete System Recovery**
```bash
#!/bin/bash
# emergency-recovery.sh

echo "🆘 Starting Emergency Recovery Procedure"

# 1. Stop all processes
npm run stop:all --force

# 2. Backup current state
mkdir -p /tmp/cctelegram-backup-$(date +%s)
cp -r ~/.cc_telegram/ /tmp/cctelegram-backup-$(date +%s)/

# 3. Clean temporary files
npm run clean:all

# 4. Reset configuration to defaults
cp config/cctelegram.example.toml config/cctelegram.toml

# 5. Recreate directories
mkdir -p ~/.cc_telegram/{events,responses,status,logs}
chmod 755 ~/.cc_telegram/{events,responses,status,logs}

# 6. Start with minimal configuration
export MCP_DEBUG_MODE=true
export MCP_LOG_LEVEL=info
npm run start:minimal

# 7. Test basic functionality
sleep 10
npm run test:basic-functionality

echo "✅ Emergency recovery completed"
echo "📁 Backup available at: /tmp/cctelegram-backup-*"
```

#### **Configuration Reset**
```bash
# Reset to factory defaults
npm run config:reset --confirm

# Restore from backup
npm run config:restore --backup-file=config.backup.toml

# Validate configuration
npm run config:validate --strict
```

#### **Data Recovery**
```bash
# Recover events from backup
npm run recover:events --from-backup

# Repair corrupted files
npm run repair:files --auto-fix

# Restore from system backup
npm run restore:from-system-backup --date="2025-08-07"
```

---

## 📊 Health Monitoring

### Continuous Health Checks

#### **Automated Health Monitoring**
```bash
#!/bin/bash
# health-monitor.sh - Run continuously for health monitoring

while true; do
    echo "🏥 Health Check - $(date)"
    
    # MCP Server Health
    if curl -sf http://localhost:8080/health > /dev/null; then
        echo "✅ MCP Server: Healthy"
    else
        echo "❌ MCP Server: Unhealthy"
        npm run restart:mcp
    fi
    
    # Bridge Process Health
    if pgrep -f "cctelegram-bridge" > /dev/null; then
        echo "✅ Bridge Process: Running"
    else
        echo "❌ Bridge Process: Not running"
        npm run start:bridge
    fi
    
    # Memory Usage Check
    MEMORY_PERCENT=$(free | awk '/^Mem:/ {printf "%.0f", $3/$2 * 100}')
    if [ $MEMORY_PERCENT -gt 80 ]; then
        echo "⚠️ Memory Usage: ${MEMORY_PERCENT}% (High)"
        npm run gc:force
    else
        echo "✅ Memory Usage: ${MEMORY_PERCENT}%"
    fi
    
    # Disk Space Check
    DISK_PERCENT=$(df ~/.cc_telegram | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ $DISK_PERCENT -gt 90 ]; then
        echo "⚠️ Disk Usage: ${DISK_PERCENT}% (Critical)"
        npm run cleanup:old-files
    else
        echo "✅ Disk Usage: ${DISK_PERCENT}%"
    fi
    
    echo "---"
    sleep 300  # Check every 5 minutes
done
```

### Performance Baseline Monitoring

#### **Performance Metrics Collection**
```bash
# Start metrics collection
npm run metrics:start-collection

# Generate performance baseline
npm run metrics:baseline --duration=1800  # 30 minutes

# Compare current performance to baseline
npm run metrics:compare-baseline

# Generate performance report
npm run metrics:generate-report --format=html --output=performance-report.html
```

---

## 🔗 Integration Support

### Claude Code Integration Issues

#### **Common Claude Code Problems**
```bash
# Test MCP connection from Claude Code
# In Claude Code terminal:
node -e "
  const { MCPClient } = require('@cctelegram/mcp-client');
  const client = new MCPClient({ host: 'localhost', port: 8080 });
  client.connect().then(() => console.log('✅ MCP connection successful')).catch(console.error);
"

# Test tool availability
curl -X POST http://localhost:8080/mcp/tools/list

# Verify tool responses
curl -X POST http://localhost:8080/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{"tool": "get_bridge_status", "params": {}}'
```

### Task Master Integration

#### **Task Master Sync Issues**
```bash
# Check Task Master integration
npm run taskmaster:status

# Sync task status
npm run taskmaster:sync

# Test task completion notifications
npm run test:task-completion --task-id="test-001"
```

---

## 📞 Support Resources

### Getting Help

#### **Support Channels**
- **Documentation**: [Complete documentation hub](../README.md)
- **Issue Tracking**: GitHub Issues with detailed templates
- **Community Support**: Discord server for real-time help
- **Professional Support**: Enterprise support contracts available

#### **Diagnostic Information Collection**
```bash
#!/bin/bash
# collect-diagnostic-info.sh - Run before contacting support

echo "📋 Collecting Diagnostic Information for Support"
echo "=============================================="

DIAG_DIR="/tmp/cctelegram-diagnostics-$(date +%s)"
mkdir -p "$DIAG_DIR"

# System information
uname -a > "$DIAG_DIR/system-info.txt"
node --version >> "$DIAG_DIR/system-info.txt"
npm --version >> "$DIAG_DIR/system-info.txt"

# Configuration (sanitized)
npm run config:export --sanitize > "$DIAG_DIR/config-sanitized.json"

# Recent logs
tail -500 /var/log/cctelegram/*.log > "$DIAG_DIR/recent-logs.txt"

# System resources
free -h > "$DIAG_DIR/memory-usage.txt"
df -h > "$DIAG_DIR/disk-usage.txt"
ps aux | grep -E "(node|cctelegram)" > "$DIAG_DIR/processes.txt"

# Network status
netstat -tuln | grep -E "(8080|443)" > "$DIAG_DIR/network-status.txt"

# Package information
npm list --depth=0 > "$DIAG_DIR/package-list.txt"

# Create archive
tar -czf "$DIAG_DIR.tar.gz" -C /tmp "$(basename $DIAG_DIR)"

echo "✅ Diagnostic information collected:"
echo "📁 Archive: $DIAG_DIR.tar.gz"
echo "📋 Include this file when contacting support"
```

---

## 🔗 Related Documentation

### Troubleshooting Resources
- **[Operations Center](README.md)** - Complete operations overview
- **[System Architecture](../architecture/system-overview.md)** - Understanding system components
- **[Performance Tuning](../maintenance/performance-tuning.md)** - Optimization procedures

### Emergency Resources
- **[Incident Response](runbooks/incident-response.md)** - Emergency response procedures
- **[Security Procedures](../security/security-procedures.md)** - Security incident handling
- **[Backup & Recovery](backup-recovery.md)** - Data recovery procedures

---

*Troubleshooting Guide - Expert Level*  
*Last updated: August 2025 | Next review: November 2025*

## See Also

- **[Operations Runbooks](runbooks/README.md)** - Operational procedures and emergency response
- **[Monitoring & Alerting](monitoring.md)** - System monitoring and alerting setup
- **[Health Check Procedures](runbooks/health-checks.md)** - Automated health monitoring
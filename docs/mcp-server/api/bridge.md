# Bridge Management

The CCTelegram bridge process is the core service that handles Telegram Bot API communication. These 5 tools provide complete bridge lifecycle management.

## 🛠️ Available Tools

### start_bridge
Start the CCTelegram bridge process if not currently running.

**Use Cases:**
- Initial bridge startup
- Recovery after crashes
- Automated deployment scripts

**Parameters:** None required

**Response:**
```json
{
  "success": true,
  "message": "Bridge started successfully",
  "pid": 12345
}
```

**Error Responses:**
```json
// Bridge already running
{
  "success": false,
  "message": "Bridge is already running",
  "pid": 12345
}

// Startup failed
{
  "success": false,
  "message": "Failed to start bridge: permission denied",
  "error": "EACCES"
}
```

### stop_bridge
Stop the running CCTelegram bridge process.

**Use Cases:**
- Graceful shutdown
- Maintenance operations  
- Configuration changes requiring restart

**Parameters:** None required

**Response:**
```json
{
  "success": true,
  "message": "Bridge stopped successfully"
}
```

**Error Responses:**
```json
// Bridge not running
{
  "success": false,
  "message": "Bridge is not running"
}

// Stop failed
{
  "success": false,
  "message": "Failed to stop bridge: process not responding",
  "error": "TIMEOUT"
}
```

### restart_bridge
Restart the bridge process (stop + start operation).

**Use Cases:**
- Configuration updates
- Memory leak recovery
- Periodic maintenance

**Parameters:** None required

**Response:**
```json
{
  "success": true,
  "message": "Bridge restarted successfully",
  "pid": 54321,
  "previous_pid": 12345
}
```

**Error Responses:**
```json
// Restart failed
{
  "success": false,
  "message": "Bridge restart failed during stop phase",
  "error": "STOP_FAILED"
}
```

### ensure_bridge_running
Ensure the bridge is running, start it if needed (idempotent operation).

**Use Cases:**
- Health monitoring systems
- Automated recovery scripts
- Service availability checks

**Parameters:** None required

**Response:**
```json
// Started new bridge
{
  "success": true,
  "message": "Bridge was not running, started successfully",
  "action": "started",
  "pid": 12345
}

// Bridge already running
{
  "success": true,
  "message": "Bridge is already running",
  "action": "already_running",
  "pid": 12345
}

// Failed to start
{
  "success": false,
  "message": "Bridge was not running and failed to start",
  "action": "failed",
  "error": "START_FAILED"
}
```

### check_bridge_process
Check if the bridge process is currently running.

**Use Cases:**
- Health monitoring
- Status dashboards
- Pre-operation validation

**Parameters:** None required

**Response:**
```json
// Bridge running
{
  "running": true,
  "message": "Bridge process is running",
  "pid": 12345
}

// Bridge not running
{
  "running": false,
  "message": "Bridge process is not running"
}
```

## 🔄 Bridge Lifecycle

### Typical Operations Flow

1. **Initial Setup**
   ```bash
   # Check if bridge is running
   check_bridge_process
   
   # Start if needed
   ensure_bridge_running
   ```

2. **Configuration Update**
   ```bash
   # Stop bridge for config changes
   stop_bridge
   
   # Update configuration files
   # ...
   
   # Start with new configuration
   start_bridge
   ```

3. **Maintenance Restart**
   ```bash
   # Single operation restart
   restart_bridge
   ```

4. **Health Monitoring**
   ```bash
   # Regular health check
   check_bridge_process
   
   # Auto-recovery if needed
   ensure_bridge_running
   ```

## ⚙️ Bridge Process Details

### Process Management
The bridge runs as a separate Node.js process with:

- **Process ID (PID)** tracking
- **Health monitoring** via HTTP endpoint
- **Graceful shutdown** handling
- **Automatic restart** capabilities

### Configuration
Bridge configuration is loaded from:

```bash
# Environment variables
CC_TELEGRAM_BOT_TOKEN=your_bot_token
CC_TELEGRAM_CHAT_ID=your_chat_id

# Configuration files
~/.cc_telegram/config.toml
./config.toml
```

### Logging
Bridge process logs are available at:

```bash
# Default log locations
~/.cc_telegram/logs/bridge.log
./logs/bridge.log

# Log level configuration
CC_TELEGRAM_LOG_LEVEL=info
```

## 🚨 Error Handling

### Common Error Codes

| Code | Description | Resolution |
|------|-------------|------------|
| `PROCESS_NOT_FOUND` | Bridge process not running | Use `start_bridge` or `ensure_bridge_running` |
| `START_FAILED` | Failed to start bridge process | Check configuration and permissions |
| `STOP_FAILED` | Failed to stop bridge process | May need manual intervention |
| `RESTART_FAILED` | Restart operation failed | Check logs for specific error |
| `PERMISSION_DENIED` | Insufficient permissions | Check file/process permissions |
| `CONFIG_ERROR` | Configuration file invalid | Validate configuration syntax |
| `NETWORK_ERROR` | Network connectivity issues | Check bot token and network |

### Troubleshooting Steps

1. **Check Process Status**
   ```bash
   # Use MCP tool
   check_bridge_process
   
   # Or check manually
   ps aux | grep cctelegram
   ```

2. **Review Logs**
   ```bash
   tail -f ~/.cc_telegram/logs/bridge.log
   ```

3. **Validate Configuration**
   ```bash
   # Check environment variables
   echo $CC_TELEGRAM_BOT_TOKEN
   echo $CC_TELEGRAM_CHAT_ID
   
   # Test configuration
   cctelegram-bridge --config-test
   ```

4. **Network Connectivity**
   ```bash
   # Test Telegram API connectivity
   curl https://api.telegram.org/bot<TOKEN>/getMe
   ```

## 📊 Monitoring & Health

### Health Check Endpoint
When running, the bridge exposes a health endpoint:

```bash
# Default health endpoint
curl http://localhost:8080/health

# Response
{
  "status": "healthy",
  "uptime": 3600,
  "pid": 12345,
  "memory_usage": "45.2 MB",
  "last_telegram_check": "2025-01-15T10:30:00Z"
}
```

### Metrics Collection
The bridge can provide metrics for monitoring:

```bash
# Metrics endpoint
curl http://localhost:8080/metrics

# Prometheus format
# TYPE bridge_uptime_seconds gauge
bridge_uptime_seconds 3600
# TYPE bridge_events_processed_total counter  
bridge_events_processed_total 1250
# TYPE bridge_telegram_api_calls_total counter
bridge_telegram_api_calls_total 450
```

## 🎯 Best Practices

### Startup Procedures
- Always use `ensure_bridge_running` in automated scripts
- Implement retry logic with exponential backoff
- Monitor bridge health after startup
- Validate configuration before starting

### Shutdown Procedures  
- Use `stop_bridge` for graceful shutdown
- Allow sufficient time for cleanup (5-10 seconds)
- Check process termination with `check_bridge_process`
- Save any persistent state before shutdown

### Monitoring
- Regular health checks every 30-60 seconds
- Monitor process memory usage and restart if needed
- Track bridge uptime and restart frequency
- Set up alerting for bridge failures

### Configuration Management
- Use environment variables for sensitive data
- Version control configuration files
- Test configuration changes in staging first
- Keep backup configurations for rollback

### Error Recovery
- Implement automatic restart for transient failures
- Use circuit breaker patterns for repeated failures
- Log all bridge operations for troubleshooting
- Set up monitoring alerts for bridge downtime
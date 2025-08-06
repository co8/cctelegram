# Recovery Procedures

Step-by-step recovery procedures for CCTelegram 3-tier cascading system failures.

## 🚨 Emergency Recovery (0-5 minutes)

### Complete System Failure (ALL-TIERS-DOWN)
```bash
#!/bin/bash
# emergency-recovery.sh
echo "🚨 EMERGENCY RECOVERY STARTING..."

# Step 1: Stop all services (2 minutes max)
systemctl stop cctelegram-mcp cctelegram-bridge nginx
sleep 5

# Step 2: Clear temporary files
rm -rf /tmp/cctelegram-* /var/run/cctelegram-*
rm -f /var/log/cctelegram/*.lock

# Step 3: Start services in order
systemctl start nginx
sleep 5
systemctl start cctelegram-bridge  
sleep 10
systemctl start cctelegram-mcp

# Step 4: Verify recovery
for i in {1..12}; do
  if curl -H "X-API-Key: $API_KEY" http://localhost:8080/health >/dev/null 2>&1; then
    echo "✅ SYSTEM RECOVERED in $((i*5)) seconds"
    exit 0
  fi
  sleep 5
done

echo "❌ RECOVERY FAILED - Escalate to L2"
exit 1
```

### Service Crash Recovery
```bash
# Quick service restart with health verification
restart_with_verification() {
  local service=$1
  echo "🔄 Restarting $service..."
  
  systemctl restart $service
  sleep 10
  
  if systemctl is-active $service >/dev/null; then
    echo "✅ $service restarted successfully"
    return 0
  else
    echo "❌ $service restart failed"
    systemctl status $service --no-pager
    return 1
  fi
}

# Usage: restart_with_verification cctelegram-mcp
```

## ⚡ Tier-Specific Recovery

### Tier 1: MCP Webhook Recovery (0-2 minutes)
```bash
# T1 webhook recovery procedure
recover_tier1() {
  echo "🔧 Recovering Tier 1 (MCP Webhook)..."
  
  # Check webhook endpoint
  if ! curl -H "X-API-Key: $API_KEY" http://localhost:8080/health >/dev/null 2>&1; then
    echo "📡 Webhook not responding, restarting MCP server..."
    systemctl restart cctelegram-mcp
    sleep 15
  fi
  
  # Verify webhook with timeout test
  for timeout_ms in 50 75 100; do
    response_time=$(curl -w "%{time_total}" -H "X-API-Key: $API_KEY" \
      --max-time 0.${timeout_ms} http://localhost:8080/health -o /dev/null -s 2>/dev/null)
    if [ $? -eq 0 ]; then
      echo "✅ T1 responding in ${response_time}s (target: <0.1s)"
      return 0
    fi
  done
  
  echo "⚠️ T1 slow/unresponsive - failing over to T2"
  return 1
}
```

### Tier 2: Bridge Internal Recovery (2-5 minutes)
```bash
# T2 bridge internal recovery
recover_tier2() {
  echo "🔧 Recovering Tier 2 (Bridge Internal)..."
  
  # Check internal processor
  if ! curl -H "X-API-Key: $API_KEY" -X POST \
      http://localhost:8080/tools/get_bridge_status >/dev/null 2>&1; then
    
    echo "🔄 Restarting bridge service..."
    curl -H "X-API-Key: $API_KEY" -X POST \
      http://localhost:8080/tools/restart_bridge
    sleep 20
  fi
  
  # Check queue status and clear if needed
  queue_size=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/get_bridge_status | \
    jq -r '.queue_size // 0' 2>/dev/null)
    
  if [ "$queue_size" -gt 100 ]; then
    echo "⚠️ High queue size ($queue_size), clearing old entries..."
    curl -H "X-API-Key: $API_KEY" -X POST \
      http://localhost:8080/tools/clear_old_responses \
      -d '{"older_than_hours": 1}'
  fi
  
  # Verify T2 response time
  start_time=$(date +%s%3N)
  curl -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/get_bridge_status >/dev/null 2>&1
  end_time=$(date +%s%3N)
  response_time=$((end_time - start_time))
  
  if [ $response_time -lt 500 ]; then
    echo "✅ T2 responding in ${response_time}ms (target: <500ms)"
    return 0
  else
    echo "⚠️ T2 slow (${response_time}ms) - failing over to T3"
    return 1
  fi
}
```

### Tier 3: File Watcher Recovery (5-10 minutes)
```bash
# T3 file watcher recovery
recover_tier3() {
  echo "🔧 Recovering Tier 3 (File Watcher)..."
  
  # Check disk space first
  disk_usage=$(df /var/lib/cctelegram | tail -1 | awk '{print $5}' | sed 's/%//')
  if [ $disk_usage -gt 90 ]; then
    echo "💾 Disk usage high ($disk_usage%), cleaning up..."
    find /var/lib/cctelegram -name "*.processed" -mtime +1 -delete
    find /var/lib/cctelegram -name "*.tmp" -mmin +60 -delete
  fi
  
  # Check inotify limits
  current_watches=$(find /proc/*/fd -lname anon_inode:inotify 2>/dev/null | wc -l)
  max_watches=$(cat /proc/sys/fs/inotify/max_user_watches)
  
  if [ $current_watches -gt $((max_watches * 80 / 100)) ]; then
    echo "👁️  High inotify usage ($current_watches/$max_watches), restarting watchers..."
    systemctl restart cctelegram-mcp
    sleep 30
  fi
  
  # Test file operations
  test_file="/var/lib/cctelegram/test-$(date +%s).tmp"
  if echo "test" > $test_file 2>/dev/null; then
    rm -f $test_file
    echo "✅ T3 file operations working"
    return 0
  else
    echo "❌ T3 file operations failed - check permissions"
    return 1
  fi
}
```

## 🔄 Circuit Breaker Recovery

### Automatic Circuit Breaker Reset
```bash
# Reset circuit breakers for all tiers
reset_circuit_breakers() {
  echo "🔄 Resetting circuit breakers..."
  
  # Get current circuit breaker states
  cb_status=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/get_bridge_status | \
    jq -r '.tier_health[] | "\(.tier_type):\(.circuit_breaker_state)"')
  
  echo "Current circuit breaker states:"
  echo "$cb_status"
  
  # Force restart bridge to reset internal state
  echo "🔄 Restarting bridge to reset circuit breakers..."
  curl -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/restart_bridge
  
  sleep 30
  
  # Verify reset
  new_status=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/get_bridge_status | \
    jq -r '.tier_health[] | "\(.tier_type):\(.circuit_breaker_state)"')
  
  echo "New circuit breaker states:"
  echo "$new_status"
}
```

### Manual Circuit Breaker Testing
```bash
# Test circuit breaker recovery
test_circuit_breaker_recovery() {
  local tier=$1
  echo "🧪 Testing $tier circuit breaker recovery..."
  
  # Send test events to trigger recovery
  for i in {1..5}; do
    curl -H "X-API-Key: $API_KEY" -X POST \
      http://localhost:8080/tools/send_telegram_message \
      -d "{\"message\": \"Circuit breaker test $i\", \"source\": \"recovery-test\"}" \
      >/dev/null 2>&1
    sleep 2
  done
  
  # Check if circuit breaker recovered
  cb_state=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/get_bridge_status | \
    jq -r ".tier_health[] | select(.tier_type==\"$tier\") | .circuit_breaker_state")
    
  if [ "$cb_state" = "closed" ]; then
    echo "✅ $tier circuit breaker recovered"
  else
    echo "⚠️ $tier circuit breaker still $cb_state"
  fi
}
```

## 🗃️ Data Recovery

### Configuration Recovery
```bash
# Restore configuration from backup
restore_config() {
  echo "📁 Restoring configuration..."
  
  # Stop services
  systemctl stop cctelegram-mcp cctelegram-bridge
  
  # Restore from backup (implement your backup strategy)
  if [ -f /var/backups/cctelegram-config.tar.gz ]; then
    cd /
    tar -xzf /var/backups/cctelegram-config.tar.gz
    echo "✅ Configuration restored from backup"
  else
    echo "⚠️ No configuration backup found, using defaults"
    # Copy default configuration
    cp /etc/cctelegram/config.example.toml /etc/cctelegram/config.toml
  fi
  
  # Restart services
  systemctl start cctelegram-bridge cctelegram-mcp
}
```

### Queue Recovery
```bash
# Recover stuck queue items
recover_queue() {
  echo "📋 Recovering stuck queue items..."
  
  # Get queue status
  queue_status=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/get_task_status | \
    jq -r '.summary_only = false' 2>/dev/null)
  
  # Clear old responses (>1 hour)
  curl -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/clear_old_responses \
    -d '{"older_than_hours": 1}'
  
  # Restart bridge to clear internal queues
  curl -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/restart_bridge
  
  sleep 15
  
  echo "✅ Queue recovery completed"
}
```

### File System Recovery
```bash
# Recover corrupted file system state
recover_filesystem() {
  echo "📁 Recovering file system state..."
  
  # Stop file watcher temporarily
  systemctl stop cctelegram-mcp
  
  # Check and fix file permissions
  chown -R cctelegram:cctelegram /var/lib/cctelegram
  chmod -R 755 /var/lib/cctelegram
  
  # Remove corrupted lock files
  find /var/lib/cctelegram -name "*.lock" -delete
  find /var/lib/cctelegram -name "*.tmp" -mmin +10 -delete
  
  # Recreate directory structure if needed
  mkdir -p /var/lib/cctelegram/{queue,processed,failed}
  
  # Restart service
  systemctl start cctelegram-mcp
  
  echo "✅ File system recovery completed"
}
```

## 🔧 Performance Recovery

### Memory Pressure Recovery
```bash
# Recover from memory pressure
recover_memory_pressure() {
  echo "🧠 Recovering from memory pressure..."
  
  # Get current memory usage
  mem_usage=$(free | grep Mem | awk '{printf "%.0f", ($3/$2) * 100.0}')
  echo "Current memory usage: ${mem_usage}%"
  
  if [ $mem_usage -gt 85 ]; then
    echo "🔄 High memory usage, performing rolling restart..."
    
    # Rolling restart to free memory
    for service in cctelegram-bridge cctelegram-mcp; do
      echo "Restarting $service..."
      systemctl restart $service
      sleep 30
      
      # Check if memory improved
      new_mem_usage=$(free | grep Mem | awk '{printf "%.0f", ($3/$2) * 100.0}')
      echo "Memory usage after $service restart: ${new_mem_usage}%"
    done
  fi
  
  # Force garbage collection if available
  if systemctl is-active cctelegram-mcp >/dev/null; then
    curl -s -X POST -H "X-API-Key: $API_KEY" \
      http://localhost:8080/admin/gc >/dev/null 2>&1 || true
  fi
  
  echo "✅ Memory pressure recovery completed"
}
```

### CPU Recovery
```bash
# Recover from high CPU usage
recover_cpu_pressure() {
  echo "⚡ Recovering from CPU pressure..."
  
  # Check current CPU usage
  cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')
  echo "Current CPU usage: ${cpu_usage}%"
  
  # Identify CPU-intensive processes
  high_cpu_pids=$(ps aux --sort=-%cpu | grep cctelegram | head -3 | awk '{print $2}')
  
  for pid in $high_cpu_pids; do
    if [ -n "$pid" ] && [ "$pid" != "PID" ]; then
      cpu_percent=$(ps -p $pid -o %cpu --no-headers 2>/dev/null)
      if [ -n "$cpu_percent" ] && [ $(echo "$cpu_percent > 50" | bc 2>/dev/null) -eq 1 ]; then
        echo "⚠️ High CPU process PID $pid (${cpu_percent}% CPU)"
        # Consider restarting the service instead of killing process
      fi
    fi
  done
  
  # Reduce processing load temporarily
  curl -s -X POST -H "X-API-Key: $API_KEY" \
    http://localhost:8080/admin/throttle \
    -d '{"enabled": true, "max_requests_per_minute": 30}' >/dev/null 2>&1 || true
  
  echo "✅ CPU pressure recovery completed (throttling enabled)"
}
```

## 📊 Health Verification

### Complete System Health Check
```bash
# Comprehensive health verification
verify_system_health() {
  echo "🔍 Verifying system health..."
  local failures=0
  
  # Check services
  for service in cctelegram-mcp cctelegram-bridge nginx; do
    if systemctl is-active $service >/dev/null; then
      echo "✅ $service: running"
    else
      echo "❌ $service: not running"
      failures=$((failures + 1))
    fi
  done
  
  # Check endpoints
  if curl -s -H "X-API-Key: $API_KEY" http://localhost:8080/health >/dev/null; then
    echo "✅ MCP endpoint: healthy"
  else
    echo "❌ MCP endpoint: unhealthy"
    failures=$((failures + 1))
  fi
  
  # Check resource usage
  mem_usage=$(free | grep Mem | awk '{printf "%.0f", ($3/$2) * 100.0}')
  cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')
  disk_usage=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
  
  echo "📊 Resource usage:"
  echo "   Memory: ${mem_usage}% $([ $mem_usage -lt 80 ] && echo "✅" || echo "⚠️")"
  echo "   CPU: ${cpu_usage}% $([ $(echo "$cpu_usage < 70" | bc) -eq 1 ] && echo "✅" || echo "⚠️")"
  echo "   Disk: ${disk_usage}% $([ $disk_usage -lt 80 ] && echo "✅" || echo "⚠️")"
  
  # Check tier health
  tier_health=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
    http://localhost:8080/tools/get_bridge_status | \
    jq -r '.tier_health[] | "\(.tier_type): \(.is_healthy)"' 2>/dev/null)
  
  echo "🎯 Tier health:"
  echo "$tier_health" | while read line; do
    if [[ $line == *"true"* ]]; then
      echo "   ✅ $line"
    else
      echo "   ❌ $line"
      failures=$((failures + 1))
    fi
  done
  
  if [ $failures -eq 0 ]; then
    echo "🎉 System health verification PASSED"
    return 0
  else
    echo "⚠️ System health verification FAILED ($failures issues)"
    return 1
  fi
}
```

### Performance Baseline Verification
```bash
# Verify performance has returned to baseline
verify_performance_baseline() {
  echo "📈 Verifying performance baseline..."
  
  # Test response times
  echo "Testing response times..."
  for i in {1..10}; do
    time=$(curl -w "%{time_total}" -H "X-API-Key: $API_KEY" \
      http://localhost:8080/health -o /dev/null -s)
    echo "Response $i: ${time}s"
  done | awk '/Response/ {sum += $3; count++} END {
    avg = sum/count
    printf "Average response time: %.3fs ", avg
    if(avg < 0.5) print "✅"
    else if(avg < 1.0) print "⚠️"
    else print "❌"
  }'
  
  # Test error rates
  echo "Testing error rates..."
  errors=0
  total=20
  for i in $(seq 1 $total); do
    if ! curl -s -H "X-API-Key: $API_KEY" \
        http://localhost:8080/health >/dev/null 2>&1; then
      errors=$((errors + 1))
    fi
  done
  
  error_rate=$(echo "scale=1; $errors * 100 / $total" | bc)
  echo "Error rate: ${error_rate}% $([ $(echo "$error_rate < 5" | bc) -eq 1 ] && echo "✅" || echo "❌")"
  
  echo "✅ Performance baseline verification completed"
}
```

---

**⚡ Quick Recovery Commands**:
- `systemctl restart cctelegram-mcp && sleep 10 && curl -H "X-API-Key: $API_KEY" http://localhost:8080/health` - Quick service restart + verify
- `./emergency-recovery.sh` - Full system emergency recovery
- `curl -X POST -H "X-API-Key: $API_KEY" http://localhost:8080/tools/restart_bridge` - Bridge-only restart

**🔗 Related**: [Error Codes](error-codes.md) | [Diagnostic Commands](diagnostic-commands.md) | [Emergency Runbook](emergency-runbook.md)
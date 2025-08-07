# Diagnostic Commands Reference

One-liner diagnostic commands for CCTelegram 3-tier cascading system troubleshooting.

## 🚀 Quick Health Check (30 seconds)

```bash
#!/bin/bash
# Complete system health check
echo "=== CCTelegram System Status ===" && \
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health | jq '.' && \
systemctl is-active cctelegram-mcp cctelegram-bridge && \
df -h | grep -E "(/$|/var)" | awk '{print $4" free on "$6}' && \
free -h | grep Mem | awk '{print "Memory: "$3" used / "$2" total"}' && \
echo "=== Status Complete ==="
```

## 🎯 Tier-Specific Diagnostics

### Tier 1: MCP Webhook (0-100ms)
```bash
# Health check with timing
curl -w "HTTP:%{http_code} Time:%{time_total}s\n" -H "X-API-Key: $API_KEY" \
  http://localhost:8080/health -o /dev/null -s

# Connection test
nc -zv localhost 8080 && echo "✅ Port 8080 open" || echo "❌ Port 8080 closed"

# Response time measurement
for i in {1..10}; do curl -w "%{time_total}\n" -H "X-API-Key: $API_KEY" \
  http://localhost:8080/health -o /dev/null -s; done | awk '{sum+=$1; count++} END {print "Avg:", sum/count, "seconds"}'

# SSL certificate check
echo | openssl s_client -connect localhost:8080 2>/dev/null | \
  openssl x509 -noout -dates
```

### Tier 2: Bridge Internal (100-500ms)
```bash
# Bridge status check
curl -H "X-API-Key: $API_KEY" -X POST http://localhost:8080/tools/get_bridge_status | \
  jq '.bridge_status, .tier_health'

# Process information
ps aux | grep -E "(node|cctelegram)" | grep -v grep | \
  awk '{print $2, $3, $4, $11}' | column -t

# Queue depth check
curl -H "X-API-Key: $API_KEY" -X POST http://localhost:8080/tools/get_task_status | \
  jq '.claude_code_tasks, .taskmaster_tasks' 2>/dev/null || echo "No task data"

# Memory usage by process
ps -o pid,ppid,pcpu,pmem,cmd -p $(pgrep -f cctelegram) | \
  tail -n +2 | sort -k4 -nr
```

### Tier 3: File Watcher (1-5s)
```bash
# File system check
df -h /var/lib/cctelegram && ls -la /var/lib/cctelegram/ | \
  head -10 && echo "Recent files count: $(find /var/lib/cctelegram -type f -newer /tmp/cctelegram-recent 2>/dev/null | wc -l)"

# Inotify usage
cat /proc/sys/fs/inotify/max_user_watches && \
  echo "Current watches: $(find /proc/*/fd -lname anon_inode:inotify 2>/dev/null | wc -l)"

# File watcher metrics
curl -H "X-API-Key: $API_KEY" http://localhost:9090/metrics | \
  grep -E "file_watcher|queue_depth" | head -10

# Cleanup old files
find /var/lib/cctelegram -type f -mtime +7 | wc -l | \
  awk '{print $1 " files older than 7 days"}'
```

## 📊 Performance Diagnostics

### System Resources
```bash
# CPU and memory snapshot
top -bn1 | head -10 && echo "=== Memory ===" && \
free -h && echo "=== Disk I/O ===" && iostat -x 1 1

# Network connections
netstat -tlnp | grep -E ":(8080|9090|3000)" | \
  awk '{print $1, $4, $7}' | column -t

# Load average trend
uptime && cat /proc/loadavg && \
  awk '{print "Load 15min: " $3 " (threshold: 2.0)"}' /proc/loadavg
```

### Application Performance
```bash
# Request rate (last 5 minutes)
curl -s http://localhost:9090/api/v1/query?query='rate(http_requests_total[5m])' | \
  jq '.data.result[] | {metric: .metric.method, value: .value[1]}' 2>/dev/null

# Error rate calculation
curl -s http://localhost:9090/api/v1/query?query='rate(http_requests_total{status=~"5.."}[5m])' | \
  jq '.data.result[0].value[1]' 2>/dev/null | awk '{printf "Error rate: %.2f req/sec\n", $1}'

# Response time percentiles
curl -s http://localhost:9090/api/v1/query?query='histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))' | \
  jq '.data.result[0].value[1]' 2>/dev/null | awk '{printf "95th percentile: %.2f seconds\n", $1}'
```

## 🔍 Deep Diagnostics

### Log Analysis
```bash
# Error spike detection (last hour)
grep "$(date -d '1 hour ago' '+%Y-%m-%d %H')" /var/log/cctelegram/application.log | \
  grep -c "ERROR" | awk '{print "Errors in last hour:", $1}'

# Correlation ID trace
read -p "Enter correlation ID: " CID && \
grep "correlation_id=$CID" /var/log/cctelegram/application.log | \
  awk '{print $1, $2, $6, $NF}' | column -t

# Security events summary
tail -100 /var/log/cctelegram/security.log | \
  jq -r '.level + " " + .message' 2>/dev/null | sort | uniq -c | sort -nr
```

### Database Diagnostics (if applicable)
```bash
# Connection pool status
sudo -u postgres psql -c "SELECT state, count(*) FROM pg_stat_activity WHERE application_name LIKE '%cctelegram%' GROUP BY state;"

# Long-running queries
sudo -u postgres psql -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';"

# Database size
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('cctelegram'));"
```

### Container Diagnostics (Docker/K8s)
```bash
# Container health
docker ps --filter name=cctelegram --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Resource usage
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | \
  grep cctelegram

# Container logs (last errors)
docker logs --since 5m cctelegram-mcp 2>&1 | grep -E "(ERROR|FATAL|CRITICAL)" | tail -10
```

## 🚨 Emergency Diagnostics

### System Under Load
```bash
# Immediate system stress check
echo "Load: $(cat /proc/loadavg | awk '{print $1}')" && \
echo "Memory: $(free | grep Mem | awk '{printf("%.0f%%\n", ($3/$2) * 100.0)}')" && \
echo "Disk: $(df / | tail -1 | awk '{print $5}')" && \
echo "Processes: $(ps aux | wc -l)"

# Network saturation check
ss -tuln | grep -E ":(8080|9090)" | wc -l | awk '{print "Active connections:", $1}'
```

### Circuit Breaker Analysis
```bash
# Circuit breaker states across tiers
curl -H "X-API-Key: $API_KEY" -X POST http://localhost:8080/tools/get_bridge_status | \
  jq '.tier_health[] | {tier: .tier_type, state: .circuit_breaker_state, healthy: .is_healthy}'

# Failure patterns
grep "circuit_breaker_state.*open" /var/log/cctelegram/application.log | \
  awk '{print $1, $2, $6}' | sort | uniq -c
```

### Service Discovery
```bash
# Find all CCTelegram processes
pgrep -f cctelegram | xargs ps -p | awk 'NR>1 {print $1, $4}' && \
lsof -i :8080 -i :9090 | grep LISTEN

# Service dependency check
curl -s http://localhost:8080/health | jq '.dependencies // empty' 2>/dev/null || \
  echo "No dependency health data"
```

## 📈 Trend Analysis

### Performance Trends
```bash
# Response time trend (last 24 hours)
for hour in {0..23}; do 
  echo -n "$(date -d "$hour hours ago" +%H):00 "
  grep "$(date -d "$hour hours ago" '+%Y-%m-%d %H')" /var/log/cctelegram/application.log 2>/dev/null | \
    grep "response_time_ms" | jq -r '.response_time_ms' | \
    awk '{sum+=$1; count++} END {printf "%.0fms avg\n", sum/count}' 2>/dev/null || echo "no data"
done
```

### Error Rate Trends
```bash
# Error rate by hour (last 24 hours)
for hour in {0..23}; do
  echo -n "$(date -d "$hour hours ago" +%H):00 "
  grep "$(date -d "$hour hours ago" '+%Y-%m-%d %H')" /var/log/cctelegram/application.log 2>/dev/null | \
    grep -c "ERROR" || echo "0"
done | awk '{print $1, $2 " errors"}'
```

## 🛠️ Interactive Diagnostics

### Multi-command Health Check
```bash
# Comprehensive diagnostic script
cat << 'EOF' > /tmp/cctelegram-diag.sh
#!/bin/bash
echo "=== CCTelegram Comprehensive Diagnostics ==="
echo "Timestamp: $(date)"
echo
echo "--- Service Status ---"
systemctl is-active cctelegram-mcp cctelegram-bridge || echo "Services not running"
echo
echo "--- Health Endpoints ---"
curl -w "MCP Health: HTTP %{http_code} in %{time_total}s\n" -H "X-API-Key: $API_KEY" \
  http://localhost:8080/health -o /dev/null -s
echo
echo "--- Resource Usage ---"
echo "CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')"
echo "Memory: $(free | grep Mem | awk '{printf "%.1f%%", ($3/$2) * 100.0}')"
echo "Disk: $(df / | tail -1 | awk '{print $5}')"
echo
echo "--- Recent Errors (last 10) ---"
tail -10 /var/log/cctelegram/application.log | grep ERROR || echo "No recent errors"
echo
echo "=== Diagnostics Complete ==="
EOF
chmod +x /tmp/cctelegram-diag.sh && /tmp/cctelegram-diag.sh
```

### Interactive Tier Testing
```bash
# Test each tier individually
for tier in "T1-MCP" "T2-BRIDGE" "T3-FILE"; do
  echo "Testing $tier..."
  # Add tier-specific test commands here
  sleep 1
done
```

## 📋 Diagnostic Checklist

### Pre-deployment Checks
- [ ] All services running: `systemctl status cctelegram-mcp cctelegram-bridge`
- [ ] Health endpoints responding: `curl http://localhost:8080/health`
- [ ] Resource utilization normal: `free -h && df -h`
- [ ] No critical errors: `grep CRITICAL /var/log/cctelegram/application.log`

### Post-incident Checks
- [ ] System stability: Monitor for 30 minutes
- [ ] Performance baselines restored: Check response times
- [ ] No cascading failures: Verify all tiers healthy
- [ ] Monitoring alerts cleared: Check Prometheus/Grafana

---

**⚡ Pro Tips**: 
- Pipe any command through `| ts` to add timestamps
- Use `watch -n 5 "command"` for continuous monitoring
- Combine with `tee` to log output: `command | tee -a diagnostics.log`

**🔗 Related**: [Error Codes](error-codes.md) | [Recovery Procedures](recovery-procedures.md) | [Log Analysis](log-analysis.md)
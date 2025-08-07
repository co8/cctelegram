# Error Code Reference

Quick reference guide for CCTelegram 3-tier cascading system error diagnosis and resolution.

## 🚨 Critical Errors (Immediate Action)

| Code | Component | Symptom | Solution | SLA |
|------|-----------|---------|----------|-----|
| **T1-TIMEOUT** | Tier 1 MCP Webhook | >100ms response | `systemctl restart cctelegram-mcp` | 0-2 min |
| **T2-TIMEOUT** | Tier 2 Bridge | >500ms response | `systemctl restart cctelegram-bridge` | 2-5 min |
| **T3-TIMEOUT** | Tier 3 File Watcher | >5s response | `rm -rf /tmp/cctelegram-*; systemctl restart` | 5-10 min |
| **ALL-TIERS-DOWN** | System-wide | No tier responding | Emergency restart all services | 0-5 min |
| **CIRCUIT-BREAKER-OPEN** | Any tier | Circuit breaker tripped | Check health: `curl /health` → restart tier | 2-5 min |

## ⚠️ High Priority Errors (1hr SLA)

| Code | Component | Symptom | Diagnostic Command | Solution |
|------|-----------|---------|-------------------|----------|
| **T1-HIGH-LATENCY** | Tier 1 | 50-100ms response | `curl -w "%{time_total}" /webhook/health` | Scale horizontal |
| **T2-QUEUE-FULL** | Tier 2 | Processing backlog | `bridge-client status \| grep queue_size` | Increase workers |
| **T3-DISK-FULL** | Tier 3 | File writes failing | `df -h /var/lib/cctelegram` | Clear old files |
| **AUTH-FAILURES** | Any tier | >1 failure/sec | `grep "SECURITY" /var/log/cctelegram/security.log` | Check API keys |
| **MEMORY-LEAK** | Any tier | >1GB memory | `ps aux \| grep cctelegram` | Restart affected tier |

## 🛠️ Medium Priority Errors (4hr SLA)

| Code | Component | Symptom | Quick Fix | Long-term Fix |
|------|-----------|---------|-----------|---------------|
| **RATE-LIMIT-EXCEEDED** | Any tier | 429 responses | Temporary: increase limits | Review client usage |
| **SSL-CERT-EXPIRY** | Load balancer | Certificate warnings | Renew cert immediately | Setup auto-renewal |
| **LOG-ROTATION-FAILED** | System | Disk space issues | Manual cleanup | Fix logrotate config |
| **CONFIG-DRIFT** | Any tier | Inconsistent behavior | `systemctl reload` | Update config management |
| **DEPENDENCY-TIMEOUT** | External | Third-party failures | Enable circuit breaker | Add redundant providers |

## 📊 Error Code Patterns by Tier

### Tier 1: MCP Webhook (0-100ms SLA)
```bash
# Common error patterns in logs
grep -E "(T1|mcp_webhook)" /var/log/cctelegram/application.log | tail -20

# Error codes:
# T1-001: Connection refused → Webhook server down
# T1-002: SSL handshake failed → Certificate issue  
# T1-003: Request timeout → Network latency
# T1-004: Invalid response → Protocol mismatch
# T1-005: Rate limit exceeded → Client overload
```

### Tier 2: Bridge Internal (100-500ms SLA)
```bash
# Common error patterns
grep -E "(T2|bridge_internal)" /var/log/cctelegram/application.log | tail -20

# Error codes:
# T2-001: Internal processor crash → Memory/CPU exhaustion
# T2-002: Queue overflow → Processing bottleneck
# T2-003: Telegram API failure → External dependency
# T2-004: Database connection lost → Connection pool exhausted
# T2-005: Serialization failed → Data format issue
```

### Tier 3: File Watcher (1-5s SLA)
```bash
# Common error patterns
grep -E "(T3|file_watcher)" /var/log/cctelegram/application.log | tail -20

# Error codes:
# T3-001: File system full → Disk space exhaustion
# T3-002: Permission denied → File system permissions
# T3-003: Inotify limit exceeded → Too many watched files
# T3-004: Debounce timeout → High file activity
# T3-005: Cleanup failed → Orphaned file entries
```

## 🔧 Emergency Error Resolution

### System-wide Failure (ALL-TIERS-DOWN)
```bash
#!/bin/bash
# Emergency recovery script
echo "=== EMERGENCY RECOVERY ==="
systemctl stop cctelegram-mcp cctelegram-bridge
sleep 10
rm -rf /tmp/cctelegram-*
systemctl start cctelegram-bridge
sleep 5
systemctl start cctelegram-mcp
echo "=== SERVICES RESTARTED ==="
```

### Circuit Breaker Recovery
```bash
# Check circuit breaker status
curl -H "X-API-Key: $API_KEY" /tools/get_bridge_status | jq '.tier_health'

# Force circuit breaker reset
curl -X POST -H "X-API-Key: $API_KEY" /tools/restart_bridge
```

### Memory Leak Recovery
```bash
# Identify memory hog
ps aux --sort=-%mem | grep cctelegram | head -5

# Rolling restart (zero downtime)
for instance in mcp-01 mcp-02 mcp-03; do
  ssh $instance "systemctl restart cctelegram-mcp"
  sleep 30
done
```

## 📈 Error Rate Thresholds

| Tier | Error Rate Threshold | Action Required |
|------|---------------------|----------------|
| **Tier 1** | >5% in 2min | Immediate failover to Tier 2 |
| **Tier 2** | >10% in 5min | Scale up processing capacity |
| **Tier 3** | >15% in 10min | Clear file system, restart watcher |
| **Overall** | >2% in 5min | System-wide health check required |

## 🚀 Performance Degradation Codes

| Code | Threshold | Impact | Recovery Action |
|------|-----------|--------|----------------|
| **PERF-T1-SLOW** | >75ms avg | User experience | Horizontal scale + CDN |
| **PERF-T2-SLOW** | >300ms avg | Processing delays | Vertical scale + queue tuning |
| **PERF-T3-SLOW** | >3s avg | Fallback ineffective | File system optimization |
| **PERF-CPU-HIGH** | >80% for 5min | System instability | Resource allocation review |
| **PERF-MEM-HIGH** | >90% for 2min | Memory pressure | Immediate restart + investigation |

## 🔍 Log Analysis Commands

### Error Pattern Detection
```bash
# Top error types in last hour
grep "$(date -d '1 hour ago' '+%Y-%m-%d %H')" /var/log/cctelegram/application.log | \
  grep -E "(ERROR|CRITICAL)" | \
  awk '{print $6}' | sort | uniq -c | sort -nr

# Correlation ID tracking
grep "correlation_id=ABC123" /var/log/cctelegram/application.log | \
  sort | head -20
```

### Security Event Analysis
```bash
# Authentication failures by IP
grep "AUTHENTICATION_FAILED" /var/log/cctelegram/security.log | \
  jq -r '.context.client_ip' | sort | uniq -c | sort -nr

# Rate limiting violations
grep "RATE_LIMIT_EXCEEDED" /var/log/cctelegram/security.log | \
  tail -10 | jq '.timestamp, .context.client_ip'
```

### Performance Analysis
```bash
# Response time percentiles
grep "response_time_ms" /var/log/cctelegram/application.log | \
  jq -r '.response_time_ms' | sort -n | \
  awk '{p[NR]=$1} END{print "P50:", p[int(NR*0.5)], "P95:", p[int(NR*0.95)], "P99:", p[int(NR*0.99)]}'
```

## 📞 Escalation Matrix

| Error Severity | Response Time | Escalation Path |
|----------------|---------------|-----------------|
| **Critical** | 0-15 min | L1 → L2 → Engineering Lead |
| **High** | 15-60 min | L1 → L2 → Product Team |
| **Medium** | 1-4 hours | L1 → Engineering Team |
| **Low** | Next business day | L1 → Backlog |

---

**⚡ Quick Reference**: For immediate help, run `./troubleshoot.sh --error-code <CODE>` with any error code above.

**🔗 Related**: [Diagnostic Commands](diagnostic-commands.md) | [Recovery Procedures](recovery-procedures.md) | [Log Analysis](log-analysis.md)
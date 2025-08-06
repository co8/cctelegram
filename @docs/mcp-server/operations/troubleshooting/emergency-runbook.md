# Emergency Runbook

Critical system recovery procedures for CCTelegram 3-tier cascading system under 5 minutes.

## 🚨 EMERGENCY CONTACTS

| Role | Contact | Phone | Escalation Time |
|------|---------|--------|-----------------|
| **L1 Operations** | ops-oncall@company.com | +1-XXX-XXX-1111 | 0-15 minutes |
| **L2 Engineering** | eng-oncall@company.com | +1-XXX-XXX-2222 | 15-45 minutes |
| **L3 Engineering Lead** | tech-lead@company.com | +1-XXX-XXX-3333 | 45+ minutes |
| **Security Team** | security-oncall@company.com | +1-XXX-XXX-9999 | Immediate if security |

## ⚡ CRITICAL FAILURE SCENARIOS

### Scenario 1: Complete System Down
**Symptoms**: All health checks failing, no tier responding, services crashed

**IMMEDIATE ACTION (0-2 minutes)**:
```bash
#!/bin/bash
# Copy and execute immediately
systemctl stop cctelegram-mcp cctelegram-bridge nginx
sleep 5
rm -rf /tmp/cctelegram-* /var/run/cctelegram-*
systemctl start nginx && sleep 3
systemctl start cctelegram-bridge && sleep 5  
systemctl start cctelegram-mcp

# Verify recovery
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health
```

**SUCCESS CRITERIA**: HTTP 200 from health endpoint within 2 minutes

---

### Scenario 2: Cascade Failure (All Tiers Failing)
**Symptoms**: T1 timeout, T2 timeout, T3 timeout, circuit breakers open

**IMMEDIATE ACTION (0-3 minutes)**:
```bash
# Emergency tier reset
echo "🚨 CASCADE FAILURE RECOVERY"

# Force circuit breaker reset
curl -X POST -H "X-API-Key: $API_KEY" http://localhost:8080/tools/restart_bridge

# Clear all temporary state
systemctl stop cctelegram-mcp
rm -rf /tmp/cctelegram-* /var/lib/cctelegram/*.lock
systemctl start cctelegram-mcp

# Verify each tier
for tier in "T1" "T2" "T3"; do
  echo "Testing $tier..."
  # Add tier-specific verification
done
```

**SUCCESS CRITERIA**: At least 2 of 3 tiers responding within 3 minutes

---

### Scenario 3: Memory Exhaustion
**Symptoms**: OOM killer active, >95% memory usage, services crashing

**IMMEDIATE ACTION (0-1 minute)**:
```bash
# Emergency memory recovery
echo "🧠 MEMORY EXHAUSTION RECOVERY"

# Kill memory-intensive processes if needed
# (Only if system is completely unresponsive)
pkill -f "high-memory-process" 2>/dev/null || true

# Restart services to free memory
systemctl restart cctelegram-mcp cctelegram-bridge
sleep 20

# Verify memory levels
free -h | grep Mem | awk '{print "Memory:", $3"/"$2, "("$3/$2*100"%)"}'
```

**SUCCESS CRITERIA**: Memory usage <80% and services responding

---

### Scenario 4: Security Breach
**Symptoms**: Multiple auth failures, suspicious API calls, data access anomalies

**IMMEDIATE ACTION (0-30 seconds)**:
```bash
# Emergency security lockdown
echo "🔒 SECURITY BREACH PROTOCOL"

# Block suspicious IPs (if identified)
# iptables -A INPUT -s SUSPICIOUS_IP -j DROP

# Rotate API keys (if possible)
# API_KEY_ROTATION_SCRIPT

# Enable emergency rate limiting
curl -X POST -H "X-API-Key: $API_KEY" \
  http://localhost:8080/admin/emergency-rate-limit \
  -d '{"max_requests_per_minute": 10}' || true

# Alert security team
echo "🚨 SECURITY INCIDENT" | mail security-oncall@company.com
```

**ESCALATION**: Immediately call security team at +1-XXX-XXX-9999

---

### Scenario 5: Disk Space Exhaustion
**Symptoms**: Write failures, >95% disk usage, log rotation failing

**IMMEDIATE ACTION (0-2 minutes)**:
```bash
# Emergency disk cleanup
echo "💾 DISK SPACE RECOVERY"

# Clear temporary files
rm -rf /tmp/cctelegram-* /var/tmp/cctelegram-*

# Clear old logs (keep last 24 hours)
find /var/log/cctelegram -type f -name "*.log*" -mtime +1 -delete

# Clear processed files
find /var/lib/cctelegram -name "*.processed" -mtime +1 -delete

# Check result
df -h | grep -E "(/$|/var)" | awk '{print $5, "used on", $6}'
```

**SUCCESS CRITERIA**: <85% disk usage and services writing successfully

---

## 🔥 EMERGENCY SCRIPTS

### Master Emergency Recovery Script
```bash
#!/bin/bash
# emergency-master-recovery.sh
# Run with: sudo ./emergency-master-recovery.sh

set -e
LOGFILE="/tmp/emergency-recovery-$(date +%s).log"

log() {
  echo "$(date +'%Y-%m-%d %H:%M:%S') $1" | tee -a $LOGFILE
}

log "🚨 EMERGENCY MASTER RECOVERY INITIATED"

# Step 1: System assessment (30 seconds)
log "Step 1: System assessment..."
MEM_USAGE=$(free | grep Mem | awk '{printf "%.0f", ($3/$2) * 100.0}')
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
CPU_LOAD=$(cat /proc/loadavg | awk '{print $1}')

log "Resources - Memory: ${MEM_USAGE}%, Disk: ${DISK_USAGE}%, Load: ${CPU_LOAD}"

# Step 2: Critical resource check (30 seconds)
if [ $MEM_USAGE -gt 95 ]; then
  log "🧠 CRITICAL: Memory exhaustion detected"
  systemctl restart cctelegram-mcp cctelegram-bridge
fi

if [ $DISK_USAGE -gt 95 ]; then
  log "💾 CRITICAL: Disk exhaustion detected"
  find /tmp /var/tmp -name "cctelegram-*" -delete || true
  find /var/log/cctelegram -name "*.log.*" -mtime +1 -delete || true
fi

# Step 3: Service recovery (60 seconds)
log "Step 3: Service recovery..."
systemctl stop cctelegram-mcp cctelegram-bridge || true
sleep 5

# Clear state files
rm -rf /tmp/cctelegram-* /var/run/cctelegram-* /var/lib/cctelegram/*.lock || true

# Start services in order
systemctl start cctelegram-bridge
sleep 10
systemctl start cctelegram-mcp
sleep 20

# Step 4: Verification (60 seconds)
log "Step 4: Verification..."
for i in {1..12}; do
  if curl -s -H "X-API-Key: $API_KEY" http://localhost:8080/health >/dev/null 2>&1; then
    log "✅ RECOVERY SUCCESSFUL after $((i*5)) seconds"
    exit 0
  fi
  sleep 5
done

log "❌ RECOVERY FAILED - Manual intervention required"
log "Log file: $LOGFILE"
exit 1
```

### Emergency Health Check Script
```bash
#!/bin/bash  
# emergency-health-check.sh
# Quick health verification

echo "=== EMERGENCY HEALTH CHECK ==="
echo "Time: $(date)"
echo

# Services
echo "--- Service Status ---"
for service in cctelegram-mcp cctelegram-bridge nginx; do
  if systemctl is-active $service >/dev/null 2>&1; then
    echo "✅ $service: RUNNING"
  else
    echo "❌ $service: STOPPED"
  fi
done

# Endpoints  
echo "--- Endpoint Health ---"
if curl -s -H "X-API-Key: $API_KEY" http://localhost:8080/health >/dev/null 2>&1; then
  echo "✅ MCP Health: OK"
else
  echo "❌ MCP Health: FAIL"
fi

# Resources
echo "--- Resource Status ---"
MEM=$(free | grep Mem | awk '{printf "%.0f", ($3/$2) * 100.0}')
DISK=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
LOAD=$(cat /proc/loadavg | awk '{print $1}')

echo "Memory: ${MEM}% $([ $MEM -lt 80 ] && echo "✅" || echo "❌")"  
echo "Disk: ${DISK}% $([ $DISK -lt 80 ] && echo "✅" || echo "❌")"
echo "Load: ${LOAD} $([ $(echo "$LOAD < 2.0" | bc) -eq 1 ] && echo "✅" || echo "❌")"

# Tier health
echo "--- Tier Health ---"
TIER_HEALTH=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
  http://localhost:8080/tools/get_bridge_status 2>/dev/null | \
  jq -r '.tier_health[]? | "\(.tier_type): \(.is_healthy)"' 2>/dev/null)

if [ -n "$TIER_HEALTH" ]; then
  echo "$TIER_HEALTH" | while read line; do
    if [[ $line == *"true"* ]]; then
      echo "✅ $line"
    else  
      echo "❌ $line"
    fi
  done
else
  echo "❌ Unable to retrieve tier health"
fi

echo "=== HEALTH CHECK COMPLETE ==="
```

## 📞 ESCALATION PROCEDURES

### Level 1 (0-15 minutes) - Operations Team
**Triggers**: 
- System health checks failing
- Response time >1s for >2 minutes  
- Error rate >10% for >1 minute
- Any circuit breaker opens

**Actions**:
1. Run emergency health check script
2. Execute appropriate emergency recovery script  
3. Verify recovery within 15 minutes
4. Document actions in incident channel
5. If not resolved → Escalate to L2

### Level 2 (15-45 minutes) - Engineering Team  
**Triggers**:
- L1 recovery procedures failed
- Complex system issues requiring code-level analysis
- Multiple component failures
- Performance degradation >50%

**Actions**:
1. Review L1 actions and logs
2. Perform root cause analysis
3. Apply engineering-level fixes
4. Deploy emergency patches if needed
5. If architectural issue → Escalate to L3

### Level 3 (45+ minutes) - Engineering Leadership
**Triggers**:
- Architectural design flaws identified
- Major system redesign required  
- Multi-hour outages
- Customer-impacting data issues

**Actions**:
1. Coordinate with product/business teams
2. Make architectural decisions
3. Allocate engineering resources
4. Approve emergency changes
5. Communicate with stakeholders

## 🛠️ EMERGENCY TOOLBOX

### Environment Variables Setup
```bash
# Add to ~/.bashrc or emergency script
export API_KEY="your-emergency-api-key"
export EMERGENCY_LOG="/tmp/emergency-$(date +%s).log"
export BACKUP_DIR="/var/backups/cctelegram"
export ALERT_WEBHOOK="https://your-alert-webhook-url"
```

### Emergency Aliases
```bash
# Add to ~/.bashrc for quick access
alias emrg-health='sudo /usr/local/bin/emergency-health-check.sh'
alias emrg-recover='sudo /usr/local/bin/emergency-master-recovery.sh'
alias emrg-logs='tail -f /var/log/cctelegram/application.log | grep -E "ERROR|CRITICAL"'
alias emrg-status='systemctl status cctelegram-mcp cctelegram-bridge --no-pager'
alias emrg-restart='systemctl restart cctelegram-mcp cctelegram-bridge'
```

### Emergency Monitoring Commands  
```bash
# Real-time monitoring during incident
watch -n 5 'curl -s -H "X-API-Key: $API_KEY" http://localhost:8080/health | jq .'

# Resource monitoring
watch -n 2 'free -h && df -h | grep -E "(/$|/var)" && cat /proc/loadavg'

# Error rate monitoring
watch -n 10 'grep "$(date -d "1 minute ago" "+%Y-%m-%d %H:%M")" /var/log/cctelegram/application.log | grep -c ERROR'
```

## 📋 POST-EMERGENCY CHECKLIST

After emergency recovery, complete this checklist:

### Immediate Post-Recovery (0-30 minutes)
- [ ] All services running and healthy
- [ ] Health endpoints returning HTTP 200
- [ ] No critical errors in logs (last 5 minutes)
- [ ] Resource usage within normal ranges (<80%)
- [ ] All tiers responding within SLA (<100ms T1, <500ms T2, <5s T3)

### Short-term Verification (30 minutes - 2 hours)  
- [ ] System stability confirmed (30 minutes continuous operation)
- [ ] Performance baselines restored
- [ ] No cascading failures detected
- [ ] Monitoring alerts cleared
- [ ] Stakeholders notified of resolution

### Follow-up Actions (2-24 hours)
- [ ] Root cause analysis initiated
- [ ] Post-mortem scheduled (if P0/P1 incident)
- [ ] Documentation updated based on incident
- [ ] Preventive measures identified
- [ ] Incident response process reviewed for improvements

---

**🚨 REMEMBER**: In emergency situations, speed is critical. Don't spend time on detailed analysis - execute recovery procedures first, analyze later.

**📋 Emergency Checklist**: Print this runbook and keep physical copy accessible during outages.

**🔗 Quick Links**: 
- [Error Codes](error-codes.md) for specific error resolution
- [Recovery Procedures](recovery-procedures.md) for detailed steps
- [Diagnostic Commands](diagnostic-commands.md) for troubleshooting
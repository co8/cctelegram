# Troubleshooting Documentation

Comprehensive troubleshooting resources for CCTelegram 3-tier cascading system.

## 📚 Documentation Overview

This troubleshooting documentation provides operations teams with practical, quick-reference materials for diagnosing and resolving issues in the CCTelegram 3-tier system under pressure.

### 🎯 3-Tier System Context
- **Tier 1**: MCP Webhook (0-100ms SLA)
- **Tier 2**: Bridge Processing (100-500ms SLA)  
- **Tier 3**: File Watcher Fallback (1-5s SLA)

## 🚨 Emergency Resources (Start Here)

### For System-Wide Outages
1. **[Emergency Runbook](emergency-runbook.md)** - Critical recovery procedures under 5 minutes
2. **[Recovery Procedures](recovery-procedures.md)** - Step-by-step system recovery workflows

### For Specific Issues  
1. **[Error Codes](error-codes.md)** - Categorized error reference with immediate solutions
2. **[Diagnostic Commands](diagnostic-commands.md)** - One-liner commands for quick diagnosis

## 📖 Complete Documentation Index

| Document | Purpose | When to Use | Time to Resolution |
|----------|---------|-------------|-------------------|
| **[Error Codes](error-codes.md)** | Error reference & solutions | Have specific error/symptom | 0-15 minutes |
| **[Diagnostic Commands](diagnostic-commands.md)** | System diagnosis tools | Need to gather system info | 0-5 minutes |
| **[Log Analysis](log-analysis.md)** | Pattern recognition guide | Need to analyze logs/trends | 5-30 minutes |
| **[Recovery Procedures](recovery-procedures.md)** | Detailed recovery steps | System recovery needed | 5-60 minutes |
| **[Troubleshooting Flowcharts](troubleshooting-flowcharts.md)** | Visual decision trees | Systematic problem-solving | Varies by issue |
| **[Emergency Runbook](emergency-runbook.md)** | Critical system recovery | System-wide emergency | 0-5 minutes |
| **[Monitoring Alerts](monitoring-alerts.md)** | Alert thresholds & responses | Understanding alert triggers | Reference |

## 🔥 Quick Start Guide

### If the system is completely down:
```bash
# 1. Execute emergency recovery (2 minutes)
sudo /usr/local/bin/emergency-master-recovery.sh

# 2. Verify recovery
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health

# 3. If still down, see Emergency Runbook
```

### If you have a specific error code:
1. Look up the error in **[Error Codes](error-codes.md)**
2. Execute the provided solution command
3. Verify resolution using diagnostic commands

### If system is slow/degraded:
1. Run quick health check: **[Diagnostic Commands](diagnostic-commands.md)**
2. Follow performance flowchart: **[Troubleshooting Flowcharts](troubleshooting-flowcharts.md)**
3. Apply appropriate recovery: **[Recovery Procedures](recovery-procedures.md)**

### If you need to analyze patterns:
1. Use log analysis tools: **[Log Analysis](log-analysis.md)**
2. Check monitoring alerts: **[Monitoring Alerts](monitoring-alerts.md)**
3. Follow root cause flowchart: **[Troubleshooting Flowcharts](troubleshooting-flowcharts.md)**

## 🛠️ Essential Commands Reference

### System Status (30 seconds)
```bash
# Complete health check
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health | jq '.'
systemctl status cctelegram-mcp cctelegram-bridge --no-pager
free -h && df -h | grep -E "(/$|/var)"
```

### Error Investigation (2 minutes)
```bash  
# Recent errors by tier
for tier in "T1" "T2" "T3"; do
  echo "=== $tier Errors ==="
  grep -E "($tier|tier.*$tier).*ERROR" /var/log/cctelegram/application.log | tail -5
done
```

### Performance Check (1 minute)
```bash
# Response time test
for i in {1..5}; do 
  curl -w "Response %{time_total}s\n" -H "X-API-Key: $API_KEY" \
    http://localhost:8080/health -o /dev/null -s
done
```

### Tier Health Check (1 minute)
```bash
# Circuit breaker and tier status  
curl -H "X-API-Key: $API_KEY" -X POST \
  http://localhost:8080/tools/get_bridge_status | \
  jq '.tier_health[] | {tier: .tier_type, healthy: .is_healthy, cb_state: .circuit_breaker_state}'
```

## 📊 Troubleshooting Decision Matrix

| Symptom | Likely Cause | First Action | Document |
|---------|-------------|--------------|----------|
| **No response from any endpoint** | System-wide failure | Emergency recovery script | [Emergency Runbook](emergency-runbook.md) |
| **Slow response (>1s)** | Performance degradation | Check resource usage | [Diagnostic Commands](diagnostic-commands.md) |
| **Specific tier timeout** | Tier-specific issue | Tier recovery procedure | [Recovery Procedures](recovery-procedures.md) |
| **High error rate** | Application logic issue | Error pattern analysis | [Error Codes](error-codes.md) |
| **Circuit breaker open** | Tier failure cascade | Circuit breaker recovery | [Recovery Procedures](recovery-procedures.md) |
| **Authentication failures** | Security issue | Security investigation | [Log Analysis](log-analysis.md) |
| **Memory/CPU high** | Resource exhaustion | Resource recovery | [Recovery Procedures](recovery-procedures.md) |
| **Disk space low** | Storage issue | Emergency cleanup | [Emergency Runbook](emergency-runbook.md) |

## 🎯 Tier-Specific Quick Reference

### Tier 1 (MCP Webhook) Issues
```bash
# Quick T1 diagnosis
curl -w "T1 Response: %{time_total}s\n" -H "X-API-Key: $API_KEY" \
  http://localhost:8080/health -o /dev/null -s
  
# T1 recovery if >100ms or failing
systemctl restart cctelegram-mcp && sleep 10 && \
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health
```

### Tier 2 (Bridge Internal) Issues
```bash  
# Quick T2 diagnosis
curl -H "X-API-Key: $API_KEY" -X POST \
  http://localhost:8080/tools/get_bridge_status | jq '.bridge_status'
  
# T2 recovery if processing issues
curl -H "X-API-Key: $API_KEY" -X POST \
  http://localhost:8080/tools/restart_bridge
```

### Tier 3 (File Watcher) Issues
```bash
# Quick T3 diagnosis
df -h /var/lib/cctelegram && \
ls -la /var/lib/cctelegram/ | head -5
  
# T3 recovery if file system issues
find /var/lib/cctelegram -name "*.processed" -mtime +1 -delete && \
systemctl restart cctelegram-mcp
```

## 📞 Escalation Guidelines

### When to Escalate
- **Immediate (0-15 min)**: System completely down, security breach, data loss
- **L2 Engineering (15-60 min)**: Recovery procedures failed, complex technical issues  
- **L3 Leadership (60+ min)**: Architectural issues, major system redesign needed

### Escalation Information to Provide
1. **Current status**: What's working/not working
2. **Actions taken**: Commands executed, procedures followed  
3. **Error evidence**: Log snippets, error codes, metrics
4. **Business impact**: Affected users, services, functionality
5. **Time constraints**: SLA requirements, deadlines

## 🔧 Tools and Scripts Location

### System Scripts
```bash
# Emergency scripts (create these)
/usr/local/bin/emergency-master-recovery.sh    # Complete system recovery
/usr/local/bin/emergency-health-check.sh       # Quick health verification
/usr/local/bin/tier-specific-recovery.sh       # Individual tier recovery
```

### Log Files
```bash
# Primary logs
/var/log/cctelegram/application.log    # Main application events
/var/log/cctelegram/security.log       # Security and audit events  
/var/log/cctelegram/performance.log    # Performance metrics
/var/log/syslog                        # System events
```

### Configuration Files
```bash
# Configuration locations
/etc/cctelegram/config.toml            # Main configuration
/etc/prometheus/rules/cctelegram.yml   # Alert rules
/etc/nginx/sites-available/cctelegram  # Reverse proxy config
```

## 📈 Monitoring Integration

### Grafana Dashboards
- **CCTelegram Overview**: System-wide health and performance
- **Tier Performance**: Individual tier metrics and SLAs  
- **Error Analysis**: Error rates, patterns, and correlation
- **Resource Utilization**: CPU, memory, disk, network usage

### Prometheus Metrics
- `cctelegram_tier_response_time_seconds` - Response time by tier
- `cctelegram_tier_errors_total` - Error count by tier
- `cctelegram_circuit_breaker_state` - Circuit breaker status
- `cctelegram_queue_depth` - Processing queue metrics

### Alert Integration
- **PagerDuty**: Critical alerts (P0/P1)
- **Slack**: Warning alerts (P2/P3) 
- **Email**: Informational alerts and summaries
- **SMS**: Emergency escalation notifications

## 📋 Maintenance and Updates

### Document Maintenance
- **Review Frequency**: Monthly
- **Update Triggers**: System changes, incident learnings, process improvements
- **Owner**: DevOps Team
- **Approver**: Engineering Leadership

### Version History
- **v1.0**: Initial troubleshooting documentation
- **v1.1**: Added 3-tier specific procedures
- **v1.2**: Enhanced emergency runbook procedures

---

**🚀 Getting Started**: For immediate help during an incident, start with the [Emergency Runbook](emergency-runbook.md) or look up your specific issue in [Error Codes](error-codes.md).

**🔗 External Resources**:  
- [System Architecture Overview](../architecture/system-overview.md)
- [Incident Response Procedures](../runbooks/incident-response.md)
- [Performance Tuning Guide](../../maintenance/performance-tuning.md)
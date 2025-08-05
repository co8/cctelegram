# Incident Response Runbook

## 🚨 Overview

This runbook provides step-by-step procedures for responding to incidents affecting the CCTelegram MCP Server in production environments.

## 📋 Incident Classification

### Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| **P0 - Critical** | Complete service outage | 15 minutes | Service down, data loss, security breach |
| **P1 - High** | Major functionality impaired | 1 hour | High error rates, significant performance degradation |
| **P2 - Medium** | Minor functionality impaired | 4 hours | Intermittent errors, moderate performance issues |
| **P3 - Low** | Cosmetic or documentation issues | Next business day | Documentation errors, minor UI issues |

### Incident Types

- **Service Outage**: Complete or partial service unavailability
- **Performance Degradation**: High latency, timeouts, slow responses
- **Security Incident**: Unauthorized access, data breach, suspicious activity
- **Data Loss**: Missing or corrupted data
- **Integration Failure**: External service dependencies failing
- **Capacity Issues**: Resource exhaustion, scaling problems

## 🚨 Immediate Response Procedures

### P0 - Critical Incidents (0-15 minutes)

#### Step 1: Alert & Mobilize (0-2 minutes)
```bash
# 1. Acknowledge the alert
# Via PagerDuty, Telegram, or monitoring system

# 2. Create incident channel
# Slack: /incident create "MCP Server P0 - Service Down"
# Teams: Create new channel #incident-YYYYMMDD-HHMM

# 3. Page on-call engineer
# PagerDuty: Escalate to L2 if no response in 5 minutes
```

#### Step 2: Immediate Assessment (2-5 minutes)
```bash
# Check service status across all instances
for instance in mcp-01 mcp-02 mcp-03; do
  echo "=== Checking $instance ==="
  ssh $instance "systemctl status cctelegram-mcp"
  ssh $instance "curl -H 'X-API-Key: $API_KEY' http://localhost:8080/health"
done

# Check load balancer status
curl -I https://mcp.company.com/health

# Check recent logs for errors
ssh mcp-01 "tail -50 /var/log/cctelegram/application.log | grep -i error"

# Check system resources
ssh mcp-01 "top -bn1 | head -20"
ssh mcp-01 "df -h"
ssh mcp-01 "free -h"
```

#### Step 3: Immediate Mitigation (5-10 minutes)
```bash
# Option A: Service restart (if process issues)
for instance in mcp-01 mcp-02 mcp-03; do
  ssh $instance "sudo systemctl restart cctelegram-mcp"
done

# Option B: Traffic rerouting (if infrastructure issues)
# Update load balancer to route around failed instances
aws elbv2 modify-target-group --target-group-arn $TG_ARN \
  --health-check-path /health

# Option C: Rollback (if deployment issues)
# Rollback to previous version
docker service update --rollback cctelegram_mcp-server

# Option D: Scale up (if capacity issues)
# Increase instance count
docker service scale cctelegram_mcp-server=6
```

#### Step 4: Verify Recovery (10-15 minutes)
```bash
# Verify service health
for i in {1..10}; do
  echo "Check $i:"
  curl -H "X-API-Key: $API_KEY" https://mcp.company.com/health
  sleep 5
done

# Check error rates
curl -s http://prometheus:9090/api/v1/query?query='rate(http_requests_total{status=~"5.."}[5m])'

# Verify core functionality
curl -H "X-API-Key: $API_KEY" -X POST https://mcp.company.com/tools/send_telegram_message \
  -d '{"message": "System recovery test", "source": "incident-response"}'
```

### P1 - High Priority Incidents (0-60 minutes)

#### Step 1: Investigation (0-15 minutes)
```bash
# Identify affected components
curl -H "X-API-Key: $API_KEY" https://mcp.company.com/tools/get_bridge_status

# Check metrics and trends
# Open Grafana dashboard: https://monitoring.company.com:3000/d/mcp-overview

# Analyze error patterns
ssh mcp-01 "grep -A5 -B5 'ERROR\|CRITICAL' /var/log/cctelegram/application.log | tail -50"

# Check security logs for anomalies
ssh mcp-01 "grep 'SECURITY' /var/log/cctelegram/security.log | tail -20"
```

#### Step 2: Containment (15-30 minutes)
```bash
# Rate limiting (if traffic spike)
# Update nginx configuration
ssh mcp-01 "sudo sed -i 's/rate=30r/rate=10r/' /etc/nginx/sites-available/cctelegram"
ssh mcp-01 "sudo nginx -s reload"

# Circuit breaker activation (if external dependency issues)
# Update application configuration to enable circuit breakers
curl -H "X-API-Key: $API_KEY" -X POST https://mcp.company.com/tools/restart_bridge

# Resource limits (if resource exhaustion)
# Temporarily reduce concurrent connections
docker service update --limit-memory 2G cctelegram_mcp-server
```

#### Step 3: Resolution (30-60 minutes)
```bash
# Apply targeted fixes based on root cause analysis
# Example: Database connection pool exhaustion
# Restart database connections
systemctl restart postgresql

# Example: Memory leak
# Restart affected instances one at a time
for instance in mcp-01 mcp-02 mcp-03; do
  ssh $instance "sudo systemctl restart cctelegram-mcp"
  sleep 30
  # Verify instance is healthy before proceeding
  curl -H "X-API-Key: $API_KEY" http://$instance:8080/health
done
```

## 🔍 Diagnosis Procedures

### Service Health Diagnostics

```bash
#!/bin/bash
# /usr/local/bin/mcp-diagnostics.sh

echo "=== CCTelegram MCP Server Diagnostics ==="
echo "Timestamp: $(date)"
echo

# System Information
echo "--- System Information ---"
hostname
uptime
uname -a
echo

# Service Status
echo "--- Service Status ---"
systemctl status cctelegram-mcp --no-pager
systemctl status nginx --no-pager  
systemctl status cctelegram-bridge --no-pager
echo

# Network Connectivity
echo "--- Network Connectivity ---"
curl -I -H "X-API-Key: $API_KEY" http://localhost:8080/health
curl -I https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe
echo

# Resource Usage
echo "--- Resource Usage ---"
free -h
df -h /
df -h /var/log
df -h /var/lib/cctelegram
echo

# Process Information
echo "--- Process Information ---"
ps aux | grep -E "(node|cctelegram)" | grep -v grep
echo

# Network Connections
echo "--- Network Connections ---"
netstat -tlnp | grep -E ":808[0-9]|:9090"
echo

# Recent Errors
echo "--- Recent Errors (Last 10) ---"
tail -10 /var/log/cctelegram/application.log | grep -i error
echo

# Security Events
echo "--- Recent Security Events ---"
tail -5 /var/log/cctelegram/security.log | grep SECURITY
echo

# Performance Metrics
echo "--- Performance Metrics ---"
curl -H "X-API-Key: $API_KEY" http://localhost:9090/metrics | grep -E "(http_requests_total|http_request_duration|process_cpu_usage|process_memory)"
```

### Log Analysis Procedures

```bash
# Error Pattern Analysis
grep -E "(ERROR|CRITICAL|FATAL)" /var/log/cctelegram/application.log | \
  awk '{print $1, $2}' | sort | uniq -c | sort -nr

# Security Event Analysis  
grep "SECURITY" /var/log/cctelegram/security.log | \
  jq -r '.timestamp, .message, .context.client_ip' | \
  paste - - - | sort | uniq -c | sort -nr

# Performance Analysis
grep "duration" /var/log/cctelegram/application.log | \
  jq -r '.context.duration' | \
  awk '{sum+=$1; count++} END {print "Avg:", sum/count, "ms"}'

# Rate Limiting Analysis
grep "RATE_LIMIT_EXCEEDED" /var/log/cctelegram/security.log | \
  jq -r '.context.client_ip' | sort | uniq -c | sort -nr | head -10
```

## 🔧 Common Remediation Actions

### Service Recovery

```bash
# Graceful restart
sudo systemctl reload cctelegram-mcp

# Force restart  
sudo systemctl restart cctelegram-mcp

# Emergency stop and start
sudo systemctl stop cctelegram-mcp
sleep 10
sudo systemctl start cctelegram-mcp

# Clear temporary files
sudo systemctl stop cctelegram-mcp
sudo rm -rf /tmp/cctelegram-*
sudo systemctl start cctelegram-mcp
```

### Bridge Recovery

```bash
# Check bridge status
curl -H "X-API-Key: $API_KEY" -X POST \
  http://localhost:8080/tools/get_bridge_status

# Restart bridge via API
curl -H "X-API-Key: $API_KEY" -X POST \
  http://localhost:8080/tools/restart_bridge

# Direct bridge restart (if API unavailable)
sudo systemctl restart cctelegram-bridge

# Bridge process cleanup
sudo pkill -f cctelegram-bridge
sleep 5
sudo systemctl start cctelegram-bridge
```

### Database Recovery (if applicable)

```bash
# Connection pool reset
sudo systemctl restart postgresql

# Connection analysis
sudo -u postgres psql -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"

# Vacuum and analyze
sudo -u postgres psql cctelegram -c "VACUUM ANALYZE;"

# Index rebuild (if corruption suspected)
sudo -u postgres psql cctelegram -c "REINDEX DATABASE cctelegram;"
```

### Load Balancer Recovery

```bash
# Health check adjustment
aws elbv2 modify-target-group \
  --target-group-arn $TARGET_GROUP_ARN \
  --health-check-interval-seconds 10 \
  --health-check-timeout-seconds 5

# Drain and restore instances
aws elbv2 modify-target-group \
  --target-group-arn $TARGET_GROUP_ARN \
  --targets Id=i-1234567890abcdef0,Port=8080

# Force traffic redistribution
sudo systemctl reload nginx
```

## 📊 Post-Incident Procedures

### Immediate Post-Incident (0-2 hours)

#### 1. Service Validation
```bash
# Comprehensive health check
/usr/local/bin/mcp-diagnostics.sh > /tmp/post-incident-health.log

# Performance validation
for i in {1..100}; do
  time curl -H "X-API-Key: $API_KEY" https://mcp.company.com/health > /dev/null 2>&1
done

# Load testing (light)
ab -n 100 -c 10 -H "X-API-Key: $API_KEY" https://mcp.company.com/health
```

#### 2. Stakeholder Notification
```bash
# Status page update
curl -X PATCH "https://api.statuspage.io/v1/pages/$PAGE_ID/incidents/$INCIDENT_ID" \
  -H "Authorization: OAuth $STATUSPAGE_API_KEY" \
  -d '{"incident": {"status": "resolved", "body": "Service has been restored"}}'

# Internal notification
curl -X POST "https://api.slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer $SLACK_TOKEN" \
  -d "channel=#incidents&text=Incident resolved: MCP Server is operational"
```

### Follow-up Analysis (2-24 hours)

#### 1. Root Cause Analysis Template
```markdown
# Incident Post-Mortem: [INCIDENT_ID]

## Summary
- **Start Time**: YYYY-MM-DD HH:MM UTC
- **End Time**: YYYY-MM-DD HH:MM UTC  
- **Duration**: X hours Y minutes
- **Severity**: P0/P1/P2/P3
- **Impact**: [User impact description]

## Timeline
- HH:MM - [First detection]
- HH:MM - [Alert triggered]
- HH:MM - [Investigation started]
- HH:MM - [Root cause identified]
- HH:MM - [Mitigation applied]
- HH:MM - [Service restored]

## Root Cause
[Detailed technical explanation]

## Contributing Factors
- Factor 1
- Factor 2
- Factor 3

## Resolution
[What was done to resolve the issue]

## Lessons Learned
### What Went Well
- Item 1
- Item 2

### What Could Be Improved  
- Item 1
- Item 2

## Action Items
- [ ] [Action 1] - [Owner] - [Due Date]
- [ ] [Action 2] - [Owner] - [Due Date]
- [ ] [Action 3] - [Owner] - [Due Date]
```

#### 2. Performance Analysis
```bash
# Incident impact analysis
prometheus_query() {
  curl -s "http://prometheus:9090/api/v1/query_range?query=$1&start=$2&end=$3&step=60s"
}

START_TIME="2025-01-15T10:00:00Z"
END_TIME="2025-01-15T12:00:00Z"

# Error rate during incident
prometheus_query "rate(http_requests_total{status=~\"5..\"}[5m])" $START_TIME $END_TIME

# Response time impact  
prometheus_query "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))" $START_TIME $END_TIME

# Resource utilization
prometheus_query "rate(process_cpu_usage_percent[5m])" $START_TIME $END_TIME
```

## 🔄 Preventive Measures

### Monitoring Enhancements

```bash
# Add custom alerting rules
cat >> /etc/prometheus/rules/cctelegram.yml << 'EOF'
  - alert: ConsecutiveErrors
    expr: increase(http_requests_total{status=~"5.."}[5m]) > 50
    for: 1m
    labels:
      severity: high
    annotations:
      summary: "High number of consecutive errors"

  - alert: MemoryLeakDetection
    expr: increase(process_memory_heap_used_bytes[30m]) > 104857600
    for: 15m
    labels:
      severity: warning
    annotations:
      summary: "Potential memory leak detected"
EOF
```

### Automated Recovery

```bash
# Create automated recovery script
cat > /usr/local/bin/auto-recovery.sh << 'EOF'
#!/bin/bash

# Check service health
if ! curl -H "X-API-Key: $API_KEY" http://localhost:8080/health > /dev/null 2>&1; then
  echo "Service unhealthy, attempting restart"
  systemctl restart cctelegram-mcp
  sleep 30
  
  # Verify recovery
  if curl -H "X-API-Key: $API_KEY" http://localhost:8080/health > /dev/null 2>&1; then
    echo "Service recovered successfully"
    # Send notification
    curl -X POST -H 'Content-Type: application/json' \
      -d '{"message": "Auto-recovery successful", "source": "monitoring"}' \
      http://localhost:8080/tools/send_telegram_message
  else
    echo "Auto-recovery failed, escalating"
    # Trigger high-priority alert
  fi
fi
EOF

chmod +x /usr/local/bin/auto-recovery.sh

# Add to crontab for periodic checks
echo "*/5 * * * * /usr/local/bin/auto-recovery.sh" | crontab -
```

### Capacity Planning

```bash
# Resource trending analysis
#!/bin/bash
# Generate weekly capacity report

echo "=== Weekly Capacity Report ==="
echo "Week ending: $(date)"

# CPU utilization trend
echo "--- CPU Utilization ---"
prometheus_query "avg(rate(process_cpu_usage_percent[5m]))" \
  "$(date -d '7 days ago' -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Memory utilization trend
echo "--- Memory Utilization ---"  
prometheus_query "avg(process_memory_heap_used_bytes)" \
  "$(date -d '7 days ago' -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Request volume trend
echo "--- Request Volume ---"
prometheus_query "sum(rate(http_requests_total[5m]))" \
  "$(date -d '7 days ago' -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## 📞 Escalation Procedures

### Internal Escalation

1. **L1 - Operations Team** (0-15 minutes)
   - Initial response and basic troubleshooting
   - Contacts: ops-oncall@company.com

2. **L2 - Engineering Team** (15-45 minutes)  
   - Advanced troubleshooting and code-level fixes
   - Contacts: eng-oncall@company.com

3. **L3 - Engineering Leadership** (45+ minutes)
   - Architectural decisions and resource allocation
   - Contacts: engineering-leadership@company.com

### External Escalation

1. **Cloud Provider Support** (if infrastructure-related)
   - AWS: Support case with Enterprise priority
   - Contact: aws-support@company.com

2. **Vendor Support** (if third-party dependency issues)
   - Telegram API issues: Contact Telegram support
   - Monitoring vendor: Contact support per SLA

3. **Security Team** (if security-related)
   - Immediate: security-oncall@company.com
   - Phone: +1-XXX-XXX-XXXX (24/7 hotline)

## 📋 Incident Response Checklist

### Detection & Response
- [ ] Alert acknowledged within SLA
- [ ] Incident channel created
- [ ] On-call engineer notified
- [ ] Initial assessment completed
- [ ] Severity level assigned

### Investigation & Mitigation
- [ ] Root cause investigation initiated
- [ ] Service logs analyzed
- [ ] System resources checked
- [ ] External dependencies verified
- [ ] Mitigation strategy selected
- [ ] Fix implemented and tested

### Resolution & Recovery
- [ ] Service functionality restored
- [ ] Performance validated
- [ ] Monitoring confirms stable state
- [ ] Users notified of resolution
- [ ] Incident status updated

### Post-Incident
- [ ] Post-mortem scheduled
- [ ] Root cause analysis completed
- [ ] Action items identified and assigned
- [ ] Documentation updated
- [ ] Process improvements implemented

---

## 📚 Additional Resources

- [Troubleshooting Guide](../troubleshooting.md)
- [Monitoring Setup](../monitoring.md)
- [Security Incident Response](../../security/incident-response.md)
- [Performance Tuning](../../maintenance/performance-tuning.md)

## 🔄 Document Maintenance

- **Last Updated**: January 2025
- **Review Frequency**: Monthly
- **Owner**: DevOps Team
- **Approver**: Engineering Leadership

---

*For 24/7 emergency support, contact the on-call engineer via PagerDuty or call +1-XXX-XXX-XXXX*
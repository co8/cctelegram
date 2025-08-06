# Monitoring Alerts Reference

Threshold explanations and alert configurations for CCTelegram 3-tier system monitoring.

## 🚨 Critical Alerts (P0 - Immediate Response)

### System Availability Alerts
| Alert Name | Threshold | Duration | Response Action |
|------------|-----------|----------|-----------------|
| **ServiceDown** | `up{job="mcp-server"} == 0` | 1 minute | Emergency restart all services |
| **AllTiersDown** | All tier health = false | 2 minutes | Execute emergency recovery script |
| **HealthEndpointDown** | HTTP status ≠ 200 | 1 minute | Check process + network connectivity |
| **CircuitBreakerCascade** | >2 circuit breakers open | 30 seconds | Immediate tier recovery procedures |

### Performance Critical Alerts
| Alert Name | Threshold | Duration | Response Action |
|------------|-----------|----------|-----------------|
| **HighErrorRate** | `rate(http_requests_total{status=~"5.."}[5m]) > 0.1` | 2 minutes | Investigate error source + failover |
| **ExtremeLatency** | P95 response time >2s | 2 minutes | Resource scaling + performance recovery |
| **MemoryExhaustion** | Memory usage >95% | 1 minute | Emergency restart services |
| **DiskSpaceCritical** | Disk usage >95% | 1 minute | Emergency cleanup + disk recovery |

### Security Critical Alerts
| Alert Name | Threshold | Duration | Response Action |
|------------|-----------|----------|-----------------|
| **SecurityBreach** | `rate(security_violations_total[5m]) > 0` | Immediate | Security team + lockdown procedures |
| **MassAuthFailures** | `rate(authentication_failures_total[5m]) > 5` | 1 minute | IP blocking + security investigation |
| **SuspiciousActivity** | Anomaly detection triggered | Immediate | Security analysis + access review |

## ⚠️ Warning Alerts (P1 - 1 Hour Response)

### Performance Warnings
```yaml
# Prometheus alert rules
groups:
  - name: cctelegram-performance-warnings
    rules:
      - alert: T1LatencyHigh
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{tier="T1"}[5m])) > 0.075
        for: 5m
        labels:
          severity: warning
          tier: T1
        annotations:
          summary: "Tier 1 latency approaching SLA limit ({{ $value }}s > 75ms)"
          action: "Scale MCP webhook instances or check network latency"
          
      - alert: T2LatencyHigh  
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{tier="T2"}[5m])) > 0.4
        for: 5m
        labels:
          severity: warning
          tier: T2
        annotations:
          summary: "Tier 2 latency approaching SLA limit ({{ $value }}s > 400ms)"
          action: "Check bridge internal processing + queue depth"
          
      - alert: T3LatencyHigh
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{tier="T3"}[5m])) > 4
        for: 10m
        labels:
          severity: warning  
          tier: T3
        annotations:
          summary: "Tier 3 latency approaching SLA limit ({{ $value }}s > 4s)"
          action: "Check file system performance + inotify limits"
```

### Resource Warnings
```yaml
  - name: cctelegram-resource-warnings
    rules:
      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / 1024 / 1024 > 400
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage detected ({{ $value }}MB)"
          action: "Monitor for memory leaks + consider restart"
          
      - alert: HighCPUUsage
        expr: rate(process_cpu_seconds_total[5m]) * 100 > 70
        for: 5m  
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage detected ({{ $value }}%)"
          action: "Check for CPU-intensive operations + scale if needed"
          
      - alert: DiskSpaceHigh
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100 < 20
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Disk space running low ({{ $value }}% remaining)"
          action: "Schedule cleanup + monitor disk usage trend"
```

### Business Logic Warnings
```yaml
  - name: cctelegram-business-warnings  
    rules:
      - alert: RateLimitingActive
        expr: rate(rate_limit_exceeded_total[5m]) > 2
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High rate limiting activity ({{ $value }} violations/sec)"
          action: "Investigate client behavior + adjust rate limits if needed"
          
      - alert: QueueBacklog
        expr: cctelegram_queue_size > 50
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Processing queue backlog detected ({{ $value }} items)"
          action: "Increase worker capacity + investigate processing delays"
          
      - alert: CircuitBreakerOpen
        expr: cctelegram_circuit_breaker_state{state="open"} == 1
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Circuit breaker open for {{ $labels.tier }}"
          action: "Investigate tier health + initiate recovery procedures"
```

## 📊 Informational Alerts (P2-P3)

### Trend Analysis Alerts
```yaml
  - name: cctelegram-trend-analysis
    rules:
      - alert: ResponseTimeIncreasing
        expr: increase(histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))[1h:5m]) > 0.1
        for: 15m
        labels:
          severity: info
        annotations:
          summary: "Response time trending upward ({{ $value }}s increase/hour)"
          action: "Monitor trend + investigate potential causes"
          
      - alert: ErrorRateIncreasing
        expr: increase(rate(http_requests_total{status=~"5.."}[5m])[1h:5m]) > 0.01
        for: 15m
        labels:
          severity: info  
        annotations:
          summary: "Error rate trending upward ({{ $value }} increase/hour)"
          action: "Investigate error patterns + root causes"
          
      - alert: TrafficSpike
        expr: rate(http_requests_total[5m]) > avg_over_time(rate(http_requests_total[5m])[1h:5m]) * 1.5
        for: 10m
        labels:
          severity: info
        annotations:
          summary: "Traffic spike detected ({{ $value }} req/sec vs {{ $labels.baseline }} baseline)"
          action: "Monitor capacity + prepare for scaling if sustained"
```

## 🔧 Alert Configuration by Component

### Tier 1 (MCP Webhook) Monitoring
```yaml
# Specific to T1 performance requirements (0-100ms SLA)
- alert: T1TimeoutRisk
  expr: histogram_quantile(0.90, rate(http_request_duration_seconds_bucket{tier="T1"}[5m])) > 0.08
  for: 3m
  annotations:
    summary: "T1 approaching timeout risk (P90: {{ $value }}s)"
    action: "Check webhook endpoint health + network latency"
    
- alert: T1FailoverActivation  
  expr: increase(cctelegram_failover_events_total{from_tier="T1"}[5m]) > 0
  for: 0s
  annotations:
    summary: "T1 failover to T2 activated"
    action: "Investigate T1 performance issues immediately"
```

### Tier 2 (Bridge Internal) Monitoring  
```yaml
# Specific to T2 performance requirements (100-500ms SLA)
- alert: T2ProcessingDelay
  expr: cctelegram_bridge_queue_depth > 20
  for: 5m
  annotations:
    summary: "T2 processing queue backlog ({{ $value }} items)"
    action: "Check bridge internal processor + increase workers"
    
- alert: T2MemoryPressure
  expr: process_resident_memory_bytes{service="bridge-internal"} / 1024 / 1024 > 300
  for: 10m
  annotations:
    summary: "T2 memory pressure detected ({{ $value }}MB)"  
    action: "Monitor for memory leaks + consider restart"
```

### Tier 3 (File Watcher) Monitoring
```yaml
# Specific to T3 performance requirements (1-5s SLA)  
- alert: T3FileSystemPressure
  expr: node_filesystem_avail_bytes{mountpoint="/var/lib/cctelegram"} / 1024 / 1024 / 1024 < 1
  for: 5m
  annotations:
    summary: "T3 file system space low ({{ $value }}GB remaining)"
    action: "Clean old processed files + monitor disk usage"
    
- alert: T3InotifyLimitApproaching
  expr: (cctelegram_inotify_watches_current / cctelegram_inotify_watches_max) * 100 > 80
  for: 5m
  annotations:
    summary: "T3 inotify watches high ({{ $value }}% of limit)"
    action: "Review watched directories + optimize file watching"
```

## 📈 Alert Severity Matrix

### Severity Levels
| Severity | Response Time | Escalation | Example Thresholds |
|----------|---------------|------------|-------------------|
| **Critical (P0)** | 0-15 minutes | Immediate page | Service down, >95% resource usage, security breach |
| **High (P1)** | 15-60 minutes | Phone call | >10% error rate, >1s response time, >85% resources |
| **Medium (P2)** | 1-4 hours | Slack/email | >5% error rate, >500ms response, >75% resources |  
| **Low (P3)** | Next business day | Email | Trend analysis, informational metrics |

### Tier-Specific SLA Thresholds
```yaml
# T1 (MCP Webhook) - 0-100ms SLA
T1_WARNING_THRESHOLD: 75ms   # 75% of SLA
T1_CRITICAL_THRESHOLD: 100ms # SLA breach
T1_TIMEOUT_THRESHOLD: 110ms  # Immediate failover

# T2 (Bridge Internal) - 100-500ms SLA  
T2_WARNING_THRESHOLD: 400ms  # 80% of SLA
T2_CRITICAL_THRESHOLD: 500ms # SLA breach
T2_TIMEOUT_THRESHOLD: 600ms  # Immediate failover

# T3 (File Watcher) - 1-5s SLA
T3_WARNING_THRESHOLD: 4s     # 80% of SLA  
T3_CRITICAL_THRESHOLD: 5s    # SLA breach
T3_TIMEOUT_THRESHOLD: 6s     # Processing failure
```

## 🔍 Alert Response Playbooks

### High Error Rate Alert Response
1. **Immediate (0-2 min)**:
   - Check error pattern in logs: `grep ERROR /var/log/cctelegram/application.log | tail -20`
   - Identify affected tier: `curl -H "X-API-Key: $API_KEY" /tools/get_bridge_status | jq '.tier_health'`

2. **Investigation (2-10 min)**:
   - Correlate with recent deployments/changes
   - Check external dependency health
   - Analyze error distribution by tier

3. **Mitigation (10-15 min)**:
   - Enable circuit breaker if not automatic
   - Scale affected tier resources
   - Implement temporary error suppression if needed

### Performance Degradation Alert Response  
1. **Assessment (0-3 min)**:
   - Measure current response times: `curl -w "%{time_total}" /health`
   - Check resource utilization: `top -bn1 | head -10`
   - Identify bottleneck tier

2. **Quick Fixes (3-10 min)**:
   - Restart services if memory/CPU pressure
   - Scale horizontally if capacity issue
   - Enable caching if database bottleneck

3. **Monitoring (10-30 min)**:
   - Verify performance improvement
   - Monitor for sustained resolution
   - Document root cause for prevention

### Security Alert Response
1. **Immediate Lockdown (0-30 sec)**:
   - Block suspicious IPs: `iptables -A INPUT -s $SUSPICIOUS_IP -j DROP`
   - Enable emergency rate limiting
   - Alert security team

2. **Investigation (30 sec - 5 min)**:
   - Analyze attack patterns in security logs
   - Check for data access anomalies  
   - Assess potential data exposure

3. **Containment (5-15 min)**:
   - Rotate compromised API keys
   - Patch identified vulnerabilities
   - Implement additional security controls

## 🛠️ Custom Alert Integration

### Webhook Notifications
```yaml
# Example webhook configuration for Slack
webhook_configs:
  - url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
    channel: '#alerts'
    title: 'CCTelegram Alert'
    text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
    send_resolved: true
```

### PagerDuty Integration  
```yaml
# PagerDuty configuration
pagerduty_configs:
  - routing_key: 'YOUR_PAGERDUTY_INTEGRATION_KEY'
    description: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
    severity: '{{ .GroupLabels.severity }}'
    client: 'CCTelegram Monitoring'
    client_url: 'https://grafana.yourcompany.com'
```

### Email Alerts
```yaml
# Email configuration  
email_configs:
  - to: 'ops-team@company.com'
    from: 'alerts@company.com'  
    subject: '[{{ .Status | toUpper }}] CCTelegram Alert'
    body: |
      {{ range .Alerts }}
      Alert: {{ .Annotations.summary }}
      Action: {{ .Annotations.action }}
      Severity: {{ .Labels.severity }}
      {{ end }}
```

---

**⚡ Quick Alert Commands**:
- `amtool alert query` - List active alerts
- `amtool silence add alertname="HighErrorRate"` - Silence alert  
- `curl http://alertmanager:9093/api/v1/alerts` - API query alerts

**🔗 Related Documentation**:
- [Error Codes](error-codes.md) for specific error alert mapping
- [Recovery Procedures](recovery-procedures.md) for alert response actions
- [Emergency Runbook](emergency-runbook.md) for critical alert procedures
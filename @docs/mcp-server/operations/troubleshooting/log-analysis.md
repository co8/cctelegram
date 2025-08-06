# Log Analysis Guide

Pattern recognition and analysis guide for CCTelegram 3-tier system logs.

## 🔍 Log File Locations

```bash
# Primary application logs
/var/log/cctelegram/application.log    # Main application events
/var/log/cctelegram/security.log       # Security events and audit trail
/var/log/cctelegram/performance.log    # Performance metrics and timing
/var/log/cctelegram/tier-operations.log # Tier-specific operations

# System logs
/var/log/syslog                        # System events
/var/log/nginx/access.log              # HTTP access logs
/var/log/nginx/error.log               # HTTP server errors
```

## 🚨 Critical Error Patterns

### Tier Failure Patterns
```bash
# Tier 1 (MCP Webhook) failures
grep -E "(T1|mcp_webhook).*ERROR" /var/log/cctelegram/application.log | \
  tail -10 | awk '{print $1, $2, $NF}'

# Tier 2 (Bridge Internal) failures  
grep -E "(T2|bridge_internal).*ERROR" /var/log/cctelegram/application.log | \
  tail -10 | awk '{print $1, $2, $NF}'

# Tier 3 (File Watcher) failures
grep -E "(T3|file_watcher).*ERROR" /var/log/cctelegram/application.log | \
  tail -10 | awk '{print $1, $2, $NF}'
```

### Cascade Failure Detection
```bash
# Detect cascade failures (all tiers failing within 5 minutes)
awk '/ERROR/ {
  if ($1 " " $2 >= systime() - 300) {
    if ($0 ~ /T1/) t1++; 
    if ($0 ~ /T2/) t2++; 
    if ($0 ~ /T3/) t3++;
  }
} END {
  if (t1 > 0 && t2 > 0 && t3 > 0) print "🚨 CASCADE FAILURE DETECTED"
  printf "T1: %d, T2: %d, T3: %d errors in last 5min\n", t1, t2, t3
}' /var/log/cctelegram/application.log
```

### Circuit Breaker Events
```bash
# Circuit breaker state changes
grep -E "circuit_breaker_state.*(open|closed|half_open)" /var/log/cctelegram/application.log | \
  awk '{print $1, $2, $6, $NF}' | column -t

# Circuit breaker trip frequency  
grep "circuit_breaker_state.*open" /var/log/cctelegram/application.log | \
  awk '{print $1}' | sort | uniq -c | tail -10
```

## ⚡ Performance Patterns

### Response Time Analysis
```bash
# Response time distribution by tier
for tier in "T1" "T2" "T3"; do
  echo "=== $tier Response Times ==="
  grep "tier.*$tier.*response_time_ms" /var/log/cctelegram/application.log | \
    grep -o "response_time_ms=[0-9]*" | cut -d= -f2 | \
    sort -n | awk '
    {
      times[NR] = $1
      sum += $1
    }
    END {
      if (NR > 0) {
        print "Count:", NR
        print "Average:", sum/NR "ms"
        print "Median:", times[int(NR/2)] "ms"
        print "P95:", times[int(NR*0.95)] "ms"
        print "Max:", times[NR] "ms"
      }
    }'
  echo
done
```

### Timeout Pattern Analysis
```bash
# Timeout events by tier and time
grep -E "timeout|TIMEOUT" /var/log/cctelegram/application.log | \
  awk '{print $1, $2, $6}' | \
  sort | uniq -c | sort -nr | head -10

# Timeout correlation with system load
grep "timeout" /var/log/cctelegram/application.log | \
  while read line; do
    timestamp=$(echo "$line" | awk '{print $1, $2}')
    load=$(grep "$timestamp" /var/log/syslog | grep "load average" | tail -1)
    echo "$timestamp: timeout + load: $load"
  done
```

### Memory and Resource Patterns
```bash
# Memory pressure correlation
grep -E "(memory|Memory|MEM)" /var/log/cctelegram/application.log | \
  grep -E "(high|pressure|exhausted|leak)" | \
  awk '{print $1, $2, $NF}' | tail -10

# Resource exhaustion warnings
grep -E "(exhausted|limit|threshold)" /var/log/cctelegram/application.log | \
  awk '{print $1, $2, $0}' | column -t
```

## 🔒 Security Event Patterns

### Authentication Failures
```bash
# Authentication failure patterns
grep "AUTHENTICATION_FAILED" /var/log/cctelegram/security.log | \
  jq -r '"\(.timestamp) \(.context.client_ip) \(.context.reason)"' | \
  sort | uniq -c | sort -nr | head -10

# Suspicious authentication patterns (>5 failures from same IP)
grep "AUTHENTICATION_FAILED" /var/log/cctelegram/security.log | \
  jq -r '.context.client_ip' | sort | uniq -c | \
  awk '$1 > 5 {print "🚨 Suspicious IP:", $2, "(" $1 " failures)"}'
```

### Rate Limiting Events
```bash
# Rate limit violations by client
grep "RATE_LIMIT_EXCEEDED" /var/log/cctelegram/security.log | \
  jq -r '"\(.context.client_ip) \(.context.endpoint)"' | \
  sort | uniq -c | sort -nr

# Rate limiting effectiveness
grep "RATE_LIMIT" /var/log/cctelegram/security.log | \
  awk '{print $1}' | cut -d'T' -f1 | sort | uniq -c | \
  awk '{print $2, $1 " violations"}'
```

### Security Anomaly Detection
```bash
# Unusual request patterns
grep "SECURITY" /var/log/cctelegram/security.log | \
  jq -r '.context.client_ip' | sort | uniq -c | \
  awk '$1 > 100 {print "⚠️ High activity IP:", $2, "(" $1 " requests)"}'

# Failed API key usage
grep "INVALID_API_KEY" /var/log/cctelegram/security.log | \
  jq -r '"\(.timestamp) \(.context.client_ip)"' | \
  tail -20
```

## 📊 Business Logic Patterns

### Task Processing Patterns
```bash
# Task completion rates by tier
for tier in "mcp_webhook" "bridge_internal" "file_watcher"; do
  success=$(grep "tier.*$tier.*success.*true" /var/log/cctelegram/application.log | wc -l)
  failure=$(grep "tier.*$tier.*success.*false" /var/log/cctelegram/application.log | wc -l)
  total=$((success + failure))
  if [ $total -gt 0 ]; then
    rate=$(echo "scale=1; $success * 100 / $total" | bc)
    echo "$tier: $rate% success rate ($success/$total)"
  fi
done
```

### Correlation ID Tracking
```bash
# Trace request through all tiers
track_correlation() {
  local cid=$1
  echo "=== Tracing Correlation ID: $cid ==="
  grep "correlation_id=$cid" /var/log/cctelegram/application.log | \
    awk '{print $1, $2, $6, $NF}' | \
    sort | column -t
}

# Usage: track_correlation "abc-123-def"
```

### Event Processing Delays
```bash
# Processing delay analysis
grep -E "queued|processed" /var/log/cctelegram/application.log | \
  awk '
  /queued/ { queue_time[$6] = $1 " " $2 }
  /processed/ { 
    if (queue_time[$6]) {
      printf "%s: %s -> %s\n", $6, queue_time[$6], $1 " " $2
    }
  }'
```

## 🔄 Failover and Recovery Patterns

### Failover Event Analysis
```bash
# Failover frequency and patterns
grep "failover" /var/log/cctelegram/application.log | \
  awk '{print $1, $6, $NF}' | \
  cut -d'T' -f1 | sort | uniq -c | \
  awk '{print $2 ": " $1 " failovers"}'

# Recovery success rates
grep -A5 -B5 "recovery.*successful" /var/log/cctelegram/application.log | \
  grep -E "(failed|successful)" | sort | uniq -c
```

### Health Check Patterns
```bash
# Health check failure patterns
grep "health.*check" /var/log/cctelegram/application.log | \
  awk '/failed/ {failed++} /passed/ {passed++} END {
    printf "Health checks - Passed: %d, Failed: %d (%.1f%% success)\n", 
    passed, failed, passed*100/(passed+failed)
  }'

# Health check response time trends
grep "health.*check.*duration" /var/log/cctelegram/application.log | \
  grep -o "duration=[0-9]*" | cut -d= -f2 | \
  awk '{sum+=$1; count++; if($1>max) max=$1} END {
    print "Health check duration - Avg:", sum/count "ms, Max:", max "ms"
  }'
```

## 🛠️ Log Analysis Tools

### Real-time Monitoring
```bash
# Real-time error monitoring
tail -f /var/log/cctelegram/application.log | \
  grep --color=always -E "(ERROR|CRITICAL|TIMEOUT)"

# Real-time tier performance
tail -f /var/log/cctelegram/application.log | \
  grep --color=always "response_time_ms" | \
  awk '{if($0 ~ /response_time_ms=/) {
    match($0, /response_time_ms=([0-9]+)/, arr)
    time = arr[1]
    if(time > 1000) print "\033[31m" $0 "\033[0m"
    else if(time > 500) print "\033[33m" $0 "\033[0m"
    else print $0
  }}'
```

### Historical Analysis Scripts
```bash
# Generate daily error report
daily_error_report() {
  local date=${1:-$(date '+%Y-%m-%d')}
  echo "=== Error Report for $date ==="
  
  echo "--- Tier Error Counts ---"
  for tier in "T1" "T2" "T3"; do
    count=$(grep "$date" /var/log/cctelegram/application.log | \
            grep "tier.*$tier.*ERROR" | wc -l)
    echo "$tier: $count errors"
  done
  
  echo "--- Top Error Messages ---"
  grep "$date" /var/log/cctelegram/application.log | \
    grep "ERROR" | awk -F'ERROR' '{print $2}' | \
    sort | uniq -c | sort -nr | head -5
}
```

### Performance Analysis Scripts
```bash
# Response time heatmap (hourly)
response_heatmap() {
  local date=${1:-$(date '+%Y-%m-%d')}
  echo "=== Response Time Heatmap for $date ==="
  
  for hour in {00..23}; do
    echo -n "${hour}:00 "
    grep "${date} ${hour}:" /var/log/cctelegram/application.log | \
      grep "response_time_ms" | \
      grep -o "response_time_ms=[0-9]*" | cut -d= -f2 | \
      awk '{sum+=$1; count++} END {
        if(count > 0) {
          avg = sum/count
          if(avg > 1000) printf "\033[31m%4.0fms\033[0m ", avg
          else if(avg > 500) printf "\033[33m%4.0fms\033[0m ", avg  
          else printf "%4.0fms ", avg
        } else printf "    - "
      }'
    echo
  done
}
```

## 📈 Log Aggregation and Alerting

### Log Parsing for Metrics
```bash
# Export metrics from logs (Prometheus format)
export_log_metrics() {
  echo "# CCTelegram application metrics"
  
  # Error rates by tier
  for tier in "T1" "T2" "T3"; do
    count=$(grep "tier.*$tier.*ERROR" /var/log/cctelegram/application.log | \
           tail -1000 | wc -l)
    echo "cctelegram_tier_errors_total{tier=\"$tier\"} $count"
  done
  
  # Response time percentiles
  grep "response_time_ms" /var/log/cctelegram/application.log | \
    tail -1000 | grep -o "response_time_ms=[0-9]*" | cut -d= -f2 | \
    sort -n | awk '
    BEGIN {print "# Response time percentiles"}
    {times[NR] = $1}
    END {
      if(NR > 0) {
        print "cctelegram_response_time_p50", times[int(NR*0.5)]
        print "cctelegram_response_time_p95", times[int(NR*0.95)]
        print "cctelegram_response_time_p99", times[int(NR*0.99)]
      }
    }'
}
```

### Alert Condition Detection
```bash
# Check for alert conditions
check_alert_conditions() {
  echo "=== Alert Condition Check ==="
  
  # High error rate (>5% in last 100 requests)
  recent_total=$(tail -100 /var/log/cctelegram/application.log | \
                grep -E "(success.*true|success.*false)" | wc -l)
  recent_errors=$(tail -100 /var/log/cctelegram/application.log | \
                 grep "success.*false" | wc -l)
  
  if [ $recent_total -gt 0 ]; then
    error_rate=$(echo "scale=1; $recent_errors * 100 / $recent_total" | bc)
    if [ $(echo "$error_rate > 5" | bc) -eq 1 ]; then
      echo "🚨 ALERT: High error rate detected ($error_rate%)"
    fi
  fi
  
  # Circuit breaker trips in last hour
  cb_trips=$(grep "circuit_breaker_state.*open" /var/log/cctelegram/application.log | \
            grep "$(date -d '1 hour ago' '+%Y-%m-%d %H')" | wc -l)
  if [ $cb_trips -gt 0 ]; then
    echo "⚠️  ALERT: $cb_trips circuit breaker trips in last hour"
  fi
  
  # High response times (>1s average in last 50 requests)
  avg_response=$(grep "response_time_ms" /var/log/cctelegram/application.log | \
                tail -50 | grep -o "response_time_ms=[0-9]*" | cut -d= -f2 | \
                awk '{sum+=$1; count++} END {if(count>0) print sum/count}')
  if [ $(echo "$avg_response > 1000" | bc 2>/dev/null) -eq 1 ]; then
    echo "⚠️  ALERT: High average response time (${avg_response}ms)"
  fi
}
```

---

**⚡ Quick Commands**:
- `tail -f /var/log/cctelegram/application.log | grep ERROR` - Live error monitoring
- `grep $(date '+%Y-%m-%d') /var/log/cctelegram/application.log | grep ERROR | wc -l` - Today's error count
- `journalctl -u cctelegram-mcp -f` - SystemD service logs

**🔗 Related**: [Error Codes](error-codes.md) | [Diagnostic Commands](diagnostic-commands.md) | [Recovery Procedures](recovery-procedures.md)
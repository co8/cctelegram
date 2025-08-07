# Enhanced Tier Orchestrator Monitoring Setup

## Overview

This document describes the comprehensive monitoring setup for the enhanced tier orchestrator, including Prometheus metrics, Grafana dashboards, and AlertManager configuration.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CCTelegram    │    │   Prometheus    │    │    Grafana      │
│     Bridge      │───▶│   Monitoring    │───▶│   Dashboards    │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                      │
         │                        ▼                      │
         │              ┌─────────────────┐              │
         │              │  AlertManager   │              │
         │              │   Notifications │◀─────────────┘
         │              └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Health Check   │
│   Endpoints     │
└─────────────────┘
```

## Enhanced Metrics

### Intelligent Selection Metrics

- **`cctelegram_intelligent_selection_total`**: Total tier selections by strategy
- **`cctelegram_selection_strategy_distribution`**: Distribution of selection strategies
- **`cctelegram_tier_score_histogram`**: Distribution of tier scores during selection

### Error Classification Metrics

- **`cctelegram_error_classification_total`**: Errors classified by category and tier
- **`cctelegram_error_severity_distribution`**: Distribution of error severities

### Resilience Pattern Metrics

- **`cctelegram_recovery_attempts_total`**: Recovery attempts by tier and strategy
- **`cctelegram_recovery_success_total`**: Successful recoveries
- **`cctelegram_bulkhead_utilization_ratio`**: Bulkhead utilization (0.0-1.0)
- **`cctelegram_adaptive_timeout_seconds`**: Current adaptive timeout values
- **`cctelegram_priority_queue_depth`**: Queue depths by tier and priority
- **`cctelegram_self_healing_attempts_total`**: Self-healing attempts
- **`cctelegram_self_healing_success_total`**: Successful self-healing actions
- **`cctelegram_circuit_breaker_trips_total`**: Circuit breaker trip events
- **`cctelegram_tier_health_score`**: Composite health scores (0.0-1.0)

## Quick Start

### 1. Start Monitoring Stack

```bash
# Navigate to project directory
cd /path/to/cctelegram

# Start the complete monitoring stack
docker-compose -f monitoring/docker-compose.monitoring.yml up -d
```

### 2. Access Monitoring Services

- **Grafana**: http://localhost:3000 (admin/admin123)
- **Prometheus**: http://localhost:9090
- **AlertManager**: http://localhost:9093
- **Traefik Dashboard**: http://localhost:8090

### 3. Configure CCTelegram Bridge

Ensure the bridge monitoring server is running:

```bash
# The bridge should expose metrics on port 8085
# Health checks available at:
# - /health (comprehensive)
# - /healthz (simple)
# - /ready (readiness)
# - /live (liveness)
# - /metrics (Prometheus format)
```

## Production Setup

### Environment Variables

```bash
# Grafana
export GRAFANA_ADMIN_PASSWORD="secure-password-here"
export GRAFANA_SECRET_KEY="your-secret-key-here"

# Prometheus
export PROMETHEUS_PASSWORD="prometheus-password"

# Environment
export ENVIRONMENT="production"
```

### Security Considerations

1. **Authentication**: Enable basic auth for Prometheus
2. **TLS**: Configure TLS certificates for production
3. **Network Security**: Use proper firewall rules
4. **Secret Management**: Use Docker secrets or external secret management

### High Availability

For production environments, consider:

1. **Prometheus HA**: Run multiple Prometheus instances
2. **Grafana HA**: Use external database (PostgreSQL)
3. **AlertManager HA**: Cluster AlertManager instances
4. **Load Balancing**: Use Traefik or NGINX for load balancing

## Dashboard Configuration

### System Overview Dashboard

The system overview dashboard provides:

- Overall system health status
- Request rates and success rates by tier
- Error distribution and severity heatmaps
- Circuit breaker status and failover events

### Enhanced Tier Orchestrator Dashboard

The enhanced dashboard includes:

- Intelligent selection strategy distribution
- Tier scoring visualizations
- Error classification breakdowns
- Resilience pattern metrics
- Self-healing activity tracking

## Alert Configuration

### Critical Alerts

1. **TierHighErrorRate**: Error rate > 5% for 3 minutes
2. **CircuitBreakerOpen**: Circuit breaker open for > 1 minute
3. **CriticalErrorSpike**: Critical errors > 1/sec for 1 minute
4. **FrequentFailovers**: Failover rate > 0.1/sec for 5 minutes

### Warning Alerts

1. **TierHealthDegraded**: Health score < 0.7 for 5 minutes
2. **BulkheadUtilizationHigh**: Utilization > 90% for 2 minutes
3. **SelfHealingFailureRateHigh**: Self-healing failure rate > 50%
4. **PriorityQueueDepthHigh**: Queue depth > 100 for 5 minutes

### Alert Routing

- **Critical**: Immediate notification to on-call team
- **High Priority**: Notification within 1 hour
- **Warning**: Daily digest or team notifications

## Health Check Endpoints

### `/health` - Comprehensive Health Check

```json
{
  "status": "UP",
  "timestamp": "2025-08-07T10:30:00Z",
  "details": {
    "overall_status": "Healthy",
    "tier_statuses": {
      "mcp_webhook": {
        "is_healthy": true,
        "circuit_breaker_state": "closed",
        "success_rate": 0.98,
        "average_response_time_ms": 45.2
      }
    }
  }
}
```

### `/healthz` - Simple Health Check

```
OK (200) or ERROR (500)
```

### `/ready` - Readiness Probe

```json
{
  "ready": true,
  "timestamp": "2025-08-07T10:30:00Z",
  "active_correlations": 5
}
```

### `/live` - Liveness Probe

```json
{
  "alive": true,
  "timestamp": "2025-08-07T10:30:00Z"
}
```

## Troubleshooting

### Common Issues

1. **Metrics not appearing**: Check bridge monitoring server is running on port 8085
2. **Dashboards blank**: Verify Prometheus can scrape metrics
3. **Alerts not firing**: Check AlertManager configuration and connectivity

### Diagnostic Commands

```bash
# Check bridge metrics endpoint
curl http://localhost:8085/metrics

# Check bridge health
curl http://localhost:8085/health

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Test AlertManager
curl http://localhost:9093/api/v1/status
```

### Log Analysis

Check logs for monitoring components:

```bash
# Bridge logs
docker logs cctelegram-bridge

# Prometheus logs
docker logs cctelegram-prometheus

# Grafana logs
docker logs cctelegram-grafana

# AlertManager logs
docker logs cctelegram-alertmanager
```

## Performance Considerations

### Metric Cardinality

Monitor the cardinality of labeled metrics:
- Tier labels: 3 values (mcp_webhook, bridge_internal, file_watcher)
- Strategy labels: 5 values (priority_based, performance_weighted, etc.)
- Priority labels: 4 values (critical, high, normal, low)
- Category/Severity labels: ~11 values each

### Resource Usage

Expected resource usage:
- **Prometheus**: 1-2 GB RAM, 2-5 GB disk (15-day retention)
- **Grafana**: 256-512 MB RAM
- **AlertManager**: 128-256 MB RAM
- **Bridge Monitoring**: 50-100 MB RAM overhead

### Optimization Tips

1. **Scrape Intervals**: Use appropriate intervals (10s for critical, 30s for health)
2. **Retention**: Configure appropriate retention periods
3. **Recording Rules**: Use recording rules for expensive queries
4. **Alerting Rules**: Optimize alert expressions for performance

## Testing

### Manual Testing

```bash
# Run the test script
cargo run --bin test-prometheus-metrics

# Check metrics output
curl http://localhost:8085/metrics | grep cctelegram_
```

### Automated Testing

The test script validates:
- Metric export functionality
- All enhanced orchestrator metrics presence
- Health check generation
- Prometheus format compliance

## Maintenance

### Regular Tasks

1. **Weekly**: Review alert effectiveness and adjust thresholds
2. **Monthly**: Analyze metric cardinality and optimize if needed
3. **Quarterly**: Review dashboard relevance and add new panels
4. **Annually**: Evaluate monitoring stack versions and upgrade

### Backup and Recovery

1. **Grafana**: Backup dashboards and data sources
2. **Prometheus**: Backup configuration and recording rules
3. **AlertManager**: Backup routing and notification configuration

## Integration with CI/CD

### Monitoring as Code

Store monitoring configuration in version control:
- Prometheus rules in `monitoring/alert_rules.yml`
- Grafana dashboards in `monitoring/grafana/dashboards/`
- Docker Compose in `monitoring/docker-compose.monitoring.yml`

### Deployment Pipeline

1. **Validate**: Check configuration syntax
2. **Test**: Run integration tests with monitoring
3. **Deploy**: Update monitoring stack
4. **Verify**: Confirm metrics and alerts are working

## Support

### Documentation

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [AlertManager Documentation](https://prometheus.io/docs/alerting/latest/alertmanager/)

### Community Resources

- [CCTelegram Monitoring Issues](https://github.com/your-org/cctelegram/issues)
- [Prometheus Community](https://prometheus.io/community/)
- [Grafana Community](https://community.grafana.com/)

---

*This monitoring setup provides comprehensive observability for the enhanced tier orchestrator with production-ready alerting and visualization capabilities.*
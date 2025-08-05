# Production Deployment Guide

## Overview

This guide covers the deployment of the CCTelegram MCP Server with full observability stack for production environments.

## Prerequisites

### System Requirements
- Node.js 18+ with ES modules support
- Minimum 2GB RAM (4GB recommended)
- 10GB+ available disk space
- Network access for monitoring endpoints

### Environment Variables

Create a `.env` file with the required configuration:

```bash
# Service Configuration
SERVICE_NAME=cctelegram-mcp-server
SERVICE_VERSION=1.5.0
NODE_ENV=production

# Observability Features
OBSERVABILITY_ENABLED=true
METRICS_ENABLED=true
LOGGING_ENABLED=true
TRACING_ENABLED=true
SECURITY_MONITORING_ENABLED=true
PERFORMANCE_MONITORING_ENABLED=true
ALERTING_ENABLED=true
DASHBOARD_ENABLED=true
HEALTH_CHECKING_ENABLED=true

# Metrics Configuration
METRICS_PORT=9090
METRICS_ENDPOINT=/metrics
METRICS_INTERVAL=10000

# Logging Configuration
LOG_LEVEL=info
LOG_FORMAT=json
LOG_OUTPUT=console,file
LOG_FILE_PATH=logs/cctelegram-mcp-server.log
LOG_MAX_SIZE=100MB
LOG_MAX_FILES=10

# Tracing Configuration
TRACING_SAMPLING_RATE=0.1
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# Security Configuration
SECURITY_THREAT_DETECTION=true
SECURITY_RATE_LIMIT_REQUESTS=100
SECURITY_RATE_LIMIT_WINDOW=60000

# Performance Configuration
PERFORMANCE_SLA_AVAILABILITY=99.9
PERFORMANCE_SLA_RESPONSE_TIME=500
PERFORMANCE_SLA_ERROR_RATE=1.0
PERFORMANCE_SLA_THROUGHPUT=100

# Alerting Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CRITICAL_CHAT_ID=your_critical_alerts_chat_id
TELEGRAM_ALERTS_CHAT_ID=your_general_alerts_chat_id
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@yourcompany.com
SMTP_PASS=your_app_password
ALERT_FROM_EMAIL=alerts@yourcompany.com
ALERT_TO_EMAIL=devops@yourcompany.com

# Dashboard Configuration
DASHBOARD_ENABLED=true
DASHBOARD_PORT=8080
DASHBOARD_AUTH_ENABLED=true
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=your_secure_password

# Health Check Configuration
HEALTH_ENDPOINT=/health
HEALTH_INTERVAL=30000
HEALTH_TIMEOUT=5000
```

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:18-alpine

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ && \
    ln -sf python3 /usr/bin/python

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY dist/ ./dist/
COPY src/observability/ ./src/observability/

# Create logs directory
RUN mkdir -p logs

# Expose ports
EXPOSE 9090 8080 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Run the application
CMD ["node", "dist/index.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  cctelegram-mcp-server:
    build: .
    container_name: cctelegram-mcp-server
    ports:
      - "9090:9090"  # Metrics
      - "8080:8080"  # Dashboard
    environment:
      - NODE_ENV=production
      - SERVICE_NAME=cctelegram-mcp-server
      - SERVICE_VERSION=1.5.0
      - OBSERVABILITY_ENABLED=true
      - METRICS_ENABLED=true
      - METRICS_PORT=9090
      - DASHBOARD_ENABLED=true
      - DASHBOARD_PORT=8080
      - HEALTH_ENDPOINT=/health
    volumes:
      - ./logs:/app/logs
      - ./config:/app/config
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - monitoring

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    ports:
      - "9091:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
      - '--storage.tsdb.retention.time=200h'
      - '--web.enable-lifecycle'
    restart: unless-stopped
    networks:
      - monitoring

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
    restart: unless-stopped
    networks:
      - monitoring

  jaeger:
    image: jaegertracing/all-in-one:latest
    container_name: jaeger
    ports:
      - "16686:16686"
      - "14268:14268"
    environment:
      - COLLECTOR_OTLP_ENABLED=true
    restart: unless-stopped
    networks:
      - monitoring

volumes:
  prometheus_data:
  grafana_data:

networks:
  monitoring:
    driver: bridge
```

### Prometheus Configuration

Create `monitoring/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alert_rules.yml"

scrape_configs:
  - job_name: 'cctelegram-mcp-server'
    static_configs:
      - targets: ['cctelegram-mcp-server:9090']
    scrape_interval: 10s
    metrics_path: '/metrics'

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

## Kubernetes Deployment

### Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cctelegram-mcp-server
  namespace: production
  labels:
    app: cctelegram-mcp-server
    version: v1.5.0
spec:
  replicas: 3
  selector:
    matchLabels:
      app: cctelegram-mcp-server
  template:
    metadata:
      labels:
        app: cctelegram-mcp-server
        version: v1.5.0
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - name: cctelegram-mcp-server
        image: cctelegram-mcp-server:1.5.0
        ports:
        - containerPort: 9090
          name: metrics
        - containerPort: 8080
          name: dashboard
        env:
        - name: NODE_ENV
          value: "production"
        - name: SERVICE_NAME
          value: "cctelegram-mcp-server"
        - name: SERVICE_VERSION
          value: "1.5.0"
        - name: OBSERVABILITY_ENABLED
          value: "true"
        envFrom:
        - secretRef:
            name: cctelegram-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
        volumeMounts:
        - name: logs
          mountPath: /app/logs
      volumes:
      - name: logs
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: cctelegram-mcp-server-service
  namespace: production
  labels:
    app: cctelegram-mcp-server
spec:
  selector:
    app: cctelegram-mcp-server
  ports:
  - name: metrics
    port: 9090
    targetPort: 9090
  - name: dashboard
    port: 8080
    targetPort: 8080
  type: ClusterIP
---
apiVersion: v1
kind: Secret
metadata:
  name: cctelegram-secrets
  namespace: production
type: Opaque
stringData:
  TELEGRAM_BOT_TOKEN: "your_telegram_bot_token"
  TELEGRAM_CRITICAL_CHAT_ID: "your_critical_chat_id"
  TELEGRAM_ALERTS_CHAT_ID: "your_alerts_chat_id"
  SMTP_USER: "alerts@yourcompany.com"
  SMTP_PASS: "your_smtp_password"
  DASHBOARD_PASSWORD: "your_secure_password"
```

## Monitoring Setup

### Grafana Dashboards

Import the following dashboard JSON configurations:

1. **System Overview Dashboard** - CPU, memory, disk usage
2. **Application Metrics Dashboard** - Request rates, response times, errors
3. **Security Dashboard** - Threat detection, compliance status
4. **Performance Dashboard** - SLA tracking, bottleneck analysis
5. **Health Dashboard** - Health check status, dependency monitoring

### Alert Rules

Create `monitoring/alert_rules.yml`:

```yaml
groups:
- name: cctelegram-mcp-server
  rules:
  - alert: HighMemoryUsage
    expr: memory_usage_percent > 85
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High memory usage detected"
      description: "Memory usage has been above 85% for 5 minutes"

  - alert: HighCPUUsage
    expr: cpu_usage_percent > 80
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High CPU usage detected"
      description: "CPU usage has been above 80% for 5 minutes"

  - alert: HighErrorRate
    expr: rate(http_requests_errors_total[5m]) > 0.05
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      description: "Error rate has been above 5% for 2 minutes"

  - alert: ServiceDown
    expr: up == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Service is down"
      description: "CCTelegram MCP Server is not responding"
```

## Security Considerations

### Network Security
- Use TLS/HTTPS for all external endpoints
- Restrict metrics endpoint access to monitoring systems
- Implement firewall rules for monitoring ports
- Use VPN or private networks for sensitive monitoring data

### Data Protection
- Enable log sanitization for PII and sensitive data
- Encrypt logs at rest and in transit
- Implement log retention policies
- Use secure authentication for dashboard access

### Access Control
- Implement role-based access control (RBAC)
- Use strong passwords and/or certificate-based authentication
- Regular security audits and vulnerability assessments
- Monitor and alert on unauthorized access attempts

## Performance Optimization

### Resource Allocation
- Minimum 2GB RAM, 4GB recommended for production
- CPU scaling based on expected load
- SSD storage for better I/O performance
- Network bandwidth adequate for monitoring data

### Configuration Tuning
- Adjust metrics collection intervals based on requirements
- Configure log rotation and retention policies
- Optimize tracing sampling rates (10% recommended for production)
- Set appropriate health check intervals

### Scaling Considerations
- Horizontal scaling with load balancers
- Database connection pooling if applicable
- Caching strategies for frequently accessed data
- Circuit breakers for external dependencies

## Maintenance Procedures

### Regular Tasks
- Monitor disk usage for logs and metrics
- Review and update alert thresholds
- Security patches and dependency updates
- Performance baseline reviews

### Backup and Recovery
- Regular configuration backups
- Monitoring data retention policies
- Disaster recovery procedures
- Testing backup restoration

### Troubleshooting
- Check service logs for errors
- Monitor resource utilization
- Validate configuration settings
- Test alert channels and escalation

## Support and Documentation

### Key Endpoints
- Health Check: `http://localhost:8080/health`
- Metrics: `http://localhost:9090/metrics`
- Dashboard: `http://localhost:8080/dashboard`
- API Documentation: Available in code comments

### Logs and Debugging
- Application logs: `/app/logs/`
- Structured JSON logging format
- Debug mode: Set `LOG_LEVEL=debug`
- Tracing data: Available in Jaeger UI

### Contact Information
- Development Team: devops@yourcompany.com
- Emergency Contact: oncall@yourcompany.com
- Documentation: Internal wiki or documentation system
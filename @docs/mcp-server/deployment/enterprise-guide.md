# Enterprise Deployment Guide

## 🚀 Overview

This guide provides comprehensive instructions for deploying the CCTelegram MCP Server in enterprise production environments with security, scalability, and reliability requirements.

## ⚠️ Pre-Deployment Requirements

### Critical Security Notice
**STOP**: Before proceeding with any deployment, you MUST complete the security remediation outlined in the [Security Assessment](../security/security-assessment.md). The MCP Server contains **CRITICAL vulnerabilities (CVSS 9.1)** that must be addressed.

**Required Actions**:
1. ✅ Implement authentication system
2. ✅ Configure input validation  
3. ✅ Enable secure logging
4. ✅ Set up rate limiting
5. ✅ Complete security validation checklist

## 📋 Infrastructure Requirements

### Minimum System Requirements

| Component | Development | Staging | Production |
|-----------|-------------|---------|------------|
| **CPU** | 2 cores | 4 cores | 8+ cores |
| **Memory** | 4GB RAM | 8GB RAM | 16+ GB RAM |
| **Storage** | 20GB SSD | 50GB SSD | 100+ GB SSD |
| **Network** | 10 Mbps | 100 Mbps | 1+ Gbps |
| **OS** | Ubuntu 20.04+ | Ubuntu 22.04+ | Ubuntu 22.04 LTS |

### Software Dependencies

```bash
# Core Runtime
Node.js >= 20.0.0
npm >= 10.0.0
TypeScript >= 5.3.0

# System Dependencies
systemd (process management)
nginx (reverse proxy) 
fail2ban (intrusion prevention)
ufw (firewall)
logrotate (log management)

# Monitoring Stack
prometheus (metrics)
grafana (dashboards)
node_exporter (system metrics)
```

### Network Requirements

#### Inbound Ports
- **8080**: MCP server WebSocket connections (internal only)
- **9090**: Metrics endpoint (monitoring only)
- **443**: HTTPS reverse proxy (external)
- **22**: SSH (admin access only)

#### Outbound Connections
- **443**: Telegram API (api.telegram.org)
- **80/443**: Package repositories and updates
- **25/587**: SMTP for alerting (optional)

#### Security Groups / Firewall Rules

```bash
# Inbound Rules
Allow 443/tcp from 0.0.0.0/0        # HTTPS public access
Allow 8080/tcp from 10.0.0.0/8      # MCP connections (internal)
Allow 9090/tcp from monitoring-subnet # Metrics (monitoring)
Allow 22/tcp from admin-subnet       # SSH (admin)

# Outbound Rules  
Allow 443/tcp to api.telegram.org    # Telegram API
Allow 80,443/tcp for package updates # Updates
Allow 25,587/tcp to mail-servers     # Email alerts
```

## 🏗️ Deployment Architecture

### Production Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer (AWS ALB/Azure LB)         │
│                    SSL Termination                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                   Reverse Proxy (Nginx)                     │
│              Rate Limiting & Security Headers               │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
┌─────────▼─────┐ ┌───▼───┐ ┌─────▼─────┐
│ MCP Server    │ │ MCP   │ │ MCP       │
│ Instance 1    │ │ Inst 2│ │ Instance 3│
│ + Monitoring  │ │       │ │           │
└─────────┬─────┘ └───┬───┘ └─────┬─────┘
          │           │           │
          └───────────┼───────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                CCTelegram Bridge                            │
│              (Rust Process - HA Cluster)                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                 Telegram Bot API                            │
│              (External Service)                             │
└─────────────────────────────────────────────────────────────┘
```

### Container Architecture (Recommended)

```yaml
# docker-compose.production.yml
version: '3.8'

services:
  mcp-server:
    image: cctelegram/mcp-server:1.5.0
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - MCP_ENABLE_AUTH=true
      - MCP_ENABLE_RATE_LIMIT=true
      - LOG_LEVEL=warn
    volumes:
      - ./config:/app/config:ro
      - ./logs:/app/logs
      - events-data:/app/events
    ports:
      - "127.0.0.1:8080:8080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'

  bridge:
    image: cctelegram/bridge:0.6.0
    restart: unless-stopped
    environment:
      - RUST_LOG=warn
      - TELEGRAM_BOT_TOKEN_FILE=/run/secrets/telegram_token
    secrets:
      - telegram_token
    volumes:
      - bridge-data:/app/data
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "./healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/ssl:ro
    depends_on:
      - mcp-server

  prometheus:
    image: prom/prometheus:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus

  grafana:
    image: grafana/grafana:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD_FILE=/run/secrets/grafana_password
    secrets:
      - grafana_password
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  events-data:
  bridge-data:
  prometheus-data:
  grafana-data:

secrets:
  telegram_token:
    file: ./secrets/telegram_token
  grafana_password:
    file: ./secrets/grafana_password
```

## 📦 Quick Deployment

### Option 1: Docker Deployment (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/your-org/cctelegram.git
cd cctelegram/mcp-server

# 2. Create production configuration
cp config.example.toml config.production.toml

# 3. Configure secrets
mkdir -p secrets
echo "YOUR_TELEGRAM_BOT_TOKEN" > secrets/telegram_token
echo "SECURE_GRAFANA_PASSWORD" > secrets/grafana_password

# 4. Generate API keys
openssl rand -hex 32 > secrets/api_key_claude
openssl rand -hex 32 > secrets/api_key_monitoring

# 5. Set environment variables
export MCP_API_KEYS=$(cat <<EOF
{
  "$(cat secrets/api_key_claude)": {
    "name": "claude-production",
    "permissions": ["send_telegram_event", "send_telegram_message", "get_bridge_status"],
    "enabled": true
  },
  "$(cat secrets/api_key_monitoring)": {
    "name": "monitoring-system", 
    "permissions": ["send_performance_alert", "start_bridge", "stop_bridge"],
    "enabled": true
  }
}
EOF
)

# 6. Deploy with Docker Compose
docker-compose -f docker-compose.production.yml up -d

# 7. Verify deployment
docker-compose ps
curl -H "X-API-Key: $(cat secrets/api_key_claude)" \
     http://localhost:8080/health
```

### Option 2: Direct Installation

```bash
# 1. Install Node.js (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Create application user
sudo useradd -r -s /bin/false -d /opt/cctelegram cctelegram
sudo mkdir -p /opt/cctelegram
sudo chown cctelegram:cctelegram /opt/cctelegram

# 3. Install application
cd /opt/cctelegram
sudo -u cctelegram git clone https://github.com/your-org/cctelegram.git .
sudo -u cctelegram npm ci --production
sudo -u cctelegram npm run build

# 4. Configure systemd service
sudo cp deployment/systemd/cctelegram-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cctelegram-mcp

# 5. Start service
sudo systemctl start cctelegram-mcp
sudo systemctl status cctelegram-mcp
```

## 🔧 Configuration

### Production Environment Variables

```bash
# /opt/cctelegram/.env.production

# Service Configuration
NODE_ENV=production
SERVICE_NAME=cctelegram-mcp-server
SERVICE_VERSION=1.5.0

# Security Configuration (CRITICAL)
MCP_ENABLE_AUTH=true
MCP_ENABLE_RATE_LIMIT=true
MCP_ENABLE_INPUT_VALIDATION=true
MCP_ENABLE_SECURE_LOGGING=true

# API Keys (Load from secure storage)
MCP_API_KEYS_FILE=/etc/cctelegram/api-keys.json

# Rate Limiting
MCP_RATE_LIMIT_REQUESTS=100
MCP_RATE_LIMIT_WINDOW=60000
MCP_RATE_LIMIT_BLOCK=300000

# Logging
LOG_LEVEL=warn
LOG_FORMAT=json
LOG_MAX_SIZE=10485760
LOG_MAX_FILES=5

# Paths (Secure directories)
CC_TELEGRAM_CONFIG_DIR=/etc/cctelegram
CC_TELEGRAM_EVENTS_DIR=/var/lib/cctelegram/events
CC_TELEGRAM_LOGS_DIR=/var/log/cctelegram

# Network
MCP_SERVER_HOST=127.0.0.1
MCP_SERVER_PORT=8080

# Health Checks
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=30000

# Monitoring
METRICS_ENABLED=true
METRICS_PORT=9090
PROMETHEUS_ENDPOINT=/metrics

# Telegram Configuration
TELEGRAM_BOT_TOKEN_FILE=/etc/cctelegram/telegram-token
TELEGRAM_API_TIMEOUT=30000
TELEGRAM_RETRY_ATTEMPTS=3

# Bridge Configuration
BRIDGE_EXECUTABLE=/usr/local/bin/cctelegram-bridge
BRIDGE_CONFIG_DIR=/etc/cctelegram/bridge
BRIDGE_RESTART_DELAY=5000
```

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/cctelegram
upstream mcp_backend {
    least_conn;
    server 127.0.0.1:8080 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:8081 max_fails=3 fail_timeout=30s backup;
    server 127.0.0.1:8082 max_fails=3 fail_timeout=30s backup;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name mcp.company.com;

    # SSL Configuration
    ssl_certificate /etc/ssl/certs/mcp.company.com.crt;
    ssl_certificate_key /etc/ssl/private/mcp.company.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";

    # Logging
    access_log /var/log/nginx/mcp_access.log;
    error_log /var/log/nginx/mcp_error.log;

    # Health check endpoint (no rate limiting)
    location /health {
        proxy_pass http://mcp_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_send_timeout 10s;
        proxy_read_timeout 10s;
    }

    # Metrics endpoint (restricted access)
    location /metrics {
        allow 10.0.0.0/8;     # Internal networks only
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
        
        proxy_pass http://mcp_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API endpoints with rate limiting
    location /tools/ {
        limit_req zone=api burst=10 nodelay;
        limit_req_status 429;

        proxy_pass http://mcp_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }

    # WebSocket upgrade for MCP connections
    location /mcp {
        proxy_pass http://mcp_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # Default location
    location / {
        return 404;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name mcp.company.com;
    return 301 https://$server_name$request_uri;
}
```

### Systemd Service Configuration

```ini
# /etc/systemd/system/cctelegram-mcp.service
[Unit]
Description=CCTelegram MCP Server
Documentation=https://github.com/your-org/cctelegram
After=network.target
Wants=network.target

[Service]
Type=notify
User=cctelegram
Group=cctelegram
WorkingDirectory=/opt/cctelegram
ExecStart=/usr/bin/node dist/index.js
ExecReload=/bin/kill -HUP $MAINPID
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30
Restart=always
RestartSec=5

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/cctelegram /var/log/cctelegram
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

# Environment
Environment=NODE_ENV=production
EnvironmentFile=/etc/cctelegram/environment

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cctelegram-mcp

[Install]
WantedBy=multi-user.target
```

## 📊 Monitoring Setup

### Prometheus Configuration

```yaml
# /etc/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "/etc/prometheus/rules/*.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093

scrape_configs:
  - job_name: 'cctelegram-mcp'
    static_configs:
      - targets: ['localhost:9090']
    scrape_interval: 10s
    metrics_path: /metrics
    scheme: http
    
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']
    scrape_interval: 30s

  - job_name: 'nginx'
    static_configs:
      - targets: ['localhost:9113']
    scrape_interval: 30s
```

### Alert Rules

```yaml
# /etc/prometheus/rules/cctelegram.yml
groups:
  - name: cctelegram_alerts
    rules:
      - alert: MCPServerDown
        expr: up{job="cctelegram-mcp"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "MCP Server is down"
          description: "CCTelegram MCP Server has been down for more than 1 minute"

      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 2m
        labels:
          severity: high
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value }} errors per second"

      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response latency"
          description: "95th percentile latency is {{ $value }} seconds"

      - alert: AuthenticationFailures
        expr: rate(security_events_total{event="authentication_failure"}[1m]) > 5
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "High authentication failure rate"
          description: "{{ $value }} authentication failures per second"

      - alert: RateLimitViolations
        expr: rate(security_events_total{event="rate_limit_exceeded"}[5m]) > 10
        for: 2m
        labels:
          severity: high
        annotations:
          summary: "High rate limit violation rate"
          description: "{{ $value }} rate limit violations per second"
```

## 🔄 High Availability Setup

### Multi-Instance Deployment

```bash
# Instance 1 (Primary)
export MCP_SERVER_PORT=8080
export INSTANCE_ID=mcp-01
systemctl start cctelegram-mcp@01

# Instance 2 (Secondary)  
export MCP_SERVER_PORT=8081
export INSTANCE_ID=mcp-02
systemctl start cctelegram-mcp@02

# Instance 3 (Tertiary)
export MCP_SERVER_PORT=8082  
export INSTANCE_ID=mcp-03
systemctl start cctelegram-mcp@03
```

### Load Balancer Health Checks

```bash
# Health check script
#!/bin/bash
# /usr/local/bin/mcp-health-check.sh

INSTANCE_PORT=${1:-8080}
API_KEY=${MCP_HEALTH_CHECK_API_KEY}

response=$(curl -s -w "%{http_code}" -H "X-API-Key: $API_KEY" \
  "http://localhost:$INSTANCE_PORT/health" -o /dev/null)

if [ "$response" = "200" ]; then
  exit 0
else
  exit 1
fi
```

### Database Clustering (if applicable)

```yaml
# Redis cluster for session storage (optional)
redis_cluster:
  nodes:
    - host: redis-01.internal
      port: 6379
    - host: redis-02.internal  
      port: 6379
    - host: redis-03.internal
      port: 6379
  max_redirections: 3
  retry_delay_on_cluster_down: 5
```

## 🛡️ Security Hardening

### Firewall Configuration (UFW)

```bash
# Reset firewall
sudo ufw --force reset

# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH access (restrict to admin networks)
sudo ufw allow from 10.0.1.0/24 to any port 22
sudo ufw allow from 192.168.1.0/24 to any port 22

# HTTP/HTTPS (public access)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Internal MCP connections
sudo ufw allow from 10.0.0.0/8 to any port 8080
sudo ufw allow from 172.16.0.0/12 to any port 8080
sudo ufw allow from 192.168.0.0/16 to any port 8080

# Monitoring (restricted)
sudo ufw allow from 10.0.2.0/24 to any port 9090
sudo ufw allow from 10.0.2.0/24 to any port 9100

# Enable firewall
sudo ufw enable
```

### Fail2Ban Configuration

```ini
# /etc/fail2ban/jail.d/cctelegram.conf
[cctelegram-auth]
enabled = true
port = 443
filter = cctelegram-auth
logpath = /var/log/cctelegram/security.log
maxretry = 5
bantime = 3600
findtime = 600

[cctelegram-rate-limit]  
enabled = true
port = 443
filter = cctelegram-rate-limit
logpath = /var/log/nginx/mcp_access.log
maxretry = 10
bantime = 1800
findtime = 300
```

```conf
# /etc/fail2ban/filter.d/cctelegram-auth.conf
[Definition]
failregex = ^.*SECURITY.*authentication_failure.*client_ip.*<HOST>.*$
ignoreregex =

# /etc/fail2ban/filter.d/cctelegram-rate-limit.conf  
[Definition]
failregex = ^<HOST>.*"(GET|POST).*" 429 .*$
ignoreregex =
```

## 📈 Scaling Guidelines

### Horizontal Scaling

| Load Level | Instances | CPU per Instance | Memory per Instance |
|------------|-----------|------------------|---------------------|
| **Low** (0-100 req/min) | 2 | 1 core | 1GB |
| **Medium** (100-1000 req/min) | 3-5 | 2 cores | 2GB |
| **High** (1000-10000 req/min) | 5-10 | 4 cores | 4GB |
| **Very High** (10000+ req/min) | 10+ | 8+ cores | 8+ GB |

### Auto-Scaling Configuration (Kubernetes)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: cctelegram-mcp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: cctelegram-mcp
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
```

## 🔍 Health Checks & Monitoring

### Health Check Endpoints

```bash
# Basic health check
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health

# Detailed health check  
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health/detailed

# Readiness probe (Kubernetes)
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health/ready

# Liveness probe (Kubernetes)
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health/live
```

### Monitoring Dashboard URLs

- **Grafana**: https://monitoring.company.com:3000
- **Prometheus**: https://monitoring.company.com:9090  
- **Alertmanager**: https://monitoring.company.com:9093

## 🚨 Troubleshooting

### Common Issues

#### 1. Service Won't Start
```bash
# Check service status
sudo systemctl status cctelegram-mcp

# View logs
sudo journalctl -u cctelegram-mcp -f

# Check configuration
sudo -u cctelegram node -c "require('./dist/config')"
```

#### 2. Authentication Failures
```bash
# Verify API key configuration
echo $MCP_API_KEYS | jq .

# Check security logs  
tail -f /var/log/cctelegram/security.log

# Test authentication
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health
```

#### 3. High Memory Usage
```bash
# Check process memory
ps aux | grep node

# Monitor heap usage
curl -H "X-API-Key: $API_KEY" http://localhost:9090/metrics | grep heap

# Generate heap dump (if needed)
kill -USR2 $(pgrep -f "node.*cctelegram")
```

#### 4. Bridge Connection Issues
```bash
# Check bridge status
curl -H "X-API-Key: $API_KEY" \
  -X POST http://localhost:8080/tools/get_bridge_status

# Test bridge connectivity
systemctl status cctelegram-bridge

# Restart bridge
curl -H "X-API-Key: $API_KEY" \
  -X POST http://localhost:8080/tools/restart_bridge
```

### Log Analysis

```bash
# Real-time monitoring
tail -f /var/log/cctelegram/application.log | jq .

# Error analysis
grep -i error /var/log/cctelegram/application.log | tail -20

# Security events
grep "SECURITY" /var/log/cctelegram/security.log | tail -10

# Performance analysis
grep "duration" /var/log/cctelegram/application.log | awk '{print $4}' | sort -n
```

## 🔄 Backup & Disaster Recovery

### Backup Strategy

```bash
#!/bin/bash
# /usr/local/bin/cctelegram-backup.sh

BACKUP_DIR="/backup/cctelegram/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Configuration backup
tar -czf "$BACKUP_DIR/config.tar.gz" /etc/cctelegram/

# Application data
tar -czf "$BACKUP_DIR/data.tar.gz" /var/lib/cctelegram/

# Database dump (if applicable)
# pg_dump cctelegram > "$BACKUP_DIR/database.sql"

# Logs (last 7 days)
find /var/log/cctelegram -name "*.log" -mtime -7 -exec cp {} "$BACKUP_DIR/" \;

# Cleanup old backups (keep 30 days)
find /backup/cctelegram -type d -mtime +30 -exec rm -rf {} \;
```

### Recovery Procedures

```bash
# 1. Stop services
sudo systemctl stop cctelegram-mcp nginx

# 2. Restore configuration
sudo tar -xzf backup/config.tar.gz -C /

# 3. Restore data  
sudo tar -xzf backup/data.tar.gz -C /

# 4. Restore database (if applicable)
# psql cctelegram < backup/database.sql

# 5. Fix permissions
sudo chown -R cctelegram:cctelegram /var/lib/cctelegram
sudo chown -R cctelegram:cctelegram /var/log/cctelegram

# 6. Start services
sudo systemctl start cctelegram-mcp nginx

# 7. Verify recovery
curl -H "X-API-Key: $API_KEY" http://localhost:8080/health
```

## 📞 Production Support

### Emergency Contacts
- **On-Call Engineer**: +1-XXX-XXX-XXXX
- **DevOps Team**: devops@company.com
- **Security Team**: security@company.com

### Escalation Matrix
1. **Level 1** (0-30 min): Application Team
2. **Level 2** (30-60 min): Infrastructure Team  
3. **Level 3** (60+ min): Engineering Management

### SLA Targets
- **Availability**: 99.9% (8.7 hours downtime/year)
- **Response Time**: <500ms (95th percentile)
- **Error Rate**: <0.1% of requests
- **Recovery Time**: <15 minutes for service restart

---

## ✅ Deployment Checklist

### Pre-Deployment
- [ ] Security remediation completed
- [ ] Infrastructure provisioned  
- [ ] SSL certificates obtained
- [ ] DNS configured
- [ ] Firewall rules applied
- [ ] Monitoring configured

### Deployment
- [ ] Application deployed
- [ ] Services started
- [ ] Health checks passing
- [ ] Load balancer configured
- [ ] Monitoring active

### Post-Deployment  
- [ ] Smoke tests completed
- [ ] Performance validated
- [ ] Security scan passed
- [ ] Backup verified
- [ ] Documentation updated
- [ ] Team notified

**Status**: 🚀 **READY FOR PRODUCTION** (after security remediation)

---

*For additional support, refer to the [Operations Runbooks](../operations/runbooks/) or contact the DevOps team.*
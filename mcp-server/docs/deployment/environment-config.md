# Environment Configuration Guide

Complete environment configuration templates for CCTelegram MCP Server across development, staging, and production environments.

## Configuration Overview

| Environment | Purpose | Security Level | Monitoring | Scaling |
|------------|---------|----------------|------------|---------|
| **Development** | Local testing | Minimal | Basic | Manual |
| **Staging** | Pre-prod testing | Medium | Enhanced | Limited |
| **Production** | Live system | Maximum | Full | Auto |

## Development Environment

### .env.development

```bash
# Development Environment Configuration
NODE_ENV=development
SERVICE_VERSION=1.8.5-dev

# Server Configuration
MCP_SERVER_HOST=localhost
MCP_SERVER_PORT=3000
MCP_LOG_LEVEL=debug

# Security (Relaxed for development)
MCP_ENABLE_AUTH=false
MCP_ENABLE_RATE_LIMIT=false
MCP_ENABLE_INPUT_VALIDATION=true
MCP_ENABLE_SECURE_LOGGING=false

# Debug Settings
DEBUG=mcp:*
NODE_OPTIONS=--inspect=9229

# Telegram Configuration (Test Bot)
TELEGRAM_BOT_TOKEN=your-test-bot-token
TELEGRAM_ALLOWED_USERS=123456,789012
TELEGRAM_API_TIMEOUT=10000

# Paths
CC_TELEGRAM_CONFIG_DIR=./config
CC_TELEGRAM_EVENTS_DIR=./data/events
CC_TELEGRAM_RESPONSES_DIR=./data/responses
CC_TELEGRAM_LOGS_DIR=./logs

# Bridge Configuration
BRIDGE_EXECUTABLE=./target/debug/cctelegram-bridge
BRIDGE_CONFIG_DIR=./config
BRIDGE_RESTART_DELAY=2000

# Database (Optional - for testing)
DATABASE_URL=sqlite://./dev.db
REDIS_URL=redis://localhost:6379

# Monitoring (Minimal)
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=30000

# Performance Settings
MEMORY_THRESHOLD_MB=500
CPU_THRESHOLD_PERCENT=90.0
EVENT_PROCESSING_THRESHOLD_MS=2000
```

### config.development.toml

```toml
[telegram]
timezone = "UTC"
message_style = "detailed"

[notifications]
task_completion = true
approval_requests = true
progress_updates = true

[security]
rate_limit_requests = 1000
rate_limit_window = 60
audit_log = false
hmac_verification = false

[performance]
memory_threshold_mb = 500
cpu_threshold_percent = 90.0
event_processing_threshold_ms = 2000
telegram_response_threshold_ms = 10000
metrics_collection_interval_seconds = 60
enable_detailed_logging = true

[monitoring]
health_check_port = 8080
enable_metrics_server = true
metrics_endpoint = "/metrics"
health_endpoint = "/health"

[timeouts]
webhook_timeout_ms = 1000
bridge_processing_timeout_ms = 2000
file_watcher_timeout_ms = 10000
overall_system_timeout_ms = 30000

[tier_configuration]
performance_degradation_threshold = 0.5
response_time_degradation_ms = 5000
error_rate_threshold_percent = 25.0
max_consecutive_failures = 5
```

### docker-compose.dev.yml

```yaml
version: '3.8'

services:
  mcp-server-dev:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    container_name: cctelegram-mcp-dev
    restart: "no"
    
    environment:
      - NODE_ENV=development
      - MCP_LOG_LEVEL=debug
      - MCP_ENABLE_AUTH=false
      - DEBUG=mcp:*
    
    ports:
      - "3000:3000"
      - "9229:9229"  # Debugger
      - "9090:9090"  # Metrics
    
    volumes:
      - .:/app:delegated
      - /app/node_modules
      - dev-data:/app/data
      - ./logs:/app/logs
    
    networks:
      - dev-network

  # Redis for caching (optional)
  redis-dev:
    image: redis:7-alpine
    container_name: cctelegram-redis-dev
    ports:
      - "6379:6379"
    volumes:
      - redis-dev-data:/data
    networks:
      - dev-network

volumes:
  dev-data:
  redis-dev-data:

networks:
  dev-network:
    driver: bridge
```

## Staging Environment

### .env.staging

```bash
# Staging Environment Configuration
NODE_ENV=staging
SERVICE_VERSION=1.8.5-staging

# Server Configuration
MCP_SERVER_HOST=0.0.0.0
MCP_SERVER_PORT=3000
MCP_LOG_LEVEL=info

# Security (Medium level)
MCP_ENABLE_AUTH=true
MCP_ENABLE_RATE_LIMIT=true
MCP_ENABLE_INPUT_VALIDATION=true
MCP_ENABLE_SECURE_LOGGING=true

# API Keys (Staging)
MCP_API_KEYS_FILE=/etc/cctelegram/api-keys.json
MCP_HMAC_SECRET_FILE=/etc/cctelegram/hmac-secret

# Rate Limiting
MCP_RATE_LIMIT_POINTS=200
MCP_RATE_LIMIT_DURATION=60000
MCP_RATE_LIMIT_BLOCK=300000

# Telegram Configuration (Staging Bot)
TELEGRAM_BOT_TOKEN_FILE=/etc/cctelegram/telegram-token
TELEGRAM_ALLOWED_USERS_FILE=/etc/cctelegram/allowed-users
TELEGRAM_API_TIMEOUT=15000

# Paths
CC_TELEGRAM_CONFIG_DIR=/etc/cctelegram
CC_TELEGRAM_EVENTS_DIR=/var/lib/cctelegram/events
CC_TELEGRAM_RESPONSES_DIR=/var/lib/cctelegram/responses
CC_TELEGRAM_LOGS_DIR=/var/log/cctelegram

# Bridge Configuration
BRIDGE_EXECUTABLE=/usr/local/bin/cctelegram-bridge
BRIDGE_CONFIG_DIR=/etc/cctelegram/bridge
BRIDGE_RESTART_DELAY=3000

# Database
DATABASE_URL_FILE=/etc/cctelegram/database-url
REDIS_URL_FILE=/etc/cctelegram/redis-url

# Monitoring (Enhanced)
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=15000
METRICS_RETENTION_DAYS=7

# Performance Settings
MEMORY_THRESHOLD_MB=256
CPU_THRESHOLD_PERCENT=75.0
EVENT_PROCESSING_THRESHOLD_MS=1000
TELEGRAM_RESPONSE_THRESHOLD_MS=3000

# Alerting
ALERT_WEBHOOK_URL_FILE=/etc/cctelegram/alert-webhook
SLACK_WEBHOOK_URL_FILE=/etc/cctelegram/slack-webhook

# SSL/TLS
SSL_CERT_PATH=/etc/ssl/certs/cctelegram-staging.crt
SSL_KEY_PATH=/etc/ssl/private/cctelegram-staging.key
```

### config.staging.toml

```toml
[telegram]
timezone = "UTC"
message_style = "concise"

[notifications]
task_completion = true
approval_requests = true
progress_updates = false

[security]
rate_limit_requests = 200
rate_limit_window = 60
audit_log = true
hmac_verification = true

[performance]
memory_threshold_mb = 256
cpu_threshold_percent = 75.0
event_processing_threshold_ms = 1000
telegram_response_threshold_ms = 3000
metrics_collection_interval_seconds = 30
enable_detailed_logging = false

[monitoring]
health_check_port = 8080
enable_metrics_server = true
metrics_endpoint = "/metrics"
health_endpoint = "/health"

[timeouts]
webhook_timeout_ms = 200
bridge_processing_timeout_ms = 750
file_watcher_timeout_ms = 7500
overall_system_timeout_ms = 15000

[tier_configuration]
performance_degradation_threshold = 0.7
response_time_degradation_ms = 3000
error_rate_threshold_percent = 20.0
max_consecutive_failures = 3
```

### kubernetes-staging.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cctelegram-staging-config
  namespace: cctelegram-staging
data:
  NODE_ENV: "staging"
  MCP_LOG_LEVEL: "info"
  MCP_ENABLE_AUTH: "true"
  MCP_ENABLE_RATE_LIMIT: "true"
  MCP_RATE_LIMIT_POINTS: "200"
  PROMETHEUS_ENABLED: "true"
  HEALTH_CHECK_INTERVAL: "15000"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cctelegram-mcp-server
  namespace: cctelegram-staging
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: cctelegram-mcp-server
  template:
    metadata:
      labels:
        app: cctelegram-mcp-server
        environment: staging
    spec:
      containers:
      - name: mcp-server
        image: ghcr.io/your-org/cctelegram-mcp-server:staging
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        envFrom:
        - configMapRef:
            name: cctelegram-staging-config
        - secretRef:
            name: cctelegram-staging-secrets
```

## Production Environment

### .env.production

```bash
# Production Environment Configuration
NODE_ENV=production
SERVICE_VERSION=1.8.5

# Server Configuration
MCP_SERVER_HOST=0.0.0.0
MCP_SERVER_PORT=3000
MCP_LOG_LEVEL=warn

# Security (Maximum level)
MCP_ENABLE_AUTH=true
MCP_ENABLE_RATE_LIMIT=true
MCP_ENABLE_INPUT_VALIDATION=true
MCP_ENABLE_SECURE_LOGGING=true

# API Keys (Production - from secure storage)
MCP_API_KEYS_FILE=/etc/cctelegram/secrets/api-keys.json
MCP_HMAC_SECRET_FILE=/etc/cctelegram/secrets/hmac-secret

# Rate Limiting (Strict)
MCP_RATE_LIMIT_POINTS=100
MCP_RATE_LIMIT_DURATION=60000
MCP_RATE_LIMIT_BLOCK=600000

# Telegram Configuration (Production Bot)
TELEGRAM_BOT_TOKEN_FILE=/etc/cctelegram/secrets/telegram-token
TELEGRAM_ALLOWED_USERS_FILE=/etc/cctelegram/secrets/allowed-users
TELEGRAM_API_TIMEOUT=30000
TELEGRAM_RETRY_ATTEMPTS=3

# Paths (Secure locations)
CC_TELEGRAM_CONFIG_DIR=/etc/cctelegram
CC_TELEGRAM_EVENTS_DIR=/var/lib/cctelegram/events
CC_TELEGRAM_RESPONSES_DIR=/var/lib/cctelegram/responses
CC_TELEGRAM_LOGS_DIR=/var/log/cctelegram

# Bridge Configuration
BRIDGE_EXECUTABLE=/usr/local/bin/cctelegram-bridge
BRIDGE_CONFIG_DIR=/etc/cctelegram/bridge
BRIDGE_RESTART_DELAY=5000

# Database (Production)
DATABASE_URL_FILE=/etc/cctelegram/secrets/database-url
DATABASE_MAX_CONNECTIONS=20
DATABASE_CONNECTION_TIMEOUT=30000
REDIS_URL_FILE=/etc/cctelegram/secrets/redis-url
REDIS_MAX_CONNECTIONS=10

# Monitoring (Full)
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
PROMETHEUS_RETENTION_DAYS=30
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=10000
METRICS_COLLECTION_INTERVAL=15000

# Performance Settings (Optimized)
MEMORY_THRESHOLD_MB=128
CPU_THRESHOLD_PERCENT=70.0
EVENT_PROCESSING_THRESHOLD_MS=500
TELEGRAM_RESPONSE_THRESHOLD_MS=2000

# Alerting (Production)
ALERT_WEBHOOK_URL_FILE=/etc/cctelegram/secrets/alert-webhook
SLACK_WEBHOOK_URL_FILE=/etc/cctelegram/secrets/slack-webhook
PAGERDUTY_KEY_FILE=/etc/cctelegram/secrets/pagerduty-key
EMAIL_SMTP_CONFIG_FILE=/etc/cctelegram/secrets/smtp-config

# SSL/TLS (Production certificates)
SSL_CERT_PATH=/etc/ssl/certs/cctelegram-prod.crt
SSL_KEY_PATH=/etc/ssl/private/cctelegram-prod.key
SSL_CA_PATH=/etc/ssl/certs/ca-certificates.crt

# Backup Configuration
BACKUP_ENABLED=true
BACKUP_SCHEDULE="0 2 * * *"  # Daily at 2 AM
BACKUP_RETENTION_DAYS=30
BACKUP_S3_BUCKET_FILE=/etc/cctelegram/secrets/s3-bucket
BACKUP_ENCRYPTION_KEY_FILE=/etc/cctelegram/secrets/backup-encryption-key

# Compliance
AUDIT_LOG_ENABLED=true
AUDIT_LOG_RETENTION_DAYS=90
GDPR_COMPLIANCE_ENABLED=true
DATA_RETENTION_DAYS=365
```

### config.production.toml

```toml
[telegram]
timezone = "UTC"
message_style = "concise"

[notifications]
task_completion = true
approval_requests = true
progress_updates = false

[security]
rate_limit_requests = 100
rate_limit_window = 60
audit_log = true
hmac_verification = true

[performance]
memory_threshold_mb = 128
cpu_threshold_percent = 70.0
event_processing_threshold_ms = 500
telegram_response_threshold_ms = 2000
metrics_collection_interval_seconds = 15
enable_detailed_logging = false

[monitoring]
health_check_port = 8080
enable_metrics_server = true
metrics_endpoint = "/metrics"
health_endpoint = "/health"

[timeouts]
webhook_timeout_ms = 100
bridge_processing_timeout_ms = 500
file_watcher_timeout_ms = 5000
overall_system_timeout_ms = 10000

[tier_configuration]
performance_degradation_threshold = 0.8
response_time_degradation_ms = 2000
error_rate_threshold_percent = 15.0
max_consecutive_failures = 3

[backup]
enabled = true
schedule = "0 2 * * *"
retention_days = 30
encryption_enabled = true

[compliance]
audit_log_enabled = true
audit_retention_days = 90
gdpr_compliance = true
data_retention_days = 365
```

### docker-compose.production.yml

```yaml
version: '3.8'

services:
  mcp-server:
    image: ghcr.io/your-org/cctelegram-mcp-server:1.6.0
    container_name: cctelegram-mcp-prod
    restart: unless-stopped
    
    # Security hardening
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    
    # Resource limits
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    
    environment:
      - NODE_ENV=production
      - MCP_LOG_LEVEL=warn
    
    # Secrets from files
    secrets:
      - telegram_token
      - api_keys
      - hmac_secret
      - database_url
      - redis_url
    
    ports:
      - "127.0.0.1:3000:3000"
      - "127.0.0.1:9090:9090"
    
    volumes:
      - prod-data:/var/lib/cctelegram
      - prod-logs:/var/log/cctelegram
      - prod-config:/etc/cctelegram:ro
      - /tmp:/tmp:rw,noexec,nosuid,size=100m
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "10"
        compress: "true"
    
    networks:
      - prod-network

  # Production database
  postgres:
    image: postgres:15-alpine
    container_name: cctelegram-postgres-prod
    restart: unless-stopped
    
    environment:
      - POSTGRES_DB=cctelegram
      - POSTGRES_USER=cctelegram
      - POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password
    
    secrets:
      - postgres_password
    
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./backup:/backup:ro
    
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cctelegram"]
      interval: 10s
      timeout: 5s
      retries: 5
    
    networks:
      - prod-network

  # Production Redis
  redis:
    image: redis:7-alpine
    container_name: cctelegram-redis-prod
    restart: unless-stopped
    
    command: redis-server --requirepass "${REDIS_PASSWORD}" --appendonly yes
    
    volumes:
      - redis-data:/data
    
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    
    networks:
      - prod-network

  # Nginx reverse proxy
  nginx:
    image: nginx:alpine
    container_name: cctelegram-nginx-prod
    restart: unless-stopped
    
    ports:
      - "80:80"
      - "443:443"
    
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/ssl:ro
      - nginx-logs:/var/log/nginx
    
    depends_on:
      - mcp-server
    
    networks:
      - prod-network

secrets:
  telegram_token:
    file: ./secrets/telegram_token
  api_keys:
    file: ./secrets/api_keys.json
  hmac_secret:
    file: ./secrets/hmac_secret
  database_url:
    file: ./secrets/database_url
  redis_url:
    file: ./secrets/redis_url
  postgres_password:
    file: ./secrets/postgres_password

volumes:
  prod-data:
    driver: local
  prod-logs:
    driver: local
  prod-config:
    driver: local
  postgres-data:
    driver: local
  redis-data:
    driver: local
  nginx-logs:
    driver: local

networks:
  prod-network:
    driver: bridge
    driver_opts:
      encrypted: "true"
```

## Environment-Specific Scripts

### scripts/setup-dev.sh

```bash
#!/bin/bash
set -euo pipefail

echo "🔧 Setting up development environment..."

# Create directories
mkdir -p {data,logs,config}/dev

# Copy configuration files
cp config.example.toml config/dev/config.toml
cp .env.example .env.development

# Generate development secrets
echo "dev-telegram-bot-token" > config/dev/telegram-token
openssl rand -hex 32 > config/dev/hmac-secret

# Set up development database
if command -v sqlite3 &> /dev/null; then
    sqlite3 data/dev/app.db "CREATE TABLE IF NOT EXISTS health_check (id INTEGER PRIMARY KEY, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);"
fi

# Install dependencies
npm ci

# Build project
npm run build

echo "✅ Development environment ready!"
echo "Run: npm run dev"
```

### scripts/setup-staging.sh

```bash
#!/bin/bash
set -euo pipefail

echo "🚀 Setting up staging environment..."

# Create secure directories
sudo mkdir -p /etc/cctelegram/{secrets,bridge}
sudo mkdir -p /var/lib/cctelegram/{events,responses}
sudo mkdir -p /var/log/cctelegram

# Set permissions
sudo chown -R cctelegram:cctelegram /etc/cctelegram
sudo chown -R cctelegram:cctelegram /var/lib/cctelegram
sudo chown -R cctelegram:cctelegram /var/log/cctelegram

# Generate staging secrets
sudo openssl rand -hex 32 | sudo tee /etc/cctelegram/secrets/hmac-secret > /dev/null

# Copy configuration
sudo cp config.staging.toml /etc/cctelegram/config.toml
sudo cp .env.staging /etc/cctelegram/environment

echo "✅ Staging environment configured!"
echo "Don't forget to set TELEGRAM_BOT_TOKEN and API keys!"
```

### scripts/setup-production.sh

```bash
#!/bin/bash
set -euo pipefail

echo "🏭 Setting up production environment..."

# Verify running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root for production setup"
   exit 1
fi

# Create secure directories with proper permissions
install -d -o cctelegram -g cctelegram -m 750 /etc/cctelegram/secrets
install -d -o cctelegram -g cctelegram -m 755 /var/lib/cctelegram/{events,responses}
install -d -o cctelegram -g cctelegram -m 755 /var/log/cctelegram

# Generate production secrets with high entropy
openssl rand -hex 32 > /etc/cctelegram/secrets/hmac-secret
openssl rand -hex 64 > /etc/cctelegram/secrets/api-key-master

# Set secure permissions on secrets
chmod 600 /etc/cctelegram/secrets/*
chown cctelegram:cctelegram /etc/cctelegram/secrets/*

# Copy configuration files
install -o cctelegram -g cctelegram -m 640 config.production.toml /etc/cctelegram/config.toml
install -o cctelegram -g cctelegram -m 640 .env.production /etc/cctelegram/environment

# Set up systemd service
cp systemd/cctelegram-mcp.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable cctelegram-mcp

# Configure logrotate
cp logrotate/cctelegram /etc/logrotate.d/

# Set up firewall rules
ufw allow from 10.0.0.0/8 to any port 3000
ufw allow from 172.16.0.0/12 to any port 3000
ufw allow from 192.168.0.0/16 to any port 3000

echo "✅ Production environment configured!"
echo "⚠️  IMPORTANT: Set TELEGRAM_BOT_TOKEN and other secrets manually!"
echo "   sudo nano /etc/cctelegram/secrets/telegram-token"
```

## Configuration Validation

### scripts/validate-config.js

```javascript
const fs = require('fs');
const path = require('path');

class ConfigValidator {
  constructor(env = 'development') {
    this.env = env;
    this.errors = [];
    this.warnings = [];
  }

  validateRequired(config, requiredKeys) {
    requiredKeys.forEach(key => {
      if (!config[key]) {
        this.errors.push(`Missing required configuration: ${key}`);
      }
    });
  }

  validateSecurity(config) {
    if (this.env === 'production') {
      if (config.MCP_ENABLE_AUTH !== 'true') {
        this.errors.push('Production must have MCP_ENABLE_AUTH=true');
      }
      if (config.MCP_ENABLE_RATE_LIMIT !== 'true') {
        this.warnings.push('Production should have rate limiting enabled');
      }
      if (config.MCP_LOG_LEVEL === 'debug') {
        this.warnings.push('Debug logging not recommended for production');
      }
    }
  }

  validatePaths(config) {
    const paths = [
      'CC_TELEGRAM_EVENTS_DIR',
      'CC_TELEGRAM_RESPONSES_DIR',
      'CC_TELEGRAM_LOGS_DIR'
    ];

    paths.forEach(pathKey => {
      if (config[pathKey] && !fs.existsSync(path.dirname(config[pathKey]))) {
        this.warnings.push(`Directory does not exist for ${pathKey}: ${config[pathKey]}`);
      }
    });
  }

  validate() {
    const envFile = `.env.${this.env}`;
    
    if (!fs.existsSync(envFile)) {
      this.errors.push(`Environment file not found: ${envFile}`);
      return false;
    }

    const config = {};
    fs.readFileSync(envFile, 'utf8')
      .split('\n')
      .filter(line => line && !line.startsWith('#'))
      .forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) config[key.trim()] = value.trim();
      });

    // Required for all environments
    this.validateRequired(config, [
      'NODE_ENV',
      'MCP_SERVER_PORT',
      'MCP_LOG_LEVEL'
    ]);

    // Environment-specific validation
    this.validateSecurity(config);
    this.validatePaths(config);

    return this.errors.length === 0;
  }

  report() {
    console.log(`\n🔍 Configuration Validation Report (${this.env})`);
    console.log('='.repeat(50));

    if (this.errors.length === 0) {
      console.log('✅ All validations passed!');
    } else {
      console.log('❌ Validation failed!');
      this.errors.forEach(error => console.log(`  ❌ ${error}`));
    }

    if (this.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
    }

    return this.errors.length === 0;
  }
}

// CLI usage
if (require.main === module) {
  const env = process.argv[2] || 'development';
  const validator = new ConfigValidator(env);
  const isValid = validator.validate();
  validator.report();
  process.exit(isValid ? 0 : 1);
}

module.exports = ConfigValidator;
```

## Quick Setup Commands

```bash
# Development setup
npm run setup:dev

# Staging setup  
npm run setup:staging

# Production setup (requires sudo)
sudo npm run setup:production

# Validate configuration
npm run validate:config -- production

# Switch environments
npm run env:switch staging

# Generate secrets
npm run secrets:generate production
```

This comprehensive environment configuration guide provides secure, scalable configuration templates for all deployment environments of the CCTelegram MCP Server.
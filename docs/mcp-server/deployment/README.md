# Deployment Overview

**Complete deployment guide for CCTelegram MCP Server across all environments**

[![Deployment](https://img.shields.io/badge/Deployment-Production%20Ready-00D26A?style=for-the-badge&logo=rocket)](README.md) [![Multi Platform](https://img.shields.io/badge/Multi%20Platform-Supported-26A5E4?style=for-the-badge&logo=docker)](README.md) [![Auto Scaling](https://img.shields.io/badge/Auto%20Scaling-Enabled-FF6B6B?style=for-the-badge&logo=scale)](README.md)

---

## 🚀 Quick Start

### Single-Command Deployment

```bash
# Production deployment with Docker Compose
curl -sSL https://raw.githubusercontent.com/cctelegram/deployment/main/install.sh | bash -s -- --env=production

# Development deployment
curl -sSL https://raw.githubusercontent.com/cctelegram/deployment/main/install.sh | bash -s -- --env=development
```

### Manual Deployment Steps

```bash
# 1. Clone repository
git clone https://github.com/cctelegram/mcp-server.git
cd mcp-server

# 2. Configure environment
cp .env.example .env
# Edit .env with your configuration

# 3. Start services
docker-compose up -d

# 4. Verify deployment
curl http://localhost:8080/health
```

---

## 📋 Deployment Options

### 1. Container Deployment (Recommended)

#### **Docker Compose**
```yaml
# docker-compose.yml
version: '3.8'
services:
  mcp-server:
    image: cctelegram/mcp-server:latest
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - REDIS_URL=${REDIS_URL}
    depends_on:
      - database
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  bridge:
    image: cctelegram/bridge:latest
    environment:
      - RUST_LOG=info
      - MCP_SERVER_URL=http://mcp-server:8080
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
    depends_on:
      - mcp-server
    restart: unless-stopped

  database:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=cctelegram
      - POSTGRES_USER=${DB_USER:-cctelegram}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

#### **Kubernetes Deployment**
```yaml
# kubernetes/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cctelegram
---
# kubernetes/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cctelegram-config
  namespace: cctelegram
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  METRICS_ENABLED: "true"
---
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cctelegram-mcp
  namespace: cctelegram
spec:
  replicas: 3
  selector:
    matchLabels:
      app: cctelegram-mcp
  template:
    metadata:
      labels:
        app: cctelegram-mcp
    spec:
      containers:
      - name: mcp-server
        image: cctelegram/mcp-server:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          valueFrom:
            configMapKeyRef:
              name: cctelegram-config
              key: NODE_ENV
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: cctelegram-secrets
              key: database-url
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
```

### 2. Native Deployment

#### **Ubuntu/Debian Installation**
```bash
#!/bin/bash
# install-native.sh - Native installation script

# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Install Redis
sudo apt-get install -y redis-server
sudo systemctl start redis
sudo systemctl enable redis

# Create application user
sudo useradd -m -s /bin/bash cctelegram
sudo usermod -aG sudo cctelegram

# Create directories
sudo mkdir -p /opt/cctelegram
sudo mkdir -p /var/log/cctelegram
sudo chown -R cctelegram:cctelegram /opt/cctelegram
sudo chown -R cctelegram:cctelegram /var/log/cctelegram

# Clone and build application
cd /opt/cctelegram
git clone https://github.com/cctelegram/mcp-server.git .
npm install --production
npm run build

# Build bridge
cd /opt/cctelegram/bridge
cargo build --release

# Create systemd services
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cctelegram-mcp
sudo systemctl enable cctelegram-bridge

echo "✅ Installation complete. Configure /etc/cctelegram/config.toml and start services."
```

#### **CentOS/RHEL Installation**
```bash
#!/bin/bash
# install-centos.sh - CentOS/RHEL installation

# Install EPEL repository
sudo yum install -y epel-release

# Install Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install PostgreSQL
sudo yum install -y postgresql-server postgresql-contrib
sudo postgresql-setup initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Install Redis
sudo yum install -y redis
sudo systemctl start redis
sudo systemctl enable redis

# Continue with application installation...
```

### 3. Cloud Deployment

#### **AWS ECS Deployment**
```json
{
  "family": "cctelegram-mcp",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/cctelegramTaskRole",
  "containerDefinitions": [
    {
      "name": "mcp-server",
      "image": "cctelegram/mcp-server:latest",
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:ssm:region:account:parameter/cctelegram/database-url"
        },
        {
          "name": "TELEGRAM_BOT_TOKEN",
          "valueFrom": "arn:aws:ssm:region:account:parameter/cctelegram/bot-token"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/cctelegram-mcp",
          "awslogs-region": "us-west-2",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
        "interval": 30,
        "timeout": 10,
        "retries": 3
      }
    }
  ]
}
```

#### **Google Cloud Run Deployment**
```yaml
# cloud-run.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: cctelegram-mcp
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/maxScale: "10"
        run.googleapis.com/cpu-throttling: "false"
    spec:
      serviceAccountName: cctelegram-service-account
      containers:
      - image: gcr.io/PROJECT-ID/cctelegram-mcp:latest
        ports:
        - name: http1
          containerPort: 8080
        env:
        - name: NODE_ENV
          value: production
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-url
              key: url
        resources:
          limits:
            memory: 2Gi
            cpu: 1000m
          requests:
            memory: 512Mi
            cpu: 500m
```

---

## ⚙️ Configuration

### Environment Variables

#### **Required Configuration**
```bash
# Core Settings
NODE_ENV=production                    # Environment (development|production)
PORT=8080                             # Server port
LOG_LEVEL=info                        # Logging level

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname
DATABASE_POOL_SIZE=20                 # Connection pool size
DATABASE_TIMEOUT=30000                # Query timeout (ms)

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token     # Bot token from @BotFather
TELEGRAM_WEBHOOK_URL=https://your.domain/webhook
TELEGRAM_SECRET_TOKEN=webhook_secret   # Webhook security token

# Redis (Optional - for caching)
REDIS_URL=redis://localhost:6379/0    # Redis connection string
REDIS_PASSWORD=your_redis_password    # Redis password

# Security
JWT_SECRET=your_jwt_secret            # JWT signing secret
ENCRYPTION_KEY=32_byte_hex_key        # Data encryption key
WEBHOOK_SECRET=webhook_secret_key     # Webhook validation secret

# External Services
MCP_SERVER_URL=http://localhost:8080  # MCP server URL for bridge
BRIDGE_PORT=3030                      # Bridge server port
```

#### **Optional Configuration**
```bash
# Performance
MAX_WORKERS=4                         # Worker processes
REQUEST_TIMEOUT=30000                 # Request timeout (ms)
KEEP_ALIVE_TIMEOUT=5000              # Keep-alive timeout (ms)

# Features
ENABLE_METRICS=true                   # Prometheus metrics
ENABLE_TRACING=false                  # OpenTelemetry tracing
ENABLE_RATE_LIMITING=true            # Rate limiting
RATE_LIMIT_MAX=100                   # Max requests per window
RATE_LIMIT_WINDOW=60000              # Rate limit window (ms)

# Storage
UPLOAD_LIMIT=10MB                     # File upload limit
TEMP_DIR=/tmp/cctelegram             # Temporary files directory
LOG_DIR=/var/log/cctelegram          # Log files directory

# Development
DEBUG=cctelegram:*                    # Debug namespaces
HOT_RELOAD=false                      # Hot reload in development
```

### Configuration Files

#### **config.toml**
```toml
[server]
host = "0.0.0.0"
port = 8080
workers = 4
request_timeout = "30s"
keep_alive_timeout = "5s"

[database]
url = "postgresql://localhost/cctelegram"
pool_size = 20
timeout = "30s"
migration_auto = true

[telegram]
bot_token = "${TELEGRAM_BOT_TOKEN}"
webhook_url = "${TELEGRAM_WEBHOOK_URL}"
secret_token = "${TELEGRAM_SECRET_TOKEN}"
max_connections = 40

[security]
jwt_secret = "${JWT_SECRET}"
encryption_key = "${ENCRYPTION_KEY}"
cors_origins = ["https://app.cctelegram.dev"]
rate_limit_enabled = true
rate_limit_max = 100
rate_limit_window = "1m"

[features]
metrics_enabled = true
tracing_enabled = false
health_checks_enabled = true
swagger_enabled = false  # Disable in production

[logging]
level = "info"
format = "json"
output = "/var/log/cctelegram/app.log"
max_size = "100MB"
max_files = 10

[monitoring]
prometheus_port = 9090
health_check_interval = "30s"
metrics_prefix = "cctelegram"
```

---

## 🔐 Security Configuration

### TLS/SSL Setup

#### **Let's Encrypt with Certbot**
```bash
# Install certbot
sudo apt-get install -y certbot

# Obtain certificate
sudo certbot certonly --standalone -d api.cctelegram.dev

# Auto-renewal
echo "0 3 * * * certbot renew --quiet" | sudo crontab -
```

#### **Reverse Proxy with Nginx**
```nginx
# /etc/nginx/sites-available/cctelegram
server {
    listen 80;
    server_name api.cctelegram.dev;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.cctelegram.dev;

    ssl_certificate /etc/letsencrypt/live/api.cctelegram.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.cctelegram.dev/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_timeout 30s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    location /health {
        proxy_pass http://localhost:8080/health;
        access_log off;
    }

    location /metrics {
        proxy_pass http://localhost:8080/metrics;
        allow 127.0.0.1;
        allow 10.0.0.0/8;
        deny all;
    }
}
```

### Firewall Configuration

#### **UFW (Ubuntu)**
```bash
# Reset firewall
sudo ufw --force reset

# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH access
sudo ufw allow ssh

# HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Application port (if directly exposed)
sudo ufw allow 8080/tcp

# Enable firewall
sudo ufw --force enable
```

---

## 📊 Monitoring Integration

### Health Checks

#### **Application Health Endpoint**
```javascript
// health.js
const express = require('express');
const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    // Check database connectivity
    await db.raw('SELECT 1');
    
    // Check Redis connectivity (if used)
    if (redis) {
      await redis.ping();
    }
    
    // Check external services
    const telegramCheck = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/getMe');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
      checks: {
        database: 'ok',
        redis: redis ? 'ok' : 'disabled',
        telegram: telegramCheck.ok ? 'ok' : 'error'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

module.exports = router;
```

### Metrics Collection

#### **Prometheus Integration**
```javascript
// metrics.js
const promClient = require('prom-client');

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequests = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status']
});

const httpDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

register.registerMetric(httpRequests);
register.registerMetric(httpDuration);

module.exports = { register, httpRequests, httpDuration };
```

---

## 🔧 Deployment Scripts

### Automated Deployment

#### **deploy.sh - Complete Deployment Script**
```bash
#!/bin/bash
# deploy.sh - Automated deployment script

set -euo pipefail

# Configuration
DEPLOY_ENV=${1:-production}
DEPLOY_VERSION=${2:-latest}
APP_DIR="/opt/cctelegram"
BACKUP_DIR="/var/backups/cctelegram"

echo "🚀 Starting CCTelegram deployment"
echo "Environment: $DEPLOY_ENV"
echo "Version: $DEPLOY_VERSION"

# Pre-deployment checks
echo "🔍 Running pre-deployment checks..."
if ! systemctl is-active --quiet postgresql; then
  echo "❌ PostgreSQL is not running"
  exit 1
fi

if ! systemctl is-active --quiet redis; then
  echo "❌ Redis is not running"  
  exit 1
fi

# Create backup
echo "💾 Creating backup..."
mkdir -p "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)"
sudo -u postgres pg_dump cctelegram > "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)/database.sql"
cp -r "$APP_DIR/config" "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)/"

# Stop services
echo "⏹️ Stopping services..."
sudo systemctl stop cctelegram-bridge
sudo systemctl stop cctelegram-mcp

# Update application
echo "📦 Updating application..."
cd "$APP_DIR"
git fetch origin
git checkout "v$DEPLOY_VERSION" 2>/dev/null || git checkout main

# Install dependencies
echo "📋 Installing dependencies..."
npm ci --production
cd bridge && cargo build --release && cd ..

# Run migrations
echo "🔄 Running database migrations..."
npm run migrate

# Start services
echo "▶️ Starting services..."
sudo systemctl start cctelegram-mcp
sudo systemctl start cctelegram-bridge

# Health check
echo "🏥 Running health checks..."
sleep 10
if curl -f http://localhost:8080/health; then
  echo "✅ Deployment successful"
else
  echo "❌ Health check failed, rolling back..."
  sudo systemctl stop cctelegram-mcp cctelegram-bridge
  # Restore backup logic here
  exit 1
fi

echo "🎉 Deployment completed successfully"
```

### Rolling Updates

#### **rolling-update.sh**
```bash
#!/bin/bash
# rolling-update.sh - Zero-downtime rolling update

INSTANCES=(server1 server2 server3)
NEW_VERSION=$1

for instance in "${INSTANCES[@]}"; do
  echo "Updating $instance..."
  
  # Remove from load balancer
  aws elbv2 deregister-targets --target-group-arn $TARGET_GROUP_ARN \
    --targets Id=$instance
  
  # Wait for connections to drain
  sleep 30
  
  # Deploy new version
  ssh $instance "sudo docker pull cctelegram/mcp-server:$NEW_VERSION"
  ssh $instance "sudo docker-compose up -d"
  
  # Health check
  sleep 30
  if ssh $instance "curl -f http://localhost:8080/health"; then
    # Add back to load balancer
    aws elbv2 register-targets --target-group-arn $TARGET_GROUP_ARN \
      --targets Id=$instance
    echo "✅ $instance updated successfully"
  else
    echo "❌ Health check failed for $instance"
    exit 1
  fi
done

echo "✅ Rolling update completed"
```

---

## 🔗 Related Documentation

### Deployment Resources
- **[Infrastructure Requirements](infrastructure.md)** - Infrastructure setup and requirements
- **[Environment Configuration](environment-config.md)** - Environment-specific configurations
- **[Monitoring Setup](monitoring-setup.md)** - Monitoring and observability setup
- **[Container Deployment](container-deployment.md)** - Container orchestration and deployment

### Operations Resources
- **[Operations Center](../operations/README.md)** - Operations and maintenance procedures
- **[Backup & Recovery](../operations/backup-recovery.md)** - Backup and disaster recovery
- **[Troubleshooting Guide](../operations/troubleshooting.md)** - Deployment troubleshooting

### Security Resources
- **[Security Guide](../security/README.md)** - Security configuration and hardening
- **[Authentication Guide](../security/auth-guide.md)** - Authentication and authorization setup

---

*Deployment Overview - Version 1.8.5*  
*Last updated: August 2025 | Next review: November 2025*

## See Also

- **[System Architecture](../architecture/system-overview.md)** - Understanding system architecture
- **[API Documentation](../api/README.md)** - API integration and usage
- **[Performance Tuning](../maintenance/performance-tuning.md)** - Performance optimization
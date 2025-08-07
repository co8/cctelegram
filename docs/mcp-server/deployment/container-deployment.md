# Container Deployment

**Comprehensive container deployment guide for CCTelegram MCP Server using Docker, Kubernetes, and orchestration platforms**

[![Docker](https://img.shields.io/badge/Docker-20.10+-0db7ed?style=for-the-badge&logo=docker)](README.md) [![Kubernetes](https://img.shields.io/badge/Kubernetes-1.24+-326ce5?style=for-the-badge&logo=kubernetes)](README.md) [![Production Ready](https://img.shields.io/badge/Production-Ready-00D26A?style=for-the-badge&logo=checkmark)](README.md)

---

## 🐳 Docker Deployment

### Single Container Setup

#### **Quick Start**
```bash
# Pull and run the MCP Server
docker run -d \
  --name cctelegram-mcp \
  -p 8080:8080 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://user:pass@host:5432/cctelegram \
  -e TELEGRAM_BOT_TOKEN=your_bot_token \
  cctelegram/mcp-server:latest

# Pull and run the Bridge
docker run -d \
  --name cctelegram-bridge \
  -e MCP_SERVER_URL=http://cctelegram-mcp:8080 \
  -e TELEGRAM_BOT_TOKEN=your_bot_token \
  --link cctelegram-mcp:mcp-server \
  cctelegram/bridge:latest
```

#### **Production Docker Setup**
```bash
# Create network
docker network create cctelegram-network

# Run PostgreSQL
docker run -d \
  --name cctelegram-postgres \
  --network cctelegram-network \
  -e POSTGRES_DB=cctelegram \
  -e POSTGRES_USER=cctelegram \
  -e POSTGRES_PASSWORD=secure_password \
  -v postgres_data:/var/lib/postgresql/data \
  postgres:15-alpine

# Run Redis
docker run -d \
  --name cctelegram-redis \
  --network cctelegram-network \
  -v redis_data:/data \
  redis:7-alpine redis-server --requirepass redis_password

# Run MCP Server
docker run -d \
  --name cctelegram-mcp \
  --network cctelegram-network \
  -p 8080:8080 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://cctelegram:secure_password@cctelegram-postgres:5432/cctelegram \
  -e REDIS_URL=redis://:redis_password@cctelegram-redis:6379/0 \
  -e TELEGRAM_BOT_TOKEN=your_bot_token \
  -v cctelegram_logs:/var/log/cctelegram \
  --restart unless-stopped \
  cctelegram/mcp-server:latest

# Run Bridge
docker run -d \
  --name cctelegram-bridge \
  --network cctelegram-network \
  -e MCP_SERVER_URL=http://cctelegram-mcp:8080 \
  -e TELEGRAM_BOT_TOKEN=your_bot_token \
  -e RUST_LOG=info \
  --restart unless-stopped \
  cctelegram/bridge:latest
```

---

## 🐙 Docker Compose

### Basic Compose Setup

#### **docker-compose.yml**
```yaml
version: '3.8'

services:
  # PostgreSQL Database
  database:
    image: postgres:15-alpine
    container_name: cctelegram-postgres
    environment:
      POSTGRES_DB: cctelegram
      POSTGRES_USER: cctelegram
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --lc-collate=en_US.UTF-8 --lc-ctype=en_US.UTF-8"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cctelegram -d cctelegram"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - cctelegram-network

  # Redis Cache
  redis:
    image: redis:7-alpine
    container_name: cctelegram-redis
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes:
      - redis_data:/data
      - ./redis.conf:/usr/local/etc/redis/redis.conf
    ports:
      - "6379:6379"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - cctelegram-network

  # MCP Server
  mcp-server:
    image: cctelegram/mcp-server:${VERSION:-latest}
    container_name: cctelegram-mcp
    ports:
      - "8080:8080"
      - "9090:9090"  # Metrics port
    environment:
      - NODE_ENV=production
      - PORT=8080
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - DATABASE_URL=postgresql://cctelegram:${DB_PASSWORD}@database:5432/cctelegram
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - ENABLE_METRICS=true
      - METRICS_PORT=9090
    volumes:
      - cctelegram_logs:/var/log/cctelegram
      - cctelegram_uploads:/app/uploads
      - ./config:/etc/cctelegram
    depends_on:
      database:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    networks:
      - cctelegram-network

  # CCTelegram Bridge
  bridge:
    image: cctelegram/bridge:${VERSION:-latest}
    container_name: cctelegram-bridge
    environment:
      - RUST_ENV=production
      - RUST_LOG=info
      - MCP_SERVER_URL=http://mcp-server:8080
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - BRIDGE_PORT=3030
      - MAX_RETRIES=3
      - RETRY_DELAY=1000
    volumes:
      - bridge_logs:/var/log/bridge
    depends_on:
      mcp-server:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3030/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - cctelegram-network

  # Nginx Reverse Proxy
  nginx:
    image: nginx:1.25-alpine
    container_name: cctelegram-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./ssl:/etc/ssl/certs
      - nginx_logs:/var/log/nginx
    depends_on:
      - mcp-server
    restart: unless-stopped
    networks:
      - cctelegram-network

  # Prometheus Monitoring
  prometheus:
    image: prom/prometheus:v2.47.0
    container_name: cctelegram-prometheus
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
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    depends_on:
      - mcp-server
    restart: unless-stopped
    networks:
      - cctelegram-network

  # Grafana Dashboard
  grafana:
    image: grafana/grafana:10.1.0
    container_name: cctelegram-grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      - GF_INSTALL_PLUGINS=grafana-clock-panel,grafana-simple-json-datasource
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
    depends_on:
      - prometheus
    restart: unless-stopped
    networks:
      - cctelegram-network

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  cctelegram_logs:
    driver: local
  cctelegram_uploads:
    driver: local
  bridge_logs:
    driver: local
  nginx_logs:
    driver: local
  prometheus_data:
    driver: local
  grafana_data:
    driver: local

networks:
  cctelegram-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

#### **Environment File (.env)**
```env
# Application Version
VERSION=latest

# Database Configuration
DB_PASSWORD=your_secure_db_password
POSTGRES_USER=cctelegram
POSTGRES_DB=cctelegram

# Redis Configuration
REDIS_PASSWORD=your_secure_redis_password

# Application Configuration
NODE_ENV=production
LOG_LEVEL=info
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
JWT_SECRET=your_jwt_secret_key_here
ENCRYPTION_KEY=your_32_byte_hex_encryption_key

# Monitoring
GRAFANA_PASSWORD=your_grafana_admin_password

# SSL Configuration
SSL_CERTIFICATE_PATH=./ssl/cert.pem
SSL_PRIVATE_KEY_PATH=./ssl/key.pem

# Network Configuration
COMPOSE_PROJECT_NAME=cctelegram
```

### Production Compose Setup

#### **docker-compose.prod.yml**
```yaml
version: '3.8'

services:
  mcp-server:
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: '1.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 1G
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "10"
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:size=100M

  bridge:
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
    security_opt:
      - no-new-privileges:true
    read_only: true

  database:
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == manager
      restart_policy:
        condition: on-failure
    volumes:
      - type: volume
        source: postgres_data
        target: /var/lib/postgresql/data
        volume:
          nocopy: true

  redis:
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
    sysctls:
      - net.core.somaxconn=65535
```

---

## ☸️ Kubernetes Deployment

### Basic Kubernetes Setup

#### **namespace.yaml**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cctelegram
  labels:
    name: cctelegram
```

#### **configmap.yaml**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cctelegram-config
  namespace: cctelegram
data:
  NODE_ENV: "production"
  PORT: "8080"
  LOG_LEVEL: "info"
  ENABLE_METRICS: "true"
  METRICS_PORT: "9090"
  BRIDGE_PORT: "3030"
  RUST_LOG: "info"
```

#### **secrets.yaml**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cctelegram-secrets
  namespace: cctelegram
type: Opaque
data:
  database-url: <base64-encoded-database-url>
  redis-url: <base64-encoded-redis-url>
  telegram-bot-token: <base64-encoded-bot-token>
  jwt-secret: <base64-encoded-jwt-secret>
  encryption-key: <base64-encoded-encryption-key>
```

#### **postgresql.yaml**
```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgresql
  namespace: cctelegram
spec:
  serviceName: postgresql-service
  replicas: 1
  selector:
    matchLabels:
      app: postgresql
  template:
    metadata:
      labels:
        app: postgresql
    spec:
      containers:
      - name: postgresql
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_DB
          value: cctelegram
        - name: POSTGRES_USER
          value: cctelegram
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgresql-secret
              key: password
        volumeMounts:
        - name: postgresql-storage
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - cctelegram
            - -d
            - cctelegram
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - cctelegram
            - -d
            - cctelegram
          initialDelaySeconds: 10
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: postgresql-storage
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 20Gi

---
apiVersion: v1
kind: Service
metadata:
  name: postgresql-service
  namespace: cctelegram
spec:
  selector:
    app: postgresql
  ports:
  - port: 5432
    targetPort: 5432
  type: ClusterIP
```

#### **redis.yaml**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: cctelegram
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        command:
        - redis-server
        - --requirepass
        - $(REDIS_PASSWORD)
        - --appendonly
        - "yes"
        env:
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: redis-secret
              key: password
        volumeMounts:
        - name: redis-data
          mountPath: /data
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          exec:
            command:
            - redis-cli
            - ping
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - redis-cli
            - ping
          initialDelaySeconds: 10
          periodSeconds: 5
      volumes:
      - name: redis-data
        persistentVolumeClaim:
          claimName: redis-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: redis-service
  namespace: cctelegram
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
  type: ClusterIP

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-pvc
  namespace: cctelegram
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
```

#### **mcp-server.yaml**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cctelegram-mcp
  namespace: cctelegram
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 2
  selector:
    matchLabels:
      app: cctelegram-mcp
  template:
    metadata:
      labels:
        app: cctelegram-mcp
        version: v1.0.0
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      containers:
      - name: mcp-server
        image: cctelegram/mcp-server:latest
        imagePullPolicy: IfNotPresent
        ports:
        - name: http
          containerPort: 8080
          protocol: TCP
        - name: metrics
          containerPort: 9090
          protocol: TCP
        env:
        - name: NODE_ENV
          valueFrom:
            configMapKeyRef:
              name: cctelegram-config
              key: NODE_ENV
        - name: PORT
          valueFrom:
            configMapKeyRef:
              name: cctelegram-config
              key: PORT
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: cctelegram-config
              key: LOG_LEVEL
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: cctelegram-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: cctelegram-secrets
              key: redis-url
        - name: TELEGRAM_BOT_TOKEN
          valueFrom:
            secretKeyRef:
              name: cctelegram-secrets
              key: telegram-bot-token
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: cctelegram-secrets
              key: jwt-secret
        - name: ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: cctelegram-secrets
              key: encryption-key
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
          initialDelaySeconds: 60
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
        volumeMounts:
        - name: logs
          mountPath: /var/log/cctelegram
        - name: config
          mountPath: /etc/cctelegram
          readOnly: true
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
      volumes:
      - name: logs
        emptyDir: {}
      - name: config
        configMap:
          name: cctelegram-config
      restartPolicy: Always
      terminationGracePeriodSeconds: 30

---
apiVersion: v1
kind: Service
metadata:
  name: cctelegram-mcp-service
  namespace: cctelegram
  labels:
    app: cctelegram-mcp
spec:
  type: ClusterIP
  selector:
    app: cctelegram-mcp
  ports:
  - name: http
    port: 80
    targetPort: 8080
    protocol: TCP
  - name: metrics
    port: 9090
    targetPort: 9090
    protocol: TCP
```

#### **bridge.yaml**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cctelegram-bridge
  namespace: cctelegram
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cctelegram-bridge
  template:
    metadata:
      labels:
        app: cctelegram-bridge
    spec:
      containers:
      - name: bridge
        image: cctelegram/bridge:latest
        ports:
        - name: http
          containerPort: 3030
        env:
        - name: RUST_LOG
          valueFrom:
            configMapKeyRef:
              name: cctelegram-config
              key: RUST_LOG
        - name: BRIDGE_PORT
          valueFrom:
            configMapKeyRef:
              name: cctelegram-config
              key: BRIDGE_PORT
        - name: MCP_SERVER_URL
          value: "http://cctelegram-mcp-service"
        - name: TELEGRAM_BOT_TOKEN
          valueFrom:
            secretKeyRef:
              name: cctelegram-secrets
              key: telegram-bot-token
        resources:
          requests:
            memory: "128Mi"
            cpu: "250m"
          limits:
            memory: "256Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3030
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3030
          initialDelaySeconds: 10
          periodSeconds: 5
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          runAsNonRoot: true
          runAsUser: 1001

---
apiVersion: v1
kind: Service
metadata:
  name: cctelegram-bridge-service
  namespace: cctelegram
spec:
  selector:
    app: cctelegram-bridge
  ports:
  - port: 3030
    targetPort: 3030
  type: ClusterIP
```

#### **ingress.yaml**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cctelegram-ingress
  namespace: cctelegram
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/rate-limit-window: "1m"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - api.cctelegram.dev
    secretName: cctelegram-tls
  rules:
  - host: api.cctelegram.dev
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: cctelegram-mcp-service
            port:
              number: 80
      - path: /health
        pathType: Exact
        backend:
          service:
            name: cctelegram-mcp-service
            port:
              number: 80
      - path: /metrics
        pathType: Exact
        backend:
          service:
            name: cctelegram-mcp-service
            port:
              number: 9090
```

### Helm Chart

#### **Chart.yaml**
```yaml
apiVersion: v2
name: cctelegram
description: A Helm chart for CCTelegram MCP Server
type: application
version: 1.0.0
appVersion: "1.8.5"
keywords:
  - cctelegram
  - telegram
  - mcp
  - notifications
home: https://github.com/cctelegram/mcp-server
sources:
  - https://github.com/cctelegram/mcp-server
maintainers:
  - name: CCTelegram Team
    email: team@cctelegram.dev
```

#### **values.yaml**
```yaml
replicaCount: 3

image:
  repository: cctelegram/mcp-server
  pullPolicy: IfNotPresent
  tag: "latest"

bridge:
  image:
    repository: cctelegram/bridge
    tag: "latest"
  replicaCount: 2

service:
  type: ClusterIP
  port: 80
  targetPort: 8080
  metricsPort: 9090

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
  hosts:
    - host: api.cctelegram.dev
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: cctelegram-tls
      hosts:
        - api.cctelegram.dev

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 500m
    memory: 512Mi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80

postgresql:
  enabled: true
  auth:
    database: cctelegram
    username: cctelegram
    password: ""  # Set in secrets
  primary:
    persistence:
      enabled: true
      size: 20Gi

redis:
  enabled: true
  auth:
    enabled: true
    password: ""  # Set in secrets
  master:
    persistence:
      enabled: true
      size: 5Gi

monitoring:
  enabled: true
  serviceMonitor:
    enabled: true
    namespace: monitoring
```

---

## 🔧 Container Optimization

### Multi-Stage Dockerfile

#### **Dockerfile (MCP Server)**
```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Runtime stage
FROM node:20-alpine AS runtime

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Install security updates
RUN apk --no-cache add dumb-init curl

WORKDIR /app

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Create required directories
RUN mkdir -p /var/log/cctelegram && chown nodejs:nodejs /var/log/cctelegram

# Set security options
USER nodejs
EXPOSE 8080 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

#### **Dockerfile (Bridge)**
```dockerfile
# Build stage
FROM rust:1.75-alpine AS builder

RUN apk add --no-cache musl-dev openssl-dev

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

# Runtime stage
FROM alpine:3.19 AS runtime

# Install security updates and runtime dependencies
RUN apk --no-cache add ca-certificates curl libgcc

# Create app user
RUN addgroup -g 1001 -S bridge
RUN adduser -S bridge -u 1001 -G bridge

WORKDIR /app

# Copy binary
COPY --from=builder --chown=bridge:bridge /app/target/release/cctelegram-bridge ./cctelegram-bridge

# Set permissions
RUN chmod +x cctelegram-bridge

USER bridge
EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3030/health || exit 1

CMD ["./cctelegram-bridge"]
```

### Security Hardening

#### **Docker Security Best Practices**
```dockerfile
# Use specific image versions
FROM node:20.10.0-alpine3.19

# Don't run as root
RUN adduser -D -s /bin/sh appuser
USER appuser

# Use read-only root filesystem
# Add to docker run: --read-only --tmpfs /tmp

# Drop capabilities
# Add to docker run: --cap-drop=ALL

# Use security profiles
# Add to docker run: --security-opt=no-new-privileges:true

# Limit resources
# Add to docker run: --memory=1g --cpus=1.0

# Network security
# Add to docker run: --network=custom-network
```

---

## 📊 Container Monitoring

### Health Checks

#### **Advanced Health Check**
```javascript
// health-check.js
const http = require('http');

const healthCheck = () => {
  const options = {
    hostname: 'localhost',
    port: 8080,
    path: '/health',
    method: 'GET',
    timeout: 5000
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        resolve('OK');
      } else {
        reject(new Error(`Health check failed: ${res.statusCode}`));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Health check timeout'));
    });

    req.on('error', reject);
    req.end();
  });
};

healthCheck()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
```

### Container Metrics

#### **Docker Compose with Monitoring**
```yaml
  # cAdvisor for container metrics
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.47.0
    container_name: cadvisor
    ports:
      - "8081:8080"
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:rw
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    restart: unless-stopped
    networks:
      - cctelegram-network

  # Node Exporter for system metrics
  node-exporter:
    image: prom/node-exporter:v1.6.1
    container_name: node-exporter
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    restart: unless-stopped
    networks:
      - cctelegram-network
```

---

## 🚀 Deployment Scripts

### Container Deployment Script

#### **deploy-containers.sh**
```bash
#!/bin/bash
# deploy-containers.sh - Container deployment automation

set -euo pipefail

ENVIRONMENT=${1:-production}
VERSION=${2:-latest}
COMPOSE_FILE="docker-compose.yml"

if [[ "$ENVIRONMENT" == "production" ]]; then
    COMPOSE_FILE="docker-compose.prod.yml"
fi

echo "🚀 Starting container deployment"
echo "Environment: $ENVIRONMENT"
echo "Version: $VERSION"
echo "Compose file: $COMPOSE_FILE"

# Pre-flight checks
echo "🔍 Running pre-flight checks..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    exit 1
fi

# Check environment file
if [[ ! -f .env ]]; then
    echo "❌ .env file not found"
    exit 1
fi

# Pull latest images
echo "📦 Pulling latest images..."
export VERSION=$VERSION
docker-compose -f $COMPOSE_FILE pull

# Create backup of current state
echo "💾 Creating backup..."
if docker-compose -f $COMPOSE_FILE ps -q | grep -q .; then
    docker-compose -f $COMPOSE_FILE exec database pg_dump -U cctelegram cctelegram > backup-$(date +%Y%m%d-%H%M%S).sql
fi

# Deploy with zero downtime
echo "🚀 Deploying containers..."
docker-compose -f $COMPOSE_FILE up -d --remove-orphans

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 30

# Health checks
echo "🏥 Running health checks..."
if curl -f http://localhost:8080/health; then
    echo "✅ MCP Server: Healthy"
else
    echo "❌ MCP Server: Unhealthy"
    exit 1
fi

# Cleanup old images
echo "🧹 Cleaning up old images..."
docker image prune -f

echo "🎉 Container deployment completed successfully"
```

### Kubernetes Deployment Script

#### **deploy-k8s.sh**
```bash
#!/bin/bash
# deploy-k8s.sh - Kubernetes deployment automation

set -euo pipefail

NAMESPACE=cctelegram
CHART_PATH=./helm/cctelegram
VALUES_FILE=values.yaml

# Create namespace if it doesn't exist
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# Deploy using Helm
if helm list -n $NAMESPACE | grep -q cctelegram; then
    echo "📦 Upgrading existing release..."
    helm upgrade cctelegram $CHART_PATH -n $NAMESPACE -f $VALUES_FILE
else
    echo "🚀 Installing new release..."
    helm install cctelegram $CHART_PATH -n $NAMESPACE -f $VALUES_FILE
fi

# Wait for rollout to complete
kubectl rollout status deployment/cctelegram-mcp -n $NAMESPACE

# Run health checks
echo "🏥 Running health checks..."
kubectl wait --for=condition=ready pod -l app=cctelegram-mcp -n $NAMESPACE --timeout=300s

echo "✅ Kubernetes deployment completed successfully"
```

---

## 🔗 Related Documentation

### Container Resources
- **[Deployment Overview](README.md)** - Complete deployment guide
- **[Infrastructure Requirements](infrastructure.md)** - Infrastructure setup and requirements
- **[Environment Configuration](environment-config.md)** - Environment-specific configurations

### Operations Resources
- **[Operations Center](../operations/README.md)** - Operations and maintenance procedures
- **[Monitoring Setup](monitoring-setup.md)** - Container monitoring and observability
- **[Security Guide](../security/README.md)** - Container security configuration

---

*Container Deployment Guide - Version 1.8.5*  
*Last updated: August 2025 | Next review: November 2025*

## See Also

- **[System Architecture](../architecture/system-overview.md)** - Understanding container architecture
- **[Performance Tuning](../maintenance/performance-tuning.md)** - Container performance optimization
- **[Troubleshooting Guide](../operations/troubleshooting.md)** - Container troubleshooting
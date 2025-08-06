# Docker Deployment Guide

Production-ready Docker deployment for CCTelegram bridge system.

## Multi-Stage Dockerfile

### Production Dockerfile

```dockerfile
# Multi-stage Docker build for CCTelegram MCP Server
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ git && rm -rf /var/cache/apk/*

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --include=dev && npm cache clean --force

# Build application
COPY src/ ./src/
RUN npm run build

# Production dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --no-audit --no-fund && npm cache clean --force

# Runtime stage
FROM node:20-alpine AS runtime

# Install runtime dependencies
RUN apk add --no-cache dumb-init curl ca-certificates && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S mcp -u 1001 -G nodejs

WORKDIR /app

# Copy dependencies and build
COPY --from=deps --chown=mcp:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=mcp:nodejs /app/dist ./dist
COPY --from=builder --chown=mcp:nodejs /app/package*.json ./

# Create directories
RUN mkdir -p /app/logs /app/data && chown -R mcp:nodejs /app/logs /app/data

# Environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    MCP_LOG_LEVEL=info \
    MCP_ENABLE_AUTH=true \
    MCP_ENABLE_RATE_LIMIT=true

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

USER mcp
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

### Development Dockerfile

```dockerfile
FROM node:20-alpine AS development

RUN apk add --no-cache python3 make g++ git && rm -rf /var/cache/apk/*
RUN npm install -g nodemon tsx

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S mcp -u 1001 -G nodejs

COPY package*.json ./
RUN npm ci

COPY . .
RUN chown -R mcp:nodejs /app

ENV NODE_ENV=development
USER mcp

EXPOSE 3000 9229

CMD ["npm", "run", "dev"]
```

## Docker Compose Configuration

### docker-compose.production.yml

```yaml
version: '3.8'

services:
  # MCP Server
  mcp-server:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime
    image: cctelegram-mcp-server:${VERSION:-latest}
    container_name: cctelegram-mcp
    restart: unless-stopped
    
    # Security
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    
    # Resources
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 128M
    
    environment:
      - NODE_ENV=production
      - MCP_LOG_LEVEL=${MCP_LOG_LEVEL:-info}
      - MCP_ENABLE_AUTH=true
      - MCP_ENABLE_RATE_LIMIT=true
      - MCP_API_KEYS=${MCP_API_KEYS}
      - MCP_HMAC_SECRET=${MCP_HMAC_SECRET}
    
    ports:
      - "${MCP_PORT:-3000}:3000"
    
    volumes:
      - mcp-data:/app/data
      - mcp-logs:/app/logs
      - /tmp:/tmp:rw,noexec,nosuid,size=100m
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    
    networks:
      - mcp-network

  # Development service
  mcp-dev:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    profiles: ["dev"]
    environment:
      - NODE_ENV=development
      - MCP_LOG_LEVEL=debug
      - DEBUG=*
    ports:
      - "3000:3000"
      - "9229:9229"
    volumes:
      - ./src:/app/src:ro
      - ./tests:/app/tests:ro
    networks:
      - mcp-network

  # Nginx reverse proxy
  nginx:
    image: nginx:alpine
    container_name: cctelegram-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/ssl:ro
    depends_on:
      - mcp-server
    networks:
      - mcp-network

volumes:
  mcp-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ${DATA_DIR:-./data}
  
  mcp-logs:
    driver: local

networks:
  mcp-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### docker-compose.override.yml

```yaml
# Development overrides
version: '3.8'

services:
  mcp-server:
    build:
      target: development
    volumes:
      - .:/app:delegated
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - MCP_ENABLE_AUTH=false
      - DEBUG=mcp:*
    command: ["npm", "run", "dev"]
```

## Environment Configuration

### .env.production

```bash
# Service configuration
NODE_ENV=production
VERSION=1.6.0
MCP_PORT=3000

# Data directories
DATA_DIR=./volumes/data
LOGS_DIR=./volumes/logs

# Security
MCP_ENABLE_AUTH=true
MCP_ENABLE_RATE_LIMIT=true
MCP_ENABLE_INPUT_VALIDATION=true
MCP_ENABLE_SECURE_LOGGING=true

# API Keys (JSON format)
MCP_API_KEYS={
  "your-secure-api-key-here": {
    "name": "claude-production",
    "permissions": ["send_telegram_event", "send_telegram_message", "get_bridge_status"],
    "enabled": true
  }
}

# Security
MCP_HMAC_SECRET=your-hmac-secret-here

# Rate limiting
MCP_RATE_LIMIT_POINTS=100
MCP_RATE_LIMIT_DURATION=60

# Telegram
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_ALLOWED_USERS=123456,789012

# Monitoring
PROMETHEUS_ENABLED=true
GRAFANA_PASSWORD=secure-password-here
```

### .env.development

```bash
NODE_ENV=development
MCP_PORT=3000
MCP_LOG_LEVEL=debug
MCP_ENABLE_AUTH=false
DEBUG=mcp:*
```

## Quick Start Commands

### Production Deployment

```bash
# 1. Create environment
mkdir -p cctelegram-deploy && cd cctelegram-deploy

# 2. Download compose files
curl -O https://raw.githubusercontent.com/your-org/cctelegram/main/docker-compose.production.yml

# 3. Configure environment
cp .env.example .env.production
nano .env.production  # Edit with your values

# 4. Generate secrets
openssl rand -hex 32 > .env.hmac_secret
echo "your-telegram-bot-token" > .env.telegram_token

# 5. Deploy
docker-compose -f docker-compose.production.yml --env-file .env.production up -d

# 6. Verify
docker-compose ps
docker-compose logs -f mcp-server
```

### Development Setup

```bash
# 1. Clone repository
git clone https://github.com/your-org/cctelegram.git
cd cctelegram/mcp-server

# 2. Start development environment
docker-compose --profile dev up -d

# 3. View logs
docker-compose logs -f mcp-dev

# 4. Run tests
docker-compose exec mcp-dev npm test
```

## Health Checks & Monitoring

### Health Check Endpoints

```bash
# Basic health
curl http://localhost:3000/health

# Detailed health
curl http://localhost:3000/health/detailed

# Readiness probe
curl http://localhost:3000/health/ready
```

### Docker Health Commands

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' cctelegram-mcp

# View health check logs
docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' cctelegram-mcp

# Health check script
docker exec cctelegram-mcp curl -f http://localhost:3000/health || echo "Unhealthy"
```

## Volume Management

### Data Persistence

```bash
# Backup volumes
docker run --rm -v cctelegram_mcp-data:/data -v $(pwd):/backup alpine tar czf /backup/mcp-data-backup.tar.gz -C /data .

# Restore volumes
docker run --rm -v cctelegram_mcp-data:/data -v $(pwd):/backup alpine tar xzf /backup/mcp-data-backup.tar.gz -C /data

# Inspect volume
docker volume inspect cctelegram_mcp-data
```

### Log Management

```bash
# View logs
docker-compose logs -f --tail=100 mcp-server

# Log rotation
docker-compose exec mcp-server sh -c 'find /app/logs -name "*.log" -size +100M -delete'

# Export logs
docker cp cctelegram-mcp:/app/logs ./exported-logs
```

## Scaling Configuration

### docker-compose.scale.yml

```yaml
version: '3.8'

services:
  mcp-server:
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 30s
        order: start-first
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      placement:
        constraints:
          - node.role == worker
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s

  # Load balancer
  haproxy:
    image: haproxy:alpine
    ports:
      - "80:80"
      - "443:443"
      - "8404:8404"  # Stats
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    depends_on:
      - mcp-server
```

## Security Hardening

### Security Configuration

```yaml
# docker-compose.security.yml
version: '3.8'

services:
  mcp-server:
    # Security hardening
    read_only: true
    tmpfs:
      - /tmp:noexec,nosuid,size=50m
    security_opt:
      - no-new-privileges:true
      - apparmor:docker-default
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    
    # User namespace
    user: "1001:1001"
    
    # Resource limits
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
      nproc: 4096
    
    # Memory limits
    mem_limit: 1g
    mem_reservation: 512m
    
    # CPU limits  
    cpus: 1.0
    cpu_shares: 1024
```

## Troubleshooting

### Common Issues

```bash
# Container won't start
docker-compose logs mcp-server
docker inspect cctelegram-mcp

# Permission issues
docker exec -it cctelegram-mcp ls -la /app/
docker exec -it --user root cctelegram-mcp chown -R mcp:nodejs /app/

# Network connectivity
docker exec cctelegram-mcp nslookup api.telegram.org
docker network inspect cctelegram_mcp-network

# Performance issues
docker stats cctelegram-mcp
docker exec cctelegram-mcp top

# Clean up resources
docker system prune -f
docker volume prune -f
```

### Debug Mode

```bash
# Run with debug logging
docker-compose -f docker-compose.yml -f docker-compose.debug.yml up -d

# Exec into container
docker exec -it cctelegram-mcp sh

# View environment
docker exec cctelegram-mcp env | grep MCP

# Test health endpoint
docker exec cctelegram-mcp curl -f http://localhost:3000/health
```

## CI/CD Integration

### Build Script

```bash
#!/bin/bash
# build.sh

VERSION=${1:-latest}
REGISTRY=${REGISTRY:-ghcr.io/your-org}

# Build multi-arch image
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag $REGISTRY/cctelegram-mcp-server:$VERSION \
  --tag $REGISTRY/cctelegram-mcp-server:latest \
  --push .
```

### GitHub Actions Integration

```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: ./mcp-server
    platforms: linux/amd64,linux/arm64
    push: ${{ github.event_name != 'pull_request' }}
    tags: |
      ghcr.io/${{ github.repository }}/mcp-server:${{ github.sha }}
      ghcr.io/${{ github.repository }}/mcp-server:latest
    cache-from: type=gha
    cache-to: type=gha,mode=max
```
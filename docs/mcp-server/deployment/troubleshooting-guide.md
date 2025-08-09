# Deployment Troubleshooting Guide

Quick troubleshooting reference for CCTelegram MCP Server deployment issues.

## Quick Diagnostics

### Health Check Commands

```bash
# Basic health check
curl -f http://localhost:3000/health

# Detailed health with API key
curl -H "X-API-Key: your-key" http://localhost:3000/health/detailed

# Container health
docker exec cctelegram-mcp curl -f http://localhost:3000/health

# Kubernetes health
kubectl exec deployment/cctelegram-mcp-server -- curl -f http://localhost:3000/health
```

### Service Status Commands

```bash
# Docker status
docker ps | grep cctelegram
docker logs --tail=50 cctelegram-mcp

# Systemd status
systemctl status cctelegram-mcp
journalctl -u cctelegram-mcp -f --lines=50

# Kubernetes status
kubectl get pods -l app=cctelegram-mcp-server
kubectl logs -f deployment/cctelegram-mcp-server --tail=50
```

## Common Issues & Solutions

### 1. Service Won't Start

#### Symptoms
- Service fails to start
- Process exits immediately
- No response on health endpoint

#### Diagnostics

```bash
# Check configuration
node -c "require('./dist/config')"

# Verify environment
env | grep MCP_ | sort

# Check permissions
ls -la /var/lib/cctelegram/
ls -la /var/log/cctelegram/

# Test port availability
netstat -tlnp | grep 3000
lsof -i :3000
```

#### Solutions

```bash
# Fix permissions
sudo chown -R cctelegram:cctelegram /var/lib/cctelegram/
sudo chown -R cctelegram:cctelegram /var/log/cctelegram/

# Create missing directories
sudo mkdir -p /var/lib/cctelegram/{events,responses}
sudo mkdir -p /var/log/cctelegram

# Kill conflicting process
sudo kill $(lsof -t -i:3000)

# Reset service
systemctl stop cctelegram-mcp
systemctl reset-failed cctelegram-mcp
systemctl start cctelegram-mcp
```

### 2. Authentication Failures

#### Symptoms
- 401 Unauthorized responses
- "Invalid API key" errors
- Authentication middleware rejections

#### Diagnostics

```bash
# Check API keys configuration
echo $MCP_API_KEYS | jq .

# Test with valid key
curl -H "X-API-Key: valid-key" http://localhost:3000/health

# Check security logs
grep "authentication" /var/log/cctelegram/security.log | tail -10

# Verify HMAC secret
echo $MCP_HMAC_SECRET | wc -c  # Should be 64 characters
```

#### Solutions

```bash
# Regenerate API keys
cat > /tmp/api-keys.json << 'EOF'
{
  "your-secure-api-key": {
    "name": "client-name",
    "permissions": ["send_telegram_event", "get_bridge_status"],
    "enabled": true
  }
}
EOF

export MCP_API_KEYS=$(cat /tmp/api-keys.json)

# Regenerate HMAC secret
export MCP_HMAC_SECRET=$(openssl rand -hex 32)

# Restart service
systemctl restart cctelegram-mcp
```

### 3. High Memory Usage

#### Symptoms
- Memory usage >1GB
- Out of memory errors
- Process killed by OOM killer

#### Diagnostics

```bash
# Check current memory usage
ps aux | grep cctelegram-mcp
cat /proc/$(pgrep cctelegram)/status | grep Vm

# Monitor memory over time
watch 'ps aux | grep cctelegram'

# Check for memory leaks
node --inspect dist/index.js
# Connect to Chrome DevTools and check heap

# Generate heap dump
kill -USR2 $(pgrep -f "node.*cctelegram")
```

#### Solutions

```bash
# Restart service to free memory
systemctl restart cctelegram-mcp

# Reduce Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=512"

# Enable garbage collection logging
export NODE_OPTIONS="--max-old-space-size=512 --trace-gc"

# Clear event files
find /var/lib/cctelegram/events -name "*.json" -mtime +7 -delete

# Analyze heap dump
npm install -g clinic
clinic doctor -- node dist/index.js
```

### 4. Connection Timeouts

#### Symptoms
- Slow response times
- Connection timeouts
- 504 Gateway Timeout errors

#### Diagnostics

```bash
# Test response time
time curl http://localhost:3000/health

# Check network connectivity
ping api.telegram.org
curl -I https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe

# Monitor connections
ss -tulpn | grep :3000
netstat -an | grep 3000

# Check DNS resolution
nslookup api.telegram.org
dig api.telegram.org
```

#### Solutions

```bash
# Increase timeout limits
export TELEGRAM_API_TIMEOUT=30000
export MCP_REQUEST_TIMEOUT=60000

# Restart networking
systemctl restart networking

# Clear DNS cache
systemctl restart systemd-resolved

# Check proxy settings
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

# Test with different DNS
echo "nameserver 8.8.8.8" >> /etc/resolv.conf
```

### 5. Bridge Communication Issues

#### Symptoms
- Bridge status shows "disconnected"
- Events not processed
- Bridge restart failures

#### Diagnostics

```bash
# Check bridge status
curl -H "X-API-Key: key" -X POST http://localhost:3000/tools/get_bridge_status

# Check bridge process
ps aux | grep cctelegram-bridge
systemctl status cctelegram-bridge

# Test bridge binary
/usr/local/bin/cctelegram-bridge --version
/usr/local/bin/cctelegram-bridge --config-check

# Check file permissions
ls -la /var/lib/cctelegram/events/
ls -la /var/lib/cctelegram/responses/
```

#### Solutions

```bash
# Restart bridge
curl -H "X-API-Key: key" -X POST http://localhost:3000/tools/restart_bridge

# Manual bridge restart
systemctl restart cctelegram-bridge

# Fix bridge permissions
chown -R cctelegram:cctelegram /var/lib/cctelegram/

# Rebuild bridge
cd /path/to/bridge && cargo build --release
```

### 6. SSL Certificate Issues

#### Symptoms
- SSL handshake failures
- Certificate expired warnings
- HTTPS not working

#### Diagnostics

```bash
# Check certificate validity
openssl x509 -in /etc/letsencrypt/live/domain/cert.pem -noout -dates

# Test SSL connection
openssl s_client -connect domain:443 -servername domain

# Check certificate chain
curl -vI https://domain.com

# Verify certificate files
ls -la /etc/letsencrypt/live/domain/
```

#### Solutions

```bash
# Renew certificate
certbot renew --force-renewal

# Fix certificate permissions
chmod 644 /etc/letsencrypt/live/domain/cert.pem
chmod 600 /etc/letsencrypt/live/domain/privkey.pem

# Reload nginx/apache
systemctl reload nginx

# Clear certificate cache
systemctl restart nginx
```

## Docker-Specific Issues

### Container Won't Start

```bash
# Check image
docker images | grep cctelegram

# Inspect container
docker inspect cctelegram-mcp

# Check logs
docker logs cctelegram-mcp --details

# Run interactively
docker run -it --rm cctelegram-mcp-server:latest sh

# Check environment
docker exec cctelegram-mcp env | grep MCP_
```

### Network Issues

```bash
# Check networks
docker network ls
docker network inspect cctelegram_default

# Test connectivity
docker exec cctelegram-mcp ping api.telegram.org
docker exec cctelegram-mcp nslookup api.telegram.org

# Port mapping
docker port cctelegram-mcp
netstat -tlnp | grep docker
```

### Volume Issues

```bash
# Check volumes
docker volume ls | grep cctelegram
docker volume inspect cctelegram_mcp-data

# Fix permissions in container
docker exec cctelegram-mcp chown -R mcp:nodejs /app/data

# Backup/restore volume
docker run --rm -v cctelegram_mcp-data:/data -v $(pwd):/backup alpine tar czf /backup/backup.tar.gz /data
```

## Kubernetes-Specific Issues

### Pod Issues

```bash
# Check pod status
kubectl get pods -l app=cctelegram-mcp-server
kubectl describe pod $POD_NAME

# Check events
kubectl get events --sort-by=.metadata.creationTimestamp

# Check resource limits
kubectl top pods
kubectl describe node $NODE_NAME

# Pod logs
kubectl logs $POD_NAME --previous
kubectl logs $POD_NAME -c container-name
```

### Service Issues

```bash
# Check service
kubectl get svc cctelegram-mcp-service
kubectl describe svc cctelegram-mcp-service

# Check endpoints
kubectl get endpoints cctelegram-mcp-service

# Test service connectivity
kubectl run test-pod --rm -it --image=curlimages/curl -- curl http://cctelegram-mcp-service/health
```

### Ingress Issues

```bash
# Check ingress
kubectl get ingress cctelegram-mcp-ingress
kubectl describe ingress cctelegram-mcp-ingress

# Check ingress controller
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller

# Test ingress
curl -H "Host: mcp.company.com" http://INGRESS_IP/health
```

## Performance Issues

### High CPU Usage

```bash
# Monitor CPU
top -p $(pgrep cctelegram)
htop -p $(pgrep cctelegram)

# Profile with clinic
npm install -g clinic
clinic doctor --on-port=3000 -- node dist/index.js

# Check for infinite loops
strace -p $(pgrep cctelegram) -e trace=write
```

### High I/O Usage

```bash
# Monitor I/O
iotop -p $(pgrep cctelegram)

# Check file handles
lsof -p $(pgrep cctelegram) | wc -l
cat /proc/$(pgrep cctelegram)/limits | grep files

# Monitor disk usage
du -sh /var/lib/cctelegram/*
df -h
```

### Network Issues

```bash
# Monitor network
nethogs
iftop

# Check connections
ss -tupln | grep cctelegram
netstat -tupln | grep 3000

# Test bandwidth
iperf3 -s &
iperf3 -c localhost -p 5201
```

## Log Analysis

### Error Patterns

```bash
# Common errors
grep -i error /var/log/cctelegram/application.log | tail -20

# Authentication failures
grep "authentication.*fail" /var/log/cctelegram/security.log

# Performance issues
grep "timeout\|slow" /var/log/cctelegram/application.log

# Memory issues
grep -i "memory\|heap\|gc" /var/log/cctelegram/application.log
```

### Log Analysis Scripts

```bash
# Error summary
awk '/ERROR/ {print $4, $5}' /var/log/cctelegram/application.log | sort | uniq -c | sort -nr

# Response time analysis
grep "duration" /var/log/cctelegram/application.log | awk '{print $6}' | sort -n | tail -20

# Request rate analysis
awk '{print $1}' /var/log/nginx/access.log | uniq -c | sort -nr | head -10
```

## Emergency Recovery

### Service Recovery

```bash
#!/bin/bash
# emergency-recovery.sh

echo "🚨 Starting emergency recovery..."

# Stop all services
systemctl stop cctelegram-mcp nginx

# Kill any remaining processes
pkill -f cctelegram

# Clear temp files
rm -rf /tmp/cctelegram-*

# Fix permissions
chown -R cctelegram:cctelegram /var/lib/cctelegram
chown -R cctelegram:cctelegram /var/log/cctelegram

# Restart services
systemctl start cctelegram-mcp
sleep 5
systemctl start nginx

# Verify
curl -f http://localhost:3000/health && echo "✅ Recovery successful"
```

### Database Recovery

```bash
# Backup current state
cp /var/lib/cctelegram/database.db /var/lib/cctelegram/database.db.backup

# Restore from backup
cp /backup/database.db /var/lib/cctelegram/database.db
chown cctelegram:cctelegram /var/lib/cctelegram/database.db

# Restart service
systemctl restart cctelegram-mcp
```

## Monitoring & Alerting

### Health Check Script

```bash
#!/bin/bash
# health-monitor.sh

ENDPOINT="http://localhost:3000/health"
API_KEY="your-api-key"
WEBHOOK_URL="your-webhook-url"

check_health() {
    response=$(curl -s -w "%{http_code}" -H "X-API-Key: $API_KEY" "$ENDPOINT")
    http_code="${response: -3}"
    
    if [ "$http_code" != "200" ]; then
        send_alert "🚨 CCTelegram MCP Server health check failed! HTTP $http_code"
        return 1
    fi
    
    return 0
}

send_alert() {
    local message="$1"
    curl -X POST -H 'Content-type: application/json' \
        --data '{"text":"'"$message"'"}' \
        "$WEBHOOK_URL"
}

# Run check
if ! check_health; then
    echo "Health check failed"
    exit 1
fi

echo "Health check passed"
```

### Resource Monitor

```bash
#!/bin/bash
# resource-monitor.sh

PID=$(pgrep cctelegram)
MEMORY_THRESHOLD=1000000  # 1GB in KB
CPU_THRESHOLD=80

if [ -z "$PID" ]; then
    echo "⚠️ Process not found"
    exit 1
fi

# Check memory
MEMORY=$(ps -o pid,vsz --no-headers -p $PID | awk '{print $2}')
if [ "$MEMORY" -gt "$MEMORY_THRESHOLD" ]; then
    echo "🚨 High memory usage: ${MEMORY}KB"
fi

# Check CPU
CPU=$(ps -o pid,pcpu --no-headers -p $PID | awk '{print $2}' | cut -d. -f1)
if [ "$CPU" -gt "$CPU_THRESHOLD" ]; then
    echo "🚨 High CPU usage: ${CPU}%"
fi
```

## Support Information

### System Information Collection

```bash
#!/bin/bash
# collect-info.sh

echo "📊 System Information Collection"
echo "================================"

echo "🗓️ Date: $(date)"
echo "💻 Hostname: $(hostname)"
echo "🏷️ OS: $(cat /etc/os-release | grep PRETTY_NAME)"
echo "🧠 Memory: $(free -h | grep Mem)"
echo "💾 Disk: $(df -h | grep -E '/$')"
echo "⚡ CPU: $(cat /proc/cpuinfo | grep 'model name' | uniq)"

echo -e "\n🔧 Service Status:"
systemctl status cctelegram-mcp --no-pager

echo -e "\n📋 Process Info:"
ps aux | grep cctelegram | head -5

echo -e "\n🌐 Network:"
ss -tulpn | grep 3000

echo -e "\n📁 File Permissions:"
ls -la /var/lib/cctelegram/
ls -la /var/log/cctelegram/

echo -e "\n🔧 Configuration:"
echo "NODE_ENV: $NODE_ENV"
echo "MCP_LOG_LEVEL: $MCP_LOG_LEVEL"
echo "MCP_ENABLE_AUTH: $MCP_ENABLE_AUTH"

echo -e "\n📄 Recent Logs:"
tail -20 /var/log/cctelegram/application.log
```

This comprehensive troubleshooting guide provides quick solutions for common deployment issues with the CCTelegram MCP Server across all deployment scenarios.
# SSL/TLS Certificate Automation Guide

Complete SSL certificate management with Let's Encrypt automation and cert-manager for CCTelegram MCP Server.

## Overview

| Method | Use Case | Automation Level | Complexity |
|--------|----------|------------------|------------|
| **cert-manager + Let's Encrypt** | Kubernetes | Full | Low |
| **Certbot + Nginx** | Traditional servers | High | Medium |
| **Traefik** | Docker Compose | Full | Low |
| **Manual + Scripts** | Custom setups | Medium | High |

## Kubernetes with cert-manager

### cert-manager Installation

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Verify installation
kubectl get pods --namespace cert-manager

# Wait for cert-manager to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=cert-manager -n cert-manager --timeout=300s
```

### ClusterIssuer Configuration

```yaml
# cluster-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: devops@company.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
          podTemplate:
            spec:
              nodeSelector:
                "kubernetes.io/os": linux
    - dns01:
        cloudflare:
          apiTokenSecretRef:
            name: cloudflare-api-token
            key: api-token

---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: devops@company.com
    privateKeySecretRef:
      name: letsencrypt-staging
    solvers:
    - http01:
        ingress:
          class: nginx
```

### Cloudflare DNS Token Secret

```yaml
# cloudflare-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: cloudflare-api-token
  namespace: cert-manager
type: Opaque
stringData:
  api-token: "your-cloudflare-api-token"
```

### Ingress with Automatic SSL

```yaml
# ingress-ssl.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cctelegram-mcp-ingress
  namespace: cctelegram
  annotations:
    # SSL automation
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    cert-manager.io/acme-challenge-type: "http01"
    
    # Nginx configuration
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/ssl-protocols: "TLSv1.2 TLSv1.3"
    nginx.ingress.kubernetes.io/ssl-ciphers: "ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384"
    
    # Security headers
    nginx.ingress.kubernetes.io/configuration-snippet: |
      add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
      add_header X-Frame-Options DENY always;
      add_header X-Content-Type-Options nosniff always;
      add_header X-XSS-Protection "1; mode=block" always;
      add_header Referrer-Policy "strict-origin-when-cross-origin" always;
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - mcp.company.com
    - api.mcp.company.com
    secretName: cctelegram-tls-cert
  rules:
  - host: mcp.company.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: cctelegram-mcp-service
            port:
              number: 80
  - host: api.mcp.company.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: cctelegram-mcp-service
            port:
              number: 80
```

### Certificate Resource (Alternative)

```yaml
# certificate.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: cctelegram-tls-cert
  namespace: cctelegram
spec:
  secretName: cctelegram-tls-cert
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - mcp.company.com
  - api.mcp.company.com
  - staging.mcp.company.com
  privateKey:
    algorithm: RSA
    size: 2048
  duration: 2160h  # 90 days
  renewBefore: 360h  # 15 days before expiry
```

## Docker Compose with Traefik

### traefik-docker-compose.yml

```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    container_name: cctelegram-traefik
    restart: unless-stopped
    
    command:
      # API and dashboard
      - --api.dashboard=true
      - --api.insecure=false
      
      # Entry points
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      
      # Docker provider
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      
      # Let's Encrypt
      - --certificatesresolvers.letsencrypt.acme.tlschallenge=true
      - --certificatesresolvers.letsencrypt.acme.email=devops@company.com
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.letsencrypt.acme.caserver=https://acme-v02.api.letsencrypt.org/directory
      
      # SSL configuration
      - --entrypoints.websecure.http.tls.options=modern@file
      
      # Logging
      - --log.level=INFO
      - --accesslog=true
    
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"  # Dashboard
    
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik/letsencrypt:/letsencrypt
      - ./traefik/dynamic.yml:/etc/traefik/dynamic.yml:ro
    
    labels:
      # Dashboard
      - traefik.enable=true
      - traefik.http.routers.dashboard.rule=Host(`traefik.company.com`)
      - traefik.http.routers.dashboard.tls.certresolver=letsencrypt
      - traefik.http.routers.dashboard.service=api@internal
      - traefik.http.routers.dashboard.middlewares=dashboard-auth
      
      # Dashboard auth
      - traefik.http.middlewares.dashboard-auth.basicauth.users=admin:$$2y$$10$$...
      
      # Redirect HTTP to HTTPS
      - traefik.http.middlewares.redirect-to-https.redirectscheme.scheme=https
      - traefik.http.routers.redirect-https.rule=hostregexp(`{host:.+}`)
      - traefik.http.routers.redirect-https.entrypoints=web
      - traefik.http.routers.redirect-https.middlewares=redirect-to-https
    
    networks:
      - traefik-network

  # CCTelegram MCP Server
  mcp-server:
    image: ghcr.io/your-org/cctelegram-mcp-server:latest
    container_name: cctelegram-mcp
    restart: unless-stopped
    
    environment:
      - NODE_ENV=production
      - MCP_ENABLE_AUTH=true
    
    volumes:
      - mcp-data:/app/data
      - mcp-logs:/app/logs
    
    labels:
      - traefik.enable=true
      
      # Main domain
      - traefik.http.routers.mcp-server.rule=Host(`mcp.company.com`)
      - traefik.http.routers.mcp-server.entrypoints=websecure
      - traefik.http.routers.mcp-server.tls.certresolver=letsencrypt
      - traefik.http.routers.mcp-server.service=mcp-server
      
      # API subdomain
      - traefik.http.routers.mcp-api.rule=Host(`api.mcp.company.com`)
      - traefik.http.routers.mcp-api.entrypoints=websecure
      - traefik.http.routers.mcp-api.tls.certresolver=letsencrypt
      - traefik.http.routers.mcp-api.service=mcp-server
      
      # Service
      - traefik.http.services.mcp-server.loadbalancer.server.port=3000
      
      # Security middleware
      - traefik.http.routers.mcp-server.middlewares=security-headers,rate-limit
      - traefik.http.routers.mcp-api.middlewares=security-headers,rate-limit
      
      # Security headers
      - traefik.http.middlewares.security-headers.headers.framedeny=true
      - traefik.http.middlewares.security-headers.headers.sslredirect=true
      - traefik.http.middlewares.security-headers.headers.browserxssfilter=true
      - traefik.http.middlewares.security-headers.headers.contenttypenosniff=true
      - traefik.http.middlewares.security-headers.headers.stsincludesubdomains=true
      - traefik.http.middlewares.security-headers.headers.stsseconds=31536000
      
      # Rate limiting
      - traefik.http.middlewares.rate-limit.ratelimit.average=100
      - traefik.http.middlewares.rate-limit.ratelimit.burst=50
      - traefik.http.middlewares.rate-limit.ratelimit.period=1m
    
    networks:
      - traefik-network

volumes:
  mcp-data:
  mcp-logs:

networks:
  traefik-network:
    driver: bridge
```

### traefik/dynamic.yml

```yaml
# Dynamic configuration
tls:
  options:
    modern:
      minVersion: "VersionTLS12"
      cipherSuites:
        - "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384"
        - "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305"
        - "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"
        - "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256"
      curvePreferences:
        - "CurveP521"
        - "CurveP384"
      sniStrict: true

http:
  middlewares:
    security-headers:
      headers:
        accessControlAllowMethods:
          - GET
          - POST
          - PUT
        accessControlMaxAge: 100
        hostsProxyHeaders:
          - "X-Forwarded-Host"
        referrerPolicy: "strict-origin-when-cross-origin"
        customRequestHeaders:
          X-Forwarded-Proto: "https"
```

## Traditional Server with Certbot

### certbot-nginx.sh

```bash
#!/bin/bash
set -euo pipefail

# Certbot + Nginx SSL automation script
DOMAIN="mcp.company.com"
EMAIL="devops@company.com"
WEBROOT="/var/www/html"

echo "🔒 Setting up SSL automation for $DOMAIN"

# Install certbot
if ! command -v certbot &> /dev/null; then
    echo "Installing certbot..."
    if [ -f /etc/debian_version ]; then
        apt-get update
        apt-get install -y certbot python3-certbot-nginx
    elif [ -f /etc/redhat-release ]; then
        yum install -y certbot python3-certbot-nginx
    fi
fi

# Create webroot directory
mkdir -p "$WEBROOT"
chown www-data:www-data "$WEBROOT"

# Initial Nginx configuration (HTTP only)
cat > /etc/nginx/sites-available/cctelegram << EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN api.$DOMAIN;
    
    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root $WEBROOT;
        try_files \$uri =404;
    }
    
    # Redirect to HTTPS (after SSL setup)
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/cctelegram /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Obtain SSL certificate
echo "Obtaining SSL certificate..."
certbot certonly \
    --webroot \
    --webroot-path="$WEBROOT" \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --domains "$DOMAIN,api.$DOMAIN"

# Generate strong DH parameters
if [ ! -f /etc/ssl/certs/dhparam.pem ]; then
    echo "Generating DH parameters..."
    openssl dhparam -out /etc/ssl/certs/dhparam.pem 2048
fi

# Create production Nginx configuration with SSL
cat > /etc/nginx/sites-available/cctelegram << EOF
# Rate limiting
limit_req_zone \$binary_remote_addr zone=api:10m rate=30r/m;
limit_req_zone \$binary_remote_addr zone=auth:10m rate=5r/m;

# Upstream servers
upstream mcp_backend {
    least_conn;
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN api.$DOMAIN;
    
    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root $WEBROOT;
        try_files \$uri =404;
    }
    
    # Redirect to HTTPS
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN api.$DOMAIN;
    
    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/$DOMAIN/chain.pem;
    
    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_dhparam /etc/ssl/certs/dhparam.pem;
    
    # SSL session cache
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_session_tickets off;
    
    # OCSP stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Logging
    access_log /var/log/nginx/cctelegram_access.log;
    error_log /var/log/nginx/cctelegram_error.log;
    
    # Health check
    location /health {
        proxy_pass http://mcp_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_send_timeout 10s;
        proxy_read_timeout 10s;
    }
    
    # Main application
    location / {
        limit_req zone=api burst=10 nodelay;
        limit_req_status 429;
        
        proxy_pass http://mcp_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Proxy timeouts
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Proxy buffering
        proxy_buffering on;
        proxy_buffer_size 8k;
        proxy_buffers 16 8k;
        proxy_busy_buffers_size 16k;
    }
}
EOF

# Test and reload Nginx
nginx -t && systemctl reload nginx

echo "✅ SSL configuration complete!"
```

### Auto-renewal Setup

```bash
# Create renewal script
cat > /usr/local/bin/renew-ssl.sh << 'EOF'
#!/bin/bash
set -euo pipefail

DOMAIN="mcp.company.com"
LOG_FILE="/var/log/certbot-renewal.log"

echo "$(date): Starting SSL renewal check" >> "$LOG_FILE"

# Renew certificates
certbot renew --quiet --no-self-upgrade >> "$LOG_FILE" 2>&1

# Check if certificate was renewed
if [ $? -eq 0 ]; then
    echo "$(date): Certificate renewal check completed" >> "$LOG_FILE"
    
    # Test Nginx configuration
    nginx -t >> "$LOG_FILE" 2>&1
    
    if [ $? -eq 0 ]; then
        # Reload Nginx
        systemctl reload nginx
        echo "$(date): Nginx reloaded after certificate renewal" >> "$LOG_FILE"
        
        # Send success notification
        if command -v curl &> /dev/null && [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
            curl -X POST -H 'Content-type: application/json' \
                --data '{"text":"✅ SSL certificate renewed successfully for '$DOMAIN'"}' \
                "$SLACK_WEBHOOK_URL"
        fi
    else
        echo "$(date): ERROR: Nginx configuration test failed" >> "$LOG_FILE"
        exit 1
    fi
else
    echo "$(date): Certificate renewal failed" >> "$LOG_FILE"
    exit 1
fi
EOF

chmod +x /usr/local/bin/renew-ssl.sh

# Add to crontab
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/renew-ssl.sh") | crontab -

# Add systemd timer (alternative to cron)
cat > /etc/systemd/system/certbot-renewal.service << 'EOF'
[Unit]
Description=Certbot Renewal Service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/renew-ssl.sh
User=root
EOF

cat > /etc/systemd/system/certbot-renewal.timer << 'EOF'
[Unit]
Description=Run certbot renewal twice daily
Requires=certbot-renewal.service

[Timer]
OnCalendar=*-*-* 02,14:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Enable and start timer
systemctl daemon-reload
systemctl enable certbot-renewal.timer
systemctl start certbot-renewal.timer
```

## Certificate Monitoring

### monitoring/ssl-checker.sh

```bash
#!/bin/bash
set -euo pipefail

# SSL certificate monitoring script
DOMAINS=("mcp.company.com" "api.mcp.company.com")
WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
WARNING_DAYS=30
CRITICAL_DAYS=7

check_certificate() {
    local domain="$1"
    local expiry_date
    local days_until_expiry
    
    # Get certificate expiry date
    expiry_date=$(echo | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null | \
                  openssl x509 -noout -dates | grep "notAfter" | cut -d= -f2)
    
    if [ -z "$expiry_date" ]; then
        echo "❌ Failed to get certificate for $domain"
        return 1
    fi
    
    # Calculate days until expiry
    expiry_timestamp=$(date -d "$expiry_date" +%s)
    current_timestamp=$(date +%s)
    days_until_expiry=$(( (expiry_timestamp - current_timestamp) / 86400 ))
    
    echo "🔒 $domain expires in $days_until_expiry days ($expiry_date)"
    
    # Send alerts
    if [ "$days_until_expiry" -lt "$CRITICAL_DAYS" ]; then
        send_alert "🚨 CRITICAL: SSL certificate for $domain expires in $days_until_expiry days!" "danger"
    elif [ "$days_until_expiry" -lt "$WARNING_DAYS" ]; then
        send_alert "⚠️ WARNING: SSL certificate for $domain expires in $days_until_expiry days" "warning"
    fi
    
    return 0
}

send_alert() {
    local message="$1"
    local color="${2:-warning}"
    
    if [ -n "$WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data '{
                "text": "'"$message"'",
                "attachments": [
                    {
                        "color": "'"$color"'",
                        "fields": [
                            {
                                "title": "Service",
                                "value": "CCTelegram MCP Server",
                                "short": true
                            },
                            {
                                "title": "Environment",
                                "value": "Production",
                                "short": true
                            }
                        ]
                    }
                ]
            }' \
            "$WEBHOOK_URL" > /dev/null 2>&1
    fi
    
    echo "$message"
}

# Check all domains
echo "🔍 Checking SSL certificates..."
for domain in "${DOMAINS[@]}"; do
    check_certificate "$domain"
done

echo "✅ SSL certificate check complete"
```

### Prometheus SSL Exporter

```yaml
# ssl-exporter.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ssl-exporter
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ssl-exporter
  template:
    metadata:
      labels:
        app: ssl-exporter
    spec:
      containers:
      - name: ssl-exporter
        image: ribbybibby/ssl-exporter:2.4.2
        ports:
        - containerPort: 9219
        args:
        - --config.file=/etc/ssl-exporter/config.yml
        volumeMounts:
        - name: config
          mountPath: /etc/ssl-exporter
      volumes:
      - name: config
        configMap:
          name: ssl-exporter-config

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ssl-exporter-config
  namespace: monitoring
data:
  config.yml: |
    modules:
      tcp_connect:
        prober: tcp
        timeout: 10s
        tcp:
          tls: true
      https_2xx:
        prober: https
        timeout: 10s
        https:
          preferred_ip_protocol: ip4
          tls_config:
            insecure_skip_verify: false

---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: ssl-exporter
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: ssl-exporter
  endpoints:
  - port: http
```

### Grafana SSL Dashboard

```json
{
  "dashboard": {
    "title": "SSL Certificate Monitoring",
    "panels": [
      {
        "title": "Certificate Expiry",
        "type": "stat",
        "targets": [
          {
            "expr": "(ssl_cert_not_after - time()) / 86400",
            "legendFormat": "{{instance}} days"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "days",
            "thresholds": {
              "steps": [
                {"color": "red", "value": 0},
                {"color": "yellow", "value": 7},
                {"color": "green", "value": 30}
              ]
            }
          }
        }
      }
    ]
  }
}
```

## Troubleshooting SSL Issues

### ssl-debug.sh

```bash
#!/bin/bash
set -euo pipefail

DOMAIN="mcp.company.com"

echo "🔍 SSL Configuration Debug for $DOMAIN"
echo "=" * 50

# Test SSL connection
echo "🔒 Testing SSL connection..."
if openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" -verify_return_error < /dev/null; then
    echo "✅ SSL connection successful"
else
    echo "❌ SSL connection failed"
fi

# Check certificate details
echo -e "\n🔒 Certificate Details:"
echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | \
    openssl x509 -noout -text | grep -E "(Subject|Issuer|Not Before|Not After|DNS)"

# Test certificate chain
echo -e "\n🔗 Certificate Chain:"
echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" -showcerts 2>/dev/null | \
    awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' | \
    openssl x509 -noout -subject -issuer

# Check OCSP response
echo -e "\n🔍 OCSP Stapling:"
echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" -status 2>/dev/null | \
    grep -A 5 "OCSP Response Status"

# Test TLS versions
echo -e "\n🔒 Supported TLS Versions:"
for version in ssl3 tls1 tls1_1 tls1_2 tls1_3; do
    if echo | timeout 3 openssl s_client -"$version" -connect "$DOMAIN:443" >/dev/null 2>&1; then
        echo "  ✅ $version supported"
    else
        echo "  ❌ $version not supported"
    fi
done

# Check cipher suites
echo -e "\n🔐 Cipher Suites:"
echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" -cipher ALL 2>/dev/null | \
    grep "Cipher    :"

echo -e "\n✅ SSL debug complete"
```

## Quick Commands Reference

```bash
# Kubernetes cert-manager
kubectl apply -f cluster-issuer.yaml
kubectl get certificates -A
kubectl describe certificate cctelegram-tls-cert

# Docker Compose Traefik
docker-compose -f traefik-docker-compose.yml up -d
docker logs cctelegram-traefik

# Certbot commands
certbot certificates
certbot renew --dry-run
certbot revoke --cert-path /etc/letsencrypt/live/domain/cert.pem

# SSL testing
./ssl-debug.sh
./ssl-checker.sh
openssl x509 -in /etc/letsencrypt/live/domain/cert.pem -noout -dates

# Certificate monitoring
systemctl status certbot-renewal.timer
journalctl -u certbot-renewal.service
```

This comprehensive SSL automation guide provides secure, automated certificate management for the CCTelegram MCP Server across different deployment environments.
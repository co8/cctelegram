# Kubernetes Deployment Guide

Production Kubernetes deployment for CCTelegram MCP Server.

## Namespace & ConfigMap

### namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cctelegram
  labels:
    app: cctelegram
    environment: production
```

### configmap.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cctelegram-config
  namespace: cctelegram
data:
  NODE_ENV: "production"
  MCP_LOG_LEVEL: "info"
  MCP_ENABLE_AUTH: "true"
  MCP_ENABLE_RATE_LIMIT: "true"
  MCP_ENABLE_INPUT_VALIDATION: "true"
  MCP_ENABLE_SECURE_LOGGING: "true"
  MCP_RATE_LIMIT_POINTS: "100"
  MCP_RATE_LIMIT_DURATION: "60"
  PROMETHEUS_ENABLED: "true"
  HEALTH_CHECK_ENABLED: "true"
  CC_TELEGRAM_EVENTS_DIR: "/app/data/events"
  CC_TELEGRAM_RESPONSES_DIR: "/app/data/responses"
```

## Secrets

### secrets.yaml

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cctelegram-secrets
  namespace: cctelegram
type: Opaque
data:
  # Base64 encoded values
  TELEGRAM_BOT_TOKEN: eW91ci10ZWxlZ3JhbS1ib3QtdG9rZW4=
  MCP_HMAC_SECRET: eW91ci1obWFjLXNlY3JldC1oZXJl
  MCP_API_KEYS: eyJ5b3VyLWFwaS1rZXktaGVyZSI6eyJuYW1lIjoiY2xhdWRlLXByb2R1Y3Rpb24iLCJwZXJtaXNzaW9ucyI6WyJzZW5kX3RlbGVncmFtX2V2ZW50Il0sImVuYWJsZWQiOnRydWV9fQ==

---
apiVersion: v1
kind: Secret
metadata:
  name: registry-secret
  namespace: cctelegram
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: eyJhdXRocyI6eyJnaGNyLmlvIjp7InVzZXJuYW1lIjoidG9rZW4iLCJwYXNzd29yZCI6ImdocF94eHgiLCJhdXRoIjoiZEdGclpXNDZaMmh3WDNoNGVBPT0ifX19
```

### Create secrets script

```bash
#!/bin/bash
# create-secrets.sh

kubectl create secret generic cctelegram-secrets \
  --from-literal=TELEGRAM_BOT_TOKEN="your-telegram-bot-token" \
  --from-literal=MCP_HMAC_SECRET="$(openssl rand -hex 32)" \
  --from-literal=MCP_API_KEYS='{"your-api-key": {"name": "claude-production", "permissions": ["send_telegram_event"], "enabled": true}}' \
  --namespace=cctelegram \
  --dry-run=client -o yaml > secrets.yaml
```

## Deployment

### deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cctelegram-mcp-server
  namespace: cctelegram
  labels:
    app: cctelegram-mcp-server
    version: v1.7.0
spec:
  replicas: 3
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
        version: v1.7.0
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      imagePullSecrets:
        - name: registry-secret
      
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        seccompProfile:
          type: RuntimeDefault
      
      containers:
      - name: mcp-server
        image: ghcr.io/your-org/cctelegram-mcp-server:v1.7.0
        imagePullPolicy: Always
        
        ports:
        - name: http
          containerPort: 3000
          protocol: TCP
        - name: metrics
          containerPort: 9090
          protocol: TCP
        
        envFrom:
        - configMapRef:
            name: cctelegram-config
        - secretRef:
            name: cctelegram-secrets
        
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "1"
        
        livenessProbe:
          httpGet:
            path: /health
            port: http
            httpHeaders:
            - name: X-Health-Check
              value: kubernetes
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        
        readinessProbe:
          httpGet:
            path: /health/ready
            port: http
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        
        startupProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 30
        
        volumeMounts:
        - name: data-volume
          mountPath: /app/data
        - name: logs-volume
          mountPath: /app/logs
        - name: tmp-volume
          mountPath: /tmp
        
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
            add:
            - NET_BIND_SERVICE
      
      volumes:
      - name: data-volume
        persistentVolumeClaim:
          claimName: cctelegram-data-pvc
      - name: logs-volume
        emptyDir:
          sizeLimit: 1Gi
      - name: tmp-volume
        emptyDir:
          sizeLimit: 100Mi
      
      terminationGracePeriodSeconds: 30
      
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - cctelegram-mcp-server
              topologyKey: kubernetes.io/hostname
```

## Services

### service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: cctelegram-mcp-service
  namespace: cctelegram
  labels:
    app: cctelegram-mcp-server
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3000"
spec:
  type: ClusterIP
  ports:
  - name: http
    port: 80
    targetPort: http
    protocol: TCP
  - name: metrics
    port: 9090
    targetPort: metrics
    protocol: TCP
  selector:
    app: cctelegram-mcp-server

---
apiVersion: v1
kind: Service
metadata:
  name: cctelegram-mcp-headless
  namespace: cctelegram
  labels:
    app: cctelegram-mcp-server
spec:
  type: ClusterIP
  clusterIP: None
  ports:
  - name: http
    port: 80
    targetPort: http
  selector:
    app: cctelegram-mcp-server
```

## Ingress

### ingress.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cctelegram-mcp-ingress
  namespace: cctelegram
  annotations:
    # Nginx ingress controller
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    
    # Rate limiting
    nginx.ingress.kubernetes.io/rate-limit-requests-per-minute: "100"
    nginx.ingress.kubernetes.io/rate-limit-connections: "10"
    
    # Security headers
    nginx.ingress.kubernetes.io/configuration-snippet: |
      add_header X-Frame-Options DENY;
      add_header X-Content-Type-Options nosniff;
      add_header X-XSS-Protection "1; mode=block";
      add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
    
    # Certificate management
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - mcp.company.com
    secretName: cctelegram-tls-secret
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
      - path: /metrics
        pathType: Prefix
        backend:
          service:
            name: cctelegram-mcp-service
            port:
              number: 9090
```

## Persistent Storage

### pvc.yaml

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cctelegram-data-pvc
  namespace: cctelegram
  labels:
    app: cctelegram-mcp-server
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 10Gi

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: cctelegram-data-pv
  labels:
    app: cctelegram-mcp-server
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: fast-ssd
  hostPath:
    path: /var/lib/cctelegram/data
```

## Auto-scaling

### hpa.yaml

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: cctelegram-mcp-hpa
  namespace: cctelegram
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: cctelegram-mcp-server
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
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "30"
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
      - type: Pods
        value: 2
        periodSeconds: 60
      selectPolicy: Max

---
apiVersion: autoscaling/v2
kind: VerticalPodAutoscaler
metadata:
  name: cctelegram-mcp-vpa
  namespace: cctelegram
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: cctelegram-mcp-server
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
    - containerName: mcp-server
      maxAllowed:
        cpu: 2
        memory: 4Gi
      minAllowed:
        cpu: 100m
        memory: 128Mi
```

## Network Policies

### network-policy.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: cctelegram-mcp-netpol
  namespace: cctelegram
spec:
  podSelector:
    matchLabels:
      app: cctelegram-mcp-server
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    - namespaceSelector:
        matchLabels:
          name: monitoring
    ports:
    - protocol: TCP
      port: 3000
    - protocol: TCP
      port: 9090
  egress:
  # Allow DNS
  - to: []
    ports:
    - protocol: UDP
      port: 53
  # Allow HTTPS to Telegram API
  - to: []
    ports:
    - protocol: TCP
      port: 443
  # Allow internal communication
  - to:
    - podSelector:
        matchLabels:
          app: cctelegram-bridge
    ports:
    - protocol: TCP
      port: 8080
```

## Pod Security Policy

### pod-security-policy.yaml

```yaml
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: cctelegram-psp
spec:
  privileged: false
  allowPrivilegeEscalation: false
  requiredDropCapabilities:
    - ALL
  allowedCapabilities:
    - NET_BIND_SERVICE
  volumes:
    - 'configMap'
    - 'emptyDir'
    - 'projected'
    - 'secret'
    - 'downwardAPI'
    - 'persistentVolumeClaim'
  hostNetwork: false
  hostIPC: false
  hostPID: false
  runAsUser:
    rule: 'MustRunAsNonRoot'
  supplementalGroups:
    rule: 'RunAsAny'
  fsGroup:
    rule: 'RunAsAny'
  seLinux:
    rule: 'RunAsAny'
```

## Monitoring & Observability

### service-monitor.yaml

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: cctelegram-mcp-monitor
  namespace: cctelegram
  labels:
    app: cctelegram-mcp-server
    release: prometheus
spec:
  selector:
    matchLabels:
      app: cctelegram-mcp-server
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
    honorLabels: true
```

### prometheus-rule.yaml

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: cctelegram-mcp-alerts
  namespace: cctelegram
  labels:
    app: cctelegram-mcp-server
    release: prometheus
spec:
  groups:
  - name: cctelegram.rules
    rules:
    - alert: CCTelegramMCPDown
      expr: up{job="cctelegram-mcp-service"} == 0
      for: 1m
      labels:
        severity: critical
      annotations:
        summary: "CCTelegram MCP Server is down"
        description: "{{ $labels.instance }} has been down for more than 1 minute"
    
    - alert: CCTelegramHighErrorRate
      expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
      for: 2m
      labels:
        severity: high
      annotations:
        summary: "High error rate detected"
        description: "Error rate is {{ $value }} errors per second"
    
    - alert: CCTelegramHighLatency
      expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High response latency"
        description: "95th percentile latency is {{ $value }} seconds"
```

## Deployment Scripts

### deploy.sh

```bash
#!/bin/bash
set -euo pipefail

NAMESPACE=${NAMESPACE:-cctelegram}
VERSION=${VERSION:-latest}
DRY_RUN=${DRY_RUN:-false}

echo "🚀 Deploying CCTelegram MCP Server v$VERSION to $NAMESPACE"

# Create namespace
kubectl apply -f namespace.yaml

# Apply configurations
kubectl apply -f configmap.yaml
kubectl apply -f secrets.yaml
kubectl apply -f pvc.yaml

# Wait for PVC to be bound
echo "⏳ Waiting for PVC to be ready..."
kubectl wait --for=condition=Bound pvc/cctelegram-data-pvc -n $NAMESPACE --timeout=60s

# Deploy application
if [ "$DRY_RUN" = "true" ]; then
    kubectl apply --dry-run=client -f deployment.yaml
else
    kubectl apply -f deployment.yaml
fi

# Deploy services and ingress
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml

# Deploy HPA
kubectl apply -f hpa.yaml

# Deploy monitoring
kubectl apply -f service-monitor.yaml
kubectl apply -f prometheus-rule.yaml

# Wait for rollout
echo "⏳ Waiting for deployment to complete..."
kubectl rollout status deployment/cctelegram-mcp-server -n $NAMESPACE --timeout=300s

# Verify deployment
echo "✅ Deployment complete! Checking health..."
kubectl get pods -n $NAMESPACE -l app=cctelegram-mcp-server
kubectl get services -n $NAMESPACE
kubectl get ingress -n $NAMESPACE

echo "🎉 CCTelegram MCP Server deployed successfully!"
```

### rollback.sh

```bash
#!/bin/bash
set -euo pipefail

NAMESPACE=${NAMESPACE:-cctelegram}

echo "🔄 Rolling back CCTelegram MCP Server deployment"

# Get rollout history
kubectl rollout history deployment/cctelegram-mcp-server -n $NAMESPACE

# Rollback to previous version
kubectl rollout undo deployment/cctelegram-mcp-server -n $NAMESPACE

# Wait for rollback to complete
kubectl rollout status deployment/cctelegram-mcp-server -n $NAMESPACE

echo "✅ Rollback complete!"
```

### health-check.sh

```bash
#!/bin/bash
set -euo pipefail

NAMESPACE=${NAMESPACE:-cctelegram}
INGRESS_HOST=${INGRESS_HOST:-mcp.company.com}

echo "🏥 Running health checks for CCTelegram MCP Server"

# Check pod status
echo "📊 Pod status:"
kubectl get pods -n $NAMESPACE -l app=cctelegram-mcp-server

# Check service endpoints
echo "🔗 Service endpoints:"
kubectl get endpoints -n $NAMESPACE cctelegram-mcp-service

# Test internal health endpoint
POD_NAME=$(kubectl get pods -n $NAMESPACE -l app=cctelegram-mcp-server -o jsonpath='{.items[0].metadata.name}')
echo "🔍 Testing internal health endpoint:"
kubectl exec -n $NAMESPACE $POD_NAME -- curl -f http://localhost:3000/health

# Test external endpoint (if ingress is configured)
if kubectl get ingress -n $NAMESPACE cctelegram-mcp-ingress &>/dev/null; then
    echo "🌐 Testing external endpoint:"
    curl -f https://$INGRESS_HOST/health
fi

echo "✅ Health checks completed!"
```

## Quick Start Commands

```bash
# Deploy everything
./deploy.sh

# Check status
kubectl get all -n cctelegram

# View logs
kubectl logs -f deployment/cctelegram-mcp-server -n cctelegram

# Scale deployment
kubectl scale deployment cctelegram-mcp-server --replicas=5 -n cctelegram

# Port forward for local testing
kubectl port-forward service/cctelegram-mcp-service 3000:80 -n cctelegram

# Execute command in pod
kubectl exec -it deployment/cctelegram-mcp-server -n cctelegram -- sh

# Update deployment
kubectl set image deployment/cctelegram-mcp-server mcp-server=ghcr.io/your-org/cctelegram-mcp-server:v1.6.1 -n cctelegram

# Clean up
kubectl delete namespace cctelegram
```
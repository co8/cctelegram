# Helm Chart Guide

Production Helm chart for CCTelegram MCP Server deployment.

## Chart Structure

```
helm/cctelegram/
├── Chart.yaml
├── values.yaml
├── values-production.yaml
├── values-staging.yaml
├── templates/
│   ├── NOTES.txt
│   ├── _helpers.tpl
│   ├── configmap.yaml
│   ├── deployment.yaml
│   ├── hpa.yaml
│   ├── ingress.yaml
│   ├── pdb.yaml
│   ├── secret.yaml
│   ├── service.yaml
│   ├── servicemonitor.yaml
│   └── tests/
│       └── test-connection.yaml
└── crds/
```

## Chart.yaml

```yaml
apiVersion: v2
name: cctelegram
description: CCTelegram MCP Server Helm Chart
type: application
version: 1.6.0
appVersion: "1.6.0"
keywords:
  - mcp
  - telegram
  - bridge
  - claude
home: https://github.com/your-org/cctelegram
sources:
  - https://github.com/your-org/cctelegram
maintainers:
  - name: DevOps Team
    email: devops@company.com
dependencies:
  - name: postgresql
    version: 12.1.9
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
  - name: redis
    version: 17.3.7  
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
annotations:
  category: Infrastructure
```

## values.yaml

```yaml
# Default values for cctelegram
replicaCount: 3

image:
  repository: ghcr.io/your-org/cctelegram-mcp-server
  pullPolicy: IfNotPresent
  tag: "1.6.0"

imagePullSecrets:
  - name: registry-secret

nameOverride: ""
fullnameOverride: ""

# Service account
serviceAccount:
  create: true
  annotations: {}
  name: ""

# Pod annotations
podAnnotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "3000"
  prometheus.io/path: "/metrics"

# Pod security context
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1001
  runAsGroup: 1001
  fsGroup: 1001
  seccompProfile:
    type: RuntimeDefault

# Container security context
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
    - ALL
    add:
    - NET_BIND_SERVICE

# Application configuration
config:
  nodeEnv: production
  logLevel: info
  enableAuth: true
  enableRateLimit: true
  enableInputValidation: true
  enableSecureLogging: true
  rateLimitPoints: 100
  rateLimitDuration: 60
  prometheusEnabled: true
  healthCheckEnabled: true

# Secrets
secrets:
  telegramBotToken: ""
  mcpHmacSecret: ""
  mcpApiKeys: {}

# Service configuration
service:
  type: ClusterIP
  port: 80
  targetPort: http
  annotations: {}

# Ingress configuration
ingress:
  enabled: true
  className: "nginx"
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/rate-limit-requests-per-minute: "100"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: mcp.company.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: cctelegram-tls
      hosts:
        - mcp.company.com

# Resource limits
resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 256Mi

# Auto-scaling
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80
  # Custom metrics
  customMetrics:
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "30"

# Pod disruption budget
podDisruptionBudget:
  enabled: true
  minAvailable: 2

# Node selection
nodeSelector: {}

tolerations: []

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
              - key: app.kubernetes.io/name
                operator: In
                values:
                  - cctelegram
          topologyKey: kubernetes.io/hostname

# Persistence
persistence:
  enabled: true
  storageClass: "fast-ssd"
  accessMode: ReadWriteOnce
  size: 10Gi
  annotations: {}

# Monitoring
monitoring:
  serviceMonitor:
    enabled: true
    additionalLabels:
      release: prometheus
    interval: 30s
    scrapeTimeout: 10s
  prometheusRule:
    enabled: true
    additionalLabels:
      release: prometheus
    rules:
      - alert: CCTelegramMCPDown
        expr: up{job="cctelegram"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "CCTelegram MCP Server is down"

# Probes
livenessProbe:
  httpGet:
    path: /health
    port: http
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

# Network policy
networkPolicy:
  enabled: true
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
  egress:
    - to: []
      ports:
        - protocol: UDP
          port: 53
    - to: []
      ports:
        - protocol: TCP
          port: 443

# Dependencies
postgresql:
  enabled: false
  auth:
    postgresPassword: ""
    username: cctelegram
    password: ""
    database: cctelegram

redis:
  enabled: false
  auth:
    enabled: true
    password: ""
```

## values-production.yaml

```yaml
# Production overrides
replicaCount: 5

image:
  pullPolicy: Always
  tag: "1.6.0"

config:
  logLevel: warn
  enableAuth: true
  enableRateLimit: true

resources:
  limits:
    cpu: 2000m
    memory: 4Gi
  requests:
    cpu: 500m
    memory: 512Mi

autoscaling:
  enabled: true
  minReplicas: 5
  maxReplicas: 50
  targetCPUUtilizationPercentage: 60
  targetMemoryUtilizationPercentage: 70

persistence:
  size: 50Gi
  storageClass: "premium-ssd"

ingress:
  hosts:
    - host: mcp.company.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: cctelegram-prod-tls
      hosts:
        - mcp.company.com

monitoring:
  serviceMonitor:
    enabled: true
    interval: 15s
  prometheusRule:
    enabled: true

postgresql:
  enabled: true
  auth:
    postgresPassword: "secure-postgres-password"
    username: cctelegram
    password: "secure-app-password"
    database: cctelegram
  primary:
    resources:
      requests:
        memory: 256Mi
        cpu: 250m
      limits:
        memory: 1Gi
        cpu: 1000m

redis:
  enabled: true
  auth:
    enabled: true
    password: "secure-redis-password"
  master:
    resources:
      requests:
        memory: 256Mi
        cpu: 250m
      limits:
        memory: 512Mi
        cpu: 500m
```

## Template Files

### templates/_helpers.tpl

```yaml
{{/*
Expand the name of the chart.
*/}}
{{- define "cctelegram.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "cctelegram.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "cctelegram.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "cctelegram.labels" -}}
helm.sh/chart: {{ include "cctelegram.chart" . }}
{{ include "cctelegram.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "cctelegram.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cctelegram.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "cctelegram.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "cctelegram.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
```

### templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "cctelegram.fullname" . }}
  labels:
    {{- include "cctelegram.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      {{- include "cctelegram.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
        {{- with .Values.podAnnotations }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      labels:
        {{- include "cctelegram.selectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "cctelegram.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: {{ .Chart.Name }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
            - name: metrics
              containerPort: 9090
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ include "cctelegram.fullname" . }}-config
            - secretRef:
                name: {{ include "cctelegram.fullname" . }}-secret
          {{- with .Values.livenessProbe }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.readinessProbe }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.startupProbe }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          volumeMounts:
            {{- if .Values.persistence.enabled }}
            - name: data
              mountPath: /app/data
            {{- end }}
            - name: logs
              mountPath: /app/logs
            - name: tmp
              mountPath: /tmp
      volumes:
        {{- if .Values.persistence.enabled }}
        - name: data
          persistentVolumeClaim:
            claimName: {{ include "cctelegram.fullname" . }}-data
        {{- end }}
        - name: logs
          emptyDir:
            sizeLimit: 1Gi
        - name: tmp
          emptyDir:
            sizeLimit: 100Mi
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

### templates/hpa.yaml

```yaml
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "cctelegram.fullname" . }}
  labels:
    {{- include "cctelegram.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "cctelegram.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
    {{- with .Values.autoscaling.customMetrics }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
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
      selectPolicy: Max
{{- end }}
```

### templates/NOTES.txt

```txt
1. Get the application URL by running these commands:
{{- if .Values.ingress.enabled }}
{{- range $host := .Values.ingress.hosts }}
  {{- range .paths }}
  http{{ if $.Values.ingress.tls }}s{{ end }}://{{ $host.host }}{{ .path }}
  {{- end }}
{{- end }}
{{- else if contains "NodePort" .Values.service.type }}
  export NODE_PORT=$(kubectl get --namespace {{ .Release.Namespace }} -o jsonpath="{.spec.ports[0].nodePort}" services {{ include "cctelegram.fullname" . }})
  export NODE_IP=$(kubectl get nodes --namespace {{ .Release.Namespace }} -o jsonpath="{.items[0].status.addresses[0].address}")
  echo http://$NODE_IP:$NODE_PORT
{{- else if contains "LoadBalancer" .Values.service.type }}
     NOTE: It may take a few minutes for the LoadBalancer IP to be available.
           You can watch the status of by running 'kubectl get --namespace {{ .Release.Namespace }} svc -w {{ include "cctelegram.fullname" . }}'
  export SERVICE_IP=$(kubectl get svc --namespace {{ .Release.Namespace }} {{ include "cctelegram.fullname" . }} --template "{{"{{ range (index .status.loadBalancer.ingress 0) }}{{.}}{{ end }}"}}")
  echo http://$SERVICE_IP:{{ .Values.service.port }}
{{- else if contains "ClusterIP" .Values.service.type }}
  export POD_NAME=$(kubectl get pods --namespace {{ .Release.Namespace }} -l "{{- include "cctelegram.selectorLabels" . | replace ": " "=" | replace "\n" "," }}" -o jsonpath="{.items[0].metadata.name}")
  export CONTAINER_PORT=$(kubectl get pod --namespace {{ .Release.Namespace }} $POD_NAME -o jsonpath="{.spec.containers[0].ports[0].containerPort}")
  echo "Visit http://127.0.0.1:8080 to use your application"
  kubectl --namespace {{ .Release.Namespace }} port-forward $POD_NAME 8080:$CONTAINER_PORT
{{- end }}

2. Check the status of your deployment:
  kubectl --namespace {{ .Release.Namespace }} get deployments {{ include "cctelegram.fullname" . }}
  kubectl --namespace {{ .Release.Namespace }} get pods -l "{{- include "cctelegram.selectorLabels" . | replace ": " "=" | replace "\n" "," }}"

3. View logs:
  kubectl --namespace {{ .Release.Namespace }} logs -f deployment/{{ include "cctelegram.fullname" . }}

4. Test health endpoint:
  kubectl --namespace {{ .Release.Namespace }} exec deployment/{{ include "cctelegram.fullname" . }} -- curl -f http://localhost:3000/health

{{- if .Values.monitoring.serviceMonitor.enabled }}

5. Access monitoring:
  - Prometheus metrics: {{ .Values.ingress.hosts | first | default "localhost" }}/metrics
  - Grafana dashboards: Check your Grafana installation for CCTelegram dashboards
{{- end }}
```

## Deployment Commands

### Install Chart

```bash
# Add Helm repository
helm repo add cctelegram https://charts.company.com/cctelegram
helm repo update

# Install with default values
helm install cctelegram cctelegram/cctelegram

# Install with custom values
helm install cctelegram cctelegram/cctelegram \
  --values values-production.yaml \
  --namespace cctelegram \
  --create-namespace

# Install with inline values
helm install cctelegram cctelegram/cctelegram \
  --set image.tag=1.6.1 \
  --set replicaCount=5 \
  --set ingress.hosts[0].host=mcp.mycompany.com \
  --namespace cctelegram \
  --create-namespace
```

### Upgrade Chart

```bash
# Upgrade with new values
helm upgrade cctelegram cctelegram/cctelegram \
  --values values-production.yaml \
  --namespace cctelegram

# Upgrade to specific version
helm upgrade cctelegram cctelegram/cctelegram \
  --version 1.6.1 \
  --namespace cctelegram

# Upgrade with rollback on failure
helm upgrade cctelegram cctelegram/cctelegram \
  --values values-production.yaml \
  --namespace cctelegram \
  --atomic \
  --timeout 10m
```

### Chart Management

```bash
# List releases
helm list -A

# Get release status
helm status cctelegram -n cctelegram

# Get release values
helm get values cctelegram -n cctelegram

# Rollback to previous version
helm rollback cctelegram 1 -n cctelegram

# Uninstall release
helm uninstall cctelegram -n cctelegram
```

## Development & Testing

### Lint Chart

```bash
# Lint chart
helm lint helm/cctelegram

# Template and validate
helm template cctelegram helm/cctelegram \
  --values helm/cctelegram/values-production.yaml \
  --validate

# Dry run install
helm install cctelegram helm/cctelegram \
  --dry-run \
  --debug \
  --values values-production.yaml
```

### Test Chart

```bash
# Run chart tests
helm test cctelegram -n cctelegram

# Template with debug
helm template cctelegram helm/cctelegram \
  --debug \
  --values values-production.yaml > rendered.yaml

# Package chart
helm package helm/cctelegram

# Verify package
helm verify cctelegram-1.6.0.tgz
```

### templates/tests/test-connection.yaml

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: "{{ include "cctelegram.fullname" . }}-test-connection"
  labels:
    {{- include "cctelegram.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-weight": "1"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  restartPolicy: Never
  containers:
    - name: curl
      image: curlimages/curl:7.85.0
      command: ['curl']
      args:
        - '--fail'
        - '--max-time'
        - '30'
        - 'http://{{ include "cctelegram.fullname" . }}.{{ .Release.Namespace }}.svc.cluster.local/health'
```

## Advanced Configuration

### Multi-Environment Values

```yaml
# values-staging.yaml
replicaCount: 2
ingress:
  hosts:
    - host: mcp-staging.company.com
config:
  logLevel: debug
resources:
  requests:
    cpu: 100m
    memory: 128Mi
```

### Secret Management

```bash
# Using sealed secrets
echo -n 'my-telegram-token' | kubectl create secret generic telegram-secret \
  --dry-run=client --from-file=token=/dev/stdin -o yaml | \
  kubeseal -o yaml > sealed-telegram-secret.yaml

# Using external secrets operator
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-backend
spec:
  provider:
    vault:
      server: "https://vault.company.com"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "cctelegram"
```

### Custom Resource Definitions

```yaml
# crds/cctelegramconfig.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: cctelegramconfigs.cctelegram.company.com
spec:
  group: cctelegram.company.com
  versions:
  - name: v1
    served: true
    storage: true
    schema:
      openAPIV3Schema:
        type: object
        properties:
          spec:
            type: object
            properties:
              telegramBotToken:
                type: string
              rateLimiting:
                type: object
  scope: Namespaced
  names:
    plural: cctelegramconfigs
    singular: cctelegramconfig
    kind: CCTelegramConfig
```

This comprehensive Helm chart provides production-ready deployment with configurable values, monitoring, scaling, and security features for the CCTelegram MCP Server.
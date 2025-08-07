# CCTelegram MCP Server System Overview

**Detailed technical architecture and system design for CCTelegram MCP Server**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6?style=for-the-badge&logo=typescript)](../README.md) [![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs)](../README.md) [![MCP Protocol](https://img.shields.io/badge/MCP%20Protocol-Compatible-7209B7?style=for-the-badge&logo=protocol)](https://spec.modelcontextprotocol.io/)

---

## 🏗️ System Architecture Overview

The CCTelegram MCP Server is a TypeScript-based Node.js application that implements the Model Context Protocol (MCP) specification to provide seamless integration between Claude Code and the CCTelegram notification system.

```mermaid
graph TB
    subgraph "External Interface"
        CC[Claude Code IDE]
        DEV[Developer]
    end
    
    subgraph "MCP Server Core" {#mcp-core}
        PROTOCOL[MCP Protocol Handler]
        REGISTRY[Tool Registry]
        VALIDATOR[Input Validator]
        SERIALIZER[Data Serializer]
    end
    
    subgraph "Tool Framework" {#tool-framework}
        EVENT_TOOLS[Event Tools]
        BRIDGE_TOOLS[Bridge Management]
        RESPONSE_TOOLS[Response Tools]
        STATUS_TOOLS[Status Tools]
    end
    
    subgraph "Processing Layer"
        EVENT_PROC[Event Processor]
        FILE_HANDLER[File Handler]
        RESPONSE_PROC[Response Processor]
        HEALTH_MON[Health Monitor]
    end
    
    subgraph "Bridge Communication"
        FILE_SYS[File System Interface]
        EVENT_FILES[Event Files]
        RESPONSE_FILES[Response Files]
        STATUS_FILES[Status Files]
    end
    
    DEV --> CC
    CC -->|MCP Protocol| PROTOCOL
    PROTOCOL --> REGISTRY
    REGISTRY --> EVENT_TOOLS
    REGISTRY --> BRIDGE_TOOLS
    REGISTRY --> RESPONSE_TOOLS
    REGISTRY --> STATUS_TOOLS
    
    EVENT_TOOLS --> VALIDATOR
    VALIDATOR --> SERIALIZER
    SERIALIZER --> EVENT_PROC
    EVENT_PROC --> FILE_HANDLER
    
    FILE_HANDLER --> FILE_SYS
    FILE_SYS --> EVENT_FILES
    FILE_SYS --> RESPONSE_FILES
    FILE_SYS --> STATUS_FILES
    
    RESPONSE_TOOLS --> RESPONSE_PROC
    STATUS_TOOLS --> HEALTH_MON
    
    style CC fill:#FF8C42,color:#fff
    style PROTOCOL fill:#2da199,color:#fff
    style EVENT_TOOLS fill:#E6522C,color:#fff
    style FILE_SYS fill:#26A5E4,color:#fff
```

---

## 🔌 MCP Core Components

### **MCP Protocol Handler** {#mcp-core}

The core MCP implementation that handles protocol compliance and communication with Claude Code.

```typescript
interface MCPProtocolHandler {
  // Protocol version and capabilities
  version: string
  capabilities: MCPCapabilities
  
  // Connection management
  connect(): Promise<void>
  disconnect(): Promise<void>
  
  // Tool registration and discovery
  registerTool(tool: MCPTool): void
  getTools(): MCPTool[]
  
  // Request handling
  handleRequest(request: MCPRequest): Promise<MCPResponse>
  
  // Error handling
  handleError(error: Error): MCPErrorResponse
}

class MCPServer implements MCPProtocolHandler {
  private tools: Map<string, MCPTool> = new Map()
  private validator: InputValidator
  private serializer: DataSerializer
  
  constructor(config: MCPServerConfig) {
    this.validator = new InputValidator(config.validation)
    this.serializer = new DataSerializer(config.serialization)
  }
  
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    // Validate request
    const validation = await this.validator.validate(request)
    if (!validation.valid) {
      return this.handleError(new ValidationError(validation.errors))
    }
    
    // Execute tool
    const tool = this.tools.get(request.method)
    if (!tool) {
      return this.handleError(new ToolNotFoundError(request.method))
    }
    
    const result = await tool.execute(request.params)
    return this.serializer.serialize(result)
  }
}
```

### **Tool Registry & Framework** {#tool-framework}

Modular tool architecture with consistent interfaces and automatic registration.

```typescript
interface MCPTool {
  name: string
  description: string
  inputSchema: JSONSchema7
  handler: ToolHandler
  category: ToolCategory
  validation?: CustomValidation
}

enum ToolCategory {
  EVENTS = 'events',
  BRIDGE = 'bridge', 
  RESPONSES = 'responses',
  STATUS = 'status'
}

class ToolRegistry {
  private tools: Map<string, MCPTool> = new Map()
  private categories: Map<ToolCategory, Set<string>> = new Map()
  
  register(tool: MCPTool): void {
    // Validate tool structure
    this.validateTool(tool)
    
    // Register tool
    this.tools.set(tool.name, tool)
    
    // Categorize tool
    if (!this.categories.has(tool.category)) {
      this.categories.set(tool.category, new Set())
    }
    this.categories.get(tool.category)!.add(tool.name)
  }
  
  getByCategory(category: ToolCategory): MCPTool[] {
    const toolNames = this.categories.get(category) || new Set()
    return Array.from(toolNames).map(name => this.tools.get(name)!)
  }
}
```

---

## 📊 Event Processing System

### **Event Validation Framework** {#event-validation}

Comprehensive multi-layer validation system with schema, business logic, and security validation.

```typescript
interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings?: ValidationWarning[]
  sanitized?: any
}

class EventValidator {
  private schemaValidator: JSONSchemaValidator
  private businessValidator: BusinessRuleValidator
  private securityValidator: SecurityValidator
  
  async validate(event: any): Promise<ValidationResult> {
    // Layer 1: Schema validation
    const schemaResult = await this.schemaValidator.validate(event)
    if (!schemaResult.valid) {
      return schemaResult
    }
    
    // Layer 2: Business rule validation
    const businessResult = await this.businessValidator.validate(event)
    if (!businessResult.valid) {
      return businessResult
    }
    
    // Layer 3: Security validation
    const securityResult = await this.securityValidator.validate(event)
    if (!securityResult.valid) {
      return securityResult
    }
    
    return {
      valid: true,
      errors: [],
      sanitized: securityResult.sanitized
    }
  }
}

// 14 ValidationError types for comprehensive error handling
enum ValidationErrorType {
  SCHEMA_VIOLATION = 'schema_violation',
  MISSING_REQUIRED_FIELD = 'missing_required_field',
  INVALID_FIELD_TYPE = 'invalid_field_type',
  FIELD_LENGTH_EXCEEDED = 'field_length_exceeded',
  INVALID_ENUM_VALUE = 'invalid_enum_value',
  INVALID_UUID_FORMAT = 'invalid_uuid_format',
  INVALID_TIMESTAMP_FORMAT = 'invalid_timestamp_format',
  BUSINESS_RULE_VIOLATION = 'business_rule_violation',
  SECURITY_VIOLATION = 'security_violation',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  DUPLICATE_EVENT = 'duplicate_event',
  INVALID_EVENT_TYPE = 'invalid_event_type',
  CONTENT_TOO_LARGE = 'content_too_large',
  FORBIDDEN_CONTENT = 'forbidden_content'
}
```

### **Event Serialization & Optimization** {#event-serialization}

High-performance serialization with 86.3% payload reduction and forward compatibility.

```typescript
interface SerializationConfig {
  omitNullFields: boolean      // 86.3% payload reduction
  fieldNaming: 'snake_case'    // Consistent JSON naming
  forwardCompatibility: boolean // Unknown field handling
  compressionEnabled: boolean   // Additional compression
}

class EventSerializer {
  private config: SerializationConfig
  
  constructor(config: SerializationConfig) {
    this.config = config
  }
  
  serialize(event: Event): string {
    let processed = event
    
    // Remove null/undefined fields for payload optimization
    if (this.config.omitNullFields) {
      processed = this.omitNullFields(processed)
    }
    
    // Convert field names to snake_case
    if (this.config.fieldNaming === 'snake_case') {
      processed = this.toSnakeCase(processed)
    }
    
    // Apply compression if enabled
    if (this.config.compressionEnabled) {
      return this.compress(JSON.stringify(processed))
    }
    
    return JSON.stringify(processed)
  }
  
  deserialize(data: string): Event {
    let parsed = JSON.parse(data)
    
    // Handle unknown fields for forward compatibility
    if (this.config.forwardCompatibility) {
      parsed = this.handleUnknownFields(parsed)
    }
    
    return parsed
  }
  
  private omitNullFields(obj: any): any {
    if (obj === null || obj === undefined) return undefined
    if (typeof obj !== 'object') return obj
    
    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      const processed = this.omitNullFields(value)
      if (processed !== undefined) {
        result[key] = processed
      }
    }
    return result
  }
}

// Serialization performance benchmarks
interface SerializationBenchmarks {
  averageSerializationTime: '72.82μs'
  averageDeserializationTime: '60.549μs'
  payloadReduction: '86.3%'
  throughput: '10,000+ events/second'
}
```

### **Event Type System** {#event-types}

Comprehensive event type system supporting 44+ structured event types with validation.

```typescript
// Base event interface
interface BaseEvent {
  type: EventType
  title: string
  description: string
  source?: string
  timestamp?: string
  task_id?: string
  data?: Record<string, any>
}

// Event type enumeration (44+ types)
enum EventType {
  // Task Management (5 types)
  TASK_STARTED = 'task_started',
  TASK_PROGRESS = 'task_progress', 
  TASK_COMPLETION = 'task_completion',
  TASK_FAILED = 'task_failed',
  TASK_CANCELLED = 'task_cancelled',
  
  // Code Development (6 types)
  CODE_GENERATION = 'code_generation',
  CODE_ANALYSIS = 'code_analysis',
  CODE_REFACTORING = 'code_refactoring',
  CODE_REVIEW = 'code_review',
  CODE_TESTING = 'code_testing',
  CODE_DEPLOYMENT = 'code_deployment',
  
  // File System (5 types)
  FILE_CREATED = 'file_created',
  FILE_MODIFIED = 'file_modified',
  FILE_DELETED = 'file_deleted',
  FILE_MOVED = 'file_moved',
  FILE_PERMISSIONS_CHANGED = 'file_permissions_changed',
  
  // Build & Development (8 types)
  BUILD_STARTED = 'build_started',
  BUILD_COMPLETED = 'build_completed',
  BUILD_FAILED = 'build_failed',
  DEPLOYMENT_STARTED = 'deployment_started',
  DEPLOYMENT_COMPLETED = 'deployment_completed',
  DEPLOYMENT_FAILED = 'deployment_failed',
  TEST_SUITE_RUN = 'test_suite_run',
  LINT_CHECK = 'lint_check',
  
  // System Monitoring (5 types)
  PERFORMANCE_ALERT = 'performance_alert',
  ERROR_OCCURRED = 'error_occurred', 
  SYSTEM_HEALTH = 'system_health',
  
  // User Interaction (3 types)
  APPROVAL_REQUEST = 'approval_request',
  USER_RESPONSE = 'user_response',
  
  // Notifications (4 types)
  INFO_NOTIFICATION = 'info_notification',
  ALERT_NOTIFICATION = 'alert_notification',
  PROGRESS_UPDATE = 'progress_update',
  
  // Git & Version Control (7 types)
  GIT_COMMIT = 'git_commit',
  GIT_PUSH = 'git_push',
  GIT_PULL = 'git_pull',
  GIT_BRANCH_CREATED = 'git_branch_created',
  GIT_BRANCH_DELETED = 'git_branch_deleted',
  GIT_MERGE = 'git_merge',
  GIT_TAG = 'git_tag'
}

// Type-specific event interfaces
interface TaskCompletionEvent extends BaseEvent {
  type: EventType.TASK_COMPLETION
  duration_ms?: number
  files_affected?: string[]
  results?: string
}

interface PerformanceAlertEvent extends BaseEvent {
  type: EventType.PERFORMANCE_ALERT
  current_value: number
  threshold: number
  severity: 'low' | 'medium' | 'high' | 'critical'
}
```

---

## 🔄 Communication Architecture

### **File System Interface** {#file-interface}

High-performance file-based communication layer with atomic operations and monitoring.

```typescript
interface FileSystemInterface {
  // Directory configuration
  eventDirectory: string       // ~/.cc_telegram/events/
  responseDirectory: string    // ~/.cc_telegram/responses/
  statusDirectory: string      // ~/.cc_telegram/status/
  
  // File operations
  writeEvent(event: Event): Promise<string>
  readResponse(responseId: string): Promise<Response>
  getStatus(): Promise<SystemStatus>
  cleanup(maxAge: number): Promise<number>
}

class FileSystemManager implements FileSystemInterface {
  private eventDir: string
  private responseDir: string
  private statusDir: string
  
  constructor(config: FileSystemConfig) {
    this.eventDir = path.resolve(config.eventDirectory)
    this.responseDir = path.resolve(config.responseDirectory)
    this.statusDir = path.resolve(config.statusDirectory)
    
    // Ensure directories exist
    this.ensureDirectories()
  }
  
  async writeEvent(event: Event): Promise<string> {
    const filename = this.generateFilename(event)
    const filepath = path.join(this.eventDir, filename)
    
    // Atomic write operation
    const tempPath = filepath + '.tmp'
    await fs.writeFile(tempPath, JSON.stringify(event), 'utf8')
    await fs.rename(tempPath, filepath)
    
    return filename
  }
  
  private generateFilename(event: Event): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const uuid = crypto.randomUUID()
    return `${timestamp}-${uuid}.json`
  }
}
```

### **Bridge Coordination** {#bridge-coordination}

Seamless coordination with Rust Bridge component through file-based protocols.

```typescript
interface BridgeCoordination {
  // Process management
  checkBridgeProcess(): Promise<ProcessStatus>
  startBridge(): Promise<boolean>
  stopBridge(): Promise<boolean>
  restartBridge(): Promise<boolean>
  
  // Communication
  sendEvent(event: Event): Promise<void>
  getResponse(eventId: string): Promise<Response | null>
  
  // Health monitoring
  getHealth(): Promise<BridgeHealth>
  ping(): Promise<boolean>
}

class BridgeManager implements BridgeCoordination {
  private processMonitor: ProcessMonitor
  private fileInterface: FileSystemInterface
  private healthChecker: HealthChecker
  
  async checkBridgeProcess(): Promise<ProcessStatus> {
    const pid = await this.processMonitor.findProcess('cctelegram-bridge')
    
    if (!pid) {
      return { status: 'not_running', pid: null }
    }
    
    const health = await this.ping()
    return {
      status: health ? 'running' : 'unhealthy',
      pid,
      memory_usage: await this.getMemoryUsage(pid),
      cpu_usage: await this.getCpuUsage(pid)
    }
  }
  
  async ping(): Promise<boolean> {
    try {
      const testEvent = {
        type: 'system_health',
        title: 'Health Check',
        description: 'MCP Server health check'
      }
      
      await this.fileInterface.writeEvent(testEvent)
      return true
    } catch (error) {
      return false
    }
  }
}
```

---

## 🔐 Security Architecture

### **Input Validation & Sanitization**

Multi-layer security validation with XSS prevention and injection protection.

```typescript
class SecurityValidator {
  private xssProtection: XSSProtection
  private injectionProtection: InjectionProtection
  private contentFilter: ContentFilter
  
  async validate(input: any): Promise<ValidationResult> {
    // XSS protection
    const xssResult = this.xssProtection.sanitize(input)
    if (!xssResult.safe) {
      return { valid: false, errors: [xssResult.error] }
    }
    
    // Injection protection
    const injectionResult = this.injectionProtection.validate(xssResult.sanitized)
    if (!injectionResult.safe) {
      return { valid: false, errors: [injectionResult.error] }
    }
    
    // Content filtering
    const contentResult = this.contentFilter.filter(injectionResult.sanitized)
    
    return {
      valid: true,
      errors: [],
      sanitized: contentResult.filtered
    }
  }
}
```

### **Audit Logging & Monitoring**

Comprehensive security event logging with sanitization and retention policies.

```typescript
interface AuditLog {
  timestamp: string
  eventType: SecurityEventType
  severity: SecuritySeverity
  source: string
  sanitizedData: any
  userId?: string
  ipAddress?: string
  userAgent?: string
}

class SecurityAuditor {
  private logger: SecureLogger
  
  logSecurityEvent(event: SecurityEvent): void {
    const auditEntry: AuditLog = {
      timestamp: new Date().toISOString(),
      eventType: event.type,
      severity: event.severity,
      source: event.source,
      sanitizedData: this.sanitizeForLogging(event.data),
      userId: event.userId,
      ipAddress: this.maskIP(event.ipAddress),
      userAgent: this.sanitizeUserAgent(event.userAgent)
    }
    
    this.logger.logSecure(auditEntry)
  }
}
```

---

## 📈 Performance Optimization

### **Performance Monitoring & Optimization**

Built-in performance monitoring with optimization strategies and benchmarking.

```typescript
interface PerformanceMetrics {
  responseTime: {
    average: number
    p95: number
    p99: number
  }
  
  throughput: {
    eventsPerSecond: number
    requestsPerMinute: number
  }
  
  resources: {
    memoryUsageMB: number
    cpuUsagePercent: number
    fileDescriptors: number
  }
  
  errors: {
    errorRate: number
    errorsByType: Map<string, number>
  }
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics
  private benchmarks: BenchmarkCollector
  
  async collectMetrics(): Promise<PerformanceMetrics> {
    return {
      responseTime: await this.measureResponseTimes(),
      throughput: await this.measureThroughput(),
      resources: await this.measureResourceUsage(),
      errors: await this.collectErrorMetrics()
    }
  }
  
  async runBenchmarks(): Promise<BenchmarkResults> {
    return {
      serialization: await this.benchmarks.serializationBenchmark(),
      validation: await this.benchmarks.validationBenchmark(),
      fileIO: await this.benchmarks.fileIOBenchmark(),
      endToEnd: await this.benchmarks.endToEndBenchmark()
    }
  }
}
```

---

## 🔧 Configuration Management

### **Environment Configuration**

Comprehensive configuration management with validation and hot reloading.

```typescript
interface MCPServerConfiguration {
  // Core settings
  server: {
    port: number
    host: string
    timeout: number
    maxConnections: number
  }
  
  // File system configuration
  filesystem: {
    eventDirectory: string
    responseDirectory: string
    statusDirectory: string
    cleanupInterval: number
    maxFileAge: number
  }
  
  // Performance settings
  performance: {
    cacheEnabled: boolean
    cacheTTL: number
    maxConcurrentOperations: number
    compressionEnabled: boolean
  }
  
  // Security configuration
  security: {
    validationEnabled: boolean
    sanitizationLevel: 'strict' | 'moderate' | 'permissive'
    auditLogging: boolean
    rateLimitEnabled: boolean
    maxRequestSize: number
  }
  
  // Monitoring settings
  monitoring: {
    metricsEnabled: boolean
    healthCheckInterval: number
    performanceLogging: boolean
    alertThresholds: AlertThresholds
  }
}
```

---

## 🔗 Integration Points

### **External System Integration**

Integration patterns and protocols for external system connectivity.

```typescript
interface ExternalIntegration {
  // Claude Code integration
  claudeCode: {
    mcpProtocolVersion: string
    toolCapabilities: ToolCapability[]
    connectionTimeout: number
  }
  
  // Bridge integration
  bridge: {
    communicationProtocol: 'file-system'
    eventDirectory: string
    responseTimeout: number
    healthCheckInterval: number
  }
  
  // Monitoring integration
  monitoring: {
    prometheusEnabled: boolean
    metricsEndpoint: string
    healthEndpoint: string
    alertWebhook: string
  }
}
```

---

*System Overview Documentation - Version 1.8.5*  
*Last updated: August 2025 | Architecture Review: November 2025*

## See Also

- **[MCP Server API](../api/README.md)** - Complete API reference and tool documentation
- **[Architecture Guide](README.md)** - High-level architecture overview
- **[Configuration Reference](../../reference/configuration.md)** - Configuration options and tuning
- **[Development Guide](../../development/architecture.md)** - Development architecture and patterns
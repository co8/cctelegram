# System Architecture

CCTelegram implements a sophisticated 3-tier cascading architecture designed for high-performance event processing and reliable notification delivery. This document provides comprehensive architectural diagrams showing the system design, data flows, and integration patterns.

## System Overview

The CCTelegram system consists of several key components working together to provide seamless integration between Claude Code and Telegram:

```mermaid
graph TB
    subgraph "Claude Code Environment"
        CC[Claude Code]
        MCP[MCP Client]
    end
    
    subgraph "CCTelegram Bridge"
        direction TB
        
        subgraph "Tier 1: Webhook Layer (0-100ms)"
            WH[Webhook Server]
            WV[Request Validator]
            WR[Rate Limiter]
        end
        
        subgraph "Tier 2: Bridge Layer (100-500ms)"
            BP[Bridge Processor]
            EV[Event Validator]
            CB[Circuit Breaker]
        end
        
        subgraph "Tier 3: File Layer (1-5s)"
            FW[File Watcher]
            FP[File Processor]
            FB[File Buffer]
        end
        
        subgraph "Core Services"
            SEC[Security Layer]
            LOG[Audit Logger]
            MON[Monitoring]
            PROM[Prometheus Metrics]
        end
        
        subgraph "Data Layer"
            FS[File System]
            RESP[Response Files]
            AUDIT[Audit Logs]
        end
    end
    
    subgraph "Telegram Services"
        TB[Telegram Bot API]
        TU[Telegram Users]
        TC[Telegram Channels]
    end
    
    subgraph "External Services"
        GRAF[Grafana Dashboard]
        ALERT[Alert Manager]
    end
    
    %% Main Flow
    CC --> MCP
    MCP --> WH
    WH --> WV
    WV --> WR
    WR --> BP
    BP --> EV
    EV --> CB
    CB --> FW
    FW --> FP
    FP --> FB
    
    %% Fallback Flows
    WH -.->|Timeout| BP
    BP -.->|Timeout| FW
    
    %% Security & Monitoring
    WH --> SEC
    BP --> SEC
    FW --> SEC
    
    SEC --> LOG
    SEC --> MON
    MON --> PROM
    PROM --> GRAF
    PROM --> ALERT
    
    %% Data Flow
    FB --> FS
    FP --> RESP
    LOG --> AUDIT
    
    %% Telegram Integration
    FP --> TB
    TB --> TU
    TB --> TC
    TU --> TB
    TB --> RESP
    
    %% Styling
    classDef tier1 fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef tier2 fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef tier3 fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef security fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef external fill:#fafafa,stroke:#424242,stroke-width:1px
    
    class WH,WV,WR tier1
    class BP,EV,CB tier2
    class FW,FP,FB tier3
    class SEC,LOG,MON,PROM security
    class TB,TU,TC,GRAF,ALERT external
```

**Key Architectural Principles:**

1. **3-Tier Cascading**: Progressive timeout handling with intelligent failover
2. **High Availability**: Circuit breaker pattern with health monitoring
3. **Security First**: Multi-layer security with authentication and audit logging
4. **Performance Monitoring**: Comprehensive metrics and alerting
5. **Scalable Design**: Modular components with clear separation of concerns

## Component Details

### Tier 1: Webhook Layer (0-100ms SLA)
- **Ultra-fast response**: Immediate acknowledgment
- **Request validation**: Input sanitization and structure validation
- **Rate limiting**: Per-user and global throttling
- **Security headers**: CSRF protection and security headers

### Tier 2: Bridge Layer (100-500ms SLA) 
- **Event processing**: Business logic and event enrichment
- **Circuit breaker**: Intelligent failover management
- **Response caching**: Performance optimization
- **Audit logging**: Comprehensive event tracking

### Tier 3: File Layer (1-5s SLA)
- **Reliable delivery**: Guaranteed event processing via file system
- **File watching**: Real-time file system monitoring
- **Buffer management**: Event queuing and batching
- **Recovery mechanisms**: Automatic retry and error handling

## Next Sections

- [MCP Server Architecture →](#mcp-server-architecture)
- [3-Tier Cascading Flow →](#3-tier-cascading-flow)
- [Telegram Integration →](#telegram-integration)
- [Security Architecture →](#security-architecture)
- [Data Flow & Error Handling →](#data-flow--error-handling)

## MCP Server Architecture

The MCP Server provides 16 specialized tools for Claude Code integration, implementing robust security, performance monitoring, and comprehensive event management.

```mermaid
graph TB
    subgraph "Claude Code MCP Client"
        CC[Claude Code]
        MCPC[MCP Protocol Client]
    end
    
    subgraph "MCP Server (Node.js/TypeScript)"
        direction TB
        
        subgraph "Transport Layer"
            STDIO[StdIO Transport]
            HTTP[HTTP Transport]
        end
        
        subgraph "Security Layer"
            AUTH[Authentication]
            AUTHZ[Authorization] 
            VALID[Input Validation]
            RATE[Rate Limiting]
        end
        
        subgraph "MCP Tools (16 Tools)"
            direction LR
            
            subgraph "Event Management"
                SEND[send_telegram_event]
                MSG[send_telegram_message]
                TASK[send_task_completion]
                PERF[send_performance_alert]
                APPR[send_approval_request]
            end
            
            subgraph "Response Processing"
                RESP[get_telegram_responses]
                PROC[process_pending_responses]
                CLEAR[clear_old_responses]
            end
            
            subgraph "Bridge Management"
                STATUS[get_bridge_status]
                START[start_bridge]
                STOP[stop_bridge]
                RESTART[restart_bridge]
                ENSURE[ensure_bridge_running]
                CHECK[check_bridge_process]
            end
            
            subgraph "System Integration"
                TYPES[list_event_types]
                TSTAT[get_task_status]
            end
        end
        
        subgraph "Bridge Client"
            BC[BridgeClient]
            HTTP_POOL[HTTP Connection Pool]
            RETRY[Retry Logic]
            CIRCUIT[Circuit Breaker]
        end
        
        subgraph "Monitoring & Observability"
            METRICS[Prometheus Metrics]
            HEALTH[Health Checks]
            LOGGING[Structured Logging]
            TRACING[OpenTelemetry Tracing]
        end
    end
    
    subgraph "CCTelegram Bridge (Rust)"
        BRIDGE[Bridge Process]
        WEBHOOK[Webhook Endpoint]
        TIERS[3-Tier Processor]
        TELEGRAM[Telegram Bot]
    end
    
    %% Connection Flow
    CC --> MCPC
    MCPC --> STDIO
    STDIO --> AUTH
    AUTH --> AUTHZ
    AUTHZ --> VALID
    VALID --> RATE
    
    %% Tool Routing
    RATE --> SEND
    RATE --> MSG
    RATE --> TASK
    RATE --> PERF
    RATE --> APPR
    RATE --> RESP
    RATE --> PROC
    RATE --> CLEAR
    RATE --> STATUS
    RATE --> START
    RATE --> STOP
    RATE --> RESTART
    RATE --> ENSURE
    RATE --> CHECK
    RATE --> TYPES
    RATE --> TSTAT
    
    %% Bridge Communication
    SEND --> BC
    MSG --> BC
    TASK --> BC
    PERF --> BC
    APPR --> BC
    START --> BC
    STOP --> BC
    RESTART --> BC
    
    BC --> HTTP_POOL
    HTTP_POOL --> RETRY
    RETRY --> CIRCUIT
    CIRCUIT --> WEBHOOK
    
    %% Response Flow
    BRIDGE --> RESP
    BRIDGE --> PROC
    
    %% Status Flow
    BRIDGE --> STATUS
    BRIDGE --> CHECK
    
    %% Monitoring
    BC --> METRICS
    METRICS --> HEALTH
    HEALTH --> LOGGING
    LOGGING --> TRACING
    
    %% Bridge Processing
    WEBHOOK --> TIERS
    TIERS --> TELEGRAM
    
    %% Styling
    classDef mcp fill:#e3f2fd,stroke:#0277bd,stroke-width:2px
    classDef security fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef tools fill:#f1f8e9,stroke:#388e3c,stroke-width:2px
    classDef monitoring fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef bridge fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    
    class STDIO,HTTP,CC,MCPC mcp
    class AUTH,AUTHZ,VALID,RATE security
    class SEND,MSG,TASK,PERF,APPR,RESP,PROC,CLEAR,STATUS,START,STOP,RESTART,ENSURE,CHECK,TYPES,TSTAT tools
    class METRICS,HEALTH,LOGGING,TRACING monitoring
    class BRIDGE,WEBHOOK,TIERS,TELEGRAM bridge
```

**MCP Server Features:**

### Tool Categories

1. **Event Management (5 tools)**
   - Structured event notifications with 40+ event types
   - Custom message delivery with source attribution
   - Task completion tracking with performance metrics
   - Performance alerts with threshold monitoring
   - Interactive approval workflows with response tracking

2. **Response Processing (3 tools)**
   - Telegram response collection and parsing
   - Pending approval request processing
   - Automated cleanup of old response files

3. **Bridge Management (6 tools)**
   - Bridge process lifecycle management
   - Health status monitoring and reporting
   - Automatic process recovery and restart
   - Connection validation and testing

4. **System Integration (2 tools)**
   - Event type discovery and documentation
   - Multi-system task status aggregation

### Security Implementation

- **Authentication**: Token-based validation with configurable providers
- **Authorization**: Role-based access control with granular permissions
- **Input Validation**: Comprehensive Joi schema validation
- **Rate Limiting**: Flexible rate limiting with per-user and global limits
- **Audit Logging**: Complete request/response logging with security events

### Performance Features

- **Connection Pooling**: Efficient HTTP connection reuse
- **Circuit Breaker**: Intelligent failover with health monitoring
- **Retry Logic**: Exponential backoff with jitter
- **Caching**: Response caching with TTL management
- **Monitoring**: Real-time performance metrics and alerting

## 3-Tier Cascading Flow

The 3-tier cascading system provides intelligent failover with progressive timeout handling and guaranteed event delivery.

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant MCP as MCP Server
    participant T1 as Tier 1: Webhook<br/>(0-100ms SLA)
    participant T2 as Tier 2: Bridge<br/>(100-500ms SLA)
    participant T3 as Tier 3: File Watcher<br/>(1-5s SLA)
    participant TG as Telegram Bot
    participant FS as File System
    participant CB as Circuit Breaker
    participant MON as Monitoring
    
    Note over CC, MON: Event Processing Flow
    
    CC->>MCP: send_telegram_event
    MCP->>T1: POST /webhook (timeout: 100ms)
    
    alt Tier 1 Success (Fast Path)
        T1->>T1: Validate Request
        T1->>T1: Rate Limiting
        T1->>T1: Security Check
        T1->>TG: Send Notification
        TG-->>T1: Response
        T1->>MCP: 200 OK (< 100ms)
        T1->>MON: Metrics: tier1_success
        MCP->>CC: Success Response
    else Tier 1 Timeout (Failover to Tier 2)
        Note over T1: Timeout after 100ms
        T1->>CB: Report Failure
        CB->>CB: Evaluate Health
        MCP->>T2: Process Event (timeout: 500ms)
        
        alt Tier 2 Success (Standard Path)
            T2->>T2: Enhanced Processing
            T2->>T2: Event Enrichment
            T2->>T2: Audit Logging
            T2->>TG: Send Notification
            TG-->>T2: Response
            T2->>MCP: 200 OK (< 500ms)
            T2->>MON: Metrics: tier2_success
            MCP->>CC: Success Response
        else Tier 2 Timeout (Failover to Tier 3)
            Note over T2: Timeout after 500ms
            T2->>CB: Report Failure
            CB->>CB: Open Circuit
            MCP->>T3: Write Event File
            
            T3->>FS: Write Event.json
            T3->>MCP: 202 Accepted
            MCP->>CC: Queued Response
            
            Note over T3, TG: Asynchronous Processing
            loop File Watcher Loop
                T3->>FS: Watch for Events
                FS-->>T3: Event File Detected
                T3->>T3: Process Event (< 5s)
                T3->>TG: Send Notification
                TG-->>T3: Response
                T3->>FS: Mark Processed
                T3->>MON: Metrics: tier3_success
            end
        end
    end
    
    Note over CC, MON: Circuit Breaker & Health Monitoring
    
    par Health Monitoring
        loop Every 30s
            MON->>T1: Health Check
            T1-->>MON: Health Status
            MON->>T2: Health Check  
            T2-->>MON: Health Status
            MON->>T3: Health Check
            T3-->>MON: Health Status
        end
    and Circuit Breaker Management
        CB->>CB: Evaluate Failure Rate
        alt Failure Rate > 50%
            CB->>CB: Open Circuit (Block T1)
            CB->>MON: Circuit Opened
        else After Recovery Period
            CB->>CB: Half-Open (Test T1)
            CB->>T1: Test Request
            alt Test Success
                CB->>CB: Close Circuit (Enable T1)
                CB->>MON: Circuit Closed
            else Test Failure
                CB->>CB: Keep Open
            end
        end
    end
    
    Note over CC, MON: Performance SLAs
    rect rgb(225, 245, 254)
        Note over T1: Tier 1 SLA: 0-100ms<br/>Ultra-fast acknowledgment<br/>95th percentile: <50ms
    end
    rect rgb(243, 229, 245)
        Note over T2: Tier 2 SLA: 100-500ms<br/>Enhanced processing<br/>95th percentile: <300ms
    end
    rect rgb(232, 245, 233)
        Note over T3: Tier 3 SLA: 1-5s<br/>Guaranteed delivery<br/>99th percentile: <3s
    end
```

**Tier Characteristics:**

### Tier 1: Webhook Layer (0-100ms)
```mermaid
graph LR
    subgraph "Tier 1: Ultra-Fast Processing"
        direction TB
        REQ[Request] --> VAL[Input Validation<br/>~5ms]
        VAL --> RATE[Rate Limiting<br/>~2ms]
        RATE --> SEC[Security Check<br/>~3ms]
        SEC --> PROC[Core Processing<br/>~20ms]
        PROC --> RESP[Response<br/>~5ms]
        
        style VAL fill:#e1f5fe,stroke:#01579b
        style RATE fill:#e1f5fe,stroke:#01579b
        style SEC fill:#e1f5fe,stroke:#01579b
        style PROC fill:#e1f5fe,stroke:#01579b
        style RESP fill:#e1f5fe,stroke:#01579b
    end
```

**Features:**
- In-memory processing only
- Minimal validation and transformation
- Direct Telegram API calls
- No disk I/O operations
- Circuit breaker integration

### Tier 2: Bridge Layer (100-500ms)
```mermaid
graph LR
    subgraph "Tier 2: Enhanced Processing"
        direction TB
        REQ[Request] --> ENR[Event Enrichment<br/>~50ms]
        ENR --> AUD[Audit Logging<br/>~30ms]
        AUD --> VAL[Advanced Validation<br/>~20ms]
        VAL --> CACHE[Response Caching<br/>~10ms]
        CACHE --> PROC[Business Logic<br/>~150ms]
        PROC --> RESP[Response<br/>~15ms]
        
        style ENR fill:#f3e5f5,stroke:#4a148c
        style AUD fill:#f3e5f5,stroke:#4a148c
        style VAL fill:#f3e5f5,stroke:#4a148c
        style CACHE fill:#f3e5f5,stroke:#4a148c
        style PROC fill:#f3e5f5,stroke:#4a148c
        style RESP fill:#f3e5f5,stroke:#4a148c
    end
```

**Features:**
- Event enrichment and transformation
- Comprehensive audit logging
- Response caching
- Advanced validation rules
- Database interactions

### Tier 3: File Layer (1-5s)
```mermaid
graph LR
    subgraph "Tier 3: Guaranteed Delivery"
        direction TB
        FILE[Event File] --> WATCH[File Watcher<br/>~100ms]
        WATCH --> PROC[File Processing<br/>~500ms]
        PROC --> BATCH[Batch Processing<br/>~1000ms]
        BATCH --> RETRY[Retry Logic<br/>~2000ms]
        RETRY --> COMP[Complete<br/>~50ms]
        
        style WATCH fill:#e8f5e8,stroke:#1b5e20
        style PROC fill:#e8f5e8,stroke:#1b5e20
        style BATCH fill:#e8f5e8,stroke:#1b5e20
        style RETRY fill:#e8f5e8,stroke:#1b5e20
        style COMP fill:#e8f5e8,stroke:#1b5e20
    end
```

**Features:**
- File system durability
- Batch processing capabilities
- Comprehensive retry logic
- Dead letter queue handling
- Recovery mechanisms

## Telegram Integration

The Telegram integration provides comprehensive bot functionality with interactive messaging, approval workflows, and multi-user support.

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant MCP as MCP Server
    participant BC as Bridge Client
    participant BRIDGE as CCTelegram Bridge
    participant TB as Telegram Bot API
    participant TU1 as User 1
    participant TU2 as User 2
    participant ADMIN as Admin User
    participant FS as Response Files
    
    Note over CC, FS: Event Notification Flow
    
    %% Event Sending
    CC->>MCP: send_telegram_event({<br/>  type: "task_completion",<br/>  title: "Build Complete",<br/>  description: "Successfully built app"<br/>})
    
    MCP->>BC: HTTP POST /events
    BC->>BRIDGE: Process Event
    
    BRIDGE->>BRIDGE: Validate Event
    BRIDGE->>BRIDGE: Format Message
    BRIDGE->>BRIDGE: Apply Security Rules
    
    %% Multi-User Broadcasting
    par Send to User 1
        BRIDGE->>TB: sendMessage({<br/>  chat_id: user1_id,<br/>  text: "✅ Build Complete\nSuccessfully built app",<br/>  reply_markup: inline_keyboard<br/>})
        TB->>TU1: Notification Message
    and Send to User 2  
        BRIDGE->>TB: sendMessage({<br/>  chat_id: user2_id,<br/>  text: "✅ Build Complete\nSuccessfully built app"<br/>})
        TB->>TU2: Notification Message
    and Send to Admin
        BRIDGE->>TB: sendMessage({<br/>  chat_id: admin_id,<br/>  text: "🔧 [ADMIN] Build Complete\nUser: claude-code\nDuration: 45s"<br/>})
        TB->>ADMIN: Admin Notification
    end
    
    BRIDGE->>MCP: 200 OK
    MCP->>CC: Success Response
    
    Note over CC, FS: Interactive Approval Flow
    
    %% Approval Request
    CC->>MCP: send_approval_request({<br/>  title: "Deploy to Production?",<br/>  description: "Build #342 ready for deployment",<br/>  options: ["✅ Approve", "❌ Deny", "⏸️ Hold"]<br/>})
    
    MCP->>BC: HTTP POST /approvals
    BC->>BRIDGE: Process Approval Request
    
    BRIDGE->>BRIDGE: Generate Approval ID
    BRIDGE->>TB: sendMessage({<br/>  chat_id: admin_id,<br/>  text: "🚀 Deployment Approval Required\nBuild #342 ready for production",<br/>  reply_markup: {<br/>    inline_keyboard: [[<br/>      {text: "✅ Approve", callback_data: "approve_abc123"},<br/>      {text: "❌ Deny", callback_data: "deny_abc123"},<br/>      {text: "⏸️ Hold", callback_data: "hold_abc123"}<br/>    ]]<br/>  }<br/>})
    
    TB->>ADMIN: Approval Request
    ADMIN->>TB: Callback Query: "approve_abc123"
    TB->>BRIDGE: Update received
    
    %% Response Processing
    BRIDGE->>BRIDGE: Parse Callback Data
    BRIDGE->>BRIDGE: Validate User Permission
    BRIDGE->>FS: Write Response File({<br/>  id: "abc123",<br/>  user_id: admin_id,<br/>  action: "approve",<br/>  timestamp: "2024-01-01T12:00:00Z"<br/>})
    
    BRIDGE->>TB: editMessageText({<br/>  message_id: original_msg_id,<br/>  text: "✅ Approved by @admin\nDeployment proceeding...",<br/>  reply_markup: null<br/>})
    
    TB->>ADMIN: Updated Message
    
    %% Response Retrieval
    CC->>MCP: get_telegram_responses()
    MCP->>FS: Read Response Files
    FS-->>MCP: Response Data
    MCP->>CC: [{<br/>  id: "abc123",<br/>  user_id: 12345,<br/>  message: "approve",<br/>  timestamp: "2024-01-01T12:00:00Z",<br/>  event_id: "approval_abc123"<br/>}]
    
    Note over CC, FS: Error Handling & Recovery
    
    %% Telegram API Error
    CC->>MCP: send_telegram_event(large_event)
    MCP->>BC: HTTP POST
    BC->>BRIDGE: Process Event
    BRIDGE->>TB: sendMessage (large text)
    TB-->>BRIDGE: Error: Message too long
    
    BRIDGE->>BRIDGE: Auto-truncate Message
    BRIDGE->>TB: sendMessage (truncated + "...more")
    TB->>TU1: Truncated Message
    
    alt Message Still Too Long
        BRIDGE->>BRIDGE: Split into Multiple Messages  
        loop For Each Chunk
            BRIDGE->>TB: sendMessage (chunk)
            TB->>TU1: Message Part
        end
    end
    
    BRIDGE->>MCP: 200 OK (with warning)
    MCP->>CC: Success with Metadata
    
    Note over CC, FS: Bot Command Handling
    
    %% User Commands
    TU1->>TB: /status
    TB->>BRIDGE: Command Update
    BRIDGE->>BRIDGE: Process Command
    BRIDGE->>BRIDGE: Check User Permissions
    
    BRIDGE->>TB: sendMessage({<br/>  chat_id: user1_id,<br/>  text: "🤖 CCTelegram Status\n\n" +<br/>         "🟢 Bridge: Healthy\n" +<br/>         "📊 Events Today: 127\n" +<br/>         "⚡ Response Time: 45ms\n" +<br/>         "👥 Active Users: 3"<br/>})
    
    TB->>TU1: Status Response
    
    %% Admin Commands
    ADMIN->>TB: /users
    TB->>BRIDGE: Admin Command Update
    BRIDGE->>BRIDGE: Verify Admin Status
    
    BRIDGE->>TB: sendMessage({<br/>  chat_id: admin_id,<br/>  text: "👥 User Management\n\n" +<br/>         "User 1: @user1 (Active)\n" +<br/>         "User 2: @user2 (Active)\n" +<br/>         "Admin: @admin (Online)",<br/>  reply_markup: management_keyboard<br/>})
    
    TB->>ADMIN: User Management Interface
```

**Telegram Bot Features:**

### Message Types & Formatting

1. **Event Notifications**
   - Rich formatting with emojis and status indicators
   - Contextual information (duration, files affected, etc.)
   - Automatic message truncation for long content
   - Multi-part message splitting when needed

2. **Interactive Elements**
   - Inline keyboards for approval workflows
   - Callback queries for user actions
   - Command menus for bot interaction
   - Custom keyboards for frequent actions

3. **User Management**
   - Multi-user support with individual targeting
   - Role-based permissions (admin/user)
   - User activity tracking and analytics
   - Configurable notification preferences

### Bot Commands

```mermaid
graph TD
    subgraph "User Commands"
        STATUS[/status - System Status]
        HELP[/help - Command Help]
        SETTINGS[/settings - User Preferences]
        HISTORY[/history - Recent Events]
    end
    
    subgraph "Admin Commands"
        USERS[/users - User Management]
        METRICS[/metrics - System Metrics]
        CONFIG[/config - Bot Configuration]
        LOGS[/logs - System Logs]
    end
    
    subgraph "Interactive Features"
        APPROVE[Approval Buttons]
        QUICK[Quick Actions]
        MENU[Inline Menus]
        FEEDBACK[Response Collection]
    end
    
    STATUS --> HEALTH[Health Check Response]
    HELP --> GUIDE[Command Guide]
    SETTINGS --> PREFS[Preference Panel]
    HISTORY --> EVENTS[Event History]
    
    USERS --> MGMT[User Management Panel]
    METRICS --> STATS[Performance Statistics]
    CONFIG --> SETTINGS_PANEL[Configuration Panel]
    LOGS --> LOG_VIEWER[Log Viewer]
    
    APPROVE --> RESPONSE[Automated Response]
    QUICK --> ACTION[Immediate Action]
    MENU --> OPTIONS[Action Options]
    FEEDBACK --> COLLECTION[Response Collection]
    
    %% Styling
    classDef userCmd fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef adminCmd fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef interactive fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef response fill:#fce4ec,stroke:#c2185b,stroke-width:1px
    
    class STATUS,HELP,SETTINGS,HISTORY userCmd
    class USERS,METRICS,CONFIG,LOGS adminCmd
    class APPROVE,QUICK,MENU,FEEDBACK interactive
    class HEALTH,GUIDE,PREFS,EVENTS,MGMT,STATS,SETTINGS_PANEL,LOG_VIEWER,RESPONSE,ACTION,OPTIONS,COLLECTION response
```

### Security & Privacy

- **Authentication**: Telegram user ID validation
- **Authorization**: Role-based command access control  
- **Rate Limiting**: Per-user message throttling
- **Content Filtering**: Sensitive data redaction
- **Audit Logging**: Complete interaction history
- **Privacy Controls**: Configurable notification levels

## Security Architecture

CCTelegram implements a comprehensive multi-layer security architecture with defense-in-depth principles, comprehensive audit logging, and enterprise-grade access controls.

```mermaid
graph TB
    subgraph "External Threats"
        DDOS[DDoS Attacks]
        BRUTE[Brute Force]
        INJECT[Injection Attacks]
        MITM[Man-in-Middle]
        SOCIAL[Social Engineering]
    end
    
    subgraph "Perimeter Security Layer"
        direction TB
        
        subgraph "Network Security"
            FW[Firewall Rules]
            PROXY[Reverse Proxy]
            RATE_GLOBAL[Global Rate Limiting]
            GEO[Geo-blocking]
        end
        
        subgraph "TLS/SSL Protection"
            CERT[TLS Certificates]
            HSTS[HSTS Headers]
            CIPHER[Cipher Suites]
            PINNING[Certificate Pinning]
        end
    end
    
    subgraph "Application Security Layer"
        direction TB
        
        subgraph "Authentication & Authorization"
            TOKEN_AUTH[Token Authentication]
            RBAC[Role-Based Access Control]
            MFA[Multi-Factor Auth (Optional)]
            SESSION[Session Management]
        end
        
        subgraph "Input Security"
            VALIDATION[Input Validation]
            SANITIZATION[Data Sanitization]
            ENCODING[Output Encoding]
            CSRF[CSRF Protection]
        end
        
        subgraph "Application Controls"
            RATE_USER[Per-User Rate Limiting]
            THROTTLE[Request Throttling]
            CIRCUIT[Circuit Breakers]
            TIMEOUT[Request Timeouts]
        end
    end
    
    subgraph "Data Security Layer"
        direction TB
        
        subgraph "Data Protection"
            ENCRYPT_REST[Encryption at Rest]
            ENCRYPT_TRANSIT[Encryption in Transit]
            KEY_MGMT[Key Management]
            DATA_CLASS[Data Classification]
        end
        
        subgraph "Privacy Controls"
            PII_FILTER[PII Filtering]
            REDACTION[Data Redaction]
            RETENTION[Data Retention]
            GDPR[GDPR Compliance]
        end
    end
    
    subgraph "Monitoring & Audit Layer"
        direction TB
        
        subgraph "Security Monitoring"
            SIEM[SIEM Integration]
            ANOMALY[Anomaly Detection]
            THREAT[Threat Intelligence]
            ALERT[Security Alerts]
        end
        
        subgraph "Audit & Compliance"
            AUDIT_LOG[Audit Logging]
            COMPLIANCE[Compliance Reporting]
            FORENSICS[Digital Forensics]
            INCIDENT[Incident Response]
        end
    end
    
    subgraph "Core Application"
        MCP[MCP Server]
        BRIDGE[CCTelegram Bridge]
        TELEGRAM[Telegram Bot]
    end
    
    %% Attack Flow Prevention
    DDOS -.-> FW
    BRUTE -.-> RATE_GLOBAL
    INJECT -.-> VALIDATION
    MITM -.-> CERT
    SOCIAL -.-> TOKEN_AUTH
    
    %% Security Layer Flow
    FW --> PROXY
    PROXY --> RATE_GLOBAL
    RATE_GLOBAL --> GEO
    
    CERT --> HSTS
    HSTS --> CIPHER
    CIPHER --> PINNING
    
    TOKEN_AUTH --> RBAC
    RBAC --> MFA
    MFA --> SESSION
    
    VALIDATION --> SANITIZATION
    SANITIZATION --> ENCODING
    ENCODING --> CSRF
    
    RATE_USER --> THROTTLE
    THROTTLE --> CIRCUIT
    CIRCUIT --> TIMEOUT
    
    ENCRYPT_REST --> ENCRYPT_TRANSIT
    ENCRYPT_TRANSIT --> KEY_MGMT
    KEY_MGMT --> DATA_CLASS
    
    PII_FILTER --> REDACTION
    REDACTION --> RETENTION
    RETENTION --> GDPR
    
    SIEM --> ANOMALY
    ANOMALY --> THREAT
    THREAT --> ALERT
    
    AUDIT_LOG --> COMPLIANCE
    COMPLIANCE --> FORENSICS
    FORENSICS --> INCIDENT
    
    %% Core Application Integration
    GEO --> MCP
    PINNING --> MCP
    SESSION --> MCP
    CSRF --> MCP
    TIMEOUT --> MCP
    DATA_CLASS --> MCP
    GDPR --> MCP
    ALERT --> MCP
    INCIDENT --> MCP
    
    MCP --> BRIDGE
    BRIDGE --> TELEGRAM
    
    %% Monitoring Integration
    MCP --> AUDIT_LOG
    BRIDGE --> AUDIT_LOG
    TELEGRAM --> AUDIT_LOG
    
    %% Styling
    classDef threat fill:#ffebee,stroke:#d32f2f,stroke-width:2px,stroke-dasharray: 5 5
    classDef perimeter fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef application fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef monitoring fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef core fill:#fafafa,stroke:#424242,stroke-width:2px
    
    class DDOS,BRUTE,INJECT,MITM,SOCIAL threat
    class FW,PROXY,RATE_GLOBAL,GEO,CERT,HSTS,CIPHER,PINNING perimeter
    class TOKEN_AUTH,RBAC,MFA,SESSION,VALIDATION,SANITIZATION,ENCODING,CSRF,RATE_USER,THROTTLE,CIRCUIT,TIMEOUT application
    class ENCRYPT_REST,ENCRYPT_TRANSIT,KEY_MGMT,DATA_CLASS,PII_FILTER,REDACTION,RETENTION,GDPR data
    class SIEM,ANOMALY,THREAT,ALERT,AUDIT_LOG,COMPLIANCE,FORENSICS,INCIDENT monitoring
    class MCP,BRIDGE,TELEGRAM core
```

### Security Implementation Details

#### Authentication & Authorization

```mermaid
graph LR
    subgraph "Authentication Flow"
        direction TB
        REQ[Request] --> TOKEN[Extract Token]
        TOKEN --> VALIDATE[Validate Token]
        VALIDATE --> CACHE[Check Cache]
        CACHE --> DB[User Database]
        DB --> ROLES[Load Roles]
        ROLES --> PERMS[Load Permissions]
    end
    
    subgraph "Authorization Matrix"
        direction TB
        
        subgraph "User Roles"
            ADMIN[Admin User]
            POWER[Power User]
            STANDARD[Standard User]
            GUEST[Guest User]
        end
        
        subgraph "Permissions"
            SEND_EVENT[Send Events]
            VIEW_STATUS[View Status]
            MANAGE_USERS[Manage Users]
            VIEW_LOGS[View Logs]
            MODIFY_CONFIG[Modify Config]
            ADMIN_CMDS[Admin Commands]
        end
    end
    
    PERMS --> ADMIN
    ADMIN --> SEND_EVENT
    ADMIN --> VIEW_STATUS
    ADMIN --> MANAGE_USERS
    ADMIN --> VIEW_LOGS
    ADMIN --> MODIFY_CONFIG
    ADMIN --> ADMIN_CMDS
    
    POWER --> SEND_EVENT
    POWER --> VIEW_STATUS
    POWER --> VIEW_LOGS
    
    STANDARD --> SEND_EVENT
    STANDARD --> VIEW_STATUS
    
    GUEST --> VIEW_STATUS
    
    %% Styling
    classDef auth fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef role fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef perm fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    
    class REQ,TOKEN,VALIDATE,CACHE,DB,ROLES,PERMS auth
    class ADMIN,POWER,STANDARD,GUEST role
    class SEND_EVENT,VIEW_STATUS,MANAGE_USERS,VIEW_LOGS,MODIFY_CONFIG,ADMIN_CMDS perm
```

#### Data Protection & Privacy

```mermaid
graph TD
    subgraph "Data Classification"
        PII[PII Data<br/>🔴 Highly Sensitive]
        AUTH_DATA[Auth Data<br/>🟠 Sensitive]
        EVENT_DATA[Event Data<br/>🟡 Internal]
        LOG_DATA[Log Data<br/>🟢 General]
    end
    
    subgraph "Protection Mechanisms"
        direction LR
        
        subgraph "Encryption"
            AES256[AES-256 Encryption]
            RSA[RSA Key Exchange]
            HASH[SHA-256 Hashing]
            SALT[Salt Generation]
        end
        
        subgraph "Privacy Controls"
            FILTER[Content Filtering]
            MASK[Data Masking]
            ANON[Anonymization]
            EXPIRE[Auto-Expiration]
        end
        
        subgraph "Compliance"
            GDPR_CTRL[GDPR Controls]
            DATA_MIN[Data Minimization]
            PURPOSE[Purpose Limitation]
            CONSENT[Consent Management]
        end
    end
    
    %% Data flow through protection
    PII --> AES256
    PII --> FILTER
    PII --> GDPR_CTRL
    
    AUTH_DATA --> RSA
    AUTH_DATA --> HASH
    AUTH_DATA --> SALT
    AUTH_DATA --> MASK
    
    EVENT_DATA --> AES256
    EVENT_DATA --> ANON
    EVENT_DATA --> DATA_MIN
    
    LOG_DATA --> HASH
    LOG_DATA --> EXPIRE
    LOG_DATA --> PURPOSE
    
    %% Compliance integration
    GDPR_CTRL --> CONSENT
    DATA_MIN --> PURPOSE
    PURPOSE --> CONSENT
    
    %% Styling
    classDef highly_sensitive fill:#ffebee,stroke:#d32f2f,stroke-width:3px
    classDef sensitive fill:#fff3e0,stroke:#ff9800,stroke-width:2px
    classDef internal fill:#fff9c4,stroke:#f9a825,stroke-width:2px
    classDef general fill:#e8f5e8,stroke:#4caf50,stroke-width:1px
    classDef protection fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    
    class PII highly_sensitive
    class AUTH_DATA sensitive
    class EVENT_DATA internal
    class LOG_DATA general
    class AES256,RSA,HASH,SALT,FILTER,MASK,ANON,EXPIRE,GDPR_CTRL,DATA_MIN,PURPOSE,CONSENT protection
```

### Security Monitoring & Incident Response

```mermaid
sequenceDiagram
    participant THREAT as Threat Actor
    participant FW as Firewall
    participant APP as Application
    participant SIEM as SIEM System
    participant SOC as SOC Team
    participant ADMIN as Admin
    participant AUTO as Auto-Response
    
    Note over THREAT, AUTO: Security Event Detection
    
    THREAT->>FW: Malicious Request
    FW->>FW: Analyze Request
    
    alt Blocked by Firewall
        FW->>SIEM: Log Blocked Request
        SIEM->>SOC: Low Priority Alert
    else Request Passes Firewall
        FW->>APP: Forward Request
        APP->>APP: Process Request
        
        alt Suspicious Activity Detected
            APP->>SIEM: Security Event
            SIEM->>SIEM: Correlation Analysis
            SIEM->>SOC: High Priority Alert
            
            par Automated Response
                SIEM->>AUTO: Trigger Auto-Response
                AUTO->>APP: Block Source IP
                AUTO->>FW: Update Rules
            and Manual Investigation
                SOC->>ADMIN: Escalate Incident
                ADMIN->>APP: Investigate Logs
                ADMIN->>SIEM: Review Timeline
            end
            
            ADMIN->>AUTO: Adjust Response
            AUTO->>ADMIN: Confirm Actions
        end
    end
    
    Note over THREAT, AUTO: Incident Response Workflow
    
    SOC->>SOC: Incident Classification
    SOC->>ADMIN: Assign Severity
    
    alt Critical Incident
        ADMIN->>AUTO: Emergency Lockdown
        AUTO->>APP: Disable Non-Essential Features
        AUTO->>FW: Maximum Security Mode
        ADMIN->>SOC: Executive Notification
    else Standard Incident
        ADMIN->>APP: Implement Countermeasures
        ADMIN->>SIEM: Update Detection Rules
    end
    
    ADMIN->>SOC: Incident Resolution
    SOC->>SIEM: Update Case Status
    SIEM->>AUTO: Resume Normal Operations
```

### Security Configuration

**Environment Variables:**
```bash
# Authentication
MCP_ENABLE_AUTH=true
MCP_AUTH_TOKEN=your_secure_token_here
MCP_AUTH_PROVIDER=telegram

# Rate Limiting
RATE_LIMIT_WINDOW=900
RATE_LIMIT_MAX=100
RATE_LIMIT_PER_USER=20

# Security Headers
SECURITY_HEADERS_ENABLED=true
HSTS_MAX_AGE=31536000
CSP_ENABLED=true

# Audit Logging
AUDIT_LOG_LEVEL=info
AUDIT_LOG_RETENTION_DAYS=90
SECURITY_LOG_ENABLED=true

# Encryption
ENCRYPTION_ENABLED=true
KEY_ROTATION_DAYS=30
```

**Security Checklist:**

- ✅ **Authentication**: Token-based with configurable providers
- ✅ **Authorization**: Role-based access control (RBAC)
- ✅ **Input Validation**: Comprehensive Joi schema validation
- ✅ **Rate Limiting**: Global and per-user throttling
- ✅ **Encryption**: AES-256 for data at rest, TLS 1.3 in transit
- ✅ **Audit Logging**: Complete security event tracking
- ✅ **Privacy Controls**: PII filtering and GDPR compliance
- ✅ **Monitoring**: Real-time threat detection and alerting
- ✅ **Incident Response**: Automated response and escalation
- ✅ **Compliance**: Industry security standard adherence

## Data Flow & Error Handling

CCTelegram implements comprehensive data flow patterns with robust error handling, automatic recovery mechanisms, and guaranteed message delivery.

### Primary Data Flow Architecture

```mermaid
graph TD
    subgraph "Data Sources"
        CC[Claude Code Events]
        USER[User Commands]
        SYS[System Events] 
        EXT[External APIs]
    end
    
    subgraph "Ingestion Layer"
        direction TB
        MCP_IN[MCP Server Ingestion]
        WH_IN[Webhook Ingestion]
        CMD_IN[Command Processor]
        API_IN[API Gateway]
    end
    
    subgraph "Processing Pipeline"
        direction TB
        
        subgraph "Validation Stage"
            SCHEMA[Schema Validation]
            AUTH_CHK[Auth Check]
            RATE_CHK[Rate Check]
            DATA_VAL[Data Validation]
        end
        
        subgraph "Transformation Stage"
            ENRICH[Event Enrichment]
            FORMAT[Message Formatting]
            FILTER[Content Filtering]
            ROUTE[Smart Routing]
        end
        
        subgraph "Delivery Stage"
            TIER_SEL[Tier Selection]
            SEND[Message Sending]
            CONFIRM[Delivery Confirmation]
            RETRY[Retry Logic]
        end
    end
    
    subgraph "Storage & Persistence"
        direction LR
        EVENT_STORE[Event Store]
        RESP_STORE[Response Store]
        AUDIT_STORE[Audit Store]
        CACHE[Response Cache]
    end
    
    subgraph "Output Layer"
        TG[Telegram Bot]
        LOG[Audit Logs]
        METRICS[Metrics Export]
        NOTIFY[Notifications]
    end
    
    %% Primary Flow
    CC --> MCP_IN
    USER --> CMD_IN
    SYS --> WH_IN
    EXT --> API_IN
    
    MCP_IN --> SCHEMA
    WH_IN --> SCHEMA
    CMD_IN --> SCHEMA
    API_IN --> SCHEMA
    
    SCHEMA --> AUTH_CHK
    AUTH_CHK --> RATE_CHK
    RATE_CHK --> DATA_VAL
    
    DATA_VAL --> ENRICH
    ENRICH --> FORMAT
    FORMAT --> FILTER
    FILTER --> ROUTE
    
    ROUTE --> TIER_SEL
    TIER_SEL --> SEND
    SEND --> CONFIRM
    CONFIRM --> RETRY
    
    %% Storage Integration
    ENRICH --> EVENT_STORE
    SEND --> RESP_STORE
    AUTH_CHK --> AUDIT_STORE
    FORMAT --> CACHE
    
    %% Output Flow
    RETRY --> TG
    AUDIT_STORE --> LOG
    EVENT_STORE --> METRICS
    CONFIRM --> NOTIFY
    
    %% Styling
    classDef source fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef ingest fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef process fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef storage fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef output fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    
    class CC,USER,SYS,EXT source
    class MCP_IN,WH_IN,CMD_IN,API_IN ingest
    class SCHEMA,AUTH_CHK,RATE_CHK,DATA_VAL,ENRICH,FORMAT,FILTER,ROUTE,TIER_SEL,SEND,CONFIRM,RETRY process
    class EVENT_STORE,RESP_STORE,AUDIT_STORE,CACHE storage
    class TG,LOG,METRICS,NOTIFY output
```

### Error Handling & Recovery Patterns

```mermaid
sequenceDiagram
    participant CLIENT as Client
    participant MCP as MCP Server
    participant BRIDGE as Bridge
    participant TG as Telegram
    participant FS as File System
    participant MONITOR as Monitor
    
    Note over CLIENT, MONITOR: Happy Path
    CLIENT->>MCP: send_event
    MCP->>BRIDGE: POST /webhook
    BRIDGE->>TG: sendMessage
    TG-->>BRIDGE: 200 OK
    BRIDGE-->>MCP: 200 OK
    MCP-->>CLIENT: Success
    
    Note over CLIENT, MONITOR: Network Error Handling
    CLIENT->>MCP: send_event
    MCP->>BRIDGE: POST /webhook (timeout: 5s)
    BRIDGE--XMCP: Network Timeout
    
    alt Retry with Exponential Backoff
        MCP->>MCP: Wait 1s
        MCP->>BRIDGE: Retry #1
        BRIDGE--XMCP: Still Failed
        MCP->>MCP: Wait 2s
        MCP->>BRIDGE: Retry #2
        BRIDGE->>TG: sendMessage
        TG-->>BRIDGE: 200 OK
        BRIDGE-->>MCP: 200 OK
        MCP-->>CLIENT: Success (with retry info)
    else Circuit Breaker Opens
        MCP->>FS: Write to File Queue
        FS-->>MCP: Queued
        MCP-->>CLIENT: 202 Accepted (Queued)
        
        Note over BRIDGE, FS: Async Processing
        BRIDGE->>FS: File Watcher Detects Event
        BRIDGE->>TG: Process Queued Event
        TG-->>BRIDGE: 200 OK
        BRIDGE->>FS: Mark Processed
    end
    
    Note over CLIENT, MONITOR: Telegram API Error Handling
    CLIENT->>MCP: send_event (large message)
    MCP->>BRIDGE: POST /webhook
    BRIDGE->>TG: sendMessage
    TG-->>BRIDGE: 400 Bad Request: Message too long
    
    alt Auto-Truncation
        BRIDGE->>BRIDGE: Truncate Message
        BRIDGE->>TG: sendMessage (truncated)
        TG-->>BRIDGE: 200 OK
        BRIDGE-->>MCP: 200 OK (with warning)
        MCP-->>CLIENT: Success (truncated)
    else Message Splitting
        BRIDGE->>BRIDGE: Split into Parts
        loop For Each Part
            BRIDGE->>TG: sendMessage (part)
            TG-->>BRIDGE: 200 OK
        end
        BRIDGE-->>MCP: 200 OK (multi-part)
        MCP-->>CLIENT: Success (split)
    end
    
    Note over CLIENT, MONITOR: Authentication Error Handling
    CLIENT->>MCP: send_event (invalid token)
    MCP->>MCP: Validate Token
    MCP-->>CLIENT: 401 Unauthorized
    
    CLIENT->>MCP: send_event (expired token)
    MCP->>MCP: Check Expiration
    MCP->>MCP: Log Security Event
    MCP->>MONITOR: Security Alert
    MCP-->>CLIENT: 401 Token Expired
    
    Note over CLIENT, MONITOR: Rate Limiting Handling
    CLIENT->>MCP: send_event (rate limit exceeded)
    MCP->>MCP: Check Rate Limit
    MCP-->>CLIENT: 429 Too Many Requests (Retry-After: 60)
    
    CLIENT->>CLIENT: Wait 60s
    CLIENT->>MCP: send_event (retry)
    MCP->>BRIDGE: POST /webhook
    BRIDGE->>TG: sendMessage
    TG-->>BRIDGE: 200 OK
    BRIDGE-->>MCP: 200 OK
    MCP-->>CLIENT: Success
    
    Note over CLIENT, MONITOR: Dead Letter Queue Processing
    CLIENT->>MCP: send_event
    MCP->>BRIDGE: POST /webhook
    BRIDGE->>TG: sendMessage
    TG-->>BRIDGE: 500 Internal Server Error
    
    loop Retry Attempts (3x)
        BRIDGE->>TG: Retry sendMessage
        TG-->>BRIDGE: Still Failing
    end
    
    BRIDGE->>FS: Write to Dead Letter Queue
    BRIDGE->>MONITOR: Alert: Message Failed
    BRIDGE-->>MCP: 500 Service Temporarily Unavailable
    MCP-->>CLIENT: 503 Service Unavailable (Queued for retry)
    
    Note over FS, MONITOR: Admin Recovery Process
    MONITOR->>MONITOR: Dead Letter Queue Alert
    MONITOR->>BRIDGE: Check DLQ Status
    BRIDGE->>FS: List Failed Messages
    FS-->>BRIDGE: DLQ Contents
    
    alt Manual Recovery
        MONITOR->>BRIDGE: Reprocess Failed Messages
        loop For Each Failed Message
            BRIDGE->>TG: Retry sendMessage
            TG-->>BRIDGE: 200 OK (recovered)
        end
        BRIDGE->>FS: Clear DLQ
        BRIDGE->>MONITOR: Recovery Complete
    else Discard After Review
        MONITOR->>BRIDGE: Mark Messages as Discarded
        BRIDGE->>FS: Archive to Audit Log
        BRIDGE->>MONITOR: Discarded with Audit Trail
    end
```

### Error Categories & Response Strategies

```mermaid
graph TD
    subgraph "Error Classification"
        direction TB
        
        subgraph "Transient Errors (Retry)"
            NET[Network Timeout]
            CONN[Connection Error]
            TEMP[Temporary Service Unavailable]
            RATE[Rate Limit Exceeded]
        end
        
        subgraph "Client Errors (No Retry)"
            AUTH[Authentication Failed]
            PERM[Permission Denied]
            VAL[Validation Failed]
            FORMAT[Malformed Request]
        end
        
        subgraph "System Errors (Circuit Break)"
            DOWN[Service Down]
            OVERLOAD[System Overload]
            DB_ERR[Database Error]
            CONFIG[Configuration Error]
        end
        
        subgraph "Data Errors (Transform)"
            TOO_LONG[Message Too Long]
            INVALID[Invalid Content]
            ENCODE[Encoding Error]
            MISSING[Missing Fields]
        end
    end
    
    subgraph "Response Strategies"
        direction TB
        
        subgraph "Retry Mechanisms"
            EXP_BACKOFF[Exponential Backoff<br/>1s, 2s, 4s, 8s]
            JITTER[Random Jitter<br/>±25% variation]
            MAX_RETRY[Max 5 Retries<br/>Then fallback]
        end
        
        subgraph "Fallback Options"
            TIER_DOWN[Fallback to Lower Tier]
            FILE_QUEUE[Queue to File System]
            DLQ[Dead Letter Queue]
            TRUNCATE[Auto-Truncate Content]
        end
        
        subgraph "Recovery Actions"
            CIRCUIT_RESET[Circuit Breaker Reset]
            HEALTH_CHECK[Health Check Recovery]
            MANUAL_RETRY[Manual Administrator Retry]
            AUDIT[Audit Trail Creation]
        end
        
        subgraph "User Communication"
            IMMEDIATE[Immediate Error Response]
            ASYNC[Async Success Notification]
            DEGRADED[Degraded Service Warning]
            QUEUE_STATUS[Queue Status Update]
        end
    end
    
    %% Error to Strategy Mapping
    NET --> EXP_BACKOFF
    CONN --> EXP_BACKOFF
    TEMP --> TIER_DOWN
    RATE --> JITTER
    
    AUTH --> IMMEDIATE
    PERM --> AUDIT
    VAL --> IMMEDIATE
    FORMAT --> IMMEDIATE
    
    DOWN --> CIRCUIT_RESET
    OVERLOAD --> FILE_QUEUE
    DB_ERR --> HEALTH_CHECK
    CONFIG --> MANUAL_RETRY
    
    TOO_LONG --> TRUNCATE
    INVALID --> DLQ
    ENCODE --> DLQ
    MISSING --> AUDIT
    
    %% Recovery Flow
    EXP_BACKOFF --> MAX_RETRY
    MAX_RETRY --> FILE_QUEUE
    FILE_QUEUE --> ASYNC
    
    TIER_DOWN --> DEGRADED
    CIRCUIT_RESET --> HEALTH_CHECK
    DLQ --> MANUAL_RETRY
    
    %% Styling
    classDef transient fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef client fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef system fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef strategy fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    
    class NET,CONN,TEMP,RATE transient
    class AUTH,PERM,VAL,FORMAT client
    class DOWN,OVERLOAD,DB_ERR,CONFIG system
    class TOO_LONG,INVALID,ENCODE,MISSING data
    class EXP_BACKOFF,JITTER,MAX_RETRY,TIER_DOWN,FILE_QUEUE,DLQ,TRUNCATE,CIRCUIT_RESET,HEALTH_CHECK,MANUAL_RETRY,AUDIT,IMMEDIATE,ASYNC,DEGRADED,QUEUE_STATUS strategy
```

### Monitoring & Observability

**Key Metrics Tracked:**
- **Throughput**: Events/second, Messages/second
- **Latency**: p50, p95, p99 response times per tier
- **Error Rates**: 4xx/5xx errors, retry rates, circuit breaker trips
- **Resource Usage**: CPU, memory, disk, network utilization
- **Business Metrics**: User engagement, approval response times

**Health Check Endpoints:**
- `/health` - Basic service health
- `/health/detailed` - Component-level health status
- `/metrics` - Prometheus metrics export
- `/readiness` - Kubernetes readiness probe
- `/liveness` - Kubernetes liveness probe

**Alert Thresholds:**
```yaml
error_rate:
  warning: 1%      # Yellow alert
  critical: 5%     # Red alert
  
latency_p95:
  warning: 500ms   # Performance degradation
  critical: 2000ms # Service impact
  
circuit_breaker:
  open: immediate  # Critical alert
  half_open: info  # Recovery in progress
```

---

## Summary

The CCTelegram architecture provides:

✅ **High Performance**: Sub-100ms response times with 3-tier cascading  
✅ **Reliability**: Circuit breakers, retries, and guaranteed delivery  
✅ **Security**: Multi-layer defense with comprehensive audit logging  
✅ **Scalability**: Modular design with horizontal scaling capabilities  
✅ **Observability**: Complete monitoring, metrics, and alerting  
✅ **Developer Experience**: Rich MCP integration with 16 specialized tools  

The system successfully bridges Claude Code and Telegram while maintaining enterprise-grade reliability, security, and performance standards.
# Developer Onboarding Guide

## 👋 Welcome to CCTelegram MCP Server

This guide will help you get set up for developing, testing, and contributing to the CCTelegram MCP Server project. By the end of this guide, you'll have a complete development environment and understand the project's architecture, coding standards, and contribution workflow.

## 🎯 Learning Path

### Phase 1: Environment Setup (30 minutes)
- [ ] System requirements verification
- [ ] Development environment setup  
- [ ] Local development server running
- [ ] Basic health checks passing

### Phase 2: Understanding the Architecture (45 minutes)
- [ ] MCP protocol fundamentals
- [ ] CCTelegram Bridge integration
- [ ] Security framework overview
- [ ] Testing framework understanding

### Phase 3: First Contribution (60 minutes)
- [ ] Code exploration and analysis
- [ ] Test suite execution
- [ ] First feature implementation
- [ ] Pull request submission

## 🖥️ Development Environment Setup

### System Requirements

**Minimum Requirements:**
- **OS**: macOS 10.15+, Ubuntu 20.04+, Windows 10 with WSL2
- **Node.js**: 20.0.0 or higher
- **npm**: 10.0.0 or higher
- **Memory**: 4GB RAM (8GB recommended)
- **Storage**: 10GB available space

**Recommended Tools:**
- **IDE**: VS Code with TypeScript extensions
- **Terminal**: iTerm2 (macOS), Windows Terminal (Windows)
- **Git**: Latest version with SSH keys configured
- **Docker**: For containerized development (optional but recommended)

### Quick Setup Script

```bash
#!/bin/bash
# setup-dev-environment.sh

echo "🚀 Setting up CCTelegram MCP Server development environment..."

# Check Node.js version
if ! command -v node &> /dev/null || [[ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt "20" ]]; then
    echo "❌ Node.js 20+ is required. Please install from https://nodejs.org"
    exit 1
fi

# Clone repository
if [ ! -d "cctelegram" ]; then
    echo "📦 Cloning repository..."
    git clone https://github.com/your-org/cctelegram.git
    cd cctelegram/mcp-server
else
    echo "📦 Repository already exists, updating..."
    cd cctelegram/mcp-server
    git pull origin main
fi

# Install dependencies
echo "📚 Installing dependencies..."
npm ci

# Build project
echo "🔨 Building project..."
npm run build

# Create development configuration
echo "⚙️ Setting up development configuration..."
cp config.example.toml config.development.toml

# Create environment file
cat > .env.development << 'EOF'
NODE_ENV=development
MCP_ENABLE_AUTH=false
MCP_ENABLE_RATE_LIMIT=false
LOG_LEVEL=debug
LOG_FORMAT=pretty

# Development Telegram Bot (create a test bot with @BotFather)
TELEGRAM_BOT_TOKEN=your-dev-bot-token-here

# Development paths
CC_TELEGRAM_CONFIG_DIR=./dev-config
CC_TELEGRAM_EVENTS_DIR=./dev-events
EOF

# Create development directories
mkdir -p dev-config dev-events logs

# Set up pre-commit hooks
echo "🔧 Setting up pre-commit hooks..."
npm run setup-hooks

# Run initial tests
echo "🧪 Running initial tests..."
npm test

echo "✅ Development environment setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Update TELEGRAM_BOT_TOKEN in .env.development"
echo "2. Run 'npm run dev' to start development server"
echo "3. Run 'npm test -- --watch' for continuous testing"
echo "4. Visit http://localhost:8080/health to verify setup"
```

### Manual Setup Instructions

#### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/your-org/cctelegram.git
cd cctelegram/mcp-server

# Install dependencies
npm ci

# Build the project
npm run build
```

#### 2. Development Configuration

```bash
# Copy example configuration
cp config.example.toml config.development.toml

# Create development environment file
cat > .env.development << 'EOF'
NODE_ENV=development
MCP_ENABLE_AUTH=false
MCP_ENABLE_RATE_LIMIT=false
MCP_ENABLE_INPUT_VALIDATION=true
MCP_ENABLE_SECURE_LOGGING=true
LOG_LEVEL=debug
LOG_FORMAT=pretty

# Telegram Bot Token (get from @BotFather)
TELEGRAM_BOT_TOKEN=your-development-bot-token

# Development paths
CC_TELEGRAM_CONFIG_DIR=./dev-config
CC_TELEGRAM_EVENTS_DIR=./dev-events
CC_TELEGRAM_LOGS_DIR=./logs

# Server configuration
MCP_SERVER_HOST=127.0.0.1
MCP_SERVER_PORT=8080

# Health checks
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=30000

# Metrics
METRICS_ENABLED=true
METRICS_PORT=9090
EOF

# Create development directories
mkdir -p dev-config dev-events logs
```

#### 3. Telegram Bot Setup

1. **Create Development Bot**:
   - Message [@BotFather](https://t.me/BotFather) on Telegram
   - Send `/newbot` command
   - Follow instructions to create a bot
   - Copy the bot token to `.env.development`

2. **Configure Bot Settings**:
   ```
   /setcommands
   start - Start interacting with the bot
   health - Check system health
   status - Get bridge status
   help - Show available commands
   ```

#### 4. Start Development Server

```bash
# Start in development mode with hot reload
npm run dev

# Or start normally
npm start

# Verify server is running
curl http://localhost:8080/health
```

### VS Code Setup

#### Recommended Extensions

```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-eslint",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-json",
    "redhat.vscode-yaml",
    "ms-python.python",
    "rust-lang.rust-analyzer",
    "ms-vscode.test-adapter-converter",
    "hbenl.vscode-test-explorer"
  ]
}
```

#### Workspace Settings

```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.git": true
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true
  }
}
```

#### Debug Configuration

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Launch MCP Server",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/dist/index.js",
      "env": {
        "NODE_ENV": "development"
      },
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "envFile": "${workspaceFolder}/.env.development"
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "--detectOpenHandles"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "env": {
        "NODE_ENV": "test"
      }
    }
  ]
}
```

## 🏗️ Project Architecture Deep Dive

### Directory Structure

```
mcp-server/
├── src/                          # Source code
│   ├── index.ts                 # Main server entry point
│   ├── bridge-client.ts         # Bridge communication client
│   ├── types.ts                 # TypeScript type definitions
│   ├── security/                # Security framework
│   │   ├── auth.ts             # Authentication & authorization
│   │   ├── validation.ts       # Input validation
│   │   └── logging.ts          # Secure logging
│   ├── observability/          # Monitoring & observability
│   │   ├── metrics/            # Metrics collection
│   │   ├── logging/            # Structured logging
│   │   ├── tracing/            # Distributed tracing
│   │   ├── health/             # Health checking
│   │   ├── alerting/           # Alert management
│   │   └── dashboard/          # Web dashboard
│   └── resilience/             # Resilience framework
│       ├── circuit-breaker/    # Circuit breaker pattern
│       ├── retry/              # Retry mechanisms
│       ├── errors/             # Error handling
│       └── recovery/           # Automatic recovery
├── tests/                      # Test suites
│   ├── unit/                  # Unit tests
│   ├── integration/           # Integration tests
│   ├── performance/           # Performance tests
│   ├── fixtures/              # Test data and mocks
│   └── setup/                 # Test configuration
├── docs/                      # Documentation
│   ├── api/                   # API documentation
│   ├── security/              # Security guides
│   ├── deployment/            # Deployment guides
│   └── operations/            # Operational procedures
├── config/                    # Configuration files
├── scripts/                   # Development scripts
└── dist/                      # Compiled JavaScript output
```

### Core Components

#### 1. MCP Server (`src/index.ts`)

The main server implements the Model Context Protocol specification:

```typescript
// Key responsibilities:
// - Tool registration and handling
// - Resource management
// - Security enforcement
// - Error handling
// - Logging and monitoring

const server = new Server({
  name: 'cctelegram-mcp-server',
  version: '1.5.0',
}, {
  capabilities: {
    tools: {},
    resources: {}
  }
});
```

#### 2. Bridge Client (`src/bridge-client.ts`)

Handles communication with the CCTelegram Bridge:

```typescript
// Key responsibilities:
// - HTTP communication with Rust bridge
// - Event serialization/deserialization
// - Connection management
// - Error handling and retries

export class CCTelegramBridgeClient {
  private baseUrl: string;
  private timeout: number;
  private retryAttempts: number;
}
```

#### 3. Security Framework (`src/security/`)

Comprehensive security controls:

```typescript
// Authentication & Authorization
export interface SecurityContext {
  clientId: string;
  authenticated: boolean;
  permissions: string[];
  rateLimitInfo: RateLimitInfo;
}

// Input Validation
export const validationSchemas = {
  sendEvent: Joi.object({...}),
  sendMessage: Joi.object({...}),
  // ... more schemas
};

// Secure Logging
export function secureLog(level: string, message: string, context?: any): void;
```

#### 4. Observability System (`src/observability/`)

Production-grade monitoring and observability:

```typescript
// Metrics Collection
export class MetricsCollector {
  collectSystemMetrics(): SystemMetrics;
  collectApplicationMetrics(): ApplicationMetrics;
  recordCustomMetric(metric: CustomMetric): void;
}

// Health Monitoring
export class HealthChecker {
  performHealthCheck(): HealthResult;
  registerHealthCheck(check: HealthCheck): void;
}
```

### Data Flow Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP Client    │───▶│   MCP Server    │───▶│ CCTelegram      │
│  (Claude Code)  │    │  (TypeScript)   │    │ Bridge (Rust)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ▲                       │                       │
         │                       ▼                       ▼
         │              ┌─────────────────┐    ┌─────────────────┐
         │              │   Security      │    │   Telegram      │
         │              │   Framework     │    │   Bot API       │
         │              └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       ▼                       ▼
         │              ┌─────────────────┐    ┌─────────────────┐
         └──────────────│  Observability  │    │   Telegram      │
                        │    System       │    │   Chat/User     │
                        └─────────────────┘    └─────────────────┘
```

## 🧪 Testing Framework

### Test Structure

```
tests/
├── unit/                       # Unit tests (isolated component testing)
│   ├── bridge-client.test.ts  # Bridge client tests
│   ├── security.test.ts       # Security framework tests
│   └── types.test.ts          # Type validation tests
├── integration/                # Integration tests (component interaction)
│   └── mcp-server.integration.test.ts
├── performance/                # Performance and load tests
│   └── load.test.ts
├── fixtures/                   # Test data and mocks
│   ├── events.fixture.ts      # Sample events
│   ├── responses.fixture.ts   # Sample responses
│   └── bridge-status.fixture.ts
├── mocks/                      # Mock implementations
│   ├── axios.mock.ts          # HTTP client mocks
│   ├── fs.mock.ts             # File system mocks
│   └── child_process.mock.ts  # Process mocks
└── setup/                      # Test configuration
    └── jest.setup.ts          # Global test setup
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- bridge-client.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="should send event"

# Run integration tests only
npm run test:integration

# Run performance tests
npm run test:performance
```

### Writing Tests

#### Unit Test Example

```typescript
// tests/unit/bridge-client.test.ts
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { CCTelegramBridgeClient } from '../../src/bridge-client';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CCTelegramBridgeClient', () => {
  let client: CCTelegramBridgeClient;

  beforeEach(() => {
    client = new CCTelegramBridgeClient();
    jest.clearAllMocks();
  });

  describe('sendEvent', () => {
    it('should send event successfully', async () => {
      // Arrange
      const mockEvent = {
        type: 'task_completion',
        title: 'Test Task',
        description: 'Test description',
        source: 'test',
        timestamp: new Date().toISOString(),
        task_id: 'test-123',
        data: {}
      };

      const mockResponse = {
        status: 200,
        data: {
          success: true,
          event_id: 'evt_123456',
          message: 'Event sent successfully'
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      // Act
      const result = await client.sendEvent(mockEvent);

      // Assert
      expect(result.success).toBe(true);
      expect(result.event_id).toBe('evt_123456');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/events',
        mockEvent,
        expect.objectContaining({
          timeout: expect.any(Number),
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('should handle network errors', async () => {
      // Arrange
      const mockEvent = {
        type: 'task_completion',
        title: 'Test Task',
        description: 'Test description',
        source: 'test',
        timestamp: new Date().toISOString(),
        task_id: 'test-123',
        data: {}
      };

      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      // Act & Assert
      await expect(client.sendEvent(mockEvent)).rejects.toThrow('Network error');
    });
  });
});
```

#### Integration Test Example

```typescript
// tests/integration/mcp-server.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('MCP Server Integration', () => {
  let serverProcess: ChildProcess;
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Start MCP server
    serverProcess = spawn('node', ['dist/index.js'], {
      env: { ...process.env, NODE_ENV: 'test' }
    });

    // Create MCP client
    transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js']
    });

    client = new Client({
      name: 'test-client',
      version: '1.0.0'
    }, {
      capabilities: { tools: {} }
    });

    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  it('should list available tools', async () => {
    const result = await client.request(
      { method: 'tools/list' },
      'ListToolsResultSchema'
    );

    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThan(0);
    
    const toolNames = result.tools.map(tool => tool.name);
    expect(toolNames).toContain('send_telegram_event');
    expect(toolNames).toContain('get_bridge_status');
  });

  it('should handle tool calls with proper validation', async () => {
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'send_telegram_message',
        arguments: {
          message: 'Integration test message',
          source: 'integration-test'
        }
      }
    }, 'CallToolResultSchema');

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    
    const response = JSON.parse(result.content[0].text);
    expect(response.success).toBe(true);
    expect(response.event_id).toBeDefined();
  });
});
```

## 🔍 Code Style & Standards

### TypeScript Configuration

The project uses strict TypeScript configuration:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### ESLint Configuration

```json
{
  "extends": [
    "@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
    "prefer-const": "error",
    "no-var": "error"
  }
}
```

### Coding Standards

#### 1. Naming Conventions

```typescript
// ✅ Good: Use PascalCase for classes and interfaces
export class CCTelegramBridgeClient {
  // ✅ Good: Use camelCase for methods and variables
  private baseUrl: string;
  
  public async sendEvent(event: CCTelegramEvent): Promise<EventResponse> {
    // ✅ Good: Use SCREAMING_SNAKE_CASE for constants
    const MAX_RETRY_ATTEMPTS = 3;
    
    // ✅ Good: Use descriptive variable names
    const eventSerializationResult = this.serializeEvent(event);
    
    return eventSerializationResult;
  }
}

// ✅ Good: Use descriptive interface names with 'I' prefix for disambiguation
export interface EventResponse {
  success: boolean;
  event_id: string;
  message: string;
}

// ✅ Good: Use union types for constrained values
export type EventType = 'task_completion' | 'task_started' | 'task_failed';
```

#### 2. Function Design

```typescript
// ✅ Good: Single responsibility functions
export function validateEventType(type: string): boolean {
  const validTypes = ['task_completion', 'task_started', 'task_failed'];
  return validTypes.includes(type);
}

// ✅ Good: Pure functions when possible
export function formatEventTitle(title: string, maxLength: number = 200): string {
  return title.length > maxLength 
    ? `${title.substring(0, maxLength - 3)}...`
    : title;
}

// ✅ Good: Explicit return types
export async function fetchBridgeStatus(): Promise<BridgeStatus> {
  // Implementation
}

// ✅ Good: Error handling with proper types
export async function sendEventSafely(event: CCTelegramEvent): Promise<EventResponse | null> {
  try {
    return await sendEvent(event);
  } catch (error) {
    if (error instanceof NetworkError) {
      console.error('Network error sending event:', error.message);
      return null;
    }
    throw error; // Re-throw unexpected errors
  }
}
```

#### 3. Error Handling Patterns

```typescript
// ✅ Good: Custom error classes with context
export class BridgeConnectionError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  
  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = 'BridgeConnectionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ✅ Good: Result pattern for operations that can fail
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

export async function sendEventWithResult(event: CCTelegramEvent): Promise<Result<EventResponse>> {
  try {
    const response = await sendEvent(event);
    return { success: true, data: response };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}
```

#### 4. Documentation Standards

```typescript
/**
 * Sends a structured event to the CCTelegram Bridge for Telegram notification.
 * 
 * @param event - The event object containing notification details
 * @param options - Optional configuration for the request
 * @returns Promise resolving to the event response with ID and status
 * 
 * @throws {ValidationError} When event data fails validation
 * @throws {BridgeConnectionError} When bridge communication fails
 * @throws {RateLimitError} When rate limits are exceeded
 * 
 * @example
 * ```typescript
 * const result = await sendEvent({
 *   type: 'task_completion',
 *   title: 'Build Completed',
 *   description: 'Successfully built version 1.5.0',
 *   task_id: 'build_001',
 *   source: 'ci-pipeline'
 * });
 * 
 * console.log('Event sent with ID:', result.event_id);
 * ```
 */
export async function sendEvent(
  event: CCTelegramEvent,
  options?: RequestOptions
): Promise<EventResponse> {
  // Implementation
}
```

### Git Workflow

#### Branch Naming

```bash
# Feature branches
feature/add-performance-metrics
feature/security-audit-implementation

# Bug fix branches  
fix/bridge-connection-timeout
fix/memory-leak-in-event-processing

# Documentation branches
docs/api-usage-examples
docs/deployment-guide-updates

# Hotfix branches (for production issues)
hotfix/critical-security-patch
```

#### Commit Messages

```bash
# Format: <type>(<scope>): <subject>
# 
# Types: feat, fix, docs, style, refactor, test, chore
# Scope: component being modified
# Subject: imperative mood, present tense, no period

# Examples:
feat(security): implement API key authentication system
fix(bridge): resolve connection timeout issues
docs(api): add comprehensive usage examples
test(integration): add end-to-end workflow tests
refactor(observability): extract metrics collection to separate module
chore(deps): update dependencies to latest versions
```

## 🔄 Development Workflow

### Daily Development Process

#### 1. Start Development Session

```bash
# Update local repository
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name

# Start development server
npm run dev

# Run tests in another terminal
npm run test:watch
```

#### 2. Development Loop

```bash
# Make changes to source files
# Tests run automatically (if using test:watch)

# Run specific tests for your changes
npm test -- --testPathPattern=your-feature

# Check code quality
npm run lint
npm run type-check

# Format code
npm run format
```

#### 3. Pre-commit Validation

```bash
# Run full test suite
npm test

# Check code coverage
npm run test:coverage

# Build project
npm run build

# Run integration tests
npm run test:integration

# Verify security
npm audit
```

#### 4. Commit and Push

```bash
# Stage changes
git add .

# Commit with descriptive message
git commit -m "feat(tools): add new performance monitoring tool"

# Push to remote
git push origin feature/your-feature-name
```

### Code Review Process

#### Before Creating PR

- [ ] All tests pass locally
- [ ] Code coverage remains above 80%
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Documentation updated (if needed)
- [ ] Integration tests added (if needed)

#### PR Creation Checklist

```markdown
## Description
Brief description of changes made

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Security
- [ ] No sensitive data exposed
- [ ] Input validation implemented
- [ ] Error handling secure

## Documentation
- [ ] Code comments added
- [ ] API documentation updated
- [ ] User documentation updated
```

## 🛠️ Debugging Guide

### Common Development Issues

#### 1. MCP Connection Issues

```bash
# Check if server is running
curl http://localhost:8080/health

# Verify MCP protocol communication
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}}}' | \
  node dist/index.js

# Debug MCP client connection
DEBUG=mcp:* npm run dev
```

#### 2. Bridge Communication Problems

```bash
# Check bridge status
curl -X POST http://localhost:8080/tools/get_bridge_status

# Test bridge connectivity
nc -zv localhost 8080

# Review bridge logs
tail -f logs/bridge.log
```

#### 3. Authentication Issues

```bash
# Test without authentication (development mode)
curl -H "Content-Type: application/json" \
     -d '{"message": "test"}' \
     http://localhost:8080/tools/send_telegram_message

# Test with API key
curl -H "X-API-Key: your-test-key" \
     -H "Content-Type: application/json" \
     -d '{"message": "test"}' \
     http://localhost:8080/tools/send_telegram_message
```

### Debugging Tools

#### 1. VS Code Debugging

1. Set breakpoints in your code
2. Press F5 or use "Run and Debug" panel
3. Select "Launch MCP Server" configuration
4. Server starts with debugger attached

#### 2. Node.js Inspector

```bash
# Start with inspector
node --inspect-brk dist/index.js

# Open Chrome DevTools
# Navigate to chrome://inspect
# Click "inspect" on your Node.js process
```

#### 3. Logging Configuration

```typescript
// Increase log verbosity for debugging
process.env.LOG_LEVEL = 'debug';
process.env.LOG_FORMAT = 'pretty';

// Enable specific debug namespaces
process.env.DEBUG = 'mcp:*,cctelegram:*';
```

## 📚 Learning Resources

### MCP Protocol

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Examples](https://github.com/modelcontextprotocol/servers)

### TypeScript & Node.js

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Jest Testing Framework](https://jestjs.io/docs/getting-started)

### Security

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Checklist](https://blog.risingstack.com/node-js-security-checklist/)
- [Input Validation with Joi](https://joi.dev/api/)

### Project-Specific Resources

- [CCTelegram Bridge Documentation](../../../README.md)
- [Security Assessment](../security/security-assessment.md)  
- [API Usage Guide](../api/usage-guide.md)
- [Deployment Guide](../deployment/enterprise-guide.md)

## 🤝 Contributing Guidelines

### Code Contributions

1. **Fork the repository** and create a feature branch
2. **Follow coding standards** and write comprehensive tests
3. **Update documentation** for any API changes
4. **Submit a pull request** with clear description
5. **Respond to code review** feedback promptly

### Bug Reports

When reporting bugs, please include:

- **Environment details** (OS, Node.js version, etc.)
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Relevant logs or error messages**
- **Screenshots** (if applicable)

### Feature Requests

When requesting features:

- **Describe the use case** and business value
- **Provide implementation suggestions** (if any)
- **Consider security implications**
- **Include examples** of how it would be used

## ✅ Onboarding Checklist

### Phase 1: Environment Setup
- [ ] System requirements verified
- [ ] Repository cloned and dependencies installed
- [ ] Development environment configured
- [ ] VS Code set up with recommended extensions
- [ ] Local server running and health checks passing

### Phase 2: Knowledge Building
- [ ] Project architecture understood
- [ ] MCP protocol fundamentals learned
- [ ] Security framework reviewed
- [ ] Testing approach understood
- [ ] Code style and standards familiar

### Phase 3: First Contribution
- [ ] Issue selected or feature identified
- [ ] Feature branch created
- [ ] Code implemented with tests
- [ ] Documentation updated
- [ ] Pull request submitted and reviewed

### Phase 4: Team Integration
- [ ] Code review process participated in
- [ ] Team communication channels joined
- [ ] Development workflow mastered
- [ ] Debugging skills developed
- [ ] Contributing guidelines followed

## 🆘 Getting Help

### Internal Resources

- **Slack Channel**: #cctelegram-dev
- **Team Email**: cctelegram-team@company.com
- **Code Reviews**: Submit PR for team review
- **Architecture Questions**: @mention the architect in issues

### Office Hours

- **Monday 2-3 PM UTC**: General Q&A
- **Wednesday 10-11 AM UTC**: Architecture discussions
- **Friday 4-5 PM UTC**: Security and best practices

### Documentation

- Check the [docs/](../README.md) directory first
- Search existing [GitHub issues](https://github.com/your-org/cctelegram/issues)
- Review [API documentation](../api/usage-guide.md)
- Consult [troubleshooting guide](../operations/troubleshooting.md)

---

## 🎉 Welcome to the Team!

You're now ready to start contributing to the CCTelegram MCP Server project. Remember:

- **Ask questions** - no question is too small
- **Test thoroughly** - quality is our priority
- **Document your work** - help future developers
- **Security first** - always consider security implications
- **Have fun** - we're building something awesome together!

Happy coding! 🚀

---

*Last updated: January 2025 | Next review: April 2025*
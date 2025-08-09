# CCTelegram MCP Server Testing Framework

Comprehensive testing framework for the CCTelegram MCP Server with 16 tools, including security vulnerability validation (CVSS 9.1), performance testing, and integration testing.

## 🧪 Test Structure

```
tests/
├── setup/              # Test configuration and global setup
├── mocks/              # Mock implementations for dependencies
├── fixtures/           # Test data and sample objects
├── unit/               # Unit tests for individual components
├── integration/        # End-to-end MCP server tests
├── performance/        # Load testing and performance benchmarks
├── test-utilities.ts   # Common testing utilities
└── README.md          # This documentation
```

## 🛡️ Security Testing (CVSS 9.1 Vulnerability Validation)

### Critical Security Tests

1. **Input Validation Tests** (`security.test.ts`)
   - XSS injection prevention
   - SQL injection prevention
   - Path traversal protection
   - Oversized input handling
   - Invalid data type rejection

2. **Authentication & Authorization**
   - API key validation
   - Rate limiting enforcement
   - Security context verification
   - Unauthorized access prevention

3. **Path Sanitization**
   - Directory traversal prevention
   - Trusted path validation
   - Malicious path detection

### Running Security Tests

```bash
# Run all security tests
npm test -- --testPathPattern=security

# Run with verbose security logging
MCP_LOG_LEVEL=debug npm test -- --testPathPattern=security

# Test specific vulnerability types
npm test -- --testNamePattern="XSS|SQL|traversal"
```

## 🏗️ Unit Tests

### Coverage by Component

| Component | Coverage | Critical Tests |
|---|---|---|
| `security.ts` | 95%+ | Authentication, input validation, path sanitization |
| `bridge-client.ts` | 90%+ | All 16 MCP tools, async patterns, error handling |
| `types.ts` | 90%+ | Interface validation, type compatibility |
| `index.ts` | 85%+ | MCP server integration, request handling |

### Running Unit Tests

```bash
# Run all unit tests
npm test tests/unit/

# Run specific component tests
npm test tests/unit/security.test.ts
npm test tests/unit/bridge-client.test.ts
npm test tests/unit/types.test.ts

# Coverage report
npm test -- --coverage
```

## 🔗 Integration Tests

Tests all 16 MCP tools in realistic scenarios:

### Tool Categories Tested

1. **Event Communication** (5 tools)
   - `send_telegram_event`
   - `send_telegram_message`
   - `send_task_completion`
   - `send_performance_alert`
   - `send_approval_request`

2. **Response Management** (3 tools)
   - `get_telegram_responses`
   - `clear_old_responses`
   - `process_pending_responses`

3. **Bridge Management** (6 tools)
   - `get_bridge_status`
   - `start_bridge`
   - `stop_bridge`
   - `restart_bridge`
   - `ensure_bridge_running`
   - `check_bridge_process`

4. **Information Tools** (2 tools)
   - `list_event_types`
   - `get_task_status`

### Running Integration Tests

```bash
# Run all integration tests
npm test tests/integration/

# Test specific workflows
npm test -- --testNamePattern="workflow|end-to-end"

# Test with real bridge connection (requires setup)
CC_TELEGRAM_BRIDGE_ENABLED=true npm test tests/integration/
```

## ⚡ Performance Testing

### Load Testing Scenarios

1. **Concurrent Requests** (100+ simultaneous operations)
2. **Mixed Operations** (realistic usage patterns)
3. **Memory Usage** (sustained load testing)
4. **Error Recovery** (resilience under failures)
5. **Resource Cleanup** (memory leak detection)
6. **Stress Testing** (extreme load conditions)

### Performance Benchmarks

| Operation Type | Target (ops/sec) | Memory Limit |
|---|---|---|
| `send_event` | 50+ | <200MB |
| `send_message` | 100+ | <200MB |
| `get_status` | 200+ | <200MB |
| `get_responses` | 150+ | <200MB |
| `bridge_management` | 20+ | <200MB |

### Running Performance Tests

```bash
# Run all performance tests
npm test tests/performance/

# Extended load testing
npm test tests/performance/ -- --testTimeout=60000

# Monitor memory usage
npm test tests/performance/ -- --logHeapUsage
```

## 🎭 Mock System

### Mock Components

1. **axios.mock.ts**
   - HTTP request mocking
   - Network condition simulation
   - Health/metrics endpoint mocking

2. **fs.mock.ts**
   - File system operation mocking
   - Directory structure simulation
   - Error condition testing

3. **child_process.mock.ts**
   - Process spawning mocking
   - Bridge lifecycle simulation
   - Command execution testing

### Using Mocks

```typescript
import { mockAxios, mockFS, mockChildProcess } from '../mocks/';

beforeEach(() => {
  // Reset all mocks
  mockAxios.reset();
  mockFS.reset();
  mockChildProcess.reset();
  
  // Configure mocks
  mockAxios.mockHealthEndpoint(true);
  mockFS.createDirectory('/test/events');
  mockChildProcess.setBridgeProcessRunning(true);
});
```

## 📊 Test Data & Fixtures

### Fixture Categories

1. **EventFixtures** - Sample CCTelegram events
2. **ResponseFixtures** - Telegram response data
3. **BridgeStatusFixtures** - Bridge health data

### Creating Test Data

```typescript
import { EventFixtures, ResponseFixtures } from '../fixtures/';

// Create sample events
const taskEvent = EventFixtures.createTaskCompletionEvent();
const perfAlert = EventFixtures.createPerformanceAlertEvent();

// Create responses
const approval = ResponseFixtures.createApprovalResponse(true);
const batch = ResponseFixtures.createResponseBatch(10);
```

## 🚀 Running Tests

### Quick Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run specific test pattern
npm test -- --testNamePattern="security|validation"

# Run tests in specific directory
npm test tests/unit/

# Debug tests
npm test -- --runInBand --verbose
```

### Environment Configuration

```bash
# Test environment variables
export NODE_ENV=test
export MCP_ENABLE_AUTH=false
export MCP_ENABLE_RATE_LIMIT=false
export MCP_LOG_LEVEL=error
export CC_TELEGRAM_EVENTS_DIR=/tmp/test/events
export CC_TELEGRAM_RESPONSES_DIR=/tmp/test/responses
```

### CI/CD Integration

```bash
# CI test command
npm run test:ci

# Coverage for CI
npm test -- --coverage --coverageReporters=lcov

# Performance benchmarks for CI
npm test tests/performance/ -- --testTimeout=120000
```

## 📈 Coverage Reports

### Coverage Thresholds

- **Global**: 90% lines, 85% branches, 90% functions
- **Security Module**: 95% lines, 95% branches, 95% functions
- **Critical Paths**: 100% coverage required

### Viewing Coverage

```bash
# Generate HTML coverage report
npm test -- --coverage

# Open coverage report
open coverage/lcov-report/index.html

# Coverage summary
npm test -- --coverage --coverageReporters=text-summary
```

## 🔧 Test Configuration

### Jest Configuration

- **TypeScript Support**: ts-jest with ESM
- **Module Resolution**: Path mapping for imports
- **Timeout**: 30s default, 60s for performance tests
- **Parallel Execution**: 50% of CPU cores
- **Setup Files**: Global test configuration

### Custom Matchers

```typescript
// Extended Jest matchers
expect(uuid).toBeValidUUID();
expect(timestamp).toBeValidISO8601();
expect(securityContext).toHaveSecurityHeaders();
```

## 🐛 Debugging Tests

### Debug Configuration

```bash
# Debug specific test
node --inspect-brk node_modules/.bin/jest tests/unit/security.test.ts

# Debug with VSCode
# Use "Jest Debug" launch configuration

# Verbose logging
DEBUG=* npm test

# Log heap usage
npm test -- --logHeapUsage --verbose
```

### Common Issues

1. **Mock State Pollution**
   - Always reset mocks in `beforeEach`
   - Use `jest.clearAllMocks()`

2. **Async Test Timeouts**
   - Increase timeout for slow operations
   - Use `jest.setTimeout(30000)`

3. **Memory Leaks in Tests**
   - Check for unclosed handles
   - Use `--detectOpenHandles`

## 📚 Best Practices

### Writing Tests

1. **Test Structure**: Arrange, Act, Assert
2. **Mock Isolation**: Reset between tests
3. **Descriptive Names**: Clear test intentions
4. **Error Cases**: Test failure scenarios
5. **Security Focus**: Validate all inputs

### Performance Testing

1. **Realistic Load**: Mirror production usage
2. **Resource Monitoring**: Track memory/CPU
3. **Baseline Metrics**: Compare against benchmarks
4. **Gradual Load**: Ramp up slowly
5. **Error Recovery**: Test resilience

### Security Testing

1. **Input Validation**: Test all attack vectors
2. **Boundary Testing**: Edge cases and limits
3. **Authentication**: Verify all access controls
4. **Data Sanitization**: Ensure clean outputs
5. **Vulnerability Scanning**: Regular security audits

## 🎯 Test Goals

### Quality Targets

- ✅ **90%+ Code Coverage**
- ✅ **100% Security Vulnerability Coverage** 
- ✅ **16/16 MCP Tools Tested**
- ✅ **Performance Benchmarks Met**
- ✅ **CI/CD Pipeline Integration**
- ✅ **Zero Critical Security Issues**

### Success Metrics

1. All tests pass consistently
2. Performance benchmarks met
3. Security vulnerabilities validated
4. Memory usage within limits
5. Error recovery working
6. CI/CD integration successful

---

For questions or issues with the testing framework, please check the test output logs or run tests with `--verbose` flag for detailed information.
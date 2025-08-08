# CCTelegram Bridge - Comprehensive Automated Testing System

A production-ready automated Telegram emulation and response verification system designed to detect and resolve data staleness issues in the CCTelegram bridge.

## 🎯 Purpose

This testing system is specifically designed to detect when the CCTelegram bridge returns **old static data** (like "28/29 tasks, 96.55%") instead of **live data** from TaskMaster. The system provides:

- **Telegram Bot API Emulation**: Complete mock Telegram server with webhook support
- **Message Flow Simulation**: End-to-end message flow testing with timing analysis
- **Response Verification**: Automated verification of content, format, and data accuracy
- **Comprehensive Reporting**: Detailed analysis with actionable recommendations

## 🚀 Quick Start

### Prerequisites

1. **Node.js 18+** installed
2. **Rust and Cargo** for building the bridge
3. **CCTelegram bridge** compiled (`cargo build --release`)
4. **MCP server** set up in the `mcp-server/` directory

### Installation

```bash
cd tests/emulation
npm install
```

### Running Tests

```bash
# Run all tests with full reporting
npm test

# Test only data staleness detection (recommended first)
npm run test:staleness

# Run basic functionality tests
npm run test:basic

# Run performance stress tests
npm run test:performance

# List available test configurations
npm run list-configs
```

### Advanced Usage

```bash
# Run specific configurations
npx tsx run-comprehensive-tests.ts --config "Data Staleness Detection,Basic Functionality Test"

# Run tests in parallel for faster execution
npm run test:parallel

# Keep test environment running for debugging
npm run test:no-cleanup

# Verbose output with detailed logging
npx tsx run-comprehensive-tests.ts --verbose
```

## 📊 Understanding Test Results

### Critical Success Criteria

The system will **PASS** only if:
- ✅ No stale data patterns detected (28/29, 96.55%, etc.)
- ✅ Task counts match live TaskMaster data
- ✅ Response times under 5 seconds
- ✅ 80%+ test success rate

### Failure Indicators

🚨 **CRITICAL FAILURES** that require immediate attention:
- **Stale Data Detected**: Old static data returned instead of live data
- **Task Count Mismatches**: Calculated totals don't match reported totals
- **MCP Connection Issues**: Bridge can't communicate with TaskMaster

⚠️ **WARNINGS** that should be investigated:
- High response times (>3 seconds)
- Progress bar calculation errors
- Markdown formatting issues

## 🧪 Test Configurations

### 1. Data Staleness Detection
**Purpose**: Detect the specific issue of stale data being returned
- **Scenarios**: Multiple `/tasks` command executions
- **Validation**: Checks for "28/29", "96.55%" patterns
- **Expected Data**: Compares against current TaskMaster state
- **Critical for**: Resolving the primary issue

### 2. Basic Functionality Test
**Purpose**: Comprehensive functionality verification
- **Scenarios**: `/tasks`, `/todo`, `/bridge`, `/start` commands
- **Validation**: Format, content, timing, API compliance
- **Expected Data**: Standard functionality checks
- **Critical for**: Overall system health

### 3. Performance Stress Test
**Purpose**: System performance under load
- **Load Test**: 5 concurrent users, 30-second duration
- **Failure Simulation**: 5% random failure rate
- **Scenarios**: Rapid command execution
- **Critical for**: Production readiness

## 🔍 Key Components

### 1. Telegram Bot API Emulator (`telegram-bot-api-emulator.ts`)
- **Complete Bot API**: All major endpoints with proper responses
- **Webhook Support**: Receives bridge requests and logs interactions
- **Rate Limiting**: Simulates Telegram's rate limits
- **Failure Simulation**: Tests error handling and resilience
- **Authentication**: Mock user validation and permissions

### 2. Message Flow Simulator (`message-flow-simulator.ts`)
- **End-to-End Flows**: User action → webhook → bridge → response → verification
- **Timing Analysis**: Measures response times and identifies bottlenecks
- **Parallel Execution**: Supports concurrent user simulation
- **Load Testing**: Configurable concurrent users and duration
- **Scenario Management**: Predefined test scenarios with expected outcomes

### 3. Response Verification Engine (`response-verification-engine.ts`)
- **Content Verification**: Validates message format and content
- **Data Accuracy**: Detects stale data patterns and inconsistencies  
- **Progress Bars**: Verifies calculation accuracy and visual representation
- **Format Compliance**: Ensures proper Markdown and API compliance
- **Custom Rules**: Extensible rule system for specific validations

### 4. Test Automation Orchestrator (`test-automation-orchestrator.ts`)
- **Process Management**: Starts/stops bridge, MCP server, emulator
- **Component Coordination**: Manages communication between components
- **Configuration Management**: Handles different test configurations
- **Reporting**: Generates comprehensive test reports
- **Cleanup**: Ensures proper resource cleanup after tests

## 📈 Interpreting Results

### Success Output Example
```
🎯 TEST EXECUTION SUMMARY
========================================
Total Duration: 45.32s
Configurations Run: 3
✅ Passed: 3
❌ Failed: 0
💥 Errors: 0
📊 Success Rate: 100.0%

🚨 CRITICAL FINDINGS
-------------------------
✅ No stale data issues detected
✅ No other critical issues found

⚡ PERFORMANCE SUMMARY
-------------------------
Average Response Time: 1,247ms
✅ Response times within acceptable limits

🎉 OVERALL VERDICT: SYSTEM HEALTHY ✅
```

### Failure Output Example
```
🚨 CRITICAL FINDINGS
-------------------------
❌ STALE DATA DETECTED: 3 instances
   🔧 ACTION REQUIRED: TaskMaster integration is returning old data
   📋 RECOMMENDATION: Check MCP server connection and TaskMaster file access
⚠️ OTHER CRITICAL ISSUES: 2 found
   📋 RECOMMENDATION: Review verification reports for details

🚨 OVERALL VERDICT: CRITICAL ISSUES DETECTED ❌
   🔧 Immediate action required to resolve data staleness
```

## 🛠️ Debugging and Development

### Debug Mode
```bash
# Keep test environment running for investigation
npm run dev

# Run with verbose logging and no cleanup
npm run test:no-cleanup
```

### Log Analysis
All logs are stored in `tests/emulation/logs/`:
- **Emulator logs**: Telegram API interactions and webhook calls
- **Flow logs**: Complete message flow timing and step analysis
- **Verification logs**: Detailed rule execution and failure analysis
- **Final reports**: JSON and text summaries with recommendations

### Component Testing
```bash
# Test only the emulator
npx tsx -e "
import { TelegramBotApiEmulator } from './telegram-bot-api-emulator.js';
const emulator = new TelegramBotApiEmulator(8081, './logs');
await emulator.start();
console.log('Emulator running on http://localhost:8081');
"

# Test verification rules
npx tsx -e "
import { ResponseVerificationEngine } from './response-verification-engine.js';
const engine = new ResponseVerificationEngine('./logs');
const result = await engine.verifyMessage('test-1', 'TaskMaster Status: 28/29 tasks (96.55%)', 'command_response');
console.log('Verification result:', result);
"
```

## 🔧 Configuration and Customization

### Adding New Test Scenarios
```typescript
// In message-flow-simulator.ts
this.addScenario({
  id: 'custom-scenario',
  name: 'Custom Test Scenario',
  description: 'Test specific functionality',
  command: '/custom-command',
  expectedResponsePattern: /Expected Pattern/,
  expectedSteps: 4,
  timeoutMs: 10000,
  validationChecks: [
    async (flow: MessageFlow) => {
      // Custom validation logic
      return flow.steps.length >= 3;
    }
  ]
});
```

### Adding New Verification Rules
```typescript
// In response-verification-engine.ts
this.addRule({
  id: 'custom-rule',
  name: 'Custom Validation Rule',
  description: 'Validates specific content patterns',
  type: 'content',
  validator: async ({ content, metadata }) => {
    const isValid = /* your validation logic */;
    return {
      ruleId: 'custom-rule',
      success: isValid,
      message: isValid ? 'Validation passed' : 'Validation failed',
      severity: 'error',
      timestamp: performance.now()
    };
  },
  severity: 'error',
  category: 'content',
  enabled: true
});
```

### Custom Test Configuration
```typescript
const customConfig: TestConfiguration = {
  name: 'Custom Test',
  description: 'Custom test configuration',
  
  telegramEmulator: {
    port: 8090,
    responseDelay: 200,
    simulateFailures: true,
    failureRate: 0.1
  },
  
  bridge: {
    executable: 'cargo run --release',
    startupTimeout: 30000,
    healthCheckInterval: 500,
    webhookUrl: 'http://localhost:8090/webhook',
    env: {
      CUSTOM_ENV_VAR: 'value'
    }
  },
  
  scenarios: ['custom-scenario'],
  expectedData: {
    completed: 25,
    total: 30
  },
  
  parallel: false,
  repeatCount: 3,
  timeoutMs: 60000,
  cleanup: true
};
```

## 🚨 Critical Success Criteria

The testing system **MUST** detect when:
1. Old static data (28/29, 96.55%) is returned instead of live data
2. Task counts don't match current TaskMaster state
3. Progress bar percentages are calculated incorrectly
4. Response times exceed acceptable limits (>5s)
5. System fails to handle basic commands properly

## 📋 Troubleshooting

### Common Issues

**"Bridge executable not found"**
- Run `cargo build --release` in the project root
- Verify `target/release/` directory exists

**"MCP server not found"**
- Check `mcp-server/package.json` exists
- Run `npm install` in the mcp-server directory

**"Port already in use"**
- Kill existing processes: `pkill -f "8081|8082|8083"`
- Use different ports in configuration

**"Webhook timeout"**
- Check bridge logs for startup errors
- Verify bridge is listening on webhook URL
- Ensure no firewall blocking local connections

### Debug Commands

```bash
# Check running processes
ps aux | grep -E "(cctelegram|node|cargo)"

# Check port usage
netstat -tlnp | grep -E "808[1-3]|3000|8080"

# Bridge manual test
cargo run --release

# MCP server manual test
cd mcp-server && npm start
```

## 🎯 Integration with Playwright Framework

This system integrates with the existing Playwright testing framework:

```bash
# Run both systems together
npm run test && cd ../playwright && npm test
```

The emulation system can be used as a component within Playwright tests for end-to-end integration testing.

## 📝 Continuous Integration

For CI/CD integration:

```yaml
# GitHub Actions example
- name: Run CCTelegram Emulation Tests
  run: |
    cd tests/emulation
    npm install
    npm run test:all
  timeout-minutes: 10
```

## 🔮 Future Enhancements

- **Real Telegram API Integration**: Test against actual Telegram API with test bots
- **Multi-Bridge Testing**: Support testing multiple bridge instances simultaneously  
- **Historical Data Comparison**: Track data consistency over time
- **Visual Dashboard**: Web-based test result visualization
- **Automated Fixing**: Suggest and apply fixes for detected issues

---

## 📞 Support

If tests consistently show stale data issues:

1. **Check MCP Server Connection**: Ensure MCP server can reach TaskMaster files
2. **Verify TaskMaster State**: Confirm `.taskmaster/tasks/tasks.json` has current data
3. **Review Bridge Logs**: Look for TaskMaster integration errors in bridge output
4. **Test MCP Direct**: Test MCP server directly with `curl` or similar tools
5. **Update Expected Data**: Update test configuration with current TaskMaster values

The system is designed to run continuously until the data staleness issue is completely resolved and verified through multiple test iterations.
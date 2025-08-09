# CCTelegram Bridge Debug Test Suite

A comprehensive Playwright-based testing framework specifically designed to debug the CCTelegram bridge `/tasks` command issue where users see old static data instead of live TaskMaster data.

## 🎯 Problem Statement

**Issue**: Users are seeing old static data (28/29 tasks, 96.55%) instead of live TaskMaster data when using the `/tasks` command.

**Goal**: Use systematic automated testing to identify the root cause and validate fixes for the data flow issue between TaskMaster, MCP server, and the Telegram bridge.

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   TaskMaster    │    │   MCP Server    │    │  Bridge (Rust)  │
│   (.taskmaster) │────│  (Node.js)      │────│                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                       │
┌─────────────────┐    ┌─────────────────┐            │
│ Telegram Mock   │────│  Playwright     │────────────┘
│   (Express)     │    │   Test Suite    │
└─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

1. **Install Dependencies**
   ```bash
   cd tests/playwright
   npm run setup
   ```

2. **Run Debug Tests**
   ```bash
   npm run test:bridge-debug
   ```

3. **View Results**
   ```bash
   npm run test:report
   ```

## 📁 Project Structure

```
tests/playwright/
├── cctelegram-bridge-debug.spec.ts    # Main debug test suite
├── utils/
│   ├── bridge-process-manager.ts      # Manages Rust bridge process
│   ├── mcp-test-client.ts            # MCP server testing client
│   ├── telegram-mock-server.ts       # Mock Telegram Bot API
│   ├── taskmaster-data-generator.ts  # Creates test TaskMaster data
│   └── debug-logger.ts               # Enhanced logging system
├── setup/
│   ├── global-setup.ts               # Test environment setup
│   └── global-teardown.ts            # Cleanup and reporting
├── reporters/
│   └── debug-reporter.ts             # Custom debug-focused reporter
├── scripts/
│   └── start-mock-services.js        # Mock service launcher
└── README.md                         # This file
```

## 🧪 Test Strategy

### 1. Data Flow Analysis

**Step 1: TaskMaster File Verification**
- ✅ Verify TaskMaster file structure is correct
- ✅ Generate test data with expected live values (27/30 tasks, 90%)
- ✅ Confirm file timestamps and data integrity

**Step 2: MCP Server Testing**
- ✅ Test MCP server `get_task_status` function directly
- ✅ Verify MCP response format and data structure
- ✅ Check TaskMaster data transformation logic

**Step 3: Bridge MCP Integration**
- ✅ Test Rust bridge MCP connection
- ✅ Verify bridge can call MCP functions successfully
- ✅ Check data transformation in `connection.rs`

**Step 4: End-to-End /tasks Command**
- ✅ Simulate `/tasks` command from Telegram
- ✅ Capture actual response sent to user
- ✅ Compare response data with expected live data

### 2. Issue Diagnosis

**Data Source Priority Testing**
- Remove TaskMaster file → Test MCP fallback
- Stop MCP server → Test file fallback  
- Both available → Identify which takes priority

**Code Path Analysis**
- Enable maximum debug logging
- Trace execution path for `/tasks` command
- Identify where old data is coming from

**Cache Investigation**
- Check for cached responses in bridge
- Test cache invalidation mechanisms
- Verify data freshness validation

### 3. Fix Validation

**Apply Potential Fixes**
- Clear bridge caches
- Force MCP refresh
- Update file timestamps
- Restart bridge with clean state

**Validate Fix**
- Re-run `/tasks` command test
- Confirm live data is returned
- Verify no regression in other functionality

## 🔧 Configuration

### Environment Variables

```bash
# Bridge settings
CC_TELEGRAM_HEALTH_PORT=8080
CC_TELEGRAM_WEBHOOK_PORT=3000
CC_TELEGRAM_BOT_TOKEN=test-bot-token
CC_TELEGRAM_ALLOWED_USERS=123456789

# Debug settings
RUST_LOG=debug
RUST_BACKTRACE=1

# MCP server settings
MCP_ENABLE_AUTH=false
MCP_ENABLE_RATE_LIMIT=false
MCP_LOG_LEVEL=debug
```

### Test Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  timeout: 120000,        // 2 minutes per test
  workers: 1,             // Sequential execution for debugging
  retries: 0,             // No retries during debugging
  headless: false,        // Show browser for visual debugging
  reporter: [
    ['html'],
    ['./reporters/debug-reporter.ts']  // Custom debugging output
  ]
});
```

## 📊 Test Output

### Console Output
```
🔍 CCTelegram Bridge Debug Reporter
=====================================
Starting debugging tests at 2024-01-15T10:30:00.000Z
Focus: /tasks command data source issue
=====================================

🧪 Step 1: Verify TaskMaster File Data Structure
────────────────────────────────────────────────
✅ Step 1: Verify TaskMaster File Data Structure (1250ms)
   📝 Debug Info:
      ✓ TaskMaster file exists
      ✓ TaskMaster file structure is valid
      ✓ TaskMaster file contains expected data

🏁 Debug Session Complete
==========================
Total Time: 45000ms
Tests: 4 passed, 0 failed, 0 skipped

🔍 Bridge Issue Analysis:
-------------------------
📁 Data Source Tests:
  ✅ Step 1: Verify TaskMaster File Data Structure
     💡 Expected stats: {completed: 27, total: 30}
     💡 Actual file stats: {completed: 27, total: 30}

❌ Issues Detected:
  ❌ Old static data detected (in Step 4: Test /tasks Command End-to-End)
     📋 Evidence: Response contains: 28/29 tasks, 96.55%

🎯 Next Steps:
1. Review debug report for specific issue identification
2. Check bridge logs for MCP connection details
3. Verify TaskMaster data source priority logic
4. Apply fixes based on analysis and re-run tests
```

### Generated Reports

1. **HTML Report**: `test-results/report/index.html`
   - Visual test execution timeline
   - Screenshots and videos of failures
   - Detailed error traces

2. **Debug Analysis**: `test-results/debug-analysis.json`
   - Structured analysis of bridge behavior
   - Data source test results
   - Issue diagnosis with evidence
   - Specific fix recommendations

3. **Test Summary**: `test-results/test-summary.md`
   - Markdown summary of test execution
   - Issue description and findings
   - Next steps for resolution

## 🛠️ Available Commands

### Primary Commands
```bash
npm run test:bridge-debug    # Run main debugging suite
npm run test:headed          # Run with browser visible
npm run test:debug           # Run with Playwright inspector
npm run debug-bridge         # Run with no timeout for deep debugging
```

### Utility Commands
```bash
npm run start-mocks          # Start mock services independently
npm run test:report          # View HTML test report
npm run clean                # Clean test artifacts
npm run build                # Compile TypeScript
```

## 🔍 Debugging Tips

### 1. Enable Verbose Logging
```bash
RUST_LOG=trace npm run test:bridge-debug
```

### 2. Inspect Network Traffic
The tests automatically capture all HTTP requests between components. Check the debug report for network analysis.

### 3. Use Playwright Inspector
```bash
npm run test:debug
```
This opens the Playwright inspector for step-by-step debugging.

### 4. Check Mock Services
```bash
curl http://localhost:3002/debug/messages
curl http://localhost:3003/status
```

### 5. Analyze Log Files
All detailed logs are saved to `test-results/logs/` with timestamps and component identification.

## 🚨 Common Issues

### Bridge Binary Not Found
```bash
# Build the Rust bridge first
cd ../../
cargo build --release
```

### MCP Server Not Built
```bash
# Build the MCP server
cd ../../mcp-server
npm run build
```

### Port Conflicts
If ports 8080, 3000, 3001, or 3002 are in use, update the configuration in the test files.

### Permission Issues
Ensure the bridge binary has execute permissions:
```bash
chmod +x target/release/cc-telegram-bridge
```

## 📈 Success Criteria

The debugging suite is successful when:

1. ✅ All data source tests pass
2. ✅ MCP connection tests pass  
3. ✅ `/tasks` command returns live data (27/30 tasks, 90%)
4. ❌ No static data detected (28/29 tasks, 96.55%)
5. ✅ Bridge logs show correct data source priority
6. ✅ Response format matches expected structure

## 🔄 Iterative Process

1. **Run Tests** → Identify specific issues
2. **Apply Fixes** → Based on debug analysis
3. **Re-run Tests** → Validate fixes work
4. **Repeat** → Until all tests pass consistently

This systematic approach ensures we can identify and resolve the data source issue efficiently while maintaining comprehensive test coverage for future changes.

## 📞 Support

For questions or issues with the test framework:
1. Check the debug analysis report for specific guidance
2. Review test logs in `test-results/logs/`
3. Examine the custom debug reporter output
4. Run individual test steps for isolated debugging
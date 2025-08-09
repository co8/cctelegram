# End-to-End Workflow Tests for CCTelegram Bridge

Comprehensive E2E testing suite using Playwright for complete user journey validation from Telegram message receipt through Claude Code notifications.

## Overview

This E2E testing suite implements **Task 25.2** and provides comprehensive workflow testing that includes:

- **Complete User Journeys**: Full workflows from event creation → bridge processing → Telegram notifications → user responses
- **Cross-Browser Testing**: Chrome, Firefox, Safari compatibility across desktop and mobile
- **Error Scenario Testing**: Network failures, API timeouts, recovery path validation  
- **Visual Regression Testing**: Screenshot comparison and UI consistency validation
- **Performance Testing**: Load testing, memory stability, concurrent user simulation
- **Mobile Testing**: Touch interactions, responsive design, network condition simulation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    E2E Test Architecture                    │
├─────────────────────────────────────────────────────────────┤
│  Playwright Test Runner                                     │
│  ├── Chrome Desktop/Mobile    ├── Visual Regression        │
│  ├── Firefox Desktop          ├── Performance Tests        │
│  ├── Safari Desktop/Mobile    └── Accessibility Tests      │
│  └── Network Simulations                                   │
├─────────────────────────────────────────────────────────────┤
│  Test Utilities & Helpers                                  │
│  ├── TelegramBotSimulator    ├── Visual Regression         │
│  ├── WorkflowTestHelpers     ├── Performance Helpers       │
│  └── Global Setup/Teardown   └── Mock Services             │
├─────────────────────────────────────────────────────────────┤
│  Bridge & Services Under Test                              │
│  ├── CCTelegram Bridge       ├── Health Dashboard          │
│  ├── MCP Webhook Server      ├── File Watcher System       │
│  └── Telegram API Mock       └── Event Processing System   │
└─────────────────────────────────────────────────────────────┘
```

## Test Files Structure

```
tests/e2e/
├── README.md                           # This documentation
├── telegram-bridge-workflow.e2e.test.ts   # Main workflow tests
├── dashboard.e2e.test.ts               # Dashboard UI tests
├── bridge-health.e2e.test.ts           # API health tests
├── mobile-dashboard.e2e.test.ts        # Mobile-specific tests
└── performance-workflows.e2e.test.ts   # Performance & load tests

tests/utils/
├── telegram-bot-simulator.ts          # Telegram API simulation
├── workflow-test-helpers.ts           # Bridge & file management
└── visual-regression-helpers.ts       # Screenshot comparison

tests/setup/
├── global-setup.ts                    # Test environment setup
└── global-teardown.ts                 # Cleanup and reporting

tests/fixtures/
└── event-fixtures.ts                  # Test data fixtures
```

## Quick Start

### Prerequisites

1. **Node.js 20+** and npm
2. **Playwright browsers** installed:
   ```bash
   npx playwright install
   ```
3. **CCTelegram Bridge** binary (optional, can run with mocks)
4. **Environment variables** (optional):
   ```bash
   export CC_TELEGRAM_BRIDGE_PATH="/path/to/bridge/binary"
   export TEST_TELEGRAM_BOT_TOKEN="your-test-token"
   export TEST_TELEGRAM_CHAT_ID="your-test-chat-id"
   ```

### Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with browser UI (interactive)
npm run test:e2e:ui

# Run specific test categories
npm run test:e2e:workflows      # Main workflow tests
npm run test:e2e:mobile         # Mobile-specific tests
npm run test:e2e:performance    # Performance tests
npm run test:e2e:visual         # Visual regression tests

# Cross-browser testing
npm run test:e2e:cross-browser

# Debug mode (step through tests)
npm run test:e2e:debug

# Headed mode (see browser)
npm run test:e2e:headed
```

### Test Environment Options

```bash
# Run without bridge process (mock-only)
START_BRIDGE=false npm run test:e2e

# Keep test files for debugging
CLEANUP_TEST_FILES=false npm run test:e2e

# Disable mock Telegram API
MOCK_TELEGRAM_API=false npm run test:e2e

# Slow motion for debugging
SLOW_MO=1000 npm run test:e2e:headed

# Headless mode in non-CI
HEADLESS=true npm run test:e2e
```

## Test Scenarios

### 1. Complete User Journey Workflows

**Task Completion Workflow** (`telegram-bridge-workflow.e2e.test.ts`):
```typescript
// Tests: Event → Bridge → Telegram → Claude Code
1. Create task completion event file
2. Wait for bridge processing (3-tier cascade)
3. Verify Telegram message sent with correct formatting
4. Simulate user response in Telegram
5. Verify response captured and processed
6. Take workflow screenshots for visual validation
```

**Performance Alert Workflow**:
```typescript
// Tests: Alert → Dashboard → User Action
1. Create performance alert event
2. Load health dashboard in browser
3. Verify alert displayed with proper styling
4. Validate Telegram notification sent
5. Test user interaction with alert
```

**Approval Request Workflow**:
```typescript
// Tests: Request → Telegram → Response → Processing  
1. Create approval request event
2. Verify Telegram message with inline buttons
3. Simulate user clicking approval button
4. Validate response processing and confirmation
```

### 2. Error Scenarios & Recovery Paths

**Network Failure Recovery**:
- Simulate bridge offline condition
- Create events during downtime  
- Verify recovery and queued event processing
- Test 3-tier cascade fallback mechanisms

**API Timeout Handling**:
- Configure slow Telegram API responses (15s delay)
- Test timeout detection and fallback processing
- Verify file-tier processing when API fails

**Invalid Event Handling**:
- Test malformed event data validation
- Verify error logging and rejection
- Ensure system stability with bad input

### 3. Visual Regression Testing

**Dashboard Visual Consistency**:
```typescript
// Baseline → Update → Compare workflow
1. Capture baseline screenshot
2. Simulate metrics update  
3. Capture updated screenshot
4. Compare with pixel-level analysis
5. Generate visual diff reports
```

**Mobile Responsiveness**:
- Test layout adaptation across viewports
- Verify touch interaction compatibility  
- Compare mobile vs desktop layouts

### 4. Cross-Browser Compatibility

**Desktop Browsers**:
- **Chrome**: Full workflow testing with advanced debugging
- **Firefox**: Cross-browser validation with Gecko engine
- **Safari**: WebKit compatibility testing

**Mobile Browsers**:
- **Mobile Chrome**: Android simulation with touch events
- **Mobile Safari**: iOS simulation with device-specific features

**Specialized Testing**:
- **High DPI**: 2x scaling factor testing
- **Slow Network**: 3G simulation with latency
- **Accessibility**: Reduced motion and high contrast

### 5. Performance & Load Testing

**High-Volume Processing**:
```typescript
// Test 50 concurrent events
const events = Array.from({ length: 50 }, createTestEvent);
const results = await Promise.all(events.map(processEvent));
// Assert: >90% success rate, <2min total time
```

**Memory Stability**:
- Monitor memory usage over 30-second test period
- Create events every 2 seconds
- Assert: <1GB max memory, <200MB growth

**Concurrent Users**:
- Simulate 5 simultaneous dashboard users
- Measure individual and average load times
- Assert: <5s average, <10s maximum load time

## Configuration

### Playwright Configuration (`playwright.config.ts`)

**Enhanced Features**:
- **11 Browser Projects**: Desktop + Mobile + Specialized scenarios
- **Visual Regression**: Built-in screenshot comparison with 0.2 threshold
- **Global Setup/Teardown**: Automated environment management
- **Extended Timeouts**: 120s for complex workflows
- **CI Integration**: GitHub Actions compatibility

**Project Matrix**:
```typescript
projects: [
  'API Tests',                    // Headless API testing
  'Chrome Desktop - Workflows',   // Primary workflow testing  
  'Firefox Desktop - Workflows',  // Cross-browser validation
  'Safari Desktop - Workflows',   // WebKit compatibility
  'Chrome/Firefox/Safari - Dashboard', // UI-specific testing
  'Mobile Chrome/Safari',         // Mobile platforms
  'iPad - Tablet Testing',        // Tablet scenarios
  'Chrome - High DPI',           // High resolution testing
  'Chrome - Slow Network',       // Network condition simulation
  'Chrome - Accessibility'       // A11y testing
]
```

### Environment Variables

**Required**:
- `CC_TELEGRAM_HEALTH_PORT` - Bridge health endpoint port (default: 8080)
- `CC_TELEGRAM_WEBHOOK_PORT` - Bridge webhook port (default: 3000)

**Optional**:
- `CC_TELEGRAM_BRIDGE_PATH` - Path to bridge binary for real testing
- `TEST_TELEGRAM_BOT_TOKEN` - Telegram bot token for API testing
- `TEST_TELEGRAM_CHAT_ID` - Test chat ID for message validation
- `CLEANUP_TEST_FILES` - Keep test files for debugging (default: true)
- `START_BRIDGE` - Start real bridge process (default: true if path set)
- `MOCK_TELEGRAM_API` - Enable mock Telegram server (default: true)

## Test Utilities

### TelegramBotSimulator

Comprehensive Telegram API simulation with realistic message formatting:

```typescript
const telegramBot = new TelegramBotSimulator(config);

// Simulate incoming messages
const message = await telegramBot.simulateIncomingMessage(
  'Task completed successfully! ✅',
  { event_id: 'task-123', buttons: [{ text: 'Acknowledge', action: 'ack' }] }
);

// Simulate user responses  
const response = await telegramBot.simulateUserResponse(
  message.message_id, 
  '👍 Great work!'
);

// Wait for specific messages
const taskMessage = await telegramBot.waitForMessage('task completed', 5000);
```

### WorkflowTestHelpers

Bridge process and file management utilities:

```typescript
const helpers = new WorkflowTestHelpers(config);

// Bridge process management
const bridge = await helpers.startBridgeProcess();
await helpers.waitForBridgeHealth();

// Event file operations
const eventFile = await helpers.createEventFile(eventData);
const result = await helpers.waitForEventProcessing(eventId, { timeout: 10000 });

// Response file monitoring
const response = await helpers.waitForResponseFile(responseId, 5000);
```

### VisualRegressionHelpers

Advanced screenshot comparison and visual testing:

```typescript
const visual = new VisualRegressionHelpers(screenshotDir);

// Capture workflow screenshots
const screenshot = await visual.captureWorkflowScreenshot(page, 'task-completion');

// Run visual regression tests
const test = await visual.runVisualTest(page, 'dashboard-layout', {
  mask: [{ selector: '[data-testid="timestamp"]' }],
  threshold: 0.2
});

// Generate comprehensive reports
await visual.generateVisualReport([test]);
```

## Test Reports & Artifacts

### Generated Reports

1. **HTML Report**: `test-results/playwright-report/index.html`
   - Interactive test results with screenshots and videos
   - Detailed error traces and performance metrics
   - Cross-browser comparison views

2. **JSON Report**: `test-results/playwright-results.json`
   - Machine-readable test results for CI integration
   - Performance data and timing information

3. **Visual Report**: `test-results/screenshots/visual-test-report.html`
   - Side-by-side screenshot comparisons
   - Pixel difference analysis and statistics
   - Mobile vs desktop layout comparisons

4. **Final Summary**: `test-results/TEST-SUMMARY.md`
   - Markdown summary with key metrics
   - Environment information and configuration
   - Test coverage breakdown

### Test Artifacts

- **Screenshots**: `test-results/screenshots/`
  - Workflow progression screenshots
  - Error state captures
  - Visual regression baselines and diffs
  
- **Videos**: `test-results/playwright-output/`
  - Full test execution recordings
  - Failure reproduction videos
  - Cross-browser behavior comparisons

- **Traces**: `test-results/playwright-output/`
  - Detailed execution traces with DOM snapshots
  - Network request/response logs
  - Performance timeline data

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run E2E Tests
  run: |
    npm run test:e2e
  env:
    CI: true
    CLEANUP_TEST_FILES: false
    START_BRIDGE: false

- name: Upload Test Results
  uses: actions/upload-artifact@v3
  if: always()
  with:
    name: e2e-test-results
    path: test-results/
```

### Docker Integration

```dockerfile
# Install Playwright browsers in CI image
RUN npx playwright install --with-deps chromium firefox webkit
```

## Troubleshooting

### Common Issues

1. **Bridge Connection Refused**
   ```bash
   # Check if bridge is running
   curl http://localhost:8080/health
   
   # Run with mocks only
   START_BRIDGE=false npm run test:e2e
   ```

2. **Port Conflicts**
   ```bash
   # Check port usage
   lsof -i :8080 -i :3000
   
   # Use different ports
   CC_TELEGRAM_HEALTH_PORT=8081 npm run test:e2e
   ```

3. **Visual Test Failures**
   ```bash
   # Update baselines
   rm -rf test-results/screenshots/baseline/
   npm run test:e2e:visual
   
   # Adjust threshold
   export VISUAL_THRESHOLD=0.5
   ```

4. **Flaky Tests**
   ```bash
   # Run with retries
   npm run test:e2e -- --retries=3
   
   # Debug mode
   npm run test:e2e:debug --grep="flaky-test"
   ```

### Debug Mode

```bash
# Step through tests interactively
npm run test:e2e:debug

# Keep browser open for inspection
npm run test:e2e:headed -- --headed

# Slow motion execution
SLOW_MO=2000 npm run test:e2e:headed

# Verbose output
DEBUG=* npm run test:e2e
```

### Test Data Inspection

```bash
# Keep test files for debugging
CLEANUP_TEST_FILES=false npm run test:e2e

# Check generated events
ls -la /tmp/test-events/

# View test logs
cat test-results/final-report.json
```

## Performance Benchmarks

### Expected Performance Targets

| Test Scenario | Success Rate | Max Duration | Avg Response Time |
|---------------|-------------|--------------|------------------|
| Task Completion Workflow | >95% | <30s | <5s |
| Performance Alert | >90% | <20s | <3s |
| Dashboard Load (Desktop) | >98% | <3s | <1s |
| Dashboard Load (Mobile) | >95% | <5s | <2s |
| 50 Concurrent Events | >90% | <120s | <2s/event |
| Cross-Browser Compatibility | >95% | <10s | <3s |

### Resource Usage Limits

- **Memory**: <1GB peak, <200MB growth over 30s test
- **CPU**: <80% sustained usage during load tests  
- **Network**: <10MB total data transfer for full test suite
- **Disk**: <100MB test artifacts (excluding videos)

## Contributing

### Adding New Tests

1. **Create test file** in appropriate category directory
2. **Follow naming convention**: `feature-type.e2e.test.ts`
3. **Use test utilities** for consistency and reliability
4. **Add visual tests** for UI changes
5. **Update documentation** with new scenarios

### Test Development Guidelines

- **Test real user scenarios**, not just API endpoints
- **Use data-testid attributes** for reliable element selection
- **Mock external services** but test real bridge functionality
- **Include error scenarios** and edge cases
- **Capture screenshots** for visual validation
- **Add performance assertions** for critical paths

---

## Summary

This comprehensive E2E testing suite provides:

✅ **Complete workflow coverage** from event creation to user response
✅ **Cross-browser compatibility** testing across 11+ browser configurations  
✅ **Visual regression detection** with pixel-level comparison
✅ **Performance validation** under load and stress conditions
✅ **Mobile responsiveness** testing with touch interactions
✅ **Error scenario coverage** including network failures and recovery
✅ **Comprehensive reporting** with visual artifacts and metrics
✅ **CI/CD integration** with automated test execution and artifact collection

The test suite ensures the CCTelegram bridge system works reliably across all supported platforms and usage scenarios, providing confidence for production deployments and catching regressions early in the development cycle.
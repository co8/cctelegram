/**
 * Integration Examples
 * Demonstrates how to use the emulation system components together
 */

import { TelegramBotApiEmulator } from './telegram-bot-api-emulator.js';
import { MessageFlowSimulator } from './message-flow-simulator.js';
import { ResponseVerificationEngine } from './response-verification-engine.js';
import { TestAutomationOrchestrator } from './test-automation-orchestrator.js';

// Example 1: Basic Emulator Usage
export async function basicEmulatorExample(): Promise<void> {
  console.log('🔸 Basic Emulator Example');
  
  const emulator = new TelegramBotApiEmulator(8081, './logs/example');
  
  // Set up message handler
  emulator.on('messageSent', (message) => {
    console.log(`📤 Message sent: ${message.text?.substring(0, 50)}...`);
  });
  
  emulator.on('webhookSent', ({ update, response, duration }) => {
    console.log(`🔄 Webhook sent to bridge (${duration}ms): ${response.ok ? 'success' : 'failed'}`);
  });
  
  try {
    await emulator.start();
    console.log('✅ Emulator started');
    
    // Configure webhook
    await emulator.setWebhook('http://localhost:3000/webhook');
    
    // Simulate user sending /tasks command
    await emulator.simulateUserMessage(123456789, '/tasks');
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check messages
    const messages = emulator.getMessages();
    console.log(`📊 Captured ${messages.length} messages`);
    
  } finally {
    await emulator.stop();
    console.log('🛑 Emulator stopped');
  }
}

// Example 2: Flow Simulation
export async function flowSimulationExample(): Promise<void> {
  console.log('🔸 Flow Simulation Example');
  
  const emulator = new TelegramBotApiEmulator(8082, './logs/flow-example');
  const simulator = new MessageFlowSimulator('./logs/flow-example');
  
  simulator.setTelegramEmulator(emulator);
  
  try {
    await emulator.start();
    await emulator.setWebhook('http://localhost:3000/webhook');
    
    // Execute a test scenario
    const result = await simulator.executeScenario('tasks-command-basic', {
      testRun: 'example',
      timestamp: Date.now()
    });
    
    console.log(`📊 Flow Result:`);
    console.log(`  Status: ${result.status}`);
    console.log(`  Duration: ${result.totalDuration?.toFixed(2)}ms`);
    console.log(`  Steps: ${result.actualSteps}/${result.expectedSteps}`);
    console.log(`  Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('  Error Details:');
      result.errors.forEach(error => console.log(`    • ${error}`));
    }
    
  } finally {
    await emulator.stop();
    await simulator.shutdown();
  }
}

// Example 3: Response Verification
export async function verificationExample(): Promise<void> {
  console.log('🔸 Response Verification Example');
  
  const verifier = new ResponseVerificationEngine('./logs/verification-example');
  
  // Set expected data to detect staleness
  verifier.setExpectedTaskData({
    completed: 25,
    total: 30,
    pending: 3,
    inProgress: 2
  });
  
  // Test with good response
  const goodResponse = `*📋 TaskMaster Status*
✅ Running

🏗️ Project Health: Good

*📊 Tasks:* 83%
\`████████████████░░░░\` 83%

✅ *Completed:* 25/30 ████████░
📌 *Pending:* 3 █░░░░░░░░
🔄 *In Progress:* 2 █░░░░░░░░

*🎯 Project Health:* 🟢 Excellent
*🕐 Updated:* Live MCP Server`;

  const goodResult = await verifier.verifyMessage(
    'test-good-1',
    goodResponse,
    'command_response',
    { source: 'example', timestamp: Date.now() }
  );
  
  console.log(`✅ Good Response Verification:`);
  console.log(`  Success: ${goodResult.overallSuccess}`);
  console.log(`  Rules Passed: ${goodResult.results.filter(r => r.success).length}/${goodResult.results.length}`);
  
  // Test with stale response
  const staleResponse = `*📋 TaskMaster Status*
✅ Running

🏗️ CCTelegram Project

*📊 Tasks:* 96.55%
\`███████████████████░\` 96.55%

✅ *Completed:* 28/29 ████████████████████
📌 *Pending:* 1 ░░░░░░░░░
🔄 *In Progress:* 0 ░░░░░░░░░

*⚠️ Data Source:* File System (Static)
*💡 Tip:* Start MCP server for live updates`;

  const staleResult = await verifier.verifyMessage(
    'test-stale-1',
    staleResponse,
    'command_response',
    { source: 'example', timestamp: Date.now() }
  );
  
  console.log(`🚨 Stale Response Verification:`);
  console.log(`  Success: ${staleResult.overallSuccess}`);
  console.log(`  Errors: ${staleResult.errorCount}`);
  console.log(`  Critical Issues:`);
  
  staleResult.results
    .filter(r => r.severity === 'error' && !r.success)
    .forEach(result => {
      console.log(`    • ${result.message}`);
    });
  
  // Generate report
  const report = await verifier.generateReport();
  console.log(`📊 Verification Summary:`);
  console.log(`  Total Verifications: ${report.totalVerifications}`);
  console.log(`  Success Rate: ${report.successRate.toFixed(1)}%`);
  console.log(`  Stale Data Detections: ${report.dataQualityIssues.staleDataDetections}`);
  
  await verifier.shutdown();
}

// Example 4: Full Integration Test
export async function fullIntegrationExample(): Promise<void> {
  console.log('🔸 Full Integration Example');
  
  const orchestrator = new TestAutomationOrchestrator('.', './logs/integration-example');
  
  // Create a simple test configuration
  const testConfig = {
    name: 'Integration Example Test',
    description: 'Demonstrates full system integration',
    
    telegramEmulator: {
      port: 8084,
      responseDelay: 100
    },
    
    bridge: {
      executable: 'echo "Mock bridge process"', // Mock for example
      startupTimeout: 5000,
      healthCheckInterval: 1000
    },
    
    mcp: {
      serverPath: './mcp-server',
      startupTimeout: 5000
    },
    
    scenarios: ['tasks-command-basic'],
    
    expectedData: {
      completed: 25,
      total: 30,
      pending: 3,
      inProgress: 2
    },
    
    parallel: false,
    repeatCount: 1,
    timeoutMs: 30000,
    cleanup: true
  };
  
  try {
    // This would normally run the full test, but we'll mock it for the example
    console.log('📋 Test Configuration:');
    console.log(`  Name: ${testConfig.name}`);
    console.log(`  Emulator Port: ${testConfig.telegramEmulator.port}`);
    console.log(`  Scenarios: ${testConfig.scenarios.join(', ')}`);
    console.log(`  Expected Data: ${JSON.stringify(testConfig.expectedData)}`);
    
    console.log('✅ Integration example completed (mocked)');
    
  } finally {
    await orchestrator.shutdown();
  }
}

// Example 5: Custom Scenario Creation
export async function customScenarioExample(): Promise<void> {
  console.log('🔸 Custom Scenario Example');
  
  const simulator = new MessageFlowSimulator('./logs/custom-scenario-example');
  
  // Add a custom scenario
  simulator.addScenario({
    id: 'custom-help-command',
    name: 'Custom Help Command Test',
    description: 'Tests the /help command with custom validation',
    command: '/help',
    expectedResponsePattern: /Available Commands/,
    expectedSteps: 3,
    timeoutMs: 10000,
    
    // Custom validation
    validationChecks: [
      async (flow) => {
        // Check if response contains expected commands
        const hasExpectedCommands = flow.steps.some(step => 
          step.type === 'telegram_response' && 
          step.data?.text?.includes('/tasks') &&
          step.data?.text?.includes('/bridge')
        );
        
        console.log(`  Custom validation: ${hasExpectedCommands ? 'PASSED' : 'FAILED'}`);
        return hasExpectedCommands;
      }
    ]
  });
  
  console.log('✅ Custom scenario added');
  console.log(`📋 Available scenarios: ${simulator.getAllScenarios().length}`);
  
  await simulator.shutdown();
}

// Example 6: Load Testing Simulation
export async function loadTestExample(): Promise<void> {
  console.log('🔸 Load Test Example');
  
  const emulator = new TelegramBotApiEmulator(8085, './logs/load-test-example');
  const simulator = new MessageFlowSimulator('./logs/load-test-example');
  
  simulator.setTelegramEmulator(emulator);
  
  try {
    await emulator.start();
    
    // Simulate load test (small scale for example)
    const results = await simulator.executeLoadTest('tasks-command-basic', {
      concurrentUsers: 2,
      duration: 5, // 5 seconds
      rampUpTime: 2 // 2 seconds ramp up
    });
    
    console.log(`📊 Load Test Results:`);
    console.log(`  Total Flows: ${results.length}`);
    console.log(`  Successful: ${results.filter(r => r.status === 'completed').length}`);
    console.log(`  Failed: ${results.filter(r => r.status === 'failed').length}`);
    
    if (results.length > 0) {
      const durations = results.map(r => r.totalDuration || 0);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      console.log(`  Average Duration: ${avgDuration.toFixed(2)}ms`);
      console.log(`  Throughput: ${(results.length / 5).toFixed(2)} flows/sec`);
    }
    
  } finally {
    await emulator.stop();
    await simulator.shutdown();
  }
}

// Main example runner
async function runExamples(): Promise<void> {
  console.log('🧪 CCTelegram Emulation System - Integration Examples');
  console.log('=' .repeat(60));
  
  const examples = [
    { name: 'Basic Emulator', fn: basicEmulatorExample },
    { name: 'Flow Simulation', fn: flowSimulationExample },
    { name: 'Response Verification', fn: verificationExample },
    { name: 'Full Integration (mocked)', fn: fullIntegrationExample },
    { name: 'Custom Scenario', fn: customScenarioExample },
    { name: 'Load Test', fn: loadTestExample }
  ];
  
  for (const example of examples) {
    try {
      console.log('');
      console.log(`▶️ Running: ${example.name}`);
      console.log('-' .repeat(40));
      
      await example.fn();
      
      console.log(`✅ ${example.name} completed successfully`);
      
    } catch (error) {
      console.error(`❌ ${example.name} failed:`, error.message);
      
      if (process.env.VERBOSE) {
        console.error(error.stack);
      }
    }
    
    // Brief pause between examples
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('');
  console.log('🎉 All examples completed!');
  console.log('');
  console.log('💡 To run the full test suite:');
  console.log('   npm test');
  console.log('');
  console.log('💡 To run specific tests:');
  console.log('   npm run test:staleness  # Critical for data staleness detection');
  console.log('   npm run test:basic      # Basic functionality');
  console.log('   npm run test:performance # Performance testing');
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch((error) => {
    console.error('❌ Examples failed:', error);
    process.exit(1);
  });
}

export {
  basicEmulatorExample,
  flowSimulationExample,
  verificationExample,
  fullIntegrationExample,
  customScenarioExample,
  loadTestExample,
  runExamples
};
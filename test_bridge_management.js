#!/usr/bin/env node

import { CCTelegramBridgeClient } from './mcp-server/dist/bridge-client.js';

async function testBridgeManagement() {
  const client = new CCTelegramBridgeClient();
  
  console.log('Testing bridge management functionality...\n');
  
  try {
    // Test 1: Check if bridge is running
    console.log('1. Checking if bridge is running...');
    const isRunning = await client.isBridgeRunning();
    console.log(`   Bridge running: ${isRunning}\n`);
    
    // Test 2: Start bridge
    console.log('2. Starting bridge...');
    const startResult = await client.startBridge();
    console.log(`   Start result: ${JSON.stringify(startResult, null, 2)}\n`);
    
    // Test 3: Check status after start
    console.log('3. Checking bridge status...');
    const status = await client.getBridgeStatus();
    console.log(`   Status: ${JSON.stringify(status, null, 2)}\n`);
    
    // Test 4: Ensure bridge running (should already be running)
    console.log('4. Ensuring bridge is running...');
    const ensureResult = await client.ensureBridgeRunning();
    console.log(`   Ensure result: ${JSON.stringify(ensureResult, null, 2)}\n`);
    
    // Test 5: Stop bridge
    console.log('5. Stopping bridge...');
    const stopResult = await client.stopBridge();
    console.log(`   Stop result: ${JSON.stringify(stopResult, null, 2)}\n`);
    
    // Test 6: Check if stopped
    console.log('6. Checking if bridge is stopped...');
    const isStoppedCheck = await client.isBridgeRunning();
    console.log(`   Bridge running after stop: ${isStoppedCheck}\n`);
    
    console.log('✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testBridgeManagement();
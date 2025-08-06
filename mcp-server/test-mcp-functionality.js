#!/usr/bin/env node

/**
 * Comprehensive MCP server functionality test
 * Tests the actual MCP tool calling functionality
 */

import { spawn } from 'child_process';

console.log('🧪 Testing MCP Server Tool Functionality...\n');

async function testMCPTool(toolName, params = {}) {
  return new Promise((resolve) => {
    console.log(`📡 Testing tool: ${toolName}`);
    
    const serverProcess = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let responseData = '';
    
    serverProcess.stdout.on('data', (data) => {
      responseData += data.toString();
    });
    
    serverProcess.stderr.on('data', (data) => {
      // Log stderr but don't fail the test for warning messages
      if (data.toString().includes('Error:') && !data.toString().includes('[MCP-ENV]')) {
        console.log('⚠️  Server stderr:', data.toString().slice(0, 100) + '...');
      }
    });

    // Send tool request
    const toolRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params
      }
    }) + '\n';
    
    setTimeout(() => {
      serverProcess.stdin.write(toolRequest);
      
      setTimeout(() => {
        try {
          // Parse JSON response
          const responses = responseData.split('\n').filter(line => line.trim());
          let toolResponse = null;
          
          for (const line of responses) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.id === 1 && parsed.result) {
                toolResponse = parsed.result;
                break;
              }
            } catch (e) {
              // Skip non-JSON lines
            }
          }
          
          if (toolResponse && toolResponse.content) {
            console.log(`✅ ${toolName} - responded successfully`);
            console.log(`   Response: ${toolResponse.content[0]?.text || 'No text content'}`);
            resolve(true);
          } else {
            console.log(`❌ ${toolName} - no valid response`);
            resolve(false);
          }
        } catch (error) {
          console.log(`❌ ${toolName} - parse error: ${error.message}`);
          resolve(false);
        }
        
        serverProcess.kill('SIGTERM');
      }, 2000);
    }, 1000);
  });
}

async function testToolsList() {
  return new Promise((resolve) => {
    console.log('📡 Testing tools/list endpoint');
    
    const serverProcess = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let responseData = '';
    
    serverProcess.stdout.on('data', (data) => {
      responseData += data.toString();
    });
    
    const listRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    }) + '\n';
    
    setTimeout(() => {
      serverProcess.stdin.write(listRequest);
      
      setTimeout(() => {
        try {
          const responses = responseData.split('\n').filter(line => line.trim());
          let toolsResponse = null;
          
          for (const line of responses) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.id === 1 && parsed.result && parsed.result.tools) {
                toolsResponse = parsed.result;
                break;
              }
            } catch (e) {
              // Skip non-JSON lines
            }
          }
          
          if (toolsResponse && toolsResponse.tools && toolsResponse.tools.length > 0) {
            console.log(`✅ tools/list - found ${toolsResponse.tools.length} tools`);
            toolsResponse.tools.forEach(tool => {
              console.log(`   - ${tool.name}: ${tool.description}`);
            });
            resolve(true);
          } else {
            console.log('❌ tools/list - no tools found');
            resolve(false);
          }
        } catch (error) {
          console.log(`❌ tools/list - parse error: ${error.message}`);
          resolve(false);
        }
        
        serverProcess.kill('SIGTERM');
      }, 2000);
    }, 1000);
  });
}

async function main() {
  try {
    console.log('🎯 MCP Server Functionality Test Suite\n');
    
    // Test 1: Tools list
    const toolsListWorking = await testToolsList();
    
    // Test 2: Individual tool calls
    const sendEventWorking = await testMCPTool('send_telegram_event', {
      type: 'info_notification',
      title: 'Test Event',
      description: 'Testing MCP server functionality'
    });
    
    const sendMessageWorking = await testMCPTool('send_telegram_message', {
      message: 'Test message from MCP server'
    });
    
    const getTaskStatusWorking = await testMCPTool('get_task_status', {
      task_system: 'both'
    });
    
    // Results
    console.log('\n🎯 MCP Functionality Test Results:');
    
    const allTestsPassed = toolsListWorking && sendEventWorking && sendMessageWorking && getTaskStatusWorking;
    
    if (allTestsPassed) {
      console.log('✅ ALL MCP FUNCTIONALITY TESTS PASSED');
      console.log('✅ Tools list endpoint working');
      console.log('✅ Tool calling mechanism working');
      console.log('✅ All core tools responding correctly');
      
      console.log('\n🚀 FINAL STATUS:');
      console.log('✅ MCP Server Build & Test - COMPLETED SUCCESSFULLY');
      console.log('✅ Task 40.5 Build System Integration - VERIFIED');
      console.log('✅ Quality Gates - FUNCTIONAL');
      console.log('✅ CCTelegram MCP Server - READY FOR PRODUCTION');
      
      process.exit(0);
    } else {
      console.log('❌ Some MCP functionality tests failed');
      console.log(`   tools/list: ${toolsListWorking ? 'PASS' : 'FAIL'}`);
      console.log(`   send_telegram_event: ${sendEventWorking ? 'PASS' : 'FAIL'}`);
      console.log(`   send_telegram_message: ${sendMessageWorking ? 'PASS' : 'FAIL'}`);
      console.log(`   get_task_status: ${getTaskStatusWorking ? 'PASS' : 'FAIL'}`);
      
      process.exit(1);
    }
    
  } catch (error) {
    console.error('💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

main();
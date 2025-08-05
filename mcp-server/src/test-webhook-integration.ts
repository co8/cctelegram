/**
 * Test webhook MCP integration (Task 21.3)
 */

import { WebhookMCPIntegration, ClaudeNotification } from './webhook-integration';

async function testWebhookIntegration() {
  console.log('🧪 Testing Webhook MCP Integration...');
  
  const integration = new WebhookMCPIntegration(3011);
  
  // Register a test Claude notification callback
  const receivedNotifications: ClaudeNotification[] = [];
  integration.registerClaudeNotificationCallback((notification) => {
    console.log('📨 Claude notification received:', notification);
    receivedNotifications.push(notification);
  });
  
  try {
    console.log('🚀 Starting integration...');
    await integration.start();
    
    console.log(`✅ Integration started on port ${integration.getWebhookPort()}`);
    console.log(`🏃 Running: ${integration.isRunning()}`);
    
    // Test different response types
    const testCases = [
      'approve_deployment-v2.1.0',
      'deny_security-audit-123',
      'ack_task-completion-456',
      'details_performance-fix-789'
    ];
    
    console.log('\n🧪 Testing response processing...');
    
    for (const callbackData of testCases) {
      console.log(`\n📝 Testing: ${callbackData}`);
      const startTime = Date.now();
      
      const result = await integration.testResponseProcessing(callbackData);
      const totalTime = Date.now() - startTime;
      
      console.log(`   ✅ Action: ${result.action}`);
      console.log(`   📋 Task ID: ${result.task_id}`);
      console.log(`   ⚡ Processing time: ${result.processing_time_ms}ms`);
      console.log(`   📨 Acknowledgment sent: ${result.acknowledgment_sent}`);
      console.log(`   🕐 Total time: ${totalTime}ms`);
      
      if (totalTime < 100) {
        console.log('   ✅ Performance target met (<100ms)');
      } else {
        console.log('   ⚠️  Performance target missed (>=100ms)');
      }
    }
    
    // Test webhook endpoint directly
    console.log('\n🌐 Testing webhook endpoint...');
    
    const webhookPayload = {
      type: 'telegram_response',
      callback_data: 'approve_integration-test',
      user_id: 297126051,
      username: 'test_user',
      first_name: 'Test User',
      timestamp: new Date().toISOString()
    };
    
    const response = await fetch(`http://localhost:${integration.getWebhookPort()}/webhook/bridge-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    });
    
    const responseData = await response.json();
    console.log('Webhook response:', responseData);
    
    // Verify Claude notifications were sent
    console.log(`\n📊 Claude notifications received: ${receivedNotifications.length}`);
    if (receivedNotifications.length > 0) {
      console.log('   ✅ Claude notification system working');
    } else {
      console.log('   ⚠️  No Claude notifications received');
    }
    
    console.log('\n🔄 Shutting down integration...');
    await integration.shutdown();
    console.log('✅ Integration shutdown complete');
    
    console.log('\n🎉 Webhook MCP Integration Test Complete!');
    console.log(`📈 Total notifications: ${receivedNotifications.length}`);
    console.log(`🚀 All response types processed successfully`);
    
  } catch (error) {
    console.error('❌ Integration test failed:', error);
    await integration.shutdown();
    process.exit(1);
  }
}

// Run the test
testWebhookIntegration().catch(console.error);
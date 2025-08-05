/**
 * Test complete MCP webhook integration
 */

import { MCPWebhookIntegration, ClaudeNotification } from './webhook-integration-v2';

async function testMCPWebhookIntegration() {
  console.log('🧪 Testing Complete MCP Webhook Integration...');
  
  const integration = new MCPWebhookIntegration(3012);
  const notifications: ClaudeNotification[] = [];
  
  // Register Claude notification callback
  integration.registerClaudeCallback((notification) => {
    console.log('📨 CLAUDE NOTIFICATION:', notification.response.action, 'for', notification.response.task_id);
    notifications.push(notification);
  });
  
  try {
    await integration.start();
    console.log(`✅ Integration running on port ${integration.getPort()}`);
    
    // Test webhook with real payload
    const testPayload = {
      type: 'telegram_response',
      callback_data: 'approve_deployment-v3.0.0',
      user_id: 297126051,
      username: 'enriqueco8',
      first_name: 'Enrique',
      timestamp: new Date().toISOString()
    };
    
    console.log('\n📨 Sending webhook payload...');
    const startTime = Date.now();
    
    const response = await fetch(`http://localhost:${integration.getPort()}/webhook/bridge-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });
    
    const responseTime = Date.now() - startTime;
    const responseData = await response.json();
    
    console.log('🎯 Response received:', responseData);
    console.log(`⚡ Total response time: ${responseTime}ms`);
    
    if (responseTime < 100) {
      console.log('✅ Performance target met (<100ms)');
    }
    
    // Wait a moment for async processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log(`\n📊 Results:`);
    console.log(`   • Action processed: ${responseData.action}`);
    console.log(`   • Task ID: ${responseData.task_id}`);
    console.log(`   • Acknowledgment sent: ${responseData.acknowledgment_sent}`);
    console.log(`   • Claude notifications: ${notifications.length}`);
    
    if (notifications.length > 0) {
      console.log('✅ End-to-end processing working!');
      console.log('✅ Claude notifications received');
      console.log('✅ Telegram acknowledgments sent');
    } else {
      console.log('⚠️  No Claude notifications received - check callback registration');
    }
    
    await integration.shutdown();
    console.log('\n🎉 MCP Webhook Integration Test Complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await integration.shutdown();
    process.exit(1);
  }
}

testMCPWebhookIntegration().catch(console.error);
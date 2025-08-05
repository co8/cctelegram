/**
 * Manual test runner for webhook server foundation
 */

import { WebhookServer } from './webhook-server';

async function testWebhookServer() {
  console.log('🧪 Testing Webhook Server Foundation...');
  
  const server = new WebhookServer(3010);
  
  try {
    console.log('📡 Starting server...');
    await server.start();
    
    console.log('✅ Server started successfully');
    console.log(`📊 Port: ${server.getPort()}`);
    console.log(`🏃 Running: ${server.isServerRunning()}`);
    
    // Test health endpoint
    console.log('\n🏥 Testing health endpoint...');
    const response = await fetch('http://localhost:3010/health');
    const healthData = await response.json();
    console.log('Health response:', healthData);
    
    // Test webhook endpoint with valid payload
    console.log('\n📨 Testing webhook endpoint...');
    const webhookPayload = {
      type: 'telegram_response',
      callback_data: 'approve_test-foundation',
      user_id: 297126051,
      username: 'test',
      first_name: 'Test',
      timestamp: new Date().toISOString()
    };
    
    const startTime = Date.now();
    const webhookResponse = await fetch('http://localhost:3010/webhook/bridge-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    });
    const responseTime = Date.now() - startTime;
    
    const webhookData = await webhookResponse.json();
    console.log('Webhook response:', webhookData);
    console.log(`⚡ Response time: ${responseTime}ms`);
    
    if (responseTime < 100) {
      console.log('✅ Performance target met (< 100ms)');
    } else {
      console.log('⚠️  Performance target missed (>= 100ms)');
    }
    
    console.log('\n🔄 Shutting down server...');
    await server.shutdown();
    console.log('✅ Server shutdown complete');
    
    console.log('\n🎉 Webhook Server Foundation Test Complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await server.shutdown();
    process.exit(1);
  }
}

// Run the test
testWebhookServer().catch(console.error);
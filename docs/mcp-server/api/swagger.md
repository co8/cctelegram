# Interactive API Documentation

<script setup>
import SwaggerUI from '../.vitepress/components/SwaggerUI.vue'
</script>

## Try the API Live

Use the interactive Swagger UI below to test all 16 MCP tools directly in your browser. 

### 🔐 Authentication Setup

Before testing protected endpoints, set your API key:

<div class="api-key-setup">
  <label for="api-key">API Key (stored locally)</label>
  <input 
    type="password" 
    id="api-key" 
    placeholder="Enter your MCP server API key" 
    @input="setApiKey"
  >
  <p class="help-text">💡 API key is stored in your browser's localStorage and included in all requests</p>
</div>

### 📊 Available Endpoints

The OpenAPI specification below includes all 16 MCP tools organized by category:

- **Events & Notifications** - 5 tools for sending events to Telegram
- **Bridge Management** - 5 tools for controlling the bridge process  
- **Response Processing** - 3 tools for handling user responses
- **Status & Monitoring** - 3 tools for system status and health

<SwaggerUI spec="/docs/openapi.yaml" />

<script>
function setApiKey(event) {
  const apiKey = event.target.value
  if (apiKey) {
    localStorage.setItem('cctelegram-api-key', apiKey)
    console.log('API key saved to localStorage')
  }
}
</script>

<style>
.api-key-setup {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 1.5rem;
  margin: 2rem 0;
}

.api-key-setup label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--vp-c-text-1);
}

.api-key-setup input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 0.9rem;
}

.api-key-setup input:focus {
  outline: none;
  border-color: var(--vp-c-brand);
  box-shadow: 0 0 0 2px rgba(100, 108, 255, 0.1);
}

.help-text {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}
</style>
<template>
  <div class="api-reference-cards">
    <h2>🚀 Quick Reference</h2>
    <p class="description">Essential MCP tools for Telegram integration</p>
    
    <div class="cards-grid">
      <!-- Events & Notifications -->
      <div class="card-section">
        <h3>📨 Events & Notifications</h3>
        <div class="tool-cards">
          <div class="tool-card" v-for="tool in eventTools" :key="tool.name">
            <div class="tool-header">
              <span class="tool-method">{{ tool.method }}</span>
              <code class="tool-name">{{ tool.name }}</code>
            </div>
            <p class="tool-description">{{ tool.description }}</p>
            <div class="tool-params">
              <span class="param-label">Required:</span>
              <code v-for="param in tool.required" :key="param" class="param">{{ param }}</code>
            </div>
            <div class="tool-example">
              <button @click="showExample(tool)" class="example-btn">
                {{ activeExample === tool.name ? 'Hide' : 'Show' }} Example
              </button>
            </div>
            <div v-if="activeExample === tool.name" class="example-code">
              <pre><code>{{ tool.example }}</code></pre>
            </div>
          </div>
        </div>
      </div>

      <!-- Bridge Management -->
      <div class="card-section">
        <h3>⚙️ Bridge Management</h3>
        <div class="tool-cards">
          <div class="tool-card" v-for="tool in bridgeTools" :key="tool.name">
            <div class="tool-header">
              <span class="tool-method">{{ tool.method }}</span>
              <code class="tool-name">{{ tool.name }}</code>
            </div>
            <p class="tool-description">{{ tool.description }}</p>
            <div class="tool-params" v-if="tool.required">
              <span class="param-label">Required:</span>
              <code v-for="param in tool.required" :key="param" class="param">{{ param }}</code>
            </div>
          </div>
        </div>
      </div>

      <!-- Response Processing -->
      <div class="card-section">
        <h3>💬 Response Processing</h3>
        <div class="tool-cards">
          <div class="tool-card" v-for="tool in responseTools" :key="tool.name">
            <div class="tool-header">
              <span class="tool-method">{{ tool.method }}</span>
              <code class="tool-name">{{ tool.name }}</code>
            </div>
            <p class="tool-description">{{ tool.description }}</p>
            <div class="tool-params" v-if="tool.params">
              <span class="param-label">Parameters:</span>
              <code v-for="param in tool.params" :key="param" class="param optional">{{ param }}</code>
            </div>
          </div>
        </div>
      </div>

      <!-- Status & Monitoring -->
      <div class="card-section">
        <h3>📊 Status & Monitoring</h3>
        <div class="tool-cards">
          <div class="tool-card" v-for="tool in statusTools" :key="tool.name">
            <div class="tool-header">
              <span class="tool-method">{{ tool.method }}</span>
              <code class="tool-name">{{ tool.name }}</code>
            </div>
            <p class="tool-description">{{ tool.description }}</p>
            <div class="tool-params" v-if="tool.params">
              <span class="param-label">Parameters:</span>
              <code v-for="param in tool.params" :key="param" class="param optional">{{ param }}</code>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Common Usage Patterns -->
    <div class="usage-patterns">
      <h3>🔄 Common Usage Patterns</h3>
      <div class="patterns-grid">
        <div class="pattern-card">
          <h4>Task Completion Workflow</h4>
          <ol class="workflow-steps">
            <li><code>send_task_completion</code> → Send completion event</li>
            <li><code>get_telegram_responses</code> → Check for user feedback</li>
            <li><code>process_pending_responses</code> → Handle responses</li>
          </ol>
        </div>
        <div class="pattern-card">
          <h4>Approval Workflow</h4>
          <ol class="workflow-steps">
            <li><code>send_approval_request</code> → Request user approval</li>
            <li><code>get_telegram_responses</code> → Poll for responses</li>
            <li><code>process_pending_responses</code> → Act on approval</li>
          </ol>
        </div>
        <div class="pattern-card">
          <h4>Bridge Health Check</h4>
          <ol class="workflow-steps">
            <li><code>check_bridge_process</code> → Verify bridge status</li>
            <li><code>ensure_bridge_running</code> → Auto-start if needed</li>
            <li><code>get_bridge_status</code> → Get detailed health info</li>
          </ol>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const activeExample = ref<string | null>(null)

const eventTools = [
  {
    name: 'send_telegram_event',
    method: 'POST',
    description: 'Send structured event notifications with rich data',
    required: ['type', 'title', 'description'],
    example: `{
  "type": "task_completion",
  "title": "Build Complete",
  "description": "Production build finished successfully",
  "task_id": "build-001",
  "data": {
    "duration_ms": 45000,
    "artifacts": ["dist/app.js"],
    "exit_code": 0
  }
}`
  },
  {
    name: 'send_telegram_message',
    method: 'POST',
    description: 'Send simple text messages for quick notifications',
    required: ['message'],
    example: `{
  "message": "Deployment to staging completed successfully ✅",
  "source": "deployment-system"
}`
  },
  {
    name: 'send_task_completion',
    method: 'POST',
    description: 'Specialized task completion notifications with metadata',
    required: ['task_id', 'title'],
    example: `{
  "task_id": "TASK-123",
  "title": "API Integration Complete",
  "results": "All 15 endpoints tested and validated",
  "files_affected": ["src/api.ts", "tests/api.test.ts"],
  "duration_ms": 120000
}`
  },
  {
    name: 'send_performance_alert',
    method: 'POST',
    description: 'Critical performance threshold alerts with metrics',
    required: ['title', 'current_value', 'threshold'],
    example: `{
  "title": "High Memory Usage",
  "current_value": 85.7,
  "threshold": 80.0,
  "severity": "high"
}`
  },
  {
    name: 'send_approval_request',
    method: 'POST',
    description: 'Interactive approval requests with custom response options',
    required: ['title', 'description'],
    example: `{
  "title": "Deploy to Production?",
  "description": "Version 2.1.0 ready for production deployment",
  "options": ["Deploy", "Cancel", "Review Changes"]
}`
  }
]

const bridgeTools = [
  {
    name: 'start_bridge',
    method: 'POST',
    description: 'Start the CCTelegram bridge process'
  },
  {
    name: 'stop_bridge',
    method: 'POST',
    description: 'Stop the CCTelegram bridge process'
  },
  {
    name: 'restart_bridge',
    method: 'POST',
    description: 'Restart the bridge process (stop + start)'
  },
  {
    name: 'ensure_bridge_running',
    method: 'POST',
    description: 'Ensure bridge is running, start if needed'
  },
  {
    name: 'check_bridge_process',
    method: 'GET',
    description: 'Check if bridge process is currently running'
  }
]

const responseTools = [
  {
    name: 'get_telegram_responses',
    method: 'GET',
    description: 'Retrieve user responses from Telegram interactions',
    params: ['limit (optional)']
  },
  {
    name: 'process_pending_responses',
    method: 'POST',
    description: 'Process and return actionable approval responses',
    params: ['since_minutes (optional)']
  },
  {
    name: 'clear_old_responses',
    method: 'DELETE',
    description: 'Clean up old response files to prevent accumulation',
    params: ['older_than_hours (optional)']
  }
]

const statusTools = [
  {
    name: 'get_bridge_status',
    method: 'GET',
    description: 'Get comprehensive bridge health and status information'
  },
  {
    name: 'list_event_types',
    method: 'GET',
    description: 'List all available event types with descriptions',
    params: ['category (optional)']
  },
  {
    name: 'get_task_status',
    method: 'GET',
    description: 'Get task status from Claude Code and TaskMaster systems',
    params: ['project_root', 'task_system', 'status_filter']
  }
]

function showExample(tool: any) {
  activeExample.value = activeExample.value === tool.name ? null : tool.name
}
</script>

<style scoped>
.api-reference-cards {
  padding: 2rem 0;
}

.description {
  color: var(--vp-c-text-2);
  font-size: 1.1rem;
  margin-bottom: 2rem;
}

.cards-grid {
  display: grid;
  gap: 2rem;
  margin-bottom: 3rem;
}

.card-section h3 {
  color: var(--vp-c-text-1);
  border-bottom: 2px solid var(--vp-c-brand);
  padding-bottom: 0.5rem;
  margin-bottom: 1rem;
}

.tool-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
}

.tool-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 1.5rem;
  transition: all 0.2s ease;
}

.tool-card:hover {
  border-color: var(--vp-c-brand);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(100, 108, 255, 0.1);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.tool-method {
  background: var(--vp-c-brand);
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  min-width: 50px;
  text-align: center;
}

.tool-method[data-method="GET"] {
  background: var(--vp-c-green);
}

.tool-method[data-method="DELETE"] {
  background: var(--vp-c-red);
}

.tool-name {
  font-family: var(--vp-font-family-mono);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.tool-description {
  color: var(--vp-c-text-2);
  margin-bottom: 1rem;
  line-height: 1.5;
}

.tool-params {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.param-label {
  font-weight: 600;
  color: var(--vp-c-text-1);
  font-size: 0.85rem;
}

.param {
  background: var(--vp-c-brand-light);
  color: var(--vp-c-brand-dark);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-family: var(--vp-font-family-mono);
  border: 1px solid var(--vp-c-brand);
}

.param.optional {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-border);
}

.example-btn {
  background: var(--vp-c-brand);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: background-color 0.2s;
}

.example-btn:hover {
  background: var(--vp-c-brand-dark);
}

.example-code {
  margin-top: 1rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  overflow: hidden;
}

.example-code pre {
  margin: 0;
  padding: 1rem;
  font-size: 0.8rem;
  line-height: 1.4;
  overflow-x: auto;
}

.example-code code {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
}

/* Usage Patterns */
.usage-patterns {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid var(--vp-c-border);
}

.usage-patterns h3 {
  color: var(--vp-c-text-1);
  margin-bottom: 1.5rem;
}

.patterns-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.pattern-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 1.5rem;
}

.pattern-card h4 {
  color: var(--vp-c-text-1);
  margin-bottom: 1rem;
  font-size: 1.1rem;
}

.workflow-steps {
  margin: 0;
  padding-left: 1.2rem;
  color: var(--vp-c-text-2);
}

.workflow-steps li {
  margin-bottom: 0.5rem;
  line-height: 1.5;
}

.workflow-steps code {
  background: var(--vp-c-bg);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-size: 0.85rem;
  color: var(--vp-c-brand);
  font-family: var(--vp-font-family-mono);
}

/* Mobile responsiveness */
@media (max-width: 768px) {
  .tool-cards {
    grid-template-columns: 1fr;
  }
  
  .patterns-grid {
    grid-template-columns: 1fr;
  }
  
  .tool-header {
    flex-wrap: wrap;
  }
}</style>
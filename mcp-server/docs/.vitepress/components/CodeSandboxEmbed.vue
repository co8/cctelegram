<template>
  <div class="codesandbox-wrapper">
    <div class="codesandbox-header">
      <div class="example-info">
        <h4>{{ title }}</h4>
        <p v-if="description">{{ description }}</p>
      </div>
      <div class="example-actions">
        <button @click="openInNewTab" class="open-button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
          </svg>
          Open in CodeSandbox
        </button>
        <button @click="toggleCode" class="code-button" :class="{ active: showCode }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8zM6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
            <path d="M12 6h2v2h-2V6zM10 6h2v2h-2V6zM12 10h2v2h-2v-2zM10 10h2v2h-2v-2z"/>
          </svg>
          {{ showCode ? 'Hide' : 'Show' }} Code
        </button>
      </div>
    </div>
    
    <div v-if="showCode" class="code-preview">
      <div class="code-tabs">
        <button 
          v-for="(file, filename) in files" 
          :key="filename"
          @click="activeFile = filename"
          :class="{ active: activeFile === filename }"
          class="code-tab"
        >
          {{ filename }}
        </button>
      </div>
      <div class="code-content">
        <pre><code :class="`language-${getLanguage(activeFile)}`" v-html="highlightCode(files[activeFile])"></code></pre>
      </div>
    </div>
    
    <div class="codesandbox-embed" :style="{ height: embedHeight }">
      <iframe
        :src="sandboxUrl"
        style="width: 100%; height: 100%; border: 0; border-radius: 4px; overflow: hidden;"
        :title="title"
        allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
        loading="lazy"
      ></iframe>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  sandboxId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    default: 'Interactive Example'
  },
  description: {
    type: String,
    default: ''
  },
  height: {
    type: String,
    default: '500px'
  },
  files: {
    type: Object,
    default: () => ({})
  },
  theme: {
    type: String,
    default: 'light',
    validator: value => ['light', 'dark'].includes(value)
  }
})

const showCode = ref(false)
const activeFile = ref('')

const embedHeight = computed(() => props.height)

const sandboxUrl = computed(() => {
  const baseUrl = `https://codesandbox.io/embed/${props.sandboxId}`
  const params = new URLSearchParams({
    fontsize: '14',
    hidenavigation: '1',
    theme: props.theme,
    view: 'preview',
    hidedevtools: '1',
    codemirror: '1'
  })
  return `${baseUrl}?${params.toString()}`
})

const openInNewTab = () => {
  window.open(`https://codesandbox.io/s/${props.sandboxId}`, '_blank')
}

const toggleCode = () => {
  showCode.value = !showCode.value
}

const getLanguage = (filename) => {
  const ext = filename.split('.').pop()
  const languageMap = {
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'javascript',
    'tsx': 'typescript',
    'vue': 'vue',
    'html': 'html',
    'css': 'css',
    'json': 'json',
    'md': 'markdown'
  }
  return languageMap[ext] || 'text'
}

const highlightCode = (code) => {
  // Simple syntax highlighting - in production, use Prism.js or similar
  if (!code) return ''
  
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '<span class="comment">$&</span>')
    .replace(/\/\/.*$/gm, '<span class="comment">$&</span>')
    .replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="string">$&</span>')
    .replace(/\b(const|let|var|function|async|await|import|export|from|class|extends|if|else|for|while|return|try|catch|finally)\b/g, '<span class="keyword">$&</span>')
}

onMounted(() => {
  // Set first file as active
  const filenames = Object.keys(props.files)
  if (filenames.length > 0) {
    activeFile.value = filenames[0]
  }
})
</script>

<style scoped>
.codesandbox-wrapper {
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  overflow: hidden;
  margin: 20px 0;
  background: var(--vp-c-bg);
}

.codesandbox-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 20px;
  border-bottom: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-soft);
}

.example-info h4 {
  margin: 0 0 4px 0;
  color: var(--vp-c-text-1);
  font-size: 16px;
  font-weight: 600;
}

.example-info p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
}

.example-actions {
  display: flex;
  gap: 8px;
}

.open-button,
.code-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.open-button:hover,
.code-button:hover {
  background: var(--vp-c-bg-elv);
  border-color: var(--vp-c-brand);
}

.code-button.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-dark);
  border-color: var(--vp-c-brand);
}

.code-preview {
  border-bottom: 1px solid var(--vp-c-border);
}

.code-tabs {
  display: flex;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.code-tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.code-tab:hover {
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
}

.code-tab.active {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-bottom: 2px solid var(--vp-c-brand);
}

.code-content {
  max-height: 400px;
  overflow-y: auto;
}

.code-content pre {
  margin: 0;
  padding: 16px 20px;
  background: var(--vp-c-bg);
  font-size: 13px;
  line-height: 1.5;
}

.code-content code {
  color: var(--vp-c-text-1);
}

:deep(.comment) {
  color: var(--vp-c-text-3);
  font-style: italic;
}

:deep(.string) {
  color: #10b981;
}

:deep(.keyword) {
  color: #3b82f6;
  font-weight: 500;
}

.codesandbox-embed {
  background: var(--vp-c-bg-alt);
}

@media (max-width: 768px) {
  .codesandbox-header {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }
  
  .example-actions {
    justify-content: flex-start;
  }
}
</style>
<template>
  <div id="swagger-ui" ref="swaggerContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Props {
  spec?: string
  url?: string
}

const props = withDefaults(defineProps<Props>(), {
  spec: '/docs/openapi.yaml'
})

const swaggerContainer = ref<HTMLElement>()

onMounted(async () => {
  if (typeof window !== 'undefined') {
    // Dynamically import Swagger UI to avoid SSR issues
    const SwaggerUIBundle = (await import('swagger-ui-dist/swagger-ui-bundle.js')).default

    SwaggerUIBundle({
      url: props.url || props.spec,
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.presets.standalone
      ],
      plugins: [
        SwaggerUIBundle.plugins.DownloadUrl
      ],
      layout: 'StandaloneLayout',
      tryItOutEnabled: true,
      requestInterceptor: (request: any) => {
        // Add API key if needed
        const apiKey = localStorage.getItem('cctelegram-api-key')
        if (apiKey) {
          request.headers['X-API-Key'] = apiKey
        }
        return request
      },
      responseInterceptor: (response: any) => {
        console.log('API Response:', response)
        return response
      },
      onComplete: () => {
        console.log('Swagger UI loaded successfully')
      }
    })
  }
})
</script>

<style>
/* Import Swagger UI styles */
@import 'swagger-ui-dist/swagger-ui.css';

/* Custom styles to match VitePress theme */
#swagger-ui {
  font-family: var(--vp-font-family-base);
}

#swagger-ui .swagger-ui .scheme-container {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

#swagger-ui .swagger-ui .info {
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 2rem;
}

#swagger-ui .swagger-ui .info hgroup.main h2 {
  color: var(--vp-c-text-1);
}

#swagger-ui .swagger-ui .info .description {
  color: var(--vp-c-text-2);
}

/* Operation styling */
#swagger-ui .swagger-ui .opblock {
  border-radius: 8px;
  margin-bottom: 1rem;
  border: 1px solid var(--vp-c-border);
}

#swagger-ui .swagger-ui .opblock .opblock-summary-method {
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.8rem;
}

#swagger-ui .swagger-ui .opblock.opblock-post {
  border-color: var(--vp-c-brand);
}

#swagger-ui .swagger-ui .opblock.opblock-get {
  border-color: var(--vp-c-green);
}

#swagger-ui .swagger-ui .opblock.opblock-delete {
  border-color: var(--vp-c-red);
}

/* Try it out button */
#swagger-ui .swagger-ui .btn.try-out__btn {
  background: var(--vp-c-brand);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-weight: 500;
}

#swagger-ui .swagger-ui .btn.try-out__btn:hover {
  background: var(--vp-c-brand-dark);
}

/* Parameters table */
#swagger-ui .swagger-ui .parameters-col_description input[type="text"] {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  padding: 0.5rem;
}

/* Response section */
#swagger-ui .swagger-ui .responses-inner h4,
#swagger-ui .swagger-ui .responses-inner h5 {
  color: var(--vp-c-text-1);
}

/* Dark mode adjustments */
.dark #swagger-ui .swagger-ui {
  filter: none;
}

.dark #swagger-ui .swagger-ui .wrapper {
  background: var(--vp-c-bg);
}

.dark #swagger-ui .swagger-ui .info {
  background: var(--vp-c-bg-soft);
}

/* API key input styling */
.api-key-input {
  margin: 1rem 0 2rem 0;
  padding: 1rem;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
}

.api-key-input label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--vp-c-text-1);
}

.api-key-input input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
}
</style>
<template>
  <div id="redoc-container" ref="redocContainer"></div>
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

const redocContainer = ref<HTMLElement>()

onMounted(async () => {
  if (typeof window !== 'undefined') {
    // Dynamically import ReDoc to avoid SSR issues
    const { RedocStandalone } = await import('redoc')

    if (redocContainer.value) {
      RedocStandalone.init(
        props.url || props.spec,
        {
          theme: {
            colors: {
              primary: {
                main: '#646cff'
              }
            },
            typography: {
              fontSize: '14px',
              fontFamily: 'var(--vp-font-family-base)',
              code: {
                fontFamily: 'var(--vp-font-family-mono)'
              }
            },
            sidebar: {
              backgroundColor: 'var(--vp-c-bg-soft)',
              textColor: 'var(--vp-c-text-1)'
            }
          },
          scrollYOffset: 60,
          hideDownloadButton: false,
          disableSearch: false,
          expandResponses: 'all',
          jsonSampleExpandLevel: 2,
          hideSingleRequestSampleTab: true,
          showExtensions: true,
          pathInMiddlePanel: true
        },
        redocContainer.value
      )
    }
  }
})
</script>

<style>
/* ReDoc custom styling */
#redoc-container {
  min-height: 100vh;
}

/* Override ReDoc styles to match VitePress theme */
#redoc-container .redoc-json code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.875rem;
}

#redoc-container .redoc-markdown p {
  color: var(--vp-c-text-2);
}

#redoc-container .redoc-markdown h1,
#redoc-container .redoc-markdown h2,
#redoc-container .redoc-markdown h3 {
  color: var(--vp-c-text-1);
}

/* Dark mode support */
.dark #redoc-container {
  --redoc-bg: var(--vp-c-bg);
  --redoc-text: var(--vp-c-text-1);
  --redoc-code-bg: var(--vp-c-bg-soft);
}
</style>
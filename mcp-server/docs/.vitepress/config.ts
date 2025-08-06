import { defineConfig } from 'vitepress'
import { readFileSync } from 'fs'
import { join } from 'path'

// Load version information
let versions: any = { versions: [], preReleases: [] }
try {
  versions = JSON.parse(readFileSync(join(__dirname, '../versions.json'), 'utf-8'))
} catch (error) {
  console.warn('Could not load versions.json:', error.message)
}

export default defineConfig({
  title: 'CCTelegram MCP Server',
  description: 'Fast, reliable MCP server for Telegram bridge integration',
  
  base: '/docs/',
  cleanUrls: true,
  
  // Performance optimizations
  vite: {
    build: {
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: {
            'framework': ['vue', 'vitepress']
          }
        }
      }
    }
  },

  head: [
    ['link', { rel: 'icon', href: '/docs/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#646cff' }],
    ['script', { 
      src: 'https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-bundle.js',
      defer: true 
    }],
    ['link', { 
      rel: 'stylesheet', 
      href: 'https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui.css' 
    }]
  ],

  themeConfig: {
    logo: '/logo.svg',
    
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/api/' },
      { text: 'Examples', link: '/examples/' },
      {
        text: `v${versions.defaultVersion || '1.6.0'}`,
        items: [
          {
            text: 'Versions',
            items: [
              ...versions.versions?.slice(0, 3).map((v: any) => ({
                text: `${v.version} ${v.isLatest ? '(Latest)' : ''}`,
                link: v.path
              })) || [],
              { text: 'All Versions', link: '/versions' }
            ]
          },
          {
            text: 'Resources',
            items: [
              { text: 'Changelog', link: '/changelog' },
              { text: 'Migration Guide', link: '/migration' },
              { text: 'GitHub Releases', link: 'https://github.com/user/cctelegram/releases' }
            ]
          }
        ]
      },
      { text: 'GitHub', link: 'https://github.com/user/cctelegram' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Quick Start', link: '/guide/' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Configuration', link: '/guide/configuration' }
          ]
        },
        {
          text: 'Architecture',
          items: [
            { text: 'System Architecture', link: '/guide/architecture' }
          ]
        },
        {
          text: 'Features',
          items: [
            { text: 'Event System', link: '/guide/events' },
            { text: 'Security', link: '/guide/security' },
            { text: 'Monitoring', link: '/guide/monitoring' }
          ]
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Custom Tools', link: '/guide/custom-tools' },
            { text: 'Performance', link: '/guide/performance' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Quick Reference', link: '/api/quick-reference' },
            { text: 'Interactive API (Swagger)', link: '/api/swagger' },
            { text: 'API Documentation (ReDoc)', link: '/api/redoc' },
            { text: 'OpenAPI Specification', link: '/api/openapi.yaml', target: '_blank' }
          ]
        },
        {
          text: 'MCP Tools',
          items: [
            { text: 'Events & Notifications', link: '/api/events' },
            { text: 'Bridge Management', link: '/api/bridge' },
            { text: 'Response Processing', link: '/api/responses' },
            { text: 'Status & Monitoring', link: '/api/status' }
          ]
        },
        {
          text: 'Integration',
          items: [
            { text: 'Authentication', link: '/api/authentication' },
            { text: 'Webhooks', link: '/api/webhooks' },
            { text: 'Error Handling', link: '/api/errors' },
            { text: 'Rate Limiting', link: '/api/rate-limiting' }
          ]
        }
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Basic Setup', link: '/examples/' },
            { text: 'Custom Events', link: '/examples/custom-events' },
            { text: 'Integration Tests', link: '/examples/integration' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/user/cctelegram' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 CCTelegram Contributors'
    },

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: 'Search docs',
                buttonAriaLabel: 'Search docs'
              },
              modal: {
                displayDetails: 'Display detailed list',
                resetButtonTitle: 'Reset search',
                backButtonTitle: 'Close search',
                noResultsText: 'No results found',
                footer: {
                  selectText: 'to select',
                  navigateText: 'to navigate',
                  closeText: 'to close'
                }
              }
            }
          }
        }
      }
    }
  },

  lastUpdated: true,
  
  // Version and metadata
  transformPageData(pageData) {
    pageData.frontmatter.version = versions.defaultVersion || '1.6.0'
    pageData.frontmatter.lastUpdated = new Date().toISOString()
    
    // Add canonical URL for SEO
    const canonicalUrl = `https://cctelegram.github.io${pageData.relativePath.replace(/\.md$/, '.html')}`
    pageData.frontmatter.head = pageData.frontmatter.head || []
    pageData.frontmatter.head.push(['link', { rel: 'canonical', href: canonicalUrl }])
    
    return pageData
  },
  
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true,
    config: (md) => {
      // Add version notice to markdown processing
      md.use((md) => {
        const defaultRender = md.renderer.rules.heading_open || function(tokens, idx, options, env, renderer) {
          return renderer.renderToken(tokens, idx, options);
        }
        
        md.renderer.rules.heading_open = function(tokens, idx, options, env, renderer) {
          const token = tokens[idx]
          if (token.tag === 'h1') {
            const nextToken = tokens[idx + 1]
            if (nextToken && nextToken.type === 'inline') {
              // Add version info after h1
              return defaultRender(tokens, idx, options, env, renderer)
            }
          }
          return defaultRender(tokens, idx, options, env, renderer)
        }
      })
    }
  },
  
  // Build hooks for versioning
  buildEnd(siteConfig) {
    // Generate sitemap with version information
    console.log('Build completed for version:', versions.defaultVersion)
  }
})
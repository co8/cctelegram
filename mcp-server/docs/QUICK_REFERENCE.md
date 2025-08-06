# Documentation Quick Reference

## Commands

| Command | Description |
|---------|-------------|
| `npm run docs:dev` | Start development server with hot-reload |
| `npm run docs:build` | Build static documentation site |
| `npm run docs:preview` | Preview built documentation |
| `npm run docs:api` | Generate API documentation from TypeScript |
| `npm run docs:clean` | Clean build artifacts |
| `./dev-setup.sh` | Initial setup (run once) |
| `./dev-setup.sh --dev` | Setup and start dev server |

## File Structure

```
docs/
├── .vitepress/
│   ├── config.ts        # Main configuration
│   ├── theme/           # Custom styling
│   └── dist/           # Built site (generated)
├── guide/              # User documentation
├── api/                # Auto-generated API docs
├── examples/           # Code examples
├── typedoc.config.js   # API generation config
└── package.json        # Documentation dependencies
```

## Writing Content

### Markdown Features

```markdown
# Heading 1
## Heading 2

**Bold** and *italic* text

`inline code` and code blocks:

```typescript
const example: string = 'Hello World';
```

> Info boxes and callouts

- Bullet points
- [Links](./guide/)
- ![Images](./assets/image.png)
```

### VitePress Features

```markdown
::: info
Information callout
:::

::: warning  
Warning callout
:::

::: danger
Danger callout
:::

::: details Click to expand
Collapsible content
:::
```

### Code Groups

```markdown
::: code-group

```typescript [client.ts]
import { BridgeClient } from 'cctelegram-mcp-server';
const client = new BridgeClient();
```

```javascript [client.js]  
const { BridgeClient } = require('cctelegram-mcp-server');
const client = new BridgeClient();
```

:::
```

## Configuration

### Navigation (config.ts)

```typescript
sidebar: {
  '/guide/': [
    {
      text: 'Getting Started',
      items: [
        { text: 'Quick Start', link: '/guide/' },
        { text: 'Installation', link: '/guide/installation' }
      ]
    }
  ]
}
```

### TypeDoc (typedoc.config.js)

```javascript
module.exports = {
  entryPoints: ['../src/index.ts'],
  out: 'api',
  exclude: ['**/*.test.ts'],
  theme: 'markdown'
};
```

## Development Workflow

1. **Setup** (once): `./dev-setup.sh`
2. **Write**: Edit markdown files 
3. **Preview**: `npm run docs:dev` → http://localhost:5173
4. **API Updates**: `npm run docs:api` (when TypeScript changes)
5. **Build**: `npm run docs:build` (for production)

## Performance Tips

- Keep images optimized (<500KB)
- Use code splitting for large examples  
- Minimize external dependencies
- Test build time regularly

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails | `npm run docs:clean && npm install` |
| Missing API docs | `npm run docs:api` |
| Port conflict | Kill process on port 5173 |
| Cache issues | Delete `.vitepress/cache` |
| Missing content | Check file paths and navigation config |

## Best Practices

### Content
- ✅ Start with quick examples
- ✅ Include troubleshooting sections  
- ✅ Use consistent terminology
- ❌ Don't duplicate information

### Code
- ✅ Test all examples
- ✅ Include error handling
- ✅ Show both TypeScript and JavaScript
- ❌ Don't use outdated APIs

### Structure  
- ✅ Logical navigation hierarchy
- ✅ Clear section headings
- ✅ Cross-reference related topics
- ❌ Don't create deep nesting
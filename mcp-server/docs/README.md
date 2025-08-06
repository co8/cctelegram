# CCTelegram MCP Server Documentation

Fast, developer-focused documentation powered by VitePress and TypeDoc.

## Quick Start

### Development
```bash
npm install
npm run docs:dev
```

Visit http://localhost:5173

### Build
```bash
npm run docs:build
npm run docs:preview
```

## Architecture

- **VitePress**: Static site generator with hot-reload
- **TypeDoc**: Automated API docs from TypeScript source
- **Custom Theme**: Minimal, fast-loading design
- **CI/CD**: Automated builds and GitHub Pages deployment

## Content Structure

```
docs/
├── .vitepress/
│   ├── config.ts        # VitePress configuration
│   └── theme/           # Custom theme
├── guide/               # User guides
├── api/                 # Auto-generated API docs  
├── examples/            # Code examples
├── typedoc.config.js    # TypeDoc configuration
└── package.json         # Dependencies
```

## Writing Documentation

### Guides
- Keep sections concise and actionable
- Use code examples liberally
- Focus on "how-to" over "why"
- Include troubleshooting sections

### API Documentation
- Automatically generated from TypeScript source
- Add JSDoc comments to interfaces/functions
- Use `@example` tags for code snippets
- Document all public APIs

### Examples
- Provide working, copy-paste code
- Cover common use cases
- Include error handling patterns
- Show both basic and advanced usage

## Performance Guidelines

### Content
- Optimize images and assets
- Keep pages focused and scannable
- Use headings for navigation
- Minimize external dependencies

### Technical
- VitePress handles bundling optimization
- Custom theme keeps CSS minimal
- Search is local (no external services)
- Static generation for fast loading

## Contributing

1. Write clear, actionable content
2. Test code examples
3. Update navigation in `.vitepress/config.ts`
4. Preview changes locally before committing

## Deployment

Documentation automatically deploys to GitHub Pages on main branch pushes:

- **Build**: GitHub Actions generates docs
- **Deploy**: Uploads to GitHub Pages  
- **URL**: https://username.github.io/cctelegram/

## Troubleshooting

### Build Issues
```bash
# Clean and rebuild
npm run clean
npm install
npm run docs:build
```

### API Generation Issues  
```bash
# Regenerate API docs
npm run api:clean
npm run api:generate
```

### Development Server Issues
```bash
# Clear VitePress cache
rm -rf .vitepress/cache
npm run docs:dev
```
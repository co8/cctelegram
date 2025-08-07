---
layout: home

hero:
  name: CCTelegram MCP Server
  text: Fast, Reliable Bridge Integration
  tagline: TypeScript MCP server v1.8.5 for seamless Telegram bridge communication
  actions:
    - theme: brand
      text: Get Started →
      link: /guide/
    - theme: alt  
      text: View API
      link: /api/
    - theme: alt
      text: Examples
      link: /examples/

features:
  - title: 🚀 High Performance
    details: Optimized TypeScript implementation with connection pooling, caching, and monitoring
  - title: 🛡️ Enterprise Security  
    details: Built-in security headers, rate limiting, and comprehensive audit logging
  - title: 🔧 Developer Friendly
    details: Full TypeScript support, comprehensive testing, and extensive examples
  - title: 📊 Observable
    details: Metrics, tracing, health checks, and performance monitoring out of the box
  - title: 🔄 Resilient
    details: Circuit breakers, retry policies, and graceful degradation patterns
  - title: 📖 Well Documented
    details: Complete API documentation, guides, and real-world examples
---

## Quick Start

```bash
# Install
npm install cctelegram-mcp-server

# Configure  
cp config.example.toml config.toml

# Run
npm start
```

## Core Features

- **Event System**: Type-safe event handling with validation
- **Bridge Client**: High-performance HTTP client with pooling
- **Security**: Headers, rate limiting, input validation  
- **Monitoring**: Metrics, health checks, performance tracking
- **Testing**: Comprehensive test suite with 95%+ coverage

## Architecture

```mermaid
graph LR
    A[Claude Code] --> B[MCP Server]
    B --> C[Telegram Bridge]
    B --> D[Event System] 
    D --> E[File Storage]
    C --> F[Telegram API]
```

[Get Started →](/guide/)
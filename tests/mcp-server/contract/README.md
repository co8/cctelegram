# Contract Testing with Pact

## Overview

This directory contains contract tests using Pact framework for consumer-driven contract testing between:

- **Consumer**: CCTelegram MCP Server
- **Provider**: CCTelegram Bridge

## Directory Structure

```
tests/contract/
├── consumer/           # MCP Server as consumer tests
│   ├── mcp-server.consumer.test.ts
│   └── event-api.consumer.test.ts
├── provider/           # Bridge as provider tests
│   ├── bridge.provider.test.ts
│   └── health-api.provider.test.ts
├── shared/             # Shared contract definitions
│   ├── contracts.ts
│   ├── matchers.ts
│   └── fixtures.ts
├── config/             # Pact configuration
│   ├── pact.config.ts
│   └── broker.config.ts
└── utils/              # Contract testing utilities
    ├── contract-helpers.ts
    ├── version-manager.ts
    └── deployment-checker.ts
```

## Consumer-Driven Contract Testing

### Consumer Tests (MCP Server)
- Test MCP Server's expectations of Bridge API
- Generate contracts that Bridge must satisfy
- Test all MCP tool interactions with Bridge

### Provider Tests (Bridge)
- Verify Bridge satisfies consumer contracts
- Test actual Bridge implementation against contracts
- Ensure API compatibility

## Contract Lifecycle

1. **Consumer Tests**: Generate contracts from MCP Server expectations
2. **Contract Publishing**: Upload contracts to Pact Broker
3. **Provider Tests**: Verify Bridge against published contracts
4. **Deployment Gates**: Prevent breaking changes in production

## Key Features

- **Consumer-driven**: MCP Server defines expected Bridge behavior
- **Contract Evolution**: Track API changes over time
- **Breaking Change Detection**: Prevent incompatible deployments
- **CI/CD Integration**: Automated contract verification
- **Version Management**: Track contract versions with git commits

## Usage

```bash
# Run consumer tests (MCP Server)
npm run test:contract:consumer

# Run provider tests (Bridge)
npm run test:contract:provider

# Full contract testing pipeline
npm run test:contract:ci

# Check deployment compatibility
npm run pact:can-deploy
```

## Contract Examples

### Event API Contract
```typescript
// Consumer expectation
pact.given('bridge is running')
  .uponReceiving('a valid event submission')
  .withRequest({
    method: 'POST',
    path: '/events',
    body: like(EventFixtures.createEvent())
  })
  .willRespondWith({
    status: 200,
    body: like({ success: true, event_id: string() })
  });
```

### Health API Contract
```typescript
// Consumer expectation
pact.given('bridge is healthy')
  .uponReceiving('a health check request')
  .withRequest({
    method: 'GET',
    path: '/health'
  })
  .willRespondWith({
    status: 200,
    body: like({ running: true, health: 'healthy' })
  });
```

## Configuration

Contracts are configured to work with:
- Local Pact Broker for development
- CI/CD pipeline integration
- Git-based versioning strategy
- Automated webhook notifications

## Testing Strategy

- **Unit Level**: Individual API endpoint contracts
- **Integration Level**: Complete workflow contracts
- **Evolution Testing**: Contract version compatibility
- **Breaking Change Detection**: API compatibility validation
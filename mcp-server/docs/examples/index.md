# Examples

Real-world examples and integration patterns for CCTelegram MCP Server.

## Basic Usage

### Send Simple Event

```typescript
import { BridgeClient } from 'cctelegram-mcp-server';

const client = new BridgeClient({
  baseURL: 'http://localhost:3000',
  timeout: 5000
});

// Send task completion event
await client.sendEvent({
  type: 'task_completion',
  title: 'Database Migration',
  description: 'Successfully migrated user table schema',
  duration_ms: 45000,
  files_affected: ['migrations/001_users.sql']
});
```

### Error Handling

```typescript
import { ValidationError, NetworkError } from 'cctelegram-mcp-server';

try {
  await client.sendEvent(event);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Invalid event data:', error.details);
  } else if (error instanceof NetworkError) {
    console.error('Network error:', error.message);
    // Implement retry logic
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Advanced Integration

### Custom Event Types

```typescript
interface CustomBuildEvent extends BaseEvent {
  type: 'build_completed';
  buildId: string;
  artifacts: string[];
  coverage: number;
  testResults: {
    passed: number;
    failed: number;
    skipped: number;
  };
}

await client.sendEvent<CustomBuildEvent>({
  type: 'build_completed',
  title: 'Frontend Build #123',
  description: 'Production build completed successfully',
  buildId: 'build-123',
  artifacts: ['dist/main.js', 'dist/styles.css'],
  coverage: 95.2,
  testResults: {
    passed: 150,
    failed: 0,
    skipped: 5
  }
});
```

### Batch Operations

```typescript
import { BridgeClient, EventBatch } from 'cctelegram-mcp-server';

const client = new BridgeClient();
const batch = new EventBatch();

// Add multiple events
batch.add({
  type: 'task_started',
  title: 'Unit Tests',
  description: 'Running test suite'
});

batch.add({
  type: 'performance_alert', 
  title: 'High Memory Usage',
  description: 'Memory usage at 85%',
  currentValue: 85,
  threshold: 80
});

// Send all events in one request
await client.sendBatch(batch);
```

### Configuration Management

```typescript
import { ConfigManager, ConfigSchema } from 'cctelegram-mcp-server';

const config = new ConfigManager({
  file: './config.toml',
  schema: ConfigSchema,
  watch: true // Hot-reload on changes
});

config.on('change', (newConfig, oldConfig) => {
  console.log('Configuration updated');
  // Restart services if needed
});

// Access typed configuration
const port = config.get('server.port'); // Type: number
const botToken = config.get('telegram.bot_token'); // Type: string
```

## Testing Examples

### Unit Test Setup

```typescript
import { BridgeClient, MockServer } from 'cctelegram-mcp-server/testing';

describe('Event Integration', () => {
  let mockServer: MockServer;
  let client: BridgeClient;

  beforeEach(() => {
    mockServer = new MockServer();
    client = new BridgeClient({
      baseURL: mockServer.url
    });
  });

  it('should send task completion event', async () => {
    const event = {
      type: 'task_completion',
      title: 'Test Task',
      description: 'Test completed'
    };

    await client.sendEvent(event);
    
    expect(mockServer.getReceivedEvents()).toHaveLength(1);
    expect(mockServer.getReceivedEvents()[0]).toMatchObject(event);
  });
});
```

### Integration Test

```typescript
import { TestBridge } from 'cctelegram-mcp-server/testing';

describe('End-to-End Integration', () => {
  let bridge: TestBridge;

  beforeAll(async () => {
    bridge = new TestBridge({
      telegram: {
        botToken: process.env.TEST_BOT_TOKEN,
        chatId: process.env.TEST_CHAT_ID
      }
    });
    
    await bridge.start();
  });

  it('should send real telegram message', async () => {
    await bridge.sendEvent({
      type: 'test_message',
      title: 'Integration Test',
      description: 'Testing real Telegram integration'
    });

    // Wait for delivery confirmation
    const delivery = await bridge.waitForDelivery(5000);
    expect(delivery.success).toBe(true);
  });
});
```

## Performance Optimization

### Connection Pooling

```typescript
import { BridgeClient, PoolConfig } from 'cctelegram-mcp-server';

const client = new BridgeClient({
  baseURL: 'http://localhost:3000',
  pool: {
    maxConnections: 10,
    keepAlive: true,
    timeout: 30000
  } as PoolConfig
});

// Reuse connections across requests
for (let i = 0; i < 100; i++) {
  await client.sendEvent({
    type: 'batch_test',
    title: `Event ${i}`,
    description: 'High-throughput test'
  });
}
```

### Caching Strategy

```typescript
import { CacheManager, RedisCache } from 'cctelegram-mcp-server';

const cache = new CacheManager({
  backend: new RedisCache({
    host: 'localhost',
    port: 6379
  }),
  ttl: 300 // 5 minutes
});

// Cache frequent lookups
const cachedResult = await cache.get('user:123', async () => {
  return await database.getUser(123);
});
```

## Production Deployment

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  cctelegram:
    image: ghcr.io/user/cctelegram-mcp-server:latest
    ports:
      - "3000:3000"
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - NODE_ENV=production
      - LOG_LEVEL=info
    volumes:
      - ./config.toml:/app/config.toml:ro
      - ./logs:/app/logs
    restart: unless-stopped
    
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

### Kubernetes Deployment

```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cctelegram-mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: cctelegram
  template:
    metadata:
      labels:
        app: cctelegram
    spec:
      containers:
      - name: cctelegram
        image: ghcr.io/user/cctelegram-mcp-server:latest
        ports:
        - containerPort: 3000
        env:
        - name: TELEGRAM_BOT_TOKEN
          valueFrom:
            secretKeyRef:
              name: telegram-secret
              key: bot-token
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi" 
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
```

## More Examples

- [Custom event types →](/examples/custom-events)
- [Integration patterns →](/examples/integration)
- [Performance tuning →](/guide/performance)
- [Security hardening →](/guide/security)
# BridgeClient

High-performance HTTP client for Telegram bridge communication with connection pooling, retries, and monitoring.

## Class: BridgeClient

The main client class for interacting with the CCTelegram bridge.

### Constructor

```typescript
new BridgeClient(options?: BridgeClientOptions)
```

**Parameters:**
- `options` (optional): Configuration options

**Example:**
```typescript
import { BridgeClient } from 'cctelegram-mcp-server';

const client = new BridgeClient({
  baseURL: 'http://localhost:3000',
  timeout: 5000,
  retries: 3
});
```

### Methods

#### sendEvent(event)

Sends an event to the Telegram bridge.

```typescript
async sendEvent<T extends BaseEvent>(event: T): Promise<EventResponse>
```

**Parameters:**
- `event`: Event object implementing the BaseEvent interface

**Returns:** Promise resolving to EventResponse

**Example:**
```typescript
await client.sendEvent({
  type: 'task_completion',
  title: 'Build Complete',
  description: 'Frontend build finished successfully',
  duration_ms: 45000,
  files_affected: ['dist/main.js', 'dist/styles.css']
});
```

#### sendBatch(batch)

Sends multiple events in a single batch request.

```typescript
async sendBatch(batch: EventBatch): Promise<BatchResponse>
```

**Parameters:**
- `batch`: EventBatch containing multiple events

**Returns:** Promise resolving to BatchResponse

**Example:**
```typescript
import { EventBatch } from 'cctelegram-mcp-server';

const batch = new EventBatch();
batch.add({ type: 'task_started', title: 'Test Suite' });
batch.add({ type: 'task_completion', title: 'Test Complete' });

await client.sendBatch(batch);
```

#### getHealth()

Checks the health status of the bridge.

```typescript
async getHealth(): Promise<HealthStatus>
```

**Returns:** Promise resolving to HealthStatus

**Example:**
```typescript
const health = await client.getHealth();
console.log('Bridge status:', health.status); // 'healthy' | 'unhealthy'
```

### Configuration Options

#### BridgeClientOptions

```typescript
interface BridgeClientOptions {
  /** Base URL for the bridge server */
  baseURL?: string;
  
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
  
  /** Number of retries on failure (default: 3) */
  retries?: number;
  
  /** Connection pool configuration */
  pool?: PoolConfig;
  
  /** Request headers */
  headers?: Record<string, string>;
}
```

#### PoolConfig

```typescript
interface PoolConfig {
  /** Maximum number of connections (default: 10) */
  maxConnections?: number;
  
  /** Keep connections alive (default: true) */
  keepAlive?: boolean;
  
  /** Connection timeout (default: 30000) */
  timeout?: number;
}
```

## Error Handling

The client throws specific error types for different failure scenarios:

```typescript
import { ValidationError, NetworkError, TimeoutError } from 'cctelegram-mcp-server';

try {
  await client.sendEvent(event);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Invalid event data:', error.details);
  } else if (error instanceof NetworkError) {
    console.error('Network failure:', error.message);
  } else if (error instanceof TimeoutError) {
    console.error('Request timeout:', error.message);
  }
}
```

## Performance Features

### Connection Pooling

The client automatically manages a pool of HTTP connections for optimal performance:

```typescript
const client = new BridgeClient({
  pool: {
    maxConnections: 20,    // Higher for high-throughput scenarios
    keepAlive: true,       // Reuse connections
    timeout: 60000         // Longer timeout for batch operations
  }
});
```

### Automatic Retries

Failed requests are automatically retried with exponential backoff:

```typescript
const client = new BridgeClient({
  retries: 5,              // More retries for unreliable networks
  timeout: 10000           // Longer timeout per attempt
});
```

### Request Batching

Use EventBatch for high-throughput scenarios:

```typescript
const batch = new EventBatch();

// Add up to 100 events per batch
for (const event of events) {
  batch.add(event);
  
  if (batch.size >= 100) {
    await client.sendBatch(batch);
    batch.clear();
  }
}

// Send remaining events
if (batch.size > 0) {
  await client.sendBatch(batch);
}
```

## Monitoring

The client provides built-in metrics and monitoring:

```typescript
// Get client statistics
const stats = client.getStats();
console.log('Requests sent:', stats.requests);
console.log('Success rate:', stats.successRate);
console.log('Average response time:', stats.avgResponseTime);
```

## Advanced Usage

### Custom Headers

```typescript
const client = new BridgeClient({
  headers: {
    'Authorization': 'Bearer your-token',
    'User-Agent': 'YourApp/1.0.0'
  }
});
```

### Request Interceptors

```typescript
client.interceptors.request.use((config) => {
  config.headers['X-Request-ID'] = generateRequestId();
  return config;
});

client.interceptors.response.use((response) => {
  console.log('Response received:', response.status);
  return response;
});
```
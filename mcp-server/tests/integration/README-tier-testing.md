# 3-Tier Cascading System Integration Tests

## Overview

Comprehensive integration tests for the 3-tier cascading monitoring system implementing **Task 25.1**. This test suite validates webhook response times (0-100ms), bridge processing (100-500ms), and file watcher fallbacks (1-5s) with real-time latency measurements.

## Architecture

The test suite implements a complete mock of the 3-tier cascading system:

```
┌─────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│   Tier 1        │    │   Tier 2        │    │   Tier 3         │
│  MCP Webhook    │───▶│ Bridge Internal │───▶│  File Watcher    │
│   (0-100ms)     │    │   (100-500ms)   │    │    (1-5s)        │
└─────────────────┘    └─────────────────┘    └──────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
   HTTP Endpoint           Direct Processing      File System Queue
   supertest/express       Mock Implementation    Event/Response Files
```

## Test Components

### 1. Integration Test Suite (`tier-cascading-system.integration.test.ts`)
- **Tier 1 Validation**: HTTP webhook endpoints with 0-100ms SLA
- **Tier 2 Validation**: Bridge processing with 100-500ms SLA  
- **Tier 3 Validation**: File watcher with 1-5s SLA
- **Fallback Testing**: Cascading failure scenarios
- **Latency Measurement**: Real-time timing with tolerance margins
- **Load Testing**: Concurrent request handling
- **Health Checks**: Service availability validation

### 2. Mock Services (`Dockerfile.tier-mocks`)
- **Tier 1 Mock**: Express server with configurable latency/failure rates
- **Tier 2 Mock**: Internal processor simulation
- **Tier 3 Mock**: File system watcher with queue processing
- **Configuration API**: Runtime adjustment of mock behavior
- **Health/Metrics Endpoints**: Monitoring integration

### 3. Docker Compose Environment (`docker-compose.integration-test.yml`)
- **Isolated Network**: Dedicated test network with subnet isolation
- **Service Dependencies**: Proper startup ordering and health checks
- **Volume Management**: Temporary file system storage for Tier 3
- **Monitoring Integration**: Prometheus/Jaeger for observability
- **Resource Limits**: Controlled resource allocation

### 4. Test Utilities (`tier-test-helpers.ts`)
- **Metrics Collection**: Real-time latency measurements
- **Load Test Runner**: Configurable concurrent testing
- **Configuration Manager**: Dynamic tier configuration
- **SLA Validation**: Automated compliance checking
- **Report Generation**: Detailed test reports

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 20+
- Available ports: 3001-3003, 5432, 6379

### Running Tests

```bash
# Complete integration test suite
npm run test:tier-integration

# Development mode (keeps containers running)
npm run test:tier-integration:dev

# Cleanup only
npm run test:tier-cleanup

# Manual Jest execution
npm run test:integration -- --testPathPattern=tier-cascading-system
```

### Docker Compose Profiles

```bash
# Basic tests only
docker-compose -f docker-compose.integration-test.yml up

# With monitoring (Prometheus/Jaeger)
docker-compose -f docker-compose.integration-test.yml --profile monitoring up

# With performance testing
docker-compose -f docker-compose.integration-test.yml --profile performance up
```

## Test Scenarios

### SLA Compliance Testing

```typescript
describe('Tier 1: MCP Webhook Response Time Validation (0-100ms)', () => {
  it('should process requests within 0-100ms SLA', async () => {
    const result = await orchestrator.processWithFallback(testPayload);
    
    expect(result.successful_tier).toBe('mcp_webhook');
    const measurement = result.tier_measurements.find(m => m.tier === 'mcp_webhook');
    expect(measurement.duration_ms).toBeLessThanOrEqual(100);
    expect(measurement.within_sla).toBe(true);
  });
});
```

### Fallback Mechanism Testing

```typescript
describe('Fallback Mechanism Validation', () => {
  it('should cascade through all tiers when each fails', async () => {
    // Configure all tiers to fail
    orchestrator.getTier1().setFailureRate(1);
    orchestrator.getTier2().setFailureRate(1);
    orchestrator.getTier3().setFailureRate(1);

    const result = await orchestrator.processWithFallback(testPayload);
    
    expect(result.attempted_tiers).toEqual(['mcp_webhook', 'bridge_internal', 'file_watcher']);
    expect(result.fallback_triggered).toBe(true);
  });
});
```

### Load Testing

```typescript
describe('Load and Stress Testing', () => {
  it('should handle concurrent requests across all tiers', async () => {
    const concurrentRequests = 10;
    const promises = Array(concurrentRequests).fill().map(() => 
      orchestrator.processWithFallback(testPayload)
    );

    const results = await Promise.all(promises);
    
    // Validate all succeeded and maintained SLA
    results.forEach(result => {
      expect(result.successful_tier).toBeDefined();
      result.tier_measurements.forEach(m => {
        expect(validateSLA(m)).toBe(true);
      });
    });
  });
});
```

## Configuration

### Environment Variables

```bash
# Test Environment
NODE_ENV=test
JEST_TIMEOUT=60000
INTEGRATION_TEST_MODE=true

# Tier Configuration
TIER1_LATENCY_MS=50          # Tier 1 simulated latency
TIER1_FAILURE_RATE=0         # Tier 1 failure rate (0-1)
TIER2_LATENCY_MS=200         # Tier 2 simulated latency
TIER3_LATENCY_MS=2000        # Tier 3 simulated latency

# Test Infrastructure
CC_TELEGRAM_EVENTS_DIR=/test/events
CC_TELEGRAM_RESPONSES_DIR=/test/responses
TIER_TEST_BASE_DIR=/test/tier-test
```

### Runtime Configuration

The mock services support runtime configuration via HTTP endpoints:

```bash
# Configure Tier 1
curl -X POST http://localhost:3001/config \
  -H "Content-Type: application/json" \
  -d '{"latency": 75, "failureRate": 0.1, "healthy": true}'

# Configure Tier 2  
curl -X POST http://localhost:3002/config \
  -H "Content-Type: application/json" \
  -d '{"latency": 300, "failureRate": 0.2, "healthy": true}'
```

## Metrics and Monitoring

### SLA Compliance Metrics

Each test run generates comprehensive metrics:

```
┌─────────────────┬──────────┬─────────────────────┬─────────────┬─────────────────┬──────────────┐
│ Tier            │ Requests │ Avg Latency (ms)    │ Min/Max (ms)│ SLA Compliance  │ Success Rate │
├─────────────────┼──────────┼─────────────────────┼─────────────┼─────────────────┼──────────────┤
│ mcp_webhook     │ 50       │ 52                  │ 45/67       │ 100%            │ 98%          │
│ bridge_internal │ 15       │ 245                 │ 201/298     │ 100%            │ 95%          │
│ file_watcher    │ 5        │ 2150                │ 1850/2400   │ 100%            │ 100%         │
└─────────────────┴──────────┴─────────────────────┴─────────────┴─────────────────┴──────────────┘
```

### Health Check Endpoints

```bash
# Tier health checks
curl http://localhost:3001/health  # Tier 1
curl http://localhost:3002/health  # Tier 2
curl http://localhost:3003/health  # Tier 3

# Prometheus metrics
curl http://localhost:3001/metrics  # Tier 1 metrics
curl http://localhost:9090          # Prometheus UI
curl http://localhost:16686         # Jaeger UI
```

## Test Results

### Coverage Reports
- **Location**: `./coverage/integration/`
- **Format**: HTML, LCOV, JSON
- **Threshold**: 90% line coverage for tier orchestration code

### Performance Reports
- **Location**: `./reports/integration/`
- **Metrics**: Latency percentiles, throughput, error rates
- **SLA Analysis**: Compliance rates per tier

### Logs
- **Location**: `./logs/integration-test/`
- **Services**: All tier mocks, infrastructure services
- **Format**: Structured JSON with correlation IDs

## Troubleshooting

### Common Issues

1. **Port Conflicts**
```bash
# Check for port usage
lsof -i :3001
lsof -i :3002
lsof -i :3003

# Kill conflicting processes
pkill -f "node.*3001"
```

2. **Docker Issues**
```bash
# Clean up containers
npm run test:tier-cleanup

# Rebuild images
docker-compose -f docker-compose.integration-test.yml build --no-cache
```

3. **Test Timeouts**
```bash
# Increase timeout in jest.config.js
testTimeout: 60000

# Or run with extended timeout
npm run test:integration -- --testTimeout=120000
```

4. **Service Health Issues**
```bash
# Check service logs
docker-compose -f docker-compose.integration-test.yml logs tier1-webhook-mock
docker-compose -f docker-compose.integration-test.yml logs tier2-bridge-mock
docker-compose -f docker-compose.integration-test.yml logs tier3-file-mock
```

### Debug Mode

```bash
# Run tests with debug output
DEBUG=* npm run test:tier-integration:dev

# Keep containers running for inspection
npm run test:tier-integration:dev

# Manual container inspection
docker-compose -f docker-compose.integration-test.yml exec tier1-webhook-mock sh
```

## Performance Tuning

### Resource Allocation

```yaml
# docker-compose.integration-test.yml
deploy:
  resources:
    limits:
      cpus: '0.5'
      memory: 256M
    reservations:
      cpus: '0.1'
      memory: 64M
```

### Test Optimization

```typescript
// Parallel test execution
describe.concurrent('Parallel SLA Tests', () => {
  it.concurrent('Tier 1 SLA', async () => { /* test */ });
  it.concurrent('Tier 2 SLA', async () => { /* test */ });
  it.concurrent('Tier 3 SLA', async () => { /* test */ });
});
```

## Contributing

### Adding New Test Scenarios

1. **Create test case** in `tier-cascading-system.integration.test.ts`
2. **Add mock configuration** if needed in tier mock services
3. **Update documentation** with new scenario details
4. **Validate SLA compliance** with appropriate assertions

### Extending Mock Services

1. **Modify Dockerfile.tier-mocks** for new functionality
2. **Update tier-test-helpers.ts** with new utilities
3. **Add configuration options** in environment variables
4. **Test against real system** to ensure accuracy

## Security Considerations

- **Isolated Network**: Tests run in dedicated Docker network
- **Temporary Storage**: All test data uses tmpfs volumes
- **No Production Data**: Mock services only, no real system interaction
- **Resource Limits**: Containers have CPU/memory constraints
- **Port Binding**: Only necessary ports exposed to host

## Future Enhancements

- **Chaos Engineering**: Random failure injection
- **Performance Regression**: Baseline comparison
- **Visual Testing**: Screenshot-based validation
- **Multi-Region**: Geographic distribution simulation
- **Circuit Breaker**: Advanced failure detection testing
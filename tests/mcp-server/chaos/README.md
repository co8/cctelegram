# Chaos Engineering Tests for CCTelegram Bridge

Comprehensive chaos engineering test suite implementing **Task 25.4** to validate system resilience through controlled failure injection.

## Overview

This chaos engineering test suite provides:

- **Network Fault Injection**: Using Toxiproxy for network-level failures
- **Service Outage Simulation**: Lambda function failures with chaos-monkey-lambda patterns
- **Recovery Validation**: Automatic recovery mechanism testing
- **MTTR Measurement**: Mean Time To Recovery metrics and analysis
- **System State Monitoring**: Real-time monitoring during chaos experiments
- **Resilience Dashboard**: Live dashboard for chaos test execution and recovery metrics

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chaos Engineering Architecture           │
├─────────────────────────────────────────────────────────────┤
│  Chaos Test Runner                                          │
│  ├── Network Fault Injection    ├── Service Outage Tests   │
│  ├── Recovery Validation        ├── MTTR Measurement       │
│  └── System State Monitor       └── Dashboard Integration   │
├─────────────────────────────────────────────────────────────┤
│  Fault Injection Layer                                     │
│  ├── Toxiproxy (Network)        ├── Chaos Monkey (Lambda)  │
│  ├── Docker Integration         ├── Process Failures       │
│  └── Resource Constraints       └── State Corruption        │
├─────────────────────────────────────────────────────────────┤
│  CCTelegram Bridge System Under Test                       │
│  ├── Bridge Process             ├── MCP Server             │
│  ├── Telegram Integration       ├── File System Tier       │
│  └── Resilience Framework       └── Health Monitoring      │
└─────────────────────────────────────────────────────────────┘
```

## Test Structure

```
tests/chaos/
├── README.md                           # This documentation
├── core/
│   ├── chaos-test-runner.ts           # Main chaos test orchestrator
│   ├── fault-injector.ts              # Fault injection engine
│   ├── recovery-validator.ts          # Recovery validation system
│   ├── mttr-analyzer.ts               # MTTR measurement and analysis
│   └── system-monitor.ts              # System state monitoring
├── network/
│   ├── network-chaos.test.ts          # Network fault injection tests
│   ├── toxiproxy-integration.ts       # Toxiproxy wrapper and utilities
│   ├── latency-injection.test.ts      # High latency scenarios
│   ├── partition-simulation.test.ts   # Network partition tests
│   └── bandwidth-limiting.test.ts     # Bandwidth constraint tests
├── service/
│   ├── service-outage.test.ts         # Service failure simulations
│   ├── lambda-chaos.test.ts           # Chaos monkey lambda patterns
│   ├── bridge-failures.test.ts       # Bridge process failure tests
│   ├── telegram-api-failures.test.ts  # Telegram API failure simulation
│   └── cascading-failures.test.ts    # Multi-service failure scenarios
├── recovery/
│   ├── recovery-validation.test.ts    # Recovery mechanism tests
│   ├── circuit-breaker.test.ts        # Circuit breaker behavior validation
│   ├── retry-logic.test.ts            # Retry mechanism testing
│   ├── health-check-recovery.test.ts  # Health check recovery validation
│   └── mttr-measurement.test.ts       # MTTR analysis and benchmarking
├── dashboard/
│   ├── chaos-dashboard.ts             # Real-time chaos testing dashboard
│   ├── metrics-collector.ts          # Chaos metrics collection
│   ├── dashboard-server.ts            # Dashboard web server
│   └── dashboard-ui.html              # Dashboard web interface
├── fixtures/
│   ├── chaos-scenarios.ts             # Predefined chaos scenarios
│   ├── recovery-benchmarks.ts        # Recovery performance benchmarks
│   └── test-data-factory.ts          # Test data generation utilities
└── utils/
    ├── docker-manager.ts              # Docker container management
    ├── process-manager.ts             # Process lifecycle management
    ├── metrics-aggregator.ts          # Metrics collection and aggregation
    └── report-generator.ts            # Chaos test report generation
```

## Quick Start

### Prerequisites

1. **Docker** - For Toxiproxy container management
2. **Node.js 20+** - For test execution
3. **CCTelegram Bridge** - System under test

### Setup

```bash
# Install dependencies
npm install

# Start Toxiproxy container
npm run chaos:toxiproxy:start

# Verify chaos testing infrastructure
npm run test:validate
```

### Running Chaos Tests

```bash
# Run all chaos engineering tests
npm run test:chaos

# Run specific test categories
npm run test:chaos:network      # Network fault injection
npm run test:chaos:service      # Service outage tests
npm run test:chaos:recovery     # Recovery validation

# Start chaos testing dashboard
npm run chaos:dashboard
```

### Basic Usage

```typescript
import { ChaosTestRunner } from './core/chaos-test-runner.js';
import { NetworkChaosScenarios } from './fixtures/chaos-scenarios.js';

const chaosRunner = new ChaosTestRunner();

// Run network partition test
const result = await chaosRunner.executeScenario(
  NetworkChaosScenarios.NETWORK_PARTITION_5_MINUTES
);

console.log(`MTTR: ${result.mttr}ms`);
console.log(`Recovery Success: ${result.recoverySuccessful}`);
```

## Test Scenarios

### 1. Network Fault Injection Tests

**High Latency Injection** (`latency-injection.test.ts`):
- Inject 500ms-5000ms latency into bridge communications
- Validate circuit breaker activation and fallback mechanisms
- Measure impact on response times and success rates

**Network Partition Simulation** (`partition-simulation.test.ts`):
- Simulate complete network partition for 30s-5min periods
- Test file-tier fallback activation and event queuing
- Validate recovery and event replay after partition resolution

**Bandwidth Limiting** (`bandwidth-limiting.test.ts`):
- Limit bandwidth to 1Mbps, 100Kbps, and 10Kbps
- Test system behavior under severe network constraints
- Validate timeout handling and degraded mode operation

### 2. Service Outage Simulation Tests

**Bridge Process Failures** (`bridge-failures.test.ts`):
- Simulate bridge process crashes and unexpected shutdowns
- Test automatic restart mechanisms and process monitoring
- Validate state preservation and recovery after restart

**Lambda Chaos Patterns** (`lambda-chaos.test.ts`):
- Implement chaos-monkey-lambda failure patterns
- Random function failures, timeouts, and resource exhaustion
- Test distributed system resilience to function-level failures

**Cascading Failure Scenarios** (`cascading-failures.test.ts`):
- Simulate multiple simultaneous service failures
- Test system behavior under compound failure conditions
- Validate graceful degradation and emergency fallback modes

### 3. Recovery Validation Tests

**Circuit Breaker Validation** (`circuit-breaker.test.ts`):
- Test circuit breaker activation under various failure conditions
- Validate half-open state behavior and recovery detection
- Measure circuit breaker effectiveness in preventing cascade failures

**Retry Logic Testing** (`retry-logic.test.ts`):
- Test exponential backoff and jitter implementation
- Validate retry limits and non-retryable error handling
- Measure retry effectiveness and resource consumption

**MTTR Measurement** (`mttr-measurement.test.ts`):
- Automated MTTR measurement across various failure scenarios
- Statistical analysis of recovery performance
- Benchmarking against SLA targets (5-minute MTTR goal)

## Configuration

### Chaos Test Configuration

```typescript
export interface ChaosTestConfig {
  environment: 'test' | 'staging' | 'production';
  toxiproxy: {
    host: string;
    port: number;
    proxies: ToxiproxyConfig[];
  };
  scenarios: {
    networkLatency: { min: number; max: number; };
    partitionDuration: { min: number; max: number; };
    serviceFailureRate: number;
  };
  monitoring: {
    metricsInterval: number;
    alertThresholds: MetricThresholds;
  };
  recovery: {
    maxRecoveryTime: number; // Maximum acceptable MTTR
    healthCheckInterval: number;
    retryTimeout: number;
  };
}
```

### Toxiproxy Configuration

```typescript
export interface ToxiproxyConfig {
  name: string;
  listen: string;
  upstream: string;
  enabled: boolean;
  toxics: ToxicConfig[];
}

export interface ToxicConfig {
  name: string;
  type: 'latency' | 'bandwidth' | 'slow_close' | 'timeout' | 'slicer';
  stream: 'upstream' | 'downstream';
  toxicity: number; // 0.0 to 1.0
  attributes: Record<string, any>;
}
```

### Environment Variables

```bash
# Chaos testing configuration
CHAOS_ENABLED=true
CHAOS_ENVIRONMENT=test
CHAOS_SAFE_MODE=true
CHAOS_MAX_DURATION=300000  # 5 minutes max per test

# Toxiproxy configuration
TOXIPROXY_HOST=localhost
TOXIPROXY_PORT=8474
TOXIPROXY_AUTO_START=true

# Bridge configuration for chaos testing
CC_TELEGRAM_BRIDGE_PATH=/path/to/bridge/binary
CC_TELEGRAM_CHAOS_MODE=true
CC_TELEGRAM_HEALTH_PORT=8080
CC_TELEGRAM_WEBHOOK_PORT=3000

# Monitoring and alerting
CHAOS_METRICS_ENDPOINT=http://localhost:9090
CHAOS_DASHBOARD_PORT=3001
CHAOS_ALERT_WEBHOOKS=http://localhost:3002/alerts
```

## Dashboard and Monitoring

### Chaos Testing Dashboard

The dashboard provides real-time monitoring of chaos experiments:

- **Live Experiment Status**: Current running experiments and their progress
- **System Health Metrics**: CPU, memory, network, and response time monitoring
- **Recovery Analytics**: MTTR trends, success rates, and failure patterns
- **Historical Analysis**: Past experiment results and trend analysis

Access the dashboard at: `http://localhost:3001/chaos-dashboard`

### Key Metrics Tracked

**Recovery Metrics**:
- **MTTR (Mean Time To Recovery)**: Average time to restore service
- **MTTF (Mean Time To Failure)**: Average time between failures
- **Recovery Success Rate**: Percentage of successful automatic recoveries
- **Failure Detection Time**: Time to detect and respond to failures

**System Performance Metrics**:
- **Request Success Rate**: Percentage of successful requests during chaos
- **Response Time P95/P99**: Response time percentiles under stress
- **Circuit Breaker Activations**: Frequency and effectiveness of circuit breakers
- **Resource Utilization**: CPU, memory, and network usage during experiments

**Business Impact Metrics**:
- **Event Processing Rate**: Events processed per second during failures
- **Message Delivery Success**: Telegram message delivery success rate
- **Data Consistency**: File system and state consistency validation
- **User Experience Impact**: End-to-end workflow success rate

## Benchmarks and SLA Targets

### Recovery Performance Targets

| Scenario | Target MTTR | Max Acceptable | Current Benchmark |
|----------|-------------|----------------|-------------------|
| Network Partition | < 30s | 60s | TBD |
| Bridge Process Failure | < 15s | 30s | TBD |
| Telegram API Failure | < 10s | 20s | TBD |
| High Latency (>1s) | < 5s | 10s | TBD |
| Resource Exhaustion | < 45s | 90s | TBD |
| Multi-Service Failure | < 120s | 300s | TBD |

### System Resilience Targets

- **Availability**: 99.9% uptime (8.7 hours downtime/year max)
- **Event Processing**: 95% of events processed within 2x normal time during failures
- **Message Delivery**: 99.5% message delivery success rate during non-catastrophic failures
- **Data Consistency**: 100% data consistency after recovery (zero data loss)
- **Circuit Breaker Effectiveness**: 90% cascade failure prevention rate

## CI/CD Integration

### GitHub Actions Integration

```yaml
name: Chaos Engineering Tests
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  chaos-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Start Toxiproxy
        run: npm run chaos:toxiproxy:start
        
      - name: Run Chaos Tests
        run: npm run test:chaos
        env:
          CHAOS_ENVIRONMENT: ci
          CHAOS_SAFE_MODE: true
          
      - name: Generate Chaos Report
        run: npm run chaos:report
        
      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: chaos-test-results
          path: |
            test-results/chaos/
            chaos-reports/
```

## Safety and Best Practices

### Safety Measures

1. **Environment Isolation**: Chaos tests only run in test/staging environments
2. **Safe Mode**: Automatic safety checks prevent dangerous experiments
3. **Time Limits**: Maximum experiment duration limits prevent runaway tests
4. **Rollback Plans**: Every experiment has automated rollback procedures
5. **Monitoring**: Continuous monitoring with automatic experiment termination

### Best Practices

1. **Start Small**: Begin with low-impact experiments and gradually increase intensity
2. **Hypothesis-Driven**: Each experiment should test a specific resilience hypothesis
3. **Document Everything**: Record all experiments, results, and learnings
4. **Regular Cadence**: Run chaos tests regularly, not just during development
5. **Post-Mortem Analysis**: Analyze failures to improve system resilience

### Troubleshooting

**Common Issues**:

1. **Toxiproxy Connection Failed**
   ```bash
   # Check if Toxiproxy is running
   curl http://localhost:8474/version
   
   # Restart Toxiproxy
   npm run chaos:toxiproxy:stop
   npm run chaos:toxiproxy:start
   ```

2. **Bridge Process Not Responding**
   ```bash
   # Check bridge health
   curl http://localhost:8080/health
   
   # Check bridge process
   ps aux | grep cctelegram
   ```

3. **Test Timeout Issues**
   ```bash
   # Increase timeout for specific tests
   CHAOS_MAX_DURATION=600000 npm run test:chaos:recovery
   
   # Run with debug logging
   DEBUG=chaos* npm run test:chaos
   ```

4. **Docker Permission Issues**
   ```bash
   # Add user to docker group
   sudo usermod -aG docker $USER
   
   # Restart session or use sudo
   sudo npm run chaos:toxiproxy:start
   ```

## Contributing

### Adding New Chaos Scenarios

1. **Define Scenario**: Create scenario definition in `fixtures/chaos-scenarios.ts`
2. **Implement Test**: Add test file in appropriate category directory
3. **Add Metrics**: Update metrics collection for new scenario type
4. **Update Dashboard**: Add dashboard visualization for new metrics
5. **Document**: Update README with new scenario description

### Extending Fault Injection

1. **New Fault Type**: Add fault type to `FaultInjector` class
2. **Integration**: Add integration with fault injection tool (Toxiproxy, etc.)
3. **Configuration**: Add configuration options to chaos test config
4. **Validation**: Add recovery validation for new fault type
5. **Monitoring**: Add specific monitoring for new fault type

---

## Summary

This comprehensive chaos engineering test suite provides:

✅ **Network Fault Injection** with Toxiproxy integration for realistic network failure simulation
✅ **Service Outage Simulation** using chaos-monkey-lambda patterns for function-level failures  
✅ **Recovery Validation** with automated testing of all resilience mechanisms
✅ **MTTR Measurement** with statistical analysis and benchmarking against SLA targets
✅ **System State Monitoring** with real-time metrics collection and alerting
✅ **Live Dashboard** for chaos test execution monitoring and historical analysis
✅ **CI/CD Integration** with automated daily chaos testing and reporting
✅ **Safety Controls** with environment isolation and automatic experiment termination

The test suite ensures the CCTelegram bridge system maintains high availability and resilience under various failure conditions, providing confidence in production deployments and enabling continuous resilience improvement.
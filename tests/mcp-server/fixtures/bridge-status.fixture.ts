/**
 * Bridge Status Fixtures
 * Sample bridge status data for testing
 */

import { BridgeStatus } from '../../src/types.js';

export class BridgeStatusFixtures {
  static createHealthyStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
    return {
      running: true,
      health: 'healthy',
      metrics: {
        uptime_seconds: 3600,
        events_processed: 150,
        telegram_messages_sent: 145,
        error_count: 2,
        memory_usage_mb: 50,
        cpu_usage_percent: 15.5
      },
      last_event_time: new Date().toISOString(),
      ...overrides
    };
  }

  static createUnhealthyStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
    return {
      running: false,
      health: 'unhealthy',
      metrics: {
        uptime_seconds: 0,
        events_processed: 0,
        telegram_messages_sent: 0,
        error_count: 0,
        memory_usage_mb: 0,
        cpu_usage_percent: 0
      },
      ...overrides
    };
  }

  static createDegradedStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
    return {
      running: true,
      health: 'degraded',
      metrics: {
        uptime_seconds: 1800,
        events_processed: 75,
        telegram_messages_sent: 60,
        error_count: 15,
        memory_usage_mb: 120,
        cpu_usage_percent: 65.2
      },
      last_event_time: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
      ...overrides
    };
  }

  static createHighLoadStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
    return this.createHealthyStatus({
      health: 'degraded',
      metrics: {
        uptime_seconds: 7200,
        events_processed: 1500,
        telegram_messages_sent: 1450,
        error_count: 25,
        memory_usage_mb: 200,
        cpu_usage_percent: 85.7
      },
      ...overrides
    });
  }

  static createLowResourceStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
    return this.createHealthyStatus({
      metrics: {
        uptime_seconds: 1200,
        events_processed: 25,
        telegram_messages_sent: 22,
        error_count: 0,
        memory_usage_mb: 15,
        cpu_usage_percent: 2.1
      },
      ...overrides
    });
  }

  // Metrics string fixtures for parsing tests
  static createMetricsString(overrides: any = {}): string {
    const metrics = {
      process_uptime_seconds: 3600,
      events_processed_total: 150,
      telegram_messages_sent_total: 145,
      errors_total: 2,
      memory_usage_bytes: 52428800, // 50MB
      cpu_usage_percent: 15.5,
      ...overrides
    };

    return `
# HELP process_uptime_seconds Process uptime in seconds
process_uptime_seconds ${metrics.process_uptime_seconds}

# HELP events_processed_total Total events processed
events_processed_total ${metrics.events_processed_total}

# HELP telegram_messages_sent_total Total Telegram messages sent
telegram_messages_sent_total ${metrics.telegram_messages_sent_total}

# HELP errors_total Total errors encountered
errors_total ${metrics.errors_total}

# HELP memory_usage_bytes Memory usage in bytes
memory_usage_bytes ${metrics.memory_usage_bytes}

# HELP cpu_usage_percent CPU usage percentage
cpu_usage_percent ${metrics.cpu_usage_percent}
`.trim();
  }

  static createEmptyMetricsString(): string {
    return `
# HELP process_uptime_seconds Process uptime in seconds
# HELP events_processed_total Total events processed
# HELP telegram_messages_sent_total Total Telegram messages sent
# HELP errors_total Total errors encountered
# HELP memory_usage_bytes Memory usage in bytes
# HELP cpu_usage_percent CPU usage percentage
`.trim();
  }

  static createMalformedMetricsString(): string {
    return `
# Invalid metrics format
process_uptime_seconds invalid_value
events_processed_total 
telegram_messages_sent_total abc123
memory_usage_bytes -50
`.trim();
  }

  static createHealthData(healthy = true): any {
    if (healthy) {
      return {
        status: 'healthy',
        uptime: 3600,
        last_event_time: new Date().toISOString(),
        version: '0.5.1',
        telegram_connected: true
      };
    } else {
      return {
        status: 'unhealthy',
        error: 'Service unavailable',
        uptime: 0,
        telegram_connected: false
      };
    }
  }
}
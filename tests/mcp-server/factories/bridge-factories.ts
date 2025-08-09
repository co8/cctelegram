/**
 * Bridge Factory Definitions
 * 
 * Factory definitions for bridge status, configurations, and system states
 */

import { Factory, FactoryUtils, Sequences } from './factory-bot.js';
import { BridgeStatus } from '../../src/types.js';

/**
 * Bridge status factory
 */
Factory.define<BridgeStatus>('bridge_status', () => ({
  running: true,
  health: 'healthy',
  metrics: {
    uptime_seconds: FactoryUtils.randomNumber(0, 86400), // Up to 24 hours
    events_processed: FactoryUtils.randomNumber(0, 10000),
    telegram_messages_sent: FactoryUtils.randomNumber(0, 1000),
    error_count: FactoryUtils.randomNumber(0, 10),
    memory_usage_mb: FactoryUtils.randomFloat(50, 512, 1),
    cpu_usage_percent: FactoryUtils.randomFloat(5, 80, 1)
  },
  last_event_time: new Date().toISOString()
}), {
  traits: {
    // Health states
    healthy: (status) => ({
      ...status,
      running: true,
      health: 'healthy',
      metrics: {
        ...status.metrics,
        memory_usage_mb: FactoryUtils.randomFloat(50, 200, 1),
        cpu_usage_percent: FactoryUtils.randomFloat(5, 30, 1),
        error_count: FactoryUtils.randomNumber(0, 2)
      }
    }),

    degraded: (status) => ({
      ...status,
      running: true,
      health: 'degraded',
      metrics: {
        ...status.metrics,
        memory_usage_mb: FactoryUtils.randomFloat(200, 400, 1),
        cpu_usage_percent: FactoryUtils.randomFloat(30, 70, 1),
        error_count: FactoryUtils.randomNumber(3, 10)
      }
    }),

    unhealthy: (status) => ({
      ...status,
      running: FactoryUtils.randomBoolean(0.3), // 30% chance still running
      health: 'unhealthy',
      metrics: {
        ...status.metrics,
        memory_usage_mb: FactoryUtils.randomFloat(400, 1024, 1),
        cpu_usage_percent: FactoryUtils.randomFloat(70, 100, 1),
        error_count: FactoryUtils.randomNumber(10, 100)
      }
    }),

    // Running states
    starting: (status) => ({
      ...status,
      running: true,
      health: 'healthy',
      metrics: {
        ...status.metrics,
        uptime_seconds: FactoryUtils.randomNumber(0, 60), // Less than 1 minute
        events_processed: FactoryUtils.randomNumber(0, 5),
        telegram_messages_sent: 0
      }
    }),

    stopped: (status) => ({
      ...status,
      running: false,
      health: 'unhealthy',
      metrics: {
        ...status.metrics,
        uptime_seconds: 0,
        memory_usage_mb: 0,
        cpu_usage_percent: 0
      },
      last_event_time: undefined
    }),

    restarting: (status) => ({
      ...status,
      running: true,
      health: 'degraded',
      metrics: {
        ...status.metrics,
        uptime_seconds: FactoryUtils.randomNumber(0, 30), // Very recent restart
        events_processed: 0,
        telegram_messages_sent: 0,
        error_count: 0
      }
    }),

    // Performance characteristics
    high_load: (status) => ({
      ...status,
      metrics: {
        ...status.metrics,
        events_processed: FactoryUtils.randomNumber(5000, 50000),
        telegram_messages_sent: FactoryUtils.randomNumber(1000, 10000),
        memory_usage_mb: FactoryUtils.randomFloat(300, 800, 1),
        cpu_usage_percent: FactoryUtils.randomFloat(60, 95, 1)
      }
    }),

    low_load: (status) => ({
      ...status,
      metrics: {
        ...status.metrics,
        events_processed: FactoryUtils.randomNumber(0, 100),
        telegram_messages_sent: FactoryUtils.randomNumber(0, 50),
        memory_usage_mb: FactoryUtils.randomFloat(50, 150, 1),
        cpu_usage_percent: FactoryUtils.randomFloat(2, 20, 1)
      }
    }),

    // Uptime scenarios
    fresh_start: (status) => ({
      ...status,
      metrics: {
        ...status.metrics,
        uptime_seconds: FactoryUtils.randomNumber(0, 300), // Less than 5 minutes
        events_processed: FactoryUtils.randomNumber(0, 10),
        telegram_messages_sent: FactoryUtils.randomNumber(0, 3)
      }
    }),

    long_running: (status) => ({
      ...status,
      metrics: {
        ...status.metrics,
        uptime_seconds: FactoryUtils.randomNumber(86400, 604800), // 1-7 days
        events_processed: FactoryUtils.randomNumber(10000, 100000),
        telegram_messages_sent: FactoryUtils.randomNumber(2000, 20000)
      }
    }),

    // Error scenarios
    high_errors: (status) => ({
      ...status,
      health: 'degraded',
      metrics: {
        ...status.metrics,
        error_count: FactoryUtils.randomNumber(50, 500)
      }
    }),

    no_errors: (status) => ({
      ...status,
      metrics: {
        ...status.metrics,
        error_count: 0
      }
    }),

    // Activity scenarios
    active: (status) => ({
      ...status,
      last_event_time: new Date(Date.now() - FactoryUtils.randomNumber(0, 300000)).toISOString(), // Within 5 minutes
      metrics: {
        ...status.metrics,
        events_processed: FactoryUtils.randomNumber(100, 10000)
      }
    }),

    inactive: (status) => ({
      ...status,
      last_event_time: new Date(Date.now() - FactoryUtils.randomNumber(3600000, 86400000)).toISOString(), // 1-24 hours ago
      metrics: {
        ...status.metrics,
        events_processed: FactoryUtils.randomNumber(0, 50)
      }
    }),

    // Memory scenarios
    memory_leak: (status) => ({
      ...status,
      health: 'degraded',
      metrics: {
        ...status.metrics,
        memory_usage_mb: FactoryUtils.randomFloat(800, 2048, 1)
      }
    }),

    low_memory: (status) => ({
      ...status,
      metrics: {
        ...status.metrics,
        memory_usage_mb: FactoryUtils.randomFloat(20, 100, 1)
      }
    }),

    // Special scenarios for testing
    connection_timeout: (status) => ({
      ...status,
      running: false,
      health: 'unhealthy',
      last_event_time: undefined
    }),

    invalid_data: (status) => ({
      ...status,
      metrics: {
        ...status.metrics,
        uptime_seconds: -1, // Invalid negative uptime
        memory_usage_mb: -50, // Invalid negative memory
        cpu_usage_percent: 150 // Invalid >100% CPU
      }
    })
  }
});

/**
 * Bridge configuration factory
 */
Factory.define('bridge_config', () => ({
  telegram_bot_token: `bot${FactoryUtils.randomString(45, 'abcdefghijklmnopqrstuvwxyz0123456789')}`,
  chat_id: FactoryUtils.randomNumber(-1000000000000, -1),
  events_dir: '/tmp/cctelegram/events',
  responses_dir: '/tmp/cctelegram/responses',
  polling_interval_ms: FactoryUtils.randomNumber(1000, 10000),
  max_retries: FactoryUtils.randomNumber(3, 10),
  timeout_ms: FactoryUtils.randomNumber(5000, 30000),
  log_level: FactoryUtils.randomChoice(['debug', 'info', 'warn', 'error']),
  enable_metrics: FactoryUtils.randomBoolean(0.8),
  metrics_port: Factory.sequence('port'),
  enable_health_check: true,
  health_check_interval_ms: FactoryUtils.randomNumber(30000, 300000)
}), {
  traits: {
    // Environment-specific configurations
    development: (config) => ({
      ...config,
      log_level: 'debug',
      polling_interval_ms: 1000,
      enable_metrics: true,
      timeout_ms: 10000
    }),

    production: (config) => ({
      ...config,
      log_level: 'info',
      polling_interval_ms: 5000,
      enable_metrics: true,
      timeout_ms: 30000,
      max_retries: 5
    }),

    testing: (config) => ({
      ...config,
      log_level: 'error',
      polling_interval_ms: 100, // Fast polling for tests
      enable_metrics: false,
      timeout_ms: 5000,
      events_dir: '/tmp/test-events',
      responses_dir: '/tmp/test-responses'
    }),

    // Performance configurations
    high_performance: (config) => ({
      ...config,
      polling_interval_ms: 500,
      timeout_ms: 5000,
      max_retries: 3
    }),

    conservative: (config) => ({
      ...config,
      polling_interval_ms: 10000,
      timeout_ms: 60000,
      max_retries: 10
    }),

    // Security configurations
    secure: (config) => ({
      ...config,
      enable_metrics: false, // Disable metrics for security
      log_level: 'warn' // Reduce logging
    }),

    // Invalid configurations for error testing
    invalid_token: (config) => ({
      ...config,
      telegram_bot_token: 'invalid-token'
    }),

    invalid_chat_id: (config) => ({
      ...config,
      chat_id: 'not-a-number'
    }),

    invalid_paths: (config) => ({
      ...config,
      events_dir: '/nonexistent/path',
      responses_dir: '/another/nonexistent/path'
    }),

    missing_required: (config) => {
      const { telegram_bot_token, ...configWithoutToken } = config;
      return configWithoutToken;
    }
  },

  sequences: {
    port: Sequences.port
  }
});

/**
 * Process information factory
 */
Factory.define('process_info', () => ({
  pid: Factory.sequence('pid'),
  status: 'running',
  cpu_usage: FactoryUtils.randomFloat(5, 80, 1),
  memory_usage: FactoryUtils.randomFloat(50, 512, 1),
  uptime_seconds: FactoryUtils.randomNumber(0, 86400),
  command: 'cctelegram-bridge',
  working_directory: '/app',
  environment: 'production'
}), {
  traits: {
    // Process states
    running: (proc) => ({
      ...proc,
      status: 'running'
    }),

    stopped: (proc) => ({
      ...proc,
      status: 'stopped',
      pid: null,
      cpu_usage: 0,
      memory_usage: 0,
      uptime_seconds: 0
    }),

    zombie: (proc) => ({
      ...proc,
      status: 'zombie',
      cpu_usage: 0
    }),

    // Resource usage
    high_cpu: (proc) => ({
      ...proc,
      cpu_usage: FactoryUtils.randomFloat(80, 100, 1)
    }),

    high_memory: (proc) => ({
      ...proc,
      memory_usage: FactoryUtils.randomFloat(800, 2048, 1)
    }),

    efficient: (proc) => ({
      ...proc,
      cpu_usage: FactoryUtils.randomFloat(2, 20, 1),
      memory_usage: FactoryUtils.randomFloat(50, 200, 1)
    })
  },

  sequences: {
    pid: Sequences.pid
  }
});

/**
 * System metrics factory
 */
Factory.define('system_metrics', () => ({
  timestamp: new Date().toISOString(),
  system: {
    cpu_usage_percent: FactoryUtils.randomFloat(10, 80, 1),
    memory_usage_percent: FactoryUtils.randomFloat(30, 85, 1),
    disk_usage_percent: FactoryUtils.randomFloat(20, 90, 1),
    load_average: [
      FactoryUtils.randomFloat(0.5, 3.0, 2),
      FactoryUtils.randomFloat(0.5, 3.0, 2),
      FactoryUtils.randomFloat(0.5, 3.0, 2)
    ],
    uptime_seconds: FactoryUtils.randomNumber(3600, 2592000) // 1 hour to 30 days
  },
  bridge: {
    status: 'running',
    memory_usage_mb: FactoryUtils.randomFloat(50, 512, 1),
    cpu_usage_percent: FactoryUtils.randomFloat(5, 50, 1),
    events_processed_per_minute: FactoryUtils.randomNumber(0, 100),
    error_rate_percent: FactoryUtils.randomFloat(0, 5, 2)
  },
  network: {
    bytes_sent: FactoryUtils.randomNumber(1000000, 100000000),
    bytes_received: FactoryUtils.randomNumber(1000000, 100000000),
    packets_sent: FactoryUtils.randomNumber(10000, 1000000),
    packets_received: FactoryUtils.randomNumber(10000, 1000000),
    connections_active: FactoryUtils.randomNumber(1, 50)
  }
}), {
  traits: {
    // System health states
    healthy_system: (metrics) => ({
      ...metrics,
      system: {
        ...metrics.system,
        cpu_usage_percent: FactoryUtils.randomFloat(10, 40, 1),
        memory_usage_percent: FactoryUtils.randomFloat(30, 60, 1),
        disk_usage_percent: FactoryUtils.randomFloat(20, 50, 1)
      },
      bridge: {
        ...metrics.bridge,
        error_rate_percent: FactoryUtils.randomFloat(0, 1, 2)
      }
    }),

    stressed_system: (metrics) => ({
      ...metrics,
      system: {
        ...metrics.system,
        cpu_usage_percent: FactoryUtils.randomFloat(80, 98, 1),
        memory_usage_percent: FactoryUtils.randomFloat(85, 95, 1),
        load_average: [
          FactoryUtils.randomFloat(4.0, 8.0, 2),
          FactoryUtils.randomFloat(4.0, 8.0, 2),
          FactoryUtils.randomFloat(4.0, 8.0, 2)
        ]
      },
      bridge: {
        ...metrics.bridge,
        error_rate_percent: FactoryUtils.randomFloat(5, 20, 2)
      }
    }),

    low_resources: (metrics) => ({
      ...metrics,
      system: {
        ...metrics.system,
        cpu_usage_percent: FactoryUtils.randomFloat(2, 15, 1),
        memory_usage_percent: FactoryUtils.randomFloat(10, 30, 1)
      },
      bridge: {
        ...metrics.bridge,
        memory_usage_mb: FactoryUtils.randomFloat(20, 100, 1),
        cpu_usage_percent: FactoryUtils.randomFloat(1, 10, 1),
        events_processed_per_minute: FactoryUtils.randomNumber(0, 10)
      }
    })
  }
});
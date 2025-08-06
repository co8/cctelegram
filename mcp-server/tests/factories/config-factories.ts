/**
 * Configuration Factory Definitions
 * 
 * Factory definitions for various configuration objects and settings
 */

import { Factory, FactoryUtils, Sequences } from './factory-bot.js';

/**
 * MCP server configuration factory
 */
Factory.define('mcp_config', () => ({
  server: {
    host: '127.0.0.1',
    port: Factory.sequence('port'),
    timeout_ms: FactoryUtils.randomNumber(5000, 30000),
    max_connections: FactoryUtils.randomNumber(10, 100),
    keep_alive: true
  },
  security: {
    enable_auth: FactoryUtils.randomBoolean(0.7),
    enable_rate_limit: FactoryUtils.randomBoolean(0.8),
    enable_input_validation: true,
    enable_secure_logging: FactoryUtils.randomBoolean(0.6),
    allowed_origins: ['http://localhost', 'https://claude.ai'],
    max_request_size_mb: FactoryUtils.randomNumber(1, 10)
  },
  logging: {
    level: FactoryUtils.randomChoice(['debug', 'info', 'warn', 'error']),
    format: FactoryUtils.randomChoice(['json', 'text']),
    output: FactoryUtils.randomChoice(['console', 'file', 'both']),
    file_path: '/var/log/cctelegram-mcp.log',
    max_file_size_mb: FactoryUtils.randomNumber(10, 100),
    max_files: FactoryUtils.randomNumber(5, 20)
  },
  bridge: {
    connection_url: 'http://localhost:3000',
    timeout_ms: FactoryUtils.randomNumber(5000, 15000),
    retry_attempts: FactoryUtils.randomNumber(3, 10),
    retry_delay_ms: FactoryUtils.randomNumber(1000, 5000),
    health_check_interval_ms: FactoryUtils.randomNumber(30000, 300000)
  },
  telegram: {
    bot_token: `bot${FactoryUtils.randomString(45)}`,
    chat_id: FactoryUtils.randomNumber(-1000000000000, -1),
    api_url: 'https://api.telegram.org',
    timeout_ms: FactoryUtils.randomNumber(10000, 30000),
    retry_attempts: FactoryUtils.randomNumber(3, 5)
  }
}), {
  traits: {
    // Environment-specific configurations
    development: (config) => ({
      ...config,
      server: {
        ...config.server,
        host: '0.0.0.0',
        port: 3001
      },
      security: {
        ...config.security,
        enable_auth: false,
        enable_rate_limit: false
      },
      logging: {
        ...config.logging,
        level: 'debug',
        output: 'console'
      }
    }),

    production: (config) => ({
      ...config,
      server: {
        ...config.server,
        host: '127.0.0.1',
        port: 3000,
        max_connections: 50
      },
      security: {
        ...config.security,
        enable_auth: true,
        enable_rate_limit: true,
        enable_secure_logging: true
      },
      logging: {
        ...config.logging,
        level: 'info',
        output: 'file'
      }
    }),

    testing: (config) => ({
      ...config,
      server: {
        ...config.server,
        host: '127.0.0.1',
        port: 0, // Random port
        timeout_ms: 5000
      },
      security: {
        ...config.security,
        enable_auth: false,
        enable_rate_limit: false
      },
      logging: {
        ...config.logging,
        level: 'error',
        output: 'console'
      },
      bridge: {
        ...config.bridge,
        timeout_ms: 2000,
        retry_attempts: 1
      }
    }),

    // Security configurations
    high_security: (config) => ({
      ...config,
      security: {
        ...config.security,
        enable_auth: true,
        enable_rate_limit: true,
        enable_input_validation: true,
        enable_secure_logging: true,
        allowed_origins: ['https://claude.ai'],
        max_request_size_mb: 1
      }
    }),

    minimal_security: (config) => ({
      ...config,
      security: {
        ...config.security,
        enable_auth: false,
        enable_rate_limit: false,
        enable_input_validation: false,
        enable_secure_logging: false,
        allowed_origins: ['*'],
        max_request_size_mb: 100
      }
    }),

    // Performance configurations
    high_performance: (config) => ({
      ...config,
      server: {
        ...config.server,
        timeout_ms: 2000,
        max_connections: 200,
        keep_alive: true
      },
      bridge: {
        ...config.bridge,
        timeout_ms: 1000,
        retry_attempts: 2,
        retry_delay_ms: 500
      }
    }),

    conservative: (config) => ({
      ...config,
      server: {
        ...config.server,
        timeout_ms: 60000,
        max_connections: 10,
        keep_alive: false
      },
      bridge: {
        ...config.bridge,
        timeout_ms: 30000,
        retry_attempts: 10,
        retry_delay_ms: 5000
      }
    }),

    // Invalid configurations for error testing
    invalid_port: (config) => ({
      ...config,
      server: {
        ...config.server,
        port: -1
      }
    }),

    invalid_telegram: (config) => ({
      ...config,
      telegram: {
        ...config.telegram,
        bot_token: 'invalid-token',
        chat_id: 'not-a-number'
      }
    }),

    missing_required: (config) => {
      const { telegram, ...configWithoutTelegram } = config;
      return configWithoutTelegram;
    }
  },

  sequences: {
    port: Sequences.port
  }
});

/**
 * Bridge configuration factory
 */
Factory.define('bridge_config', () => ({
  telegram: {
    bot_token: `bot${FactoryUtils.randomString(45)}`,
    chat_id: FactoryUtils.randomNumber(-1000000000000, -1),
    polling_interval_ms: FactoryUtils.randomNumber(1000, 10000),
    max_retries: FactoryUtils.randomNumber(3, 10),
    timeout_ms: FactoryUtils.randomNumber(10000, 30000)
  },
  filesystem: {
    events_dir: '/tmp/cctelegram/events',
    responses_dir: '/tmp/cctelegram/responses',
    watch_interval_ms: FactoryUtils.randomNumber(500, 5000),
    cleanup_interval_minutes: FactoryUtils.randomNumber(60, 1440),
    max_file_age_hours: FactoryUtils.randomNumber(24, 168),
    max_files_per_directory: FactoryUtils.randomNumber(100, 10000)
  },
  server: {
    host: '127.0.0.1',
    port: Factory.sequence('port'),
    enable_metrics: FactoryUtils.randomBoolean(0.8),
    metrics_port: Factory.sequence('port'),
    health_check_path: '/health',
    metrics_path: '/metrics'
  },
  logging: {
    level: FactoryUtils.randomChoice(['trace', 'debug', 'info', 'warn', 'error']),
    format: FactoryUtils.randomChoice(['json', 'pretty']),
    target: FactoryUtils.randomChoice(['stdout', 'stderr', 'file']),
    file_path: '/var/log/cctelegram-bridge.log'
  },
  features: {
    enable_event_deduplication: FactoryUtils.randomBoolean(0.9),
    enable_response_caching: FactoryUtils.randomBoolean(0.7),
    enable_performance_monitoring: FactoryUtils.randomBoolean(0.8),
    enable_auto_restart: FactoryUtils.randomBoolean(0.6)
  }
}), {
  traits: {
    // Environment-specific configurations
    development: (config) => ({
      ...config,
      telegram: {
        ...config.telegram,
        polling_interval_ms: 1000
      },
      filesystem: {
        ...config.filesystem,
        watch_interval_ms: 500,
        events_dir: '/tmp/dev-events',
        responses_dir: '/tmp/dev-responses'
      },
      logging: {
        ...config.logging,
        level: 'debug',
        format: 'pretty',
        target: 'stdout'
      }
    }),

    production: (config) => ({
      ...config,
      telegram: {
        ...config.telegram,
        polling_interval_ms: 5000,
        max_retries: 5
      },
      filesystem: {
        ...config.filesystem,
        watch_interval_ms: 2000,
        events_dir: '/var/lib/cctelegram/events',
        responses_dir: '/var/lib/cctelegram/responses'
      },
      logging: {
        ...config.logging,
        level: 'info',
        format: 'json',
        target: 'file'
      },
      features: {
        ...config.features,
        enable_event_deduplication: true,
        enable_performance_monitoring: true
      }
    }),

    testing: (config) => ({
      ...config,
      telegram: {
        ...config.telegram,
        polling_interval_ms: 100,
        timeout_ms: 5000
      },
      filesystem: {
        ...config.filesystem,
        watch_interval_ms: 100,
        events_dir: '/tmp/test-events',
        responses_dir: '/tmp/test-responses',
        cleanup_interval_minutes: 1,
        max_file_age_hours: 1
      },
      logging: {
        ...config.logging,
        level: 'error',
        target: 'stderr'
      }
    }),

    // Performance configurations
    fast_polling: (config) => ({
      ...config,
      telegram: {
        ...config.telegram,
        polling_interval_ms: 100
      },
      filesystem: {
        ...config.filesystem,
        watch_interval_ms: 100
      }
    }),

    slow_polling: (config) => ({
      ...config,
      telegram: {
        ...config.telegram,
        polling_interval_ms: 30000
      },
      filesystem: {
        ...config.filesystem,
        watch_interval_ms: 10000
      }
    }),

    // Resource configurations
    low_resources: (config) => ({
      ...config,
      filesystem: {
        ...config.filesystem,
        max_files_per_directory: 100,
        cleanup_interval_minutes: 30,
        max_file_age_hours: 6
      },
      features: {
        ...config.features,
        enable_response_caching: false,
        enable_performance_monitoring: false
      }
    }),

    high_capacity: (config) => ({
      ...config,
      filesystem: {
        ...config.filesystem,
        max_files_per_directory: 50000,
        cleanup_interval_minutes: 1440,
        max_file_age_hours: 720
      },
      features: {
        ...config.features,
        enable_response_caching: true,
        enable_performance_monitoring: true,
        enable_event_deduplication: true
      }
    })
  },

  sequences: {
    port: Sequences.port
  }
});

/**
 * Test configuration factory for different testing scenarios
 */
Factory.define('test_config', () => ({
  test_environment: FactoryUtils.randomChoice(['unit', 'integration', 'e2e', 'performance']),
  timeout_ms: FactoryUtils.randomNumber(5000, 120000),
  retries: FactoryUtils.randomNumber(0, 3),
  parallel: FactoryUtils.randomBoolean(0.7),
  cleanup_after: FactoryUtils.randomBoolean(0.9),
  mock_external_services: FactoryUtils.randomBoolean(0.8),
  generate_coverage: FactoryUtils.randomBoolean(0.6),
  test_data: {
    events_count: FactoryUtils.randomNumber(5, 100),
    responses_count: FactoryUtils.randomNumber(2, 50),
    users_count: FactoryUtils.randomNumber(1, 10),
    duration_minutes: FactoryUtils.randomNumber(1, 60)
  },
  thresholds: {
    response_time_ms: FactoryUtils.randomNumber(100, 5000),
    memory_usage_mb: FactoryUtils.randomNumber(100, 1000),
    cpu_usage_percent: FactoryUtils.randomNumber(50, 90),
    error_rate_percent: FactoryUtils.randomFloat(0, 5, 2)
  },
  fixtures: {
    use_factories: true,
    reset_sequences: true,
    cleanup_between_tests: true,
    seed_random: FactoryUtils.randomNumber(1000, 9999)
  }
}), {
  traits: {
    // Test types
    unit_test: (config) => ({
      ...config,
      test_environment: 'unit',
      timeout_ms: 5000,
      parallel: true,
      mock_external_services: true,
      test_data: {
        events_count: FactoryUtils.randomNumber(1, 10),
        responses_count: FactoryUtils.randomNumber(1, 5),
        users_count: 1,
        duration_minutes: 1
      }
    }),

    integration_test: (config) => ({
      ...config,
      test_environment: 'integration',
      timeout_ms: 30000,
      parallel: false,
      mock_external_services: false,
      test_data: {
        events_count: FactoryUtils.randomNumber(10, 50),
        responses_count: FactoryUtils.randomNumber(5, 25),
        users_count: FactoryUtils.randomNumber(2, 5),
        duration_minutes: FactoryUtils.randomNumber(5, 15)
      }
    }),

    e2e_test: (config) => ({
      ...config,
      test_environment: 'e2e',
      timeout_ms: 120000,
      parallel: false,
      mock_external_services: false,
      cleanup_after: true,
      test_data: {
        events_count: FactoryUtils.randomNumber(20, 100),
        responses_count: FactoryUtils.randomNumber(10, 50),
        users_count: FactoryUtils.randomNumber(3, 10),
        duration_minutes: FactoryUtils.randomNumber(10, 30)
      }
    }),

    performance_test: (config) => ({
      ...config,
      test_environment: 'performance',
      timeout_ms: 600000, // 10 minutes
      parallel: true,
      generate_coverage: false,
      test_data: {
        events_count: FactoryUtils.randomNumber(100, 10000),
        responses_count: FactoryUtils.randomNumber(50, 5000),
        users_count: FactoryUtils.randomNumber(10, 100),
        duration_minutes: FactoryUtils.randomNumber(30, 120)
      },
      thresholds: {
        response_time_ms: FactoryUtils.randomNumber(50, 1000),
        memory_usage_mb: FactoryUtils.randomNumber(200, 2000),
        cpu_usage_percent: FactoryUtils.randomNumber(70, 95),
        error_rate_percent: FactoryUtils.randomFloat(0, 1, 2)
      }
    }),

    // Test characteristics
    fast_test: (config) => ({
      ...config,
      timeout_ms: 1000,
      test_data: {
        events_count: FactoryUtils.randomNumber(1, 5),
        responses_count: FactoryUtils.randomNumber(1, 3),
        users_count: 1,
        duration_minutes: 1
      }
    }),

    stress_test: (config) => ({
      ...config,
      timeout_ms: 300000, // 5 minutes
      test_data: {
        events_count: FactoryUtils.randomNumber(1000, 10000),
        responses_count: FactoryUtils.randomNumber(500, 5000),
        users_count: FactoryUtils.randomNumber(50, 500),
        duration_minutes: FactoryUtils.randomNumber(60, 180)
      }
    }),

    chaos_test: (config) => ({
      ...config,
      timeout_ms: 600000, // 10 minutes
      mock_external_services: false,
      test_data: {
        ...config.test_data,
        chaos_enabled: true,
        failure_rate_percent: FactoryUtils.randomFloat(5, 30, 1),
        recovery_time_ms: FactoryUtils.randomNumber(1000, 10000)
      }
    })
  }
});

/**
 * Database/persistence configuration factory
 */
Factory.define('persistence_config', () => ({
  type: FactoryUtils.randomChoice(['memory', 'file', 'redis', 'sqlite']),
  connection: {
    host: '127.0.0.1',
    port: Factory.sequence('port'),
    timeout_ms: FactoryUtils.randomNumber(5000, 30000),
    pool_size: FactoryUtils.randomNumber(5, 50),
    retry_attempts: FactoryUtils.randomNumber(3, 10)
  },
  settings: {
    auto_vacuum: FactoryUtils.randomBoolean(0.8),
    compression: FactoryUtils.randomBoolean(0.6),
    encryption: FactoryUtils.randomBoolean(0.4),
    backup_enabled: FactoryUtils.randomBoolean(0.7),
    backup_interval_hours: FactoryUtils.randomNumber(6, 24)
  },
  limits: {
    max_connections: FactoryUtils.randomNumber(10, 100),
    max_memory_mb: FactoryUtils.randomNumber(100, 1000),
    max_disk_gb: FactoryUtils.randomNumber(1, 100),
    ttl_hours: FactoryUtils.randomNumber(24, 720)
  }
}), {
  traits: {
    // Storage types
    memory_storage: (config) => ({
      ...config,
      type: 'memory',
      settings: {
        ...config.settings,
        auto_vacuum: false,
        compression: false,
        encryption: false,
        backup_enabled: false
      }
    }),

    file_storage: (config) => ({
      ...config,
      type: 'file',
      connection: {
        ...config.connection,
        file_path: '/var/lib/cctelegram/data.db'
      }
    }),

    redis_storage: (config) => ({
      ...config,
      type: 'redis',
      connection: {
        ...config.connection,
        port: 6379,
        database: 0
      }
    }),

    // Performance characteristics
    high_performance: (config) => ({
      ...config,
      connection: {
        ...config.connection,
        pool_size: 50,
        timeout_ms: 1000
      },
      settings: {
        ...config.settings,
        compression: false,
        encryption: false
      }
    }),

    secure: (config) => ({
      ...config,
      settings: {
        ...config.settings,
        compression: true,
        encryption: true,
        backup_enabled: true
      }
    })
  },

  sequences: {
    port: Sequences.port
  }
});
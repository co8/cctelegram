/**
 * System State Factory Definitions
 * 
 * Factory definitions for system states, environment configurations, and testing scenarios
 */

import { Factory, FactoryUtils, Sequences } from './factory-bot.js';

/**
 * System environment factory
 */
Factory.define('system_environment', () => ({
  NODE_ENV: FactoryUtils.randomChoice(['development', 'production', 'test']),
  CC_TELEGRAM_BOT_TOKEN: `bot${FactoryUtils.randomString(45)}`,
  CC_TELEGRAM_CHAT_ID: FactoryUtils.randomNumber(-1000000000000, -1),
  CC_TELEGRAM_EVENTS_DIR: '/tmp/cctelegram/events',
  CC_TELEGRAM_RESPONSES_DIR: '/tmp/cctelegram/responses',
  MCP_ENABLE_AUTH: FactoryUtils.randomBoolean().toString(),
  MCP_ENABLE_RATE_LIMIT: FactoryUtils.randomBoolean().toString(),
  MCP_ENABLE_INPUT_VALIDATION: 'true',
  MCP_ENABLE_SECURE_LOGGING: FactoryUtils.randomBoolean().toString(),
  MCP_LOG_LEVEL: FactoryUtils.randomChoice(['debug', 'info', 'warn', 'error']),
  MCP_PORT: Factory.sequence('port').toString(),
  MCP_HOST: '127.0.0.1',
  DEBUG: FactoryUtils.randomBoolean(0.3) ? 'cctelegram:*' : undefined
}), {
  traits: {
    // Environment types
    development: (env) => ({
      ...env,
      NODE_ENV: 'development',
      DEBUG: 'cctelegram:*',
      MCP_LOG_LEVEL: 'debug',
      MCP_ENABLE_AUTH: 'false',
      MCP_ENABLE_RATE_LIMIT: 'false'
    }),

    production: (env) => ({
      ...env,
      NODE_ENV: 'production',
      DEBUG: undefined,
      MCP_LOG_LEVEL: 'info',
      MCP_ENABLE_AUTH: 'true',
      MCP_ENABLE_RATE_LIMIT: 'true',
      MCP_ENABLE_SECURE_LOGGING: 'true'
    }),

    testing: (env) => ({
      ...env,
      NODE_ENV: 'test',
      DEBUG: undefined,
      MCP_LOG_LEVEL: 'error',
      MCP_ENABLE_AUTH: 'false',
      MCP_ENABLE_RATE_LIMIT: 'false',
      CC_TELEGRAM_EVENTS_DIR: '/tmp/test-events',
      CC_TELEGRAM_RESPONSES_DIR: '/tmp/test-responses'
    }),

    // Security configurations
    secure: (env) => ({
      ...env,
      MCP_ENABLE_AUTH: 'true',
      MCP_ENABLE_RATE_LIMIT: 'true',
      MCP_ENABLE_INPUT_VALIDATION: 'true',
      MCP_ENABLE_SECURE_LOGGING: 'true'
    }),

    insecure: (env) => ({
      ...env,
      MCP_ENABLE_AUTH: 'false',
      MCP_ENABLE_RATE_LIMIT: 'false',
      MCP_ENABLE_INPUT_VALIDATION: 'false',
      MCP_ENABLE_SECURE_LOGGING: 'false'
    }),

    // Invalid configurations for error testing
    missing_token: (env) => {
      const { CC_TELEGRAM_BOT_TOKEN, ...envWithoutToken } = env;
      return envWithoutToken;
    },

    invalid_chat_id: (env) => ({
      ...env,
      CC_TELEGRAM_CHAT_ID: 'invalid-chat-id'
    }),

    invalid_port: (env) => ({
      ...env,
      MCP_PORT: 'invalid-port'
    }),

    invalid_paths: (env) => ({
      ...env,
      CC_TELEGRAM_EVENTS_DIR: '/nonexistent/directory',
      CC_TELEGRAM_RESPONSES_DIR: '/another/nonexistent/directory'
    })
  },

  sequences: {
    port: Sequences.port
  }
});

/**
 * File system state factory
 */
Factory.define('filesystem_state', () => ({
  events_directory: {
    path: '/tmp/cctelegram/events',
    exists: true,
    writable: true,
    files: Array.from({ length: FactoryUtils.randomNumber(0, 10) }, () => 
      `event-${FactoryUtils.randomString(8)}.json`
    ),
    total_size_bytes: FactoryUtils.randomNumber(0, 1048576), // Up to 1MB
    free_space_bytes: FactoryUtils.randomNumber(1048576, 10737418240) // 1MB to 10GB
  },
  responses_directory: {
    path: '/tmp/cctelegram/responses',
    exists: true,
    writable: true,
    files: Array.from({ length: FactoryUtils.randomNumber(0, 5) }, () => 
      `response-${FactoryUtils.randomString(8)}.json`
    ),
    total_size_bytes: FactoryUtils.randomNumber(0, 524288), // Up to 512KB
    free_space_bytes: FactoryUtils.randomNumber(1048576, 10737418240)
  },
  temp_directory: {
    path: '/tmp',
    exists: true,
    writable: true,
    free_space_bytes: FactoryUtils.randomNumber(1048576, 10737418240)
  }
}), {
  traits: {
    // Directory states
    healthy_filesystem: (fs) => ({
      ...fs,
      events_directory: {
        ...fs.events_directory,
        exists: true,
        writable: true,
        free_space_bytes: FactoryUtils.randomNumber(10737418240, 107374182400) // 10GB+
      },
      responses_directory: {
        ...fs.responses_directory,
        exists: true,
        writable: true,
        free_space_bytes: FactoryUtils.randomNumber(10737418240, 107374182400)
      }
    }),

    low_disk_space: (fs) => ({
      ...fs,
      events_directory: {
        ...fs.events_directory,
        free_space_bytes: FactoryUtils.randomNumber(0, 1048576) // Less than 1MB
      },
      responses_directory: {
        ...fs.responses_directory,
        free_space_bytes: FactoryUtils.randomNumber(0, 1048576)
      }
    }),

    permission_denied: (fs) => ({
      ...fs,
      events_directory: {
        ...fs.events_directory,
        writable: false
      },
      responses_directory: {
        ...fs.responses_directory,
        writable: false
      }
    }),

    missing_directories: (fs) => ({
      ...fs,
      events_directory: {
        ...fs.events_directory,
        exists: false
      },
      responses_directory: {
        ...fs.responses_directory,
        exists: false
      }
    }),

    many_files: (fs) => ({
      ...fs,
      events_directory: {
        ...fs.events_directory,
        files: Array.from({ length: FactoryUtils.randomNumber(100, 1000) }, (_, i) => 
          `event-${i.toString().padStart(4, '0')}.json`
        ),
        total_size_bytes: FactoryUtils.randomNumber(10485760, 104857600) // 10MB-100MB
      }
    }),

    empty_directories: (fs) => ({
      ...fs,
      events_directory: {
        ...fs.events_directory,
        files: [],
        total_size_bytes: 0
      },
      responses_directory: {
        ...fs.responses_directory,
        files: [],
        total_size_bytes: 0
      }
    })
  }
});

/**
 * Network state factory
 */
Factory.define('network_state', () => ({
  telegram_api: {
    reachable: true,
    response_time_ms: FactoryUtils.randomNumber(50, 500),
    last_successful_call: new Date().toISOString(),
    rate_limit_remaining: FactoryUtils.randomNumber(20, 30),
    rate_limit_reset: new Date(Date.now() + 60000).toISOString()
  },
  mcp_server: {
    running: true,
    port: Factory.sequence('port'),
    response_time_ms: FactoryUtils.randomNumber(1, 50),
    connections_active: FactoryUtils.randomNumber(0, 10),
    last_health_check: new Date().toISOString()
  },
  bridge_process: {
    running: true,
    pid: Factory.sequence('pid'),
    port: Factory.sequence('port'),
    response_time_ms: FactoryUtils.randomNumber(10, 100),
    last_heartbeat: new Date().toISOString()
  },
  external_services: {
    github_api: {
      reachable: FactoryUtils.randomBoolean(0.9),
      response_time_ms: FactoryUtils.randomNumber(100, 2000)
    },
    claude_api: {
      reachable: FactoryUtils.randomBoolean(0.95),
      response_time_ms: FactoryUtils.randomNumber(200, 3000)
    }
  }
}), {
  traits: {
    // Network conditions
    healthy_network: (network) => ({
      ...network,
      telegram_api: {
        ...network.telegram_api,
        reachable: true,
        response_time_ms: FactoryUtils.randomNumber(50, 200)
      },
      mcp_server: {
        ...network.mcp_server,
        running: true,
        response_time_ms: FactoryUtils.randomNumber(1, 20)
      },
      bridge_process: {
        ...network.bridge_process,
        running: true,
        response_time_ms: FactoryUtils.randomNumber(5, 50)
      }
    }),

    slow_network: (network) => ({
      ...network,
      telegram_api: {
        ...network.telegram_api,
        response_time_ms: FactoryUtils.randomNumber(2000, 10000)
      },
      mcp_server: {
        ...network.mcp_server,
        response_time_ms: FactoryUtils.randomNumber(100, 500)
      },
      bridge_process: {
        ...network.bridge_process,
        response_time_ms: FactoryUtils.randomNumber(200, 1000)
      }
    }),

    telegram_down: (network) => ({
      ...network,
      telegram_api: {
        ...network.telegram_api,
        reachable: false,
        response_time_ms: 0,
        last_successful_call: new Date(Date.now() - 300000).toISOString() // 5 minutes ago
      }
    }),

    services_down: (network) => ({
      ...network,
      mcp_server: {
        ...network.mcp_server,
        running: false,
        response_time_ms: 0
      },
      bridge_process: {
        ...network.bridge_process,
        running: false,
        response_time_ms: 0
      }
    }),

    rate_limited: (network) => ({
      ...network,
      telegram_api: {
        ...network.telegram_api,
        rate_limit_remaining: 0,
        rate_limit_reset: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
      }
    }),

    high_load: (network) => ({
      ...network,
      mcp_server: {
        ...network.mcp_server,
        connections_active: FactoryUtils.randomNumber(50, 100),
        response_time_ms: FactoryUtils.randomNumber(100, 500)
      }
    })
  },

  sequences: {
    port: Sequences.port,
    pid: Sequences.pid
  }
});

/**
 * Test scenario factory for creating complex testing scenarios
 */
Factory.define('test_scenario', () => ({
  name: `Test Scenario ${FactoryUtils.randomString(8)}`,
  description: 'Generated test scenario for system validation',
  environment: Factory.build('system_environment'),
  filesystem: Factory.build('filesystem_state'),
  network: Factory.build('network_state'),
  expected_outcomes: {
    bridge_should_start: true,
    events_should_process: true,
    responses_should_send: true,
    health_check_should_pass: true
  },
  test_data: {
    events_to_create: FactoryUtils.randomNumber(5, 20),
    responses_to_generate: FactoryUtils.randomNumber(2, 10),
    duration_minutes: FactoryUtils.randomNumber(5, 30)
  }
}), {
  traits: {
    // Scenario types
    happy_path: (scenario) => ({
      ...scenario,
      name: 'Happy Path Scenario',
      description: 'Everything works as expected',
      environment: Factory.build('system_environment', {}, ['production']),
      filesystem: Factory.build('filesystem_state', {}, ['healthy_filesystem']),
      network: Factory.build('network_state', {}, ['healthy_network']),
      expected_outcomes: {
        bridge_should_start: true,
        events_should_process: true,
        responses_should_send: true,
        health_check_should_pass: true
      }
    }),

    error_recovery: (scenario) => ({
      ...scenario,
      name: 'Error Recovery Scenario',
      description: 'System should recover from temporary failures',
      network: Factory.build('network_state', {}, ['telegram_down']),
      expected_outcomes: {
        bridge_should_start: true,
        events_should_process: false,
        responses_should_send: false,
        health_check_should_pass: false
      }
    }),

    resource_constraints: (scenario) => ({
      ...scenario,
      name: 'Resource Constraints Scenario',
      description: 'System behavior under resource pressure',
      filesystem: Factory.build('filesystem_state', {}, ['low_disk_space']),
      network: Factory.build('network_state', {}, ['slow_network']),
      expected_outcomes: {
        bridge_should_start: true,
        events_should_process: true,
        responses_should_send: true,
        health_check_should_pass: false
      }
    }),

    configuration_errors: (scenario) => ({
      ...scenario,
      name: 'Configuration Errors Scenario',
      description: 'Invalid configuration handling',
      environment: Factory.build('system_environment', {}, ['missing_token']),
      expected_outcomes: {
        bridge_should_start: false,
        events_should_process: false,
        responses_should_send: false,
        health_check_should_pass: false
      }
    }),

    high_load: (scenario) => ({
      ...scenario,
      name: 'High Load Scenario',
      description: 'System performance under high load',
      filesystem: Factory.build('filesystem_state', {}, ['many_files']),
      network: Factory.build('network_state', {}, ['high_load']),
      test_data: {
        events_to_create: FactoryUtils.randomNumber(100, 500),
        responses_to_generate: FactoryUtils.randomNumber(50, 200),
        duration_minutes: FactoryUtils.randomNumber(30, 120)
      }
    }),

    security_test: (scenario) => ({
      ...scenario,
      name: 'Security Test Scenario',
      description: 'Security feature validation',
      environment: Factory.build('system_environment', {}, ['secure']),
      expected_outcomes: {
        bridge_should_start: true,
        events_should_process: true,
        responses_should_send: true,
        health_check_should_pass: true
      }
    })
  }
});

/**
 * Mock API response factory
 */
Factory.define('api_response', () => ({
  status: FactoryUtils.randomChoice([200, 201, 400, 401, 403, 404, 429, 500, 502, 503]),
  data: {
    success: FactoryUtils.randomBoolean(0.8),
    message: 'API response message',
    timestamp: new Date().toISOString()
  },
  headers: {
    'content-type': 'application/json',
    'x-rate-limit-remaining': FactoryUtils.randomNumber(0, 30).toString(),
    'x-rate-limit-reset': Math.floor(Date.now() / 1000 + 3600).toString()
  },
  response_time_ms: FactoryUtils.randomNumber(50, 5000)
}), {
  traits: {
    // Success responses
    success: (response) => ({
      ...response,
      status: FactoryUtils.randomChoice([200, 201, 202]),
      data: {
        ...response.data,
        success: true,
        message: 'Operation completed successfully'
      }
    }),

    // Error responses
    client_error: (response) => ({
      ...response,
      status: FactoryUtils.randomChoice([400, 401, 403, 404, 422]),
      data: {
        ...response.data,
        success: false,
        message: 'Client error occurred',
        error_code: `E${FactoryUtils.randomNumber(1000, 9999)}`
      }
    }),

    server_error: (response) => ({
      ...response,
      status: FactoryUtils.randomChoice([500, 502, 503, 504]),
      data: {
        ...response.data,
        success: false,
        message: 'Server error occurred',
        error_code: `E${FactoryUtils.randomNumber(5000, 5999)}`
      }
    }),

    rate_limited: (response) => ({
      ...response,
      status: 429,
      data: {
        ...response.data,
        success: false,
        message: 'Rate limit exceeded'
      },
      headers: {
        ...response.headers,
        'x-rate-limit-remaining': '0',
        'retry-after': FactoryUtils.randomNumber(60, 3600).toString()
      }
    }),

    timeout: (response) => ({
      ...response,
      status: 0,
      data: null,
      response_time_ms: 30000 // Timeout threshold
    })
  }
});
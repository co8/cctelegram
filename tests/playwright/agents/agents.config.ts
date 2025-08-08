/**
 * Configuration for CCTelegram debugging agents
 */

import { AgentConfig } from './shared/types';

export const agentConfig: AgentConfig = {
  dataFlow: {
    traceLevel: 'verbose',
    captureTransformations: true,
    validateDataIntegrity: true,
    trackTimestamps: true,
    maxTraceSteps: 100
  },
  
  mcp: {
    testDirectConnection: true,
    validateTransformations: true,
    checkResponseFormat: true,
    timeoutMs: 30000,
    retryAttempts: 3
  },
  
  bridge: {
    captureDebugLogs: true,
    monitorProcessHealth: true,
    analyzeResponseGeneration: true,
    logAnalysisDepth: 'deep',
    performanceMonitoring: true
  },
  
  response: {
    validateFormat: true,
    compareWithExpected: true,
    checkTimestamps: true,
    parseTaskData: true,
    validateMarkdown: true
  },
  
  orchestration: {
    coordinateAgents: true,
    aggregateFindings: true,
    generateRecommendations: true,
    parallelExecution: false, // Sequential for debugging clarity
    maxConcurrentAgents: 3,
    timeoutMs: 120000 // 2 minutes for full orchestration
  },
  
  global: {
    debugLevel: 'verbose',
    captureScreenshots: true,
    saveArtifacts: true,
    generateReports: true,
    maxExecutionTime: 300000 // 5 minutes max per agent
  }
};

export const testPorts = {
  bridgeHealth: 8080,
  bridgeWebhook: 3000,
  mcpServer: 3001,
  telegramMock: 3002,
  monitoringPort: 3003
};

export const testPaths = {
  bridgeBinary: '../../target/release/cc-telegram-bridge',
  mcpServer: '../../mcp-server',
  taskMasterDir: '../../../.taskmaster',
  taskMasterFile: '../../../.taskmaster/tasks/tasks.json',
  testResults: './test-results',
  screenshots: './test-results/screenshots',
  artifacts: './test-results/artifacts',
  logs: './test-results/logs',
  reports: './test-results/reports'
};

export const environmentConfig = {
  // Bridge environment variables
  bridge: {
    CC_TELEGRAM_HEALTH_PORT: testPorts.bridgeHealth.toString(),
    CC_TELEGRAM_WEBHOOK_PORT: testPorts.bridgeWebhook.toString(),
    CC_TELEGRAM_BOT_TOKEN: 'test-bot-token-123456789',
    CC_TELEGRAM_ALLOWED_USERS: '123456789',
    RUST_LOG: 'debug',
    RUST_BACKTRACE: '1',
    CC_TELEGRAM_MODE: 'nomad'
  },
  
  // MCP server environment variables
  mcp: {
    MCP_ENABLE_AUTH: 'false',
    MCP_ENABLE_RATE_LIMIT: 'false',
    MCP_LOG_LEVEL: 'debug',
    PORT: testPorts.mcpServer.toString(),
    NODE_ENV: 'test'
  },
  
  // TaskMaster integration
  taskmaster: {
    PROJECT_ROOT: '../../..',
    TASKMASTER_PROJECT_ROOT: '../../..',
    TASKMASTER_CONFIG: '../../../.taskmaster/config.json'
  }
};

export const expectedTestData = {
  // What we expect to see in live data
  liveTaskMasterStats: {
    totalTasks: 30,
    completedTasks: 27,
    completionPercentage: 90.0,
    isLiveData: true,
    dataSource: 'file'
  },
  
  // What indicates stale/cached data
  staleTaskMasterStats: {
    totalTasks: 29,
    completedTasks: 28,
    completionPercentage: 96.55,
    isLiveData: false,
    dataSource: 'cache'
  },
  
  // Expected MCP response structure
  mcpTaskStatusResponse: {
    tasks: {
      pending: 'number',
      in_progress: 'number', 
      completed: 'number',
      blocked: 'number',
      total: 'number'
    },
    project_name: 'string',
    last_updated: 'string'
  },
  
  // Expected Telegram response patterns
  telegramResponsePatterns: {
    taskSummary: /\d+\/\d+\s+tasks,\s+[\d.]+%/,
    progressBar: /[▓░]{10,}/,
    projectName: /Project:\s+\*\*[\w\s-]+\*\*/,
    lastUpdated: /Last updated:\s+\d{4}-\d{2}-\d{2}/
  }
};

export const timeouts = {
  agentExecution: 60000,      // 1 minute per agent
  processStart: 30000,        // 30 seconds to start processes
  mcpConnection: 10000,       // 10 seconds for MCP connection
  telegramResponse: 15000,    // 15 seconds for Telegram response
  dataValidation: 5000,       // 5 seconds for data validation
  cleanup: 10000              // 10 seconds for cleanup
};

export const retryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
};

export const loggingConfig = {
  levels: ['error', 'warn', 'info', 'debug', 'trace'],
  maxLogEntries: 10000,
  logRotationSize: 10 * 1024 * 1024, // 10MB
  exportFormat: 'json',
  includeStackTrace: true
};

export default {
  agentConfig,
  testPorts,
  testPaths,
  environmentConfig,
  expectedTestData,
  timeouts,
  retryConfig,
  loggingConfig
};
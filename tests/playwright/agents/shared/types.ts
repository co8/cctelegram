/**
 * Shared types and interfaces for CCTelegram debugging agents
 */

// ============================================================================
// Core Agent Types
// ============================================================================

export interface BaseAgent {
  name: string;
  version: string;
  capabilities: AgentCapability[];
  status: AgentStatus;
  findings: AgentFindings;
  
  initialize(): Promise<void>;
  execute(): Promise<AgentResult>;
  cleanup(): Promise<void>;
  reportFindings(): AgentFindings;
}

export enum AgentStatus {
  INITIALIZING = 'initializing',
  READY = 'ready',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CLEANUP = 'cleanup'
}

export enum AgentCapability {
  DATA_TRACING = 'data_tracing',
  MCP_TESTING = 'mcp_testing',
  BRIDGE_DEBUGGING = 'bridge_debugging',
  RESPONSE_VALIDATION = 'response_validation',
  WORKFLOW_ORCHESTRATION = 'workflow_orchestration',
  LOG_ANALYSIS = 'log_analysis',
  PROCESS_MANAGEMENT = 'process_management',
  ISSUE_CORRELATION = 'issue_correlation'
}

// ============================================================================
// Agent Communication & Results
// ============================================================================

export interface AgentCommunication {
  findings: AgentFindings[];
  testResults: TestResults[];
  sharedContext: SharedContext;
  nextSteps: ActionItem[];
  timestamp: Date;
  correlationId: string;
}

export interface SharedContext {
  sessionId: string;
  taskMasterData: TaskMasterStats;
  mcpResponses: McpResponse[];
  bridgeProcessState: BridgeProcessState;
  telegramResponses: TelegramMessage[];
  issuesDetected: Issue[];
  dataFlowTrace: DataFlowStep[];
  testEnvironmentState: TestEnvironmentState;
}

export interface AgentResult {
  agentName: string;
  success: boolean;
  executionTime: number;
  findings: AgentFindings;
  errors?: Error[];
  recommendations?: Recommendation[];
  nextActions?: ActionItem[];
}

export interface AgentFindings {
  agentName: string;
  timestamp: Date;
  summary: string;
  issues: Issue[];
  validations: ValidationResult[];
  dataPoints: DataPoint[];
  confidence: number; // 0-1 scale
  priority: Priority;
}

// ============================================================================
// Data Structure Types
// ============================================================================

export interface TaskMasterStats {
  projectName: string;
  taskFile: string;
  lastModified: Date;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  subtasksTotal: number;
  subtasksCompleted: number;
  completionPercentage: number;
  isLiveData: boolean;
  dataSource: 'file' | 'mcp' | 'cache' | 'unknown';
}

export interface McpResponse {
  timestamp: Date;
  method: string;
  request: any;
  response: any;
  success: boolean;
  executionTime: number;
  errors?: string[];
  source: 'direct' | 'bridge' | 'cached';
}

export interface BridgeProcessState {
  pid?: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
  lastActivity: Date;
  healthPort: number;
  webhookPort: number;
  logLevel: string;
  version: string;
  buildInfo?: any;
}

export interface TelegramMessage {
  messageId: string;
  timestamp: Date;
  userId: number;
  command: string;
  response: string;
  responseTime: number;
  format: 'markdown' | 'html' | 'plain';
  containsTaskData: boolean;
  taskDataSource: 'live' | 'static' | 'unknown';
  extractedStats?: TaskMasterStats;
}

// ============================================================================
// Testing & Validation Types
// ============================================================================

export interface TestResults {
  testName: string;
  agentName: string;
  timestamp: Date;
  success: boolean;
  executionTime: number;
  assertions: AssertionResult[];
  logs: LogEntry[];
  screenshots?: string[];
  artifacts?: string[];
}

export interface ValidationResult {
  type: ValidationType;
  target: string;
  expected: any;
  actual: any;
  passed: boolean;
  message: string;
  severity: Severity;
}

export enum ValidationType {
  DATA_INTEGRITY = 'data_integrity',
  FORMAT_COMPLIANCE = 'format_compliance',
  RESPONSE_ACCURACY = 'response_accuracy',
  TIMING_VALIDATION = 'timing_validation',
  PROCESS_HEALTH = 'process_health',
  NETWORK_CONNECTIVITY = 'network_connectivity'
}

export interface AssertionResult {
  description: string;
  passed: boolean;
  expected: any;
  actual: any;
  error?: string;
}

// ============================================================================
// Issue & Analysis Types
// ============================================================================

export interface Issue {
  id: string;
  type: IssueType;
  severity: Severity;
  component: Component;
  description: string;
  evidence: Evidence[];
  suggestedFixes: SuggestedFix[];
  detectedBy: string;
  timestamp: Date;
  reproduced: boolean;
  resolved: boolean;
}

export enum IssueType {
  STALE_DATA = 'stale_data',
  MCP_CONNECTION_FAILURE = 'mcp_connection_failure',
  BRIDGE_PROCESS_ERROR = 'bridge_process_error',
  RESPONSE_FORMAT_ERROR = 'response_format_error',
  DATA_TRANSFORMATION_ERROR = 'data_transformation_error',
  CACHE_INVALIDATION_FAILURE = 'cache_invalidation_failure',
  CONFIGURATION_ERROR = 'configuration_error'
}

export enum Component {
  TASKMASTER = 'taskmaster',
  MCP_SERVER = 'mcp_server',
  RUST_BRIDGE = 'rust_bridge',
  TELEGRAM_BOT = 'telegram_bot',
  TEST_FRAMEWORK = 'test_framework'
}

export enum Severity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info'
}

export enum Priority {
  URGENT = 'urgent',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export interface Evidence {
  type: EvidenceType;
  description: string;
  data: any;
  source: string;
  timestamp: Date;
  reliable: boolean;
}

export enum EvidenceType {
  LOG_ENTRY = 'log_entry',
  API_RESPONSE = 'api_response',
  FILE_CONTENT = 'file_content',
  PROCESS_STATE = 'process_state',
  NETWORK_TRACE = 'network_trace',
  SCREENSHOT = 'screenshot',
  PERFORMANCE_METRIC = 'performance_metric'
}

// ============================================================================
// Workflow & Action Types
// ============================================================================

export interface DataFlowStep {
  stepNumber: number;
  component: Component;
  operation: string;
  input: any;
  output: any;
  transformation?: string;
  timestamp: Date;
  duration: number;
  success: boolean;
  dataIntegrity: boolean;
}

export interface ActionItem {
  id: string;
  type: ActionType;
  priority: Priority;
  description: string;
  component: Component;
  estimatedEffort: number; // minutes
  dependencies?: string[];
  assignedAgent?: string;
  status: ActionStatus;
  createdAt: Date;
  completedAt?: Date;
}

export enum ActionType {
  INVESTIGATE = 'investigate',
  FIX = 'fix',
  TEST = 'test',
  VALIDATE = 'validate',
  MONITOR = 'monitor',
  DOCUMENT = 'document'
}

export enum ActionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  BLOCKED = 'blocked'
}

export interface Recommendation {
  id: string;
  type: RecommendationType;
  priority: Priority;
  title: string;
  description: string;
  reasoning: string;
  implementation: string;
  riskAssessment: string;
  expectedOutcome: string;
  confidence: number;
  suggestedBy: string;
  relatedIssues: string[];
}

export enum RecommendationType {
  IMMEDIATE_FIX = 'immediate_fix',
  CONFIGURATION_CHANGE = 'configuration_change',
  CODE_MODIFICATION = 'code_modification',
  PROCESS_IMPROVEMENT = 'process_improvement',
  MONITORING_ENHANCEMENT = 'monitoring_enhancement',
  TESTING_ENHANCEMENT = 'testing_enhancement'
}

export interface SuggestedFix {
  id: string;
  title: string;
  description: string;
  implementation: string;
  riskLevel: 'low' | 'medium' | 'high';
  estimatedTime: number; // minutes
  testingRequired: boolean;
  rollbackPlan: string;
}

// ============================================================================
// Environment & Configuration Types
// ============================================================================

export interface TestEnvironmentState {
  mcpServerRunning: boolean;
  bridgeProcessRunning: boolean;
  telegramMockRunning: boolean;
  taskMasterDataAvailable: boolean;
  portsInUse: number[];
  environmentVariables: Record<string, string>;
  systemResources: SystemResources;
}

export interface SystemResources {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkLatency: number;
  availablePorts: number[];
}

export interface DataPoint {
  name: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  source: string;
  timestamp: Date;
  reliable: boolean;
  metadata?: Record<string, any>;
}

export interface LogEntry {
  timestamp: Date;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  component: Component;
  message: string;
  data?: any;
  correlationId?: string;
}

// ============================================================================
// Agent-Specific Types
// ============================================================================

export interface DataFlowTrace {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  steps: DataFlowStep[];
  totalSteps: number;
  successfulSteps: number;
  dataIntegrityMaintained: boolean;
  issues: Issue[];
}

export interface McpTestResult {
  method: string;
  success: boolean;
  response: any;
  executionTime: number;
  dataAccuracy: boolean;
  formatCompliance: boolean;
  error?: string;
}

export interface BridgeDebugInfo {
  processInfo: BridgeProcessState;
  logAnalysis: LogAnalysisResult;
  performanceMetrics: PerformanceMetrics;
  errorPatterns: ErrorPattern[];
}

export interface LogAnalysisResult {
  totalLogEntries: number;
  errorCount: number;
  warningCount: number;
  debugCount: number;
  patterns: LogPattern[];
  suspiciousEntries: LogEntry[];
}

export interface LogPattern {
  pattern: string;
  frequency: number;
  significance: Severity;
  relatedIssue?: string;
}

export interface ErrorPattern {
  pattern: string;
  frequency: number;
  lastOccurrence: Date;
  impact: Severity;
  suggestedFix?: string;
}

export interface PerformanceMetrics {
  responseTime: number;
  memoryUsage: number;
  cpuUsage: number;
  requestsPerSecond: number;
  errorRate: number;
  uptime: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface AgentConfig {
  dataFlow: DataFlowConfig;
  mcp: McpConfig;
  bridge: BridgeConfig;
  response: ResponseConfig;
  orchestration: OrchestrationConfig;
  global: GlobalConfig;
}

export interface DataFlowConfig {
  traceLevel: 'minimal' | 'standard' | 'verbose';
  captureTransformations: boolean;
  validateDataIntegrity: boolean;
  trackTimestamps: boolean;
  maxTraceSteps: number;
}

export interface McpConfig {
  testDirectConnection: boolean;
  validateTransformations: boolean;
  checkResponseFormat: boolean;
  timeoutMs: number;
  retryAttempts: number;
}

export interface BridgeConfig {
  captureDebugLogs: boolean;
  monitorProcessHealth: boolean;
  analyzeResponseGeneration: boolean;
  logAnalysisDepth: 'surface' | 'deep';
  performanceMonitoring: boolean;
}

export interface ResponseConfig {
  validateFormat: boolean;
  compareWithExpected: boolean;
  checkTimestamps: boolean;
  parseTaskData: boolean;
  validateMarkdown: boolean;
}

export interface OrchestrationConfig {
  coordinateAgents: boolean;
  aggregateFindings: boolean;
  generateRecommendations: boolean;
  parallelExecution: boolean;
  maxConcurrentAgents: number;
  timeoutMs: number;
}

export interface GlobalConfig {
  debugLevel: 'minimal' | 'standard' | 'verbose';
  captureScreenshots: boolean;
  saveArtifacts: boolean;
  generateReports: boolean;
  maxExecutionTime: number;
}
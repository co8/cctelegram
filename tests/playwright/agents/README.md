# CCTelegram Specialized Debugging Agents

A comprehensive system of specialized debugging agents designed to systematically resolve the TaskMaster integration issue where `/tasks` shows old static data instead of live TaskMaster data.

## 🧠 Agent Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Issue Resolution Orchestrator                              │
│                  (Coordinates all agents & workflow)                         │
└─────────────────┬───────────────────────────────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Data Flow    │    │ MCP Integration│   │ Rust Bridge  │    │ Response     │
│ Analyzer     │    │ Specialist     │   │ Debugger     │    │ Verification │
│ Agent        │    │ Agent          │   │ Agent        │    │ Agent        │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

## 🎯 Agent Responsibilities

### 1. Data Flow Analyzer Agent (`DataFlowAnalyzerAgent`)
**Focus**: Trace data from TaskMaster file → MCP server → Rust bridge → Telegram
- Verify TaskMaster tasks.json has correct live data (27/30 tasks, 90%)
- Track data transformations at each stage
- Identify where old static data gets injected
- Create data flow diagrams and trace reports

### 2. MCP Integration Specialist Agent (`McpIntegrationAgent`)
**Focus**: MCP server communication and data transformation
- Test MCP `get_task_status` and `get_tasks` functions directly
- Verify MCP response format and data structure
- Test connection.rs MCP transformation logic
- Identify MCP-specific integration issues

### 3. Rust Bridge Debugger Agent (`RustBridgeAgent`)
**Focus**: Rust bridge code debugging and process management
- Analyze Rust bridge logs and debug output
- Test bot.rs Telegram response formatting
- Manage bridge process lifecycle during testing
- Identify Rust-specific parsing and formatting issues

### 4. Response Verification Agent (`ResponseVerificationAgent`)
**Focus**: Telegram response validation and formatting
- Parse and validate Telegram message responses
- Compare expected vs actual response format
- Verify progress bars, task counts, and status display
- Test response timing and acknowledgments

### 5. Issue Resolution Orchestrator Agent (`OrchestrationAgent`)
**Focus**: Coordinate all agents and manage debugging process
- Execute systematic debugging workflow
- Coordinate between specialized agents
- Aggregate findings and create fix recommendations
- Manage iterative testing until resolution

## 🔄 Agent Communication Flow

```typescript
// Shared data structures for inter-agent communication
interface AgentCommunication {
  findings: AgentFindings[];
  testResults: TestResults[];
  sharedContext: SharedContext;
  nextSteps: ActionItem[];
}

interface SharedContext {
  taskMasterData: TaskMasterStats;
  mcpResponses: any[];
  bridgeProcessState: BridgeState;
  telegramResponses: TelegramMessage[];
  issuesDetected: Issue[];
}
```

## 🚀 Usage

### Quick Start
```bash
cd tests/playwright
npm run setup
npm run agents:debug         # Run all agents in coordinated mode
npm run agents:report        # Generate comprehensive analysis report
```

### Individual Agent Testing
```bash
npm run agent:dataflow       # Run Data Flow Analyzer only
npm run agent:mcp           # Run MCP Integration Specialist only
npm run agent:bridge        # Run Rust Bridge Debugger only
npm run agent:response      # Run Response Verification only
npm run agent:orchestrator  # Run orchestration workflow only
```

### Advanced Debugging
```bash
npm run agents:debug:verbose    # Run with maximum debug logging
npm run agents:debug:headless   # Run without browser UI
npm run agents:debug:parallel   # Run agents in parallel where possible
```

## 📊 Agent Workflow

### Phase 1: Individual Agent Analysis
Each agent runs its specialized tests independently and reports findings to the shared context.

### Phase 2: Cross-Agent Correlation
The orchestrator analyzes findings from all agents to identify patterns and root causes.

### Phase 3: Fix Implementation & Validation
Based on aggregated findings, apply targeted fixes and validate with coordinated re-testing.

### Phase 4: Resolution Verification
Comprehensive end-to-end validation that the issue is fully resolved.

## 📈 Success Criteria

The agent system succeeds when:

1. ✅ **Data Flow Analysis**: Clear identification of where old data originates
2. ✅ **MCP Integration**: MCP server returns correct live data
3. ✅ **Bridge Processing**: Rust bridge correctly processes MCP responses
4. ✅ **Response Validation**: Telegram responses show live data (27/30 tasks, 90%)
5. ✅ **Issue Resolution**: No static data detected (28/29 tasks, 96.55%)
6. ✅ **System Stability**: All components work together reliably

## 🔧 Configuration

### Agent-Specific Settings
```typescript
// agents.config.ts
export const agentConfig = {
  dataFlow: {
    traceLevel: 'verbose',
    captureTransformations: true,
    validateDataIntegrity: true
  },
  mcp: {
    testDirectConnection: true,
    validateTransformations: true,
    checkResponseFormat: true
  },
  bridge: {
    captureDebugLogs: true,
    monitorProcessHealth: true,
    analyzeResponseGeneration: true
  },
  response: {
    validateFormat: true,
    compareWithExpected: true,
    checkTimestamps: true
  },
  orchestration: {
    coordinateAgents: true,
    aggregateFindings: true,
    generateRecommendations: true
  }
};
```

## 📁 Directory Structure

```
tests/playwright/agents/
├── README.md                           # This file
├── agents.config.ts                    # Agent configuration
├── shared/
│   ├── types.ts                       # Shared types and interfaces
│   ├── communication.ts               # Inter-agent communication
│   ├── test-data.ts                   # Shared test data
│   └── utilities.ts                   # Common utilities
├── data-flow-analyzer/
│   ├── data-flow-analyzer.agent.ts    # Main agent implementation
│   ├── data-flow-tracer.ts           # Data tracing logic
│   ├── transformation-validator.ts    # Data transformation validation
│   └── tests/
│       └── data-flow.spec.ts         # Agent-specific tests
├── mcp-integration-specialist/
│   ├── mcp-integration.agent.ts      # Main agent implementation
│   ├── mcp-client-tester.ts          # Direct MCP testing
│   ├── response-validator.ts         # MCP response validation
│   └── tests/
│       └── mcp-integration.spec.ts   # Agent-specific tests
├── rust-bridge-debugger/
│   ├── rust-bridge.agent.ts          # Main agent implementation
│   ├── process-manager.ts            # Bridge process management
│   ├── log-analyzer.ts               # Bridge log analysis
│   └── tests/
│       └── rust-bridge.spec.ts       # Agent-specific tests
├── response-verification/
│   ├── response-verification.agent.ts # Main agent implementation
│   ├── message-parser.ts             # Telegram message parsing
│   ├── format-validator.ts           # Response format validation
│   └── tests/
│       └── response.spec.ts          # Agent-specific tests
├── orchestration/
│   ├── orchestration.agent.ts        # Main orchestrator
│   ├── workflow-manager.ts           # Debugging workflow
│   ├── findings-aggregator.ts        # Results aggregation
│   ├── fix-recommender.ts            # Fix recommendation engine
│   └── tests/
│       └── orchestration.spec.ts     # Orchestration tests
└── integration-tests/
    ├── agents-integration.spec.ts     # Full agent system tests
    ├── workflow-validation.spec.ts    # Workflow validation tests
    └── resolution-verification.spec.ts # Resolution verification tests
```

## 🔍 Next Steps

1. **Initialize the agent system**: Create shared types and communication interfaces
2. **Implement individual agents**: Build each specialized debugging agent
3. **Create orchestration system**: Implement workflow coordination and findings aggregation
4. **Integration testing**: Develop comprehensive tests for the agent system
5. **Deploy and execute**: Run the coordinated debugging workflow to resolve the TaskMaster issue

Each agent is designed to be focused, testable, and able to work both independently and as part of the coordinated system.
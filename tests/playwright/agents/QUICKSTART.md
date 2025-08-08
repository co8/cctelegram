# CCTelegram Debugging Agents - Quick Start Guide

## 🚀 Quick Setup & Execution

### 1. Install Dependencies
```bash
cd tests/playwright/agents
npm run setup
```

### 2. Run Complete Analysis
```bash
# Run all agents with orchestration
npm run agents:debug

# With verbose logging
npm run agents:debug:verbose

# Headless mode
npm run agents:debug:headless
```

### 3. View Results
```bash
# Open HTML report
npm run agents:report

# Check artifacts
ls test-results/artifacts/
```

## 🎯 What It Does

The debugging agent system systematically analyzes the CCTelegram TaskMaster integration issue where users see **old static data** (28/29 tasks, 96.55%) instead of **live data** (27/30 tasks, 90%).

### Agent Workflow:
1. **Data Flow Analyzer** → Traces data from TaskMaster file through the system
2. **MCP Integration Specialist** → Tests MCP server communication and data transformation
3. **Rust Bridge Debugger** → Analyzes Rust bridge processing and logs
4. **Response Verification** → Validates Telegram response format and content
5. **Issue Resolution Orchestrator** → Coordinates agents and generates fix recommendations

## 📊 Expected Output

### Successful Analysis Example:
```
🎯 Execution Summary:
  • Status: ✅ SUCCESS
  • Execution Time: 45000ms
  • Confidence Level: 87.5%
  • Priority: high

🔍 Issues Detected: 3
  1. [HIGH] TaskMaster file contains stale data pattern
     Component: taskmaster
     Type: stale_data

💡 Recommendations: 2
  1. [HIGH] Fix TaskMaster Data Staleness Issue
     Primary issue: Users seeing old static data instead of live data
     Confidence: 90.0%

📋 Action Plan: 5 items
  1. [HIGH] Resolve TaskMaster data staleness issue
     Component: taskmaster | Effort: 45min
```

### Generated Artifacts:
- `debugging-session-{sessionId}.json` - Complete analysis results
- `debugging-logs-{sessionId}.log` - Detailed execution logs  
- `comprehensive-analysis-report-{sessionId}.json` - Technical report
- `analysis-summary-{sessionId}.md` - Human-readable summary

## 🛠️ Individual Agent Testing

### Test Specific Components:
```bash
# Data flow analysis only
npm run agent:dataflow

# MCP integration testing only
npm run agent:mcp

# Orchestration system only  
npm run agent:orchestrator
```

### Manual Script Execution:
```bash
# Custom session ID
node scripts/run-agent-system.ts --session-id=manual-debug-001

# Default execution
node scripts/run-agent-system.ts
```

## 🔍 Understanding Results

### Issue Severity Levels:
- **CRITICAL** 🚨 - System cannot function (immediate fix required)
- **HIGH** ⚠️ - Major functionality impacted (fix within hours)  
- **MEDIUM** - Degraded experience (fix within days)
- **LOW** - Minor issues (fix when convenient)

### Primary Issue Types:
- **stale_data** - Old cached data being served instead of live data
- **mcp_connection_failure** - MCP server connectivity issues
- **bridge_process_error** - Rust bridge processing problems
- **response_format_error** - Telegram response formatting issues

### Confidence Levels:
- **90%+** - High confidence in findings and recommendations
- **70-89%** - Good confidence with solid evidence  
- **50-69%** - Moderate confidence, may need validation
- **<50%** - Low confidence, requires investigation

## 🎯 Common Scenarios

### Scenario 1: Stale Data Detected
**Symptoms**: Users see 28/29 tasks (96.55%) instead of live data
**Typical Findings**: 
- TaskMaster file contains live data (27/30 tasks, 90%)
- MCP server may be caching responses
- Bridge process may have stale cached data

**Recommended Actions**:
1. Clear MCP server cache and restart
2. Restart Rust bridge process  
3. Verify TaskMaster file timestamp
4. Test `/tasks` command for live data

### Scenario 2: MCP Connection Issues
**Symptoms**: Agents cannot connect to MCP server
**Typical Findings**:
- MCP server not running or unreachable
- Connection timeouts or errors
- Port conflicts or configuration issues

**Recommended Actions**:
1. Check MCP server process status
2. Verify port availability (default: 3001)
3. Review MCP server configuration
4. Restart MCP server with proper settings

### Scenario 3: System Components Down
**Symptoms**: Multiple critical failures across agents
**Typical Findings**:
- Bridge process not running
- TaskMaster files missing or corrupted
- Multiple connection failures

**Recommended Actions**:
1. Verify all system components are running
2. Check process health and resource usage
3. Review system logs for errors
4. Restart components in proper order

## 🚨 Troubleshooting

### Common Issues:

#### "MCP server not found" 
```bash
# Check MCP server path exists
ls ../../mcp-server/

# Build MCP server if needed
cd ../../mcp-server && npm install && npm run build
```

#### "Bridge binary not found"
```bash  
# Build Rust bridge
cd ../../ && cargo build --release

# Check binary exists
ls ../../target/release/cc-telegram-bridge
```

#### "Port already in use"
```bash
# Check port usage
lsof -i :3001  # MCP server
lsof -i :8080  # Bridge health
lsof -i :3000  # Bridge webhook

# Kill processes if needed
kill -9 <PID>
```

#### "Permission denied"
```bash
# Make bridge executable
chmod +x ../../target/release/cc-telegram-bridge

# Check file permissions
ls -la ../../target/release/cc-telegram-bridge
```

### Debug Mode:
```bash
# Maximum verbosity
DEBUG=* RUST_LOG=trace npm run agents:debug:verbose

# Component-specific debugging  
DEBUG=agent:* npm run agents:debug
DEBUG=mcp:* npm run agents:debug
DEBUG=bridge:* npm run agents:debug
```

## 📁 File Structure

```
agents/
├── README.md                          # Main documentation
├── QUICKSTART.md                      # This file
├── agents.config.ts                   # Configuration
├── package.json                       # Dependencies
├── playwright.config.ts               # Test configuration
├── tsconfig.json                      # TypeScript config
├── shared/                           # Common utilities
│   ├── types.ts                      # Type definitions
│   ├── communication.ts              # Agent communication
│   └── utilities.ts                  # Helper functions
├── data-flow-analyzer/               # Data flow analysis agent
├── mcp-integration-specialist/       # MCP integration agent  
├── orchestration/                    # Orchestration agent
├── integration-tests/                # Full system tests
├── scripts/                         # Execution scripts
└── test-results/                    # Generated reports
    ├── artifacts/                   # JSON reports
    ├── logs/                        # Execution logs
    ├── screenshots/                 # Debug screenshots
    └── html-report/                 # Visual reports
```

## 💡 Pro Tips

1. **Always run setup first**: `npm run setup` to ensure dependencies are installed

2. **Check system prerequisites**: Ensure TaskMaster files exist and system components are built

3. **Use verbose mode for debugging**: Add `--headed` and `DEBUG=*` for maximum visibility

4. **Review artifacts**: JSON reports contain detailed technical information  

5. **Follow action plan**: Implement suggested fixes in priority order

6. **Validate fixes**: Re-run agents after applying fixes to confirm resolution

7. **Save session IDs**: Use custom session IDs for tracking specific debugging sessions

## 🎉 Success Indicators

The debugging agent system is working correctly when:

✅ **All agents initialize successfully**  
✅ **No critical system component failures**  
✅ **Clear issue identification with high confidence**  
✅ **Specific, actionable fix recommendations**  
✅ **Comprehensive action plan with time estimates**  
✅ **Detailed artifacts and logs generated**

The **TaskMaster integration issue is resolved** when:

✅ **Users see live data (27/30 tasks, 90%)**  
✅ **No more static data responses (28/29 tasks, 96.55%)**  
✅ **Data flow integrity maintained throughout pipeline**  
✅ **System performance and stability improved**
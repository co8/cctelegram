#!/bin/bash

# Task 39 Agent Deployment Script
# Deploy 9 specialized agents for parallel message integrity work

set -e

echo "🚀 Deploying Task 39 Agent Orchestration System"
echo "================================================"

# Create agent session directories
AGENT_DIR="/Users/enrique/Documents/cctelegram/.claude/agents/sessions"
mkdir -p "$AGENT_DIR"

echo "📋 Creating agent session tracking..."

# Core Management Agents
echo "Deploying Core Management Agents..."

echo "1️⃣  Project Manager Agent"
cat > "$AGENT_DIR/task39-project-manager.session" << 'EOF'
SESSION_ID="task39-project-manager"
AGENT_TYPE="Core Management - Systems Coordinator"
PERSONA="--persona-architect"
MCP_TOOLS="--seq"
MISSION="Coordinate message integrity work across 6 specialized agents, manage timelines, resolve conflicts, ensure quality gates"
STATUS="ready"
PRIORITY="critical"

# Agent spawn command
SPAWN_CMD="claude --persona-architect --seq 'I am the Task 39 Project Manager Agent. My role is to coordinate all message integrity work across 6 specialized agents, manage timelines, resolve conflicts, and ensure quality gates are met. Focus on systems coordination and integration with Task 35 queue system.'"
EOF

echo "2️⃣  TaskMaster Agent"
cat > "$AGENT_DIR/task39-taskmaster.session" << 'EOF'
SESSION_ID="task39-taskmaster"
AGENT_TYPE="Core Management - Task Lifecycle Coordinator"
PERSONA="--persona-analyzer"
MCP_TOOLS="Task Master AI, TodoWrite, Sequential"
MISSION="Track progress of all 6 subtasks in real-time, manage dependencies, update task statuses, provide progress metrics"
STATUS="ready"
PRIORITY="critical"

# Agent spawn command
SPAWN_CMD="claude --persona-analyzer 'I am the Task 39 TaskMaster Agent. I track progress of all 6 subtasks in real-time, manage dependencies, update task statuses, and provide progress metrics. I coordinate with the main TaskMaster system and ensure no blocking issues.'"
EOF

echo "3️⃣  Documentation Agent"
cat > "$AGENT_DIR/task39-documentation.session" << 'EOF'
SESSION_ID="task39-documentation"
AGENT_TYPE="Core Management - Technical Documentation Specialist"
PERSONA="--persona-scribe=en"
MCP_TOOLS="--c7"
MISSION="Create real-time technical documentation, API guides, integration procedures, architecture decision records"
STATUS="ready"
PRIORITY="high"

# Agent spawn command
SPAWN_CMD="claude --persona-scribe=en --c7 'I am the Task 39 Documentation Agent. I create real-time technical documentation, API guides, integration procedures, and architecture decision records for the message integrity system. I ensure knowledge transfer and system maintainability.'"
EOF

# Specialized Technical Agents
echo "Deploying Specialized Technical Agents..."

echo "4️⃣  Queue Integration Specialist"
cat > "$AGENT_DIR/task39-queue-specialist.session" << 'EOF'
SESSION_ID="task39-queue-specialist"
AGENT_TYPE="Technical Specialist - Queue Integration"
PERSONA="--persona-backend"
MCP_TOOLS="--seq"
SUBTASK="39.1 - Immediate Queue Integration Analysis"
MISSION="Analyze queue.rs implementation from Task 35, assess Redis limits, identify truncation risks"
STATUS="ready"
PRIORITY="critical"

# Agent spawn command
SPAWN_CMD="claude --persona-backend --seq 'I am the Queue Integration Specialist for Task 39.1. I analyze the queue.rs implementation from Task 35, assess Redis limits, identify truncation risks, and ensure message integrity through queue operations.'"
EOF

echo "5️⃣  Buffer Audit Specialist"
cat > "$AGENT_DIR/task39-buffer-specialist.session" << 'EOF'
SESSION_ID="task39-buffer-specialist"
AGENT_TYPE="Technical Specialist - Buffer Analysis"
PERSONA="--persona-performance"
MCP_TOOLS="--seq"
SUBTASK="39.2 - Critical Buffer Size Audit"
MISSION="Comprehensive buffer size audit across all tiers, identify truncation points, analyze memory usage"
STATUS="ready"
PRIORITY="high"

# Agent spawn command
SPAWN_CMD="claude --persona-performance --seq 'I am the Buffer Audit Specialist for Task 39.2. I perform comprehensive buffer size audits across all system tiers, identify truncation points, and analyze memory usage patterns for optimization.'"
EOF

echo "6️⃣  Dynamic Buffer Engineer"
cat > "$AGENT_DIR/task39-buffer-engineer.session" << 'EOF'
SESSION_ID="task39-buffer-engineer"
AGENT_TYPE="Technical Specialist - Buffer Implementation"
PERSONA="--persona-backend"
MCP_TOOLS="--c7"
SUBTASK="39.3 - Dynamic Buffer Implementation"
MISSION="Replace fixed-size buffers with dynamic allocation using Node.js patterns, ensure queue compatibility"
STATUS="ready"
PRIORITY="high"
DEPENDENCIES="39.2"

# Agent spawn command
SPAWN_CMD="claude --persona-backend --c7 'I am the Dynamic Buffer Engineer for Task 39.3. I replace fixed-size buffers with dynamic allocation using Node.js patterns, implement proper memory management, and ensure queue compatibility.'"
EOF

echo "7️⃣  Compression Specialist"
cat > "$AGENT_DIR/task39-compression-specialist.session" << 'EOF'
SESSION_ID="task39-compression-specialist"
AGENT_TYPE="Technical Specialist - Message Compression"
PERSONA="--persona-performance"
MCP_TOOLS="--c7"
SUBTASK="39.4 - Queue-Aware Message Compression"
MISSION="Implement zlib compression for queue storage efficiency, maintain integrity during compression/decompression"
STATUS="ready"
PRIORITY="high"
DEPENDENCIES="39.1,39.3"

# Agent spawn command
SPAWN_CMD="claude --persona-performance --c7 'I am the Compression Specialist for Task 39.4. I implement zlib compression for queue storage efficiency, maintain integrity during compression/decompression, and optimize Redis storage performance.'"
EOF

echo "8️⃣  Integrity Validation Engineer"
cat > "$AGENT_DIR/task39-validation-engineer.session" << 'EOF'
SESSION_ID="task39-validation-engineer"
AGENT_TYPE="Technical Specialist - Integrity Validation"
PERSONA="--persona-security"
MCP_TOOLS="--seq"
SUBTASK="39.5 - End-to-End Integrity Validation"
MISSION="Implement SHA-256 checksums, design end-to-end validation systems, ensure message integrity across all tiers"
STATUS="ready"
PRIORITY="high"
DEPENDENCIES="39.1,39.2,39.3,39.4"

# Agent spawn command
SPAWN_CMD="claude --persona-security --seq 'I am the Integrity Validation Engineer for Task 39.5. I implement SHA-256 checksums, design end-to-end validation systems, and ensure message integrity across all processing tiers.'"
EOF

echo "9️⃣  Large Message Protocol Engineer"
cat > "$AGENT_DIR/task39-protocol-engineer.session" << 'EOF'
SESSION_ID="task39-protocol-engineer"
AGENT_TYPE="Technical Specialist - Protocol Design"
PERSONA="--persona-architect"
MCP_TOOLS="--seq"
SUBTASK="39.6 - Large Message Handling Protocol"
MISSION="Design and implement message splitting/reassembly protocols, coordinate with queue processing limits"
STATUS="ready"
PRIORITY="high"
DEPENDENCIES="39.3,39.4,39.5"

# Agent spawn command
SPAWN_CMD="claude --persona-architect --seq 'I am the Large Message Protocol Engineer for Task 39.6. I design and implement message splitting/reassembly protocols, coordinate with queue processing limits, and maintain message order integrity.'"
EOF

# Create agent coordination dashboard
echo "📊 Creating Agent Coordination Dashboard..."
cat > "$AGENT_DIR/coordination-dashboard.md" << 'EOF'
# Task 39 Agent Coordination Dashboard
**Status**: All 9 agents ready for deployment
**Timeline**: 4-week parallel execution starting immediately

## Agent Status Overview

### Core Management Agents ✅
- **Project Manager**: Ready - Systems coordination and quality gates
- **TaskMaster**: Ready - Progress tracking and dependency management  
- **Documentation**: Ready - Technical documentation and knowledge transfer

### Specialized Technical Agents ✅
- **Queue Integration Specialist**: Ready - Task 39.1 (Critical - no dependencies)
- **Buffer Audit Specialist**: Ready - Task 39.2 (High - can start immediately)
- **Dynamic Buffer Engineer**: Ready - Task 39.3 (High - depends on 39.2)
- **Compression Specialist**: Ready - Task 39.4 (High - depends on 39.1, 39.3)
- **Integrity Validation Engineer**: Ready - Task 39.5 (High - depends on all previous)
- **Large Message Protocol Engineer**: Ready - Task 39.6 (High - depends on 39.3-39.5)

## Deployment Commands

Each agent can be deployed using their respective SPAWN_CMD from their session files.
Use the coordination protocols defined in task39-orchestration.md for management.

## Success Criteria
- ✅ All 9 agents configured and ready
- ✅ Coordination protocols established
- ✅ Session tracking implemented
- 🎯 Ready for parallel execution
EOF

# Create quick deployment script
echo "⚡ Creating Quick Deployment Commands..."
cat > "$AGENT_DIR/quick-deploy.sh" << 'EOF'
#!/bin/bash
# Quick deployment commands for Task 39 agents

echo "🚀 Quick Deploy Task 39 Agents"
echo "Choose deployment type:"
echo "1. Deploy Core Management Agents (3)"
echo "2. Deploy Technical Specialist Agents (6)" 
echo "3. Deploy All Agents (9)"
echo "4. Deploy Individual Agent"

read -p "Selection (1-4): " choice

case $choice in
  1)
    echo "Deploying Core Management Agents..."
    echo "Run these commands in separate terminals:"
    echo ""
    echo "# Project Manager"
    echo "claude --persona-architect --seq 'I am the Task 39 Project Manager Agent...'"
    echo ""
    echo "# TaskMaster Agent"  
    echo "claude --persona-analyzer 'I am the Task 39 TaskMaster Agent...'"
    echo ""
    echo "# Documentation Agent"
    echo "claude --persona-scribe=en --c7 'I am the Task 39 Documentation Agent...'"
    ;;
  2)
    echo "Deploying Technical Specialist Agents..."
    echo "Run these commands in separate terminals:"
    echo ""
    echo "# Queue Integration Specialist"
    echo "claude --persona-backend --seq 'I am the Queue Integration Specialist...'"
    echo ""
    echo "# Buffer Audit Specialist"
    echo "claude --persona-performance --seq 'I am the Buffer Audit Specialist...'"
    echo ""
    echo "# Dynamic Buffer Engineer" 
    echo "claude --persona-backend --c7 'I am the Dynamic Buffer Engineer...'"
    echo ""
    echo "# Compression Specialist"
    echo "claude --persona-performance --c7 'I am the Compression Specialist...'"
    echo ""
    echo "# Integrity Validation Engineer"
    echo "claude --persona-security --seq 'I am the Integrity Validation Engineer...'"
    echo ""
    echo "# Large Message Protocol Engineer"
    echo "claude --persona-architect --seq 'I am the Large Message Protocol Engineer...'"
    ;;
  3)
    echo "Deploy all 9 agents - see individual commands in session files"
    ;;
  4)
    echo "Individual agent deployment - check session files for specific commands"
    ;;
esac
EOF

chmod +x "$AGENT_DIR/quick-deploy.sh"

echo "✅ Task 39 Agent Orchestration System Deployed Successfully!"
echo ""
echo "📍 Agent files created in: $AGENT_DIR"
echo "📊 Coordination dashboard: $AGENT_DIR/coordination-dashboard.md"
echo "⚡ Quick deployment: $AGENT_DIR/quick-deploy.sh"
echo ""
echo "🎯 Ready for parallel execution of Task 39 message integrity work!"
echo "   Use the spawn commands from session files to deploy individual agents"
echo "   Follow coordination protocols in task39-orchestration.md"
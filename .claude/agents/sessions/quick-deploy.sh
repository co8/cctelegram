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

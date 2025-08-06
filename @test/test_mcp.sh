#!/bin/bash

echo "Testing MCP server response parsing..."

# Test the MCP server directly
echo "1. Testing MCP server directly:"
cd /Users/enrique/Documents/cctelegram/mcp-server
response=$(node dist/index.js <<< '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_task_status","arguments":{}}}' 2>/dev/null | head -1)

echo "MCP Server Response (first part):"
echo "$response" | jq -r '.result.content[0].text' | head -10

# Extract the key metrics we care about
echo ""
echo "2. Extracting key metrics from MCP response:"
text_content=$(echo "$response" | jq -r '.result.content[0].text')
echo "Main tasks count:" $(echo "$text_content" | jq -r '.taskmaster_tasks.main_tasks_count')
echo "Subtasks count:" $(echo "$text_content" | jq -r '.taskmaster_tasks.subtasks_count') 
echo "Total count:" $(echo "$text_content" | jq -r '.combined_summary.grand_total')
echo "Pending:" $(echo "$text_content" | jq -r '.combined_summary.total_pending')
echo "In Progress:" $(echo "$text_content" | jq -r '.combined_summary.total_in_progress')
echo "Completed:" $(echo "$text_content" | jq -r '.combined_summary.total_completed')

echo ""
echo "3. This should now be parsed correctly by the Rust bridge."
echo "   Expected: 27 main tasks + 120 subtasks = 147 total"
echo "   No longer: 12 tasks from file system fallback"
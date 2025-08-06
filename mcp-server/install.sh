#!/bin/bash

# CC Telegram MCP Server Installation Script

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_CONFIG_DIR="$HOME/.claude"

echo "🚀 Installing CC Telegram MCP Server..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if ! node -e "process.exit(process.version.slice(1).split('.').map(Number).reduce((a,b,i)=>(a+(b<<(8*(2-i)))),0) >= '$REQUIRED_VERSION'.split('.').map(Number).reduce((a,b,i)=>(a+(b<<(8*(2-i)))),0) ? 0 : 1)"; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js version: $NODE_VERSION"

# Install dependencies
echo "📦 Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

# Note: Using development mode due to TypeScript compilation issues
echo "🔨 Setting up development mode..."
echo "⚠️  Note: Using development mode (tsx) due to TypeScript compilation complexity"

echo "📝 Creating MCP configuration..."

# Create Claude config directory if it doesn't exist
mkdir -p "$MCP_CONFIG_DIR"

# Create or update Claude desktop config
CLAUDE_CONFIG="$MCP_CONFIG_DIR/claude_desktop_config.json"

if [ -f "$CLAUDE_CONFIG" ]; then
    echo "⚠️  Claude config already exists. Please manually add the following to your claude_desktop_config.json:"
    echo ""
    echo "Add this to the 'mcpServers' section:"
    echo ""
    cat << 'EOF'
    "cctelegram": {
      "command": "npx",
      "args": ["tsx", "FULL_PATH_TO/cc-telegram/mcp-server/src/index.ts"],
      "env": {
        "CC_TELEGRAM_EVENTS_DIR": "~/.cc_telegram/events",
        "CC_TELEGRAM_RESPONSES_DIR": "~/.cc_telegram/responses",
        "CC_TELEGRAM_HEALTH_PORT": "8080"
      }
    }
EOF
    echo ""
    echo "Replace FULL_PATH_TO with the actual path: $SCRIPT_DIR"
else
    echo "📄 Creating new Claude config..."
    cat > "$CLAUDE_CONFIG" << EOF
{
  "mcpServers": {
    "cctelegram": {
      "command": "npx",
      "args": ["tsx", "$SCRIPT_DIR/src/index.ts"],
      "env": {
        "CC_TELEGRAM_EVENTS_DIR": "~/.cc_telegram/events",
        "CC_TELEGRAM_RESPONSES_DIR": "~/.cc_telegram/responses",
        "CC_TELEGRAM_HEALTH_PORT": "8080"
      }
    }
  }
}
EOF
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Next steps:"
echo "1. Make sure your CC Telegram Bridge is running:"
echo "   cd $SCRIPT_DIR/.."
echo "   ./target/release/cc-telegram-bridge"
echo ""
echo "2. Restart Claude Code to load the MCP server"
echo ""
echo "3. Test the integration with:"
echo "   @cctelegram send_telegram_message \"Hello from Claude Code!\""
echo ""
echo "🔧 Configuration files:"
echo "   - Claude config: $CLAUDE_CONFIG"
echo "   - Events directory: ~/.cc_telegram/events"
echo "   - Responses directory: ~/.cc_telegram/responses"
echo ""
echo "📚 Available tools:"
echo "   - send_telegram_event: Send structured events"
echo "   - send_telegram_message: Send simple messages"  
echo "   - send_task_completion: Send task completion notifications"
echo "   - send_performance_alert: Send performance alerts"
echo "   - send_approval_request: Request user approval"
echo "   - get_telegram_responses: Get user responses"
echo "   - get_bridge_status: Check bridge health"
echo "   - list_event_types: List available event types"
echo "   - get_task_status: Get TaskMaster and Claude Code task status"
echo "   - todo: Display organized todo list with completed, current, and upcoming tasks"
echo ""
echo "🎉 Happy coding with remote Telegram monitoring!"
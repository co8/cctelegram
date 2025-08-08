#!/bin/bash
set -e

# CCTelegram Bridge - Emulation System Setup Script
# Sets up the comprehensive automated testing environment

echo "🧪 CCTelegram Bridge - Setting up Emulation System"
echo "================================================="

# Get current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "📂 Project root: $PROJECT_ROOT"
echo "📂 Emulation dir: $SCRIPT_DIR"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check Node.js version
check_node_version() {
    if command_exists node; then
        local node_version
        node_version=$(node --version | sed 's/v//' | cut -d'.' -f1)
        if [ "$node_version" -ge 18 ]; then
            echo "✅ Node.js $(node --version) found"
            return 0
        else
            echo "❌ Node.js version must be 18 or higher (found: $(node --version))"
            return 1
        fi
    else
        echo "❌ Node.js not found"
        return 1
    fi
}

# Function to check Rust installation
check_rust() {
    if command_exists cargo && command_exists rustc; then
        echo "✅ Rust $(rustc --version) found"
        return 0
    else
        echo "❌ Rust/Cargo not found"
        return 1
    fi
}

# Function to create directory structure
setup_directories() {
    echo ""
    echo "📁 Setting up directory structure..."
    
    local dirs=(
        "$SCRIPT_DIR/logs"
        "$SCRIPT_DIR/logs/emulator"
        "$SCRIPT_DIR/logs/flows"
        "$SCRIPT_DIR/logs/verification"
        "$SCRIPT_DIR/logs/reports"
    )
    
    for dir in "${dirs[@]}"; do
        mkdir -p "$dir"
        echo "   Created: $dir"
    done
}

# Function to install dependencies
install_dependencies() {
    echo ""
    echo "📦 Installing Node.js dependencies..."
    cd "$SCRIPT_DIR"
    
    if [ -f package.json ]; then
        npm install
        echo "✅ Dependencies installed successfully"
    else
        echo "❌ package.json not found in $SCRIPT_DIR"
        exit 1
    fi
}

# Function to build Rust bridge
build_bridge() {
    echo ""
    echo "🦀 Building CCTelegram Bridge..."
    cd "$PROJECT_ROOT"
    
    if [ -f Cargo.toml ]; then
        echo "   Building in release mode (this may take a few minutes)..."
        cargo build --release
        echo "✅ Bridge built successfully"
    else
        echo "❌ Cargo.toml not found in $PROJECT_ROOT"
        exit 1
    fi
}

# Function to verify MCP server
check_mcp_server() {
    echo ""
    echo "🔗 Checking MCP Server..."
    
    local mcp_dir="$PROJECT_ROOT/mcp-server"
    if [ -d "$mcp_dir" ] && [ -f "$mcp_dir/package.json" ]; then
        echo "✅ MCP Server found"
        cd "$mcp_dir"
        
        if [ ! -d node_modules ]; then
            echo "   Installing MCP Server dependencies..."
            npm install
        fi
        echo "✅ MCP Server ready"
    else
        echo "⚠️ MCP Server not found at $mcp_dir"
        echo "   Some tests may fail without MCP server"
    fi
}

# Function to check TaskMaster
check_taskmaster() {
    echo ""
    echo "📋 Checking TaskMaster..."
    
    local taskmaster_dir="$PROJECT_ROOT/.taskmaster"
    if [ -d "$taskmaster_dir" ]; then
        echo "✅ TaskMaster found - tests will use live data"
        
        # Show current task counts for reference
        local tasks_file="$taskmaster_dir/tasks/tasks.json"
        if [ -f "$tasks_file" ]; then
            echo "   📊 Current TaskMaster data:"
            if command_exists jq; then
                local completed=$(jq -r '.tags.master.tasks | map(select(.status == "done" or .status == "completed")) | length' "$tasks_file" 2>/dev/null || echo "unknown")
                local total=$(jq -r '.tags.master.tasks | length' "$tasks_file" 2>/dev/null || echo "unknown")
                echo "      Tasks: $completed/$total completed"
            else
                echo "      (Install 'jq' for detailed task counts)"
            fi
        fi
    else
        echo "⚠️ TaskMaster not initialized"
        echo "   Tests will use fallback data"
        echo "   To initialize: run 'task-master init' in project root"
    fi
}

# Function to run quick validation
run_validation() {
    echo ""
    echo "🧪 Running validation tests..."
    cd "$SCRIPT_DIR"
    
    echo "   Testing TypeScript compilation..."
    if npx tsc --noEmit; then
        echo "   ✅ TypeScript compilation successful"
    else
        echo "   ❌ TypeScript compilation failed"
        exit 1
    fi
    
    echo "   Testing emulator startup..."
    timeout 10s npx tsx -e "
        import { TelegramBotApiEmulator } from './telegram-bot-api-emulator.js';
        const emulator = new TelegramBotApiEmulator(18081, './logs/test');
        await emulator.start();
        console.log('   ✅ Emulator test successful');
        await emulator.stop();
    " || echo "   ⚠️ Emulator test failed (may be normal)"
    
    echo "✅ Validation completed"
}

# Function to create example configuration
create_example_config() {
    echo ""
    echo "📝 Creating example configuration..."
    
    local example_config="$SCRIPT_DIR/example-config.json"
    cat > "$example_config" << 'EOF'
{
  "name": "Custom Test Configuration",
  "description": "Example test configuration - modify as needed",
  "telegramEmulator": {
    "port": 8090,
    "responseDelay": 100,
    "simulateFailures": false,
    "failureRate": 0.05
  },
  "bridge": {
    "executable": "cargo run --release",
    "startupTimeout": 30000,
    "healthCheckInterval": 500,
    "webhookUrl": "http://localhost:8090/webhook"
  },
  "mcp": {
    "serverPath": "./mcp-server",
    "startupTimeout": 20000
  },
  "scenarios": [
    "tasks-command-basic",
    "data-staleness-detection"
  ],
  "expectedData": {
    "completed": 25,
    "total": 30,
    "pending": 3,
    "inProgress": 2
  },
  "parallel": false,
  "repeatCount": 1,
  "timeoutMs": 60000,
  "cleanup": true
}
EOF
    
    echo "   Created: $example_config"
}

# Function to show next steps
show_next_steps() {
    echo ""
    echo "🎉 Setup completed successfully!"
    echo ""
    echo "🚀 Next steps:"
    echo "============="
    echo ""
    echo "1. Run basic functionality test:"
    echo "   cd $SCRIPT_DIR"
    echo "   npm run test:basic"
    echo ""
    echo "2. Test for data staleness issues (RECOMMENDED):"
    echo "   npm run test:staleness"
    echo ""
    echo "3. Run all comprehensive tests:"
    echo "   npm test"
    echo ""
    echo "4. See available test configurations:"
    echo "   npm run list-configs"
    echo ""
    echo "📊 Test results will be available in:"
    echo "   $SCRIPT_DIR/logs/"
    echo ""
    echo "📚 For detailed usage, see README.md"
    echo ""
    echo "🚨 CRITICAL: The system will detect if old static data"
    echo "   (like '28/29 tasks, 96.55%') is being returned"
    echo "   instead of live TaskMaster data!"
}

# Main execution
main() {
    echo ""
    echo "🔍 Checking prerequisites..."
    
    # Check prerequisites
    local prereq_failed=false
    
    if ! check_node_version; then
        echo "   Please install Node.js 18+ from https://nodejs.org"
        prereq_failed=true
    fi
    
    if ! check_rust; then
        echo "   Please install Rust from https://rustup.rs"
        prereq_failed=true
    fi
    
    if [ "$prereq_failed" = true ]; then
        echo ""
        echo "❌ Prerequisites not met. Please install missing dependencies."
        exit 1
    fi
    
    # Setup process
    setup_directories
    install_dependencies
    build_bridge
    check_mcp_server
    check_taskmaster
    run_validation
    create_example_config
    show_next_steps
}

# Handle interruption
trap 'echo ""; echo "🛑 Setup interrupted"; exit 130' INT

# Handle errors
trap 'echo ""; echo "❌ Setup failed on line $LINENO"; exit 1' ERR

# Run main function
main "$@"
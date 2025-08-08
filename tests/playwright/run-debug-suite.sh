#!/bin/bash
set -e

# CCTelegram Bridge Debug Suite Runner
# Automated script to set up and run the comprehensive debug tests

echo "🔍 CCTelegram Bridge Debug Suite"
echo "================================"
echo "Systematic debugging for /tasks command data issue"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "cctelegram-bridge-debug.spec.ts" ]; then
    print_error "Please run this script from the tests/playwright directory"
    exit 1
fi

print_status "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version 18+ is required. Current version: $(node --version)"
    exit 1
fi

print_success "Node.js $(node --version) found"

# Check Rust/Cargo
if ! command -v cargo &> /dev/null; then
    print_warning "Cargo (Rust) not found. Bridge compilation may fail."
else
    print_success "Cargo $(cargo --version | cut -d' ' -f2) found"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    print_status "Installing Node.js dependencies..."
    npm install
fi

# Install Playwright browsers if needed
if [ ! -d "node_modules/@playwright/test" ]; then
    print_status "Installing Playwright..."
    npm run install-browsers
fi

print_success "Dependencies ready"

# Set up project root path
PROJECT_ROOT=$(cd ../.. && pwd)
print_status "Project root: $PROJECT_ROOT"

# Check TaskMaster setup
if [ ! -d "$PROJECT_ROOT/.taskmaster" ]; then
    print_warning "TaskMaster not initialized. Creating test structure..."
    mkdir -p "$PROJECT_ROOT/.taskmaster/tasks"
    mkdir -p "$PROJECT_ROOT/.taskmaster/docs"
fi

# Build Rust bridge if needed
BRIDGE_BINARY="$PROJECT_ROOT/target/release/cc-telegram-bridge"
if [ ! -f "$BRIDGE_BINARY" ]; then
    print_status "Building Rust bridge..."
    cd "$PROJECT_ROOT"
    cargo build --release
    cd - > /dev/null
fi

if [ -f "$BRIDGE_BINARY" ]; then
    print_success "Bridge binary found at $BRIDGE_BINARY"
else
    print_error "Failed to build bridge binary"
    exit 1
fi

# Build MCP server if needed
MCP_SERVER_DIST="$PROJECT_ROOT/mcp-server/dist"
if [ ! -d "$MCP_SERVER_DIST" ]; then
    print_status "Building MCP server..."
    cd "$PROJECT_ROOT/mcp-server"
    if [ -f "package.json" ]; then
        npm install
        npm run build
    else
        print_warning "MCP server package.json not found"
    fi
    cd - > /dev/null
fi

if [ -d "$MCP_SERVER_DIST" ]; then
    print_success "MCP server built"
else
    print_warning "MCP server dist not found - tests may fail"
fi

# Clean previous test results
print_status "Cleaning previous test results..."
rm -rf test-results
mkdir -p test-results/logs

print_success "Environment ready!"

echo ""
echo "🚀 Starting Debug Test Suite"
echo "============================="

# Set environment variables for the test
export CC_TELEGRAM_HEALTH_PORT=8080
export CC_TELEGRAM_WEBHOOK_PORT=3000
export CC_TELEGRAM_BOT_TOKEN=test-bot-token
export CC_TELEGRAM_ALLOWED_USERS=123456789
export CC_TELEGRAM_EVENTS_DIR=/tmp/test-events
export CC_TELEGRAM_RESPONSES_DIR=/tmp/test-responses
export RUST_LOG=debug
export RUST_BACKTRACE=1
export MCP_ENABLE_AUTH=false
export MCP_LOG_LEVEL=debug

print_status "Environment variables set"

# Run the debug tests
echo ""
print_status "Executing CCTelegram bridge debug tests..."
echo ""

if npm run test:bridge-debug; then
    echo ""
    print_success "🎉 Debug suite completed successfully!"
    echo ""
    echo "📊 Results available at:"
    echo "   - HTML Report: $(pwd)/test-results/report/index.html"
    echo "   - Debug Analysis: $(pwd)/test-results/debug-analysis.json"  
    echo "   - Test Summary: $(pwd)/test-results/test-summary.md"
    echo "   - Detailed Logs: $(pwd)/test-results/logs/"
    echo ""
    
    # Check if any issues were found
    if [ -f "test-results/debug-analysis.json" ]; then
        ISSUES=$(grep -o "Old static data detected" test-results/debug-analysis.json 2>/dev/null || echo "")
        if [ -n "$ISSUES" ]; then
            print_warning "🚨 ISSUE DETECTED: Old static data found in /tasks response"
            echo "   Review the debug analysis report for specific fix recommendations"
        else
            print_success "✅ No data source issues detected"
        fi
    fi
    
    echo ""
    echo "🎯 Next Steps:"
    echo "1. Open the HTML report to review detailed test execution"
    echo "2. Check debug-analysis.json for specific issue identification"  
    echo "3. Review bridge logs for MCP connection details"
    echo "4. Apply recommended fixes and re-run tests"
    echo ""
    echo "To re-run tests:"
    echo "   npm run test:bridge-debug"
    echo ""
    echo "To view reports:"
    echo "   npm run test:report"
    
else
    echo ""
    print_error "❌ Debug suite failed"
    echo ""
    echo "🔍 Troubleshooting:"
    echo "1. Check test-results/logs/ for detailed error logs"
    echo "2. Ensure all prerequisites are installed"
    echo "3. Verify bridge binary and MCP server are built"
    echo "4. Check for port conflicts (8080, 3000, 3001, 3002)"
    echo ""
    echo "For help, see: $(pwd)/README.md"
    exit 1
fi
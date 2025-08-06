#!/bin/bash

# Contract Testing Workflow Script
# Comprehensive contract testing orchestration for CCTelegram

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_ROOT/logs/contract-workflow"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/workflow_${TIMESTAMP}.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration from environment
ENVIRONMENT="${CI_ENVIRONMENT:-development}"
GIT_BRANCH="${GIT_BRANCH:-$(git branch --show-current 2>/dev/null || echo 'unknown')}"
GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo 'unknown')}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%s)}"
DRY_RUN="${DRY_RUN:-false}"
PARALLEL_EXECUTION="${PARALLEL_EXECUTION:-true}"
MAX_RETRIES="${MAX_RETRIES:-3}"

# Pact Broker Configuration
PACT_BROKER_URL="${PACT_BROKER_URL:-http://localhost:9292}"
PACT_BROKER_TOKEN="${PACT_BROKER_TOKEN:-}"
CONSUMER_NAME="cctelegram-mcp-server"
PROVIDER_NAME="cctelegram-bridge"

# Function definitions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

log_info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO:${NC} $1" | tee -a "$LOG_FILE"
}

print_banner() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                    CCTelegram Contract Testing               ║
║                     Workflow Orchestrator                   ║
╚══════════════════════════════════════════════════════════════╝
EOF
}

setup_logging() {
    mkdir -p "$LOG_DIR"
    log "Contract testing workflow started"
    log "Environment: $ENVIRONMENT"
    log "Branch: $GIT_BRANCH"
    log "Commit: $GIT_COMMIT"
    log "Build: $BUILD_NUMBER"
    log "Dry Run: $DRY_RUN"
    log "Parallel Execution: $PARALLEL_EXECUTION"
}

check_prerequisites() {
    log "🔍 Checking prerequisites..."
    
    # Check required tools
    local missing_tools=()
    
    command -v node >/dev/null 2>&1 || missing_tools+=("node")
    command -v npm >/dev/null 2>&1 || missing_tools+=("npm")
    command -v git >/dev/null 2>&1 || missing_tools+=("git")
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        exit 1
    fi
    
    # Check Node.js version
    local node_version
    node_version=$(node --version | sed 's/v//')
    log_info "Node.js version: $node_version"
    
    # Check if project dependencies are installed
    if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
        log_warn "Node modules not found, installing dependencies..."
        cd "$PROJECT_ROOT"
        npm install
    fi
    
    # Check TypeScript compilation
    log_info "Checking TypeScript compilation..."
    cd "$PROJECT_ROOT"
    npx tsc --noEmit
    
    log "✅ Prerequisites check completed"
}

setup_test_environment() {
    log "⚙️  Setting up test environment..."
    
    cd "$PROJECT_ROOT"
    
    # Create required directories
    mkdir -p pacts logs/pact contract-versions tmp/test-events tmp/test-responses
    
    # Clear any existing contract artifacts
    rm -rf pacts/*.json
    
    # Export environment variables for tests
    export PACT_BROKER_URL="$PACT_BROKER_URL"
    export PACT_BROKER_TOKEN="$PACT_BROKER_TOKEN"
    export CI="true"
    export NODE_ENV="test"
    
    log "✅ Test environment setup completed"
}

run_consumer_tests() {
    log "🧪 Running consumer contract tests..."
    
    cd "$PROJECT_ROOT"
    
    local attempt=1
    while [ $attempt -le $MAX_RETRIES ]; do
        log_info "Consumer test attempt $attempt/$MAX_RETRIES"
        
        if npm run test:contract:consumer; then
            log "✅ Consumer contract tests passed"
            return 0
        else
            log_warn "Consumer test attempt $attempt failed"
            if [ $attempt -eq $MAX_RETRIES ]; then
                log_error "Consumer contract tests failed after $MAX_RETRIES attempts"
                return 1
            fi
            attempt=$((attempt + 1))
            sleep 5
        fi
    done
}

run_provider_verification() {
    log "🔬 Running provider verification..."
    
    cd "$PROJECT_ROOT"
    
    # Check if bridge is available for testing
    if command -v cargo >/dev/null 2>&1; then
        log_info "Cargo found, attempting to build bridge for testing..."
        # Build bridge if Rust toolchain is available
        if [ -f "../Cargo.toml" ]; then
            (cd .. && cargo build --bin cctelegram-bridge) || log_warn "Bridge build failed, continuing with mock"
        fi
    fi
    
    local attempt=1
    while [ $attempt -le $MAX_RETRIES ]; do
        log_info "Provider verification attempt $attempt/$MAX_RETRIES"
        
        if npm run test:contract:provider; then
            log "✅ Provider verification passed"
            return 0
        else
            log_warn "Provider verification attempt $attempt failed"
            if [ $attempt -eq $MAX_RETRIES ]; then
                log_error "Provider verification failed after $MAX_RETRIES attempts"
                return 1
            fi
            attempt=$((attempt + 1))
            sleep 10
        fi
    done
}

publish_contracts() {
    if [ "$DRY_RUN" = "true" ]; then
        log_info "🔍 DRY RUN: Would publish contracts to broker"
        return 0
    fi
    
    # Only publish from main/master branch
    if [[ "$GIT_BRANCH" != "main" && "$GIT_BRANCH" != "master" ]]; then
        log_info "Skipping contract publishing for branch: $GIT_BRANCH"
        return 0
    fi
    
    log "📤 Publishing contracts to Pact Broker..."
    
    cd "$PROJECT_ROOT"
    
    if npm run pact:publish; then
        log "✅ Contracts published successfully"
    else
        log_error "Contract publishing failed"
        return 1
    fi
}

check_deployment_compatibility() {
    log "🚦 Checking deployment compatibility..."
    
    cd "$PROJECT_ROOT"
    
    # Run deployment compatibility check
    if node scripts/contract-ci.js deploy-check; then
        log "✅ Deployment compatibility check passed"
    else
        log_error "Deployment compatibility check failed"
        return 1
    fi
}

run_contract_evolution_analysis() {
    log "🔄 Running contract evolution analysis..."
    
    cd "$PROJECT_ROOT"
    
    # Generate contract evolution report
    if npx tsx tests/contract/utils/version-manager.ts; then
        log "✅ Contract evolution analysis completed"
        
        # Display evolution summary if report exists
        if [ -f "contract-versions/latest.json" ]; then
            log_info "Contract Evolution Summary:"
            jq -r '.evolution_metadata | 
                "Version Type: " + .version_type + 
                "\nBackward Compatible: " + (.backward_compatible | tostring) +
                "\nNew Features: " + (.new_features | length | tostring) +
                "\nRemoved Features: " + (.removed_features | length | tostring)' \
                contract-versions/latest.json
        fi
    else
        log_warn "Contract evolution analysis failed, continuing..."
    fi
}

run_integration_tests() {
    log "🔗 Running contract integration tests..."
    
    cd "$PROJECT_ROOT"
    
    if npm run test:contract:integration; then
        log "✅ Contract integration tests passed"
    else
        log_error "Contract integration tests failed"
        return 1
    fi
}

generate_reports() {
    log "📊 Generating contract testing reports..."
    
    cd "$PROJECT_ROOT"
    
    local report_dir="$PROJECT_ROOT/reports/contract"
    mkdir -p "$report_dir"
    
    # Generate test coverage report
    if [ -f "coverage/coverage-summary.json" ]; then
        cp coverage/coverage-summary.json "$report_dir/coverage-summary.json"
    fi
    
    # Generate contract evolution report
    if [ -f "contract-versions/latest.json" ]; then
        cp contract-versions/latest.json "$report_dir/latest-contract-version.json"
    fi
    
    # Generate workflow summary
    cat > "$report_dir/workflow-summary.json" << EOF
{
  "workflow_id": "${BUILD_NUMBER}",
  "timestamp": "$(date -Iseconds)",
  "environment": "$ENVIRONMENT",
  "branch": "$GIT_BRANCH",
  "commit": "$GIT_COMMIT",
  "consumer": "$CONSUMER_NAME",
  "provider": "$PROVIDER_NAME",
  "dry_run": $DRY_RUN,
  "parallel_execution": $PARALLEL_EXECUTION
}
EOF
    
    log "✅ Reports generated in $report_dir"
}

cleanup() {
    log "🧹 Cleaning up test environment..."
    
    cd "$PROJECT_ROOT"
    
    # Stop any background processes
    if [ -n "${BRIDGE_PID:-}" ]; then
        kill "$BRIDGE_PID" 2>/dev/null || true
    fi
    
    # Clean up temporary files
    rm -rf tmp/test-events/* tmp/test-responses/*
    
    # Archive logs
    if [ -f "$LOG_FILE" ]; then
        gzip "$LOG_FILE"
        log_info "Log archived: ${LOG_FILE}.gz"
    fi
    
    log "✅ Cleanup completed"
}

run_parallel_workflow() {
    log "🚀 Running parallel contract testing workflow..."
    
    local pids=()
    local results=()
    
    # Run consumer tests and provider verification in parallel
    run_consumer_tests &
    pids+=($!)
    
    # Wait a bit before starting provider verification
    sleep 5
    run_provider_verification &
    pids+=($!)
    
    # Wait for both to complete
    for pid in "${pids[@]}"; do
        if wait "$pid"; then
            results+=(0)
        else
            results+=(1)
        fi
    done
    
    # Check if both succeeded
    local failures=0
    for result in "${results[@]}"; do
        failures=$((failures + result))
    done
    
    if [ $failures -eq 0 ]; then
        log "✅ Parallel workflow completed successfully"
        return 0
    else
        log_error "Parallel workflow had $failures failures"
        return 1
    fi
}

run_sequential_workflow() {
    log "🔄 Running sequential contract testing workflow..."
    
    run_consumer_tests || return 1
    run_provider_verification || return 1
    
    log "✅ Sequential workflow completed successfully"
}

main() {
    # Setup
    print_banner
    setup_logging
    
    # Set up trap for cleanup
    trap cleanup EXIT
    
    # Main workflow
    check_prerequisites || exit 1
    setup_test_environment || exit 1
    
    # Run core testing workflow
    if [ "$PARALLEL_EXECUTION" = "true" ]; then
        run_parallel_workflow || exit 1
    else
        run_sequential_workflow || exit 1
    fi
    
    # Post-testing activities
    publish_contracts || exit 1
    check_deployment_compatibility || exit 1
    run_contract_evolution_analysis
    run_integration_tests
    generate_reports
    
    log "🎉 Contract testing workflow completed successfully!"
    
    # Print summary
    echo
    log "📈 Workflow Summary:"
    log "   Environment: $ENVIRONMENT"
    log "   Branch: $GIT_BRANCH"
    log "   Commit: ${GIT_COMMIT:0:8}"
    log "   Build: $BUILD_NUMBER"
    log "   Duration: $(($(date +%s) - $(date -d "$(head -1 "$LOG_FILE" | cut -d']' -f1 | tr -d '[')" +%s))) seconds"
}

# Handle command line arguments
case "${1:-full}" in
    "consumer")
        setup_logging
        check_prerequisites
        setup_test_environment
        run_consumer_tests
        ;;
    "provider")
        setup_logging
        check_prerequisites
        setup_test_environment
        run_provider_verification
        ;;
    "publish")
        setup_logging
        publish_contracts
        ;;
    "deploy-check")
        setup_logging
        check_deployment_compatibility
        ;;
    "cleanup")
        setup_logging
        cleanup
        ;;
    "full"|*)
        main
        ;;
esac
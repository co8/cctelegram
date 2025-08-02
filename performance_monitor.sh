#!/bin/bash

# CC Telegram Bridge Performance Monitor Script
# Provides comprehensive monitoring, alerting, and optimization recommendations

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="cctelegram-bridge"
HEALTH_PORT="${HEALTH_PORT:-8080}"
METRICS_ENDPOINT="http://localhost:${HEALTH_PORT}/metrics"
HEALTH_ENDPOINT="http://localhost:${HEALTH_PORT}/health"
REPORT_ENDPOINT="http://localhost:${HEALTH_PORT}/report"
LOG_FILE="${SCRIPT_DIR}/performance_monitor.log"
ALERT_THRESHOLD_CPU=80
ALERT_THRESHOLD_MEMORY=100
ALERT_THRESHOLD_ERROR_RATE=5.0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Check if the application is running
check_app_running() {
    if pgrep -f "$APP_NAME" > /dev/null; then
        return 0
    else
        return 1
    fi
}

# Check if health endpoint is responding
check_health_endpoint() {
    if curl -s -f "$HEALTH_ENDPOINT" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Get health status
get_health_status() {
    local response
    if response=$(curl -s "$HEALTH_ENDPOINT" 2>/dev/null); then
        echo "$response" | jq -r '.status // "unknown"'
    else
        echo "unreachable"
    fi
}

# Get performance metrics
get_performance_metrics() {
    local response
    if response=$(curl -s "$REPORT_ENDPOINT" 2>/dev/null); then
        echo "$response"
    else
        echo "{\"error\": \"Failed to fetch performance report\"}"
    fi
}

# Get Prometheus metrics
get_prometheus_metrics() {
    local response
    if response=$(curl -s "$METRICS_ENDPOINT" 2>/dev/null); then
        echo "$response"
    else
        echo "# Failed to fetch Prometheus metrics"
    fi
}

# Extract metric value from Prometheus format
extract_prometheus_metric() {
    local metric_name="$1"
    local metrics="$2"
    echo "$metrics" | grep "^$metric_name " | tail -1 | awk '{print $2}'
}

# Display status with colors
display_status() {
    local status="$1"
    case "$status" in
        "healthy")
            echo -e "${GREEN}✓ HEALTHY${NC}"
            ;;
        "warning")
            echo -e "${YELLOW}⚠ WARNING${NC}"
            ;;
        "critical")
            echo -e "${RED}✗ CRITICAL${NC}"
            ;;
        "unreachable")
            echo -e "${RED}✗ UNREACHABLE${NC}"
            ;;
        *)
            echo -e "${BLUE}? UNKNOWN${NC}"
            ;;
    esac
}

# Monitor function
monitor() {
    echo "=== CC Telegram Bridge Performance Monitor ==="
    echo "Timestamp: $(date)"
    echo

    # Check if application is running
    if ! check_app_running; then
        echo -e "${RED}❌ Application is not running${NC}"
        log "ERROR: Application is not running"
        exit 1
    fi

    echo -e "${GREEN}✓ Application is running${NC}"

    # Check health endpoint
    if ! check_health_endpoint; then
        echo -e "${RED}❌ Health endpoint is not responding${NC}"
        log "ERROR: Health endpoint is not responding on port $HEALTH_PORT"
        exit 1
    fi

    echo -e "${GREEN}✓ Health endpoint is responding${NC}"
    echo

    # Get and display health status
    local health_status
    health_status=$(get_health_status)
    echo -n "Health Status: "
    display_status "$health_status"
    
    # Get performance report
    local performance_report
    performance_report=$(get_performance_metrics)
    
    if echo "$performance_report" | jq empty 2>/dev/null; then
        echo
        echo "=== System Metrics ==="
        
        local cpu_usage
        local memory_mb
        local uptime
        local events_processed
        local error_rate
        
        cpu_usage=$(echo "$performance_report" | jq -r '.system_metrics.cpu_usage_percent // 0')
        memory_mb=$(echo "$performance_report" | jq -r '.system_metrics.memory_usage_mb // 0')
        uptime=$(echo "$performance_report" | jq -r '.system_metrics.uptime_seconds // 0')
        events_processed=$(echo "$performance_report" | jq -r '.event_metrics.total_events_processed // 0')
        error_rate=$(echo "$performance_report" | jq -r '.event_metrics.error_rate_percent // 0')
        
        printf "CPU Usage:        %.1f%%\n" "$cpu_usage"
        printf "Memory Usage:     %s MB\n" "$memory_mb"
        printf "Uptime:           %s seconds\n" "$uptime"
        printf "Events Processed: %s\n" "$events_processed"
        printf "Error Rate:       %.1f%%\n" "$error_rate"
        
        # Check thresholds and display warnings
        echo
        echo "=== Alerts ==="
        
        local alerts=0
        
        if (( $(echo "$cpu_usage > $ALERT_THRESHOLD_CPU" | bc -l) )); then
            echo -e "${RED}⚠ HIGH CPU USAGE: ${cpu_usage}% (threshold: ${ALERT_THRESHOLD_CPU}%)${NC}"
            log "ALERT: High CPU usage: ${cpu_usage}%"
            alerts=$((alerts + 1))
        fi
        
        if (( $(echo "$memory_mb > $ALERT_THRESHOLD_MEMORY" | bc -l) )); then
            echo -e "${RED}⚠ HIGH MEMORY USAGE: ${memory_mb}MB (threshold: ${ALERT_THRESHOLD_MEMORY}MB)${NC}"
            log "ALERT: High memory usage: ${memory_mb}MB"
            alerts=$((alerts + 1))
        fi
        
        if (( $(echo "$error_rate > $ALERT_THRESHOLD_ERROR_RATE" | bc -l) )); then
            echo -e "${RED}⚠ HIGH ERROR RATE: ${error_rate}% (threshold: ${ALERT_THRESHOLD_ERROR_RATE}%)${NC}"
            log "ALERT: High error rate: ${error_rate}%"
            alerts=$((alerts + 1))
        fi
        
        if [ "$alerts" -eq 0 ]; then
            echo -e "${GREEN}✓ No alerts${NC}"
        fi
        
        # Display recommendations if any
        local recommendations
        recommendations=$(echo "$performance_report" | jq -r '.recommendations[]?' 2>/dev/null)
        if [ -n "$recommendations" ]; then
            echo
            echo "=== Recommendations ==="
            echo "$recommendations" | while IFS= read -r recommendation; do
                echo "• $recommendation"
            done
        fi
        
    else
        echo -e "${RED}❌ Failed to parse performance report${NC}"
        log "ERROR: Failed to parse performance report"
    fi
    
    echo
    echo "=== Prometheus Metrics Summary ==="
    
    local prometheus_metrics
    prometheus_metrics=$(get_prometheus_metrics)
    
    if [ "$prometheus_metrics" != "# Failed to fetch Prometheus metrics" ]; then
        local events_total
        local messages_total
        local memory_bytes
        
        events_total=$(extract_prometheus_metric "cc_telegram_events_processed_total" "$prometheus_metrics")
        messages_total=$(extract_prometheus_metric "cc_telegram_messages_sent_total" "$prometheus_metrics")
        memory_bytes=$(extract_prometheus_metric "cc_telegram_memory_usage_bytes" "$prometheus_metrics")
        
        echo "Events Processed Total: ${events_total:-0}"
        echo "Messages Sent Total:    ${messages_total:-0}"
        echo "Memory Usage (bytes):   ${memory_bytes:-0}"
    else
        echo -e "${RED}❌ Failed to fetch Prometheus metrics${NC}"
    fi
    
    echo
    log "Performance monitoring completed successfully"
}

# Continuous monitoring function
continuous_monitor() {
    local interval="${1:-30}"
    echo "Starting continuous monitoring (interval: ${interval}s)..."
    echo "Press Ctrl+C to stop"
    echo
    
    while true; do
        monitor
        echo "---"
        sleep "$interval"
    done
}

# Performance optimization suggestions
optimize() {
    echo "=== Performance Optimization Suggestions ==="
    echo
    
    # Check Rust build profile
    if [ -f "${SCRIPT_DIR}/Cargo.toml" ]; then
        echo "✓ Rust Optimization:"
        if cargo build --release > /dev/null 2>&1; then
            echo "  • Use 'cargo build --release' for production deployment"
            echo "  • Release build includes LTO and optimizations"
        fi
        echo
    fi
    
    # System-level optimizations
    echo "✓ System Optimizations:"
    echo "  • Consider increasing file descriptor limits for high-throughput scenarios"
    echo "  • Monitor disk I/O if processing many files"
    echo "  • Use SSD storage for better file watcher performance"
    echo "  • Consider running on dedicated server for production"
    echo
    
    # Configuration optimizations
    echo "✓ Configuration Optimizations:"
    echo "  • Adjust rate limiting based on your usage patterns"
    echo "  • Configure appropriate memory and CPU thresholds"
    echo "  • Enable detailed logging only when debugging"
    echo "  • Set metrics collection interval based on monitoring needs"
    echo
    
    # Network optimizations
    echo "✓ Network Optimizations:"
    echo "  • Use webhook instead of polling for Telegram API (if supported)"
    echo "  • Implement connection pooling for high-frequency requests"
    echo "  • Consider using a reverse proxy for health endpoints"
    echo
}

# Deployment health check
deployment_check() {
    echo "=== Deployment Health Check ==="
    echo
    
    local checks_passed=0
    local total_checks=0
    
    # Check 1: Application binary exists
    total_checks=$((total_checks + 1))
    if [ -f "${SCRIPT_DIR}/target/release/${APP_NAME}" ]; then
        echo -e "${GREEN}✓ Release binary exists${NC}"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}✗ Release binary not found${NC}"
        echo "  Run: cargo build --release"
    fi
    
    # Check 2: Configuration file
    total_checks=$((total_checks + 1))
    if [ -f "$HOME/.cc_telegram/config.toml" ] || [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
        echo -e "${GREEN}✓ Configuration available${NC}"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}✗ Configuration missing${NC}"
        echo "  Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USERS environment variables"
    fi
    
    # Check 3: Directory permissions
    total_checks=$((total_checks + 1))
    if [ -w "$HOME/.cc_telegram" ] || mkdir -p "$HOME/.cc_telegram" 2>/dev/null; then
        echo -e "${GREEN}✓ Directory permissions OK${NC}"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}✗ Cannot write to ~/.cc_telegram${NC}"
    fi
    
    # Check 4: Required tools
    total_checks=$((total_checks + 1))
    if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Required tools available (curl, jq)${NC}"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}✗ Missing required tools${NC}"
        echo "  Install: curl, jq"
    fi
    
    echo
    echo "Deployment readiness: $checks_passed/$total_checks checks passed"
    
    if [ "$checks_passed" -eq "$total_checks" ]; then
        echo -e "${GREEN}✓ Ready for deployment${NC}"
        return 0
    else
        echo -e "${RED}✗ Not ready for deployment${NC}"
        return 1
    fi
}

# Show usage
usage() {
    cat << EOF
CC Telegram Bridge Performance Monitor

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    monitor           Run one-time performance check (default)
    continuous [N]    Run continuous monitoring (every N seconds, default: 30)
    optimize          Show performance optimization suggestions
    deployment-check  Check deployment readiness
    help             Show this help message

Environment Variables:
    HEALTH_PORT      Health check server port (default: 8080)

Examples:
    $0                           # Run one-time performance check
    $0 continuous 60             # Monitor every 60 seconds
    $0 optimize                  # Show optimization suggestions
    $0 deployment-check          # Check deployment readiness

EOF
}

# Main script logic
main() {
    case "${1:-monitor}" in
        "monitor")
            monitor
            ;;
        "continuous")
            continuous_monitor "${2:-30}"
            ;;
        "optimize")
            optimize
            ;;
        "deployment-check")
            deployment_check
            ;;
        "help"|"--help"|"-h")
            usage
            ;;
        *)
            echo "Unknown command: $1"
            echo
            usage
            exit 1
            ;;
    esac
}

# Install required dependencies if missing
install_dependencies() {
    local missing_deps=()
    
    if ! command -v curl >/dev/null 2>&1; then
        missing_deps+=("curl")
    fi
    
    if ! command -v jq >/dev/null 2>&1; then
        missing_deps+=("jq")
    fi
    
    if ! command -v bc >/dev/null 2>&1; then
        missing_deps+=("bc")
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo -e "${YELLOW}⚠ Missing dependencies: ${missing_deps[*]}${NC}"
        echo "Please install them using your package manager:"
        echo "  macOS: brew install ${missing_deps[*]}"
        echo "  Ubuntu/Debian: sudo apt-get install ${missing_deps[*]}"
        echo "  CentOS/RHEL: sudo yum install ${missing_deps[*]}"
        exit 1
    fi
}

# Check dependencies before running
install_dependencies

# Run main function
main "$@"
#!/bin/bash
# CCTelegram 3-Tier System Troubleshooting Script
# Usage: ./troubleshoot.sh [--error-code <CODE>] [--tier <T1|T2|T3>] [--emergency] [--health-check]

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/cctelegram-troubleshoot-$(date +%s).log"
API_KEY="${API_KEY:-}"
MCP_ENDPOINT="${MCP_ENDPOINT:-http://localhost:8080}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging
log() {
    echo -e "$(date +'%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_FILE"
}

error() {
    log "${RED}❌ ERROR: $1${NC}"
}

warn() {
    log "${YELLOW}⚠️  WARNING: $1${NC}"
}

info() {
    log "${BLUE}ℹ️  INFO: $1${NC}"
}

success() {
    log "${GREEN}✅ SUCCESS: $1${NC}"
}

# Help function
show_help() {
    cat << EOF
CCTelegram 3-Tier System Troubleshooting Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --error-code <CODE>     Look up specific error code and apply solution
    --tier <T1|T2|T3>      Diagnose specific tier issues  
    --emergency            Execute emergency recovery procedures
    --health-check         Perform comprehensive health check
    --performance          Analyze performance issues
    --security            Investigate security issues
    --logs                 Analyze recent logs for patterns
    --help                 Show this help message

ERROR CODES:
    T1-TIMEOUT            Tier 1 MCP Webhook timeout (>100ms)
    T2-TIMEOUT            Tier 2 Bridge timeout (>500ms)  
    T3-TIMEOUT            Tier 3 File Watcher timeout (>5s)
    ALL-TIERS-DOWN        Complete system failure
    CIRCUIT-BREAKER-OPEN  Circuit breaker tripped
    MEMORY-LEAK           Memory exhaustion detected
    DISK-FULL            Disk space exhaustion
    
EXAMPLES:
    $0 --health-check                    # Quick system health check
    $0 --error-code T1-TIMEOUT          # Resolve T1 timeout issue
    $0 --tier T2                        # Diagnose T2 specific issues
    $0 --emergency                      # Emergency recovery
    $0 --performance                    # Performance analysis
    
ENVIRONMENT VARIABLES:
    API_KEY              CCTelegram API key for health checks
    MCP_ENDPOINT         MCP server endpoint (default: http://localhost:8080)
    
LOG FILE: $LOG_FILE
EOF
}

# Check prerequisites
check_prerequisites() {
    local missing_deps=()
    
    # Check required commands
    for cmd in curl jq systemctl; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        error "Missing required dependencies: ${missing_deps[*]}"
        exit 1
    fi
    
    # Check API key
    if [ -z "$API_KEY" ]; then
        warn "API_KEY not set. Some checks may fail."
    fi
}

# Health check functions
health_check() {
    info "Starting comprehensive health check..."
    
    # Service status
    info "Checking service status..."
    local services_ok=true
    for service in cctelegram-mcp cctelegram-bridge nginx; do
        if systemctl is-active "$service" >/dev/null 2>&1; then
            success "$service: RUNNING"
        else
            error "$service: STOPPED"
            services_ok=false
        fi
    done
    
    # Endpoint health
    info "Checking endpoint health..."
    if [ -n "$API_KEY" ]; then
        if curl -s -H "X-API-Key: $API_KEY" "$MCP_ENDPOINT/health" >/dev/null 2>&1; then
            success "MCP endpoint: HEALTHY"
        else
            error "MCP endpoint: UNHEALTHY"
        fi
    else
        warn "Skipping endpoint check (no API key)"
    fi
    
    # Resource usage
    info "Checking resource usage..."
    local mem_usage
    mem_usage=$(free | grep Mem | awk '{printf "%.0f", ($3/$2) * 100.0}')
    local disk_usage
    disk_usage=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
    local load_avg
    load_avg=$(cat /proc/loadavg | awk '{print $1}')
    
    echo "📊 Resource Status:"
    if [ "$mem_usage" -lt 80 ]; then
        success "Memory: ${mem_usage}%"
    else
        warn "Memory: ${mem_usage}% (high)"
    fi
    
    if [ "$disk_usage" -lt 80 ]; then
        success "Disk: ${disk_usage}%"
    else
        warn "Disk: ${disk_usage}% (high)"
    fi
    
    if [ "$(echo "$load_avg < 2.0" | bc 2>/dev/null || echo 0)" -eq 1 ]; then
        success "Load: $load_avg"
    else
        warn "Load: $load_avg (high)"
    fi
    
    # Tier health
    if [ -n "$API_KEY" ]; then
        info "Checking tier health..."
        local tier_health
        tier_health=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
            "$MCP_ENDPOINT/tools/get_bridge_status" 2>/dev/null | \
            jq -r '.tier_health[]? | "\(.tier_type): \(.is_healthy)"' 2>/dev/null)
        
        if [ -n "$tier_health" ]; then
            echo "🎯 Tier Health:"
            echo "$tier_health" | while read -r line; do
                if [[ $line == *"true"* ]]; then
                    success "$line"
                else
                    error "$line"
                fi
            done
        else
            warn "Unable to retrieve tier health data"
        fi
    fi
}

# Error code resolution
resolve_error_code() {
    local error_code="$1"
    info "Resolving error code: $error_code"
    
    case "$error_code" in
        "T1-TIMEOUT")
            info "T1 MCP Webhook timeout resolution..."
            systemctl restart cctelegram-mcp
            sleep 15
            if curl -w "%{time_total}" -H "X-API-Key: $API_KEY" \
               "$MCP_ENDPOINT/health" -o /dev/null -s | \
               awk '{if($1 < 0.1) exit 0; else exit 1}'; then
                success "T1 timeout resolved (response < 100ms)"
            else
                error "T1 timeout persists - escalate to L2"
            fi
            ;;
            
        "T2-TIMEOUT")
            info "T2 Bridge timeout resolution..."
            curl -H "X-API-Key: $API_KEY" -X POST \
                "$MCP_ENDPOINT/tools/restart_bridge" >/dev/null 2>&1
            sleep 20
            success "T2 bridge restarted - monitor response times"
            ;;
            
        "T3-TIMEOUT")
            info "T3 File Watcher timeout resolution..."
            # Clean old files first
            find /var/lib/cctelegram -name "*.processed" -mtime +1 -delete 2>/dev/null || true
            find /var/lib/cctelegram -name "*.tmp" -mmin +60 -delete 2>/dev/null || true
            systemctl restart cctelegram-mcp
            sleep 30
            success "T3 file watcher cleaned and restarted"
            ;;
            
        "ALL-TIERS-DOWN")
            warn "Executing emergency recovery for complete system failure..."
            emergency_recovery
            ;;
            
        "CIRCUIT-BREAKER-OPEN")
            info "Circuit breaker recovery..."
            curl -H "X-API-Key: $API_KEY" -X POST \
                "$MCP_ENDPOINT/tools/restart_bridge" >/dev/null 2>&1
            sleep 30
            success "Circuit breaker reset attempted"
            ;;
            
        "MEMORY-LEAK")
            info "Memory leak recovery..."
            systemctl restart cctelegram-mcp cctelegram-bridge
            sleep 20
            success "Services restarted to clear memory"
            ;;
            
        "DISK-FULL")
            info "Disk space recovery..."
            # Emergency cleanup
            rm -rf /tmp/cctelegram-* /var/tmp/cctelegram-* 2>/dev/null || true
            find /var/log/cctelegram -name "*.log.*" -mtime +1 -delete 2>/dev/null || true
            find /var/lib/cctelegram -name "*.processed" -mtime +1 -delete 2>/dev/null || true
            success "Emergency disk cleanup completed"
            ;;
            
        *)
            error "Unknown error code: $error_code"
            info "Available error codes: T1-TIMEOUT, T2-TIMEOUT, T3-TIMEOUT, ALL-TIERS-DOWN, CIRCUIT-BREAKER-OPEN, MEMORY-LEAK, DISK-FULL"
            return 1
            ;;
    esac
}

# Tier-specific diagnosis
diagnose_tier() {
    local tier="$1"
    info "Diagnosing Tier $tier..."
    
    case "$tier" in
        "T1")
            info "T1 (MCP Webhook) Diagnosis..."
            local response_time
            response_time=$(curl -w "%{time_total}" -H "X-API-Key: $API_KEY" \
                "$MCP_ENDPOINT/health" -o /dev/null -s 2>/dev/null || echo "999")
            
            if [ "$(echo "$response_time < 0.1" | bc 2>/dev/null || echo 0)" -eq 1 ]; then
                success "T1 response time: ${response_time}s (within 100ms SLA)"
            else
                warn "T1 response time: ${response_time}s (exceeds 100ms SLA)"
                info "Recommended action: systemctl restart cctelegram-mcp"
            fi
            
            # Check port availability
            if nc -z localhost 8080 2>/dev/null; then
                success "Port 8080: OPEN"
            else
                error "Port 8080: CLOSED"
            fi
            ;;
            
        "T2")
            info "T2 (Bridge Internal) Diagnosis..."
            if [ -n "$API_KEY" ]; then
                local bridge_status
                bridge_status=$(curl -s -H "X-API-Key: $API_KEY" -X POST \
                    "$MCP_ENDPOINT/tools/get_bridge_status" 2>/dev/null | \
                    jq -r '.bridge_status // "unknown"' 2>/dev/null)
                
                if [ "$bridge_status" = "healthy" ]; then
                    success "T2 bridge status: $bridge_status"
                else
                    warn "T2 bridge status: $bridge_status"
                fi
            fi
            
            # Check process memory
            local mem_usage_mb
            mem_usage_mb=$(ps aux | grep -E "(node|cctelegram)" | grep -v grep | \
                awk '{sum+=$4} END {printf "%.0f", sum*1024/100}' 2>/dev/null || echo "0")
            if [ "$mem_usage_mb" -lt 500 ]; then
                success "T2 memory usage: ${mem_usage_mb}MB"
            else
                warn "T2 memory usage: ${mem_usage_mb}MB (high)"
            fi
            ;;
            
        "T3")
            info "T3 (File Watcher) Diagnosis..."
            # Check disk space
            local disk_free_gb
            disk_free_gb=$(df /var/lib/cctelegram 2>/dev/null | tail -1 | \
                awk '{printf "%.1f", $4/1024/1024}' || echo "0")
            if [ "$(echo "$disk_free_gb > 1.0" | bc 2>/dev/null || echo 0)" -eq 1 ]; then
                success "T3 disk space: ${disk_free_gb}GB free"
            else
                warn "T3 disk space: ${disk_free_gb}GB free (low)"
            fi
            
            # Check inotify usage
            local inotify_count
            inotify_count=$(find /proc/*/fd -lname anon_inode:inotify 2>/dev/null | wc -l)
            local inotify_max
            inotify_max=$(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo "8192")
            local inotify_percent
            inotify_percent=$(echo "scale=0; $inotify_count * 100 / $inotify_max" | bc 2>/dev/null || echo "0")
            
            if [ "$inotify_percent" -lt 80 ]; then
                success "T3 inotify usage: ${inotify_percent}%"
            else
                warn "T3 inotify usage: ${inotify_percent}% (high)"
            fi
            ;;
            
        *)
            error "Unknown tier: $tier"
            info "Available tiers: T1, T2, T3"
            return 1
            ;;
    esac
}

# Emergency recovery
emergency_recovery() {
    warn "🚨 EXECUTING EMERGENCY RECOVERY"
    
    info "Step 1: Stopping services..."
    systemctl stop cctelegram-mcp cctelegram-bridge nginx 2>/dev/null || true
    sleep 5
    
    info "Step 2: Clearing temporary files..."
    rm -rf /tmp/cctelegram-* /var/run/cctelegram-* /var/lib/cctelegram/*.lock 2>/dev/null || true
    
    info "Step 3: Starting services in order..."
    systemctl start nginx && sleep 3
    systemctl start cctelegram-bridge && sleep 5
    systemctl start cctelegram-mcp && sleep 10
    
    info "Step 4: Verifying recovery..."
    for i in {1..12}; do
        if [ -n "$API_KEY" ] && curl -s -H "X-API-Key: $API_KEY" "$MCP_ENDPOINT/health" >/dev/null 2>&1; then
            success "EMERGENCY RECOVERY SUCCESSFUL after $((i*5)) seconds"
            return 0
        fi
        sleep 5
    done
    
    error "EMERGENCY RECOVERY FAILED - Escalate to L2 Engineering"
    return 1
}

# Performance analysis
performance_analysis() {
    info "Analyzing system performance..."
    
    # Response time analysis
    info "Testing response times..."
    local times=()
    for i in {1..10}; do
        local time
        time=$(curl -w "%{time_total}" -H "X-API-Key: $API_KEY" \
            "$MCP_ENDPOINT/health" -o /dev/null -s 2>/dev/null || echo "999")
        times+=("$time")
        echo "Response $i: ${time}s"
    done
    
    # Calculate average
    local avg_time
    avg_time=$(printf '%s\n' "${times[@]}" | awk '{sum+=$1; count++} END {printf "%.3f", sum/count}')
    
    if [ "$(echo "$avg_time < 0.5" | bc 2>/dev/null || echo 0)" -eq 1 ]; then
        success "Average response time: ${avg_time}s (good)"
    elif [ "$(echo "$avg_time < 1.0" | bc 2>/dev/null || echo 0)" -eq 1 ]; then
        warn "Average response time: ${avg_time}s (acceptable)"
    else
        error "Average response time: ${avg_time}s (poor)"
    fi
    
    # Resource analysis
    info "Resource utilization analysis..."
    echo "CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')"
    echo "Memory: $(free | grep Mem | awk '{printf "%.1f%%", ($3/$2) * 100.0}')"
    echo "Load: $(cat /proc/loadavg | awk '{print $1}')"
    echo "Processes: $(ps aux | grep cctelegram | grep -v grep | wc -l)"
}

# Log analysis
log_analysis() {
    info "Analyzing recent logs for patterns..."
    
    if [ ! -f "/var/log/cctelegram/application.log" ]; then
        warn "Application log not found at /var/log/cctelegram/application.log"
        return 1
    fi
    
    # Recent errors
    info "Recent errors (last 10):"
    grep -E "(ERROR|CRITICAL|FATAL)" /var/log/cctelegram/application.log | tail -10 | \
        awk '{print $1, $2, $NF}' || info "No recent errors found"
    
    # Error patterns
    info "Error patterns in last hour:"
    local hour_ago
    hour_ago=$(date -d '1 hour ago' '+%Y-%m-%d %H')
    grep "$hour_ago" /var/log/cctelegram/application.log 2>/dev/null | \
        grep -E "(ERROR|CRITICAL)" | \
        awk '{print $6}' | sort | uniq -c | sort -nr | head -5 || info "No error patterns found"
    
    # Performance patterns
    info "Response time analysis from logs:"
    grep "response_time_ms" /var/log/cctelegram/application.log | tail -50 | \
        grep -o "response_time_ms=[0-9]*" | cut -d= -f2 | \
        awk '{sum+=$1; count++; if($1>max) max=$1} END {
            if(count>0) printf "Count: %d, Avg: %.0fms, Max: %dms\n", count, sum/count, max
        }' || info "No response time data found"
}

# Security analysis
security_analysis() {
    info "Analyzing security events..."
    
    if [ ! -f "/var/log/cctelegram/security.log" ]; then
        warn "Security log not found at /var/log/cctelegram/security.log"
        return 1
    fi
    
    # Authentication failures
    info "Recent authentication failures:"
    grep "AUTHENTICATION_FAILED" /var/log/cctelegram/security.log | tail -5 | \
        jq -r '"\(.timestamp) \(.context.client_ip // "unknown") \(.context.reason // "unknown")"' 2>/dev/null || \
        info "No authentication failures found"
    
    # Rate limiting events  
    info "Rate limiting events:"
    grep "RATE_LIMIT_EXCEEDED" /var/log/cctelegram/security.log | tail -5 | \
        jq -r '"\(.timestamp) \(.context.client_ip // "unknown")"' 2>/dev/null || \
        info "No rate limiting events found"
    
    # Security violations
    local security_violations
    security_violations=$(grep "SECURITY" /var/log/cctelegram/security.log | tail -10 | wc -l)
    if [ "$security_violations" -gt 0 ]; then
        warn "Found $security_violations security events in recent logs"
    else
        success "No recent security violations detected"
    fi
}

# Main function
main() {
    local error_code=""
    local tier=""
    local emergency=false
    local health_check_only=false
    local performance_only=false
    local security_only=false
    local logs_only=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --error-code)
                error_code="$2"
                shift 2
                ;;
            --tier)
                tier="$2"
                shift 2
                ;;
            --emergency)
                emergency=true
                shift
                ;;
            --health-check)
                health_check_only=true
                shift
                ;;
            --performance)
                performance_only=true
                shift
                ;;
            --security)
                security_only=true
                shift
                ;;
            --logs)
                logs_only=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Check prerequisites
    check_prerequisites
    
    info "CCTelegram 3-Tier System Troubleshooting"
    info "Log file: $LOG_FILE"
    echo
    
    # Execute based on options
    if [ "$emergency" = true ]; then
        emergency_recovery
    elif [ -n "$error_code" ]; then
        resolve_error_code "$error_code"
    elif [ -n "$tier" ]; then
        diagnose_tier "$tier"
    elif [ "$health_check_only" = true ]; then
        health_check
    elif [ "$performance_only" = true ]; then
        performance_analysis
    elif [ "$security_only" = true ]; then
        security_analysis
    elif [ "$logs_only" = true ]; then
        log_analysis
    else
        # Default: comprehensive health check
        health_check
    fi
    
    echo
    success "Troubleshooting completed. Log file: $LOG_FILE"
}

# Execute main function
main "$@"
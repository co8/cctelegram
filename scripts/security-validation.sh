#!/bin/bash
# Security validation script for CCTelegram
# File: scripts/security-validation.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date -u +"%Y-%m-%d_%H-%M-%S")
REPORT_DIR="$PROJECT_ROOT/security-reports"
REPORT_FILE="$REPORT_DIR/security-validation-$TIMESTAMP.json"

# Ensure report directory exists
mkdir -p "$REPORT_DIR"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Initialize report
init_report() {
    cat > "$REPORT_FILE" << EOF
{
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "version": "1.0",
    "project": "CCTelegram",
    "validation_results": {
        "overall_status": "pending",
        "checks": {}
    }
}
EOF
}

# Update report with check result
update_report() {
    local check_name="$1"
    local status="$2"
    local details="$3"
    local score="${4:-0}"
    
    jq --arg name "$check_name" --arg status "$status" --arg details "$details" --argjson score "$score" \
       '.validation_results.checks[$name] = {"status": $status, "details": $details, "score": $score}' \
       "$REPORT_FILE" > "$REPORT_FILE.tmp" && mv "$REPORT_FILE.tmp" "$REPORT_FILE"
}

# Finalize report
finalize_report() {
    local overall_status="$1"
    local total_score="$2"
    
    jq --arg status "$overall_status" --argjson score "$total_score" \
       '.validation_results.overall_status = $status | .validation_results.total_score = $score' \
       "$REPORT_FILE" > "$REPORT_FILE.tmp" && mv "$REPORT_FILE.tmp" "$REPORT_FILE"
}

# Check 1: Dependency vulnerability scanning
check_dependencies() {
    log_info "🔍 Checking dependencies for vulnerabilities..."
    
    local rust_score=0
    local node_score=0
    local details=""
    
    # Check Rust dependencies
    cd "$PROJECT_ROOT"
    if command -v cargo-audit >/dev/null 2>&1; then
        if cargo audit --json > cargo-audit-report.json 2>&1; then
            local rust_vulns
            rust_vulns=$(jq '.vulnerabilities.list | length' cargo-audit-report.json 2>/dev/null || echo "0")
            if [ "$rust_vulns" -eq 0 ]; then
                rust_score=10
                log_success "Rust dependencies: No vulnerabilities found"
            else
                rust_score=0
                log_error "Rust dependencies: $rust_vulns vulnerabilities found"
            fi
            details="Rust vulnerabilities: $rust_vulns"
        else
            log_warning "Could not run cargo audit"
            details="Rust audit failed"
        fi
    else
        log_warning "cargo-audit not installed"
        details="cargo-audit not available"
    fi
    
    # Check Node.js dependencies
    cd "$PROJECT_ROOT/mcp-server"
    if npm audit --json > npm-audit-report.json 2>&1; then
        local npm_high
        local npm_critical
        npm_critical=$(jq -r '.metadata.vulnerabilities.critical // 0' npm-audit-report.json)
        npm_high=$(jq -r '.metadata.vulnerabilities.high // 0' npm-audit-report.json)
        
        if [ "$npm_critical" -eq 0 ] && [ "$npm_high" -eq 0 ]; then
            node_score=10
            log_success "Node.js dependencies: No high/critical vulnerabilities"
        elif [ "$npm_critical" -eq 0 ]; then
            node_score=5
            log_warning "Node.js dependencies: $npm_high high vulnerabilities"
        else
            node_score=0
            log_error "Node.js dependencies: $npm_critical critical, $npm_high high vulnerabilities"
        fi
        details="$details; Node.js critical: $npm_critical, high: $npm_high"
    else
        log_warning "Could not run npm audit"
        details="$details; Node.js audit failed"
    fi
    
    local avg_score=$(( (rust_score + node_score) / 2 ))
    update_report "dependency_vulnerabilities" "completed" "$details" "$avg_score"
    echo "$avg_score"
}

# Check 2: License compliance
check_licenses() {
    log_info "📄 Checking license compliance..."
    
    local score=10
    local details=""
    local problematic_licenses=("GPL-2.0" "GPL-3.0" "AGPL-1.0" "AGPL-3.0" "CPAL-1.0" "OSL-3.0")
    
    cd "$PROJECT_ROOT/mcp-server"
    
    # Generate license report
    if npx license-checker --json --out license-report.json 2>/dev/null; then
        local found_problematic=""
        
        for license in "${problematic_licenses[@]}"; do
            if jq -r 'to_entries[] | select(.value.licenses | type == "string" and contains("'"$license"'")) | .key' license-report.json 2>/dev/null | grep -q .; then
                found_problematic="$found_problematic $license"
                score=5
            fi
        done
        
        if [ -n "$found_problematic" ]; then
            log_warning "Found potentially problematic licenses:$found_problematic"
            details="Problematic licenses found:$found_problematic"
        else
            log_success "All licenses are compatible"
            details="All licenses compatible"
        fi
    else
        log_warning "Could not generate license report"
        details="License check failed"
        score=5
    fi
    
    update_report "license_compliance" "completed" "$details" "$score"
    echo "$score"
}

# Check 3: Secret scanning
check_secrets() {
    log_info "🔐 Scanning for exposed secrets..."
    
    local score=10
    local details=""
    
    cd "$PROJECT_ROOT"
    
    # Basic secret patterns
    local secret_patterns=(
        "password\s*=\s*['\"][^'\"]{8,}"
        "api[_-]?key\s*=\s*['\"][^'\"]{16,}"
        "secret[_-]?key\s*=\s*['\"][^'\"]{16,}"
        "token\s*=\s*['\"][^'\"]{16,}"
        "-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----"
    )
    
    local secrets_found=0
    
    for pattern in "${secret_patterns[@]}"; do
        if grep -r -i -E "$pattern" src/ mcp-server/src/ --exclude-dir=node_modules --exclude-dir=target 2>/dev/null | grep -v "process.env" | head -5; then
            secrets_found=$((secrets_found + 1))
        fi
    done
    
    if [ "$secrets_found" -eq 0 ]; then
        log_success "No hardcoded secrets found"
        details="No secrets detected"
    else
        log_error "Found $secrets_found potential secrets"
        details="$secrets_found potential secrets found"
        score=0
    fi
    
    update_report "secret_scanning" "completed" "$details" "$score"
    echo "$score"
}

# Check 4: Build integrity
check_build_integrity() {
    log_info "🏗️ Checking build integrity..."
    
    local score=0
    local details=""
    
    cd "$PROJECT_ROOT"
    
    # Check for reproducible build configurations
    if grep -q "lto = true" Cargo.toml && grep -q "codegen-units = 1" Cargo.toml; then
        score=$((score + 3))
        details="Rust reproducible build config ✓"
    fi
    
    # Check for package-lock.json integrity
    if [ -f "mcp-server/package-lock.json" ]; then
        cd mcp-server
        if npm ci --dry-run >/dev/null 2>&1; then
            score=$((score + 3))
            details="$details; Node.js package-lock integrity ✓"
        else
            details="$details; Node.js package-lock integrity ✗"
        fi
        cd ..
    fi
    
    # Check for SLSA workflow
    if [ -f ".github/workflows/slsa-provenance.yml" ]; then
        score=$((score + 4))
        details="$details; SLSA provenance workflow ✓"
    fi
    
    log_info "Build integrity score: $score/10"
    update_report "build_integrity" "completed" "$details" "$score"
    echo "$score"
}

# Check 5: Container security
check_container_security() {
    log_info "🐳 Checking container security..."
    
    local score=8  # Start with good base score
    local details="Container security assessment"
    
    cd "$PROJECT_ROOT/mcp-server"
    
    # Check if Dockerfile exists and analyze it
    if [ -f "Dockerfile" ]; then
        # Check for non-root user
        if grep -q "USER" Dockerfile; then
            log_success "Dockerfile uses non-root user"
            details="$details; Non-root user ✓"
        else
            score=$((score - 2))
            log_warning "Dockerfile should specify non-root user"
            details="$details; Non-root user ✗"
        fi
        
        # Check for minimal base image
        if grep -q "alpine\|distroless" Dockerfile; then
            log_success "Using minimal base image"
            details="$details; Minimal base ✓"
        else
            score=$((score - 1))
            details="$details; Could use more minimal base"
        fi
        
        # Check for health checks
        if grep -q "HEALTHCHECK" Dockerfile; then
            log_success "Health check configured"
            details="$details; Health check ✓"
        else
            score=$((score - 1))
            log_warning "Consider adding health check"
            details="$details; Health check missing"
        fi
    else
        log_info "No Dockerfile found - using base score"
        details="No Dockerfile found"
    fi
    
    update_report "container_security" "completed" "$details" "$score"
    echo "$score"
}

# Check 6: Security headers
check_security_headers() {
    log_info "🔒 Checking security headers configuration..."
    
    local score=0
    local details=""
    
    cd "$PROJECT_ROOT/mcp-server"
    
    # Check for security headers in the code
    local security_headers=(
        "X-Frame-Options"
        "X-Content-Type-Options"
        "Strict-Transport-Security"
        "X-XSS-Protection"
        "Content-Security-Policy"
    )
    
    local headers_found=0
    for header in "${security_headers[@]}"; do
        if grep -r -i "$header" src/ 2>/dev/null | head -1 >/dev/null; then
            headers_found=$((headers_found + 1))
        fi
    done
    
    score=$((headers_found * 2))  # 2 points per header, max 10
    if [ "$score" -gt 10 ]; then score=10; fi
    
    log_info "Security headers: $headers_found/5 found"
    details="$headers_found/5 security headers implemented"
    
    update_report "security_headers" "completed" "$details" "$score"
    echo "$score"
}

# Check 7: Access controls
check_access_controls() {
    log_info "🔐 Checking access controls..."
    
    local score=0
    local details=""
    
    cd "$PROJECT_ROOT"
    
    # Check for authentication implementations
    if grep -r -i "authenticate\|auth" src/ mcp-server/src/ --include="*.rs" --include="*.ts" | head -1 >/dev/null; then
        score=$((score + 4))
        details="Authentication implementation found"
    fi
    
    # Check for authorization
    if grep -r -i "authorize\|permission\|role" src/ mcp-server/src/ --include="*.rs" --include="*.ts" | head -1 >/dev/null; then
        score=$((score + 3))
        details="$details; Authorization implementation found"
    fi
    
    # Check for rate limiting
    if grep -r -i "rate.limit\|throttle" src/ mcp-server/src/ --include="*.rs" --include="*.ts" | head -1 >/dev/null; then
        score=$((score + 3))
        details="$details; Rate limiting found"
    fi
    
    log_info "Access controls score: $score/10"
    update_report "access_controls" "completed" "$details" "$score"
    echo "$score"
}

# Main validation function
main() {
    log_info "🛡️ Starting CCTelegram Security Validation"
    log_info "Timestamp: $(date -u)"
    log_info "Report will be saved to: $REPORT_FILE"
    
    init_report
    
    # Run all security checks
    local total_score=0
    local max_score=70  # 7 checks * 10 points each
    
    log_info "\n=== DEPENDENCY SECURITY ==="
    dep_score=$(check_dependencies)
    total_score=$((total_score + dep_score))
    
    log_info "\n=== LICENSE COMPLIANCE ==="
    license_score=$(check_licenses)
    total_score=$((total_score + license_score))
    
    log_info "\n=== SECRET SCANNING ==="
    secret_score=$(check_secrets)
    total_score=$((total_score + secret_score))
    
    log_info "\n=== BUILD INTEGRITY ==="
    build_score=$(check_build_integrity)
    total_score=$((total_score + build_score))
    
    log_info "\n=== CONTAINER SECURITY ==="
    container_score=$(check_container_security)
    total_score=$((total_score + container_score))
    
    log_info "\n=== SECURITY HEADERS ==="
    headers_score=$(check_security_headers)
    total_score=$((total_score + headers_score))
    
    log_info "\n=== ACCESS CONTROLS ==="
    access_score=$(check_access_controls)
    total_score=$((total_score + access_score))
    
    # Calculate percentage
    local percentage=$((total_score * 100 / max_score))
    
    # Determine overall status
    local overall_status
    if [ "$percentage" -ge 90 ]; then
        overall_status="excellent"
        log_success "🏆 Security validation: EXCELLENT ($percentage%)"
    elif [ "$percentage" -ge 80 ]; then
        overall_status="good"
        log_success "✅ Security validation: GOOD ($percentage%)"
    elif [ "$percentage" -ge 70 ]; then
        overall_status="fair"
        log_warning "⚠️ Security validation: FAIR ($percentage%)"
    elif [ "$percentage" -ge 60 ]; then
        overall_status="poor"
        log_warning "⚠️ Security validation: POOR ($percentage%)"
    else
        overall_status="critical"
        log_error "❌ Security validation: CRITICAL ($percentage%)"
    fi
    
    finalize_report "$overall_status" "$total_score"
    
    log_info "\n=== SECURITY VALIDATION SUMMARY ==="
    log_info "Dependencies: $dep_score/10"
    log_info "Licenses: $license_score/10"
    log_info "Secrets: $secret_score/10"
    log_info "Build Integrity: $build_score/10"
    log_info "Container Security: $container_score/10"
    log_info "Security Headers: $headers_score/10"
    log_info "Access Controls: $access_score/10"
    log_info "TOTAL: $total_score/$max_score ($percentage%)"
    log_info "STATUS: $overall_status"
    
    log_info "\n📊 Full report available at: $REPORT_FILE"
    
    # Exit with appropriate code
    if [ "$percentage" -ge 70 ]; then
        exit 0
    else
        exit 1
    fi
}

# Run main function
main "$@"
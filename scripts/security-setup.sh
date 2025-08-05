#!/bin/bash

# Security Setup Script for CCTelegram
# This script sets up automated vulnerability scanning tools and configurations

set -e

echo "🛡️ Setting up automated vulnerability scanning for CCTelegram..."

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

# Check if running from project root
if [ ! -f "package.json" ] && [ ! -f "mcp-server/package.json" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

# Set working directory
if [ -f "mcp-server/package.json" ]; then
    WORK_DIR="mcp-server"
else
    WORK_DIR="."
fi

print_status "Working directory: $WORK_DIR"

# Install global security tools
print_status "Installing global security tools..."

# Check if npm is available
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install Node.js and npm first."
    exit 1
fi

# Install Snyk CLI
if ! command -v snyk &> /dev/null; then
    print_status "Installing Snyk CLI..."
    npm install -g snyk
    print_success "Snyk CLI installed"
else
    print_success "Snyk CLI already installed"
fi

# Install license checker
if ! command -v license-checker &> /dev/null; then
    print_status "Installing license-checker..."
    npm install -g license-checker
    print_success "license-checker installed"
else
    print_success "license-checker already installed"
fi

# Install additional security tools
print_status "Installing additional security tools..."
npm install -g audit-ci retire njsscan semgrep

# Navigate to working directory
cd "$WORK_DIR"

# Install project dependencies
print_status "Installing project dependencies..."
npm install

# Add development dependencies for security
print_status "Adding security development dependencies..."
npm install --save-dev \
    @types/node \
    audit-ci \
    license-compatibility-checker \
    security-checker \
    sri-toolbox

# Create security directory structure
print_status "Creating security directory structure..."
mkdir -p security/{reports,configs,policies}
mkdir -p .github/security-policies

# Create security policy template
print_status "Creating security policy template..."
cat > security/policies/security-policy.md << 'EOF'
# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.6.x   | :white_check_mark: |
| 1.5.x   | :white_check_mark: |
| < 1.5   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities via:
- Email: security@example.com
- GitHub Security Advisories
- Private issue reporting

## Security Response Timeline

- **Critical**: 24 hours
- **High**: 72 hours
- **Medium**: 1 week
- **Low**: 2 weeks

## Security Measures

- Dependency vulnerability scanning with Snyk
- Automated security updates via Dependabot
- Static code analysis with Semgrep and CodeQL
- Container security scanning with Trivy
- License compliance monitoring
- Subresource integrity validation
EOF

# Create audit configuration
print_status "Creating npm audit configuration..."
cat > .npmrc << 'EOF'
# NPM Security Configuration
audit-level=moderate
fund=false
package-lock-only=true
save-exact=true
EOF

# Create pre-commit hook template
print_status "Creating pre-commit security hooks..."
mkdir -p .git/hooks 2>/dev/null || true
cat > security/configs/pre-commit-security.sh << 'EOF'
#!/bin/bash
# Pre-commit security checks

echo "🔍 Running pre-commit security checks..."

# Run npm audit
if npm audit --audit-level=moderate; then
    echo "✅ npm audit passed"
else
    echo "❌ npm audit found vulnerabilities"
    exit 1
fi

# Run Snyk test if available
if command -v snyk &> /dev/null; then
    if snyk test --severity-threshold=high; then
        echo "✅ Snyk test passed"
    else
        echo "❌ Snyk found high severity vulnerabilities"
        exit 1
    fi
fi

echo "✅ Pre-commit security checks completed"
EOF

chmod +x security/configs/pre-commit-security.sh

# Create security monitoring script
print_status "Creating security monitoring script..."
cat > security/security-monitor.sh << 'EOF'
#!/bin/bash
# Daily security monitoring script

set -e

echo "🛡️ Running daily security monitoring..."

# Create reports directory with timestamp
REPORT_DIR="security/reports/$(date +%Y-%m-%d)"
mkdir -p "$REPORT_DIR"

# Run npm audit
echo "📊 Running npm audit..."
npm audit --json > "$REPORT_DIR/npm-audit.json" || true
npm audit --audit-level=low > "$REPORT_DIR/npm-audit.txt" || true

# Run Snyk scan if authenticated
if command -v snyk &> /dev/null && snyk auth; then
    echo "🔍 Running Snyk security scan..."
    snyk test --json > "$REPORT_DIR/snyk-test.json" || true
    snyk code test --json > "$REPORT_DIR/snyk-code.json" || true
    
    # Monitor project with Snyk
    snyk monitor || true
fi

# Run license check
echo "📄 Running license compliance check..."
license-checker --json --out "$REPORT_DIR/licenses.json" || true

# Generate summary report
echo "📋 Generating security summary..."
cat > "$REPORT_DIR/security-summary.md" << SUMMARY
# Security Monitoring Report - $(date)

## Scan Results

### npm audit
$(cat "$REPORT_DIR/npm-audit.txt" | tail -10)

### Snyk Test
$(if [ -f "$REPORT_DIR/snyk-test.json" ]; then echo "Snyk scan completed - see snyk-test.json"; else echo "Snyk scan not available"; fi)

### License Compliance
$(if [ -f "$REPORT_DIR/licenses.json" ]; then echo "License scan completed - see licenses.json"; else echo "License scan failed"; fi)

## Next Steps
- Review any critical or high severity vulnerabilities
- Update dependencies as needed
- Check license compliance issues
- Monitor for new vulnerabilities

SUMMARY

echo "✅ Security monitoring completed. Reports saved to $REPORT_DIR"
EOF

chmod +x security/security-monitor.sh

# Create security validation script
print_status "Creating security validation script..."
cat > security/validate-security.js << 'EOF'
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Validating security configuration...');

const checks = [
    {
        name: 'npm audit configuration',
        check: () => fs.existsSync('.npmrc'),
        fix: 'Create .npmrc with audit-level=moderate'
    },
    {
        name: 'Snyk configuration',
        check: () => fs.existsSync('.snyk'),
        fix: 'Create .snyk configuration file'
    },
    {
        name: 'Dependabot configuration',
        check: () => fs.existsSync('.github/dependabot.yml'),
        fix: 'Create .github/dependabot.yml configuration'
    },
    {
        name: 'Security workflow',
        check: () => fs.existsSync('.github/workflows/security-vulnerability-scanning.yml'),
        fix: 'Create security workflow in .github/workflows/'
    },
    {
        name: 'Security policy',
        check: () => fs.existsSync('security/policies/security-policy.md'),
        fix: 'Create security policy documentation'
    }
];

let passed = 0;
let total = checks.length;

checks.forEach(check => {
    const result = check.check();
    if (result) {
        console.log(`✅ ${check.name}`);
        passed++;
    } else {
        console.log(`❌ ${check.name} - ${check.fix}`);
    }
});

console.log(`\n📊 Security configuration: ${passed}/${total} checks passed`);

if (passed === total) {
    console.log('🎉 All security configurations are properly set up!');
    process.exit(0);
} else {
    console.log('⚠️ Some security configurations need attention.');
    process.exit(1);
}
EOF

chmod +x security/validate-security.js

# Create .gitignore entries for security reports
print_status "Updating .gitignore for security reports..."
cat >> .gitignore << 'EOF'

# Security reports (exclude sensitive data)
security/reports/
*.audit.json
*-security-report.json
snyk-*.json
npm-audit-*.json
security-audit-*.json
EOF

# Initialize Snyk if token is available
if [ ! -z "$SNYK_TOKEN" ]; then
    print_status "Authenticating with Snyk..."
    snyk auth "$SNYK_TOKEN"
    print_success "Snyk authentication successful"
    
    # Monitor the project
    print_status "Setting up Snyk monitoring..."
    snyk monitor || print_warning "Snyk monitor setup failed - you may need to configure it manually"
else
    print_warning "SNYK_TOKEN not set - Snyk authentication skipped"
    print_warning "Set SNYK_TOKEN environment variable to enable Snyk monitoring"
fi

# Run initial security scan
print_status "Running initial security scan..."
npm run audit || print_warning "Initial npm audit found issues - review and fix"

# Validate the setup
print_status "Validating security setup..."
node security/validate-security.js

print_success "🎉 Security setup completed successfully!"
print_status "Next steps:"
echo "  1. Set SNYK_TOKEN environment variable for Snyk integration"
echo "  2. Configure GitHub repository secrets for CI/CD integration"
echo "  3. Review and customize security policies in security/policies/"
echo "  4. Run 'npm run security:full' to perform comprehensive security scan"
echo "  5. Set up automated security monitoring with './security/security-monitor.sh'"

print_status "Repository secrets needed for full CI/CD integration:"
echo "  - SNYK_TOKEN: Snyk authentication token"
echo "  - SECURITY_WEBHOOK_URL: Optional webhook for security notifications"
echo "  - SEMGREP_APP_TOKEN: Optional Semgrep token for enhanced scanning"

print_success "Security setup script completed! 🛡️"
EOF
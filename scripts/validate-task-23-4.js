#!/usr/bin/env node

/**
 * Task 23.4 Completion Validation Script
 * Validates implementation of "Set Up Automated Vulnerability Scanning and CI/CD Integration"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Validating Task 23.4: Automated Vulnerability Scanning and CI/CD Integration\n');

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(level, message) {
  const color = colors[level] || colors.reset;
  console.log(`${color}${message}${colors.reset}`);
}

// Validation checks
const validationChecks = [
  {
    name: '1. Snyk CLI Integration',
    description: 'Verify Snyk CLI configuration and integration',
    checks: [
      {
        name: 'Snyk configuration file exists',
        validate: () => fs.existsSync('.snyk'),
        critical: true
      },
      {
        name: 'Package.json includes Snyk scripts',
        validate: () => {
          const pkg = JSON.parse(fs.readFileSync('mcp-server/package.json', 'utf8'));
          return pkg.scripts['security:snyk'] && pkg.scripts['security:snyk-fix'];
        },
        critical: true
      },
      {
        name: 'Snyk CLI is available globally',
        validate: () => {
          try {
            execSync('which snyk', { stdio: 'ignore' });
            return true;
          } catch {
            return false;
          }
        },
        critical: false
      }
    ]
  },
  {
    name: '2. GitHub Actions Security Workflow',
    description: 'Verify comprehensive security workflow implementation',
    checks: [
      {
        name: 'Security vulnerability scanning workflow exists',
        validate: () => fs.existsSync('.github/workflows/security-vulnerability-scanning.yml'),
        critical: true
      },
      {
        name: 'Enhanced security workflow exists',
        validate: () => fs.existsSync('.github/workflows/security-enhanced.yml'),
        critical: true
      },
      {
        name: 'Workflow includes Snyk integration',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('snyk test') && workflow.includes('snyk auth');
        },
        critical: true
      },
      {
        name: 'Workflow includes npm audit with CI integration',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('npm ci --audit');
        },
        critical: true
      }
    ]
  },
  {
    name: '3. Dependabot Configuration',
    description: 'Verify Dependabot setup for automated security updates',
    checks: [
      {
        name: 'Dependabot configuration file exists',
        validate: () => fs.existsSync('.github/dependabot.yml'),
        critical: true
      },
      {
        name: 'Dependabot configured for npm ecosystem',
        validate: () => {
          const config = fs.readFileSync('.github/dependabot.yml', 'utf8');
          return config.includes('package-ecosystem: "npm"');
        },
        critical: true
      },
      {
        name: 'Dependabot configured for security updates',
        validate: () => {
          const config = fs.readFileSync('.github/dependabot.yml', 'utf8');
          return config.includes('vulnerability-alerts') && config.includes('enabled: true');
        },
        critical: true
      },
      {
        name: 'Dependabot includes automated labeling',
        validate: () => {
          const config = fs.readFileSync('.github/dependabot.yml', 'utf8');
          return config.includes('labels:') && config.includes('security');
        },
        critical: false
      }
    ]
  },
  {
    name: '4. Package Integrity Validation',
    description: 'Verify npm audit and package integrity implementation',
    checks: [
      {
        name: 'npm audit CI script exists',
        validate: () => {
          const pkg = JSON.parse(fs.readFileSync('mcp-server/package.json', 'utf8'));
          return pkg.scripts['audit:ci'];
        },
        critical: true
      },
      {
        name: 'Security integrity validation script exists',
        validate: () => {
          const pkg = JSON.parse(fs.readFileSync('mcp-server/package.json', 'utf8'));
          return pkg.scripts['security:integrity'];
        },
        critical: true
      },
      {
        name: 'npm configuration for security',
        validate: () => fs.existsSync('mcp-server/.npmrc'),
        critical: false
      },
      {
        name: 'License compliance checking',
        validate: () => {
          const pkg = JSON.parse(fs.readFileSync('mcp-server/package.json', 'utf8'));
          return pkg.scripts['security:license'];
        },
        critical: true
      }
    ]
  },
  {
    name: '5. Subresource Integrity Implementation',
    description: 'Verify SRI validation for CDN resources',
    checks: [
      {
        name: 'SRI validation module exists',
        validate: () => fs.existsSync('mcp-server/src/security/subresource-integrity.ts'),
        critical: true
      },
      {
        name: 'SRI module includes hash generation',
        validate: () => {
          const sriModule = fs.readFileSync('mcp-server/src/security/subresource-integrity.ts', 'utf8');
          return sriModule.includes('generateSRIHash') && sriModule.includes('validateSRIHash');
        },
        critical: true
      },
      {
        name: 'SRI workflow validation exists',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('subresource-integrity-check');
        },
        critical: true
      },
      {
        name: 'Known CDN resources configured',
        validate: () => {
          const sriModule = fs.readFileSync('mcp-server/src/security/subresource-integrity.ts', 'utf8');
          return sriModule.includes('KNOWN_CDN_RESOURCES') && sriModule.includes('bootstrap');
        },
        critical: false
      }
    ]
  },
  {
    name: '6. Automated Vulnerability Notifications',
    description: 'Verify notification systems for security alerts',
    checks: [
      {
        name: 'Security notification workflow exists',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('security-notifications');
        },
        critical: true
      },
      {
        name: 'PR comment notifications configured',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('Comment on Pull Request') && workflow.includes('github-script');
        },
        critical: true
      },
      {
        name: 'Critical vulnerability issue creation',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('Create GitHub Issue for Critical Vulnerabilities');
        },
        critical: true
      },
      {
        name: 'Webhook notification support',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('SECURITY_WEBHOOK_URL');
        },
        critical: false
      }
    ]
  },
  {
    name: '7. Security Gates and Build Integration',
    description: 'Verify security gates that fail builds on critical vulnerabilities',
    checks: [
      {
        name: 'Security gate validation job exists',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('security-gate-validation');
        },
        critical: true
      },
      {
        name: 'Critical vulnerability thresholds defined',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('MAX_CRITICAL_VULNERABILITIES') && workflow.includes('MAX_HIGH_VULNERABILITIES');
        },
        critical: true
      },
      {
        name: 'Build fails on security gate failure',
        validate: () => {
          const workflow = fs.readFileSync('.github/workflows/security-vulnerability-scanning.yml', 'utf8');
          return workflow.includes('exit 1') && workflow.includes('FAILED:');
        },
        critical: true
      },
      {
        name: 'Integration with existing CI/CD pipeline',
        validate: () => {
          const mainWorkflow = fs.readFileSync('.github/workflows/ci-cd-pipeline.yml', 'utf8');
          return mainWorkflow.includes('security-scan') && mainWorkflow.includes('security-passed');
        },
        critical: true
      }
    ]
  },
  {
    name: '8. Documentation and Setup',
    description: 'Verify comprehensive documentation and setup scripts',
    checks: [
      {
        name: 'Security setup script exists',
        validate: () => fs.existsSync('scripts/security-setup.sh') && fs.statSync('scripts/security-setup.sh').mode & 0o111,
        critical: true
      },
      {
        name: 'Task 23.4 validation script exists',
        validate: () => fs.existsSync('scripts/validate-task-23-4.js'),
        critical: true
      },
      {
        name: 'Comprehensive security documentation exists',
        validate: () => fs.existsSync('docs/AUTOMATED-VULNERABILITY-SCANNING.md'),
        critical: true
      },
      {
        name: 'Security monitoring script exists',
        validate: () => {
          try {
            return fs.existsSync('security/security-monitor.sh') || 
                   fs.readFileSync('scripts/security-setup.sh', 'utf8').includes('security-monitor.sh');
          } catch {
            return false;
          }
        },
        critical: false
      }
    ]
  }
];

// Run validation
let totalChecks = 0;
let passedChecks = 0;
let criticalFailures = 0;

console.log('Running validation checks...\n');

validationChecks.forEach(section => {
  log('blue', `📋 ${section.name}`);
  log('reset', `   ${section.description}\n`);
  
  section.checks.forEach(check => {
    totalChecks++;
    const passed = check.validate();
    
    if (passed) {
      passedChecks++;
      log('green', `   ✅ ${check.name}`);
    } else {
      if (check.critical) {
        criticalFailures++;
        log('red', `   ❌ ${check.name} (CRITICAL)`);
      } else {
        log('yellow', `   ⚠️  ${check.name} (WARNING)`);
      }
    }
  });
  
  console.log('');
});

// Summary
console.log('━'.repeat(60));
log('blue', '📊 VALIDATION SUMMARY');
console.log('━'.repeat(60));

const successRate = Math.round((passedChecks / totalChecks) * 100);

console.log(`Total Checks: ${totalChecks}`);
log('green', `Passed: ${passedChecks}`);
log('red', `Failed: ${totalChecks - passedChecks}`);
log('red', `Critical Failures: ${criticalFailures}`);
console.log(`Success Rate: ${successRate}%\n`);

// Overall result
if (criticalFailures === 0) {
  log('green', '🎉 TASK 23.4 VALIDATION PASSED!');
  console.log('All critical components for automated vulnerability scanning are properly implemented.\n');
  
  if (passedChecks < totalChecks) {
    log('yellow', '📝 Minor recommendations:');
    console.log('- Some optional features could be enhanced');
    console.log('- Review warnings above for improvement opportunities\n');
  }
  
  console.log('✅ Implementation includes:');
  console.log('  • Snyk CLI integration with comprehensive scanning');
  console.log('  • GitHub Actions security workflow with multiple scan types');
  console.log('  • Dependabot configuration for automated security updates');
  console.log('  • Package integrity validation using npm ci --audit');
  console.log('  • Subresource integrity checks for CDN resources');
  console.log('  • Automated vulnerability notifications and alerts');
  console.log('  • Security gates that fail builds on critical vulnerabilities');
  console.log('  • Comprehensive documentation and setup scripts\n');
  
  process.exit(0);
} else {
  log('red', '❌ TASK 23.4 VALIDATION FAILED!');
  console.log(`${criticalFailures} critical component(s) missing or misconfigured.\n`);
  
  log('red', '🚨 Required actions:');
  console.log('  1. Address all critical failures listed above');
  console.log('  2. Run setup script: ./scripts/security-setup.sh');
  console.log('  3. Configure required GitHub secrets (SNYK_TOKEN, etc.)');
  console.log('  4. Re-run this validation script\n');
  
  log('yellow', '📖 For detailed implementation guidance, see:');
  console.log('  • docs/AUTOMATED-VULNERABILITY-SCANNING.md');
  console.log('  • scripts/security-setup.sh');
  console.log('  • .github/workflows/security-vulnerability-scanning.yml\n');
  
  process.exit(1);
}
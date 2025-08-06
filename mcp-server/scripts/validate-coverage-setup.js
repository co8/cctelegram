#!/usr/bin/env node

/**
 * Coverage and Quality Metrics Setup Validation
 * Validates that all coverage and mutation testing infrastructure is properly configured
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class CoverageSetupValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.successes = [];
  }

  log(type, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    
    switch (type) {
      case 'error':
        this.errors.push(logMessage);
        console.error('❌', message);
        break;
      case 'warning':
        this.warnings.push(logMessage);
        console.warn('⚠️', message);
        break;
      case 'success':
        this.successes.push(logMessage);
        console.log('✅', message);
        break;
      case 'info':
        console.log('ℹ️', message);
        break;
    }
  }

  async validateFileExists(filePath, description) {
    if (fs.existsSync(filePath)) {
      this.log('success', `${description} exists: ${filePath}`);
      return true;
    } else {
      this.log('error', `${description} missing: ${filePath}`);
      return false;
    }
  }

  async validateNycConfiguration() {
    this.log('info', 'Validating nyc configuration...');
    
    const configPath = '.nycrc.json';
    if (!await this.validateFileExists(configPath, 'nyc configuration')) {
      return false;
    }
    
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // Check required fields
      const requiredFields = ['include', 'exclude', 'reporter', 'lines', 'functions', 'branches', 'statements'];
      for (const field of requiredFields) {
        if (!config[field]) {
          this.log('error', `nyc config missing required field: ${field}`);
          return false;
        }
      }
      
      // Check thresholds are reasonable
      if (config.lines < 80 || config.lines > 100) {
        this.log('warning', `nyc lines threshold seems unreasonable: ${config.lines}%`);
      }
      
      if (config.functions < 80 || config.functions > 100) {
        this.log('warning', `nyc functions threshold seems unreasonable: ${config.functions}%`);
      }
      
      // Check that reporters include essential formats
      const requiredReporters = ['lcov', 'html', 'json'];
      for (const reporter of requiredReporters) {
        if (!config.reporter.includes(reporter)) {
          this.log('warning', `nyc config missing recommended reporter: ${reporter}`);
        }
      }
      
      this.log('success', 'nyc configuration is valid');
      return true;
      
    } catch (error) {
      this.log('error', `Failed to parse nyc configuration: ${error.message}`);
      return false;
    }
  }

  async validateStrykerConfiguration() {
    this.log('info', 'Validating Stryker configuration...');
    
    const configPath = 'stryker.conf.json';
    if (!await this.validateFileExists(configPath, 'Stryker configuration')) {
      return false;
    }
    
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // Check required fields
      const requiredFields = ['testRunner', 'mutate', 'reporters', 'thresholds'];
      for (const field of requiredFields) {
        if (!config[field]) {
          this.log('error', `Stryker config missing required field: ${field}`);
          return false;
        }
      }
      
      // Check test runner
      if (config.testRunner !== 'jest') {
        this.log('warning', `Stryker configured for ${config.testRunner}, expected jest`);
      }
      
      // Check thresholds
      if (!config.thresholds.high || !config.thresholds.low) {
        this.log('error', 'Stryker config missing threshold values');
        return false;
      }
      
      // Check reporters include essential formats
      const requiredReporters = ['html', 'json'];
      for (const reporter of requiredReporters) {
        if (!config.reporters.includes(reporter)) {
          this.log('warning', `Stryker config missing recommended reporter: ${reporter}`);
        }
      }
      
      this.log('success', 'Stryker configuration is valid');
      return true;
      
    } catch (error) {
      this.log('error', `Failed to parse Stryker configuration: ${error.message}`);
      return false;
    }
  }

  async validateJestConfiguration() {
    this.log('info', 'Validating Jest configuration...');
    
    const configPath = 'jest.config.js';
    if (!await this.validateFileExists(configPath, 'Jest configuration')) {
      return false;
    }
    
    try {
      // Read the file as text since it's an ES module
      const content = fs.readFileSync(configPath, 'utf8');
      
      // Basic checks for required content
      const requiredContent = [
        'collectCoverage',
        'collectCoverageFrom',
        'coverageDirectory',
        'coverageReporters',
        'coverageThreshold'
      ];
      
      for (const required of requiredContent) {
        if (!content.includes(required)) {
          this.log('error', `Jest config missing: ${required}`);
          return false;
        }
      }
      
      // Check for coverage reporters
      if (!content.includes('lcov') || !content.includes('html')) {
        this.log('warning', 'Jest config may be missing essential coverage reporters');
      }
      
      this.log('success', 'Jest configuration appears valid');
      return true;
      
    } catch (error) {
      this.log('error', `Failed to validate Jest configuration: ${error.message}`);
      return false;
    }
  }

  async validatePackageJson() {
    this.log('info', 'Validating package.json scripts and dependencies...');
    
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      
      // Check coverage scripts
      const requiredScripts = [
        'test:coverage',
        'test:coverage:nyc',
        'test:coverage:ci',
        'coverage:check',
        'coverage:analyze',
        'test:mutation',
        'test:mutation:ci',
        'mutation:analyze',
        'ci:quality-gates',
        'quality:all'
      ];
      
      for (const script of requiredScripts) {
        if (!packageJson.scripts[script]) {
          this.log('error', `package.json missing script: ${script}`);
          return false;
        }
      }
      
      // Check dependencies
      const requiredDevDependencies = [
        'nyc',
        '@stryker-mutator/core',
        '@stryker-mutator/jest-runner',
        '@stryker-mutator/typescript-checker'
      ];
      
      for (const dep of requiredDevDependencies) {
        if (!packageJson.devDependencies[dep]) {
          this.log('error', `package.json missing devDependency: ${dep}`);
          return false;
        }
      }
      
      this.log('success', 'package.json scripts and dependencies are valid');
      return true;
      
    } catch (error) {
      this.log('error', `Failed to validate package.json: ${error.message}`);
      return false;
    }
  }

  async validateScripts() {
    this.log('info', 'Validating analysis scripts...');
    
    const scripts = [
      { path: 'scripts/coverage-analysis.js', name: 'Coverage analysis script' },
      { path: 'scripts/mutation-testing-analysis.js', name: 'Mutation testing analysis script' },
      { path: 'scripts/ci-quality-gates.js', name: 'CI quality gates script' }
    ];
    
    let allValid = true;
    
    for (const script of scripts) {
      if (await this.validateFileExists(script.path, script.name)) {
        // Basic content validation
        const content = fs.readFileSync(script.path, 'utf8');
        
        if (script.path.includes('coverage-analysis')) {
          if (!content.includes('CoverageAnalyzer') || !content.includes('runCoverageAnalysis')) {
            this.log('error', `${script.name} missing required classes/methods`);
            allValid = false;
          }
        } else if (script.path.includes('mutation-testing')) {
          if (!content.includes('MutationTestingAnalyzer') || !content.includes('runMutationTesting')) {
            this.log('error', `${script.name} missing required classes/methods`);
            allValid = false;
          }
        } else if (script.path.includes('ci-quality-gates')) {
          if (!content.includes('CIQualityGates') || !content.includes('runQualityGates')) {
            this.log('error', `${script.name} missing required classes/methods`);
            allValid = false;
          }
        }
      } else {
        allValid = false;
      }
    }
    
    if (allValid) {
      this.log('success', 'All analysis scripts are present and valid');
    }
    
    return allValid;
  }

  async validateCIWorkflow() {
    this.log('info', 'Validating CI/CD workflow...');
    
    const workflowPath = '../.github/workflows/coverage-quality-gates.yml';
    if (!await this.validateFileExists(workflowPath, 'GitHub Actions workflow')) {
      return false;
    }
    
    try {
      const content = fs.readFileSync(workflowPath, 'utf8');
      
      const requiredJobs = ['coverage-analysis', 'quality-gates'];
      const optionalJobs = ['mutation-testing', 'performance-benchmarks', 'security-audit'];
      
      for (const job of requiredJobs) {
        if (!content.includes(job)) {
          this.log('error', `GitHub workflow missing required job: ${job}`);
          return false;
        }
      }
      
      for (const job of optionalJobs) {
        if (!content.includes(job)) {
          this.log('info', `GitHub workflow includes optional job: ${job}`);
        }
      }
      
      // Check for codecov integration
      if (content.includes('codecov')) {
        this.log('success', 'GitHub workflow includes CodeCov integration');
      } else {
        this.log('warning', 'GitHub workflow missing CodeCov integration');
      }
      
      this.log('success', 'GitHub Actions workflow is valid');
      return true;
      
    } catch (error) {
      this.log('error', `Failed to validate GitHub workflow: ${error.message}`);
      return false;
    }
  }

  async validateDocumentation() {
    this.log('info', 'Validating documentation...');
    
    const docsPath = 'docs/COVERAGE_AND_QUALITY_METRICS.md';
    if (!await this.validateFileExists(docsPath, 'Coverage documentation')) {
      return false;
    }
    
    try {
      const content = fs.readFileSync(docsPath, 'utf8');
      
      const requiredSections = [
        '# Code Coverage and Quality Metrics',
        '## Quick Start',
        '## Configuration',
        '## Mutation Testing',
        '## Quality Gates',
        '## CI/CD Pipeline'
      ];
      
      for (const section of requiredSections) {
        if (!content.includes(section)) {
          this.log('warning', `Documentation missing section: ${section}`);
        }
      }
      
      this.log('success', 'Documentation is present and appears complete');
      return true;
      
    } catch (error) {
      this.log('error', `Failed to validate documentation: ${error.message}`);
      return false;
    }
  }

  async validateToolAvailability() {
    this.log('info', 'Validating tool availability...');
    
    const tools = [
      { command: 'npx nyc --version', name: 'nyc' },
      { command: 'npx stryker --version', name: 'Stryker' },
      { command: 'npx jest --version', name: 'Jest' }
    ];
    
    let allAvailable = true;
    
    for (const tool of tools) {
      try {
        await execAsync(tool.command);
        this.log('success', `${tool.name} is available`);
      } catch (error) {
        this.log('error', `${tool.name} is not available: ${error.message}`);
        allAvailable = false;
      }
    }
    
    return allAvailable;
  }

  async validateDirectoryStructure() {
    this.log('info', 'Validating directory structure...');
    
    const requiredDirs = [
      'src',
      'tests',
      'scripts',
      'docs'
    ];
    
    let allExist = true;
    
    for (const dir of requiredDirs) {
      if (fs.existsSync(dir)) {
        this.log('success', `Directory exists: ${dir}`);
      } else {
        this.log('error', `Directory missing: ${dir}`);
        allExist = false;
      }
    }
    
    // Check that output directories can be created
    const outputDirs = ['coverage', 'reports', 'reports/coverage', 'reports/mutation', 'reports/ci'];
    
    for (const dir of outputDirs) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.log('success', `Output directory ready: ${dir}`);
      } catch (error) {
        this.log('error', `Cannot create output directory ${dir}: ${error.message}`);
        allExist = false;
      }
    }
    
    return allExist;
  }

  async runValidation() {
    this.log('info', 'Starting comprehensive coverage and quality metrics validation...');
    
    const validations = [
      { name: 'Directory Structure', fn: () => this.validateDirectoryStructure() },
      { name: 'Tool Availability', fn: () => this.validateToolAvailability() },
      { name: 'Package Configuration', fn: () => this.validatePackageJson() },
      { name: 'nyc Configuration', fn: () => this.validateNycConfiguration() },
      { name: 'Stryker Configuration', fn: () => this.validateStrykerConfiguration() },
      { name: 'Jest Configuration', fn: () => this.validateJestConfiguration() },
      { name: 'Analysis Scripts', fn: () => this.validateScripts() },
      { name: 'CI/CD Workflow', fn: () => this.validateCIWorkflow() },
      { name: 'Documentation', fn: () => this.validateDocumentation() }
    ];
    
    let allPassed = true;
    
    for (const validation of validations) {
      this.log('info', `\n--- Validating ${validation.name} ---`);
      
      try {
        const result = await validation.fn();
        if (!result) {
          allPassed = false;
        }
      } catch (error) {
        this.log('error', `Validation failed for ${validation.name}: ${error.message}`);
        allPassed = false;
      }
    }
    
    // Generate summary report
    this.generateSummaryReport(allPassed);
    
    return allPassed;
  }

  generateSummaryReport(allPassed) {
    console.log('\n' + '='.repeat(80));
    console.log('COVERAGE AND QUALITY METRICS VALIDATION SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`\n✅ Successes: ${this.successes.length}`);
    console.log(`⚠️ Warnings: ${this.warnings.length}`);
    console.log(`❌ Errors: ${this.errors.length}`);
    
    if (this.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.errors.forEach(error => console.log(`  ${error}`));
    }
    
    if (this.warnings.length > 0) {
      console.log('\n⚠️ WARNINGS:');
      this.warnings.forEach(warning => console.log(`  ${warning}`));
    }
    
    console.log('\n' + '='.repeat(80));
    
    if (allPassed) {
      console.log('🎉 ALL VALIDATIONS PASSED! Coverage and quality metrics system is ready.');
      console.log('\nNext steps:');
      console.log('  1. Run: npm run test:coverage');
      console.log('  2. Run: npm run coverage:analyze');
      console.log('  3. Run: npm run test:mutation (optional, time-consuming)');
      console.log('  4. Run: npm run quality:ci');
    } else {
      console.log('💥 VALIDATION FAILED! Please fix the errors above.');
      console.log('\nRecommended actions:');
      console.log('  1. Review and fix all errors listed above');
      console.log('  2. Re-run this validation script');
      console.log('  3. Test the coverage system with a simple test run');
    }
    
    console.log('='.repeat(80));
    
    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      status: allPassed ? 'PASSED' : 'FAILED',
      summary: {
        successes: this.successes.length,
        warnings: this.warnings.length,
        errors: this.errors.length
      },
      details: {
        successes: this.successes,
        warnings: this.warnings,
        errors: this.errors
      }
    };
    
    if (!fs.existsSync('reports')) {
      fs.mkdirSync('reports', { recursive: true });
    }
    
    fs.writeFileSync('reports/validation-report.json', JSON.stringify(report, null, 2));
    console.log('\n📄 Detailed report saved to: reports/validation-report.json');
  }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new CoverageSetupValidator();
  
  validator.runValidation()
    .then(passed => {
      process.exit(passed ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Validation script failed:', error);
      process.exit(1);
    });
}

export { CoverageSetupValidator };
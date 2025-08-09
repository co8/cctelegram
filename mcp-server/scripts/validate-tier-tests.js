#!/usr/bin/env node

/**
 * 3-Tier Integration Test Validation Script
 * 
 * Validates that the integration test environment is properly configured
 * and all necessary components are in place before running tests.
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class TierTestValidator {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../..');
    this.mcpServerRoot = path.join(this.projectRoot, 'mcp-server');
    this.validationResults = [];
  }

  async validate() {
    console.log('🔍 Validating 3-Tier Integration Test Setup');
    console.log('='.repeat(50));

    await this.validateProjectStructure();
    await this.validateDockerSetup();
    await this.validateTestFiles();
    await this.validateDependencies();
    await this.validateConfiguration();
    
    this.printResults();
    
    const hasErrors = this.validationResults.some(r => r.status === 'error');
    if (hasErrors) {
      console.log('\n❌ Validation failed - please fix the issues above before running tests');
      process.exit(1);
    } else {
      console.log('\n✅ Validation successful - integration tests are ready to run');
    }
  }

  async validateProjectStructure() {
    console.log('\n📁 Validating project structure...');
    
    const requiredFiles = [
      'docker-compose.integration-test.yml',
      'mcp-server/Dockerfile.tier-mocks',
      'tests/mcp-server/integration/tier-cascading-system.integration.test.ts',
      'tests/mcp-server/utils/tier-test-helpers.ts',
      'mcp-server/scripts/run-tier-integration-tests.js',
      'mcp-server/scripts/validate-tier-tests.js'
    ];

    for (const file of requiredFiles) {
      await this.checkFileExists(path.join(this.projectRoot, file), file);
    }

    const requiredDirs = [
      'tests/mcp-server/integration',
      'tests/mcp-server/utils',
      'mcp-server/scripts'
    ];

    for (const dir of requiredDirs) {
      await this.checkDirectoryExists(path.join(this.projectRoot, dir), dir);
    }
  }

  async validateDockerSetup() {
    console.log('\n🐳 Validating Docker setup...');
    
    try {
      const { stdout: dockerVersion } = await execAsync('docker --version');
      this.addResult('Docker installation', 'success', dockerVersion.trim());
    } catch (error) {
      this.addResult('Docker installation', 'error', 'Docker not found - required for integration tests');
      return;
    }

    try {
      const { stdout: composeVersion } = await execAsync('docker-compose --version');
      this.addResult('Docker Compose installation', 'success', composeVersion.trim());
    } catch (error) {
      this.addResult('Docker Compose installation', 'error', 'Docker Compose not found - required for integration tests');
      return;
    }

    // Check if Docker daemon is running
    try {
      await execAsync('docker info');
      this.addResult('Docker daemon', 'success', 'Docker daemon is running');
    } catch (error) {
      this.addResult('Docker daemon', 'error', 'Docker daemon is not running');
    }

    // Validate Docker Compose file
    const composeFile = path.join(this.projectRoot, 'docker-compose.integration-test.yml');
    try {
      await execAsync(`docker-compose -f ${composeFile} config`);
      this.addResult('Docker Compose configuration', 'success', 'Configuration is valid');
    } catch (error) {
      this.addResult('Docker Compose configuration', 'error', `Invalid configuration: ${error.message}`);
    }
  }

  async validateTestFiles() {
    console.log('\n🧪 Validating test files...');
    
    // Check main integration test file
    const integrationTestFile = path.join(this.projectRoot, 'tests/mcp-server/integration/tier-cascading-system.integration.test.ts');
    try {
      const content = await fs.readFile(integrationTestFile, 'utf-8');
      
      const requiredTests = [
        'Tier 1: MCP Webhook Response Time Validation',
        'Tier 2: Bridge Processing Validation',
        'Tier 3: File Watcher Fallback Validation',
        'Real-time Latency Measurements',
        'Fallback Mechanism Validation'
      ];

      for (const testName of requiredTests) {
        if (content.includes(testName)) {
          this.addResult(`Test suite: ${testName}`, 'success', 'Test suite found');
        } else {
          this.addResult(`Test suite: ${testName}`, 'warning', 'Test suite not found in file');
        }
      }

      // Check for required imports
      const requiredImports = ['supertest', 'express', 'child_process', 'fs'];
      for (const importName of requiredImports) {
        if (content.includes(importName)) {
          this.addResult(`Import: ${importName}`, 'success', 'Required import found');
        } else {
          this.addResult(`Import: ${importName}`, 'warning', 'Required import not found');
        }
      }

    } catch (error) {
      this.addResult('Integration test file', 'error', `Cannot read test file: ${error.message}`);
    }

    // Check test utilities
    const testUtilsFile = path.join(this.projectRoot, 'tests/mcp-server/utils/tier-test-helpers.ts');
    try {
      const content = await fs.readFile(testUtilsFile, 'utf-8');
      
      const requiredClasses = ['TierTestMetrics', 'TierTestScheduler', 'TierConfigurationManager', 'LoadTestRunner'];
      for (const className of requiredClasses) {
        if (content.includes(`class ${className}`)) {
          this.addResult(`Utility class: ${className}`, 'success', 'Helper class found');
        } else {
          this.addResult(`Utility class: ${className}`, 'error', 'Required helper class not found');
        }
      }

    } catch (error) {
      this.addResult('Test utilities file', 'error', `Cannot read utilities file: ${error.message}`);
    }
  }

  async validateDependencies() {
    console.log('\n📦 Validating dependencies...');
    
    const packageJsonPath = path.join(this.mcpServerRoot, 'package.json');
    try {
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);
      
      const requiredDependencies = {
        devDependencies: ['supertest', '@types/supertest', 'jest', '@types/jest']
      };

      for (const [depType, deps] of Object.entries(requiredDependencies)) {
        for (const dep of deps) {
          if (packageJson[depType] && packageJson[depType][dep]) {
            this.addResult(`Dependency: ${dep}`, 'success', `Found in ${depType}`);
          } else {
            this.addResult(`Dependency: ${dep}`, 'error', `Missing from ${depType}`);
          }
        }
      }

      // Check for new test scripts
      const requiredScripts = [
        'test:tier-integration',
        'test:tier-integration:dev',
        'test:tier-cleanup'
      ];

      for (const script of requiredScripts) {
        if (packageJson.scripts && packageJson.scripts[script]) {
          this.addResult(`NPM script: ${script}`, 'success', 'Script configured');
        } else {
          this.addResult(`NPM script: ${script}`, 'warning', 'Script not found in package.json');
        }
      }

    } catch (error) {
      this.addResult('Package.json', 'error', `Cannot read package.json: ${error.message}`);
    }
  }

  async validateConfiguration() {
    console.log('\n⚙️  Validating configuration...');
    
    // Check Jest configuration
    const jestConfigPath = path.join(this.mcpServerRoot, 'jest.config.js');
    try {
      const jestConfig = await fs.readFile(jestConfigPath, 'utf-8');
      
      if (jestConfig.includes('integration')) {
        this.addResult('Jest integration config', 'success', 'Integration test pattern configured');
      } else {
        this.addResult('Jest integration config', 'warning', 'Integration test pattern not explicitly configured');
      }

      if (jestConfig.includes('testTimeout')) {
        this.addResult('Jest timeout config', 'success', 'Test timeout configured');
      } else {
        this.addResult('Jest timeout config', 'warning', 'Test timeout not configured - may cause issues with long-running tests');
      }

    } catch (error) {
      this.addResult('Jest configuration', 'error', `Cannot read jest.config.js: ${error.message}`);
    }

    // Check TypeScript configuration
    const tsConfigPath = path.join(this.mcpServerRoot, 'tsconfig.json');
    try {
      const tsConfig = await fs.readFile(tsConfigPath, 'utf-8');
      const config = JSON.parse(tsConfig);
      
      if (config.compilerOptions && config.compilerOptions.esModuleInterop) {
        this.addResult('TypeScript ESM config', 'success', 'ESM interop enabled');
      } else {
        this.addResult('TypeScript ESM config', 'warning', 'ESM interop not configured - may cause import issues');
      }

    } catch (error) {
      this.addResult('TypeScript configuration', 'warning', `Cannot read tsconfig.json: ${error.message}`);
    }

    // Check environment variables template
    const envExamplePath = path.join(this.projectRoot, '.env.example');
    try {
      await fs.access(envExamplePath);
      this.addResult('Environment template', 'success', 'Environment template exists');
    } catch (error) {
      this.addResult('Environment template', 'info', 'No .env.example found - consider creating one for test environment variables');
    }
  }

  async checkFileExists(filePath, displayName) {
    try {
      await fs.access(filePath);
      this.addResult(`File: ${displayName}`, 'success', 'File exists');
    } catch (error) {
      this.addResult(`File: ${displayName}`, 'error', 'File not found');
    }
  }

  async checkDirectoryExists(dirPath, displayName) {
    try {
      const stat = await fs.stat(dirPath);
      if (stat.isDirectory()) {
        this.addResult(`Directory: ${displayName}`, 'success', 'Directory exists');
      } else {
        this.addResult(`Directory: ${displayName}`, 'error', 'Path exists but is not a directory');
      }
    } catch (error) {
      this.addResult(`Directory: ${displayName}`, 'error', 'Directory not found');
    }
  }

  addResult(item, status, message) {
    this.validationResults.push({ item, status, message });
    
    const icon = {
      success: '✅',
      warning: '⚠️ ',
      error: '❌',
      info: 'ℹ️ '
    }[status];
    
    console.log(`  ${icon} ${item}: ${message}`);
  }

  printResults() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 VALIDATION SUMMARY');
    console.log('='.repeat(50));
    
    const summary = this.validationResults.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {});

    console.log(`✅ Success: ${summary.success || 0}`);
    console.log(`⚠️  Warnings: ${summary.warning || 0}`);
    console.log(`❌ Errors: ${summary.error || 0}`);
    console.log(`ℹ️  Info: ${summary.info || 0}`);
    console.log(`📋 Total: ${this.validationResults.length}`);

    if (summary.error > 0) {
      console.log('\n🔧 REQUIRED FIXES:');
      this.validationResults
        .filter(r => r.status === 'error')
        .forEach(r => console.log(`   • ${r.item}: ${r.message}`));
    }

    if (summary.warning > 0) {
      console.log('\n💡 RECOMMENDED IMPROVEMENTS:');
      this.validationResults
        .filter(r => r.status === 'warning')
        .forEach(r => console.log(`   • ${r.item}: ${r.message}`));
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
3-Tier Integration Test Validation Script

Usage: node validate-tier-tests.js [options]

Options:
  --help, -h     Show this help message

This script validates that all components for the 3-tier cascading system
integration tests are properly configured and ready to run.

Components checked:
  • Project structure and required files
  • Docker and Docker Compose setup
  • Test files and test suites
  • Dependencies and configuration
  • NPM scripts and Jest configuration
    `);
    return;
  }

  const validator = new TierTestValidator();
  await validator.validate();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Validation failed:', error.message);
    process.exit(1);
  });
}

module.exports = TierTestValidator;
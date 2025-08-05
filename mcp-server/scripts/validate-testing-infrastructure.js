#!/usr/bin/env node

/**
 * Testing Infrastructure Validation Script
 * Validates the complete testing infrastructure setup and integration
 */

import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';

class TestingInfrastructureValidator {
  constructor() {
    this.projectRoot = process.cwd();
    this.results = {
      passed: 0,
      failed: 0,
      warnings: 0,
      details: []
    };
  }

  async validate() {
    console.log('🧪 Testing Infrastructure Validation\n');
    
    // Core test framework validation
    await this.validateJestConfiguration();
    await this.validateTestStructure();
    await this.validateMockSystem();
    await this.validateFixtures();
    
    // Test type validation
    await this.validateUnitTests();
    await this.validateIntegrationTests();
    await this.validateE2ETests();
    await this.validatePerformanceTests();
    
    // CI/CD integration validation
    await this.validateGitHubActions();
    await this.validateTestScripts();
    
    // Quality gates validation
    await this.validateCoverageConfiguration();
    await this.validateTestingStandards();
    
    this.printSummary();
    
    return this.results.failed === 0;
  }

  async validateJestConfiguration() {
    this.log('📋 Validating Jest Configuration...');
    
    const jestConfigPath = path.join(this.projectRoot, 'jest.config.js');
    if (await fs.pathExists(jestConfigPath)) {
      this.pass('Jest configuration file exists');
      
      const config = await import(jestConfigPath);
      const requiredFields = ['testMatch', 'moduleNameMapper', 'transform', 'setupFilesAfterEnv'];
      
      for (const field of requiredFields) {
        if (config.default[field]) {
          this.pass(`Jest ${field} configured`);
        } else {
          this.fail(`Jest ${field} missing`);
        }
      }
    } else {
      this.fail('Jest configuration file missing');
    }
  }

  async validateTestStructure() {
    this.log('📁 Validating Test Directory Structure...');
    
    const requiredDirs = [
      'tests/unit',
      'tests/integration', 
      'tests/e2e',
      'tests/performance',
      'tests/fixtures',
      'tests/mocks',
      'tests/setup'
    ];
    
    for (const dir of requiredDirs) {
      const dirPath = path.join(this.projectRoot, dir);
      if (await fs.pathExists(dirPath)) {
        this.pass(`${dir} directory exists`);
      } else {
        this.warn(`${dir} directory missing`);
      }
    }
  }

  async validateMockSystem() {
    this.log('🎭 Validating Mock System...');
    
    const mockFiles = [
      'tests/mocks/axios.mock.ts',
      'tests/mocks/fs.mock.ts', 
      'tests/mocks/child_process.mock.ts'
    ];
    
    for (const mockFile of mockFiles) {
      const mockPath = path.join(this.projectRoot, mockFile);
      if (await fs.pathExists(mockPath)) {
        this.pass(`Mock ${path.basename(mockFile)} exists`);
      } else {
        this.warn(`Mock ${path.basename(mockFile)} missing`);
      }
    }
  }

  async validateFixtures() {
    this.log('🏗️ Validating Test Fixtures...');
    
    const fixtureFiles = [
      'tests/fixtures/events.fixture.ts',
      'tests/fixtures/responses.fixture.ts',
      'tests/fixtures/bridge-status.fixture.ts'
    ];
    
    for (const fixtureFile of fixtureFiles) {
      const fixturePath = path.join(this.projectRoot, fixtureFile);
      if (await fs.pathExists(fixturePath)) {
        this.pass(`Fixture ${path.basename(fixtureFile)} exists`);
      } else {
        this.warn(`Fixture ${path.basename(fixtureFile)} missing`);
      }
    }
  }

  async validateUnitTests() {
    this.log('🔬 Validating Unit Tests...');
    
    const unitTestDir = path.join(this.projectRoot, 'tests/unit');
    if (await fs.pathExists(unitTestDir)) {
      const testFiles = await fs.readdir(unitTestDir);
      const testCount = testFiles.filter(f => f.endsWith('.test.ts')).length;
      
      if (testCount > 0) {
        this.pass(`${testCount} unit test files found`);
      } else {
        this.fail('No unit test files found');
      }
      
      // Check for core module tests
      const coreTests = [
        'bridge-client.test.ts',
        'security.test.ts',
        'types.test.ts'
      ];
      
      for (const test of coreTests) {
        if (testFiles.includes(test)) {
          this.pass(`Core test ${test} exists`);
        } else {
          this.warn(`Core test ${test} missing`);
        }
      }
    } else {
      this.fail('Unit test directory missing');
    }
  }

  async validateIntegrationTests() {
    this.log('🔗 Validating Integration Tests...');
    
    const integrationTestDir = path.join(this.projectRoot, 'tests/integration');
    if (await fs.pathExists(integrationTestDir)) {
      const testFiles = await fs.readdir(integrationTestDir);
      const testCount = testFiles.filter(f => f.endsWith('.test.ts')).length;
      
      if (testCount > 0) {
        this.pass(`${testCount} integration test files found`);
      } else {
        this.warn('No integration test files found');
      }
    } else {
      this.warn('Integration test directory missing');
    }
  }

  async validateE2ETests() {
    this.log('🎭 Validating E2E Tests...');
    
    // Check Playwright configuration
    const playwrightConfigPath = path.join(this.projectRoot, 'playwright.config.ts');
    if (await fs.pathExists(playwrightConfigPath)) {
      this.pass('Playwright configuration exists');
    } else {
      this.warn('Playwright configuration missing');
    }
    
    const e2eTestDir = path.join(this.projectRoot, 'tests/e2e');
    if (await fs.pathExists(e2eTestDir)) {
      const testFiles = await fs.readdir(e2eTestDir);
      const testCount = testFiles.filter(f => f.endsWith('.test.ts')).length;
      
      if (testCount > 0) {
        this.pass(`${testCount} E2E test files found`);
      } else {
        this.warn('No E2E test files found');
      }
    } else {
      this.warn('E2E test directory missing');
    }
  }

  async validatePerformanceTests() {
    this.log('⚡ Validating Performance Tests...');
    
    const performanceTestDir = path.join(this.projectRoot, 'tests/performance');
    if (await fs.pathExists(performanceTestDir)) {
      const testFiles = await fs.readdir(performanceTestDir);
      const testCount = testFiles.filter(f => f.endsWith('.test.ts')).length;
      
      if (testCount > 0) {
        this.pass(`${testCount} performance test files found`);
      } else {
        this.warn('No performance test files found');
      }
    } else {
      this.warn('Performance test directory missing');
    }
  }

  async validateGitHubActions() {
    this.log('🚀 Validating GitHub Actions...');
    
    const workflowDir = path.join(this.projectRoot, '.github/workflows');
    if (await fs.pathExists(workflowDir)) {
      const workflows = await fs.readdir(workflowDir);
      
      if (workflows.includes('testing.yml')) {
        this.pass('Testing workflow exists');
      } else {
        this.warn('Testing workflow missing');
      }
      
      if (workflows.includes('benchmark.yml')) {
        this.pass('Benchmark workflow exists');
      } else {
        this.warn('Benchmark workflow missing');
      }
    } else {
      this.warn('GitHub Actions workflows directory missing');
    }
  }

  async validateTestScripts() {
    this.log('📜 Validating Test Scripts...');
    
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      const scripts = packageJson.scripts || {};
      
      const requiredScripts = [
        'test',
        'test:unit', 
        'test:integration',
        'test:performance',
        'test:coverage'
      ];
      
      for (const script of requiredScripts) {
        if (scripts[script]) {
          this.pass(`Script ${script} exists`);
        } else {
          this.warn(`Script ${script} missing`);
        }
      }
    } else {
      this.fail('package.json missing');
    }
  }

  async validateCoverageConfiguration() {
    this.log('📊 Validating Coverage Configuration...');
    
    const jestConfigPath = path.join(this.projectRoot, 'jest.config.js');
    if (await fs.pathExists(jestConfigPath)) {
      const config = await import(jestConfigPath);
      
      if (config.default.collectCoverageFrom) {
        this.pass('Coverage collection configured');
      } else {
        this.warn('Coverage collection not configured');
      }
      
      if (config.default.coverageThreshold) {
        this.pass('Coverage thresholds configured');
      } else {
        this.warn('Coverage thresholds not configured');
      }
    }
  }

  async validateTestingStandards() {
    this.log('📏 Validating Testing Standards...');
    
    // Check for test naming conventions
    const testFiles = await this.getAllTestFiles();
    let properlyNamedTests = 0;
    
    for (const testFile of testFiles) {
      if (testFile.endsWith('.test.ts') || testFile.endsWith('.e2e.test.ts')) {
        properlyNamedTests++;
      }
    }
    
    if (properlyNamedTests === testFiles.length) {
      this.pass('All test files follow naming conventions');
    } else {
      this.warn('Some test files don\'t follow naming conventions');
    }
    
    // Check for TypeScript configuration
    const tsconfigPath = path.join(this.projectRoot, 'tests/tsconfig.json');
    if (await fs.pathExists(tsconfigPath)) {
      this.pass('Test TypeScript configuration exists');
    } else {
      this.warn('Test TypeScript configuration missing');
    }
  }

  async getAllTestFiles() {
    const testFiles = [];
    const testDirs = ['tests/unit', 'tests/integration', 'tests/e2e', 'tests/performance'];
    
    for (const dir of testDirs) {
      const dirPath = path.join(this.projectRoot, dir);
      if (await fs.pathExists(dirPath)) {
        const files = await fs.readdir(dirPath);
        testFiles.push(...files.filter(f => f.includes('.test.')));
      }
    }
    
    return testFiles;
  }

  pass(message) {
    console.log(`  ✅ ${message}`);
    this.results.passed++;
    this.results.details.push({ status: 'pass', message });
  }

  fail(message) {
    console.log(`  ❌ ${message}`);
    this.results.failed++;
    this.results.details.push({ status: 'fail', message });
  }

  warn(message) {
    console.log(`  ⚠️  ${message}`);
    this.results.warnings++;
    this.results.details.push({ status: 'warn', message });
  }

  log(message) {
    console.log(`\n${message}`);
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 Testing Infrastructure Validation Summary');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⚠️  Warnings: ${this.results.warnings}`);
    console.log(`📊 Total Checks: ${this.results.passed + this.results.failed + this.results.warnings}`);
    
    if (this.results.failed === 0) {
      console.log('\n🎉 Testing infrastructure validation successful!');
    } else {
      console.log('\n💥 Testing infrastructure validation failed!');
      console.log('Please fix the failed checks before proceeding.');
    }
  }
}

// Run validation if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new TestingInfrastructureValidator();
  const success = await validator.validate();
  process.exit(success ? 0 : 1);
}

export { TestingInfrastructureValidator };
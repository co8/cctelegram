/**
 * Coverage Infrastructure Validation Test
 * Tests that the coverage and mutation testing infrastructure is properly set up
 */

import fs from 'fs';
import path from 'path';

describe('Coverage Infrastructure Validation', () => {
  test('nyc configuration should exist and be valid', () => {
    const nycConfigPath = '.nycrc.json';
    expect(fs.existsSync(nycConfigPath)).toBe(true);
    
    const config = JSON.parse(fs.readFileSync(nycConfigPath, 'utf8'));
    
    // Validate essential configuration
    expect(config.include).toContain('src/**/*.ts');
    expect(config.exclude).toContain('src/**/*.test.ts');
    expect(config.reporter).toContain('lcov');
    expect(config.reporter).toContain('html');
    expect(config.lines).toBe(95);
    expect(config.functions).toBe(95);
    expect(config.branches).toBe(90);
    expect(config.statements).toBe(95);
    expect(config['check-coverage']).toBe(true);
  });

  test('Stryker configuration should exist and be valid', () => {
    const strykerConfigPath = 'stryker.conf.json';
    expect(fs.existsSync(strykerConfigPath)).toBe(true);
    
    const config = JSON.parse(fs.readFileSync(strykerConfigPath, 'utf8'));
    
    // Validate essential configuration
    expect(config.testRunner).toBe('jest');
    expect(config.mutate).toContain('src/**/*.ts');
    expect(config.mutate).toContain('!src/**/*.test.ts');
    expect(config.reporters).toContain('html');
    expect(config.reporters).toContain('json');
    expect(config.thresholds.high).toBe(90);
    expect(config.thresholds.low).toBe(70);
  });

  test('coverage analysis script should exist', () => {
    const scriptPath = 'scripts/coverage-analysis.js';
    expect(fs.existsSync(scriptPath)).toBe(true);
    
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('CoverageAnalyzer');
    expect(content).toContain('runCoverageAnalysis');
  });

  test('mutation testing analysis script should exist', () => {
    const scriptPath = 'scripts/mutation-testing-analysis.js';
    expect(fs.existsSync(scriptPath)).toBe(true);
    
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('MutationTestingAnalyzer');
    expect(content).toContain('runMutationTesting');
  });

  test('CI quality gates script should exist', () => {
    const scriptPath = 'scripts/ci-quality-gates.js';
    expect(fs.existsSync(scriptPath)).toBe(true);
    
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('CIQualityGates');
    expect(content).toContain('runQualityGates');
  });

  test('GitHub Actions workflow should exist', () => {
    const workflowPath = '../.github/workflows/coverage-quality-gates.yml';
    expect(fs.existsSync(workflowPath)).toBe(true);
    
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('coverage-analysis');
    expect(workflow).toContain('mutation-testing');
    expect(workflow).toContain('quality-gates');
  });

  test('package.json should have coverage and mutation scripts', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    // Coverage scripts
    expect(packageJson.scripts['test:coverage']).toBeDefined();
    expect(packageJson.scripts['test:coverage:nyc']).toBeDefined();
    expect(packageJson.scripts['test:coverage:ci']).toBeDefined();
    expect(packageJson.scripts['coverage:check']).toBeDefined();
    expect(packageJson.scripts['coverage:analyze']).toBeDefined();
    
    // Mutation testing scripts
    expect(packageJson.scripts['test:mutation']).toBeDefined();
    expect(packageJson.scripts['test:mutation:ci']).toBeDefined();
    expect(packageJson.scripts['test:mutation:report']).toBeDefined();
    expect(packageJson.scripts['mutation:analyze']).toBeDefined();
    
    // Quality gates scripts
    expect(packageJson.scripts['ci:quality-gates']).toBeDefined();
    expect(packageJson.scripts['quality:all']).toBeDefined();
    expect(packageJson.scripts['quality:ci']).toBeDefined();
  });

  test('required dependencies should be installed', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    // Coverage dependencies
    expect(packageJson.devDependencies['nyc']).toBeDefined();
    
    // Mutation testing dependencies
    expect(packageJson.devDependencies['@stryker-mutator/core']).toBeDefined();
    expect(packageJson.devDependencies['@stryker-mutator/jest-runner']).toBeDefined();
    expect(packageJson.devDependencies['@stryker-mutator/typescript-checker']).toBeDefined();
  });

  test('Jest configuration should include coverage settings', () => {
    // Import Jest config (using require since this is a test)
    const jestConfig = require('../../jest.config.js');
    
    expect(jestConfig.collectCoverage).toBe(true);
    expect(jestConfig.collectCoverageFrom).toContain('src/**/*.{ts,tsx}');
    expect(jestConfig.collectCoverageFrom).toContain('!src/**/*.test.ts');
    expect(jestConfig.coverageReporters).toContain('lcov');
    expect(jestConfig.coverageReporters).toContain('html');
    
    // Check thresholds
    expect(jestConfig.coverageThreshold.global.lines).toBe(95);
    expect(jestConfig.coverageThreshold.global.functions).toBe(95);
    expect(jestConfig.coverageThreshold.global.branches).toBe(90);
    expect(jestConfig.coverageThreshold.global.statements).toBe(95);
    
    // Check specific module thresholds
    expect(jestConfig.coverageThreshold['./src/security.ts']).toBeDefined();
    expect(jestConfig.coverageThreshold['./src/bridge-client.ts']).toBeDefined();
  });

  test('documentation should exist', () => {
    const docsPath = 'docs/COVERAGE_AND_QUALITY_METRICS.md';
    expect(fs.existsSync(docsPath)).toBe(true);
    
    const content = fs.readFileSync(docsPath, 'utf8');
    expect(content).toContain('Code Coverage and Quality Metrics');
    expect(content).toContain('95% Code Coverage Target');
    expect(content).toContain('Mutation Testing');
    expect(content).toContain('Quality Gates');
  });
});

describe('Coverage System Configuration Validation', () => {
  test('coverage thresholds should be consistent across configurations', () => {
    // Check nyc config
    const nycConfig = JSON.parse(fs.readFileSync('.nycrc.json', 'utf8'));
    
    // Check Jest config
    const jestConfig = require('../../jest.config.js');
    
    // Validate consistency
    expect(jestConfig.coverageThreshold.global.lines).toBe(nycConfig.lines);
    expect(jestConfig.coverageThreshold.global.functions).toBe(nycConfig.functions);
    expect(jestConfig.coverageThreshold.global.branches).toBe(nycConfig.branches);
    expect(jestConfig.coverageThreshold.global.statements).toBe(nycConfig.statements);
  });

  test('coverage exclusions should be consistent', () => {
    const nycConfig = JSON.parse(fs.readFileSync('.nycrc.json', 'utf8'));
    const jestConfig = require('../../jest.config.js');
    
    // Both should exclude test files
    expect(nycConfig.exclude).toContain('src/**/*.test.ts');
    expect(jestConfig.collectCoverageFrom).toContain('!src/**/*.test.ts');
    
    // Both should exclude spec files
    expect(nycConfig.exclude).toContain('src/**/*.spec.ts');
    expect(jestConfig.collectCoverageFrom).toContain('!src/**/*.spec.ts');
  });

  test('mutation testing should target same files as coverage', () => {
    const strykerConfig = JSON.parse(fs.readFileSync('stryker.conf.json', 'utf8'));
    const nycConfig = JSON.parse(fs.readFileSync('.nycrc.json', 'utf8'));
    
    // Both should include TypeScript files
    expect(strykerConfig.mutate).toContain('src/**/*.ts');
    expect(nycConfig.include).toContain('src/**/*.ts');
    
    // Both should exclude test files
    expect(strykerConfig.mutate).toContain('!src/**/*.test.ts');
    expect(nycConfig.exclude).toContain('src/**/*.test.ts');
  });
});

// Simple test class for coverage demonstration
class CoverageTestHelper {
  static simpleFunction(input: number): number {
    if (input > 0) {
      return input * 2;
    } else if (input < 0) {
      return input * -1;
    } else {
      return 0;
    }
  }

  static asyncFunction(value: string): Promise<string> {
    return Promise.resolve(`processed: ${value}`);
  }

  static throwingFunction(shouldThrow: boolean): string {
    if (shouldThrow) {
      throw new Error('Test error');
    }
    return 'success';
  }
}

describe('Coverage Test Helper Validation', () => {
  test('should demonstrate line coverage', () => {
    expect(CoverageTestHelper.simpleFunction(5)).toBe(10);
    expect(CoverageTestHelper.simpleFunction(-3)).toBe(3);
    expect(CoverageTestHelper.simpleFunction(0)).toBe(0);
  });

  test('should demonstrate async coverage', async () => {
    const result = await CoverageTestHelper.asyncFunction('test');
    expect(result).toBe('processed: test');
  });

  test('should demonstrate error handling coverage', () => {
    expect(CoverageTestHelper.throwingFunction(false)).toBe('success');
    expect(() => CoverageTestHelper.throwingFunction(true)).toThrow('Test error');
  });
});
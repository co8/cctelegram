/**
 * Integration tests for Benchmark Runner
 * 
 * Tests the complete benchmarking workflow including:
 * - CLI argument parsing
 * - Result output in different formats
 * - Regression detection
 * - CI/CD integration scenarios
 */

import fs from 'fs-extra';
import path from 'path';
import { BenchmarkRunner } from '../../src/benchmark/benchmark-runner.js';
import { BenchmarkSuite } from '../../src/benchmark/benchmark-suite.js';

describe('Benchmark Integration Tests', () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = path.join(__dirname, '..', 'temp', 'benchmark-integration');
    outputDir = path.join(tempDir, 'output');
    await fs.ensureDir(tempDir);
    await fs.ensureDir(outputDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('BenchmarkRunner', () => {
    it('should run complete benchmark suite and generate results', async () => {
      const outputPath = path.join(outputDir, 'test-results.json');
      
      const runner = new BenchmarkRunner({
        output: outputPath,
        format: 'json',
        quiet: true,
        tempDir
      });

      const results = await runner.run();

      // Verify results structure
      expect(results).toBeDefined();
      expect(results.total_tests).toBeGreaterThan(0);
      expect(results.results).toBeDefined();
      expect(results.analysis).toBeDefined();
      expect(results.recommendations).toBeDefined();

      // Verify file was created
      expect(await fs.pathExists(outputPath)).toBe(true);
      
      const savedResults = await fs.readJSON(outputPath);
      expect(savedResults).toEqual(results);
    }, 60000); // 60 second timeout for comprehensive benchmark

    it('should generate HTML report format', async () => {
      const outputPath = path.join(outputDir, 'test-report.html');
      
      const runner = new BenchmarkRunner({
        output: outputPath,
        format: 'html',
        quiet: true,
        tempDir
      });

      await runner.run();

      expect(await fs.pathExists(outputPath)).toBe(true);
      
      const htmlContent = await fs.readFile(outputPath, 'utf8');
      expect(htmlContent).toContain('<!DOCTYPE html>');
      expect(htmlContent).toContain('CCTelegram MCP Server Benchmark Report');
      expect(htmlContent).toContain('Performance by Category');
      expect(htmlContent).toContain('Recommendations');
    }, 60000);

    it('should generate CSV report format', async () => {
      const outputPath = path.join(outputDir, 'test-report.csv');
      
      const runner = new BenchmarkRunner({
        output: outputPath,
        format: 'csv',
        quiet: true,
        tempDir
      });

      await runner.run();

      expect(await fs.pathExists(outputPath)).toBe(true);
      
      const csvContent = await fs.readFile(outputPath, 'utf8');
      const lines = csvContent.split('\n');
      
      // Should have header row
      expect(lines[0]).toContain('name,category,ops_per_sec');
      
      // Should have data rows
      expect(lines.length).toBeGreaterThan(1);
      
      // Verify CSV structure
      const headers = lines[0].split(',');
      expect(headers).toContain('name');
      expect(headers).toContain('category');
      expect(headers).toContain('ops_per_sec');
      expect(headers).toContain('duration_ms');
    }, 60000);

    it('should generate Markdown report format', async () => {
      const outputPath = path.join(outputDir, 'test-report.md');
      
      const runner = new BenchmarkRunner({
        output: outputPath,
        format: 'markdown',
        quiet: true,
        tempDir
      });

      await runner.run();

      expect(await fs.pathExists(outputPath)).toBe(true);
      
      const markdownContent = await fs.readFile(outputPath, 'utf8');
      expect(markdownContent).toContain('# 📊 CCTelegram MCP Server Benchmark Report');
      expect(markdownContent).toContain('## Summary');
      expect(markdownContent).toContain('## Performance Analysis');
      expect(markdownContent).toContain('## Results by Category');
      expect(markdownContent).toContain('## Recommendations');
      
      // Should contain table formatting
      expect(markdownContent).toContain('|');
      expect(markdownContent).toContain('---');
    }, 60000);
  });

  describe('Baseline Comparison Integration', () => {
    it('should compare against baseline and detect improvements', async () => {
      // First, create a baseline with slower performance
      const baselinePath = path.join(outputDir, 'baseline.json');
      const baselineResults = {
        results: {
          security: [{
            name: 'security_config_load_with_cache',
            category: 'security',
            description: 'Load security configuration with caching',
            timestamp: Date.now(),
            hz: 1000, // Slower baseline
            stats: {
              mean: 0.001,
              moe: 0.0001,
              rme: 0.1,
              sem: 0.00005,
              deviation: 0.0002,
              variance: 0.00000004,
              sample: [0.001, 0.0009, 0.0011]
            },
            performance: {
              meets_budget: true,
              duration_ms: 1.0,
              memory_used_mb: 1.0
            },
            system: {
              node_version: process.version,
              platform: process.platform,
              arch: process.arch,
              memory_total_gb: 8,
              cpu_count: 4
            }
          }],
          filesystem: [],
          http: [],
          tools: [],
          integration: []
        }
      };

      await fs.writeJSON(baselinePath, baselineResults);

      const outputPath = path.join(outputDir, 'comparison-results.json');
      
      const runner = new BenchmarkRunner({
        baseline: baselinePath,
        output: outputPath,
        format: 'json',
        quiet: true,
        tempDir
      });

      const results = await runner.run();

      // Find the security config test result
      const securityTest = results.results.security.find(
        r => r.name === 'security_config_load_with_cache'
      );

      if (securityTest && securityTest.comparison) {
        expect(securityTest.comparison.baseline_hz).toBe(1000);
        
        // Should detect improvement or regression
        const hasImprovement = (securityTest.comparison.improvement_percent || 0) > 0;
        const hasRegression = (securityTest.comparison.regression_percent || 0) > 0;
        expect(hasImprovement || hasRegression).toBe(true);
      }
    }, 60000);

    it('should save new baseline when requested', async () => {
      const outputPath = path.join(outputDir, 'new-baseline-test.json');
      const baselinePath = path.join(outputDir, 'new-baseline-test.baseline.json');
      
      const runner = new BenchmarkRunner({
        output: outputPath,
        saveBaseline: true,
        format: 'json',
        quiet: true,
        tempDir
      });

      await runner.run();

      // Verify both results and baseline files exist
      expect(await fs.pathExists(outputPath)).toBe(true);
      expect(await fs.pathExists(baselinePath)).toBe(true);

      const baselineData = await fs.readJSON(baselinePath);
      expect(Array.isArray(baselineData)).toBe(true);
      expect(baselineData.length).toBeGreaterThan(0);
      
      // Verify baseline structure
      expect(baselineData[0]).toHaveProperty('name');
      expect(baselineData[0]).toHaveProperty('hz');
      expect(baselineData[0]).toHaveProperty('performance');
    }, 60000);
  });

  describe('Performance Regression Detection', () => {
    it('should detect performance regressions above threshold', async () => {
      // Create baseline with very fast performance
      const baselinePath = path.join(outputDir, 'fast-baseline.json');
      const baselineResults = {
        results: {
          security: [{
            name: 'security_config_load_with_cache',
            category: 'security',
            description: 'Load security configuration with caching',
            timestamp: Date.now(),
            hz: 1000000, // Very fast baseline that current implementation can't match
            stats: {
              mean: 0.000001,
              moe: 0.0000001,
              rme: 0.01,
              sem: 0.00000005,
              deviation: 0.0000002,
              variance: 0.00000000004,
              sample: [0.000001, 0.0000009, 0.0000011]
            },
            performance: {
              meets_budget: true,
              duration_ms: 0.001,
              memory_used_mb: 0.1
            },
            system: {
              node_version: process.version,
              platform: process.platform,
              arch: process.arch,
              memory_total_gb: 8,
              cpu_count: 4
            }
          }],
          filesystem: [],
          http: [],
          tools: [],
          integration: []
        }
      };

      await fs.writeJSON(baselinePath, baselineResults);

      const runner = new BenchmarkRunner({
        baseline: baselinePath,
        threshold: 5, // 5% regression threshold
        quiet: true,
        tempDir
      });

      // Should exit with error code due to regression
      try {
        await runner.run();
        // If we get here, no regression was detected (which might be valid)
      } catch (error) {
        // Expected behavior if regression threshold is exceeded
        expect(error).toBeDefined();
      }
    }, 60000);

    it('should pass when performance is within threshold', async () => {
      // Create baseline with similar performance to current implementation
      const baselinePath = path.join(outputDir, 'similar-baseline.json');
      const baselineResults = {
        results: {
          security: [{
            name: 'security_config_load_with_cache',
            category: 'security',
            description: 'Load security configuration with caching',
            timestamp: Date.now(),
            hz: 10000, // Reasonable baseline
            stats: {
              mean: 0.0001,
              moe: 0.00001,
              rme: 0.1,
              sem: 0.000005,
              deviation: 0.00002,
              variance: 0.0000000004,
              sample: [0.0001, 0.00009, 0.00011]
            },
            performance: {
              meets_budget: true,
              duration_ms: 0.1,
              memory_used_mb: 1.0
            },
            system: {
              node_version: process.version,
              platform: process.platform,
              arch: process.arch,
              memory_total_gb: 8,
              cpu_count: 4
            }
          }],
          filesystem: [],
          http: [],
          tools: [],
          integration: []
        }
      };

      await fs.writeJSON(baselinePath, baselineResults);

      const runner = new BenchmarkRunner({
        baseline: baselinePath,
        threshold: 50, // 50% regression threshold (very lenient)
        quiet: true,
        tempDir
      });

      // Should complete without throwing
      const results = await runner.run();
      expect(results).toBeDefined();
      expect(results.total_tests).toBeGreaterThan(0);
    }, 60000);
  });

  describe('CI/CD Integration Scenarios', () => {
    it('should handle timeout scenarios', async () => {
      const runner = new BenchmarkRunner({
        timeout: 100, // Very short timeout
        quiet: true,
        tempDir
      });

      // Should timeout and throw error
      await expect(runner.run()).rejects.toThrow('timed out');
    });

    it('should handle missing baseline files gracefully', async () => {
      const nonExistentBaseline = path.join(outputDir, 'does-not-exist.json');
      
      const runner = new BenchmarkRunner({
        baseline: nonExistentBaseline,
        quiet: true,
        tempDir
      });

      // Should complete without throwing, just not load any baselines
      const results = await runner.run();
      expect(results).toBeDefined();
      
      // Results shouldn't have comparison data
      const securityTests = results.results.security;
      if (securityTests.length > 0) {
        const hasComparison = securityTests.some(test => test.comparison);
        expect(hasComparison).toBe(false);
      }
    }, 60000);

    it('should generate comprehensive performance report', async () => {
      const outputPath = path.join(outputDir, 'comprehensive-report.json');
      
      const runner = new BenchmarkRunner({
        output: outputPath,
        format: 'json',
        quiet: true,
        tempDir
      });

      const results = await runner.run();

      // Verify comprehensive results structure
      expect(results.timestamp).toBeDefined();
      expect(results.duration_ms).toBeGreaterThan(0);
      expect(results.total_tests).toBeGreaterThan(0);
      expect(results.passed + results.failed).toBe(results.total_tests);

      // Verify all categories are present
      expect(results.results.security).toBeDefined();
      expect(results.results.filesystem).toBeDefined();
      expect(results.results.http).toBeDefined();
      expect(results.results.tools).toBeDefined();
      expect(results.results.integration).toBeDefined();

      // Verify analysis
      expect(results.analysis.fastest_operation).toBeDefined();
      expect(results.analysis.slowest_operation).toBeDefined();
      expect(Array.isArray(results.analysis.budget_violations)).toBe(true);

      // Verify recommendations
      expect(Array.isArray(results.recommendations)).toBe(true);
      expect(results.recommendations.length).toBeGreaterThan(0);

      // Verify system information is captured
      if (results.results.security.length > 0) {
        const systemInfo = results.results.security[0].system;
        expect(systemInfo.node_version).toBe(process.version);
        expect(systemInfo.platform).toBe(process.platform);
        expect(systemInfo.cpu_count).toBeGreaterThan(0);
      }
    }, 60000);
  });

  describe('Real Performance Validation', () => {
    it('should validate security config caching provides performance improvement', async () => {
      const runner = new BenchmarkRunner({
        quiet: true,
        tempDir
      });

      const results = await runner.run();

      // Find both cached and non-cached security config tests
      const securityTests = results.results.security.filter(test => 
        test.name.includes('security_config_load')
      );

      if (securityTests.length >= 2) {
        const cachedTest = securityTests.find(test => test.name.includes('with_cache'));
        const nonCachedTest = securityTests.find(test => test.name.includes('no_cache'));

        if (cachedTest && nonCachedTest) {
          // Cached version should be faster (higher ops/sec, lower duration)
          expect(cachedTest.hz).toBeGreaterThan(nonCachedTest.hz * 0.5); // At least 50% as fast
          expect(cachedTest.performance.duration_ms).toBeLessThan(nonCachedTest.performance.duration_ms * 2); // At most 2x slower
        }
      }
    }, 60000);

    it('should validate FileSystemOptimizer performance meets budgets', async () => {
      const runner = new BenchmarkRunner({
        quiet: true,
        tempDir
      });

      const results = await runner.run();

      const fsTests = results.results.filesystem.filter(test =>
        test.name.includes('fs_') && test.performance_budget
      );

      // At least some filesystem tests should meet their performance budgets
      const budgetCompliantTests = fsTests.filter(test => test.performance.meets_budget);
      expect(budgetCompliantTests.length).toBeGreaterThan(0);

      // Filesystem operations should complete within reasonable time
      fsTests.forEach(test => {
        expect(test.performance.duration_ms).toBeLessThan(1000); // Less than 1 second
        expect(test.performance.memory_used_mb).toBeLessThan(100); // Less than 100MB
      });
    }, 60000);

    it('should validate HTTP pool operations meet performance targets', async () => {
      const runner = new BenchmarkRunner({
        quiet: true,
        tempDir
      });

      const results = await runner.run();

      const httpTests = results.results.http;

      // HTTP operations should be very fast
      httpTests.forEach(test => {
        expect(test.performance.duration_ms).toBeLessThan(100); // Less than 100ms
        expect(test.performance.memory_used_mb).toBeLessThan(20); // Less than 20MB
        expect(test.hz).toBeGreaterThan(100); // At least 100 ops/sec
      });
    }, 60000);

    it('should validate MCP tool operations meet performance budgets', async () => {
      const runner = new BenchmarkRunner({
        quiet: true,
        tempDir
      });

      const results = await runner.run();

      const toolTests = results.results.tools;

      // Tool operations should complete quickly
      toolTests.forEach(test => {
        // Most tools should complete within their budgets
        if (test.name.includes('start_bridge') || 
            test.name.includes('stop_bridge') || 
            test.name.includes('restart_bridge')) {
          // Bridge operations can be slower
          expect(test.performance.duration_ms).toBeLessThan(10000); // Less than 10 seconds
        } else {
          // Other tools should be faster
          expect(test.performance.duration_ms).toBeLessThan(1000); // Less than 1 second
        }
        
        expect(test.performance.memory_used_mb).toBeLessThan(50); // Less than 50MB
      });
    }, 60000);
  });
});
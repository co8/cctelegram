/**
 * Unit tests for BenchmarkSuite
 * 
 * Tests the benchmarking functionality including:
 * - Test configuration and initialization
 * - Individual benchmark execution
 * - Results analysis and comparison
 * - Performance budget validation
 * - Baseline comparison functionality
 */

import fs from 'fs-extra';
import path from 'path';
import { BenchmarkSuite, BenchmarkConfig, BenchmarkResult } from '../../src/benchmark/benchmark-suite.js';
import { loadSecurityConfig, invalidateSecurityConfigCache } from '../../src/security.js';
import { getFsOptimizer, destroyFsOptimizer } from '../../src/utils/fs-optimizer.js';

describe('BenchmarkSuite', () => {
  let suite: BenchmarkSuite;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(__dirname, '..', 'temp', 'benchmark-test');
    await fs.ensureDir(tempDir);
    suite = new BenchmarkSuite(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    destroyFsOptimizer();
    invalidateSecurityConfigCache();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      expect(suite).toBeDefined();
      expect(suite.listenerCount('suite_started')).toBe(0);
    });

    it('should accept custom temp directory', () => {
      const customTempDir = path.join(__dirname, 'custom-temp');
      const customSuite = new BenchmarkSuite(customTempDir);
      expect(customSuite).toBeDefined();
    });

    it('should emit events during benchmark execution', (done) => {
      suite.on('suite_started', (data) => {
        expect(data).toHaveProperty('total_tests');
        expect(typeof data.total_tests).toBe('number');
        done();
      });

      // Create a minimal test to trigger suite_started
      suite['tests'] = [{
        name: 'test_minimal',
        description: 'Minimal test',
        category: 'security',
        fn: () => Promise.resolve('test')
      }];

      suite.runAll().catch(() => {}); // Ignore errors for this test
    });
  });

  describe('Security Benchmarks', () => {
    it('should benchmark security config loading without cache', async () => {
      // Create a simple benchmark config
      const testConfig: BenchmarkConfig = {
        name: 'security_config_no_cache_test',
        description: 'Test security config loading without cache',
        category: 'security',
        setup: async () => {
          invalidateSecurityConfigCache();
        },
        fn: () => loadSecurityConfig(true),
        performance_budget: {
          max_duration_ms: 50,
          max_memory_mb: 10
        }
      };

      // Mock the tests array with our test config
      suite['tests'] = [testConfig];

      const results = await suite.runAll();

      expect(results.total_tests).toBe(1);
      expect(results.passed).toBe(1);
      expect(results.failed).toBe(0);
      expect(results.results.security).toHaveLength(1);

      const result = results.results.security[0];
      expect(result.name).toBe('security_config_no_cache_test');
      expect(result.category).toBe('security');
      expect(result.hz).toBeGreaterThan(0);
      expect(result.performance.duration_ms).toBeGreaterThan(0);
    });

    it('should benchmark security config loading with cache', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'security_config_with_cache_test',
        description: 'Test security config loading with cache',
        category: 'security',
        setup: async () => {
          // Prime the cache
          loadSecurityConfig(true);
        },
        fn: () => loadSecurityConfig(false),
        performance_budget: {
          max_duration_ms: 5,
          max_memory_mb: 5
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1);
      const result = results.results.security[0];
      expect(result.performance.duration_ms).toBeLessThan(50); // Should be faster with cache
    });
  });

  describe('File System Benchmarks', () => {
    it('should benchmark directory listing operations', async () => {
      // Create test files
      const testFilesDir = path.join(tempDir, 'test-files');
      await fs.ensureDir(testFilesDir);
      
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(
          path.join(testFilesDir, `test-file-${i}.txt`),
          `Test content ${i}`
        );
      }

      const testConfig: BenchmarkConfig = {
        name: 'fs_directory_listing_test',
        description: 'Test directory listing performance',
        category: 'filesystem',
        fn: async () => {
          const files = await fs.readdir(testFilesDir);
          const stats = await Promise.all(
            files.map(file => fs.stat(path.join(testFilesDir, file)))
          );
          return { files, stats };
        },
        performance_budget: {
          max_duration_ms: 100,
          max_memory_mb: 10
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1);
      const result = results.results.filesystem[0];
      expect(result.hz).toBeGreaterThan(0);
      expect(result.performance.meets_budget).toBe(true);
    });

    it('should benchmark FileSystemOptimizer operations', async () => {
      // Create test files
      const testFilesDir = path.join(tempDir, 'optimizer-test');
      await fs.ensureDir(testFilesDir);
      
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(
          path.join(testFilesDir, `opt-test-${i}.txt`),
          `Optimizer test content ${i}`
        );
      }

      const testConfig: BenchmarkConfig = {
        name: 'fs_optimizer_test',
        description: 'Test FileSystemOptimizer performance',
        category: 'filesystem',
        fn: async () => {
          const optimizer = getFsOptimizer();
          return await optimizer.getCachedDirectoryListing(testFilesDir);
        },
        teardown: async () => {
          destroyFsOptimizer();
        },
        performance_budget: {
          max_duration_ms: 50,
          max_memory_mb: 10
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1);
      const result = results.results.filesystem[0];
      expect(result.name).toBe('fs_optimizer_test');
      expect(result.hz).toBeGreaterThan(0);
    });
  });

  describe('HTTP Pool Benchmarks', () => {
    it('should benchmark HTTP pool configuration', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'http_pool_config_test',
        description: 'Test HTTP pool configuration performance',
        category: 'http',
        fn: () => {
          // Import inside the function to avoid module loading issues
          const { HttpConnectionPool } = require('../../src/http-pool.js');
          const pool = new HttpConnectionPool();
          
          const configs = [];
          for (let i = 0; i < 5; i++) {
            configs.push(pool.getAxiosConfig('health', 'http://localhost:8080/test'));
          }
          
          pool.destroy();
          return configs;
        },
        performance_budget: {
          max_duration_ms: 20,
          max_memory_mb: 5
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1);
      const result = results.results.http[0];
      expect(result.hz).toBeGreaterThan(0);
      expect(result.performance.meets_budget).toBe(true);
    });
  });

  describe('Performance Budget Validation', () => {
    it('should detect budget violations', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'budget_violation_test',
        description: 'Test that should violate performance budget',
        category: 'security',
        fn: async () => {
          // Simulate a slow operation
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'slow operation complete';
        },
        performance_budget: {
          max_duration_ms: 1, // Very strict budget to force violation
          max_memory_mb: 1
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1); // Test still passes, but budget is violated
      const result = results.results.security[0];
      expect(result.performance.meets_budget).toBe(false);
      expect(results.analysis.budget_violations).toContain(result);
    });

    it('should validate budget compliance', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'budget_compliant_test',
        description: 'Test that should comply with performance budget',
        category: 'security',
        fn: () => 'fast operation',
        performance_budget: {
          max_duration_ms: 100,
          max_memory_mb: 10
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1);
      const result = results.results.security[0];
      expect(result.performance.meets_budget).toBe(true);
      expect(results.analysis.budget_violations).not.toContain(result);
    });
  });

  describe('Baseline Comparison', () => {
    it('should load and compare against baselines', async () => {
      // Create baseline data
      const baselineData: BenchmarkResult[] = [{
        name: 'baseline_test',
        category: 'security',
        description: 'Baseline test',
        timestamp: Date.now(),
        hz: 1000, // 1000 ops/sec baseline
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
      }];

      const baselinePath = path.join(tempDir, 'baseline.json');
      await fs.writeJSON(baselinePath, baselineData);

      // Load baseline
      await suite.loadBaselines(baselinePath);

      // Create test that should show improvement
      const testConfig: BenchmarkConfig = {
        name: 'baseline_test',
        description: 'Test for baseline comparison',
        category: 'security',
        fn: () => 'fast operation', // Should be faster than baseline
        performance_budget: {
          max_duration_ms: 10,
          max_memory_mb: 5
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1);
      const result = results.results.security[0];
      expect(result.comparison).toBeDefined();
      expect(result.comparison!.baseline_hz).toBe(1000);
      
      // The new test should likely be faster, showing improvement
      if (result.hz > 1000) {
        expect(result.comparison!.improvement_percent).toBeGreaterThan(0);
      }
    });

    it('should save results as baselines', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'save_baseline_test',
        description: 'Test to save as baseline',
        category: 'security',
        fn: () => 'operation to save',
        performance_budget: {
          max_duration_ms: 10,
          max_memory_mb: 5
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      const baselinePath = path.join(tempDir, 'new-baseline.json');
      await suite.saveBaselines(baselinePath);

      expect(await fs.pathExists(baselinePath)).toBe(true);
      
      const savedBaseline = await fs.readJSON(baselinePath);
      expect(Array.isArray(savedBaseline)).toBe(true);
      expect(savedBaseline).toHaveLength(1);
      expect(savedBaseline[0].name).toBe('save_baseline_test');
    });
  });

  describe('Results Analysis', () => {
    it('should analyze benchmark results correctly', async () => {
      const testConfigs: BenchmarkConfig[] = [
        {
          name: 'fast_test',
          description: 'Fast operation',
          category: 'security',
          fn: () => 'fast',
          performance_budget: { max_duration_ms: 10, max_memory_mb: 5 }
        },
        {
          name: 'slow_test',
          description: 'Slow operation',
          category: 'filesystem',
          fn: async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return 'slow';
          },
          performance_budget: { max_duration_ms: 100, max_memory_mb: 10 }
        }
      ];

      suite['tests'] = testConfigs;
      const results = await suite.runAll();

      expect(results.analysis.fastest_operation).toBeDefined();
      expect(results.analysis.slowest_operation).toBeDefined();
      
      // Fast test should be faster
      expect(results.analysis.fastest_operation.name).toBe('fast_test');
      expect(results.analysis.slowest_operation.name).toBe('slow_test');
      
      expect(results.recommendations).toBeDefined();
      expect(Array.isArray(results.recommendations)).toBe(true);
    });

    it('should categorize results correctly', async () => {
      const testConfigs: BenchmarkConfig[] = [
        {
          name: 'security_test',
          description: 'Security operation',
          category: 'security',
          fn: () => 'security',
          performance_budget: { max_duration_ms: 10, max_memory_mb: 5 }
        },
        {
          name: 'filesystem_test',
          description: 'Filesystem operation',
          category: 'filesystem',
          fn: () => 'filesystem',
          performance_budget: { max_duration_ms: 10, max_memory_mb: 5 }
        },
        {
          name: 'http_test',
          description: 'HTTP operation',
          category: 'http',
          fn: () => 'http',
          performance_budget: { max_duration_ms: 10, max_memory_mb: 5 }
        }
      ];

      suite['tests'] = testConfigs;
      const results = await suite.runAll();

      expect(results.results.security).toHaveLength(1);
      expect(results.results.filesystem).toHaveLength(1);
      expect(results.results.http).toHaveLength(1);
      expect(results.results.tools).toHaveLength(0);
      expect(results.results.integration).toHaveLength(0);

      expect(results.results.security[0].name).toBe('security_test');
      expect(results.results.filesystem[0].name).toBe('filesystem_test');
      expect(results.results.http[0].name).toBe('http_test');
    });
  });

  describe('Error Handling', () => {
    it('should handle test failures gracefully', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'failing_test',
        description: 'Test that should fail',
        category: 'security',
        fn: () => {
          throw new Error('Intentional test failure');
        },
        performance_budget: {
          max_duration_ms: 10,
          max_memory_mb: 5
        }
      };

      suite['tests'] = [testConfig];

      // Should not throw, but should record the failure
      const results = await suite.runAll();

      expect(results.failed).toBe(1);
      expect(results.passed).toBe(0);
      expect(results.total_tests).toBe(1);
    });

    it('should handle setup and teardown errors', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'setup_error_test',
        description: 'Test with failing setup',
        category: 'security',
        setup: async () => {
          throw new Error('Setup failed');
        },
        fn: () => 'should not run',
        performance_budget: {
          max_duration_ms: 10,
          max_memory_mb: 5
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.failed).toBe(1);
      expect(results.passed).toBe(0);
    });
  });

  describe('System Information', () => {
    it('should capture system information in results', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'system_info_test',
        description: 'Test system info capture',
        category: 'security',
        fn: () => 'test',
        performance_budget: {
          max_duration_ms: 10,
          max_memory_mb: 5
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1);
      const result = results.results.security[0];
      
      expect(result.system).toBeDefined();
      expect(result.system.node_version).toBe(process.version);
      expect(result.system.platform).toBe(process.platform);
      expect(result.system.arch).toBe(process.arch);
      expect(result.system.cpu_count).toBeGreaterThan(0);
      expect(result.system.memory_total_gb).toBeGreaterThan(0);
    });
  });

  describe('Memory Management', () => {
    it('should track memory usage during tests', async () => {
      const testConfig: BenchmarkConfig = {
        name: 'memory_tracking_test',
        description: 'Test memory usage tracking',
        category: 'security',
        fn: () => {
          // Create some memory usage
          const largeArray = new Array(1000).fill('memory test data');
          return largeArray.length;
        },
        performance_budget: {
          max_duration_ms: 50,
          max_memory_mb: 10
        }
      };

      suite['tests'] = [testConfig];
      const results = await suite.runAll();

      expect(results.passed).toBe(1);
      const result = results.results.security[0];
      
      expect(result.performance.memory_used_mb).toBeDefined();
      expect(typeof result.performance.memory_used_mb).toBe('number');
      // Memory usage should be tracked (could be positive or negative due to GC)
      expect(Number.isFinite(result.performance.memory_used_mb)).toBe(true);
    });
  });
});
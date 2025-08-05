/**
 * Comprehensive Benchmarking Suite for CCTelegram MCP Server
 * 
 * Provides performance benchmarking for all critical operations including:
 * - Security config loading (before/after caching)
 * - HTTP connection pooling optimizations
 * - File system operations (with and without batching)
 * - Event processing pipeline
 * - All 16 MCP tool executions
 * 
 * Uses benchmark.js for accurate performance measurements with statistical significance.
 */

import Benchmark from 'benchmark';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import components to benchmark
import { 
  loadSecurityConfig, 
  invalidateSecurityConfigCache,
  getSecurityConfigCacheStats,
  validateInput,
  withSecurity,
  SecurityContext
} from '../security.js';
import { 
  HttpConnectionPool, 
  getBridgeAxiosConfig, 
  getHttpPool,
  PoolType 
} from '../http-pool.js';
import { 
  FileSystemOptimizer, 
  getFsOptimizer, 
  destroyFsOptimizer 
} from '../utils/fs-optimizer.js';
import { CCTelegramBridgeClient } from '../bridge-client.js';
import { EnhancedPerformanceMonitor } from '../observability/performance/enhanced-performance-monitor.js';
import { secureLog } from '../security.js';

/**
 * Benchmark test configuration
 */
export interface BenchmarkConfig {
  name: string;
  description: string;
  category: 'security' | 'filesystem' | 'http' | 'tools' | 'integration';
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  fn: () => Promise<any> | any;
  options?: {
    minSamples?: number;
    maxTime?: number;
    delay?: number;
    initCount?: number;
  };
  performance_budget?: {
    max_duration_ms: number;
    max_memory_mb: number;
  };
}

/**
 * Benchmark results with detailed metrics
 */
export interface BenchmarkResult {
  name: string;
  category: string;
  description: string;
  timestamp: number;
  
  // Core benchmark metrics
  hz: number; // Operations per second
  stats: {
    mean: number;
    moe: number; // Margin of error
    rme: number; // Relative margin of error
    sem: number; // Standard error of mean
    deviation: number;
    variance: number;
    sample: number[]; // All sample times
  };
  
  // Performance analysis
  performance: {
    meets_budget: boolean;
    duration_ms: number;
    memory_used_mb: number;
    cpu_usage_percent?: number;
  };
  
  // Comparison metrics
  comparison?: {
    baseline_hz?: number;
    improvement_percent?: number;
    regression_percent?: number;
  };
  
  // System context
  system: {
    node_version: string;
    platform: string;
    arch: string;
    memory_total_gb: number;
    cpu_count: number;
  };
}

/**
 * Comprehensive benchmark suite results
 */
export interface BenchmarkSuiteResults {
  timestamp: number;
  duration_ms: number;
  total_tests: number;
  passed: number;
  failed: number;
  
  // Categorized results
  results: {
    security: BenchmarkResult[];
    filesystem: BenchmarkResult[];
    http: BenchmarkResult[];
    tools: BenchmarkResult[];
    integration: BenchmarkResult[];
  };
  
  // Overall analysis
  analysis: {
    fastest_operation: BenchmarkResult;
    slowest_operation: BenchmarkResult;
    biggest_improvement: BenchmarkResult | null;
    biggest_regression: BenchmarkResult | null;
    budget_violations: BenchmarkResult[];
  };
  
  // Recommendations
  recommendations: string[];
}

/**
 * Main benchmarking suite class
 */
export class BenchmarkSuite extends EventEmitter {
  private tests: BenchmarkConfig[] = [];
  private results: BenchmarkResult[] = [];
  private baselines: Map<string, BenchmarkResult> = new Map();
  private tempDir: string;
  private performanceMonitor?: EnhancedPerformanceMonitor;
  
  constructor(tempDir?: string) {
    super();
    this.tempDir = tempDir || path.join(__dirname, '..', '..', 'temp', 'benchmark');
    this.initializeTests();
  }
  
  /**
   * Initialize all benchmark tests
   */
  private initializeTests(): void {
    // Security configuration benchmarks
    this.addSecurityBenchmarks();
    
    // File system operation benchmarks
    this.addFileSystemBenchmarks();
    
    // HTTP connection pool benchmarks
    this.addHttpPoolBenchmarks();
    
    // MCP tool execution benchmarks
    this.addMcpToolBenchmarks();
    
    // Integration benchmarks
    this.addIntegrationBenchmarks();
    
    secureLog('info', 'Benchmark suite initialized', {
      total_tests: this.tests.length,
      categories: this.getCategoryStats()
    });
  }
  
  /**
   * Add security-related benchmarks
   */
  private addSecurityBenchmarks(): void {
    // Security config loading without cache
    this.tests.push({
      name: 'security_config_load_no_cache',
      description: 'Load security configuration without caching',
      category: 'security',
      setup: async () => {
        invalidateSecurityConfigCache();
      },
      fn: () => loadSecurityConfig(true),
      performance_budget: {
        max_duration_ms: 10,
        max_memory_mb: 5
      }
    });
    
    // Security config loading with cache
    this.tests.push({
      name: 'security_config_load_with_cache',
      description: 'Load security configuration with caching (should be faster)',
      category: 'security',
      setup: async () => {
        // Prime the cache
        loadSecurityConfig(true);
      },
      fn: () => loadSecurityConfig(false),
      performance_budget: {
        max_duration_ms: 1,
        max_memory_mb: 1
      }
    });
    
    // Input validation benchmark
    this.tests.push({
      name: 'input_validation_send_event',
      description: 'Validate input for send_telegram_event',
      category: 'security',
      fn: () => validateInput({
        type: 'task_completion',
        title: 'Test Task Complete',
        description: 'Test task completed successfully',
        source: 'benchmark-test'
      }, 'sendEvent'),
      performance_budget: {
        max_duration_ms: 5,
        max_memory_mb: 2
      }
    });
    
    // Security wrapper benchmark
    this.tests.push({
      name: 'security_wrapper_overhead',
      description: 'Measure withSecurity wrapper overhead',
      category: 'security',
      fn: async () => {
        return await withSecurity(
          async () => ({ test: 'data' }),
          {
            toolName: 'benchmark_test',
            clientId: 'benchmark_client'
          }
        );
      },
      performance_budget: {
        max_duration_ms: 10,
        max_memory_mb: 3
      }
    });
  }
  
  /**
   * Add file system operation benchmarks
   */
  private addFileSystemBenchmarks(): void {
    // Directory listing without batching
    this.tests.push({
      name: 'fs_directory_listing_standard',
      description: 'Standard directory listing using fs.readdir',
      category: 'filesystem',
      setup: async () => {
        await this.createTestFiles(50);
      },
      fn: async () => {
        const files = await fs.readdir(this.tempDir);
        const stats = await Promise.all(
          files.map(file => fs.stat(path.join(this.tempDir, file)))
        );
        return { files, stats };
      },
      teardown: async () => {
        await this.cleanupTestFiles();
      },
      performance_budget: {
        max_duration_ms: 100,
        max_memory_mb: 10
      }
    });
    
    // Directory listing with FileSystemOptimizer
    this.tests.push({
      name: 'fs_directory_listing_optimized',
      description: 'Optimized directory listing using FileSystemOptimizer',
      category: 'filesystem',
      setup: async () => {
        await this.createTestFiles(50);
      },
      fn: async () => {
        const optimizer = getFsOptimizer();
        return await optimizer.getCachedDirectoryListing(this.tempDir);
      },
      teardown: async () => {
        await this.cleanupTestFiles();
        destroyFsOptimizer();
      },
      performance_budget: {
        max_duration_ms: 50,
        max_memory_mb: 8
      }
    });
    
    // Batch JSON file reading
    this.tests.push({
      name: 'fs_batch_json_read',
      description: 'Batch read multiple JSON files using FileSystemOptimizer',
      category: 'filesystem',
      setup: async () => {
        await this.createTestJsonFiles(20);
      },
      fn: async () => {
        const optimizer = getFsOptimizer();
        const files = await fs.readdir(this.tempDir);
        const jsonFiles = files
          .filter(f => f.endsWith('.json'))
          .map(f => path.join(this.tempDir, f));
        return await optimizer.batchReadJSON(jsonFiles);
      },
      teardown: async () => {
        await this.cleanupTestFiles();
        destroyFsOptimizer();
      },
      performance_budget: {
        max_duration_ms: 200,
        max_memory_mb: 15
      }
    });
    
    // File existence checking in batch
    this.tests.push({
      name: 'fs_batch_exists_check',
      description: 'Batch check file existence using FileSystemOptimizer',
      category: 'filesystem',
      setup: async () => {
        await this.createTestFiles(30);
      },
      fn: async () => {
        const optimizer = getFsOptimizer();
        const testPaths = Array.from({ length: 50 }, (_, i) => 
          path.join(this.tempDir, `test-file-${i}.txt`)
        );
        return await optimizer.batchPathExists(testPaths);
      },
      teardown: async () => {
        await this.cleanupTestFiles();
        destroyFsOptimizer();
      },
      performance_budget: {
        max_duration_ms: 100,
        max_memory_mb: 5
      }
    });
  }
  
  /**
   * Add HTTP connection pool benchmarks
   */
  private addHttpPoolBenchmarks(): void {
    // HTTP agent creation and reuse
    this.tests.push({
      name: 'http_pool_agent_reuse',
      description: 'HTTP agent reuse efficiency',
      category: 'http',
      fn: () => {
        const pool = new HttpConnectionPool();
        const configs = [];
        // Generate multiple configs to test agent reuse
        for (let i = 0; i < 10; i++) {
          configs.push(pool.getAxiosConfig('health', 'http://localhost:8080/test'));
        }
        pool.destroy();
        return configs;
      },
      performance_budget: {
        max_duration_ms: 10,
        max_memory_mb: 5
      }
    });
    
    // Pool type-specific configurations
    this.tests.push({
      name: 'http_pool_type_configs',
      description: 'Generate configurations for different pool types',
      category: 'http',
      fn: () => {
        const pool = new HttpConnectionPool();
        const poolTypes: PoolType[] = ['health', 'status', 'polling', 'default'];
        const configs = poolTypes.map(type => ({
          type,
          config: pool.getAxiosConfig(type, 'https://example.com/test')
        }));
        pool.destroy();
        return configs;
      },
      performance_budget: {
        max_duration_ms: 5,
        max_memory_mb: 3
      }
    });
    
    // Bridge axios config generation
    this.tests.push({
      name: 'http_bridge_config_generation',
      description: 'Generate bridge-specific axios configurations',
      category: 'http',
      fn: () => {
        const configs = [
          getBridgeAxiosConfig('health', 'http://localhost:8080/health'),
          getBridgeAxiosConfig('status', 'http://localhost:8080/status'),
          getBridgeAxiosConfig('polling', 'http://localhost:8080/poll')
        ];
        return configs;
      },
      performance_budget: {
        max_duration_ms: 5,
        max_memory_mb: 2
      }
    });
    
    // Pool statistics collection
    this.tests.push({
      name: 'http_pool_stats_collection',
      description: 'Collect HTTP pool statistics',
      category: 'http',
      setup: async () => {
        const pool = getHttpPool();
        // Generate some activity
        for (let i = 0; i < 10; i++) {
          pool.getAxiosConfig('health');
          if (i % 3 === 0) pool.recordError('health');
        }
      },
      fn: () => {
        const pool = getHttpPool();
        return pool.getStats();
      },
      performance_budget: {
        max_duration_ms: 5,
        max_memory_mb: 2
      }
    });
  }
  
  /**
   * Add MCP tool execution benchmarks
   */
  private addMcpToolBenchmarks(): void {
    const toolNames = [
      'send_telegram_event',
      'send_telegram_message', 
      'send_task_completion',
      'send_performance_alert',
      'send_approval_request',
      'get_telegram_responses',
      'get_bridge_status',
      'list_event_types',
      'clear_old_responses',
      'process_pending_responses',
      'start_bridge',
      'stop_bridge',
      'restart_bridge',
      'ensure_bridge_running',
      'check_bridge_process',
      'get_task_status'
    ];
    
    toolNames.forEach(toolName => {
      this.tests.push({
        name: `mcp_tool_${toolName}`,
        description: `Benchmark MCP tool: ${toolName}`,
        category: 'tools',
        fn: async () => {
          // Mock the tool execution by measuring just the validation and setup overhead
          const mockArgs = this.getMockArgsForTool(toolName);
          const startTime = performance.now();
          
          // Simulate tool execution overhead (validation, security, etc.)
          try {
            if (this.requiresValidation(toolName)) {
              const schemaKey = this.getSchemaKeyForTool(toolName);
              if (schemaKey) {
                validateInput(mockArgs, schemaKey);
              }
            }
            
            // Simulate minimal processing
            await new Promise(resolve => setImmediate(resolve));
            
            return {
              tool: toolName,
              duration: performance.now() - startTime,
              args: mockArgs
            };
          } catch (error) {
            return {
              tool: toolName,
              duration: performance.now() - startTime,
              error: error instanceof Error ? error.message : 'unknown'
            };
          }
        },
        performance_budget: {
          max_duration_ms: this.getToolPerformanceBudget(toolName),
          max_memory_mb: 5
        }
      });
    });
  }
  
  /**
   * Add integration benchmarks (end-to-end scenarios)
   */
  private addIntegrationBenchmarks(): void {
    // Complete event processing pipeline
    this.tests.push({
      name: 'integration_event_pipeline',
      description: 'Complete event processing pipeline (validation + security)',
      category: 'integration',
      fn: async () => {
        const eventData = {
          type: 'task_completion',
          title: 'Benchmark Task Complete', 
          description: 'Test task completed for benchmarking purposes',
          source: 'benchmark-suite'
        };
        
        // Simulate the complete pipeline
        const validatedData = validateInput(eventData, 'sendEvent');
        
        return await withSecurity(
          async () => ({ processed: true, data: validatedData }),
          {
            toolName: 'benchmark_integration',
            clientId: 'benchmark_client',
            data: validatedData,
            schemaKey: 'sendEvent'
          }
        );
      },
      performance_budget: {
        max_duration_ms: 20,
        max_memory_mb: 8
      }
    });
    
    // File system + HTTP pool integration
    this.tests.push({
      name: 'integration_fs_http_combined',
      description: 'Combined file system optimization and HTTP pooling',
      category: 'integration',
      setup: async () => {
        await this.createTestFiles(10);
      },
      fn: async () => {
        // File system operations
        const optimizer = getFsOptimizer();
        const fsResult = await optimizer.getCachedDirectoryListing(this.tempDir);
        
        // HTTP pool operations  
        const httpConfig = getBridgeAxiosConfig('status');
        
        return {
          fs: fsResult,
          http: httpConfig
        };
      },
      teardown: async () => {
        await this.cleanupTestFiles();
        destroyFsOptimizer();
      },
      performance_budget: {
        max_duration_ms: 100,
        max_memory_mb: 10
      }
    });
  }
  
  /**
   * Run all benchmarks
   */
  public async runAll(): Promise<BenchmarkSuiteResults> {
    const startTime = Date.now();
    secureLog('info', 'Starting comprehensive benchmark suite', {
      total_tests: this.tests.length
    });
    
    this.emit('suite_started', { total_tests: this.tests.length });
    
    let passed = 0;
    let failed = 0;
    
    // Ensure temp directory exists
    await fs.ensureDir(this.tempDir);
    
    // Run each benchmark
    for (const test of this.tests) {
      try {
        secureLog('debug', 'Running benchmark test', { name: test.name });
        const result = await this.runSingleBenchmark(test);
        this.results.push(result);
        passed++;
        
        this.emit('test_completed', { test: test.name, result });
      } catch (error) {
        failed++;
        secureLog('error', 'Benchmark test failed', {
          name: test.name,
          error: error instanceof Error ? error.message : 'unknown'
        });
        
        this.emit('test_failed', { test: test.name, error });
      }
    }
    
    // Analyze results
    const analysis = this.analyzeResults();
    const recommendations = this.generateRecommendations(analysis);
    
    const suiteResults: BenchmarkSuiteResults = {
      timestamp: startTime,
      duration_ms: Date.now() - startTime,
      total_tests: this.tests.length,
      passed,
      failed,
      results: this.categorizeResults(),
      analysis,
      recommendations
    };
    
    secureLog('info', 'Benchmark suite completed', {
      duration_ms: suiteResults.duration_ms,
      passed,
      failed,
      total_tests: this.tests.length
    });
    
    this.emit('suite_completed', suiteResults);
    
    // Cleanup
    await this.cleanup();
    
    return suiteResults;
  }
  
  /**
   * Run a single benchmark test
   */
  private async runSingleBenchmark(test: BenchmarkConfig): Promise<BenchmarkResult> {
    return new Promise((resolve, reject) => {
      const suite = new Benchmark.Suite();
      
      let memoryBefore = process.memoryUsage();
      
      suite.add(test.name, {
        defer: true,
        fn: async (deferred: any) => {
          try {
            if (test.setup) {
              await test.setup();
            }
            
            const result = await test.fn();
            deferred.resolve(result);
            
            if (test.teardown) {
              await test.teardown();
            }
          } catch (error) {
            deferred.reject(error);
          }
        },
        ...test.options
      });
      
      suite.on('complete', function(this: any) {
        // Access the first benchmark result from the suite using 'this' context
        const benchmark = this.filter('fastest')[0];
        if (!benchmark) {
          reject(new Error('No benchmark results found'));
          return;
        }
        
        const memoryAfter = process.memoryUsage();
        const memoryUsed = (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024;
        const meanDuration = benchmark.stats.mean * 1000; // Convert to milliseconds
        
        const result: BenchmarkResult = {
          name: test.name,
          category: test.category,
          description: test.description,
          timestamp: Date.now(),
          hz: benchmark.hz,
          stats: {
            mean: benchmark.stats.mean,
            moe: benchmark.stats.moe,
            rme: benchmark.stats.rme,
            sem: benchmark.stats.sem,
            deviation: benchmark.stats.deviation,
            variance: benchmark.stats.variance,
            sample: [...benchmark.stats.sample]
          },
          performance: {
            meets_budget: this.checkPerformanceBudget(test, meanDuration, memoryUsed),
            duration_ms: meanDuration,
            memory_used_mb: memoryUsed
          },
          system: {
            node_version: process.version,
            platform: process.platform,
            arch: process.arch,
            memory_total_gb: Math.round(require('os').totalmem() / 1024 / 1024 / 1024),
            cpu_count: require('os').cpus().length
          }
        };
        
        // Add comparison if baseline exists
        const baseline = this.baselines.get(test.name);
        if (baseline) {
          const improvement = ((result.hz - baseline.hz) / baseline.hz) * 100;
          result.comparison = {
            baseline_hz: baseline.hz,
            improvement_percent: improvement > 0 ? improvement : 0,
            regression_percent: improvement < 0 ? Math.abs(improvement) : 0
          };
        }
        
        resolve(result);
      });
      
      suite.on('error', (error: any) => {
        reject(error);
      });
      
      suite.run({ async: true });
    });
  }
  
  /**
   * Load baseline results for comparison
   */
  public async loadBaselines(baselinePath: string): Promise<void> {
    try {
      if (await fs.pathExists(baselinePath)) {
        const baselineData = await fs.readJSON(baselinePath);
        if (baselineData.results) {
          // Load from suite results format
          Object.values(baselineData.results).forEach((categoryResults: any) => {
            categoryResults.forEach((result: BenchmarkResult) => {
              this.baselines.set(result.name, result);
            });
          });
        } else {
          // Load from raw results array
          baselineData.forEach((result: BenchmarkResult) => {
            this.baselines.set(result.name, result);
          });
        }
        
        secureLog('info', 'Baseline results loaded', {
          baselines_count: this.baselines.size,
          baseline_path: baselinePath
        });
      }
    } catch (error) {
      secureLog('warn', 'Failed to load baseline results', {
        baseline_path: baselinePath,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
  
  /**
   * Save current results as baseline
   */
  public async saveBaselines(baselinePath: string): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(baselinePath));
      await fs.writeJSON(baselinePath, this.results, { spaces: 2 });
      
      secureLog('info', 'Baseline results saved', {
        results_count: this.results.length,
        baseline_path: baselinePath
      });
    } catch (error) {
      secureLog('error', 'Failed to save baseline results', {
        baseline_path: baselinePath,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
  
  /**
   * Helper methods
   */
  
  private checkPerformanceBudget(
    test: BenchmarkConfig, 
    duration: number, 
    memory: number
  ): boolean {
    if (!test.performance_budget) return true;
    
    return duration <= test.performance_budget.max_duration_ms && 
           memory <= test.performance_budget.max_memory_mb;
  }
  
  private getCategoryStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    this.tests.forEach(test => {
      stats[test.category] = (stats[test.category] || 0) + 1;
    });
    return stats;
  }
  
  private categorizeResults(): BenchmarkSuiteResults['results'] {
    const categorized: BenchmarkSuiteResults['results'] = {
      security: [],
      filesystem: [],
      http: [],
      tools: [],
      integration: []
    };
    
    this.results.forEach(result => {
      if (result.category in categorized) {
        (categorized as any)[result.category].push(result);
      }
    });
    
    return categorized;
  }
  
  private analyzeResults(): BenchmarkSuiteResults['analysis'] {
    if (this.results.length === 0) {
      return {
        fastest_operation: {} as BenchmarkResult,
        slowest_operation: {} as BenchmarkResult,
        biggest_improvement: null,
        biggest_regression: null,
        budget_violations: []
      };
    }
    
    const fastest = this.results.reduce((fastest, current) => 
      current.hz > fastest.hz ? current : fastest
    );
    
    const slowest = this.results.reduce((slowest, current) =>
      current.hz < slowest.hz ? current : slowest
    );
    
    const withComparisons = this.results.filter(r => r.comparison);
    const biggest_improvement = withComparisons.length > 0 
      ? withComparisons.reduce((best, current) => 
          (current.comparison?.improvement_percent || 0) > (best.comparison?.improvement_percent || 0) 
            ? current : best
        )
      : null;
    
    const biggest_regression = withComparisons.length > 0
      ? withComparisons.reduce((worst, current) =>
          (current.comparison?.regression_percent || 0) > (worst.comparison?.regression_percent || 0)
            ? current : worst
        )
      : null;
    
    const budget_violations = this.results.filter(r => !r.performance.meets_budget);
    
    return {
      fastest_operation: fastest,
      slowest_operation: slowest,
      biggest_improvement,
      biggest_regression,
      budget_violations
    };
  }
  
  private generateRecommendations(analysis: BenchmarkSuiteResults['analysis']): string[] {
    const recommendations: string[] = [];
    
    if (analysis.budget_violations.length > 0) {
      recommendations.push(
        `${analysis.budget_violations.length} operations exceeded performance budgets. ` +
        `Focus optimization on: ${analysis.budget_violations.map(v => v.name).join(', ')}`
      );
    }
    
    if (analysis.biggest_regression && 
        (analysis.biggest_regression.comparison?.regression_percent || 0) > 10) {
      recommendations.push(
        `Significant performance regression detected in ${analysis.biggest_regression.name}: ` +
        `${analysis.biggest_regression.comparison?.regression_percent?.toFixed(1)}% slower`
      );
    }
    
    if (analysis.slowest_operation.performance.duration_ms > 100) {
      recommendations.push(
        `Slowest operation (${analysis.slowest_operation.name}) takes ${analysis.slowest_operation.performance.duration_ms.toFixed(1)}ms. ` +
        `Consider optimization if used frequently.`
      );
    }
    
    // Category-specific recommendations
    const categoryPerformance = this.getCategoryPerformanceStats();
    Object.entries(categoryPerformance).forEach(([category, stats]) => {
      if (stats.avg_duration > 50) {
        recommendations.push(
          `${category} operations average ${stats.avg_duration.toFixed(1)}ms. ` +
          `Consider implementing caching or batching optimizations.`
        );
      }
    });
    
    if (recommendations.length === 0) {
      recommendations.push('All operations are performing within acceptable ranges.');
    }
    
    return recommendations;
  }
  
  private getCategoryPerformanceStats(): Record<string, { avg_duration: number; count: number }> {
    const stats: Record<string, { total_duration: number; count: number }> = {};
    
    this.results.forEach(result => {
      if (!stats[result.category]) {
        stats[result.category] = { total_duration: 0, count: 0 };
      }
      stats[result.category].total_duration += result.performance.duration_ms;
      stats[result.category].count++;
    });
    
    const averages: Record<string, { avg_duration: number; count: number }> = {};
    Object.entries(stats).forEach(([category, data]) => {
      averages[category] = {
        avg_duration: data.total_duration / data.count,
        count: data.count
      };
    });
    
    return averages;
  }
  
  // Test data creation helpers
  
  private async createTestFiles(count: number): Promise<void> {
    await fs.ensureDir(this.tempDir);
    
    const createPromises = Array.from({ length: count }, async (_, i) => {
      const filePath = path.join(this.tempDir, `test-file-${i}.txt`);
      return fs.writeFile(filePath, `Test file content ${i}\nCreated for benchmarking purposes.`);
    });
    
    await Promise.all(createPromises);
  }
  
  private async createTestJsonFiles(count: number): Promise<void> {
    await fs.ensureDir(this.tempDir);
    
    const createPromises = Array.from({ length: count }, async (_, i) => {
      const filePath = path.join(this.tempDir, `test-data-${i}.json`);
      const data = {
        id: i,
        name: `Test Object ${i}`,
        timestamp: new Date().toISOString(),
        data: Array.from({ length: 10 }, (_, j) => `item-${j}`)
      };
      return fs.writeJSON(filePath, data);
    });
    
    await Promise.all(createPromises);
  }
  
  private async cleanupTestFiles(): Promise<void> {
    try {
      if (await fs.pathExists(this.tempDir)) {
        await fs.remove(this.tempDir);
      }
    } catch (error) {
      secureLog('warn', 'Failed to cleanup test files', {
        temp_dir: this.tempDir,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
  
  private async cleanup(): Promise<void> {
    await this.cleanupTestFiles();
    this.results = [];
    this.tests = [];
  }
  
  // Tool-specific helpers
  
  private getMockArgsForTool(toolName: string): any {
    const mockArgs: Record<string, any> = {
      send_telegram_event: {
        type: 'task_completion',
        title: 'Benchmark Test',
        description: 'Test event for benchmarking'
      },
      send_telegram_message: {
        message: 'Benchmark test message'
      },
      send_task_completion: {
        task_id: 'benchmark-task-123',
        title: 'Benchmark Task Complete'
      },
      send_performance_alert: {
        title: 'Benchmark Alert',
        current_value: 95,
        threshold: 90
      },
      send_approval_request: {
        title: 'Benchmark Approval',
        description: 'Test approval request'
      },
      get_telegram_responses: {
        limit: 10
      },
      clear_old_responses: {
        older_than_hours: 24
      },
      process_pending_responses: {
        since_minutes: 10
      },
      get_task_status: {
        task_system: 'both'
      }
    };
    
    return mockArgs[toolName] || {};
  }
  
  private requiresValidation(toolName: string): boolean {
    const validationRequired = [
      'send_telegram_event',
      'send_telegram_message',
      'send_task_completion',
      'send_performance_alert',
      'send_approval_request',
      'get_telegram_responses',
      'clear_old_responses',
      'process_pending_responses',
      'list_event_types',
      'get_task_status'
    ];
    
    return validationRequired.includes(toolName);
  }
  
  private getSchemaKeyForTool(toolName: string): keyof typeof import('../security.js').inputSchemas | null {
    const schemaMap: Record<string, keyof typeof import('../security.js').inputSchemas> = {
      send_telegram_event: 'sendEvent',
      send_telegram_message: 'sendMessage',
      send_task_completion: 'sendTaskCompletion',
      send_performance_alert: 'sendPerformanceAlert',
      send_approval_request: 'sendApprovalRequest',
      get_telegram_responses: 'getTelegramResponses',
      clear_old_responses: 'clearOldResponses',
      process_pending_responses: 'processPendingResponses',
      list_event_types: 'listEventTypes',
      get_task_status: 'getTaskStatus'
    };
    
    return schemaMap[toolName] || null;
  }
  
  private getToolPerformanceBudget(toolName: string): number {
    // Define performance budgets for different tool categories
    const budgets: Record<string, number> = {
      // Fast operations (< 5ms)
      get_bridge_status: 5,
      check_bridge_process: 5,
      list_event_types: 5,
      
      // Medium operations (< 50ms)  
      send_telegram_event: 50,
      send_telegram_message: 50,
      send_task_completion: 50,
      send_performance_alert: 50,
      send_approval_request: 50,
      get_telegram_responses: 50,
      process_pending_responses: 50,
      
      // Slower operations (< 100ms)
      clear_old_responses: 100,
      get_task_status: 100,
      
      // Process operations (< 5000ms - 5 seconds)
      start_bridge: 5000,
      stop_bridge: 5000,
      restart_bridge: 5000,
      ensure_bridge_running: 5000
    };
    
    return budgets[toolName] || 50; // Default budget
  }
}

// Export singleton instance for easy use
let globalBenchmarkSuite: BenchmarkSuite | null = null;

/**
 * Get global benchmark suite instance
 */
export function getBenchmarkSuite(tempDir?: string): BenchmarkSuite {
  if (!globalBenchmarkSuite) {
    globalBenchmarkSuite = new BenchmarkSuite(tempDir);
  }
  return globalBenchmarkSuite;
}

/**
 * Destroy global benchmark suite
 */
export function destroyBenchmarkSuite(): void {
  globalBenchmarkSuite = null;
}
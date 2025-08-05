/**
 * Benchmarking Suite Example
 * 
 * Demonstrates how to use the CCTelegram MCP Server benchmarking suite
 * for performance testing and optimization validation.
 */

import { BenchmarkSuite, getBenchmarkSuite } from './benchmark-suite.js';
import { BenchmarkRunner } from './benchmark-runner.js';
import { secureLog } from '../security.js';

/**
 * Example 1: Basic benchmark suite usage
 */
async function basicBenchmarkExample(): Promise<void> {
  console.log('🧪 Running Basic Benchmark Example\n');
  
  const suite = getBenchmarkSuite();
  
  // Listen for events
  suite.on('suite_started', (data) => {
    console.log(`📊 Starting ${data.total_tests} benchmark tests...`);
  });
  
  suite.on('test_completed', (data) => {
    const { test, result } = data;
    const status = result.performance.meets_budget ? '✅' : '⚠️';
    const ops = result.hz.toFixed(0);
    const duration = result.performance.duration_ms.toFixed(2);
    
    console.log(`  ${status} ${test}: ${ops} ops/sec (${duration}ms avg)`);
  });
  
  // Run all benchmarks
  const results = await suite.runAll();
  
  console.log('\n📋 Results Summary:');
  console.log(`Total Tests: ${results.total_tests}`);
  console.log(`Passed: ${results.passed} | Failed: ${results.failed}`);
  console.log(`Duration: ${(results.duration_ms / 1000).toFixed(2)}s`);
  
  // Show performance highlights
  console.log('\n🏆 Performance Highlights:');
  console.log(`Fastest: ${results.analysis.fastest_operation.name} (${results.analysis.fastest_operation.hz.toFixed(0)} ops/sec)`);
  console.log(`Slowest: ${results.analysis.slowest_operation.name} (${results.analysis.slowest_operation.hz.toFixed(0)} ops/sec)`);
  
  if (results.analysis.budget_violations.length > 0) {
    console.log(`\n⚠️  Budget Violations: ${results.analysis.budget_violations.length}`);
    results.analysis.budget_violations.forEach(violation => {
      console.log(`  - ${violation.name}: ${violation.performance.duration_ms.toFixed(2)}ms`);
    });
  }
  
  console.log('\n💡 Recommendations:');
  results.recommendations.forEach(rec => {
    console.log(`  • ${rec}`);
  });
}

/**
 * Example 2: Using BenchmarkRunner with custom options
 */
async function customBenchmarkExample(): Promise<void> {
  console.log('\n🛠️  Running Custom Benchmark Example\n');
  
  const runner = new BenchmarkRunner({
    output: 'example-results.json',
    format: 'json',
    quiet: false,
    threshold: 15, // 15% regression threshold
    timeout: 120000 // 2 minutes timeout
  });
  
  const results = await runner.run();
  
  console.log('\n📊 Custom Benchmark Results:');
  console.log(`Generated report: example-results.json`);
  console.log(`Categories tested: ${Object.keys(results.results).filter(cat => results.results[cat as keyof typeof results.results].length > 0).join(', ')}`);
}

/**
 * Example 3: Baseline comparison demonstration
 */
async function baselineComparisonExample(): Promise<void> {
  console.log('\n📈 Running Baseline Comparison Example\n');
  
  // Step 1: Create initial baseline
  console.log('Step 1: Creating initial baseline...');
  const initialRunner = new BenchmarkRunner({
    output: 'initial-results.json',
    saveBaseline: true,
    quiet: true
  });
  
  await initialRunner.run();
  console.log('✅ Baseline created: initial-results.baseline.json');
  
  // Step 2: Run comparison against baseline
  console.log('\nStep 2: Running comparison against baseline...');
  const comparisonRunner = new BenchmarkRunner({
    baseline: 'initial-results.baseline.json',
    output: 'comparison-results.json',
    format: 'json',
    threshold: 10,
    quiet: false
  });
  
  const comparisonResults = await comparisonRunner.run();
  
  // Show comparison results
  console.log('\n📊 Comparison Results:');
  const testsWithComparison = Object.values(comparisonResults.results)
    .flat()
    .filter((test): test is typeof test & { comparison: NonNullable<typeof test.comparison> } => 
      !!test.comparison
    );
  
  if (testsWithComparison.length > 0) {
    console.log('Performance Changes:');
    testsWithComparison.forEach(test => {
      const improvement = test.comparison?.improvement_percent || 0;
      const regression = test.comparison?.regression_percent || 0;
      
      if (improvement > 0) {
        console.log(`  🚀 ${test.name}: +${improvement.toFixed(1)}% improvement`);
      } else if (regression > 0) {
        console.log(`  📉 ${test.name}: -${regression.toFixed(1)}% regression`);
      } else {
        console.log(`  ➡️  ${test.name}: no significant change`);
      }
    });
  } else {
    console.log('No baseline comparisons available (tests may have different names)');
  }
}

/**
 * Example 4: Category-specific benchmarking
 */
async function categorySpecificExample(): Promise<void> {
  console.log('\n🎯 Running Category-Specific Analysis\n');
  
  const suite = getBenchmarkSuite();
  const results = await suite.runAll();
  
  // Analyze each category
  const categories = ['security', 'filesystem', 'http', 'tools', 'integration'] as const;
  
  categories.forEach(category => {
    const categoryResults = results.results[category];
    if (categoryResults.length === 0) return;
    
    console.log(`\n📁 ${category.toUpperCase()} Category Analysis:`);
    
    // Calculate category statistics
    const avgOps = categoryResults.reduce((sum, r) => sum + r.hz, 0) / categoryResults.length;
    const avgDuration = categoryResults.reduce((sum, r) => sum + r.performance.duration_ms, 0) / categoryResults.length;
    const budgetCompliant = categoryResults.filter(r => r.performance.meets_budget).length;
    
    console.log(`  Tests: ${categoryResults.length}`);
    console.log(`  Average: ${avgOps.toFixed(0)} ops/sec (${avgDuration.toFixed(2)}ms)`);
    console.log(`  Budget Compliance: ${budgetCompliant}/${categoryResults.length} (${((budgetCompliant/categoryResults.length)*100).toFixed(1)}%)`);
    
    // Show top performers
    const topPerformer = categoryResults.reduce((best, current) => 
      current.hz > best.hz ? current : best
    );
    console.log(`  Top Performer: ${topPerformer.name} (${topPerformer.hz.toFixed(0)} ops/sec)`);
    
    // Show budget violations
    const violations = categoryResults.filter(r => !r.performance.meets_budget);
    if (violations.length > 0) {
      console.log(`  Budget Violations:`);
      violations.forEach(v => {
        console.log(`    - ${v.name}: ${v.performance.duration_ms.toFixed(2)}ms`);
      });
    }
  });
}

/**
 * Example 5: Performance optimization validation
 */
async function optimizationValidationExample(): Promise<void> {
  console.log('\n🔧 Running Optimization Validation Example\n');
  
  const suite = getBenchmarkSuite();
  const results = await suite.runAll();
  
  // Validate specific optimizations from Tasks 15.1-15.5
  console.log('🔍 Validating Task 15.1 - Security Config Caching:');
  
  const securityTests = results.results.security;
  const cachedTest = securityTests.find(t => t.name.includes('with_cache'));
  const uncachedTest = securityTests.find(t => t.name.includes('no_cache'));
  
  if (cachedTest && uncachedTest) {
    const speedup = cachedTest.hz / uncachedTest.hz;
    console.log(`  Cache speedup: ${speedup.toFixed(1)}x faster`);
    
    if (speedup > 2) {
      console.log('  ✅ Caching optimization is effective (>2x improvement)');
    } else {
      console.log('  ⚠️  Caching optimization may need review (<2x improvement)');
    }
  }
  
  console.log('\n🔍 Validating Task 15.3 - File System Batching:');
  
  const fsTests = results.results.filesystem;
  const optimizedTest = fsTests.find(t => t.name.includes('optimized'));
  const standardTest = fsTests.find(t => t.name.includes('standard'));
  
  if (optimizedTest && standardTest) {
    const improvement = ((optimizedTest.hz - standardTest.hz) / standardTest.hz) * 100;
    console.log(`  FileSystemOptimizer improvement: ${improvement.toFixed(1)}%`);
    
    if (improvement > 30) {
      console.log('  ✅ File system optimization is effective (>30% improvement)');
    } else {
      console.log('  ⚠️  File system optimization may need review (<30% improvement)');
    }
  }
  
  console.log('\n🔍 Validating Task 15.2 - HTTP Connection Pooling:');
  
  const httpTests = results.results.http;
  const poolTest = httpTests.find(t => t.name.includes('pool'));
  
  if (poolTest) {
    const meetsTarget = poolTest.performance.duration_ms < 20; // <20ms target
    console.log(`  HTTP pool config time: ${poolTest.performance.duration_ms.toFixed(2)}ms`);
    
    if (meetsTarget) {
      console.log('  ✅ HTTP pool optimization meets performance target (<20ms)');
    } else {
      console.log('  ⚠️  HTTP pool optimization may need review (>20ms)');
    }
  }
  
  // Overall performance budget compliance
  const allTests = Object.values(results.results).flat();
  const budgetCompliant = allTests.filter(t => t.performance.meets_budget).length;
  const complianceRate = (budgetCompliant / allTests.length) * 100;
  
  console.log('\n📊 Overall Performance Budget Compliance:');
  console.log(`  Compliant: ${budgetCompliant}/${allTests.length} tests (${complianceRate.toFixed(1)}%)`);
  
  if (complianceRate >= 90) {
    console.log('  ✅ Excellent performance budget compliance (≥90%)');
  } else if (complianceRate >= 80) {
    console.log('  ⚠️  Good performance budget compliance (≥80%)');
  } else {
    console.log('  ❌ Performance budget compliance needs improvement (<80%)');
  }
}

/**
 * Main example runner
 */
async function runExamples(): Promise<void> {
  console.log('🚀 CCTelegram MCP Server Benchmarking Suite Examples\n');
  console.log('===============================================\n');
  
  try {
    // Run all examples
    await basicBenchmarkExample();
    await customBenchmarkExample();
    await baselineComparisonExample();
    await categorySpecificExample();
    await optimizationValidationExample();
    
    console.log('\n✅ All examples completed successfully!');
    console.log('\nNext steps:');
    console.log('• Run `npm run benchmark` to use the full benchmark suite');
    console.log('• Use `npm run benchmark:html` to generate visual reports');
    console.log('• Set up CI/CD with `npm run benchmark:ci` for regression testing');
    console.log('• Check the README.md for more advanced usage patterns');
    
  } catch (error) {
    console.error('\n❌ Example failed:', error);
    
    secureLog('error', 'Benchmark example failed', {
      error: error instanceof Error ? error.message : 'unknown',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export {
  basicBenchmarkExample,
  customBenchmarkExample,
  baselineComparisonExample,
  categorySpecificExample,
  optimizationValidationExample,
  runExamples
};
/**
 * Memory Leak Detector Usage Example
 * 
 * Demonstrates how to use the memory leak detection system in production
 * and development environments with various configuration options.
 */

import { 
  MemoryLeakDetector,
  MemoryLeakConfig,
  MemoryLeakAlert,
  MemoryDashboard,
  DEFAULT_MEMORY_LEAK_CONFIG
} from './memory-leak-detector.js';
import { MetricsCollector } from '../metrics/metrics-collector.js';
import { EnhancedPerformanceMonitor } from './enhanced-performance-monitor.js';
import { PerformanceMonitor } from './performance-monitor.js';
import { secureLog } from '../../security.js';

/**
 * Basic Memory Leak Detector Setup
 */
export async function basicMemoryLeakDetection() {
  console.log('\n=== Basic Memory Leak Detection Setup ===');
  
  // Create detector with default configuration
  const detector = new MemoryLeakDetector();
  
  // Set up event listeners
  detector.on('memory_alert', (alert: MemoryLeakAlert) => {
    console.log(`🚨 Memory Alert: ${alert.type} - ${alert.severity}`);
    console.log(`   Message: ${alert.message}`);
    console.log(`   Current heap: ${alert.current.heapUsedMB}MB`);
    console.log(`   Recommendations:`, alert.recommendations);
  });
  
  detector.on('heap_analyzed', (analysis) => {
    console.log(`🔍 Heap Analysis Complete`);
    console.log(`   Memory leak suspected: ${analysis.analysis.memoryLeakSuspected}`);
    console.log(`   Growth areas: ${analysis.analysis.growthAreas.length}`);
  });
  
  detector.on('heap_dump_generated', (info) => {
    console.log(`💾 Heap dump generated: ${info.filepath}`);
  });
  
  // Start monitoring
  await detector.start();
  
  // Take manual snapshots
  console.log('\nTaking memory snapshots...');
  const globalSnapshot = await detector.takeSnapshot('global');
  console.log(`Global memory usage: ${Math.round(globalSnapshot.heapUsed / (1024 * 1024))}MB`);
  
  const eventFilesSnapshot = await detector.takeSnapshot('event_files');
  console.log(`Event files: ${eventFilesSnapshot.specific.eventFilesCount} files`);
  
  // Perform heap analysis
  console.log('\nPerforming heap analysis...');
  const analysis = await detector.analyzeHeap();
  if (analysis) {
    console.log(`Analysis found ${analysis.analysis.growthAreas.length} growth areas`);
  }
  
  // Get dashboard data
  const dashboard = detector.getMemoryDashboard();
  console.log(`\nMemory Dashboard Status: ${dashboard.status}`);
  console.log(`Memory budget usage: ${dashboard.summary.memoryBudgetUsage}%`);
  
  // Stop monitoring
  await detector.stop();
  console.log('Memory leak detection stopped');
}

/**
 * Production Memory Leak Detection Setup
 */
export async function productionMemoryLeakDetection() {
  console.log('\n=== Production Memory Leak Detection Setup ===');
  
  // Production-optimized configuration
  const productionConfig: MemoryLeakConfig = {
    thresholds: {
      maxHeapUsageMB: 512, // Higher threshold for production
      memoryGrowthRateMBPerMin: 5,
      heapGrowthPercentage: 15,
      eventFileAccumulationThreshold: 5000
    },
    monitoring: {
      snapshotIntervalMs: 60000, // Every minute
      heapDiffIntervalMs: 600000, // Every 10 minutes
      gcMonitoringEnabled: true,
      alertCooldownMs: 300000 // 5 minute cooldown
    },
    heapDumps: {
      enabled: true,
      maxDumps: 3,
      dumpOnThreshold: true,
      dumpDirectory: '/var/log/heapdumps',
      autoAnalyze: false // Disable auto-analysis in production
    },
    integration: {
      enableEventFileTracking: true,
      enableRateLimiterTracking: true,
      enableCacheTracking: true,
      enableConnectionPoolTracking: true
    }
  };
  
  // Create metrics collector for production monitoring
  const metricsCollector = new MetricsCollector({
    enabled: true,
    prometheusEnabled: true,
    customMetrics: true,
    retentionDays: 7
  });
  
  await metricsCollector.initialize();
  
  // Create detector with production config
  const detector = new MemoryLeakDetector(productionConfig, metricsCollector);
  
  // Set up production alert handlers
  detector.on('memory_alert', async (alert: MemoryLeakAlert) => {
    secureLog('warn', 'Memory leak alert in production', {
      type: alert.type,
      severity: alert.severity,
      area: alert.area,
      heapUsedMB: alert.current.heapUsedMB,
      recommendations: alert.recommendations
    });
    
    // Send to monitoring system (e.g., Datadog, New Relic)
    if (alert.severity === 'critical') {
      await sendCriticalAlert(alert);
    }
    
    // Auto-trigger cleanup for file accumulation
    if (alert.type === 'file_accumulation') {
      await triggerFileCleanup(alert.area);
    }
  });
  
  detector.on('heap_dump_generated', (info) => {
    secureLog('info', 'Production heap dump generated', {
      filepath: info.filepath,
      reason: info.reason
    });
    
    // Notify operations team
    notifyOperationsTeam(`Heap dump generated: ${info.filepath}`);
  });
  
  // Start production monitoring
  await detector.start();
  
  console.log('Production memory leak detection started');
  console.log(`Monitoring thresholds: ${productionConfig.thresholds.maxHeapUsageMB}MB heap limit`);
  
  // Production monitoring loop (normally would run continuously)
  const monitoringInterval = setInterval(async () => {
    const stats = detector.getMemoryStats();
    const dashboard = detector.getMemoryDashboard();
    
    // Log periodic stats
    secureLog('info', 'Memory monitoring stats', {
      heapUsedMB: stats.budget.used,
      budgetPercentage: stats.budget.percentage,
      status: dashboard.status,
      alerts: stats.alerts
    });
    
    // Check for concerning trends
    if (dashboard.trends.memoryGrowthRate > 3) {
      secureLog('warn', 'High memory growth rate detected', {
        growthRate: dashboard.trends.memoryGrowthRate
      });
    }
    
  }, 300000); // Every 5 minutes
  
  // Cleanup after demo
  setTimeout(async () => {
    clearInterval(monitoringInterval);
    await detector.stop();
    await metricsCollector.stop();
    console.log('Production monitoring stopped');
  }, 10000);
}

/**
 * Development Memory Leak Detection Setup
 */
export async function developmentMemoryLeakDetection() {
  console.log('\n=== Development Memory Leak Detection Setup ===');
  
  // Development-optimized configuration
  const devConfig: MemoryLeakConfig = {
    thresholds: {
      maxHeapUsageMB: 100, // Lower threshold for early detection
      memoryGrowthRateMBPerMin: 1,
      heapGrowthPercentage: 5,
      eventFileAccumulationThreshold: 100
    },
    monitoring: {
      snapshotIntervalMs: 10000, // Every 10 seconds
      heapDiffIntervalMs: 30000, // Every 30 seconds
      gcMonitoringEnabled: true,
      alertCooldownMs: 5000 // Short cooldown for development
    },
    heapDumps: {
      enabled: true,
      maxDumps: 10,
      dumpOnThreshold: true,
      dumpDirectory: './dev-heapdumps',
      autoAnalyze: true // Enable auto-analysis in development
    },
    integration: {
      enableEventFileTracking: true,
      enableRateLimiterTracking: false, // Disable for simpler dev setup
      enableCacheTracking: false,
      enableConnectionPoolTracking: false
    }
  };
  
  const detector = new MemoryLeakDetector(devConfig);
  
  // Development-friendly event handlers
  detector.on('memory_alert', (alert: MemoryLeakAlert) => {
    console.log(`\n🚨 DEV ALERT: ${alert.type} (${alert.severity})`);
    console.log(`📍 Area: ${alert.area}`);
    console.log(`📊 Current heap: ${alert.current.heapUsedMB}MB`);
    console.log(`💡 Recommendations:`);
    alert.recommendations.forEach(rec => console.log(`   - ${rec}`));
    
    if (alert.actions.heapDumpGenerated) {
      console.log(`💾 Heap dump: ${alert.actions.heapDumpGenerated}`);
      console.log(`   Analyze with: node --inspect-brk your-app.js`);
    }
  });
  
  detector.on('heap_analyzed', (analysis) => {
    console.log(`\n🔍 Heap Analysis Results:`);
    console.log(`   Memory leak suspected: ${analysis.analysis.memoryLeakSuspected ? '⚠️  YES' : '✅ NO'}`);
    console.log(`   Growth areas detected: ${analysis.analysis.growthAreas.length}`);
    
    if (analysis.analysis.growthAreas.length > 0) {
      console.log(`   Top growth areas:`);
      analysis.analysis.growthAreas.slice(0, 3).forEach(area => {
        const sizeMB = (area.sizeDelta / (1024 * 1024)).toFixed(2);
        console.log(`     - ${area.what}: +${sizeMB}MB`);
      });
    }
  });
  
  // Start development monitoring
  await detector.start();
  
  // Simulate some development scenarios
  console.log('\nSimulating development memory usage...');
  
  // Take regular snapshots
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const snapshot = await detector.takeSnapshot('global');
    const heapMB = Math.round(snapshot.heapUsed / (1024 * 1024));
    console.log(`Snapshot ${i + 1}: ${heapMB}MB heap usage`);
  }
  
  // Perform analysis
  console.log('\nRunning heap analysis...');
  await detector.analyzeHeap();
  
  // Show development dashboard
  const dashboard = detector.getMemoryDashboard();
  console.log(`\n📊 Development Dashboard:`);
  console.log(`   Status: ${dashboard.status}`);
  console.log(`   Memory usage: ${dashboard.summary.heapUsedMB}MB / ${dashboard.summary.memoryBudgetUsage}%`);
  console.log(`   Growth rate: ${dashboard.trends.memoryGrowthRate} MB/min`);
  console.log(`   Active alerts: ${dashboard.summary.activeAlerts}`);
  
  await detector.stop();
  console.log('Development monitoring stopped');
}

/**
 * Integration with Enhanced Performance Monitor
 */
export async function integratedPerformanceMonitoring() {
  console.log('\n=== Integrated Performance Monitoring ===');
  
  // Create base performance monitor
  const baseMonitor = new PerformanceMonitor({
    enabled: true,
    profiling: { enabled: false, heapSnapshots: false, cpuProfile: false, interval: 30000 },
    optimization: { enabled: true, recommendationEngine: true, autoTuning: false },
    slaTargets: { availability: 99.9, responseTime: 500, errorRate: 1, throughput: 100 },
    thresholds: { cpu: 80, memory: 85, responseTime: 1000, errorRate: 5 }
  });
  
  // Create metrics collector
  const metricsCollector = new MetricsCollector({
    enabled: true,
    prometheusEnabled: false,
    customMetrics: true,
    retentionDays: 1
  });
  
  // Memory leak detection configuration
  const memoryConfig = {
    thresholds: {
      maxHeapUsageMB: 200,
      memoryGrowthRateMBPerMin: 3,
      heapGrowthPercentage: 10,
      eventFileAccumulationThreshold: 1000
    }
  };
  
  // Create enhanced monitor with memory leak detection
  const enhancedMonitor = new EnhancedPerformanceMonitor(
    baseMonitor,
    undefined, // No clinic profiler
    metricsCollector,
    memoryConfig
  );
  
  // Set up integrated event handlers
  enhancedMonitor.on('memory_leak_alert', (alert: MemoryLeakAlert) => {
    console.log(`🚨 Integrated Memory Alert: ${alert.type} (${alert.severity})`);
  });
  
  enhancedMonitor.on('degradation_alert', (alert) => {
    console.log(`⚠️  Performance Degradation: ${alert.metric} (${alert.severity})`);
  });
  
  enhancedMonitor.on('dashboard_updated', (dashboard) => {
    console.log(`📊 Dashboard Updated - Status: ${dashboard.summary.status}, Score: ${dashboard.summary.score}`);
  });
  
  // Initialize and start
  await enhancedMonitor.initialize();
  await enhancedMonitor.start();
  
  console.log('Integrated monitoring started');
  
  // Simulate some MCP operations
  console.log('\nSimulating MCP tool operations...');
  
  const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep'];
  for (let i = 0; i < 10; i++) {
    const tool = tools[i % tools.length];
    const duration = Math.random() * 100 + 50;
    const success = Math.random() > 0.1; // 90% success rate
    
    enhancedMonitor.recordToolExecution(tool, duration, success);
    enhancedMonitor.recordResourceAccess('read', 1024 * Math.random(), duration * 0.8);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Get comprehensive performance data
  const performanceDashboard = enhancedMonitor.getPerformanceDashboard();
  const memoryDashboard = enhancedMonitor.getMemoryDashboard();
  const toolMetrics = enhancedMonitor.getToolMetrics();
  
  console.log(`\n📊 Integrated Performance Results:`);
  console.log(`   Overall Status: ${performanceDashboard?.summary.status}`);
  console.log(`   Performance Score: ${performanceDashboard?.summary.score}/100`);
  console.log(`   Memory Status: ${memoryDashboard?.status}`);
  console.log(`   Memory Budget Usage: ${memoryDashboard?.summary.memoryBudgetUsage}%`);
  console.log(`   Tools Monitored: ${toolMetrics.size}`);
  
  await enhancedMonitor.stop();
  console.log('Integrated monitoring stopped');
}

/**
 * Memory Leak Simulation for Testing
 */
export async function simulateMemoryLeak() {
  console.log('\n=== Memory Leak Simulation ===');
  
  const detector = new MemoryLeakDetector({
    thresholds: {
      maxHeapUsageMB: 50, // Low threshold for quick detection
      memoryGrowthRateMBPerMin: 1,
      heapGrowthPercentage: 5,
      eventFileAccumulationThreshold: 50
    },
    monitoring: {
      snapshotIntervalMs: 5000,
      heapDiffIntervalMs: 10000,
      gcMonitoringEnabled: true,
      alertCooldownMs: 1000
    }
  });
  
  let alertCount = 0;
  detector.on('memory_alert', (alert) => {
    alertCount++;
    console.log(`🚨 Alert ${alertCount}: ${alert.type} - ${alert.message}`);
  });
  
  await detector.start();
  
  // Simulate memory leak pattern
  console.log('Simulating gradual memory increase...');
  
  let simulatedHeapMB = 30;
  const originalMemoryUsage = process.memoryUsage;
  
  // Mock increasing memory usage
  (process as any).memoryUsage = () => ({
    rss: 100 * 1024 * 1024,
    heapTotal: 80 * 1024 * 1024,
    heapUsed: simulatedHeapMB * 1024 * 1024,
    external: 5 * 1024 * 1024,
    arrayBuffers: 1 * 1024 * 1024
  });
  
  for (let i = 0; i < 10; i++) {
    simulatedHeapMB += 5; // Increase by 5MB each iteration
    
    await detector.takeSnapshot('global');
    console.log(`Iteration ${i + 1}: Simulated heap usage ${simulatedHeapMB}MB`);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Restore original function
  process.memoryUsage = originalMemoryUsage;
  
  console.log(`\nSimulation complete. Generated ${alertCount} alerts.`);
  
  const dashboard = detector.getMemoryDashboard();
  console.log(`Final status: ${dashboard.status}`);
  console.log(`Recommendations: ${dashboard.recommendations.length}`);
  
  await detector.stop();
}

// Helper functions for production example
async function sendCriticalAlert(alert: MemoryLeakAlert): Promise<void> {
  // Simulate sending alert to monitoring system
  console.log(`📧 Critical alert sent to operations team: ${alert.message}`);
}

async function triggerFileCleanup(area: string): Promise<void> {
  // Simulate triggering cleanup
  console.log(`🧹 Triggering cleanup for area: ${area}`);
}

function notifyOperationsTeam(message: string): void {
  // Simulate notification
  console.log(`📞 Operations team notified: ${message}`);
}

// Run examples if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      await basicMemoryLeakDetection();
      await developmentMemoryLeakDetection();
      await integratedPerformanceMonitoring();
      await simulateMemoryLeak();
      // await productionMemoryLeakDetection(); // Commented out as it runs longer
      
      console.log('\n✅ All examples completed successfully!');
    } catch (error) {
      console.error('❌ Example failed:', error);
      process.exit(1);
    }
  })();
}
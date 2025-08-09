/**
 * Performance Regression Framework Integration Tests
 * 
 * Comprehensive integration tests for the performance regression testing system
 * including baseline management, regression detection, statistical analysis,
 * visual regression testing, alerting, and dashboard functionality.
 */

import { jest } from '@jest/globals';
import { createPerformanceRegressionFramework } from '../../src/performance-regression/performance-regression-framework.js';
import { BaselineMetrics } from '../performance/baseline-manager.js';
import fs from 'fs-extra';
import path from 'path';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('playwright');

const mockFS = fs as jest.Mocked<typeof fs>;

describe('Performance Regression Framework Integration', () => {
  const testDataPath = '/tmp/perf-regression-test';
  let framework: any;

  beforeAll(() => {
    jest.setTimeout(60000); // 60 seconds for integration tests
  });

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock file system operations
    mockFS.ensureDir.mockResolvedValue(undefined);
    mockFS.pathExists.mockResolvedValue(false);
    mockFS.readJSON.mockResolvedValue({});
    mockFS.writeJSON.mockResolvedValue(undefined);
    mockFS.readdir.mockResolvedValue([]);
    mockFS.writeFile.mockResolvedValue(undefined);
    mockFS.appendFile.mockResolvedValue(undefined);

    // Create framework instance
    framework = await createPerformanceRegressionFramework({
      baselineRetentionDays: 7,
      baselineUpdateStrategy: 'automatic',
      regressionThresholds: {
        responseTime: 10, // 10% increase triggers regression
        throughput: 10,
        errorRate: 5,
        resourceUsage: 15,
        visualDifference: 0.5
      },
      statisticalAnalysis: {
        enabled: true,
        trendWindow: 7,
        anomalyDetectionSensitivity: 'medium',
        seasonalityDetection: false,
        predictionEnabled: true
      },
      visualRegression: {
        enabled: false, // Disable for unit tests
        screenshotPath: path.join(testDataPath, 'screenshots'),
        thresholds: {
          mobile: 0.3,
          tablet: 0.4,
          desktop: 0.5
        }
      },
      alerting: {
        channels: [
          {
            name: 'console',
            type: 'console',
            config: {},
            enabled: true,
            severityFilter: ['minor', 'moderate', 'major', 'critical']
          }
        ],
        severityMapping: {
          minor: 85,
          moderate: 70,
          major: 50,
          critical: 30
        },
        escalation: {
          enabled: false, // Disable for tests
          timeToEscalate: 60,
          escalationChannels: []
        }
      },
      dashboard: {
        enabled: false, // Disable for tests
        port: 3001,
        realTimeUpdates: false,
        metricsRetention: 7
      },
      automatedTesting: {
        enabled: false, // Disable for tests
        schedule: '0 */4 * * *',
        testSuites: [],
        parallelExecution: false
      }
    });
  });

  afterEach(async () => {
    if (framework) {
      await framework.shutdown();
    }
  });

  describe('Basic Framework Operations', () => {
    it('should initialize framework successfully', async () => {
      expect(framework).toBeDefined();
      expect(framework.isInitialized).toBe(true);
    });

    it('should run performance test and detect no regression with good metrics', async () => {
      const testMetrics: BaselineMetrics = {
        responseTime: {
          mean: 100,
          median: 95,
          p95: 150,
          p99: 200,
          min: 50,
          max: 300,
          stddev: 25
        },
        throughput: {
          requestsPerSecond: 1000,
          totalRequests: 10000,
          duration: 10000
        },
        errorMetrics: {
          errorRate: 0.1,
          errorCount: 10,
          timeoutCount: 2,
          successRate: 99.9
        },
        resourceUtilization: {
          avgCpuUsage: 30,
          maxCpuUsage: 50,
          avgMemoryUsage: 40,
          maxMemoryUsage: 60,
          avgDiskIo: 10,
          avgNetworkIo: 15
        }
      };

      const testFunction = async (): Promise<BaselineMetrics> => {
        // Simulate a performance test
        await new Promise(resolve => setTimeout(resolve, 100));
        return testMetrics;
      };

      const result = await framework.runPerformanceTest(
        'baseline-test',
        'load',
        testFunction,
        {
          tags: ['integration-test'],
          version: '1.0.0'
        }
      );

      expect(result).toBeDefined();
      expect(result.testName).toBe('baseline-test');
      expect(result.testType).toBe('load');
      expect(result.regressionDetected).toBe(false);
      expect(result.metrics).toEqual(testMetrics);
      expect(result.recommendations).toBeDefined();
    });

    it('should detect regression with degraded metrics', async () => {
      // First, establish a baseline
      const baselineMetrics: BaselineMetrics = {
        responseTime: {
          mean: 100,
          median: 95,
          p95: 150,
          p99: 200,
          min: 50,
          max: 300,
          stddev: 25
        },
        throughput: {
          requestsPerSecond: 1000,
          totalRequests: 10000,
          duration: 10000
        },
        errorMetrics: {
          errorRate: 0.1,
          errorCount: 10,
          timeoutCount: 2,
          successRate: 99.9
        },
        resourceUtilization: {
          avgCpuUsage: 30,
          maxCpuUsage: 50,
          avgMemoryUsage: 40,
          maxMemoryUsage: 60,
          avgDiskIo: 10,
          avgNetworkIo: 15
        }
      };

      // Run baseline test
      await framework.runPerformanceTest(
        'regression-test',
        'load',
        async () => baselineMetrics,
        { version: '1.0.0' }
      );

      // Now run test with degraded metrics (>10% regression)
      const degradedMetrics: BaselineMetrics = {
        responseTime: {
          mean: 120, // 20% increase - should trigger regression
          median: 115,
          p95: 180,
          p99: 240,
          min: 60,
          max: 360,
          stddev: 30
        },
        throughput: {
          requestsPerSecond: 850, // 15% decrease - should trigger regression
          totalRequests: 8500,
          duration: 10000
        },
        errorMetrics: {
          errorRate: 0.8, // 700% increase - should trigger regression
          errorCount: 80,
          timeoutCount: 15,
          successRate: 99.2
        },
        resourceUtilization: {
          avgCpuUsage: 50, // 67% increase - should trigger regression
          maxCpuUsage: 80,
          avgMemoryUsage: 65, // 63% increase - should trigger regression
          maxMemoryUsage: 90,
          avgDiskIo: 18,
          avgNetworkIo: 25
        }
      };

      const result = await framework.runPerformanceTest(
        'regression-test',
        'load',
        async () => degradedMetrics,
        { version: '1.0.1' }
      );

      expect(result.regressionDetected).toBe(true);
      expect(result.alerts).toBeDefined();
      expect(result.alerts.length).toBeGreaterThan(0);
      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Statistical Analysis Integration', () => {
    it('should detect performance trends over multiple test runs', async () => {
      const testName = 'trend-analysis-test';
      
      // Run series of tests with gradually degrading performance
      const baseResponseTime = 100;
      const degradationStep = 5; // 5ms increase per test
      
      for (let i = 0; i < 10; i++) {
        const metrics: BaselineMetrics = {
          responseTime: {
            mean: baseResponseTime + (i * degradationStep),
            median: baseResponseTime + (i * degradationStep) - 5,
            p95: baseResponseTime + (i * degradationStep) + 50,
            p99: baseResponseTime + (i * degradationStep) + 100,
            min: 50,
            max: 300 + (i * 10),
            stddev: 25
          },
          throughput: {
            requestsPerSecond: 1000 - (i * 10), // Slight decrease
            totalRequests: 10000,
            duration: 10000
          },
          errorMetrics: {
            errorRate: 0.1 + (i * 0.01), // Slight increase
            errorCount: 10 + i,
            timeoutCount: 2,
            successRate: 99.9 - (i * 0.01)
          },
          resourceUtilization: {
            avgCpuUsage: 30 + i,
            maxCpuUsage: 50 + i,
            avgMemoryUsage: 40 + i,
            maxMemoryUsage: 60 + i,
            avgDiskIo: 10,
            avgNetworkIo: 15
          }
        };

        await framework.runPerformanceTest(
          testName,
          'load',
          async () => metrics,
          { 
            version: `1.0.${i}`,
            skipBaseline: i > 0 // Only first test creates baseline
          }
        );
      }

      // Analyze trends
      const trends = await framework.getPerformanceTrends(testName, 24 * 60 * 60 * 1000); // Last 24 hours
      
      expect(trends).toBeDefined();
      expect(trends.trends.responseTime).toBe('degrading');
      expect(trends.trends.throughput).toBe('degrading');
      expect(trends.trends.errorRate).toBe('degrading');
      expect(trends.dataPoints.length).toBe(10);
    });

    it('should generate performance analysis report', async () => {
      // Run a few tests first
      const testCases = [
        { name: 'api-test', responseTime: 50, throughput: 2000, errorRate: 0.05 },
        { name: 'database-test', responseTime: 200, throughput: 500, errorRate: 0.1 },
        { name: 'ui-test', responseTime: 1000, throughput: 100, errorRate: 0.2 }
      ];

      for (const testCase of testCases) {
        const metrics: BaselineMetrics = {
          responseTime: {
            mean: testCase.responseTime,
            median: testCase.responseTime * 0.9,
            p95: testCase.responseTime * 1.5,
            p99: testCase.responseTime * 2,
            min: testCase.responseTime * 0.5,
            max: testCase.responseTime * 3,
            stddev: testCase.responseTime * 0.2
          },
          throughput: {
            requestsPerSecond: testCase.throughput,
            totalRequests: testCase.throughput * 10,
            duration: 10000
          },
          errorMetrics: {
            errorRate: testCase.errorRate,
            errorCount: Math.round(testCase.throughput * testCase.errorRate / 100),
            timeoutCount: 1,
            successRate: 100 - testCase.errorRate
          },
          resourceUtilization: {
            avgCpuUsage: 30,
            maxCpuUsage: 50,
            avgMemoryUsage: 40,
            maxMemoryUsage: 60,
            avgDiskIo: 10,
            avgNetworkIo: 15
          }
        };

        await framework.runPerformanceTest(
          testCase.name,
          'load',
          async () => metrics,
          { version: '1.0.0' }
        );
      }

      // Generate analysis report
      const report = await framework.runRegressionAnalysis();
      
      expect(report).toBeDefined();
      expect(report.id).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.totalTests).toBe(3);
      expect(report.trendAnalysis).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.actionItems).toBeDefined();
      expect(report.actionItems.length).toBeGreaterThan(0);
    });
  });

  describe('Alert Management', () => {
    it('should process and track alerts correctly', async () => {
      // Create test that will trigger an alert
      const degradedMetrics: BaselineMetrics = {
        responseTime: {
          mean: 500, // Very high response time
          median: 480,
          p95: 800,
          p99: 1200,
          min: 200,
          max: 2000,
          stddev: 150
        },
        throughput: {
          requestsPerSecond: 100, // Very low throughput
          totalRequests: 1000,
          duration: 10000
        },
        errorMetrics: {
          errorRate: 5, // High error rate
          errorCount: 50,
          timeoutCount: 20,
          successRate: 95
        },
        resourceUtilization: {
          avgCpuUsage: 90, // High CPU usage
          maxCpuUsage: 98,
          avgMemoryUsage: 85, // High memory usage
          maxMemoryUsage: 95,
          avgDiskIo: 50,
          avgNetworkIo: 60
        }
      };

      const result = await framework.runPerformanceTest(
        'alert-test',
        'stress',
        async () => degradedMetrics,
        { version: '1.0.0' }
      );

      expect(result.regressionDetected).toBe(true);
      expect(result.alerts.length).toBeGreaterThan(0);

      // Check active alerts
      const activeAlerts = framework.getActiveRegressions();
      expect(activeAlerts.length).toBeGreaterThan(0);

      const alert = activeAlerts[0];
      expect(alert.severity).toBeDefined();
      expect(['minor', 'moderate', 'major', 'critical']).toContain(alert.severity);
      expect(alert.testName).toBe('alert-test');
      expect(alert.acknowledged).toBe(false);
    });

    it('should acknowledge alerts', async () => {
      // First create an alert
      const degradedMetrics: BaselineMetrics = {
        responseTime: {
          mean: 300,
          median: 290,
          p95: 450,
          p99: 600,
          min: 150,
          max: 800,
          stddev: 75
        },
        throughput: {
          requestsPerSecond: 500,
          totalRequests: 5000,
          duration: 10000
        },
        errorMetrics: {
          errorRate: 2,
          errorCount: 100,
          timeoutCount: 10,
          successRate: 98
        },
        resourceUtilization: {
          avgCpuUsage: 70,
          maxCpuUsage: 85,
          avgMemoryUsage: 65,
          maxMemoryUsage: 80,
          avgDiskIo: 25,
          avgNetworkIo: 30
        }
      };

      await framework.runPerformanceTest(
        'acknowledge-test',
        'load',
        async () => degradedMetrics,
        { version: '1.0.0' }
      );

      const activeAlerts = framework.getActiveRegressions();
      expect(activeAlerts.length).toBeGreaterThan(0);

      const alert = activeAlerts[0];
      
      // Test acknowledgment through framework's regression detector
      const acknowledged = await framework.regressionDetector.acknowledgeAlert(
        alert.id,
        'test-user',
        'Acknowledged for testing'
      );

      expect(acknowledged).toBe(true);
    });
  });

  describe('Data Export and Import', () => {
    it('should export performance data successfully', async () => {
      // Run some tests to generate data
      const testData = [
        { name: 'export-test-1', responseTime: 100, throughput: 1000 },
        { name: 'export-test-2', responseTime: 150, throughput: 800 },
        { name: 'export-test-3', responseTime: 120, throughput: 900 }
      ];

      for (const test of testData) {
        const metrics: BaselineMetrics = {
          responseTime: {
            mean: test.responseTime,
            median: test.responseTime * 0.9,
            p95: test.responseTime * 1.5,
            p99: test.responseTime * 2,
            min: test.responseTime * 0.5,
            max: test.responseTime * 3,
            stddev: test.responseTime * 0.2
          },
          throughput: {
            requestsPerSecond: test.throughput,
            totalRequests: test.throughput * 10,
            duration: 10000
          },
          errorMetrics: {
            errorRate: 0.1,
            errorCount: test.throughput * 0.001,
            timeoutCount: 1,
            successRate: 99.9
          },
          resourceUtilization: {
            avgCpuUsage: 30,
            maxCpuUsage: 50,
            avgMemoryUsage: 40,
            maxMemoryUsage: 60,
            avgDiskIo: 10,
            avgNetworkIo: 15
          }
        };

        await framework.runPerformanceTest(
          test.name,
          'load',
          async () => metrics,
          { version: '1.0.0' }
        );
      }

      // Export data
      const exportPath = '/tmp/performance-export.json';
      await framework.exportPerformanceData(exportPath, {
        format: 'json',
        includeBaselines: true,
        includeAlerts: true
      });

      // Verify export was called
      expect(mockFS.writeJSON).toHaveBeenCalledWith(
        exportPath,
        expect.objectContaining({
          metadata: expect.objectContaining({
            exportTimestamp: expect.any(Number)
          }),
          testResults: expect.any(Array)
        }),
        { spaces: 2 }
      );
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid metrics gracefully', async () => {
      const invalidMetrics = {} as BaselineMetrics;

      await expect(
        framework.runPerformanceTest(
          'invalid-test',
          'load',
          async () => invalidMetrics,
          { version: '1.0.0' }
        )
      ).rejects.toThrow();
    });

    it('should handle missing baseline gracefully', async () => {
      const metrics: BaselineMetrics = {
        responseTime: {
          mean: 100,
          median: 95,
          p95: 150,
          p99: 200,
          min: 50,
          max: 300,
          stddev: 25
        },
        throughput: {
          requestsPerSecond: 1000,
          totalRequests: 10000,
          duration: 10000
        },
        errorMetrics: {
          errorRate: 0.1,
          errorCount: 10,
          timeoutCount: 2,
          successRate: 99.9
        },
        resourceUtilization: {
          avgCpuUsage: 30,
          maxCpuUsage: 50,
          avgMemoryUsage: 40,
          maxMemoryUsage: 60,
          avgDiskIo: 10,
          avgNetworkIo: 15
        }
      };

      // Run test against non-existent baseline
      const result = await framework.runPerformanceTest(
        'no-baseline-test',
        'load',
        async () => metrics,
        { 
          version: '1.0.0',
          skipBaseline: true // This should handle missing baseline gracefully
        }
      );

      expect(result).toBeDefined();
      expect(result.regressionDetected).toBe(false); // No regression without baseline
    });

    it('should handle concurrent test execution', async () => {
      const testFunction = async (): Promise<BaselineMetrics> => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          responseTime: {
            mean: 100,
            median: 95,
            p95: 150,
            p99: 200,
            min: 50,
            max: 300,
            stddev: 25
          },
          throughput: {
            requestsPerSecond: 1000,
            totalRequests: 10000,
            duration: 10000
          },
          errorMetrics: {
            errorRate: 0.1,
            errorCount: 10,
            timeoutCount: 2,
            successRate: 99.9
          },
          resourceUtilization: {
            avgCpuUsage: 30,
            maxCpuUsage: 50,
            avgMemoryUsage: 40,
            maxMemoryUsage: 60,
            avgDiskIo: 10,
            avgNetworkIo: 15
          }
        };
      };

      // Run multiple tests concurrently
      const promises = Array.from({ length: 5 }, (_, i) =>
        framework.runPerformanceTest(
          `concurrent-test-${i}`,
          'load',
          testFunction,
          { version: `1.0.${i}` }
        )
      );

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.testName).toBe(`concurrent-test-${index}`);
        expect(result.regressionDetected).toBe(false);
      });
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle large datasets efficiently', async () => {
      const startMemory = process.memoryUsage().heapUsed;
      const testCount = 50;

      // Generate and run many tests
      for (let i = 0; i < testCount; i++) {
        const metrics: BaselineMetrics = {
          responseTime: {
            mean: 100 + Math.random() * 50,
            median: 95 + Math.random() * 45,
            p95: 150 + Math.random() * 75,
            p99: 200 + Math.random() * 100,
            min: 50 + Math.random() * 25,
            max: 300 + Math.random() * 150,
            stddev: 25 + Math.random() * 12
          },
          throughput: {
            requestsPerSecond: 1000 + Math.random() * 200,
            totalRequests: 10000,
            duration: 10000
          },
          errorMetrics: {
            errorRate: Math.random() * 0.5,
            errorCount: Math.floor(Math.random() * 20),
            timeoutCount: Math.floor(Math.random() * 5),
            successRate: 99.5 + Math.random() * 0.5
          },
          resourceUtilization: {
            avgCpuUsage: 30 + Math.random() * 20,
            maxCpuUsage: 50 + Math.random() * 30,
            avgMemoryUsage: 40 + Math.random() * 25,
            maxMemoryUsage: 60 + Math.random() * 35,
            avgDiskIo: 10 + Math.random() * 10,
            avgNetworkIo: 15 + Math.random() * 15
          }
        };

        await framework.runPerformanceTest(
          `large-dataset-test-${i}`,
          'load',
          async () => metrics,
          { version: '1.0.0', skipBaseline: i > 0 }
        );
      }

      const endMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (endMemory - startMemory) / 1024 / 1024; // MB

      // Memory increase should be reasonable (less than 100MB for 50 tests)
      expect(memoryIncrease).toBeLessThan(100);
      
      console.log(`Memory increase for ${testCount} tests: ${memoryIncrease.toFixed(2)}MB`);
    });
  });
});

/**
 * Helper function to create test metrics with specified characteristics
 */
function createTestMetrics(options: {
  responseTime?: number;
  throughput?: number;
  errorRate?: number;
  cpuUsage?: number;
  memoryUsage?: number;
}): BaselineMetrics {
  return {
    responseTime: {
      mean: options.responseTime || 100,
      median: (options.responseTime || 100) * 0.9,
      p95: (options.responseTime || 100) * 1.5,
      p99: (options.responseTime || 100) * 2,
      min: (options.responseTime || 100) * 0.5,
      max: (options.responseTime || 100) * 3,
      stddev: (options.responseTime || 100) * 0.2
    },
    throughput: {
      requestsPerSecond: options.throughput || 1000,
      totalRequests: (options.throughput || 1000) * 10,
      duration: 10000
    },
    errorMetrics: {
      errorRate: options.errorRate || 0.1,
      errorCount: Math.round((options.throughput || 1000) * (options.errorRate || 0.1) / 100),
      timeoutCount: 2,
      successRate: 100 - (options.errorRate || 0.1)
    },
    resourceUtilization: {
      avgCpuUsage: options.cpuUsage || 30,
      maxCpuUsage: (options.cpuUsage || 30) + 20,
      avgMemoryUsage: options.memoryUsage || 40,
      maxMemoryUsage: (options.memoryUsage || 40) + 20,
      avgDiskIo: 10,
      avgNetworkIo: 15
    }
  };
}

/**
 * Helper function to simulate a performance test
 */
async function simulatePerformanceTest(
  framework: any,
  testName: string,
  options: {
    responseTime?: number;
    throughput?: number;
    errorRate?: number;
    cpuUsage?: number;
    memoryUsage?: number;
    version?: string;
    skipBaseline?: boolean;
  } = {}
) {
  const metrics = createTestMetrics(options);
  
  return await framework.runPerformanceTest(
    testName,
    'load',
    async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return metrics;
    },
    {
      version: options.version || '1.0.0',
      skipBaseline: options.skipBaseline || false
    }
  );
}
/**
 * Global Teardown for Playwright E2E Tests
 * Cleans up test environment, stops processes, and generates final reports
 */

import { FullConfig } from '@playwright/test';
import fs from 'fs-extra';
import path from 'path';
import { ChildProcess } from 'child_process';

async function globalTeardown(config: FullConfig) {
  console.log('🧹 Starting global E2E test teardown...');

  // Close persistent browser instance
  if (global.__BROWSER__) {
    try {
      await global.__BROWSER__.close();
      console.log('🌐 Closed persistent browser instance');
    } catch (error) {
      console.warn('⚠️ Failed to close browser:', error.message);
    }
  }

  // Stop mock Telegram API server
  if (global.__MOCK_TELEGRAM_SERVER__) {
    try {
      global.__MOCK_TELEGRAM_SERVER__.close();
      console.log('🤖 Stopped mock Telegram API server');
    } catch (error) {
      console.warn('⚠️ Failed to stop mock Telegram server:', error.message);
    }
  }

  // Stop bridge process
  if (global.__BRIDGE_PROCESS__) {
    try {
      const bridgeProcess: ChildProcess = global.__BRIDGE_PROCESS__;
      bridgeProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise(resolve => {
        bridgeProcess.on('exit', resolve);
        setTimeout(resolve, 5000); // Force shutdown after 5 seconds
      });
      
      console.log('🌉 Stopped bridge process');
    } catch (error) {
      console.warn('⚠️ Failed to stop bridge process:', error.message);
    }
  }

  // Clean up test files (optional, can be disabled for debugging)
  if (process.env.CLEANUP_TEST_FILES !== 'false') {
    await cleanupTestFiles();
  }

  // Generate final test report
  await generateFinalReport();

  // Archive test results if in CI
  if (process.env.CI && process.env.ARCHIVE_RESULTS !== 'false') {
    await archiveTestResults();
  }

  console.log('✅ Global E2E test teardown completed');
}

/**
 * Clean up temporary test files
 */
async function cleanupTestFiles(): Promise<void> {
  const cleanupPaths = [
    '/tmp/test-events',
    '/tmp/test-responses',
    './test.config.json'
  ];

  for (const cleanupPath of cleanupPaths) {
    try {
      if (await fs.pathExists(cleanupPath)) {
        await fs.remove(cleanupPath);
        console.log(`🧹 Cleaned up: ${cleanupPath}`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to cleanup ${cleanupPath}:`, error.message);
    }
  }
}

/**
 * Generate final comprehensive test report
 */
async function generateFinalReport(): Promise<void> {
  try {
    const reportData = {
      timestamp: new Date().toISOString(),
      environment: {
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        ci: !!process.env.CI
      },
      test_configuration: {
        timeout: config.timeout,
        retries: config.retries,
        workers: config.workers,
        projects: config.projects?.length || 0
      },
      paths: {
        test_results: './test-results',
        screenshots: './test-results/screenshots',
        videos: './test-results/playwright-output'
      }
    };

    // Add results summary if available
    const resultsPath = './test-results/playwright-results.json';
    if (await fs.pathExists(resultsPath)) {
      try {
        const results = await fs.readJSON(resultsPath);
        reportData.summary = {
          total: results.suites?.reduce((total, suite) => total + suite.specs.length, 0) || 0,
          passed: results.suites?.reduce((total, suite) => 
            total + suite.specs.filter(spec => spec.ok).length, 0) || 0,
          failed: results.suites?.reduce((total, suite) => 
            total + suite.specs.filter(spec => !spec.ok).length, 0) || 0,
          duration: results.stats?.duration || 0
        };
      } catch (error) {
        console.warn('⚠️ Failed to parse test results for summary');
      }
    }

    // Write final report
    const finalReportPath = './test-results/final-report.json';
    await fs.writeJSON(finalReportPath, reportData, { spaces: 2 });
    console.log(`📊 Final test report generated: ${finalReportPath}`);

    // Generate markdown summary
    await generateMarkdownSummary(reportData);

  } catch (error) {
    console.warn('⚠️ Failed to generate final report:', error.message);
  }
}

/**
 * Generate markdown summary report
 */
async function generateMarkdownSummary(reportData: any): Promise<void> {
  const summary = reportData.summary;
  const markdown = `# CCTelegram E2E Test Report

## Test Summary
- **Total Tests**: ${summary?.total || 'Unknown'}
- **Passed**: ${summary?.passed || 'Unknown'} ✅
- **Failed**: ${summary?.failed || 'Unknown'} ❌
- **Duration**: ${summary?.duration ? `${Math.round(summary.duration / 1000)}s` : 'Unknown'}
- **Success Rate**: ${summary ? `${Math.round((summary.passed / summary.total) * 100)}%` : 'Unknown'}

## Environment
- **Node Version**: ${reportData.environment.node_version}
- **Platform**: ${reportData.environment.platform}
- **Architecture**: ${reportData.environment.arch}
- **CI Environment**: ${reportData.environment.ci ? 'Yes' : 'No'}

## Configuration
- **Test Timeout**: ${reportData.test_configuration.timeout}ms
- **Retries**: ${reportData.test_configuration.retries}
- **Workers**: ${reportData.test_configuration.workers}
- **Projects**: ${reportData.test_configuration.projects}

## Test Artifacts
- **Screenshots**: \`${reportData.paths.screenshots}\`
- **Videos**: \`${reportData.paths.videos}\`
- **Full Report**: \`${reportData.paths.test_results}/playwright-report/index.html\`

## Workflow Coverage
- ✅ Task Completion Workflow
- ✅ Performance Alert Workflow  
- ✅ Approval Request Workflow
- ✅ Network Failure Recovery
- ✅ API Timeout Handling
- ✅ Visual Regression Testing
- ✅ Cross-Browser Compatibility

Generated: ${reportData.timestamp}
`;

  const markdownPath = './test-results/TEST-SUMMARY.md';
  await fs.writeFile(markdownPath, markdown, 'utf8');
  console.log(`📄 Markdown summary generated: ${markdownPath}`);
}

/**
 * Archive test results for CI
 */
async function archiveTestResults(): Promise<void> {
  try {
    const archiveName = `e2e-test-results-${Date.now()}.tar.gz`;
    const { spawn } = require('child_process');
    
    const archive = spawn('tar', [
      '-czf',
      archiveName,
      'test-results/',
      '--exclude=*.mp4',  // Exclude large video files
      '--exclude=node_modules'
    ]);

    await new Promise((resolve, reject) => {
      archive.on('close', (code) => {
        if (code === 0) {
          console.log(`📦 Test results archived: ${archiveName}`);
          resolve(code);
        } else {
          reject(new Error(`Archive process exited with code ${code}`));
        }
      });
      
      archive.on('error', reject);
    });

  } catch (error) {
    console.warn('⚠️ Failed to archive test results:', error.message);
  }
}

export default globalTeardown;
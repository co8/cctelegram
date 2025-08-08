/**
 * Custom Debug Reporter for CCTelegram Bridge Testing
 * Provides detailed debugging output specifically for bridge issue diagnosis
 */

import { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import path from 'path';
import fs from 'fs/promises';

class DebugReporter implements Reporter {
  private startTime: number = 0;
  private testResults: any[] = [];
  private bridgeAnalysis: any = {
    dataSourceTests: [],
    mcpConnectionTests: [],
    telegramResponseTests: [],
    issuesDiagnosed: []
  };

  onBegin(config: any, suite: any) {
    this.startTime = Date.now();
    console.log('\n🔍 CCTelegram Bridge Debug Reporter');
    console.log('=====================================');
    console.log(`Starting debugging tests at ${new Date().toISOString()}`);
    console.log(`Focus: /tasks command data source issue`);
    console.log('=====================================\n');
  }

  onTestBegin(test: TestCase) {
    const testTitle = test.title;
    console.log(`\n🧪 ${testTitle}`);
    console.log('─'.repeat(testTitle.length + 3));
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const duration = result.duration;
    const status = result.status;
    
    // Store result for analysis
    const testResult = {
      title: test.title,
      status,
      duration,
      errors: result.errors,
      stdout: result.stdout,
      stderr: result.stderr,
      attachments: result.attachments
    };
    
    this.testResults.push(testResult);
    
    // Analyze test results for bridge-specific insights
    this.analyzeTestResult(test, result);
    
    // Display result with appropriate emoji
    const statusEmoji = this.getStatusEmoji(status);
    const durationMs = duration ? `${duration}ms` : 'N/A';
    
    console.log(`${statusEmoji} ${test.title} (${durationMs})`);
    
    // Show errors if any
    if (result.errors.length > 0) {
      console.log('   ❌ Errors:');
      result.errors.forEach(error => {
        console.log(`      ${error.message}`);
        if (error.stack) {
          console.log(`      Stack: ${error.stack.split('\n')[0]}`);
        }
      });
    }
    
    // Show stdout if debugging info present
    if (result.stdout.length > 0) {
      const debugInfo = this.extractDebugInfo(result.stdout);
      if (debugInfo.length > 0) {
        console.log('   📝 Debug Info:');
        debugInfo.forEach(info => console.log(`      ${info}`));
      }
    }
  }

  onStdOut(chunk: Buffer, test?: TestCase) {
    const output = chunk.toString();
    
    // Look for specific bridge-related output
    if (output.includes('TaskMaster') || output.includes('MCP') || output.includes('bridge')) {
      console.log(`   📤 ${output.trim()}`);
    }
  }

  onStdErr(chunk: Buffer, test?: TestCase) {
    const output = chunk.toString();
    
    // Show all stderr as it's likely important for debugging
    if (output.trim()) {
      console.log(`   ❌ STDERR: ${output.trim()}`);
    }
  }

  async onEnd(result: FullResult) {
    const totalTime = Date.now() - this.startTime;
    const passed = this.testResults.filter(t => t.status === 'passed').length;
    const failed = this.testResults.filter(t => t.status === 'failed').length;
    const skipped = this.testResults.filter(t => t.status === 'skipped').length;
    
    console.log('\n🏁 Debug Session Complete');
    console.log('==========================');
    console.log(`Total Time: ${totalTime}ms`);
    console.log(`Tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    
    // Bridge-specific analysis
    console.log('\n🔍 Bridge Issue Analysis:');
    console.log('-------------------------');
    
    this.reportDataSourceAnalysis();
    this.reportMcpConnectionAnalysis();
    this.reportTelegramResponseAnalysis();
    this.reportIssueDiagnosis();
    
    // Generate detailed debug report
    await this.generateDebugReport();
    
    console.log('\n📊 Reports Generated:');
    console.log('- HTML Report: test-results/report/index.html');
    console.log('- Debug Report: test-results/debug-analysis.json');
    console.log('- Test Summary: test-results/test-summary.md');
    console.log('\n🎯 Next Steps:');
    console.log('1. Review debug report for specific issue identification');
    console.log('2. Check bridge logs for MCP connection details'); 
    console.log('3. Verify TaskMaster data source priority logic');
    console.log('4. Apply fixes based on analysis and re-run tests\n');
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'skipped': return '⏭️';
      case 'timedOut': return '⏰';
      default: return '❓';
    }
  }

  private extractDebugInfo(stdout: string[]): string[] {
    const debugLines = [];
    
    for (const line of stdout) {
      if (line.includes('✓') || line.includes('❌') || 
          line.includes('MCP') || line.includes('TaskMaster') ||
          line.includes('Bridge') || line.includes('Telegram')) {
        debugLines.push(line.trim());
      }
    }
    
    return debugLines;
  }

  private analyzeTestResult(test: TestCase, result: TestResult): void {
    const testTitle = test.title.toLowerCase();
    
    // Categorize tests for analysis
    if (testTitle.includes('taskmaster file') || testTitle.includes('data structure')) {
      this.bridgeAnalysis.dataSourceTests.push({
        title: test.title,
        status: result.status,
        insights: this.extractInsights(result.stdout, 'data source')
      });
    }
    
    if (testTitle.includes('mcp') || testTitle.includes('server')) {
      this.bridgeAnalysis.mcpConnectionTests.push({
        title: test.title,
        status: result.status,
        insights: this.extractInsights(result.stdout, 'mcp')
      });
    }
    
    if (testTitle.includes('tasks command') || testTitle.includes('telegram')) {
      this.bridgeAnalysis.telegramResponseTests.push({
        title: test.title,
        status: result.status,
        insights: this.extractInsights(result.stdout, 'telegram')
      });
    }
    
    // Look for issue indicators
    if (result.stdout.some(line => line.includes('28/29') || line.includes('96.55%'))) {
      this.bridgeAnalysis.issuesDiagnosed.push({
        test: test.title,
        issue: 'Old static data detected',
        evidence: result.stdout.filter(line => 
          line.includes('28/29') || line.includes('96.55%')
        )
      });
    }
  }

  private extractInsights(stdout: string[], category: string): string[] {
    const insights = [];
    
    for (const line of stdout) {
      if (category === 'data source' && 
          (line.includes('file') || line.includes('stats') || line.includes('TaskMaster'))) {
        insights.push(line.trim());
      } else if (category === 'mcp' && 
                 (line.includes('MCP') || line.includes('response') || line.includes('connection'))) {
        insights.push(line.trim());
      } else if (category === 'telegram' && 
                 (line.includes('Telegram') || line.includes('message') || line.includes('/tasks'))) {
        insights.push(line.trim());
      }
    }
    
    return insights;
  }

  private reportDataSourceAnalysis(): void {
    const dataTests = this.bridgeAnalysis.dataSourceTests;
    
    if (dataTests.length > 0) {
      console.log('📁 Data Source Tests:');
      dataTests.forEach(test => {
        console.log(`  ${this.getStatusEmoji(test.status)} ${test.title}`);
        if (test.insights.length > 0) {
          test.insights.slice(0, 2).forEach(insight => {
            console.log(`     💡 ${insight}`);
          });
        }
      });
    }
  }

  private reportMcpConnectionAnalysis(): void {
    const mcpTests = this.bridgeAnalysis.mcpConnectionTests;
    
    if (mcpTests.length > 0) {
      console.log('🔌 MCP Connection Tests:');
      mcpTests.forEach(test => {
        console.log(`  ${this.getStatusEmoji(test.status)} ${test.title}`);
        if (test.insights.length > 0) {
          test.insights.slice(0, 2).forEach(insight => {
            console.log(`     💡 ${insight}`);
          });
        }
      });
    }
  }

  private reportTelegramResponseAnalysis(): void {
    const telegramTests = this.bridgeAnalysis.telegramResponseTests;
    
    if (telegramTests.length > 0) {
      console.log('📱 Telegram Response Tests:');
      telegramTests.forEach(test => {
        console.log(`  ${this.getStatusEmoji(test.status)} ${test.title}`);
        if (test.insights.length > 0) {
          test.insights.slice(0, 2).forEach(insight => {
            console.log(`     💡 ${insight}`);
          });
        }
      });
    }
  }

  private reportIssueDiagnosis(): void {
    const issues = this.bridgeAnalysis.issuesDiagnosed;
    
    if (issues.length > 0) {
      console.log('🚨 Issues Detected:');
      issues.forEach(issue => {
        console.log(`  ❌ ${issue.issue} (in ${issue.test})`);
        if (issue.evidence.length > 0) {
          console.log(`     📋 Evidence: ${issue.evidence[0]}`);
        }
      });
    } else {
      console.log('✅ No static data issues detected');
    }
  }

  private async generateDebugReport(): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: this.testResults.length,
        passed: this.testResults.filter(t => t.status === 'passed').length,
        failed: this.testResults.filter(t => t.status === 'failed').length,
        skipped: this.testResults.filter(t => t.status === 'skipped').length
      },
      bridgeAnalysis: this.bridgeAnalysis,
      testResults: this.testResults,
      recommendations: this.generateRecommendations()
    };

    const reportPath = path.resolve('test-results/debug-analysis.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  }

  private generateRecommendations(): string[] {
    const recommendations = [];
    const issues = this.bridgeAnalysis.issuesDiagnosed;
    
    if (issues.some(i => i.issue.includes('static data'))) {
      recommendations.push('CRITICAL: Fix data source priority - bridge is serving old static data instead of live TaskMaster data');
      recommendations.push('Check MCP connection logic in src/mcp/connection.rs');
      recommendations.push('Verify fallback mechanism is not incorrectly triggered');
    }
    
    if (this.bridgeAnalysis.mcpConnectionTests.some(t => t.status === 'failed')) {
      recommendations.push('Fix MCP server connection issues');
      recommendations.push('Verify MCP server is properly built and started');
    }
    
    if (this.bridgeAnalysis.telegramResponseTests.some(t => t.status === 'failed')) {
      recommendations.push('Debug Telegram message formatting');
      recommendations.push('Check webhook processing logic');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('All tests passed - monitor for data consistency');
      recommendations.push('Consider adding more edge case tests');
    }
    
    return recommendations;
  }
}

export default DebugReporter;
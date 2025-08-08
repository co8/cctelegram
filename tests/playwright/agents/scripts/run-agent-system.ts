#!/usr/bin/env node
/**
 * Script to run the complete CCTelegram debugging agent system
 * 
 * Usage:
 *   npm run agents:debug
 *   node scripts/run-agent-system.ts
 *   node scripts/run-agent-system.ts --session-id custom-session-123
 */

import { OrchestrationAgent } from '../orchestration/orchestration.agent';
import { AgentUtilities } from '../shared/utilities';

async function main() {
  const args = process.argv.slice(2);
  const sessionId = args.find(arg => arg.startsWith('--session-id='))?.split('=')[1] 
    || `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  console.log('🚀 Starting CCTelegram Debugging Agent System');
  console.log(`📋 Session ID: ${sessionId}`);
  console.log('=' .repeat(80));
  
  const utilities = AgentUtilities.getInstance();
  let orchestrator: OrchestrationAgent;
  
  try {
    // Initialize orchestrator
    console.log('🔧 Initializing orchestration agent...');
    orchestrator = new OrchestrationAgent(sessionId);
    await orchestrator.initialize();
    
    console.log('✅ Orchestration agent initialized');
    console.log('🎯 Starting coordinated debugging workflow...');
    
    // Execute the debugging workflow
    const result = await orchestrator.execute();
    
    console.log('=' .repeat(80));
    console.log('📊 DEBUGGING ANALYSIS RESULTS');
    console.log('=' .repeat(80));
    
    // Display results
    console.log(`\n🎯 Execution Summary:`);
    console.log(`  • Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`  • Execution Time: ${result.executionTime}ms`);
    console.log(`  • Confidence Level: ${(result.findings.confidence * 100).toFixed(1)}%`);
    console.log(`  • Priority: ${result.findings.priority}`);
    
    console.log(`\n🔍 Issues Detected: ${result.findings.issues.length}`);
    result.findings.issues.slice(0, 5).forEach((issue, index) => {
      console.log(`  ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`);
      console.log(`     Component: ${issue.component}`);
      console.log(`     Type: ${issue.type}`);
    });
    
    if (result.findings.issues.length > 5) {
      console.log(`     ... and ${result.findings.issues.length - 5} more issues`);
    }
    
    console.log(`\n💡 Recommendations: ${result.recommendations?.length || 0}`);
    result.recommendations?.slice(0, 3).forEach((rec, index) => {
      console.log(`  ${index + 1}. [${rec.priority}] ${rec.title}`);
      console.log(`     ${rec.description}`);
      console.log(`     Confidence: ${(rec.confidence * 100).toFixed(1)}%`);
    });
    
    console.log(`\n📋 Action Plan: ${result.nextActions?.length || 0} items`);
    result.nextActions?.slice(0, 5).forEach((action, index) => {
      console.log(`  ${index + 1}. [${action.priority}] ${action.description}`);
      console.log(`     Component: ${action.component} | Effort: ${action.estimatedEffort}min`);
    });
    
    // Summary analysis
    console.log('\n📈 KEY FINDINGS:');
    console.log(`  • ${result.findings.summary}`);
    
    const criticalIssues = result.findings.issues.filter(i => i.severity === 'critical');
    const highIssues = result.findings.issues.filter(i => i.severity === 'high');
    const staleDataIssues = result.findings.issues.filter(i => i.type === 'stale_data');
    
    if (criticalIssues.length > 0) {
      console.log(`  • 🚨 ${criticalIssues.length} CRITICAL issues require immediate attention`);
    }
    
    if (staleDataIssues.length > 0) {
      console.log(`  • 📊 ${staleDataIssues.length} stale data issues detected (primary concern)`);
    }
    
    if (highIssues.length > 0) {
      console.log(`  • ⚠️  ${highIssues.length} high-priority issues identified`);
    }
    
    // Next steps
    console.log('\n🎯 RECOMMENDED NEXT STEPS:');
    
    if (criticalIssues.length > 0) {
      console.log('  1. 🚨 Address critical issues immediately');
      console.log('     - Check system component health');
      console.log('     - Resolve blocking errors');
    }
    
    if (staleDataIssues.length > 0) {
      console.log('  2. 📊 Fix TaskMaster data staleness');
      console.log('     - Clear MCP server cache');
      console.log('     - Restart bridge process');
      console.log('     - Verify TaskMaster file freshness');
      console.log('     - Test /tasks command response');
    }
    
    console.log('  3. 🧪 Run validation tests');
    console.log('     - Execute comprehensive end-to-end tests');
    console.log('     - Verify fix effectiveness');
    
    console.log('  4. 📝 Document findings and solutions');
    console.log('     - Record resolution steps');
    console.log('     - Update troubleshooting documentation');
    
    // Export results
    console.log('\n💾 Exporting detailed analysis results...');
    
    const exportData = {
      sessionId,
      timestamp: new Date(),
      executionResult: result,
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };
    
    await utilities.saveArtifact(
      `debugging-session-${sessionId}.json`, 
      JSON.stringify(exportData, null, 2)
    );
    
    // Export logs
    await utilities.exportLogs(`debugging-logs-${sessionId}.log`);
    
    console.log('✅ Results exported to test-results/artifacts/');
    
    console.log('\n' + '=' .repeat(80));
    console.log('🎉 DEBUGGING ANALYSIS COMPLETE');
    console.log(`📁 Session artifacts saved with ID: ${sessionId}`);
    console.log('=' .repeat(80));
    
    // Exit code based on success
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
    
    // Save error information
    try {
      await utilities.saveArtifact(
        `debugging-error-${sessionId}.json`,
        JSON.stringify({
          sessionId,
          timestamp: new Date(),
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name
          }
        }, null, 2)
      );
      
      await utilities.exportLogs(`debugging-error-logs-${sessionId}.log`);
    } catch (exportError) {
      console.error('Failed to export error information:', exportError);
    }
    
    process.exit(1);
    
  } finally {
    // Cleanup
    if (orchestrator) {
      try {
        await orchestrator.cleanup();
        console.log('🧹 Cleanup completed');
      } catch (cleanupError) {
        console.error('⚠️  Cleanup warning:', cleanupError.message);
      }
    }
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⏹️  Received SIGINT, shutting down gracefully...');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Received SIGTERM, shutting down gracefully...');
  process.exit(143);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('\n💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
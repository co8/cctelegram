/**
 * Integration tests for the CCTelegram specialized debugging agents system
 * 
 * Tests the coordination and integration between all specialized agents
 * to ensure they work together effectively to resolve the TaskMaster issue.
 */

import { test, expect } from '@playwright/test';
import { OrchestrationAgent } from '../orchestration/orchestration.agent';
import { AgentCommunicationHub } from '../shared/communication';
import { AgentUtilities } from '../shared/utilities';
import {
  AgentStatus,
  Component,
  Severity,
  Priority,
  IssueType,
  RecommendationType
} from '../shared/types';
import { agentConfig, timeouts, expectedTestData } from '../agents.config';

test.describe('CCTelegram Debugging Agents Integration', () => {
  let sessionId: string;
  let orchestrator: OrchestrationAgent;
  let communicationHub: AgentCommunicationHub;
  let utilities: AgentUtilities;
  
  test.beforeEach(async () => {
    sessionId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    orchestrator = new OrchestrationAgent(sessionId);
    communicationHub = new AgentCommunicationHub(sessionId);
    utilities = AgentUtilities.getInstance();
    
    // Clear any previous logs
    utilities.clearLogs();
    
    console.log(`🚀 Starting agent integration test session: ${sessionId}`);
  });
  
  test.afterEach(async () => {
    if (orchestrator) {
      await orchestrator.cleanup();
    }
    
    // Export logs for debugging
    await utilities.exportLogs(`agent-integration-test-${sessionId}.log`);
    
    console.log(`✅ Completed agent integration test session: ${sessionId}`);
  });
  
  test('Agent System Initialization', async () => {
    console.log('🔧 Testing agent system initialization...');
    
    // Test orchestrator initialization
    await orchestrator.initialize();
    expect(orchestrator.status).toBe(AgentStatus.READY);
    
    // Test communication hub
    expect(communicationHub.getSharedContext().sessionId).toBe(sessionId);
    
    // Verify system resources are available
    const systemResources = await utilities.getSystemResources();
    expect(systemResources.availablePorts.length).toBeGreaterThan(0);
    
    console.log('✅ Agent system initialization successful');
  });
  
  test('Coordinated Agent Execution', async () => {
    console.log('🎯 Testing coordinated agent execution...');
    
    await orchestrator.initialize();
    
    // Execute the full orchestration workflow
    const result = await orchestrator.execute();
    
    // Verify orchestration completed
    expect(result.success).toBe(true);
    expect(result.executionTime).toBeGreaterThan(0);
    expect(result.findings).toBeDefined();
    expect(result.recommendations).toBeDefined();
    expect(result.nextActions).toBeDefined();
    
    // Verify findings quality
    expect(result.findings.agentName).toBe('orchestration');
    expect(result.findings.confidence).toBeGreaterThan(0);
    expect(result.findings.summary).toContain('TaskMaster integration');
    
    // Verify action plan exists
    expect(result.nextActions.length).toBeGreaterThan(0);
    
    console.log(`✅ Coordinated execution completed in ${result.executionTime}ms`);
  });
  
  test('Issue Detection and Correlation', async () => {
    console.log('🔍 Testing issue detection and correlation...');
    
    await orchestrator.initialize();
    const result = await orchestrator.execute();
    
    expect(result.success).toBe(true);
    
    const findings = result.findings;
    
    // Verify issues were detected
    expect(findings.issues.length).toBeGreaterThan(0);
    
    // Check for TaskMaster-related issues
    const taskMasterIssues = findings.issues.filter(issue => 
      issue.component === Component.TASKMASTER ||
      issue.type === IssueType.STALE_DATA
    );
    expect(taskMasterIssues.length).toBeGreaterThan(0);
    
    // Verify issue correlation
    const correlatedIssues = findings.issues.filter(issue => 
      issue.id.includes('correlated')
    );
    
    if (correlatedIssues.length > 0) {
      console.log(`Found ${correlatedIssues.length} correlated issues`);
      
      // Verify correlated issues have combined evidence
      correlatedIssues.forEach(issue => {
        expect(issue.evidence.length).toBeGreaterThan(1);
      });
    }
    
    console.log(`✅ Detected ${findings.issues.length} issues, ${correlatedIssues.length} correlated`);
  });
  
  test('Data Flow Analysis Integration', async () => {
    console.log('📊 Testing data flow analysis integration...');
    
    await orchestrator.initialize();
    const result = await orchestrator.execute();
    
    expect(result.success).toBe(true);
    
    // Look for data flow analysis results
    const dataFlowPoints = result.findings.dataPoints.filter(dp => 
      dp.source === 'data_flow_analyzer' || dp.name.includes('taskmaster')
    );
    
    expect(dataFlowPoints.length).toBeGreaterThan(0);
    
    // Verify TaskMaster file analysis
    const taskMasterDataPoint = dataFlowPoints.find(dp => 
      dp.name === 'taskmaster_file_data'
    );
    
    if (taskMasterDataPoint) {
      expect(taskMasterDataPoint.value).toBeDefined();
      expect(typeof taskMasterDataPoint.value.totalTasks).toBe('number');
      expect(typeof taskMasterDataPoint.value.completedTasks).toBe('number');
      expect(typeof taskMasterDataPoint.value.completionPercentage).toBe('number');
      
      console.log(`TaskMaster data: ${taskMasterDataPoint.value.completedTasks}/${taskMasterDataPoint.value.totalTasks} (${taskMasterDataPoint.value.completionPercentage}%)`);
    }
    
    console.log(`✅ Data flow analysis integrated with ${dataFlowPoints.length} data points`);
  });
  
  test('MCP Integration Testing', async () => {
    console.log('🔗 Testing MCP integration analysis...');
    
    await orchestrator.initialize();
    const result = await orchestrator.execute();
    
    expect(result.success).toBe(true);
    
    // Look for MCP integration results
    const mcpDataPoints = result.findings.dataPoints.filter(dp => 
      dp.source === 'mcp_integration_agent' || dp.name.includes('mcp')
    );
    
    // MCP integration may fail in test environment, but should be handled gracefully
    const mcpIssues = result.findings.issues.filter(issue => 
      issue.component === Component.MCP_SERVER
    );
    
    if (mcpIssues.length > 0) {
      console.log(`Found ${mcpIssues.length} MCP-related issues`);
      
      // Verify MCP issues have appropriate severity
      mcpIssues.forEach(issue => {
        expect(['critical', 'high', 'medium', 'low']).toContain(issue.severity);
        expect(issue.suggestedFixes).toBeDefined();
        expect(issue.suggestedFixes.length).toBeGreaterThan(0);
      });
    }
    
    console.log(`✅ MCP integration analysis completed with ${mcpDataPoints.length} data points`);
  });
  
  test('Recommendation Generation', async () => {
    console.log('💡 Testing recommendation generation...');
    
    await orchestrator.initialize();
    const result = await orchestrator.execute();
    
    expect(result.success).toBe(true);
    expect(result.recommendations).toBeDefined();
    expect(result.recommendations.length).toBeGreaterThan(0);
    
    // Verify recommendation quality
    result.recommendations.forEach(recommendation => {
      expect(recommendation.id).toBeDefined();
      expect(recommendation.type).toBeDefined();
      expect(recommendation.priority).toBeDefined();
      expect(recommendation.title).toBeDefined();
      expect(recommendation.description).toBeDefined();
      expect(recommendation.implementation).toBeDefined();
      expect(recommendation.confidence).toBeGreaterThan(0);
      expect(recommendation.confidence).toBeLessThanOrEqual(1);
    });
    
    // Look for TaskMaster-specific recommendations
    const taskMasterRecommendations = result.recommendations.filter(rec => 
      rec.title.toLowerCase().includes('taskmaster') ||
      rec.description.toLowerCase().includes('stale data') ||
      rec.description.toLowerCase().includes('data staleness')
    );
    
    expect(taskMasterRecommendations.length).toBeGreaterThan(0);
    
    // Verify high-priority recommendations exist for critical issues
    const urgentRecommendations = result.recommendations.filter(rec => 
      rec.priority === Priority.URGENT || rec.priority === Priority.HIGH
    );
    
    if (urgentRecommendations.length > 0) {
      console.log(`Found ${urgentRecommendations.length} urgent/high-priority recommendations`);
    }
    
    console.log(`✅ Generated ${result.recommendations.length} recommendations`);
  });
  
  test('Action Plan Creation', async () => {
    console.log('📋 Testing action plan creation...');
    
    await orchestrator.initialize();
    const result = await orchestrator.execute();
    
    expect(result.success).toBe(true);
    expect(result.nextActions).toBeDefined();
    expect(result.nextActions.length).toBeGreaterThan(0);
    
    // Verify action plan quality
    result.nextActions.forEach(action => {
      expect(action.id).toBeDefined();
      expect(action.type).toBeDefined();
      expect(action.priority).toBeDefined();
      expect(action.description).toBeDefined();
      expect(action.component).toBeDefined();
      expect(action.estimatedEffort).toBeGreaterThan(0);
      expect(action.status).toBe('pending');
    });
    
    // Verify action prioritization
    const urgentActions = result.nextActions.filter(action => 
      action.priority === Priority.URGENT
    );
    
    const highPriorityActions = result.nextActions.filter(action => 
      action.priority === Priority.HIGH
    );
    
    // Should have some high-priority actions for TaskMaster issue
    expect(urgentActions.length + highPriorityActions.length).toBeGreaterThan(0);
    
    // Calculate total estimated effort
    const totalEffort = result.nextActions.reduce((sum, action) => 
      sum + action.estimatedEffort, 0
    );
    
    expect(totalEffort).toBeGreaterThan(0);
    expect(totalEffort).toBeLessThan(300); // Should be reasonable (< 5 hours)
    
    console.log(`✅ Created action plan with ${result.nextActions.length} actions (${totalEffort} minutes total)`);
  });
  
  test('Agent Communication and Coordination', async () => {
    console.log('📡 Testing agent communication and coordination...');
    
    await orchestrator.initialize();
    
    // Monitor communication during execution
    const communicationEvents: any[] = [];
    
    communicationHub.on('agent:findings', (event) => {
      communicationEvents.push({ type: 'findings', ...event });
    });
    
    communicationHub.on('agent:issue-detected', (event) => {
      communicationEvents.push({ type: 'issue', ...event });
    });
    
    communicationHub.on('findings:correlated', (event) => {
      communicationEvents.push({ type: 'correlation', ...event });
    });
    
    const result = await orchestrator.execute();
    
    expect(result.success).toBe(true);
    
    // Verify communication occurred
    expect(communicationEvents.length).toBeGreaterThan(0);
    
    // Check communication statistics
    const stats = communicationHub.getStatistics();
    expect(stats.activeAgents).toBeGreaterThan(0);
    expect(stats.totalFindings).toBeGreaterThan(0);
    
    console.log(`✅ Agent communication: ${communicationEvents.length} events, ${stats.activeAgents} agents`);
  });
  
  test('Error Handling and Recovery', async () => {
    console.log('🛡️ Testing error handling and recovery...');
    
    await orchestrator.initialize();
    
    // Execute with potential failures (MCP server might not be available)
    const result = await orchestrator.execute();
    
    // System should handle errors gracefully
    expect(result).toBeDefined();
    
    if (!result.success) {
      // If execution failed, verify we have error information
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
      
      console.log(`Handled ${result.errors.length} errors gracefully`);
    } else {
      // If execution succeeded, verify we still detected potential issues
      expect(result.findings.issues.length).toBeGreaterThan(0);
    }
    
    // Verify cleanup occurred
    expect(orchestrator.status).toBe(AgentStatus.COMPLETED);
    
    console.log('✅ Error handling and recovery validated');
  });
  
  test('Comprehensive Validation', async () => {
    console.log('🎯 Testing comprehensive system validation...');
    
    await orchestrator.initialize();
    const result = await orchestrator.execute();
    
    // System-level validation
    expect(result).toBeDefined();
    expect(result.agentName).toBe('orchestration');
    expect(result.executionTime).toBeGreaterThan(0);
    expect(result.findings).toBeDefined();
    
    // Quality validation
    expect(result.findings.confidence).toBeGreaterThan(0);
    expect(result.findings.confidence).toBeLessThanOrEqual(1);
    expect(result.findings.summary).toContain('TaskMaster');
    
    // Issue resolution validation
    const hasTaskMasterIssues = result.findings.issues.some(issue => 
      issue.component === Component.TASKMASTER ||
      issue.type === IssueType.STALE_DATA ||
      issue.description.toLowerCase().includes('stale')
    );
    
    const hasRelevantRecommendations = result.recommendations?.some(rec => 
      rec.description.toLowerCase().includes('taskmaster') ||
      rec.description.toLowerCase().includes('stale data')
    ) || false;
    
    const hasActionPlan = result.nextActions && result.nextActions.length > 0;
    
    // The system should detect TaskMaster-related issues OR provide relevant analysis
    const systemEffectiveness = hasTaskMasterIssues || hasRelevantRecommendations || hasActionPlan;
    expect(systemEffectiveness).toBe(true);
    
    // Log comprehensive results
    console.log('📊 Comprehensive Validation Results:');
    console.log(`  • Execution Time: ${result.executionTime}ms`);
    console.log(`  • Confidence: ${(result.findings.confidence * 100).toFixed(1)}%`);
    console.log(`  • Issues Detected: ${result.findings.issues.length}`);
    console.log(`  • Recommendations: ${result.recommendations?.length || 0}`);
    console.log(`  • Action Items: ${result.nextActions?.length || 0}`);
    console.log(`  • TaskMaster Issues: ${hasTaskMasterIssues ? 'Yes' : 'No'}`);
    console.log(`  • Relevant Recommendations: ${hasRelevantRecommendations ? 'Yes' : 'No'}`);
    
    console.log('✅ Comprehensive validation completed successfully');
  });
  
  test('Performance and Resource Usage', async () => {
    console.log('⚡ Testing performance and resource usage...');
    
    const startResources = await utilities.getSystemResources();
    const startTime = Date.now();
    
    await orchestrator.initialize();
    const result = await orchestrator.execute();
    
    const endTime = Date.now();
    const endResources = await utilities.getSystemResources();
    
    // Performance validation
    const totalExecutionTime = endTime - startTime;
    expect(totalExecutionTime).toBeLessThan(timeouts.agentExecution * 3); // Should complete within reasonable time
    
    // Resource usage validation
    const memoryIncrease = endResources.memoryUsage - startResources.memoryUsage;
    expect(memoryIncrease).toBeLessThan(50); // Should not consume excessive memory
    
    // Log performance metrics
    console.log('📈 Performance Metrics:');
    console.log(`  • Total Execution Time: ${totalExecutionTime}ms`);
    console.log(`  • Agent Execution Time: ${result.executionTime}ms`);
    console.log(`  • Memory Usage Increase: ${memoryIncrease}%`);
    console.log(`  • System CPU Usage: ${endResources.cpuUsage}%`);
    
    console.log('✅ Performance validation completed');
  });
});

/**
 * Utility test helpers for agent integration testing
 */
export class AgentTestHelpers {
  static async waitForAgentCompletion(agent: any, timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (agent.status === AgentStatus.COMPLETED || agent.status === AgentStatus.FAILED) {
        return agent.status === AgentStatus.COMPLETED;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return false;
  }
  
  static validateAgentFindings(findings: any): boolean {
    return (
      findings &&
      typeof findings.agentName === 'string' &&
      typeof findings.confidence === 'number' &&
      findings.confidence >= 0 && findings.confidence <= 1 &&
      Array.isArray(findings.issues) &&
      Array.isArray(findings.validations) &&
      Array.isArray(findings.dataPoints)
    );
  }
  
  static validateIssue(issue: any): boolean {
    return (
      issue &&
      typeof issue.id === 'string' &&
      typeof issue.type === 'string' &&
      typeof issue.severity === 'string' &&
      typeof issue.component === 'string' &&
      typeof issue.description === 'string' &&
      Array.isArray(issue.evidence) &&
      Array.isArray(issue.suggestedFixes)
    );
  }
  
  static validateRecommendation(recommendation: any): boolean {
    return (
      recommendation &&
      typeof recommendation.id === 'string' &&
      typeof recommendation.type === 'string' &&
      typeof recommendation.priority === 'string' &&
      typeof recommendation.title === 'string' &&
      typeof recommendation.description === 'string' &&
      typeof recommendation.confidence === 'number' &&
      recommendation.confidence >= 0 && recommendation.confidence <= 1
    );
  }
}
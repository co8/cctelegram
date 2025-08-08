/**
 * MCP Integration Specialist Agent
 * 
 * Specialized agent that focuses on MCP server communication and data transformation.
 * Tests MCP functions directly, validates response formats, and identifies MCP-specific
 * integration issues in the TaskMaster data flow.
 */

import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import {
  BaseAgent,
  AgentStatus,
  AgentCapability,
  AgentResult,
  AgentFindings,
  McpResponse,
  McpTestResult,
  Issue,
  IssueType,
  Component,
  Severity,
  Priority,
  Evidence,
  EvidenceType,
  DataPoint,
  ValidationResult,
  ValidationType
} from '../shared/types';
import { AgentUtilities } from '../shared/utilities';
import { agentConfig, testPorts, testPaths, environmentConfig, expectedTestData, timeouts } from '../agents.config';

export class McpIntegrationAgent implements BaseAgent {
  public readonly name = 'mcp-integration-specialist';
  public readonly version = '1.0.0';
  public readonly capabilities: AgentCapability[] = [
    AgentCapability.MCP_TESTING,
    AgentCapability.PROCESS_MANAGEMENT
  ];
  
  public status: AgentStatus = AgentStatus.INITIALIZING;
  public findings: AgentFindings;
  
  private utilities: AgentUtilities;
  private sessionId: string;
  private mcpProcess?: ChildProcess;
  private mcpServerUrl: string;
  private mcpTestResults: McpTestResult[] = [];
  
  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.utilities = AgentUtilities.getInstance();
    this.findings = this.initializeFindings();
    this.mcpServerUrl = `http://localhost:${testPorts.mcpServer}`;
  }
  
  public async initialize(): Promise<void> {
    this.status = AgentStatus.INITIALIZING;
    this.utilities.log('info', Component.MCP_SERVER, `Initializing ${this.name} agent`);
    
    try {
      // Verify MCP server path exists
      await this.verifyMcpServerPath();
      
      // Start MCP server for testing
      await this.startMcpServer();
      
      // Wait for MCP server to be ready
      await this.waitForMcpServer();
      
      this.status = AgentStatus.READY;
      this.utilities.log('info', Component.MCP_SERVER, `${this.name} agent ready`);
    } catch (error) {
      this.status = AgentStatus.FAILED;
      this.utilities.log('error', Component.MCP_SERVER, `Failed to initialize ${this.name} agent: ${error}`);
      throw error;
    }
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    this.status = AgentStatus.RUNNING;
    this.utilities.log('info', Component.MCP_SERVER, `Starting MCP integration analysis`);
    
    try {
      // Test 1: Direct MCP connection
      await this.testDirectMcpConnection();
      
      // Test 2: TaskMaster integration via MCP
      await this.testTaskMasterMcpIntegration();
      
      // Test 3: MCP response format validation
      await this.validateMcpResponseFormats();
      
      // Test 4: Data transformation analysis
      await this.analyzeDataTransformations();
      
      // Test 5: MCP error handling
      await this.testMcpErrorHandling();
      
      this.status = AgentStatus.COMPLETED;
      const executionTime = Date.now() - startTime;
      
      this.utilities.log('info', Component.MCP_SERVER, 
        `MCP integration analysis completed in ${executionTime}ms`);
      
      return {
        agentName: this.name,
        success: true,
        executionTime,
        findings: this.findings,
        recommendations: this.generateRecommendations()
      };
      
    } catch (error) {
      this.status = AgentStatus.FAILED;
      const executionTime = Date.now() - startTime;
      
      this.utilities.log('error', Component.MCP_SERVER, 
        `MCP integration analysis failed: ${error}`);
      
      return {
        agentName: this.name,
        success: false,
        executionTime,
        findings: this.findings,
        errors: [error as Error]
      };
    }
  }
  
  public async cleanup(): Promise<void> {
    this.status = AgentStatus.CLEANUP;
    this.utilities.log('info', Component.MCP_SERVER, `Cleaning up ${this.name} agent`);
    
    try {
      // Stop MCP server
      await this.stopMcpServer();
      
      // Export test results
      await this.exportTestResults();
      
      this.status = AgentStatus.COMPLETED;
      this.utilities.log('info', Component.MCP_SERVER, `${this.name} agent cleanup completed`);
    } catch (error) {
      this.utilities.log('error', Component.MCP_SERVER, `Cleanup failed: ${error}`);
    }
  }
  
  public reportFindings(): AgentFindings {
    return { ...this.findings };
  }
  
  private async testDirectMcpConnection(): Promise<void> {
    this.utilities.log('info', Component.MCP_SERVER, 'Testing direct MCP connection');
    
    const testResult: McpTestResult = {
      method: 'connection_test',
      success: false,
      response: null,
      executionTime: 0,
      dataAccuracy: false,
      formatCompliance: false
    };
    
    const startTime = Date.now();
    
    try {
      // Test basic MCP server connectivity
      const response = await axios.get(`${this.mcpServerUrl}/health`, {
        timeout: timeouts.mcpConnection
      });
      
      testResult.success = response.status === 200;
      testResult.response = response.data;
      testResult.executionTime = Date.now() - startTime;
      testResult.formatCompliance = this.validateHealthResponseFormat(response.data);
      testResult.dataAccuracy = testResult.formatCompliance;
      
      this.mcpTestResults.push(testResult);
      
      // Create validation result
      this.findings.validations.push({
        type: ValidationType.NETWORK_CONNECTIVITY,
        target: 'mcp_server_connection',
        expected: { status: 200 },
        actual: { status: response.status },
        passed: testResult.success,
        message: testResult.success ? 'MCP server connection successful' : 'MCP server connection failed',
        severity: testResult.success ? Severity.INFO : Severity.CRITICAL
      });
      
      if (testResult.success) {
        this.utilities.log('info', Component.MCP_SERVER, 'Direct MCP connection successful');
      } else {
        throw new Error(`MCP server connection failed: ${response.status}`);
      }
      
    } catch (error) {
      testResult.success = false;
      testResult.executionTime = Date.now() - startTime;
      testResult.error = error.message;
      
      this.mcpTestResults.push(testResult);
      
      this.reportIssue({
        id: `mcp-connection-failure-${Date.now()}`,
        type: IssueType.MCP_CONNECTION_FAILURE,
        severity: Severity.CRITICAL,
        component: Component.MCP_SERVER,
        description: `Failed to connect to MCP server: ${error.message}`,
        evidence: [
          this.utilities.createEvidence(
            EvidenceType.API_RESPONSE,
            'MCP connection failure',
            { error: error.message, url: this.mcpServerUrl },
            'mcp_integration_agent'
          )
        ],
        suggestedFixes: [
          {
            id: 'check-mcp-server-status',
            title: 'Check MCP Server Status',
            description: 'Verify MCP server is running and accessible',
            implementation: 'Check MCP server process and port availability',
            riskLevel: 'low',
            estimatedTime: 5,
            testingRequired: true,
            rollbackPlan: 'Restart MCP server if needed'
          }
        ],
        detectedBy: this.name,
        timestamp: new Date(),
        reproduced: false,
        resolved: false
      });
      
      throw error;
    }
  }
  
  private async testTaskMasterMcpIntegration(): Promise<void> {
    this.utilities.log('info', Component.MCP_SERVER, 'Testing TaskMaster MCP integration');
    
    const testResult: McpTestResult = {
      method: 'get_task_status',
      success: false,
      response: null,
      executionTime: 0,
      dataAccuracy: false,
      formatCompliance: false
    };
    
    const startTime = Date.now();
    
    try {
      // Test the get_task_status MCP function
      const response = await axios.post(`${this.mcpServerUrl}/mcp/tools/call`, {
        name: 'get_task_status',
        arguments: {
          project_root: testPaths.taskMasterDir.replace('./../../', ''),
          summary_only: false,
          task_system: 'taskmaster'
        }
      }, {
        timeout: timeouts.mcpConnection,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      testResult.success = response.status === 200;
      testResult.response = response.data;
      testResult.executionTime = Date.now() - startTime;
      testResult.formatCompliance = this.validateTaskStatusResponseFormat(response.data);
      testResult.dataAccuracy = this.validateTaskStatusDataAccuracy(response.data);
      
      this.mcpTestResults.push(testResult);
      
      // Create MCP response data point
      this.findings.dataPoints.push(
        this.utilities.createDataPoint('mcp_task_status_response', response.data, 'mcp_server', true),
        this.utilities.createDataPoint('mcp_response_time', testResult.executionTime, 'mcp_server', true)
      );
      
      // Create validation result
      this.findings.validations.push({
        type: ValidationType.FORMAT_COMPLIANCE,
        target: 'mcp_task_status_response',
        expected: expectedTestData.mcpTaskStatusResponse,
        actual: response.data,
        passed: testResult.formatCompliance,
        message: testResult.formatCompliance ? 'MCP response format is valid' : 'MCP response format is invalid',
        severity: testResult.formatCompliance ? Severity.INFO : Severity.HIGH
      });
      
      this.findings.validations.push({
        type: ValidationType.RESPONSE_ACCURACY,
        target: 'mcp_task_status_data',
        expected: expectedTestData.liveTaskMasterStats,
        actual: this.extractTaskStatsFromMcpResponse(response.data),
        passed: testResult.dataAccuracy,
        message: testResult.dataAccuracy ? 'MCP data is accurate and live' : 'MCP data may be stale or inaccurate',
        severity: testResult.dataAccuracy ? Severity.INFO : Severity.HIGH
      });
      
      // Check for stale data in MCP response
      if (!testResult.dataAccuracy) {
        this.reportIssue({
          id: `mcp-stale-data-${Date.now()}`,
          type: IssueType.STALE_DATA,
          severity: Severity.HIGH,
          component: Component.MCP_SERVER,
          description: 'MCP server returning stale TaskMaster data',
          evidence: [
            this.utilities.createEvidence(
              EvidenceType.API_RESPONSE,
              'MCP task status response with potentially stale data',
              response.data,
              'mcp_integration_agent'
            )
          ],
          suggestedFixes: [
            {
              id: 'refresh-mcp-cache',
              title: 'Refresh MCP Cache',
              description: 'Clear MCP server cache and reload TaskMaster data',
              implementation: 'Restart MCP server or call cache invalidation endpoint',
              riskLevel: 'low',
              estimatedTime: 10,
              testingRequired: true,
              rollbackPlan: 'No rollback needed - cache refresh only'
            }
          ],
          detectedBy: this.name,
          timestamp: new Date(),
          reproduced: false,
          resolved: false
        });
      }
      
      this.utilities.log('info', Component.MCP_SERVER, 
        `TaskMaster MCP integration test: ${testResult.success ? 'PASS' : 'FAIL'} (${testResult.executionTime}ms)`);
      
    } catch (error) {
      testResult.success = false;
      testResult.executionTime = Date.now() - startTime;
      testResult.error = error.message;
      
      this.mcpTestResults.push(testResult);
      
      this.reportIssue({
        id: `mcp-taskmaster-integration-failure-${Date.now()}`,
        type: IssueType.MCP_CONNECTION_FAILURE,
        severity: Severity.CRITICAL,
        component: Component.MCP_SERVER,
        description: `Failed to call MCP get_task_status: ${error.message}`,
        evidence: [
          this.utilities.createEvidence(
            EvidenceType.API_RESPONSE,
            'MCP TaskMaster integration failure',
            { error: error.message, method: 'get_task_status' },
            'mcp_integration_agent'
          )
        ],
        suggestedFixes: [],
        detectedBy: this.name,
        timestamp: new Date(),
        reproduced: false,
        resolved: false
      });
      
      throw error;
    }
  }
  
  private async validateMcpResponseFormats(): Promise<void> {
    this.utilities.log('info', Component.MCP_SERVER, 'Validating MCP response formats');
    
    // Test multiple MCP endpoints to validate format consistency
    const endpoints = [
      { name: 'get_tasks', args: { project_root: testPaths.taskMasterDir.replace('./../../', '') } },
      { name: 'next_task', args: { project_root: testPaths.taskMasterDir.replace('./../../', '') } }
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await axios.post(`${this.mcpServerUrl}/mcp/tools/call`, {
          name: endpoint.name,
          arguments: endpoint.args
        }, {
          timeout: timeouts.mcpConnection,
          headers: { 'Content-Type': 'application/json' }
        });
        
        const testResult: McpTestResult = {
          method: endpoint.name,
          success: response.status === 200,
          response: response.data,
          executionTime: 0,
          dataAccuracy: true, // Assume accurate for format validation
          formatCompliance: this.validateGenericMcpResponseFormat(response.data)
        };
        
        this.mcpTestResults.push(testResult);
        
        this.findings.validations.push({
          type: ValidationType.FORMAT_COMPLIANCE,
          target: `mcp_${endpoint.name}_response`,
          expected: 'valid_mcp_format',
          actual: response.data,
          passed: testResult.formatCompliance,
          message: `MCP ${endpoint.name} format: ${testResult.formatCompliance ? 'valid' : 'invalid'}`,
          severity: testResult.formatCompliance ? Severity.INFO : Severity.MEDIUM
        });
        
      } catch (error) {
        this.utilities.log('warn', Component.MCP_SERVER, 
          `MCP format validation failed for ${endpoint.name}: ${error.message}`);
      }
    }
  }
  
  private async analyzeDataTransformations(): Promise<void> {
    this.utilities.log('info', Component.MCP_SERVER, 'Analyzing MCP data transformations');
    
    // Compare original TaskMaster file data with MCP response data
    try {
      const taskMasterStats = await this.utilities.parseTaskMasterFile(testPaths.taskMasterFile);
      const mcpTaskResult = this.mcpTestResults.find(r => r.method === 'get_task_status');
      
      if (mcpTaskResult && mcpTaskResult.response) {
        const mcpStats = this.extractTaskStatsFromMcpResponse(mcpTaskResult.response);
        
        const transformationAnalysis = {
          sourceData: taskMasterStats,
          transformedData: mcpStats,
          dataIntegrityMaintained: this.compareTaskStats(taskMasterStats, mcpStats),
          transformationAccuracy: this.calculateTransformationAccuracy(taskMasterStats, mcpStats)
        };
        
        this.findings.dataPoints.push(
          this.utilities.createDataPoint('data_transformation_analysis', transformationAnalysis, 'mcp_integration_agent', true)
        );
        
        this.findings.validations.push({
          type: ValidationType.DATA_INTEGRITY,
          target: 'mcp_data_transformation',
          expected: taskMasterStats,
          actual: mcpStats,
          passed: transformationAnalysis.dataIntegrityMaintained,
          message: `Data transformation accuracy: ${(transformationAnalysis.transformationAccuracy * 100).toFixed(1)}%`,
          severity: transformationAnalysis.dataIntegrityMaintained ? Severity.INFO : Severity.HIGH
        });
        
        if (!transformationAnalysis.dataIntegrityMaintained) {
          this.reportIssue({
            id: `mcp-transformation-error-${Date.now()}`,
            type: IssueType.DATA_TRANSFORMATION_ERROR,
            severity: Severity.HIGH,
            component: Component.MCP_SERVER,
            description: 'Data integrity lost during MCP transformation',
            evidence: [
              this.utilities.createEvidence(
                EvidenceType.PERFORMANCE_METRIC,
                'Data transformation analysis',
                transformationAnalysis,
                'mcp_integration_agent'
              )
            ],
            suggestedFixes: [
              {
                id: 'fix-mcp-transformation',
                title: 'Fix MCP Data Transformation',
                description: 'Correct the data transformation logic in MCP server',
                implementation: 'Review and fix TaskMaster data parsing in MCP server code',
                riskLevel: 'medium',
                estimatedTime: 30,
                testingRequired: true,
                rollbackPlan: 'Revert MCP server code changes'
              }
            ],
            detectedBy: this.name,
            timestamp: new Date(),
            reproduced: false,
            resolved: false
          });
        }
        
        this.utilities.log('info', Component.MCP_SERVER, 
          `Data transformation analysis: ${(transformationAnalysis.transformationAccuracy * 100).toFixed(1)}% accuracy`);
      }
      
    } catch (error) {
      this.utilities.log('error', Component.MCP_SERVER, 
        `Data transformation analysis failed: ${error.message}`);
    }
  }
  
  private async testMcpErrorHandling(): Promise<void> {
    this.utilities.log('info', Component.MCP_SERVER, 'Testing MCP error handling');
    
    // Test error conditions
    const errorTests = [
      {
        name: 'invalid_project_root',
        args: { project_root: '/nonexistent/path' },
        expectedError: true
      },
      {
        name: 'missing_arguments',
        args: {},
        expectedError: true
      }
    ];
    
    for (const errorTest of errorTests) {
      try {
        const response = await axios.post(`${this.mcpServerUrl}/mcp/tools/call`, {
          name: 'get_task_status',
          arguments: errorTest.args
        }, {
          timeout: timeouts.mcpConnection,
          headers: { 'Content-Type': 'application/json' }
        });
        
        // Should have failed but didn't
        if (errorTest.expectedError) {
          this.utilities.log('warn', Component.MCP_SERVER, 
            `Expected error for ${errorTest.name} but got success: ${response.status}`);
        }
        
      } catch (error) {
        // Expected error occurred
        if (errorTest.expectedError) {
          this.utilities.log('info', Component.MCP_SERVER, 
            `Error handling test ${errorTest.name}: Expected error occurred`);
        } else {
          this.utilities.log('error', Component.MCP_SERVER, 
            `Unexpected error for ${errorTest.name}: ${error.message}`);
        }
      }
    }
  }
  
  private async verifyMcpServerPath(): Promise<void> {
    const { promises: fs } = require('fs');
    
    try {
      await fs.access(testPaths.mcpServer);
    } catch (error) {
      throw new Error(`MCP server path not found: ${testPaths.mcpServer}`);
    }
  }
  
  private async startMcpServer(): Promise<void> {
    this.utilities.log('info', Component.MCP_SERVER, 'Starting MCP server');
    
    const { process: mcpProcess } = await this.utilities.startProcess('npm', ['start'], {
      cwd: testPaths.mcpServer,
      env: {
        ...process.env,
        ...environmentConfig.mcp
      }
    });
    
    this.mcpProcess = mcpProcess;
    
    // Give the server time to start
    await this.utilities.sleep(5000);
  }
  
  private async stopMcpServer(): Promise<void> {
    if (this.mcpProcess) {
      this.utilities.log('info', Component.MCP_SERVER, 'Stopping MCP server');
      
      this.mcpProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        if (this.mcpProcess) {
          this.mcpProcess.on('exit', resolve);
          
          // Force kill after timeout
          setTimeout(() => {
            if (this.mcpProcess && !this.mcpProcess.killed) {
              this.mcpProcess.kill('SIGKILL');
            }
            resolve(undefined);
          }, 5000);
        } else {
          resolve(undefined);
        }
      });
      
      this.mcpProcess = undefined;
    }
  }
  
  private async waitForMcpServer(): Promise<void> {
    const maxAttempts = 30;
    const delay = 1000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.get(`${this.mcpServerUrl}/health`, {
          timeout: 5000
        });
        
        if (response.status === 200) {
          this.utilities.log('info', Component.MCP_SERVER, 'MCP server is ready');
          return;
        }
      } catch (error) {
        // Server not ready yet
      }
      
      if (attempt < maxAttempts) {
        await this.utilities.sleep(delay);
      }
    }
    
    throw new Error('MCP server failed to become ready within timeout');
  }
  
  private validateHealthResponseFormat(data: any): boolean {
    return (
      typeof data === 'object' &&
      typeof data.status === 'string' &&
      data.status === 'healthy'
    );
  }
  
  private validateTaskStatusResponseFormat(data: any): boolean {
    return (
      typeof data === 'object' &&
      typeof data.tasks === 'object' &&
      typeof data.tasks.total === 'number' &&
      typeof data.tasks.completed === 'number'
    );
  }
  
  private validateTaskStatusDataAccuracy(data: any): boolean {
    const stats = this.extractTaskStatsFromMcpResponse(data);
    const expected = expectedTestData.liveTaskMasterStats;
    
    return (
      Math.abs(stats.completionPercentage - expected.completionPercentage) < 10 &&
      stats.totalTasks >= expected.totalTasks - 2 // Allow some variance
    );
  }
  
  private validateGenericMcpResponseFormat(data: any): boolean {
    return typeof data === 'object' && data !== null;
  }
  
  private extractTaskStatsFromMcpResponse(data: any): any {
    if (data && data.tasks) {
      const { tasks } = data;
      return {
        totalTasks: tasks.total || 0,
        completedTasks: tasks.completed || 0,
        pendingTasks: tasks.pending || 0,
        inProgressTasks: tasks.in_progress || 0,
        blockedTasks: tasks.blocked || 0,
        completionPercentage: tasks.total > 0 ? (tasks.completed / tasks.total) * 100 : 0
      };
    }
    
    return {
      totalTasks: 0,
      completedTasks: 0,
      pendingTasks: 0,
      inProgressTasks: 0,
      blockedTasks: 0,
      completionPercentage: 0
    };
  }
  
  private compareTaskStats(source: any, transformed: any): boolean {
    return (
      source.totalTasks === transformed.totalTasks &&
      source.completedTasks === transformed.completedTasks &&
      Math.abs(source.completionPercentage - transformed.completionPercentage) < 1
    );
  }
  
  private calculateTransformationAccuracy(source: any, transformed: any): number {
    const fields = ['totalTasks', 'completedTasks', 'pendingTasks', 'inProgressTasks'];
    let matches = 0;
    
    fields.forEach(field => {
      if (source[field] === transformed[field]) {
        matches++;
      }
    });
    
    return matches / fields.length;
  }
  
  private generateRecommendations(): any[] {
    const recommendations: any[] = [];
    
    // Check for critical MCP issues
    const criticalIssues = this.findings.issues.filter(i => i.severity === Severity.CRITICAL);
    if (criticalIssues.length > 0) {
      recommendations.push({
        id: 'resolve-critical-mcp-issues',
        type: 'IMMEDIATE_FIX',
        priority: Priority.URGENT,
        title: 'Resolve Critical MCP Issues',
        description: `${criticalIssues.length} critical MCP issues detected`,
        reasoning: 'Critical issues prevent MCP integration from functioning',
        implementation: 'Address each critical issue identified in findings',
        riskAssessment: 'High impact if not resolved',
        expectedOutcome: 'Functional MCP integration',
        confidence: 0.9,
        suggestedBy: this.name,
        relatedIssues: criticalIssues.map(i => i.id)
      });
    }
    
    // Check for stale data issues
    const staleDataIssues = this.findings.issues.filter(i => i.type === IssueType.STALE_DATA);
    if (staleDataIssues.length > 0) {
      recommendations.push({
        id: 'refresh-mcp-data-cache',
        type: 'IMMEDIATE_FIX',
        priority: Priority.HIGH,
        title: 'Refresh MCP Data Cache',
        description: 'MCP server appears to be serving stale TaskMaster data',
        reasoning: 'Stale data detected in MCP responses',
        implementation: 'Clear MCP cache and ensure fresh data loading',
        riskAssessment: 'Low risk - cache refresh operation',
        expectedOutcome: 'MCP serves fresh, accurate TaskMaster data',
        confidence: 0.8,
        suggestedBy: this.name,
        relatedIssues: staleDataIssues.map(i => i.id)
      });
    }
    
    return recommendations;
  }
  
  private async exportTestResults(): Promise<void> {
    const testResultsData = {
      sessionId: this.sessionId,
      agent: this.name,
      version: this.version,
      testResults: this.mcpTestResults,
      findings: this.findings,
      timestamp: new Date()
    };
    
    const filename = `mcp-test-results-${this.sessionId}.json`;
    await this.utilities.saveArtifact(filename, JSON.stringify(testResultsData, null, 2));
    
    this.utilities.log('info', Component.MCP_SERVER, `MCP test results exported to ${filename}`);
  }
  
  private reportIssue(issue: Issue): void {
    this.findings.issues.push(issue);
    this.utilities.log('warn', Component.MCP_SERVER, `Issue detected: ${issue.description}`);
  }
  
  private initializeFindings(): AgentFindings {
    return {
      agentName: this.name,
      timestamp: new Date(),
      summary: 'MCP integration analysis in progress',
      issues: [],
      validations: [],
      dataPoints: [],
      confidence: 0,
      priority: Priority.MEDIUM
    };
  }
}
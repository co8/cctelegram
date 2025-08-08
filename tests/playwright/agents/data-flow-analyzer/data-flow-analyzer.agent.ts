/**
 * Data Flow Analyzer Agent
 * 
 * Specialized agent that traces data flow from TaskMaster file through MCP server
 * to Rust bridge and finally to Telegram response. Identifies where old static
 * data gets injected and tracks all transformations.
 */

import { join } from 'path';
import { promises as fs } from 'fs';
import {
  BaseAgent,
  AgentStatus,
  AgentCapability,
  AgentResult,
  AgentFindings,
  DataFlowStep,
  DataFlowTrace,
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
import { agentConfig, testPaths, expectedTestData } from '../agents.config';

export class DataFlowAnalyzerAgent implements BaseAgent {
  public readonly name = 'data-flow-analyzer';
  public readonly version = '1.0.0';
  public readonly capabilities: AgentCapability[] = [
    AgentCapability.DATA_TRACING,
    AgentCapability.LOG_ANALYSIS
  ];
  
  public status: AgentStatus = AgentStatus.INITIALIZING;
  public findings: AgentFindings;
  
  private utilities: AgentUtilities;
  private dataFlowTrace: DataFlowTrace;
  private sessionId: string;
  
  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.utilities = AgentUtilities.getInstance();
    this.findings = this.initializeFindings();
    this.dataFlowTrace = this.initializeDataFlowTrace();
  }
  
  public async initialize(): Promise<void> {
    this.status = AgentStatus.INITIALIZING;
    this.utilities.log('info', Component.TEST_FRAMEWORK, `Initializing ${this.name} agent`);
    
    try {
      // Verify required files and paths exist
      await this.verifyPreconditions();
      
      // Initialize data flow tracing
      this.dataFlowTrace = this.initializeDataFlowTrace();
      
      this.status = AgentStatus.READY;
      this.utilities.log('info', Component.TEST_FRAMEWORK, `${this.name} agent ready`);
    } catch (error) {
      this.status = AgentStatus.FAILED;
      this.utilities.log('error', Component.TEST_FRAMEWORK, `Failed to initialize ${this.name} agent: ${error}`);
      throw error;
    }
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    this.status = AgentStatus.RUNNING;
    this.utilities.log('info', Component.TEST_FRAMEWORK, `Starting data flow analysis`);
    
    try {
      // Step 1: Analyze TaskMaster file data
      await this.analyzeTaskMasterFile();
      
      // Step 2: Trace data through MCP layer
      await this.traceMcpDataFlow();
      
      // Step 3: Analyze bridge processing
      await this.analyzeBridgeProcessing();
      
      // Step 4: Validate end-to-end data integrity
      await this.validateDataIntegrity();
      
      // Step 5: Identify transformation points and potential issues
      await this.identifyTransformationIssues();
      
      this.status = AgentStatus.COMPLETED;
      const executionTime = Date.now() - startTime;
      
      this.utilities.log('info', Component.TEST_FRAMEWORK, 
        `Data flow analysis completed in ${executionTime}ms`);
      
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
      
      this.utilities.log('error', Component.TEST_FRAMEWORK, 
        `Data flow analysis failed: ${error}`);
      
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
    this.utilities.log('info', Component.TEST_FRAMEWORK, `Cleaning up ${this.name} agent`);
    
    try {
      // Export trace data for later analysis
      await this.exportTraceData();
      
      // Clean up any resources
      this.status = AgentStatus.COMPLETED;
      this.utilities.log('info', Component.TEST_FRAMEWORK, `${this.name} agent cleanup completed`);
    } catch (error) {
      this.utilities.log('error', Component.TEST_FRAMEWORK, `Cleanup failed: ${error}`);
    }
  }
  
  public reportFindings(): AgentFindings {
    return { ...this.findings };
  }
  
  private async analyzeTaskMasterFile(): Promise<void> {
    this.utilities.log('info', Component.TASKMASTER, 'Analyzing TaskMaster file data');
    
    const step: DataFlowStep = {
      stepNumber: this.dataFlowTrace.steps.length + 1,
      component: Component.TASKMASTER,
      operation: 'read_tasks_file',
      input: { filePath: testPaths.taskMasterFile },
      output: null,
      timestamp: new Date(),
      duration: 0,
      success: false,
      dataIntegrity: false
    };
    
    const stepStartTime = Date.now();
    
    try {
      // Check if TaskMaster file exists
      const fileExists = await this.fileExists(testPaths.taskMasterFile);
      
      if (!fileExists) {
        throw new Error(`TaskMaster file not found: ${testPaths.taskMasterFile}`);
      }
      
      // Parse TaskMaster file
      const taskMasterStats = await this.utilities.parseTaskMasterFile(testPaths.taskMasterFile);
      
      step.output = taskMasterStats;
      step.success = true;
      step.duration = Date.now() - stepStartTime;
      
      // Validate data integrity
      step.dataIntegrity = this.validateTaskMasterData(taskMasterStats);
      
      // Add to trace
      this.dataFlowTrace.steps.push(step);
      
      // Create data points
      this.findings.dataPoints.push(
        this.utilities.createDataPoint('taskmaster_file_data', taskMasterStats, 'file_system', true),
        this.utilities.createDataPoint('data_freshness', {
          lastModified: taskMasterStats.lastModified,
          isRecent: this.isRecentData(taskMasterStats.lastModified)
        }, 'file_system', true)
      );
      
      // Create validation results
      this.findings.validations.push({
        type: ValidationType.DATA_INTEGRITY,
        target: 'taskmaster_file',
        expected: expectedTestData.liveTaskMasterStats,
        actual: taskMasterStats,
        passed: this.isLiveTaskData(taskMasterStats),
        message: this.isLiveTaskData(taskMasterStats) 
          ? 'TaskMaster file contains live data'
          : 'TaskMaster file contains potentially stale data',
        severity: this.isLiveTaskData(taskMasterStats) ? Severity.INFO : Severity.HIGH
      });
      
      // Report issues if stale data detected
      if (!this.isLiveTaskData(taskMasterStats)) {
        this.reportIssue({
          id: `stale-taskmaster-data-${Date.now()}`,
          type: IssueType.STALE_DATA,
          severity: Severity.HIGH,
          component: Component.TASKMASTER,
          description: 'TaskMaster file contains stale data pattern',
          evidence: [
            this.utilities.createEvidence(
              EvidenceType.FILE_CONTENT,
              'TaskMaster statistics showing stale data pattern',
              taskMasterStats,
              'taskmaster_file'
            )
          ],
          suggestedFixes: [
            {
              id: 'refresh-taskmaster-data',
              title: 'Refresh TaskMaster Data',
              description: 'Generate new TaskMaster data or verify file is current',
              implementation: 'Run task-master generate or update tasks.json with current data',
              riskLevel: 'low',
              estimatedTime: 5,
              testingRequired: true,
              rollbackPlan: 'Restore original tasks.json file'
            }
          ],
          detectedBy: this.name,
          timestamp: new Date(),
          reproduced: false,
          resolved: false
        });
      }
      
      this.utilities.log('info', Component.TASKMASTER, 
        `TaskMaster analysis complete: ${taskMasterStats.completedTasks}/${taskMasterStats.totalTasks} tasks (${taskMasterStats.completionPercentage}%)`);
      
    } catch (error) {
      step.success = false;
      step.duration = Date.now() - stepStartTime;
      step.output = { error: error.message };
      
      this.dataFlowTrace.steps.push(step);
      
      this.reportIssue({
        id: `taskmaster-read-error-${Date.now()}`,
        type: IssueType.CONFIGURATION_ERROR,
        severity: Severity.CRITICAL,
        component: Component.TASKMASTER,
        description: `Failed to read TaskMaster file: ${error.message}`,
        evidence: [
          this.utilities.createEvidence(
            EvidenceType.LOG_ENTRY,
            'TaskMaster file read error',
            { error: error.message, filePath: testPaths.taskMasterFile },
            'data_flow_analyzer'
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
  
  private async traceMcpDataFlow(): Promise<void> {
    this.utilities.log('info', Component.MCP_SERVER, 'Tracing MCP data flow');
    
    const step: DataFlowStep = {
      stepNumber: this.dataFlowTrace.steps.length + 1,
      component: Component.MCP_SERVER,
      operation: 'mcp_data_transformation',
      input: { source: 'taskmaster_file' },
      output: null,
      timestamp: new Date(),
      duration: 0,
      success: false,
      dataIntegrity: false
    };
    
    const stepStartTime = Date.now();
    
    try {
      // This will be coordinated with MCP Integration Specialist Agent
      // For now, we'll mark it as a placeholder and track the expectation
      
      step.output = { status: 'pending_mcp_agent_analysis' };
      step.success = true;
      step.duration = Date.now() - stepStartTime;
      step.dataIntegrity = true; // Will be validated by MCP agent
      
      this.dataFlowTrace.steps.push(step);
      
      // Create validation placeholder
      this.findings.validations.push({
        type: ValidationType.DATA_INTEGRITY,
        target: 'mcp_transformation',
        expected: 'live_taskmaster_data',
        actual: 'pending_analysis',
        passed: false, // Will be updated by MCP agent
        message: 'MCP data transformation analysis pending',
        severity: Severity.MEDIUM
      });
      
      this.utilities.log('info', Component.MCP_SERVER, 'MCP data flow trace prepared for MCP agent analysis');
      
    } catch (error) {
      step.success = false;
      step.duration = Date.now() - stepStartTime;
      step.output = { error: error.message };
      
      this.dataFlowTrace.steps.push(step);
      throw error;
    }
  }
  
  private async analyzeBridgeProcessing(): Promise<void> {
    this.utilities.log('info', Component.RUST_BRIDGE, 'Analyzing bridge data processing');
    
    const step: DataFlowStep = {
      stepNumber: this.dataFlowTrace.steps.length + 1,
      component: Component.RUST_BRIDGE,
      operation: 'bridge_data_processing',
      input: { source: 'mcp_response' },
      output: null,
      timestamp: new Date(),
      duration: 0,
      success: false,
      dataIntegrity: false
    };
    
    const stepStartTime = Date.now();
    
    try {
      // This will be coordinated with Rust Bridge Debugger Agent
      // For now, we'll set up the trace structure
      
      step.output = { status: 'pending_bridge_agent_analysis' };
      step.success = true;
      step.duration = Date.now() - stepStartTime;
      step.dataIntegrity = true; // Will be validated by bridge agent
      
      this.dataFlowTrace.steps.push(step);
      
      // Create validation placeholder
      this.findings.validations.push({
        type: ValidationType.DATA_INTEGRITY,
        target: 'bridge_processing',
        expected: 'preserved_data_integrity',
        actual: 'pending_analysis',
        passed: false, // Will be updated by bridge agent
        message: 'Bridge data processing analysis pending',
        severity: Severity.MEDIUM
      });
      
      this.utilities.log('info', Component.RUST_BRIDGE, 'Bridge processing trace prepared for bridge agent analysis');
      
    } catch (error) {
      step.success = false;
      step.duration = Date.now() - stepStartTime;
      step.output = { error: error.message };
      
      this.dataFlowTrace.steps.push(step);
      throw error;
    }
  }
  
  private async validateDataIntegrity(): Promise<void> {
    this.utilities.log('info', Component.TEST_FRAMEWORK, 'Validating end-to-end data integrity');
    
    const step: DataFlowStep = {
      stepNumber: this.dataFlowTrace.steps.length + 1,
      component: Component.TEST_FRAMEWORK,
      operation: 'validate_data_integrity',
      input: { allSteps: this.dataFlowTrace.steps.length },
      output: null,
      timestamp: new Date(),
      duration: 0,
      success: false,
      dataIntegrity: false
    };
    
    const stepStartTime = Date.now();
    
    try {
      // Calculate overall data integrity
      const successfulSteps = this.dataFlowTrace.steps.filter(s => s.success).length;
      const integrityMaintained = this.dataFlowTrace.steps.filter(s => s.dataIntegrity).length;
      
      const integrityPercentage = this.dataFlowTrace.steps.length > 0 
        ? (integrityMaintained / this.dataFlowTrace.steps.length) * 100 
        : 0;
      
      step.output = {
        totalSteps: this.dataFlowTrace.steps.length,
        successfulSteps,
        integrityMaintained,
        integrityPercentage
      };
      
      step.success = successfulSteps === this.dataFlowTrace.steps.length;
      step.dataIntegrity = integrityPercentage >= 80; // 80% threshold
      step.duration = Date.now() - stepStartTime;
      
      this.dataFlowTrace.steps.push(step);
      this.dataFlowTrace.dataIntegrityMaintained = step.dataIntegrity;
      
      // Create comprehensive validation
      this.findings.validations.push({
        type: ValidationType.DATA_INTEGRITY,
        target: 'end_to_end_flow',
        expected: { integrityPercentage: 100 },
        actual: { integrityPercentage },
        passed: integrityPercentage >= 80,
        message: `Data integrity: ${integrityPercentage.toFixed(1)}% (${integrityMaintained}/${this.dataFlowTrace.steps.length} steps)`,
        severity: integrityPercentage >= 80 ? Severity.INFO : Severity.HIGH
      });
      
      if (integrityPercentage < 80) {
        this.reportIssue({
          id: `data-integrity-failure-${Date.now()}`,
          type: IssueType.DATA_TRANSFORMATION_ERROR,
          severity: Severity.HIGH,
          component: Component.TEST_FRAMEWORK,
          description: `Data integrity compromised: ${integrityPercentage.toFixed(1)}%`,
          evidence: [
            this.utilities.createEvidence(
              EvidenceType.PERFORMANCE_METRIC,
              'Data integrity metrics',
              step.output,
              'data_flow_analyzer'
            )
          ],
          suggestedFixes: [
            {
              id: 'investigate-failed-steps',
              title: 'Investigate Failed Steps',
              description: 'Review failed data flow steps for root cause',
              implementation: 'Check logs and analyze each failed transformation step',
              riskLevel: 'low',
              estimatedTime: 15,
              testingRequired: true,
              rollbackPlan: 'No rollback needed for investigation'
            }
          ],
          detectedBy: this.name,
          timestamp: new Date(),
          reproduced: false,
          resolved: false
        });
      }
      
      this.utilities.log('info', Component.TEST_FRAMEWORK, 
        `Data integrity validation: ${integrityPercentage.toFixed(1)}%`);
      
    } catch (error) {
      step.success = false;
      step.duration = Date.now() - stepStartTime;
      step.output = { error: error.message };
      
      this.dataFlowTrace.steps.push(step);
      throw error;
    }
  }
  
  private async identifyTransformationIssues(): Promise<void> {
    this.utilities.log('info', Component.TEST_FRAMEWORK, 'Identifying transformation issues');
    
    const issues: string[] = [];
    const failedSteps = this.dataFlowTrace.steps.filter(step => !step.success);
    const integrityLossSteps = this.dataFlowTrace.steps.filter(step => !step.dataIntegrity);
    
    // Analyze failed steps
    failedSteps.forEach(step => {
      issues.push(`Step ${step.stepNumber} (${step.component}/${step.operation}) failed`);
    });
    
    // Analyze integrity loss
    integrityLossSteps.forEach(step => {
      if (step.success) { // Successful but lost integrity
        issues.push(`Step ${step.stepNumber} (${step.component}/${step.operation}) lost data integrity`);
      }
    });
    
    // Look for patterns in transformation chain
    const transformationPattern = this.analyzeTransformationPattern();
    
    if (issues.length > 0 || transformationPattern.issues.length > 0) {
      this.findings.summary = `Data flow analysis identified ${issues.length} step failures and ${transformationPattern.issues.length} transformation issues`;
      this.findings.confidence = Math.max(0, 1 - (issues.length * 0.2));
      this.findings.priority = issues.length > 0 ? Priority.HIGH : Priority.MEDIUM;
    } else {
      this.findings.summary = 'Data flow analysis completed successfully with no major issues detected';
      this.findings.confidence = 0.9;
      this.findings.priority = Priority.LOW;
    }
    
    // Add analysis results to data points
    this.findings.dataPoints.push(
      this.utilities.createDataPoint('transformation_issues', {
        stepFailures: issues,
        transformationIssues: transformationPattern.issues,
        totalSteps: this.dataFlowTrace.steps.length,
        successfulSteps: this.dataFlowTrace.steps.filter(s => s.success).length
      }, 'data_flow_analyzer', true)
    );
    
    this.utilities.log('info', Component.TEST_FRAMEWORK, 
      `Transformation analysis: ${issues.length} step failures, ${transformationPattern.issues.length} pattern issues`);
  }
  
  private analyzeTransformationPattern(): { issues: string[] } {
    const issues: string[] = [];
    
    // Check for expected transformation sequence
    const expectedSequence = [Component.TASKMASTER, Component.MCP_SERVER, Component.RUST_BRIDGE];
    const actualSequence = this.dataFlowTrace.steps.map(step => step.component);
    
    if (!this.sequencesMatch(actualSequence, expectedSequence)) {
      issues.push('Unexpected transformation sequence detected');
    }
    
    // Check for data consistency across steps
    const taskMasterStep = this.dataFlowTrace.steps.find(s => s.component === Component.TASKMASTER);
    if (taskMasterStep && taskMasterStep.output) {
      const taskMasterData = taskMasterStep.output;
      if (!this.isLiveTaskData(taskMasterData)) {
        issues.push('Stale data detected at source (TaskMaster)');
      }
    }
    
    return { issues };
  }
  
  private sequencesMatch(actual: Component[], expected: Component[]): boolean {
    if (actual.length < expected.length) return false;
    
    for (let i = 0; i < expected.length; i++) {
      if (!actual.includes(expected[i])) return false;
    }
    
    return true;
  }
  
  private generateRecommendations(): any[] {
    const recommendations: any[] = [];
    
    // Recommendation based on findings
    if (this.findings.issues.length > 0) {
      recommendations.push({
        id: 'investigate-data-flow-issues',
        type: 'IMMEDIATE_FIX',
        priority: Priority.HIGH,
        title: 'Investigate Data Flow Issues',
        description: 'Multiple issues detected in data flow analysis',
        reasoning: `Found ${this.findings.issues.length} issues affecting data integrity`,
        implementation: 'Review each identified issue and apply suggested fixes',
        riskAssessment: 'Low risk - investigation and analysis only',
        expectedOutcome: 'Clear understanding of root cause',
        confidence: this.findings.confidence,
        suggestedBy: this.name,
        relatedIssues: this.findings.issues.map(i => i.id)
      });
    }
    
    if (this.dataFlowTrace.dataIntegrityMaintained === false) {
      recommendations.push({
        id: 'restore-data-integrity',
        type: 'IMMEDIATE_FIX',
        priority: Priority.HIGH,
        title: 'Restore Data Integrity',
        description: 'Data integrity compromised in transformation chain',
        reasoning: 'Data integrity validation failed',
        implementation: 'Check each transformation step for data corruption points',
        riskAssessment: 'Medium risk - may require code changes',
        expectedOutcome: 'Maintained data integrity throughout flow',
        confidence: 0.8,
        suggestedBy: this.name,
        relatedIssues: []
      });
    }
    
    return recommendations;
  }
  
  private async verifyPreconditions(): Promise<void> {
    // Check if TaskMaster file exists
    if (!await this.fileExists(testPaths.taskMasterFile)) {
      throw new Error(`TaskMaster file not found: ${testPaths.taskMasterFile}`);
    }
    
    // Verify test results directory exists
    await fs.mkdir(testPaths.testResults, { recursive: true });
  }
  
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  private validateTaskMasterData(data: any): boolean {
    return (
      typeof data.totalTasks === 'number' &&
      typeof data.completedTasks === 'number' &&
      typeof data.completionPercentage === 'number' &&
      data.totalTasks > 0
    );
  }
  
  private isLiveTaskData(data: any): boolean {
    // Check if data matches expected live data pattern
    const expected = expectedTestData.liveTaskMasterStats;
    return (
      Math.abs(data.completionPercentage - expected.completionPercentage) < 5 ||
      (data.totalTasks === expected.totalTasks && data.completedTasks === expected.completedTasks)
    );
  }
  
  private isRecentData(lastModified: Date): boolean {
    const now = new Date();
    const diffHours = (now.getTime() - lastModified.getTime()) / (1000 * 60 * 60);
    return diffHours < 24; // Consider data recent if less than 24 hours old
  }
  
  private async exportTraceData(): Promise<void> {
    const traceData = {
      sessionId: this.sessionId,
      agent: this.name,
      version: this.version,
      trace: this.dataFlowTrace,
      findings: this.findings,
      timestamp: new Date()
    };
    
    const filename = `data-flow-trace-${this.sessionId}.json`;
    await this.utilities.saveArtifact(filename, JSON.stringify(traceData, null, 2));
    
    this.utilities.log('info', Component.TEST_FRAMEWORK, `Data flow trace exported to ${filename}`);
  }
  
  private reportIssue(issue: Issue): void {
    this.findings.issues.push(issue);
    this.utilities.log('warn', Component.TEST_FRAMEWORK, `Issue detected: ${issue.description}`);
  }
  
  private initializeFindings(): AgentFindings {
    return {
      agentName: this.name,
      timestamp: new Date(),
      summary: 'Data flow analysis in progress',
      issues: [],
      validations: [],
      dataPoints: [],
      confidence: 0,
      priority: Priority.MEDIUM
    };
  }
  
  private initializeDataFlowTrace(): DataFlowTrace {
    return {
      sessionId: this.sessionId,
      startTime: new Date(),
      steps: [],
      totalSteps: 0,
      successfulSteps: 0,
      dataIntegrityMaintained: false,
      issues: []
    };
  }
}
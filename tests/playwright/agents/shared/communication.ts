/**
 * Inter-agent communication system for coordinated debugging
 */

import { EventEmitter } from 'events';
import {
  AgentCommunication,
  SharedContext,
  AgentFindings,
  TestResults,
  ActionItem,
  Issue,
  Component,
  Severity,
  LogEntry
} from './types';

export class AgentCommunicationHub extends EventEmitter {
  private sharedContext: SharedContext;
  private activeAgents: Map<string, any> = new Map();
  private communicationHistory: AgentCommunication[] = [];
  
  constructor(sessionId: string) {
    super();
    this.sharedContext = {
      sessionId,
      taskMasterData: {
        projectName: '',
        taskFile: '',
        lastModified: new Date(),
        totalTasks: 0,
        completedTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        blockedTasks: 0,
        subtasksTotal: 0,
        subtasksCompleted: 0,
        completionPercentage: 0,
        isLiveData: false,
        dataSource: 'unknown'
      },
      mcpResponses: [],
      bridgeProcessState: {
        status: 'stopped',
        uptime: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        lastActivity: new Date(),
        healthPort: 8080,
        webhookPort: 3000,
        logLevel: 'info',
        version: '1.0.0'
      },
      telegramResponses: [],
      issuesDetected: [],
      dataFlowTrace: [],
      testEnvironmentState: {
        mcpServerRunning: false,
        bridgeProcessRunning: false,
        telegramMockRunning: false,
        taskMasterDataAvailable: false,
        portsInUse: [],
        environmentVariables: {},
        systemResources: {
          cpuUsage: 0,
          memoryUsage: 0,
          diskUsage: 0,
          networkLatency: 0,
          availablePorts: []
        }
      }
    };
    
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    this.on('agent:findings', this.handleAgentFindings.bind(this));
    this.on('agent:test-results', this.handleTestResults.bind(this));
    this.on('agent:issue-detected', this.handleIssueDetected.bind(this));
    this.on('agent:action-required', this.handleActionRequired.bind(this));
    this.on('agent:context-update', this.handleContextUpdate.bind(this));
  }
  
  /**
   * Register an agent with the communication hub
   */
  public registerAgent(agentName: string, agent: any): void {
    this.activeAgents.set(agentName, agent);
    this.emit('agent:registered', { agentName, timestamp: new Date() });
  }
  
  /**
   * Unregister an agent
   */
  public unregisterAgent(agentName: string): void {
    this.activeAgents.delete(agentName);
    this.emit('agent:unregistered', { agentName, timestamp: new Date() });
  }
  
  /**
   * Get current shared context
   */
  public getSharedContext(): SharedContext {
    return { ...this.sharedContext };
  }
  
  /**
   * Update shared context
   */
  public updateSharedContext(updates: Partial<SharedContext>): void {
    this.sharedContext = { ...this.sharedContext, ...updates };
    this.emit('context:updated', this.sharedContext);
  }
  
  /**
   * Broadcast findings from an agent to all other agents
   */
  public broadcastFindings(agentName: string, findings: AgentFindings): void {
    const communication: AgentCommunication = {
      findings: [findings],
      testResults: [],
      sharedContext: this.sharedContext,
      nextSteps: [],
      timestamp: new Date(),
      correlationId: this.generateCorrelationId()
    };
    
    this.communicationHistory.push(communication);
    this.emit('agent:findings', { agentName, findings, communication });
  }
  
  /**
   * Broadcast test results
   */
  public broadcastTestResults(agentName: string, testResults: TestResults): void {
    const communication: AgentCommunication = {
      findings: [],
      testResults: [testResults],
      sharedContext: this.sharedContext,
      nextSteps: [],
      timestamp: new Date(),
      correlationId: this.generateCorrelationId()
    };
    
    this.communicationHistory.push(communication);
    this.emit('agent:test-results', { agentName, testResults, communication });
  }
  
  /**
   * Report an issue detected by an agent
   */
  public reportIssue(agentName: string, issue: Issue): void {
    this.sharedContext.issuesDetected.push(issue);
    this.emit('agent:issue-detected', { agentName, issue });
    
    // Correlate with existing issues
    this.correlateIssues(issue);
  }
  
  /**
   * Request action from other agents
   */
  public requestAction(agentName: string, actionItem: ActionItem): void {
    this.emit('agent:action-required', { requestedBy: agentName, actionItem });
  }
  
  /**
   * Get all findings from all agents
   */
  public getAllFindings(): AgentFindings[] {
    return this.communicationHistory.flatMap(comm => comm.findings);
  }
  
  /**
   * Get all test results from all agents
   */
  public getAllTestResults(): TestResults[] {
    return this.communicationHistory.flatMap(comm => comm.testResults);
  }
  
  /**
   * Get communication history
   */
  public getCommunicationHistory(): AgentCommunication[] {
    return [...this.communicationHistory];
  }
  
  /**
   * Get issues by severity
   */
  public getIssuesBySeverity(severity: Severity): Issue[] {
    return this.sharedContext.issuesDetected.filter(issue => issue.severity === severity);
  }
  
  /**
   * Get issues by component
   */
  public getIssuesByComponent(component: Component): Issue[] {
    return this.sharedContext.issuesDetected.filter(issue => issue.component === component);
  }
  
  /**
   * Wait for specific agent findings
   */
  public async waitForAgentFindings(agentName: string, timeoutMs: number = 30000): Promise<AgentFindings> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for findings from ${agentName}`));
      }, timeoutMs);
      
      const handler = ({ agentName: reportingAgent, findings }: any) => {
        if (reportingAgent === agentName) {
          clearTimeout(timeout);
          this.off('agent:findings', handler);
          resolve(findings);
        }
      };
      
      this.on('agent:findings', handler);
    });
  }
  
  /**
   * Wait for all active agents to report findings
   */
  public async waitForAllAgentFindings(timeoutMs: number = 60000): Promise<AgentFindings[]> {
    const agentNames = Array.from(this.activeAgents.keys());
    const promises = agentNames.map(name => this.waitForAgentFindings(name, timeoutMs));
    
    try {
      return await Promise.all(promises);
    } catch (error) {
      // Return partial results if some agents timeout
      const results: AgentFindings[] = [];
      for (const promise of promises) {
        try {
          const result = await Promise.race([promise, this.createTimeoutPromise(1000)]);
          if (result) results.push(result);
        } catch {
          // Agent timed out, continue with others
        }
      }
      return results;
    }
  }
  
  /**
   * Create a coordination barrier for agents
   */
  public async createCoordinationBarrier(agentNames: string[], timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const completedAgents = new Set<string>();
      const timeout = setTimeout(() => {
        reject(new Error(`Coordination barrier timeout. Missing agents: ${
          agentNames.filter(name => !completedAgents.has(name)).join(', ')
        }`));
      }, timeoutMs);
      
      const handler = ({ agentName }: any) => {
        if (agentNames.includes(agentName)) {
          completedAgents.add(agentName);
          if (completedAgents.size === agentNames.length) {
            clearTimeout(timeout);
            this.off('agent:barrier-reached', handler);
            resolve();
          }
        }
      };
      
      this.on('agent:barrier-reached', handler);
    });
  }
  
  /**
   * Signal that an agent has reached a coordination barrier
   */
  public signalBarrierReached(agentName: string): void {
    this.emit('agent:barrier-reached', { agentName, timestamp: new Date() });
  }
  
  /**
   * Log a message to the shared log
   */
  public log(level: LogEntry['level'], component: Component, message: string, data?: any): void {
    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      component,
      message,
      data,
      correlationId: this.generateCorrelationId()
    };
    
    this.emit('log:entry', logEntry);
  }
  
  /**
   * Get aggregated statistics
   */
  public getStatistics() {
    const allFindings = this.getAllFindings();
    const allTestResults = this.getAllTestResults();
    const issues = this.sharedContext.issuesDetected;
    
    return {
      totalFindings: allFindings.length,
      totalTestResults: allTestResults.length,
      totalIssues: issues.length,
      criticalIssues: issues.filter(i => i.severity === Severity.CRITICAL).length,
      highIssues: issues.filter(i => i.severity === Severity.HIGH).length,
      averageConfidence: allFindings.reduce((sum, f) => sum + f.confidence, 0) / allFindings.length || 0,
      activeAgents: this.activeAgents.size,
      communicationEvents: this.communicationHistory.length
    };
  }
  
  private handleAgentFindings({ agentName, findings }: any): void {
    // Process and correlate findings with existing data
    this.correlateFindings(findings);
    
    // Update shared context based on findings
    if (findings.dataPoints) {
      this.updateContextFromDataPoints(findings.dataPoints);
    }
  }
  
  private handleTestResults({ agentName, testResults }: any): void {
    // Process test results and update system state
    this.updateTestEnvironmentState(testResults);
  }
  
  private handleIssueDetected({ agentName, issue }: any): void {
    // Cross-reference with other detected issues
    this.correlateIssues(issue);
    
    // Trigger automated responses if needed
    this.checkForCriticalIssues();
  }
  
  private handleActionRequired({ requestedBy, actionItem }: any): void {
    // Determine which agent(s) should handle the action
    const targetAgents = this.determineTargetAgents(actionItem);
    
    // Notify relevant agents
    targetAgents.forEach(agentName => {
      const agent = this.activeAgents.get(agentName);
      if (agent && typeof agent.handleActionRequest === 'function') {
        agent.handleActionRequest(actionItem);
      }
    });
  }
  
  private handleContextUpdate(context: SharedContext): void {
    // Broadcast context updates to all agents
    this.activeAgents.forEach((agent, agentName) => {
      if (typeof agent.onContextUpdate === 'function') {
        agent.onContextUpdate(context);
      }
    });
  }
  
  private correlateFindings(findings: AgentFindings): void {
    // Implement finding correlation logic
    const relatedFindings = this.getAllFindings().filter(f => 
      f.agentName !== findings.agentName &&
      this.findingsAreRelated(f, findings)
    );
    
    if (relatedFindings.length > 0) {
      this.emit('findings:correlated', { findings, relatedFindings });
    }
  }
  
  private correlateIssues(newIssue: Issue): void {
    const relatedIssues = this.sharedContext.issuesDetected.filter(issue =>
      issue.id !== newIssue.id &&
      (issue.component === newIssue.component || issue.type === newIssue.type)
    );
    
    if (relatedIssues.length > 0) {
      this.emit('issues:correlated', { newIssue, relatedIssues });
    }
  }
  
  private findingsAreRelated(f1: AgentFindings, f2: AgentFindings): boolean {
    // Simple relatedness check - can be made more sophisticated
    return f1.issues.some(i1 => 
      f2.issues.some(i2 => 
        i1.component === i2.component || i1.type === i2.type
      )
    );
  }
  
  private updateContextFromDataPoints(dataPoints: any[]): void {
    // Update shared context based on data points from findings
    dataPoints.forEach(point => {
      if (point.name === 'taskmaster_stats') {
        this.sharedContext.taskMasterData = { ...this.sharedContext.taskMasterData, ...point.value };
      } else if (point.name === 'bridge_state') {
        this.sharedContext.bridgeProcessState = { ...this.sharedContext.bridgeProcessState, ...point.value };
      }
    });
  }
  
  private updateTestEnvironmentState(testResults: TestResults): void {
    // Update environment state based on test results
    if (testResults.testName.includes('mcp')) {
      this.sharedContext.testEnvironmentState.mcpServerRunning = testResults.success;
    } else if (testResults.testName.includes('bridge')) {
      this.sharedContext.testEnvironmentState.bridgeProcessRunning = testResults.success;
    }
  }
  
  private checkForCriticalIssues(): void {
    const criticalIssues = this.getIssuesBySeverity(Severity.CRITICAL);
    if (criticalIssues.length > 0) {
      this.emit('critical:issues-detected', criticalIssues);
    }
  }
  
  private determineTargetAgents(actionItem: ActionItem): string[] {
    // Determine which agents can handle specific action types
    const agentCapabilities: Record<string, string[]> = {
      'data-flow-analyzer': ['investigate', 'trace'],
      'mcp-integration-specialist': ['test', 'validate'],
      'rust-bridge-debugger': ['fix', 'monitor'],
      'response-verification': ['validate', 'test'],
      'orchestration': ['coordinate', 'aggregate']
    };
    
    const targetAgents: string[] = [];
    Object.entries(agentCapabilities).forEach(([agentName, capabilities]) => {
      if (capabilities.includes(actionItem.type)) {
        targetAgents.push(agentName);
      }
    });
    
    return targetAgents;
  }
  
  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private async createTimeoutPromise(ms: number): Promise<null> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), ms);
    });
  }
}
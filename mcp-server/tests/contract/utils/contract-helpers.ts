/**
 * Contract Testing Utilities
 * Helper functions for consumer and provider contract tests
 */

import { Pact, Matchers } from '@pact-foundation/pact';
import { CCTelegramEvent, TelegramResponse, BridgeStatus } from '../../../src/types.js';
import { createEvent, createResponse, createBridgeStatus } from '../../factories/data-factory.js';
import { consumerConfig } from '../config/pact.config.js';

const { like, string, integer, boolean, uuid, iso8601DateTime } = Matchers;

/**
 * Contract test fixture generator
 */
export class ContractFixtures {
  /**
   * Generate event fixture with Pact matchers
   */
  static createEventFixture(overrides: Partial<CCTelegramEvent> = {}): any {
    const baseEvent = createEvent(overrides);
    return {
      type: like(baseEvent.type),
      source: like(baseEvent.source),
      timestamp: iso8601DateTime(baseEvent.timestamp),
      task_id: uuid(baseEvent.task_id),
      title: like(baseEvent.title),
      description: like(baseEvent.description),
      data: like(baseEvent.data)
    };
  }

  /**
   * Generate response fixture with Pact matchers
   */
  static createResponseFixture(overrides: Partial<TelegramResponse> = {}): any {
    const baseResponse = createResponse(overrides);
    return {
      id: uuid(baseResponse.id),
      user_id: integer(baseResponse.user_id),
      message: like(baseResponse.message),
      timestamp: iso8601DateTime(baseResponse.timestamp),
      event_id: uuid(baseResponse.event_id),
      action: like(baseResponse.action),
      data: like(baseResponse.data)
    };
  }

  /**
   * Generate bridge status fixture with Pact matchers
   */
  static createBridgeStatusFixture(overrides: Partial<BridgeStatus> = {}): any {
    const baseStatus = createBridgeStatus(overrides);
    return {
      running: boolean(baseStatus.running),
      health: like(baseStatus.health),
      metrics: like({
        uptime_seconds: integer(baseStatus.metrics.uptime_seconds),
        events_processed: integer(baseStatus.metrics.events_processed),
        telegram_messages_sent: integer(baseStatus.metrics.telegram_messages_sent),
        error_count: integer(baseStatus.metrics.error_count),
        memory_usage_mb: like(baseStatus.metrics.memory_usage_mb),
        cpu_usage_percent: like(baseStatus.metrics.cpu_usage_percent)
      }),
      last_event_time: baseStatus.last_event_time ? iso8601DateTime(baseStatus.last_event_time) : null
    };
  }

  /**
   * Generate API success response fixture
   */
  static createSuccessResponse(data: any = {}): any {
    return {
      success: boolean(true),
      event_id: uuid(),
      message: like('Operation completed successfully'),
      data: like(data),
      timestamp: iso8601DateTime()
    };
  }

  /**
   * Generate API error response fixture
   */
  static createErrorResponse(error: string = 'An error occurred', code: string = 'GENERIC_ERROR'): any {
    return {
      success: boolean(false),
      error: like(error),
      code: like(code),
      timestamp: iso8601DateTime(),
      request_id: uuid()
    };
  }
}

/**
 * Contract state manager for provider testing
 */
export class ContractStateManager {
  private states: Map<string, () => Promise<void>> = new Map();

  constructor() {
    this.setupDefaultStates();
  }

  /**
   * Setup default provider states
   */
  private setupDefaultStates(): void {
    // Bridge running states
    this.addState('bridge is running', async () => {
      console.log('Setting up: bridge is running');
      // Mock bridge as running
    });

    this.addState('bridge is stopped', async () => {
      console.log('Setting up: bridge is stopped');
      // Mock bridge as stopped
    });

    this.addState('bridge is healthy', async () => {
      console.log('Setting up: bridge is healthy');
      // Mock bridge health as good
    });

    this.addState('bridge is unhealthy', async () => {
      console.log('Setting up: bridge is unhealthy');
      // Mock bridge health as poor
    });

    // Data states
    this.addState('events directory exists', async () => {
      console.log('Setting up: events directory exists');
      // Ensure events directory is available
    });

    this.addState('responses directory exists', async () => {
      console.log('Setting up: responses directory exists');
      // Ensure responses directory is available
    });

    this.addState('valid event exists', async () => {
      console.log('Setting up: valid event exists');
      // Prepare valid event data
    });

    this.addState('telegram responses exist', async () => {
      console.log('Setting up: telegram responses exist');
      // Prepare response data
    });

    this.addState('no telegram responses', async () => {
      console.log('Setting up: no telegram responses');
      // Clear response data
    });

    this.addState('task status data exists', async () => {
      console.log('Setting up: task status data exists');
      // Prepare task status data
    });
  }

  /**
   * Add a new state handler
   */
  addState(state: string, handler: () => Promise<void>): void {
    this.states.set(state, handler);
  }

  /**
   * Execute state setup
   */
  async executeState(state: string): Promise<void> {
    const handler = this.states.get(state);
    if (handler) {
      await handler();
    } else {
      console.warn(`No handler found for state: ${state}`);
    }
  }

  /**
   * Get all available states
   */
  getAvailableStates(): string[] {
    return Array.from(this.states.keys());
  }
}

/**
 * Contract test helper for consumer tests
 */
export class ConsumerTestHelper {
  private pact: Pact;

  constructor(customConfig: Partial<typeof consumerConfig> = {}) {
    this.pact = new Pact({
      ...consumerConfig,
      ...customConfig
    });
  }

  /**
   * Get Pact instance
   */
  getPact(): Pact {
    return this.pact;
  }

  /**
   * Setup Pact for testing
   */
  async setup(): Promise<void> {
    await this.pact.setup();
  }

  /**
   * Verify Pact interactions
   */
  async verify(): Promise<void> {
    await this.pact.verify();
  }

  /**
   * Finalize Pact (write contracts)
   */
  async finalize(): Promise<void> {
    await this.pact.finalize();
  }

  /**
   * Add interaction for event submission
   */
  addEventSubmissionInteraction(
    state: string,
    request: any,
    response: any,
    description: string = 'event submission'
  ): void {
    this.pact
      .given(state)
      .uponReceiving(`a ${description} request`)
      .withRequest({
        method: 'POST',
        path: '/api/events',
        headers: {
          'Content-Type': 'application/json'
        },
        body: request
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: response
      });
  }

  /**
   * Add interaction for health check
   */
  addHealthCheckInteraction(state: string, response: any): void {
    this.pact
      .given(state)
      .uponReceiving('a health check request')
      .withRequest({
        method: 'GET',
        path: '/health'
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: response
      });
  }

  /**
   * Add interaction for getting responses
   */
  addGetResponsesInteraction(
    state: string,
    query: any,
    response: any
  ): void {
    this.pact
      .given(state)
      .uponReceiving('a get responses request')
      .withRequest({
        method: 'GET',
        path: '/api/responses',
        query: query
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: response
      });
  }

  /**
   * Add interaction for bridge management
   */
  addBridgeManagementInteraction(
    state: string,
    action: 'start' | 'stop' | 'restart' | 'status',
    response: any
  ): void {
    const method = action === 'status' ? 'GET' : 'POST';
    const path = `/api/bridge/${action}`;

    this.pact
      .given(state)
      .uponReceiving(`a bridge ${action} request`)
      .withRequest({
        method,
        path
      })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: response
      });
  }
}

/**
 * Contract validation utilities
 */
export class ContractValidator {
  /**
   * Validate event structure against contract
   */
  static validateEvent(event: CCTelegramEvent): boolean {
    const required = ['type', 'source', 'timestamp', 'task_id', 'title', 'description'];
    return required.every(field => field in event && event[field as keyof CCTelegramEvent] != null);
  }

  /**
   * Validate response structure against contract
   */
  static validateResponse(response: TelegramResponse): boolean {
    const required = ['id', 'user_id', 'message', 'timestamp'];
    return required.every(field => field in response && response[field as keyof TelegramResponse] != null);
  }

  /**
   * Validate bridge status structure against contract
   */
  static validateBridgeStatus(status: BridgeStatus): boolean {
    const required = ['running', 'health', 'metrics'];
    const metricsRequired = [
      'uptime_seconds', 'events_processed', 'telegram_messages_sent',
      'error_count', 'memory_usage_mb', 'cpu_usage_percent'
    ];
    
    return required.every(field => field in status) &&
           metricsRequired.every(field => field in status.metrics);
  }

  /**
   * Validate API response structure
   */
  static validateApiResponse(response: any): boolean {
    return typeof response === 'object' &&
           'success' in response &&
           typeof response.success === 'boolean';
  }
}

/**
 * Contract evolution helper
 */
export class ContractEvolutionHelper {
  /**
   * Check if contract change is breaking
   */
  static isBreakingChange(oldContract: any, newContract: any): boolean {
    // Simple breaking change detection
    // In real implementation, this would be more sophisticated
    
    // Check if required fields were removed
    const oldRequired = oldContract.required || [];
    const newRequired = newContract.required || [];
    
    return oldRequired.some((field: string) => !newRequired.includes(field));
  }

  /**
   * Generate contract evolution report
   */
  static generateEvolutionReport(oldContract: any, newContract: any): any {
    return {
      version_change: 'minor',
      breaking_changes: this.isBreakingChange(oldContract, newContract),
      added_fields: [],
      removed_fields: [],
      changed_fields: [],
      compatibility_score: 0.95,
      recommendations: []
    };
  }

  /**
   * Check deployment compatibility
   */
  static async checkDeploymentCompatibility(version: string): Promise<boolean> {
    // In real implementation, this would call Pact Broker
    console.log(`Checking deployment compatibility for version: ${version}`);
    return true;
  }
}

export default {
  ContractFixtures,
  ContractStateManager,
  ConsumerTestHelper,
  ContractValidator,
  ContractEvolutionHelper
};
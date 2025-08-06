/**
 * Response Factory Definitions
 * 
 * Factory definitions for Telegram responses and user interactions
 */

import { Factory, FactoryUtils, Sequences } from './factory-bot.js';
import { TelegramResponse } from '../../src/types.js';

/**
 * Base Telegram response factory
 */
Factory.define<TelegramResponse>('telegram_response', () => ({
  id: Factory.sequence('responseId'),
  user_id: Factory.sequence('userId'),
  message: 'Test response message',
  timestamp: new Date().toISOString()
}), {
  traits: {
    // Approval responses
    approve: (response) => ({
      ...response,
      message: 'Approved',
      action: 'approve'
    }),

    deny: (response) => ({
      ...response,
      message: 'Denied',
      action: 'deny'
    }),

    defer: (response) => ({
      ...response,
      message: 'Deferred for later review',
      action: 'defer'
    }),

    // Response with event reference
    with_event: (response) => ({
      ...response,
      event_id: Factory.sequence('eventId')
    }),

    // Detailed approval responses
    detailed_approve: (response) => ({
      ...response,
      message: 'Approved after careful review. Proceeding with implementation.',
      action: 'approve',
      data: {
        review_time_seconds: FactoryUtils.randomNumber(30, 300),
        confidence_level: FactoryUtils.randomChoice(['high', 'medium', 'low']),
        notes: 'Implementation looks good'
      }
    }),

    detailed_deny: (response) => ({
      ...response,
      message: 'Denied due to security concerns. Please review and resubmit.',
      action: 'deny',
      data: {
        review_time_seconds: FactoryUtils.randomNumber(60, 600),
        reason: FactoryUtils.randomChoice([
          'Security risk',
          'Policy violation',
          'Insufficient testing',
          'Missing documentation'
        ]),
        suggested_action: 'Please address the identified issues and resubmit'
      }
    }),

    // Custom action responses
    custom_action: (response) => ({
      ...response,
      message: 'Custom action executed',
      action: FactoryUtils.randomChoice(['restart', 'rollback', 'pause', 'resume']),
      data: {
        action_type: 'custom',
        parameters: {
          force: FactoryUtils.randomBoolean(),
          timeout: FactoryUtils.randomNumber(30, 300)
        }
      }
    }),

    // Emergency responses
    emergency: (response) => ({
      ...response,
      message: '🚨 EMERGENCY STOP - All operations halted',
      action: 'emergency_stop',
      data: {
        severity: 'critical',
        initiated_by: `user_${response.user_id}`,
        reason: 'Manual emergency intervention'
      }
    }),

    // Status inquiry responses
    status_inquiry: (response) => ({
      ...response,
      message: 'Status check requested',
      action: 'status',
      data: {
        requested_info: FactoryUtils.randomChoice([
          'system_health',
          'active_tasks',
          'error_logs',
          'performance_metrics'
        ])
      }
    }),

    // Help request responses
    help_request: (response) => ({
      ...response,
      message: 'Help needed with current task',
      action: 'help',
      data: {
        help_type: FactoryUtils.randomChoice([
          'technical_guidance',
          'clarification',
          'troubleshooting',
          'documentation'
        ])
      }
    }),

    // Time-based response traits
    very_recent: (response) => ({
      ...response,
      timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 minutes ago
    }),

    recent: (response) => ({
      ...response,
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 minutes ago
    }),

    old: (response) => ({
      ...response,
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // 24 hours ago
    }),

    very_old: (response) => ({
      ...response,
      timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days ago
    }),

    // User type traits
    admin_user: (response) => ({
      ...response,
      user_id: 1, // Admin user ID
      data: {
        ...response.data,
        user_role: 'admin',
        permissions: ['read', 'write', 'admin']
      }
    }),

    standard_user: (response) => ({
      ...response,
      user_id: Factory.sequence('userId'),
      data: {
        ...response.data,
        user_role: 'user',
        permissions: ['read']
      }
    }),

    developer_user: (response) => ({
      ...response,
      user_id: Factory.sequence('userId'),
      data: {
        ...response.data,
        user_role: 'developer',
        permissions: ['read', 'write']
      }
    }),

    // Response validation traits
    invalid_user_id: (response) => ({
      ...response,
      user_id: -1 // Invalid user ID
    }),

    invalid_timestamp: (response) => ({
      ...response,
      timestamp: 'invalid-timestamp'
    }),

    missing_message: (response) => {
      const { message, ...responseWithoutMessage } = response;
      return responseWithoutMessage as TelegramResponse;
    },

    empty_message: (response) => ({
      ...response,
      message: ''
    }),

    long_message: (response) => ({
      ...response,
      message: 'x'.repeat(1001) // Exceeds max length
    }),

    // Language-specific responses
    spanish: (response) => ({
      ...response,
      message: 'Aprobado',
      action: 'approve',
      data: {
        ...response.data,
        language: 'es'
      }
    }),

    french: (response) => ({
      ...response,
      message: 'Approuvé',
      action: 'approve',
      data: {
        ...response.data,
        language: 'fr'
      }
    }),

    // Special character responses
    emoji_response: (response) => ({
      ...response,
      message: '✅ Approved! 🚀 Ready to proceed',
      action: 'approve'
    }),

    special_chars: (response) => ({
      ...response,
      message: 'Тест with спецсимволы and 中文 characters',
      action: 'test'
    })
  },

  sequences: {
    responseId: Sequences.responseId,
    userId: Sequences.userId,
    eventId: Sequences.eventId
  }
});

/**
 * Response batch factory for creating multiple related responses
 */
Factory.define<TelegramResponse[]>('response_batch', () => {
  const count = FactoryUtils.randomNumber(3, 10);
  const baseTimestamp = Date.now();
  const eventId = Factory.sequence('eventId');
  
  return Array.from({ length: count }, (_, index) => 
    Factory.build<TelegramResponse>('telegram_response', {
      event_id: eventId,
      timestamp: new Date(baseTimestamp + index * 1000).toISOString(),
      message: `Response ${index + 1}`
    })
  );
});

/**
 * Approval workflow responses
 */
Factory.define<TelegramResponse[]>('approval_workflow', () => {
  const eventId = Factory.sequence('eventId');
  const baseTimestamp = Date.now();
  
  return [
    // Initial approval request (this would be an event, but we track the response)
    Factory.build<TelegramResponse>('telegram_response', {
      event_id: eventId,
      timestamp: new Date(baseTimestamp + 60000).toISOString()
    }, ['approve']),
    
    // Confirmation response
    Factory.build<TelegramResponse>('telegram_response', {
      event_id: eventId,
      timestamp: new Date(baseTimestamp + 120000).toISOString(),
      message: 'Approval confirmed, proceeding with execution',
      action: 'confirm'
    })
  ];
});

/**
 * Mixed approval responses for testing various scenarios
 */
Factory.define<TelegramResponse[]>('mixed_approval_responses', () => {
  const eventId = Factory.sequence('eventId');
  const actions = ['approve', 'deny', 'defer'];
  
  return actions.map((action, index) => 
    Factory.build<TelegramResponse>('telegram_response', {
      event_id: eventId,
      timestamp: new Date(Date.now() + index * 60000).toISOString()
    }, [action])
  );
});

/**
 * Time-based response collection for testing cleanup and aging
 */
Factory.define<TelegramResponse[]>('time_based_responses', () => {
  const now = Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  
  return [
    Factory.build<TelegramResponse>('telegram_response', {}, ['very_recent']),
    Factory.build<TelegramResponse>('telegram_response', {}, ['recent']),
    Factory.build<TelegramResponse>('telegram_response', {}, ['old']),
    Factory.build<TelegramResponse>('telegram_response', {}, ['very_old'])
  ];
});

/**
 * User role-based responses for testing authorization
 */
Factory.define<TelegramResponse[]>('role_based_responses', () => [
  Factory.build<TelegramResponse>('telegram_response', {}, ['admin_user', 'approve']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['developer_user', 'defer']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['standard_user', 'status_inquiry'])
]);

/**
 * Invalid responses for error testing
 */
Factory.define<TelegramResponse[]>('invalid_responses', () => [
  Factory.build<TelegramResponse>('telegram_response', {}, ['invalid_user_id']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['invalid_timestamp']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['missing_message']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['empty_message']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['long_message'])
]);

/**
 * Multi-language responses for internationalization testing
 */
Factory.define<TelegramResponse[]>('multilingual_responses', () => [
  Factory.build<TelegramResponse>('telegram_response', {}, ['approve']), // English
  Factory.build<TelegramResponse>('telegram_response', {}, ['spanish']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['french']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['emoji_response']),
  Factory.build<TelegramResponse>('telegram_response', {}, ['special_chars'])
]);
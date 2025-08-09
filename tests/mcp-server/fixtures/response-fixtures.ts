/**
 * Telegram Response Test Fixtures
 * Provides pre-built response objects for testing response handling
 */

import { TelegramResponse } from '../../src/types.js';

// Base timestamp for consistent testing
export const BASE_TIMESTAMP = '2025-08-05T10:00:00.000Z';
export const VALID_USER_ID = 123456789;
export const VALID_EVENT_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Valid approval response
 */
export const VALID_APPROVAL_RESPONSE: TelegramResponse = {
  id: 'response-approval-001',
  user_id: VALID_USER_ID,
  message: 'Approved',
  timestamp: BASE_TIMESTAMP,
  event_id: VALID_EVENT_ID,
  action: 'approve'
};

/**
 * Valid denial response
 */
export const VALID_DENIAL_RESPONSE: TelegramResponse = {
  id: 'response-denial-001',
  user_id: VALID_USER_ID,
  message: 'Denied - needs more testing',
  timestamp: BASE_TIMESTAMP,
  event_id: VALID_EVENT_ID,
  action: 'deny'
};

/**
 * Valid custom response with additional data
 */
export const VALID_CUSTOM_RESPONSE: TelegramResponse = {
  id: 'response-custom-001',
  user_id: VALID_USER_ID,
  message: 'Defer until Monday',
  timestamp: BASE_TIMESTAMP,
  event_id: VALID_EVENT_ID,
  action: 'defer',
  data: {
    reason: 'Weekend deployment freeze',
    reschedule_date: '2025-08-08T09:00:00.000Z'
  }
};

/**
 * Response without event_id (general message)
 */
export const VALID_GENERAL_RESPONSE: TelegramResponse = {
  id: 'response-general-001',
  user_id: VALID_USER_ID,
  message: 'Status update received',
  timestamp: BASE_TIMESTAMP
};

/**
 * Collection of responses for batch testing
 */
export const MULTIPLE_RESPONSES: TelegramResponse[] = [
  {
    id: 'response-001',
    user_id: 123456789,
    message: 'Approved',
    timestamp: '2025-08-05T10:00:00.000Z',
    event_id: 'event-001',
    action: 'approve'
  },
  {
    id: 'response-002',
    user_id: 987654321,
    message: 'Denied',
    timestamp: '2025-08-05T10:05:00.000Z',
    event_id: 'event-002',
    action: 'deny'
  },
  {
    id: 'response-003',
    user_id: 555666777,
    message: 'Defer for review',
    timestamp: '2025-08-05T10:10:00.000Z',
    event_id: 'event-003',
    action: 'defer'
  },
  {
    id: 'response-004',
    user_id: 111222333,
    message: 'General status inquiry',
    timestamp: '2025-08-05T10:15:00.000Z'
  }
];

/**
 * Responses with different timestamps for age testing
 */
export const TIME_BASED_RESPONSES = {
  VERY_OLD: {
    id: 'response-very-old',
    user_id: VALID_USER_ID,
    message: 'Very old response',
    timestamp: '2025-08-01T10:00:00.000Z' // 4 days old
  },
  OLD: {
    id: 'response-old',
    user_id: VALID_USER_ID,
    message: 'Old response',
    timestamp: '2025-08-04T10:00:00.000Z' // 1 day old
  },
  RECENT: {
    id: 'response-recent',
    user_id: VALID_USER_ID,
    message: 'Recent response',
    timestamp: '2025-08-05T09:30:00.000Z' // 30 minutes old
  },
  VERY_RECENT: {
    id: 'response-very-recent',
    user_id: VALID_USER_ID,
    message: 'Very recent response',
    timestamp: '2025-08-05T09:55:00.000Z' // 5 minutes old
  }
};

/**
 * Invalid responses for negative testing
 */
export const INVALID_RESPONSES = {
  MISSING_ID: {
    user_id: VALID_USER_ID,
    message: 'Missing ID field',
    timestamp: BASE_TIMESTAMP
  },
  
  MISSING_USER_ID: {
    id: 'response-missing-user',
    message: 'Missing user_id field',
    timestamp: BASE_TIMESTAMP
  },
  
  MISSING_MESSAGE: {
    id: 'response-missing-message',
    user_id: VALID_USER_ID,
    timestamp: BASE_TIMESTAMP
  },
  
  MISSING_TIMESTAMP: {
    id: 'response-missing-timestamp',
    user_id: VALID_USER_ID,
    message: 'Missing timestamp field'
  },
  
  INVALID_TIMESTAMP: {
    id: 'response-invalid-timestamp',
    user_id: VALID_USER_ID,
    message: 'Invalid timestamp',
    timestamp: 'not-a-valid-date'
  },
  
  INVALID_USER_ID: {
    id: 'response-invalid-user',
    user_id: 'not-a-number' as any,
    message: 'Invalid user ID',
    timestamp: BASE_TIMESTAMP
  }
};

/**
 * Response scenarios for different testing needs
 */
export const RESPONSE_SCENARIOS = {
  EMPTY_RESPONSES: [],
  
  SINGLE_RESPONSE: [VALID_APPROVAL_RESPONSE],
  
  LIMIT_TEST_RESPONSES: Array.from({ length: 15 }, (_, i) => ({
    id: `response-limit-${i + 1}`,
    user_id: VALID_USER_ID + i,
    message: `Response ${i + 1}`,
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    action: i % 3 === 0 ? 'approve' : i % 3 === 1 ? 'deny' : 'defer'
  })) as TelegramResponse[]
};
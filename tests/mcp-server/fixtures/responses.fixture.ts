/**
 * Response Fixtures
 * Sample Telegram responses for testing
 */

import { TelegramResponse } from '../../src/types.js';
import { v4 as uuidv4 } from 'uuid';

export class ResponseFixtures {
  static createBasicResponse(overrides: Partial<TelegramResponse> = {}): TelegramResponse {
    return {
      id: uuidv4(),
      user_id: 123456789,
      message: 'Test response',
      timestamp: new Date().toISOString(),
      ...overrides
    };
  }

  static createApprovalResponse(approved: boolean, overrides: Partial<TelegramResponse> = {}): TelegramResponse {
    const taskId = uuidv4();
    return this.createBasicResponse({
      message: approved ? 'Approved' : 'Denied',
      event_id: taskId,
      action: approved ? 'approve' : 'deny',
      ...overrides
    });
  }

  static createCallbackResponse(callbackData: string, overrides: Partial<any> = {}): any {
    return {
      ...this.createBasicResponse(),
      response_type: 'callback_query',
      callback_data: callbackData,
      user_id: 123456789,
      username: 'testuser',
      ...overrides
    };
  }

  static createApprovalCallbackResponse(taskId: string, approved: boolean): any {
    const callbackData = approved ? `approve_${taskId}` : `deny_${taskId}`;
    return this.createCallbackResponse(callbackData, {
      message: approved ? 'Request approved' : 'Request denied'
    });
  }

  static createTextResponse(text: string, overrides: Partial<TelegramResponse> = {}): TelegramResponse {
    return this.createBasicResponse({
      message: text,
      ...overrides
    });
  }

  static createResponseBatch(count: number, userId?: number): TelegramResponse[] {
    const responses: TelegramResponse[] = [];
    const baseUserId = userId || 123456789;
    
    for (let i = 0; i < count; i++) {
      responses.push(this.createBasicResponse({
        id: uuidv4(),
        user_id: baseUserId + i,
        message: `Response ${i + 1}`,
        timestamp: new Date(Date.now() - (count - i) * 60000).toISOString() // Spread over time
      }));
    }
    
    return responses;
  }

  static createOldResponse(hoursOld: number, overrides: Partial<TelegramResponse> = {}): TelegramResponse {
    const timestamp = new Date(Date.now() - (hoursOld * 60 * 60 * 1000)).toISOString();
    return this.createBasicResponse({
      timestamp,
      message: `Old response from ${hoursOld} hours ago`,
      ...overrides
    });
  }

  static createRecentResponse(minutesAgo: number, overrides: Partial<TelegramResponse> = {}): TelegramResponse {
    const timestamp = new Date(Date.now() - (minutesAgo * 60 * 1000)).toISOString();
    return this.createBasicResponse({
      timestamp,
      message: `Recent response from ${minutesAgo} minutes ago`,
      ...overrides
    });
  }

  // Security test responses
  static createMaliciousResponse(attackType: string): any {
    const baseResponse = this.createBasicResponse();
    
    switch (attackType) {
      case 'xss':
        return { ...baseResponse, message: '<script>alert("xss")</script>' };
      case 'sql_injection':
        return { ...baseResponse, message: "'; DROP TABLE responses; --" };
      case 'path_traversal':
        return { ...baseResponse, message: '../../../etc/passwd' };
      case 'oversized':
        return { ...baseResponse, message: 'A'.repeat(10000) };
      case 'invalid_user_id':
        return { ...baseResponse, user_id: 'not-a-number' as any };
      case 'missing_required_field':
        const { message, ...incomplete } = baseResponse;
        return incomplete;
      default:
        return baseResponse;
    }
  }
}
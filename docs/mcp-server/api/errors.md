# Error Handling

Comprehensive guide to error handling, error codes, and troubleshooting in the CCTelegram MCP Server API.

## 🚨 Error Response Format

All API errors follow a consistent JSON structure:

```json
{
  "error": true,
  "code": "ERROR_CODE",
  "message": "Human-readable error description",
  "details": {
    "field": "specific_field",
    "reason": "detailed_reason"
  },
  "timestamp": "2025-01-15T10:30:00.000Z",
  "request_id": "req_abc123def456"
}
```

## 📋 Error Categories

### Authentication Errors (401)

**AUTHENTICATION_ERROR**
```json
{
  "error": true,
  "code": "AUTHENTICATION_ERROR",
  "message": "Invalid or missing API key",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**INVALID_API_KEY**
```json
{
  "error": true,
  "code": "INVALID_API_KEY", 
  "message": "API key format is invalid",
  "details": {
    "expected_format": "alphanumeric string, 32+ characters"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**UNAUTHORIZED_TOOL**
```json
{
  "error": true,
  "code": "UNAUTHORIZED_TOOL",
  "message": "Access to this tool is not permitted",
  "details": {
    "tool_name": "send_telegram_event",
    "required_permission": "event_send"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Validation Errors (400)

**VALIDATION_ERROR**
```json
{
  "error": true,
  "code": "VALIDATION_ERROR",
  "message": "Input validation failed",
  "details": {
    "field": "title",
    "reason": "exceeds maximum length of 200 characters",
    "current_length": 250,
    "max_length": 200
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**MISSING_REQUIRED_FIELD**
```json
{
  "error": true,
  "code": "MISSING_REQUIRED_FIELD",
  "message": "Required field is missing",
  "details": {
    "field": "description",
    "required_fields": ["type", "title", "description"]
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**INVALID_EVENT_TYPE**
```json
{
  "error": true,
  "code": "INVALID_EVENT_TYPE", 
  "message": "Unknown event type",
  "details": {
    "provided_type": "invalid_event_type",
    "available_types": ["task_completion", "performance_alert", "approval_request"]
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**INVALID_PARAMETER**
```json
{
  "error": true,
  "code": "INVALID_PARAMETER",
  "message": "Parameter value is invalid",
  "details": {
    "parameter": "limit",
    "provided_value": 150,
    "valid_range": "1-100"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Rate Limiting Errors (429)

**RATE_LIMIT_EXCEEDED**
```json
{
  "error": true,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Request rate limit exceeded",
  "details": {
    "limit": 100,
    "window": 60,
    "current_requests": 105,
    "retry_after": 30,
    "reset_time": "2025-01-15T10:31:00.000Z"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**TOO_MANY_REQUESTS**
```json
{
  "error": true,
  "code": "TOO_MANY_REQUESTS",
  "message": "Global rate limit exceeded",
  "details": {
    "retry_after": 60,
    "limit_type": "global"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Bridge Errors (503/502)

**BRIDGE_UNAVAILABLE**
```json
{
  "error": true,
  "code": "BRIDGE_UNAVAILABLE",
  "message": "CCTelegram bridge service is unavailable",
  "details": {
    "bridge_status": "stopped",
    "last_check": "2025-01-15T10:29:00.000Z",
    "suggested_action": "start_bridge"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**BRIDGE_CONNECTION_FAILED**
```json
{
  "error": true,
  "code": "BRIDGE_CONNECTION_FAILED", 
  "message": "Failed to connect to bridge service",
  "details": {
    "connection_timeout_ms": 5000,
    "retry_count": 3
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### System Errors (500)

**INTERNAL_ERROR**
```json
{
  "error": true,
  "code": "INTERNAL_ERROR",
  "message": "An internal server error occurred",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "request_id": "req_abc123def456"
}
```

**PROCESSING_ERROR**
```json
{
  "error": true,
  "code": "PROCESSING_ERROR",
  "message": "Failed to process request",
  "details": {
    "stage": "event_validation",
    "internal_code": "EVT_001"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**TIMEOUT_ERROR**
```json
{
  "error": true,
  "code": "TIMEOUT_ERROR",
  "message": "Request timed out",
  "details": {
    "timeout_ms": 30000,
    "operation": "telegram_api_call"
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

## 🔧 Error Handling Strategies

### Client-Side Error Handling

#### JavaScript/TypeScript Example
```typescript
interface MCPError {
  error: true;
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
  request_id?: string;
}

class MCPClient {
  async sendEvent(event: any): Promise<any> {
    try {
      const response = await fetch('/tools/send_telegram_event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify(event)
      });

      const data = await response.json();
      
      if (!response.ok || data.error) {
        throw new MCPAPIError(data);
      }
      
      return data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  private handleError(error: any): never {
    if (error instanceof MCPAPIError) {
      // Handle specific MCP errors
      switch (error.code) {
        case 'AUTHENTICATION_ERROR':
          console.error('Invalid API key - check configuration');
          break;
        case 'VALIDATION_ERROR':
          console.error('Validation failed:', error.details);
          break;
        case 'RATE_LIMIT_EXCEEDED':
          console.warn('Rate limited - retrying in', error.details.retry_after, 'seconds');
          break;
        case 'BRIDGE_UNAVAILABLE':
          console.error('Bridge unavailable - try starting bridge');
          break;
        default:
          console.error('MCP API Error:', error.message);
      }
      throw error;
    }
    
    // Handle network or other errors
    console.error('Network or system error:', error);
    throw error;
  }
}

class MCPAPIError extends Error {
  code: string;
  details?: Record<string, any>;
  timestamp: string;
  request_id?: string;

  constructor(errorResponse: MCPError) {
    super(errorResponse.message);
    this.name = 'MCPAPIError';
    this.code = errorResponse.code;
    this.details = errorResponse.details;
    this.timestamp = errorResponse.timestamp;
    this.request_id = errorResponse.request_id;
  }
}
```

#### Python Example
```python
import requests
import time
from typing import Optional, Dict, Any

class MCPError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}

class MCPClient:
    def __init__(self, api_key: str, base_url: str = "http://localhost:8080"):
        self.api_key = api_key
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({"X-API-Key": api_key})

    def send_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        try:
            response = self.session.post(
                f"{self.base_url}/tools/send_telegram_event",
                json=event,
                timeout=30
            )
            
            data = response.json()
            
            if not response.ok or data.get('error'):
                self._handle_error(data, response.status_code)
            
            return data
            
        except requests.RequestException as e:
            raise MCPError("NETWORK_ERROR", f"Network error: {str(e)}")

    def _handle_error(self, error_data: Dict, status_code: int):
        code = error_data.get('code', 'UNKNOWN_ERROR')
        message = error_data.get('message', 'Unknown error occurred')
        details = error_data.get('details', {})
        
        # Handle rate limiting with retry
        if code == 'RATE_LIMIT_EXCEEDED':
            retry_after = details.get('retry_after', 60)
            print(f"Rate limited - waiting {retry_after} seconds")
            time.sleep(retry_after)
            return  # Could retry here
        
        # Handle authentication errors
        if code == 'AUTHENTICATION_ERROR':
            raise MCPError(code, "Check API key configuration")
        
        # Handle validation errors
        if code == 'VALIDATION_ERROR':
            field = details.get('field', 'unknown')
            reason = details.get('reason', 'validation failed')
            raise MCPError(code, f"Validation error on {field}: {reason}")
        
        # Handle bridge errors
        if code == 'BRIDGE_UNAVAILABLE':
            raise MCPError(code, "Bridge service unavailable - check bridge status")
        
        raise MCPError(code, message)
```

### Retry Logic with Exponential Backoff

```typescript
class RetryHandler {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (error instanceof MCPAPIError) {
          // Don't retry certain errors
          if (this.isNonRetryableError(error.code)) {
            throw error;
          }
          
          // Handle rate limiting specially
          if (error.code === 'RATE_LIMIT_EXCEEDED') {
            const retryAfter = error.details?.retry_after || 60;
            await this.delay(retryAfter * 1000);
            continue;
          }
        }
        
        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }
        
        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await this.delay(delay);
      }
    }
    
    throw lastError;
  }
  
  private isNonRetryableError(code: string): boolean {
    return [
      'AUTHENTICATION_ERROR',
      'VALIDATION_ERROR', 
      'INVALID_EVENT_TYPE',
      'UNAUTHORIZED_TOOL'
    ].includes(code);
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

## 🔍 Troubleshooting Guide

### Common Error Scenarios

#### Authentication Issues
**Symptoms:**
- 401 responses with `AUTHENTICATION_ERROR`
- Missing or invalid API key errors

**Solutions:**
1. Verify API key in environment variables
2. Check API key format (32+ alphanumeric characters)  
3. Ensure API key is included in `X-API-Key` header
4. Verify MCP server authentication is enabled

#### Validation Failures
**Symptoms:**
- 400 responses with `VALIDATION_ERROR`
- Missing required field errors

**Solutions:**
1. Check required fields for each tool
2. Validate input against tool schemas
3. Check string length limits
4. Verify event type is valid

#### Rate Limiting
**Symptoms:**  
- 429 responses with `RATE_LIMIT_EXCEEDED`
- Temporary service unavailability

**Solutions:**
1. Implement exponential backoff retry logic
2. Respect `retry_after` values in responses
3. Monitor request patterns and reduce frequency
4. Consider request batching where possible

#### Bridge Connectivity
**Symptoms:**
- 503 responses with `BRIDGE_UNAVAILABLE`
- Timeout errors during bridge communication

**Solutions:**
1. Check bridge process status with `check_bridge_process`
2. Start bridge with `start_bridge` if not running
3. Verify bridge configuration
4. Check network connectivity and firewall rules

### Debugging Steps

#### 1. Enable Detailed Logging
```bash
# Enable debug logging
MCP_LOG_LEVEL=debug
MCP_ENABLE_SECURE_LOGGING=true
```

#### 2. Check API Response Headers
```bash
curl -v -H "X-API-Key: your_key" \
     http://localhost:8080/tools/get_bridge_status
```

#### 3. Validate Configuration
```bash
# Check environment variables
env | grep MCP_
env | grep CC_TELEGRAM_

# Test basic connectivity
curl -H "X-API-Key: $MCP_DEFAULT_API_KEY" \
     http://localhost:8080/health
```

#### 4. Monitor Server Logs
```bash
# Monitor MCP server logs
tail -f mcp-server.log | grep ERROR

# Monitor bridge logs
tail -f ~/.cc_telegram/logs/bridge.log
```

## 💡 Best Practices

### Error Handling
- **Always Check Response Status** - Check both HTTP status and response `error` field
- **Implement Proper Retry Logic** - Use exponential backoff with jitter
- **Log Errors Appropriately** - Include request IDs for troubleshooting
- **Handle Rate Limits Gracefully** - Respect retry_after values

### Validation
- **Client-Side Validation** - Validate inputs before API calls
- **Use Type Safety** - Leverage TypeScript types for compile-time validation  
- **Cache Validation Rules** - Cache event types and validation schemas
- **Provide Clear Error Messages** - Help users understand validation failures

### Monitoring
- **Track Error Rates** - Monitor API error rates and patterns
- **Set Up Alerting** - Alert on high error rates or critical errors
- **Log Request IDs** - Use request IDs for distributed tracing
- **Monitor Bridge Health** - Regular health checks for bridge connectivity

### Recovery
- **Circuit Breaker Pattern** - Prevent cascading failures
- **Graceful Degradation** - Continue operating with reduced functionality
- **Automatic Recovery** - Implement auto-recovery for transient failures
- **Manual Intervention Points** - Provide clear escalation paths

## 📊 Error Monitoring

### Error Metrics to Track

```javascript
// Example error metrics collection
class ErrorMetrics {
  constructor() {
    this.errorCounts = new Map();
    this.errorRates = new Map();
  }
  
  recordError(code, message) {
    const current = this.errorCounts.get(code) || 0;
    this.errorCounts.set(code, current + 1);
    
    console.log(`Error recorded: ${code} (${current + 1} total)`);
  }
  
  getErrorSummary() {
    return {
      total_errors: Array.from(this.errorCounts.values()).reduce((a, b) => a + b, 0),
      by_code: Object.fromEntries(this.errorCounts),
      top_errors: this.getTopErrors(5)
    };
  }
  
  getTopErrors(limit) {
    return Array.from(this.errorCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit);
  }
}
```

### Health Check Integration

```javascript
// Integrate error monitoring with health checks
async function healthCheck() {
  try {
    const status = await mcpClient.getBridgeStatus();
    return {
      healthy: status.health.overall === 'healthy',
      status: status,
      errors: errorMetrics.getErrorSummary()
    };
  } catch (error) {
    errorMetrics.recordError(error.code || 'HEALTH_CHECK_FAILED', error.message);
    return {
      healthy: false,
      error: error.message,
      errors: errorMetrics.getErrorSummary()
    };
  }
}
```
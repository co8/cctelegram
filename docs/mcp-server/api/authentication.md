# Authentication & Security

The CCTelegram MCP Server implements comprehensive security controls to protect your Telegram integration.

## 🔐 API Key Authentication

### Setup

API keys are configured via environment variables:

```bash
# Primary API key for MCP tool access
MCP_DEFAULT_API_KEY=your_secure_api_key_here

# Enable/disable authentication (default: true)
MCP_ENABLE_AUTH=true
```

### Usage

Include the API key in all requests using the `X-API-Key` header:

```bash
curl -X POST \
  -H "X-API-Key: your_secure_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from MCP!"}' \
  http://localhost:8080/tools/send_telegram_message
```

### JavaScript/TypeScript Example

```typescript
const mcpClient = {
  apiKey: 'your_secure_api_key_here',
  baseURL: 'http://localhost:8080',
  
  async sendEvent(event: any) {
    const response = await fetch(`${this.baseURL}/tools/send_telegram_event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(event)
    });
    
    return response.json();
  }
};
```

## 🛡️ Security Features

### Input Validation
All inputs are validated against JSON schemas:

- **String Length Limits** - Prevent oversized payloads
- **Pattern Matching** - Validate formats (IDs, URLs, etc.)
- **Type Checking** - Ensure correct data types
- **Property Limits** - Restrict object complexity

### Rate Limiting
Configurable rate limits prevent abuse:

```bash
# Rate limiting configuration
MCP_RATE_LIMIT_WINDOW_MS=60000    # 1 minute window
MCP_RATE_LIMIT_MAX_REQUESTS=100   # Max 100 requests per window
MCP_ENABLE_RATE_LIMIT=true        # Enable rate limiting
```

**Rate Limit Response:**
```json
{
  "error": true,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests",
  "details": {
    "limit": 100,
    "window": 60,
    "retry_after": 30
  }
}
```

### Audit Logging
All requests are logged for security monitoring:

```bash
# Enable secure audit logging
MCP_ENABLE_SECURE_LOGGING=true
MCP_LOG_LEVEL=info
```

**Log Format:**
```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "info",
  "event": "tool_request",
  "tool_name": "send_telegram_event", 
  "client_id": "client_abc123",
  "authenticated": true,
  "request_id": "req_xyz789"
}
```

### Error Sanitization
Errors are sanitized to prevent information leakage:

```json
{
  "error": true,
  "code": "INTERNAL_ERROR",
  "message": "An internal error occurred",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "request_id": "req_abc123"
}
```

## 🔒 Environment Configuration

### Required Variables
```bash
# API Authentication
MCP_DEFAULT_API_KEY=your_secure_api_key_here

# Security Settings  
MCP_ENABLE_AUTH=true
MCP_ENABLE_RATE_LIMIT=true
MCP_ENABLE_INPUT_VALIDATION=true
MCP_ENABLE_SECURE_LOGGING=true
```

### Optional Variables
```bash
# Rate Limiting
MCP_RATE_LIMIT_WINDOW_MS=60000
MCP_RATE_LIMIT_MAX_REQUESTS=100

# Logging
MCP_LOG_LEVEL=info
MCP_LOG_FORMAT=json

# Bridge Communication
CC_TELEGRAM_API_KEY=your_bridge_api_key
```

## 🚨 Error Codes

### Authentication Errors

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTHENTICATION_ERROR` | 401 | Invalid or missing API key |
| `UNAUTHORIZED_TOOL` | 403 | Tool access not permitted |
| `INVALID_API_KEY` | 401 | API key format invalid |

### Validation Errors

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `INVALID_EVENT_TYPE` | 400 | Unknown event type |
| `INVALID_PARAMETER` | 400 | Parameter format invalid |
| `MISSING_REQUIRED_FIELD` | 400 | Required field missing |

### Rate Limiting

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RATE_LIMIT_EXCEEDED` | 429 | Request rate limit exceeded |
| `TOO_MANY_REQUESTS` | 429 | Global rate limit exceeded |

### System Errors

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INTERNAL_ERROR` | 500 | Internal server error |
| `BRIDGE_UNAVAILABLE` | 503 | Bridge service unavailable |
| `TIMEOUT_ERROR` | 504 | Request timeout |

## 🎯 Security Best Practices

### API Key Management
- **Generate Strong Keys** - Use cryptographically secure random strings
- **Environment Variables** - Never hardcode keys in source code
- **Key Rotation** - Regularly rotate API keys
- **Scope Limitation** - Use different keys for different environments

### Request Security
- **HTTPS Only** - Always use encrypted connections in production
- **Input Validation** - Validate all inputs on the client side too
- **Error Handling** - Don't expose sensitive information in errors
- **Request Signing** - Consider implementing request signing for extra security

### Monitoring
- **Audit Logs** - Regularly review audit logs for suspicious activity
- **Rate Limit Monitoring** - Monitor for rate limit violations
- **Error Patterns** - Watch for unusual error patterns
- **Access Patterns** - Monitor for abnormal access patterns

### Development vs Production

#### Development
```bash
MCP_ENABLE_AUTH=false           # Optional for development
MCP_LOG_LEVEL=debug            # Verbose logging
MCP_RATE_LIMIT_MAX_REQUESTS=1000  # Higher limits
```

#### Production
```bash
MCP_ENABLE_AUTH=true           # Always required
MCP_LOG_LEVEL=warn             # Minimal logging
MCP_RATE_LIMIT_MAX_REQUESTS=100   # Strict limits
MCP_ENABLE_SECURE_LOGGING=true    # Enhanced security
```

## 🔍 Debugging Authentication Issues

### Common Problems

1. **Missing API Key**
   ```bash
   # Error: Authentication required
   curl -X POST http://localhost:8080/tools/send_telegram_message
   ```

2. **Invalid API Key Format**
   ```bash
   # Error: Invalid API key format
   curl -H "X-API-Key: invalid-key" ...
   ```

3. **Rate Limit Exceeded**
   ```bash
   # Wait for retry_after seconds before retrying
   curl -H "X-API-Key: valid-key" ... # Returns 429
   ```

### Troubleshooting Steps

1. **Verify Environment Variables**
   ```bash
   echo $MCP_DEFAULT_API_KEY
   echo $MCP_ENABLE_AUTH
   ```

2. **Check Server Logs**
   ```bash
   tail -f server.log | grep "authentication"
   ```

3. **Test with Curl**
   ```bash
   curl -v -H "X-API-Key: $MCP_DEFAULT_API_KEY" \
        http://localhost:8080/tools/get_bridge_status
   ```

4. **Validate Configuration**
   ```bash
   # Test authentication endpoint
   curl -H "X-API-Key: test" http://localhost:8080/health
   ```
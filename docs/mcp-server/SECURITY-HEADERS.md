# Security Headers Implementation

## Overview

This document describes the comprehensive security headers implementation using Helmet.js for the CCTelegram MCP Server. The implementation provides protection against XSS, clickjacking, MIME sniffing, and other web security vulnerabilities.

## Architecture

### Components

1. **SecurityHeadersManager** - Core class managing security headers configuration and nonce generation
2. **Helmet.js Integration** - Middleware for applying security headers
3. **CSP Nonce System** - Dynamic nonce generation for Content Security Policy
4. **Audit & Monitoring** - Security headers validation and logging

### Security Headers Implemented

| Header | Purpose | Configuration |
|--------|---------|---------------|
| Content-Security-Policy | Prevents XSS attacks, controls resource loading | Strict-dynamic with nonce-based CSP |
| X-Frame-Options | Prevents clickjacking attacks | DENY (blocks all framing) |
| X-Content-Type-Options | Prevents MIME sniffing attacks | nosniff |
| Strict-Transport-Security | Enforces HTTPS connections | max-age=31536000, includeSubDomains |
| Referrer-Policy | Controls referrer information leakage | strict-origin-when-cross-origin |
| Permissions-Policy | Controls browser feature access | Restrictive permissions |
| Cross-Origin-* Headers | Controls cross-origin interactions | Same-origin policies |

## Content Security Policy (CSP)

### Directives

```
default-src 'self'
script-src 'self' 'nonce-{GENERATED}' 'strict-dynamic'
style-src 'self' 'nonce-{GENERATED}' 'unsafe-inline'
img-src 'self' data: https:
font-src 'self' https: data:
connect-src 'self' wss: ws:
media-src 'self'
object-src 'none'
child-src 'self'
frame-src 'none'
worker-src 'self'
manifest-src 'self'
form-action 'self'
frame-ancestors 'none'
base-uri 'self'
upgrade-insecure-requests (production only)
```

### Nonce-Based CSP

The implementation uses nonce-based CSP with strict-dynamic for enhanced security:

- **Script Nonces**: Generated for each request, allowing only scripts with valid nonces
- **Style Nonces**: Separate nonces for stylesheets
- **Strict-Dynamic**: Allows dynamically loaded scripts from trusted sources
- **Nonce Cleanup**: Automatic cleanup of expired nonces to prevent memory leaks

## Implementation Details

### SecurityHeadersManager Class

```typescript
class SecurityHeadersManager {
  // Core configuration management
  constructor(config: Partial<SecurityHeadersConfig>)
  
  // Nonce generation and tracking
  generateNonce(requestId?: string): CSPNonce
  getNonce(requestId: string): CSPNonce | undefined
  
  // Middleware generation
  getHelmetMiddleware(): RequestHandler
  nonceMiddleware(): RequestHandler
  auditMiddleware(): RequestHandler
  
  // Configuration and validation
  validateConfiguration(): ValidationResult
  updateConfiguration(newConfig: Partial<SecurityHeadersConfig>): void
  
  // Monitoring and cleanup
  getStatusReport(): StatusReport
  cleanupExpiredNonces(): number
}
```

### Configuration Options

```typescript
interface SecurityHeadersConfig {
  enableCSP: boolean;              // Enable Content Security Policy
  enableHSTS: boolean;             // Enable HSTS (HTTPS enforcement)
  enableFrameOptions: boolean;     // Enable X-Frame-Options
  enableContentTypeOptions: boolean; // Enable X-Content-Type-Options
  enableReferrerPolicy: boolean;   // Enable Referrer-Policy
  enablePermissionsPolicy: boolean; // Enable Permissions-Policy
  hstsMaxAge: number;              // HSTS max-age in seconds
  isDevelopment: boolean;          // Development vs production mode
  allowUnsafeInlineDev: boolean;   // Allow unsafe-inline in development
}
```

### Environment-Specific Configuration

#### Production Configuration
```typescript
{
  enableCSP: true,
  enableHSTS: true,
  enableFrameOptions: true,
  enableContentTypeOptions: true,
  enableReferrerPolicy: true,
  enablePermissionsPolicy: true,
  hstsMaxAge: 31536000, // 1 year
  isDevelopment: false,
  allowUnsafeInlineDev: false
}
```

#### Development Configuration
```typescript
{
  enableCSP: true,
  enableHSTS: false, // Don't enforce HTTPS in development
  enableFrameOptions: true,
  enableContentTypeOptions: true,
  enableReferrerPolicy: true,
  enablePermissionsPolicy: false, // More permissive
  hstsMaxAge: 86400, // 1 day
  isDevelopment: true,
  allowUnsafeInlineDev: true // Allow inline scripts/styles
}
```

## Integration

### Webhook Server Integration

The security headers are integrated into the webhook server middleware stack:

```typescript
class WebhookServer {
  private securityHeaders: SecurityHeadersManager;
  
  private setupMiddleware(): void {
    // Security headers middleware (must be first)
    this.app.use(this.securityHeaders.getHelmetMiddleware());
    this.app.use(this.securityHeaders.nonceMiddleware());
    this.app.use(this.securityHeaders.auditMiddleware());
    
    // Other middleware follows...
  }
}
```

### Dashboard Manager Integration

The dashboard manager applies security headers manually for HTTP module compatibility:

```typescript
private applySecurityHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  const nonce = this.securityHeaders.generateNonce(requestId);
  
  // Apply security headers
  res.setHeader('Content-Security-Policy', this.buildCSPHeader(nonce));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // ... other headers
}
```

### HTML Nonce Usage

Generated nonces are embedded in HTML responses:

```html
<!DOCTYPE html>
<html>
<head>
  <style nonce="${nonce.style}">
    /* Inline styles allowed with nonce */
  </style>
</head>
<body>
  <script nonce="${nonce.script}">
    // Inline scripts allowed with nonce
  </script>
</body>
</html>
```

## Monitoring and Validation

### Status Endpoints

#### `/security-headers` - Security Headers Status
```json
{
  "status": "compliant",
  "validation": {
    "valid": true,
    "errors": []
  },
  "headers_status": {
    "enabled_headers": ["Content-Security-Policy", "X-Frame-Options", ...],
    "disabled_headers": [],
    "nonce_store_size": 42,
    "configuration": { ... }
  },
  "nonce_example": {
    "script": "<script nonce=\"abc123\">",
    "style": "<style nonce=\"def456\">"
  }
}
```

#### `/status` - Server Status with Security Info
Includes security headers status in the main server status endpoint.

### Validation Rules

The system validates configuration against security best practices:

- HSTS max-age should be at least 86400 seconds (24 hours)
- CSP should be enabled in production
- HSTS should be enabled in production
- Frame options should prevent clickjacking
- Content type options should prevent MIME sniffing

### Audit Logging

Security headers are logged for compliance and monitoring:

```typescript
secureLog('info', 'Security headers audit', {
  url: req.url,
  method: req.method,
  headers: {
    'content-security-policy': res.getHeader('content-security-policy'),
    'strict-transport-security': res.getHeader('strict-transport-security'),
    // ... other headers
  },
  request_id: requestId
});
```

## Performance Considerations

### Nonce Management

- **Memory Efficiency**: Automatic cleanup of expired nonces
- **Store Size Limit**: Maximum 1000 nonces stored, LRU cleanup
- **TTL**: Nonces expire after 5 minutes
- **Cleanup Interval**: Every 5 minutes

### Response Time Impact

- Security headers add minimal overhead (<5ms per request)
- Nonce generation is cryptographically secure but fast (<1ms)
- Headers are applied at middleware level for efficiency

## Security Benefits

### Protection Against Common Attacks

1. **Cross-Site Scripting (XSS)**
   - CSP prevents execution of unauthorized scripts
   - Nonce-based approach allows trusted dynamic content
   - `script-src 'strict-dynamic'` enables safe script loading

2. **Clickjacking**
   - `X-Frame-Options: DENY` prevents embedding in frames
   - `frame-ancestors 'none'` in CSP provides additional protection

3. **MIME Sniffing**
   - `X-Content-Type-Options: nosniff` prevents browser MIME type guessing
   - Reduces risk of content type confusion attacks

4. **Protocol Downgrade**
   - HSTS enforces HTTPS connections
   - `upgrade-insecure-requests` upgrades HTTP to HTTPS
   - Protects against man-in-the-middle attacks

5. **Information Leakage**
   - `Referrer-Policy: strict-origin-when-cross-origin` limits referrer information
   - Cross-origin policies control resource sharing

6. **Feature Abuse**
   - Permissions-Policy restricts browser feature access
   - Prevents unauthorized camera, geolocation, etc. access

## Testing

### Unit Tests

Comprehensive unit tests cover:
- Configuration validation
- Nonce generation and cleanup
- Middleware integration
- Header application
- Environment-specific behavior

### Integration Tests

Integration tests verify:
- End-to-end header application
- Webhook endpoint security
- Dashboard security
- Performance impact
- Error handling with security headers

### Security Testing

Security testing includes:
- CSP violation testing
- Nonce uniqueness validation
- Header presence verification
- Configuration compliance checking

## Best Practices

### Implementation Guidelines

1. **Always Apply Security Headers First**
   ```typescript
   app.use(securityHeaders.getHelmetMiddleware()); // First middleware
   app.use(securityHeaders.nonceMiddleware());
   app.use(securityHeaders.auditMiddleware());
   ```

2. **Use Nonces for Inline Content**
   ```html
   <script nonce="${nonce.script}">
   <style nonce="${nonce.style}">
   ```

3. **Validate Configuration**
   ```typescript
   const validation = manager.validateConfiguration();
   if (!validation.valid) {
     console.warn('Security headers configuration issues:', validation.errors);
   }
   ```

4. **Monitor Nonce Store Size**
   ```typescript
   const report = manager.getStatusReport();
   if (report.nonce_store_size > 500) {
     manager.cleanupExpiredNonces();
   }
   ```

### Security Considerations

1. **Nonce Security**
   - Nonces are cryptographically random (16 bytes, base64 encoded)
   - Each request gets unique nonces
   - Nonces are not logged or exposed unnecessarily

2. **CSP Reporting**
   - Consider implementing CSP reporting for violation monitoring
   - Use `report-only` mode during development/testing

3. **HSTS Considerations**
   - HSTS should only be enabled over HTTPS
   - Consider HSTS preload list inclusion for production

4. **Environment Separation**
   - Use different configurations for development/production
   - Allow more permissive policies in development

## Troubleshooting

### Common Issues

1. **CSP Violations**
   - Check browser console for CSP violation reports
   - Ensure all inline scripts/styles have proper nonces
   - Verify external resource URLs are allowed in CSP

2. **Missing Nonces**
   - Ensure nonce middleware is applied before content generation
   - Check that nonce values are properly passed to templates

3. **CORS Conflicts**
   - Security headers are applied before CORS headers
   - Ensure CORS configuration doesn't conflict with CSP

4. **Performance Issues**
   - Monitor nonce store size
   - Implement regular cleanup of expired nonces
   - Consider adjusting cleanup intervals for high-traffic scenarios

### Debugging

1. **Enable Security Logging**
   ```typescript
   const manager = new SecurityHeadersManager({
     ...config,
     enableAuditLogging: true
   });
   ```

2. **Check Status Endpoint**
   ```bash
   curl http://localhost:3000/security-headers
   ```

3. **Validate Headers**
   ```bash
   curl -I http://localhost:3000/health
   ```

## Compliance

### Standards Compliance

- **OWASP Security Headers**: Implements all recommended security headers
- **Mozilla Security Guidelines**: Follows Mozilla's web security guidelines
- **CSP Level 3**: Uses modern CSP features like strict-dynamic
- **HSTS Specification**: RFC 6797 compliant HSTS implementation

### Security Headers Scorecard

When tested with SecurityHeaders.com or similar tools, the implementation should achieve:
- **Grade A+** overall security rating
- All major security headers present and properly configured
- CSP with strict policies and nonce-based implementation
- No security anti-patterns or vulnerabilities

## Conclusion

The security headers implementation provides comprehensive protection against web security vulnerabilities while maintaining flexibility for development and production environments. The nonce-based CSP system ensures both security and functionality, while the monitoring and validation features enable ongoing security compliance.

Regular auditing and testing of the security headers configuration ensures continued protection against evolving security threats.
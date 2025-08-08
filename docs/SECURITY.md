# CCTelegram Security Guide

**Comprehensive security policy and deployment hardening guide**

**For**: Security teams, operators, and production deployments

---

## 🔒 Security Policy

### **Supported Versions**
| Component | Version | Security Support |
|-----------|---------|------------------|
| Bridge | v0.9.x | ✅ Active support |
| MCP Server | v1.9.x | ✅ Active support |
| Bridge | v0.8.x | ⚠️ Security fixes only |
| MCP Server | v1.8.x | ⚠️ Security fixes only |
| Bridge | < v0.8.0 | ❌ No support |
| MCP Server | < v1.8.0 | ❌ No support |

### **Security Update Schedule**
- **Critical vulnerabilities**: Patches within 24-48 hours
- **High severity**: Patches within 1 week
- **Medium severity**: Patches in next minor release
- **Low severity**: Patches in next major release

---

## 🚨 Vulnerability Reporting

### **Responsible Disclosure Process**

**DO NOT** create public GitHub issues for security vulnerabilities.

**Report security issues privately:**
1. **Email**: security@cctelegram.dev (preferred)
2. **GitHub**: [Private security advisory](https://github.com/co8/cctelegram/security/advisories/new)
3. **Encrypted**: GPG key available on request

### **Report Should Include**
- **Description**: Detailed vulnerability description
- **Impact**: Potential security impact and affected versions
- **Reproduction**: Step-by-step reproduction instructions
- **Fix**: Suggested fix if available
- **Disclosure**: Preferred disclosure timeline

### **Response Timeline**
- **24 hours**: Acknowledgment of report
- **72 hours**: Initial assessment and severity classification
- **1 week**: Regular updates on investigation progress  
- **Resolution**: Coordinated disclosure after fix is available

### **Security Researchers**
- **Acknowledgment**: Public recognition in security advisories (optional)
- **Coordination**: Work with maintainers on responsible disclosure
- **Timeline**: Reasonable disclosure timeline (typically 90 days)

---

## 🛡️ Security Architecture

### **Threat Model**
**Assets Protected:**
- Bot tokens and API keys
- User message content and metadata
- Bridge-MCP communication channel
- System configuration and logs

**Attack Vectors:**
- **Network**: Man-in-the-middle, API interception
- **System**: Local file access, process injection  
- **Application**: Input validation, injection attacks
- **Social**: Token compromise, social engineering

### **Security Boundaries**
```
User Environment ──TLS──> Telegram API ──HTTPS──> CCTelegram
                                                      │
                                                      ├─ MCP Server (sandbox)
                                                      └─ Bridge (isolated process)
```

**Trust Boundaries:**
- **MCP Server**: Trusts Claude Code via MCP protocol
- **Bridge**: Trusts MCP Server via filesystem events
- **Telegram API**: External service, validate all responses

---

## 🔐 Bot Security

### **Token Security**
```bash
# ✅ Secure token storage
echo "TELEGRAM_BOT_TOKEN=your_token_here" > ~/.cc_telegram/.env
chmod 600 ~/.cc_telegram/.env

# ❌ Insecure practices to avoid
export TELEGRAM_BOT_TOKEN="your_token"  # Environment visible to all processes
git add .env  # Never commit tokens to version control
```

**Token Rotation:**
```bash
# 1. Generate new token from @BotFather
# 2. Update configuration atomically
cp ~/.cc_telegram/.env ~/.cc_telegram/.env.backup
echo "TELEGRAM_BOT_TOKEN=new_token_here" > ~/.cc_telegram/.env.new
mv ~/.cc_telegram/.env.new ~/.cc_telegram/.env

# 3. Restart services with zero downtime
cctelegram --restart
```

### **Bot Permissions**
**Configure minimal bot permissions with @BotFather:**
```
/mybots → Select your bot → Bot Settings → Group Privacy → Disable

Enabled permissions:
✅ Send messages
✅ Receive messages  
✅ Edit messages
❌ Add bot to groups (unless needed)
❌ Admin rights (unless needed)
❌ Inline mode (unless needed)
```

### **User Access Control**
```bash
# Restrict bot access to specific users (optional)
export CC_TELEGRAM_ALLOWED_USERS=123456789,987654321

# Whitelist approach - only specified users can interact
# Leave empty to allow all users (default)
```

---

## 🌐 Network Security

### **Communication Encryption**
- **Telegram API**: TLS 1.3 enforced (443/tcp)
- **MCP Protocol**: Local IPC (no network exposure)
- **Bridge-MCP**: Filesystem-based (local only)
- **Health endpoint**: HTTP on localhost only (configurable)

### **Firewall Configuration**
```bash
# Minimal required connectivity
# Outbound only - no inbound ports needed

# Allow HTTPS to Telegram API
iptables -A OUTPUT -d api.telegram.org -p tcp --dport 443 -j ACCEPT

# Block all other outbound (if using strict firewall)
iptables -A OUTPUT -j DROP

# Optional: Health check port (localhost only)  
iptables -A INPUT -s 127.0.0.1 -p tcp --dport 8080 -j ACCEPT
```

### **Network Monitoring**
```bash
# Monitor Telegram API connections
netstat -an | grep 443 | grep api.telegram.org

# Monitor localhost health port
netstat -tln | grep :8080

# Network traffic analysis
tcpdump -i any -n host api.telegram.org
```

---

## 💾 Data Protection

### **Data Classification**
| Data Type | Classification | Retention | Encryption |
|-----------|----------------|-----------|------------|
| Bot tokens | Secret | Indefinite | At rest |
| User messages | Confidential | 24 hours | In transit |
| Event files | Internal | Auto-cleanup | Filesystem |
| Log files | Internal | 7 days | Optional |
| Configuration | Internal | Backup only | Recommended |

### **Data Storage Security**
```bash
# Event files (temporary storage)
# Automatically cleaned up after processing
# Located: ~/.cc_telegram/events/

# Secure permissions
chmod 700 ~/.cc_telegram
chmod 600 ~/.cc_telegram/.env
chmod 700 ~/.cc_telegram/events

# Filesystem encryption (recommended)
# Use full-disk encryption (FileVault, LUKS, BitLocker)
```

### **Data Minimization**
- **Event files**: Contain only necessary message data
- **Logs**: Configurable verbosity, no sensitive data in INFO level
- **Retention**: Automatic cleanup of processed events
- **Metadata**: Minimal user metadata stored

### **GDPR Compliance**
```bash
# Data subject rights implementation

# 1. Right to access - export user data
curl -s "https://api.telegram.org/bot<TOKEN>/getChat?chat_id=<USER_ID>"

# 2. Right to deletion - remove user data  
# User data is automatically removed after processing
# No persistent user data storage

# 3. Right to portability - data export
# User can export their Telegram chat history directly
```

---

## 🏭 Production Security

### **Deployment Hardening**
```bash
# 1. Dedicated user account
useradd -r -s /bin/false cctelegram
usermod -L cctelegram  # Lock account

# 2. Minimal file permissions
chown -R cctelegram:cctelegram ~/.cc_telegram
chmod 700 ~/.cc_telegram
chmod 600 ~/.cc_telegram/.env

# 3. Process isolation
# Run bridge with limited capabilities
setcap 'cap_net_bind_service=+ep' /usr/local/bin/cctelegram

# 4. Resource limits
cat > /etc/systemd/system/cctelegram.service << 'EOF'
[Unit]
Description=CCTelegram Bridge
After=network.target

[Service]
Type=simple
User=cctelegram
ExecStart=/usr/local/bin/cctelegram --start
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/home/cctelegram/.cc_telegram

# Resource limits
LimitNOFILE=1024
LimitNPROC=100
LimitMEMLOCK=64K

[Install]
WantedBy=multi-user.target
EOF
```

### **Security Monitoring**
```bash
# Log security events
export RUST_LOG=warn  # Reduce log noise
export CC_TELEGRAM_SECURITY_LOG=true

# Monitor for suspicious activity
tail -f ~/.cc_telegram/security.log | grep -E "(failed|error|unauthorized)"

# Rate limiting monitoring  
grep "Rate limited" ~/.cc_telegram/bridge.log | tail -10

# Failed authentication attempts
grep "401 Unauthorized" ~/.cc_telegram/bridge.log
```

### **Backup Security**
```bash
# Secure configuration backup
tar -czf cctelegram-config-$(date +%Y%m%d).tar.gz ~/.cc_telegram/
gpg --symmetric --cipher-algo AES256 cctelegram-config-*.tar.gz
rm cctelegram-config-*.tar.gz  # Keep only encrypted version

# Disaster recovery procedure
# 1. Restore encrypted backup
# 2. Generate new bot token (security best practice)
# 3. Update configuration with new token
# 4. Test functionality
```

---

## 🚦 Security Configuration

### **Security-First Configuration**
```bash
# Production security settings
cat > ~/.cc_telegram/.env << 'EOF'
# Basic configuration
TELEGRAM_BOT_TOKEN=your_production_token_here
CC_TELEGRAM_MODE=local

# Security settings
CC_TELEGRAM_RATE_LIMIT_STRICT=true
CC_TELEGRAM_VALIDATE_EVENTS=true
CC_TELEGRAM_ENCRYPT_MESSAGES=false  # Enable if handling sensitive data

# Access control (optional - whitelist specific users)
# CC_TELEGRAM_ALLOWED_USERS=123456789,987654321

# Logging (security-focused)
RUST_LOG=warn
CC_TELEGRAM_SECURITY_LOG=true

# Resource limits
MAX_QUEUE_SIZE=100
RATE_LIMIT_PER_MINUTE=20  # Conservative rate limiting
MEMORY_LIMIT_MB=256
CONNECTION_POOL_SIZE=5

# Monitoring
HEALTH_PORT=8080  # Localhost only
EVENT_TTL_HOURS=1  # Quick cleanup
EOF

chmod 600 ~/.cc_telegram/.env
```

### **Security Validation**
```bash
# Security configuration check
./scripts/security-check.sh

# Expected checks:
# ✅ File permissions correct
# ✅ Bot token format valid
# ✅ Rate limiting enabled
# ✅ Event validation enabled
# ✅ Log level appropriate
# ✅ Resource limits configured
# ✅ Health endpoint secure
```

---

## 🔍 Security Testing

### **Security Test Suite**
```bash
# MCP Server security tests
cd mcp-server
npm run test:security

# Bridge security tests  
cd bridge
cargo test security_

# Integration security tests
./scripts/test-security-integration.sh
```

### **Security Checklist**
- [ ] **Input validation**: All MCP inputs validated
- [ ] **Rate limiting**: Telegram API rate limits enforced
- [ ] **Authentication**: Bot token validation implemented  
- [ ] **Authorization**: User access controls (if configured)
- [ ] **Encryption**: TLS for all external communications
- [ ] **Logging**: Security events logged appropriately
- [ ] **Error handling**: No sensitive data in error messages
- [ ] **Resource limits**: Protection against resource exhaustion
- [ ] **File permissions**: Restrictive permissions on config files
- [ ] **Process isolation**: Services run with minimal privileges

---

## 📋 Compliance

### **Security Standards**
- **OWASP**: Web Application Security guidelines followed
- **NIST**: Cybersecurity Framework alignment  
- **ISO 27001**: Information security management principles
- **SOC 2**: Security, availability, and confidentiality controls

### **Audit Trail**
```bash
# Security audit log format
{
  "timestamp": "2025-08-08T20:30:00Z",
  "event": "authentication_failure", 
  "source_ip": "192.168.1.100",
  "user_id": "123456789",
  "details": "Invalid bot token provided",
  "action_taken": "Request blocked"
}
```

### **Third-Party Dependencies**
- **Vulnerability scanning**: Regular security audits of dependencies
- **License compliance**: All dependencies use compatible licenses
- **Supply chain**: Dependencies from trusted sources only
- **Updates**: Security updates applied within 30 days

---

## 🚨 Incident Response

### **Security Incident Classification**
- **P0 Critical**: Token compromise, remote code execution
- **P1 High**: Unauthorized access, data breach  
- **P2 Medium**: Privilege escalation, injection attacks
- **P3 Low**: Information disclosure, denial of service

### **Incident Response Steps**
1. **Immediate**: Isolate affected systems, revoke compromised tokens
2. **Assessment**: Determine scope and impact of security incident
3. **Containment**: Prevent further damage, preserve evidence
4. **Recovery**: Restore services with enhanced security measures
5. **Lessons**: Post-incident review and security improvements

### **Emergency Contacts**
- **Security team**: security@cctelegram.dev
- **Maintainers**: Available via GitHub issues (for urgent security matters)
- **Community**: Discord security channel (for general security questions)

---

**Security Guide Complete** • **Defense in Depth** • **Production Hardened** • **Compliance Ready**

*Security is everyone's responsibility. Report vulnerabilities responsibly and follow security best practices.*
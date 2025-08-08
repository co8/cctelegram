# Contributing to CCTelegram

**Complete developer guide for contributing to the dual-component architecture**

**For**: Developers who want to enhance, fix, or extend CCTelegram

---

## 🎯 Quick Start for Contributors

### **What You Can Contribute**
- **🐛 Bug fixes**: Both Bridge (Rust) and MCP Server (TypeScript) 
- **✨ New features**: Additional MCP tools, event types, performance optimizations
- **📚 Documentation**: Improvements to these 6 core documentation files
- **🧪 Testing**: Unit tests, integration tests, performance tests
- **🔧 Tooling**: Development scripts, CI/CD improvements

### **Contribution Complexity**
- **🟢 Easy**: Documentation, simple bug fixes, new event types
- **🟡 Medium**: New MCP tools, configuration options, error handling
- **🔴 Hard**: Bridge performance optimization, architecture changes

**Ready to contribute?** → Jump to **[Development Setup](#development-setup)** below

---

## 🏗️ Architecture Overview

### **Dual-Component Design**
```
Claude Code ──MCP──> MCP Server ──Events──> Rust Bridge ──API──> Telegram
    (User)         (TypeScript)            (Rust Engine)       (Delivery)
```

**Why Two Components?**
- **MCP Server**: Rich integration with Claude Code (20+ tools, complex data handling)
- **Bridge**: High-performance message processing (51,390 ops/sec, reliability)

### **Component Responsibilities**

#### **MCP Server (TypeScript)**
- **Location**: `/mcp-server/`
- **Purpose**: Claude Code integration via MCP protocol
- **Key Files**:
  - `src/index.ts` - Main MCP server entry point
  - `src/tools/` - Individual tool implementations  
  - `src/events/` - Event type definitions
  - `src/bridge/` - Bridge communication logic

#### **Rust Bridge (Rust)**
- **Location**: `/bridge/`  
- **Purpose**: High-performance Telegram message processing
- **Key Files**:
  - `src/main.rs` - Bridge entry point and CLI
  - `src/telegram/` - Telegram API integration
  - `src/events/` - Event processing pipeline
  - `src/queue/` - Message queue and retry logic

### **Communication Flow**
1. **Claude Code** → **MCP Tool Call** → **MCP Server** 
2. **MCP Server** → **Creates Event File** → **`~/.cc_telegram/events/`**
3. **Bridge** → **Watches Event Directory** → **Processes Events**  
4. **Bridge** → **Telegram API** → **Message Delivered**

---

## 🛠️ Development Setup

### **Prerequisites**
```bash
# Required tools
node --version    # v20+ required
rustc --version   # v1.70+ required  
git --version     # v2.20+ required

# Development tools
npm install -g tsx typescript
cargo install cargo-watch
```

### **Repository Setup**
```bash
# 1. Fork repository on GitHub
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/cctelegram.git
cd cctelegram

# 3. Add upstream remote
git remote add upstream https://github.com/co8/cctelegram.git

# 4. Create development branch  
git checkout -b feature/your-feature-name
```

### **MCP Server Development Setup**
```bash
# 1. Install dependencies
cd mcp-server
npm install

# 2. Build TypeScript
npm run build

# 3. Run in development mode
npm run dev

# 4. Test MCP server
npm test
```

### **Bridge Development Setup**
```bash
# 1. Build in development mode
cd bridge
cargo build

# 2. Run tests
cargo test

# 3. Run with hot reload
cargo watch -x run

# 4. Performance testing
cargo build --release
cargo bench
```

### **Integration Testing Setup**
```bash
# 1. Set up test environment
cp .env.example .env.test
# Edit .env.test with test bot token

# 2. Start test services
docker-compose -f docker-compose.test.yml up -d

# 3. Run full integration test
./scripts/test-integration.sh
```

---

## 🧪 Testing Strategy

### **MCP Server Testing**
```bash
# Unit tests
npm run test:unit

# Integration tests  
npm run test:integration

# Performance tests
npm run test:performance

# Security tests
npm run test:security

# Full test suite with coverage
npm run test:coverage
```

**Test Structure**:
- `tests/unit/` - Individual function/class tests
- `tests/integration/` - MCP protocol integration tests
- `tests/performance/` - Throughput and latency tests
- `tests/security/` - Input validation and security tests

### **Bridge Testing**
```bash
# Unit tests
cargo test

# Integration tests
cargo test --test integration_*

# Performance benchmarks
cargo bench

# Security audit
cargo audit
```

**Test Structure**:
- `tests/unit/` - Core logic tests
- `tests/integration/` - Telegram API integration
- `benches/` - Performance benchmarks
- `tests/security/` - Security validation

### **End-to-End Testing**
```bash
# Full system test
./scripts/e2e-test.sh

# Manual testing checklist
# 1. MCP tool calls work in Claude Code
# 2. Events appear in ~/.cc_telegram/events/
# 3. Bridge processes events correctly  
# 4. Telegram messages delivered
# 5. Interactive workflows function
```

---

## 📝 Code Standards

### **TypeScript Standards (MCP Server)**
```typescript
// File naming: kebab-case.ts
// Class naming: PascalCase  
// Function naming: camelCase
// Constants: SCREAMING_SNAKE_CASE

// Example structure
export class TelegramEventProcessor {
  private readonly eventQueue: EventQueue;
  
  public async processEvent(event: TelegramEvent): Promise<ProcessResult> {
    // Implementation with proper error handling
    try {
      return await this.handleEvent(event);
    } catch (error) {
      logger.error('Event processing failed', { event, error });
      throw new ProcessingError('Failed to process event', error);
    }
  }
}
```

**TypeScript Requirements**:
- **Strict typing**: No `any` types without justification
- **Error handling**: All async operations in try/catch
- **Logging**: Structured logging with context
- **Documentation**: JSDoc comments for public APIs
- **Testing**: Minimum 90% coverage for new code

### **Rust Standards (Bridge)**
```rust
// File naming: snake_case.rs
// Struct naming: PascalCase
// Function naming: snake_case
// Constants: SCREAMING_SNAKE_CASE

// Example structure  
pub struct TelegramBridge {
    event_processor: EventProcessor,
    rate_limiter: RateLimiter,
}

impl TelegramBridge {
    pub async fn process_event(&self, event: Event) -> Result<(), BridgeError> {
        // Implementation with proper error handling
        self.rate_limiter.check().await?;
        self.event_processor.process(event).await?;
        Ok(())
    }
}
```

**Rust Requirements**:
- **Error handling**: Proper `Result<T, E>` usage throughout
- **Performance**: No unnecessary allocations in hot paths
- **Safety**: No unsafe code without extensive documentation
- **Documentation**: Rust doc comments with examples
- **Testing**: Unit tests for all public functions

### **Git Workflow**
```bash
# Commit message format
<type>(<scope>): <description>

# Types: feat, fix, docs, style, refactor, test, chore
# Scopes: mcp, bridge, docs, tests, ci

# Examples:
feat(mcp): add interactive approval request tool
fix(bridge): resolve race condition in event processing  
docs: improve installation guide clarity
test(mcp): add performance tests for event processing
```

---

## 🔄 Pull Request Process

### **Before Submitting PR**
```bash
# 1. Ensure all tests pass
cd mcp-server && npm test
cd ../bridge && cargo test

# 2. Run linting
cd mcp-server && npm run lint
cd ../bridge && cargo clippy

# 3. Check formatting
cd mcp-server && npm run format:check
cd ../bridge && cargo fmt -- --check

# 4. Update documentation if needed
# Edit relevant files in docs/

# 5. Test integration manually
./scripts/test-integration.sh
```

### **PR Requirements**
- **✅ Descriptive title**: Clear, concise description of change
- **✅ Detailed description**: Problem solved, approach taken, testing done  
- **✅ Tests included**: Unit tests for new features, regression tests for fixes
- **✅ Documentation updated**: Update relevant documentation files
- **✅ Performance impact**: Note any performance implications
- **✅ Breaking changes**: Clearly document any breaking changes

### **PR Template**
```markdown
## Description
Brief description of changes and why they're needed.

## Type of Change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance improvement

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass  
- [ ] Manual testing completed
- [ ] Performance impact assessed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed  
- [ ] Comments added to hard-to-understand areas
- [ ] Documentation updated
- [ ] No new warnings introduced
```

### **Review Process**
1. **Automated checks**: CI runs tests, linting, security scans
2. **Code review**: Maintainer reviews code quality and approach
3. **Testing**: Manual testing of new functionality
4. **Merge**: Squash and merge after approval

---

## 🚀 Release Process

### **Version Management**
- **MCP Server**: Semantic versioning (currently v1.9.0)
- **Bridge**: Matches project version (currently v0.9.0) 
- **Documentation**: No independent versioning
- **Breaking changes**: Major version bump required

### **Release Checklist**
```bash
# 1. Update version numbers
vim mcp-server/package.json    # Update version
vim bridge/Cargo.toml         # Update version  
vim package.json              # Update project version

# 2. Run full test suite
npm run test:all
cargo test --all

# 3. Update CHANGELOG.md
# Document all changes since last release

# 4. Create release PR
git checkout -b release/v0.10.0
git commit -am "chore: prepare release v0.10.0"
gh pr create --title "Release v0.10.0" --body "Release preparation"

# 5. After merge, create release tag
git tag -a v0.10.0 -m "Release v0.10.0"  
git push origin v0.10.0
```

### **Release Artifacts**
- **NPM Package**: MCP server published to npm
- **Cargo Crate**: Bridge published to crates.io
- **GitHub Release**: Binaries for major platforms
- **Docker Images**: Updated container images

---

## 🎯 Contribution Ideas

### **High-Impact Contributions**
- **🔥 New MCP Tools**: `send_code_review`, `send_deployment_status`
- **⚡ Performance**: Bridge optimization, memory usage reduction
- **🛡️ Security**: Input validation, rate limiting improvements
- **🧪 Testing**: Chaos engineering tests, load testing
- **📱 Mobile**: Better mobile notification formatting

### **Good First Issues**
- **📚 Documentation**: Fix typos, improve examples
- **🎨 Event Types**: Add new event types with schemas
- **🔧 Configuration**: Additional environment variables
- **🚨 Error Messages**: More descriptive error messages
- **📊 Metrics**: Additional performance metrics

### **Advanced Projects**
- **🔄 Clustering**: Multi-instance bridge deployment
- **📈 Analytics**: Usage analytics and insights
- **🌐 Internationalization**: Multi-language support
- **🔌 Plugin System**: Extensible architecture
- **☁️ Cloud Integration**: AWS/GCP deployment options

---

## 📚 Development Resources

### **Key Documentation**
- **[MCP Protocol Specification](https://spec.modelcontextprotocol.io/)**
- **[Telegram Bot API](https://core.telegram.org/bots/api)**
- **[Rust Async Book](https://rust-lang.github.io/async-book/)**
- **[TypeScript Handbook](https://www.typescriptlang.org/docs/)**

### **Project-Specific Resources**
- **Architecture Decision Records**: `/docs/adr/`
- **Performance Baselines**: `/benchmarks/`
- **Integration Examples**: `/examples/`
- **Development Scripts**: `/scripts/`

### **Communication Channels**
- **💬 Discussions**: [GitHub Discussions](https://github.com/co8/cctelegram/discussions)
- **🐛 Issues**: [GitHub Issues](https://github.com/co8/cctelegram/issues)  
- **📧 Maintainers**: Available via GitHub for questions

---

## 🤝 Code of Conduct

### **Our Standards**
- **Respectful**: Be kind and respectful in all interactions
- **Inclusive**: Welcome contributors from all backgrounds  
- **Constructive**: Provide helpful, constructive feedback
- **Professional**: Maintain professional communication standards
- **Collaborative**: Work together toward common goals

### **Unacceptable Behavior**
- Harassment, discrimination, or exclusionary behavior
- Personal attacks or inflammatory comments
- Publishing private information without consent
- Commercial spam or off-topic promotion
- Any conduct that creates an unwelcoming environment

---

## 🎉 Recognition

### **Contributor Recognition**
- **Contributors list**: README.md acknowledgments
- **Release notes**: Credit in release announcements  
- **Discord role**: Special contributor role in community Discord
- **Reference**: LinkedIn recommendation for significant contributions

### **Contribution Types Recognized**
- **Code**: Bug fixes, features, performance improvements
- **Documentation**: Writing, editing, translation
- **Testing**: Test creation, bug reporting, QA
- **Community**: Helping users, answering questions
- **Design**: UI/UX improvements, visual assets

---

**Contributing Guide Complete** • **Welcome All Skill Levels** • **High-Impact Opportunities Available**

*Ready to contribute? Start with a [good first issue](https://github.com/co8/cctelegram/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) and join our community of contributors!*
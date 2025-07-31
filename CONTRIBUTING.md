# Contributing to CC Telegram Bridge

Thank you for your interest in contributing to CC Telegram Bridge! This document provides guidelines and information for contributors.

## 🤝 Ways to Contribute

- **Bug Reports**: Help us identify and fix issues
- **Feature Requests**: Suggest new functionality
- **Code Contributions**: Submit bug fixes and enhancements
- **Documentation**: Improve guides, examples, and API docs
- **Testing**: Help expand test coverage
- **Performance**: Optimize and benchmark improvements

## 🚀 Getting Started

### Prerequisites
- **Rust 1.70+** - [Install Rust](https://rustup.rs/)
- **Git** for version control
- **Telegram Bot Token** for testing
- **Basic understanding** of Rust and async programming

### Development Setup
```bash
# Fork and clone the repository
git clone https://github.com/yourusername/cc-telegram.git
cd cc-telegram

# Install development tools
rustup component add clippy rustfmt

# Build and test
cargo build
cargo test

# Run lints
cargo clippy
cargo fmt --check
```

## 📝 Development Guidelines

### Code Style
- **Format**: Use `cargo fmt` for consistent formatting
- **Linting**: Ensure `cargo clippy` passes without warnings
- **Documentation**: Document public APIs with rustdoc comments
- **Comments**: Use `//` for code comments, avoid obvious comments
- **Error Handling**: Use `anyhow::Result` for error propagation

### Rust Best Practices
```rust
// ✅ Good: Clear error context and proper types
pub async fn process_event(&self, event: &Event) -> anyhow::Result<()> {
    self.validate_event(event)
        .context("Failed to validate event")?;
    Ok(())
}

// ❌ Avoid: Unwrap in production code
let result = operation().unwrap(); // Don't do this

// ✅ Good: Proper error handling
let result = operation()
    .context("Operation failed")?;
```

### Testing Standards
- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test complete workflows
- **Documentation Tests**: Ensure examples in docs work
- **Performance Tests**: Validate performance characteristics

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_event_processing() {
        // Setup
        let processor = EventProcessor::new(&temp_dir);
        
        // Execute
        let result = processor.process_event(&mock_event).await;
        
        // Verify
        assert!(result.is_ok());
    }
}
```

### Security Guidelines
- **Input Validation**: Validate all external inputs
- **Authentication**: Maintain user-based access control
- **Secrets**: Never commit tokens, keys, or sensitive data
- **Rate Limiting**: Implement appropriate throttling
- **Error Messages**: Don't leak sensitive information

## 🐛 Bug Reports

### Before Submitting
1. **Search existing issues** to avoid duplicates
2. **Test with latest version** to ensure bug still exists
3. **Gather system information** (OS, Rust version, etc.)
4. **Create minimal reproduction** if possible

### Bug Report Template
```markdown
## Bug Description
Brief description of the issue.

## Steps to Reproduce
1. Step one
2. Step two
3. Expected vs actual behavior

## Environment
- OS: [e.g., macOS 14.0, Ubuntu 22.04]
- Rust Version: [e.g., 1.75.0]
- CC Telegram Bridge Version: [e.g., 0.1.0]

## Logs/Output
```
Paste relevant logs or error messages
```

## Additional Context
Any other relevant information.
```

## 💡 Feature Requests

### Before Submitting
1. **Check existing issues** for similar requests
2. **Consider scope** - does it fit the project goals?
3. **Think about implementation** - is it technically feasible?
4. **Provide use cases** - why is this needed?

### Feature Request Template
```markdown
## Feature Description
Clear description of the proposed feature.

## Use Case
Why is this feature needed? What problem does it solve?

## Proposed Implementation
How should this feature work? Any implementation ideas?

## Alternatives Considered
What alternatives have you considered?

## Additional Context
Any other relevant information, mockups, or examples.
```

## 🔧 Code Contributions

### Development Workflow
1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Develop** your changes following the guidelines
4. **Test** thoroughly: `cargo test && cargo clippy`
5. **Commit** with clear messages
6. **Push** to your fork: `git push origin feature/amazing-feature`
7. **Submit** a pull request

### Commit Message Format
Use conventional commits for consistency:

```bash
# Format: type(scope): description
feat(telegram): add interactive keyboard support
fix(config): resolve environment variable parsing
docs(readme): update installation instructions
test(events): add event validation tests
perf(monitor): optimize metrics collection
refactor(storage): simplify file operations
```

### Pull Request Guidelines

#### Before Submitting
- [ ] **Tests pass**: `cargo test`
- [ ] **Lints clean**: `cargo clippy`
- [ ] **Formatted**: `cargo fmt`
- [ ] **Documentation updated** if needed
- [ ] **CHANGELOG.md updated** for user-facing changes

#### PR Template
```markdown
## Description
Brief description of changes made.

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to change)
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added and passing
- [ ] No new clippy warnings

## Additional Notes
Any additional information or context.
```

## 🧪 Testing

### Running Tests
```bash
# Run all tests
cargo test

# Run specific test
cargo test test_performance_monitor

# Run with output
cargo test -- --nocapture

# Run integration tests only
cargo test --test integration_tests
```

### Writing Tests
- **Test Names**: Use descriptive names
- **Test Structure**: Arrange, Act, Assert pattern
- **Mock Data**: Use realistic test data
- **Error Cases**: Test both success and failure paths

```rust
#[tokio::test]
async fn test_telegram_message_formatting() {
    // Arrange
    let formatter = MessageFormatter::new();
    let event = create_test_event();
    
    // Act
    let message = formatter.format_task_completion(&event);
    
    // Assert
    assert!(message.contains("✅"));
    assert!(message.contains(&event.title));
}
```

## 📊 Performance Considerations

### Performance Guidelines
- **Async/Await**: Use async functions for I/O operations
- **Memory Allocation**: Minimize unnecessary allocations
- **CPU Usage**: Profile CPU-intensive operations
- **Caching**: Cache expensive computations when appropriate

### Benchmarking
```rust
#[cfg(test)]
mod benches {
    use super::*;
    use std::time::Instant;
    
    #[test]
    fn benchmark_event_processing() {
        let start = Instant::now();
        // ... operation to benchmark
        let duration = start.elapsed();
        assert!(duration.as_millis() < 100, "Processing too slow: {:?}", duration);
    }
}
```

## 📚 Documentation

### Documentation Standards
- **Public APIs**: Document all public functions and types
- **Examples**: Include usage examples in doc comments
- **Error Cases**: Document when functions return errors
- **Panics**: Document when functions might panic

```rust
/// Processes a Telegram event and sends notifications.
/// 
/// # Arguments
/// * `event` - The event to process
/// 
/// # Returns
/// * `Ok(())` - Event processed successfully
/// * `Err(_)` - Processing failed (invalid event, network error, etc.)
/// 
/// # Examples
/// ```
/// let processor = EventProcessor::new();
/// processor.process_event(&event).await?;
/// ```
pub async fn process_event(&self, event: &Event) -> anyhow::Result<()> {
    // Implementation
}
```

### Documentation Types
- **README.md**: Project overview and basic usage
- **QUICKSTART.md**: Step-by-step setup guide
- **API Documentation**: Generated from rustdoc comments
- **Examples**: Practical usage examples
- **Architecture**: High-level design documentation

## 🔍 Code Review Process

### Review Checklist
- [ ] **Functionality**: Does the code work as intended?
- [ ] **Style**: Follows project conventions?
- [ ] **Performance**: No obvious performance issues?
- [ ] **Security**: No security vulnerabilities?
- [ ] **Tests**: Adequate test coverage?
- [ ] **Documentation**: Clear and complete?
- [ ] **Breaking Changes**: Properly documented?

### Review Guidelines
- **Be Constructive**: Provide helpful feedback
- **Be Specific**: Point to exact lines and suggest improvements
- **Be Respectful**: Maintain a positive and professional tone
- **Learn Together**: Use reviews as learning opportunities

## 🏷️ Release Process

### Version Numbering
We follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Checklist
1. **Update Version**: Bump version in `Cargo.toml`
2. **Update Changelog**: Document all changes
3. **Test Thoroughly**: Run full test suite
4. **Performance Check**: Validate performance benchmarks
5. **Documentation**: Update docs for new features
6. **Security Review**: Ensure no security regressions
7. **Tag Release**: Create git tag and GitHub release

## 📞 Getting Help

### Communication Channels
- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions and ideas
- **Code Review**: Pull request discussions

### Questions?
- **Architecture Questions**: Ask in GitHub Discussions
- **Implementation Help**: Comment on relevant issues
- **Security Concerns**: Create private security report

## 🙏 Recognition

Contributors are recognized in several ways:
- **CHANGELOG.md**: Major contributions noted in releases
- **GitHub Contributors**: Automatic recognition on repository
- **Documentation**: Contributor acknowledgments

## 📜 License

By contributing to CC Telegram Bridge, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to CC Telegram Bridge!** 🚀

Your contributions help make this project better for everyone. Whether you're fixing bugs, adding features, or improving documentation, every contribution matters.

**Happy coding!** ❤️
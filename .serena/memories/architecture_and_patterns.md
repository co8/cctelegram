# Architecture and Design Patterns

## Project Architecture

### Modular Design
The project follows a clean modular architecture with clear separation of concerns:

- **config/**: Configuration management with TOML and environment variable support
- **events/**: Comprehensive event system with 44+ event types, processing, and file watching
- **telegram/**: Telegram bot integration with message formatting and interactive handlers
- **storage/**: File operations and data persistence layer
- **utils/**: Cross-cutting concerns (security, logging, performance, health checks)

### Key Design Patterns

#### Builder Pattern
Used extensively in the event system for type-safe event creation:
```rust
Event::task_completed(source, task_id, title, results)
Event::performance_alert(source, task_id, title, current_value, threshold)
```

#### Configuration Pattern
Hierarchical configuration with defaults and environment overrides:
- TOML files for structured configuration
- Environment variables for sensitive data
- Auto-creation of config files on first run

#### Event-Driven Architecture
Core application flow based on file system events:
1. File watcher detects new event files
2. Event processor validates and routes events
3. Telegram bot formats and sends notifications
4. Storage layer manages persistence

#### Async/Await Pattern
Heavily async codebase using Tokio:
- Non-blocking I/O operations
- Concurrent event processing
- Background monitoring tasks

## Security Architecture

### Multi-Layer Security
- **Authentication**: Telegram user ID validation
- **Rate Limiting**: Per-user request throttling
- **Input Validation**: Comprehensive sanitization
- **Audit Logging**: Security event tracking

### Error Handling Strategy
- **Graceful Degradation**: Service continues on non-critical errors
- **Structured Errors**: `thiserror` for library errors, `anyhow` for applications
- **Comprehensive Logging**: Detailed error context with `tracing`

## Performance Design

### Monitoring Integration
- **Prometheus Metrics**: Built-in metrics collection
- **Health Endpoints**: Multiple monitoring endpoints (/health, /metrics, /report)
- **Performance Tracking**: CPU, memory, and processing time monitoring

### Scalability Considerations
- **Async Processing**: Non-blocking event handling
- **Resource Monitoring**: Automatic alerts for threshold breaches
- **Modular Components**: Easy to scale individual components

## Development Guidelines

### Code Organization Principles
1. **Single Responsibility**: Each module has a clear, focused purpose
2. **Dependency Injection**: Configuration and dependencies passed explicitly
3. **Interface Segregation**: Clean module boundaries with minimal public APIs
4. **Composition**: Prefer composition over inheritance patterns

### Testing Strategy
- **Unit Tests**: 32 tests covering event system core functionality
- **Integration Tests**: 6 tests covering end-to-end workflows
- **Performance Tests**: Monitoring and validation of system metrics
- **Edge Case Coverage**: Invalid inputs, boundary conditions, error scenarios

### Quality Assurance
- **Static Analysis**: Clippy linting with strict rules
- **Formatting**: Consistent code style with rustfmt
- **Documentation**: Comprehensive rustdoc for public APIs
- **Security Review**: Regular audit of security-sensitive code paths
# Code Style and Conventions

## Rust Code Style
- **Edition**: Rust 2021
- **Formatting**: Standard Rust formatting with `cargo fmt`
- **Linting**: Clippy for additional linting with `cargo clippy`
- **Error Handling**: Uses `anyhow::Result` for main functions, `thiserror` for custom error types
- **Async**: Tokio-based async/await patterns throughout

## Naming Conventions
- **Structs**: PascalCase (e.g., `Event`, `TelegramBot`, `PerformanceMonitor`)
- **Functions**: snake_case (e.g., `setup_logging`, `check_health_endpoint`)
- **Variables**: snake_case (e.g., `performance_monitor`, `event_type`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `ALERT_THRESHOLD_CPU`)
- **Modules**: snake_case (e.g., `config`, `events`, `telegram`)

## Documentation Patterns
- **Public APIs**: Comprehensive rustdoc comments with examples
- **Structs**: Document purpose and usage patterns
- **Complex Functions**: Include usage examples and error conditions
- **Modules**: Module-level documentation explaining purpose

## Serde Patterns
- **Derive Macros**: `#[derive(Debug, Clone, Deserialize, Serialize)]` for data structures
- **Field Renaming**: Use `#[serde(rename = "type")]` for JSON compatibility
- **Optional Fields**: Properly handle Option types in serialization

## Error Handling Patterns
- **Main Functions**: Return `anyhow::Result<()>`
- **Library Functions**: Use specific error types with `thiserror`
- **Logging**: Use `tracing` macros (`info!`, `warn!`, `error!`) for structured logging
- **Graceful Degradation**: Handle errors without crashing the service

## Module Organization
- **Public Interface**: Expose necessary types through `lib.rs`
- **Internal Structure**: Organize by domain (config, events, telegram, storage, utils)
- **Re-exports**: Use `mod.rs` files to control public API surface
- **Tests**: Place unit tests in same file, integration tests in `tests/` directory

## Configuration Patterns
- **Environment Variables**: Use for sensitive data (tokens, user IDs)
- **TOML Files**: Use for structured configuration with defaults
- **Auto-creation**: Create default config files on first run
- **Validation**: Validate configuration at startup
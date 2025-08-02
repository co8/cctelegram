# Suggested Development Commands

## Build Commands
```bash
# Development build
cargo build

# Optimized release build
cargo build --release

# Build and run in development mode
cargo run

# Build and run with detailed logging
RUST_LOG=info cargo run
RUST_LOG=debug cargo run  # More verbose logging
```

## Testing Commands
```bash
# Run all tests
cargo test

# Run tests with verbose output
cargo test -- --nocapture --test-threads=1

# Run specific test categories
cargo test events::types::tests      # Event system tests (32 tests)
cargo test integration_tests        # Integration tests (6 tests)
cargo test performance_monitor      # Performance monitoring tests

# Run specific test with debug output
RUST_LOG=debug cargo test test_event_creation -- --nocapture
```

## Code Quality Commands
```bash
# Format code
cargo fmt

# Check formatting without changing files
cargo fmt --check

# Run clippy linter
cargo clippy

# Run clippy with strict linting
cargo clippy -- -W clippy::all

# Check code without building
cargo check
```

## Development Tools
```bash
# Install development dependencies
rustup component add clippy rustfmt

# Watch for changes and rebuild
cargo watch -x test      # Requires cargo-watch
cargo watch -x check     # Check on file changes
```

## Application Commands
```bash
# Run the application (requires bot token setup)
./target/release/cc-telegram-bridge

# Run with custom configuration
CC_TELEGRAM_EVENTS_DIR="/custom/path" ./target/release/cc-telegram-bridge

# Test build and setup
./test_app.sh

# Performance monitoring
./performance_monitor.sh monitor           # One-time check
./performance_monitor.sh continuous 30     # Continuous monitoring
./performance_monitor.sh optimize          # Optimization suggestions
./performance_monitor.sh deployment-check  # Deployment readiness
```

## Health Check Commands
```bash
# Application health (when running)
curl http://localhost:8080/health
curl http://localhost:8080/metrics
curl http://localhost:8080/report

# Check if application is running
pgrep -f cc-telegram-bridge
```

## Environment Setup Commands
```bash
# Set required environment variables
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_ALLOWED_USERS="123456789,987654321"

# Optional environment variables
export CC_TELEGRAM_EVENTS_DIR="/custom/events/path"
export CC_TELEGRAM_RESPONSES_DIR="/custom/responses/path"
export RUST_LOG=info  # or debug for more verbose logging
```

## Pre-commit Quality Checks
Always run before committing:
```bash
cargo fmt --check    # Format check
cargo clippy         # Linting
cargo test           # All tests
```
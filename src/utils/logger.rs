use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use anyhow::Result;

pub fn setup_logging() -> Result<()> {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(true)
                .with_line_number(true)
                .with_file(true)
                // JSON format requires additional features, using compact format for now
                .compact()
        )
        .with(env_filter)
        .init();

    Ok(())
}

/// Structured logging macros for tier-specific operations
#[macro_export]
macro_rules! log_tier_operation {
    ($level:ident, $tier:expr, $correlation_id:expr, $operation:expr, $($key:ident = $value:expr),*) => {
        tracing::$level!(
            tier = $tier,
            correlation_id = $correlation_id,
            operation = $operation,
            $($key = $value,)*
        );
    };
}

/// Log tier success with metrics
#[macro_export]
macro_rules! log_tier_success {
    ($tier:expr, $correlation_id:expr, $response_time_ms:expr, $($key:ident = $value:expr),*) => {
        tracing::info!(
            tier = $tier,
            correlation_id = $correlation_id,
            response_time_ms = $response_time_ms,
            success = true,
            $($key = $value,)*
            "Tier operation completed successfully"
        );
    };
}

/// Log tier failure with error details
#[macro_export]
macro_rules! log_tier_failure {
    ($tier:expr, $correlation_id:expr, $error:expr, $($key:ident = $value:expr),*) => {
        tracing::error!(
            tier = $tier,
            correlation_id = $correlation_id,
            error = %$error,
            success = false,
            $($key = $value,)*
            "Tier operation failed"
        );
    };
}

/// Log failover events
#[macro_export]
macro_rules! log_failover_event {
    ($from_tier:expr, $to_tier:expr, $correlation_id:expr, $reason:expr) => {
        tracing::warn!(
            from_tier = $from_tier,
            to_tier = $to_tier,
            correlation_id = $correlation_id,
            reason = $reason,
            event_type = "failover",
            "Tier failover occurred"
        );
    };
}

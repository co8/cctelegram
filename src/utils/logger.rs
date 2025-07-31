use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use anyhow::Result;

pub fn setup_logging() -> Result<()> {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(fmt::layer().with_target(true).with_thread_ids(true))
        .with(env_filter)
        .init();

    Ok(())
}
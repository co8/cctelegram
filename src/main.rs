use anyhow::{Result, Context};
use tracing::{info, warn, error};
use tokio::signal;
use std::sync::Arc;
use std::time::Instant;

mod config;
mod events;
mod telegram;
mod storage;
mod utils;
mod internal_processor;
mod tier_orchestrator;
mod mcp;

use config::Config;
use events::{EventWatcher, EventProcessor};
use telegram::TelegramBot;
use telegram::messages::MessageStyle;
use storage::FileStore;
use utils::{PerformanceMonitor, HealthServer};
use internal_processor::InternalProcessor;
use tier_orchestrator::TierOrchestrator;

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables from .env file if it exists
    // This will load from shell environment if no .env file is found
    if let Err(e) = dotenv::dotenv() {
        // Only warn if the error is not "file not found"
        if !e.to_string().contains("No such file or directory") && !e.to_string().contains("system cannot find the file") {
            warn!("Failed to load .env file: {}", e);
        }
    } else {
        info!("Loaded environment variables from .env file");
    }

    // Initialize logging
    utils::setup_logging()?;

    info!("Starting CC Telegram Bridge v{}", env!("CARGO_PKG_VERSION"));
    info!("Build info: {} ({})", env!("GIT_HASH_SHORT"), env!("BUILD_TIME"));
    
    // Warn if running in debug mode
    #[cfg(debug_assertions)]
    warn!("Running in DEBUG mode - rebuild with --release for production");
    
    // Check for source-binary synchronization
    if let Ok(current_head) = std::process::Command::new("git")
        .args(&["rev-parse", "HEAD"])
        .output()
    {
        let current_hash = String::from_utf8_lossy(&current_head.stdout).trim().to_string();
        let build_hash = env!("GIT_HASH");
        
        if current_hash != build_hash {
            warn!("⚠️  Binary built from commit {} but source is at commit {}", 
                  &build_hash[..8], &current_hash[..8]);
            warn!("⚠️  Consider rebuilding with 'cargo build --release' for latest changes");
        }
    }

    // Load configuration
    let config = Config::load()?;
    info!("Configuration loaded successfully");

    // Initialize performance monitoring
    let performance_monitor = Arc::new(PerformanceMonitor::new(config.performance.clone())?);
    info!("Performance monitoring initialized");

    // Start background monitoring task
    let monitor_clone = performance_monitor.clone();
    tokio::spawn(async move {
        if let Err(e) = monitor_clone.start_monitoring_task().await {
            error!("Performance monitoring task failed: {}", e);
        }
    });

    // Start health check server if enabled
    if config.monitoring.enable_metrics_server {
        let health_server = HealthServer::new(performance_monitor.clone(), config.monitoring.health_check_port);
        tokio::spawn(async move {
            if let Err(e) = health_server.start().await {
                error!("Health server failed: {}", e);
            }
        });
        info!("Health check server started on port {}", config.monitoring.health_check_port);
    }

    // Initialize Tier 2 Internal Processor (Bridge fallback)
    let internal_processor = Arc::new(InternalProcessor::new(Arc::new(config.clone())));
    info!("🔧 Internal Processor (Tier 2) initialized for port 3001");

    // Initialize Tier Orchestrator (Circuit Breaker and Failover Logic)
    let tier_orchestrator = Arc::new(TierOrchestrator::new(
        Arc::new(config.clone()),
        internal_processor.clone(),
    ));
    info!("🎯 Tier Orchestrator initialized with 3-tier cascading system");

    // Start periodic health checks for tier monitoring
    let orchestrator_clone = tier_orchestrator.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            orchestrator_clone.perform_health_checks().await;
        }
    });
    info!("🔍 Tier health monitoring started (30s intervals)");

    // Initialize storage
    let file_store = FileStore::new(&Config::get_config_dir());
    file_store.ensure_directories().await?;

    // Initialize event processor
    let event_processor = EventProcessor::new(&config.paths.events_dir);

    // Parse timezone from config
    let timezone: chrono_tz::Tz = config.telegram.timezone.parse()
        .with_context(|| format!("Invalid timezone: {}", config.telegram.timezone))?;

    // Parse message style from config
    let message_style = MessageStyle::from_str(&config.telegram.message_style);

    // Initialize Telegram bot
    let telegram_bot = Arc::new(TelegramBot::new_with_style(
        config.telegram.telegram_bot_token.clone(),
        config.telegram.telegram_allowed_users.clone(),
        config.paths.responses_dir.clone(),
        timezone,
        message_style,
    ));

    // Process any unsent events from previous sessions
    if let Err(e) = telegram_bot.process_unsent_events().await {
        warn!("Failed to process unsent events: {}", e);
    }

    // Send startup message to all allowed users
    for &user_id in &config.telegram.telegram_allowed_users {
        if let Err(e) = telegram_bot.send_startup_message(user_id).await {
            warn!("Failed to send startup message to user {}: {}", user_id, e);
        }
    }

    // Initialize file watcher
    let mut event_watcher = EventWatcher::new(&config.paths.events_dir)?;
    info!("File watcher initialized for: {}", config.paths.events_dir.display());

    // Start Telegram message dispatcher
    let telegram_dispatcher = {
        let bot_clone = telegram_bot.clone();
        tokio::spawn(async move {
            info!("Starting Telegram message dispatcher");
            if let Err(e) = bot_clone.start_dispatcher().await {
                error!("Telegram dispatcher error: {}", e);
            }
        })
    };

    // Start main event loop
    info!("Starting main event processing loop");
    
    let bot_clone = telegram_bot.clone();
    let monitor_clone = performance_monitor.clone();
    let main_loop = tokio::spawn(async move {
        loop {
            if let Some(file_event) = event_watcher.next_event().await {
                // Record file watcher event
                monitor_clone.record_file_watcher_event();
                
                if event_watcher.is_relevant_event(&file_event) {
                    info!("Processing file event: {:?}", file_event);
                    
                    for path in &file_event.paths {
                        if path.is_file() {
                            // Measure event processing time
                            let start_time = Instant::now();
                            
                            match event_processor.process_event_file(path).await {
                                Ok(event) => {
                                    // Record successful event processing
                                    monitor_clone.record_event_processed(start_time.elapsed());
                                    info!("Processed event: {} - {}", event.task_id, event.title);
                                    
                                    // Send notification to all allowed users
                                    for &user_id in &config.telegram.telegram_allowed_users {
                                        let telegram_start = Instant::now();
                                        
                                        match bot_clone.send_event_notification(user_id, &event).await {
                                            Ok(_) => {
                                                // Record successful Telegram message
                                                monitor_clone.record_telegram_message(telegram_start.elapsed());
                                            }
                                            Err(e) => {
                                                // Record error
                                                monitor_clone.record_error("telegram_notification");
                                                error!("Failed to send notification: {}", e);
                                            }
                                        }
                                    }
                                    
                                    // Clean up processed file
                                    if let Err(e) = event_processor.cleanup_processed_file(path).await {
                                        monitor_clone.record_error("file_cleanup");
                                        warn!("Failed to cleanup file {}: {}", path.display(), e);
                                    }
                                }
                                Err(e) => {
                                    // Record error and processing time
                                    monitor_clone.record_error("event_processing");
                                    monitor_clone.record_event_processed(start_time.elapsed());
                                    error!("Failed to process event file {}: {}", path.display(), e);
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Wait for shutdown signal
    info!("CC Telegram Bridge is running. Press Ctrl+C to stop.");
    info!("📱 Telegram dispatcher started - ready to receive messages");
    
    tokio::select! {
        _ = signal::ctrl_c() => {
            info!("Received shutdown signal");
        }
        result = main_loop => {
            if let Err(e) = result {
                error!("Main loop error: {}", e);
            }
        }
        result = telegram_dispatcher => {
            if let Err(e) = result {
                error!("Telegram dispatcher error: {}", e);
            }
        }
    }

    info!("CC Telegram Bridge stopped");
    Ok(())
}
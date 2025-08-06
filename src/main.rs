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
use events::{EventWatcher, EventProcessor, QueueManager, QueueManagerConfig, DebouncedEventProcessor, DebouncedEventWatcher, DebounceConfig};
use telegram::TelegramBot;
use telegram::messages::MessageStyle;
use telegram::rate_limiter::RateLimiterConfig;
use telegram::retry_handler::{RetryConfig, CircuitBreakerConfig};
use storage::{FileStore, EnhancedEventQueue};
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
    let mut telegram_bot = TelegramBot::new_with_style(
        config.telegram.telegram_bot_token.clone(),
        config.telegram.telegram_allowed_users.clone(),
        config.paths.responses_dir.clone(),
        timezone,
        message_style,
    );

    // Enable rate limiting
    let rate_limiter_config = config.security.rate_limiter.to_rate_limiter_config();
    if let Err(e) = telegram_bot.enable_rate_limiting(rate_limiter_config).await {
        warn!("Failed to enable rate limiting: {}, continuing without rate limiting", e);
    } else {
        info!("Rate limiting enabled successfully");
    }

    // Enable MCP integration with default configuration
    telegram_bot.enable_mcp_integration_default();
    info!("MCP integration enabled for Telegram bot");

    let telegram_bot = Arc::new(telegram_bot);

    // Initialize Queue Manager for startup burst handling (SubAgent Gamma)
    let queue_manager = if let Some(ref redis_url) = std::env::var("REDIS_URL").ok() {
        info!("🎯 Initializing Queue Manager (SubAgent Gamma) with Redis");
        
        let queue_config = QueueManagerConfig {
            redis_url: redis_url.clone(),
            max_workers: 3,
            max_retry_attempts: 3,
            startup_batch_size: 10,
            processing_timeout: std::time::Duration::from_secs(30),
            queue_prefix: "cctelegram:queue".to_string(),
        };
        
        let rate_limiter_config = config.security.rate_limiter.to_rate_limiter_config();
        let retry_config = RetryConfig::default();
        let circuit_breaker_config = CircuitBreakerConfig::default();
        
        match QueueManager::new(queue_config, rate_limiter_config, retry_config, circuit_breaker_config).await {
            Ok(qm) => {
                info!("✅ Queue Manager (SubAgent Gamma) initialized with Alpha+Beta integration");
                Some(Arc::new(qm))
            }
            Err(e) => {
                warn!("⚠️  Failed to initialize Queue Manager: {}, falling back to traditional queue", e);
                None
            }
        }
    } else {
        info!("ℹ️  Redis URL not configured, using traditional queue (no startup burst protection)");
        None
    };

    // Initialize Enhanced Event Queue with QueueManager integration
    let mut enhanced_queue = EnhancedEventQueue::new(1000, queue_manager.clone());

    // Process accumulated startup events through queue manager
    info!("🚀 Processing startup events (accumulated while bridge was offline)");
    if let Err(e) = enhanced_queue.process_startup_burst(&config.paths.events_dir).await {
        warn!("Failed to process startup events through queue manager: {}", e);
    }

    // Process any unsent events from previous sessions (legacy method)
    if let Err(e) = telegram_bot.process_unsent_events().await {
        warn!("Failed to process legacy unsent events: {}", e);
    }

    // Send startup message to all allowed users
    for &user_id in &config.telegram.telegram_allowed_users {
        if let Err(e) = telegram_bot.send_startup_message(user_id).await {
            warn!("Failed to send startup message to user {}: {}", user_id, e);
        }
    }

    // Initialize file processing system (debounced or standard)
    let use_debounced = config.file_debouncing.enabled;
    info!("Initializing file processing system - Debounced: {}", use_debounced);

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

    // Start main event loop based on configuration
    info!("Starting main event processing loop");
    
    let bot_clone = telegram_bot.clone();
    let monitor_clone = performance_monitor.clone();
    let config_clone = config.clone();
    
    let main_loop = if use_debounced {
        // Use debounced event processing with simplified approach
        info!("🚀 Starting DEBOUNCED event processing with {}ms debounce window", 
              config.file_debouncing.debounce_duration_ms);
              
        tokio::spawn(async move {
            // Create debounced file watcher directly  
            let debounce_config = config_clone.file_debouncing.to_debounce_config();
            let mut debounced_watcher = match DebouncedEventWatcher::new(&config_clone.paths.events_dir, Some(debounce_config)) {
                Ok(watcher) => watcher,
                Err(e) => {
                    error!("Failed to create debounced watcher: {}", e);
                    return;
                }
            };
            
            // Start debounced processing in background
            let mut processing_watcher = match DebouncedEventWatcher::new(&config_clone.paths.events_dir, Some(config_clone.file_debouncing.to_debounce_config())) {
                Ok(watcher) => watcher,
                Err(e) => {
                    error!("Failed to create processing watcher: {}", e);
                    return;
                }
            };
            
            tokio::spawn(async move {
                if let Err(e) = processing_watcher.start_processing().await {
                    error!("Debounced processing failed: {}", e);
                }
            });
            
            // Process debounced event batches
            while let Some(batch) = debounced_watcher.next_batch().await {
                // Record batch processing
                monitor_clone.record_file_watcher_event();
                let batch_size = batch.events.len();
                info!("📦 Processing debounced batch with {} events (from {} raw events)", batch_size, batch.raw_event_count);
                
                let start_time = Instant::now();
                
                for file_event in &batch.events {
                    if !file_event.content_changed {
                        continue; // Skip timestamp-only changes
                    }
                    
                    // Process the file event into a parsed Event
                    match event_processor.process_event_file(&file_event.path).await {
                        Ok(event) => {
                            info!("Processing debounced event: {} - {}", event.task_id, event.title);
                            
                            // Send notification to all allowed users
                            for &user_id in &config_clone.telegram.telegram_allowed_users {
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
                            
                            // Clean up processed file if auto-cleanup enabled
                            if config_clone.file_debouncing.auto_cleanup {
                                if let Err(e) = event_processor.cleanup_processed_file(&file_event.path).await {
                                    monitor_clone.record_error("file_cleanup");
                                    warn!("Failed to cleanup file {}: {}", file_event.path.display(), e);
                                }
                            }
                        }
                        Err(e) => {
                            error!("Failed to process debounced file {}: {}", file_event.path.display(), e);
                            monitor_clone.record_error("event_processing");
                        }
                    }
                }
                
                // Record successful batch processing
                monitor_clone.record_event_processed(start_time.elapsed());
                info!("✅ Completed debounced batch processing for {} events", batch_size);
            }
        })
    } else {
        // Use standard event processing
        info!("🚀 Starting STANDARD event processing");
        
        tokio::spawn(async move {
            let mut event_watcher = match EventWatcher::new(&config_clone.paths.events_dir) {
                Ok(watcher) => watcher,
                Err(e) => {
                    error!("Failed to create event watcher: {}", e);
                    return;
                }
            };
            
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
                                        for &user_id in &config_clone.telegram.telegram_allowed_users {
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
        })
    };

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

    // Graceful shutdown of queue manager workers
    info!("🛑 Shutting down queue manager workers...");
    if let Err(e) = enhanced_queue.shutdown().await {
        warn!("Error during queue manager shutdown: {}", e);
    } else {
        info!("✅ Queue manager shutdown complete");
    }

    info!("CC Telegram Bridge stopped");
    Ok(())
}
/**
 * Task 21.5: Circuit Breaker and Tier Fallback Logic
 * Intelligent tier selection and failover management for 3-tier cascading system
 */

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use tracing::{info, warn, error, debug};
// Simple circuit breaker pattern without external dependencies

use crate::config::{Config, ConfigManager};
use crate::internal_processor::{InternalProcessor, ResponsePayload, ProcessingResult};
use crate::events::file_tier::FileTierProcessor;
use crate::utils::{TierMonitor, PerformanceMonitor};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TierType {
    #[serde(rename = "mcp_webhook")]
    McpWebhook,      // Tier 1: 0-100ms
    #[serde(rename = "bridge_internal")]  
    BridgeInternal,  // Tier 2: 100-500ms
    #[serde(rename = "file_watcher")]
    FileWatcher,     // Tier 3: 1-5s
}

impl TierType {
    pub fn as_str(&self) -> &'static str {
        match self {
            TierType::McpWebhook => "mcp_webhook",
            TierType::BridgeInternal => "bridge_internal",
            TierType::FileWatcher => "file_watcher",
        }
    }

    pub fn timeout_ms(&self) -> u64 {
        // Default fallback values - should be overridden by configuration
        match self {
            TierType::McpWebhook => 100,
            TierType::BridgeInternal => 500,
            TierType::FileWatcher => 5000,
        }
    }

    pub fn timeout_from_config(&self, config: &Config) -> Duration {
        config.get_tier_timeout(*self)
    }

    pub fn priority(&self) -> u8 {
        // Default fallback values - should be overridden by configuration
        match self {
            TierType::McpWebhook => 1,      // Highest priority
            TierType::BridgeInternal => 2,
            TierType::FileWatcher => 3,     // Lowest priority (fallback)
        }
    }

    pub fn priority_from_config(&self, config: &Config) -> u8 {
        config.get_tier_priority(*self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierHealth {
    pub tier_type: TierType,
    pub is_healthy: bool,
    pub last_check: DateTime<Utc>,
    pub response_time_ms: Option<u64>,
    pub success_rate: f64,
    pub consecutive_failures: u32,
    pub circuit_breaker_state: CircuitBreakerState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CircuitBreakerState {
    #[serde(rename = "closed")]
    Closed,      // Normal operation
    #[serde(rename = "open")]
    Open,        // Failing, blocking requests
    #[serde(rename = "half_open")]
    HalfOpen,    // Testing recovery
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierSelection {
    pub selected_tier: TierType,
    pub reason: String,
    pub fallback_tiers: Vec<TierType>,
    pub decision_time_ms: u64,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierFailoverEvent {
    pub from_tier: TierType,
    pub to_tier: TierType,
    pub reason: String,
    pub timestamp: DateTime<Utc>,
    pub correlation_id: String,
    pub processing_result: Option<ProcessingResult>,
}

#[derive(Debug)]
pub struct TierOrchestrator {
    config: Arc<Config>,
    config_manager: Option<Arc<ConfigManager>>,
    internal_processor: Arc<InternalProcessor>,
    file_tier_processor: Option<Arc<FileTierProcessor>>,
    tier_health: Arc<RwLock<Vec<TierHealth>>>,
    // Removed circuit_breakers field - using built-in logic instead
    failover_events: Arc<RwLock<Vec<TierFailoverEvent>>>,
    statistics: Arc<RwLock<TierStatistics>>,
    tier_monitor: Arc<TierMonitor>,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct TierStatistics {
    pub total_requests: u64,
    pub tier_requests: std::collections::HashMap<TierType, u64>,
    pub tier_successes: std::collections::HashMap<TierType, u64>,
    pub tier_failures: std::collections::HashMap<TierType, u64>,
    pub average_response_times: std::collections::HashMap<TierType, u64>,
    pub failover_count: u64,
    pub circuit_breaker_trips: u64,
}

impl TierOrchestrator {
    pub fn new(config: Arc<Config>, internal_processor: Arc<InternalProcessor>) -> Self {
        Self::new_with_file_tier(config, internal_processor, None)
    }
    
    pub fn new_with_config_manager(
        config: Arc<Config>, 
        config_manager: Arc<ConfigManager>,
        internal_processor: Arc<InternalProcessor>
    ) -> Self {
        Self::new_with_file_tier_and_config_manager(config, Some(config_manager), internal_processor, None)
    }
    
    pub fn new_with_file_tier(
        config: Arc<Config>, 
        internal_processor: Arc<InternalProcessor>,
        file_tier_base_path: Option<&std::path::Path>
    ) -> Self {
        Self::new_with_file_tier_and_config_manager(config, None, internal_processor, file_tier_base_path)
    }
    
    pub fn new_with_file_tier_and_config_manager(
        config: Arc<Config>, 
        config_manager: Option<Arc<ConfigManager>>,
        internal_processor: Arc<InternalProcessor>,
        file_tier_base_path: Option<&std::path::Path>
    ) -> Self {
        let tier_health = Arc::new(RwLock::new(vec![
            TierHealth {
                tier_type: TierType::McpWebhook,
                is_healthy: true,
                last_check: Utc::now(),
                response_time_ms: None,
                success_rate: 1.0,
                consecutive_failures: 0,
                circuit_breaker_state: CircuitBreakerState::Closed,
            },
            TierHealth {
                tier_type: TierType::BridgeInternal,
                is_healthy: true,
                last_check: Utc::now(),
                response_time_ms: None,
                success_rate: 1.0,
                consecutive_failures: 0,
                circuit_breaker_state: CircuitBreakerState::Closed,
            },
            TierHealth {
                tier_type: TierType::FileWatcher,
                is_healthy: true,
                last_check: Utc::now(),
                response_time_ms: None,
                success_rate: 1.0,
                consecutive_failures: 0,
                circuit_breaker_state: CircuitBreakerState::Closed,
            },
        ]));

        // Initialize file tier processor if path provided
        let file_tier_processor = file_tier_base_path
            .and_then(|path| {
                match FileTierProcessor::new(path) {
                    Ok(processor) => {
                        info!("✅ [ORCHESTRATOR] File tier processor initialized");
                        Some(Arc::new(processor))
                    }
                    Err(e) => {
                        error!("❌ [ORCHESTRATOR] Failed to initialize file tier processor: {}", e);
                        None
                    }
                }
            });

        // Initialize performance monitor for tier monitoring integration
        let performance_monitor = match PerformanceMonitor::new(Default::default()) {
            Ok(monitor) => {
                info!("✅ [ORCHESTRATOR] Performance monitor initialized");
                Some(Arc::new(monitor))
            }
            Err(e) => {
                warn!("⚠️ [ORCHESTRATOR] Failed to initialize performance monitor: {}", e);
                None
            }
        };

        // Initialize tier monitor with performance monitor integration
        let tier_monitor = match TierMonitor::new(performance_monitor) {
            Ok(monitor) => {
                info!("✅ [ORCHESTRATOR] Tier monitor initialized");
                Arc::new(monitor)
            }
            Err(e) => {
                error!("❌ [ORCHESTRATOR] Failed to initialize tier monitor: {}", e);
                // Create a basic tier monitor without performance integration
                Arc::new(TierMonitor::new(None).unwrap_or_else(|_| {
                    panic!("Failed to create basic tier monitor")
                }))
            }
        };

        Self {
            config,
            config_manager,
            internal_processor,
            file_tier_processor,
            tier_health,
            failover_events: Arc::new(RwLock::new(Vec::new())),
            statistics: Arc::new(RwLock::new(TierStatistics::default())),
            tier_monitor,
        }
    }

    // Circuit breaker logic is now integrated into tier health management

    pub async fn select_tier(&self, correlation_id: &str) -> TierSelection {
        let start_time = Instant::now();
        
        info!("🎯 [ORCHESTRATOR] Selecting tier for correlation: {}", correlation_id);
        
        // Get current configuration (may be updated via hot-reload)
        let current_config = if let Some(config_manager) = &self.config_manager {
            config_manager.get_config().await
        } else {
            (*self.config).clone()
        };
        
        // Get current tier health status
        let tier_health = self.tier_health.read().await;
        
        // Filter tiers based on health, circuit breaker state, and configuration
        let mut available_tiers: Vec<_> = tier_health
            .iter()
            .filter(|health| {
                health.is_healthy 
                && health.circuit_breaker_state != CircuitBreakerState::Open
                && current_config.is_tier_enabled(health.tier_type)
            })
            .collect();

        // Performance-based tier selection if enabled
        if current_config.tier_configuration.enable_performance_based_selection {
            available_tiers = self.apply_performance_filtering(available_tiers, &current_config).await;
        }

        // Sort by configured priority (lower number = higher priority)
        available_tiers.sort_by_key(|health| current_config.get_tier_priority(health.tier_type));
        
        let selected_tier = if available_tiers.is_empty() {
            warn!("⚠️ [ORCHESTRATOR] No healthy tiers available, forcing FileWatcher fallback");
            TierType::FileWatcher
        } else {
            available_tiers[0].tier_type
        };
        
        let fallback_tiers: Vec<TierType> = available_tiers.into_iter().skip(1).map(|h| h.tier_type).collect();
        let reason = self.get_selection_reason(&selected_tier, &fallback_tiers, &current_config).await;
        
        let selection = TierSelection {
            selected_tier,
            reason,
            fallback_tiers,
            decision_time_ms: start_time.elapsed().as_millis() as u64,
            correlation_id: correlation_id.to_string(),
        };
        
        info!("✅ [ORCHESTRATOR] Selected {} tier ({}) in {}ms", 
              selected_tier.as_str(), selection.reason, selection.decision_time_ms);
        
        selection
    }

    async fn apply_performance_filtering<'a>(&self, tiers: Vec<&'a TierHealth>, config: &Config) -> Vec<&'a TierHealth> {
        let mut filtered_tiers = Vec::new();
        let tiers_len = tiers.len();
        
        for tier in &tiers {
            // Check performance degradation threshold
            if tier.success_rate < config.tier_configuration.performance_degradation_threshold {
                debug!("🐌 [ORCHESTRATOR] {} tier filtered out due to low success rate: {:.1}%", 
                       tier.tier_type.as_str(), tier.success_rate * 100.0);
                continue;
            }
            
            // Check response time threshold
            if let Some(response_time) = tier.response_time_ms {
                if response_time > config.tier_configuration.response_time_degradation_ms {
                    debug!("🐌 [ORCHESTRATOR] {} tier filtered out due to high response time: {}ms", 
                           tier.tier_type.as_str(), response_time);
                    continue;
                }
            }
            
            // Check error rate threshold
            let error_rate = (1.0 - tier.success_rate) * 100.0;
            if error_rate > config.tier_configuration.error_rate_threshold_percent {
                debug!("🐌 [ORCHESTRATOR] {} tier filtered out due to high error rate: {:.1}%", 
                       tier.tier_type.as_str(), error_rate);
                continue;
            }
            
            filtered_tiers.push(*tier);
        }
        
        if filtered_tiers.is_empty() && tiers_len > 0 {
            warn!("⚠️ [ORCHESTRATOR] All tiers filtered out by performance criteria, using original list");
            return tiers;
        }
        
        filtered_tiers
    }

    async fn get_selection_reason(&self, selected_tier: &TierType, fallback_tiers: &[TierType], config: &Config) -> String {
        let tier_health = self.tier_health.read().await;
        let selected_health = tier_health.iter().find(|h| h.tier_type == *selected_tier);
        
        match selected_health {
            Some(health) if health.circuit_breaker_state == CircuitBreakerState::Closed => {
                if config.tier_configuration.enable_performance_based_selection {
                    format!("Performance-based selection (success_rate: {:.1}%, enabled: {})", 
                           health.success_rate * 100.0, 
                           if config.is_tier_enabled(*selected_tier) { "✓" } else { "✗" })
                } else {
                    format!("Priority-based selection (success_rate: {:.1}%)", health.success_rate * 100.0)
                }
            }
            Some(health) if health.circuit_breaker_state == CircuitBreakerState::HalfOpen => {
                "Testing tier recovery with circuit breaker".to_string()
            }
            _ => {
                if fallback_tiers.is_empty() {
                    "Last resort fallback - all tiers unavailable".to_string()
                } else {
                    format!("Graceful degradation ({} fallbacks available)", fallback_tiers.len())
                }
            }
        }
    }

    pub async fn process_with_tier(&self, 
        payload: ResponsePayload, 
        selected_tier: TierType,
        correlation_id: &str
    ) -> Result<ProcessingResult, Box<dyn std::error::Error + Send + Sync>> {
        let start_time = Instant::now();
        
        // Get current configuration for timeout enforcement
        let current_config = if let Some(config_manager) = &self.config_manager {
            config_manager.get_config().await
        } else {
            (*self.config).clone()
        };
        
        let tier_timeout = current_config.get_tier_timeout(selected_tier);
        let overall_timeout = Duration::from_millis(current_config.timeouts.overall_system_timeout_ms);
        
        // Start correlation tracking
        self.tier_monitor.start_correlation(correlation_id, selected_tier, "process").await;
        
        crate::log_tier_operation!(
            info,
            selected_tier.as_str(),
            correlation_id,
            "process",
            processing_tier = selected_tier.as_str()
        );
        
        // Record tier request (legacy statistics)
        self.record_tier_request(selected_tier).await;
        
        // Apply tier-specific timeout with overall system timeout as fallback
        let timeout_to_use = std::cmp::min(tier_timeout, overall_timeout);
        
        info!("⏱️ [ORCHESTRATOR] Processing {} tier with {}ms timeout (tier: {}ms, system: {}ms)", 
              selected_tier.as_str(), 
              timeout_to_use.as_millis(),
              tier_timeout.as_millis(),
              overall_timeout.as_millis());
        
        let result = tokio::time::timeout(
            timeout_to_use,
            async {
                match selected_tier {
                    TierType::McpWebhook => {
                        self.process_with_mcp_webhook(payload, correlation_id, &current_config).await
                    }
                    TierType::BridgeInternal => {
                        self.process_with_bridge_internal(payload, correlation_id, &current_config).await
                    }
                    TierType::FileWatcher => {
                        self.process_with_file_watcher(payload, correlation_id, &current_config).await
                    }
                }
            }
        ).await;
        
        let processing_time = start_time.elapsed().as_millis() as u64;
        
        match result {
            Ok(tier_result) => {
                match tier_result {
                    Ok(processing_result) => {
                        // End correlation tracking with success
                        self.tier_monitor.end_correlation_success(correlation_id, None).await;
                        
                        self.record_tier_success(selected_tier, processing_time).await;
                        
                        crate::log_tier_success!(
                            selected_tier.as_str(),
                            correlation_id,
                            processing_time,
                            processing_tier = selected_tier.as_str()
                        );
                        
                        Ok(processing_result)
                    }
                    Err(e) => {
                        // End correlation tracking with failure
                        self.tier_monitor.end_correlation_failure(correlation_id, &e.to_string()).await;
                        
                        self.record_tier_failure(selected_tier, e.to_string()).await;
                        
                        crate::log_tier_failure!(
                            selected_tier.as_str(),
                            correlation_id,
                            e,
                            processing_tier = selected_tier.as_str(),
                            processing_time_ms = processing_time
                        );
                        
                        Err(e)
                    }
                }
            }
            Err(_timeout_error) => {
                let timeout_error = format!("{} tier timeout after {}ms (limit: {}ms)", 
                                          selected_tier.as_str(), 
                                          processing_time,
                                          timeout_to_use.as_millis());
                
                // End correlation tracking with timeout failure
                self.tier_monitor.end_correlation_failure(correlation_id, &timeout_error).await;
                
                self.record_tier_failure(selected_tier, timeout_error.clone()).await;
                
                warn!("⏰ [ORCHESTRATOR] {} - triggering graceful degradation", timeout_error);
                
                crate::log_tier_failure!(
                    selected_tier.as_str(),
                    correlation_id,
                    timeout_error.clone(),
                    processing_tier = selected_tier.as_str(),
                    processing_time_ms = processing_time
                );
                
                Err(timeout_error.into())
            }
        }
    }

    async fn process_with_mcp_webhook(&self, 
        _payload: ResponsePayload, 
        correlation_id: &str,
        config: &Config
    ) -> Result<ProcessingResult, Box<dyn std::error::Error + Send + Sync>> {
        // Simulate MCP webhook processing
        // In real implementation, this would make HTTP request to MCP server
        
        info!("📡 [TIER-1-MCP] Processing webhook request (correlation: {})", correlation_id);
        
        // Use configured timeout instead of hardcoded value
        let webhook_timeout = config.get_tier_timeout(TierType::McpWebhook);
        
        // Simulate processing time (should be less than configured timeout)
        let simulated_processing_time = std::cmp::min(50, webhook_timeout.as_millis() as u64 / 2);
        tokio::time::sleep(Duration::from_millis(simulated_processing_time)).await;
                
        Ok(ProcessingResult {
            success: true,
            action: "approve".to_string(), // Parse from payload.callback_data
            task_id: "webhook-test".to_string(),
            processing_time_ms: simulated_processing_time,
            acknowledgment_sent: true,
            tier: TierType::McpWebhook.as_str().to_string(),
            correlation_id: correlation_id.to_string(),
            error: None,
        })
    }

    async fn process_with_bridge_internal(&self, 
        payload: ResponsePayload, 
        correlation_id: &str,
        _config: &Config
    ) -> Result<ProcessingResult, Box<dyn std::error::Error + Send + Sync>> {
        info!("🔧 [TIER-2-BRIDGE] Processing internal request (correlation: {})", correlation_id);
        
        // Use the actual internal processor
        let mut result = self.internal_processor.process_response(payload).await;
        result.correlation_id = correlation_id.to_string();
        
        Ok(result)
    }

    async fn process_with_file_watcher(&self, 
        payload: ResponsePayload, 
        correlation_id: &str,
        config: &Config
    ) -> Result<ProcessingResult, Box<dyn std::error::Error + Send + Sync>> {
        info!("📁 [TIER-3-FILE] Processing file watcher request (correlation: {})", correlation_id);
        
        match &self.file_tier_processor {
            Some(processor) => {
                // Use actual file tier processor
                let start_time = Instant::now();
                
                // Queue the response for processing
                let _entry_id = processor.queue_response(payload, correlation_id).await
                    .map_err(|e| format!("Failed to queue response: {}", e))?;
                
                // Use configured timeout and debounce settings
                let file_timeout = config.get_tier_timeout(TierType::FileWatcher);
                let poll_interval = Duration::from_millis(config.timeouts.file_watcher_debounce_ms);
                let max_attempts = (file_timeout.as_millis() / poll_interval.as_millis()).max(1) as u32;
                
                let mut attempts = 0;
                while attempts < max_attempts {
                    // Process any debounced events
                    let results = processor.process_debounced_events().await
                        .map_err(|e| format!("Failed to process debounced events: {}", e))?;
                    
                    // Check if our entry was processed
                    for result in results {
                        if result.correlation_id == correlation_id {
                            info!("✅ [TIER-3-FILE] File watcher processing completed for correlation: {} in {} attempts", 
                                  correlation_id, attempts + 1);
                            return Ok(result);
                        }
                    }
                    
                    attempts += 1;
                    tokio::time::sleep(poll_interval).await;
                }
                
                // If we get here, processing timed out - return a timeout result
                warn!("⏰ [TIER-3-FILE] File watcher processing timed out for correlation: {}", correlation_id);
                Ok(ProcessingResult {
                    success: false,
                    action: "timeout".to_string(),
                    task_id: correlation_id.to_string(),
                    processing_time_ms: start_time.elapsed().as_millis() as u64,
                    acknowledgment_sent: false,
                    tier: TierType::FileWatcher.as_str().to_string(),
                    correlation_id: correlation_id.to_string(),
                    error: Some("Processing timeout".to_string()),
                })
            }
            None => {
                // Fall back to simulation if file tier processor not available
                warn!("⚠️ [TIER-3-FILE] File tier processor not available, using simulation");
                tokio::time::sleep(Duration::from_millis(1500)).await;
                
                Ok(ProcessingResult {
                    success: true,
                    action: "acknowledge".to_string(),
                    task_id: "file-watcher-simulation".to_string(),
                    processing_time_ms: 1500,
                    acknowledgment_sent: true,
                    tier: TierType::FileWatcher.as_str().to_string(),
                    correlation_id: correlation_id.to_string(),
                    error: None,
                })
            }
        }
    }

    pub async fn process_with_failover(&self, payload: ResponsePayload) -> ProcessingResult {
        let correlation_id = payload.correlation_id.clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        
        let selection = self.select_tier(&correlation_id).await;
        let mut current_tier = selection.selected_tier;
        let mut attempted_tiers = vec![current_tier];
        
        // Try primary tier first
        match self.process_with_tier(payload.clone(), current_tier, &correlation_id).await {
            Ok(result) => return result,
            Err(e) => {
                warn!("⚠️ [ORCHESTRATOR] {} tier failed: {}", current_tier.as_str(), e);
                self.record_failover_event(current_tier, &correlation_id, Some(e.to_string())).await;
            }
        }
        
        // Try fallback tiers
        for fallback_tier in selection.fallback_tiers {
            if attempted_tiers.contains(&fallback_tier) {
                continue;
            }
            
            attempted_tiers.push(fallback_tier);
            
            info!("🔄 [ORCHESTRATOR] Failing over to {} tier", fallback_tier.as_str());
            
            match self.process_with_tier(payload.clone(), fallback_tier, &correlation_id).await {
                Ok(result) => {
                    self.record_failover_event(current_tier, &correlation_id, None).await;
                    return result;
                }
                Err(e) => {
                    warn!("⚠️ [ORCHESTRATOR] {} fallback failed: {}", fallback_tier.as_str(), e);
                    current_tier = fallback_tier;
                }
            }
        }
        
        // All tiers failed - return error result
        error!("❌ [ORCHESTRATOR] All {} tiers failed for correlation: {}", 
               attempted_tiers.len(), correlation_id);
        
        ProcessingResult {
            success: false,
            action: "unknown".to_string(),
            task_id: "failed".to_string(),
            processing_time_ms: 0,
            acknowledgment_sent: false,
            tier: "orchestrator_failure".to_string(),
            correlation_id,
            error: Some("All tiers failed".to_string()),
        }
    }

    async fn record_tier_request(&self, tier_type: TierType) {
        let mut stats = self.statistics.write().await;
        stats.total_requests += 1;
        *stats.tier_requests.entry(tier_type).or_insert(0) += 1;
    }

    async fn record_tier_success(&self, tier_type: TierType, response_time_ms: u64) {
        let mut stats = self.statistics.write().await;
        *stats.tier_successes.entry(tier_type).or_insert(0) += 1;
        
        // Update average response time
        let current_avg = stats.average_response_times.get(&tier_type).copied().unwrap_or(0);
        let success_count = stats.tier_successes.get(&tier_type).copied().unwrap_or(1);
        let new_avg = ((current_avg * (success_count - 1)) + response_time_ms) / success_count;
        stats.average_response_times.insert(tier_type, new_avg);
        
        // Update tier health
        let mut tier_health = self.tier_health.write().await;
        if let Some(health) = tier_health.iter_mut().find(|h| h.tier_type == tier_type) {
            health.consecutive_failures = 0;
            health.response_time_ms = Some(response_time_ms);
            health.last_check = Utc::now();
            health.is_healthy = true;
            
            // Update success rate
            let total_requests = stats.tier_requests.get(&tier_type).copied().unwrap_or(1);
            let successes = stats.tier_successes.get(&tier_type).copied().unwrap_or(0);
            health.success_rate = successes as f64 / total_requests as f64;
        }
    }

    async fn record_tier_failure(&self, tier_type: TierType, _error: String) {
        let mut stats = self.statistics.write().await;
        *stats.tier_failures.entry(tier_type).or_insert(0) += 1;
        
        // Get current configuration for consecutive failure threshold
        let current_config = if let Some(config_manager) = &self.config_manager {
            config_manager.get_config().await
        } else {
            (*self.config).clone()
        };
        
        // Update tier health
        let mut tier_health = self.tier_health.write().await;
        if let Some(health) = tier_health.iter_mut().find(|h| h.tier_type == tier_type) {
            health.consecutive_failures += 1;
            health.last_check = Utc::now();
            
            // Mark as unhealthy after configured consecutive failures
            let max_failures = current_config.tier_configuration.max_consecutive_failures;
            if health.consecutive_failures >= max_failures {
                health.is_healthy = false;
                health.circuit_breaker_state = CircuitBreakerState::Open;
                warn!("⚠️ [ORCHESTRATOR] {} tier marked unhealthy after {} failures (threshold: {})", 
                      tier_type.as_str(), health.consecutive_failures, max_failures);
            }
            
            // Update success rate
            let total_requests = stats.tier_requests.get(&tier_type).copied().unwrap_or(1);
            let successes = stats.tier_successes.get(&tier_type).copied().unwrap_or(0);
            health.success_rate = successes as f64 / total_requests as f64;
        }
    }

    async fn record_failover_event(&self, from_tier: TierType, correlation_id: &str, error: Option<String>) {
        let mut events = self.failover_events.write().await;
        let mut stats = self.statistics.write().await;
        
        // Determine target tier (next available)
        let tier_health = self.tier_health.read().await;
        let to_tier = tier_health
            .iter()
            .filter(|h| h.tier_type != from_tier && h.is_healthy)
            .min_by_key(|h| h.tier_type.priority())
            .map(|h| h.tier_type)
            .unwrap_or(TierType::FileWatcher);
        
        let reason = error.unwrap_or_else(|| "Health check failure".to_string());
        
        let event = TierFailoverEvent {
            from_tier,
            to_tier,
            reason: reason.clone(),
            timestamp: Utc::now(),
            correlation_id: correlation_id.to_string(),
            processing_result: None,
        };
        
        events.push(event);
        stats.failover_count += 1;
        
        // Record failover in tier monitor
        self.tier_monitor.record_failover(from_tier, to_tier, correlation_id, &reason).await;
        
        crate::log_failover_event!(
            from_tier.as_str(),
            to_tier.as_str(),
            correlation_id,
            reason
        );
    }

    pub async fn get_tier_health(&self) -> Vec<TierHealth> {
        self.tier_health.read().await.clone()
    }

    pub async fn get_statistics(&self) -> TierStatistics {
        self.statistics.read().await.clone()
    }

    pub async fn get_failover_events(&self, limit: Option<usize>) -> Vec<TierFailoverEvent> {
        let events = self.failover_events.read().await;
        match limit {
            Some(n) => events.iter().rev().take(n).cloned().collect(),
            None => events.clone(),
        }
    }

    // Health check methods
    pub async fn perform_health_checks(&self) {
        info!("🔍 [ORCHESTRATOR] Performing tier health checks...");
        
        // Perform health checks sequentially for simplicity
        self.check_mcp_webhook_health().await;
        self.check_bridge_internal_health().await;
        self.check_file_watcher_health().await;
        
        debug!("✅ [ORCHESTRATOR] Health checks completed");
    }

    async fn check_mcp_webhook_health(&self) {
        // Simulate MCP webhook health check
        // In real implementation, this would make HTTP request to webhook endpoint
        let is_healthy = true; // Simulate healthy state
        let response_time = 45; // Simulate 45ms response time
        
        self.update_tier_health(TierType::McpWebhook, is_healthy, Some(response_time)).await;
    }

    async fn check_bridge_internal_health(&self) {
        // Check internal processor health
        let is_healthy = true; // Internal processor is always available
        let response_time = 150; // Simulate 150ms response time
        
        self.update_tier_health(TierType::BridgeInternal, is_healthy, Some(response_time)).await;
    }

    async fn check_file_watcher_health(&self) {
        // File watcher is always available as final fallback
        let is_healthy = true;
        let response_time = 2000; // Simulate 2s response time
        
        self.update_tier_health(TierType::FileWatcher, is_healthy, Some(response_time)).await;
    }

    async fn update_tier_health(&self, tier_type: TierType, is_healthy: bool, response_time_ms: Option<u64>) {
        let mut tier_health = self.tier_health.write().await;
        if let Some(health) = tier_health.iter_mut().find(|h| h.tier_type == tier_type) {
            health.is_healthy = is_healthy;
            health.last_check = Utc::now();
            health.response_time_ms = response_time_ms;
            
            if is_healthy {
                health.consecutive_failures = 0;
                health.circuit_breaker_state = CircuitBreakerState::Closed;
            }
        }
    }
    
    // File tier specific methods
    pub async fn get_file_tier_metrics(&self) -> Option<crate::events::file_tier::FileWatcherMetrics> {
        match &self.file_tier_processor {
            Some(processor) => Some(processor.get_metrics().await),
            None => None,
        }
    }
    
    pub async fn get_file_tier_queue_status(&self) -> Option<(usize, usize, usize)> {
        match &self.file_tier_processor {
            Some(processor) => processor.get_queue_status().await.ok(),
            None => None,
        }
    }
    
    pub async fn cleanup_file_tier_entries(&self, max_age_days: u32) -> Option<usize> {
        match &self.file_tier_processor {
            Some(processor) => processor.cleanup_old_entries(max_age_days).await.ok(),
            None => None,
        }
    }
    
    pub fn has_file_tier(&self) -> bool {
        self.file_tier_processor.is_some()
    }

    /// Get the current configuration (may be updated via hot-reload)
    pub async fn get_current_config(&self) -> Config {
        if let Some(config_manager) = &self.config_manager {
            config_manager.get_config().await
        } else {
            (*self.config).clone()
        }
    }

    /// Update timeout for a specific tier dynamically
    pub async fn update_tier_timeout(&self, tier_type: TierType, timeout_ms: u64) -> anyhow::Result<()> {
        if let Some(config_manager) = &self.config_manager {
            config_manager.update_timeout(tier_type, timeout_ms).await?;
            info!("⚙️ [ORCHESTRATOR] Updated {} tier timeout to {}ms", tier_type.as_str(), timeout_ms);
        } else {
            warn!("⚠️ [ORCHESTRATOR] Cannot update timeout - no configuration manager available");
        }
        Ok(())
    }

    /// Enable or disable a tier dynamically
    pub async fn set_tier_enabled(&self, tier_type: TierType, enabled: bool) -> anyhow::Result<()> {
        if let Some(config_manager) = &self.config_manager {
            config_manager.set_tier_enabled(tier_type, enabled).await?;
            info!("⚙️ [ORCHESTRATOR] {} tier {}", 
                  tier_type.as_str(), 
                  if enabled { "enabled ✓" } else { "disabled ✗" });
        } else {
            warn!("⚠️ [ORCHESTRATOR] Cannot update tier state - no configuration manager available");
        }
        Ok(())
    }

    /// Trigger auto-recovery for tiers if enabled
    pub async fn trigger_auto_recovery(&self) -> anyhow::Result<()> {
        let current_config = self.get_current_config().await;
        
        if !current_config.tier_configuration.enable_auto_recovery {
            debug!("🔄 [ORCHESTRATOR] Auto-recovery disabled in configuration");
            return Ok(());
        }

        let recovery_timeout = Duration::from_millis(current_config.timeouts.circuit_breaker_recovery_timeout_ms);
        let mut tier_health = self.tier_health.write().await;
        let now = Utc::now();

        let mut recovered_tiers = Vec::new();

        for health in tier_health.iter_mut() {
            if health.circuit_breaker_state == CircuitBreakerState::Open {
                let time_since_failure = now.signed_duration_since(health.last_check);
                
                if time_since_failure >= chrono::Duration::from_std(recovery_timeout).unwrap_or_default() {
                    health.circuit_breaker_state = CircuitBreakerState::HalfOpen;
                    health.consecutive_failures = 0;
                    health.is_healthy = true; // Allow testing
                    recovered_tiers.push(health.tier_type);
                    
                    info!("🔄 [ORCHESTRATOR] {} tier circuit breaker set to half-open for recovery testing", 
                          health.tier_type.as_str());
                }
            }
        }

        if !recovered_tiers.is_empty() {
            info!("✅ [ORCHESTRATOR] Auto-recovery triggered for {} tiers: {:?}", 
                  recovered_tiers.len(), recovered_tiers);
        }

        Ok(())
    }

    
    // Monitoring and observability methods
    
    /// Get comprehensive health check with detailed tier status
    pub async fn get_comprehensive_health_check(&self) -> anyhow::Result<crate::utils::monitoring::TierHealthCheck> {
        // Update tier monitor with current health
        let tier_health = self.get_tier_health().await;
        self.tier_monitor.update_tier_health(tier_health).await;
        
        // Update queue depths if file tier is available
        if let Some((queue_count, _, _)) = self.get_file_tier_queue_status().await {
            self.tier_monitor.update_queue_depth(TierType::FileWatcher, queue_count).await;
        }
        
        self.tier_monitor.get_health_check().await
    }
    
    /// Export all monitoring metrics in Prometheus format
    pub fn export_prometheus_metrics(&self) -> anyhow::Result<String> {
        self.tier_monitor.export_prometheus_metrics()
    }
    
    /// Get tier-specific monitoring instance
    pub fn get_tier_monitor(&self) -> Arc<TierMonitor> {
        Arc::clone(&self.tier_monitor)
    }
    
    /// Start background monitoring tasks
    pub async fn start_monitoring_tasks(&self) -> anyhow::Result<()> {
        let tier_monitor = Arc::clone(&self.tier_monitor);
        let tier_health = Arc::clone(&self.tier_health);
        
        // Start health check updater task
        let _health_updater = {
            let tier_monitor = Arc::clone(&tier_monitor);
            let tier_health = Arc::clone(&tier_health);
            
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(30));
                
                loop {
                    interval.tick().await;
                    
                    // Update tier monitor with current health
                    let current_health = tier_health.read().await.clone();
                    tier_monitor.update_tier_health(current_health).await;
                    
                    debug!("🔍 [ORCHESTRATOR] Updated tier monitor with current health status");
                }
            })
        };
        
        info!("🚀 [ORCHESTRATOR] Started background monitoring tasks");
        Ok(())
    }
    
    pub async fn start_file_tier_background_processor(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        match &self.file_tier_processor {
            Some(processor) => {
                let processor_clone = Arc::clone(processor);
                tokio::spawn(async move {
                    if let Err(e) = processor_clone.run_background_processor().await {
                        error!("❌ [TIER-3-FILE] Background processor error: {}", e);
                    }
                });
                info!("🚀 [ORCHESTRATOR] File tier background processor started");
                Ok(())
            }
            None => Err("File tier processor not initialized".into()),
        }
    }
}
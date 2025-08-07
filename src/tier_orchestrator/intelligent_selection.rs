/**
 * Task 36.1: Intelligent Tier Selection with Load Balancing
 * Advanced tier selection algorithms based on multiple factors
 */

use std::collections::HashMap;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::tier_orchestrator::core::{TierType, TierHealth, CircuitBreakerState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SelectionStrategy {
    #[serde(rename = "priority_based")]
    PriorityBased,
    #[serde(rename = "performance_weighted")]
    PerformanceWeighted,
    #[serde(rename = "load_balanced")]
    LoadBalanced,
    #[serde(rename = "adaptive")]
    Adaptive,
    #[serde(rename = "cost_optimized")]
    CostOptimized,
}

#[derive(Debug, Clone, Serialize)]
pub struct TierScore {
    pub tier_type: TierType,
    pub total_score: f64,
    pub performance_score: f64,
    pub availability_score: f64,
    pub load_score: f64,
    pub cost_score: f64,
    pub priority_bonus: f64,
    pub selection_reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SelectionContext {
    pub message_priority: MessagePriority,
    pub message_size: Option<usize>,
    pub recipient_availability: RecipientAvailability,
    pub system_load: SystemLoad,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MessagePriority {
    #[serde(rename = "critical")]
    Critical,
    #[serde(rename = "high")]
    High,
    #[serde(rename = "normal")]
    Normal,
    #[serde(rename = "low")]
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecipientAvailability {
    #[serde(rename = "online")]
    Online,
    #[serde(rename = "recent")]
    Recent,
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "unknown")]
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemLoad {
    pub cpu_usage_percent: f32,
    pub memory_usage_percent: f32,
    pub active_connections: u32,
    pub queue_depth: u32,
}

#[derive(Debug)]
pub struct IntelligentTierSelector {
    strategy: SelectionStrategy,
    historical_performance: HashMap<TierType, PerformanceHistory>,
    load_balancer: LoadBalancer,
}

#[derive(Debug, Clone, Default)]
pub struct PerformanceHistory {
    pub success_rate_1h: f64,
    pub success_rate_24h: f64,
    pub avg_response_time_1h: Duration,
    pub avg_response_time_24h: Duration,
    pub last_failure_time: Option<chrono::DateTime<chrono::Utc>>,
    pub failure_frequency: f64, // failures per hour
    pub load_capacity: f64,     // estimated max concurrent requests
}

#[derive(Debug)]
pub struct LoadBalancer {
    tier_weights: HashMap<TierType, f64>,
    current_loads: HashMap<TierType, u32>,
    max_concurrent: HashMap<TierType, u32>,
}

impl IntelligentTierSelector {
    pub fn new(strategy: SelectionStrategy) -> Self {
        Self {
            strategy,
            historical_performance: HashMap::new(),
            load_balancer: LoadBalancer::new(),
        }
    }

    pub async fn select_optimal_tier(
        &self,
        tier_health: &[TierHealth],
        config: &Config,
        context: &SelectionContext,
    ) -> Vec<TierScore> {
        match self.strategy {
            SelectionStrategy::PriorityBased => {
                self.priority_based_selection(tier_health, config).await
            }
            SelectionStrategy::PerformanceWeighted => {
                self.performance_weighted_selection(tier_health, config, context).await
            }
            SelectionStrategy::LoadBalanced => {
                self.load_balanced_selection(tier_health, config, context).await
            }
            SelectionStrategy::Adaptive => {
                self.adaptive_selection(tier_health, config, context).await
            }
            SelectionStrategy::CostOptimized => {
                self.cost_optimized_selection(tier_health, config, context).await
            }
        }
    }

    async fn priority_based_selection(
        &self,
        tier_health: &[TierHealth],
        config: &Config,
    ) -> Vec<TierScore> {
        let mut scores = Vec::new();

        for health in tier_health {
            if !self.is_tier_selectable(health, config) {
                continue;
            }

            let priority_bonus = match health.tier_type.priority() {
                1 => 100.0,  // McpWebhook
                2 => 75.0,   // BridgeInternal
                3 => 50.0,   // FileWatcher
                _ => 0.0,
            };

            let availability_score = if health.is_healthy && 
                health.circuit_breaker_state == CircuitBreakerState::Closed {
                100.0
            } else if health.circuit_breaker_state == CircuitBreakerState::HalfOpen {
                60.0
            } else {
                10.0
            };

            let score = TierScore {
                tier_type: health.tier_type,
                total_score: priority_bonus + availability_score * 0.5,
                performance_score: health.success_rate * 100.0,
                availability_score,
                load_score: 50.0, // Neutral for priority-based
                cost_score: 50.0,  // Not considered
                priority_bonus,
                selection_reason: format!("Priority-based (rank {})", health.tier_type.priority()),
            };

            scores.push(score);
        }

        scores.sort_by(|a, b| b.total_score.partial_cmp(&a.total_score).unwrap());
        scores
    }

    async fn performance_weighted_selection(
        &self,
        tier_health: &[TierHealth],
        config: &Config,
        context: &SelectionContext,
    ) -> Vec<TierScore> {
        let mut scores = Vec::new();

        for health in tier_health {
            if !self.is_tier_selectable(health, config) {
                continue;
            }

            let performance_score = self.calculate_performance_score(health, context);
            let availability_score = self.calculate_availability_score(health);
            let load_score = self.calculate_load_score(health.tier_type, context);

            // Weight factors based on message priority
            let (perf_weight, avail_weight, load_weight) = match context.message_priority {
                MessagePriority::Critical => (0.5, 0.4, 0.1),
                MessagePriority::High => (0.4, 0.4, 0.2),
                MessagePriority::Normal => (0.3, 0.4, 0.3),
                MessagePriority::Low => (0.2, 0.3, 0.5),
            };

            let total_score = performance_score * perf_weight + 
                            availability_score * avail_weight + 
                            load_score * load_weight;

            let score = TierScore {
                tier_type: health.tier_type,
                total_score,
                performance_score,
                availability_score,
                load_score,
                cost_score: 50.0,
                priority_bonus: 0.0,
                selection_reason: format!("Performance-weighted (P:{:.1} A:{:.1} L:{:.1})", 
                                        performance_score, availability_score, load_score),
            };

            scores.push(score);
        }

        scores.sort_by(|a, b| b.total_score.partial_cmp(&a.total_score).unwrap());
        scores
    }

    async fn load_balanced_selection(
        &self,
        tier_health: &[TierHealth],
        config: &Config,
        context: &SelectionContext,
    ) -> Vec<TierScore> {
        let mut scores = Vec::new();

        for health in tier_health {
            if !self.is_tier_selectable(health, config) {
                continue;
            }

            let load_score = self.calculate_load_score(health.tier_type, context);
            let capacity_utilization = self.load_balancer.get_capacity_utilization(health.tier_type);
            
            // Favor tiers with lower utilization
            let balance_score = (1.0 - capacity_utilization) * 100.0;
            let availability_score = self.calculate_availability_score(health);

            let total_score = balance_score * 0.5 + availability_score * 0.3 + load_score * 0.2;

            let score = TierScore {
                tier_type: health.tier_type,
                total_score,
                performance_score: health.success_rate * 100.0,
                availability_score,
                load_score: balance_score,
                cost_score: 50.0,
                priority_bonus: 0.0,
                selection_reason: format!("Load-balanced (util: {:.1}%)", capacity_utilization * 100.0),
            };

            scores.push(score);
        }

        scores.sort_by(|a, b| b.total_score.partial_cmp(&a.total_score).unwrap());
        scores
    }

    async fn adaptive_selection(
        &self,
        tier_health: &[TierHealth],
        config: &Config,
        context: &SelectionContext,
    ) -> Vec<TierScore> {
        // Adaptive strategy chooses the best approach based on current conditions
        let system_load = &context.system_load;
        
        let strategy = if system_load.cpu_usage_percent > 80.0 || system_load.memory_usage_percent > 85.0 {
            // High system load - prioritize efficiency
            debug!("🧠 [ADAPTIVE] High system load detected, using load-balanced strategy");
            SelectionStrategy::LoadBalanced
        } else if context.message_priority == MessagePriority::Critical {
            // Critical messages - prioritize speed and reliability
            debug!("🧠 [ADAPTIVE] Critical message detected, using performance-weighted strategy");
            SelectionStrategy::PerformanceWeighted
        } else {
            // Normal conditions - use priority-based
            debug!("🧠 [ADAPTIVE] Normal conditions, using priority-based strategy");
            SelectionStrategy::PriorityBased
        };

        // Apply the chosen strategy directly to avoid recursion
        let mut scores = match strategy {
            SelectionStrategy::LoadBalanced => {
                self.load_balanced_selection(tier_health, config, context).await
            }
            SelectionStrategy::PerformanceWeighted => {
                self.performance_weighted_selection(tier_health, config, context).await
            }
            SelectionStrategy::PriorityBased => {
                self.priority_based_selection(tier_health, config).await
            }
            _ => {
                // Default to priority-based for unsupported strategies in adaptive mode
                self.priority_based_selection(tier_health, config).await
            }
        };

        // Add adaptive reasoning
        for score in &mut scores {
            score.selection_reason = format!("Adaptive -> {}", score.selection_reason);
        }

        scores
    }

    async fn cost_optimized_selection(
        &self,
        tier_health: &[TierHealth],
        config: &Config,
        context: &SelectionContext,
    ) -> Vec<TierScore> {
        let mut scores = Vec::new();

        for health in tier_health {
            if !self.is_tier_selectable(health, config) {
                continue;
            }

            let cost_score = self.calculate_cost_score(health.tier_type, context);
            let availability_score = self.calculate_availability_score(health);
            let performance_score = self.calculate_performance_score(health, context);

            // Balance cost efficiency with minimum acceptable performance
            let min_performance_threshold = 70.0;
            let performance_penalty = if performance_score < min_performance_threshold {
                (min_performance_threshold - performance_score) * 2.0
            } else {
                0.0
            };

            let total_score = cost_score * 0.5 + availability_score * 0.3 + 
                            performance_score * 0.2 - performance_penalty;

            let score = TierScore {
                tier_type: health.tier_type,
                total_score,
                performance_score,
                availability_score,
                load_score: 50.0,
                cost_score,
                priority_bonus: 0.0,
                selection_reason: format!("Cost-optimized (cost: {:.1}, perf: {:.1})", 
                                        cost_score, performance_score),
            };

            scores.push(score);
        }

        scores.sort_by(|a, b| b.total_score.partial_cmp(&a.total_score).unwrap());
        scores
    }

    fn is_tier_selectable(&self, health: &TierHealth, config: &Config) -> bool {
        config.is_tier_enabled(health.tier_type) && 
        (health.is_healthy || health.circuit_breaker_state == CircuitBreakerState::HalfOpen)
    }

    fn calculate_performance_score(&self, health: &TierHealth, context: &SelectionContext) -> f64 {
        let base_score = health.success_rate * 100.0;
        
        // Response time factor
        let response_time_score = match health.response_time_ms {
            Some(rt) => {
                let target_time = health.tier_type.timeout_ms() as f64 * 0.5; // 50% of timeout as target
                if rt as f64 <= target_time {
                    100.0
                } else {
                    (100.0 - (rt as f64 - target_time) / target_time * 50.0).max(0.0)
                }
            }
            None => 50.0, // Neutral score if no data
        };

        // Consecutive failures penalty
        let failure_penalty = (health.consecutive_failures as f64).min(10.0) * 5.0;

        // Historical performance bonus (if available)
        let history_bonus = if let Some(history) = self.historical_performance.get(&health.tier_type) {
            history.success_rate_1h * 10.0
        } else {
            0.0
        };

        // Message size consideration for certain tiers
        let size_factor = match context.message_size {
            Some(size) if size > 1000 && health.tier_type == TierType::McpWebhook => 0.9, // Slight penalty for large messages on webhook
            _ => 1.0,
        };

        ((base_score + response_time_score) * 0.5 + history_bonus - failure_penalty) * size_factor
    }

    fn calculate_availability_score(&self, health: &TierHealth) -> f64 {
        match health.circuit_breaker_state {
            CircuitBreakerState::Closed if health.is_healthy => 100.0,
            CircuitBreakerState::Closed => 80.0,
            CircuitBreakerState::HalfOpen => 60.0,
            CircuitBreakerState::Open => 10.0,
        }
    }

    fn calculate_load_score(&self, tier_type: TierType, context: &SelectionContext) -> f64 {
        let capacity_utilization = self.load_balancer.get_capacity_utilization(tier_type);
        let system_load_factor = 1.0 - (context.system_load.cpu_usage_percent / 100.0) as f64;
        
        ((1.0 - capacity_utilization) * 100.0) * system_load_factor
    }

    fn calculate_cost_score(&self, tier_type: TierType, _context: &SelectionContext) -> f64 {
        // Cost estimation based on tier characteristics
        match tier_type {
            TierType::FileWatcher => 100.0,      // Lowest cost - local file operations
            TierType::BridgeInternal => 80.0,    // Medium cost - internal processing
            TierType::McpWebhook => 60.0,        // Higher cost - external HTTP requests
        }
    }

    pub fn update_performance_history(&mut self, tier_type: TierType, success: bool, response_time: Duration) {
        let history = self.historical_performance.entry(tier_type).or_default();
        
        // Update rolling averages (simplified - in production would use proper sliding windows)
        if success {
            history.success_rate_1h = (history.success_rate_1h * 0.95) + (1.0 * 0.05);
        } else {
            history.success_rate_1h = history.success_rate_1h * 0.95;
            history.last_failure_time = Some(chrono::Utc::now());
            history.failure_frequency += 0.1;
        }
        
        let rt_ms = response_time.as_millis() as f64;
        history.avg_response_time_1h = Duration::from_millis(
            ((history.avg_response_time_1h.as_millis() as f64 * 0.95) + (rt_ms * 0.05)) as u64
        );
    }

    pub fn update_load_balancer(&mut self, tier_type: TierType, active_requests: u32) {
        self.load_balancer.update_load(tier_type, active_requests);
    }

    pub fn get_selection_strategy(&self) -> &SelectionStrategy {
        &self.strategy
    }

    pub fn set_selection_strategy(&mut self, strategy: SelectionStrategy) {
        info!("🧠 [INTELLIGENT_SELECTOR] Switching selection strategy from {:?} to {:?}", 
              self.strategy, strategy);
        self.strategy = strategy;
    }
}

impl LoadBalancer {
    pub fn new() -> Self {
        let mut max_concurrent = HashMap::new();
        max_concurrent.insert(TierType::McpWebhook, 50);      // HTTP connection limits
        max_concurrent.insert(TierType::BridgeInternal, 100); // Internal processing capacity
        max_concurrent.insert(TierType::FileWatcher, 20);     // File I/O limitations

        Self {
            tier_weights: HashMap::new(),
            current_loads: HashMap::new(),
            max_concurrent,
        }
    }

    pub fn update_load(&mut self, tier_type: TierType, active_requests: u32) {
        self.current_loads.insert(tier_type, active_requests);
    }

    pub fn get_capacity_utilization(&self, tier_type: TierType) -> f64 {
        let current = self.current_loads.get(&tier_type).copied().unwrap_or(0);
        let max = self.max_concurrent.get(&tier_type).copied().unwrap_or(100);
        
        (current as f64) / (max as f64)
    }

    pub fn can_accept_request(&self, tier_type: TierType) -> bool {
        let utilization = self.get_capacity_utilization(tier_type);
        utilization < 0.95 // 95% capacity threshold
    }
}

impl Default for SelectionStrategy {
    fn default() -> Self {
        SelectionStrategy::Adaptive
    }
}

impl MessagePriority {
    pub fn from_payload_data(data: &serde_json::Value) -> Self {
        data.get("priority")
            .and_then(|p| p.as_str())
            .and_then(|s| match s {
                "critical" => Some(MessagePriority::Critical),
                "high" => Some(MessagePriority::High),
                "normal" => Some(MessagePriority::Normal),
                "low" => Some(MessagePriority::Low),
                _ => None,
            })
            .unwrap_or(MessagePriority::Normal)
    }
}

impl SystemLoad {
    pub fn current() -> Self {
        // In production, this would gather real system metrics
        Self {
            cpu_usage_percent: 45.0,
            memory_usage_percent: 60.0,
            active_connections: 25,
            queue_depth: 12,
        }
    }
}
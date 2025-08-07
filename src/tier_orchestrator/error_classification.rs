/**
 * Task 36.2: Advanced Error Classification and Recovery System
 * Comprehensive error taxonomy with automatic classification and intelligent recovery
 */

use std::collections::HashMap;
use std::time::{Duration, SystemTime};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn, error};
use chrono::{DateTime, Utc};

use crate::tier_orchestrator::core::TierType;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ErrorCategory {
    #[serde(rename = "network")]
    Network,
    #[serde(rename = "timeout")]
    Timeout,
    #[serde(rename = "authentication")]
    Authentication,
    #[serde(rename = "authorization")]
    Authorization,
    #[serde(rename = "rate_limit")]
    RateLimit,
    #[serde(rename = "resource")]
    Resource,
    #[serde(rename = "validation")]
    Validation,
    #[serde(rename = "configuration")]
    Configuration,
    #[serde(rename = "external_service")]
    ExternalService,
    #[serde(rename = "system")]
    System,
    #[serde(rename = "unknown")]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ErrorSeverity {
    #[serde(rename = "critical")]
    Critical,    // System-threatening, immediate action required
    #[serde(rename = "high")]
    High,        // Significant impact, urgent attention needed
    #[serde(rename = "medium")]
    Medium,      // Moderate impact, should be addressed
    #[serde(rename = "low")]
    Low,         // Minor impact, can be deferred
    #[serde(rename = "info")]
    Info,        // Informational, no action needed
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum RecoveryStrategy {
    #[serde(rename = "immediate_retry")]
    ImmediateRetry,
    #[serde(rename = "exponential_backoff")]
    ExponentialBackoff,
    #[serde(rename = "circuit_breaker")]
    CircuitBreaker,
    #[serde(rename = "fallback_tier")]
    FallbackTier,
    #[serde(rename = "escalate")]
    Escalate,
    #[serde(rename = "ignore")]
    Ignore,
    #[serde(rename = "manual_intervention")]
    ManualIntervention,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClassifiedError {
    pub original_error: String,
    pub category: ErrorCategory,
    pub severity: ErrorSeverity,
    pub tier_type: TierType,
    pub correlation_id: String,
    pub timestamp: DateTime<Utc>,
    pub error_code: Option<String>,
    pub context: HashMap<String, String>,
    pub recovery_strategies: Vec<RecoveryStrategy>,
    pub recommended_action: String,
    pub escalation_threshold: u32,
    pub retry_config: RetryConfig,
    pub similar_errors_count: u32,
    pub last_occurrence: DateTime<Utc>,
    pub pattern_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub initial_delay: Duration,
    pub max_delay: Duration,
    pub backoff_multiplier: f64,
    pub jitter: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorPattern {
    pub pattern_id: String,
    pub category: ErrorCategory,
    pub frequency: u32,
    pub last_seen: DateTime<Utc>,
    pub affected_tiers: Vec<TierType>,
    pub success_rate_after_recovery: f64,
    pub average_recovery_time: Duration,
    pub trend: ErrorTrend,
}

#[derive(Debug, Clone, Serialize)]
pub enum ErrorTrend {
    #[serde(rename = "increasing")]
    Increasing,
    #[serde(rename = "decreasing")]
    Decreasing,
    #[serde(rename = "stable")]
    Stable,
    #[serde(rename = "sporadic")]
    Sporadic,
}

#[derive(Debug)]
pub struct ErrorClassificationEngine {
    classification_rules: HashMap<ErrorCategory, Vec<ClassificationRule>>,
    error_patterns: HashMap<String, ErrorPattern>,
    tier_error_history: HashMap<TierType, Vec<ClassifiedError>>,
    recovery_success_rates: HashMap<(ErrorCategory, RecoveryStrategy), f64>,
    escalation_policies: HashMap<ErrorCategory, EscalationPolicy>,
}

#[derive(Debug, Clone)]
pub struct ClassificationRule {
    pub keywords: Vec<String>,
    pub error_codes: Vec<String>,
    pub context_patterns: Vec<String>,
    pub confidence: f64,
    pub severity: ErrorSeverity,
    pub recovery_strategies: Vec<RecoveryStrategy>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EscalationPolicy {
    pub category: ErrorCategory,
    pub occurrence_threshold: u32,
    pub time_window_minutes: u32,
    pub escalation_targets: Vec<String>,
    pub severity_upgrade: Option<ErrorSeverity>,
    pub automatic_actions: Vec<String>,
}

impl ErrorClassificationEngine {
    pub fn new() -> Self {
        let mut engine = Self {
            classification_rules: HashMap::new(),
            error_patterns: HashMap::new(),
            tier_error_history: HashMap::new(),
            recovery_success_rates: HashMap::new(),
            escalation_policies: HashMap::new(),
        };

        engine.initialize_default_rules();
        engine.initialize_escalation_policies();
        engine
    }

    pub fn classify_error(
        &mut self,
        error: &str,
        tier_type: TierType,
        correlation_id: &str,
        context: HashMap<String, String>,
    ) -> ClassifiedError {
        let timestamp = Utc::now();
        
        // Step 1: Determine error category and severity
        let (category, severity, confidence) = self.categorize_error(error, &context);
        
        // Step 2: Extract error code if present
        let error_code = self.extract_error_code(error);
        
        // Step 3: Generate recovery strategies based on category and tier
        let recovery_strategies = self.generate_recovery_strategies(&category, tier_type, &context);
        
        // Step 4: Create retry configuration
        let retry_config = self.create_retry_config(&category, &severity);
        
        // Step 5: Check for similar error patterns
        let (similar_count, pattern_score) = self.analyze_error_patterns(error, tier_type, &category);
        
        // Step 6: Generate recommended action
        let recommended_action = self.generate_recommended_action(&category, &severity, similar_count);
        
        let classified_error = ClassifiedError {
            original_error: error.to_string(),
            category: category.clone(),
            severity: severity.clone(),
            tier_type,
            correlation_id: correlation_id.to_string(),
            timestamp,
            error_code,
            context,
            recovery_strategies,
            recommended_action,
            escalation_threshold: self.get_escalation_threshold(&category),
            retry_config,
            similar_errors_count: similar_count,
            last_occurrence: timestamp,
            pattern_score,
        };

        // Step 7: Update error history and patterns
        self.update_error_history(tier_type, classified_error.clone());
        self.update_error_patterns(&classified_error);
        
        // Step 8: Check for escalation needs
        self.check_escalation(&classified_error);
        
        info!("🔍 [ERROR_CLASSIFIER] Classified error: {} -> {:?}/{:?} (confidence: {:.2})", 
              error, category, severity, confidence);
              
        classified_error
    }

    fn categorize_error(&self, error: &str, context: &HashMap<String, String>) -> (ErrorCategory, ErrorSeverity, f64) {
        let error_lower = error.to_lowercase();
        let mut best_match = (ErrorCategory::Unknown, ErrorSeverity::Medium, 0.0);

        for (category, rules) in &self.classification_rules {
            for rule in rules {
                let mut score = 0.0;

                // Keyword matching
                for keyword in &rule.keywords {
                    if error_lower.contains(&keyword.to_lowercase()) {
                        score += rule.confidence * 0.4;
                    }
                }

                // Error code matching
                for code in &rule.error_codes {
                    if error_lower.contains(&code.to_lowercase()) {
                        score += rule.confidence * 0.3;
                    }
                }

                // Context pattern matching
                for pattern in &rule.context_patterns {
                    if context.values().any(|v| v.to_lowercase().contains(&pattern.to_lowercase())) {
                        score += rule.confidence * 0.3;
                    }
                }

                if score > best_match.2 {
                    best_match = (category.clone(), rule.severity.clone(), score);
                }
            }
        }

        best_match
    }

    fn extract_error_code(&self, error: &str) -> Option<String> {
        // Common error code patterns
        let patterns = [
            r"(?i)error\s+(\d+)",
            r"(?i)code\s*:\s*(\d+)",
            r"(?i)status\s*:\s*(\d+)",
            r"(?i)http\s+(\d{3})",
        ];

        for pattern in &patterns {
            if let Ok(regex) = regex::Regex::new(pattern) {
                if let Some(captures) = regex.captures(error) {
                    if let Some(code) = captures.get(1) {
                        return Some(code.as_str().to_string());
                    }
                }
            }
        }

        None
    }

    fn generate_recovery_strategies(
        &self,
        category: &ErrorCategory,
        tier_type: TierType,
        context: &HashMap<String, String>,
    ) -> Vec<RecoveryStrategy> {
        let mut strategies = Vec::new();

        match category {
            ErrorCategory::Network => {
                strategies.extend([
                    RecoveryStrategy::ExponentialBackoff,
                    RecoveryStrategy::FallbackTier,
                    RecoveryStrategy::CircuitBreaker,
                ]);
            }
            ErrorCategory::Timeout => {
                strategies.extend([
                    RecoveryStrategy::ExponentialBackoff,
                    RecoveryStrategy::FallbackTier,
                ]);
                
                // For webhooks, prefer immediate fallback
                if tier_type == TierType::McpWebhook {
                    strategies.insert(0, RecoveryStrategy::FallbackTier);
                }
            }
            ErrorCategory::RateLimit => {
                strategies.extend([
                    RecoveryStrategy::ExponentialBackoff,
                    RecoveryStrategy::CircuitBreaker,
                ]);
            }
            ErrorCategory::Authentication | ErrorCategory::Authorization => {
                strategies.extend([
                    RecoveryStrategy::Escalate,
                    RecoveryStrategy::ManualIntervention,
                ]);
            }
            ErrorCategory::Resource => {
                strategies.extend([
                    RecoveryStrategy::ExponentialBackoff,
                    RecoveryStrategy::FallbackTier,
                ]);
            }
            ErrorCategory::Configuration => {
                strategies.extend([
                    RecoveryStrategy::ManualIntervention,
                    RecoveryStrategy::Escalate,
                ]);
            }
            ErrorCategory::ExternalService => {
                strategies.extend([
                    RecoveryStrategy::CircuitBreaker,
                    RecoveryStrategy::FallbackTier,
                ]);
            }
            ErrorCategory::System => {
                strategies.extend([
                    RecoveryStrategy::Escalate,
                    RecoveryStrategy::FallbackTier,
                ]);
            }
            ErrorCategory::Validation => {
                strategies.push(RecoveryStrategy::Ignore);
            }
            ErrorCategory::Unknown => {
                strategies.extend([
                    RecoveryStrategy::ImmediateRetry,
                    RecoveryStrategy::FallbackTier,
                ]);
            }
        }

        // Consider context for additional strategies
        if context.get("is_critical").map(|v| v == "true").unwrap_or(false) {
            strategies.insert(0, RecoveryStrategy::FallbackTier);
        }

        strategies
    }

    fn create_retry_config(&self, category: &ErrorCategory, severity: &ErrorSeverity) -> RetryConfig {
        match (category, severity) {
            (ErrorCategory::Network, ErrorSeverity::High) => RetryConfig {
                max_attempts: 5,
                initial_delay: Duration::from_millis(100),
                max_delay: Duration::from_secs(30),
                backoff_multiplier: 2.0,
                jitter: true,
            },
            (ErrorCategory::Timeout, _) => RetryConfig {
                max_attempts: 3,
                initial_delay: Duration::from_millis(200),
                max_delay: Duration::from_secs(10),
                backoff_multiplier: 1.5,
                jitter: true,
            },
            (ErrorCategory::RateLimit, _) => RetryConfig {
                max_attempts: 10,
                initial_delay: Duration::from_secs(1),
                max_delay: Duration::from_secs(300),
                backoff_multiplier: 2.0,
                jitter: true,
            },
            _ => RetryConfig {
                max_attempts: 3,
                initial_delay: Duration::from_millis(500),
                max_delay: Duration::from_secs(5),
                backoff_multiplier: 2.0,
                jitter: false,
            },
        }
    }

    fn analyze_error_patterns(&mut self, error: &str, tier_type: TierType, category: &ErrorCategory) -> (u32, f64) {
        let pattern_id = format!("{:?}:{}", category, self.generate_error_signature(error));
        
        let pattern = self.error_patterns.entry(pattern_id.clone()).or_insert_with(|| {
            ErrorPattern {
                pattern_id: pattern_id.clone(),
                category: category.clone(),
                frequency: 0,
                last_seen: Utc::now(),
                affected_tiers: vec![tier_type],
                success_rate_after_recovery: 0.8,
                average_recovery_time: Duration::from_secs(30),
                trend: ErrorTrend::Sporadic,
            }
        });

        pattern.frequency += 1;
        pattern.last_seen = Utc::now();
        
        if !pattern.affected_tiers.contains(&tier_type) {
            pattern.affected_tiers.push(tier_type);
        }

        // Calculate pattern score based on frequency and recency
        let pattern_score = (pattern.frequency as f64).ln() * 0.3 + 
                          (if pattern.frequency > 5 { 0.7 } else { 0.0 });

        (pattern.frequency, pattern_score)
    }

    fn generate_error_signature(&self, error: &str) -> String {
        // Create a simplified signature of the error for pattern matching
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        // Normalize the error by removing variable parts
        let normalized = error
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphabetic() || c.is_whitespace())
            .collect::<String>();
            
        let mut hasher = DefaultHasher::new();
        normalized.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    fn generate_recommended_action(&self, category: &ErrorCategory, severity: &ErrorSeverity, similar_count: u32) -> String {
        let urgency = if similar_count > 10 { "URGENT: " } else { "" };
        
        match (category, severity) {
            (ErrorCategory::Authentication, _) => {
                format!("{}Check authentication credentials and token validity", urgency)
            }
            (ErrorCategory::Network, ErrorSeverity::Critical) => {
                format!("{}Immediate failover to backup tier - network connectivity lost", urgency)
            }
            (ErrorCategory::RateLimit, _) => {
                format!("{}Implement exponential backoff and consider rate limiting optimization", urgency)
            }
            (ErrorCategory::Resource, ErrorSeverity::High) => {
                format!("{}Check system resources (memory/CPU/disk) and scale if needed", urgency)
            }
            (ErrorCategory::Configuration, _) => {
                format!("{}Verify configuration settings and validate against schema", urgency)
            }
            _ => {
                if similar_count > 5 {
                    format!("{}Pattern detected ({} occurrences) - investigate root cause", urgency, similar_count)
                } else {
                    format!("{}Monitor and retry with appropriate strategy", urgency)
                }
            }
        }
    }

    fn get_escalation_threshold(&self, category: &ErrorCategory) -> u32 {
        match category {
            ErrorCategory::Authentication | ErrorCategory::Authorization => 3,
            ErrorCategory::System | ErrorCategory::Configuration => 5,
            ErrorCategory::Network | ErrorCategory::ExternalService => 10,
            _ => 15,
        }
    }

    fn update_error_history(&mut self, tier_type: TierType, error: ClassifiedError) {
        let history = self.tier_error_history.entry(tier_type).or_insert_with(Vec::new);
        
        // Keep only recent errors (last 1000)
        if history.len() >= 1000 {
            history.remove(0);
        }
        
        history.push(error);
    }

    fn update_error_patterns(&mut self, error: &ClassifiedError) {
        // Update pattern trends based on recent frequency
        let pattern_id = format!("{:?}:{}", error.category, self.generate_error_signature(&error.original_error));
        
        // Get recent errors count first to avoid borrowing conflicts
        let recent_errors = self.count_recent_errors(&error.category, Duration::from_secs(3600));
        
        if let Some(pattern) = self.error_patterns.get_mut(&pattern_id) {
            // Simple trend analysis based on frequency in the last hour
            pattern.trend = if recent_errors > pattern.frequency / 2 {
                ErrorTrend::Increasing
            } else if recent_errors < pattern.frequency / 4 {
                ErrorTrend::Decreasing
            } else {
                ErrorTrend::Stable
            };
        }
    }

    fn count_recent_errors(&self, category: &ErrorCategory, duration: Duration) -> u32 {
        let cutoff = Utc::now() - chrono::Duration::from_std(duration).unwrap_or_default();
        
        self.tier_error_history
            .values()
            .flatten()
            .filter(|e| e.category == *category && e.timestamp > cutoff)
            .count() as u32
    }

    fn check_escalation(&self, error: &ClassifiedError) {
        if error.similar_errors_count >= error.escalation_threshold {
            warn!("🚨 [ERROR_CLASSIFIER] Escalation threshold reached for {:?} errors: {} >= {}",
                  error.category, error.similar_errors_count, error.escalation_threshold);
            
            // In production, this would trigger actual escalation (alerts, notifications, etc.)
            self.trigger_escalation(error);
        }
    }

    fn trigger_escalation(&self, error: &ClassifiedError) {
        // Log escalation (in production, would send alerts, create tickets, etc.)
        error!("🚨 [ESCALATION] Error pattern requires attention: {} occurrences of {:?} errors",
               error.similar_errors_count, error.category);
        error!("🚨 [ESCALATION] Recommendation: {}", error.recommended_action);
    }

    pub fn get_error_statistics(&self) -> HashMap<ErrorCategory, (u32, f64)> {
        let mut stats = HashMap::new();
        
        for errors in self.tier_error_history.values() {
            for error in errors {
                let entry = stats.entry(error.category.clone()).or_insert((0, 0.0));
                entry.0 += 1;
                
                // Calculate average severity (approximate)
                let severity_score = match error.severity {
                    ErrorSeverity::Critical => 5.0,
                    ErrorSeverity::High => 4.0,
                    ErrorSeverity::Medium => 3.0,
                    ErrorSeverity::Low => 2.0,
                    ErrorSeverity::Info => 1.0,
                };
                entry.1 = (entry.1 * (entry.0 - 1) as f64 + severity_score) / entry.0 as f64;
            }
        }
        
        stats
    }

    pub fn get_recovery_success_rates(&self) -> HashMap<(ErrorCategory, RecoveryStrategy), f64> {
        self.recovery_success_rates.clone()
    }

    pub fn update_recovery_success(&mut self, category: ErrorCategory, strategy: RecoveryStrategy, success: bool) {
        let key = (category, strategy);
        let current_rate = self.recovery_success_rates.get(&key).copied().unwrap_or(0.5);
        
        // Update success rate with exponential smoothing
        let new_rate = if success {
            current_rate * 0.9 + 0.1
        } else {
            current_rate * 0.9
        };
        
        self.recovery_success_rates.insert(key, new_rate);
    }

    fn initialize_default_rules(&mut self) {
        // Network errors
        self.classification_rules.insert(ErrorCategory::Network, vec![
            ClassificationRule {
                keywords: vec!["connection", "network", "dns", "host", "unreachable", "refused"].into_iter().map(String::from).collect(),
                error_codes: vec!["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].into_iter().map(String::from).collect(),
                context_patterns: vec!["network_error", "connection_failed"].into_iter().map(String::from).collect(),
                confidence: 0.9,
                severity: ErrorSeverity::High,
                recovery_strategies: vec![RecoveryStrategy::ExponentialBackoff, RecoveryStrategy::FallbackTier],
            },
        ]);

        // Timeout errors
        self.classification_rules.insert(ErrorCategory::Timeout, vec![
            ClassificationRule {
                keywords: vec!["timeout", "timed out", "deadline", "elapsed"].into_iter().map(String::from).collect(),
                error_codes: vec!["ETIMEDOUT", "408"].into_iter().map(String::from).collect(),
                context_patterns: vec!["timeout_error"].into_iter().map(String::from).collect(),
                confidence: 0.95,
                severity: ErrorSeverity::Medium,
                recovery_strategies: vec![RecoveryStrategy::ExponentialBackoff, RecoveryStrategy::FallbackTier],
            },
        ]);

        // Rate limit errors
        self.classification_rules.insert(ErrorCategory::RateLimit, vec![
            ClassificationRule {
                keywords: vec!["rate limit", "too many requests", "throttled", "quota"].into_iter().map(String::from).collect(),
                error_codes: vec!["429", "509"].into_iter().map(String::from).collect(),
                context_patterns: vec!["rate_limited"].into_iter().map(String::from).collect(),
                confidence: 0.95,
                severity: ErrorSeverity::Medium,
                recovery_strategies: vec![RecoveryStrategy::ExponentialBackoff, RecoveryStrategy::CircuitBreaker],
            },
        ]);

        // Add more rules for other categories...
    }

    fn initialize_escalation_policies(&mut self) {
        self.escalation_policies.insert(ErrorCategory::Authentication, EscalationPolicy {
            category: ErrorCategory::Authentication,
            occurrence_threshold: 3,
            time_window_minutes: 15,
            escalation_targets: vec!["security-team@company.com".to_string()],
            severity_upgrade: Some(ErrorSeverity::Critical),
            automatic_actions: vec!["disable_affected_tokens".to_string()],
        });

        // Add more escalation policies...
    }
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            initial_delay: Duration::from_millis(1000),
            max_delay: Duration::from_secs(30),
            backoff_multiplier: 2.0,
            jitter: true,
        }
    }
}
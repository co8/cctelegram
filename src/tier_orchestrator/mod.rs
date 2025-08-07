/**
 * Task 36: Enhanced Tier Orchestrator Module
 * Modular structure for advanced tier orchestration components
 */

pub mod core;
pub mod intelligent_selection;
pub mod error_classification;
pub mod resilience_patterns;

// Re-export main types from the core module
pub use core::{
    TierType, TierHealth, CircuitBreakerState, TierSelection, TierFailoverEvent,
    TierOrchestrator, TierStatistics
};

// Export new intelligent selection types
pub use intelligent_selection::{
    IntelligentTierSelector, SelectionStrategy, TierScore, SelectionContext,
    MessagePriority, RecipientAvailability, SystemLoad, PerformanceHistory
};

// Export resilience patterns types
pub use resilience_patterns::{
    ResilienceOrchestrator, BulkheadManager, AdaptiveTimeoutManager, PriorityQueueManager,
    SelfHealingManager, AutomatedRecoveryManager, ResilienceMetricsCollector,
    QueuePriority, SystemIssue, IssueType, IssueSeverity, ResilienceMetricsSnapshot,
    ResilienceError, HealingResult, RecoveryResult
};
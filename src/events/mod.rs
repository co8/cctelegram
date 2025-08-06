pub mod watcher;
pub mod processor;
pub mod types;
pub mod file_tier;
pub mod queue_manager;

pub use watcher::EventWatcher;
pub use processor::EventProcessor;
pub use queue_manager::{QueueManager, QueueManagerConfig, Priority, QueuedJob, QueueStats};
// Unused file tier exports removed - these are part of inactive Tier 3 architecture
// pub use file_tier::{FileTierProcessor, FileQueueEntry, FileQueueStatus, FileWatcherMetrics};

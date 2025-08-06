pub mod watcher;
pub mod processor;
pub mod types;
pub mod file_tier;
pub mod queue_manager;
pub mod compressed_queue_manager;

pub use watcher::{EventWatcher, DebouncedEventWatcher, DebounceConfig, DebouncedFileEvent, FileEventBatch, calculate_file_hash};
pub use processor::{EventProcessor, DebouncedEventProcessor, DebouncedProcessorConfig, DebouncedProcessorStats, create_debounced_processor, create_custom_debounced_processor};
pub use queue_manager::{QueueManager, QueueManagerConfig, Priority, QueuedJob, QueueStats};
pub use compressed_queue_manager::{CompressedQueueManager, CompressedQueueManagerConfig, EnhancedQueueStats, CompressionEfficiencyReport};
// Unused file tier exports removed - these are part of inactive Tier 3 architecture
// pub use file_tier::{FileTierProcessor, FileQueueEntry, FileQueueStatus, FileWatcherMetrics};

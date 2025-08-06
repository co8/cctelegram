pub mod file_store;
pub mod queue;
pub mod queue_integrity;
pub mod compression;
pub mod compression_integrity;
pub mod redis_compression;
pub mod compression_demo;
pub mod large_message_protocol;
pub mod large_message_queue_integration;

pub use file_store::FileStore;
pub use queue::{EventQueue, EnhancedEventQueue};
pub use queue_integrity::{IntegrityAwareEventQueue, IntegrityValidatedEvent, QueueIntegrityReport, QueueIntegrityStats};
pub use compression::{CompressionService, CompressionConfig, CompressedEvent, CompressionMetrics};
pub use compression_integrity::{IntegrityAwareCompressionService, CompressionIntegrityMetrics};
pub use redis_compression::{RedisCompressionService, RedisCompressionConfig, RedisStorageStats};
pub use compression_demo::{CompressionDemo, run_compression_demo};
pub use large_message_protocol::{LargeMessageProtocol, LargeMessageProtocolConfig, LargeMessageProtocolStats, MessageFragment, FragmentMetadata};
pub use large_message_queue_integration::{LargeMessageQueueIntegration, LargeMessageQueueConfig, QueueIntegrationStats, QueueLimits, FragmentStorageStrategy};

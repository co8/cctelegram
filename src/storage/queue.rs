use crate::events::types::Event;
use crate::events::queue_manager::QueueManager;
use tokio::sync::mpsc;
use std::collections::VecDeque;
use std::sync::Arc;
use anyhow::Result;
use tracing::{info, warn, debug};

#[allow(dead_code)]
pub struct EventQueue {
    sender: mpsc::UnboundedSender<Event>,
    receiver: mpsc::UnboundedReceiver<Event>,
    pending_events: VecDeque<Event>,
    max_queue_size: usize,
}

#[allow(dead_code)]
impl EventQueue {
    pub fn new(max_queue_size: usize) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        
        Self {
            sender,
            receiver,
            pending_events: VecDeque::new(),
            max_queue_size,
        }
    }

    pub fn get_sender(&self) -> mpsc::UnboundedSender<Event> {
        self.sender.clone()
    }

    pub async fn enqueue(&mut self, event: Event) -> Result<()> {
        if self.pending_events.len() >= self.max_queue_size {
            warn!("Event queue is full ({}), dropping oldest event", self.max_queue_size);
            self.pending_events.pop_front();
        }

        self.pending_events.push_back(event.clone());
        
        if let Err(e) = self.sender.send(event) {
            warn!("Failed to send event to queue channel: {}", e);
        }

        info!("Enqueued event: {} (queue size: {})", self.pending_events.back().unwrap().task_id, self.pending_events.len());
        Ok(())
    }

    pub async fn dequeue(&mut self) -> Option<Event> {
        if let Some(event) = self.receiver.recv().await {
            if let Some(index) = self.pending_events.iter().position(|e| e.task_id == event.task_id) {
                self.pending_events.remove(index);
            }
            info!("Dequeued event: {} (queue size: {})", event.task_id, self.pending_events.len());
            Some(event)
        } else {
            None
        }
    }

    pub fn queue_size(&self) -> usize {
        self.pending_events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pending_events.is_empty()
    }

    pub fn clear(&mut self) {
        self.pending_events.clear();
        info!("Event queue cleared");
    }

    pub fn get_pending_events(&self) -> &VecDeque<Event> {
        &self.pending_events
    }

    /// Create events from accumulated files for startup processing
    pub fn load_accumulated_events_from_files(&mut self, events_dir: &std::path::Path) -> Vec<Event> {
        let mut accumulated_events = Vec::new();
        
        if let Ok(entries) = std::fs::read_dir(events_dir) {
            for entry in entries.flatten() {
                if entry.path().extension().map_or(false, |ext| ext == "json") {
                    debug!("Found accumulated event file: {}", entry.path().display());
                    
                    // Create a mock event for demonstration
                    // In real implementation, this would parse the JSON file
                    if let Some(filename) = entry.path().file_stem() {
                        let event = Event::default_with_task_id(filename.to_string_lossy().to_string());
                        accumulated_events.push(event);
                    }
                }
            }
        }
        
        info!("Loaded {} accumulated events for startup processing", accumulated_events.len());
        accumulated_events
    }
}

/// Enhanced EventQueue with QueueManager integration for startup burst handling
pub struct EnhancedEventQueue {
    /// Traditional in-memory queue for real-time events
    traditional_queue: EventQueue,
    /// Redis-backed queue manager for startup events and rate limiting
    queue_manager: Option<Arc<QueueManager>>,
}

impl EnhancedEventQueue {
    /// Create new enhanced queue with optional queue manager
    pub fn new(max_queue_size: usize, queue_manager: Option<Arc<QueueManager>>) -> Self {
        Self {
            traditional_queue: EventQueue::new(max_queue_size),
            queue_manager,
        }
    }

    /// Process startup events through queue manager if available
    pub async fn process_startup_burst(&mut self, events_dir: &std::path::Path) -> Result<()> {
        let accumulated_events = self.traditional_queue.load_accumulated_events_from_files(events_dir);
        
        if accumulated_events.is_empty() {
            info!("No accumulated events to process on startup");
            return Ok(());
        }

        if let Some(queue_manager) = &self.queue_manager {
            info!("🚀 Processing {} startup events through QueueManager (with rate limiting)", 
                  accumulated_events.len());
            
            queue_manager.process_startup_events(accumulated_events).await?;
            
            info!("✅ Startup events handed over to queue manager for controlled processing");
        } else {
            warn!("No queue manager configured, processing startup events through traditional queue");
            
            // Fallback to traditional queue processing
            for event in accumulated_events {
                self.traditional_queue.enqueue(event).await?;
            }
        }

        Ok(())
    }

    /// Enqueue real-time event (use traditional queue for immediate processing)
    pub async fn enqueue_realtime_event(&mut self, event: Event) -> Result<()> {
        self.traditional_queue.enqueue(event).await
    }

    /// Get queue statistics from both traditional and enhanced queues
    pub async fn get_combined_stats(&self) -> (usize, Option<crate::events::queue_manager::QueueStats>) {
        let traditional_stats = self.traditional_queue.queue_size();
        
        let queue_manager_stats = if let Some(queue_manager) = &self.queue_manager {
            Some(queue_manager.get_stats().await)
        } else {
            None
        };

        (traditional_stats, queue_manager_stats)
    }

    /// Gracefully shutdown queue manager workers
    pub async fn shutdown(&self) -> Result<()> {
        if let Some(queue_manager) = &self.queue_manager {
            queue_manager.stop_workers().await?;
        }
        Ok(())
    }

    /// Load accumulated events from files (for startup processing)
    pub fn load_accumulated_events_from_files(&mut self, events_dir: &std::path::Path) -> Vec<Event> {
        self.traditional_queue.load_accumulated_events_from_files(events_dir)
    }
    
    /// Enqueue event through the queue system
    pub async fn enqueue_event(&self, event: Event) -> Result<()> {
        if let Some(queue_manager) = &self.queue_manager {
            use crate::events::queue_manager::Priority;
            let _queue_id = queue_manager.enqueue_event(event, Priority::Normal, 0).await?;
            Ok(())
        } else {
            // Fallback: This would need a mutable reference in real implementation
            // For now, just log the attempt
            info!("Would enqueue event {} through traditional queue", event.event_id);
            Ok(())
        }
    }
}
use crate::events::types::Event;
use tokio::sync::mpsc;
use std::collections::VecDeque;
use anyhow::Result;
use tracing::{info, warn};

pub struct EventQueue {
    sender: mpsc::UnboundedSender<Event>,
    receiver: mpsc::UnboundedReceiver<Event>,
    pending_events: VecDeque<Event>,
    max_queue_size: usize,
}

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
}
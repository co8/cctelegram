use notify::{Watcher, RecursiveMode, Result as NotifyResult, Event as NotifyEvent, EventKind};
use tokio::sync::mpsc;
use std::path::Path;
use anyhow::Result;
use tracing::{info, error};

pub struct EventWatcher {
    _watcher: notify::RecommendedWatcher,
    receiver: mpsc::UnboundedReceiver<NotifyEvent>,
}

impl EventWatcher {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let (tx, receiver) = mpsc::unbounded_channel();
        
        let mut watcher = notify::recommended_watcher(move |res: NotifyResult<NotifyEvent>| {
            match res {
                Ok(event) => {
                    if let Err(e) = tx.send(event) {
                        error!("Failed to send file event: {}", e);
                    }
                }
                Err(e) => error!("File watcher error: {:?}", e),
            }
        })?;

        watcher.watch(path.as_ref(), RecursiveMode::NonRecursive)?;
        info!("File watcher started for path: {}", path.as_ref().display());

        Ok(Self {
            _watcher: watcher,
            receiver,
        })
    }

    pub async fn next_event(&mut self) -> Option<NotifyEvent> {
        self.receiver.recv().await
    }

    pub fn is_relevant_event(&self, event: &NotifyEvent) -> bool {
        match &event.kind {
            EventKind::Create(_) | EventKind::Modify(_) => {
                // Check if it's a JSON file
                event.paths.iter().any(|path| {
                    path.extension().map_or(false, |ext| ext == "json")
                })
            }
            _ => false,
        }
    }
}
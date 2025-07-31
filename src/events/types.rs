use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Event {
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub source: String,
    pub timestamp: DateTime<Utc>,
    pub task_id: String,
    pub title: String,
    pub description: String,
    pub data: EventData,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    TaskCompletion,
    ApprovalRequest,
    ProgressUpdate,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventData {
    pub status: Option<String>,
    pub results: Option<String>,
    pub approval_prompt: Option<String>,
    pub options: Option<Vec<String>>,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResponseEvent {
    pub event_id: String,
    pub user_id: String,
    pub timestamp: DateTime<Utc>,
    pub response: String,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}
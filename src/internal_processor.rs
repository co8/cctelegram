/**
 * Task 21.4: Tier 2 Bridge Internal Processing
 * Rust actix-web fallback layer for 100-500ms response handling
 */

use actix_web::{web, App, HttpServer, HttpResponse, Result as ActixResult, middleware::Logger};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};
use uuid::Uuid;
use teloxide::{Bot, requests::Requester};
use teloxide::types::{ChatId, ParseMode};
use teloxide::payloads::SendMessageSetters;
use tracing::{info, warn, error, debug};

use crate::config::Config;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResponsePayload {
    pub callback_data: String,
    pub user_id: i64,
    pub username: Option<String>,
    pub first_name: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessingResult {
    pub success: bool,
    pub action: String,
    pub task_id: String,
    pub processing_time_ms: u64,
    pub acknowledgment_sent: bool,
    pub tier: String,
    pub correlation_id: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResponseAction {
    pub action_type: ActionType,
    pub task_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ActionType {
    Approve,
    Deny,
    Acknowledge,
    Details,
    Unknown,
}

impl ActionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ActionType::Approve => "approve",
            ActionType::Deny => "deny", 
            ActionType::Acknowledge => "acknowledge",
            ActionType::Details => "details",
            ActionType::Unknown => "unknown",
        }
    }
}

pub struct InternalProcessor {
    config: Arc<Config>,
    telegram_bot: Arc<Bot>,
    processing_stats: Arc<RwLock<ProcessingStats>>,
}

#[derive(Debug, Default, Clone, Serialize)]
struct ProcessingStats {
    total_processed: u64,
    successful_responses: u64,
    failed_responses: u64,
    average_response_time_ms: u64,
    acknowledgments_sent: u64,
}

impl InternalProcessor {
    pub fn new(config: Arc<Config>) -> Self {
        let telegram_bot = Arc::new(Bot::new(&config.telegram.telegram_bot_token));
        
        Self {
            config,
            telegram_bot,
            processing_stats: Arc::new(RwLock::new(ProcessingStats::default())),
        }
    }

    pub async fn start_server(&self, port: u16) -> std::io::Result<()> {
        info!("🚀 Starting Bridge Internal Processor on port {}", port);
        
        let config = self.config.clone();
        let bot = self.telegram_bot.clone();
        let stats = self.processing_stats.clone();
        
        HttpServer::new(move || {
            App::new()
                .app_data(web::Data::new(config.clone()))
                .app_data(web::Data::new(bot.clone()))
                .app_data(web::Data::new(stats.clone()))
                .wrap(Logger::default())
                .route("/health", web::get().to(health_handler))
                .route("/status", web::get().to(status_handler))
                .route("/process-response", web::post().to(process_response_handler))
                .route("/stats", web::get().to(stats_handler))
        })
        .bind(("127.0.0.1", port))?
        .run()
        .await
    }

    pub fn parse_callback_data(&self, callback_data: &str) -> ResponseAction {
        if let Some(task_id) = callback_data.strip_prefix("approve_") {
            ResponseAction {
                action_type: ActionType::Approve,
                task_id: task_id.to_string(),
            }
        } else if let Some(task_id) = callback_data.strip_prefix("deny_") {
            ResponseAction {
                action_type: ActionType::Deny,
                task_id: task_id.to_string(),
            }
        } else if let Some(task_id) = callback_data.strip_prefix("ack_") {
            ResponseAction {
                action_type: ActionType::Acknowledge,
                task_id: task_id.to_string(),
            }
        } else if let Some(task_id) = callback_data.strip_prefix("details_") {
            ResponseAction {
                action_type: ActionType::Details,
                task_id: task_id.to_string(),
            }
        } else {
            ResponseAction {
                action_type: ActionType::Unknown,
                task_id: callback_data.to_string(),
            }
        }
    }

    pub async fn process_response(&self, payload: ResponsePayload) -> ProcessingResult {
        let start_time = std::time::Instant::now();
        let correlation_id = payload.correlation_id.clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        info!("🔧 [TIER-2] Processing response: {} (correlation: {})", 
                  payload.callback_data, correlation_id);

        // Parse callback data
        let action = self.parse_callback_data(&payload.callback_data);
        
        // Process with exponential backoff retry mechanism
        let mut result = ProcessingResult {
            success: false,
            action: action.action_type.as_str().to_string(),
            task_id: action.task_id.clone(),
            processing_time_ms: 0,
            acknowledgment_sent: false,
            tier: "bridge_internal".to_string(),
            correlation_id: correlation_id.clone(),
            error: None,
        };

        // Attempt to send acknowledgment with retry logic
        match self.send_acknowledgment_with_retry(&payload, &action, &correlation_id).await {
            Ok(_) => {
                result.success = true;
                result.acknowledgment_sent = true;
                info!("✅ [TIER-2] Acknowledgment sent for {} on task {}", 
                          action.action_type.as_str(), action.task_id);
            }
            Err(e) => {
                result.error = Some(e.to_string());
                error!("❌ [TIER-2] Failed to send acknowledgment: {}", e);
            }
        }

        result.processing_time_ms = start_time.elapsed().as_millis() as u64;

        // Update statistics
        self.update_stats(&result).await;

        result
    }

    async fn send_acknowledgment_with_retry(
        &self,
        payload: &ResponsePayload,
        action: &ResponseAction,
        correlation_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let max_retries = 3;
        let mut delay_ms = 100; // Start with 100ms

        for attempt in 1..=max_retries {
            match self.send_telegram_acknowledgment(payload, action, correlation_id).await {
                Ok(_) => {
                    if attempt > 1 {
                        info!("✅ [TIER-2] Acknowledgment succeeded on attempt {}", attempt);
                    }
                    return Ok(());
                }
                Err(e) => {
                    if attempt < max_retries {
                        warn!("⚠️ [TIER-2] Attempt {} failed, retrying in {}ms: {}",
                                  attempt, delay_ms, e);
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
                        delay_ms = std::cmp::min(delay_ms * 2, 2000); // Cap at 2s
                    } else {
                        error!("❌ [TIER-2] All {} attempts failed: {}", max_retries, e);
                        return Err(e);
                    }
                }
            }
        }

        unreachable!()
    }

    async fn send_telegram_acknowledgment(
        &self,
        payload: &ResponsePayload,
        action: &ResponseAction,
        correlation_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let chat_id = ChatId(payload.user_id);
        let user_prefix = payload.first_name
            .as_deref()
            .map(|name| format!("{}, ", name))
            .unwrap_or_default();
        
        let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
        
        let message = match action.action_type {
            ActionType::Approve => {
                format!("✅ {}**TIER-2 FALLBACK** processed your APPROVAL for task `{}`. Action executing automatically. ({})",
                       user_prefix, action.task_id, timestamp)
            }
            ActionType::Deny => {
                format!("❌ {}**TIER-2 FALLBACK** processed your DENIAL for task `{}`. Action cancelled. ({})",
                       user_prefix, action.task_id, timestamp)
            }
            ActionType::Acknowledge => {
                format!("👍 {}**TIER-2 FALLBACK** processed your ACKNOWLEDGMENT for task `{}`. Marked as reviewed. ({})",
                       user_prefix, action.task_id, timestamp)
            }
            ActionType::Details => {
                format!("📄 {}**TIER-2 FALLBACK** processed your DETAILS request for task `{}`. Information logged. ({})",
                       user_prefix, action.task_id, timestamp)
            }
            ActionType::Unknown => {
                format!("🤖 {}**TIER-2 FALLBACK** processed your response for task `{}`. ({})",
                       user_prefix, action.task_id, timestamp)
            }
        };

        // Send message with retry built into teloxide
        self.telegram_bot
            .send_message(chat_id, message)
            .parse_mode(ParseMode::MarkdownV2)
            .await?;

        debug!("📨 [TIER-2] Telegram acknowledgment sent (correlation: {})", correlation_id);
        Ok(())
    }

    async fn update_stats(&self, result: &ProcessingResult) {
        let mut stats = self.processing_stats.write().await;
        stats.total_processed += 1;
        
        if result.success {
            stats.successful_responses += 1;
        } else {
            stats.failed_responses += 1;
        }

        if result.acknowledgment_sent {
            stats.acknowledgments_sent += 1;
        }

        // Update rolling average
        let total_time = stats.average_response_time_ms * (stats.total_processed - 1) + result.processing_time_ms;
        stats.average_response_time_ms = total_time / stats.total_processed;
    }

    pub async fn get_stats(&self) -> ProcessingStats {
        self.processing_stats.read().await.clone()
    }
}

// HTTP handlers
async fn health_handler() -> ActixResult<HttpResponse> {
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "bridge-internal-processor",
        "tier": "2",
        "timestamp": Utc::now(),
        "version": "1.0.0"
    })))
}

async fn status_handler(
    stats: web::Data<Arc<RwLock<ProcessingStats>>>,
) -> ActixResult<HttpResponse> {
    let stats = stats.read().await;
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "service": "bridge-internal-processor",
        "tier": 2,
        "stats": *stats,
        "endpoints": [
            "GET /health",
            "GET /status", 
            "GET /stats",
            "POST /process-response"
        ],
        "timestamp": Utc::now()
    })))
}

async fn process_response_handler(
    payload: web::Json<ResponsePayload>,
    config: web::Data<Arc<Config>>,
    bot: web::Data<Arc<Bot>>,
    stats: web::Data<Arc<RwLock<ProcessingStats>>>,
) -> ActixResult<HttpResponse> {
    let processor = InternalProcessor {
        config: config.get_ref().clone(),
        telegram_bot: bot.get_ref().clone(),
        processing_stats: stats.get_ref().clone(),
    };

    let result = processor.process_response(payload.into_inner()).await;
    
    let status_code = if result.success { 200 } else { 500 };
    Ok(HttpResponse::build(actix_web::http::StatusCode::from_u16(status_code).unwrap())
       .json(result))
}

async fn stats_handler(
    stats: web::Data<Arc<RwLock<ProcessingStats>>>,
) -> ActixResult<HttpResponse> {
    let stats = stats.read().await;
    Ok(HttpResponse::Ok().json(&*stats))
}
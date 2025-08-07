use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, Transaction, Result as SqlResult, Row};
use rusqlite::backup::Backup;
use tokio::sync::Semaphore;
use tokio::time::{sleep, interval};
use tracing::{info, warn, error, debug};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use anyhow::{Result, Context, bail};

use crate::events::types::Event;

/// Message status in the persistence system lifecycle
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageStatus {
    Pending,
    Sent,
    Confirmed,
    Failed,
}

impl MessageStatus {
    fn to_string(&self) -> &'static str {
        match self {
            MessageStatus::Pending => "pending",
            MessageStatus::Sent => "sent", 
            MessageStatus::Confirmed => "confirmed",
            MessageStatus::Failed => "failed",
        }
    }

    fn from_string(s: &str) -> Result<Self> {
        match s {
            "pending" => Ok(MessageStatus::Pending),
            "sent" => Ok(MessageStatus::Sent),
            "confirmed" => Ok(MessageStatus::Confirmed),
            "failed" => Ok(MessageStatus::Failed),
            _ => bail!("Invalid message status: {}", s),
        }
    }
}

/// Persisted message record
#[derive(Debug, Clone)]
pub struct PersistedMessage {
    pub id: Uuid,
    pub chat_id: i64,
    pub message_text: String,
    pub timestamp: DateTime<Utc>,
    pub status: MessageStatus,
    pub retry_count: u32,
    pub telegram_message_id: Option<i32>,
    pub event_data: Option<String>, // JSON serialized event data
    pub tier_used: Option<String>,
    pub error_message: Option<String>,
}

/// Configuration for message persistence
#[derive(Debug, Clone)]
pub struct MessagePersistenceConfig {
    pub database_path: String,
    pub retention_days: u32,
    pub max_connections: usize,
    pub cleanup_interval_hours: u64,
    pub backup_interval_hours: Option<u64>,
    pub backup_path: Option<String>,
    pub max_retry_count: u32,
    pub batch_size: usize,
}

impl Default for MessagePersistenceConfig {
    fn default() -> Self {
        Self {
            database_path: "cctelegram_messages.db".to_string(),
            retention_days: 30,
            max_connections: 10,
            cleanup_interval_hours: 24,
            backup_interval_hours: Some(168), // Weekly backup
            backup_path: Some("backup".to_string()),
            max_retry_count: 3,
            batch_size: 100,
        }
    }
}

/// Connection pool for SQLite with proper concurrency control
pub struct ConnectionPool {
    connections: Arc<Mutex<Vec<Arc<Mutex<Connection>>>>>,
    semaphore: Arc<Semaphore>,
    database_path: String,
    max_connections: usize,
}

impl ConnectionPool {
    pub fn new(database_path: String, max_connections: usize) -> Result<Self> {
        let pool = Self {
            connections: Arc::new(Mutex::new(Vec::new())),
            semaphore: Arc::new(Semaphore::new(max_connections)),
            database_path,
            max_connections,
        };
        
        // Initialize initial connections
        pool.initialize_connections()?;
        
        Ok(pool)
    }

    fn initialize_connections(&self) -> Result<()> {
        let mut connections = self.connections.lock().unwrap();
        
        for _ in 0..std::cmp::min(3, self.max_connections) {
            let conn = self.create_connection()?;
            connections.push(Arc::new(Mutex::new(conn)));
        }
        
        info!("Initialized connection pool with {} connections", connections.len());
        Ok(())
    }

    fn create_connection(&self) -> Result<Connection> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE 
            | OpenFlags::SQLITE_OPEN_CREATE 
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX;

        let conn = Connection::open_with_flags(&self.database_path, flags)
            .with_context(|| format!("Failed to open database: {}", self.database_path))?;

        // Configure connection for optimal concurrent performance
        conn.pragma_update(None, "journal_mode", &"WAL")?;
        conn.pragma_update(None, "synchronous", &"NORMAL")?;
        conn.pragma_update(None, "cache_size", &"-64000")?; // 64MB cache
        conn.pragma_update(None, "temp_store", &"memory")?;
        conn.pragma_update(None, "mmap_size", &"268435456")?; // 256MB mmap

        Ok(conn)
    }

    pub async fn get_connection(&self) -> Result<PooledConnection<'_>> {
        let permit = self.semaphore.acquire().await.unwrap();
        
        let conn = loop {
            let conn_opt = {
                let mut connections = self.connections.lock().unwrap();
                connections.pop()
            };
            
            if let Some(conn) = conn_opt {
                break conn;
            }
            
            // Check if we can create a new connection
            let current_count = {
                let connections = self.connections.lock().unwrap();
                connections.len()
            };
            
            if current_count < self.max_connections {
                let new_conn = self.create_connection()
                    .with_context(|| "Failed to create new database connection")?;
                break Arc::new(Mutex::new(new_conn));
            }
            
            // Wait briefly and retry
            sleep(Duration::from_millis(10)).await;
        };

        Ok(PooledConnection {
            connection: conn,
            pool: self.connections.clone(),
            _permit: permit,
        })
    }
}

/// A connection from the pool with automatic return
pub struct PooledConnection<'a> {
    connection: Arc<Mutex<Connection>>,
    pool: Arc<Mutex<Vec<Arc<Mutex<Connection>>>>>,
    _permit: tokio::sync::SemaphorePermit<'a>,
}

impl<'a> Drop for PooledConnection<'a> {
    fn drop(&mut self) {
        let mut pool = self.pool.lock().unwrap();
        pool.push(self.connection.clone());
    }
}

impl<'a> PooledConnection<'a> {
    pub fn execute<F, R>(&self, f: F) -> Result<R> 
    where 
        F: FnOnce(&Connection) -> Result<R>,
    {
        let conn = self.connection.lock().unwrap();
        f(&*conn)
    }

    pub fn transaction<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&Transaction) -> Result<R>,
    {
        let conn = self.connection.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let result = f(&tx)?;
        tx.commit()?;
        Ok(result)
    }
}

/// Main message persistence system
pub struct MessagePersistenceSystem {
    pool: Arc<ConnectionPool>,
    config: MessagePersistenceConfig,
    cleanup_shutdown: Arc<RwLock<bool>>,
    backup_shutdown: Arc<RwLock<bool>>,
    stats: Arc<RwLock<PersistenceStats>>,
}

#[derive(Debug, Default, Clone)]
pub struct PersistenceStats {
    pub messages_stored: u64,
    pub messages_updated: u64,
    pub messages_retrieved: u64,
    pub messages_cleaned: u64,
    pub failed_operations: u64,
    pub last_cleanup: Option<DateTime<Utc>>,
    pub last_backup: Option<DateTime<Utc>>,
    pub database_size_bytes: u64,
}

impl MessagePersistenceSystem {
    /// Create a new message persistence system
    pub async fn new(config: MessagePersistenceConfig) -> Result<Self> {
        info!("Initializing message persistence system with database: {}", config.database_path);
        
        let pool = Arc::new(ConnectionPool::new(config.database_path.clone(), config.max_connections)?);
        
        let system = Self {
            pool,
            config,
            cleanup_shutdown: Arc::new(RwLock::new(false)),
            backup_shutdown: Arc::new(RwLock::new(false)),
            stats: Arc::new(RwLock::new(PersistenceStats::default())),
        };

        // Initialize database schema
        system.initialize_database().await?;
        
        // Perform crash recovery
        system.perform_crash_recovery().await?;
        
        // Start background tasks
        system.start_cleanup_task();
        if system.config.backup_interval_hours.is_some() {
            system.start_backup_task();
        }
        
        info!("Message persistence system initialized successfully");
        Ok(system)
    }

    /// Initialize database schema with proper indexes
    async fn initialize_database(&self) -> Result<()> {
        let conn = self.pool.get_connection().await?;
        
        conn.execute(|conn| {
            conn.execute_batch(r#"
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    chat_id INTEGER NOT NULL,
                    message_text TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    telegram_message_id INTEGER,
                    event_data TEXT,
                    tier_used TEXT,
                    error_message TEXT,
                    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
                );

                CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
                CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
                CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
                CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
                CREATE INDEX IF NOT EXISTS idx_messages_telegram_id ON messages(telegram_message_id);

                CREATE TRIGGER IF NOT EXISTS trigger_messages_updated_at
                AFTER UPDATE ON messages
                BEGIN
                    UPDATE messages SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
                END;

                -- Migration for existing data (if any)
                PRAGMA user_version;
            "#)?;
            
            // Check and perform migrations if needed
            let version: i32 = conn.pragma_query_value(None, "user_version", |row| {
                Ok(row.get(0)?)
            })?;
            
            if version < 1 {
                // Add any future migrations here
                conn.pragma_update(None, "user_version", &1)?;
                info!("Database schema migrated to version 1");
            }
            
            Ok(())
        })?;

        info!("Database schema initialized");
        Ok(())
    }

    /// Perform crash recovery by loading pending messages
    async fn perform_crash_recovery(&self) -> Result<Vec<PersistedMessage>> {
        info!("Performing crash recovery...");
        
        let pending_messages = self.get_messages_by_status(MessageStatus::Pending).await?;
        
        if !pending_messages.is_empty() {
            warn!("Found {} pending messages during crash recovery", pending_messages.len());
            
            for message in &pending_messages {
                info!("Recovered pending message {} (retry count: {})", 
                     message.id, message.retry_count);
            }
        } else {
            info!("No pending messages found during crash recovery");
        }

        Ok(pending_messages)
    }

    /// Store a new message in the database
    pub async fn store_message(&self, event: &Event, chat_id: i64) -> Result<Uuid> {
        let message_id = Uuid::new_v4();
        let timestamp = Utc::now();
        
        let event_data = serde_json::to_string(event)
            .with_context(|| "Failed to serialize event data")?;
        
        let conn = self.pool.get_connection().await?;
        
        conn.transaction(|tx| {
            tx.execute(
                r#"INSERT INTO messages 
                   (id, chat_id, message_text, timestamp, status, retry_count, event_data) 
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                (
                    message_id.to_string(),
                    chat_id,
                    format!("{}: {}", event.event_type, event.description),
                    timestamp.timestamp(),
                    MessageStatus::Pending.to_string(),
                    0,
                    event_data,
                ),
            )?;
            Ok(())
        })?;

        {
            let mut stats = self.stats.write().unwrap();
            stats.messages_stored += 1;
        }

        debug!("Stored message {} for chat {}", message_id, chat_id);
        Ok(message_id)
    }

    /// Update message status atomically
    pub async fn update_message_status(
        &self, 
        message_id: Uuid, 
        status: MessageStatus, 
        telegram_message_id: Option<i32>,
        tier_used: Option<String>,
        error_message: Option<String>,
    ) -> Result<()> {
        let conn = self.pool.get_connection().await?;
        
        conn.transaction(|tx| {
            let mut query = "UPDATE messages SET status = ?1".to_string();
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(status.to_string())];
            let mut param_index = 2;

            if let Some(tg_msg_id) = telegram_message_id {
                query.push_str(&format!(", telegram_message_id = ?{}", param_index));
                params.push(Box::new(tg_msg_id));
                param_index += 1;
            }

            if let Some(tier) = tier_used {
                query.push_str(&format!(", tier_used = ?{}", param_index));
                params.push(Box::new(tier));
                param_index += 1;
            }

            if let Some(error) = error_message {
                query.push_str(&format!(", error_message = ?{}", param_index));
                params.push(Box::new(error));
                param_index += 1;
            }

            // Always increment retry count for failed status
            if status == MessageStatus::Failed {
                query.push_str(&format!(", retry_count = retry_count + 1"));
            }

            query.push_str(&format!(" WHERE id = ?{}", param_index));
            params.push(Box::new(message_id.to_string()));

            let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            
            let updated_rows = tx.execute(&query, params_refs.as_slice())?;
            
            if updated_rows == 0 {
                bail!("Message {} not found for status update", message_id);
            }
            
            Ok(())
        })?;

        {
            let mut stats = self.stats.write().unwrap();
            stats.messages_updated += 1;
        }

        debug!("Updated message {} status to {:?}", message_id, status);
        Ok(())
    }

    /// Get messages by status
    pub async fn get_messages_by_status(&self, status: MessageStatus) -> Result<Vec<PersistedMessage>> {
        let conn = self.pool.get_connection().await?;
        
        let messages = conn.execute(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, chat_id, message_text, timestamp, status, retry_count, 
                        telegram_message_id, event_data, tier_used, error_message
                 FROM messages 
                 WHERE status = ?1 
                 ORDER BY timestamp ASC"
            )?;
            
            let rows = stmt.query_map([status.to_string()], |row| {
                Ok(self.row_to_message(row)?)
            })?;
            
            let mut messages = Vec::new();
            for message_result in rows {
                messages.push(message_result?);
            }
            
            Ok(messages)
        })?;

        {
            let mut stats = self.stats.write().unwrap();
            stats.messages_retrieved += messages.len() as u64;
        }

        Ok(messages)
    }

    /// Get messages that need retry (failed with retry count < max)
    pub async fn get_retry_messages(&self) -> Result<Vec<PersistedMessage>> {
        let conn = self.pool.get_connection().await?;
        
        let messages = conn.execute(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, chat_id, message_text, timestamp, status, retry_count, 
                        telegram_message_id, event_data, tier_used, error_message
                 FROM messages 
                 WHERE status = 'failed' AND retry_count < ?1
                 ORDER BY timestamp ASC"
            )?;
            
            let rows = stmt.query_map([self.config.max_retry_count], |row| {
                Ok(self.row_to_message(row)?)
            })?;
            
            let mut messages = Vec::new();
            for message_result in rows {
                messages.push(message_result?);
            }
            
            Ok(messages)
        })?;

        Ok(messages)
    }

    /// Get message by ID
    pub async fn get_message(&self, message_id: Uuid) -> Result<Option<PersistedMessage>> {
        let conn = self.pool.get_connection().await?;
        
        let message = conn.execute(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, chat_id, message_text, timestamp, status, retry_count, 
                        telegram_message_id, event_data, tier_used, error_message
                 FROM messages 
                 WHERE id = ?1"
            )?;
            
            let mut rows = stmt.query_map([message_id.to_string()], |row| {
                Ok(self.row_to_message(row)?)
            })?;
            
            if let Some(row_result) = rows.next() {
                Ok(Some(row_result?))
            } else {
                Ok(None)
            }
        })?;

        Ok(message)
    }

    /// Helper function to convert database row to PersistedMessage
    fn row_to_message(&self, row: &Row) -> SqlResult<PersistedMessage> {
        let timestamp_secs: i64 = row.get("timestamp")?;
        let timestamp = DateTime::<Utc>::from_timestamp(timestamp_secs, 0)
            .unwrap_or_else(Utc::now);

        Ok(PersistedMessage {
            id: Uuid::parse_str(&row.get::<_, String>("id")?).unwrap(),
            chat_id: row.get("chat_id")?,
            message_text: row.get("message_text")?,
            timestamp,
            status: MessageStatus::from_string(&row.get::<_, String>("status")?).unwrap(),
            retry_count: row.get("retry_count")?,
            telegram_message_id: row.get("telegram_message_id")?,
            event_data: row.get("event_data")?,
            tier_used: row.get("tier_used")?,
            error_message: row.get("error_message")?,
        })
    }

    /// Clean up old messages based on retention policy
    pub async fn cleanup_old_messages(&self) -> Result<u64> {
        let cutoff_timestamp = (Utc::now() - chrono::Duration::days(self.config.retention_days as i64))
            .timestamp();
        
        let conn = self.pool.get_connection().await?;
        
        let deleted_count = conn.transaction(|tx| {
            let count = tx.execute(
                "DELETE FROM messages WHERE created_at < ?1",
                [cutoff_timestamp],
            )?;
            Ok(count as u64)
        })?;

        if deleted_count > 0 {
            info!("Cleaned up {} old messages (retention: {} days)", 
                  deleted_count, self.config.retention_days);
        }

        {
            let mut stats = self.stats.write().unwrap();
            stats.messages_cleaned += deleted_count;
            stats.last_cleanup = Some(Utc::now());
        }

        // Vacuum database after cleanup to reclaim space
        if deleted_count > 0 {
            conn.execute(|conn| {
                conn.execute("VACUUM", [])?;
                Ok(())
            })?;
        }

        Ok(deleted_count)
    }

    /// Create database backup
    pub async fn create_backup(&self) -> Result<String> {
        let default_backup = "backup".to_string();
        let backup_dir = self.config.backup_path.as_ref()
            .unwrap_or(&default_backup);
        
        tokio::fs::create_dir_all(backup_dir).await
            .with_context(|| format!("Failed to create backup directory: {}", backup_dir))?;
        
        let backup_filename = format!("messages_backup_{}.db", 
                                    Utc::now().format("%Y%m%d_%H%M%S"));
        let backup_path = format!("{}/{}", backup_dir, backup_filename);
        
        let conn = self.pool.get_connection().await?;
        
        conn.execute(|conn| {
            let mut backup_conn = Connection::open(&backup_path)?;
            let backup = Backup::new(conn, &mut backup_conn)?;
            backup.run_to_completion(5, Duration::from_millis(100), None)?;
            Ok(())
        })?;

        {
            let mut stats = self.stats.write().unwrap();
            stats.last_backup = Some(Utc::now());
        }

        info!("Created database backup: {}", backup_path);
        Ok(backup_path)
    }

    /// Get persistence statistics
    pub fn get_stats(&self) -> PersistenceStats {
        self.stats.read().unwrap().clone()
    }

    /// Start background cleanup task
    fn start_cleanup_task(&self) {
        let pool = self.pool.clone();
        let config = self.config.clone();
        let shutdown_flag = self.cleanup_shutdown.clone();
        let stats = self.stats.clone();

        tokio::spawn(async move {
            let mut cleanup_interval = interval(Duration::from_secs(
                config.cleanup_interval_hours * 3600
            ));

            loop {
                cleanup_interval.tick().await;
                
                if *shutdown_flag.read().unwrap() {
                    break;
                }

                match Self::perform_cleanup(&pool, &config, &stats).await {
                    Ok(deleted_count) => {
                        if deleted_count > 0 {
                            info!("Cleanup task completed, deleted {} messages", deleted_count);
                        }
                    }
                    Err(e) => {
                        error!("Cleanup task failed: {}", e);
                    }
                }
            }
            
            info!("Cleanup task shut down");
        });
    }

    /// Start background backup task
    fn start_backup_task(&self) {
        let pool = self.pool.clone();
        let config = self.config.clone();
        let shutdown_flag = self.backup_shutdown.clone();
        let stats = self.stats.clone();

        tokio::spawn(async move {
            let backup_hours = config.backup_interval_hours.unwrap_or(168);
            let mut backup_interval = interval(Duration::from_secs(backup_hours * 3600));

            loop {
                backup_interval.tick().await;
                
                if *shutdown_flag.read().unwrap() {
                    break;
                }

                match Self::perform_backup(&pool, &config, &stats).await {
                    Ok(backup_path) => {
                        info!("Backup task completed: {}", backup_path);
                    }
                    Err(e) => {
                        error!("Backup task failed: {}", e);
                    }
                }
            }
            
            info!("Backup task shut down");
        });
    }

    /// Internal cleanup implementation
    async fn perform_cleanup(
        pool: &ConnectionPool,
        config: &MessagePersistenceConfig,
        stats: &Arc<RwLock<PersistenceStats>>,
    ) -> Result<u64> {
        let cutoff_timestamp = (Utc::now() - chrono::Duration::days(config.retention_days as i64))
            .timestamp();
        
        let conn = pool.get_connection().await?;
        
        let deleted_count = conn.transaction(|tx| {
            let count = tx.execute(
                "DELETE FROM messages WHERE created_at < ?1",
                [cutoff_timestamp],
            )?;
            Ok(count as u64)
        })?;

        {
            let mut stats = stats.write().unwrap();
            stats.messages_cleaned += deleted_count;
            stats.last_cleanup = Some(Utc::now());
        }

        if deleted_count > 0 {
            conn.execute(|conn| {
                conn.execute("VACUUM", [])?;
                Ok(())
            })?;
        }

        Ok(deleted_count)
    }

    /// Internal backup implementation
    async fn perform_backup(
        pool: &ConnectionPool,
        config: &MessagePersistenceConfig,
        stats: &Arc<RwLock<PersistenceStats>>,
    ) -> Result<String> {
        let default_backup = "backup".to_string();
        let backup_dir = config.backup_path.as_ref()
            .unwrap_or(&default_backup);
        
        tokio::fs::create_dir_all(backup_dir).await?;
        
        let backup_filename = format!("messages_backup_{}.db", 
                                    Utc::now().format("%Y%m%d_%H%M%S"));
        let backup_path = format!("{}/{}", backup_dir, backup_filename);
        
        let conn = pool.get_connection().await?;
        
        conn.execute(|conn| {
            let mut backup_conn = Connection::open(&backup_path)?;
            let backup = Backup::new(conn, &mut backup_conn)?;
            backup.run_to_completion(5, Duration::from_millis(100), None)?;
            Ok(())
        })?;

        {
            let mut stats = stats.write().unwrap();
            stats.last_backup = Some(Utc::now());
        }

        Ok(backup_path)
    }
}

impl Drop for MessagePersistenceSystem {
    fn drop(&mut self) {
        // Signal background tasks to shut down
        *self.cleanup_shutdown.write().unwrap() = true;
        *self.backup_shutdown.write().unwrap() = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    
    fn create_test_config() -> MessagePersistenceConfig {
        let temp_file = NamedTempFile::new().unwrap();
        MessagePersistenceConfig {
            database_path: temp_file.path().to_string_lossy().to_string(),
            retention_days: 1,
            max_connections: 2,
            cleanup_interval_hours: 1,
            backup_interval_hours: None,
            backup_path: None,
            max_retry_count: 2,
            batch_size: 10,
        }
    }
    
    #[tokio::test]
    async fn test_message_persistence_lifecycle() {
        let config = create_test_config();
        let system = MessagePersistenceSystem::new(config).await.unwrap();
        
        // Create test event
        let event = Event {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_type: crate::events::types::EventType::TestSuiteRun,
            source: "test".to_string(),
            timestamp: Utc::now(),
            task_id: "test_task".to_string(),
            title: "Test Event".to_string(),
            description: "Test message".to_string(),
            data: crate::events::types::EventData::default(),
            correlation_id: None,
            parent_event_id: None,
            retry_count: 0,
            processing_status: crate::events::types::ProcessingStatus::Pending,
            schema_version: "1.0".to_string(),
            created_at: Utc::now(),
            processed_at: None,
        };
        
        let chat_id = 12345i64;
        
        // Store message
        let message_id = system.store_message(&event, chat_id).await.unwrap();
        
        // Verify message is pending
        let pending_messages = system.get_messages_by_status(MessageStatus::Pending).await.unwrap();
        assert_eq!(pending_messages.len(), 1);
        assert_eq!(pending_messages[0].id, message_id);
        
        // Update to sent
        system.update_message_status(
            message_id, 
            MessageStatus::Sent, 
            Some(67890), 
            Some("tier1".to_string()),
            None,
        ).await.unwrap();
        
        // Verify status update
        let message = system.get_message(message_id).await.unwrap().unwrap();
        assert_eq!(message.status, MessageStatus::Sent);
        assert_eq!(message.telegram_message_id, Some(67890));
        assert_eq!(message.tier_used, Some("tier1".to_string()));
        
        // Update to confirmed
        system.update_message_status(
            message_id,
            MessageStatus::Confirmed,
            None,
            None,
            None,
        ).await.unwrap();
        
        // Verify final status
        let message = system.get_message(message_id).await.unwrap().unwrap();
        assert_eq!(message.status, MessageStatus::Confirmed);
    }
}
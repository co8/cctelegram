use std::collections::HashMap;
use std::time::{Duration, Instant};
use tracing::{info, warn};
use ring::{digest, hmac};
use base64::{Engine as _, engine::general_purpose};

pub struct SecurityManager {
    allowed_users: std::collections::HashSet<i64>,
    rate_limiter: RateLimiter,
    hmac_key: Option<hmac::Key>,
}

impl SecurityManager {
    pub fn new(allowed_users: Vec<i64>, rate_limit_requests: u32, rate_limit_window_secs: u64) -> Self {
        // Try to get HMAC key from environment
        let hmac_key = std::env::var("CC_TELEGRAM_HMAC_KEY").ok()
            .map(|key| hmac::Key::new(hmac::HMAC_SHA256, key.as_bytes()));
        
        if hmac_key.is_none() {
            warn!("CC_TELEGRAM_HMAC_KEY not set - event integrity checks disabled");
            info!("Set CC_TELEGRAM_HMAC_KEY environment variable to enable HMAC integrity verification");
        }
        
        Self {
            allowed_users: allowed_users.into_iter().collect(),
            rate_limiter: RateLimiter::new(rate_limit_requests, Duration::from_secs(rate_limit_window_secs)),
            hmac_key,
        }
    }

    pub fn is_user_authorized(&self, user_id: i64) -> bool {
        let authorized = self.allowed_users.contains(&user_id);
        if !authorized {
            warn!("Unauthorized access attempt from user ID: {}", user_id);
        }
        authorized
    }

    pub fn check_rate_limit(&mut self, user_id: i64) -> bool {
        let allowed = self.rate_limiter.check_rate_limit(user_id);
        if !allowed {
            warn!("Rate limit exceeded for user ID: {}", user_id);
        }
        allowed
    }

    pub fn add_user(&mut self, user_id: i64) {
        self.allowed_users.insert(user_id);
        info!("Added user {} to authorized list", user_id);
    }

    pub fn remove_user(&mut self, user_id: i64) {
        self.allowed_users.remove(&user_id);
        info!("Removed user {} from authorized list", user_id);
    }

    pub fn hash_sensitive_data(&self, data: &str) -> String {
        let digest = digest::digest(&digest::SHA256, data.as_bytes());
        general_purpose::STANDARD.encode(digest.as_ref())
    }

    pub fn validate_task_id(&self, task_id: &str) -> bool {
        // Basic validation: alphanumeric and underscores only, reasonable length
        if task_id.len() < 1 || task_id.len() > 64 {
            return false;
        }
        
        task_id.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    }

    pub fn sanitize_input(&self, input: &str) -> String {
        // Remove potentially dangerous characters and limit length
        input
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace() || "._-:@".contains(*c))
            .take(1000) // Limit to 1000 characters
            .collect()
    }
    
    /// Generate HMAC signature for data integrity
    pub fn generate_hmac(&self, data: &[u8]) -> Option<String> {
        self.hmac_key.as_ref().map(|key| {
            let signature = hmac::sign(key, data);
            general_purpose::STANDARD.encode(signature.as_ref())
        })
    }
    
    /// Verify HMAC signature
    pub fn verify_hmac(&self, data: &[u8], signature: &str) -> bool {
        let Some(key) = &self.hmac_key else {
            // If no key is configured, skip verification
            return true;
        };
        
        let Ok(signature_bytes) = general_purpose::STANDARD.decode(signature) else {
            warn!("Invalid HMAC signature format");
            return false;
        };
        
        hmac::verify(key, data, &signature_bytes).is_ok()
    }
    
    /// Generate integrity metadata for an event
    pub fn generate_event_integrity(&self, event_json: &str) -> HashMap<String, String> {
        let mut metadata = HashMap::new();
        
        // Add timestamp
        metadata.insert(
            "integrity_timestamp".to_string(),
            chrono::Utc::now().to_rfc3339(),
        );
        
        // Add HMAC if key is configured
        if let Some(hmac) = self.generate_hmac(event_json.as_bytes()) {
            metadata.insert("hmac_sha256".to_string(), hmac);
        }
        
        // Add content hash for additional verification
        let digest = digest::digest(&digest::SHA256, event_json.as_bytes());
        metadata.insert(
            "content_sha256".to_string(),
            general_purpose::STANDARD.encode(digest.as_ref()),
        );
        
        metadata
    }
    
    /// Verify event integrity
    pub fn verify_event_integrity(&self, event_json: &str, metadata: &HashMap<String, String>) -> bool {
        // Verify content hash
        if let Some(expected_hash) = metadata.get("content_sha256") {
            let digest = digest::digest(&digest::SHA256, event_json.as_bytes());
            let actual_hash = general_purpose::STANDARD.encode(digest.as_ref());
            
            if actual_hash != *expected_hash {
                warn!("Event content hash mismatch");
                return false;
            }
        }
        
        // Verify HMAC if present
        if let Some(hmac_signature) = metadata.get("hmac_sha256") {
            if !self.verify_hmac(event_json.as_bytes(), hmac_signature) {
                warn!("Event HMAC verification failed");
                return false;
            }
        }
        
        true
    }
}

pub struct RateLimiter {
    requests: HashMap<i64, Vec<Instant>>,
    max_requests: u32,
    window_duration: Duration,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window_duration: Duration) -> Self {
        Self {
            requests: HashMap::new(),
            max_requests,
            window_duration,
        }
    }

    pub fn check_rate_limit(&mut self, user_id: i64) -> bool {
        let now = Instant::now();
        let user_requests = self.requests.entry(user_id).or_insert_with(Vec::new);

        // Remove old requests outside the window
        user_requests.retain(|&request_time| now.duration_since(request_time) < self.window_duration);

        if user_requests.len() >= self.max_requests as usize {
            return false;
        }

        // Add current request
        user_requests.push(now);
        true
    }

    pub fn reset_user_limit(&mut self, user_id: i64) {
        self.requests.remove(&user_id);
        info!("Reset rate limit for user {}", user_id);
    }

    pub fn get_user_request_count(&self, user_id: i64) -> usize {
        self.requests.get(&user_id).map_or(0, |requests| requests.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_rate_limiter() {
        let mut limiter = RateLimiter::new(2, Duration::from_secs(1));
        let user_id = 123;

        assert!(limiter.check_rate_limit(user_id));
        assert!(limiter.check_rate_limit(user_id));
        assert!(!limiter.check_rate_limit(user_id)); // Should be blocked

        thread::sleep(Duration::from_millis(1100));
        assert!(limiter.check_rate_limit(user_id)); // Should be allowed again
    }

    #[test]
    fn test_security_manager() {
        let manager = SecurityManager::new(vec![123, 456], 10, 60);
        
        assert!(manager.is_user_authorized(123));
        assert!(manager.is_user_authorized(456));
        assert!(!manager.is_user_authorized(789));

        assert!(manager.validate_task_id("task_123"));
        assert!(manager.validate_task_id("test-task"));
        assert!(!manager.validate_task_id("task/with/slashes"));
        assert!(!manager.validate_task_id(""));

        let sanitized = manager.sanitize_input("Hello <script>alert('test')</script>");
        assert!(!sanitized.contains("<"));
        assert!(!sanitized.contains(">"));
    }
}
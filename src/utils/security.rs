use std::collections::HashMap;
use std::time::{Duration, Instant};
use tracing::{info, warn};
use ring::digest;
use base64::{Engine as _, engine::general_purpose};

pub struct SecurityManager {
    allowed_users: std::collections::HashSet<i64>,
    rate_limiter: RateLimiter,
}

impl SecurityManager {
    pub fn new(allowed_users: Vec<i64>, rate_limit_requests: u32, rate_limit_window_secs: u64) -> Self {
        Self {
            allowed_users: allowed_users.into_iter().collect(),
            rate_limiter: RateLimiter::new(rate_limit_requests, Duration::from_secs(rate_limit_window_secs)),
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
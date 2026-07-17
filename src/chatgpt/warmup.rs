use wreq::Client;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// Session warmup cache - tracks which sessions have been warmed up recently
pub struct WarmupCache {
    cache: Arc<RwLock<HashMap<String, Instant>>>,
    ttl: Duration,
    max_entries: usize,
}

impl WarmupCache {
    pub fn new(ttl_seconds: u64, max_entries: usize) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            ttl: Duration::from_secs(ttl_seconds),
            max_entries,
        }
    }

    /// Check if a session needs warmup (returns true if warmup is needed)
    pub async fn needs_warmup(&self, session_key: &str) -> bool {
        let cache = self.cache.read().await;
        
        if let Some(&last_warmup) = cache.get(session_key) {
            // Check if warmup is still valid
            let elapsed = Instant::now().duration_since(last_warmup);
            if elapsed < self.ttl {
                debug!("Session warmup cache hit (valid for {} more seconds)", 
                    (self.ttl - elapsed).as_secs());
                return false; // No warmup needed
            }
        }
        
        true // Warmup needed
    }

    /// Mark a session as warmed up
    pub async fn mark_warmed(&self, session_key: String) {
        let mut cache = self.cache.write().await;
        
        // Evict old entries if at capacity
        if cache.len() >= self.max_entries {
            self.evict_oldest(&mut cache);
        }
        
        cache.insert(session_key, Instant::now());
    }

    /// Evict the oldest 20% of entries when at capacity
    fn evict_oldest(&self, cache: &mut HashMap<String, Instant>) {
        let evict_count = cache.len() / 5; // 20%
        if evict_count == 0 {
            return;
        }

        let mut entries: Vec<(String, Instant)> = cache
            .iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect();

        entries.sort_by_key(|(_, instant)| *instant);

        for i in 0..evict_count {
            cache.remove(&entries[i].0);
        }

        debug!("Evicted {} old warmup entries", evict_count);
    }

    /// Get cache statistics
    pub async fn stats(&self) -> WarmupStats {
        let cache = self.cache.read().await;
        WarmupStats {
            total_entries: cache.len(),
            max_entries: self.max_entries,
            ttl_seconds: self.ttl.as_secs(),
        }
    }
}

#[derive(Debug)]
pub struct WarmupStats {
    pub total_entries: usize,
    pub max_entries: usize,
    pub ttl_seconds: u64,
}

/// Generate a unique warmup key from session token and access token
fn generate_warmup_key(session_token: &str, access_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session_token.as_bytes());
    hasher.update(access_token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Run session warmup by hitting 3 backend endpoints
/// Mimics browser page load behavior to reduce PoW difficulty
pub async fn run_warmup(
    client: &Client,
    access_token: &str,
    session_token: &str,
    cookie_header: &str,
    base_url: &str,
) -> Result<(), String> {
    let base = base_url.trim_end_matches("/backend-api/conversation");
    
    // 3 warmup endpoints matching OmniRoute
    let warmup_urls = [
        format!("{}/backend-api/me", base),
        format!("{}/backend-api/conversations?offset=0&limit=28", base),
        format!("{}/backend-api/models", base),
    ];

    info!("Running session warmup ({} requests)...", warmup_urls.len());
    let start = Instant::now();

    // Make all 3 requests in parallel for speed
    let mut tasks = Vec::new();
    
    for url in &warmup_urls {
        let client = client.clone();
        let url = url.clone();
        let token = access_token.to_string();
        let cookie = cookie_header.to_string();
        
        let task = tokio::spawn(async move {
            let result = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", token))
                .header("Cookie", cookie)
                .timeout(Duration::from_secs(15))
                .send()
                .await;
            
            match result {
                Ok(response) => {
                    if response.status().is_success() {
                        debug!("Warmup request succeeded: {}", url);
                        Ok(())
                    } else {
                        warn!("Warmup request failed with status {}: {}", response.status(), url);
                        Err(format!("Status {}", response.status()))
                    }
                }
                Err(e) => {
                    warn!("Warmup request error: {} - {}", url, e);
                    Err(format!("{}", e))
                }
            }
        });
        
        tasks.push(task);
    }

    // Wait for all requests to complete
    let results = futures::future::join_all(tasks).await;
    
    let mut successes = 0;
    let mut failures = 0;
    
    for result in results {
        match result {
            Ok(Ok(())) => successes += 1,
            Ok(Err(_)) | Err(_) => failures += 1,
        }
    }

    let elapsed = start.elapsed();
    info!(
        "Session warmup completed in {}ms ({} succeeded, {} failed)",
        elapsed.as_millis(),
        successes,
        failures
    );

    // Warmup is considered successful even if some requests fail
    // This prevents blocking the actual conversation request
    Ok(())
}

/// Run warmup if needed, using the cache to avoid redundant warmups
pub async fn warmup_if_needed(
    cache: &WarmupCache,
    client: &Client,
    access_token: &str,
    session_token: &str,
    cookie_header: &str,
    base_url: &str,
) -> Result<(), String> {
    let warmup_key = generate_warmup_key(session_token, access_token);
    
    if cache.needs_warmup(&warmup_key).await {
        debug!("Session needs warmup, executing...");
        run_warmup(client, access_token, session_token, cookie_header, base_url).await?;
        cache.mark_warmed(warmup_key).await;
    } else {
        debug!("Session warmup cached, skipping");
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_warmup_cache_miss() {
        let cache = WarmupCache::new(60, 100);
        assert!(cache.needs_warmup("test_key").await);
    }

    #[tokio::test]
    async fn test_warmup_cache_hit() {
        let cache = WarmupCache::new(60, 100);
        cache.mark_warmed("test_key".to_string()).await;
        assert!(!cache.needs_warmup("test_key").await);
    }

    #[tokio::test]
    async fn test_warmup_cache_expiry() {
        let cache = WarmupCache::new(1, 100); // 1 second TTL
        cache.mark_warmed("test_key".to_string()).await;
        assert!(!cache.needs_warmup("test_key").await);
        
        // Wait for expiry
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(cache.needs_warmup("test_key").await);
    }

    #[tokio::test]
    async fn test_warmup_cache_eviction() {
        let cache = WarmupCache::new(60, 10); // Small cache
        
        // Fill cache beyond capacity
        for i in 0..15 {
            cache.mark_warmed(format!("key_{}", i)).await;
            tokio::time::sleep(Duration::from_millis(10)).await; // Ensure different timestamps
        }
        
        let stats = cache.stats().await;
        assert!(stats.total_entries <= 13); // Should have evicted ~20% when hitting capacity
    }

    #[test]
    fn test_generate_warmup_key_stability() {
        let key1 = generate_warmup_key("session1", "token1");
        let key2 = generate_warmup_key("session1", "token1");
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_generate_warmup_key_uniqueness() {
        let key1 = generate_warmup_key("session1", "token1");
        let key2 = generate_warmup_key("session1", "token2");
        let key3 = generate_warmup_key("session2", "token1");
        
        assert_ne!(key1, key2);
        assert_ne!(key1, key3);
        assert_ne!(key2, key3);
    }

    #[tokio::test]
    async fn test_warmup_stats() {
        let cache = WarmupCache::new(60, 100);
        cache.mark_warmed("key1".to_string()).await;
        cache.mark_warmed("key2".to_string()).await;
        
        let stats = cache.stats().await;
        assert_eq!(stats.total_entries, 2);
        assert_eq!(stats.max_entries, 100);
        assert_eq!(stats.ttl_seconds, 60);
    }
}

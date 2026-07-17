use wreq::Client;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{info, warn};
use crate::chatgpt::headers::build_auth_headers;
use crate::error::AppError;
use super::cookie::{parse_session_cookie, ParsedCookie};

#[derive(Clone)]
pub struct AuthManager {
    token: Arc<RwLock<Option<(String, Instant)>>>,
    parsed_cookie: ParsedCookie,
    client: Client,
    pub base_url: String,
}

impl AuthManager {
    pub fn new(session_token: String, client: Client, base_url: Option<String>) -> Self {
        let parsed_cookie = parse_session_cookie(&session_token);
        tracing::info!("Parsed session token length: {}, full cookie header length: {}", 
            parsed_cookie.session_token.len(), 
            parsed_cookie.full_cookie_header.len());
        
        Self {
            token: Arc::new(RwLock::new(None)),
            parsed_cookie,
            client,
            base_url: base_url.unwrap_or_else(|| "https://chatgpt.com/api/auth/session".to_string()),
        }
    }
    
    /// Get the session token value (for device ID generation)
    pub fn get_session_token(&self) -> &str {
        &self.parsed_cookie.session_token
    }
    
    /// Get the full cookie header (for requests)
    pub fn get_cookie_header(&self) -> &str {
        &self.parsed_cookie.full_cookie_header
    }

    /// Get the device ID (either from oai-did cookie or generated)
    pub fn get_device_id(&self) -> String {
        if let Some(did) = self.parsed_cookie.other_cookies.get("oai-did") {
            did.clone()
        } else {
            crate::chatgpt::headers::generate_device_id(&self.parsed_cookie.session_token)
        }
    }

    pub async fn get_token(&self) -> Result<String, AppError> {
        {
            let cache = self.token.read().await;
            if let Some((token, expiry)) = &*cache {
                if !self.is_token_expired(*expiry) {
                    return Ok(token.clone());
                }
            }
        }
        
        self.refresh_token().await
    }

    pub async fn refresh_token(&self) -> Result<String, AppError> {
        info!("Refreshing ChatGPT access token...");
        
        // Retry logic for token refresh
        let mut attempts = 0;
        let max_attempts = 3;
        
        loop {
            attempts += 1;
            
            // Build browser-like headers
            let headers = build_auth_headers();
            
            let cookie_header = self.get_cookie_header();
            tracing::debug!("Sending auth request with cookie: {}", &cookie_header[..50.min(cookie_header.len())]);
            
            let req = self.client.get(&self.base_url)
                .headers(headers)
                .header("cookie", cookie_header);

            match req.send().await {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        // Read response body for debugging
                        let body = response.text().await.unwrap_or_else(|_| "Could not read body".to_string());
                        let preview = body.chars().take(200).collect::<String>();
                        tracing::debug!("Auth response status {}: {}", status, preview);
                        
                        if status == 401 || status == 403 {
                            return Err(AppError::Auth("Session token is invalid or expired. Please provide a new CHATGPT_SESSION_TOKEN.".to_string()));
                        }
                        if attempts >= max_attempts {
                            let error_preview = body.chars().take(100).collect::<String>();
                            return Err(AppError::Auth(format!("Failed to refresh token, status: {} - {}", status, error_preview)));
                        }
                        warn!("Token refresh failed with status {}, retrying...", status);
                        tokio::time::sleep(Duration::from_millis(500 * attempts as u64)).await;
                        continue;
                    }

                    match response.text().await {
                        Ok(body) => {
                            tracing::debug!("Auth response body (first 300 chars): {}", body.chars().take(300).collect::<String>());
                            
                            match serde_json::from_str::<serde_json::Value>(&body) {
                                Ok(data) => {
                                    tracing::debug!("Auth response JSON parsed successfully");
                                    if let Some(access_token) = data.get("accessToken").and_then(|t| t.as_str()) {
                                        // Default expiry is usually a few hours, but we can set it to e.g. 1 hour safely,
                                        // or parse from the response if available. We will set it to 1 hour here as a fallback
                                        // unless `expires` is provided (some ChatGPT auth responses don't provide expires_in cleanly).
                                        let expiry = Instant::now() + Duration::from_secs(3600);
                                        
                                        let mut cache = self.token.write().await;
                                        *cache = Some((access_token.to_string(), expiry));
                                        info!("Token refreshed successfully");
                                        return Ok(access_token.to_string());
                                    } else {
                                        return Err(AppError::Auth("accessToken missing from response".to_string()));
                                    }
                                }
                                Err(e) => {
                                    if attempts >= max_attempts {
                                        return Err(AppError::Auth(format!("Failed to parse session response as JSON: {}", e)));
                                    }
                                    warn!("JSON parse error {}, retrying...", e);
                                    tokio::time::sleep(Duration::from_millis(500 * attempts as u64)).await;
                                }
                            }
                        }
                        Err(e) => {
                            if attempts >= max_attempts {
                                return Err(AppError::Auth(format!("Failed to read response body: {}", e)));
                            }
                            warn!("Body read error {}, retrying...", e);
                            tokio::time::sleep(Duration::from_millis(500 * attempts as u64)).await;
                        }
                    }
                }
                Err(e) => {
                    if attempts >= max_attempts {
                        return Err(AppError::Auth(format!("Network error refreshing token: {}", e)));
                    }
                    warn!("Network error {}, retrying...", e);
                    tokio::time::sleep(Duration::from_millis(500 * attempts as u64)).await;
                }
            }
        }
    }

    pub fn is_token_expired(&self, expires_at: Instant) -> bool {
        // 5-minute buffer before actual expiry
        Instant::now() + Duration::from_secs(300) > expires_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_token_expiry() {
        let manager = AuthManager::new("test_session".to_string(), Client::new(), None);
        
        let past = Instant::now() - Duration::from_secs(60);
        assert!(manager.is_token_expired(past));
        
        let future = Instant::now() + Duration::from_secs(3600);
        assert!(!manager.is_token_expired(future));

        // Buffer test: expires in 4 mins (240 secs) < 300 secs buffer
        let soon = Instant::now() + Duration::from_secs(240);
        assert!(manager.is_token_expired(soon));
    }
}

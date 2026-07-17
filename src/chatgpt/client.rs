use super::models::{ChatGPTRequest, ChatGPTMessage, Author, Content};
use super::headers::build_chatgpt_headers;
use super::pow::{solve_pow_with_config, CONVERSATION_PREFIX};
use super::sentinel::get_chat_requirements;
use crate::auth::AuthManager;
use crate::error::AppError;
use wreq::{Client, Response};
use uuid::Uuid;
use tracing::{info, warn};
use serde_json::Value;

#[derive(Clone)]
pub struct ChatGPTClient {
    client: Client,
    auth_manager: AuthManager,
    pub base_url: String,
}

impl ChatGPTClient {
    pub fn new(auth_manager: AuthManager, client: Client, base_url: Option<String>) -> Self {
        Self {
            client,
            auth_manager,
            base_url: base_url.unwrap_or_else(|| "https://chatgpt.com/backend-api/conversation".to_string()),
        }
    }

    /// Get reference to the HTTP client (for warmup)
    pub fn get_client(&self) -> &Client {
        &self.client
    }

    /// Get reference to the auth manager (for warmup)
    pub fn get_auth_manager(&self) -> &AuthManager {
        &self.auth_manager
    }

    pub async fn send_request(
        &self,
        request: ChatGPTRequest,
    ) -> Result<Response, AppError> {
        let mut attempts = 0;
        let max_attempts = 2; // Initial try + 1 retry on 401

        loop {
            attempts += 1;
            let token = self.auth_manager.get_token().await?;

            // Fetch Sentinel requirements first
            let session_token = self.auth_manager.get_session_token();
            let cookie_header = self.auth_manager.get_cookie_header();
            let user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";
            
            let req_res = get_chat_requirements(
                &self.client,
                &token,
                session_token,
                cookie_header,
                user_agent,
                &self.base_url,
                false,
            ).await?;

            let mut pow_token = None;
            if req_res.proof_required {
                if let (Some(seed), Some(diff)) = (req_res.seed, req_res.difficulty) {
                    pow_token = solve_pow_with_config(
                        &seed,
                        &diff,
                        CONVERSATION_PREFIX,
                        user_agent,
                        &self.client,
                        100_000,
                    ).await;
                }
            }

            // Build browser-like headers with OAI-specific headers
            let device_id = self.auth_manager.get_device_id();
            let headers = build_chatgpt_headers(&device_id, None, true);

            let mut req_builder = self
                .client
                .post(&self.base_url)
                .headers(headers)
                .header("Authorization", format!("Bearer {}", token))
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .header("OpenAI-Sentinel-Chat-Requirements-Token", &req_res.token)
                .json(&request);

            if let Some(proof) = pow_token {
                req_builder = req_builder.header("OpenAI-Sentinel-Proof-Token", proof);
            }

            match req_builder.send().await {
                Ok(response) => {
                    if response.status() == 401 {
                        if attempts >= max_attempts {
                            return Err(AppError::Auth("ChatGPT API returned 401 even after token refresh".to_string()));
                        }
                        warn!("Received 401 Unauthorized, forcing token refresh...");
                        let _ = self.auth_manager.refresh_token().await?;
                        continue;
                    }

                    if response.status() == 429 {
                        let retry_after = response.headers().get("Retry-After")
                            .and_then(|h| h.to_str().ok())
                            .unwrap_or("unknown");
                        return Err(AppError::RateLimited(format!("Rate limited by ChatGPT. Retry after: {} seconds", retry_after)));
                    }

                    if response.status() == 403 {
                        let body = response.text().await.unwrap_or_default();
                        
                        // Not a PoW challenge — check for Cloudflare
                        // Note: we already consumed the body, so check what we got
                        if body.contains("cloudflare") || body.contains("cf-") {
                            return Err(AppError::Upstream("Cloudflare challenge encountered. Please refresh your session token or IP.".to_string()));
                        }
                        
                        // Try to parse the body to extract the real detail message
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(detail) = json.get("detail").and_then(|v| v.as_str()) {
                                return Err(AppError::Upstream(format!("ChatGPT API Error: {}", detail)));
                            }
                        }
                        
                        warn!("ChatGPT returned 403. Body: {}", body);
                        return Err(AppError::Auth("Access forbidden (403). Session token may be invalid.".to_string()));
                    }
                    
                    if response.status() == 401 || response.status() == 403 {
                        return Err(AppError::Auth(format!("Access forbidden or unauthorized ({}). Session token may be invalid.", response.status())));
                    }

                    if !response.status().is_success() {
                        return Err(AppError::Upstream(format!("ChatGPT API error: {}", response.status())));
                    }

                    return Ok(response);
                }
                Err(e) => {
                    return Err(AppError::Internal(format!("Network error: {}", e)));
                }
            }
        }
    }

    pub async fn download_file(&self, file_id: &str) -> Result<Response, AppError> {
        let url = format!("https://chatgpt.com/backend-api/files/{}/download", file_id);
        self.download_url(&url).await
    }

    pub async fn download_url(&self, url: &str) -> Result<Response, AppError> {
        let mut attempts = 0;
        let max_attempts = 2;

        loop {
            attempts += 1;
            let token = self.auth_manager.get_token().await?;
            let device_id = self.auth_manager.get_device_id();
            let headers = build_chatgpt_headers(&device_id, None, false);

            let req_builder = self
                .client
                .get(url)
                .headers(headers)
                .header("Authorization", format!("Bearer {}", token))
                .header("Accept", "*/*");

            match req_builder.send().await {
                Ok(response) => {
                    if response.status() == 401 && attempts < max_attempts {
                        warn!("Received 401 for file download, refreshing token...");
                        let _ = self.auth_manager.refresh_token().await?;
                        continue;
                    }
                    if !response.status().is_success() {
                        return Err(AppError::Upstream(format!("Failed to download file: {}", response.status())));
                    }
                    return Ok(response);
                }
                Err(e) => {
                    return Err(AppError::Internal(e.to_string()));
                }
            }
        }
    }

    pub fn build_stateless_request(prompt: String, model: String) -> ChatGPTRequest {
        let message_id = Uuid::new_v4().to_string();
        let parent_id = Uuid::new_v4().to_string();
        
        ChatGPTRequest {
            action: "next".to_string(),
            messages: vec![ChatGPTMessage {
                id: message_id,
                author: Author { role: "user".to_string() },
                content: Content {
                    content_type: "text".to_string(),
                    parts: vec![prompt],
                },
            }],
            model,
            parent_message_id: parent_id,
            timezone_offset_min: 0,
            history_and_training_disabled: false,
            conversation_id: None,
        }
    }

    pub fn build_stateful_request(
        prompt: String,
        model: String,
        conversation_id: String,
        parent_message_id: String,
    ) -> ChatGPTRequest {
        let message_id = Uuid::new_v4().to_string();

        ChatGPTRequest {
            action: "next".to_string(),
            messages: vec![ChatGPTMessage {
                id: message_id,
                author: Author { role: "user".to_string() },
                content: Content {
                    content_type: "text".to_string(),
                    parts: vec![prompt],
                },
            }],
            model,
            parent_message_id,
            timezone_offset_min: 0,
            history_and_training_disabled: false,
            conversation_id: Some(conversation_id),
        }
    }
}


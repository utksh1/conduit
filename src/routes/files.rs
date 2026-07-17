use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    extract::Request,
};
use serde_json::json;
use std::sync::Arc;
use tracing::error;
use crate::AppState;
use axum::Json;

pub async fn get_file(
    State(state): State<Arc<AppState>>,
    Path(file_id): Path<String>,
    req: Request,
) -> Response {
    let token = req.headers().get("Authorization")
        .and_then(|val| val.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("");

    let mut is_valid = false;
    if !token.is_empty() {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        let token_hash = hex::encode(hasher.finalize());

        // Check if config allows proxy without key, or if hash is in db
        if state.config.proxy_api_key.is_none() {
            is_valid = true;
        } else {
            let hash_clone = token_hash.clone();
            let valid = state.db.call(move |c| {
                let mut stmt = c.prepare("SELECT 1 FROM api_keys WHERE secret_hash = ? AND is_active = 1")?;
                let exists = stmt.exists([hash_clone])?;
                Ok::<_, tokio_rusqlite::Error>(exists)
            }).await.unwrap_or(false);
            is_valid = valid;
        }
    }

    if !is_valid {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "Invalid API key"}))).into_response();
    }

    tracing::info!("Downloading file_id: {}", file_id);

    match state.chatgpt_client.download_file(&file_id).await {
        Ok(res) => {
            let content_type = res.headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
                
            let bytes = match res.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!("Failed to read file bytes: {}", e);
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read file").into_response();
                }
            };
            
            // If the response is JSON, it might contain a download_url (e.g. for DALL-E images)
            if content_type.starts_with("application/json") {
                if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    if let Some(download_url) = json.get("download_url").and_then(|v| v.as_str()) {
                        tracing::info!("Found download_url in JSON, fetching: {}", download_url);
                        match state.chatgpt_client.download_url(download_url).await {
                            Ok(res) => {
                                let content_type = res.headers()
                                    .get(header::CONTENT_TYPE)
                                    .and_then(|v| v.to_str().ok())
                                    .unwrap_or("application/octet-stream")
                                    .to_string();
                                
                                let image_bytes = match res.bytes().await {
                                    Ok(b) => b,
                                    Err(e) => {
                                        tracing::error!("Failed to read image bytes: {}", e);
                                        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read image").into_response();
                                    }
                                };
                                return ([(header::CONTENT_TYPE, content_type)], image_bytes).into_response();
                            }
                            Err(e) => {
                                tracing::error!("Failed to download image from download_url: {}", e);
                                return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
                            }
                        }
                    }
                }
            }
            
            
            ([(header::CONTENT_TYPE, content_type)], bytes).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to download file: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

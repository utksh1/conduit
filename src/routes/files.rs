use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use crate::AppState;

pub async fn get_file(
    State(state): State<Arc<AppState>>,
    Path(file_id): Path<String>,
) -> Response {
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

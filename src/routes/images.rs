use axum::{extract::State, response::{IntoResponse, Response}, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::AppState;
use crate::error::AppError;
use crate::chatgpt::client::ChatGPTClient;
use crate::chatgpt::warmup::warmup_if_needed;
use serde_json::Value;
use futures::StreamExt;

#[derive(Deserialize)]
pub struct ImageRequest {
    prompt: String,
    #[serde(default = "default_n")]
    n: u32,
    #[serde(default = "default_size")]
    size: String,
    #[serde(default = "default_model")]
    model: String,
    #[serde(default)]
    quality: Option<String>,
    #[serde(default)]
    style: Option<String>,
}

fn default_n() -> u32 { 1 }
fn default_size() -> String { "1024x1024".to_string() }
fn default_model() -> String { "dall-e-3".to_string() }

#[derive(Serialize)]
struct ImageResponse {
    created: u64,
    data: Vec<ImageData>,
}

#[derive(Serialize)]
struct ImageData {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    revised_prompt: Option<String>,
}

/// Extract image URLs from ChatGPT response message parts.
/// ChatGPT returns DALL-E images as asset_pointer objects in the parts array.
fn extract_image_urls(parts: &[Value]) -> Vec<String> {
    let mut urls = Vec::new();
    for part in parts {
        if let Some(obj) = part.as_object() {
            // Check for asset_pointer (DALL-E generated images)
            if let Some(asset) = obj.get("asset_pointer").and_then(|v| v.as_str()) {
                let file_id = asset
                    .replace("file-service://", "")
                    .replace("sediment://", "");
                let encoded_id = urlencoding::encode(&file_id);
                urls.push(format!("/v1/files/{}", encoded_id));
            }
            // Check for direct URL
            else if let Some(url) = obj.get("url").and_then(|v| v.as_str()) {
                urls.push(url.to_string());
            }
            // Check for download_url
            else if let Some(url) = obj.get("download_url").and_then(|v| v.as_str()) {
                urls.push(url.to_string());
            }
            // Check metadata.url
            else if let Some(meta) = obj.get("metadata").and_then(|v| v.as_object()) {
                if let Some(url) = meta.get("url").and_then(|v| v.as_str()) {
                    urls.push(url.to_string());
                }
            }
        }
    }
    urls
}

/// Extract text content from ChatGPT response message parts (for revised_prompt).
fn extract_text(parts: &[Value]) -> String {
    let mut text = String::new();
    for part in parts {
        if let Some(s) = part.as_str() {
            text.push_str(s);
        }
    }
    text
}

pub async fn generate_image(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImageRequest>,
) -> Result<Response, AppError> {
    // Build the DALL-E prompt to send through ChatGPT
    let mut dalle_instruction = format!(
        "Generate an image using DALL-E with the following prompt: \"{}\"",
        req.prompt
    );

    // Add size instruction
    dalle_instruction.push_str(&format!("\nImage size: {}", req.size));

    // Add quality/style if provided
    if let Some(ref quality) = req.quality {
        dalle_instruction.push_str(&format!("\nQuality: {}", quality));
    }
    if let Some(ref style) = req.style {
        dalle_instruction.push_str(&format!("\nStyle: {}", style));
    }

    // Use the requested model to trigger DALL-E (defaults to dall-e-3, but maps to gpt-4o for web backend)
    let target_model = if req.model == "dall-e-3" {
        "gpt-4o".to_string()
    } else {
        req.model.clone()
    };

    let mut all_images: Vec<ImageData> = Vec::new();

    // Generate n images (each requires a separate conversation to get unique images)
    for i in 0..req.n {
        let prompt = if req.n > 1 {
            format!("{}\n\nThis is image {} of {}. Generate a unique variation.", dalle_instruction, i + 1, req.n)
        } else {
            dalle_instruction.clone()
        };

        let chatgpt_req = ChatGPTClient::build_stateless_request(
            prompt,
            target_model.clone(),
        );

        // Run warmup if needed
        let access_token = state.auth_manager.get_token().await?;
        let session_token = state.auth_manager.get_session_token();
        let cookie_header = state.auth_manager.get_cookie_header();

        if let Err(e) = warmup_if_needed(
            &state.warmup_cache,
            state.chatgpt_client.get_client(),
            &access_token,
            session_token,
            cookie_header,
            &state.chatgpt_client.base_url,
        ).await {
            tracing::warn!("Session warmup failed: {}", e);
        }

        // Send the request and consume the full response
        let response = state.chatgpt_client.send_request(chatgpt_req).await?;
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut image_urls: Vec<String> = Vec::new();
        let mut revised_prompt = String::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| AppError::Internal(e.to_string()))?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            while let Some(idx) = buffer.find("\n\n") {
                let event = buffer[..idx].to_string();
                buffer = buffer[idx + 2..].to_string();

                if event.starts_with("data: ") {
                    let data = &event[6..];
                    if data == "[DONE]" {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(data) {
                        if let Some(parts) = val.pointer("/message/content/parts").and_then(|v| v.as_array()) {
                            let urls = extract_image_urls(parts);
                            if !urls.is_empty() {
                                image_urls = urls;
                            }
                            let text = extract_text(parts);
                            if !text.is_empty() {
                                revised_prompt = text;
                            }
                        }
                    }
                }
            }
        }

        if image_urls.is_empty() {
            tracing::warn!("No image URLs found in ChatGPT response for image request {}", i + 1);
            // If no images were returned, add an error message
            return Err(AppError::Internal(
                "ChatGPT did not return any images. The DALL-E model may not be available or the prompt was rejected.".to_string()
            ));
        }

        for url in image_urls {
            all_images.push(ImageData {
                url,
                revised_prompt: if revised_prompt.is_empty() { None } else { Some(revised_prompt.clone()) },
            });
        }
    }

    let response = ImageResponse {
        created: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        data: all_images,
    };

    Ok(Json(response).into_response())
}

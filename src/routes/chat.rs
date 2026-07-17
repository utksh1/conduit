use axum::{
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use axum::body::Body;
use wreq::StatusCode;
use sha2::{Sha256, Digest};
use std::sync::Arc;
use std::collections::HashMap;
use crate::{AppState, chatgpt::models::ChatCompletionRequest, error::AppError};
use crate::chatgpt::warmup::warmup_if_needed;
use crate::tools::{ToolParser, inject_tool_prompt};
use crate::conversation::hash::{CleanMessage, hash_messages};
use crate::conversation::cache::ConversationContext;
use crate::streaming::transformer::StreamTransformer;
use serde_json::{json, Value};
use futures::StreamExt;
use tokio_stream::wrappers::ReceiverStream;

/// Helper to extract text and image URLs from the ChatGPT message parts array
fn parse_message_parts(parts: &[Value]) -> String {
    let mut combined_text = String::new();
    for part in parts {
        if let Some(text) = part.as_str() {
            combined_text.push_str(text);
        } else if let Some(obj) = part.as_object() {
            let mut found_url = None;
            
            if let Some(url) = obj.get("url").and_then(|v| v.as_str()) {
                found_url = Some(url.to_string());
            } else if let Some(download) = obj.get("download_url").and_then(|v| v.as_str()) {
                found_url = Some(download.to_string());
            } else if let Some(asset) = obj.get("asset_pointer").and_then(|v| v.as_str()) {
                let file_id = asset.replace("file-service://", "").replace("sediment://", "");
                let encoded_id = urlencoding::encode(&file_id);
                found_url = Some(format!("/v1/files/{}", encoded_id));
            } else if let Some(meta) = obj.get("metadata").and_then(|v| v.as_object()) {
                if let Some(url) = meta.get("url").and_then(|v| v.as_str()) {
                    found_url = Some(url.to_string());
                }
            }

            if let Some(url) = found_url {
                combined_text.push_str(&format!("\n![image]({})\n", url));
            }
        }
    }
    combined_text
}

/// Result from consuming a ChatGPT upstream response (possibly with continuation).
struct ConsumeResult {
    text: String,
    conversation_id: Option<String>,
    last_message_id: String,
}

async fn consume_and_continue(
    state: &Arc<AppState>,
    mut chatgpt_req: crate::chatgpt::models::ChatGPTRequest,
) -> Result<ConsumeResult, AppError> {
    let mut full_text = String::new();
    let mut final_conversation_id: Option<String> = None;
    let mut final_message_id = String::new();

    loop {
        let response = state.chatgpt_client.send_request(chatgpt_req.clone()).await?;
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        
        let mut current_text = String::new();
        let mut needs_continue = false;
        let mut last_message_id = String::new();
        let mut conversation_id: Option<String> = None;

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| AppError::Internal(e.to_string()))?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);
            
            while let Some(idx) = buffer.find("\n\n") {
                let event = buffer[..idx].to_string();
                buffer = buffer[idx+2..].to_string();
                
                if event.starts_with("data: ") {
                    let data = &event[6..];
                    if data == "[DONE]" {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(data) {
                        if let Some(conv_id) = val.get("conversation_id").and_then(|v| v.as_str()) {
                            conversation_id = Some(conv_id.to_string());
                        }
                        if let Some(msg_id) = val.pointer("/message/id").and_then(|v| v.as_str()) {
                            last_message_id = msg_id.to_string();
                        }
                        if let Some(parts) = val.pointer("/message/content/parts").and_then(|v| v.as_array()) {
                            let parsed_text = parse_message_parts(parts);
                            if !parsed_text.is_empty() {
                                current_text = parsed_text;
                            }
                        }
                        if let Some(finish_type) = val.pointer("/message/metadata/finish_details/type").and_then(|v| v.as_str()) {
                            if finish_type == "max_tokens" || finish_type == "length" {
                                needs_continue = true;
                            }
                        }
                    }
                }
            }
        }

        full_text.push_str(&current_text);
        if conversation_id.is_some() {
            final_conversation_id = conversation_id;
        }
        if !last_message_id.is_empty() {
            final_message_id = last_message_id.clone();
        }

        if needs_continue && !last_message_id.is_empty() {
            chatgpt_req.action = "continue".to_string();
            chatgpt_req.parent_message_id = last_message_id;
        } else {
            break;
        }
    }

    Ok(ConsumeResult {
        text: full_text,
        conversation_id: final_conversation_id,
        last_message_id: final_message_id,
    })
}

/// Stream upstream ChatGPT SSE events back to the client in OpenAI format.
async fn handle_streaming(
    state: &Arc<AppState>,
    chatgpt_req: crate::chatgpt::models::ChatGPTRequest,
    model: &str,
) -> Result<Response, AppError> {
    let response = state.chatgpt_client.send_request(chatgpt_req).await?;
    let mut upstream = response.bytes_stream();

    let model_owned = model.to_string();
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, std::convert::Infallible>>(64);

    tokio::spawn(async move {
        let mut transformer = StreamTransformer::new();
        let mut buffer = String::new();
        let id = format!("chatcmpl-{}", uuid::Uuid::new_v4());

        while let Some(chunk_res) = upstream.next().await {
            let chunk = match chunk_res {
                Ok(c) => c,
                Err(_) => break,
            };
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            while let Some(idx) = buffer.find("\n\n") {
                let event = buffer[..idx].to_string();
                buffer = buffer[idx+2..].to_string();

                if event.starts_with("data: ") {
                    let data = &event[6..];
                    if data == "[DONE]" {
                        let _ = tx.send(Ok(StreamTransformer::done_marker().to_string())).await;
                        return;
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(data) {
                        // Check for reasoning_content (thinking models)
                        if let Some(reasoning) = val.pointer("/message/content/reasoning").and_then(|v| v.as_str()) {
                            if !reasoning.is_empty() {
                                let chunk = serde_json::json!({
                                    "id": &id,
                                    "object": "chat.completion.chunk",
                                    "model": &model_owned,
                                    "choices": [{
                                        "index": 0,
                                        "delta": {
                                            "reasoning_content": reasoning
                                        }
                                    }]
                                });
                                let _ = tx.send(Ok(format!("data: {}\n\n", chunk))).await;
                            }
                        }

                        // Regular content
                        if let Some(parts) = val.pointer("/message/content/parts").and_then(|v| v.as_array()) {
                            let parsed_text = parse_message_parts(parts);
                            if !parsed_text.is_empty() {
                                let delta = transformer.transform_chunk(&parsed_text);
                                if !delta.is_empty() {
                                    let sse = transformer.build_sse_response(&id, &model_owned, &delta);
                                    let _ = tx.send(Ok(sse)).await;
                                }
                            }
                        }
                    }
                }
            }
        }

        let _ = tx.send(Ok(StreamTransformer::done_marker().to_string())).await;
    });

    let stream = ReceiverStream::new(rx);
    let body = Body::from_stream(stream);

    Ok(Response::builder()
        .status(200)
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .body(body)
        .unwrap())
}

/// Convert OpenAI-format messages to CleanMessage for hashing.
fn to_clean_messages(messages: &[Value]) -> Vec<CleanMessage> {
    messages.iter().map(|m| CleanMessage {
        role: m.get("role").and_then(|v| v.as_str()).unwrap_or("user").to_string(),
        content: m.get("content").and_then(|v| v.as_str()).map(|s| s.to_string()),
        name: m.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        tool_calls: None,
        tool_call_id: None,
    }).collect()
}

pub async fn chat_completions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut req): Json<ChatCompletionRequest>,
) -> Result<Response, AppError> {
    
    let start_time = std::time::Instant::now();
    let token = headers.get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Auth("Missing or invalid Authorization header".to_string()))?;
        
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let token_hash = hex::encode(hasher.finalize());
    
    let db = &state.db;
    let auth_res: Result<(String, bool), _> = db.call(move |conn| {
        conn.query_row(
            "SELECT id, is_active FROM api_keys WHERE secret_hash = ?",
            [&token_hash],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
        )
    }).await;
    
    let key_id = match auth_res {
        Ok((id, is_active)) if is_active => {
            // Update last_used_at
            let id_clone = id.clone();
            let now = chrono::Utc::now().to_rfc3339();
            let _ = db.call(move |conn| {
                conn.execute("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [&now, &id_clone])
            }).await;
            id
        },
        _ => return Err(AppError::Auth("Invalid or inactive API key".to_string())),
    };
    
    // 1. Inject tool prompts
    req.messages = inject_tool_prompt(&state.tool_registry, req.messages);
    
    // 2. Model Auto-Upgrade
    let has_tools = !state.tool_registry.all_definitions().is_empty();
    let mut target_model = req.model.clone();
    if has_tools {
        if state.config.tool_force_thinking {
            target_model = state.config.tool_thinking_model.clone();
        } else if target_model.starts_with("gpt-3.5") || target_model == "gpt-4" {
            target_model = "gpt-4o".to_string();
        }
    }

    // 3. Compute conversation hash and look up cache
    let clean_msgs = to_clean_messages(&req.messages);
    let msg_hash = hash_messages(&clean_msgs);
    let cached_ctx = state.conversation_cache.lookup(&msg_hash).await;

    // 4. Build ChatGPT Request — stateful if cached, stateless otherwise
    let mut prompt = String::new();
    for msg in &req.messages {
        if let Some(role) = msg.get("role").and_then(|r| r.as_str()) {
            let mut message_text = String::new();
            if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                if !content.is_empty() {
                    message_text.push_str(content);
                }
            } else if let Some(content_array) = msg.get("content").and_then(|c| c.as_array()) {
                let mut text_parts = Vec::new();
                for part in content_array {
                    if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                        text_parts.push(text.to_string());
                    }
                }
                if !text_parts.is_empty() {
                    message_text.push_str(&text_parts.join("\n"));
                }
            }
            
            if let Some(tool_calls) = msg.get("tool_calls").and_then(|tc| tc.as_array()) {
                if !message_text.is_empty() {
                    message_text.push_str("\n");
                }
                message_text.push_str(&serde_json::to_string_pretty(tool_calls).unwrap_or_default());
            }

            if !message_text.is_empty() {
                prompt.push_str(&format!("{}:\n{}\n\n", role.to_uppercase(), message_text));
            }
        }
    }
    let prompt = prompt.trim().to_string();
    let mut chatgpt_req = if let Some(ctx) = &cached_ctx {
        crate::chatgpt::client::ChatGPTClient::build_stateful_request(
            prompt,
            target_model.clone(),
            ctx.conversation_id.clone(),
            ctx.parent_message_id.clone(),
        )
    } else {
        crate::chatgpt::client::ChatGPTClient::build_stateless_request(prompt, target_model.clone())
    };

    // 4.5. Run session warmup if needed
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
        // Warmup failures are non-fatal, just log
        tracing::warn!("Session warmup failed: {}", e);
    }

    // 5. Streaming path — only if no tools (tool loops require buffering)
    let is_streaming = req.stream == Some(true);
    if is_streaming && !has_tools {
        return handle_streaming(&state, chatgpt_req, &target_model).await;
    }

    // 6. Non-streaming path (with tool loop support)
    let mut iterations = 0;
    let max_iterations = 5;
    let parser = ToolParser::new(&state.tool_registry);

    let mut status_code = 200;
    let mut final_error: Option<String> = None;
    
    let mut response_result = Ok((StatusCode::OK, Json(json!({}))).into_response());

    loop {
        iterations += 1;
        if iterations > max_iterations {
            status_code = 500;
            final_error = Some("Max tool loop iterations reached".to_string());
            response_result = Err(AppError::Internal("Max tool loop iterations reached".to_string()));
            break;
        }

        let result = match consume_and_continue(&state, chatgpt_req.clone()).await {
            Ok(r) => r,
            Err(e) => {
                status_code = 500;
                final_error = Some(e.to_string());
                response_result = Err(e);
                break;
            }
        };

        // Store conversation context for future stateful requests
        if let Some(conv_id) = &result.conversation_id {
            let ctx = ConversationContext {
                conversation_id: conv_id.clone(),
                parent_message_id: result.last_message_id.clone(),
                original_tool_calls: HashMap::new(),
                last_accessed: std::time::Instant::now(),
            };
            state.conversation_cache.store(msg_hash.clone(), ctx).await;
        }

        // Parse response for tool calls
        match parser.parse_tool_calls(&result.text) {
            Ok(tool_calls) => {
                if tool_calls.is_empty() {
                    if is_streaming {
                        let sse_json = json!({
                            "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                            "object": "chat.completion.chunk",
                            "model": &target_model,
                            "choices": [{
                                "index": 0,
                                "delta": {
                                    "role": "assistant",
                                    "content": result.text
                                },
                                "finish_reason": "stop"
                            }]
                        });
                        let sse_body = format!("data: {}\n\ndata: [DONE]\n\n", sse_json);
                        response_result = Ok((
                            StatusCode::OK,
                            [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                            sse_body
                        ).into_response());
                    } else {
                        response_result = Ok((StatusCode::OK, Json(json!({
                            "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                            "object": "chat.completion",
                            "model": &target_model,
                            "choices": [{
                                "index": 0,
                                "message": {
                                    "role": "assistant",
                                    "content": result.text
                                },
                                "finish_reason": "stop"
                            }]
                        }))).into_response());
                    }
                    break;
                }

                // Execute tools
                let mut results_content = String::from("Tool execution results:\n");
                for call in tool_calls {
                    let res = state.tool_executor.execute(&call).await;
                    results_content.push_str(&format!(
                        "Call ID: {}\nSuccess: {}\nOutput: {}\nError: {:?}\n\n",
                        call.id, res.success, res.output, res.error
                    ));
                }

                // Append tool results and loop
                chatgpt_req.messages.push(crate::chatgpt::models::ChatGPTMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    author: crate::chatgpt::models::Author { role: "tool".to_string() },
                    content: crate::chatgpt::models::Content {
                        content_type: "text".to_string(),
                        parts: vec![results_content],
                    }
                });
                chatgpt_req.action = "next".to_string();
            }
            Err(crate::tools::parser::ParseError::NoMarkersFound) => {
                if is_streaming {
                    let sse_json = json!({
                        "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                        "object": "chat.completion.chunk",
                        "model": &target_model,
                        "choices": [{
                            "index": 0,
                            "delta": {
                                "role": "assistant",
                                "content": result.text
                            },
                            "finish_reason": "stop"
                        }]
                    });
                    let sse_body = format!("data: {}\n\ndata: [DONE]\n\n", sse_json);
                    response_result = Ok((
                        StatusCode::OK,
                        [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                        sse_body
                    ).into_response());
                } else {
                    response_result = Ok((StatusCode::OK, Json(json!({
                        "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                        "object": "chat.completion",
                        "model": &target_model,
                        "choices": [{
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": result.text
                            },
                            "finish_reason": "stop"
                        }]
                    }))).into_response());
                }
                break;
            }
            Err(crate::tools::parser::ParseError::MalformedJson(e)) | Err(crate::tools::parser::ParseError::ValidationError(e)) => {
                chatgpt_req.messages.push(crate::chatgpt::models::ChatGPTMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    author: crate::chatgpt::models::Author { role: "system".to_string() },
                    content: crate::chatgpt::models::Content {
                        content_type: "text".to_string(),
                        parts: vec![format!("Tool call failed: {}\nPlease fix your syntax and try again.", e)],
                    }
                });
                chatgpt_req.action = "next".to_string();
            }
        }
    }
    
    // Log request
    let duration_ms = start_time.elapsed().as_millis() as u32;
    let req_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let endpoint = "/v1/chat/completions".to_string();
    
    let _ = db.call(move |conn| {
        conn.execute(
            "INSERT INTO request_logs (id, created_at, key_id, model, endpoint, status, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (&req_id, &now, &key_id, &target_model, &endpoint, status_code, duration_ms, &final_error),
        )
    }).await;
    
    response_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_message_parts() {
        let parts = vec![
            json!("Here is the image:"),
            json!({
                "content_type": "image_asset_pointer",
                "asset_pointer": "file-service://file-123456789"
            }),
            json!({
                "url": "https://example.com/image.png"
            })
        ];
        
        let result = parse_message_parts(&parts);
        
        assert!(result.contains("Here is the image:"));
        assert!(result.contains("![image](https://chatgpt.com/backend-api/files/file-123456789/download)"));
        assert!(result.contains("![image](https://example.com/image.png)"));
    }
}

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use tracing::error;

/// Application-wide error type.
///
/// Every variant maps to an HTTP status code and produces a JSON error body
/// compatible with the OpenAI error format:
/// ```json
/// { "error": { "message": "...", "type": "...", "code": "..." } }
/// ```
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Internal server error: {0}")]
    Internal(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Tool execution error: {0}")]
    ToolError(String),

    #[error("Upstream service unavailable: {0}")]
    Upstream(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_type, error_message) = match &self {
            AppError::Config(msg) => (StatusCode::INTERNAL_SERVER_ERROR, "server_error", msg.clone()),
            AppError::Auth(msg) => (StatusCode::UNAUTHORIZED, "authentication_error", msg.clone()),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, "server_error", msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "invalid_request_error", msg.clone()),
            AppError::RateLimited(msg) => (StatusCode::TOO_MANY_REQUESTS, "rate_limit_error", msg.clone()),
            AppError::ToolError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, "tool_error", msg.clone()),
            AppError::Upstream(msg) => (StatusCode::BAD_GATEWAY, "upstream_error", msg.clone()),
        };

        // Log internal/upstream errors at error level for operators
        match &self {
            AppError::Internal(_) | AppError::Upstream(_) | AppError::Config(_) => {
                error!("{}", self);
            }
            _ => {}
        }

        let body = Json(json!({
            "error": {
                "message": error_message,
                "type": error_type,
                "code": status.as_u16()
            }
        }));

        (status, body).into_response()
    }
}

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use crate::AppState;
use std::sync::Arc;

pub async fn list_models(State(_state): State<Arc<AppState>>) -> Response {
    let models = json!({
        "object": "list",
        "data": [
            // GPT-5.6 Family (Frontier)
            { "id": "gpt-5.6-sol", "object": "model", "created": 1718000000, "owned_by": "openai" },
            { "id": "gpt-5.6-terra", "object": "model", "created": 1718000000, "owned_by": "openai" },
            { "id": "gpt-5.6-luna", "object": "model", "created": 1718000000, "owned_by": "openai" },
            
            // GPT-5.5 & GPT-5.4 Families
            { "id": "gpt-5.5", "object": "model", "created": 1700000000, "owned_by": "openai" },
            { "id": "gpt-5.5-pro", "object": "model", "created": 1700000000, "owned_by": "openai" },
            { "id": "gpt-5.4-pro", "object": "model", "created": 1690000000, "owned_by": "openai" },
            { "id": "gpt-5.4-mini", "object": "model", "created": 1690000000, "owned_by": "openai" },
            { "id": "gpt-5.4-nano", "object": "model", "created": 1690000000, "owned_by": "openai" },

            // Reasoning Models
            { "id": "o3-mini", "object": "model", "created": 1705000000, "owned_by": "openai" },
            { "id": "o1", "object": "model", "created": 1686935002, "owned_by": "openai" },
            { "id": "o1-mini", "object": "model", "created": 1686935002, "owned_by": "openai" },

            // Legacy GPT-4o Family
            { "id": "gpt-4o", "object": "model", "created": 1686935002, "owned_by": "openai" },
            { "id": "gpt-4o-mini", "object": "model", "created": 1686935002, "owned_by": "openai" }
        ]
    });

    Json(models).into_response()
}

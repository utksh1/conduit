use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use bcrypt::verify;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    middleware::{bearer_token, create_admin_token, is_valid_admin_token},
    AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub needs_setup: bool,
    pub authenticated: bool,
}

#[derive(Deserialize)]
pub struct AuthPayload {
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
}

pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let authenticated = bearer_token(&headers)
        .map(|token| is_valid_admin_token(token, &state.config.jwt_secret))
        .unwrap_or(false);

    (
        StatusCode::OK,
        Json(StatusResponse {
            needs_setup: false,
            authenticated,
        }),
    )
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    if !verify(&payload.password, &state.config.admin_password_hash).unwrap_or(false) {
        return (StatusCode::UNAUTHORIZED, "Invalid password").into_response();
    }

    match create_admin_token(&state.config.jwt_secret) {
        Ok(token) => (StatusCode::OK, Json(AuthResponse { token })).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to create an admin session",
        )
            .into_response(),
    }
}

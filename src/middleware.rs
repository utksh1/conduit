use axum::{
    extract::{Request, State},
    http::{header, HeaderMap},
    middleware::Next,
    response::Response,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use subtle::ConstantTimeEq;

use crate::{error::AppError, AppState};

const ADMIN_SUBJECT: &str = "admin";
const TOKEN_LIFETIME_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

#[derive(Debug, Clone)]
pub enum ApiCredential {
    Proxy,
    DatabaseKey(String),
}

impl ApiCredential {
    pub fn database_key_id(&self) -> Option<&str> {
        match self {
            Self::Proxy => None,
            Self::DatabaseKey(id) => Some(id),
        }
    }
}

pub fn create_admin_token(secret: &str) -> Result<String, AppError> {
    let expiration = Utc::now()
        .checked_add_signed(Duration::days(TOKEN_LIFETIME_DAYS))
        .ok_or_else(|| AppError::Internal("Unable to create an admin session".to_string()))?
        .timestamp();

    let claims = Claims {
        sub: ADMIN_SUBJECT.to_string(),
        exp: expiration as usize,
    };

    let mut header = Header::new(Algorithm::HS256);
    header.typ = Some("JWT".to_string());

    encode(&header, &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|_| AppError::Internal("Unable to create an admin session".to_string()))
}

pub fn is_valid_admin_token(token: &str, secret: &str) -> bool {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.set_required_spec_claims(&["exp", "sub"]);

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims.sub == ADMIN_SUBJECT)
    .unwrap_or(false)
}

pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?.trim();
    let (scheme, token) = value.split_once(char::is_whitespace)?;

    if scheme.eq_ignore_ascii_case("bearer") && !token.trim().is_empty() {
        Some(token.trim())
    } else {
        None
    }
}

pub async fn require_admin_auth(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = bearer_token(req.headers())
        .ok_or_else(|| AppError::Auth("Missing or invalid Authorization header".to_string()))?;

    if !is_valid_admin_token(token, &state.config.jwt_secret) {
        return Err(AppError::Auth("Invalid or expired admin session".to_string()));
    }

    Ok(next.run(req).await)
}

pub async fn require_api_credential(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = bearer_token(req.headers())
        .ok_or_else(|| AppError::Auth("Missing or invalid Authorization header".to_string()))?;

    let credential = if token
        .as_bytes()
        .ct_eq(state.config.proxy_api_key.as_bytes())
        .into()
    {
        ApiCredential::Proxy
    } else {
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        let token_hash = hex::encode(hasher.finalize());

        let key = state
            .db
            .call(move |conn| {
                conn.query_row(
                    "SELECT id FROM api_keys WHERE secret_hash = ? AND is_active = 1",
                    [&token_hash],
                    |row| row.get::<_, String>(0),
                )
            })
            .await
            .ok();

        let key_id = key.ok_or_else(|| AppError::Auth("Invalid or inactive API key".to_string()))?;
        let key_id_for_update = key_id.clone();
        let now = Utc::now().to_rfc3339();
        let _ = state
            .db
            .call(move |conn| {
                conn.execute(
                    "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
                    [&now, &key_id_for_update],
                )
            })
            .await;

        ApiCredential::DatabaseKey(key_id)
    };

    req.extensions_mut().insert(credential);
    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn accepts_valid_admin_tokens() {
        let secret = "a".repeat(32);
        let token = create_admin_token(&secret).unwrap();

        assert!(is_valid_admin_token(&token, &secret));
        assert!(!is_valid_admin_token(&token, &"b".repeat(32)));
    }

    #[test]
    fn parses_bearer_tokens_case_insensitively() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("bearer token-value"),
        );
        assert_eq!(bearer_token(&headers), Some("token-value"));

        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Basic token-value"),
        );
        assert_eq!(bearer_token(&headers), None);
    }
}

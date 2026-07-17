use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::AppState;
use uuid::Uuid;
use chrono::Utc;
use sha2::{Sha256, Digest};
use rand::RngCore;

#[derive(Serialize)]
pub struct ApiKeyResponse {
    pub id: String,
    pub name: String,
    pub key_hint: String,
    pub is_active: bool,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Serialize)]
pub struct ApiKeyListResponse {
    pub keys: Vec<ApiKeyResponse>,
}

#[derive(Deserialize)]
pub struct CreateKeyRequest {
    pub name: String,
}

#[derive(Serialize)]
pub struct CreateKeyResponse {
    pub key: ApiKeyResponse,
    pub secret: String,
}

#[derive(Deserialize)]
pub struct UpdateKeyRequest {
    pub is_active: Option<bool>,
}

fn generate_secret() -> String {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    format!("sk-cond-{}", hex::encode(key))
}

fn hash_secret(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

pub async fn list_keys(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let db = &state.db;

    let res: Result<Vec<ApiKeyResponse>, _> = db.call(|conn| {
        let mut stmt = conn.prepare("SELECT id, name, key_hint, is_active, created_at, last_used_at FROM api_keys ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(ApiKeyResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                key_hint: row.get(2)?,
                is_active: row.get(3)?,
                created_at: row.get(4)?,
                last_used_at: row.get(5)?,
            })
        })?;

        let mut keys = Vec::new();
        for k in rows {
            keys.push(k?);
        }
        Ok::<Vec<ApiKeyResponse>, rusqlite::Error>(keys)
    }).await;

    match res {
        Ok(keys) => (StatusCode::OK, Json(ApiKeyListResponse { keys })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn create_key(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateKeyRequest>,
) -> impl IntoResponse {
    let secret = generate_secret();
    let secret_hash = hash_secret(&secret);
    let key_hint = format!("...{}", &secret[secret.len()-4..]);
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();

    let db = &state.db;
    
    let key_res = ApiKeyResponse {
        id: id.clone(),
        name: payload.name.clone(),
        key_hint: key_hint.clone(),
        is_active: true,
        created_at: created_at.clone(),
        last_used_at: None,
    };

    let res = db.call(move |conn| {
        conn.execute(
            "INSERT INTO api_keys (id, name, secret_hash, key_hint, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
            (&id, &payload.name, &secret_hash, &key_hint, &created_at),
        )
    }).await;

    match res {
        Ok(_) => (StatusCode::OK, Json(CreateKeyResponse { key: key_res, secret })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn update_key(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateKeyRequest>,
) -> impl IntoResponse {
    let db = &state.db;
    let res = db.call(move |conn| {
        if let Some(active) = payload.is_active {
            conn.execute("UPDATE api_keys SET is_active = ? WHERE id = ?", (active, &id))?;
        }
        Ok::<(), rusqlite::Error>(())
    }).await;

    match res {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn delete_key(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let db = &state.db;
    let res = db.call(move |conn| {
        conn.execute("DELETE FROM api_keys WHERE id = ?", [&id])
    }).await;

    match res {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn rotate_key(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let secret = generate_secret();
    let secret_hash = hash_secret(&secret);
    let key_hint = format!("...{}", &secret[secret.len()-4..]);
    
    let db = &state.db;
    let id_clone = id.clone();
    
    let res = db.call(move |conn| {
        conn.execute("UPDATE api_keys SET secret_hash = ?, key_hint = ? WHERE id = ?", (&secret_hash, &key_hint, &id_clone))?;
        
        let mut stmt = conn.prepare("SELECT name, is_active, created_at, last_used_at FROM api_keys WHERE id = ?")?;
        stmt.query_row([&id_clone], |row| {
            Ok(ApiKeyResponse {
                id: id_clone.clone(),
                name: row.get(0)?,
                key_hint: key_hint.clone(),
                is_active: row.get(1)?,
                created_at: row.get(2)?,
                last_used_at: row.get(3)?,
            })
        })
    }).await;

    match res {
        Ok(key_res) => (StatusCode::OK, Json(CreateKeyResponse { key: key_res, secret })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

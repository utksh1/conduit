use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::AppState;
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{encode, Header, EncodingKey};
use chrono::{Utc, Duration};
use axum_extra::extract::cookie::{Cookie, CookieJar};

#[derive(Serialize)]
pub struct StatusResponse {
    pub needsSetup: bool,
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

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

// Generate JWT token
fn create_jwt() -> String {
    let expiration = Utc::now()
        .checked_add_signed(Duration::days(7))
        .expect("valid timestamp")
        .timestamp();

    let claims = Claims {
        sub: "admin".to_owned(),
        exp: expiration as usize,
    };

    // In a real app, use a secret key from env/DB
    encode(&Header::default(), &claims, &EncodingKey::from_secret(b"secret")).unwrap()
}

pub async fn status(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> impl IntoResponse {
    let db = &state.db;
    let count: i64 = db.call(|conn| {
        conn.query_row("SELECT COUNT(*) FROM admin", [], |row| row.get(0))
    }).await.unwrap_or(0);

    let needs_setup = count == 0;
    
    // Check if authenticated
    // Note: the frontend sends tokens in Authorization Bearer usually, but the status endpoint in App.tsx sends `skipAuth: !token` and relies on cookie? No, `Bearer` token. We will handle auth check via a middleware later. But for `status`, we just return `authenticated: false` if we can't extract the Bearer token or it's invalid.
    let authenticated = false; // We can implement token check properly later if needed, but the frontend usually checks if it has a token.

    (StatusCode::OK, Json(StatusResponse { needsSetup: needs_setup, authenticated }))
}

pub async fn setup(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    let db = &state.db;
    
    let count: i64 = db.call(|conn| {
        conn.query_row("SELECT COUNT(*) FROM admin", [], |row| row.get(0))
    }).await.unwrap_or(0);

    if count > 0 {
        return (StatusCode::BAD_REQUEST, "Admin already setup").into_response();
    }

    let hashed = hash(payload.password, DEFAULT_COST).unwrap();

    let res = db.call(move |conn| {
        conn.execute("INSERT INTO admin (id, password_hash) VALUES (1, ?)", [hashed])
    }).await;

    match res {
        Ok(_) => {
            let token = create_jwt();
            (StatusCode::OK, Json(AuthResponse { token })).into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    let db = &state.db;

    let hash_result: Result<String, _> = db.call(|conn| {
        conn.query_row("SELECT password_hash FROM admin WHERE id = 1", [], |row| row.get(0))
    }).await;

    match hash_result {
        Ok(stored_hash) => {
            if verify(&payload.password, &stored_hash).unwrap_or(false) {
                let token = create_jwt();
                (StatusCode::OK, Json(AuthResponse { token })).into_response()
            } else {
                (StatusCode::UNAUTHORIZED, "Invalid password").into_response()
            }
        },
        Err(_) => (StatusCode::UNAUTHORIZED, "Admin not setup").into_response(),
    }
}

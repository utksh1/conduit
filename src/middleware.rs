use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

pub async fn require_auth(req: Request, next: Next) -> Result<Response, StatusCode> {
    let auth_header = req.headers().get(header::AUTHORIZATION)
        .and_then(|val| val.to_str().ok());

    let token = if let Some(auth_header) = auth_header {
        if auth_header.starts_with("Bearer ") {
            auth_header.trim_start_matches("Bearer ")
        } else {
            return Err(StatusCode::UNAUTHORIZED);
        }
    } else {
        return Err(StatusCode::UNAUTHORIZED);
    };

    // In a real app, use the same secret key from env/DB
    match decode::<Claims>(
        token,
        &DecodingKey::from_secret(b"secret"),
        &Validation::default(),
    ) {
        Ok(_) => Ok(next.run(req).await),
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}

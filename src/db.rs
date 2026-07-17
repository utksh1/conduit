use tokio_rusqlite::Connection;
use tracing::info;
use crate::error::AppError;

pub async fn init_db(db_path: &str) -> Result<Connection, AppError> {
    info!("Initializing SQLite database at {}", db_path);
    let conn = Connection::open(db_path).await.map_err(|e| AppError::Internal(e.to_string()))?;

    conn.call(|conn| {
        // Setup tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS admin (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                password_hash TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS api_keys (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                secret_hash TEXT NOT NULL,
                key_hint TEXT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                last_used_at TEXT
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS request_logs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                key_id TEXT,
                model TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                status INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                error TEXT
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                details TEXT NOT NULL
            )",
            [],
        )?;

        Ok(())
    })
    .await
    .map_err(|e: tokio_rusqlite::Error| AppError::Internal(e.to_string()))?;

    Ok(conn)
}

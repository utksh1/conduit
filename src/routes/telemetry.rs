use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::AppState;

#[derive(Deserialize)]
pub struct LogsQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Serialize)]
pub struct LogRow {
    pub id: String,
    pub created_at: String,
    pub model: Option<String>,
    pub endpoint: String,
    pub status: String,
    pub status_code: u16,
    pub latency_ms: Option<u32>,
    pub api_key_name: Option<String>,
}

#[derive(Serialize)]
pub struct LogsResponse {
    pub logs: Vec<LogRow>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Deserialize)]
pub struct MetricsQuery {
    pub hours: Option<u32>,
}

#[derive(Serialize)]
pub struct ChartDataPoint {
    pub timestamp: String,
    pub requests: u32,
    pub errors: u32,
}

#[derive(Serialize, Default)]
pub struct MetricsTotals {
    pub requests: u32,
    pub success: u32,
    pub error: u32,
    pub rate_limited: u32,
    pub auth_failed: u32,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Serialize)]
pub struct MetricsSeries {
    pub bucket_start: String,
    pub requests: u32,
    pub success: u32,
    pub error: u32,
    pub rate_limited: u32,
}

#[derive(Serialize)]
pub struct MetricsModelBreakdown {
    pub model: String,
    pub count: u32,
}

#[derive(Serialize)]
pub struct MetricsResponse {
    pub window_hours: u32,
    pub totals: MetricsTotals,
    pub series: Vec<MetricsSeries>,
    pub model_breakdown: Vec<MetricsModelBreakdown>,
}

#[derive(Deserialize)]
pub struct AuditQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Serialize)]
pub struct AuditRow {
    pub id: String,
    pub created_at: String,
    pub action: String,
    pub actor: String,
    pub details: String,
}

#[derive(Serialize)]
pub struct AuditResponse {
    pub entries: Vec<AuditRow>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

pub async fn get_logs(
    Query(query): Query<LogsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);
    let db = &state.db;

    let res: Result<(Vec<LogRow>, usize), _> = db.call(move |conn| {
        let mut count_stmt = conn.prepare("SELECT COUNT(*) FROM request_logs")?;
        let total: usize = count_stmt.query_row([], |row| row.get(0))?;

        let mut stmt = conn.prepare(
            "SELECT r.id, r.created_at, r.model, r.endpoint, r.status, r.duration_ms, r.error, k.name 
             FROM request_logs r 
             LEFT JOIN api_keys k ON r.key_id = k.id 
             ORDER BY r.created_at DESC LIMIT ? OFFSET ?"
        )?;
        let rows = stmt.query_map([limit, offset], |row| {
            let status_code: u16 = row.get(4)?;
            Ok(LogRow {
                id: row.get(0)?,
                created_at: row.get(1)?,
                model: row.get(2).ok(),
                endpoint: row.get(3)?,
                status: if status_code < 400 { "success".to_string() } else if status_code == 429 { "rate_limited".to_string() } else if status_code == 401 { "auth_failed".to_string() } else { "error".to_string() },
                status_code,
                latency_ms: row.get(5).ok(),
                api_key_name: row.get(7).ok(),
            })
        })?;

        let mut logs = Vec::new();
        for r in rows {
            logs.push(r?);
        }
        Ok::<(Vec<LogRow>, usize), rusqlite::Error>((logs, total))
    }).await;

    match res {
        Ok((logs, total)) => (StatusCode::OK, Json(LogsResponse { logs, total, limit, offset })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn get_metrics(
    Query(query): Query<MetricsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let hours = query.hours.unwrap_or(24);
    let db = &state.db;
    
    let res: Result<(MetricsTotals,), _> = db.call(move |conn| {
        let total: u32 = conn.query_row("SELECT COUNT(*) FROM request_logs", [], |row| row.get(0)).unwrap_or(0);
        let errors: u32 = conn.query_row("SELECT COUNT(*) FROM request_logs WHERE status >= 400 AND status != 429", [], |row| row.get(0)).unwrap_or(0);
        let success: u32 = conn.query_row("SELECT COUNT(*) FROM request_logs WHERE status < 400", [], |row| row.get(0)).unwrap_or(0);
        let rate_limited: u32 = conn.query_row("SELECT COUNT(*) FROM request_logs WHERE status = 429", [], |row| row.get(0)).unwrap_or(0);
        
        let totals = MetricsTotals {
            requests: total,
            success,
            error: errors,
            rate_limited,
            auth_failed: 0,
            input_tokens: 0,
            output_tokens: 0,
        };
        Ok::<(MetricsTotals,), rusqlite::Error>((totals,))
    }).await;

    match res {
        Ok((totals,)) => (StatusCode::OK, Json(MetricsResponse {
            window_hours: hours,
            totals,
            series: vec![],
            model_breakdown: vec![],
        })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn get_audit(
    Query(query): Query<AuditQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);
    let db = &state.db;

    let res: Result<(Vec<AuditRow>, usize), _> = db.call(move |conn| {
        let mut count_stmt = conn.prepare("SELECT COUNT(*) FROM audit_logs")?;
        let total: usize = count_stmt.query_row([], |row| row.get(0))?;

        let mut stmt = conn.prepare(
            "SELECT id, created_at, action, actor, details 
             FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?"
        )?;
        let rows = stmt.query_map([limit, offset], |row| {
            Ok(AuditRow {
                id: row.get(0)?,
                created_at: row.get(1)?,
                action: row.get(2)?,
                actor: row.get(3)?,
                details: row.get(4)?,
            })
        })?;

        let mut entries = Vec::new();
        for r in rows {
            entries.push(r?);
        }
        Ok::<(Vec<AuditRow>, usize), rusqlite::Error>((entries, total))
    }).await;

    match res {
        Ok((entries, total)) => (StatusCode::OK, Json(AuditResponse { entries, total, limit, offset })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

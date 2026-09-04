use wreq::Client;
use serde_json::{json, Value};
use tracing::{debug, info, warn};

use super::pow::{solve_pow_with_config, PREPARE_PREFIX};
use crate::error::AppError;

/// Sentinel chat requirements response
#[derive(Debug)]
pub struct SentinelRequirements {
    pub token: String,
    pub proof_required: bool,
    pub seed: Option<String>,
    pub difficulty: Option<String>,
}

/// Get Sentinel chat requirements with optional prepare token
/// This is the first step in the two-step PoW process
pub async fn get_chat_requirements(
    client: &Client,
    access_token: &str,
    session_token: &str,
    cookie_header: &str,
    user_agent: &str,
    base_url: &str,
    with_prepare: bool,
) -> Result<SentinelRequirements, AppError> {
    let base = base_url.trim_end_matches("/backend-api/conversation");
    let url = format!("{}/backend-api/sentinel/chat-requirements", base);
    let dpl_info = super::dpl::get_dpl_info(client).await;

    let device_id = crate::chatgpt::headers::generate_device_id(session_token);
    let headers = crate::chatgpt::headers::build_chatgpt_headers_with_version(
        &device_id,
        None,
        true,
        Some(&dpl_info.dpl),
    );
    
    // Step 1: Solve prepare PoW if requested
    let mut prepare_token = if with_prepare {
        info!("Solving Sentinel prepare PoW...");
        match solve_pow_with_config(
            "",              // Empty seed for prepare
            "0fffff",        // Standard prepare difficulty
            PREPARE_PREFIX,  // "gAAAAAC" prefix
            user_agent,
            client,
            100_000,         // Max iterations
        ).await {
            Some(token) => {
                debug!("Prepare PoW solved");
                Some(token)
            }
            None => {
                warn!("Prepare PoW failed, continuing without it");
                None
            }
        }
    } else {
        None
    };
    
    // Step 2: Helper to send chat requirements request
    let send_requirements_request = |p_token: Option<&str>| {
        let mut req_body = json!({
            "conversation_mode_kind": "primary_assistant"
        });
        if let Some(p) = p_token {
            req_body["p"] = json!(p);
        }
        client
            .post(&url)
            .headers(headers.clone())
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Cookie", cookie_header)
            .header("Content-Type", "application/json")
            .json(&req_body)
    };

    let mut response = send_requirements_request(prepare_token.as_deref())
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Sentinel requirements request failed: {}", e)))?;

    // If initial attempt without prepare failed (common on datacenter IPs with 403), solve prepare PoW and retry
    if !response.status().is_success() && prepare_token.is_none() {
        warn!(
            "Sentinel requirements returned status {}, solving prepare PoW and retrying...",
            response.status()
        );
        if let Some(p) = solve_pow_with_config(
            "",
            "0fffff",
            PREPARE_PREFIX,
            user_agent,
            client,
            100_000,
        ).await {
            prepare_token = Some(p.clone());
            response = send_requirements_request(Some(&p))
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("Sentinel requirements retry failed: {}", e)))?;
        }
    }
    
    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        warn!("Sentinel requirements failed with status {}: {}", status, body_text);
        return Err(AppError::Upstream(format!(
            "Sentinel requirements returned status {}",
            status
        )));
    }
    
    let body: Value = response
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Sentinel response: {}", e)))?;
    
    // Parse response
    let token = body
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Upstream("Sentinel response missing 'token'".to_string()))?
        .to_string();
    
    let proof_required = body
        .get("proofofwork")
        .and_then(|p| p.get("required"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    
    let seed = body
        .pointer("/proofofwork/seed")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    
    let difficulty = body
        .pointer("/proofofwork/difficulty")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    
    debug!(
        "Sentinel requirements: token={}, proof_required={}, difficulty={:?}",
        &token[..8.min(token.len())],
        proof_required,
        difficulty
    );
    
    Ok(SentinelRequirements {
        token,
        proof_required,
        seed,
        difficulty,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sentinel_requirements_struct() {
        let req = SentinelRequirements {
            token: "test_token".to_string(),
            proof_required: true,
            seed: Some("test_seed".to_string()),
            difficulty: Some("0fffff".to_string()),
        };
        
        assert_eq!(req.token, "test_token");
        assert!(req.proof_required);
        assert_eq!(req.seed.unwrap(), "test_seed");
        assert_eq!(req.difficulty.unwrap(), "0fffff");
    }
}

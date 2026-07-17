use base64::{engine::general_purpose, Engine as _};
use wreq::Client;
use serde_json::Value;
use sha3::{Digest, Sha3_512};
use std::time::Duration;
use tokio::time::timeout;
use tracing::{debug, info};

use super::dpl::get_dpl_info;
use super::prekey::build_prekey_config;

/// PoW prefix for conversation requests
pub const CONVERSATION_PREFIX: &str = "gAAAAAB";

/// PoW prefix for prepare requests
pub const PREPARE_PREFIX: &str = "gAAAAAC";

/// Count the number of leading zero bits in a byte slice (legacy method, kept for compatibility)
fn count_leading_zero_bits(hash: &[u8]) -> usize {
    let mut count = 0;
    for &byte in hash {
        if byte == 0 {
            count += 8;
        } else {
            count += byte.leading_zeros() as usize;
            break;
        }
    }
    count
}

/// Compare hex string prefix (new OmniRoute method)
/// Returns true if hash_hex <= target_hex (lexicographically)
fn compare_hex_prefix(hash_hex: &str, target_hex: &str) -> bool {
    if target_hex.is_empty() {
        return true;
    }
    
    let len = target_hex.len().min(hash_hex.len());
    &hash_hex[..len] <= target_hex
}

/// Solve PoW using prekey config approach (OmniRoute/chat2api style)
/// This is the new, preferred method for ChatGPT Sentinel
pub async fn solve_pow_with_config(
    seed: &str,
    target: &str,
    prefix: &str,
    user_agent: &str,
    client: &Client,
    max_iterations: u32,
) -> Option<String> {
    info!("Solving PoW with config (target={}, prefix={})", target, prefix);
    
    // Get DPL info (cached)
    let dpl_info = get_dpl_info(client).await;
    
    // Build base prekey config
    let mut config = build_prekey_config(user_agent, &dpl_info.dpl, &dpl_info.script_src);
    
    let seed_owned = seed.to_string();
    let target_owned = target.to_string();
    let prefix_owned = prefix.to_string();
    
    let solve_task = tokio::task::spawn_blocking(move || {
        for iteration in 0..max_iterations {
            // Mutate config[3] with iteration counter
            config[3] = Value::Number(iteration.into());
            
            // Serialize config to JSON
            let json_str = serde_json::to_string(&config).ok()?;
            
            // Base64 encode
            let b64 = general_purpose::STANDARD.encode(json_str.as_bytes());
            
            // Hash: SHA3-512(seed + base64)
            let mut hasher = Sha3_512::new();
            hasher.update(seed_owned.as_bytes());
            hasher.update(b64.as_bytes());
            let hash = hasher.finalize();
            
            // Convert to hex
            let hash_hex = hex::encode(hash);
            
            // Check if hash meets difficulty
            if compare_hex_prefix(&hash_hex, &target_owned) {
                let proof = format!("{}{}", prefix_owned, b64);
                debug!("PoW solved at iteration {} (proof length: {})", iteration, proof.len());
                return Some(proof);
            }
        }
        
        None
    });
    
    // Generous timeout for PoW solving
    match timeout(Duration::from_secs(30), solve_task).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => {
            tracing::warn!("PoW solver task panicked: {}", e);
            None
        }
        Err(_) => {
            tracing::warn!("PoW solver timed out after 30 seconds");
            None
        }
    }
}

/// Legacy PoW solver (simple seed-based, for backward compatibility)
/// This uses the old "seed_N" format with leading zero bits comparison
pub async fn solve_pow_legacy(required: &str, difficulty_str: &str) -> Option<String> {
    let difficulty: usize = difficulty_str.parse().unwrap_or(0);
    
    let required_owned = required.to_string();
    
    let solve_task = tokio::task::spawn_blocking(move || {
        for attempt in 0..1_000_000 {
            let seed = format!("seed_{}", attempt);
            let mut hasher = Sha3_512::new();
            hasher.update(seed.as_bytes());
            hasher.update(required_owned.as_bytes());
            
            let hash = hasher.finalize();
            
            if count_leading_zero_bits(&hash) >= difficulty {
                return Some(seed);
            }
        }
        None
    });

    match timeout(Duration::from_secs(5), solve_task).await {
        Ok(Ok(result)) => result,
        _ => None,
    }
}

/// Main PoW solver entry point - uses legacy method for now
/// TODO: Update client.rs to call solve_pow_with_config directly
pub async fn solve_pow(required: &str, difficulty_str: &str) -> Option<String> {
    solve_pow_legacy(required, difficulty_str).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_leading_zero_bits() {
        assert_eq!(count_leading_zero_bits(&[0x00, 0x00, 0x00]), 24);
        assert_eq!(count_leading_zero_bits(&[0x00, 0x0F, 0x00]), 12);
        assert_eq!(count_leading_zero_bits(&[0xFF, 0x00, 0x00]), 0);
    }

    #[test]
    fn test_compare_hex_prefix() {
        assert!(compare_hex_prefix("00001234", "0000"));
        assert!(compare_hex_prefix("0fffff00", "0fffff"));
        assert!(!compare_hex_prefix("1000", "0fff"));
        assert!(compare_hex_prefix("abc", "abc"));
        assert!(compare_hex_prefix("abc", "abd")); // "abc" <= "abd"
    }

    #[tokio::test]
    async fn test_solve_pow_legacy() {
        let result = solve_pow_legacy("test_req", "4").await;
        assert!(result.is_some());
    }

    #[tokio::test]
    async fn test_solve_pow_with_config() {
        let client = Client::new();
        
        // Very easy target for testing
        let result = solve_pow_with_config(
            "",
            "fffff", // Very easy target
            "gAAAAAB",
            "Mozilla/5.0",
            &client,
            10000,
        ).await;
        
        assert!(result.is_some());
        if let Some(proof) = result {
            assert!(proof.starts_with("gAAAAAB"));
            assert!(proof.len() > 10); // Should have base64 data
        }
    }

    #[test]
    fn test_base64_encoding() {
        let json = r#"{"test":"value"}"#;
        let b64 = general_purpose::STANDARD.encode(json.as_bytes());
        assert!(!b64.is_empty());
        
        // Decode to verify
        let decoded = general_purpose::STANDARD.decode(&b64).unwrap();
        let decoded_str = String::from_utf8(decoded).unwrap();
        assert_eq!(decoded_str, json);
    }
}

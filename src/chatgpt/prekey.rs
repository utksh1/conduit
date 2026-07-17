use rand::Rng;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Navigator keys for browser fingerprinting
const NAVIGATOR_KEYS: &[&str] = &[
    "hardwareConcurrency",
    "deviceMemory",
    "platform",
    "userAgent",
    "language",
    "languages",
];

/// Document keys for browser fingerprinting
const DOCUMENT_KEYS: &[&str] = &[
    "documentElement",
    "body",
    "visibilityState",
    "hidden",
    "title",
];

/// Window keys for browser fingerprinting
const WINDOW_KEYS: &[&str] = &[
    "innerWidth",
    "innerHeight",
    "outerWidth",
    "outerHeight",
    "screenX",
    "screenY",
];

/// Screen sizes (width x height) for randomization
const SCREEN_SIZES: &[u32] = &[3000, 4000, 3120, 4160];

/// CPU core counts for randomization
const CORES: &[u32] = &[8, 16, 24, 32];

/// Pick a random element from a slice
fn pick<T: Clone>(items: &[T]) -> T {
    let mut rng = rand::thread_rng();
    let idx = rng.gen_range(0..items.len());
    items[idx].clone()
}

/// Build the 18-element prekey configuration array for browser fingerprinting
/// This matches OmniRoute's buildPrekeyConfig function
pub fn build_prekey_config(user_agent: &str, dpl: &str, script_src: &str) -> Vec<Value> {
    let now = SystemTime::now();
    let perf_now = now.duration_since(UNIX_EPOCH).unwrap().as_secs_f64() * 1000.0;
    let epoch_offset = now.duration_since(UNIX_EPOCH).unwrap().as_millis() as i64 - perf_now as i64;
    
    vec![
        // [0] Screen size (width)
        Value::Number(pick(SCREEN_SIZES).into()),
        
        // [1] Current datetime string
        Value::String(chrono::Local::now().to_string()),
        
        // [2] Magic constant
        Value::Number(4294705152u64.into()),
        
        // [3] PoW iteration counter (mutated by solver)
        Value::Number(0.into()),
        
        // [4] User agent
        Value::String(user_agent.to_string()),
        
        // [5] Script source (webpack chunk URL)
        Value::String(script_src.to_string()),
        
        // [6] DPL (deployment hash)
        Value::String(dpl.to_string()),
        
        // [7] Language
        Value::String("en-US".to_string()),
        
        // [8] Languages
        Value::String("en-US,en".to_string()),
        
        // [9] Constant zero
        Value::Number(0.into()),
        
        // [10] Random navigator key
        Value::String(pick(NAVIGATOR_KEYS).to_string()),
        
        // [11] Random document key
        Value::String(pick(DOCUMENT_KEYS).to_string()),
        
        // [12] Random window key
        Value::String(pick(WINDOW_KEYS).to_string()),
        
        // [13] Performance timestamp
        Value::Number(serde_json::Number::from_f64(perf_now).unwrap()),
        
        // [14] Random UUID
        Value::String(Uuid::new_v4().to_string()),
        
        // [15] Empty string
        Value::String(String::new()),
        
        // [16] CPU cores
        Value::Number(pick(CORES).into()),
        
        // [17] Epoch offset
        Value::Number(epoch_offset.into()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_prekey_config_length() {
        let config = build_prekey_config("test-ua", "test-dpl", "test-script");
        assert_eq!(config.len(), 18, "Prekey config should have 18 elements");
    }

    #[test]
    fn test_build_prekey_config_structure() {
        let config = build_prekey_config(
            "Mozilla/5.0",
            "prod-abc123",
            "https://cdn.example.com/chunk.js"
        );

        // Check key positions
        assert!(config[0].is_number(), "[0] should be screen width");
        assert!(config[1].is_string(), "[1] should be date string");
        assert_eq!(config[2].as_u64(), Some(4294705152), "[2] should be magic constant");
        assert_eq!(config[3].as_u64(), Some(0), "[3] should be iteration counter (0)");
        assert_eq!(config[4].as_str(), Some("Mozilla/5.0"), "[4] should be user agent");
        assert_eq!(config[5].as_str(), Some("https://cdn.example.com/chunk.js"), "[5] should be script src");
        assert_eq!(config[6].as_str(), Some("prod-abc123"), "[6] should be dpl");
        assert_eq!(config[7].as_str(), Some("en-US"), "[7] should be language");
        assert_eq!(config[8].as_str(), Some("en-US,en"), "[8] should be languages");
        assert_eq!(config[9].as_u64(), Some(0), "[9] should be constant 0");
        assert!(config[10].is_string(), "[10] should be navigator key");
        assert!(config[11].is_string(), "[11] should be document key");
        assert!(config[12].is_string(), "[12] should be window key");
        assert!(config[13].is_f64(), "[13] should be performance timestamp");
        assert!(config[14].is_string(), "[14] should be UUID");
        assert_eq!(config[15].as_str(), Some(""), "[15] should be empty string");
        assert!(config[16].is_number(), "[16] should be CPU cores");
        assert!(config[17].is_number(), "[17] should be epoch offset");
    }

    #[test]
    fn test_pick_randomization() {
        let items = &[1, 2, 3, 4, 5];
        let mut results = std::collections::HashSet::new();
        
        // Pick 100 times, should get some variety
        for _ in 0..100 {
            results.insert(pick(items));
        }
        
        // Should have picked at least 2 different values
        assert!(results.len() >= 2, "pick() should randomize");
    }

    #[test]
    fn test_navigator_keys_valid() {
        for _ in 0..10 {
            let key = pick(NAVIGATOR_KEYS);
            assert!(NAVIGATOR_KEYS.contains(&key));
        }
    }

    #[test]
    fn test_document_keys_valid() {
        for _ in 0..10 {
            let key = pick(DOCUMENT_KEYS);
            assert!(DOCUMENT_KEYS.contains(&key));
        }
    }

    #[test]
    fn test_window_keys_valid() {
        for _ in 0..10 {
            let key = pick(WINDOW_KEYS);
            assert!(WINDOW_KEYS.contains(&key));
        }
    }

    #[test]
    fn test_screen_sizes_valid() {
        for _ in 0..10 {
            let size = pick(SCREEN_SIZES);
            assert!(SCREEN_SIZES.contains(&size));
        }
    }

    #[test]
    fn test_cores_valid() {
        for _ in 0..10 {
            let cores = pick(CORES);
            assert!(CORES.contains(&cores));
        }
    }
}

use wreq::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, ACCEPT_ENCODING, ACCEPT_LANGUAGE, CACHE_CONTROL, ORIGIN, REFERER, USER_AGENT};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Firefox 152 User-Agent string matching OmniRoute
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";

/// OpenAI client version
const OAI_CLIENT_VERSION: &str = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";

/// OpenAI client build number
const OAI_CLIENT_BUILD_NUMBER: &str = "6128297";

/// Generate a stable device ID from the session token
/// Uses SHA-256 hash to ensure same token always produces same device ID
pub fn generate_device_id(session_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session_token.as_bytes());
    let hash = hasher.finalize();
    // Convert to hex and take first 32 chars for device ID
    let hex_str = hex::encode(hash);
    hex_str[..32].to_string()
}

/// Generate a random session ID for a conversation
pub fn generate_session_id() -> String {
    Uuid::new_v4().to_string()
}

/// Build browser-like headers for ChatGPT API requests
/// 
/// # Arguments
/// * `session_token` - The session token for device ID generation
/// * `session_id` - Optional session ID for this conversation (generates new if None)
/// * `include_oai_headers` - Whether to include OpenAI-specific headers
pub fn build_chatgpt_headers(
    device_id: &str,
    session_id: Option<String>,
    include_oai_headers: bool,
) -> HeaderMap {
    let mut headers = HeaderMap::new();

    // Standard browser headers
    headers.insert(USER_AGENT, HeaderValue::from_static(BROWSER_USER_AGENT));
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip, deflate, br"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(ORIGIN, HeaderValue::from_static("https://chatgpt.com"));
    
    // Pragma header
    headers.insert(
        HeaderName::from_static("pragma"),
        HeaderValue::from_static("no-cache"),
    );
    
    headers.insert(REFERER, HeaderValue::from_static("https://chatgpt.com/"));

    // Fetch metadata headers (security)
    headers.insert(
        HeaderName::from_static("sec-fetch-dest"),
        HeaderValue::from_static("empty"),
    );
    headers.insert(
        HeaderName::from_static("sec-fetch-mode"),
        HeaderValue::from_static("cors"),
    );
    headers.insert(
        HeaderName::from_static("sec-fetch-site"),
        HeaderValue::from_static("same-origin"),
    );

    // OpenAI-specific headers
    if include_oai_headers {
        headers.insert(
            HeaderName::from_static("oai-language"),
            HeaderValue::from_static("en-US"),
        );
        
        // Device ID - use provided device_id
        headers.insert(
            HeaderName::from_static("oai-device-id"),
            HeaderValue::from_str(device_id).unwrap(),
        );

        // Client version and build
        headers.insert(
            HeaderName::from_static("oai-client-version"),
            HeaderValue::from_static(OAI_CLIENT_VERSION),
        );
        headers.insert(
            HeaderName::from_static("oai-client-build-number"),
            HeaderValue::from_static(OAI_CLIENT_BUILD_NUMBER),
        );

        // Session ID - generated per conversation or provided
        let sid = session_id.unwrap_or_else(generate_session_id);
        headers.insert(
            HeaderName::from_static("oai-session-id"),
            HeaderValue::from_str(&sid).unwrap(),
        );
    }

    headers
}

/// Build headers specifically for auth/session endpoint
pub fn build_auth_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    
    headers.insert(USER_AGENT, HeaderValue::from_static(BROWSER_USER_AGENT));
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip, deflate, br"));
    headers.insert(ORIGIN, HeaderValue::from_static("https://chatgpt.com"));
    headers.insert(REFERER, HeaderValue::from_static("https://chatgpt.com/"));

    headers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_id_stability() {
        let token = "test_token_123";
        let id1 = generate_device_id(token);
        let id2 = generate_device_id(token);
        assert_eq!(id1, id2, "Same token should produce same device ID");
    }

    #[test]
    fn test_device_id_uniqueness() {
        let id1 = generate_device_id("token1");
        let id2 = generate_device_id("token2");
        assert_ne!(id1, id2, "Different tokens should produce different device IDs");
    }

    #[test]
    fn test_device_id_length() {
        let id = generate_device_id("test_token");
        assert_eq!(id.len(), 32, "Device ID should be 32 characters");
    }

    #[test]
    fn test_session_id_uniqueness() {
        let id1 = generate_session_id();
        let id2 = generate_session_id();
        assert_ne!(id1, id2, "Session IDs should be unique");
    }

    #[test]
    fn test_headers_contain_user_agent() {
        let headers = build_chatgpt_headers("test_token", None, false);
        assert!(headers.contains_key(USER_AGENT));
        assert_eq!(
            headers.get(USER_AGENT).unwrap(),
            BROWSER_USER_AGENT
        );
    }

    #[test]
    fn test_headers_contain_oai_headers() {
        let headers = build_chatgpt_headers("test_token", None, true);
        assert!(headers.contains_key("oai-language"));
        assert!(headers.contains_key("oai-device-id"));
        assert!(headers.contains_key("oai-client-version"));
        assert!(headers.contains_key("oai-session-id"));
    }

    #[test]
    fn test_headers_exclude_oai_when_disabled() {
        let headers = build_chatgpt_headers("test_token", None, false);
        assert!(!headers.contains_key("oai-language"));
        assert!(!headers.contains_key("oai-device-id"));
    }

    #[test]
    fn test_custom_session_id() {
        let custom_id = "my-custom-session-id";
        let headers = build_chatgpt_headers("test_token", Some(custom_id.to_string()), true);
        assert_eq!(
            headers.get("oai-session-id").unwrap(),
            custom_id
        );
    }
}

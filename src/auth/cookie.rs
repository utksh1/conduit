use std::collections::HashMap;

/// Parse session token from various formats:
/// 1. Simple value: "abc123..."
/// 2. Unchunked cookie: "__Secure-next-auth.session-token=abc123"
/// 3. Chunked cookie: "__Secure-next-auth.session-token.0=part1; __Secure-next-auth.session-token.1=part2"
/// 4. Full Cookie header with multiple cookies: "cookie1=val1; __Secure-next-auth.session-token=val; cookie2=val2"
pub fn parse_session_cookie(input: &str) -> ParsedCookie {
    let input = input.trim();
    
    // Check if it looks like a full cookie header (contains "=")
    if !input.contains('=') {
        // Simple token value
        return ParsedCookie {
            session_token: input.to_string(),
            full_cookie_header: format!("__Secure-next-auth.session-token={}", input),
            other_cookies: HashMap::new(),
        };
    }
    
    // Parse as cookie string
    let mut session_chunks: HashMap<String, String> = HashMap::new();
    let mut other_cookies: HashMap<String, String> = HashMap::new();
    
    for cookie_pair in input.split(';') {
        let cookie_pair = cookie_pair.trim();
        if let Some((key, value)) = cookie_pair.split_once('=') {
            let key = key.trim();
            let value = value.trim();
            
            if key == "__Secure-next-auth.session-token" {
                // Unchunked session token
                session_chunks.insert("0".to_string(), value.to_string());
            } else if key.starts_with("__Secure-next-auth.session-token.") {
                // Chunked session token (e.g., .0, .1, .2)
                if let Some(chunk_num) = key.strip_prefix("__Secure-next-auth.session-token.") {
                    session_chunks.insert(chunk_num.to_string(), value.to_string());
                }
            } else {
                // Other cookies (cf_clearance, __cf_bm, _cfuvid, etc.)
                other_cookies.insert(key.to_string(), value.to_string());
            }
        }
    }
    
    // Reconstruct session token from chunks (sorted by chunk number)
    let mut chunk_keys: Vec<String> = session_chunks.keys().cloned().collect();
    chunk_keys.sort();
    
    let session_token = chunk_keys.iter()
        .map(|k| session_chunks.get(k).unwrap().as_str())
        .collect::<Vec<&str>>()
        .join("");
    
    // Build full cookie header
    let full_cookie_header = build_cookie_header(&session_token, &session_chunks, &other_cookies);
    
    ParsedCookie {
        session_token,
        full_cookie_header,
        other_cookies,
    }
}

/// Build a complete Cookie header string
fn build_cookie_header(
    _session_token: &str,
    session_chunks: &HashMap<String, String>,
    other_cookies: &HashMap<String, String>,
) -> String {
    let mut parts = Vec::new();
    
    // Add session token (preserve chunked format if it was chunked)
    if session_chunks.len() == 1 && session_chunks.contains_key("0") {
        // Unchunked
        parts.push(format!("__Secure-next-auth.session-token={}", session_chunks.get("0").unwrap()));
    } else {
        // Chunked - maintain order
        let mut chunk_keys: Vec<String> = session_chunks.keys().cloned().collect();
        chunk_keys.sort();
        for key in chunk_keys {
            let value = session_chunks.get(&key).unwrap();
            parts.push(format!("__Secure-next-auth.session-token.{}={}", key, value));
        }
    }
    
    // Add other cookies
    for (key, value) in other_cookies {
        parts.push(format!("{}={}", key, value));
    }
    
    parts.join("; ")
}

/// Merge rotated session token from Set-Cookie header into existing cookie
/// ChatGPT sometimes rotates tokens by sending Set-Cookie headers
pub fn merge_rotated_cookie(original: &ParsedCookie, set_cookie_headers: &[String]) -> ParsedCookie {
    let mut new_session_chunks: HashMap<String, String> = HashMap::new();
    let mut other_cookies = original.other_cookies.clone();
    
    // Parse all Set-Cookie headers
    for set_cookie in set_cookie_headers {
        // Set-Cookie format: "name=value; Path=/; ..."
        if let Some(cookie_part) = set_cookie.split(';').next() {
            if let Some((key, value)) = cookie_part.split_once('=') {
                let key = key.trim();
                let value = value.trim();
                
                if key == "__Secure-next-auth.session-token" {
                    new_session_chunks.insert("0".to_string(), value.to_string());
                } else if key.starts_with("__Secure-next-auth.session-token.") {
                    if let Some(chunk_num) = key.strip_prefix("__Secure-next-auth.session-token.") {
                        new_session_chunks.insert(chunk_num.to_string(), value.to_string());
                    }
                } else {
                    // Update other cookies
                    other_cookies.insert(key.to_string(), value.to_string());
                }
            }
        }
    }
    
    // If no new session token found, keep original
    if new_session_chunks.is_empty() {
        return ParsedCookie {
            session_token: original.session_token.clone(),
            full_cookie_header: original.full_cookie_header.clone(),
            other_cookies,
        };
    }
    
    // Build new session token
    let mut chunk_keys: Vec<String> = new_session_chunks.keys().cloned().collect();
    chunk_keys.sort();
    
    let session_token = chunk_keys.iter()
        .map(|k| new_session_chunks.get(k).unwrap().as_str())
        .collect::<Vec<&str>>()
        .join("");
    
    let full_cookie_header = build_cookie_header(&session_token, &new_session_chunks, &other_cookies);
    
    ParsedCookie {
        session_token,
        full_cookie_header,
        other_cookies,
    }
}

#[derive(Debug, Clone)]
pub struct ParsedCookie {
    /// The actual session token value (unchunked)
    pub session_token: String,
    /// Full Cookie header string with all cookies
    pub full_cookie_header: String,
    /// Other cookies like cf_clearance, __cf_bm, _cfuvid
    pub other_cookies: HashMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_token() {
        let result = parse_session_cookie("abc123xyz");
        assert_eq!(result.session_token, "abc123xyz");
        assert!(result.full_cookie_header.contains("__Secure-next-auth.session-token=abc123xyz"));
    }

    #[test]
    fn test_parse_unchunked_cookie() {
        let result = parse_session_cookie("__Secure-next-auth.session-token=abc123xyz");
        assert_eq!(result.session_token, "abc123xyz");
        assert!(result.full_cookie_header.contains("__Secure-next-auth.session-token=abc123xyz"));
    }

    #[test]
    fn test_parse_chunked_cookie() {
        let input = "__Secure-next-auth.session-token.0=part1; __Secure-next-auth.session-token.1=part2";
        let result = parse_session_cookie(input);
        assert_eq!(result.session_token, "part1part2");
        assert!(result.full_cookie_header.contains(".0=part1"));
        assert!(result.full_cookie_header.contains(".1=part2"));
    }

    #[test]
    fn test_parse_with_cloudflare_cookies() {
        let input = "__Secure-next-auth.session-token=token123; cf_clearance=cf123; __cf_bm=bm456";
        let result = parse_session_cookie(input);
        assert_eq!(result.session_token, "token123");
        assert_eq!(result.other_cookies.get("cf_clearance"), Some(&"cf123".to_string()));
        assert_eq!(result.other_cookies.get("__cf_bm"), Some(&"bm456".to_string()));
        assert!(result.full_cookie_header.contains("cf_clearance=cf123"));
        assert!(result.full_cookie_header.contains("__cf_bm=bm456"));
    }

    #[test]
    fn test_parse_chunked_with_other_cookies() {
        let input = "__Secure-next-auth.session-token.0=p1; __Secure-next-auth.session-token.1=p2; cf_clearance=cf123";
        let result = parse_session_cookie(input);
        assert_eq!(result.session_token, "p1p2");
        assert_eq!(result.other_cookies.get("cf_clearance"), Some(&"cf123".to_string()));
    }

    #[test]
    fn test_merge_rotated_token() {
        let original = parse_session_cookie("__Secure-next-auth.session-token=old_token; cf_clearance=cf123");
        let set_cookies = vec![
            "__Secure-next-auth.session-token=new_token; Path=/; HttpOnly; Secure".to_string(),
        ];
        
        let merged = merge_rotated_cookie(&original, &set_cookies);
        assert_eq!(merged.session_token, "new_token");
        assert_eq!(merged.other_cookies.get("cf_clearance"), Some(&"cf123".to_string()));
    }

    #[test]
    fn test_merge_chunked_rotation() {
        let original = parse_session_cookie("__Secure-next-auth.session-token=old");
        let set_cookies = vec![
            "__Secure-next-auth.session-token.0=new1; Path=/".to_string(),
            "__Secure-next-auth.session-token.1=new2; Path=/".to_string(),
        ];
        
        let merged = merge_rotated_cookie(&original, &set_cookies);
        assert_eq!(merged.session_token, "new1new2");
    }

    #[test]
    fn test_merge_no_rotation() {
        let original = parse_session_cookie("__Secure-next-auth.session-token=token; cf_clearance=cf123");
        let set_cookies = vec![
            "some_other_cookie=value; Path=/".to_string(),
        ];
        
        let merged = merge_rotated_cookie(&original, &set_cookies);
        assert_eq!(merged.session_token, "token"); // Should keep original
        assert_eq!(merged.other_cookies.get("some_other_cookie"), Some(&"value".to_string()));
    }

    #[test]
    fn test_chunk_order_preserved() {
        // Test that chunks are assembled in correct order even if provided out of order
        let input = "__Secure-next-auth.session-token.2=c; __Secure-next-auth.session-token.0=a; __Secure-next-auth.session-token.1=b";
        let result = parse_session_cookie(input);
        assert_eq!(result.session_token, "abc");
    }
}

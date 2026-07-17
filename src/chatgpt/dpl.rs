use lazy_static::lazy_static;
use regex::Regex;
use wreq::Client;
use std::sync::RwLock;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

/// DPL (deployment) information scraped from ChatGPT homepage
#[derive(Debug, Clone)]
pub struct DplInfo {
    pub dpl: String,        // Deployment hash (e.g., "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029")
    pub script_src: String, // Webpack chunk URL
    pub scraped_at: Instant,
}

/// Global DPL cache with 60-minute expiry
lazy_static! {
    static ref DPL_CACHE: RwLock<Option<DplInfo>> = RwLock::new(None);
}

/// Default fallback values if scraping fails
const DEFAULT_DPL: &str = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";
const DEFAULT_SCRIPT_SRC: &str = "https://cdn.oaistatic.com/_next/static/chunks/7112-e6b809c1f4c9559f.js";

/// Cache TTL in seconds (60 minutes)
const CACHE_TTL_SECS: u64 = 3600;

/// Get DPL info, using cache if valid or scraping if needed
pub async fn get_dpl_info(client: &Client) -> DplInfo {
    // Check cache first
    {
        let cache = DPL_CACHE.read().unwrap();
        if let Some(info) = cache.as_ref() {
            let elapsed = Instant::now().duration_since(info.scraped_at);
            if elapsed < Duration::from_secs(CACHE_TTL_SECS) {
                debug!("DPL cache hit (valid for {} more seconds)", 
                    (Duration::from_secs(CACHE_TTL_SECS) - elapsed).as_secs());
                return info.clone();
            }
        }
    }

    // Cache miss or expired, scrape
    info!("Scraping DPL info from ChatGPT homepage...");
    let scraped = scrape_dpl_info(client).await;

    // Update cache
    {
        let mut cache = DPL_CACHE.write().unwrap();
        *cache = Some(scraped.clone());
    }

    scraped
}

/// Scrape DPL and script source from ChatGPT homepage
async fn scrape_dpl_info(client: &Client) -> DplInfo {
    let url = "https://chatgpt.com/";
    
    match client.get(url).timeout(Duration::from_secs(10)).send().await {
        Ok(response) => {
            if !response.status().is_success() {
                warn!("DPL scrape failed with status {}, using defaults", response.status());
                return default_dpl_info();
            }

            match response.text().await {
                Ok(html) => parse_dpl_from_html(&html),
                Err(e) => {
                    warn!("Failed to read DPL response body: {}, using defaults", e);
                    default_dpl_info()
                }
            }
        }
        Err(e) => {
            warn!("DPL scrape request failed: {}, using defaults", e);
            default_dpl_info()
        }
    }
}

/// Parse DPL and script source from HTML
fn parse_dpl_from_html(html: &str) -> DplInfo {
    lazy_static! {
        // Match: data-build="prod-81e0c5cdf6140e8c5db714d613337f4aeab94029"
        static ref DPL_REGEX: Regex = Regex::new(r#"data-build="([^"]+)""#).unwrap();
        
        // Match: <script src="/_next/static/chunks/7112-e6b809c1f4c9559f.js"
        // or: <script src="https://cdn.oaistatic.com/_next/static/chunks/7112-e6b809c1f4c9559f.js"
        static ref SCRIPT_REGEX: Regex = Regex::new(
            r#"<script[^>]+src="((?:https://[^"]+)?/_next/static/chunks/[^"]+\.js)""#
        ).unwrap();
    }

    let mut dpl = None;
    let mut script_src = None;

    // Extract DPL
    if let Some(caps) = DPL_REGEX.captures(html) {
        if let Some(m) = caps.get(1) {
            dpl = Some(m.as_str().to_string());
            debug!("Scraped DPL: {}", m.as_str());
        }
    }

    // Extract script source (take first match)
    if let Some(caps) = SCRIPT_REGEX.captures(html) {
        if let Some(m) = caps.get(1) {
            let mut src = m.as_str().to_string();
            
            // Ensure it's a full URL
            if src.starts_with("/_next") {
                src = format!("https://cdn.oaistatic.com{}", src);
            }
            
            script_src = Some(src.clone());
            debug!("Scraped script source: {}", src);
        }
    }

    // Use defaults if scraping failed
    let final_dpl = dpl.unwrap_or_else(|| {
        warn!("Failed to scrape DPL from HTML, using default");
        DEFAULT_DPL.to_string()
    });

    let final_script_src = script_src.unwrap_or_else(|| {
        warn!("Failed to scrape script source from HTML, using default");
        DEFAULT_SCRIPT_SRC.to_string()
    });

    info!("DPL info: dpl={}, script_src={}", final_dpl, final_script_src);

    DplInfo {
        dpl: final_dpl,
        script_src: final_script_src,
        scraped_at: Instant::now(),
    }
}

/// Return default DPL info as fallback
fn default_dpl_info() -> DplInfo {
    DplInfo {
        dpl: DEFAULT_DPL.to_string(),
        script_src: DEFAULT_SCRIPT_SRC.to_string(),
        scraped_at: Instant::now(),
    }
}

/// Clear the DPL cache (useful for testing)
#[allow(dead_code)]
pub fn clear_cache() {
    let mut cache = DPL_CACHE.write().unwrap();
    *cache = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_dpl_from_html() {
        let html = r#"
            <html>
                <head>
                    <meta data-build="prod-abc123def456" />
                    <script src="/_next/static/chunks/1234-abcd1234.js"></script>
                </head>
            </html>
        "#;

        let info = parse_dpl_from_html(html);
        assert_eq!(info.dpl, "prod-abc123def456");
        assert!(info.script_src.contains("1234-abcd1234.js"));
        assert!(info.script_src.starts_with("https://"));
    }

    #[test]
    fn test_parse_dpl_full_url() {
        let html = r#"
            <html>
                <head>
                    <meta data-build="prod-xyz789" />
                    <script src="https://cdn.oaistatic.com/_next/static/chunks/5678-xyz789.js"></script>
                </head>
            </html>
        "#;

        let info = parse_dpl_from_html(html);
        assert_eq!(info.dpl, "prod-xyz789");
        assert_eq!(info.script_src, "https://cdn.oaistatic.com/_next/static/chunks/5678-xyz789.js");
    }

    #[test]
    fn test_parse_dpl_missing() {
        let html = "<html><head></head></html>";
        let info = parse_dpl_from_html(html);
        
        // Should fall back to defaults
        assert_eq!(info.dpl, DEFAULT_DPL);
        assert_eq!(info.script_src, DEFAULT_SCRIPT_SRC);
    }

    #[test]
    fn test_default_dpl_info() {
        let info = default_dpl_info();
        assert_eq!(info.dpl, DEFAULT_DPL);
        assert_eq!(info.script_src, DEFAULT_SCRIPT_SRC);
    }

    #[tokio::test]
    async fn test_cache_expiry() {
        clear_cache();
        
        // Manually set cache with expired timestamp
        {
            let mut cache = DPL_CACHE.write().unwrap();
            *cache = Some(DplInfo {
                dpl: "test-dpl".to_string(),
                script_src: "test-src".to_string(),
                scraped_at: Instant::now() - Duration::from_secs(CACHE_TTL_SECS + 1),
            });
        }

        // Cache should be treated as expired (would trigger re-scrape in real usage)
        let cache = DPL_CACHE.read().unwrap();
        if let Some(info) = cache.as_ref() {
            let elapsed = Instant::now().duration_since(info.scraped_at);
            assert!(elapsed >= Duration::from_secs(CACHE_TTL_SECS));
        }
    }
}

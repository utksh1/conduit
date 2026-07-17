use crate::config::SecurityConfig;
use crate::tools::registry::ToolResult;
use wreq::Client;
use std::time::Duration;
use url::Url;
use std::net::IpAddr;
use std::str::FromStr;

pub struct HTTPTool {
    config: SecurityConfig,
    client: Client,
}

impl HTTPTool {
    pub fn new(config: SecurityConfig) -> Self {
        let client = Client::builder()
            .emulation(wreq_util::Emulation::Chrome120)
            .timeout(config.http_timeout)
            .build()
            .expect("Failed to build HTTP client for tools");
            
        Self { config, client }
    }

    fn validate_host(&self, url_str: &str) -> Result<Url, String> {
        let url = Url::parse(url_str).map_err(|e| format!("Invalid URL: {}", e))?;
        
        let host = url.host_str().ok_or("No host found in URL")?;
        
        if self.config.blocked_hosts.contains(host) {
            return Err(format!("Host '{}' is blocked by security policy.", host));
        }
        
        // Block raw IP addresses that might be local/private if they resolve cleanly
        if let Ok(ip) = IpAddr::from_str(host) {
            if ip.is_loopback() || ip.is_unspecified() {
                return Err("Loopback or unspecified IP addresses are blocked.".to_string());
            }
            if let IpAddr::V4(ipv4) = ip {
                if ipv4.is_private() || ipv4.is_link_local() {
                    return Err("Private network IP addresses are blocked.".to_string());
                }
            }
        }
        
        if let Some(allowed) = &self.config.allowed_domains {
            if !allowed.contains(host) {
                return Err(format!("Host '{}' is not in the allowed domains list.", host));
            }
        }

        Ok(url)
    }

    pub async fn execute(&self, method: &str, url_str: &str, body: Option<&str>) -> ToolResult {
        let url = match self.validate_host(url_str) {
            Ok(u) => u,
            Err(e) => return ToolResult { success: false, output: String::new(), error: Some(e) },
        };

        let method = match wreq::Method::from_bytes(method.to_uppercase().as_bytes()) {
            Ok(m) => m,
            Err(_) => return ToolResult { success: false, output: String::new(), error: Some("Invalid HTTP method".to_string()) },
        };

        let mut req = self.client.request(method, url.as_str());
        if let Some(b) = body {
            req = req.body(b.to_string());
        }

        match req.send().await {
            Ok(response) => {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                
                let mut output = text;
                if output.len() > self.config.max_response_size {
                    output.truncate(self.config.max_response_size);
                    output.push_str("\n...[response truncated due to size limit]");
                }

                ToolResult {
                    success: status.is_success(),
                    output,
                    error: if status.is_success() { None } else { Some(format!("HTTP Error: {}", status)) },
                }
            }
            Err(e) => ToolResult {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
            },
        }
    }
}

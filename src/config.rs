use bcrypt::{hash, DEFAULT_COST};
use serde::Deserialize;
use std::collections::HashSet;
use std::env;
use std::net::SocketAddr;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SecurityConfig {
    pub allowed_directories: Vec<String>,
    pub max_file_size: usize,

    pub blocked_hosts: HashSet<String>,
    pub allowed_domains: Option<HashSet<String>>,
    pub max_response_size: usize,
    pub http_timeout: Duration,

    pub allowed_commands: HashSet<String>,
    pub command_timeout: Duration,
    pub max_output_size: usize,
}

#[derive(Clone, Deserialize)]
pub struct Config {
    pub session_token: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub port: u16,
    pub host: String,
    pub proxy_api_key: String,
    #[serde(skip)]
    pub jwt_secret: String,
    #[serde(skip)]
    pub admin_password_hash: String,
    pub tool_force_thinking: bool,
    pub tool_thinking_model: String,
    #[serde(skip)]
    pub security: SecurityConfig,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        dotenv::dotenv().ok();

        let session_token = env::var("CHATGPT_SESSION_TOKEN")
            .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
            .map_err(|_| "CHATGPT_SESSION_TOKEN must be set in the environment")?;

        let access_token = env::var("CHATGPT_ACCESS_TOKEN")
            .ok()
            .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
            .filter(|s| !s.is_empty());
        let refresh_token = env::var("CHATGPT_REFRESH_TOKEN")
            .ok()
            .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
            .filter(|s| !s.is_empty());

        let port_str = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
        let port: u16 = port_str
            .parse()
            .map_err(|_| format!("Invalid PORT: {}", port_str))?;

        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

        let addr_str = format!("{}:{}", host, port);
        if addr_str.parse::<SocketAddr>().is_err() {
            return Err(format!("Invalid HOST:PORT combination: {}", addr_str));
        }

        let proxy_api_key = required_secret("PROXY_API_KEY", 3)?;
        let jwt_secret = required_secret("JWT_SECRET", 32)?;
        let admin_password = required_secret("ADMIN_PASSWORD", 12)?;
        let admin_password_hash = hash(admin_password, DEFAULT_COST)
            .map_err(|_| "Failed to hash ADMIN_PASSWORD")?;

        let allowed_dirs_str = env::var("ALLOWED_DIRECTORIES").unwrap_or_default();
        let allowed_directories = allowed_dirs_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let allowed_cmds_str = env::var("ALLOWED_SHELL_COMMANDS")
            .unwrap_or_else(|_| "ls,cat,grep,echo".to_string());
        let allowed_commands = allowed_cmds_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let blocked_hosts = vec![
            "localhost".to_string(),
            "127.0.0.1".to_string(),
            "0.0.0.0".to_string(),
            "::1".to_string(),
        ]
        .into_iter()
        .collect();

        let security = SecurityConfig {
            allowed_directories,
            max_file_size: 10 * 1024 * 1024,
            blocked_hosts,
            allowed_domains: None,
            max_response_size: 10 * 1024 * 1024,
            http_timeout: Duration::from_secs(30),
            allowed_commands,
            command_timeout: Duration::from_secs(30),
            max_output_size: 1024 * 1024,
        };

        let tool_force_thinking = env::var("TOOL_FORCE_THINKING")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);
        let tool_thinking_model = env::var("TOOL_THINKING_MODEL")
            .unwrap_or_else(|_| "o3".to_string());

        Ok(Config {
            session_token,
            access_token,
            refresh_token,
            port,
            host,
            proxy_api_key,
            jwt_secret,
            admin_password_hash,
            tool_force_thinking,
            tool_thinking_model,
            security,
        })
    }
}

fn required_secret(name: &str, minimum_length: usize) -> Result<String, String> {
    let value = env::var(name).map_err(|_| format!("{} must be set in the environment", name))?;

    if value.len() < minimum_length {
        return Err(format!(
            "{} must be at least {} characters long",
            name, minimum_length
        ));
    }

    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::env;

    #[test]
    #[serial]
    fn test_missing_session_token() {
        let original = env::var("CHATGPT_SESSION_TOKEN").ok();
        env::remove_var("CHATGPT_SESSION_TOKEN");

        if std::path::Path::new(".env").exists() {
            if let Some(val) = original {
                env::set_var("CHATGPT_SESSION_TOKEN", val);
            }
            return;
        }

        let config = Config::from_env();
        assert!(config.is_err());

        if let Some(val) = original {
            env::set_var("CHATGPT_SESSION_TOKEN", val);
        }
    }

    #[test]
    #[serial]
    fn rejects_short_required_secrets() {
        let original = env::var("TEST_SECRET").ok();
        env::set_var("TEST_SECRET", "short");

        assert_eq!(
            required_secret("TEST_SECRET", 8),
            Err("TEST_SECRET must be at least 8 characters long".to_string())
        );

        match original {
            Some(value) => env::set_var("TEST_SECRET", value),
            None => env::remove_var("TEST_SECRET"),
        }
    }
}

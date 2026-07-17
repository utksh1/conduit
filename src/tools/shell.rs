use crate::config::SecurityConfig;
use crate::tools::registry::ToolResult;
use tokio::process::Command;
use tokio::time::timeout;
use std::time::Duration;

pub struct ShellTool {
    config: SecurityConfig,
}

impl ShellTool {
    pub fn new(config: SecurityConfig) -> Self {
        Self { config }
    }

    pub async fn execute(&self, command: &str, args: &[&str]) -> ToolResult {
        if !self.config.allowed_commands.contains(command) {
            return ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Command '{}' is not in the allowed commands whitelist.", command)),
            };
        }

        let child = Command::new(command)
            .args(args)
            .env_remove("GITHUB_TOKEN")
            .output();

        let timeout_res = timeout(self.config.command_timeout, child).await;

        match timeout_res {
            Ok(output_res) => match output_res {
                Ok(output) => {
                    let mut out_str = String::from_utf8_lossy(&output.stdout).to_string();
                    let err_str = String::from_utf8_lossy(&output.stderr).to_string();

                    if !err_str.is_empty() {
                        out_str.push_str("\n--- STDERR ---\n");
                        out_str.push_str(&err_str);
                    }

                    if out_str.len() > self.config.max_output_size {
                        out_str.truncate(self.config.max_output_size);
                        out_str.push_str("\n...[output truncated due to size limit]");
                    }

                    ToolResult {
                        success: output.status.success(),
                        output: out_str,
                        error: if !output.status.success() { Some(format!("Command exited with status {}", output.status)) } else { None },
                    }
                }
                Err(e) => ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(e.to_string()),
                },
            },
            Err(_) => ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("Command timed out after {} seconds", self.config.command_timeout.as_secs())),
            },
        }
    }
}

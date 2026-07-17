use crate::tools::registry::{ToolCall, ToolResult, ToolRegistry};
use crate::tools::filesystem::FilesystemTool;
use crate::tools::http::HTTPTool;
use crate::tools::shell::ShellTool;
use crate::tools::code::CodeTool;
use crate::tools::websearch::WebSearchTool;
use crate::config::SecurityConfig;
use std::sync::Arc;
use wreq::Client;

pub struct ToolExecutor {
    registry: Arc<ToolRegistry>,
    fs: FilesystemTool,
    http: HTTPTool,
    shell: ShellTool,
    code: CodeTool,
    websearch: WebSearchTool,
}

impl ToolExecutor {
    pub fn new(registry: Arc<ToolRegistry>, config: SecurityConfig, client: Client) -> Self {
        Self {
            registry,
            fs: FilesystemTool::new(config.clone()),
            http: HTTPTool::new(config.clone()),
            shell: ShellTool::new(config.clone()),
            code: CodeTool::new(),
            websearch: WebSearchTool::new(client),
        }
    }

    pub async fn execute(&self, call: &ToolCall) -> ToolResult {
        let name = call.name.as_str();
        
        match name {
            "read_file" => {
                if let Some(path) = call.arguments.get("path").and_then(|v| v.as_str()) {
                    self.fs.read(path)
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'path'".to_string()) }
                }
            },
            "write_file" => {
                if let (Some(path), Some(content)) = (
                    call.arguments.get("path").and_then(|v| v.as_str()),
                    call.arguments.get("content").and_then(|v| v.as_str())
                ) {
                    self.fs.write(path, content)
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'path' or 'content'".to_string()) }
                }
            },
            "list_dir" => {
                if let Some(path) = call.arguments.get("path").and_then(|v| v.as_str()) {
                    self.fs.list(path)
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'path'".to_string()) }
                }
            },
            "delete_file" => {
                if let Some(path) = call.arguments.get("path").and_then(|v| v.as_str()) {
                    self.fs.delete(path)
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'path'".to_string()) }
                }
            },
            "create_dir" => {
                if let Some(path) = call.arguments.get("path").and_then(|v| v.as_str()) {
                    self.fs.mkdir(path)
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'path'".to_string()) }
                }
            },
            "file_exists" => {
                if let Some(path) = call.arguments.get("path").and_then(|v| v.as_str()) {
                    self.fs.exists(path)
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'path'".to_string()) }
                }
            },
            "http_request" => {
                if let (Some(method), Some(url)) = (
                    call.arguments.get("method").and_then(|v| v.as_str()),
                    call.arguments.get("url").and_then(|v| v.as_str())
                ) {
                    let body = call.arguments.get("body").and_then(|v| v.as_str());
                    self.http.execute(method, url, body).await
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'method' or 'url'".to_string()) }
                }
            },
            "shell_execute" => {
                if let Some(command) = call.arguments.get("command").and_then(|v| v.as_str()) {
                    let mut args = Vec::new();
                    if let Some(args_val) = call.arguments.get("args").and_then(|v| v.as_array()) {
                        for arg in args_val {
                            if let Some(s) = arg.as_str() {
                                args.push(s);
                            }
                        }
                    }
                    self.shell.execute(command, &args).await
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'command'".to_string()) }
                }
            },
            "code_analyze" => {
                if let (Some(operation), Some(code)) = (
                    call.arguments.get("operation").and_then(|v| v.as_str()),
                    call.arguments.get("code").and_then(|v| v.as_str())
                ) {
                    let lang = call.arguments.get("language").and_then(|v| v.as_str()).unwrap_or("rust");
                    self.code.execute(operation, code, lang)
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'operation' or 'code'".to_string()) }
                }
            }
            "web_search" => {
                if let Some(query) = call.arguments.get("query").and_then(|v| v.as_str()) {
                    let max_results = call.arguments.get("max_results")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(5) as usize;
                    self.websearch.search(query, max_results).await
                } else {
                    ToolResult { success: false, output: "".to_string(), error: Some("Missing 'query'".to_string()) }
                }
            }
            _ => {
                ToolResult { success: false, output: "".to_string(), error: Some(format!("Executor not implemented for tool: {}", name)) }
            }
        }
    }
}

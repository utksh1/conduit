use super::registry::ToolCall;
use serde_json::{json, Value};
use regex::Regex;

pub fn extract_tool_calls_heuristic(content: &str, available_tools: &[String]) -> Option<Vec<ToolCall>> {
    let mut calls = Vec::new();
    let content_lower = content.to_lowercase();
    
    // Pattern 1: "list files in /path" -> list_dir
    if content_lower.contains("list") && (content_lower.contains("files") || content_lower.contains("directory") || content_lower.contains("dir")) {
        if let Some(path) = extract_path(&content) {
            if available_tools.contains(&"list_dir".to_string()) {
                calls.push(ToolCall {
                    id: format!("call_{}", uuid::Uuid::new_v4()),
                    name: "list_dir".to_string(),
                    arguments: json!({"path": path}),
                });
            }
        }
    }
    
    // Pattern 2: "read /path/file" -> read_file
    if content_lower.contains("read") && !content_lower.contains("already") {
        if let Some(path) = extract_path(&content) {
            if available_tools.contains(&"read_file".to_string()) {
                calls.push(ToolCall {
                    id: format!("call_{}", uuid::Uuid::new_v4()),
                    name: "read_file".to_string(),
                    arguments: json!({"path": path}),
                });
            }
        }
    }
    
    // Pattern 3: "write 'content' to /path" -> write_file
    if content_lower.contains("write") || content_lower.contains("create") {
        if let Some((content_text, path)) = extract_write_params(&content) {
            if available_tools.contains(&"write_file".to_string()) {
                calls.push(ToolCall {
                    id: format!("call_{}", uuid::Uuid::new_v4()),
                    name: "write_file".to_string(),
                    arguments: json!({"path": path, "content": content_text}),
                });
            }
        }
    }
    
    // Pattern 4: "check if /path exists" -> file_exists
    if (content_lower.contains("check") || content_lower.contains("exists")) && content_lower.contains("exist") {
        if let Some(path) = extract_path(&content) {
            if available_tools.contains(&"file_exists".to_string()) {
                calls.push(ToolCall {
                    id: format!("call_{}", uuid::Uuid::new_v4()),
                    name: "file_exists".to_string(),
                    arguments: json!({"path": path}),
                });
            }
        }
    }
    
    // Pattern 5: "search for X" -> web_search
    if content_lower.contains("search") && !content_lower.contains("file") {
        if let Some(query) = extract_search_query(&content) {
            if available_tools.contains(&"web_search".to_string()) {
                calls.push(ToolCall {
                    id: format!("call_{}", uuid::Uuid::new_v4()),
                    name: "web_search".to_string(),
                    arguments: json!({"query": query, "max_results": 5}),
                });
            }
        }
    }
    
    if calls.is_empty() {
        None
    } else {
        Some(calls)
    }
}

fn extract_path(text: &str) -> Option<String> {
    let re = Regex::new(r"(/[^\s,;]+)").ok()?;
    re.captures(text)?.get(1).map(|m| m.as_str().to_string())
}

fn extract_write_params(text: &str) -> Option<(String, String)> {
    let re = Regex::new(r#"['"]([^'"]+)['"].*?(/[^\s,;]+)"#).ok()?;
    let caps = re.captures(text)?;
    Some((caps.get(1)?.as_str().to_string(), caps.get(2)?.as_str().to_string()))
}

fn extract_search_query(text: &str) -> Option<String> {
    let re = Regex::new(r#"search\s+(?:for\s+)?['"]?([^'"]+?)['"]?\s*(?:\.|$)"#).ok()?;
    re.captures(&text.to_lowercase())?.get(1).map(|m| m.as_str().to_string())
}

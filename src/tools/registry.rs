use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value, // JSON schema
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct ToolRegistry {
    tools: Arc<HashMap<String, ToolDefinition>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: Arc::new(HashMap::new()),
        }
    }

    pub fn register(&mut self, tool: ToolDefinition) {
        Arc::make_mut(&mut self.tools).insert(tool.name.clone(), tool);
    }

    pub fn lookup(&self, name: &str) -> Option<ToolDefinition> {
        self.tools.get(name).cloned()
    }

    pub fn all_definitions(&self) -> Vec<ToolDefinition> {
        self.tools.values().cloned().collect()
    }
}

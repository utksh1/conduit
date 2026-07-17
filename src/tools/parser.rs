use super::registry::{ToolCall, ToolRegistry};
use serde_json::Value;

pub const TOOL_CALL_START: &str = "```tool_call";
pub const TOOL_CALL_END: &str = "```";

pub struct ToolParser<'a> {
    registry: &'a ToolRegistry,
}

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NoMarkersFound,
    MalformedJson(String),
    ValidationError(String),
}

impl<'a> ToolParser<'a> {
    pub fn new(registry: &'a ToolRegistry) -> Self {
        Self { registry }
    }

    /// Extracts the JSON payload situated between the tool call markers.
    /// This represents the Chimera Parsing Strategy.
    pub fn extract_between_markers(content: &str) -> Option<String> {
        if let Some(start_idx) = content.find(TOOL_CALL_START) {
            let json_start = start_idx + TOOL_CALL_START.len();
            if let Some(end_idx) = content[json_start..].find(TOOL_CALL_END) {
                return Some(content[json_start..json_start + end_idx].trim().to_string());
            }
        }
        None
    }

    /// Parses the extracted string into a list of ToolCalls and validates them.
    pub fn parse_tool_calls(&self, content: &str) -> Result<Vec<ToolCall>, ParseError> {
        let json_str = match Self::extract_between_markers(content) {
            Some(s) => s,
            None => return Err(ParseError::NoMarkersFound),
        };

        let parsed: Value = serde_json::from_str(&json_str)
            .map_err(|e| ParseError::MalformedJson(format!("Invalid JSON in tool call: {}", e)))?;

        let calls_array = parsed
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .ok_or_else(|| ParseError::MalformedJson("Missing 'tool_calls' array in payload".to_string()))?;

        let mut valid_calls = Vec::new();

        for call_val in calls_array {
            let call: ToolCall = serde_json::from_value(call_val.clone())
                .map_err(|e| ParseError::MalformedJson(format!("Malformed tool call structure: {}", e)))?;
            
            self.validate_tool_call(&call)?;
            valid_calls.push(call);
        }

        Ok(valid_calls)
    }

    /// Validates a single ToolCall against its schema in the registry.
    pub fn validate_tool_call(&self, call: &ToolCall) -> Result<(), ParseError> {
        let _definition = self.registry.lookup(&call.name)
            .ok_or_else(|| ParseError::ValidationError(format!("Unknown tool requested: {}", call.name)))?;

        if !call.arguments.is_object() {
            return Err(ParseError::ValidationError(format!("Tool {} arguments must be a JSON object", call.name)));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::registry::ToolDefinition;
    use serde_json::json;

    #[test]
    fn test_extract_between_markers() {
        let content = "Some text before\n```tool_call\n{\"test\": true}\n```\nSome text after";
        let extracted = ToolParser::extract_between_markers(content);
        assert_eq!(extracted.unwrap(), "{\"test\": true}");
    }
}

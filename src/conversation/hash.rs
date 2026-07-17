use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub r#type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

pub fn hash_messages(messages: &[CleanMessage]) -> String {
    let mut hasher = Sha256::new();
    let json = serde_json::to_string(messages).unwrap_or_default();
    hasher.update(json.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_messages() {
        let msg = CleanMessage {
            role: "user".to_string(),
            content: Some("Hello".to_string()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };
        let hash1 = hash_messages(&[msg.clone()]);
        let hash2 = hash_messages(&[msg]);
        assert_eq!(hash1, hash2);
        
        let msg2 = CleanMessage {
            role: "user".to_string(),
            content: Some("World".to_string()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };
        let hash3 = hash_messages(&[msg2]);
        assert_ne!(hash1, hash3);
    }
}

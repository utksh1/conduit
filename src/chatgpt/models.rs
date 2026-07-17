use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<Value>, // OpenAI format messages
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    // Add other fields as necessary (tools, etc.)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatGPTRequest {
    pub action: String,
    pub messages: Vec<ChatGPTMessage>,
    pub model: String,
    pub parent_message_id: String,
    pub timezone_offset_min: i32,
    pub history_and_training_disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatGPTMessage {
    pub id: String,
    pub author: Author,
    pub content: Content,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Author {
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Content {
    pub content_type: String,
    pub parts: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatGPTChunk {
    pub message: Option<ChatGPTResponseMessage>,
    pub conversation_id: Option<String>,
    pub error: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatGPTResponseMessage {
    pub id: String,
    pub author: Author,
    pub content: ResponseContent,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseContent {
    pub content_type: String,
    pub parts: Option<Vec<String>>,
}

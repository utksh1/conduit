use serde_json::{json, Value};

pub struct StreamTransformer {
    previous_content: String,
}

impl StreamTransformer {
    pub fn new() -> Self {
        Self {
            previous_content: String::new(),
        }
    }

    /// Transforms an accumulated ChatGPT chunk content into a delta for OpenAI format
    pub fn transform_chunk(&mut self, current_content: &str) -> String {
        // Strip the previous content prefix if it matches
        let delta = if current_content.starts_with(&self.previous_content) {
            current_content[self.previous_content.len()..].to_string()
        } else {
            // Fallback: just use current content if it doesn't match (shouldn't happen normally)
            current_content.to_string()
        };
        
        self.previous_content = current_content.to_string();
        delta
    }

    /// Builds an OpenAI SSE response string from a delta string
    pub fn build_sse_response(&self, id: &str, model: &str, delta: &str) -> String {
        let chunk = json!({
            "id": id,
            "object": "chat.completion.chunk",
            "model": model,
            "choices": [{
                "index": 0,
                "delta": {
                    "content": delta
                }
            }]
        });

        format!("data: {}\n\n", chunk)
    }

    /// Returns the DONE marker
    pub fn done_marker() -> &'static str {
        "data: [DONE]\n\n"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_chunk() {
        let mut transformer = StreamTransformer::new();
        
        let delta1 = transformer.transform_chunk("Hello");
        assert_eq!(delta1, "Hello");
        
        let delta2 = transformer.transform_chunk("Hello world");
        assert_eq!(delta2, " world");
        
        let delta3 = transformer.transform_chunk("Hello world!");
        assert_eq!(delta3, "!");
    }
}

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ConversationContext {
    pub conversation_id: String,
    pub parent_message_id: String,
    // Original tool calls mapped by their ID to recover full tool call structure if needed
    pub original_tool_calls: HashMap<String, Value>,
    pub last_accessed: std::time::Instant,
}

#[derive(Clone)]
pub struct ConversationCache {
    cache: Arc<RwLock<HashMap<String, ConversationContext>>>,
}

impl ConversationCache {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn lookup(&self, hash: &str) -> Option<ConversationContext> {
        let cache = self.cache.read().await;
        cache.get(hash).cloned()
    }

    pub async fn store(&self, hash: String, mut ctx: ConversationContext) {
        let mut cache = self.cache.write().await;
        ctx.last_accessed = std::time::Instant::now();
        cache.insert(hash, ctx);

        if cache.len() > 1000 {
            // Evict oldest 20%
            let mut entries: Vec<_> = cache.iter().map(|(k, v)| (k.clone(), v.last_accessed)).collect();
            entries.sort_by_key(|&(_, t)| t);
            for (k, _) in entries.iter().take(200) {
                cache.remove(k);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cache_operations() {
        let cache = ConversationCache::new();
        let hash = "abcdef123456".to_string();
        
        let ctx = ConversationContext {
            conversation_id: "conv-1".to_string(),
            parent_message_id: "msg-1".to_string(),
            original_tool_calls: HashMap::new(),
            last_accessed: std::time::Instant::now(),
        };

        // Initially empty
        assert!(cache.lookup(&hash).await.is_none());

        // Store and retrieve
        cache.store(hash.clone(), ctx.clone()).await;
        let retrieved = cache.lookup(&hash).await.unwrap();
        
        assert_eq!(retrieved.conversation_id, "conv-1");
        assert_eq!(retrieved.parent_message_id, "msg-1");
    }
}

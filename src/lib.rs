pub mod auth;
pub mod chatgpt;
pub mod config;
pub mod conversation;
pub mod error;
pub mod middleware;
pub mod routes;
pub mod streaming;
pub mod tools;
pub mod db;

use std::sync::Arc;
use auth::AuthManager;
use chatgpt::client::ChatGPTClient;
use chatgpt::warmup::WarmupCache;
use config::Config;
use conversation::cache::ConversationCache;
use tools::{ToolRegistry, ToolExecutor};

pub struct AppState {
    pub config: Arc<Config>,
    pub auth_manager: AuthManager,
    pub chatgpt_client: ChatGPTClient,
    pub conversation_cache: ConversationCache,
    pub warmup_cache: WarmupCache,
    pub tool_registry: Arc<ToolRegistry>,
    pub tool_executor: Arc<ToolExecutor>,
    pub db: Arc<tokio_rusqlite::Connection>,
}

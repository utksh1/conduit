use conduit::*;

use axum::{
    routing::{get, post, patch, delete},
    Router, middleware,
};
use chatgpt::warmup::WarmupCache;
use config::Config;
use wreq::Client;
use wreq_util::Emulation;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing::{error, info};
use auth::AuthManager;
use chatgpt::client::ChatGPTClient;
use conversation::cache::ConversationCache;
use tools::{ToolRegistry, ToolDefinition, ToolExecutor};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to load configuration: {}", e);
            std::process::exit(1);
        }
    };

    // Build wreq client with Chrome 120 TLS fingerprint
    let client = Client::builder()
        .emulation(Emulation::Chrome120)
        .brotli(true)
        .gzip(true)
        .deflate(true)
        .cookie_store(true)
        .build()
        .expect("Failed to build wreq client");

    let auth_manager = AuthManager::new(config.session_token.clone(), client.clone(), None);
    let chatgpt_client = ChatGPTClient::new(auth_manager.clone(), client.clone(), None);
    let conversation_cache = ConversationCache::new();
    let warmup_cache = WarmupCache::new(60, 200); // 60 second TTL, 200 max entries

    let mut tool_registry = ToolRegistry::new();
    
    // Register filesystem tools
    tool_registry.register(ToolDefinition {
        name: "read_file".to_string(),
        description: "Read the contents of a file from the filesystem".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the file to read" }
            },
            "required": ["path"]
        }),
    });
    
    tool_registry.register(ToolDefinition {
        name: "write_file".to_string(),
        description: "Write content to a file. Creates the file if it doesn't exist.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the file to write" },
                "content": { "type": "string", "description": "Content to write to the file" }
            },
            "required": ["path", "content"]
        }),
    });

    tool_registry.register(ToolDefinition {
        name: "list_dir".to_string(),
        description: "List contents of a directory".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the directory to list" }
            },
            "required": ["path"]
        }),
    });

    tool_registry.register(ToolDefinition {
        name: "delete_file".to_string(),
        description: "Delete a file from the filesystem".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the file to delete" }
            },
            "required": ["path"]
        }),
    });

    tool_registry.register(ToolDefinition {
        name: "create_dir".to_string(),
        description: "Create a new directory".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to the directory to create" }
            },
            "required": ["path"]
        }),
    });

    tool_registry.register(ToolDefinition {
        name: "file_exists".to_string(),
        description: "Check if a file or directory exists".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Path to check for existence" }
            },
            "required": ["path"]
        }),
    });

    // Register HTTP tool
    tool_registry.register(ToolDefinition {
        name: "http_request".to_string(),
        description: "Make an HTTP request to a URL".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "method": { "type": "string", "description": "HTTP method (GET, POST, PUT, DELETE)", "enum": ["GET", "POST", "PUT", "DELETE"] },
                "url": { "type": "string", "description": "URL to request" },
                "body": { "type": "string", "description": "Optional request body (for POST/PUT)" }
            },
            "required": ["method", "url"]
        }),
    });

    // Register shell tool
    tool_registry.register(ToolDefinition {
        name: "shell_execute".to_string(),
        description: format!("Execute a shell command. Only whitelisted commands are allowed: {}",
            config.security.allowed_commands.iter().cloned().collect::<Vec<_>>().join(", ")),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Command to execute (must be in whitelist)" },
                "args": { "type": "array", "items": { "type": "string" }, "description": "Arguments to pass to the command" }
            },
            "required": ["command"]
        }),
    });

    // Register code analysis tool
    tool_registry.register(ToolDefinition {
        name: "code_analyze".to_string(),
        description: "Analyze code (lint, format check)".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "operation": { "type": "string", "description": "Operation to perform (lint, format)", "enum": ["lint", "format"] },
                "code": { "type": "string", "description": "Code to analyze" },
                "language": { "type": "string", "description": "Programming language (rust, python, javascript, etc.)" }
            },
            "required": ["operation", "code"]
        }),
    });

    // Register websearch tool
    tool_registry.register(ToolDefinition {
        name: "web_search".to_string(),
        description: "Search the web using DuckDuckGo. Returns titles, URLs, and snippets.".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Search query" },
                "max_results": { "type": "integer", "description": "Maximum number of results (default: 5)", "default": 5 }
            },
            "required": ["query"]
        }),
    });

    let tool_registry = Arc::new(tool_registry);
    let tool_executor = Arc::new(ToolExecutor::new(tool_registry.clone(), config.security.clone(), client.clone()));

    let db = match db::init_db("conduit.db").await {
        Ok(d) => Arc::new(d),
        Err(e) => {
            error!("Failed to init DB: {}", e);
            std::process::exit(1);
        }
    };

    let state = Arc::new(AppState {
        config: Arc::new(config.clone()),
        auth_manager,
        chatgpt_client,
        conversation_cache,
        warmup_cache,
        tool_registry,
        tool_executor,
        db,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let protected_routes = Router::new()
        .route("/keys", get(routes::keys::list_keys).post(routes::keys::create_key))
        .route("/keys/{id}", patch(routes::keys::update_key).delete(routes::keys::delete_key))
        .route("/keys/{id}/rotate", post(routes::keys::rotate_key))
        .route("/logs", get(routes::telemetry::get_logs))
        .route("/metrics", get(routes::telemetry::get_metrics))
        .route("/audit", get(routes::telemetry::get_audit))
        .layer(middleware::from_fn(conduit::middleware::require_auth));

    let admin_routes = Router::new()
        .route("/auth/status", get(routes::auth::status))
        .route("/auth/setup", post(routes::auth::setup))
        .route("/auth/login", post(routes::auth::login))
        .merge(protected_routes);

    // Build API routes
    let mut app = Router::new()
        .route("/v1/models", get(routes::models::list_models))
        .route("/v1/chat/completions", post(routes::chat::chat_completions))
        .route("/v1/files/{*file_id}", get(routes::files::get_file))
        .route("/health", get(health_check))
        .nest("/api", admin_routes)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    // Serve dashboard static files if directory exists
    let dashboard_path = std::path::Path::new("dashboard/dist");
    if dashboard_path.exists() {
        info!("Serving dashboard from dashboard/dist");
        app = app.fallback_service(
            ServeDir::new("dashboard/dist")
                .fallback(ServeFile::new("dashboard/dist/index.html"))
        );
    } else {
        info!("Dashboard not found at dashboard/dist — skipping static file serving");
    }

    let addr_str = format!("{}:{}", state.config.host, state.config.port);
    let addr: SocketAddr = addr_str.parse().expect("Invalid address");
    
    info!("Starting server on {}", addr);
    info!("API endpoints: /v1/chat/completions, /v1/models, /health");
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

/// Health check endpoint for monitoring and load balancers.
async fn health_check() -> &'static str {
    "ok"
}
